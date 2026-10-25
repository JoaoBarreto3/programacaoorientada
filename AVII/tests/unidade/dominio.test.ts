import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Equipamento, { LOCAL_RECEBIMENTO } from "../../src/dominio/Equipamento";
import Lote from "../../src/dominio/Lote";
import Contrato from "../../src/dominio/Contrato";
import Usuario, { MAX_TENTATIVAS_LOGIN } from "../../src/dominio/Usuario";
import ParametrosGlobais from "../../src/dominio/ParametrosGlobais";
import EstadoFisico from "../../src/dominio/enums/EstadoFisico";
import StatusLote from "../../src/dominio/enums/StatusLote";
import StatusRastreamento from "../../src/dominio/enums/StatusRastreamento";
import TipoEquipamento from "../../src/dominio/enums/TipoEquipamento";
import PapelUsuario from "../../src/dominio/enums/PapelUsuario";
import { papelPossui } from "../../src/dominio/enums/Permissao";
import { codigoBarrasValido, gerarCodigoBarras } from "../../src/dominio/codigoBarras";
import { conferirSenha, gerarSaltEHash } from "../../src/dominio/senha";
import { ErroConflito, ErroRegraNegocio, ErroValidacao } from "../../src/comum/erros";
import { lerData } from "../../src/comum/datas";

const agora = new Date(2026, 9, 25, 10, 0);

function equipamento(id = "EQ-000001", estado: EstadoFisico = EstadoFisico.BOM_ESTADO): Equipamento {
    return new Equipamento({
        id, codigoBarrasInterno: gerarCodigoBarras(TipoEquipamento.NOTEBOOK, 1), tipo: TipoEquipamento.NOTEBOOK,
        marca: "Dell", modelo: "Latitude", anoFabricacao: 2020, estadoFisico: estado, pesoQuilogramas: 2,
        loteId: "", posicaoNoLote: 0, statusRastreamento: StatusRastreamento.AGUARDANDO_TRIAGEM, historicoMovimentacao: [], versao: 1
    });
}

function lote(...equipamentos: Equipamento[]): Lote {
    const l = new Lote({
        id: "LT-2026-0001", dataEntrada: lerData("2026-10-20"), organizacaoId: "BR001", notaFiscal: "123",
        transportadora: "TransRapida", observacoes: "", equipamentos: [], statusProcessamento: StatusLote.RECEBIDO, versao: 1
    });
    equipamentos.forEach(e => l.adicionarEquipamento(e));
    return l;
}

describe("Equipamento", () => {
    it("só aceita transições previstas na máquina de estados", () => {
        const e = equipamento();
        assert.throws(() => e.atualizarStatus(StatusRastreamento.EM_DESMONTE, "", "gestor", agora), ErroRegraNegocio);
        e.atualizarStatus(StatusRastreamento.EM_TRIAGEM, "", "gestor", agora);
        assert.equal(e.statusRastreamento, StatusRastreamento.EM_TRIAGEM);
        assert.equal(e.historicoMovimentacao.at(-1)?.natureza, "STATUS");
        assert.equal(e.historicoMovimentacao.at(-1)?.responsavel, "gestor");
    });

    it("exige justificativa quando o estado cai duas ou mais categorias", () => {
        const e = equipamento();
        e.atualizarEstadoFisico(EstadoFisico.USADO_LEVE, "", "gestor", agora); // cai 1: sem justificativa
        assert.throws(() => e.atualizarEstadoFisico(EstadoFisico.DANIFICADO_LEVE, "", "gestor", agora), ErroValidacao);
        assert.throws(() => e.atualizarEstadoFisico(EstadoFisico.DANIFICADO_LEVE, "curta", "gestor", agora), ErroValidacao);
        e.atualizarEstadoFisico(EstadoFisico.DANIFICADO_LEVE, "Tela trincada na triagem", "gestor", agora);
        e.atualizarEstadoFisico(EstadoFisico.NOVO, "", "gestor", agora); // melhora: sem justificativa
        assert.equal(e.historicoMovimentacao.length, 3);
    });

    it("registra movimentações de local, recusando nomes reservados e o local atual", () => {
        const e = equipamento();
        e.loteId = "LT-2026-0001";
        e.registrarRecebimento("Organização BR001", "gestor", agora);
        assert.equal(e.localizacaoAtual(), LOCAL_RECEBIMENTO);
        e.registrarMovimentacao("Prateleira A1", "gestor", agora);
        assert.equal(e.historicoMovimentacao.at(-1)?.origem, LOCAL_RECEBIMENTO);
        assert.throws(() => e.registrarMovimentacao("Prateleira A1", "gestor", agora), ErroRegraNegocio);
        assert.throws(() => e.registrarMovimentacao("em_desmonte", "gestor", agora), ErroValidacao);
        assert.equal(e.movimentacoesPendentes().length, 2);
        e.confirmarMovimentacoes();
        assert.equal(e.movimentacoesPendentes().length, 0);
    });

    it("calcula a depreciação por idade e estado físico", () => {
        const p = ParametrosGlobais.padrao();
        const e = equipamento("EQ-000001", EstadoFisico.NOVO);
        assert.equal(e.calcularDepreciacao(p, 2020), 0);
        assert.ok(Math.abs(e.calcularDepreciacao(p, 2022) - 0.5) < 1e-9); // 2 anos × 25%
        assert.ok(Math.abs(e.calcularDepreciacao(p, 2040) - 0.9) < 1e-9); // limite de 90% por idade
        assert.equal(e.calcularValorResidual(p, 2020), 4000);
    });

    it("valida dados descritivos", () => {
        assert.throws(() => Equipamento.validarDadosDescritivos({ marca: "D", modelo: "X", anoFabricacao: 2020, pesoQuilogramas: 1 }, 2026), /Marca/);
        assert.throws(() => Equipamento.validarDadosDescritivos({ marca: "Dell", modelo: "X", anoFabricacao: 2027, pesoQuilogramas: 1 }, 2026), /Ano/);
        assert.throws(() => Equipamento.validarDadosDescritivos({ marca: "Dell", modelo: "X", anoFabricacao: 2020, pesoQuilogramas: 0 }, 2026), /Peso/);
        assert.throws(() => Equipamento.validarDadosDescritivos({ marca: "Dell", modelo: "X", anoFabricacao: 2020, pesoQuilogramas: 1.2345 }, 2026), /três casas/);
    });
});

describe("Lote (agregado)", () => {
    it("só libera o desmonte depois da triagem completa", () => {
        const e = equipamento();
        const l = lote(e);
        assert.throws(() => l.atualizarStatusEquipamento(e, StatusRastreamento.AGUARDANDO_DESMONTE, "", "g", agora), /triagem completa/);
        assert.equal(l.avancarTriagem("g", agora), "INICIADA");
        assert.equal(e.statusRastreamento, StatusRastreamento.EM_TRIAGEM);
        assert.throws(() => l.atualizarStatusEquipamento(e, StatusRastreamento.AGUARDANDO_DESMONTE, "", "g", agora), /triagem completa/);
        assert.equal(l.avancarTriagem("g", agora), "CONCLUIDA");
        l.atualizarStatusEquipamento(e, StatusRastreamento.AGUARDANDO_DESMONTE, "", "g", agora);
        assert.equal(l.statusProcessamento, StatusLote.ENCAMINHADO);
        assert.throws(() => l.avancarTriagem("g", agora), /já foi concluída/);
    });

    it("finaliza quando todos os equipamentos recebem baixa definitiva", () => {
        const e = equipamento();
        const l = lote(e);
        l.avancarTriagem("g", agora);
        l.avancarTriagem("g", agora);
        l.atualizarStatusEquipamento(e, StatusRastreamento.DESCARTE_SEGURO, "", "g", agora);
        l.atualizarStatusEquipamento(e, StatusRastreamento.BAIXA_DEFINITIVA, "", "g", agora);
        assert.equal(l.statusProcessamento, StatusLote.FINALIZADO);
        assert.throws(() => e.registrarMovimentacao("Galpão", "g", agora), /baixa definitiva/);
    });

    it("renumera posições ao remover e não deixa o lote vazio", () => {
        const [a, b, c] = [equipamento("EQ-000001"), equipamento("EQ-000002"), equipamento("EQ-000003")];
        const l = lote(a, b, c);
        assert.deepEqual(l.removerEquipamento("EQ-000001").map(e => [e.id, e.posicaoNoLote]), [["EQ-000002", 1], ["EQ-000003", 2]]);
        l.removerEquipamento("EQ-000002");
        assert.throws(() => l.removerEquipamento("EQ-000003"), /ao menos um equipamento/);
        assert.equal(l.calcularPesoTotal(), 2);
    });

    it("não aceita equipamentos depois de iniciada a triagem", () => {
        const l = lote(equipamento("EQ-000001"));
        l.avancarTriagem("g", agora);
        assert.throws(() => l.adicionarEquipamento(equipamento("EQ-000002")), /RECEBIDOS/);
        assert.throws(() => l.exigirExcluivel(), /RECEBIDOS/);
    });
});

describe("Contrato", () => {
    const hoje = lerData("2026-10-25");
    const dados = { dataAssinatura: lerData("2026-01-01"), dataVencimento: lerData("2026-12-31"), clausulas: [" Coleta ", ""], valorMensal: 100, renovacaoAutomatica: false };
    it("valida datas, valor e cláusulas", () => {
        assert.throws(() => Contrato.criar("BR001", { ...dados, dataVencimento: lerData("2025-12-31") }), /posterior/);
        assert.throws(() => Contrato.criar("BR001", { ...dados, clausulas: [" "] }), /cláusula/);
        assert.throws(() => Contrato.criar("BR001", { ...dados, valorMensal: 10.005 }), /duas casas/);
        assert.deepEqual(Contrato.criar("BR001", dados).clausulas, ["Coleta"]);
    });
    it("vigência e renovação", () => {
        const c = Contrato.criar("BR001", dados);
        assert.ok(c.estaVigente(hoje));
        assert.equal(c.estaVigente(lerData("2027-01-01")), false);
        assert.throws(() => c.renovar(lerData("2026-06-01"), hoje), /posterior ao atual/);
        c.renovar(lerData("2027-12-31"), hoje);
        assert.ok(c.estaVigente(lerData("2027-06-01")));
    });
});

describe("Usuário, senha e permissões", () => {
    it("hash PBKDF2-SHA256 com salt: confere a senha certa e recusa a errada", async () => {
        const { salt, hashSenha } = await gerarSaltEHash("Segura2026", 1000);
        assert.match(hashSenha, /^pbkdf2-sha256\$1000\$[0-9a-f]{64}$/);
        assert.ok(await conferirSenha("Segura2026", salt, hashSenha));
        assert.equal(await conferirSenha("segura2026", salt, hashSenha), false);
    });

    it("bloqueia após 5 falhas e invalida tokens ao desativar", () => {
        const u = new Usuario({
            id: "1", login: "maria", hashSenha: "", salt: "", papel: PapelUsuario.AUDITOR, ativo: true, ultimoAcesso: null,
            tentativasFalhas: 0, bloqueadoAte: null, versaoToken: 0, criadoEm: agora, versao: 1
        });
        for (let i = 1; i < MAX_TENTATIVAS_LOGIN; i++) assert.equal(u.registrarFalhaLogin(agora), false);
        assert.equal(u.registrarFalhaLogin(agora), true);
        assert.ok(u.estaBloqueado(agora));
        u.desativar();
        assert.equal(u.versaoToken, 1);
    });

    it("versionamento otimista recusa versão desatualizada", () => {
        const p = ParametrosGlobais.padrao();
        p.verificarVersao(1);
        p.verificarVersao(undefined);
        assert.throws(() => p.verificarVersao(2), ErroConflito);
    });

    it("matriz de permissões segue a segregação de funções", () => {
        assert.ok(papelPossui(PapelUsuario.ADMINISTRADOR, "USUARIOS_GERENCIAR"));
        assert.ok(papelPossui(PapelUsuario.OPERADOR_CADASTRO, "ORGANIZACOES_ESCREVER"));
        assert.equal(papelPossui(PapelUsuario.OPERADOR_CADASTRO, "LOTES_ESCREVER"), false);
        assert.ok(papelPossui(PapelUsuario.GESTOR_ALMOXARIFADO, "EQUIPAMENTOS_ESCREVER"));
        assert.equal(papelPossui(PapelUsuario.AUDITOR, "ORGANIZACOES_ESCREVER"), false);
        assert.ok(papelPossui(PapelUsuario.AUDITOR, "RELATORIOS_GERAR"));
    });

    it("código de barras com dígito verificador", () => {
        const codigo = gerarCodigoBarras(TipoEquipamento.MONITOR, 42);
        assert.match(codigo, /^GCMON0000042\d$/);
        assert.ok(codigoBarrasValido(codigo));
        assert.equal(codigoBarrasValido(codigo.slice(0, -1) + ((Number(codigo.at(-1)) + 1) % 10)), false);
    });
});
