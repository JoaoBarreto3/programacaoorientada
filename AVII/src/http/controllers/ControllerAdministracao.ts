import { FastifyInstance } from "fastify";
import StatusRastreamento from "../../dominio/enums/StatusRastreamento";
import Servicos from "../../servicos/Servicos";
import { GRUPOS_PARAMETROS } from "../../servicos/ServicoParametros";
import { dataOpcional, periodoDaConsulta } from "./auxiliares";
import { enumDe, entradas, errosPadrao, pagina, queryPaginacao, queryVersao, seguranca, PADRAO_DATA } from "../schemas";

const periodo = {
    inicio: { type: "string", pattern: PADRAO_DATA, description: "Padrão: 2000-01-01" },
    fim: { type: "string", pattern: PADRAO_DATA, description: "Padrão: hoje" }
} as const;

// Parâmetros globais, relatórios e auditoria.
export default class ControllerAdministracao {
    constructor(private readonly servicos: Servicos) {}

    public rotas = async (app: FastifyInstance): Promise<void> => {
        app.addHook("preHandler", app.autenticar);
        const { parametros, relatorios, auditoria } = this.servicos;
        const agora = () => new Date();

        // ------------------------------------------------------------ parâmetros
        const baseParam = { tags: ["Parâmetros"], security: seguranca };
        app.get("/parametros", {
            schema: { ...baseParam, summary: "Consulta alíquotas, coeficientes de depreciação, valores de referência e retenção", response: { 200: { $ref: "Parametros#" }, ...errosPadrao } }
        }, async req => (await parametros.consultar(req.usuario)).paraJSON());

        app.put<{ Params: { grupo: string; chave: string }; Body: { valor: number; versao?: number } }>("/parametros/:grupo/:chave", {
            schema: {
                ...baseParam, summary: "Define um parâmetro. Grupos: aliquota (ISS...), depreciacao (tipo), valor (tipo), retencao (dias)",
                params: { type: "object", required: ["grupo", "chave"], properties: { grupo: { type: "string", enum: [...GRUPOS_PARAMETROS] }, chave: { type: "string", maxLength: 30 } } },
                body: { type: "object", required: ["valor"], additionalProperties: false, properties: { valor: { type: "number" }, versao: entradas.versao } },
                response: { 200: { $ref: "Parametros#" }, ...errosPadrao }
            }
        }, async req => (await parametros.definir(req.usuario, req.params.grupo, req.params.chave, req.body.valor, req.body.versao)).paraJSON());

        app.delete<{ Params: { chave: string }; Querystring: { versao?: number } }>("/parametros/aliquota/:chave", {
            schema: {
                ...baseParam, summary: "Remove uma alíquota", querystring: queryVersao,
                params: { type: "object", required: ["chave"], properties: { chave: { type: "string", maxLength: 20 } } },
                response: { 200: { $ref: "Parametros#" }, ...errosPadrao }
            }
        }, async req => (await parametros.removerAliquota(req.usuario, req.params.chave, req.query.versao)).paraJSON());

        // ------------------------------------------------------------ relatórios
        const baseRel = { tags: ["Relatórios"], security: seguranca };
        app.get("/relatorios/painel", {
            schema: { ...baseRel, summary: "Indicadores gerais (qualquer usuário autenticado)", response: { ...errosPadrao } }
        }, async req => relatorios.painel(req.usuario));

        app.get<{ Params: { id: string }; Querystring: { inicio?: string; fim?: string } }>("/relatorios/organizacoes/:id", {
            schema: {
                ...baseRel, summary: "Lotes, equipamentos e valor residual de uma organização no período",
                params: { type: "object", required: ["id"], properties: { id: { type: "string", maxLength: 12 } } },
                querystring: { type: "object", properties: periodo }, response: { ...errosPadrao }
            }
        }, async req => relatorios.gerarRelatorioPorOrganizacao(req.usuario, req.params.id, periodoDaConsulta(req.query, agora())));

        app.get<{ Params: { status: StatusRastreamento } }>("/relatorios/status/:status", {
            schema: {
                ...baseRel, summary: "Equipamentos em um status de rastreamento",
                params: { type: "object", required: ["status"], properties: { status: enumDe(StatusRastreamento) } }, response: { ...errosPadrao }
            }
        }, async req => relatorios.gerarRelatorioPorStatus(req.usuario, req.params.status));

        app.get<{ Querystring: { inicio?: string; fim?: string } }>("/relatorios/financeiro", {
            schema: { ...baseRel, summary: "Valor de referência, depreciação, valor residual e tributos dos lotes do período", querystring: { type: "object", properties: periodo }, response: { ...errosPadrao } }
        }, async req => relatorios.gerarRelatorioFinanceiro(req.usuario, periodoDaConsulta(req.query, agora())));

        // ------------------------------------------------------------ auditoria
        const baseAud = { tags: ["Auditoria"], security: seguranca };
        app.get<{ Querystring: { entidade?: string; entidadeId?: string; usuario?: string; operacao?: string; inicio?: string; fim?: string; pagina?: number; tamanhoPagina?: number } }>("/auditoria", {
            schema: {
                ...baseAud, summary: "Trilha de auditoria (mais recentes primeiro)",
                querystring: {
                    type: "object",
                    properties: {
                        entidade: { type: "string", maxLength: 30 }, entidadeId: { type: "string", maxLength: 40 },
                        usuario: { type: "string", maxLength: 32 }, operacao: { type: "string", maxLength: 40 }, ...periodo, ...queryPaginacao
                    }
                },
                response: { 200: pagina("RegistroAuditoria"), ...errosPadrao }
            }
        }, async req => {
            const { inicio, fim, pagina: p, tamanhoPagina, ...filtro } = req.query;
            const fimData = dataOpcional(fim, "fim");
            return auditoria.listar(req.usuario, {
                ...filtro, inicio: dataOpcional(inicio, "inicio"),
                // "fim" inclui o dia inteiro.
                fim: fimData ? new Date(fimData.getTime() + 86_400_000) : undefined
            }, { pagina: p, tamanhoPagina });
        });

        app.post("/auditoria/expurgo", {
            schema: {
                ...baseAud, summary: "Remove registros mais antigos que o prazo de retenção (mínimo 180 dias)",
                response: { 200: { type: "object", properties: { removidos: { type: "integer" }, limite: { type: "string", format: "date-time" } } }, ...errosPadrao }
            }
        }, async req => auditoria.expurgar(req.usuario));
    };
}
