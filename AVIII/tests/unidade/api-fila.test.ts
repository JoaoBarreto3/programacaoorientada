import { describe, it } from "node:test";
import assert from "node:assert/strict";
import ChaveApi from "../../src/dominio/ChaveApi";
import { gerarCredencial, hashSegredo, lerChave, segredoConfere } from "../../src/dominio/credencialApi";
import { possuiPermissao } from "../../src/servicos/autorizacao";
import Permissao from "../../src/dominio/enums/Permissao";
import { gerarCsv } from "../../src/comum/csv";
import FilaMemoria from "../../src/infra/fila/FilaMemoria";
import { FalhaDefinitiva, InfoTentativa } from "../../src/infra/fila/FilaTarefas";
import { ErroRegraNegocio, ErroValidacao } from "../../src/comum/erros";

const agora = new Date("2026-11-19T12:00:00Z");
const silencioso = { log: { error: () => undefined, info: () => undefined } };

function novaChave(extra: Partial<ConstructorParameters<typeof ChaveApi>[0]> = {}) {
    return new ChaveApi({
        id: "6f1c2a8e-0000-4000-8000-000000000001", nome: "ERP Cliente", prefixo: "a1b2c3d4e5f6", hashSegredo: hashSegredo("x"),
        escopos: ["LOTES_LER"], plano: "BASICO", organizacaoId: "BR001", ativa: true, expiraEm: null, revogadaEm: null,
        ultimoUsoEm: null, criadaPor: "admin", criadaEm: agora, versao: 1, ...extra
    });
}

describe("Credenciais da API pública", () => {
    it("gera chave no formato gc_<prefixo>_<segredo> e guarda só o hash", () => {
        const c = gerarCredencial();
        assert.match(c.chaveCompleta, /^gc_[0-9a-f]{12}_[A-Za-z0-9_-]{43}$/);
        assert.equal(c.hashSegredo.length, 64);
        assert.ok(!c.hashSegredo.includes(c.segredo));
        const lida = lerChave(c.chaveCompleta)!;
        assert.equal(lida.prefixo, c.prefixo);
        assert.ok(segredoConfere(lida.segredo, c.hashSegredo));
        assert.ok(!segredoConfere(lida.segredo.slice(0, -1) + "A", c.hashSegredo));
        assert.equal(lerChave("gc_123_abc"), null);
        assert.equal(gerarCredencial().prefixo === c.prefixo, false);
    });

    it("valida escopos, organização e validade da chave", () => {
        assert.throws(() => ChaveApi.validar({ nome: "ab", escopos: ["LOTES_LER"], plano: "BASICO", organizacaoId: null, expiraEm: null }, agora), ErroValidacao);
        assert.throws(() => ChaveApi.validar({ nome: "Parceiro", escopos: [], plano: "BASICO", organizacaoId: null, expiraEm: null }, agora), ErroValidacao);
        assert.throws(() => ChaveApi.validar({ nome: "Parceiro", escopos: ["LOTES_ESCREVER"], plano: "BASICO", organizacaoId: null, expiraEm: null }, agora), ErroRegraNegocio);
        assert.throws(() => ChaveApi.validar({ nome: "Parceiro", escopos: ["LOTES_LER"], plano: "BASICO", organizacaoId: null, expiraEm: new Date(agora.getTime() - 1) }, agora), ErroValidacao);
        const ok = ChaveApi.validar({ nome: "  Parceiro  ", escopos: ["LOTES_LER", "LOTES_LER"], plano: "BASICO", organizacaoId: null, expiraEm: null }, agora);
        assert.deepEqual(ok.escopos, ["LOTES_LER"]);
        assert.equal(ok.nome, "Parceiro");
    });

    it("revogação é definitiva; expiração e desativação tornam a chave inutilizável", () => {
        const c = novaChave({ expiraEm: new Date(agora.getTime() + 60_000) });
        assert.ok(c.utilizavel(agora));
        assert.ok(!c.utilizavel(new Date(agora.getTime() + 120_000)));
        c.alterar({ ativa: false }, agora);
        assert.ok(!c.utilizavel(agora));
        c.revogar(agora);
        assert.equal(c.paraJSON(agora).situacao, "REVOGADA");
        assert.throws(() => c.alterar({ ativa: true }, agora), ErroRegraNegocio);
        assert.throws(() => c.rotacionar("0".repeat(64)), ErroRegraNegocio);
    });

    it("escopos viram permissões de negócio fechadas", () => {
        const parceiro = novaChave({ escopos: ["RASTREABILIDADE_LER", "RELATORIOS_GERAR"] }).paraParceiro();
        assert.equal(parceiro.login, "api:a1b2c3d4e5f6");
        assert.ok(possuiPermissao(parceiro, Permissao.EQUIPAMENTOS_LER));
        assert.ok(possuiPermissao(parceiro, Permissao.ANALISES_LER));
        assert.ok(possuiPermissao(parceiro, Permissao.RELATORIOS_ASSINCRONOS));
        assert.ok(!possuiPermissao(parceiro, Permissao.LOTES_LER));
        assert.ok(!possuiPermissao(parceiro, Permissao.ANALISES_EXECUTAR));
        assert.ok(!possuiPermissao(parceiro, Permissao.USUARIOS_GERENCIAR));
    });
});

describe("CSV", () => {
    it("segue a RFC 4180, inclui BOM e neutraliza fórmulas (CSV injection)", () => {
        const csv = gerarCsv([{ titulo: "a", valor: (x: string[]) => x[0] }, { titulo: "b", valor: (x: string[]) => x[1] }],
            [["texto, com vírgula", 'aspas "duplas"'], ["=HYPERLINK(\"x\")", "-5"], ["normal", ""]]);
        const linhas = csv.replace("﻿", "").split("\r\n");
        assert.ok(csv.startsWith("﻿"));
        assert.equal(linhas[0], "a,b");
        assert.equal(linhas[1], '"texto, com vírgula","aspas ""duplas"""');
        assert.equal(linhas[2], `"'=HYPERLINK(""x"")",'-5`);
        assert.equal(linhas[3], "normal,");
    });
});

describe("Fila em memória (mesma política de retry da fila BullMQ)", () => {
    const esperar = (ms: number) => new Promise(r => setTimeout(r, ms));

    it("repete com backoff exponencial e para na última tentativa", async () => {
        const fila = new FilaMemoria({ tentativas: 3, atrasoInicialMs: 10 }, 2, silencioso);
        const vistos: InfoTentativa[] = [];
        const instantes: number[] = [];
        await fila.iniciarWorker(async (_id, info) => {
            vistos.push(info);
            instantes.push(Date.now());
            throw new Error("falha transitória");
        });
        await fila.enfileirar("t1");
        await esperar(150);
        assert.deepEqual(vistos.map(v => [v.tentativa, v.ultimaTentativa]), [[1, false], [2, false], [3, true]]);
        assert.ok(instantes[2]! - instantes[1]! >= instantes[1]! - instantes[0]!, "o intervalo dobra a cada falha");
        await fila.fechar();
    });

    it("falha definitiva não é repetida; sucesso na 2ª tentativa encerra", async () => {
        const fila = new FilaMemoria({ tentativas: 3, atrasoInicialMs: 5 }, 1, silencioso);
        const tentativas: Record<string, number> = {};
        await fila.iniciarWorker(async (id, info) => {
            tentativas[id] = info.tentativa;
            if (id === "definitiva") throw new FalhaDefinitiva("não adianta repetir");
            if (id === "transitoria" && info.tentativa === 1) throw new Error("timeout");
        });
        await fila.enfileirar("definitiva");
        await fila.enfileirar("transitoria");
        await esperar(80);
        assert.deepEqual(tentativas, { definitiva: 1, transitoria: 2 });
        await fila.fechar();
    });

    it("não enfileira a mesma tarefa duas vezes e respeita a concorrência", async () => {
        const fila = new FilaMemoria({ tentativas: 1, atrasoInicialMs: 0 }, 2, silencioso);
        let simultaneos = 0, pico = 0, execucoes = 0;
        await fila.iniciarWorker(async () => {
            execucoes++;
            pico = Math.max(pico, ++simultaneos);
            await esperar(15);
            simultaneos--;
        });
        for (const id of ["a", "a", "b", "c", "d"]) await fila.enfileirar(id);
        await esperar(100);
        assert.equal(execucoes, 4);
        assert.equal(pico, 2);
        await fila.fechar();
        await assert.rejects(fila.enfileirar("e"), /encerrada/);
    });
});
