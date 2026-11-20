import { FastifyInstance, FastifyRequest } from "fastify";
import { ParceiroAutenticado } from "../../dominio/Sessao";
import ServicoChaveApi from "../../servicos/ServicoChaveApi";
import { ErroChaveApi } from "../../comum/erros";

declare module "fastify" {
    interface FastifyRequest {
        parceiro: ParceiroAutenticado;
    }
}

// Cabeçalho da chave de API dos parceiros:  X-API-Key: gc_<prefixo>_<segredo>
export const CABECALHO_CHAVE = "x-api-key";

export function decorarParceiro(app: FastifyInstance): void {
    app.decorateRequest("parceiro", null as unknown as ParceiroAutenticado);
}

// Hook onRequest da API pública (antes de ler e validar o corpo): valida a chave e injeta o parceiro na requisição.
export function autenticacaoParceiro(servico: ServicoChaveApi) {
    return async (requisicao: FastifyRequest): Promise<void> => {
        const valor = requisicao.headers[CABECALHO_CHAVE];
        const chave = Array.isArray(valor) ? valor[0] : valor;
        if (!chave) {
            throw new ErroChaveApi("Autenticação necessária: envie a chave no cabeçalho X-API-Key.");
        }
        requisicao.parceiro = await servico.autenticar(chave);
    };
}
