import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { cnpjValido, configuracaoTeste, equipamentoPadrao, hojeISO, limparBanco } from "./auxiliares";
import { criarClientePrisma } from "../src/infra/banco";
import { encerrarServidor as encerrar, iniciarServidor, Servidor } from "./servidorReal";

// Jornada de ponta a ponta com o servidor REAL (processo separado, porta TCP, fetch), do
// provisionamento até a rastreabilidade de um equipamento após várias movimentações,
// incluindo reinício do servidor e graceful shutdown.

function cliente(base: string) {
    let token = "";
    const chamar = async (metodo: string, rota: string, corpo?: unknown) => {
        const resposta = await fetch(base + rota, {
            method: metodo,
            headers: { ...(corpo !== undefined ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
            body: corpo !== undefined ? JSON.stringify(corpo) : undefined
        });
        const texto = await resposta.text();
        return { status: resposta.status, corpo: texto ? JSON.parse(texto) : null };
    };
    return {
        chamar,
        async entrar(login: string, senha: string) {
            const r = await chamar("POST", "/api/auth/login", { login, senha });
            assert.equal(r.status, 200, `login ${login}: ${JSON.stringify(r.corpo)}`);
            token = r.corpo.token;
        },
        usarToken(t: string) { token = t; }
    };
}

describe("Jornada completa do greencode (servidor real)", () => {
    let servidor: Servidor;
    const cnpj = cnpjValido("11444777000A");
    const equipamentoRastreado = "EQ-000001";

    before(async () => {
        const prisma = criarClientePrisma(configuracaoTeste().urlBanco);
        await limparBanco(prisma);
        await prisma.$disconnect();
        servidor = await iniciarServidor();
    });
    after(async () => {
        if (servidor.processo.exitCode === null) await encerrar(servidor);
    });

    it("1. provisionamento inicial do administrador", async () => {
        const c = cliente(servidor.url);
        assert.deepEqual((await c.chamar("GET", "/api/provisionamento")).corpo, { necessario: true });
        const r = await c.chamar("POST", "/api/provisionamento", { login: "admin", senha: "Mestre2026x" });
        assert.equal(r.status, 201);
        assert.equal(r.corpo.usuario.papel, "ADMINISTRADOR");
    });

    it("2. administrador cria operador, gestor e auditor", async () => {
        const c = cliente(servidor.url);
        await c.entrar("admin", "Mestre2026x");
        for (const [login, papel] of [["operador", "OPERADOR_CADASTRO"], ["gestor", "GESTOR_ALMOXARIFADO"], ["auditor", "AUDITOR"]]) {
            assert.equal((await c.chamar("POST", "/api/usuarios", { login, senha: "Acesso2026x", papel })).status, 201);
        }
        assert.equal((await c.chamar("PUT", "/api/parametros/aliquota/ISS", { valor: 0.04 })).status, 200);
    });

    it("3. operador cadastra a organização com contrato e renova o contrato", async () => {
        const c = cliente(servidor.url);
        await c.entrar("operador", "Acesso2026x");
        const org = {
            razaoSocial: "Rede Varejo Brasil Ltda", cnpj, email: "sustentabilidade@varejo.com.br",
            enderecoCompleto: "Rua das Flores, 500, Curitiba/PR",
            contrato: { dataAssinatura: hojeISO(-10), dataVencimento: hojeISO(180), clausulas: ["Coleta quinzenal"], valorMensal: 3200 }
        };
        assert.equal((await c.chamar("POST", "/api/organizacoes", org)).status, 201);
        assert.equal((await c.chamar("POST", "/api/organizacoes", org)).status, 422, "CNPJ duplicado");
        assert.equal((await c.chamar("POST", "/api/organizacoes", { ...org, cnpj: "11.444.777/0001-00" })).status, 400, "CNPJ inválido");
        const renovado = await c.chamar("POST", "/api/organizacoes/BR001/contrato/renovacao", { novoVencimento: hojeISO(540) });
        assert.equal(renovado.corpo.dataVencimento, hojeISO(540));
        assert.equal((await c.chamar("POST", "/api/lotes", { organizacaoId: "BR001", notaFiscal: "1", transportadora: "TT" })).status, 403);
    });

    it("4. gestor registra lote, faz a triagem e movimenta os equipamentos", async () => {
        const c = cliente(servidor.url);
        await c.entrar("gestor", "Acesso2026x");
        const lote = await c.chamar("POST", "/api/lotes", {
            organizacaoId: "BR001", notaFiscal: "123456", transportadora: "TransRapida",
            equipamentos: [equipamentoPadrao(), equipamentoPadrao({ tipo: "IMPRESSORA", marca: "Epson", modelo: "L3250", pesoQuilogramas: 4 })]
        });
        assert.equal(lote.status, 201);
        const loteId = lote.corpo.id;
        const id = equipamentoRastreado;

        const cedo = await c.chamar("PATCH", `/api/equipamentos/${id}/status`, { status: "AGUARDANDO_DESMONTE" });
        assert.equal(cedo.status, 422, "desmonte antes da triagem");

        assert.equal((await c.chamar("POST", `/api/lotes/${loteId}/triagem`, {})).corpo.etapa, "INICIADA");
        assert.equal((await c.chamar("PATCH", `/api/equipamentos/${id}/estado`, { estadoFisico: "DANIFICADO_LEVE" })).status, 400, "sem justificativa");
        assert.equal((await c.chamar("PATCH", `/api/equipamentos/${id}/estado`, { estadoFisico: "DANIFICADO_LEVE", justificativa: "Carcaça quebrada na coleta" })).status, 200);
        assert.equal((await c.chamar("POST", `/api/lotes/${loteId}/triagem`, {})).corpo.etapa, "CONCLUIDA");

        for (const destino of ["Galpão A", "Linha de desmonte 1"]) {
            assert.equal((await c.chamar("POST", `/api/equipamentos/${id}/movimentacoes`, { destino })).status, 201);
        }
        for (const status of ["AGUARDANDO_DESMONTE", "EM_DESMONTE", "PECAS_REAPROVEITADAS"]) {
            assert.equal((await c.chamar("PATCH", `/api/equipamentos/${id}/status`, { status })).status, 200, status);
        }
        assert.equal((await c.chamar("PATCH", "/api/equipamentos/EQ-000002/status", { status: "DESCARTE_SEGURO", justificativa: "Cartucho vazando" })).status, 200);
    });

    it("5. após reiniciar o servidor, o auditor rastreia o equipamento e gera relatórios", async () => {
        const codigo = await encerrar(servidor);
        if (process.platform !== "win32") {
            // No Windows, kill('SIGTERM') encerra o processo à força; o graceful shutdown é testado no Linux.
            assert.equal(codigo, 0);
            assert.match(servidor.saida.join(""), /Servidor encerrado/);
        }
        servidor = await iniciarServidor();

        const c = cliente(servidor.url);
        await c.entrar("auditor", "Acesso2026x");
        const r = await c.chamar("GET", `/api/equipamentos/${equipamentoRastreado}/rastreamento`);
        assert.equal(r.status, 200);
        assert.equal(r.corpo.organizacao.cnpj, cnpj);
        assert.equal(r.corpo.equipamento.statusRastreamento, "PECAS_REAPROVEITADAS");
        assert.equal(r.corpo.equipamento.localizacaoAtual, "Linha de desmonte 1");
        assert.deepEqual(r.corpo.movimentacoes.map((m: any) => m.destino), [
            "Almoxarifado - recebimento", "EM_TRIAGEM", "DANIFICADO_LEVE", "Galpão A", "Linha de desmonte 1",
            "AGUARDANDO_DESMONTE", "EM_DESMONTE", "PECAS_REAPROVEITADAS"
        ]);
        assert.equal(r.corpo.movimentacoes.find((m: any) => m.destino === "DANIFICADO_LEVE").observacao, "Carcaça quebrada na coleta");
        assert.ok(r.corpo.auditoria.length >= 6);

        const financeiro = await c.chamar("GET", "/api/relatorios/financeiro");
        assert.equal(financeiro.corpo.totais.equipamentos, 2);
        assert.ok(financeiro.corpo.tributos.some((t: any) => t.imposto === "ISS" && t.aliquota === 0.04));
        assert.equal((await c.chamar("GET", "/api/relatorios/status/DESCARTE_SEGURO")).corpo.total, 1);
        assert.equal((await c.chamar("PATCH", `/api/equipamentos/${equipamentoRastreado}/status`, { status: "BAIXA_DEFINITIVA" })).status, 403, "auditor só consulta");
        const auditoria = await c.chamar("GET", "/api/auditoria?tamanhoPagina=100");
        const usuarios = new Set(auditoria.corpo.itens.map((i: any) => i.usuario));
        for (const u of ["admin", "operador", "gestor", "auditor"]) assert.ok(usuarios.has(u), `auditoria de ${u}`);
    });

    it("6. documentação da API e front-end são servidos pelo monólito", async () => {
        const docs = await fetch(`${servidor.url}/docs/json`);
        assert.equal(docs.status, 200);
        const openapi = await docs.json() as { paths: Record<string, unknown> };
        assert.ok(Object.keys(openapi.paths).length > 30);
        const pagina = await fetch(`${servidor.url}/`);
        assert.equal(pagina.status, 200);
        assert.match(await pagina.text(), /greencode/);
    });
});
