import { FastifyInstance, FastifyRequest } from "fastify";
import { LIMITES_PLANO } from "../../dominio/enums/PlanoApi";
import StatusLote from "../../dominio/enums/StatusLote";
import { DadosEquipamento } from "../../fabricas/FabricaEquipamento";
import Servicos from "../../servicos/Servicos";
import { autenticacaoParceiro } from "../plugins/autenticacaoParceiro";
import { construtorErroLimite, limitePorIp } from "../plugins/limites";
import { dataOpcional, escopoDaConsulta, tarefaComLinks } from "./auxiliares";
import { consultaEscopo, consultaVidaUtil } from "./ControllerAnalise";
import { corpoPedidoRelatorio, enviarArquivo, paginaDeTarefas, paramTarefa, PedidoHttp } from "./ControllerRelatorioAssincrono";
import { enumDe, entradas, errosPublicos, queryPaginacao, respostaDocumentada, segurancaParceiro, PADRAO_DATA } from "../schemas";
import { EXEMPLOS_PUBLICOS as EX } from "../exemplosPublicos";

export const VERSAO_API_PUBLICA = "1.0.0";
const MINUTO_MS = 60_000;

// Consultas de análise do parceiro: a organização vem da chave (não é parâmetro).
const escopoParceiro = { inicio: consultaEscopo.inicio, fim: consultaEscopo.fim } as const;
const { organizacaoId: _semOrganizacao, ...vidaUtilParceiro } = consultaVidaUtil;

type Escopo = { inicio?: string; fim?: string };

// Só o período vem do parceiro; a organização é sempre a da chave (resolvida no serviço).
const periodo = (q: Escopo) => escopoDaConsulta({ inicio: q.inicio, fim: q.fim });

// API pública v1 para parceiros externos (ERPs de clientes, cooperativas, auditorias ambientais).
// Autenticação por chave de API (X-API-Key), escopos por contrato, limite de requisições por plano.
// Separada da API interna (/api/v1/internal): outra autenticação, outra política de limites, outro
// contrato de versão. Mudanças incompatíveis aqui só numa /api/v2/public, com a v1 em depreciação.
export default class ControllerPublico {
    constructor(private readonly servicos: Servicos, private readonly limitePorIp: number) {}

    public rotas = async (app: FastifyInstance): Promise<void> => {
        const { lotes, equipamentos, analises, relatoriosAssincronos: relatorios } = this.servicos;

        // 1º limite por IP (antes de autenticar: freia tentativas de adivinhar chaves);
        // 2º autenticação da chave; 3º limite do plano da chave (por parceiro, não por IP).
        app.addHook("onRequest", limitePorIp(app, "publico-ip", this.limitePorIp, "Muitas requisições deste endereço IP"));
        // Tudo no onRequest: quem não se autentica não tem o corpo lido nem validado.
        app.addHook("onRequest", autenticacaoParceiro(this.servicos.chavesApi));
        app.addHook("onRequest", app.rateLimit({
            max: (req: FastifyRequest) => LIMITES_PLANO[req.parceiro.plano].requisicoesPorMinuto,
            timeWindow: MINUTO_MS, keyGenerator: req => `publico-chave:${req.parceiro.id}`,
            errorResponseBuilder: construtorErroLimite("Limite de requisições do plano excedido")
        }));

        const doc = (tag: string, summary: string, description?: string) =>
            ({ tags: [tag], summary, ...(description ? { description } : {}), security: segurancaParceiro });

        // ------------------------------------------------------------ conta
        app.get("/eu", {
            schema: {
                ...doc("Conta", "Dados da chave usada: parceiro, organização, escopos, plano e limites"),
                response: {
                    200: {
                        description: "Dados da chave autenticada",
                        type: "object",
                        properties: {
                            parceiro: { type: "string" }, organizacaoId: { type: ["string", "null"] },
                            escopos: { type: "array", items: { type: "string" } }, plano: { type: "string" },
                            limites: { type: "object", properties: { requisicoesPorMinuto: { type: "integer" }, relatoriosSimultaneos: { type: "integer" } } },
                            versaoApi: { type: "string" }
                        },
                        examples: [{ parceiro: "ERP Banco Horizonte", organizacaoId: "BR001", escopos: ["LOTES_LER", "RASTREABILIDADE_LER"], plano: "PROFISSIONAL", limites: { requisicoesPorMinuto: 300, relatoriosSimultaneos: 5 }, versaoApi: VERSAO_API_PUBLICA }]
                    },
                    ...errosPublicos
                }
            }
        }, async req => ({
            parceiro: req.parceiro.nome, organizacaoId: req.parceiro.organizacaoId, escopos: req.parceiro.escopos,
            plano: req.parceiro.plano, limites: LIMITES_PLANO[req.parceiro.plano], versaoApi: VERSAO_API_PUBLICA
        }));

        // ------------------------------------------------------------ rastreabilidade
        app.get<{ Params: { codigo: string } }>("/equipamentos/:codigo/rastreamento", {
            schema: {
                ...doc("Rastreabilidade", "Rastreabilidade de um equipamento: situação, local atual, histórico de movimentações e valor residual",
                    "Escopo: RASTREABILIDADE_LER. Aceita o código (EQ-000001) ou o código de barras interno (GCNTB00000017)."),
                params: { type: "object", required: ["codigo"], properties: { codigo: { type: "string", maxLength: 16, examples: ["EQ-000001"], description: "Código do equipamento (EQ-000001) ou código de barras interno" } } },
                response: {
                    200: respostaDocumentada("Situação, local atual, histórico e valor do equipamento", {
                        type: "object",
                        properties: {
                            equipamento: { $ref: "EquipamentoPublico#" },
                            lote: {
                                type: "object",
                                properties: { id: { type: "string" }, organizacaoId: { type: "string" }, dataEntrada: { type: "string" }, notaFiscal: { type: "string" }, statusProcessamento: enumDe(StatusLote) }
                            },
                            movimentacoes: { type: "array", items: { $ref: "MovimentacaoPublica#" } },
                            depreciacao: { type: "number", description: "Fração do valor perdida (0 a 1)" },
                            valorResidual: { type: "number", description: "Valor estimado de recuperação (R$)" }
                        }
                    }, EX.rastreamento),
                    ...errosPublicos
                }
            }
        }, async req => {
            const h = await equipamentos.rastrearEquipamento(req.parceiro, req.params.codigo);
            return {
                equipamento: h.equipamento.paraJSON(),
                lote: { id: h.lote.id, organizacaoId: h.lote.organizacaoId, dataEntrada: h.lote.paraJSON(false).dataEntrada, notaFiscal: h.lote.notaFiscal, statusProcessamento: h.lote.statusProcessamento },
                movimentacoes: h.equipamento.historicoMovimentacao.map(m => m.paraJSON()),
                depreciacao: Math.round(h.depreciacao * 10000) / 10000,
                valorResidual: Math.round(h.valorResidual * 100) / 100
            };
        });

        // ------------------------------------------------------------ lotes
        app.get<{ Querystring: { status?: StatusLote; inicio?: string; fim?: string; pagina?: number; tamanhoPagina?: number } }>("/lotes", {
            schema: {
                ...doc("Lotes", "Lista os lotes da organização da chave", "Escopo: LOTES_LER. Chaves sem organização veem todos os lotes."),
                querystring: {
                    type: "object",
                    properties: {
                        status: { ...enumDe(StatusLote), description: "Filtra pela situação do lote" },
                        inicio: { type: "string", pattern: PADRAO_DATA, description: "Lotes com entrada a partir desta data (AAAA-MM-DD)" },
                        fim: { type: "string", pattern: PADRAO_DATA, description: "Lotes com entrada até esta data (AAAA-MM-DD)" },
                        ...queryPaginacao
                    }
                },
                response: {
                    200: respostaDocumentada("Página de lotes (sem os equipamentos)", {
                        type: "object",
                        properties: { itens: { type: "array", items: { $ref: "LotePublico#" } }, total: { type: "integer" }, pagina: { type: "integer" }, tamanhoPagina: { type: "integer" } }
                    }, EX.listaLotes),
                    ...errosPublicos
                }
            }
        }, async req => {
            const { status, inicio, fim, ...paginacao } = req.query;
            const r = await lotes.listar(req.parceiro, { status, inicio: dataOpcional(inicio, "inicio"), fim: dataOpcional(fim, "fim") }, paginacao);
            return { ...r, itens: r.itens.map(l => l.paraJSON(false)) };
        });

        app.get<{ Params: { id: string } }>("/lotes/:id", {
            schema: {
                ...doc("Lotes", "Consulta um lote com os equipamentos", "Escopo: LOTES_LER."),
                params: { type: "object", required: ["id"], properties: { id: { type: "string", maxLength: 16, examples: ["LT-2026-0001"], description: "Código do lote" } } },
                response: { 200: respostaDocumentada("Lote com os equipamentos", { $ref: "LotePublico#" }, EX.lote), ...errosPublicos }
            }
        }, async req => (await lotes.buscar(req.parceiro, req.params.id)).paraJSON());

        app.post<{ Body: { notaFiscal: string; transportadora: string; dataEntrada?: string; observacoes?: string; equipamentos?: DadosEquipamento[] } }>("/lotes", {
            schema: {
                ...doc("Lotes", "Submete um novo lote com os equipamentos (importação de inventário do ERP do cliente)",
                    "Escopo: LOTES_ESCREVER. O lote é registrado para a organização da chave; o contrato dela precisa estar vigente. " +
                    "Tudo ou nada: se um equipamento for inválido, nenhum dado é gravado."),
                body: {
                    type: "object", required: ["notaFiscal", "transportadora"], additionalProperties: false,
                    properties: {
                        notaFiscal: { type: "string", minLength: 1, maxLength: 9, description: "Número da nota fiscal de remessa (único por organização)" },
                        transportadora: { type: "string", minLength: 2, maxLength: 100, description: "Transportadora responsável pela coleta" },
                        dataEntrada: { ...entradas.data, description: "Data de entrada (AAAA-MM-DD); padrão: hoje; no máximo 90 dias atrás" },
                        observacoes: { type: "string", maxLength: 1000, description: "Observações livres" },
                        equipamentos: { type: "array", maxItems: 200, items: entradas.equipamento, description: "Equipamentos do lote (até 200 por requisição)" }
                    },
                    examples: [{
                        notaFiscal: "204511", transportadora: "TransRapida Logística",
                        equipamentos: [{ tipo: "NOTEBOOK", marca: "Dell", modelo: "Latitude 5490", anoFabricacao: 2019, estadoFisico: "BOM_ESTADO", pesoQuilogramas: 1.9 }]
                    }]
                },
                response: { 201: respostaDocumentada("Lote registrado (cabeçalho Location com o endereço dele)", { $ref: "LotePublico#" }, EX.lote), ...errosPublicos }
            }
        }, async (req, res) => {
            const { dataEntrada, ...dados } = req.body;
            const lote = await lotes.criarLote(req.parceiro, {
                ...dados, organizacaoId: req.parceiro.organizacaoId ?? "", dataEntrada: dataOpcional(dataEntrada, "dataEntrada")
            });
            return res.status(201).header("location", `${req.url.split("?")[0]!.replace(/\/$/, "")}/${lote.id}`).send(lote.paraJSON());
        });

        // ------------------------------------------------------------ análises
        const respostaAnalise = (exemplo: unknown) => ({ 200: respostaDocumentada("Resultado da análise, calculado na hora", { $ref: "Analise#" }, exemplo), ...errosPublicos });
        app.get<{ Querystring: Escopo }>("/analises/eficiencia", {
            schema: {
                ...doc("Análises", "Eficiência operacional dos lotes da organização", "Escopo: RELATORIOS_GERAR."),
                querystring: { type: "object", properties: escopoParceiro }, response: respostaAnalise(EX.eficiencia)
            }
        }, async req => analises.eficiencia(req.parceiro, periodo(req.query)));

        app.get<{ Querystring: Escopo }>("/analises/rentabilidade", {
            schema: {
                ...doc("Análises", "Rentabilidade por tipo de equipamento (valor de recuperação por estado, marca e modelo)", "Escopo: RELATORIOS_GERAR."),
                querystring: { type: "object", properties: escopoParceiro }, response: respostaAnalise(EX.rentabilidade)
            }
        }, async req => analises.rentabilidade(req.parceiro, periodo(req.query)));

        app.get<{ Querystring: Escopo & { limitePrevisoes?: number; horizonteMeses?: number } }>("/analises/vida-util", {
            schema: {
                ...doc("Análises", "Vida útil remanescente prevista dos equipamentos",
                    "Escopo: RELATORIOS_GERAR. Devolve as previsões mais próximas; para todos os equipamentos, solicite o relatório VIDA_UTIL em POST /relatorios."),
                querystring: { type: "object", properties: vidaUtilParceiro }, response: respostaAnalise(EX.vidaUtil)
            }
        }, async req => {
            const { limitePrevisoes, horizonteMeses } = req.query;
            return analises.vidaUtil(req.parceiro, periodo(req.query), limitePrevisoes, horizonteMeses);
        });

        // ------------------------------------------------------------ relatórios assíncronos
        const { organizacaoId: _sem, ...propriedadesPedido } = corpoPedidoRelatorio.properties;
        const descricaoAssincrono = "Escopo: RELATORIOS_GERAR. Processamento assíncrono: a resposta 202 traz o id da tarefa; " +
            "consulte GET /relatorios/{id} até a situação ser CONCLUIDA e baixe em GET /relatorios/{id}/arquivo. " +
            "O número de relatórios em processamento ao mesmo tempo depende do plano.";
        app.post<{ Body: PedidoHttp }>("/relatorios", {
            schema: {
                ...doc("Relatórios", "Solicita um relatório completo (CSV ou JSON) para processamento em segundo plano", descricaoAssincrono),
                body: { ...corpoPedidoRelatorio, properties: propriedadesPedido },
                response: { 202: respostaDocumentada("Tarefa criada e na fila (cabeçalho Location com o endereço de acompanhamento)", { $ref: "TarefaRelatorio#" }, EX.tarefaCriada), ...errosPublicos }
            }
        }, async (req, res) => {
            const { tipo, formato } = req.body;
            const tarefa = await relatorios.solicitar(req.parceiro, { tipo, formato: formato ?? "JSON", ...periodo(req.body) });
            const base = req.url.split("?")[0]!.replace(/\/$/, "");
            return res.status(202).header("location", `${base}/${tarefa.id}`).send(tarefaComLinks(tarefa, base));
        });

        app.get<{ Querystring: { pagina?: number; tamanhoPagina?: number } }>("/relatorios", {
            schema: {
                ...doc("Relatórios", "Relatórios solicitados com esta chave", "Escopo: RELATORIOS_GERAR."),
                querystring: { type: "object", properties: queryPaginacao },
                response: { 200: respostaDocumentada("Relatórios desta chave, mais recentes primeiro", paginaDeTarefas(), EX.listaTarefas), ...errosPublicos }
            }
        }, async req => {
            const pagina = await relatorios.listar(req.parceiro, req.query);
            const base = req.url.split("?")[0]!.replace(/\/$/, "");
            return { ...pagina, itens: pagina.itens.map(t => tarefaComLinks(t, base)) };
        });

        app.get<{ Params: { id: string } }>("/relatorios/:id", {
            schema: {
                ...doc("Relatórios", "Situação de um relatório (polling)", "Escopo: RELATORIOS_GERAR."),
                params: paramTarefa, response: { 200: respostaDocumentada("Situação da tarefa; quando CONCLUIDA, links.arquivo traz o download", { $ref: "TarefaRelatorio#" }, EX.tarefaConcluida), ...errosPublicos }
            }
        }, async req => tarefaComLinks(await relatorios.consultar(req.parceiro, req.params.id), req.url.split("?")[0]!.replace(/\/[^/]+$/, "")));

        app.delete<{ Params: { id: string } }>("/relatorios/:id", {
            schema: {
                ...doc("Relatórios", "Cancela um relatório ainda na fila ou exclui um já finalizado",
                    "Escopo: RELATORIOS_GERAR. Libera a vaga do plano. Responde 409 enquanto o relatório está sendo gerado."),
                params: paramTarefa,
                response: { 204: { description: "Relatório cancelado ou excluído", type: "null" }, ...errosPublicos }
            }
        }, async (req, res) => {
            await relatorios.excluir(req.parceiro, req.params.id);
            return res.status(204).send();
        });

        app.get<{ Params: { id: string } }>("/relatorios/:id/arquivo", {
            schema: {
                ...doc("Relatórios", "Baixa o arquivo de um relatório concluído", "Escopo: RELATORIOS_GERAR. Responde 409 enquanto a tarefa não estiver CONCLUIDA e 422 se ela falhou."),
                params: paramTarefa,
                response: {
                    200: respostaDocumentada("Arquivo do relatório (application/json ou text/csv). O cabeçalho ETag traz o SHA-256 do conteúdo.", { type: "string" }, EX.arquivoCsv),
                    ...errosPublicos
                }
            }
        }, async (req, res) => enviarArquivo(res, await relatorios.baixar(req.parceiro, req.params.id)));
    };
}
