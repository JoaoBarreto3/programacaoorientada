import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Ambiente, cnpjValido, equipamentoPadrao, hojeISO, organizacaoPadrao, prepararAmbiente } from "../auxiliares";

describe("Lotes (CRUD, transações e triagem)", () => {
    let amb: Ambiente;
    before(async () => {
        amb = await prepararAmbiente();
        assert.equal((await amb.operador.post("/api/organizacoes", organizacaoPadrao(cnpjValido("445566778899")))).status, 201);
    });
    after(async () => { await amb.fechar(); });

    it("registra o lote com os equipamentos em uma transação", async () => {
        const r = await amb.gestor.post("/api/lotes", {
            organizacaoId: "br001", notaFiscal: "000123", transportadora: "TransRapida", observacoes: "Troca de frota",
            equipamentos: [equipamentoPadrao(), equipamentoPadrao({ tipo: "MONITOR", marca: "LG", modelo: "24MK430", pesoQuilogramas: 3.25 })]
        });
        assert.equal(r.status, 201, JSON.stringify(r.corpo));
        const ano = new Date().getFullYear();
        assert.equal(r.corpo.id, `LT-${ano}-0001`);
        assert.equal(r.corpo.notaFiscal, "123");
        assert.equal(r.corpo.dataEntrada, hojeISO());
        assert.equal(r.corpo.statusProcessamento, "RECEBIDO");
        assert.equal(r.corpo.pesoTotalKg, 5.15);
        assert.deepEqual(r.corpo.equipamentos.map((e: any) => [e.id, e.posicaoNoLote, e.statusRastreamento]),
            [["EQ-000001", 1, "AGUARDANDO_TRIAGEM"], ["EQ-000002", 2, "AGUARDANDO_TRIAGEM"]]);
        assert.match(r.corpo.equipamentos[0].codigoBarrasInterno, /^GCNTB0000001\d$/);
        assert.equal(r.corpo.equipamentos[0].localizacaoAtual, "Almoxarifado - recebimento");
    });

    it("um equipamento inválido desfaz o lote inteiro (rollback)", async () => {
        const antes = await amb.prisma.lote.count();
        const equipamentosAntes = await amb.prisma.equipamento.count();
        const r = await amb.gestor.post("/api/lotes", {
            organizacaoId: "BR001", notaFiscal: "555", transportadora: "TransRapida",
            equipamentos: [equipamentoPadrao(), equipamentoPadrao({ anoFabricacao: new Date().getFullYear() + 1 })]
        });
        assert.equal(r.status, 400);
        assert.match(r.corpo.erro.mensagem, /Equipamento 2: Ano de fabricação/);
        assert.equal(await amb.prisma.lote.count(), antes);
        assert.equal(await amb.prisma.equipamento.count(), equipamentosAntes);
        assert.equal(await amb.prisma.registroAuditoria.count({ where: { operacao: "LOTE_CRIAR", entidadeId: { not: `LT-${new Date().getFullYear()}-0001` } } }), 0);
    });

    it("valida data de entrada (não futura, até 90 dias) e nota fiscal única por organização", async () => {
        const base = { organizacaoId: "BR001", transportadora: "TT" };
        const futura = await amb.gestor.post("/api/lotes", { ...base, notaFiscal: "900", dataEntrada: hojeISO(1) });
        assert.equal(futura.status, 400);
        assert.match(futura.corpo.erro.mensagem, /futuro/);
        const antiga = await amb.gestor.post("/api/lotes", { ...base, notaFiscal: "900", dataEntrada: hojeISO(-91) });
        assert.equal(antiga.status, 400);
        assert.match(antiga.corpo.erro.mensagem, /90 dias/);
        assert.equal((await amb.gestor.post("/api/lotes", { ...base, notaFiscal: "900", dataEntrada: hojeISO(-90) })).status, 201);
        const duplicada = await amb.gestor.post("/api/lotes", { ...base, notaFiscal: "123" });
        assert.equal(duplicada.status, 422);
        assert.match(duplicada.corpo.erro.mensagem, /já foi registrada/);
        assert.equal((await amb.gestor.post("/api/lotes", { ...base, notaFiscal: "abc" })).status, 400);
    });

    it("lista com filtros de organização, status e período", async () => {
        const todos = await amb.auditor.get("/api/lotes");
        assert.equal(todos.corpo.total, 2);
        assert.equal(todos.corpo.itens[0].equipamentos, undefined, "a listagem não traz os equipamentos");
        assert.equal(todos.corpo.itens[0].quantidadeEquipamentos, 2);
        assert.equal((await amb.auditor.get(`/api/lotes?inicio=${hojeISO(-10)}&fim=${hojeISO()}`)).corpo.total, 1);
        assert.equal((await amb.auditor.get("/api/lotes?status=EM_TRIAGEM")).corpo.total, 0);
        assert.equal((await amb.auditor.get(`/api/lotes?inicio=${hojeISO()}&fim=${hojeISO(-1)}`)).status, 400);
    });

    it("altera e exclui somente enquanto RECEBIDO", async () => {
        const ano = new Date().getFullYear();
        const id = `LT-${ano}-0003`;
        const lote = (await amb.gestor.get(`/api/lotes/${id}`)).corpo;
        const alterado = await amb.gestor.put(`/api/lotes/${id}`, { notaFiscal: "901", transportadora: "LogSul", observacoes: "corrigido", dataEntrada: hojeISO(-5), versao: lote.versao });
        assert.equal(alterado.status, 200, JSON.stringify(alterado.corpo));
        assert.equal(alterado.corpo.transportadora, "LogSul");
        assert.equal(alterado.corpo.dataEntrada, hojeISO(-5));
        assert.equal((await amb.gestor.put(`/api/lotes/${id}`, { notaFiscal: "123", transportadora: "LogSul", versao: alterado.corpo.versao })).status, 422);
        assert.equal((await amb.gestor.delete(`/api/lotes/${id}?versao=${alterado.corpo.versao}`)).status, 204);
        assert.equal((await amb.gestor.get(`/api/lotes/${id}`)).status, 404);
    });

    it("triagem em duas etapas e bloqueio de alterações depois dela", async () => {
        const id = `LT-${new Date().getFullYear()}-0001`;
        const inicio = await amb.gestor.post(`/api/lotes/${id}/triagem`, {});
        assert.equal(inicio.status, 200);
        assert.equal(inicio.corpo.etapa, "INICIADA");
        assert.equal(inicio.corpo.lote.statusProcessamento, "EM_TRIAGEM");
        assert.ok(inicio.corpo.lote.equipamentos.every((e: any) => e.statusRastreamento === "EM_TRIAGEM"));

        assert.equal((await amb.gestor.post(`/api/lotes/${id}/equipamentos`, equipamentoPadrao())).status, 422);
        assert.equal((await amb.gestor.put(`/api/lotes/${id}`, { notaFiscal: "123", transportadora: "X1", versao: inicio.corpo.lote.versao })).status, 422);
        assert.equal((await amb.gestor.delete(`/api/lotes/${id}`)).status, 422);

        const fim = await amb.gestor.post(`/api/lotes/${id}/triagem`, { versao: inicio.corpo.lote.versao });
        assert.equal(fim.corpo.etapa, "CONCLUIDA");
        assert.equal(fim.corpo.lote.statusProcessamento, "TRIAGEM_CONCLUIDA");
        assert.equal((await amb.gestor.post(`/api/lotes/${id}/triagem`, {})).status, 422);

        const relatorio = await amb.auditor.get(`/api/lotes/${id}/relatorio-triagem`);
        assert.equal(relatorio.corpo.quantidadeEquipamentos, 2);
        assert.deepEqual(relatorio.corpo.porEstadoFisico, { BOM_ESTADO: 2 });
    });

    it("adiciona equipamento a um lote RECEBIDO com código sequencial", async () => {
        const novo = await amb.gestor.post("/api/lotes", { organizacaoId: "BR001", notaFiscal: "321", transportadora: "TT" });
        assert.equal(novo.corpo.quantidadeEquipamentos, 0);
        const e = await amb.gestor.post(`/api/lotes/${novo.corpo.id}/equipamentos`, equipamentoPadrao({ tipo: "SERVIDOR", marca: "HP", modelo: "ProLiant", pesoQuilogramas: 25 }));
        assert.equal(e.status, 201);
        assert.equal(e.cabecalhos.location, `/api/equipamentos/${e.corpo.id}`);
        assert.match(e.corpo.codigoBarrasInterno, /^GCSRV/);
        assert.equal(e.corpo.posicaoNoLote, 1);
        // Lote sem equipamentos não pode iniciar triagem.
        const vazio = await amb.gestor.post("/api/lotes", { organizacaoId: "BR001", notaFiscal: "322", transportadora: "TT" });
        assert.equal((await amb.gestor.post(`/api/lotes/${vazio.corpo.id}/triagem`, {})).status, 422);
    });
});
