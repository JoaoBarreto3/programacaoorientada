import { FastifyInstance } from "fastify";
import StatusLote from "../../dominio/enums/StatusLote";
import { DadosEquipamento } from "../../fabricas/FabricaEquipamento";
import Servicos from "../../servicos/Servicos";
import { enumDe, entradas, errosPadrao, pagina, queryPaginacao, queryVersao, seguranca, PADRAO_DATA } from "../schemas";
import { dataOpcional, urlDoRecurso } from "./auxiliares";

const paramId = { type: "object", required: ["id"], properties: { id: { type: "string", maxLength: 16 } } } as const;

type LoteEntrada = {
    organizacaoId: string; notaFiscal: string; transportadora: string; dataEntrada?: string; observacoes?: string;
    equipamentos?: DadosEquipamento[];
};

export default class ControllerLote {
    constructor(private readonly servicos: Servicos) {}

    public rotas = async (app: FastifyInstance): Promise<void> => {
        const servico = this.servicos.lotes;
        app.addHook("preHandler", app.autenticar);
        const base = { tags: ["Lotes"], security: seguranca };

        app.get<{ Querystring: { organizacaoId?: string; status?: StatusLote; inicio?: string; fim?: string; pagina?: number; tamanhoPagina?: number } }>("/", {
            schema: {
                ...base, summary: "Lista lotes (filtros: organização, status e período de entrada)",
                querystring: {
                    type: "object",
                    properties: {
                        organizacaoId: { type: "string", maxLength: 12 }, status: enumDe(StatusLote),
                        inicio: { type: "string", pattern: PADRAO_DATA }, fim: { type: "string", pattern: PADRAO_DATA }, ...queryPaginacao
                    }
                },
                response: { 200: pagina("Lote"), ...errosPadrao }
            }
        }, async req => {
            const { organizacaoId, status, inicio, fim, ...paginacao } = req.query;
            const resultado = await servico.listar(req.usuario, {
                organizacaoId: organizacaoId?.toUpperCase(), status, inicio: dataOpcional(inicio, "inicio"), fim: dataOpcional(fim, "fim")
            }, paginacao);
            return { ...resultado, itens: resultado.itens.map(l => l.paraJSON(false)) };
        });

        app.get<{ Params: { id: string } }>("/:id", {
            schema: { ...base, summary: "Consulta um lote com os seus equipamentos", params: paramId, response: { 200: { $ref: "Lote#" }, ...errosPadrao } }
        }, async req => (await servico.buscar(req.usuario, req.params.id)).paraJSON(true));

        app.post<{ Body: LoteEntrada }>("/", {
            schema: {
                ...base, summary: "Registra a chegada de um lote, opcionalmente com os equipamentos (tudo em uma transação)",
                body: {
                    type: "object", required: ["organizacaoId", "notaFiscal", "transportadora"], additionalProperties: false,
                    properties: {
                        organizacaoId: { type: "string", maxLength: 12 }, notaFiscal: { type: "string", maxLength: 12 },
                        transportadora: { type: "string", maxLength: 100 }, dataEntrada: entradas.data,
                        observacoes: { type: "string", maxLength: 1000 },
                        equipamentos: { type: "array", maxItems: 200, items: entradas.equipamento }
                    }
                },
                response: { 201: { $ref: "Lote#" }, ...errosPadrao }
            }
        }, async (req, res) => {
            const lote = await servico.criarLote(req.usuario, { ...req.body, dataEntrada: dataOpcional(req.body.dataEntrada, "dataEntrada") });
            return res.status(201).header("location", urlDoRecurso(req, lote.id)).send(lote.paraJSON(true));
        });

        app.put<{ Params: { id: string }; Body: { notaFiscal: string; transportadora: string; observacoes?: string; dataEntrada?: string; versao: number } }>("/:id", {
            schema: {
                ...base, summary: "Altera os dados do lote (somente enquanto RECEBIDO)", params: paramId,
                body: {
                    type: "object", required: ["notaFiscal", "transportadora", "versao"], additionalProperties: false,
                    properties: {
                        notaFiscal: { type: "string", maxLength: 12 }, transportadora: { type: "string", maxLength: 100 },
                        observacoes: { type: "string", maxLength: 1000 }, dataEntrada: entradas.data, versao: entradas.versao
                    }
                },
                response: { 200: { $ref: "Lote#" }, ...errosPadrao }
            }
        }, async req => {
            const { versao, dataEntrada, ...dados } = req.body;
            const lote = await servico.atualizar(req.usuario, req.params.id,
                { ...dados, observacoes: dados.observacoes ?? "", dataEntrada: dataOpcional(dataEntrada, "dataEntrada") }, versao);
            return lote.paraJSON(true);
        });

        app.delete<{ Params: { id: string }; Querystring: { versao?: number } }>("/:id", {
            schema: { ...base, summary: "Exclui um lote RECEBIDO (e os seus equipamentos)", params: paramId, querystring: queryVersao, response: { 204: { type: "null" }, ...errosPadrao } }
        }, async (req, res) => {
            await servico.excluir(req.usuario, req.params.id, req.query.versao);
            return res.status(204).send();
        });

        app.post<{ Params: { id: string }; Body: { versao?: number } | undefined }>("/:id/triagem", {
            schema: {
                ...base, summary: "Avança a triagem: 1ª chamada inicia (EM_TRIAGEM), 2ª conclui (TRIAGEM_CONCLUIDA)", params: paramId,
                body: { type: ["object", "null"], additionalProperties: false, properties: { versao: entradas.versao } },
                response: {
                    200: { type: "object", properties: { etapa: { type: "string", enum: ["INICIADA", "CONCLUIDA"] }, lote: { $ref: "Lote#" } } },
                    ...errosPadrao
                }
            }
        }, async req => {
            const { lote, etapa } = await servico.processarTriagem(req.usuario, req.params.id, req.body?.versao);
            return { etapa, lote: lote.paraJSON(true) };
        });

        app.get<{ Params: { id: string } }>("/:id/relatorio-triagem", {
            schema: { ...base, summary: "Relatório de triagem do lote", params: paramId, response: { ...errosPadrao } }
        }, async req => servico.relatorioTriagem(req.usuario, req.params.id));

        app.post<{ Params: { id: string }; Body: DadosEquipamento }>("/:id/equipamentos", {
            schema: {
                ...base, tags: ["Equipamentos"], summary: "Adiciona um equipamento a um lote RECEBIDO (gera código e código de barras)",
                params: paramId, body: entradas.equipamento, response: { 201: { $ref: "Equipamento#" }, ...errosPadrao }
            }
        }, async (req, res) => {
            const equipamento = await servico.adicionarEquipamentoLote(req.usuario, req.params.id, req.body);
            return res.status(201).header("location", `/api/equipamentos/${equipamento.id}`).send(equipamento.paraJSON());
        });
    };
}
