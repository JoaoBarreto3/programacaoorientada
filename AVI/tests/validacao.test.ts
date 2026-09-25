import { test } from "node:test";
import * as assert from "node:assert/strict";
import ValidadorCNPJ from "../src/validacao/ValidadorCNPJ";
import ValidadorDataEntrada from "../src/validacao/ValidadorDataEntrada";
import ValidadorSenha from "../src/validacao/ValidadorSenha";
import ValidadorNotaFiscal from "../src/validacao/ValidadorNotaFiscal";
import Validador from "../src/validacao/Validador";
import { RelogioFixo } from "../src/comum/Relogio";
import { adicionarDias, lerData } from "../src/comum/datas";
import Argumentos, { tokenizar } from "../src/cli/Argumentos";

test("CNPJ: aceita CNPJs numéricos válidos, com ou sem máscara", () => {
    const v = new ValidadorCNPJ();
    assert.equal(v.validar("11.222.333/0001-81"), true);
    assert.equal(v.validar("11222333000181"), true);
    assert.equal(v.validar("45.723.174/0001-10"), true);
});

test("CNPJ: aceita o CNPJ alfanumérico (exemplo oficial da Receita Federal)", () => {
    assert.equal(new ValidadorCNPJ().validar("12.ABC.345/01DE-35"), true);
});

test("CNPJ: rejeita dígitos verificadores errados, repetições e formatos inválidos", () => {
    const v = new ValidadorCNPJ();
    assert.equal(v.validar("11.222.333/0001-82"), false);
    assert.match(v.obterMensagemErro(), /dígitos verificadores/);
    assert.equal(v.validar("00.000.000/0000-00"), false);
    assert.match(v.obterMensagemErro(), /repetidos/);
    assert.equal(v.validar("123"), false);
    assert.equal(v.validar("12ABC34501DE3X"), false);
});

test("Validadores são polimórficos: tratados pela classe abstrata Validador", () => {
    const hoje = new RelogioFixo(new Date(2026, 8, 25));
    const casos: Array<[Validador, unknown, boolean]> = [
        [new ValidadorCNPJ(), "11.222.333/0001-81", true],
        [new ValidadorDataEntrada(hoje), new Date(2026, 8, 30), false],
        [new ValidadorNotaFiscal(), "0", false],
        [new ValidadorSenha(), { usuario: "ana", senha: "Coleta#2026" }, true]
    ];
    for (const [validador, valor, esperado] of casos) {
        assert.equal(validador.validar(valor), esperado);
        assert.equal(validador.obterMensagemErro() === "", esperado);
    }
});

test("Data de entrada: hoje e até 90 dias atrás são aceitos; futuro e 91+ dias, não", () => {
    const hoje = new Date(2026, 8, 25, 15, 30);
    const v = new ValidadorDataEntrada(new RelogioFixo(hoje));
    assert.equal(v.validar(new Date(2026, 8, 25)), true);
    assert.equal(v.validar(adicionarDias(hoje, -90)), true);
    assert.equal(v.validar(adicionarDias(hoje, -91)), false);
    assert.match(v.obterMensagemErro(), /90 dias/);
    assert.equal(v.validar(adicionarDias(hoje, 1)), false);
    assert.match(v.obterMensagemErro(), /futuro/);
});

test("Datas: aceita AAAA-MM-DD e DD/MM/AAAA e rejeita datas inexistentes", () => {
    assert.equal(lerData("2026-09-25").getDate(), 25);
    assert.equal(lerData("25/09/2026").getMonth(), 8);
    assert.throws(() => lerData("2026-02-30"), /inexistente/);
    assert.throws(() => lerData("amanhã"), /inválida/);
});

test("Senha: exige 8+ caracteres, letras e números, sem conter o login", () => {
    const v = new ValidadorSenha();
    assert.equal(v.validar({ usuario: "ana", senha: "curta1" }), false);
    assert.equal(v.validar({ usuario: "ana", senha: "semnumeros" }), false);
    assert.equal(v.validar({ usuario: "ana", senha: "Ana12345" }), false);
    assert.equal(v.validar({ usuario: "ana", senha: "Coleta#2026" }), true);
});

test("CLI: tokenização respeita aspas e opções seguem a convenção --nome valor", () => {
    const tokens = tokenizar('lote criar --org BR001 --nf 123456 --transp "Trans Rápida"');
    assert.deepEqual(tokens, ["lote", "criar", "--org", "BR001", "--nf", "123456", "--transp", "Trans Rápida"]);
    const args = new Argumentos(tokens.slice(2), [
        { nome: "org", descricao: "", obrigatoria: true }, { nome: "nf", descricao: "" }, { nome: "transp", descricao: "" }
    ]);
    assert.equal(args.obrigatoria("org"), "BR001");
    assert.equal(args.texto("transp"), "Trans Rápida");
    assert.throws(() => new Argumentos(["--xyz", "1"], []), /Opção desconhecida/);
    assert.throws(() => new Argumentos([], [{ nome: "org", descricao: "organização", obrigatoria: true }]), /obrigatória/);
    assert.throws(() => tokenizar('org criar --razao "sem fim'), /Aspas/);
});
