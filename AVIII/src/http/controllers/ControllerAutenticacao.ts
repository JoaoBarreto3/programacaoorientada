import { FastifyInstance } from "fastify";
import { PERMISSOES_POR_PAPEL } from "../../dominio/enums/Permissao";
import Servicos from "../../servicos/Servicos";
import { errosPadrao, respostaErro, seguranca } from "../schemas";
import { limitePorIp } from "../plugins/limites";

const credenciais = {
    type: "object", required: ["login", "senha"], additionalProperties: false,
    properties: { login: { type: "string", minLength: 1, maxLength: 64 }, senha: { type: "string", minLength: 1, maxLength: 256 } }
} as const;

type Credenciais = { login: string; senha: string };

export default class ControllerAutenticacao {
    constructor(private readonly servicos: Servicos, private readonly limiteLoginPorMinuto: number) {}

    public rotas = async (app: FastifyInstance): Promise<void> => {
        const auth = this.servicos.autenticacao;
        // Limite por IP no login e no provisionamento: complementa o bloqueio por conta (5 falhas)
        // contra quem testa senhas em muitas contas diferentes a partir do mesmo endereço.
        const limiteLogin = limitePorIp(app, "login-ip", this.limiteLoginPorMinuto, "Muitas tentativas de login deste endereço IP");

        app.get("/provisionamento", {
            schema: {
                tags: ["Autenticação"], summary: "Indica se o sistema ainda precisa do provisionamento inicial",
                response: { 200: { type: "object", properties: { necessario: { type: "boolean" } } } }
            }
        }, async () => ({ necessario: await auth.precisaProvisionar() }));

        app.post<{ Body: Credenciais }>("/provisionamento", {
            onRequest: limiteLogin,
            schema: {
                tags: ["Autenticação"], summary: "Provisionamento inicial: cria o primeiro administrador (só com o banco vazio)",
                body: credenciais, response: { 201: { $ref: "Sessao#" }, 400: respostaErro, 422: respostaErro, 429: respostaErro }
            }
        }, async (req, res) => {
            const sessao = await auth.provisionar(req.body.login, req.body.senha);
            return res.status(201).send(sessao.paraJSON());
        });

        app.post<{ Body: Credenciais }>("/auth/login", {
            onRequest: limiteLogin,
            schema: {
                tags: ["Autenticação"], summary: "Autentica e devolve um token JWT (expira após 30 min sem uso)",
                body: credenciais, response: { 200: { $ref: "Sessao#" }, 400: respostaErro, 401: respostaErro, 429: respostaErro }
            }
        }, async req => (await auth.login(req.body.login, req.body.senha)).paraJSON());

        app.post("/auth/renovar", {
            onRequest: app.autenticar,
            schema: { tags: ["Autenticação"], summary: "Emite um novo token, estendendo a sessão", security: seguranca, response: { 200: { $ref: "Sessao#" }, ...errosPadrao } }
        }, async req => (await auth.renovar(req.usuario)).paraJSON());

        app.post("/auth/logout", {
            onRequest: app.autenticar,
            schema: { tags: ["Autenticação"], summary: "Encerra a sessão: invalida todos os tokens do usuário", security: seguranca, response: { 204: { type: "null" }, ...errosPadrao } }
        }, async (req, res) => {
            await auth.logout(req.usuario);
            return res.status(204).send();
        });

        app.get("/auth/eu", {
            onRequest: app.autenticar,
            schema: {
                tags: ["Autenticação"], summary: "Dados e permissões do usuário autenticado", security: seguranca,
                response: {
                    200: {
                        type: "object",
                        properties: { id: { type: "string" }, login: { type: "string" }, papel: { type: "string" }, permissoes: { type: "array", items: { type: "string" } } }
                    },
                    ...errosPadrao
                }
            }
        }, async req => ({ ...req.usuario, permissoes: [...PERMISSOES_POR_PAPEL[req.usuario.papel]] }));

        app.put<{ Body: { senhaAtual: string; senhaNova: string } }>("/auth/senha", {
            onRequest: app.autenticar,
            schema: {
                tags: ["Autenticação"], summary: "Altera a própria senha (devolve um token novo; os anteriores deixam de valer)", security: seguranca,
                body: {
                    type: "object", required: ["senhaAtual", "senhaNova"], additionalProperties: false,
                    properties: { senhaAtual: { type: "string", maxLength: 256 }, senhaNova: { type: "string", maxLength: 256 } }
                },
                response: { 200: { $ref: "Sessao#" }, ...errosPadrao }
            }
        }, async req => (await auth.alterarSenha(req.usuario, req.body.senhaAtual, req.body.senhaNova)).paraJSON());
    };
}
