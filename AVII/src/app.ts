import { existsSync } from "node:fs";
import path from "node:path";
import Fastify, { FastifyInstance, FastifyServerOptions } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import { Configuracao } from "./config/configuracao";
import { PrismaClient } from "./infra/banco";
import Relogio, { RelogioSistema } from "./comum/Relogio";
import Servicos from "./servicos/Servicos";
import { registrarSchemas } from "./http/schemas";
import { registrarJwt, registrarAutenticacao, CABECALHO_TOKEN_RENOVADO } from "./http/plugins/autenticacao";
import { registrarTratamentoErros } from "./http/plugins/tratamentoErros";
import ControllerAutenticacao from "./http/controllers/ControllerAutenticacao";
import ControllerUsuario from "./http/controllers/ControllerUsuario";
import ControllerOrganizacao from "./http/controllers/ControllerOrganizacao";
import ControllerLote from "./http/controllers/ControllerLote";
import ControllerEquipamento from "./http/controllers/ControllerEquipamento";
import ControllerAdministracao from "./http/controllers/ControllerAdministracao";

export const VERSAO_API = "2.0.0";
const PASTA_FRONTEND = path.resolve(__dirname, "..", "..", "public");

export interface OpcoesApp {
    config: Configuracao;
    prisma: PrismaClient;
    relogio?: Relogio;
    logger?: FastifyServerOptions["logger"];
}

// Monta a aplicação (sem abrir a porta): usada pelo server.ts e pelos testes (app.inject).
export async function construirApp(opcoes: OpcoesApp): Promise<FastifyInstance> {
    const { config, prisma } = opcoes;
    const app = Fastify({
        logger: opcoes.logger ?? { level: config.logNivel },
        // No desligamento, fecha conexões keep-alive ociosas sem esperar o cliente.
        forceCloseConnections: "idle",
        bodyLimit: 1024 * 1024,
        ajv: { customOptions: { allErrors: false } }
    });

    registrarSchemas(app);
    await app.register(fastifySwagger, {
        openapi: {
            info: {
                title: "greencode API",
                description: "API REST do greencode: logística reversa de resíduos eletrônicos. " +
                    "Autentique em POST /api/auth/login e use o token no botão Authorize.",
                version: VERSAO_API
            },
            components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } } }
        }
    });
    await app.register(fastifySwaggerUi, { routePrefix: "/docs" });

    const emissor = await registrarJwt(app, config.jwtSegredo, config.sessaoMinutos);
    const servicos = new Servicos(prisma, opcoes.relogio ?? new RelogioSistema(), emissor, config.iteracoesSenha);
    registrarAutenticacao(app, servicos.autenticacao);
    registrarTratamentoErros(app);

    // Cabeçalhos de segurança básicos em todas as respostas.
    app.addHook("onSend", async (_req, resposta) => {
        resposta.header("x-content-type-options", "nosniff");
        resposta.header("x-frame-options", "DENY");
        resposta.header("referrer-policy", "no-referrer");
        resposta.header("access-control-expose-headers", CABECALHO_TOKEN_RENOVADO);
    });

    app.addSchema({
        $id: "Saude", type: "object",
        properties: { status: { type: "string" }, banco: { type: "string" }, versao: { type: "string" }, horario: { type: "string" } }
    });
    await app.register(async api => {
        api.get("/saude", {
            schema: {
                tags: ["Sistema"], summary: "Verifica se o servidor e o banco de dados estão respondendo",
                response: {
                    200: { $ref: "Saude#" },
                    503: { $ref: "Saude#" }
                }
            }
        }, async (_req, resposta) => {
            let banco = "ok";
            try {
                await prisma.$queryRaw`SELECT 1`;
            } catch {
                banco = "indisponivel";
                resposta.status(503);
            }
            return { status: banco === "ok" ? "ok" : "degradado", banco, versao: VERSAO_API, horario: new Date().toISOString() };
        });
        await api.register(new ControllerAutenticacao(servicos).rotas);
        await api.register(new ControllerUsuario(servicos).rotas, { prefix: "/usuarios" });
        await api.register(new ControllerOrganizacao(servicos).rotas, { prefix: "/organizacoes" });
        await api.register(new ControllerLote(servicos).rotas, { prefix: "/lotes" });
        await api.register(new ControllerEquipamento(servicos).rotas, { prefix: "/equipamentos" });
        await api.register(new ControllerAdministracao(servicos).rotas);
    }, { prefix: "/api" });

    // Front-end SPA (HTML + JS estáticos) servido pelo próprio monólito.
    if (existsSync(PASTA_FRONTEND)) {
        await app.register(fastifyStatic, { root: PASTA_FRONTEND, prefix: "/", index: ["index.html"] });
    }
    return app;
}
