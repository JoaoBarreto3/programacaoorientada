import { FastifyInstance, FastifyReply } from "fastify";
import Servicos from "../../servicos/Servicos";
import { FormatoRelatorio, TipoRelatorio } from "../../servicos/ServicoRelatorioAssincrono";
import { escopoDaConsulta, respostaArquivo, tarefaComLinks } from "./auxiliares";
import { consultaEscopo } from "./ControllerAnalise";
import { enumDe, errosPadrao, queryPaginacao, seguranca } from "../schemas";

export const corpoPedidoRelatorio = {
    type: "object", required: ["tipo"], additionalProperties: false,
    properties: {
        tipo: { ...enumDe(TipoRelatorio), description: "EFICIENCIA_OPERACIONAL, RENTABILIDADE, VIDA_UTIL (previsão de todos os equipamentos ativos) ou INVENTARIO_RASTREABILIDADE" },
        formato: { ...enumDe(FormatoRelatorio), default: "JSON", description: "JSON (estrutura completa) ou CSV (uma linha por item, para planilhas)" },
        ...consultaEscopo
    },
    examples: [{ tipo: "VIDA_UTIL", formato: "CSV" }, { tipo: "INVENTARIO_RASTREABILIDADE", formato: "JSON", inicio: "2026-01-01" }]
} as const;

export type PedidoHttp = { tipo: TipoRelatorio; formato?: FormatoRelatorio; organizacaoId?: string; inicio?: string; fim?: string };

export const paramTarefa = { type: "object", required: ["id"], properties: { id: { type: "string", maxLength: 36, description: "Id da tarefa (UUID)" } } } as const;

export function paginaDeTarefas() {
    return {
        type: "object",
        properties: { itens: { type: "array", items: { $ref: "TarefaRelatorio#" } }, total: { type: "integer" }, pagina: { type: "integer" }, tamanhoPagina: { type: "integer" } }
    } as const;
}

export function enviarArquivo(res: FastifyReply, arquivo: { conteudo: string; tipoConteudo: string; nomeArquivo: string; hash: string }) {
    return res
        .header("content-type", arquivo.tipoConteudo)
        .header("content-disposition", `attachment; filename="${arquivo.nomeArquivo}"`)
        .header("etag", `"${arquivo.hash}"`)
        .header("cache-control", "private, no-store")
        .send(arquivo.conteudo);
}

// Relatórios assíncronos pela API interna (front-end). Mesma fila usada pela API pública.
export default class ControllerRelatorioAssincrono {
    constructor(private readonly servicos: Servicos) {}

    public rotas = async (app: FastifyInstance): Promise<void> => {
        app.addHook("onRequest", app.autenticar);
        const servico = this.servicos.relatoriosAssincronos;
        const base = { tags: ["Relatórios assíncronos"], security: seguranca };
        const prefixo = (url: string) => url.split("?")[0]!.replace(/\/[^/]*(\/arquivo)?$/, "").replace(/\/$/, "");

        app.post<{ Body: PedidoHttp }>("/", {
            schema: {
                ...base, summary: "Solicita um relatório pesado: responde 202 na hora com o id da tarefa; o arquivo é gerado em segundo plano",
                body: corpoPedidoRelatorio, response: { 202: { $ref: "TarefaRelatorio#" }, ...errosPadrao }
            }
        }, async (req, res) => {
            const { tipo, formato, ...escopo } = req.body;
            const tarefa = await servico.solicitar(req.usuario, { tipo, formato: formato ?? "JSON", ...escopoDaConsulta(escopo) });
            const base = req.url.split("?")[0]!.replace(/\/$/, "");
            return res.status(202).header("location", `${base}/${tarefa.id}`).send(tarefaComLinks(tarefa, base));
        });

        app.get<{ Querystring: { pagina?: number; tamanhoPagina?: number } }>("/", {
            schema: {
                ...base, summary: "Minhas tarefas de relatório (o administrador vê todas)",
                querystring: { type: "object", properties: queryPaginacao }, response: { 200: paginaDeTarefas(), ...errosPadrao }
            }
        }, async req => {
            const pagina = await servico.listar(req.usuario, req.query);
            const b = req.url.split("?")[0]!.replace(/\/$/, "");
            return { ...pagina, itens: pagina.itens.map(t => tarefaComLinks(t, b)) };
        });

        app.get<{ Params: { id: string } }>("/:id", {
            schema: { ...base, summary: "Situação de uma tarefa (polling)", params: paramTarefa, response: { 200: { $ref: "TarefaRelatorio#" }, ...errosPadrao } }
        }, async req => tarefaComLinks(await servico.consultar(req.usuario, req.params.id), prefixo(req.url)));

        app.delete<{ Params: { id: string } }>("/:id", {
            schema: {
                ...base, summary: "Cancela um relatório ainda na fila ou exclui um já finalizado (409 enquanto está sendo gerado)",
                params: paramTarefa, response: { 204: { type: "null" }, ...errosPadrao }
            }
        }, async (req, res) => {
            await servico.excluir(req.usuario, req.params.id);
            return res.status(204).send();
        });

        app.get<{ Params: { id: string } }>("/:id/arquivo", {
            schema: {
                ...base, summary: "Baixa o arquivo do relatório (409 enquanto não estiver CONCLUIDA)", params: paramTarefa,
                response: { 200: respostaArquivo, ...errosPadrao }
            }
        }, async (req, res) => enviarArquivo(res, await servico.baixar(req.usuario, req.params.id)));
    };
}
