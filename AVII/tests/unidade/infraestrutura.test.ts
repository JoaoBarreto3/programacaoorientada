import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { carregarConfiguracao } from "../../src/config/configuracao";
import { traduzirErro } from "../../src/http/plugins/tratamentoErros";
import { Prisma } from "../../src/infra/banco";
import { ErroConflito, ErroNaoEncontrado, ErroPermissao, ErroRegraNegocio, ErroSessao, ErroValidacao } from "../../src/comum/erros";
import { normalizarPaginacao } from "../../src/comum/paginacao";
import { lerEnum } from "../../src/comum/enums";
import StatusRastreamento from "../../src/dominio/enums/StatusRastreamento";

const BASE = { DATABASE_URL: "postgresql://u:s@localhost/db", JWT_SEGREDO: "x".repeat(32) };

describe("Configuração por variáveis de ambiente", () => {
    it("aplica os padrões", () => {
        const c = carregarConfiguracao(BASE);
        assert.deepEqual([c.porta, c.host, c.sessaoMinutos, c.logNivel, c.iteracoesSenha], [3000, "0.0.0.0", 30, "info", 600_000]);
    });
    it("lê porta e sessão configuradas", () => {
        const c = carregarConfiguracao({ ...BASE, PORT: "8080", SESSAO_MINUTOS: "15", LOG_NIVEL: "WARN" });
        assert.deepEqual([c.porta, c.sessaoMinutos, c.logNivel], [8080, 15, "warn"]);
    });
    it("falha cedo com mensagens claras", () => {
        assert.throws(() => carregarConfiguracao({ JWT_SEGREDO: BASE.JWT_SEGREDO }), /DATABASE_URL/);
        assert.throws(() => carregarConfiguracao({ ...BASE, JWT_SEGREDO: "curto" }), /32 caracteres/);
        assert.throws(() => carregarConfiguracao({ ...BASE, PORT: "99999" }), /PORT/);
        assert.throws(() => carregarConfiguracao({ ...BASE, PORT: "abc" }), /PORT/);
        assert.throws(() => carregarConfiguracao({ ...BASE, LOG_NIVEL: "verboso" }), /LOG_NIVEL/);
    });
});

describe("Tradução de erros para HTTP", () => {
    it("erros do domínio mantêm status, código e severidade", () => {
        const casos: [Error, number, string][] = [
            [new ErroValidacao("x"), 400, "VALIDACAO"], [new ErroSessao(), 401, "SESSAO"], [new ErroPermissao(), 403, "PERMISSAO"],
            [new ErroNaoEncontrado("x"), 404, "NAO_ENCONTRADO"], [new ErroConflito("x"), 409, "CONFLITO"], [new ErroRegraNegocio("x"), 422, "REGRA_NEGOCIO"]
        ];
        for (const [erro, status, codigo] of casos) {
            const r = traduzirErro(erro)!;
            assert.deepEqual([r.statusCode, r.erro.codigo], [status, codigo]);
        }
    });

    function erroPrisma(code: string, cause: object) {
        return new Prisma.PrismaClientKnownRequestError("falha", { code, clientVersion: "7", meta: { driverAdapterError: { cause } } });
    }

    it("erros do banco viram respostas amigáveis", () => {
        assert.deepEqual(traduzirErro(erroPrisma("P2002", { constraint: { index: "organizacoes_cnpj_key" } }))!.erro.mensagem, "Já existe uma organização com este CNPJ.");
        assert.equal(traduzirErro(erroPrisma("P2002", { constraint: { index: "organizacoes_cnpj_key" } }))!.statusCode, 409);
        assert.equal(traduzirErro(erroPrisma("P2003", {}))!.statusCode, 409);
        assert.equal(traduzirErro(erroPrisma("P2025", {}))!.statusCode, 404);
        const trigger = traduzirErro(erroPrisma("P2039", { originalCode: "GC001", originalMessage: "Transição de status inválida" }))!;
        assert.deepEqual([trigger.statusCode, trigger.erro.mensagem], [422, "Transição de status inválida"]);
        assert.equal(traduzirErro(erroPrisma("P2039", { originalCode: "23514" }))!.statusCode, 422);
        assert.equal(traduzirErro(new Error("desconhecido")), null);
    });
});

describe("Utilitários", () => {
    it("paginação com limites", () => {
        assert.deepEqual(normalizarPaginacao({}), { pagina: 1, tamanhoPagina: 20, pular: 0 });
        assert.deepEqual(normalizarPaginacao({ pagina: 3, tamanhoPagina: 500 }), { pagina: 3, tamanhoPagina: 100, pular: 200 });
        assert.deepEqual(normalizarPaginacao({ pagina: -1, tamanhoPagina: 0 }), { pagina: 1, tamanhoPagina: 1, pular: 0 });
    });
    it("leitura tolerante de enumerações", () => {
        assert.equal(lerEnum(StatusRastreamento, "em triagem", "status"), "EM_TRIAGEM");
        assert.equal(lerEnum(StatusRastreamento, "baixa-definitiva", "status"), "BAIXA_DEFINITIVA");
        assert.throws(() => lerEnum(StatusRastreamento, "vendido", "status"), /Opções/);
    });
});
