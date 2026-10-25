import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Ambiente, ClienteApi, cnpjValido, contratoPadrao, equipamentoPadrao, hojeISO, organizacaoPadrao, prepararAmbiente, SENHA_PADRAO } from "../auxiliares";

// Verificação sistemática do CRUD: para cada entidade, cadastrar → consultar → listar → alterar →
// excluir, conferindo que a listagem reflete cada mudança, que o registro excluído some (404) e
// que cada operação de escrita deixou um registro na auditoria.

describe("CRUD completo de todas as entidades", () => {
    let amb: Ambiente;
    before(async () => { amb = await prepararAmbiente(); });
    after(async () => { await amb.fechar(); });

    async function auditado(entidade: string, entidadeId: string, operacao: string): Promise<void> {
        const r = await amb.auditor.get(`/api/auditoria?entidade=${entidade}&entidadeId=${encodeURIComponent(entidadeId)}&operacao=${operacao}`);
        assert.equal(r.status, 200);
        assert.ok(r.corpo.total >= 1, `auditoria deveria registrar ${operacao} em ${entidade} ${entidadeId}`);
    }

    it("Usuário: cadastrar, consultar, listar, alterar papel, desativar, reativar, redefinir senha e excluir", async () => {
        const criado = await amb.admin.post("/api/usuarios", { login: "maria.silva", senha: SENHA_PADRAO, papel: "OPERADOR_CADASTRO" });
        assert.equal(criado.status, 201);
        await auditado("Usuario", "maria.silva", "USUARIO_CRIAR");
        assert.equal((await amb.admin.get("/api/usuarios/maria.silva")).corpo.papel, "OPERADOR_CADASTRO");
        assert.ok((await amb.admin.get("/api/usuarios")).corpo.some((u: any) => u.login === "maria.silva"));

        let v = criado.corpo.versao;
        const papel = await amb.admin.patch("/api/usuarios/maria.silva", { papel: "AUDITOR", versao: v });
        assert.equal(papel.corpo.papel, "AUDITOR");
        v = papel.corpo.versao;
        const inativo = await amb.admin.patch("/api/usuarios/maria.silva", { ativo: false, versao: v });
        assert.equal(inativo.corpo.ativo, false);
        assert.equal((await amb.admin.get("/api/usuarios?ativo=false")).corpo.length, 1);
        const ativo = await amb.admin.patch("/api/usuarios/maria.silva", { ativo: true, versao: inativo.corpo.versao });
        assert.equal(ativo.corpo.ativo, true);
        const senha = await amb.admin.put("/api/usuarios/maria.silva/senha", { senhaNova: "Renovada2027", versao: ativo.corpo.versao });
        assert.equal(senha.status, 200);
        const sessao = await amb.api.login("maria.silva", "Renovada2027");
        assert.equal((await sessao.get("/api/auth/eu")).corpo.papel, "AUDITOR");
        await auditado("Usuario", "maria.silva", "USUARIO_ALTERAR");
        await auditado("Usuario", "maria.silva", "USUARIO_SENHA_REDEFINIR");

        assert.equal((await amb.admin.delete(`/api/usuarios/maria.silva?versao=${senha.corpo.versao}`)).status, 204);
        assert.equal((await amb.admin.get("/api/usuarios/maria.silva")).status, 404);
        assert.equal((await sessao.get("/api/auth/eu")).status, 401, "conta excluída perde a sessão");
        await auditado("Usuario", "maria.silva", "USUARIO_EXCLUIR");
    });

    it("Organização: cadastrar (sem contrato), consultar, listar, alterar, corrigir CNPJ, desativar, reativar e excluir", async () => {
        const criada = await amb.operador.post("/api/organizacoes", organizacaoPadrao(cnpjValido("101010101010"), { razaoSocial: "Clínica Bem Estar", contrato: undefined }));
        assert.equal(criada.status, 201);
        const id = criada.corpo.id;
        assert.equal(criada.corpo.contrato, null);
        await auditado("Organizacao", id, "ORGANIZACAO_CRIAR");
        assert.equal((await amb.gestor.get(`/api/organizacoes/${id}`)).corpo.razaoSocial, "Clínica Bem Estar");
        assert.equal((await amb.gestor.get("/api/organizacoes?busca=bem estar")).corpo.total, 1);

        const alterada = await amb.operador.put(`/api/organizacoes/${id}`, {
            razaoSocial: "Clínica Bem Estar Ltda", cnpj: cnpjValido("202020202020"), email: "contato@bemestar.com",
            enderecoCompleto: "Rua Nova, 45, Natal/RN", telefone: "84999990000", inscricaoEstadual: "ISENTO", versao: criada.corpo.versao
        });
        assert.equal(alterada.status, 200, JSON.stringify(alterada.corpo));
        assert.equal(alterada.corpo.razaoSocial, "Clínica Bem Estar Ltda");
        assert.equal(alterada.corpo.cnpj, cnpjValido("202020202020"));
        assert.equal((await amb.gestor.get("/api/organizacoes?busca=Ltda")).corpo.itens[0].id, id, "a listagem reflete a alteração");
        await auditado("Organizacao", id, "ORGANIZACAO_ALTERAR");

        const desativada = await amb.operador.patch(`/api/organizacoes/${id}/situacao`, { ativo: false, versao: alterada.corpo.versao });
        assert.equal(desativada.corpo.ativo, false);
        const reativada = await amb.operador.patch(`/api/organizacoes/${id}/situacao`, { ativo: true, versao: desativada.corpo.versao });
        assert.equal(reativada.corpo.ativo, true);
        await auditado("Organizacao", id, "ORGANIZACAO_DESATIVAR");
        await auditado("Organizacao", id, "ORGANIZACAO_REATIVAR");

        assert.equal((await amb.operador.delete(`/api/organizacoes/${id}?versao=${reativada.corpo.versao}`)).status, 204);
        assert.equal((await amb.operador.get(`/api/organizacoes/${id}`)).status, 404);
        assert.equal((await amb.gestor.get("/api/organizacoes?busca=Bem Estar")).corpo.total, 0);
        await auditado("Organizacao", id, "ORGANIZACAO_EXCLUIR");
    });

    it("Contrato: adicionar a uma organização existente, consultar, alterar, renovar e excluir", async () => {
        const org = (await amb.operador.post("/api/organizacoes", organizacaoPadrao(cnpjValido("303030303030"), { contrato: undefined }))).corpo;
        const criado = await amb.operador.put(`/api/organizacoes/${org.id}/contrato`, contratoPadrao({ valorMensal: 999.9 }));
        assert.equal(criado.status, 201);
        await auditado("Organizacao", org.id, "CONTRATO_CRIAR");
        assert.equal((await amb.gestor.get(`/api/organizacoes/${org.id}/contrato`)).corpo.valorMensal, 999.9);

        const alterado = await amb.operador.put(`/api/organizacoes/${org.id}/contrato`,
            contratoPadrao({ valorMensal: 1999.9, clausulas: ["Coleta semanal", "Certificado de destinação", "Seguro de carga"], versao: criado.corpo.versao }));
        assert.equal(alterado.status, 200);
        assert.equal(alterado.corpo.clausulas.length, 3);
        assert.equal((await amb.gestor.get(`/api/organizacoes/${org.id}`)).corpo.contrato.valorMensal, 1999.9);
        await auditado("Organizacao", org.id, "CONTRATO_ALTERAR");

        const renovado = await amb.operador.post(`/api/organizacoes/${org.id}/contrato/renovacao`, { novoVencimento: hojeISO(1000), versao: alterado.corpo.versao });
        assert.equal(renovado.corpo.dataVencimento, hojeISO(1000));
        await auditado("Organizacao", org.id, "CONTRATO_RENOVAR");

        assert.equal((await amb.operador.delete(`/api/organizacoes/${org.id}/contrato?versao=${renovado.corpo.versao}`)).status, 204);
        assert.equal((await amb.gestor.get(`/api/organizacoes/${org.id}/contrato`)).status, 404);
        await auditado("Organizacao", org.id, "CONTRATO_EXCLUIR");
    });

    it("Lote: cadastrar (com e sem equipamentos), consultar, listar, alterar e excluir", async () => {
        const org = (await amb.operador.post("/api/organizacoes", organizacaoPadrao(cnpjValido("404040404040")))).corpo;
        const criado = await amb.gestor.post("/api/lotes", { organizacaoId: org.id, notaFiscal: "7001", transportadora: "Rodonorte", equipamentos: [equipamentoPadrao()] });
        assert.equal(criado.status, 201);
        const vazio = await amb.gestor.post("/api/lotes", { organizacaoId: org.id, notaFiscal: "7002", transportadora: "Rodonorte" });
        assert.equal(vazio.status, 201);
        assert.equal(vazio.corpo.quantidadeEquipamentos, 0);
        await auditado("Lote", criado.corpo.id, "LOTE_CRIAR");
        assert.equal((await amb.auditor.get(`/api/lotes/${criado.corpo.id}`)).corpo.equipamentos.length, 1);
        assert.equal((await amb.auditor.get(`/api/lotes?organizacaoId=${org.id}`)).corpo.total, 2);

        const alterado = await amb.gestor.put(`/api/lotes/${criado.corpo.id}`, {
            notaFiscal: "7003", transportadora: "Rodosul", observacoes: "NF corrigida", dataEntrada: hojeISO(-2), versao: criado.corpo.versao
        });
        assert.equal(alterado.status, 200);
        assert.deepEqual([alterado.corpo.notaFiscal, alterado.corpo.transportadora, alterado.corpo.dataEntrada], ["7003", "Rodosul", hojeISO(-2)]);
        assert.equal((await amb.auditor.get(`/api/lotes?organizacaoId=${org.id}&inicio=${hojeISO(-2)}&fim=${hojeISO(-2)}`)).corpo.total, 1);
        await auditado("Lote", criado.corpo.id, "LOTE_ALTERAR");

        assert.equal((await amb.gestor.delete(`/api/lotes/${criado.corpo.id}?versao=${alterado.corpo.versao}`)).status, 204);
        assert.equal((await amb.gestor.delete(`/api/lotes/${vazio.corpo.id}`)).status, 204);
        assert.equal((await amb.auditor.get(`/api/lotes/${criado.corpo.id}`)).status, 404);
        assert.equal((await amb.auditor.get(`/api/equipamentos?loteId=${criado.corpo.id}`)).corpo.total, 0, "equipamentos saem junto");
        assert.equal((await amb.auditor.get(`/api/lotes?organizacaoId=${org.id}`)).corpo.total, 0);
        await auditado("Lote", criado.corpo.id, "LOTE_EXCLUIR");
    });

    it("Equipamento: cadastrar (pelo lote e direto), consultar, listar, alterar e excluir", async () => {
        const org = (await amb.operador.post("/api/organizacoes", organizacaoPadrao(cnpjValido("505050505050")))).corpo;
        const lote = (await amb.gestor.post("/api/lotes", { organizacaoId: org.id, notaFiscal: "8001", transportadora: "TT", equipamentos: [equipamentoPadrao()] })).corpo;
        const pelaRotaDoLote = await amb.gestor.post(`/api/lotes/${lote.id}/equipamentos`, equipamentoPadrao({ tipo: "MONITOR", marca: "AOC", modelo: "22B1H" }));
        assert.equal(pelaRotaDoLote.status, 201);
        const direto = await amb.gestor.post("/api/equipamentos", { loteId: lote.id, ...equipamentoPadrao({ tipo: "ROTEADOR", marca: "TP-Link", modelo: "Archer", pesoQuilogramas: 0.4 }) });
        assert.equal(direto.status, 201, JSON.stringify(direto.corpo));
        assert.equal(direto.corpo.posicaoNoLote, 3);
        assert.match(direto.corpo.codigoBarrasInterno, /^GCROT/);
        await auditado("Equipamento", direto.corpo.id, "EQUIPAMENTO_ADICIONAR");
        assert.equal((await amb.auditor.get(`/api/equipamentos/${direto.corpo.id}`)).corpo.marca, "TP-Link");
        assert.equal((await amb.auditor.get(`/api/equipamentos?loteId=${lote.id}`)).corpo.total, 3);

        const alterado = await amb.gestor.put(`/api/equipamentos/${direto.corpo.id}`, { marca: "Intelbras", modelo: "W5", anoFabricacao: 2021, pesoQuilogramas: 0.35, versao: direto.corpo.versao });
        assert.equal(alterado.status, 200);
        assert.deepEqual([alterado.corpo.marca, alterado.corpo.anoFabricacao, alterado.corpo.pesoQuilogramas], ["Intelbras", 2021, 0.35]);
        await auditado("Equipamento", direto.corpo.id, "EQUIPAMENTO_ALTERAR");

        assert.equal((await amb.gestor.delete(`/api/equipamentos/${pelaRotaDoLote.corpo.id}?versao=${pelaRotaDoLote.corpo.versao}`)).status, 204);
        assert.equal((await amb.auditor.get(`/api/equipamentos/${pelaRotaDoLote.corpo.id}`)).status, 404);
        const posicoes = (await amb.auditor.get(`/api/lotes/${lote.id}`)).corpo.equipamentos.map((e: any) => e.posicaoNoLote);
        assert.deepEqual(posicoes, [1, 2], "posições renumeradas");
        await auditado("Equipamento", pelaRotaDoLote.corpo.id, "EQUIPAMENTO_EXCLUIR");
    });

    it("Movimentação: adicionar e consultar (histórico imutável: sem alteração nem exclusão)", async () => {
        const id = (await amb.auditor.get("/api/equipamentos?tipo=ROTEADOR")).corpo.itens[0].id;
        const m = await amb.gestor.post(`/api/equipamentos/${id}/movimentacoes`, { destino: "Prateleira R2", observacao: "conferido" });
        assert.equal(m.status, 201);
        const lista = await amb.auditor.get(`/api/equipamentos/${id}/movimentacoes`);
        assert.equal(lista.corpo.at(-1).id, m.corpo.id);
        assert.equal((await amb.gestor.put(`/api/equipamentos/${id}/movimentacoes`, {})).status, 404, "não existe rota para alterar");
        assert.equal((await amb.gestor.delete(`/api/equipamentos/${id}/movimentacoes`)).status, 404, "não existe rota para excluir");
        await auditado("Equipamento", id, "EQUIPAMENTO_MOVIMENTAR");
    });

    it("Parâmetros: adicionar, alterar e remover alíquota; alterar coeficientes, valores e retenção", async () => {
        let p = (await amb.admin.get("/api/parametros")).corpo;
        p = (await amb.admin.put("/api/parametros/aliquota/IRPJ", { valor: 0.15, versao: p.versao })).corpo;
        assert.equal(p.aliquotas.IRPJ, 0.15);
        p = (await amb.admin.put("/api/parametros/aliquota/IRPJ", { valor: 0.25, versao: p.versao })).corpo;
        assert.equal(p.aliquotas.IRPJ, 0.25);
        p = (await amb.admin.put("/api/parametros/depreciacao/NOTEBOOK", { valor: 0.3, versao: p.versao })).corpo;
        p = (await amb.admin.put("/api/parametros/valor/MONITOR", { valor: 1100, versao: p.versao })).corpo;
        p = (await amb.admin.put("/api/parametros/retencao/dias", { valor: 365, versao: p.versao })).corpo;
        assert.deepEqual([p.coeficientesDepreciacao.NOTEBOOK, p.valoresReferencia.MONITOR, p.retencaoAuditoriaDias], [0.3, 1100, 365]);
        p = (await amb.admin.delete(`/api/parametros/aliquota/IRPJ?versao=${p.versao}`)).corpo;
        assert.equal("IRPJ" in p.aliquotas, false);
        assert.equal((await amb.admin.delete("/api/parametros/aliquota/INEXISTENTE")).status, 400);
        await auditado("Parametros", "aliquota.IRPJ", "PARAMETRO_REMOVER");
    });

    it("Sessão: provisionar, entrar, renovar, consultar, trocar senha e sair", async () => {
        await amb.admin.post("/api/usuarios", { login: "carlos", senha: SENHA_PADRAO, papel: "GESTOR_ALMOXARIFADO" });
        const sessao = await amb.api.login("carlos", SENHA_PADRAO);
        const renovada = await sessao.post("/api/auth/renovar");
        assert.equal(renovada.status, 200);
        const comNova = new ClienteApi(amb.app).como(renovada.corpo.token);
        assert.equal((await comNova.get("/api/auth/eu")).corpo.login, "carlos");
        const trocada = await comNova.put("/api/auth/senha", { senhaAtual: SENHA_PADRAO, senhaNova: "Outra2027x" });
        const atual = new ClienteApi(amb.app).como(trocada.corpo.token);
        assert.equal((await atual.post("/api/auth/logout")).status, 204);
        assert.equal((await atual.get("/api/auth/eu")).status, 401);
    });
});
