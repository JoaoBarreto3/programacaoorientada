import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createSigner } from "fast-jwt";
import { Ambiente, ClienteApi, configuracaoTeste, prepararAmbiente, SENHA_ADMIN, SENHA_PADRAO } from "../auxiliares";

describe("Autenticação e sessão (JWT)", () => {
    let amb: Ambiente;
    before(async () => { amb = await prepararAmbiente(); });
    after(async () => { await amb.fechar(); });

    // Token assinado com a mesma chave, mas com horários controlados.
    async function tokenCom(login: string, iatRelativo: number, expRelativo: number): Promise<string> {
        const eu = await (await amb.api.login(login, login === "admin" ? SENHA_ADMIN : SENHA_PADRAO)).get("/api/auth/eu");
        const usuario = await amb.prisma.usuario.findUniqueOrThrow({ where: { login } });
        const agora = Math.floor(Date.now() / 1000);
        const assinar = createSigner({ key: configuracaoTeste().jwtSegredo, algorithm: "HS256" });
        return assinar({ sub: eu.corpo.id, login, papel: eu.corpo.papel, tv: usuario.versaoToken, iat: agora + iatRelativo, exp: agora + expRelativo });
    }

    it("o provisionamento só funciona uma vez", async () => {
        assert.deepEqual((await amb.api.get("/api/provisionamento")).corpo, { necessario: false });
        const r = await amb.api.post("/api/provisionamento", { login: "outroadmin", senha: "Outro2026x" });
        assert.equal(r.status, 422);
        assert.match(r.corpo.erro.mensagem, /já foi provisionado/);
    });

    it("login devolve token Bearer com expiração de 30 minutos", async () => {
        const r = await amb.api.post("/api/auth/login", { login: "gestor", senha: SENHA_PADRAO });
        assert.equal(r.status, 200);
        assert.equal(r.corpo.tipo, "Bearer");
        assert.equal(r.corpo.usuario.papel, "GESTOR_ALMOXARIFADO");
        const minutos = (new Date(r.corpo.expiraEm).getTime() - Date.now()) / 60_000;
        assert.ok(minutos > 29 && minutos <= 30, `expira em ${minutos} min`);
        const eu = await amb.api.como(r.corpo.token).get("/api/auth/eu");
        assert.equal(eu.corpo.login, "gestor");
        assert.ok(eu.corpo.permissoes.includes("LOTES_ESCREVER"));
    });

    it("recusa senha errada e usuário inexistente com a mesma mensagem", async () => {
        const a = await amb.api.post("/api/auth/login", { login: "gestor", senha: "errada123" });
        const b = await amb.api.post("/api/auth/login", { login: "naoexiste", senha: "errada123" });
        assert.equal(a.status, 401);
        assert.equal(b.status, 401);
        assert.equal(a.corpo.erro.mensagem, b.corpo.erro.mensagem);
    });

    it("bloqueia a conta após 5 tentativas erradas", async () => {
        await amb.admin.post("/api/usuarios", { login: "vitima", senha: SENHA_PADRAO, papel: "AUDITOR" });
        for (let i = 0; i < 4; i++) {
            assert.equal((await amb.api.post("/api/auth/login", { login: "vitima", senha: "errada123" })).status, 401);
        }
        const quinta = await amb.api.post("/api/auth/login", { login: "vitima", senha: "errada123" });
        assert.match(quinta.corpo.erro.mensagem, /bloqueada/);
        const certa = await amb.api.post("/api/auth/login", { login: "vitima", senha: SENHA_PADRAO });
        assert.equal(certa.status, 401);
        assert.match(certa.corpo.erro.mensagem, /temporariamente bloqueada/);
        // O administrador desbloqueia redefinindo a senha.
        assert.equal((await amb.admin.put("/api/usuarios/vitima/senha", { senhaNova: "NovaSenha2026" })).status, 200);
        assert.equal((await amb.api.post("/api/auth/login", { login: "vitima", senha: "NovaSenha2026" })).status, 200);
    });

    it("rejeita requisição sem token, com token adulterado e com token expirado", async () => {
        assert.equal((await amb.api.get("/api/lotes")).status, 401);
        const adulterado = amb.gestor.token!.slice(0, -2) + (amb.gestor.token!.endsWith("A") ? "BB" : "AA");
        assert.equal((await amb.api.como(adulterado).get("/api/lotes")).status, 401);
        const expirado = await tokenCom("gestor", -31 * 60, -60);
        const r = await amb.api.como(expirado).get("/api/lotes");
        assert.equal(r.status, 401);
        assert.match(r.corpo.erro.mensagem, /expirada por inatividade/);
    });

    it("renova a sessão a cada uso (expiração por inatividade)", async () => {
        const antigo = await tokenCom("auditor", -120, 28 * 60);
        const r = await amb.api.como(antigo).get("/api/auth/eu");
        assert.equal(r.status, 200);
        const novo = r.cabecalhos["x-token-renovado"];
        assert.ok(typeof novo === "string" && novo !== antigo);
        assert.equal((await amb.api.como(novo).get("/api/auth/eu")).status, 200);
        const renovado = await amb.api.como(novo).post("/api/auth/renovar");
        assert.equal(renovado.status, 200);
    });

    it("logout invalida todos os tokens já emitidos do usuário", async () => {
        const sessao = await amb.api.login("operador", SENHA_PADRAO);
        assert.equal((await sessao.get("/api/organizacoes")).status, 200);
        assert.equal((await sessao.post("/api/auth/logout")).status, 204);
        assert.equal((await sessao.get("/api/organizacoes")).status, 401);
        amb.operador = await amb.api.login("operador", SENHA_PADRAO);
    });

    it("troca de senha: exige a atual, valida a nova e derruba os tokens antigos", async () => {
        const sessao = await amb.api.login("auditor", SENHA_PADRAO);
        assert.equal((await sessao.put("/api/auth/senha", { senhaAtual: "errada", senhaNova: "Trocada2027" })).status, 401);
        assert.equal((await sessao.put("/api/auth/senha", { senhaAtual: SENHA_PADRAO, senhaNova: "fraca" })).status, 400);
        const r = await sessao.put("/api/auth/senha", { senhaAtual: SENHA_PADRAO, senhaNova: "Trocada2027" });
        assert.equal(r.status, 200);
        assert.equal((await sessao.get("/api/auth/eu")).status, 401);
        assert.equal((await new ClienteApi(amb.app).como(r.corpo.token).get("/api/auth/eu")).status, 200);
    });

    it("desativar um usuário encerra a sessão dele imediatamente", async () => {
        await amb.admin.post("/api/usuarios", { login: "temporario", senha: SENHA_PADRAO, papel: "AUDITOR" });
        const sessao = await amb.api.login("temporario", SENHA_PADRAO);
        const atual = await amb.admin.get("/api/usuarios/temporario");
        assert.equal((await amb.admin.patch("/api/usuarios/temporario", { ativo: false, versao: atual.corpo.versao })).status, 200);
        assert.equal((await sessao.get("/api/auth/eu")).status, 401);
        assert.equal((await amb.api.post("/api/auth/login", { login: "temporario", senha: SENHA_PADRAO })).status, 401);
    });
});
