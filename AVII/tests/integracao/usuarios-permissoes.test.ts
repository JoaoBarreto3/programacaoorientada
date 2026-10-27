import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Ambiente, cnpjValido, organizacaoPadrao, prepararAmbiente, SENHA_PADRAO } from "../auxiliares";

describe("Usuários (CRUD) e segregação de funções", () => {
    let amb: Ambiente;
    before(async () => { amb = await prepararAmbiente(); });
    after(async () => { await amb.fechar(); });

    it("CRUD completo de usuários pelo administrador", async () => {
        const criado = await amb.admin.post("/api/usuarios", { login: "joana", senha: SENHA_PADRAO, papel: "AUDITOR" });
        assert.equal(criado.status, 201);
        assert.equal(criado.cabecalhos.location, "/api/usuarios/joana");
        assert.equal(criado.corpo.versao, 1);
        assert.equal("hashSenha" in criado.corpo, false, "o hash da senha nunca sai na API");

        assert.equal((await amb.admin.post("/api/usuarios", { login: "joana", senha: SENHA_PADRAO, papel: "AUDITOR" })).status, 422);
        assert.equal((await amb.admin.post("/api/usuarios", { login: "Joana!", senha: SENHA_PADRAO, papel: "AUDITOR" })).status, 400);
        assert.equal((await amb.admin.post("/api/usuarios", { login: "pedro", senha: "123", papel: "AUDITOR" })).status, 400);
        assert.equal((await amb.admin.post("/api/usuarios", { login: "pedro", senha: SENHA_PADRAO, papel: "CHEFE" })).status, 400);

        const lista = await amb.admin.get("/api/usuarios?papel=AUDITOR");
        assert.deepEqual(lista.corpo.map((u: any) => u.login).sort(), ["auditor", "joana"]);

        const alterado = await amb.admin.patch("/api/usuarios/joana", { papel: "GESTOR_ALMOXARIFADO", versao: 1 });
        assert.equal(alterado.status, 200);
        assert.equal(alterado.corpo.papel, "GESTOR_ALMOXARIFADO");
        assert.equal(alterado.corpo.versao, 2);
        assert.equal((await amb.admin.patch("/api/usuarios/joana", { papel: "AUDITOR", versao: 1 })).status, 409);

        assert.equal((await amb.admin.delete("/api/usuarios/joana?versao=1")).status, 409);
        assert.equal((await amb.admin.delete("/api/usuarios/joana?versao=2")).status, 204);
        assert.equal((await amb.admin.get("/api/usuarios/joana")).status, 404);
    });

    it("renomeia o login sem derrubar a sessão nem perder a senha", async () => {
        await amb.admin.post("/api/usuarios", { login: "carla", senha: SENHA_PADRAO, papel: "AUDITOR" });
        const carla = await amb.api.login("carla", SENHA_PADRAO);

        assert.equal((await amb.admin.patch("/api/usuarios/carla", { login: "Carla!", versao: 1 })).status, 400);
        assert.equal((await amb.admin.patch("/api/usuarios/carla", { login: "auditor", versao: 1 })).status, 422);

        const renomeado = await amb.admin.patch("/api/usuarios/carla", { login: "carla.souza", versao: 1 });
        assert.equal(renomeado.status, 200);
        assert.equal(renomeado.corpo.login, "carla.souza");
        assert.equal(renomeado.corpo.versao, 2);
        assert.equal((await amb.admin.get("/api/usuarios/carla")).status, 404);
        assert.equal((await amb.admin.get("/api/usuarios/carla.souza")).status, 200);

        assert.equal((await carla.get("/api/auth/eu")).corpo.login, "carla.souza", "a sessão aberta continua valendo");
        assert.equal((await amb.api.post("/api/auth/login", { login: "carla", senha: SENHA_PADRAO })).status, 401);
        assert.equal((await amb.api.post("/api/auth/login", { login: "carla.souza", senha: SENHA_PADRAO })).status, 200);
        assert.equal((await amb.admin.delete("/api/usuarios/carla.souza?versao=2")).status, 204);
    });

    it("protege o último administrador e a própria conta", async () => {
        assert.equal((await amb.admin.delete("/api/usuarios/admin")).status, 422);
        assert.equal((await amb.admin.patch("/api/usuarios/admin", { ativo: false, versao: 1 })).status, 422);
        await amb.admin.post("/api/usuarios", { login: "admin2", senha: SENHA_PADRAO, papel: "ADMINISTRADOR" });
        const admin2 = await amb.api.login("admin2", SENHA_PADRAO);
        const atual = await admin2.get("/api/usuarios/admin");
        // Com outro administrador ativo, o admin2 pode rebaixar o admin original...
        assert.equal((await admin2.patch("/api/usuarios/admin", { papel: "AUDITOR", versao: atual.corpo.versao })).status, 200);
        // ...mas agora o admin2 é o último e não pode ser rebaixado por ninguém.
        const a2 = await admin2.get("/api/usuarios/admin2");
        assert.equal((await admin2.patch("/api/usuarios/admin2", { papel: "AUDITOR", versao: a2.corpo.versao })).status, 422);
    });

    it("cada papel acessa apenas o que lhe cabe (HTTP 403 no restante)", async () => {
        const org = organizacaoPadrao(cnpjValido("998877665544"));
        const casos: [string, () => Promise<{ status: number }>, number][] = [
            ["operador cria organização", () => amb.operador.post("/api/organizacoes", org), 201],
            ["auditor não cria organização", () => amb.auditor.post("/api/organizacoes", organizacaoPadrao(cnpjValido("112233445566"))), 403],
            ["gestor não cria organização", () => amb.gestor.post("/api/organizacoes", organizacaoPadrao(cnpjValido("112233445566"))), 403],
            ["gestor consulta organizações", () => amb.gestor.get("/api/organizacoes"), 200],
            ["operador não registra lote", () => amb.operador.post("/api/lotes", { organizacaoId: "BR001", notaFiscal: "1", transportadora: "TT" }), 403],
            ["auditor não registra lote", () => amb.auditor.post("/api/lotes", { organizacaoId: "BR001", notaFiscal: "1", transportadora: "TT" }), 403],
            ["operador não vê lotes", () => amb.operador.get("/api/lotes"), 403],
            ["gestor não gerencia usuários", () => amb.gestor.get("/api/usuarios"), 403],
            ["auditor não gerencia usuários", () => amb.auditor.post("/api/usuarios", { login: "x1x", senha: SENHA_PADRAO, papel: "AUDITOR" }), 403],
            ["auditor lê parâmetros", () => amb.auditor.get("/api/parametros"), 200],
            ["auditor não altera parâmetros", () => amb.auditor.put("/api/parametros/aliquota/ISS", { valor: 0.03 }), 403],
            ["gestor não gera relatórios", () => amb.gestor.get("/api/relatorios/financeiro"), 403],
            ["auditor gera relatórios", () => amb.auditor.get("/api/relatorios/financeiro"), 200],
            ["auditor lê auditoria", () => amb.auditor.get("/api/auditoria"), 200],
            ["auditor não expurga auditoria", () => amb.auditor.post("/api/auditoria/expurgo"), 403],
            ["operador não lê auditoria", () => amb.operador.get("/api/auditoria"), 403],
            ["todos veem o painel", () => amb.operador.get("/api/relatorios/painel"), 200]
        ];
        for (const [descricao, chamar, esperado] of casos) {
            assert.equal((await chamar()).status, esperado, descricao);
        }
    });
});
