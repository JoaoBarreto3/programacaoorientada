import { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import ErroGreencode, { Severidade } from "../../comum/erros";
import { Prisma } from "../../infra/banco";

export interface CorpoErro {
    statusCode: number;
    erro: { codigo: string; mensagem: string; severidade: Severidade };
}

// Mensagens amigáveis para as restrições de unicidade do banco (garantia final contra duplicidade
// quando duas requisições simultâneas passam pela verificação do serviço ao mesmo tempo).
const MENSAGENS_UNICIDADE: Record<string, string> = {
    organizacoes_cnpj_key: "Já existe uma organização com este CNPJ.",
    usuarios_login_key: "Já existe um usuário com este login.",
    lotes_organizacao_id_nota_fiscal_key: "Esta nota fiscal já foi registrada para a organização.",
    equipamentos_codigo_barras_interno_key: "Código de barras interno já utilizado.",
    contratos_organizacao_id_key: "A organização já possui contrato.",
    equipamentos_lote_id_posicao_no_lote_key: "Posição do equipamento no lote já ocupada; tente novamente."
};

interface CausaBanco {
    originalCode?: string;
    originalMessage?: string;
    constraint?: { index?: string };
}

function causaBanco(erro: Prisma.PrismaClientKnownRequestError): CausaBanco {
    const meta = erro.meta as { driverAdapterError?: { cause?: CausaBanco } } | undefined;
    return meta?.driverAdapterError?.cause ?? {};
}

function corpo(statusCode: number, codigo: string, mensagem: string, severidade: Severidade = "ERRO"): CorpoErro {
    return { statusCode, erro: { codigo, mensagem, severidade } };
}

// Converte qualquer erro em uma resposta JSON padronizada com status HTTP adequado.
export function traduzirErro(erro: unknown): CorpoErro | null {
    if (erro instanceof ErroGreencode) {
        return corpo(erro.statusHttp, erro.codigo, erro.message, erro.severidade);
    }
    if (erro instanceof Prisma.PrismaClientKnownRequestError) {
        const causa = causaBanco(erro);
        if (causa.originalCode === "GC001") {
            // Regra de negócio barrada por trigger do banco.
            return corpo(422, "REGRA_NEGOCIO", causa.originalMessage ?? "Operação recusada pelo banco de dados.");
        }
        switch (erro.code) {
            case "P2002":
                return corpo(409, "DUPLICIDADE", MENSAGENS_UNICIDADE[causa.constraint?.index ?? ""] ?? "Registro duplicado.", "AVISO");
            case "P2003":
                return corpo(409, "REFERENCIA", "O registro está vinculado a outros dados e não pode ser alterado ou excluído.");
            case "P2025":
                return corpo(404, "NAO_ENCONTRADO", "Registro não encontrado.");
            case "P2034":
                return corpo(409, "CONFLITO", "Conflito com outra operação simultânea. Tente novamente.", "AVISO");
        }
        if (causa.originalCode === "23514") {
            return corpo(422, "RESTRICAO", "Os dados violam uma restrição de integridade do banco de dados.");
        }
    }
    return null;
}

export function registrarTratamentoErros(app: FastifyInstance): void {
    app.setErrorHandler((erro: FastifyError, requisicao: FastifyRequest, resposta: FastifyReply) => {
        const traduzido = traduzirErro(erro);
        if (traduzido) {
            if (traduzido.statusCode >= 500) requisicao.log.error({ err: erro }, traduzido.erro.mensagem);
            return resposta.status(traduzido.statusCode).send(traduzido);
        }
        if (erro.validation) {
            // Falha de validação do JSON Schema da rota (corpo, parâmetros ou query).
            const local = erro.validationContext === "body" ? "corpo" : erro.validationContext === "querystring" ? "consulta" : "parâmetros";
            return resposta.status(400).send(corpo(400, "VALIDACAO", `Requisição inválida (${local}): ${erro.message}`));
        }
        if (erro.statusCode && erro.statusCode < 500) {
            return resposta.status(erro.statusCode).send(corpo(erro.statusCode, erro.code ?? "REQUISICAO", erro.message));
        }
        requisicao.log.error({ err: erro }, "erro não tratado");
        return resposta.status(500).send(corpo(500, "INTERNO", "Erro interno do servidor. A operação não foi concluída.", "CRITICO"));
    });

    app.setNotFoundHandler((requisicao, resposta) => {
        resposta.status(404).send(corpo(404, "ROTA_INEXISTENTE", `Rota ${requisicao.method} ${requisicao.url} não existe.`));
    });
}
