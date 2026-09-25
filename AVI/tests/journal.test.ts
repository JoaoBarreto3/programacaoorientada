import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { TAMANHO_MAXIMO_JOURNAL } from "../src/infra/GerenciadorJournal";
import Aplicacao from "../src/Aplicacao";
import { ErroIntegridade } from "../src/comum/erros";
import { SENHA_ADMIN, adicionar, criarAmbiente, prepararLote, removerDiretorio, ITERACOES_TESTE } from "./auxiliares";

function arquivoAtual(dir: string): string {
    return path.join(dir, "journal", "journal-atual.log");
}

test("Rotação do journal ocorre ao ultrapassar 10 MB (limite padrão)", () => {
    assert.equal(TAMANHO_MAXIMO_JOURNAL, 10 * 1024 * 1024);
});

test("Cada operação vira uma JournalTransacao registrada antes de ser aplicada", () => {
    const amb = criarAmbiente();
    try {
        const { org } = prepararLote(amb);
        const criacao = amb.app.journal.listarRegistros().find(r => r.operacao === "ORGANIZACAO_CRIAR")!;
        assert.equal(criacao.situacao, "CONFIRMADA");
        assert.equal(criacao.usuario, "admin");
        assert.equal(criacao.entidade, `Organização ${org.id}`);
        assert.deepEqual(criacao.afetados.sort(), ["BR001", "CT-BR001"]);
        const transacao = amb.app.journal.obterTransacao(criacao.id);
        assert.equal(transacao.dadosAntes["organizacoes.dat"]["BR001"], null, "dadosAntes: a organização não existia");
        assert.equal(transacao.dadosDepois["organizacoes.dat"]["BR001"].razaoSocial, "Banco Horizonte S.A.");
        assert.equal(amb.app.auditoria.verificar().integro, true);
    } finally {
        removerDiretorio(amb.diretorio);
    }
});

test("Queda durante a aplicação: a transação é refeita a partir do journal na inicialização", () => {
    const amb = criarAmbiente();
    try {
        const { app } = amb;
        const { lote } = prepararLote(amb);
        const original = app.repositorio.salvarEntidade.bind(app.repositorio);
        app.repositorio.salvarEntidade = () => { throw new Error("disco cheio (simulado)"); };
        assert.throws(() => adicionar(amb, lote.id), ErroIntegridade);
        app.repositorio.salvarEntidade = original;
        assert.throws(() => adicionar(amb, lote.id), /Reinicie/, "após a falha o sistema recusa novas transações até ser reiniciado");

        const reaberta = amb.reabrir();
        assert.ok(reaberta.journal.listarRegistros().filter(r => r.operacao === "EQUIPAMENTO_ADICIONAR").every(r => r.situacao === "CONFIRMADA"));
        reaberta.autenticacao.login("admin", SENHA_ADMIN);
        const recuperado = reaberta.lote.consultarLotePorPeriodo(new Date(2000, 0, 1), amb.relogio.agora()).find(l => l.id === lote.id)!;
        assert.equal(recuperado.equipamentos.length, 1, "o equipamento foi recuperado");
        assert.equal(reaberta.auditoria.verificar().integro, true);
    } finally {
        removerDiretorio(amb.diretorio);
    }
});

test("Queda durante a gravação do journal: a transação pela metade é descartada sem alterar dados", () => {
    const amb = criarAmbiente();
    try {
        prepararLote(amb);
        fs.appendFileSync(arquivoAtual(amb.diretorio), "GC1:transacao-pela-met");
        const app2 = new Aplicacao(amb.diretorio, amb.chave, { relogio: amb.relogio, iteracoesSenha: ITERACOES_TESTE });
        const relatorio = app2.inicializar();
        assert.equal(relatorio.caudaReparada, true);
        assert.deepEqual(relatorio.recuperadas, []);
        assert.equal(app2.journal.verificarIntegridade().integro, true);
    } finally {
        removerDiretorio(amb.diretorio);
    }
});

test("Adulteração do journal é detectada: linha alterada ou removida", () => {
    const amb = criarAmbiente();
    try {
        prepararLote(amb);
        const arquivo = arquivoAtual(amb.diretorio);
        const linhas = fs.readFileSync(arquivo, "utf8").trimEnd().split("\n");

        fs.writeFileSync(arquivo, [...linhas.slice(0, 4), ...linhas.slice(5)].join("\n") + "\n");
        const r1 = amb.app.journal.verificarIntegridade();
        assert.equal(r1.integro, false);
        assert.match(r1.problemas.join(" "), /quebra no encadeamento/);

        const alterada = [...linhas];
        alterada[3] = alterada[3]!.slice(0, 20) + (alterada[3]![20] === "A" ? "B" : "A") + alterada[3]!.slice(21);
        fs.writeFileSync(arquivo, alterada.join("\n") + "\n");
        assert.match(amb.app.journal.verificarIntegridade().problemas.join(" "), /ilegível/);
        assert.throws(() => amb.reabrir(), /Journal corrompido ou adulterado/);
    } finally {
        removerDiretorio(amb.diretorio);
    }
});

test("Rotação por tamanho mantém a cadeia de hashes íntegra entre arquivos", () => {
    const amb = criarAmbiente({ tamanhoMaximoJournal: 4_000 });
    try {
        const { lote } = prepararLote(amb);
        for (let i = 0; i < 6; i++) {
            adicionar(amb, lote.id);
        }
        const arquivos = amb.app.journal.listarArquivos();
        assert.ok(arquivos.length >= 3, `esperados vários arquivos, obtidos ${arquivos.length}`);
        assert.ok(arquivos.slice(0, -1).every(a => /journal-\d{8}T\d{9}Z\.log$/.test(a)), "nomes válidos no Windows (sem ':')");
        const r = amb.app.journal.verificarIntegridade();
        assert.equal(r.integro, true, r.problemas.join("\n"));
        assert.ok(amb.app.journal.listarRegistros().some(x => x.operacao === "JOURNAL_ROTACAO"));
    } finally {
        removerDiretorio(amb.diretorio);
    }
});

test("Retenção: arquivos rotacionados com menos de 180 dias são mantidos; mais antigos, expurgados", () => {
    const amb = criarAmbiente({ tamanhoMaximoJournal: 2_000, agora: new Date(2026, 0, 2, 12, 0) });
    try {
        const { app, relogio } = amb;
        for (const valor of [0.04, 0.05, 0.03]) {
            app.parametros.definir("aliquota", "ISS", valor);
        }
        const antigos = app.journal.listarArquivos().length - 1;
        assert.ok(antigos >= 1);
        assert.throws(() => app.parametros.definir("retencao", "dias", 90), /mínimo 180/);

        relogio.avancarMinutos(179 * 24 * 60);
        assert.deepEqual(amb.reabrir({ tamanhoMaximoJournal: 2_000 }).inicializar().expurgados, [], "com 179 dias nada é removido");

        relogio.avancarMinutos(2 * 24 * 60);
        const reaberta = new Aplicacao(amb.diretorio, amb.chave, { relogio, iteracoesSenha: ITERACOES_TESTE, tamanhoMaximoJournal: 2_000 });
        assert.equal(reaberta.inicializar().expurgados.length, antigos);
        const r = reaberta.journal.verificarIntegridade();
        assert.equal(r.integro, true, "a cadeia continua verificável a partir do expurgo registrado: " + r.problemas.join("\n"));

        reaberta.autenticacao.login("admin", SENHA_ADMIN);
        for (const valor of [0.02, 0.03, 0.04]) {
            reaberta.parametros.definir("aliquota", "ISS", valor);
        }
        const restantes = reaberta.journal.listarArquivos();
        assert.ok(restantes.length > 1);
        fs.rmSync(restantes[0]!);
        assert.equal(reaberta.journal.verificarIntegridade().integro, false, "remover arquivo sem expurgo registrado é detectado");
    } finally {
        removerDiretorio(amb.diretorio);
    }
});

test("JournalTransacao.reverter(): desfaz por compensação e recusa se houve alteração posterior", () => {
    const amb = criarAmbiente();
    try {
        const { app } = amb;
        const { lote } = prepararLote(amb);
        const eq1 = adicionar(amb, lote.id);
        const primeira = app.journal.listarRegistros().find(r => r.operacao === "EQUIPAMENTO_ADICIONAR" && r.afetados.includes(eq1.id))!;
        const eq2 = adicionar(amb, lote.id);
        assert.equal(app.auditoria.reverter(primeira.id.slice(0, 8)), false, "o lote mudou depois (2º equipamento)");
        const segunda = app.journal.listarRegistros().find(r => r.operacao === "EQUIPAMENTO_ADICIONAR" && r.afetados.includes(eq2.id))!;
        assert.equal(app.journal.obterTransacao(segunda.id).reverter(), true);
        const atual = app.lote.consultarLotePorPeriodo(new Date(2000, 0, 1), amb.relogio.agora()).find(l => l.id === lote.id)!;
        assert.equal(atual.equipamentos.length, 1);
        assert.throws(() => app.equipamento.rastrearEquipamento(eq2.id), /não encontrado/);
        assert.ok(app.journal.listarRegistros().some(r => r.operacao === `REVERSAO ${segunda.id}` && r.usuario === "admin"));
    } finally {
        removerDiretorio(amb.diretorio);
    }
});
