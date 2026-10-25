import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Ambiente, criarOrganizacaoELote, equipamentoPadrao, prepararAmbiente } from "../auxiliares";

describe("Equipamentos (CRUD, ciclo de vida e rastreabilidade)", () => {
    let amb: Ambiente;
    let loteId: string;
    before(async () => {
        amb = await prepararAmbiente();
        const { lote } = await criarOrganizacaoELote(amb, "556677889900", "1001", [
            equipamentoPadrao(), equipamentoPadrao({ tipo: "MONITOR", marca: "LG", modelo: "24MK", pesoQuilogramas: 3 }),
            equipamentoPadrao({ tipo: "ROTEADOR", marca: "Cisco", modelo: "ISR", pesoQuilogramas: 1.2 })
        ]);
        loteId = lote.id;
    });
    after(async () => { await amb.fechar(); });

    it("consulta pelo código ou pelo código de barras e lista com filtros", async () => {
        const porId = await amb.auditor.get("/api/equipamentos/EQ-000001");
        assert.equal(porId.status, 200);
        const porCodigo = await amb.auditor.get(`/api/equipamentos/${porId.corpo.codigoBarrasInterno.toLowerCase()}`);
        assert.equal(porCodigo.corpo.id, "EQ-000001");
        assert.equal((await amb.auditor.get(`/api/equipamentos?loteId=${loteId}`)).corpo.total, 3);
        assert.equal((await amb.auditor.get("/api/equipamentos?tipo=MONITOR")).corpo.itens[0].marca, "LG");
        assert.equal((await amb.auditor.get("/api/equipamentos?organizacaoId=BR001&status=AGUARDANDO_TRIAGEM")).corpo.total, 3);
        assert.equal((await amb.auditor.get("/api/equipamentos?tipo=GELADEIRA")).status, 400);
    });

    it("corrige dados descritivos e remove equipamento antes da triagem, renumerando as posições", async () => {
        const e = (await amb.gestor.get("/api/equipamentos/EQ-000002")).corpo;
        const r = await amb.gestor.put("/api/equipamentos/EQ-000002", { marca: "Samsung", modelo: "S24", anoFabricacao: 2018, pesoQuilogramas: 3.5, versao: e.versao });
        assert.equal(r.status, 200);
        assert.equal(r.corpo.marca, "Samsung");
        assert.equal((await amb.gestor.delete("/api/equipamentos/EQ-000001?versao=1")).status, 204);
        const lote = (await amb.gestor.get(`/api/lotes/${loteId}`)).corpo;
        assert.deepEqual(lote.equipamentos.map((x: any) => [x.id, x.posicaoNoLote]), [["EQ-000002", 1], ["EQ-000003", 2]]);
        assert.equal((await amb.gestor.get("/api/equipamentos/EQ-000001")).status, 404);
    });

    it("desmonte é recusado antes da triagem completa", async () => {
        const r = await amb.gestor.patch("/api/equipamentos/EQ-000002/status", { status: "AGUARDANDO_DESMONTE" });
        assert.equal(r.status, 422);
        assert.match(r.corpo.erro.mensagem, /triagem completa/);
        await amb.gestor.post(`/api/lotes/${loteId}/triagem`, {});
        assert.equal((await amb.gestor.patch("/api/equipamentos/EQ-000002/status", { status: "AGUARDANDO_DESMONTE" })).status, 422);
        const atual = (await amb.gestor.get("/api/equipamentos/EQ-000002")).corpo;
        assert.equal(atual.versao, 4, "criação, edição, renumeração e início da triagem");
        assert.equal((await amb.gestor.put("/api/equipamentos/EQ-000002", { marca: "LG", modelo: "X", anoFabricacao: 2018, pesoQuilogramas: 3, versao: atual.versao })).status, 422);
        assert.equal((await amb.gestor.put("/api/equipamentos/EQ-000002", { marca: "LG", modelo: "X", anoFabricacao: 2018, pesoQuilogramas: 3, versao: 1 })).status, 409);
        assert.equal((await amb.gestor.delete("/api/equipamentos/EQ-000002")).status, 422);
        await amb.gestor.post(`/api/lotes/${loteId}/triagem`, {});
    });

    it("reclassificação do estado físico exige justificativa ao cair 2+ categorias", async () => {
        const semJustificativa = await amb.gestor.patch("/api/equipamentos/EQ-000002/estado", { estadoFisico: "DANIFICADO_LEVE" });
        assert.equal(semJustificativa.status, 400);
        assert.match(semJustificativa.corpo.erro.mensagem, /Justificativa obrigatória/);
        const ok = await amb.gestor.patch("/api/equipamentos/EQ-000002/estado", { estadoFisico: "DANIFICADO_LEVE", justificativa: "Tela trincada no transporte" });
        assert.equal(ok.status, 200);
        assert.equal(ok.corpo.estadoFisico, "DANIFICADO_LEVE");
        assert.equal((await amb.gestor.patch("/api/equipamentos/EQ-000003/estado", { estadoFisico: "USADO_LEVE" })).status, 200);
    });

    it("percorre o ciclo de vida até a baixa definitiva e atualiza a situação do lote", async () => {
        const passos: [string, string, string][] = [
            // EQ-000003 ainda está EM_TRIAGEM: o lote só é ENCAMINHADO quando nenhum equipamento estiver em triagem.
            ["EQ-000002", "AGUARDANDO_DESMONTE", "TRIAGEM_CONCLUIDA"],
            ["EQ-000003", "PECAS_REAPROVEITADAS", "ENCAMINHADO"],
            ["EQ-000002", "EM_DESMONTE", "ENCAMINHADO"],
            ["EQ-000002", "MATERIAL_RECICLAVEL", "ENCAMINHADO"],
            ["EQ-000002", "BAIXA_DEFINITIVA", "ENCAMINHADO"],
            ["EQ-000003", "BAIXA_DEFINITIVA", "FINALIZADO"]
        ];
        for (const [id, status, statusLote] of passos) {
            const r = await amb.gestor.patch(`/api/equipamentos/${id}/status`, { status, justificativa: "Fluxo de teste" });
            assert.equal(r.status, 200, `${id} → ${status}: ${JSON.stringify(r.corpo)}`);
            assert.equal((await amb.gestor.get(`/api/lotes/${loteId}`)).corpo.statusProcessamento, statusLote);
        }
        const invalida = await amb.gestor.patch("/api/equipamentos/EQ-000002/status", { status: "EM_TRIAGEM" });
        assert.equal(invalida.status, 422);
        assert.match(invalida.corpo.erro.mensagem, /Transição inválida/);
    });

    it("movimentações: registra locais, recusa nomes reservados e equipamento baixado", async () => {
        const novo = await criarOrganizacaoELote(amb, "667788990011", "2002");
        const id = novo.lote.equipamentos[0].id;
        const m1 = await amb.gestor.post(`/api/equipamentos/${id}/movimentacoes`, { destino: "Galpão B - prateleira 3", observacao: "aguardando triagem" });
        assert.equal(m1.status, 201);
        assert.equal(m1.corpo.origem, "Almoxarifado - recebimento");
        assert.equal(m1.corpo.natureza, "LOCALIZACAO");
        assert.equal((await amb.gestor.post(`/api/equipamentos/${id}/movimentacoes`, { destino: "Galpão B - prateleira 3" })).status, 422);
        assert.equal((await amb.gestor.post(`/api/equipamentos/${id}/movimentacoes`, { destino: "EM_DESMONTE" })).status, 400);
        assert.equal((await amb.gestor.post("/api/equipamentos/EQ-000002/movimentacoes", { destino: "Doca 1" })).status, 422);
        const historico = await amb.auditor.get(`/api/equipamentos/${id}/movimentacoes`);
        assert.deepEqual(historico.corpo.map((m: any) => m.destino), ["Almoxarifado - recebimento", "Galpão B - prateleira 3"]);
    });

    it("rastreabilidade completa: origem, histórico, auditoria e valor residual", async () => {
        const r = await amb.auditor.get("/api/equipamentos/EQ-000002/rastreamento");
        assert.equal(r.status, 200);
        assert.equal(r.corpo.organizacao.id, "BR001");
        assert.equal(r.corpo.lote.id, loteId);
        assert.deepEqual(r.corpo.movimentacoes.map((m: any) => `${m.natureza}:${m.destino}`), [
            "LOCALIZACAO:Almoxarifado - recebimento", "STATUS:EM_TRIAGEM", "ESTADO_FISICO:DANIFICADO_LEVE",
            "STATUS:AGUARDANDO_DESMONTE", "STATUS:EM_DESMONTE", "STATUS:MATERIAL_RECICLAVEL", "STATUS:BAIXA_DEFINITIVA"
        ]);
        assert.ok(r.corpo.movimentacoes.every((m: any) => m.responsavel === "gestor"));
        const operacoes = r.corpo.auditoria.map((a: any) => a.operacao);
        for (const op of ["LOTE_CRIAR", "EQUIPAMENTO_ALTERAR", "LOTE_TRIAGEM_INICIAR", "LOTE_TRIAGEM_CONCLUIR", "EQUIPAMENTO_ESTADO", "EQUIPAMENTO_STATUS"]) {
            assert.ok(operacoes.includes(op), `auditoria deveria conter ${op}`);
        }
        assert.ok(r.corpo.depreciacao > 0 && r.corpo.depreciacao <= 1);
        assert.ok(r.corpo.valorResidual >= 0 && r.corpo.valorResidual < 900);
    });
});
