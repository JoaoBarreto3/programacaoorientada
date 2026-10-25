import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Ambiente, cnpjValido, criarOrganizacaoELote, equipamentoPadrao, organizacaoPadrao, prepararAmbiente } from "../auxiliares";

// Casos-limite e corridas entre requisições simultâneas que as outras suítes não cobrem.
describe("Casos-limite e concorrência entre recursos", () => {
    let amb: Ambiente;
    let nf = 7000;
    const proximaNf = () => String(++nf);

    before(async () => {
        amb = await prepararAmbiente();
        assert.equal((await amb.operador.post("/api/organizacoes", organizacaoPadrao(cnpjValido("123123123123")))).status, 201);
    });
    after(async () => { await amb.fechar(); });

    async function loteTriado(quantidade: number): Promise<{ id: string; equipamentos: string[] }> {
        const lote = await amb.gestor.post("/api/lotes", {
            organizacaoId: "BR001", notaFiscal: proximaNf(), transportadora: "TT",
            equipamentos: Array.from({ length: quantidade }, () => equipamentoPadrao())
        });
        assert.equal(lote.status, 201, JSON.stringify(lote.corpo));
        assert.equal((await amb.gestor.post(`/api/lotes/${lote.corpo.id}/triagem`, {})).status, 200);
        assert.equal((await amb.gestor.post(`/api/lotes/${lote.corpo.id}/triagem`, {})).status, 200);
        return { id: lote.corpo.id as string, equipamentos: lote.corpo.equipamentos.map((e: any) => e.id as string) };
    }

    const status = (id: string, novo: string) => amb.gestor.patch(`/api/equipamentos/${id}/status`, { status: novo, justificativa: "Encaminhamento" });

    it("saídas simultâneas da triagem deixam o lote ENCAMINHADO", async () => {
        const lote = await loteTriado(3);
        const r = await Promise.all(lote.equipamentos.map(id => status(id, "DESCARTE_SEGURO")));
        assert.ok(r.every(x => x.status === 200 || x.status === 409), JSON.stringify(r.map(x => x.status)));
        for (const [i, x] of r.entries()) {
            if (x.status === 409) assert.equal((await status(lote.equipamentos[i]!, "DESCARTE_SEGURO")).status, 200);
        }
        const final = (await amb.auditor.get(`/api/lotes/${lote.id}`)).corpo;
        assert.ok(final.equipamentos.every((e: any) => e.statusRastreamento === "DESCARTE_SEGURO"));
        assert.equal(final.statusProcessamento, "ENCAMINHADO");
    });

    it("baixas definitivas simultâneas deixam o lote FINALIZADO", async () => {
        const lote = await loteTriado(3);
        for (const id of lote.equipamentos) assert.equal((await status(id, "DESCARTE_SEGURO")).status, 200);
        const r = await Promise.all(lote.equipamentos.map(id => status(id, "BAIXA_DEFINITIVA")));
        for (const [i, x] of r.entries()) {
            if (x.status === 409) assert.equal((await status(lote.equipamentos[i]!, "BAIXA_DEFINITIVA")).status, 200);
            else assert.equal(x.status, 200, JSON.stringify(x.corpo));
        }
        const final = (await amb.auditor.get(`/api/lotes/${lote.id}`)).corpo;
        assert.ok(final.equipamentos.every((e: any) => e.statusRastreamento === "BAIXA_DEFINITIVA"));
        assert.equal(final.statusProcessamento, "FINALIZADO");
    });

    it("inclusão de equipamento simultânea ao início da triagem não deixa equipamento fora da triagem", async () => {
        for (let tentativa = 0; tentativa < 10; tentativa++) {
            const lote = (await amb.gestor.post("/api/lotes", {
                organizacaoId: "BR001", notaFiscal: proximaNf(), transportadora: "TT", equipamentos: [equipamentoPadrao()]
            })).corpo;
            await Promise.all([
                amb.gestor.post(`/api/lotes/${lote.id}/triagem`, {}),
                amb.gestor.post(`/api/lotes/${lote.id}/equipamentos`, equipamentoPadrao())
            ]);
            const atual = (await amb.auditor.get(`/api/lotes/${lote.id}`)).corpo;
            if (atual.statusProcessamento !== "RECEBIDO") {
                const fora = atual.equipamentos.filter((e: any) => e.statusRastreamento === "AGUARDANDO_TRIAGEM");
                assert.deepEqual(fora.map((e: any) => e.id), [], `tentativa ${tentativa}: lote ${atual.statusProcessamento} com equipamento fora da triagem`);
            }
        }
    });

    it("inclusões simultâneas no mesmo lote recebem posições distintas", async () => {
        const lote = (await amb.gestor.post("/api/lotes", { organizacaoId: "BR001", notaFiscal: proximaNf(), transportadora: "TT" })).corpo;
        const r = await Promise.all([1, 2, 3, 4].map(() => amb.gestor.post(`/api/lotes/${lote.id}/equipamentos`, equipamentoPadrao())));
        assert.ok(r.every(x => x.status === 201 || x.status === 409), JSON.stringify(r.map(x => [x.status, x.corpo])));
        const posicoes = (await amb.auditor.get(`/api/lotes/${lote.id}`)).corpo.equipamentos.map((e: any) => e.posicaoNoLote);
        assert.deepEqual(posicoes, posicoes.map((_: number, i: number) => i + 1));
    });

    it("mesma NF enviada ao mesmo tempo: só um lote é criado", async () => {
        const numero = proximaNf();
        const r = await Promise.all([1, 2].map(() => amb.gestor.post("/api/lotes", { organizacaoId: "BR001", notaFiscal: numero, transportadora: "TT" })));
        assert.equal(r.filter(x => x.status === 201).length, 1);
        assert.ok(r.some(x => [409, 422].includes(x.status)), JSON.stringify(r.map(x => x.status)));
    });

    it("excluir o equipamento do meio renumera as posições e atualiza o peso do lote", async () => {
        const lote = (await amb.gestor.post("/api/lotes", {
            organizacaoId: "BR001", notaFiscal: proximaNf(), transportadora: "TT",
            equipamentos: [equipamentoPadrao({ pesoQuilogramas: 1 }), equipamentoPadrao({ pesoQuilogramas: 2 }), equipamentoPadrao({ pesoQuilogramas: 4 })]
        })).corpo;
        const [a, b, c] = lote.equipamentos;
        assert.equal((await amb.gestor.delete(`/api/equipamentos/${b.id}?versao=${b.versao}`)).status, 204);
        const atual = (await amb.auditor.get(`/api/lotes/${lote.id}`)).corpo;
        assert.deepEqual(atual.equipamentos.map((e: any) => [e.id, e.posicaoNoLote]), [[a.id, 1], [c.id, 2]]);
        assert.equal(atual.pesoTotalKg, 5);
        // O último equipamento não pode sair (o lote deve ter ao menos um).
        assert.equal((await amb.gestor.delete(`/api/equipamentos/${c.id}`)).status, 204);
        assert.equal((await amb.gestor.delete(`/api/equipamentos/${a.id}`)).status, 422);
    });

    it("equipamento com baixa definitiva não muda estado nem local", async () => {
        const lote = await loteTriado(1);
        const id = lote.equipamentos[0]!;
        assert.equal((await status(id, "PECAS_REAPROVEITADAS")).status, 200);
        assert.equal((await status(id, "BAIXA_DEFINITIVA")).status, 200);
        assert.equal((await amb.gestor.patch(`/api/equipamentos/${id}/estado`, { estadoFisico: "USADO_LEVE" })).status, 422);
        assert.equal((await amb.gestor.post(`/api/equipamentos/${id}/movimentacoes`, { destino: "Doca 9" })).status, 422);
        assert.equal((await status(id, "EM_DESMONTE")).status, 422);
        assert.equal((await amb.gestor.put(`/api/equipamentos/${id}`, { ...equipamentoPadrao({ tipo: undefined, estadoFisico: undefined }), versao: 99 })).status, 409);
    });

    it("busca por código de barras e por código em minúsculas", async () => {
        const { lote } = await criarOrganizacaoELote(amb, "321321321321", proximaNf());
        const e = lote.equipamentos[0];
        assert.equal((await amb.auditor.get(`/api/equipamentos/${e.codigoBarrasInterno}`)).corpo.id, e.id);
        assert.equal((await amb.auditor.get(`/api/equipamentos/${e.id.toLowerCase()}`)).corpo.id, e.id);
        assert.equal((await amb.auditor.get(`/api/lotes/${lote.id.toLowerCase()}`)).corpo.id, lote.id);
        assert.equal((await amb.auditor.get("/api/equipamentos/EQ-999999")).status, 404);
    });

    it("paginação: limites e páginas além do fim", async () => {
        assert.equal((await amb.auditor.get("/api/lotes?tamanhoPagina=101")).status, 400);
        assert.equal((await amb.auditor.get("/api/lotes?tamanhoPagina=0")).status, 400);
        assert.equal((await amb.auditor.get("/api/lotes?pagina=0")).status, 400);
        assert.equal((await amb.auditor.get("/api/lotes?pagina=abc")).status, 400);
        const longe = await amb.auditor.get("/api/lotes?pagina=1000");
        assert.equal(longe.status, 200);
        assert.deepEqual(longe.corpo.itens, []);
        assert.ok(longe.corpo.total > 0);
        const p1 = (await amb.auditor.get("/api/lotes?tamanhoPagina=2&pagina=1")).corpo;
        const p2 = (await amb.auditor.get("/api/lotes?tamanhoPagina=2&pagina=2")).corpo;
        assert.equal(p1.itens.length, 2);
        assert.notDeepEqual(p1.itens.map((l: any) => l.id), p2.itens.map((l: any) => l.id));
    });

    it("número de página enorme não causa erro interno", async () => {
        for (const url of ["/api/lotes?pagina=9007199254740991", "/api/equipamentos?pagina=999999999999999999", "/api/organizacoes?pagina=1e300"]) {
            const r = await amb.auditor.get(url);
            assert.ok(r.status < 500, `${url} → ${r.status} ${JSON.stringify(r.corpo)}`);
        }
    });

    it("valores numéricos extremos são recusados com 400, não 500", async () => {
        const lote = (await amb.gestor.post("/api/lotes", { organizacaoId: "BR001", notaFiscal: proximaNf(), transportadora: "TT" })).corpo;
        for (const extra of [{ pesoQuilogramas: 1e308 }, { pesoQuilogramas: 0.0001 }, { anoFabricacao: 2019.5 }, { marca: "x".repeat(61) }]) {
            const r = await amb.gestor.post(`/api/lotes/${lote.id}/equipamentos`, equipamentoPadrao(extra));
            assert.equal(r.status, 400, `${JSON.stringify(extra)} → ${r.status}`);
        }
        const nfs = ["0", "000", "1234567890", "-5", "1e3", " 12 "];
        for (const n of nfs) {
            const r = await amb.gestor.post("/api/lotes", { organizacaoId: "BR001", notaFiscal: n, transportadora: "TT" });
            assert.ok(r.status === 400 || (n.trim() === "12" && r.status === 201), `NF "${n}" → ${r.status}`);
        }
    });

    it("token adulterado, sem assinatura ou de usuário desativado é recusado", async () => {
        const token = amb.operador.token!;
        const [h, p] = token.split(".");
        const payload = JSON.parse(Buffer.from(p!, "base64url").toString());
        const forjado = `${h}.${Buffer.from(JSON.stringify({ ...payload, papel: "ADMINISTRADOR" })).toString("base64url")}.${token.split(".")[2]}`;
        assert.equal((await amb.api.requisitar("GET", "/api/usuarios", undefined, forjado)).status, 401);
        const semAssinatura = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString("base64url")}.${p}.`;
        assert.equal((await amb.api.requisitar("GET", "/api/organizacoes", undefined, semAssinatura)).status, 401);
        assert.equal((await amb.api.requisitar("GET", "/api/organizacoes", undefined, "lixo")).status, 401);

        const criado = await amb.admin.post("/api/usuarios", { login: "temporario", senha: "Acesso2026x", papel: "AUDITOR" });
        assert.equal(criado.status, 201);
        const temp = await amb.api.login("temporario", "Acesso2026x");
        assert.equal((await temp.get("/api/lotes")).status, 200);
        const atual = (await amb.admin.get("/api/usuarios/temporario")).corpo;
        assert.equal((await amb.admin.patch("/api/usuarios/temporario", { ativo: false, versao: atual.versao })).status, 200);
        assert.equal((await temp.get("/api/lotes")).status, 401);
    });

    it("rotas e métodos inexistentes respondem 404 no formato padrão", async () => {
        const r = await amb.auditor.get("/api/naoexiste");
        assert.equal(r.status, 404);
        assert.equal(r.corpo.erro.codigo, "ROTA_INEXISTENTE");
        assert.equal((await amb.auditor.requisitar("PATCH", "/api/lotes")).status, 404);
    });

    it("relatório de triagem e rastreamento são coerentes com o lote", async () => {
        const lote = await loteTriado(2);
        const id = lote.equipamentos[0]!;
        assert.equal((await status(id, "AGUARDANDO_DESMONTE")).status, 200);
        assert.equal((await status(id, "EM_DESMONTE")).status, 200);
        const rastreio = (await amb.auditor.get(`/api/equipamentos/${id}/rastreamento`)).corpo;
        assert.equal(rastreio.lote.id, lote.id);
        assert.equal(rastreio.organizacao.id, "BR001");
        assert.deepEqual(rastreio.movimentacoes.filter((m: any) => m.natureza === "STATUS").map((m: any) => m.destino),
            ["EM_TRIAGEM", "AGUARDANDO_DESMONTE", "EM_DESMONTE"]);
        assert.ok(rastreio.depreciacao > 0 && rastreio.depreciacao <= 1);
        assert.ok(rastreio.valorResidual >= 0);
        const ops = rastreio.auditoria.map((a: any) => a.operacao);
        assert.ok(ops.includes("LOTE_CRIAR") && ops.includes("EQUIPAMENTO_STATUS"), JSON.stringify(ops));
    });
});
