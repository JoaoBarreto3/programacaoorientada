import { FastifyInstance } from "fastify";
import { DadosCadastrais } from "../../dominio/Organizacao";
import { DadosContrato } from "../../dominio/Contrato";
import Servicos from "../../servicos/Servicos";
import { lerData } from "../../comum/datas";
import { entradas, errosPadrao, pagina, queryPaginacao, queryVersao, seguranca } from "../schemas";
import { urlDoRecurso } from "./auxiliares";

type ContratoEntrada = {
    dataAssinatura: string; dataVencimento: string; clausulas: string[]; valorMensal: number;
    renovacaoAutomatica?: boolean; versao?: number;
};

const paramId = { type: "object", required: ["id"], properties: { id: { type: "string", maxLength: 12 } } } as const;

function contratoDaEntrada(c: ContratoEntrada): DadosContrato {
    return {
        dataAssinatura: lerData(c.dataAssinatura, "dataAssinatura"), dataVencimento: lerData(c.dataVencimento, "dataVencimento"),
        clausulas: c.clausulas, valorMensal: c.valorMensal, renovacaoAutomatica: c.renovacaoAutomatica ?? false
    };
}

export default class ControllerOrganizacao {
    constructor(private readonly servicos: Servicos) {}

    public rotas = async (app: FastifyInstance): Promise<void> => {
        const servico = this.servicos.organizacoes;
        const hoje = () => servico.hoje();
        app.addHook("preHandler", app.autenticar);
        const base = { tags: ["Organizações"], security: seguranca };

        app.get<{ Querystring: { ativo?: boolean; busca?: string; pagina?: number; tamanhoPagina?: number } }>("/", {
            schema: {
                ...base, summary: "Lista organizações (filtros: ativo, busca por razão social/CNPJ/código)",
                querystring: { type: "object", properties: { ativo: { type: "boolean" }, busca: { type: "string", maxLength: 150 }, ...queryPaginacao } },
                response: { 200: pagina("Organizacao"), ...errosPadrao }
            }
        }, async req => {
            const { ativo, busca, ...paginacao } = req.query;
            const resultado = await servico.listar(req.usuario, { ativo, busca }, paginacao);
            return { ...resultado, itens: resultado.itens.map(o => o.paraJSON(hoje())) };
        });

        app.get<{ Params: { id: string } }>("/:id", {
            schema: { ...base, summary: "Consulta uma organização (com o contrato)", params: paramId, response: { 200: { $ref: "Organizacao#" }, ...errosPadrao } }
        }, async req => (await servico.buscarOrganizacao(req.usuario, req.params.id)).paraJSON(hoje()));

        app.post<{ Body: Partial<DadosCadastrais> & { cnpj: string; contrato?: ContratoEntrada } }>("/", {
            schema: {
                ...base, summary: "Cadastra uma organização, opcionalmente já com o contrato de coleta",
                body: {
                    type: "object", required: ["cnpj", "razaoSocial", "enderecoCompleto", "email"], additionalProperties: false,
                    properties: { cnpj: { type: "string", maxLength: 20 }, ...entradas.dadosCadastrais, contrato: entradas.contrato }
                },
                response: { 201: { $ref: "Organizacao#" }, ...errosPadrao }
            }
        }, async (req, res) => {
            const { contrato, ...dados } = req.body;
            const organizacao = await servico.cadastrarOrganizacao(req.usuario, { ...dados, contrato: contrato ? contratoDaEntrada(contrato) : null });
            return res.status(201).header("location", urlDoRecurso(req, organizacao.id)).send(organizacao.paraJSON(hoje()));
        });

        app.put<{ Params: { id: string }; Body: DadosCadastrais & { cnpj?: string; versao: number } }>("/:id", {
            schema: {
                ...base, summary: "Altera os dados cadastrais (CNPJ: só corrigível enquanto a organização não tiver lotes)", params: paramId,
                body: {
                    type: "object", required: ["razaoSocial", "enderecoCompleto", "email", "versao"], additionalProperties: false,
                    properties: { cnpj: { type: "string", maxLength: 20 }, ...entradas.dadosCadastrais, versao: entradas.versao }
                },
                response: { 200: { $ref: "Organizacao#" }, ...errosPadrao }
            }
        }, async req => {
            const { versao, ...dados } = req.body;
            return (await servico.atualizar(req.usuario, req.params.id, dados, versao)).paraJSON(hoje());
        });

        app.patch<{ Params: { id: string }; Body: { ativo: boolean; versao?: number } }>("/:id/situacao", {
            schema: {
                ...base, summary: "Desativa ou reativa a organização", params: paramId,
                body: { type: "object", required: ["ativo"], additionalProperties: false, properties: { ativo: { type: "boolean" }, versao: entradas.versao } },
                response: { 200: { $ref: "Organizacao#" }, ...errosPadrao }
            }
        }, async req => (await servico.alterarSituacao(req.usuario, req.params.id, req.body.ativo, req.body.versao)).paraJSON(hoje()));

        app.delete<{ Params: { id: string }; Querystring: { versao?: number } }>("/:id", {
            schema: { ...base, summary: "Exclui uma organização sem lotes (com lotes, desative-a)", params: paramId, querystring: queryVersao, response: { 204: { type: "null" }, ...errosPadrao } }
        }, async (req, res) => {
            await servico.excluir(req.usuario, req.params.id, req.query.versao);
            return res.status(204).send();
        });

        // ------------------------------------------------------------ contrato
        const baseContrato = { tags: ["Contratos"], security: seguranca };

        app.get<{ Params: { id: string } }>("/:id/contrato", {
            schema: { ...baseContrato, summary: "Consulta o contrato da organização", params: paramId, response: { 200: { $ref: "Contrato#" }, ...errosPadrao } }
        }, async req => (await servico.obterContrato(req.usuario, req.params.id)).paraJSON(hoje()));

        app.put<{ Params: { id: string }; Body: ContratoEntrada }>("/:id/contrato", {
            schema: {
                ...baseContrato, summary: "Cria (201) ou substitui (200) o contrato da organização", params: paramId,
                body: entradas.contrato, response: { 200: { $ref: "Contrato#" }, 201: { $ref: "Contrato#" }, ...errosPadrao }
            }
        }, async (req, res) => {
            const { contrato, criado } = await servico.definirContrato(req.usuario, req.params.id, contratoDaEntrada(req.body), req.body.versao);
            return res.status(criado ? 201 : 200).send(contrato.paraJSON(hoje()));
        });

        app.post<{ Params: { id: string }; Body: { novoVencimento: string; versao?: number } }>("/:id/contrato/renovacao", {
            schema: {
                ...baseContrato, summary: "Renova o contrato para um novo vencimento", params: paramId,
                body: { type: "object", required: ["novoVencimento"], additionalProperties: false, properties: { novoVencimento: entradas.data, versao: entradas.versao } },
                response: { 200: { $ref: "Contrato#" }, ...errosPadrao }
            }
        }, async req => (await servico.renovarContrato(req.usuario, req.params.id, lerData(req.body.novoVencimento, "novoVencimento"), req.body.versao)).paraJSON(hoje()));

        app.delete<{ Params: { id: string }; Querystring: { versao?: number } }>("/:id/contrato", {
            schema: { ...baseContrato, summary: "Remove o contrato da organização", params: paramId, querystring: queryVersao, response: { 204: { type: "null" }, ...errosPadrao } }
        }, async (req, res) => {
            await servico.excluirContrato(req.usuario, req.params.id, req.query.versao);
            return res.status(204).send();
        });
    };
}
