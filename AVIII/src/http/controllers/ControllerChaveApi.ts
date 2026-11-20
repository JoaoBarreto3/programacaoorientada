import { FastifyInstance } from "fastify";
import EscopoApi, { DESCRICAO_ESCOPO } from "../../dominio/enums/EscopoApi";
import PlanoApi, { LIMITES_PLANO } from "../../dominio/enums/PlanoApi";
import Servicos from "../../servicos/Servicos";
import { dataHoraOpcional } from "./auxiliares";
import { enumDe, entradas, errosPadrao, queryVersao, seguranca } from "../schemas";

const escopos = { type: "array", minItems: 1, maxItems: 4, uniqueItems: true, items: enumDe(EscopoApi) } as const;
const expiraEm = { type: ["string", "null"], format: "date-time", description: "Validade da chave (ISO 8601); null = sem expiração" } as const;
const paramId = { type: "object", required: ["id"], properties: { id: { type: "string", maxLength: 36, description: "Id (UUID) ou prefixo da chave" } } } as const;
const chaveComSegredo = {
    type: "object",
    properties: {
        chave: { $ref: "ChaveApi#" },
        segredo: { type: "string", description: "Chave completa para o parceiro (X-API-Key). Mostrada só nesta resposta." }
    }
} as const;

// Gestão das chaves de API dos parceiros (ADMINISTRADOR). Contratos comerciais → escopos e plano.
export default class ControllerChaveApi {
    constructor(private readonly servicos: Servicos) {}

    public rotas = async (app: FastifyInstance): Promise<void> => {
        app.addHook("onRequest", app.autenticar);
        const servico = this.servicos.chavesApi;
        const base = { tags: ["Chaves de API"], security: seguranca };
        const agora = () => new Date();

        app.get("/catalogo", {
            schema: {
                ...base, summary: "Escopos e planos disponíveis para as chaves de API",
                response: { 200: { type: "object", additionalProperties: true }, ...errosPadrao }
            }
        }, async () => ({
            escopos: Object.values(EscopoApi).map(e => ({ escopo: e, descricao: DESCRICAO_ESCOPO[e] })),
            planos: Object.values(PlanoApi).map(p => ({ plano: p, ...LIMITES_PLANO[p] }))
        }));

        app.post<{ Body: { nome: string; escopos: EscopoApi[]; plano?: PlanoApi; organizacaoId?: string | null; expiraEm?: string | null } }>("/", {
            schema: {
                ...base, summary: "Cria a chave de API de um parceiro (o segredo é mostrado uma única vez)",
                body: {
                    type: "object", required: ["nome", "escopos"], additionalProperties: false,
                    properties: {
                        nome: { type: "string", minLength: 3, maxLength: 100 }, escopos, plano: { ...enumDe(PlanoApi), default: "BASICO" },
                        organizacaoId: { type: ["string", "null"], maxLength: 12, description: "Organização cujos dados a chave acessa (obrigatória para LOTES_ESCREVER)" },
                        expiraEm
                    },
                    examples: [{ nome: "ERP Banco Horizonte", escopos: ["LOTES_LER", "LOTES_ESCREVER", "RASTREABILIDADE_LER"], plano: "PROFISSIONAL", organizacaoId: "BR001" }]
                },
                response: { 201: chaveComSegredo, ...errosPadrao }
            }
        }, async (req, res) => {
            const { chave, segredo } = await servico.criar(req.usuario, {
                nome: req.body.nome, escopos: req.body.escopos, plano: req.body.plano ?? "BASICO",
                organizacaoId: req.body.organizacaoId ?? null, expiraEm: dataHoraOpcional(req.body.expiraEm, "expiraEm") ?? null
            });
            return res.status(201).header("location", `${req.url.replace(/\/$/, "")}/${chave.id}`).send({ chave: chave.paraJSON(agora()), segredo });
        });

        app.get<{ Querystring: { organizacaoId?: string; ativa?: boolean } }>("/", {
            schema: {
                ...base, summary: "Lista as chaves de API",
                querystring: { type: "object", properties: { organizacaoId: { type: "string", maxLength: 12 }, ativa: { type: "boolean" } } },
                response: { 200: { type: "array", items: { $ref: "ChaveApi#" } }, ...errosPadrao }
            }
        }, async req => (await servico.listar(req.usuario, req.query)).map(c => c.paraJSON(agora())));

        app.get<{ Params: { id: string } }>("/:id", {
            schema: { ...base, summary: "Consulta uma chave de API", params: paramId, response: { 200: { $ref: "ChaveApi#" }, ...errosPadrao } }
        }, async req => (await servico.buscar(req.usuario, req.params.id)).paraJSON(agora()));

        app.patch<{ Params: { id: string }; Body: { nome?: string; escopos?: EscopoApi[]; plano?: PlanoApi; ativa?: boolean; expiraEm?: string | null; versao: number } }>("/:id", {
            schema: {
                ...base, summary: "Altera nome, escopos, plano, validade ou situação (ativa/inativa) da chave", params: paramId,
                body: {
                    type: "object", required: ["versao"], additionalProperties: false, minProperties: 2,
                    properties: { nome: { type: "string", minLength: 3, maxLength: 100 }, escopos, plano: enumDe(PlanoApi), ativa: { type: "boolean" }, expiraEm, versao: entradas.versao }
                },
                response: { 200: { $ref: "ChaveApi#" }, ...errosPadrao }
            }
        }, async req => {
            const { versao, expiraEm: validade, ...dados } = req.body;
            return (await servico.atualizar(req.usuario, req.params.id, {
                ...dados, ...(validade !== undefined ? { expiraEm: dataHoraOpcional(validade, "expiraEm") ?? null } : {})
            }, versao)).paraJSON(agora());
        });

        app.post<{ Params: { id: string }; Body: { versao?: number } }>("/:id/rotacao", {
            schema: {
                ...base, summary: "Gera um novo segredo para a chave (o anterior para de funcionar na hora)", params: paramId,
                body: { type: "object", additionalProperties: false, properties: { versao: entradas.versao } },
                response: { 200: chaveComSegredo, ...errosPadrao }
            }
        }, async req => {
            const { chave, segredo } = await servico.rotacionar(req.usuario, req.params.id, req.body?.versao);
            return { chave: chave.paraJSON(agora()), segredo };
        });

        app.delete<{ Params: { id: string }; Querystring: { versao?: number } }>("/:id", {
            schema: {
                ...base, summary: "Revoga a chave em definitivo (o registro fica guardado para auditoria)", params: paramId,
                querystring: queryVersao, response: { 204: { type: "null" }, ...errosPadrao }
            }
        }, async (req, res) => {
            await servico.revogar(req.usuario, req.params.id, req.query.versao);
            return res.status(204).send();
        });
    };
}
