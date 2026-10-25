import { FastifyInstance } from "fastify";
import { DadosDescritivos } from "../../dominio/Equipamento";
import EstadoFisico from "../../dominio/enums/EstadoFisico";
import StatusRastreamento from "../../dominio/enums/StatusRastreamento";
import TipoEquipamento from "../../dominio/enums/TipoEquipamento";
import { DadosEquipamento } from "../../fabricas/FabricaEquipamento";
import Servicos from "../../servicos/Servicos";
import { enumDe, entradas, errosPadrao, pagina, queryPaginacao, queryVersao, seguranca } from "../schemas";

const paramId = { type: "object", required: ["id"], properties: { id: { type: "string", maxLength: 16, description: "Código EQ-... ou código de barras" } } } as const;
const justificativa = { type: "string", maxLength: 1000 } as const;

export default class ControllerEquipamento {
    constructor(private readonly servicos: Servicos) {}

    public rotas = async (app: FastifyInstance): Promise<void> => {
        const servico = this.servicos.equipamentos;
        app.addHook("preHandler", app.autenticar);
        const base = { tags: ["Equipamentos"], security: seguranca };

        app.get<{ Querystring: { loteId?: string; organizacaoId?: string; status?: StatusRastreamento; tipo?: TipoEquipamento; estado?: EstadoFisico; pagina?: number; tamanhoPagina?: number } }>("/", {
            schema: {
                ...base, summary: "Lista equipamentos (filtros: lote, organização, status, tipo e estado físico)",
                querystring: {
                    type: "object",
                    properties: {
                        loteId: { type: "string", maxLength: 16 }, organizacaoId: { type: "string", maxLength: 12 },
                        status: enumDe(StatusRastreamento), tipo: enumDe(TipoEquipamento), estado: enumDe(EstadoFisico), ...queryPaginacao
                    }
                },
                response: { 200: pagina("Equipamento"), ...errosPadrao }
            }
        }, async req => {
            const { loteId, organizacaoId, status, tipo, estado, ...paginacao } = req.query;
            const resultado = await servico.listar(req.usuario,
                { loteId: loteId?.toUpperCase(), organizacaoId: organizacaoId?.toUpperCase(), status, tipo, estado }, paginacao);
            return { ...resultado, itens: resultado.itens.map(e => e.paraJSON()) };
        });

        app.post<{ Body: DadosEquipamento & { loteId: string } }>("/", {
            schema: {
                ...base, summary: "Cadastra um equipamento em um lote RECEBIDO (gera código e código de barras)",
                body: {
                    ...entradas.equipamento,
                    required: ["loteId", ...entradas.equipamento.required],
                    properties: { loteId: { type: "string", maxLength: 16 }, ...entradas.equipamento.properties }
                },
                response: { 201: { $ref: "Equipamento#" }, ...errosPadrao }
            }
        }, async (req, res) => {
            const { loteId, ...dados } = req.body;
            const equipamento = await this.servicos.lotes.adicionarEquipamentoLote(req.usuario, loteId, dados);
            return res.status(201).header("location", `/api/equipamentos/${equipamento.id}`).send(equipamento.paraJSON());
        });

        app.get<{ Params: { id: string } }>("/:id", {
            schema: { ...base, summary: "Consulta um equipamento pelo código ou pelo código de barras", params: paramId, response: { 200: { $ref: "Equipamento#" }, ...errosPadrao } }
        }, async req => (await servico.buscar(req.usuario, req.params.id)).paraJSON());

        app.put<{ Params: { id: string }; Body: DadosDescritivos & { versao: number } }>("/:id", {
            schema: {
                ...base, summary: "Corrige marca, modelo, ano e peso (somente antes da triagem)", params: paramId,
                body: {
                    type: "object", required: ["marca", "modelo", "anoFabricacao", "pesoQuilogramas", "versao"], additionalProperties: false,
                    properties: {
                        marca: entradas.equipamento.properties.marca, modelo: entradas.equipamento.properties.modelo,
                        anoFabricacao: entradas.equipamento.properties.anoFabricacao,
                        pesoQuilogramas: entradas.equipamento.properties.pesoQuilogramas, versao: entradas.versao
                    }
                },
                response: { 200: { $ref: "Equipamento#" }, ...errosPadrao }
            }
        }, async req => {
            const { versao, ...dados } = req.body;
            return (await servico.atualizarDados(req.usuario, req.params.id, dados, versao)).paraJSON();
        });

        app.delete<{ Params: { id: string }; Querystring: { versao?: number } }>("/:id", {
            schema: { ...base, summary: "Remove o equipamento de um lote RECEBIDO", params: paramId, querystring: queryVersao, response: { 204: { type: "null" }, ...errosPadrao } }
        }, async (req, res) => {
            await servico.excluir(req.usuario, req.params.id, req.query.versao);
            return res.status(204).send();
        });

        app.patch<{ Params: { id: string }; Body: { estadoFisico: EstadoFisico; justificativa?: string; versao?: number } }>("/:id/estado", {
            schema: {
                ...base, summary: "Reclassifica o estado físico (queda de 2+ categorias exige justificativa)", params: paramId,
                body: {
                    type: "object", required: ["estadoFisico"], additionalProperties: false,
                    properties: { estadoFisico: enumDe(EstadoFisico), justificativa, versao: entradas.versao }
                },
                response: { 200: { $ref: "Equipamento#" }, ...errosPadrao }
            }
        }, async req => (await servico.atualizarEstadoFisico(req.usuario, req.params.id, req.body.estadoFisico,
            req.body.justificativa ?? "", req.body.versao)).paraJSON());

        app.patch<{ Params: { id: string }; Body: { status: StatusRastreamento; justificativa?: string; versao?: number } }>("/:id/status", {
            schema: {
                ...base, summary: "Altera o status de rastreamento (desmonte só após a triagem completa do lote)", params: paramId,
                body: {
                    type: "object", required: ["status"], additionalProperties: false,
                    properties: { status: enumDe(StatusRastreamento), justificativa, versao: entradas.versao }
                },
                response: { 200: { $ref: "Equipamento#" }, ...errosPadrao }
            }
        }, async req => (await servico.atualizarStatus(req.usuario, req.params.id, req.body.status,
            req.body.justificativa ?? "", req.body.versao)).paraJSON());

        app.get<{ Params: { id: string } }>("/:id/movimentacoes", {
            schema: { ...base, summary: "Histórico de movimentações do equipamento", params: paramId, response: { 200: { type: "array", items: { $ref: "Movimentacao#" } }, ...errosPadrao } }
        }, async req => (await servico.listarMovimentacoes(req.usuario, req.params.id)).map(m => m.paraJSON()));

        app.post<{ Params: { id: string }; Body: { destino: string; observacao?: string; versao?: number } }>("/:id/movimentacoes", {
            schema: {
                ...base, summary: "Registra a movimentação do equipamento para outro local", params: paramId,
                body: {
                    type: "object", required: ["destino"], additionalProperties: false,
                    properties: { destino: { type: "string", maxLength: 120 }, observacao: { type: "string", maxLength: 1000 }, versao: entradas.versao }
                },
                response: { 201: { $ref: "Movimentacao#" }, ...errosPadrao }
            }
        }, async (req, res) => {
            const movimentacao = await servico.registrarMovimentacao(req.usuario, req.params.id, req.body.destino,
                req.body.observacao ?? "", req.body.versao);
            return res.status(201).send(movimentacao.paraJSON());
        });

        app.get<{ Params: { id: string } }>("/:id/rastreamento", {
            schema: {
                ...base, summary: "Rastreabilidade completa: origem, movimentações, auditoria e valor residual", params: paramId,
                response: {
                    200: {
                        type: "object",
                        properties: {
                            equipamento: { $ref: "Equipamento#" },
                            lote: { $ref: "Lote#" },
                            organizacao: { $ref: "Organizacao#" },
                            movimentacoes: { type: "array", items: { $ref: "Movimentacao#" } },
                            auditoria: {
                                type: "array",
                                items: { type: "object", properties: { id: { type: "string" }, dataHora: { type: "string", format: "date-time" }, operacao: { type: "string" }, usuario: { type: "string" } } }
                            },
                            depreciacao: { type: "number" }, valorResidual: { type: "number" }
                        }
                    },
                    ...errosPadrao
                }
            }
        }, async req => {
            const h = await servico.rastrearEquipamento(req.usuario, req.params.id);
            return {
                equipamento: h.equipamento.paraJSON(),
                lote: h.lote.paraJSON(false),
                organizacao: h.organizacao.paraJSON(this.servicos.organizacoes.hoje()),
                movimentacoes: h.equipamento.historicoMovimentacao.map(m => m.paraJSON()),
                auditoria: h.auditoria,
                depreciacao: Math.round(h.depreciacao * 10000) / 10000,
                valorResidual: Math.round(h.valorResidual * 100) / 100
            };
        });
    };
}
