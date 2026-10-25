import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Browser, chromium, Page } from "playwright-core";
import { configuracaoTeste, hojeISO, limparBanco } from "../auxiliares";
import { criarClientePrisma } from "../../src/infra/banco";
import { encerrarServidor, iniciarServidor, Servidor } from "../servidorReal";

// Testes da interface (front-end SPA) no Google Chrome instalado na máquina, em modo headless:
// o CRUD completo é feito clicando e preenchendo formulários, como um usuário faria.
// Se o Chrome não estiver instalado, os testes são pulados (não falham).

async function abrirNavegador(): Promise<Browser | null> {
    try {
        return await chromium.launch({ channel: "chrome", headless: true });
    } catch {
        return null;
    }
}

describe("Interface web (SPA) — CRUD pelo navegador", async () => {
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
        servidor = await iniciarServidor();
        pagina = await navegador.newPage({ viewport: { width: 1280, height: 900 } });
        pagina.on("pageerror", e => errosNoNavegador.push(e.message));
    });
    after(async () => {
        await navegador?.close();
        if (servidor) await encerrarServidor(servidor);
    });

    // ------------------------------------------------------------ auxiliares de interação
    // Navega e espera a tela NOVA: um marcador colocado na tela atual some quando o SPA a substitui.
    const ir = async (rota: string) => {
        await pagina.evaluate(`document.querySelector("main")?.insertAdjacentHTML("beforeend", '<i id="tela-anterior"></i>')`);
        await pagina.goto(`${servidor.url}/#/${rota}`);
        if (await pagina.$("#tela-anterior")) await pagina.reload();
        await pagina.waitForSelector("#tela-anterior", { state: "detached" });
        await pagina.waitForSelector("main h1");
    };
    // Espera um texto aparecer (a tela é recarregada logo depois do aviso de sucesso).
    const aguardarTexto = (seletor: string, texto: string) => pagina.waitForSelector(`${seletor}:has-text("${texto}")`, { timeout: 10_000 });
    const titulo = () => pagina.textContent("main h1");
    const clicar = (texto: string) => pagina.click(`main button:has-text("${texto}")`);
    const preencher = async (campos: Record<string, string>, escopo = "dialog[open]") => {
        await pagina.waitForSelector(escopo);
        for (const [nome, valor] of Object.entries(campos)) {
            const seletor = `${escopo} [name="${nome}"]`;
            if (await pagina.$eval(seletor, e => e.tagName) === "SELECT") await pagina.selectOption(seletor, valor);
            else await pagina.fill(seletor, valor);
        }
    };
    const confirmarDialogo = () => pagina.click("dialog[open] [type=submit]");
    const aguardarAviso = (texto: string) => pagina.waitForSelector(`#avisos .aviso:has-text("${texto}")`, { timeout: 10_000 });
    const linhas = (seletor = "main table tbody tr") => pagina.$$eval(seletor, trs => trs.map(tr => tr.textContent ?? ""));
    const entrar = async (login: string, senha: string) => {
        if (await pagina.isVisible("#botao-sair")) {
            await pagina.click("#botao-sair");
        }
        await pagina.waitForSelector("#form-login");
        await pagina.fill("#form-login [name=login]", login);
        await pagina.fill("#form-login [name=senha]", senha);
        await pagina.click("#form-login button");
        await pagina.waitForSelector("#topo:not([hidden])");
        await pagina.waitForSelector("main h1");
    };

    it("provisionamento inicial pela tela", { skip: pular }, async () => {
        await pagina.goto(servidor.url);
        await pagina.waitForSelector("#form-login");
        assert.match(await pagina.textContent("#form-login") ?? "", /Primeiro acesso/);
        await pagina.fill("#form-login [name=login]", "admin");
        await pagina.fill("#form-login [name=senha]", "Mestre2026x");
        await pagina.fill("#form-login [name=confirmacao]", "Mestre2026x");
        await pagina.click("#form-login button");
        await pagina.waitForSelector("#topo:not([hidden])");
        assert.equal(await titulo(), "Olá, admin");
    });

    it("usuários: cadastrar, alterar papel e excluir", { skip: pular }, async () => {
        await ir("usuarios");
        await clicar("Novo usuário");
        await preencher({ login: "auditora", papel: "AUDITOR", senha: "Acesso2026x" });
        await confirmarDialogo();
        await aguardarAviso("Usuário auditora criado");
        await clicar("Novo usuário");
        await preencher({ login: "temporario", papel: "GESTOR_ALMOXARIFADO", senha: "Acesso2026x" });
        await confirmarDialogo();
        await aguardarAviso("Usuário temporario criado");
        await pagina.click('[data-login="temporario"] [data-acao="papel"]');
        await preencher({ papel: "OPERADOR_CADASTRO" });
        await confirmarDialogo();
        await aguardarAviso("Papel alterado");
        await aguardarTexto("main tr", "Operador cadastro");
        await pagina.click('[data-login="temporario"] [data-acao="excluir"]');
        await confirmarDialogo();
        await aguardarAviso("Usuário excluído");
        await pagina.waitForSelector('[data-login="temporario"]', { state: "detached" });
    });

    it("organizações e contrato: cadastrar, alterar, renovar e excluir", { skip: pular }, async () => {
        await ir("organizacoes");
        await clicar("Nova organização");
        await preencher({
            cnpj: "11.222.333/0001-81", razaoSocial: "Banco Horizonte S.A.", email: "ti@horizonte.com.br",
            enderecoCompleto: "Av. Paulista, 1000, São Paulo/SP", c_dataVencimento: hojeISO(365), c_valorMensal: "4500",
            c_clausulas: "Coleta mensal\nLaudo de destinação"
        });
        await confirmarDialogo();
        await aguardarAviso("Organização BR001 cadastrada");
        await pagina.waitForSelector("main h1:has-text('Banco Horizonte')");

        await clicar("Editar");
        await preencher({ razaoSocial: "Banco Horizonte Digital S.A.", telefone: "(11) 3003-4000" });
        await confirmarDialogo();
        await aguardarAviso("Dados atualizados");
        await pagina.waitForSelector("main h1:has-text('Banco Horizonte Digital')");

        await clicar("Renovar");
        await preencher({ novoVencimento: hojeISO(730) });
        await confirmarDialogo();
        await aguardarAviso("Contrato renovado");
        const [ano, mes, dia] = hojeISO(730).split("-");
        await aguardarTexto("main .cartao", `${dia}/${mes}/${ano}`);

        // Segunda organização, sem contrato, para testar a exclusão.
        await ir("organizacoes");
        await clicar("Nova organização");
        await preencher({ cnpj: "45.987.612/0001-00", razaoSocial: "Organização Temporária", email: "x@temp.com.br", enderecoCompleto: "Rua Teste, 1, Recife/PE" });
        await pagina.uncheck("dialog[open] #com-contrato");
        await confirmarDialogo();
        const erro = await pagina.waitForSelector("#avisos .aviso.ERRO");
        assert.match(await erro.textContent() ?? "", /dígitos verificadores/, "CNPJ inválido é recusado na tela");
        await preencher({ cnpj: "45.987.612/0001-58" });
        await confirmarDialogo();
        await aguardarAviso("Organização BR002 cadastrada");
        await clicar("Excluir");
        await confirmarDialogo();
        await aguardarAviso("Organização excluída");
        await pagina.waitForSelector("main h1:has-text('Organizações')");
        assert.ok(!(await linhas()).some(l => l.includes("Temporária")));
    });

    it("lotes e equipamentos: registrar com vários itens, alterar, adicionar e remover", { skip: pular }, async () => {
        await ir("lotes");
        await clicar("Registrar lote");
        await preencher({ notaFiscal: "123456", transportadora: "TransRapida" });
        await pagina.waitForSelector("dialog[open] #mais");
        await pagina.click("dialog[open] #mais");
        const linhasEquip = await pagina.$$("dialog[open] .equipamento-linha");
        assert.equal(linhasEquip.length, 2);
        const dados = [["NOTEBOOK", "Dell", "Latitude 5490", "2019", "BOM_ESTADO", "1.9"], ["MONITOR", "LG", "24MK430", "2018", "USADO_LEVE", "3.2"]];
        for (const [i, [tipo, marca, modelo, ano, estado, peso]] of dados.entries()) {
            const linha = linhasEquip[i]!;
            await (await linha.$("[name=tipo]"))!.selectOption(tipo!);
            await (await linha.$("[name=marca]"))!.fill(marca!);
            await (await linha.$("[name=modelo]"))!.fill(modelo!);
            await (await linha.$("[name=anoFabricacao]"))!.fill(ano!);
            await (await linha.$("[name=estadoFisico]"))!.selectOption(estado!);
            await (await linha.$("[name=pesoQuilogramas]"))!.fill(peso!);
        }
        await confirmarDialogo();
        await aguardarAviso("registrado com 2 equipamento(s)");
        await pagina.waitForSelector("main h1:has-text('Lote LT-')");
        const loteId = (await titulo())!.replace("Lote ", "");
        assert.match(loteId, /^LT-\d{4}-\d{4}$/);
        assert.equal((await linhas()).filter(l => l.includes("EQ-")).length, 2);

        await clicar("Editar");
        await preencher({ transportadora: "LogSul Transportes", observacoes: "Conferido na doca" });
        await confirmarDialogo();
        await aguardarAviso("Lote atualizado");
        await aguardarTexto("main .cartao", "LogSul Transportes");

        await clicar("Adicionar equipamento");
        await preencher({ tipo: "IMPRESSORA", marca: "HP", modelo: "M402", anoFabricacao: "2016", pesoQuilogramas: "8.9" });
        await confirmarDialogo();
        await aguardarAviso("adicionado");
        await pagina.waitForSelector("main table a:has-text('EQ-000003')");

        await pagina.click("main table a:has-text('EQ-000003')");
        await pagina.waitForSelector("main h1:has-text('EQ-000003')");
        await clicar("Excluir");
        await confirmarDialogo();
        await aguardarAviso("Equipamento removido");
        await pagina.waitForSelector(`main h1:has-text('${loteId}')`);
        await pagina.waitForSelector("main table a:has-text('EQ-000003')", { state: "detached" });
        assert.equal((await linhas()).filter(l => l.includes("EQ-")).length, 2);
    });

    it("triagem, reclassificação com justificativa, status e movimentação", { skip: pular }, async () => {
        await ir("lotes");
        await pagina.click("main table a[href^='#/lotes/LT-']");
        await pagina.waitForSelector("main h1:has-text('Lote')");
        await clicar("Iniciar triagem");
        await aguardarAviso("Triagem iniciada");
        await pagina.waitForSelector("main button:has-text('Concluir triagem')");
        await clicar("Concluir triagem");
        await aguardarAviso("Triagem concluída");

        await pagina.click("main table a:has-text('EQ-000001')");
        await pagina.waitForSelector("main h1:has-text('EQ-000001')");
        await clicar("Reclassificar estado");
        await preencher({ estadoFisico: "DANIFICADO_GRAVE" });
        await confirmarDialogo();
        await pagina.waitForSelector("#avisos .aviso.ERRO:has-text('Justificativa obrigatória')");
        assert.ok(await pagina.isVisible("dialog[open]"), "o diálogo continua aberto para corrigir");
        await preencher({ justificativa: "Tela quebrada e carcaça trincada" });
        await confirmarDialogo();
        await aguardarAviso("Estado físico atualizado");
        await aguardarTexto("main .cartao", "Danificado grave");

        await clicar("Alterar status");
        await preencher({ status: "AGUARDANDO_DESMONTE" });
        await confirmarDialogo();
        await aguardarAviso("Status atualizado");
        await clicar("Movimentar");
        await preencher({ destino: "Linha de desmonte 1" });
        await confirmarDialogo();
        await aguardarAviso("Movimentação registrada");
        await aguardarTexto(".linha-tempo", "Linha de desmonte 1");

        const historico = await pagina.textContent(".linha-tempo") ?? "";
        for (const trecho of ["Almoxarifado - recebimento", "Danificado grave", "Tela quebrada", "Aguardando desmonte", "Linha de desmonte 1"]) {
            assert.ok(historico.includes(trecho), `histórico deveria mostrar "${trecho}"`);
        }
    });

    it("lote: excluir um lote recebido pela tela", { skip: pular }, async () => {
        await ir("lotes");
        await clicar("Registrar lote");
        await preencher({ notaFiscal: "999", transportadora: "Teste", marca: "Acer", modelo: "Aspire", anoFabricacao: "2020", pesoQuilogramas: "2" });
        await confirmarDialogo();
        await aguardarAviso("registrado");
        await pagina.waitForSelector("main h1:has-text('Lote LT-')");
        await clicar("Excluir");
        await confirmarDialogo();
        await aguardarAviso("Lote excluído");
        await pagina.waitForSelector("main h1:has-text('Lotes')");
        assert.ok(!(await linhas()).some(l => l.includes("999")));
    });

    it("parâmetros: incluir, alterar e remover alíquota", { skip: pular }, async () => {
        await ir("parametros");
        await clicar("Nova alíquota");
        await preencher({ chave: "ICMS", valor: "0.12" });
        await confirmarDialogo();
        await aguardarAviso("Alíquota incluída");
        await pagina.click('main button[data-grupo="aliquota"][data-chave="ICMS"]');
        await preencher({ valor: "0.18" });
        await confirmarDialogo();
        await aguardarAviso("Parâmetro atualizado");
        await aguardarTexto("main tr", "18%");
        await pagina.click('main button[data-remover="ICMS"]');
        await confirmarDialogo();
        await aguardarAviso("Alíquota removida");
        await pagina.waitForSelector('main button[data-remover="ICMS"]', { state: "detached" });
    });

    it("o menu e os botões se adaptam ao papel (auditor só consulta)", { skip: pular }, async () => {
        await entrar("auditora", "Acesso2026x");
        const menu = await pagina.$$eval("#menu a", as => as.map(a => a.textContent));
        assert.ok(menu.includes("Relatórios") && menu.includes("Auditoria"));
        assert.ok(!menu.includes("Usuários"), "auditor não vê a gestão de usuários");
        await ir("organizacoes");
        assert.equal(await pagina.$("main button:has-text('Nova organização')"), null);
        await ir("organizacoes/BR001");
        assert.equal(await pagina.$("#editar"), null);
        await ir("equipamentos/EQ-000001");
        assert.equal(await pagina.$("main button:has-text('Alterar status')"), null);
        await ir("relatorios");
        assert.match(await pagina.textContent("main") ?? "", /Valor residual estimado/);
        await ir("auditoria");
        assert.ok((await linhas()).length > 10, "auditoria lista as operações feitas pela tela");
    });

    it("nenhum erro de JavaScript na página durante os testes", { skip: pular }, () => {
        assert.deepEqual(errosNoNavegador, []);
    });
});
