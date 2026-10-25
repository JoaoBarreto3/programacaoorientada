import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Ambiente, cnpjValido, criarOrganizacaoELote, equipamentoPadrao, organizacaoPadrao, prepararAmbiente } from "../auxiliares";

describe("Concorrência (versionamento otimista) e integridade no banco", () => {
    let amb: Ambiente;
    let loteId: string;
    before(async () => {
        amb = await prepararAmbiente();
        loteId = (await criarOrganizacaoELote(amb, "778899001122", "3003", [equipamentoPadrao(), equipamentoPadrao()])).lote.id;
    });
    after(async () => { await amb.fechar(); });

    it("duas edições simultâneas da mesma versão: uma grava, a outra recebe 409", async () => {
        const org = (await amb.operador.get("/api/organizacoes/BR001")).corpo;
        const base = { razaoSocial: org.razaoSocial, enderecoCompleto: org.enderecoCompleto, email: org.email, versao: org.versao };
        const [a, b] = await Promise.all([
            amb.operador.put("/api/organizacoes/BR001", { ...base, razaoSocial: "Edição A Ltda" }),
            amb.operador.put("/api/organizacoes/BR001", { ...base, razaoSocial: "Edição B Ltda" })
        ]);
        assert.deepEqual([a.status, b.status].sort(), [200, 409]);
        const vencedora = a.status === 200 ? "Edição A Ltda" : "Edição B Ltda";
        assert.equal((await amb.operador.get("/api/organizacoes/BR001")).corpo.razaoSocial, vencedora);
    });

    it("operações simultâneas no mesmo equipamento não perdem atualizações", async () => {
        const resultados = await Promise.all(["Doca 1", "Doca 2", "Doca 3", "Doca 4"].map(destino =>
            amb.gestor.post("/api/equipamentos/EQ-000001/movimentacoes", { destino })));
        const sucesso = resultados.filter(r => r.status === 201).length;
        assert.ok(sucesso >= 1);
        assert.ok(resultados.every(r => r.status === 201 || r.status === 409), JSON.stringify(resultados.map(r => r.status)));
        const historico = (await amb.auditor.get("/api/equipamentos/EQ-000001/movimentacoes")).corpo;
        // Cada movimentação gravada partiu do local deixado pela anterior: nenhuma foi sobrescrita.
        for (let i = 1; i < historico.length; i++) {
            assert.equal(historico[i].origem, historico[i - 1].destino);
        }
        assert.equal(historico.length, 1 + sucesso);
        const equipamento = (await amb.auditor.get("/api/equipamentos/EQ-000001")).corpo;
        assert.equal(equipamento.versao, 1 + sucesso);
    });

    it("cadastros simultâneos recebem códigos distintos e CNPJ duplicado é barrado pelo índice único", async () => {
        const cnpj = cnpjValido("889900112233");
        const [a, b] = await Promise.all([
            amb.operador.post("/api/organizacoes", organizacaoPadrao(cnpj)),
            amb.operador.post("/api/organizacoes", organizacaoPadrao(cnpj))
        ]);
        assert.deepEqual([a.status, b.status].sort(), [201, a.status === 201 ? b.status : a.status].sort());
        assert.equal([a, b].filter(r => r.status === 201).length, 1);
        const recusada = [a, b].find(r => r.status !== 201)!;
        assert.ok([409, 422].includes(recusada.status), JSON.stringify(recusada.corpo));
        const lotes = await Promise.all([1, 2, 3].map(n => amb.gestor.post("/api/lotes", { organizacaoId: "BR001", notaFiscal: String(4000 + n), transportadora: "TT" })));
        assert.ok(lotes.every(l => l.status === 201));
        assert.equal(new Set(lotes.map(l => l.corpo.id)).size, 3);
    });

    it("trigger impede pular etapas do ciclo de vida mesmo por SQL direto", async () => {
        await assert.rejects(
            amb.prisma.$executeRaw`UPDATE equipamentos SET status_rastreamento = 'BAIXA_DEFINITIVA' WHERE id = 'EQ-000002'`,
            (e: any) => /Transição de status inválida/.test(e.message));
        await amb.prisma.$executeRaw`UPDATE equipamentos SET status_rastreamento = 'EM_TRIAGEM' WHERE id = 'EQ-000002'`;
        await assert.rejects(
            amb.prisma.$executeRaw`UPDATE equipamentos SET status_rastreamento = 'AGUARDANDO_DESMONTE' WHERE id = 'EQ-000002'`,
            (e: any) => /só pode ir para desmonte após a triagem completa/.test(e.message));
    });

    it("histórico de movimentações e auditoria são imutáveis no banco", async () => {
        await assert.rejects(amb.prisma.$executeRaw`UPDATE movimentacoes SET destino = 'Adulterado'`, (e: any) => /imutável/.test(e.message));
        await assert.rejects(amb.prisma.$executeRaw`DELETE FROM movimentacoes`, (e: any) => /imutável/.test(e.message));
        await assert.rejects(amb.prisma.$executeRaw`UPDATE registros_auditoria SET usuario = 'outro'`, (e: any) => /imutáveis/.test(e.message));
        await assert.rejects(amb.prisma.$executeRaw`DELETE FROM registros_auditoria`, (e: any) => /prazo de retenção/.test(e.message));
    });

    it("CHECK constraints barram valores inconsistentes", async () => {
        await assert.rejects(amb.prisma.$executeRaw`UPDATE equipamentos SET peso_quilogramas = -1 WHERE id = 'EQ-000001'`, (e: any) => /ck_equipamentos_peso/.test(e.message));
        await assert.rejects(amb.prisma.$executeRaw`UPDATE organizacoes SET cnpj = '123' WHERE id = 'BR001'`, (e: any) => /ck_organizacoes_cnpj/.test(e.message));
        await assert.rejects(amb.prisma.$executeRaw`UPDATE parametros_globais SET retencao_auditoria_dias = 30`, (e: any) => /ck_parametros_retencao/.test(e.message));
    });

    it("lote em triagem não pode ser excluído nem por SQL direto", async () => {
        const lote = (await amb.gestor.post("/api/lotes", { organizacaoId: "BR001", notaFiscal: "6006", transportadora: "TT", equipamentos: [equipamentoPadrao()] })).corpo;
        assert.equal((await amb.gestor.post(`/api/lotes/${lote.id}/triagem`, {})).status, 200);
        const equipamentoId = lote.equipamentos[0].id;
        await assert.rejects(amb.prisma.$executeRaw`DELETE FROM lotes WHERE id = ${lote.id}`, (e: any) => /não pode ser excluído/.test(e.message));
        await assert.rejects(amb.prisma.$executeRaw`DELETE FROM equipamentos WHERE id = ${equipamentoId}`, (e: any) => /lotes RECEBIDOS/.test(e.message));
        // Um lote RECEBIDO é excluído junto com os equipamentos e o histórico (cascata permitida).
        assert.equal(await amb.prisma.$executeRaw`DELETE FROM lotes WHERE id = ${loteId}`, 1);
        assert.equal(await amb.prisma.equipamento.count({ where: { loteId } }), 0);
    });
});
