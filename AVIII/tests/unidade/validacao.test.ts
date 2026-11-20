import { describe, it } from "node:test";
import assert from "node:assert/strict";
import ValidadorCNPJ from "../../src/validacao/ValidadorCNPJ";
import ValidadorDataEntrada from "../../src/validacao/ValidadorDataEntrada";
import ValidadorSenha from "../../src/validacao/ValidadorSenha";
import ValidadorUsuario from "../../src/validacao/ValidadorUsuario";
import ValidadorEmail from "../../src/validacao/ValidadorEmail";
import ValidadorNotaFiscal from "../../src/validacao/ValidadorNotaFiscal";
import { RelogioFixo } from "../../src/comum/Relogio";
import { adicionarDias, dataCivil, formatarData, lerData } from "../../src/comum/datas";
import { cnpjValido } from "../auxiliares";

describe("ValidadorCNPJ", () => {
    const v = new ValidadorCNPJ();
    it("aceita CNPJ numérico com e sem máscara", () => {
        assert.ok(v.validar("11.222.333/0001-81"));
        assert.ok(v.validar("11222333000181"));
    });
    it("aceita CNPJ alfanumérico (formato a partir de 2026)", () => {
        assert.ok(v.validar(cnpjValido("12ABC34501DE")));
    });
    it("recusa dígitos verificadores errados, sequências repetidas e formato inválido", () => {
        assert.equal(v.validar("11.222.333/0001-82"), false);
        assert.match(v.obterMensagemErro(), /dígitos verificadores/);
        assert.equal(v.validar("11111111111111"), false);
        assert.equal(v.validar("123"), false);
    });
});

describe("ValidadorDataEntrada (regra dos 90 dias)", () => {
    const relogio = new RelogioFixo(new Date(2026, 9, 25, 10, 0));
    const v = new ValidadorDataEntrada(relogio);
    const hoje = dataCivil(relogio.agora());
    it("aceita hoje e exatamente 90 dias atrás", () => {
        assert.ok(v.validar(hoje));
        assert.ok(v.validar(adicionarDias(hoje, -90)));
    });
    it("recusa data futura", () => {
        assert.equal(v.validar(adicionarDias(hoje, 1)), false);
        assert.match(v.obterMensagemErro(), /futuro/);
    });
    it("recusa data anterior a 90 dias", () => {
        assert.equal(v.validar(adicionarDias(hoje, -91)), false);
        assert.match(v.obterMensagemErro(), /90 dias/);
    });
    it("trata a data como civil: 23h em Brasília continua sendo o mesmo dia", () => {
        const noite = new RelogioFixo(new Date(2026, 9, 25, 23, 30));
        assert.ok(new ValidadorDataEntrada(noite).validar(lerData("2026-10-25")));
    });
});

describe("Datas civis", () => {
    it("lê AAAA-MM-DD e DD/MM/AAAA à meia-noite UTC e recusa datas inexistentes", () => {
        assert.equal(lerData("2026-02-28").toISOString(), "2026-02-28T00:00:00.000Z");
        assert.equal(lerData("28/02/2026").toISOString(), "2026-02-28T00:00:00.000Z");
        assert.equal(formatarData(lerData("2026-02-28")), "28/02/2026");
        assert.throws(() => lerData("2026-02-30"), /não existe/);
        assert.throws(() => lerData("ontem"), /não é uma data válida/);
    });
});

describe("Validadores de cadastro", () => {
    it("senha: mínimo de 8, letras e números, sem conter o login", () => {
        const v = new ValidadorSenha();
        assert.ok(v.validar({ usuario: "maria", senha: "Segura2026" }));
        assert.equal(v.validar({ usuario: "maria", senha: "curta1" }), false);
        assert.equal(v.validar({ usuario: "maria", senha: "semnumeros" }), false);
        assert.equal(v.validar({ usuario: "maria", senha: "maria2026x" }), false);
    });
    it("login, e-mail e nota fiscal", () => {
        assert.ok(new ValidadorUsuario().validar("gestor.almox"));
        assert.equal(new ValidadorUsuario().validar("Gestor"), false);
        assert.ok(new ValidadorEmail().validar("ti@empresa.com.br"));
        assert.equal(new ValidadorEmail().validar("ti@empresa"), false);
        assert.ok(new ValidadorNotaFiscal().validar("123456"));
        assert.equal(new ValidadorNotaFiscal().validar("0"), false);
        assert.equal(new ValidadorNotaFiscal().validar("1234567890"), false);
    });
});
