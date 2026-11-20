import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Ambiente, ClienteApi, criarOrganizacaoELote, equipamentoPadrao, prepararAmbiente } from "../auxiliares";

const CHAVES = "/api/v1/internal/chaves-api";
const PUB = "/api/v1/public";

describe("API pública v1 (parceiros com chave de API)", () => {
    let amb: Ambiente;
    let erp: ClienteApi;          // chave do Banco (BR001): lê e grava lotes, rastreia
    let erpChave: { id: string; prefixo: string; versao: number };
    let equipamentoBR001: string;
    let equipamentoBR002: string;

    const criarChave = async (corpo: Record<string, unknown>) => {
        const r = await amb.admin.post(CHAVES, corpo);
        assert.equal(r.status, 201, JSON.stringify(r.corpo));
        return { cliente: amb.api.comChave(r.corpo.segredo), chave: r.corpo.chave, segredo: r.corpo.segredo as string };
    };

    before(async () => {
        amb = await prepararAmbiente();
        const a = await criarOrganizacaoELote(amb, "112233445566", "9001", [equipamentoPadrao(), equipamentoPadrao({ tipo: "MONITOR", marca: "LG", modelo: "24MK" })]);
        const b = await criarOrganizacaoELote(amb, "665544332211", "9002");
        equipamentoBR001 = a.lote.equipamentos[0].id;
        equipamentoBR002 = b.lote.equipamentos[0].id;
        const c = await criarChave({ nome: "ERP Banco Horizonte", escopos: ["LOTES_LER", "LOTES_ESCREVER", "RASTREABILIDADE_LER"], plano: "PROFISSIONAL", organizacaoId: "BR001" });
        erp = c.cliente;
        erpChave = c.chave;
    });
    after(async () => { await amb.fechar(); });

    it("gestão de chaves: só o administrador; segredo mostrado uma única vez; regras de escopo", async () => {
        assert.equal((await amb.auditor.get(CHAVES)).status, 403);
        assert.equal((await amb.gestor.post(CHAVES, { nome: "Parceiro X", escopos: ["LOTES_LER"] })).status, 403);
        const semOrg = await amb.admin.post(CHAVES, { nome: "Cooperativa", escopos: ["LOTES_ESCREVER"] });
        assert.equal(semOrg.status, 422, "gravar lotes exige organização");
        assert.equal((await amb.admin.post(CHAVES, { nome: "Coop", escopos: ["LOTES_LER"], organizacaoId: "BR999" })).status, 404);
        assert.equal((await amb.admin.post(CHAVES, { nome: "Coop", escopos: [] })).status, 400);
        assert.equal((await amb.admin.post(CHAVES, { nome: "Coop", escopos: ["LOTES_LER"], expiraEm: "2000-01-01T00:00:00Z" })).status, 400);
        const lista = await amb.admin.get(CHAVES);
        assert.equal(lista.status, 200);
        assert.equal(lista.corpo.length, 1);
        assert.equal(lista.corpo[0].prefixo, erpChave.prefixo);
        assert.ok(!JSON.stringify(lista.corpo).includes("segredo") && !JSON.stringify(lista.corpo).includes("hash"), "nem segredo nem hash saem na listagem");
        assert.equal((await amb.admin.get(`${CHAVES}/${erpChave.prefixo}`)).corpo.id, erpChave.id, "busca pelo prefixo");
        const catalogo = await amb.admin.get(`${CHAVES}/catalogo`);
        assert.equal(catalogo.corpo.planos.find((p: any) => p.plano === "BASICO").requisicoesPorMinuto, 60);
        const auditoria = await amb.admin.get("/api/v1/internal/auditoria?entidade=ChaveApi");
        assert.ok(auditoria.corpo.itens.some((i: any) => i.operacao === "CHAVE_API_CRIAR" && i.entidadeId === erpChave.prefixo));
    });

    it("autenticação: sem chave, chave malformada ou com segredo errado → 401", async () => {
        assert.equal((await amb.api.get(`${PUB}/eu`)).status, 401);
        const malformada = await amb.api.comChave("abc").get(`${PUB}/eu`);
        assert.equal(malformada.status, 401);
        assert.equal(malformada.corpo.erro.codigo, "CHAVE_API");
        assert.equal((await amb.api.comChave(`gc_${erpChave.prefixo}_${"A".repeat(43)}`).get(`${PUB}/eu`)).status, 401);
        // Token JWT de usuário não vale na API pública.
        assert.equal((await amb.admin.get(`${PUB}/eu`)).status, 401);
    });

    it("/eu mostra escopos e limites; respostas trazem versão e cabeçalhos de limite", async () => {
        const r = await erp.get(`${PUB}/eu`);
        assert.equal(r.status, 200);
        assert.deepEqual(r.corpo, {
            parceiro: "ERP Banco Horizonte", organizacaoId: "BR001", escopos: ["LOTES_LER", "LOTES_ESCREVER", "RASTREABILIDADE_LER"],
            plano: "PROFISSIONAL", limites: { requisicoesPorMinuto: 300, relatoriosSimultaneos: 5 }, versaoApi: "1.0.0"
        });
        assert.equal(r.cabecalhos["api-version"], "1.0.0");
        assert.equal(r.cabecalhos["x-ratelimit-limit"], "300");
        assert.ok(Number(r.cabecalhos["x-ratelimit-remaining"]) < 300);
        const chave = await amb.admin.get(`${CHAVES}/${erpChave.id}`);
        assert.ok(chave.corpo.ultimoUsoEm, "o uso da chave é registrado");
    });

    it("rastreabilidade só da própria organização, sem dados internos", async () => {
        const r = await erp.get(`${PUB}/equipamentos/${equipamentoBR001}/rastreamento`);
        assert.equal(r.status, 200, JSON.stringify(r.corpo));
        assert.equal(r.corpo.equipamento.id, equipamentoBR001);
        assert.equal(r.corpo.lote.organizacaoId, "BR001");
        assert.equal(r.corpo.movimentacoes.length, 1);
        assert.equal(r.corpo.movimentacoes[0].responsavel, undefined, "o login do funcionário não é exposto");
        assert.equal(r.corpo.equipamento.versao, undefined);
        assert.ok(r.corpo.valorResidual > 0);
        const outra = await erp.get(`${PUB}/equipamentos/${equipamentoBR002}/rastreamento`);
        assert.equal(outra.status, 404, "equipamento de outra organização é tratado como inexistente");
    });

    it("lotes: lista e consulta só os da organização; submete lote em nome dela, auditado como api:<prefixo>", async () => {
        const lista = await erp.get(`${PUB}/lotes`);
        assert.equal(lista.status, 200);
        assert.deepEqual(lista.corpo.itens.map((l: any) => l.organizacaoId), ["BR001"]);
        assert.equal(lista.corpo.itens[0].triagemIniciadaPor, undefined);
        assert.equal((await erp.get(`${PUB}/lotes/${lista.corpo.itens[0].id}`)).status, 200);
        const loteBR002 = (await amb.gestor.get("/api/v1/internal/lotes?organizacaoId=BR002")).corpo.itens[0].id;
        assert.equal((await erp.get(`${PUB}/lotes/${loteBR002}`)).status, 404);

        const novo = await erp.post(`${PUB}/lotes`, {
            notaFiscal: "9100", transportadora: "Frota Própria",
            equipamentos: [equipamentoPadrao({ marca: "Lenovo", modelo: "T14" }), equipamentoPadrao({ tipo: "IMPRESSORA", marca: "HP", modelo: "M402", pesoQuilogramas: 8.9 })]
        });
        assert.equal(novo.status, 201, JSON.stringify(novo.corpo));
        assert.equal(novo.corpo.organizacaoId, "BR001");
        assert.equal(novo.corpo.quantidadeEquipamentos, 2);
        assert.match(String(novo.cabecalhos.location), /^\/api\/v1\/public\/lotes\/LT-/);
        const responsavel = `api:${erpChave.prefixo}`;
        const aud = await amb.auditor.get(`/api/v1/internal/auditoria?entidade=Lote&entidadeId=${novo.corpo.id}`);
        assert.equal(aud.corpo.itens[0].usuario, responsavel);
        const mov = await amb.gestor.get(`/api/v1/internal/equipamentos/${novo.corpo.equipamentos[0].id}/movimentacoes`);
        assert.equal(mov.corpo[0].responsavel, responsavel);
        // Mesmas regras de negócio da API interna: nota fiscal repetida e equipamento inválido.
        assert.equal((await erp.post(`${PUB}/lotes`, { notaFiscal: "9100", transportadora: "Frota" })).status, 422);
        const invalido = await erp.post(`${PUB}/lotes`, { notaFiscal: "9101", transportadora: "Frota", equipamentos: [equipamentoPadrao({ anoFabricacao: 1950 })] });
        assert.equal(invalido.status, 400);
        // A organização não é parâmetro: um "organizacaoId" no corpo é descartado e o lote vai para a da chave.
        const tentativa = await erp.post(`${PUB}/lotes`, { notaFiscal: "9102", transportadora: "Frota", organizacaoId: "BR002" });
        assert.equal(tentativa.status, 201);
        assert.equal(tentativa.corpo.organizacaoId, "BR001");
    });

    it("escopo ausente → 403; chave global (sem organização) lê tudo mas não grava", async () => {
        assert.equal((await erp.get(`${PUB}/analises/eficiencia`)).status, 403);
        assert.equal((await erp.post(`${PUB}/relatorios`, { tipo: "RENTABILIDADE" })).status, 403);
        const { cliente: auditoria } = await criarChave({ nome: "Auditoria Ambiental", escopos: ["RASTREABILIDADE_LER", "LOTES_LER", "RELATORIOS_GERAR"] });
        assert.equal((await auditoria.get(`${PUB}/equipamentos/${equipamentoBR002}/rastreamento`)).status, 200);
        assert.equal((await auditoria.get(`${PUB}/lotes`)).corpo.total, 4);
        assert.equal((await auditoria.post(`${PUB}/lotes`, { notaFiscal: "1", transportadora: "XX" })).status, 403);
        const ef = await auditoria.get(`${PUB}/analises/eficiencia`);
        assert.equal(ef.status, 200);
        assert.equal(ef.corpo.escopo.organizacaoId, null);
        const rent = await auditoria.get(`${PUB}/analises/rentabilidade`);
        assert.equal(rent.corpo.resultado.equipamentos, 5);
        const vu = await auditoria.get(`${PUB}/analises/vida-util?limitePrevisoes=2`);
        assert.equal(vu.corpo.resultado.previsoes.length, 2);
    });

    it("analises de parceiro ficam restritas à organização da chave", async () => {
        const { cliente } = await criarChave({ nome: "BI Banco", escopos: ["RELATORIOS_GERAR"], organizacaoId: "BR001" });
        const r = await cliente.get(`${PUB}/analises/rentabilidade`);
        assert.equal(r.status, 200);
        assert.equal(r.corpo.escopo.organizacaoId, "BR001");
        assert.equal(r.corpo.resultado.equipamentos, 4, "2 do lote inicial + 2 submetidos pela API");
        const ignorado = await cliente.get(`${PUB}/analises/rentabilidade?organizacaoId=BR002`);
        assert.equal(ignorado.corpo.escopo.organizacaoId, "BR001", "o parâmetro não existe na API pública e é descartado");
    });

    it("desativar, rotacionar e revogar a chave valem na hora", async () => {
        const { cliente, chave, segredo } = await criarChave({ nome: "Parceiro Temporário", escopos: ["LOTES_LER"], organizacaoId: "BR002" });
        assert.equal((await cliente.get(`${PUB}/eu`)).status, 200);
        const desativada = await amb.admin.patch(`${CHAVES}/${chave.id}`, { ativa: false, versao: chave.versao });
        assert.equal(desativada.status, 200);
        assert.equal(desativada.corpo.situacao, "INATIVA");
        assert.match((await cliente.get(`${PUB}/eu`)).corpo.erro.mensagem, /desativada/);
        const reativada = await amb.admin.patch(`${CHAVES}/${chave.id}`, { ativa: true, plano: "CORPORATIVO", versao: desativada.corpo.versao });
        assert.equal(reativada.corpo.plano, "CORPORATIVO");
        assert.equal((await amb.admin.patch(`${CHAVES}/${chave.id}`, { ativa: true, versao: 1 })).status, 409, "versionamento otimista");

        const rot = await amb.admin.post(`${CHAVES}/${chave.id}/rotacao`, {});
        assert.equal(rot.status, 200);
        assert.notEqual(rot.corpo.segredo, segredo);
        assert.ok(rot.corpo.segredo.startsWith(`gc_${chave.prefixo}_`), "o prefixo é mantido");
        assert.equal((await cliente.get(`${PUB}/eu`)).status, 401, "o segredo antigo deixa de valer");
        const nova = amb.api.comChave(rot.corpo.segredo);
        assert.equal((await nova.get(`${PUB}/eu`)).corpo.plano, "CORPORATIVO");

        assert.equal((await amb.admin.delete(`${CHAVES}/${chave.id}`)).status, 204);
        assert.match((await nova.get(`${PUB}/eu`)).corpo.erro.mensagem, /revogada/);
        assert.equal((await amb.admin.get(`${CHAVES}/${chave.id}`)).corpo.situacao, "REVOGADA");
        assert.equal((await amb.admin.delete(`${CHAVES}/${chave.id}`)).status, 422, "revogação é definitiva");
    });

    it("chave expirada → 401", async () => {
        const { cliente, chave } = await criarChave({ nome: "Piloto", escopos: ["LOTES_LER"], expiraEm: new Date(Date.now() + 60_000).toISOString() });
        assert.equal((await cliente.get(`${PUB}/eu`)).status, 200);
        await amb.prisma.chaveApi.update({ where: { id: chave.id }, data: { expiraEm: new Date(Date.now() - 1000) } });
        assert.match((await cliente.get(`${PUB}/eu`)).corpo.erro.mensagem, /expirada/);
    });

    it("limite do plano: a 61ª requisição no minuto da chave BASICO recebe 429 com Retry-After", async () => {
        const { cliente } = await criarChave({ nome: "Plano Básico", escopos: ["LOTES_LER"], plano: "BASICO" });
        for (let i = 0; i < 60; i++) {
            assert.equal((await cliente.get(`${PUB}/eu`)).status, 200, `requisição ${i + 1}`);
        }
        const excedida = await cliente.get(`${PUB}/eu`);
        assert.equal(excedida.status, 429);
        assert.equal(excedida.corpo.erro.codigo, "LIMITE_REQUISICOES");
        assert.ok(Number(excedida.cabecalhos["retry-after"]) > 0);
        assert.equal((await erp.get(`${PUB}/eu`)).status, 200, "o limite é por chave: outro parceiro não é afetado");
    });

    it("documentação pública separada: só rotas públicas, autenticação por chave e exemplos", async () => {
        const pub = (await amb.app.inject({ method: "GET", url: `${PUB}/docs/json` })).json();
        const rotas = Object.keys(pub.paths);
        assert.equal(rotas.length, 10);
        assert.ok(rotas.every(r => r.startsWith(PUB)), rotas.join(", "));
        assert.deepEqual(Object.keys(pub.components.securitySchemes), ["chaveApi"]);
        assert.equal(pub.info.version, "1.0.0");
        for (const [rota, metodos] of Object.entries<any>(pub.paths)) {
            for (const [metodo, doc] of Object.entries<any>(metodos)) {
                assert.ok(doc.summary && doc.tags?.length, `${metodo} ${rota} sem resumo`);
                assert.deepEqual(doc.security, [{ chaveApi: [] }], `${metodo} ${rota}`);
                for (const codigo of ["401", "403", "429"]) {
                    assert.ok(doc.responses[codigo]?.description, `${metodo} ${rota} sem a resposta ${codigo} descrita`);
                }
            }
        }
        const postLote = pub.paths[`${PUB}/lotes`].post;
        assert.ok(JSON.stringify(postLote.requestBody).includes("Latitude 5490"), "o corpo traz exemplo");
        const interna = (await amb.app.inject({ method: "GET", url: "/docs/json" })).json();
        assert.ok(!Object.keys(interna.paths).some(r => r.startsWith(PUB)), "a documentação interna não mistura as rotas públicas");
        assert.equal((await amb.app.inject({ method: "GET", url: `${PUB}/docs` })).statusCode, 200, "a interface é aberta (sem chave)");
    });
});

describe("Limite de tentativas de login por IP", () => {
    let amb: Ambiente;
    // O preparo do ambiente já faz 1 provisionamento + 3 logins neste IP.
    before(async () => { amb = await prepararAmbiente(undefined, { config: { limiteLoginPorMinuto: 6 } }); });
    after(async () => { await amb.fechar(); });

    it("depois do limite, novas tentativas do mesmo IP recebem 429", async () => {
        for (let i = 0; i < 2; i++) {
            assert.equal((await amb.api.post("/api/v1/internal/auth/login", { login: "fulano", senha: "Errada123" })).status, 401);
        }
        const r = await amb.api.post("/api/v1/internal/auth/login", { login: "fulano", senha: "Errada123" });
        assert.equal(r.status, 429);
        assert.equal(r.corpo.erro.codigo, "LIMITE_REQUISICOES");
        assert.equal((await amb.admin.get("/api/v1/internal/auth/eu")).status, 200, "quem já está autenticado continua usando o sistema");
    });
});
