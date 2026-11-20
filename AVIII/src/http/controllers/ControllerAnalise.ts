import { FastifyInstance } from "fastify";
import EstadoFisico from "../../dominio/enums/EstadoFisico";
import TipoEquipamento from "../../dominio/enums/TipoEquipamento";
import Servicos from "../../servicos/Servicos";
import { PREVISOES_NA_RESPOSTA_MAXIMO, PREVISOES_NA_RESPOSTA_PADRAO, TipoAnalise } from "../../servicos/ServicoAnalise";
import { escopoDaConsulta } from "./auxiliares";
import { enumDe, errosPadrao, queryPaginacao, seguranca, PADRAO_DATA } from "../schemas";

export const consultaEscopo = {
    organizacaoId: { type: "string", maxLength: 12, description: "Restringe a uma organização (padrão: todas)" },
    inicio: { type: "string", pattern: PADRAO_DATA, description: "Lotes com entrada a partir desta data (AAAA-MM-DD)" },
    fim: { type: "string", pattern: PADRAO_DATA, description: "Lotes com entrada até esta data (AAAA-MM-DD)" }
} as const;

export const consultaVidaUtil = {
    ...consultaEscopo,
    limitePrevisoes: { type: "integer", minimum: 0, maximum: PREVISOES_NA_RESPOSTA_MAXIMO, default: PREVISOES_NA_RESPOSTA_PADRAO,
        description: "Quantas previsões individuais devolver (as mais próximas de ficar inservíveis). A lista completa sai pelo relatório assíncrono." },
    horizonteMeses: { type: "integer", minimum: 1, maximum: 120, default: 12, description: "Horizonte da contagem de equipamentos que devem ficar inservíveis" }
} as const;

type Escopo = { organizacaoId?: string; inicio?: string; fim?: string };

// Camada analítica na API interna (front-end e equipe de gestão).
export default class ControllerAnalise {
    constructor(private readonly servicos: Servicos) {}

    public rotas = async (app: FastifyInstance): Promise<void> => {
        app.addHook("onRequest", app.autenticar);
        const analises = this.servicos.analises;
        const base = { tags: ["Análises"], security: seguranca };
        const resposta = { 200: { $ref: "Analise#" }, ...errosPadrao };

        app.get<{ Querystring: Escopo }>("/eficiencia", {
            schema: {
                ...base, summary: "Eficiência operacional: tempo de espera e de triagem dos lotes, por operador e por mês, gargalo e lotes atípicos",
                querystring: { type: "object", properties: consultaEscopo }, response: resposta
            }
        }, async req => analises.eficiencia(req.usuario, escopoDaConsulta(req.query)));

        app.get<{ Querystring: Escopo }>("/rentabilidade", {
            schema: {
                ...base, summary: "Rentabilidade por tipo de equipamento: valor de recuperação por estado físico, marca e modelo",
                querystring: { type: "object", properties: consultaEscopo }, response: resposta
            }
        }, async req => analises.rentabilidade(req.usuario, escopoDaConsulta(req.query)));

        app.get<{ Querystring: Escopo & { tipo: TipoEquipamento; marca?: string; modelo?: string; estadoFisico?: EstadoFisico } }>("/rentabilidade/estimativa", {
            schema: {
                ...base, summary: "Estima o valor de recuperação de um equipamento pelo histórico de itens parecidos",
                querystring: {
                    type: "object", required: ["tipo"],
                    properties: { tipo: enumDe(TipoEquipamento), marca: { type: "string", maxLength: 60 }, modelo: { type: "string", maxLength: 80 }, estadoFisico: enumDe(EstadoFisico), ...consultaEscopo }
                },
                response: { 200: { type: "object", additionalProperties: true }, ...errosPadrao }
            }
        }, async req => {
            const { tipo, marca, modelo, estadoFisico, ...escopo } = req.query;
            return analises.estimativa(req.usuario, { tipo, marca, modelo, estadoFisico }, escopoDaConsulta(escopo));
        });

        app.get<{ Querystring: Escopo & { limitePrevisoes?: number; horizonteMeses?: number } }>("/vida-util", {
            schema: {
                ...base, summary: "Vida útil remanescente prevista (regressão linear por mínimos quadrados, por tipo de equipamento)",
                querystring: { type: "object", properties: consultaVidaUtil }, response: resposta
            }
        }, async req => {
            const { limitePrevisoes, horizonteMeses, ...escopo } = req.query;
            return analises.vidaUtil(req.usuario, escopoDaConsulta(escopo), limitePrevisoes, horizonteMeses);
        });

        app.get<{ Querystring: { organizacaoId?: string } }>("/vida-util/aderencia", {
            schema: {
                ...base, summary: "Compara previsões de vida útil já gravadas com as datas reais em que os equipamentos ficaram inservíveis",
                querystring: { type: "object", properties: { organizacaoId: consultaEscopo.organizacaoId } }, response: resposta
            }
        }, async req => analises.aderencia(req.usuario, { organizacaoId: req.query.organizacaoId }));

        // ------------------------------------------------------------ histórico
        app.post<{ Body: Escopo & { tipo: TipoAnalise } }>("/execucoes", {
            schema: {
                ...base, summary: "Executa uma análise agora e grava o resultado no histórico",
                body: {
                    type: "object", required: ["tipo"], additionalProperties: false,
                    properties: { tipo: enumDe(TipoAnalise), ...consultaEscopo },
                    examples: [{ tipo: "VIDA_UTIL" }, { tipo: "EFICIENCIA_OPERACIONAL", organizacaoId: "BR001", inicio: "2026-01-01", fim: "2026-06-30" }]
                },
                response: { 201: { $ref: "ExecucaoAnalise#" }, ...errosPadrao }
            }
        }, async (req, res) => {
            const { tipo, ...escopo } = req.body;
            const execucao = await analises.executar(req.usuario, tipo, escopoDaConsulta(escopo));
            return res.status(201).header("location", `${req.url.replace(/\/$/, "")}/${execucao.id}`).send(execucao);
        });

        app.get<{ Querystring: { tipo?: TipoAnalise; organizacaoId?: string; pagina?: number; tamanhoPagina?: number } }>("/execucoes", {
            schema: {
                ...base, summary: "Histórico de execuções das análises (agendadas e manuais), mais recentes primeiro",
                querystring: { type: "object", properties: { tipo: enumDe(TipoAnalise), organizacaoId: consultaEscopo.organizacaoId, ...queryPaginacao } },
                response: {
                    200: {
                        type: "object",
                        properties: {
                            itens: { type: "array", items: { $ref: "ExecucaoAnalise#" } },
                            total: { type: "integer" }, pagina: { type: "integer" }, tamanhoPagina: { type: "integer" }
                        }
                    },
                    ...errosPadrao
                }
            }
        }, async req => {
            const { tipo, organizacaoId, ...paginacao } = req.query;
            return analises.listarExecucoes(req.usuario, { tipo, organizacaoId }, paginacao);
        });

        const paramId = { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } as const;
        app.get<{ Params: { id: string } }>("/execucoes/:id", {
            schema: { ...base, summary: "Uma execução gravada, com o resultado completo", params: paramId, response: { 200: { $ref: "ExecucaoAnalise#" }, ...errosPadrao } }
        }, async req => analises.buscarExecucao(req.usuario, req.params.id));

        app.get<{ Params: { id: string }; Querystring: { pagina?: number; tamanhoPagina?: number } }>("/execucoes/:id/previsoes", {
            schema: {
                ...base, summary: "Previsões de vida útil por equipamento gravadas numa execução",
                params: paramId, querystring: { type: "object", properties: queryPaginacao },
                response: { 200: { type: "object", additionalProperties: true }, ...errosPadrao }
            }
        }, async req => analises.previsoesDaExecucao(req.usuario, req.params.id, req.query));
    };
}
