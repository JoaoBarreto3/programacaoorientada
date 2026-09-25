import { test } from "node:test";
import * as assert from "node:assert/strict";
import EstadoFisico from "../src/dominio/enums/EstadoFisico";
import StatusRastreamento from "../src/dominio/enums/StatusRastreamento";
import StatusLote from "../src/dominio/enums/StatusLote";
import PapelUsuario from "../src/dominio/enums/PapelUsuario";
import { codigoBarrasValido } from "../src/servicos/ServicoEquipamento";
import { localizacaoAtual, naturezaMovimentacao } from "../src/dominio/rastreamento";
import { ErroPermissao, ErroRegraNegocio, ErroValidacao } from "../src/comum/erros";
import { adicionarDias } from "../src/comum/datas";
import { adicionar, criarAmbiente, criarUsuario, dadosOrganizacao, notebook, prepararLote, removerDiretorio } from "./auxiliares";

function lote(amb: ReturnType<typeof criarAmbiente>, id: string) {
    return amb.app.lote.consultarLotePorPeriodo(new Date(2000, 0, 1), amb.relogio.agora()).find(l => l.id === id)!;
}

test("Organização é cadastrada junto com o contrato (objeto composto) e o CNPJ é único", () => {
    const amb = criarAmbiente();
    try {
        const { org } = prepararLote(amb);
        assert.equal(org.id, "BR001");
        assert.equal(org.contratoVigente.id, "CT-BR001");
        assert.equal(amb.app.organizacao.buscarOrganizacao("br001").contratoVigente.estaVigente(), true);
        assert.throws(() => amb.app.organizacao.cadastrarOrganizacao(dadosOrganizacao(amb, "11222333000181")),
            (e: Error) => e instanceof ErroRegraNegocio && /já cadastrado para BR001/.test(e.message));
        assert.throws(() => amb.app.organizacao.cadastrarOrganizacao(dadosOrganizacao(amb, "11.222.333/0001-00")), ErroValidacao);
        amb.app.organizacao.renovarContrato("BR001", adicionarDias(amb.relogio.agora(), 800));
        assert.equal(amb.app.organizacao.buscarOrganizacao("BR001").contratoVigente.dataVencimento.getTime(),
            adicionarDias(amb.relogio.agora(), 800).getTime());
    } finally {
        removerDiretorio(amb.diretorio);
    }
});

test("Lote: rejeita data futura, anterior a 90 dias, NF repetida e contrato vencido", () => {
    const amb = criarAmbiente();
    try {
        const { app, relogio } = amb;
        const { org } = prepararLote(amb);
        const hoje = relogio.agora();
        const base = { organizacaoId: org.id, transportadora: "TransRapida" };
        assert.throws(() => app.lote.criarLote({ ...base, notaFiscal: "2", dataEntrada: adicionarDias(hoje, 1) }), /futuro/);
        assert.throws(() => app.lote.criarLote({ ...base, notaFiscal: "3", dataEntrada: adicionarDias(hoje, -91) }), /90 dias/);
        assert.equal(app.lote.criarLote({ ...base, notaFiscal: "4", dataEntrada: adicionarDias(hoje, -90) }).id, "LT-2026-0002");
        assert.throws(() => app.lote.criarLote({ ...base, notaFiscal: "123456" }), /já foi registrada/);
        relogio.avancarMinutos(400 * 24 * 60);
        amb.entrar("admin");
        assert.throws(() => app.lote.criarLote({ ...base, notaFiscal: "5" }), /contrato de coleta vigente/);
    } finally {
        removerDiretorio(amb.diretorio);
    }
});

test("Desmonte só é permitido após a triagem completa do lote", () => {
    const amb = criarAmbiente();
    try {
        const { app } = amb;
        const { lote: l } = prepararLote(amb);
        const eq = adicionar(amb, l.id);
        assert.throws(() => app.equipamento.atualizarStatus(eq.id, StatusRastreamento.AGUARDANDO_DESMONTE, ""), /após a triagem completa/);
        app.lote.processarTriagem(l.id);
        assert.equal(lote(amb, l.id).statusProcessamento, StatusLote.EM_TRIAGEM);
        assert.throws(() => app.equipamento.atualizarStatus(eq.id, StatusRastreamento.AGUARDANDO_DESMONTE, ""), /após a triagem completa/);
        assert.throws(() => app.equipamento.atualizarStatus(eq.id, StatusRastreamento.DESCARTE_SEGURO, ""), /conclua a triagem/);
        app.equipamento.atualizarEstadoFisico(eq.id, EstadoFisico.USADO_LEVE);
        app.lote.processarTriagem(l.id);
        assert.equal(lote(amb, l.id).statusProcessamento, StatusLote.TRIAGEM_CONCLUIDA);
        assert.throws(() => app.equipamento.atualizarStatus(eq.id, StatusRastreamento.EM_DESMONTE, ""), /Transição inválida/);
        app.equipamento.atualizarStatus(eq.id, StatusRastreamento.AGUARDANDO_DESMONTE, "");
        assert.equal(app.equipamento.rastrearEquipamento(eq.id).equipamento.statusRastreamento, StatusRastreamento.AGUARDANDO_DESMONTE);
        assert.throws(() => app.lote.processarTriagem(l.id), /já foi concluída/);
    } finally {
        removerDiretorio(amb.diretorio);
    }
});

test("Queda de duas ou mais categorias no estado físico exige justificativa", () => {
    const amb = criarAmbiente();
    try {
        const { app } = amb;
        const { lote: l } = prepararLote(amb);
        const eq = adicionar(amb, l.id, notebook({ estadoFisico: EstadoFisico.BOM_ESTADO }));
        app.lote.processarTriagem(l.id);
        app.equipamento.atualizarEstadoFisico(eq.id, EstadoFisico.USADO_LEVE);
        assert.throws(() => app.equipamento.atualizarEstadoFisico(eq.id, EstadoFisico.DANIFICADO_LEVE), /Justificativa obrigatória/);
        assert.throws(() => app.equipamento.atualizarEstadoFisicoJustificado(eq.id, EstadoFisico.DANIFICADO_LEVE, "curta"), /Justificativa obrigatória/);
        app.equipamento.atualizarEstadoFisicoJustificado(eq.id, EstadoFisico.DANIFICADO_LEVE, "Queda durante o transporte interno");
        app.equipamento.atualizarEstadoFisico(eq.id, EstadoFisico.USADO_MODERADO);
        const h = app.equipamento.rastrearEquipamento(eq.id);
        assert.equal(h.equipamento.estadoFisico, EstadoFisico.USADO_MODERADO);
        const justificada = h.movimentacoes.find(m => m.destino === EstadoFisico.DANIFICADO_LEVE);
        assert.equal(justificada?.observacao, "Queda durante o transporte interno", "a justificativa fica registrada na movimentação");
        assert.equal(justificada?.responsavel, "admin");
    } finally {
        removerDiretorio(amb.diretorio);
    }
});

test("Status do lote acompanha os equipamentos até FINALIZADO", () => {
    const amb = criarAmbiente();
    try {
        const { app } = amb;
        const { lote: l } = prepararLote(amb);
        const a = adicionar(amb, l.id);
        const b = adicionar(amb, l.id, notebook({ marca: "Lenovo" }));
        assert.throws(() => adicionar(amb, "LT-2026-9999"), /não encontrado/);
        app.lote.processarTriagem(l.id);
        assert.throws(() => adicionar(amb, l.id), /RECEBIDOS/);
        app.lote.processarTriagem(l.id);
        app.equipamento.atualizarStatus(a.id, StatusRastreamento.PECAS_REAPROVEITADAS, "Reuso integral");
        assert.equal(lote(amb, l.id).statusProcessamento, StatusLote.TRIAGEM_CONCLUIDA);
        app.equipamento.atualizarStatus(b.id, StatusRastreamento.PECAS_REAPROVEITADAS, "Reuso integral");
        assert.equal(lote(amb, l.id).statusProcessamento, StatusLote.ENCAMINHADO);
        for (const id of [a.id, b.id]) {
            app.equipamento.atualizarStatus(id, StatusRastreamento.BAIXA_DEFINITIVA, "");
        }
        assert.equal(lote(amb, l.id).statusProcessamento, StatusLote.FINALIZADO);
        assert.throws(() => app.equipamento.registrarMovimentacao(a.id, "Galpão C"), /baixa definitiva/);
    } finally {
        removerDiretorio(amb.diretorio);
    }
});

test("Lote contém ao menos um equipamento: o último não pode ser removido", () => {
    const amb = criarAmbiente();
    try {
        const { lote: l } = prepararLote(amb);
        const a = adicionar(amb, l.id);
        const b = adicionar(amb, l.id);
        const carregado = lote(amb, l.id);
        assert.equal(carregado.removerEquipamento(a.id), true);
        assert.equal(carregado.equipamentos[0]!.posicaoNoLote, 1);
        assert.equal(carregado.removerEquipamento("EQ-999999"), false);
        assert.throws(() => carregado.removerEquipamento(b.id), /ao menos um equipamento/);
    } finally {
        removerDiretorio(amb.diretorio);
    }
});

test("Código de barras interno: único, com prefixo do tipo e dígito verificador", () => {
    const amb = criarAmbiente();
    try {
        const { lote: l } = prepararLote(amb);
        const a = adicionar(amb, l.id);
        const b = adicionar(amb, l.id);
        assert.match(a.codigoBarrasInterno, /^GCNTB\d{8}$/);
        assert.notEqual(a.codigoBarrasInterno, b.codigoBarrasInterno);
        assert.equal(codigoBarrasValido(a.codigoBarrasInterno), true);
        assert.equal(amb.app.equipamento.gerarCodigoBarras(a.tipo, 1), a.codigoBarrasInterno);
        assert.equal(amb.app.equipamento.rastrearEquipamento(a.codigoBarrasInterno).equipamento.id, a.id, "busca pelo código de barras");
    } finally {
        removerDiretorio(amb.diretorio);
    }
});

test("Rastreabilidade após múltiplas movimentações reúne origem, lote e linha do tempo", () => {
    const amb = criarAmbiente();
    try {
        const { app } = amb;
        criarUsuario(amb, "gestor", PapelUsuario.GESTOR_ALMOXARIFADO);
        criarUsuario(amb, "auditor", PapelUsuario.AUDITOR);
        const { org, lote: l } = prepararLote(amb);
        amb.entrar("gestor");
        const eq = adicionar(amb, l.id);
        app.lote.processarTriagem(l.id);
        app.equipamento.atualizarEstadoFisico(eq.id, EstadoFisico.USADO_LEVE);
        app.lote.processarTriagem(l.id);
        app.equipamento.registrarMovimentacao(eq.id, "Galpão B / Bancada 3");
        app.equipamento.atualizarStatus(eq.id, StatusRastreamento.AGUARDANDO_DESMONTE, "");
        app.equipamento.atualizarStatus(eq.id, StatusRastreamento.EM_DESMONTE, "");
        app.equipamento.registrarMovimentacao(eq.id, "Linha de desmonte 1");
        amb.entrar("auditor");
        const h = app.equipamento.rastrearEquipamento(eq.codigoBarrasInterno);
        assert.equal(h.organizacao.id, org.id);
        assert.equal(h.lote.id, l.id);
        assert.deepEqual(h.movimentacoes.map(naturezaMovimentacao),
            ["LOCALIZACAO", "STATUS", "ESTADO_FISICO", "LOCALIZACAO", "STATUS", "STATUS", "LOCALIZACAO"]);
        assert.ok(h.movimentacoes.every(m => m.responsavel === "gestor"));
        assert.equal(localizacaoAtual(h.equipamento), "Linha de desmonte 1");
        assert.equal(h.auditoria.length, 7);
        assert.ok(h.depreciacao > 0 && h.depreciacao < 1);
        assert.throws(() => app.equipamento.registrarMovimentacao(eq.id, "EM_TRIAGEM"), ErroPermissao);
    } finally {
        removerDiretorio(amb.diretorio);
    }
});
