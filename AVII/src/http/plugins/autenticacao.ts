import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fastifyJwt from "@fastify/jwt";
import { UsuarioAutenticado } from "../../dominio/Sessao";
import ServicoAutenticacao, { ConteudoToken, EmissorToken } from "../../servicos/ServicoAutenticacao";
import { ErroSessao } from "../../comum/erros";

declare module "@fastify/jwt" {
    interface FastifyJWT {
        payload: ConteudoToken;
        user: ConteudoToken & { iat: number; exp: number };
    }
}

declare module "fastify" {
    interface FastifyInstance {
        autenticar: (requisicao: FastifyRequest, resposta: FastifyReply) => Promise<void>;
    }
    interface FastifyRequest {
        usuario: UsuarioAutenticado;
    }
}

// Cabeçalho com o token renovado: cada requisição autenticada estende a sessão por mais
// SESSAO_MINUTOS, reproduzindo a "expiração após 30 minutos de inatividade" da AV1.
export const CABECALHO_TOKEN_RENOVADO = "x-token-renovado";
const RENOVAR_APOS_SEGUNDOS = 60;

export async function registrarJwt(app: FastifyInstance, segredo: string, sessaoMinutos: number): Promise<EmissorToken> {
    await app.register(fastifyJwt, {
        secret: segredo,
        sign: { algorithm: "HS256", expiresIn: `${sessaoMinutos}m` },
        verify: { algorithms: ["HS256"] }
    });
    return {
        emitir(conteudo) {
            const token = app.jwt.sign(conteudo);
            const decodificado = app.jwt.decode<{ iat: number; exp: number }>(token)!;
            return { token, criacao: new Date(decodificado.iat * 1000), expiracao: new Date(decodificado.exp * 1000) };
        }
    };
}

// Hook preHandler das rotas protegidas: valida o token "Authorization: Bearer <jwt>" e injeta
// o usuário autenticado na requisição. Os serviços usam o papel dele para autorizar.
export function registrarAutenticacao(app: FastifyInstance, servico: ServicoAutenticacao): void {
    app.decorateRequest("usuario", null as unknown as UsuarioAutenticado);
    app.decorate("autenticar", async (requisicao: FastifyRequest, resposta: FastifyReply) => {
        if (!requisicao.headers.authorization) {
            throw new ErroSessao("Autenticação necessária: envie o cabeçalho Authorization: Bearer <token>.");
        }
        try {
            await requisicao.jwtVerify();
        } catch (erro) {
            const codigo = (erro as { code?: string }).code ?? "";
            throw new ErroSessao(codigo.includes("EXPIRED")
                ? "Sessão expirada por inatividade. Faça login novamente."
                : "Token de acesso inválido. Faça login novamente.");
        }
        const conteudo = requisicao.user;
        requisicao.usuario = await servico.validarSessao(conteudo);
        if (Date.now() / 1000 - conteudo.iat >= RENOVAR_APOS_SEGUNDOS) {
            const { id, login, papel } = requisicao.usuario;
            resposta.header(CABECALHO_TOKEN_RENOVADO, app.jwt.sign({ sub: id, login, papel, tv: conteudo.tv }));
        }
    });
}
