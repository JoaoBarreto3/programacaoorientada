import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Ambiente, cnpjValido, contratoPadrao, equipamentoPadrao, hojeISO, organizacaoPadrao, prepararAmbiente } from "../auxiliares";

describe("Organizações e contratos (CRUD)", () => {
    let amb: Ambiente;
    before(async () => { amb = await prepararAmbiente(); });
    after(async () => { await amb.fechar(); });

    it("cadastra com contrato, gera o código BRnnn e normaliza os dados", async () => {
        const r = await amb.operador.post("/api/organizacoes", organizacaoPadrao("11.222.333/0001-81", { email: " TI@Horizonte.com.br " }));
        assert.equal(r.status, 201, JSON.stringify(r.corpo));
        assert.equal(r.corpo.id, "BR001");
        assert.equal(r.cabecalhos.location, "/api/organizacoes/BR001");
        assert.equal(r.corpo.cnpj, "11222333000181");
        assert.equal(r.corpo.email, "ti@horizonte.com.br");
        assert.equal(r.corpo.telefone, "1133334444");
        assert.equal(r.corpo.inscricaoEstadual, "ISENTO");
        assert.equal(r.corpo.contrato.vigente, true);
        assert.deepEqual(r.corpo.contrato.clausulas, ["Coleta mensal", "Laudo de destinação"]);
    });

    it("recusa CNPJ inválido, CNPJ duplicado e dados incompletos", async () => {
        const invalido = await amb.operador.post("/api/organizacoes", organizacaoPadrao("11.222.333/0001-82"));
        assert.equal(invalido.status, 400);
        assert.match(invalido.corpo.erro.mensagem, /dígitos verificadores/);
        const duplicado = await amb.operador.post("/api/organizacoes", organizacaoPadrao("11222333000181"));
        assert.equal(duplicado.status, 422);
        assert.match(duplicado.corpo.erro.mensagem, /já cadastrado para BR001/);
        const semEmail = await amb.operador.post("/api/organizacoes", { cnpj: cnpjValido("123456780001"), razaoSocial: "Empresa X", enderecoCompleto: "Rua A, 100, Recife/PE" });
        assert.equal(semEmail.status, 400);
        const contratoRuim = await amb.operador.post("/api/organizacoes", organizacaoPadrao(cnpjValido("123456780001"), { contrato: contratoPadrao({ dataVencimento: hojeISO(-60) }) }));
        assert.equal(contratoRuim.status, 400);
        assert.match(contratoRuim.corpo.erro.mensagem, /posterior à de assinatura/);
    });

    it("lista com paginação e busca, e consulta por código", async () => {
        await amb.operador.post("/api/organizacoes", organizacaoPadrao(cnpjValido("222333444555"), { razaoSocial: "Hospital Vida Plena", contrato: undefined }));
        await amb.operador.post("/api/organizacoes", organizacaoPadrao(cnpjValido("333444555666"), { razaoSocial: "Universidade Federal do Norte" }));
        const pagina1 = await amb.gestor.get("/api/organizacoes?tamanhoPagina=2&pagina=1");
        assert.equal(pagina1.corpo.total, 3);
        assert.deepEqual(pagina1.corpo.itens.map((o: any) => o.id), ["BR001", "BR002"]);
        const pagina2 = await amb.gestor.get("/api/organizacoes?tamanhoPagina=2&pagina=2");
        assert.deepEqual(pagina2.corpo.itens.map((o: any) => o.id), ["BR003"]);
        const busca = await amb.gestor.get("/api/organizacoes?busca=hospital");
        assert.deepEqual(busca.corpo.itens.map((o: any) => o.razaoSocial), ["Hospital Vida Plena"]);
        assert.equal(busca.corpo.itens[0].contrato, null);
        assert.equal((await amb.gestor.get("/api/organizacoes/br001")).corpo.razaoSocial, "Banco Horizonte S.A.");
        assert.equal((await amb.gestor.get("/api/organizacoes/BR999")).status, 404);
    });

    it("altera dados cadastrais com versionamento otimista", async () => {
        const atual = (await amb.operador.get("/api/organizacoes/BR001")).corpo;
        const dados = { razaoSocial: "Banco Horizonte S/A", enderecoCompleto: "Av. Paulista, 2000, São Paulo/SP", email: "coleta@horizonte.com.br", telefone: "11999998888", inscricaoEstadual: "123.456.789.000" };
        const r = await amb.operador.put("/api/organizacoes/BR001", { ...dados, versao: atual.versao });
        assert.equal(r.status, 200);
        assert.equal(r.corpo.versao, atual.versao + 1);
        assert.equal(r.corpo.enderecoCompleto, "Av. Paulista, 2000, São Paulo/SP");
        const desatualizada = await amb.operador.put("/api/organizacoes/BR001", { ...dados, versao: atual.versao });
        assert.equal(desatualizada.status, 409);
        assert.equal(desatualizada.corpo.erro.codigo, "CONFLITO");
        assert.equal((await amb.operador.put("/api/organizacoes/BR001", { ...dados, cnpj: "x", versao: r.corpo.versao })).status, 400, "CNPJ inválido");
        // Sem lotes, o CNPJ pode ser corrigido (desde que válido e não usado por outra organização).
        const corrigido = await amb.operador.put("/api/organizacoes/BR001", { ...dados, cnpj: cnpjValido("111222333444"), versao: r.corpo.versao });
        assert.equal(corrigido.status, 200, JSON.stringify(corrigido.corpo));
        assert.equal(corrigido.corpo.cnpj, cnpjValido("111222333444"));
        const devolta = await amb.operador.put("/api/organizacoes/BR001", { ...dados, cnpj: "11.222.333/0001-81", versao: corrigido.corpo.versao });
        assert.equal(devolta.corpo.cnpj, "11222333000181");
    });

    it("contrato: cria, substitui, renova e exclui (cardinalidade 0..1)", async () => {
        assert.equal((await amb.operador.get("/api/organizacoes/BR002/contrato")).status, 404);
        const criado = await amb.operador.put("/api/organizacoes/BR002/contrato", contratoPadrao({ valorMensal: 1200.5 }));
        assert.equal(criado.status, 201);
        assert.equal(criado.corpo.valorMensal, 1200.5);
        const substituido = await amb.operador.put("/api/organizacoes/BR002/contrato", contratoPadrao({ valorMensal: 1500, renovacaoAutomatica: true, versao: criado.corpo.versao }));
        assert.equal(substituido.status, 200);
        assert.equal(substituido.corpo.renovacaoAutomatica, true);
        const renovado = await amb.operador.post("/api/organizacoes/BR002/contrato/renovacao", { novoVencimento: hojeISO(800) });
        assert.equal(renovado.status, 200);
        assert.equal(renovado.corpo.dataVencimento, hojeISO(800));
        const recuo = await amb.operador.post("/api/organizacoes/BR002/contrato/renovacao", { novoVencimento: hojeISO(10) });
        assert.equal(recuo.status, 422);
        assert.equal((await amb.operador.delete(`/api/organizacoes/BR002/contrato?versao=${renovado.corpo.versao}`)).status, 204);
        assert.equal((await amb.operador.get("/api/organizacoes/BR002")).corpo.contrato, null);
    });

    it("lote exige organização ativa e com contrato vigente", async () => {
        const semContrato = await amb.gestor.post("/api/lotes", { organizacaoId: "BR002", notaFiscal: "10", transportadora: "TT", equipamentos: [equipamentoPadrao()] });
        assert.equal(semContrato.status, 422);
        assert.match(semContrato.corpo.erro.mensagem, /contrato de coleta vigente/);
        const desativada = await amb.operador.patch("/api/organizacoes/BR003/situacao", { ativo: false });
        assert.equal(desativada.corpo.ativo, false);
        assert.equal((await amb.operador.patch("/api/organizacoes/BR003/situacao", { ativo: false })).status, 422);
        const lote = await amb.gestor.post("/api/lotes", { organizacaoId: "BR003", notaFiscal: "10", transportadora: "TT" });
        assert.equal(lote.status, 422);
        assert.match(lote.corpo.erro.mensagem, /desativada/);
        assert.equal((await amb.gestor.get("/api/organizacoes?ativo=false")).corpo.total, 1);
        assert.equal((await amb.operador.patch("/api/organizacoes/BR003/situacao", { ativo: true })).corpo.ativo, true);
    });

    it("exclui só organizações sem lotes (com lotes: desativar)", async () => {
        const lote = await amb.gestor.post("/api/lotes", { organizacaoId: "BR001", notaFiscal: "77", transportadora: "TT", equipamentos: [equipamentoPadrao()] });
        assert.equal(lote.status, 201);
        const comLote = await amb.operador.delete("/api/organizacoes/BR001");
        assert.equal(comLote.status, 422);
        assert.match(comLote.corpo.erro.mensagem, /desative-a/);
        assert.equal((await amb.operador.delete("/api/organizacoes/BR002")).status, 204);
        assert.equal((await amb.operador.get("/api/organizacoes/BR002")).status, 404);
    });
});
