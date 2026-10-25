import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Ambiente, cnpjValido, criarOrganizacaoELote, equipamentoPadrao, organizacaoPadrao, prepararAmbiente } from "../auxiliares";

// Cada rota de escrita recusa entradas malformadas com HTTP 400 (JSON Schema ou validação de
// domínio), sempre no formato padrão de erro, e nada é gravado.

describe("Validação das entradas da API", () => {
    let amb: Ambiente;
    let loteId: string;
    before(async () => {
        amb = await prepararAmbiente();
        loteId = (await criarOrganizacaoELote(amb, "121212121212", "9001")).lote.id;
    });
    after(async () => { await amb.fechar(); });

    it("recusa corpos inválidos em todas as rotas de escrita", async () => {
        const org = organizacaoPadrao(cnpjValido("131313131313"));
        const casos: [string, () => Promise<{ status: number; corpo: any }>][] = [
            ["login sem senha", () => amb.api.post("/api/auth/login", { login: "admin" })],
            ["usuário com papel inexistente", () => amb.admin.post("/api/usuarios", { login: "novo", senha: "Valida2026", papel: "DONO" })],
            ["usuário sem versão no PATCH", () => amb.admin.patch("/api/usuarios/gestor", { papel: "AUDITOR" })],
            ["organização sem CNPJ", () => amb.operador.post("/api/organizacoes", { ...org, cnpj: undefined })],
            ["organização com e-mail inválido", () => amb.operador.post("/api/organizacoes", { ...org, email: "sem-arroba" })],
            ["organização com razão social curta", () => amb.operador.post("/api/organizacoes", { ...org, razaoSocial: "AB" })],
            ["organização com telefone inválido", () => amb.operador.post("/api/organizacoes", { ...org, telefone: "123" })],
            ["contrato com data em formato errado", () => amb.operador.post("/api/organizacoes", { ...org, contrato: { ...org.contrato, dataVencimento: "31/12/2030" } })],
            ["contrato com data inexistente", () => amb.operador.post("/api/organizacoes", { ...org, contrato: { ...org.contrato, dataVencimento: "2030-02-30" } })],
            ["contrato sem cláusulas", () => amb.operador.post("/api/organizacoes", { ...org, contrato: { ...org.contrato, clausulas: [] } })],
            ["contrato com valor negativo", () => amb.operador.put("/api/organizacoes/BR001/contrato", { ...org.contrato, valorMensal: -1 })],
            ["renovação sem data", () => amb.operador.post("/api/organizacoes/BR001/contrato/renovacao", {})],
            ["PUT de organização sem versão", () => amb.operador.put("/api/organizacoes/BR001", { razaoSocial: "Nome Novo", enderecoCompleto: "Rua X, 10, Recife/PE", email: "a@b.com" })],
            ["situação sem o campo ativo", () => amb.operador.patch("/api/organizacoes/BR001/situacao", {})],
            ["lote sem transportadora", () => amb.gestor.post("/api/lotes", { organizacaoId: "BR001", notaFiscal: "1" })],
            ["lote com nota fiscal não numérica", () => amb.gestor.post("/api/lotes", { organizacaoId: "BR001", notaFiscal: "NF-1", transportadora: "TT" })],
            ["lote com mais de 200 equipamentos", () => amb.gestor.post("/api/lotes", { organizacaoId: "BR001", notaFiscal: "2", transportadora: "TT", equipamentos: Array(201).fill(equipamentoPadrao()) })],
            ["equipamento com tipo inexistente", () => amb.gestor.post(`/api/lotes/${loteId}/equipamentos`, equipamentoPadrao({ tipo: "GELADEIRA" }))],
            ["equipamento com peso zero", () => amb.gestor.post(`/api/lotes/${loteId}/equipamentos`, equipamentoPadrao({ pesoQuilogramas: 0 }))],
            ["equipamento com ano anterior a 1970", () => amb.gestor.post(`/api/lotes/${loteId}/equipamentos`, equipamentoPadrao({ anoFabricacao: 1960 }))],
            ["equipamento com ano como texto", () => amb.gestor.post(`/api/lotes/${loteId}/equipamentos`, equipamentoPadrao({ anoFabricacao: "dois mil" }))],
            ["equipamento direto sem lote", () => amb.gestor.post("/api/equipamentos", equipamentoPadrao())],
            ["status inexistente", () => amb.gestor.patch("/api/equipamentos/EQ-000001/status", { status: "VENDIDO" })],
            ["estado físico inexistente", () => amb.gestor.patch("/api/equipamentos/EQ-000001/estado", { estadoFisico: "OTIMO" })],
            ["movimentação sem destino", () => amb.gestor.post("/api/equipamentos/EQ-000001/movimentacoes", {})],
            ["movimentação com destino de 1 caractere", () => amb.gestor.post("/api/equipamentos/EQ-000001/movimentacoes", { destino: "A" })],
            ["parâmetro de grupo inexistente", () => amb.admin.put("/api/parametros/imposto/ISS", { valor: 0.1 })],
            ["alíquota maior que 100%", () => amb.admin.put("/api/parametros/aliquota/ISS", { valor: 1.5 })],
            ["parâmetro sem valor", () => amb.admin.put("/api/parametros/aliquota/ISS", {})]
        ];
        for (const [descricao, chamar] of casos) {
            const r = await chamar();
            assert.equal(r.status, 400, `${descricao}: ${JSON.stringify(r.corpo)}`);
            assert.equal(r.corpo.erro.codigo, "VALIDACAO", descricao);
            assert.ok(r.corpo.erro.mensagem.length > 5, descricao);
        }
        assert.equal(await amb.prisma.organizacao.count(), 1, "nada foi gravado");
        assert.equal(await amb.prisma.equipamento.count(), 1, "nada foi gravado");
    });

    it("recusa consultas inválidas (filtros, períodos e paginação)", async () => {
        for (const url of [
            "/api/lotes?status=PERDIDO", "/api/lotes?inicio=2026-13-01", "/api/lotes?inicio=ontem",
            "/api/equipamentos?estado=OTIMO", "/api/organizacoes?tamanhoPagina=101", "/api/organizacoes?pagina=0",
            "/api/relatorios/status/INEXISTENTE", "/api/relatorios/financeiro?inicio=2026-01-01&fim=2025-01-01"
        ]) {
            const r = await amb.admin.get(url);
            assert.equal(r.status, 400, `${url}: ${JSON.stringify(r.corpo)}`);
        }
    });

    it("ignora campos desconhecidos e não deixa o cliente definir campos controlados pelo servidor", async () => {
        const r = await amb.operador.post("/api/organizacoes", {
            ...organizacaoPadrao(cnpjValido("141414141414")), id: "BR999", ativo: false, versao: 77, dataCadastro: "2000-01-01T00:00:00Z", admin: true
        });
        assert.equal(r.status, 201);
        assert.equal(r.corpo.id, "BR002");
        assert.equal(r.corpo.ativo, true);
        assert.equal(r.corpo.versao, 1);
        assert.notEqual(r.corpo.dataCadastro, "2000-01-01T00:00:00.000Z");
    });

    it("JSON malformado, rota inexistente e corpo grande demais têm respostas padronizadas", async () => {
        const malformado = await amb.app.inject({ method: "POST", url: "/api/auth/login", headers: { "content-type": "application/json" }, payload: "{login:" });
        assert.equal(malformado.statusCode, 400);
        assert.ok(malformado.json().erro.mensagem);
        const inexistente = await amb.admin.get("/api/nao-existe");
        assert.equal(inexistente.status, 404);
        assert.equal(inexistente.corpo.erro.codigo, "ROTA_INEXISTENTE");
        const grande = await amb.app.inject({ method: "POST", url: "/api/auth/login", headers: { "content-type": "application/json" }, payload: JSON.stringify({ login: "x".repeat(2_000_000), senha: "y" }) });
        assert.equal(grande.statusCode, 413);
    });

    it("cabeçalhos de segurança e verificação de saúde", async () => {
        const r = await amb.app.inject({ method: "GET", url: "/api/saude" });
        assert.equal(r.statusCode, 200);
        assert.deepEqual({ status: r.json().status, banco: r.json().banco }, { status: "ok", banco: "ok" });
        assert.equal(r.headers["x-content-type-options"], "nosniff");
        assert.equal(r.headers["x-frame-options"], "DENY");
    });
});
