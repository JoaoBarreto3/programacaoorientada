import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import CriptografiaArquivo from "../src/infra/CriptografiaArquivo";
import { escreverArquivoAtomico, limparTemporarios } from "../src/infra/EscritaAtomica";
import TravaInstancia from "../src/infra/TravaInstancia";
import Arquivos from "../src/infra/Arquivos";
import { ITERACOES_PADRAO } from "../src/dominio/Credencial";
import Sessao from "../src/dominio/Sessao";
import PapelUsuario from "../src/dominio/enums/PapelUsuario";
import FabricaCredencial from "../src/fabricas/FabricaCredencial";
import { RelogioFixo } from "../src/comum/Relogio";
import { ErroAutenticacao, ErroIntegridade, ErroPermissao, ErroSessao } from "../src/comum/erros";
import {
    SENHA_ADMIN, SENHA_PADRAO, adicionar, criarAmbiente, criarUsuario, dadosOrganizacao, diretorioTemporario, prepararLote, removerDiretorio
} from "./auxiliares";

const cripto = new CriptografiaArquivo();

test("AES-256-GCM: cifra e decifra; cada cifragem usa IV novo", () => {
    const chave = cripto.gerarChave();
    assert.equal(chave.length, 64);
    const a = cripto.cifrar("dados sigilosos", chave);
    const b = cripto.cifrar("dados sigilosos", chave);
    assert.notEqual(a, b);
    assert.ok(!a.includes("sigilosos"));
    assert.equal(cripto.decifrar(a, chave), "dados sigilosos");
});

test("AES-256-GCM: detecta adulteração e chave errada", () => {
    const chave = cripto.gerarChave();
    const cifrado = cripto.cifrar('{"valor":100}', chave);
    const bytes = Buffer.from(cifrado.slice(4), "base64");
    bytes[bytes.length - 1]! ^= 0x01;
    assert.throws(() => cripto.decifrar("GC1:" + bytes.toString("base64"), chave), ErroIntegridade);
    assert.throws(() => cripto.decifrar(cifrado, cripto.gerarChave()), ErroIntegridade);
});

test("Escrita atômica: interrupção antes do rename preserva o arquivo original", () => {
    const dir = diretorioTemporario();
    try {
        const arquivo = path.join(dir, "dados.dat");
        escreverArquivoAtomico(arquivo, "versão 1");
        assert.throws(() => escreverArquivoAtomico(arquivo, "versão 2 (incompleta)", {
            antesDeRenomear: () => { throw new Error("queda de energia simulada"); }
        }), /queda de energia/);
        assert.equal(fs.readFileSync(arquivo, "utf8"), "versão 1");
        fs.writeFileSync(`${arquivo}.999.abcd.tmp`, "lixo parcial");
        assert.deepEqual(limparTemporarios(dir), ["dados.dat.999.abcd.tmp"]);
        assert.equal(fs.readFileSync(arquivo, "utf8"), "versão 1");
        escreverArquivoAtomico(arquivo, "versão 2");
        assert.equal(fs.readFileSync(arquivo, "utf8"), "versão 2");
    } finally {
        removerDiretorio(dir);
    }
});

test("Senhas: PBKDF2-HMAC-SHA256 com salt único; hash nunca é a senha", () => {
    const a = FabricaCredencial.criar("ana", SENHA_PADRAO, PapelUsuario.AUDITOR, 1000);
    const b = FabricaCredencial.criar("bia", SENHA_PADRAO, PapelUsuario.AUDITOR, 1000);
    assert.notEqual(a.salt, b.salt);
    assert.notEqual(a.hashSenha, b.hashSenha);
    assert.match(a.hashSenha, /^pbkdf2-sha256\$1000\$[0-9a-f]{64}$/);
    assert.equal(a.verificarSenha(SENHA_PADRAO), true);
    assert.equal(a.verificarSenha("errada123"), false);
    assert.ok(ITERACOES_PADRAO >= 600_000);
});

test("Credenciais ficam em arquivo separado e todos os arquivos de dados são cifrados", () => {
    const amb = criarAmbiente();
    try {
        const conteudo = fs.readFileSync(path.join(amb.diretorio, Arquivos.CREDENCIAIS), "utf8");
        assert.match(conteudo, /^GC1:/);
        assert.ok(!conteudo.includes("admin") && !conteudo.includes(SENHA_ADMIN));
        for (const arquivo of fs.readdirSync(amb.diretorio).filter(n => n.endsWith(".dat"))) {
            assert.match(fs.readFileSync(path.join(amb.diretorio, arquivo), "utf8"), /^GC1:/, arquivo);
        }
    } finally {
        removerDiretorio(amb.diretorio);
    }
});

test("Credencial gera a Sessão; a sessão expira após 30 minutos de inatividade", () => {
    const relogio = new RelogioFixo(new Date(2026, 8, 25, 9, 0));
    const credencial = FabricaCredencial.criar("ana", SENHA_PADRAO, PapelUsuario.AUDITOR, 1000);
    const sessao = new Sessao(credencial, relogio);
    assert.equal(sessao.usuario, "ana");
    assert.equal(sessao.papel, PapelUsuario.AUDITOR);
    assert.match(sessao.token, /^[0-9a-f]{64}$/);
    relogio.avancarMinutos(29);
    assert.equal(sessao.isValida(), true);
    sessao.renovar();
    relogio.avancarMinutos(29);
    assert.equal(sessao.isValida(), true, "a atividade no minuto 29 renovou o prazo");
    relogio.avancarMinutos(2);
    assert.equal(sessao.isValida(), false);
    sessao.renovar();
    assert.equal(sessao.isValida(), false, "sessão expirada não pode ser renovada");
});

test("Serviços recusam sessão expirada, e validarToken encerra a sessão", () => {
    const amb = criarAmbiente();
    try {
        const sessao = amb.app.autenticacao.sessoesAtivas[0]!;
        amb.relogio.avancarMinutos(31);
        assert.throws(() => amb.app.organizacao.listarOrganizacoesAtivas(), ErroSessao);
        assert.equal(amb.app.autenticacao.validarToken(sessao.token), false);
        assert.equal(amb.app.autenticacao.sessoesAtivas.length, 0);
        assert.ok(amb.app.journal.listarRegistros().some(r => r.operacao === "SESSAO_EXPIRADA"));
    } finally {
        removerDiretorio(amb.diretorio);
    }
});

test("Login: senha errada é recusada e 5 falhas bloqueiam a conta por 15 minutos", () => {
    const amb = criarAmbiente();
    try {
        const auth = amb.app.autenticacao;
        auth.criarUsuario("ana", SENHA_PADRAO, PapelUsuario.AUDITOR);
        assert.throws(() => auth.login("inexistente", SENHA_PADRAO), /Usuário ou senha inválidos/);
        for (let i = 0; i < 4; i++) {
            assert.throws(() => auth.login("ana", "Errada#123"), ErroAutenticacao);
        }
        assert.throws(() => auth.login("ana", "Errada#123"), /bloqueada/);
        assert.throws(() => auth.login("ana", SENHA_PADRAO), /bloqueada/, "nem a senha certa entra durante o bloqueio");
        amb.relogio.avancarMinutos(16);
        assert.equal(auth.login("ana", SENHA_PADRAO).usuario, "ana");
    } finally {
        removerDiretorio(amb.diretorio);
    }
});

test("Segregação de papéis: cada perfil só executa o que lhe cabe", () => {
    const amb = criarAmbiente();
    try {
        const { app } = amb;
        criarUsuario(amb, "auditor", PapelUsuario.AUDITOR);
        criarUsuario(amb, "operador", PapelUsuario.OPERADOR_CADASTRO);
        criarUsuario(amb, "gestor", PapelUsuario.GESTOR_ALMOXARIFADO);
        const dados = dadosOrganizacao(amb, "45.723.174/0001-10");

        amb.entrar("auditor");
        assert.throws(() => app.organizacao.cadastrarOrganizacao(dados), ErroPermissao);
        amb.entrar("gestor");
        assert.throws(() => app.organizacao.cadastrarOrganizacao(dados), ErroPermissao);
        assert.throws(() => app.autenticacao.criarUsuario("novo", SENHA_PADRAO, PapelUsuario.AUDITOR), ErroPermissao);
        amb.entrar("operador");
        const org = app.organizacao.cadastrarOrganizacao(dados);
        assert.throws(() => app.lote.criarLote({ organizacaoId: org.id, notaFiscal: "1", transportadora: "Xpto" }), ErroPermissao);
        amb.entrar("auditor");
        assert.throws(() => app.parametros.definir("aliquota", "ISS", 0.02), ErroPermissao);
        assert.throws(() => app.auditoria.reverter("12345678"), ErroPermissao);
        assert.equal(app.organizacao.listarOrganizacoesAtivas().length, 1, "auditor consulta, mas não altera");
        assert.equal(app.auditoria.verificar().integro, true);
    } finally {
        removerDiretorio(amb.diretorio);
    }
});

test("Troca de arquivos de dados é detectada (lotes.dat copiado sobre organizacoes.dat)", () => {
    const amb = criarAmbiente();
    try {
        const { lote } = prepararLote(amb);
        adicionar(amb, lote.id);
        fs.copyFileSync(path.join(amb.diretorio, Arquivos.LOTES), path.join(amb.diretorio, Arquivos.ORGANIZACOES));
        assert.throws(() => amb.reabrir(), /organizacoes\.dat" corrompido ou adulterado/);
    } finally {
        removerDiretorio(amb.diretorio);
    }
});

test("Trava de instância: impede dois processos no mesmo diretório e remove trava órfã", () => {
    const dir = diretorioTemporario();
    try {
        fs.writeFileSync(path.join(dir, "greencode.lock"), String(process.ppid));
        assert.throws(() => TravaInstancia.adquirir(dir), /Outra instância/);
        fs.writeFileSync(path.join(dir, "greencode.lock"), "999999999");
        const trava = TravaInstancia.adquirir(dir);
        assert.equal(fs.readFileSync(path.join(dir, "greencode.lock"), "utf8"), String(process.pid));
        trava.liberar();
        assert.equal(fs.existsSync(path.join(dir, "greencode.lock")), false);
    } finally {
        removerDiretorio(dir);
    }
});
