import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Ambiente, prepararAmbiente } from "../auxiliares";

// A AV2 pede uma "API documentada": confere que toda rota está no OpenAPI com descrição, que as
// rotas protegidas declaram o esquema Bearer e que cada entidade tem as operações de CRUD.
// Na AV3, /docs documenta a API interna; a pública tem documentação própria (ver api-publica.test).

const PUBLICAS = new Set(["GET /api/saude", "GET /api/v1/internal/provisionamento", "POST /api/v1/internal/provisionamento", "POST /api/v1/internal/auth/login"]);

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
        assert.ok(operacoes.length >= 60, `${operacoes.length} operações documentadas`);
        assert.ok(operacoes.every(o => !o.chave.includes("/api/v1/public")), "rotas públicas ficam na documentação pública");
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
            Usuário: ["POST /api/v1/internal/usuarios", "GET /api/v1/internal/usuarios", "GET /api/v1/internal/usuarios/{login}", "PATCH /api/v1/internal/usuarios/{login}", "PUT /api/v1/internal/usuarios/{login}/senha", "DELETE /api/v1/internal/usuarios/{login}"],
            Organização: ["POST /api/v1/internal/organizacoes", "GET /api/v1/internal/organizacoes", "GET /api/v1/internal/organizacoes/{id}", "PUT /api/v1/internal/organizacoes/{id}", "PATCH /api/v1/internal/organizacoes/{id}/situacao", "DELETE /api/v1/internal/organizacoes/{id}"],
            Contrato: ["PUT /api/v1/internal/organizacoes/{id}/contrato", "GET /api/v1/internal/organizacoes/{id}/contrato", "POST /api/v1/internal/organizacoes/{id}/contrato/renovacao", "DELETE /api/v1/internal/organizacoes/{id}/contrato"],
            Lote: ["POST /api/v1/internal/lotes", "GET /api/v1/internal/lotes", "GET /api/v1/internal/lotes/{id}", "PUT /api/v1/internal/lotes/{id}", "DELETE /api/v1/internal/lotes/{id}", "POST /api/v1/internal/lotes/{id}/triagem"],
            Equipamento: ["POST /api/v1/internal/equipamentos", "POST /api/v1/internal/lotes/{id}/equipamentos", "GET /api/v1/internal/equipamentos", "GET /api/v1/internal/equipamentos/{id}", "PUT /api/v1/internal/equipamentos/{id}",
                "PATCH /api/v1/internal/equipamentos/{id}/estado", "PATCH /api/v1/internal/equipamentos/{id}/status", "DELETE /api/v1/internal/equipamentos/{id}", "GET /api/v1/internal/equipamentos/{id}/rastreamento"],
            Movimentação: ["POST /api/v1/internal/equipamentos/{id}/movimentacoes", "GET /api/v1/internal/equipamentos/{id}/movimentacoes"],
            Parâmetros: ["GET /api/v1/internal/parametros", "PUT /api/v1/internal/parametros/{grupo}/{chave}", "DELETE /api/v1/internal/parametros/aliquota/{chave}"],
            Auditoria: ["GET /api/v1/internal/auditoria", "POST /api/v1/internal/auditoria/expurgo"],
            // AV3
            "Chave de API": ["POST /api/v1/internal/chaves-api", "GET /api/v1/internal/chaves-api", "GET /api/v1/internal/chaves-api/{id}",
                "PATCH /api/v1/internal/chaves-api/{id}", "POST /api/v1/internal/chaves-api/{id}/rotacao", "DELETE /api/v1/internal/chaves-api/{id}"],
            Análises: ["GET /api/v1/internal/analises/eficiencia", "GET /api/v1/internal/analises/rentabilidade", "GET /api/v1/internal/analises/vida-util",
                "GET /api/v1/internal/analises/vida-util/aderencia", "POST /api/v1/internal/analises/execucoes", "GET /api/v1/internal/analises/execucoes",
                "GET /api/v1/internal/analises/execucoes/{id}"],
            "Relatório assíncrono": ["POST /api/v1/internal/relatorios/tarefas", "GET /api/v1/internal/relatorios/tarefas",
                "GET /api/v1/internal/relatorios/tarefas/{id}", "GET /api/v1/internal/relatorios/tarefas/{id}/arquivo"]
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
