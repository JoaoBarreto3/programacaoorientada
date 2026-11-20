import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Browser, chromium, Page } from "playwright-core";
import { cnpjValido, configuracaoTeste, contratoPadrao, equipamentoPadrao, limparBanco, SENHA_ADMIN } from "../auxiliares";
import { criarClientePrisma } from "../../src/infra/banco";
import { encerrarServidor, iniciarServidor, Servidor } from "../servidorReal";

// XSS: cadastra cargas de script em todos os campos de texto que aparecem na interface e abre TODAS
// as telas no Chrome. Nenhum script pode executar, o texto deve aparecer literalmente e não pode haver
// violação de CSP (a prova de que o escape funciona sozinho; a CSP é a segunda barreira).

const IMG = "<img src=x onerror=window.__xss=1>";
const SCRIPT = "<script>window.__xss=1</script>";
const SVG = "\"><svg onload=window.__xss=1>";

async function abrirNavegador(): Promise<Browser | null> {
    try {
        return await chromium.launch({ channel: "chrome", headless: true });
    } catch {
        return null;
    }
}

describe("Interface: nenhuma carga de script executa em nenhuma tela (XSS)", async () => {
    const navegador = await abrirNavegador();
    const pular = navegador ? false : "Google Chrome não encontrado nesta máquina";
    let servidor: Servidor;
    let pagina: Page;
    let lote = "";
    let equipamento = "";
    const problemas: string[] = [];

    before(async () => {
        if (!navegador) return;
        const prisma = criarClientePrisma(configuracaoTeste().urlBanco);
        await limparBanco(prisma);
        servidor = await iniciarServidor({ REDIS_URL: "" });
        let token = "";
        const http = async (metodo: string, rota: string, corpo?: unknown) => {
            const r = await fetch(servidor.url + "/api/v1/internal" + rota, {
                method: metodo, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: corpo ? JSON.stringify(corpo) : undefined
            });
            const c = await r.json() as any;
            assert.ok(r.ok, `${metodo} ${rota}: ${JSON.stringify(c)}`);
            return c;
        };
        token = (await http("POST", "/provisionamento", { login: "admin", senha: SENHA_ADMIN })).token;
        await http("POST", "/organizacoes", {
            razaoSocial: `Org ${IMG}`, cnpj: cnpjValido("121212121212"), email: "ti@xss.com.br",
            enderecoCompleto: `Rua ${SCRIPT}, 1`, contrato: contratoPadrao({ clausulas: [SVG, SCRIPT] })
        });
        const l = await http("POST", "/lotes", {
            organizacaoId: "BR001", notaFiscal: "4242", transportadora: `T ${IMG}`, observacoes: SCRIPT,
            equipamentos: [equipamentoPadrao({ marca: IMG, modelo: SVG }), equipamentoPadrao({ marca: IMG, modelo: SVG, estadoFisico: "USADO_LEVE" })]
        });
        lote = l.id;
        equipamento = l.equipamentos[0].id;
        await http("POST", `/equipamentos/${equipamento}/movimentacoes`, { destino: `Galpão ${SVG}`, observacao: IMG });
        await http("POST", `/lotes/${lote}/triagem`, {});
        await http("PATCH", `/equipamentos/${equipamento}/estado`, { estadoFisico: "DANIFICADO_GRAVE", justificativa: `Quebrado ${SCRIPT}` });
        await http("POST", `/lotes/${lote}/triagem`, {});
        await http("POST", "/chaves-api", { nome: `Parceiro ${IMG}`, escopos: ["LOTES_LER"] });
        await http("POST", "/analises/execucoes", { tipo: "RENTABILIDADE" });
        // Relatório que falhou com uma mensagem de erro maliciosa (aparece na tela de relatórios).
        await prisma.tarefaRelatorio.create({ data: { tipo: "VIDA_UTIL", formato: "CSV", parametros: {}, solicitante: "admin", situacao: "FALHOU", tentativas: 3, erro: `Falha ${IMG}`, concluidaEm: new Date() } });
        await prisma.$disconnect();

        pagina = await navegador.newPage({ viewport: { width: 1280, height: 900 } });
        pagina.on("pageerror", e => problemas.push(`erro JS: ${e.message}`));
        pagina.on("dialog", d => { problemas.push(`diálogo aberto: ${d.message()}`); void d.dismiss(); });
        pagina.on("console", m => { if (/Content Security Policy/i.test(m.text())) problemas.push(`CSP: ${m.text()}`); });
        await pagina.goto(servidor.url);
        await pagina.fill("#form-login [name=login]", "admin");
        await pagina.fill("#form-login [name=senha]", SENHA_ADMIN);
        await pagina.click("#form-login button");
        await pagina.waitForSelector("#topo:not([hidden])");
    });
    after(async () => {
        await navegador?.close();
        if (servidor) await encerrarServidor(servidor);
    });

    const visitar = async (rota: string, esperarTexto?: string) => {
        // Marcador na tela atual: some quando o SPA desenha a tela nova (evita conferir a tela anterior).
        await pagina.evaluate(`document.querySelector("main")?.insertAdjacentHTML("beforeend", '<i id="tela-anterior"></i>')`);
        await pagina.goto(`${servidor.url}/#/${rota}`);
        if (await pagina.$("#tela-anterior")) await pagina.reload();
        await pagina.waitForSelector("#tela-anterior", { state: "detached" });
        await pagina.waitForSelector("main h1");
        await pagina.waitForLoadState("networkidle");
        // Abre todos os "ver detalhes" da tela, para renderizar também o conteúdo recolhido.
        await pagina.evaluate(`document.querySelectorAll("main details").forEach(d => { d.open = true; })`);
        await pagina.waitForTimeout(50);
        assert.equal(await pagina.evaluate("window.__xss"), undefined, `script executou em #/${rota}`);
        assert.equal(await pagina.locator("main script, main img[onerror], main svg[onload]").count(), 0, `elemento injetado em #/${rota}`);
        if (esperarTexto) assert.ok(((await pagina.textContent("main")) ?? "").includes(esperarTexto), `#/${rota} deveria exibir o texto literal ${esperarTexto}`);
    };

    it("telas de cadastro: organizações, lotes, equipamentos e usuários", { skip: pular }, async () => {
        await visitar("painel");
        await visitar("organizacoes", IMG);
        await visitar("organizacoes/BR001", SCRIPT);
        await visitar("lotes", IMG);
        await visitar(`lotes/${lote}`, SCRIPT);
        await visitar("equipamentos", IMG);
        await visitar(`equipamentos/${equipamento}`, SVG);
        await visitar("usuarios");
    });

    it("relatórios, auditoria (com os detalhes abertos) e parâmetros", { skip: pular }, async () => {
        await visitar("relatorios");
        // Relatório por status: lista marca e modelo dos equipamentos.
        await pagina.selectOption("#filtros [name=tipo]", "status");
        await pagina.waitForSelector("#filtros [name=status]");
        await pagina.selectOption("#filtros [name=status]", "EM_TRIAGEM");
        await pagina.click("#filtros button");
        await pagina.waitForSelector("main table tbody tr");
        assert.ok(((await pagina.textContent("main")) ?? "").includes(IMG), "marca exibida como texto");
        assert.equal(await pagina.evaluate("window.__xss"), undefined);
        await visitar("auditoria", SCRIPT);
        await visitar("parametros");
    });

    it("telas da AV3: análises (todas as abas), relatórios em segundo plano e chaves de API", { skip: pular }, async () => {
        await visitar("analises/eficiencia");
        await visitar("analises/rentabilidade", IMG);
        await visitar("analises/vida-util");
        await visitar("analises/historico");
        await pagina.click("main [data-execucao]");
        await pagina.waitForSelector("dialog[open]");
        assert.ok(((await pagina.textContent("dialog[open]")) ?? "").includes(IMG), "JSON da execução exibido como texto");
        assert.equal(await pagina.evaluate("window.__xss"), undefined);
        await pagina.click("dialog[open] [type=submit]");
        await visitar("tarefas", IMG);
        await visitar("chaves-api", IMG);
    });

    it("a CSP bloqueia de fato um script embutido injetado na página", { skip: pular }, async () => {
        await pagina.evaluate(`(() => { const s = document.createElement("script"); s.textContent = "window.__csp = 1"; document.body.append(s); })()`);
        await pagina.waitForTimeout(100);
        assert.equal(await pagina.evaluate("window.__csp"), undefined, "script embutido não pode executar");
        // A tentativa é registrada como violação de CSP: retira-a da lista (era esperada).
        const csp = problemas.filter(p => p.startsWith("CSP"));
        assert.ok(csp.length >= 1, "violação registrada pelo navegador");
        problemas.splice(0, problemas.length, ...problemas.filter(p => !p.startsWith("CSP")));
    });

    it("nenhum erro de JavaScript, diálogo ou violação de CSP durante a navegação", { skip: pular }, () => {
        assert.deepEqual(problemas, []);
    });
});
