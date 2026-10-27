import { FastifyInstance } from "fastify";
import PapelUsuario from "../../dominio/enums/PapelUsuario";
import Servicos from "../../servicos/Servicos";
import { enumDe, entradas, errosPadrao, queryVersao, seguranca } from "../schemas";
import { urlDoRecurso } from "./auxiliares";

const paramLogin = { type: "object", required: ["login"], properties: { login: { type: "string", maxLength: 32 } } } as const;

export default class ControllerUsuario {
    constructor(private readonly servicos: Servicos) {}

    public rotas = async (app: FastifyInstance): Promise<void> => {
        const servico = this.servicos.usuarios;
        app.addHook("preHandler", app.autenticar);
        const base = { tags: ["Usuários"], security: seguranca };

        app.get<{ Querystring: { papel?: PapelUsuario; ativo?: boolean } }>("/", {
            schema: {
                ...base, summary: "Lista as contas de acesso",
                querystring: { type: "object", properties: { papel: enumDe(PapelUsuario), ativo: { type: "boolean" } } },
                response: { 200: { type: "array", items: { $ref: "Usuario#" } }, ...errosPadrao }
            }
        }, async req => (await servico.listar(req.usuario, req.query)).map(u => u.paraJSON()));

        app.get<{ Params: { login: string } }>("/:login", {
            schema: { ...base, summary: "Consulta uma conta", params: paramLogin, response: { 200: { $ref: "Usuario#" }, ...errosPadrao } }
        }, async req => (await servico.buscar(req.usuario, req.params.login)).paraJSON());

        app.post<{ Body: { login: string; senha: string; papel: PapelUsuario } }>("/", {
            schema: {
                ...base, summary: "Cria uma conta de acesso",
                body: {
                    type: "object", required: ["login", "senha", "papel"], additionalProperties: false,
                    properties: { login: { type: "string", maxLength: 32 }, senha: { type: "string", maxLength: 256 }, papel: enumDe(PapelUsuario) }
                },
                response: { 201: { $ref: "Usuario#" }, ...errosPadrao }
            }
        }, async (req, res) => {
            const usuario = await servico.criarUsuario(req.usuario, req.body.login, req.body.senha, req.body.papel);
            return res.status(201).header("location", urlDoRecurso(req, usuario.login)).send(usuario.paraJSON());
        });

        app.patch<{ Params: { login: string }; Body: { login?: string; papel?: PapelUsuario; ativo?: boolean; versao: number } }>("/:login", {
            schema: {
                ...base, summary: "Altera o login, o papel e/ou ativa/desativa a conta", params: paramLogin,
                body: {
                    type: "object", required: ["versao"], additionalProperties: false,
                    properties: {
                        login: { type: "string", maxLength: 32 }, papel: enumDe(PapelUsuario), ativo: { type: "boolean" }, versao: entradas.versao
                    }
                },
                response: { 200: { $ref: "Usuario#" }, ...errosPadrao }
            }
        }, async req => {
            const { versao, ...alteracao } = req.body;
            return (await servico.atualizar(req.usuario, req.params.login, alteracao, versao)).paraJSON();
        });

        app.put<{ Params: { login: string }; Body: { senhaNova: string; versao?: number } }>("/:login/senha", {
            schema: {
                ...base, summary: "Redefine a senha de outro usuário (encerra as sessões dele)", params: paramLogin,
                body: {
                    type: "object", required: ["senhaNova"], additionalProperties: false,
                    properties: { senhaNova: { type: "string", maxLength: 256 }, versao: entradas.versao }
                },
                response: { 200: { $ref: "Usuario#" }, ...errosPadrao }
            }
        }, async req => (await servico.redefinirSenha(req.usuario, req.params.login, req.body.senhaNova, req.body.versao)).paraJSON());

        app.delete<{ Params: { login: string }; Querystring: { versao?: number } }>("/:login", {
            schema: { ...base, summary: "Exclui uma conta", params: paramLogin, querystring: queryVersao, response: { 204: { type: "null" }, ...errosPadrao } }
        }, async (req, res) => {
            await servico.excluir(req.usuario, req.params.login, req.query.versao);
            return res.status(204).send();
        });
    };
}
