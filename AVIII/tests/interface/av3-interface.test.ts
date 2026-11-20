import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { Browser, chromium, Page } from "playwright-core";
import { configuracaoTeste, limparBanco } from "../auxiliares";
import { criarClientePrisma } from "../../src/infra/banco";
import { encerrarServidor, iniciarServidor, Servidor } from "../servidorReal";

// Telas da AV3 no Chrome headless, sobre os dados do seed (12 meses de histórico): análises,
// relatórios em segundo plano (fila + polling + download) e gestão de chaves de API.

const SEED = path.resolve(__dirname, "..", "..", "prisma", "seed.js");
const SENHA = "Greencode2026";

async function abrirNavegador(): Promise<Browser | null> {
    try {
        return await chromium.launch({ channel: "chrome", headless: true });
    } catch {
        return null;
    }
}

describe("Interface web (AV3): análises, relatórios assíncronos e chaves de API", async () => {
    const navegador = await abrirNavegador();
    const pular = navegador ? false : "Google Chrome não encontrado nesta máquina";
    let servidor: Servidor;
    let pagina: Page;
    const errosNoNavegador: string[] = [];

    before(async () => {
        if (!navegador) return;
        const prisma = criarClientePrisma(configuracaoTeste().urlBanco);
        await limparBanco(prisma);
        await prisma.$disconnect();
        const seed = spawnSync(process.execPath, [SEED], {
            env: { ...process.env, DATABASE_URL: configuracaoTeste().urlBanco, SENHA_ITERACOES: "1000" }, encoding: "utf8"
        });
        assert.equal(seed.status, 0, seed.stdout + seed.stderr);
        servidor = await iniciarServidor();
        pagina = await navegador.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
        pagina.on("pageerror", e => errosNoNavegador.push(e.message));
    });
    after(async () => {
        await navegador?.close();
        if (servidor) await encerrarServidor(servidor);
    });

    const ir = async (rota: string, titulo: string) => {
        await pagina.goto(`${servidor.url}/#/${rota}`);
        await pagina.waitForSelector(`main h1:has-text("${titulo}")`);
    };
    const entrar = async (login: string) => {
        await pagina.goto(servidor.url);
        // Espera o SPA decidir a tela (login ou sistema) antes de olhar se há sessão aberta.
        await pagina.waitForSelector("#form-login, #topo:not([hidden])");
        if (await pagina.isVisible("#botao-sair")) await pagina.click("#botao-sair");
        await pagina.waitForSelector("#form-login");
        await pagina.fill("#form-login [name=login]", login);
        await pagina.fill("#form-login [name=senha]", SENHA);
        await pagina.click("#form-login button");
        await pagina.waitForSelector("#topo:not([hidden])");
    };
    const textoPrincipal = async () => (await pagina.textContent("main")) ?? "";

    it("auditor: abas de análise com gargalo, operadores, prioridade, modelos e aderência", { skip: pular }, async () => {
        await entrar("auditor");
        assert.ok(await pagina.isVisible('#menu a[href="#/analises"]'));
        await ir("analises/eficiencia", "Análises");
        await pagina.waitForSelector("main .cartao.destaque:has-text('Gargalo')");
        const eficiencia = await textoPrincipal();
        for (const operador of ["ana.souza", "bruno.lima", "gestor"]) assert.ok(eficiencia.includes(operador), operador);
        const barras = await pagina.locator("main .barra-proporcao").count();
        assert.ok(barras >= 10, "um mês por linha, com barra proporcional");

        await pagina.click('main .abas a:has-text("Rentabilidade")');
        await pagina.waitForSelector("main h2:has-text('Prioridade por tipo')");
        await pagina.selectOption("#estimativa [name=tipo]", "NOTEBOOK");
        await pagina.click("#estimativa button");
        await pagina.waitForSelector("#resultado-estimativa:has-text('R$')");

        await pagina.click('main .abas a:has-text("Vida útil")');
        await pagina.waitForSelector("main h2:has-text('Aderência')");
        assert.match(await textoPrincipal(), /Regressão linear/);

        await pagina.click('main .abas a:has-text("Histórico")');
        await pagina.waitForSelector("main table tbody tr");
        assert.ok(await pagina.locator("main table tbody tr").count() >= 12);
        await pagina.click('main .abas a:has-text("Eficiência")');
        await pagina.click("#gravar");
        await pagina.waitForSelector('#avisos .aviso:has-text("gravada no histórico")');
    });

    it("relatório em segundo plano: solicita, acompanha por polling e baixa o CSV", { skip: pular }, async () => {
        await ir("tarefas", "Relatórios em segundo plano");
        await pagina.selectOption("#novo [name=tipo]", "VIDA_UTIL");
        await pagina.selectOption("#novo [name=formato]", "CSV");
        await pagina.click("#novo button");
        const baixar = await pagina.waitForSelector("main [data-baixar]", { timeout: 15_000 });
        const [download] = await Promise.all([pagina.waitForEvent("download"), baixar.click()]);
        assert.match(download.suggestedFilename(), /^greencode-vida-util-\d{4}-\d{2}-\d{2}\.csv$/);
    });

    it("administrador: cria chave (segredo exibido uma vez), parceiro usa a API e a chave é revogada", { skip: pular }, async () => {
        await entrar("admin");
        await ir("chaves-api", "Chaves de API");
        await pagina.click("#nova");
        await pagina.fill("dialog[open] [name=nome]", "Cooperativa Recicla Mais");
        await pagina.selectOption("dialog[open] [name=organizacaoId]", "BR001");
        await pagina.check('dialog[open] [name=escopo][value="LOTES_LER"]');
        await pagina.click("dialog[open] [type=submit]");
        const campo = await pagina.waitForSelector("dialog[open] input[readonly]");
        const segredo = await campo.inputValue();
        assert.match(segredo, /^gc_[0-9a-f]{12}_/);
        await pagina.click("dialog[open] [type=submit]");

        const usar = () => fetch(`${servidor.url}/api/v1/public/lotes`, { headers: { "x-api-key": segredo } });
        const r = await usar();
        assert.equal(r.status, 200);
        const corpo = await r.json() as { itens: { organizacaoId: string }[] };
        assert.ok(corpo.itens.every(l => l.organizacaoId === "BR001"));

        await pagina.waitForSelector("main tr:has-text('Cooperativa Recicla Mais')");
        await pagina.click("main tr:has-text('Cooperativa Recicla Mais') [data-acao=revogar]");
        await pagina.click("dialog[open] [type=submit]");
        await pagina.waitForSelector("main tr:has-text('Cooperativa Recicla Mais') .etiqueta:has-text('Revogada')");
        assert.equal((await usar()).status, 401);
    });

    it("chave: desativar, reativar e gerar novo segredo pela tela (o antigo para de funcionar)", { skip: pular }, async () => {
        await ir("chaves-api", "Chaves de API");
        await pagina.click("#nova");
        await pagina.fill("dialog[open] [name=nome]", "Parceiro Rotação");
        await pagina.check('dialog[open] [name=escopo][value="LOTES_LER"]');
        await pagina.click("dialog[open] [type=submit]");
        const antigo = await (await pagina.waitForSelector("dialog[open] input[readonly]")).inputValue();
        await pagina.click("dialog[open] [type=submit]");
        const linha = "main tr:has-text('Parceiro Rotação')";
        const usar = (chave: string) => fetch(`${servidor.url}/api/v1/public/eu`, { headers: { "x-api-key": chave } }).then(r => r.status);

        await pagina.click(`${linha} [data-acao=situacao]`);
        await pagina.waitForSelector(`${linha} .etiqueta:has-text('Inativa')`);
        assert.equal(await usar(antigo), 401);
        await pagina.click(`${linha} [data-acao=situacao]`);
        await pagina.waitForSelector(`${linha} .etiqueta:has-text('Ativa')`);
        assert.equal(await usar(antigo), 200);

        await pagina.click(`${linha} [data-acao=rotacao]`);
        await pagina.click("dialog[open] [type=submit]");
        const novo = await (await pagina.waitForSelector("dialog[open] input[readonly]")).inputValue();
        await pagina.click("dialog[open] [type=submit]");
        assert.notEqual(novo, antigo);
        assert.deepEqual([await usar(antigo), await usar(novo)], [401, 200]);
    });

    it("relatório: excluir pela tela", { skip: pular }, async () => {
        await ir("tarefas", "Relatórios em segundo plano");
        await pagina.selectOption("#novo [name=tipo]", "RENTABILIDADE");
        await pagina.selectOption("#novo [name=formato]", "JSON");
        await pagina.click("#novo button");
        // A linha do pedido novo (JSON de rentabilidade), já concluída pelo worker.
        const linha = "main tbody tr:has-text('Rentabilidade'):has-text('JSON')";
        await pagina.waitForSelector(`${linha} [data-baixar]`, { timeout: 15_000 });
        await pagina.click(`${linha} [data-excluir]`);
        await pagina.click("dialog[open] [type=submit]");
        await pagina.waitForSelector('#avisos .aviso:has-text("Relatório excluído")');
        await pagina.waitForSelector(linha, { state: "detached" });
    });

    it("menu por papel: gestor vê análises sem gravar; operador não vê as telas da AV3", { skip: pular }, async () => {
        await entrar("gestor");
        await ir("analises/eficiencia", "Análises");
        assert.equal(await pagina.locator("#gravar").count(), 0, "gestor lê, mas não grava execuções");
        assert.ok(await pagina.isVisible('#menu a[href="#/tarefas"]'));
        assert.equal(await pagina.locator('#menu a[href="#/chaves-api"]').count(), 0);
        await entrar("operador");
        for (const rota of ["#/analises", "#/tarefas", "#/chaves-api"]) {
            assert.equal(await pagina.locator(`#menu a[href="${rota}"]`).count(), 0, `operador não deveria ver ${rota}`);
        }
    });

    it("nenhum erro de JavaScript no navegador", { skip: pular }, () => {
        assert.deepEqual(errosNoNavegador, []);
    });
});
