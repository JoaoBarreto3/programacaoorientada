import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Ambiente, ClienteApi, cnpjValido, contratoPadrao, equipamentoPadrao, prepararAmbiente } from "../auxiliares";

// Entradas maliciosas em TODOS os campos de texto livre e em todos os filtros de busca. Regra: o
// conteúdo é guardado e devolvido exatamente como dado (nunca executado como SQL, template ou script),
// ou recusado com 400 quando não é aceitável; nunca erro 500, nunca efeito colateral no banco.

const INT = "/api/v1/internal";
const PUB = "/api/v1/public";

// Cargas clássicas: injeção de SQL (inclusive com atraso), templates, XSS, travessia de caminho,
// comandos de shell, Unicode problemático e "operadores" de banco NoSQL como texto.
const MALICIOSOS = [
    "'; DROP TABLE lotes; --",
    "' OR '1'='1",
    "\" OR 1=1 --",
    "1' AND pg_sleep(3)--",
    "'); DELETE FROM usuarios; --",
    "${7*7} {{7*7}} #{7*7}",
    "<script>window.__xss=1</script>",
    "<img src=x onerror=window.__xss=1>",
    "../../../etc/passwd",
    "$(rm -rf /) `id` | cat /etc/shadow",
    "‮gnp.exe ✓ 🔥 ñ ç",
    "{\"$gt\": \"\"}"
];

describe("Segurança: entradas maliciosas são dados, nunca código", () => {
    let amb: Ambiente;
    let parceiro: ClienteApi;
    const criadosPor = { organizacoes: 1, lotes: 1 };

    before(async () => {
        amb = await prepararAmbiente();
        const org = await amb.operador.post(`${INT}/organizacoes`, {
            razaoSocial: "Base Ltda", cnpj: cnpjValido("101010101010"), email: "ti@base.com.br",
            enderecoCompleto: "Rua Base, 100, São Paulo/SP", contrato: contratoPadrao()
        });
        assert.equal(org.status, 201);
        const lote = await amb.gestor.post(`${INT}/lotes`, { organizacaoId: "BR001", notaFiscal: "1", transportadora: "Base", equipamentos: [equipamentoPadrao()] });
        assert.equal(lote.status, 201);
        const chave = await amb.admin.post(`${INT}/chaves-api`, { nome: "Segurança", escopos: ["LOTES_LER", "LOTES_ESCREVER", "RASTREABILIDADE_LER", "RELATORIOS_GERAR"], plano: "CORPORATIVO", organizacaoId: "BR001" });
        parceiro = amb.api.comChave(chave.corpo.segredo);
    });
    after(async () => { await amb.fechar(); });

    it("campos de texto livre guardam a carga maliciosa literalmente (sem executar nada)", async () => {
        let n = 0;
        for (const carga of MALICIOSOS) {
            n++;
            // Organização (razão social, endereço, cláusulas do contrato).
            const org = await amb.operador.post(`${INT}/organizacoes`, {
                razaoSocial: `Org ${carga}`, cnpj: cnpjValido(String(200000000000 + n)), email: `ti${n}@org.com.br`,
                enderecoCompleto: `Rua ${carga}, 1`, contrato: contratoPadrao({ clausulas: [carga] })
            });
            assert.equal(org.status, 201, `${carga}: ${JSON.stringify(org.corpo)}`);
            criadosPor.organizacoes++;
            const lidaOrg = await amb.operador.get(`${INT}/organizacoes/${org.corpo.id}`);
            assert.equal(lidaOrg.corpo.razaoSocial, `Org ${carga}`);
            assert.equal(lidaOrg.corpo.enderecoCompleto, `Rua ${carga}, 1`);
            assert.deepEqual(lidaOrg.corpo.contrato.clausulas, [carga]);

            // Lote e equipamento (transportadora, observações, marca, modelo) pela API interna e pela pública.
            const marca = carga.slice(0, 60);
            const lote = await amb.gestor.post(`${INT}/lotes`, {
                organizacaoId: org.corpo.id, notaFiscal: String(100 + n), transportadora: `T ${carga}`.slice(0, 100), observacoes: carga,
                equipamentos: [equipamentoPadrao({ marca: marca.length >= 2 ? marca : `${marca}!`, modelo: carga.slice(0, 80) })]
            });
            assert.equal(lote.status, 201, `${carga}: ${JSON.stringify(lote.corpo)}`);
            criadosPor.lotes++;
            const lido = await amb.gestor.get(`${INT}/lotes/${lote.corpo.id}`);
            assert.equal(lido.corpo.observacoes, carga);
            assert.equal(lido.corpo.equipamentos[0].modelo, carga.slice(0, 80));
            const viaParceiro = await parceiro.post(`${PUB}/lotes`, { notaFiscal: String(500 + n), transportadora: `P ${carga}`.slice(0, 100), observacoes: carga });
            assert.equal(viaParceiro.status, 201);
            assert.equal(viaParceiro.corpo.observacoes, carga);
            criadosPor.lotes++;

            // Movimentação (destino e observação) e justificativa de estado físico.
            const equipamento = lido.corpo.equipamentos[0].id;
            const mov = await amb.gestor.post(`${INT}/equipamentos/${equipamento}/movimentacoes`, { destino: `Galpão ${carga}`.slice(0, 120), observacao: carga });
            assert.equal(mov.status, 201, `${carga}: ${JSON.stringify(mov.corpo)}`);
            assert.equal(mov.corpo.observacao, carga);
            const estado = await amb.gestor.patch(`${INT}/equipamentos/${equipamento}/estado`, { estadoFisico: "INSERVIVEL", justificativa: `Avaria ${carga}` });
            assert.equal(estado.status, 200);

            // Nome do parceiro na chave de API.
            const chave = await amb.admin.post(`${INT}/chaves-api`, { nome: `Parceiro ${carga}`.slice(0, 100), escopos: ["LOTES_LER"] });
            assert.equal(chave.status, 201);
            assert.equal(chave.corpo.chave.nome, `Parceiro ${carga}`.slice(0, 100));
        }
    });

    it("o banco segue íntegro: nenhuma tabela apagada, nenhum registro a mais ou a menos", async () => {
        const [organizacoes, lotes, usuarios] = await Promise.all([
            amb.prisma.organizacao.count(), amb.prisma.lote.count(), amb.prisma.usuario.count()
        ]);
        assert.deepEqual({ organizacoes, lotes, usuarios }, { organizacoes: criadosPor.organizacoes, lotes: criadosPor.lotes, usuarios: 4 });
    });

    it("filtros de busca tratam a carga como texto: sem erro, sem vazamento de outros registros, sem atraso", async () => {
        const filtros = [
            `${INT}/organizacoes?busca=`, `${INT}/auditoria?operacao=`, `${INT}/auditoria?usuario=`, `${INT}/auditoria?entidade=`,
            `${INT}/auditoria?entidadeId=`, `${INT}/lotes?organizacaoId=`, `${INT}/equipamentos?loteId=`, `${INT}/equipamentos?organizacaoId=`,
            `${INT}/analises/eficiencia?organizacaoId=`, `${INT}/analises/rentabilidade/estimativa?tipo=NOTEBOOK&marca=`,
            `${INT}/analises/execucoes?organizacaoId=`, `${INT}/chaves-api?organizacaoId=`
        ];
        for (const filtro of filtros) {
            for (const carga of MALICIOSOS) {
                const inicio = Date.now();
                const r = await amb.admin.get(filtro + encodeURIComponent(carga.slice(0, 30)));
                assert.ok(r.status < 500, `${filtro}${carga} → ${r.status}: ${JSON.stringify(r.corpo).slice(0, 200)}`);
                assert.ok(Date.now() - inicio < 2000, `${filtro}${carga}: ${Date.now() - inicio} ms (pg_sleep executado?)`);
                if (r.status === 200 && carga.includes("OR")) {
                    // "' OR '1'='1" não pode virar "traga tudo": só vêm registros que contêm o texto literal.
                    if (filtro.includes("?busca=")) {
                        const termo = carga.slice(0, 30);
                        assert.ok(r.corpo.itens.every((o: any) => o.razaoSocial.includes(termo)), `${filtro}${carga} trouxe registros sem o texto`);
                        assert.ok(r.corpo.total < criadosPor.organizacoes, "não trouxe todos");
                    }
                    if (filtro.includes("loteId=")) assert.equal(r.corpo.total, 0, `${filtro}${carga}`);
                }
            }
        }
    });

    it("login e autenticação com cargas maliciosas: 401, nunca acesso", async () => {
        for (const carga of MALICIOSOS) {
            const r = await amb.api.post(`${INT}/auth/login`, { login: carga, senha: carga });
            assert.equal(r.status, 401, carga);
            assert.equal((await amb.api.comChave(carga).get(`${PUB}/eu`)).status, 401);
            assert.equal((await amb.api.como(carga).get(`${INT}/auth/eu`)).status, 401);
        }
        // JWT forjado com algoritmo "none" (sem assinatura).
        const cabecalho = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
        const conteudo = Buffer.from(JSON.stringify({ sub: "x", login: "admin", papel: "ADMINISTRADOR", tv: 0 })).toString("base64url");
        assert.equal((await amb.api.como(`${cabecalho}.${conteudo}.`).get(`${INT}/usuarios`)).status, 401);
    });

    it("caractere nulo (U+0000) é recusado com 400 em corpo, filtro e caminho, sem chegar ao banco", async () => {
        const nulo = "a\u0000b";
        const respostas = await Promise.all([
            amb.gestor.post(`${INT}/lotes`, { organizacaoId: "BR001", notaFiscal: "9999", transportadora: nulo }),
            amb.operador.get(`${INT}/organizacoes?busca=${encodeURIComponent(nulo)}`),
            amb.gestor.get(`${INT}/lotes/${encodeURIComponent(nulo)}`),
            parceiro.post(`${PUB}/lotes`, { notaFiscal: "9998", transportadora: "Frota", observacoes: nulo }),
            amb.api.post(`${INT}/auth/login`, { login: nulo, senha: "x" })
        ]);
        for (const r of respostas) {
            assert.equal(r.status, 400, JSON.stringify(r.corpo));
            assert.match(r.corpo.erro.mensagem, /caractere nulo/);
        }
    });

    it("poluição de protótipo e tipos trocados são recusados", async () => {
        const proto = await amb.app.inject({
            method: "POST", url: `${INT}/lotes`, headers: { authorization: `Bearer ${amb.gestor.token}`, "content-type": "application/json" },
            payload: '{"organizacaoId":"BR001","notaFiscal":"77","transportadora":"X","__proto__":{"admin":true}}'
        });
        assert.equal(proto.statusCode, 400);
        assert.equal(({} as Record<string, unknown>).admin, undefined, "Object.prototype intacto");
        const objetoNoLugarDeTexto = await amb.gestor.post(`${INT}/lotes`, { organizacaoId: { $ne: null }, notaFiscal: "78", transportadora: "X" });
        assert.equal(objetoNoLugarDeTexto.status, 400);
        const loginObjeto = await amb.api.post(`${INT}/auth/login`, { login: { $gt: "" }, senha: { $gt: "" } });
        assert.equal(loginObjeto.status, 400);
    });

    it("corpo acima de 1 MB → 413; texto acima do limite do campo → 400", async () => {
        const enorme = await amb.app.inject({
            method: "POST", url: `${INT}/lotes`, headers: { authorization: `Bearer ${amb.gestor.token}`, "content-type": "application/json" },
            payload: JSON.stringify({ organizacaoId: "BR001", notaFiscal: "79", transportadora: "X", observacoes: "x".repeat(1_100_000) })
        });
        assert.equal(enorme.statusCode, 413);
        const longo = await amb.gestor.post(`${INT}/lotes`, { organizacaoId: "BR001", notaFiscal: "80", transportadora: "X", observacoes: "x".repeat(1001) });
        assert.equal(longo.status, 400);
    });

    it("cabeçalhos de segurança: CSP rígida na página, CSP restritiva na API", async () => {
        const [pagina, api, script, cache] = await Promise.all([
            amb.app.inject({ url: "/" }), amb.app.inject({ url: "/api/saude" }), amb.app.inject({ url: "/app.js" }),
            amb.app.inject({ url: "/" }).then(r => amb.app.inject({ url: "/", headers: { "if-none-match": String(r.headers.etag) } }))
        ]);
        // Página servida do cache (304) e arquivos estáticos recebem a política da página, não a da API:
        // senão o navegador bloquearia o próprio app.js ao recarregar.
        assert.equal(cache.statusCode, 304);
        assert.equal(cache.headers["content-security-policy"], pagina.headers["content-security-policy"]);
        assert.equal(script.headers["content-security-policy"], pagina.headers["content-security-policy"]);
        const csp = String(pagina.headers["content-security-policy"]);
        assert.match(csp, /script-src 'self'(;|$)/, "só scripts do próprio site, nada embutido");
        assert.match(csp, /object-src 'none'/);
        assert.match(csp, /frame-ancestors 'none'/);
        assert.equal(api.headers["content-security-policy"], "default-src 'none'; frame-ancestors 'none'");
        for (const h of ["x-content-type-options", "x-frame-options", "referrer-policy"]) assert.ok(pagina.headers[h], h);
    });
});
