import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Ambiente, prepararAmbiente } from "../auxiliares";

// A AV2 pede uma "API documentada": confere que toda rota está no OpenAPI com descrição, que as
// rotas protegidas declaram o esquema Bearer e que cada entidade tem as operações de CRUD.

const PUBLICAS = new Set(["GET /api/saude", "GET /api/provisionamento", "POST /api/provisionamento", "POST /api/auth/login"]);

describe("Documentação OpenAPI e cobertura do CRUD", () => {
    let amb: Ambiente;
    let operacoes: { chave: string; doc: any }[];
    before(async () => {
        amb = await prepararAmbiente();
        const openapi = (await amb.app.inject({ method: "GET", url: "/docs/json" })).json();
        operacoes = Object.entries(openapi.paths).flatMap(([rota, metodos]: [string, any]) =>
            Object.entries(metodos).map(([metodo, doc]) => ({ chave: `${metodo.toUpperCase()} ${rota.replace(/\/$/, "")}`, doc })));
    });
    after(async () => { await amb.fechar(); });

    it("toda rota tem resumo e grupo; as protegidas exigem token Bearer", () => {
        assert.ok(operacoes.length >= 40, `${operacoes.length} operações documentadas`);
        for (const { chave, doc } of operacoes) {
            assert.ok(doc.summary, `${chave} sem resumo`);
            assert.ok(doc.tags?.length, `${chave} sem grupo`);
            if (!PUBLICAS.has(chave)) {
                assert.deepEqual(doc.security, [{ bearerAuth: [] }], `${chave} deveria exigir token`);
            }
        }
    });

    it("cada entidade tem as operações de cadastrar, consultar, listar, alterar e excluir", () => {
        const existentes = new Set(operacoes.map(o => o.chave));
        const crud: Record<string, string[]> = {
            Usuário: ["POST /api/usuarios", "GET /api/usuarios", "GET /api/usuarios/{login}", "PATCH /api/usuarios/{login}", "PUT /api/usuarios/{login}/senha", "DELETE /api/usuarios/{login}"],
            Organização: ["POST /api/organizacoes", "GET /api/organizacoes", "GET /api/organizacoes/{id}", "PUT /api/organizacoes/{id}", "PATCH /api/organizacoes/{id}/situacao", "DELETE /api/organizacoes/{id}"],
            Contrato: ["PUT /api/organizacoes/{id}/contrato", "GET /api/organizacoes/{id}/contrato", "POST /api/organizacoes/{id}/contrato/renovacao", "DELETE /api/organizacoes/{id}/contrato"],
            Lote: ["POST /api/lotes", "GET /api/lotes", "GET /api/lotes/{id}", "PUT /api/lotes/{id}", "DELETE /api/lotes/{id}", "POST /api/lotes/{id}/triagem"],
            Equipamento: ["POST /api/equipamentos", "POST /api/lotes/{id}/equipamentos", "GET /api/equipamentos", "GET /api/equipamentos/{id}", "PUT /api/equipamentos/{id}",
                "PATCH /api/equipamentos/{id}/estado", "PATCH /api/equipamentos/{id}/status", "DELETE /api/equipamentos/{id}", "GET /api/equipamentos/{id}/rastreamento"],
            Movimentação: ["POST /api/equipamentos/{id}/movimentacoes", "GET /api/equipamentos/{id}/movimentacoes"],
            Parâmetros: ["GET /api/parametros", "PUT /api/parametros/{grupo}/{chave}", "DELETE /api/parametros/aliquota/{chave}"],
            Auditoria: ["GET /api/auditoria", "POST /api/auditoria/expurgo"]
        };
        for (const [entidade, rotas] of Object.entries(crud)) {
            for (const rota of rotas) assert.ok(existentes.has(rota), `${entidade}: falta ${rota}`);
        }
    });

    it("rotas de escrita documentam o corpo e as respostas de erro", () => {
        for (const { chave, doc } of operacoes) {
            if (/^(POST|PUT|PATCH) /.test(chave) && !chave.endsWith("/logout") && !chave.endsWith("/renovar") && !chave.endsWith("/expurgo")) {
                assert.ok(doc.requestBody, `${chave} sem corpo documentado`);
            }
            if (!PUBLICAS.has(chave)) {
                for (const status of ["401", "403"]) assert.ok(doc.responses[status], `${chave} sem resposta ${status}`);
            }
        }
    });
});
