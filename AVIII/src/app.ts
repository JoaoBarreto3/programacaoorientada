import { existsSync } from "node:fs";
import path from "node:path";
import Fastify, { FastifyInstance, FastifyReply, FastifyServerOptions } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import { Configuracao } from "./config/configuracao";
import { PrismaClient } from "./infra/banco";
import { criarFila } from "./infra/fila/criarFila";
import { FilaTarefas } from "./infra/fila/FilaTarefas";
import Relogio, { RelogioSistema } from "./comum/Relogio";
import Servicos from "./servicos/Servicos";
import { iniciarProcessamento } from "./servicos/processamento";
import { registrarSchemas } from "./http/schemas";
import { registrarJwt, registrarAutenticacao, CABECALHO_TOKEN_RENOVADO } from "./http/plugins/autenticacao";
import { decorarParceiro } from "./http/plugins/autenticacaoParceiro";
import { registrarLimites } from "./http/plugins/limites";
import { corpo as corpoErro, registrarTratamentoErros } from "./http/plugins/tratamentoErros";
import { ErroValidacao } from "./comum/erros";
import ControllerAutenticacao from "./http/controllers/ControllerAutenticacao";
import ControllerUsuario from "./http/controllers/ControllerUsuario";
import ControllerOrganizacao from "./http/controllers/ControllerOrganizacao";
import ControllerLote from "./http/controllers/ControllerLote";
import ControllerEquipamento from "./http/controllers/ControllerEquipamento";
import ControllerAdministracao from "./http/controllers/ControllerAdministracao";
import ControllerAnalise from "./http/controllers/ControllerAnalise";
import ControllerChaveApi from "./http/controllers/ControllerChaveApi";
import ControllerRelatorioAssincrono from "./http/controllers/ControllerRelatorioAssincrono";
import ControllerPublico, { VERSAO_API_PUBLICA } from "./http/controllers/ControllerPublico";

export const VERSAO_API = "3.0.0";
export const PREFIXO_INTERNO = "/api/v1/internal";
export const PREFIXO_PUBLICO = "/api/v1/public";
const PASTA_FRONTEND = path.resolve(__dirname, "..", "..", "public");

export interface OpcoesApp {
    config: Configuracao;
    prisma: PrismaClient;
    relogio?: Relogio;
    logger?: FastifyServerOptions["logger"];
    // Fila pronta (testes); se ausente, é criada conforme a configuração (Redis ou memória).
    fila?: FilaTarefas;
    // Prefixo das chaves no Redis (testes usam um próprio para não misturar com o desenvolvimento).
    prefixoRedis?: string;
}

type Especificacao = Readonly<Record<string, any>>;

// Uma única especificação OpenAPI gera duas documentações: a interna (/docs), com as rotas do
// front-end e da gestão, e a pública (/api/v1/public/docs), só com o contrato dos parceiros.
function filtrarEspecificacao(spec: Especificacao, publica: boolean): Record<string, any> {
    const paths = Object.fromEntries(Object.entries(spec.paths ?? {})
        .filter(([rota]) => rota.startsWith(PREFIXO_PUBLICO) === publica && !rota.includes("/docs")));
    if (!publica) {
        return { ...spec, paths };
    }
    const { bearerAuth: _interno, ...esquemas } = spec.components?.securitySchemes ?? {};
    return {
        ...spec,
        paths,
        info: {
            title: "greencode API pública",
            version: VERSAO_API_PUBLICA,
            description: [
                "API de integração do greencode para parceiros: rastreabilidade de equipamentos, submissão de lotes,",
                "análises (eficiência, rentabilidade e vida útil) e relatórios completos gerados em segundo plano.",
                "",
                "**Autenticação:** envie a chave recebida no cabeçalho `X-API-Key: gc_<prefixo>_<segredo>` (botão Authorize).",
                "Cada chave tem escopos (o que pode fazer), um plano (limites) e, em geral, uma organização (só vê os dados dela).",
                "",
                "**Limites:** por plano — BASICO 60 req/min e 2 relatórios simultâneos; PROFISSIONAL 300 e 5; CORPORATIVO 1200 e 20.",
                "Toda resposta traz `x-ratelimit-limit`, `x-ratelimit-remaining` e `x-ratelimit-reset`; ao exceder, HTTP 429 com `Retry-After`.",
                "",
                "**Versão:** o número da versão está na URL (`/api/v1/public`) e no cabeçalho `api-version` das respostas.",
                "Mudanças compatíveis (campos novos) entram na v1; mudanças incompatíveis só numa v2, mantendo a v1 por um período de depreciação anunciado.",
                "",
                "**Erros:** sempre no formato `{ statusCode, erro: { codigo, mensagem, severidade } }`. Códigos: VALIDACAO (400), CHAVE_API (401),",
                "PERMISSAO (403), NAO_ENCONTRADO (404), CONFLITO e DUPLICIDADE (409), EXPIRADO (410), REGRA_NEGOCIO (422), LIMITE_REQUISICOES (429), INTERNO (500)."
            ].join("\n")
        },
        components: { ...spec.components, securitySchemes: esquemas },
        tags: [
            { name: "Conta", description: "Dados da chave de API" },
            { name: "Rastreabilidade", description: "Situação e histórico de equipamentos" },
            { name: "Lotes", description: "Consulta e submissão de lotes" },
            { name: "Análises", description: "Indicadores calculados na hora" },
            { name: "Relatórios", description: "Relatórios completos processados em segundo plano (fila)" }
        ]
    };
}

function contemCaractereNulo(valor: unknown, profundidade = 0): boolean {
    if (typeof valor === "string") return valor.includes("\u0000");
    if (profundidade > 20 || valor === null || typeof valor !== "object") return false;
    return Object.entries(valor).some(([chave, v]) => chave.includes("\u0000") || contemCaractereNulo(v, profundidade + 1));
}

// Monta a aplicação (sem abrir a porta): usada pelo server.ts e pelos testes (app.inject).
export async function construirApp(opcoes: OpcoesApp): Promise<FastifyInstance> {
    const { config, prisma } = opcoes;
    const app = Fastify({
        logger: opcoes.logger ?? { level: config.logNivel },
        // No desligamento, fecha conexões keep-alive ociosas sem esperar o cliente.
        forceCloseConnections: "idle",
        bodyLimit: 1024 * 1024,
        // Atrás de um proxy reverso (Nginx/Caddy), o IP real do cliente vem no X-Forwarded-For.
        trustProxy: process.env.TRUST_PROXY === "true",
        ajv: { customOptions: { allErrors: false } },
        // Erros do próprio roteador (parâmetro longo demais, URL mal codificada, corpo ilegível)
        // no mesmo formato padronizado das demais respostas de erro.
        frameworkErrors: (erro, _req, res) => {
            const status = erro.statusCode && erro.statusCode < 500 ? erro.statusCode : 400;
            (res as unknown as FastifyReply).status(status).send(corpoErro(status, "REQUISICAO", `Requisição inválida: ${erro.message}`));
        }
    });

    registrarSchemas(app);
    await app.register(fastifySwagger, {
        openapi: {
            info: {
                title: "greencode API interna",
                description: "API interna do greencode (front-end e equipe de gestão): logística reversa de resíduos eletrônicos. " +
                    "Autentique em POST /api/v1/internal/auth/login e use o token no botão Authorize. " +
                    "A documentação para parceiros fica em /api/v1/public/docs.",
                version: VERSAO_API
            },
            components: {
                securitySchemes: {
                    bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
                    chaveApi: { type: "apiKey", in: "header", name: "X-API-Key", description: "Chave de API do parceiro: gc_<prefixo>_<segredo>" }
                }
            }
        }
    });
    // Cada interface de documentação num contexto encapsulado (o plugin não pode ser registrado
    // duas vezes no mesmo contexto).
    await app.register(async ctx => {
        await ctx.register(fastifySwaggerUi, { routePrefix: "/docs", transformSpecification: spec => filtrarEspecificacao(spec, false) });
    });
    await app.register(async ctx => {
        await ctx.register(fastifySwaggerUi, { routePrefix: `${PREFIXO_PUBLICO}/docs`, transformSpecification: spec => filtrarEspecificacao(spec, true) });
    });
    await registrarLimites(app, config.redisUrl);

    const relogio = opcoes.relogio ?? new RelogioSistema();
    const fila = opcoes.fila ?? criarFila(config, app.log, opcoes.prefixoRedis);
    const emissor = await registrarJwt(app, config.jwtSegredo, config.sessaoMinutos);
    const servicos = new Servicos(prisma, relogio, emissor, config.iteracoesSenha, fila, {
        retencaoHoras: config.relatorioRetencaoHoras, simultaneosPorUsuario: config.relatoriosSimultaneosPorUsuario
    });
    registrarAutenticacao(app, servicos.autenticacao);
    decorarParceiro(app);
    registrarTratamentoErros(app);
    if (fila.tipo === "memoria") {
        app.log.warn("REDIS_URL não definida: fila de relatórios em memória (adequada só a desenvolvimento e a uma única instância).");
    }

    // Worker embutido: o próprio servidor processa a fila e os agendamentos. Não bloqueia a
    // partida: com o Redis fora do ar, a API sobe assim mesmo (saúde "degradado") e as tarefas
    // ficam PENDENTES no banco até a fila voltar.
    if (config.workerEmbutido) {
        app.addHook("onReady", async () => {
            iniciarProcessamento(servicos, config, app.log)
                .catch(erro => app.log.error({ err: erro }, "Falha ao iniciar o processamento da fila e dos agendamentos."));
        });
    }
    app.addHook("onClose", async () => { await fila.fechar(); });

    // O caractere nulo (U+0000) não tem uso legítimo em nenhum campo e o PostgreSQL não o aceita em
    // texto: é recusado na entrada (400), em vez de chegar ao banco e virar erro interno.
    app.addHook("preValidation", async req => {
        if (contemCaractereNulo(req.body) || contemCaractereNulo(req.query) || contemCaractereNulo(req.params)) {
            throw new ErroValidacao("A requisição contém o caractere nulo (U+0000), que não é aceito.");
        }
    });

    // Cabeçalhos de segurança em todas as respostas.
    app.addHook("onSend", async (req, resposta) => {
        resposta.header("x-content-type-options", "nosniff");
        resposta.header("x-frame-options", "DENY");
        resposta.header("referrer-policy", "no-referrer");
        resposta.header("cross-origin-opener-policy", "same-origin");
        resposta.header("permissions-policy", "camera=(), microphone=(), geolocation=()");
        // Content-Security-Policy: o front-end só executa o próprio app.js (nenhum script embutido ou
        // injetado roda, mesmo que um dado malicioso escape para o HTML); a API não carrega nada.
        // A interface do Swagger (/docs) tem scripts próprios e fica de fora.
        // A política é escolhida pelo endereço, não pelo tipo de conteúdo: arquivos estáticos (e respostas
        // 304 do cache) ainda não têm o content-type definido neste ponto.
        if (!req.url.includes("/docs")) {
            const api = req.url.startsWith("/api/");
            resposta.header("content-security-policy", !api
                ? "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
                  "connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
                : "default-src 'none'; frame-ancestors 'none'");
        }
        resposta.header("access-control-expose-headers", `${CABECALHO_TOKEN_RENOVADO}, api-version, x-ratelimit-limit, x-ratelimit-remaining, x-ratelimit-reset, retry-after`);
    });

    // Versão 1 da API REST anterior (AV2) em /api/...: redireciona para /api/v1/internal/... com
    // 308 (mantém método e corpo) e cabeçalhos de depreciação, para clientes antigos migrarem.
    app.addHook("onRequest", async (req, res) => {
        const url = req.url;
        if (url.startsWith("/api/") && !url.startsWith("/api/v1/") && !url.startsWith("/api/saude")) {
            return res.status(308)
                .header("location", `${PREFIXO_INTERNO}${url.slice(4)}`)
                .header("deprecation", "true")
                .header("link", `<${PREFIXO_INTERNO}${url.slice(4)}>; rel="successor-version"`)
                .send();
        }
    });

    app.addSchema({
        $id: "Saude", type: "object",
        properties: {
            status: { type: "string" }, banco: { type: "string" }, fila: { type: "string" }, tipoFila: { type: "string" },
            versao: { type: "string" }, horario: { type: "string" }
        }
    });
    app.get("/api/saude", {
        schema: {
            tags: ["Sistema"], summary: "Verifica se o servidor, o banco de dados e a fila estão respondendo",
            response: { 200: { $ref: "Saude#" }, 503: { $ref: "Saude#" } }
        }
    }, async (_req, resposta) => {
        let banco = "ok";
        try {
            await prisma.$queryRaw`SELECT 1`;
        } catch {
            banco = "indisponivel";
        }
        const filaOk = await fila.disponivel();
        // Banco fora = serviço fora (503). Fila fora = degradado: a API atende, os relatórios esperam.
        if (banco !== "ok") resposta.status(503);
        return {
            status: banco !== "ok" ? "indisponivel" : filaOk ? "ok" : "degradado", banco,
            fila: filaOk ? "ok" : "indisponivel", tipoFila: fila.tipo, versao: VERSAO_API, horario: new Date().toISOString()
        };
    });

    // ------------------------------------------------------------ API interna (JWT)
    await app.register(async api => {
        await api.register(new ControllerAutenticacao(servicos, config.limiteLoginPorMinuto).rotas);
        await api.register(new ControllerUsuario(servicos).rotas, { prefix: "/usuarios" });
        await api.register(new ControllerOrganizacao(servicos).rotas, { prefix: "/organizacoes" });
        await api.register(new ControllerLote(servicos).rotas, { prefix: "/lotes" });
        await api.register(new ControllerEquipamento(servicos).rotas, { prefix: "/equipamentos" });
        await api.register(new ControllerAdministracao(servicos).rotas);
        await api.register(new ControllerAnalise(servicos).rotas, { prefix: "/analises" });
        await api.register(new ControllerChaveApi(servicos).rotas, { prefix: "/chaves-api" });
        await api.register(new ControllerRelatorioAssincrono(servicos).rotas, { prefix: "/relatorios/tarefas" });
    }, { prefix: PREFIXO_INTERNO });

    // ------------------------------------------------------------ API pública v1 (chave de API)
    await app.register(async publica => {
        publica.addHook("onSend", async (_req, resposta) => { resposta.header("api-version", VERSAO_API_PUBLICA); });
        await publica.register(new ControllerPublico(servicos, config.limitePublicoPorIpPorMinuto).rotas);
    }, { prefix: PREFIXO_PUBLICO });

    // Front-end SPA (HTML + JS estáticos) servido pelo próprio monólito.
    if (existsSync(PASTA_FRONTEND)) {
        await app.register(fastifyStatic, { root: PASTA_FRONTEND, prefix: "/", index: ["index.html"] });
    }
    app.decorate("servicos", servicos);
    return app;
}

declare module "fastify" {
    interface FastifyInstance {
        servicos: Servicos;
    }
}
