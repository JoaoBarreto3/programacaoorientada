import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Ambiente, criarOrganizacaoELote, equipamentoPadrao, hojeISO, prepararAmbiente } from "../auxiliares";

describe("Parâmetros, relatórios e auditoria", () => {
    let amb: Ambiente;
    before(async () => {
        amb = await prepararAmbiente();
        const ano = new Date().getFullYear();
        await criarOrganizacaoELote(amb, "990011223344", "5005", [
            equipamentoPadrao({ anoFabricacao: ano, estadoFisico: "NOVO" }),
            equipamentoPadrao({ tipo: "SERVIDOR", marca: "HP", modelo: "DL380", anoFabricacao: ano, estadoFisico: "NOVO", pesoQuilogramas: 20 })
        ]);
    });
    after(async () => { await amb.fechar(); });

    it("parâmetros: consulta, define e valida, com versionamento", async () => {
        const p = await amb.admin.get("/api/parametros");
        assert.equal(p.corpo.retencaoAuditoriaDias, 180);
        assert.equal(p.corpo.valoresReferencia.NOTEBOOK, 4000);
        const r = await amb.admin.put("/api/parametros/aliquota/ICMS", { valor: 0.12, versao: p.corpo.versao });
        assert.equal(r.status, 200);
        assert.equal(r.corpo.aliquotas.ICMS, 0.12);
        assert.equal((await amb.admin.put("/api/parametros/aliquota/ISS", { valor: 0.02, versao: p.corpo.versao })).status, 409);
        assert.equal((await amb.admin.put("/api/parametros/retencao/dias", { valor: 90 })).status, 400);
        assert.equal((await amb.admin.put("/api/parametros/depreciacao/GELADEIRA", { valor: 0.1 })).status, 400);
        assert.equal((await amb.admin.put("/api/parametros/valor/SERVIDOR", { valor: 20000 })).corpo.valoresReferencia.SERVIDOR, 20000);
        assert.equal((await amb.admin.delete("/api/parametros/aliquota/ICMS")).corpo.aliquotas.ICMS, undefined);
    });

    it("relatório financeiro aplica valores de referência, depreciação e tributos", async () => {
        const r = await amb.auditor.get(`/api/relatorios/financeiro?inicio=${hojeISO(-1)}&fim=${hojeISO()}`);
        assert.equal(r.status, 200);
        assert.equal(r.corpo.totais.equipamentos, 2);
        assert.equal(r.corpo.totais.valorReferencia, 24000); // 4000 + 20000
        assert.equal(r.corpo.totais.valorResidual, 24000);   // novos e do ano corrente: sem depreciação
        const soma = r.corpo.tributos.reduce((s: number, t: any) => s + t.valor, 0);
        assert.ok(Math.abs(r.corpo.totais.tributos - soma) < 0.011);
        assert.ok(Math.abs(r.corpo.totais.valorLiquido - (24000 - r.corpo.totais.tributos)) < 0.011);
        assert.equal((await amb.auditor.get(`/api/relatorios/financeiro?inicio=${hojeISO()}&fim=${hojeISO(-5)}`)).status, 400);
    });

    it("relatórios por organização, por status e painel", async () => {
        const org = await amb.auditor.get("/api/relatorios/organizacoes/BR001");
        assert.equal(org.corpo.totais.lotes, 1);
        assert.equal(org.corpo.totais.pesoKg, 21.9);
        assert.deepEqual(org.corpo.equipamentosPorStatus, { AGUARDANDO_TRIAGEM: 2 });
        const status = await amb.auditor.get("/api/relatorios/status/AGUARDANDO_TRIAGEM");
        assert.equal(status.corpo.total, 2);
        assert.equal(status.corpo.equipamentos[0].organizacaoId, "BR001");
        const painel = await amb.gestor.get("/api/relatorios/painel");
        assert.equal(painel.corpo.organizacoesAtivas, 1);
        assert.deepEqual(painel.corpo.lotesPorStatus, { RECEBIDO: 1 });
    });

    it("auditoria registra quem fez o quê, com dados antes e depois", async () => {
        const r = await amb.auditor.get("/api/auditoria?entidade=Parametros");
        assert.ok(r.corpo.total >= 3);
        const definicao = r.corpo.itens.find((i: any) => i.entidadeId === "valor.SERVIDOR");
        assert.equal(definicao.usuario, "admin");
        assert.equal(definicao.dadosAntes.valoresReferencia.SERVIDOR, 15000);
        assert.equal(definicao.dadosDepois.valoresReferencia.SERVIDOR, 20000);
        const logins = await amb.auditor.get("/api/auditoria?operacao=login&usuario=gestor");
        assert.ok(logins.corpo.itens.every((i: any) => i.operacao.startsWith("LOGIN") && i.usuario === "gestor"));
    });

    it("expurgo respeita a retenção mínima de 180 dias", async () => {
        await amb.prisma.$executeRaw`INSERT INTO registros_auditoria (id, data_hora, operacao, entidade, entidade_id, usuario)
            VALUES (gen_random_uuid(), now() - interval '200 days', 'ANTIGA', 'Teste', '1', 'admin'),
                   (gen_random_uuid(), now() - interval '100 days', 'RECENTE', 'Teste', '2', 'admin')`;
        const r = await amb.admin.post("/api/auditoria/expurgo");
        assert.equal(r.status, 200);
        assert.equal(r.corpo.removidos, 1);
        const restantes = await amb.prisma.registroAuditoria.findMany({ where: { entidade: "Teste" } });
        assert.deepEqual(restantes.map(x => x.operacao), ["RECENTE"]);
    });
});
