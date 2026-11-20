import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { arredondar, limiteAtipico, regressaoLinear, resumir } from "../../src/analises/estatistica";
import { analisarEficiencia, LoteParaEficiencia } from "../../src/analises/AnaliseEficiencia";
import { analisarRentabilidade, EquipamentoParaRentabilidade, estimarValorRecuperacao } from "../../src/analises/AnaliseRentabilidade";
import {
    ajustarModelo, analisarVidaUtil, compararPrevisoes, EquipamentoParaVidaUtil, idadeEmAnos, MetodoPrevisao, observacoesDe
} from "../../src/analises/AnaliseVidaUtil";
import ParametrosGlobais from "../../src/dominio/ParametrosGlobais";
import TipoEquipamento from "../../src/dominio/enums/TipoEquipamento";

const DIA = 86_400_000;
const d = (iso: string) => new Date(iso);

describe("Estatística (fachada da simple-statistics)", () => {
    it("resumo descritivo com desvio padrão amostral e quantis", () => {
        const r = resumir([2, 4, 4, 4, 5, 5, 7, 9])!;
        assert.equal(r.n, 8);
        assert.equal(r.media, 5);
        assert.equal(r.mediana, 4.5);
        assert.equal(r.desvioPadrao, 2.14); // amostral: sqrt(32/7)
        assert.equal(r.minimo, 2);
        assert.equal(r.maximo, 9);
        assert.equal(resumir([]), null);
        assert.equal(resumir([3])!.desvioPadrao, 0);
    });

    it("regressão linear por mínimos quadrados recupera a reta e o R²", () => {
        const r = regressaoLinear([[0, 1], [1, 3], [2, 5], [3, 7]])!;
        assert.equal(arredondar(r.inclinacao, 6), 2);
        assert.equal(arredondar(r.intercepto, 6), 1);
        assert.equal(arredondar(r.r2, 6), 1);
        const ruidosa = regressaoLinear([[0, 0], [1, 2], [2, 1], [3, 3]])!;
        assert.ok(ruidosa.r2 > 0 && ruidosa.r2 < 1);
        assert.equal(regressaoLinear([[1, 1]]), null, "um ponto não define reta");
        assert.equal(regressaoLinear([[2, 1], [2, 5]]), null, "x constante não define reta");
    });

    it("limite de Tukey só com amostra mínima", () => {
        assert.equal(limiteAtipico([1, 2, 3]), null);
        assert.ok(limiteAtipico([1, 2, 3, 4, 5, 6, 7, 8])! > 8, "amostra sem valores atípicos");
        assert.ok(limiteAtipico([1, 1, 1, 1, 1, 1, 1, 9])! < 9, "o 9 destoa do restante");
    });
});

describe("Análise de eficiência operacional", () => {
    const entrada = d("2026-03-02T00:00:00Z");
    const lote = (id: string, operador: string | null, inicioDias: number | null, fimDias: number | null, status: LoteParaEficiencia["statusProcessamento"] = "TRIAGEM_CONCLUIDA"): LoteParaEficiencia => ({
        id, organizacaoId: "BR001", dataEntrada: entrada, statusProcessamento: status, quantidadeEquipamentos: 4,
        triagemIniciadaEm: inicioDias === null ? null : new Date(entrada.getTime() + inicioDias * DIA), triagemIniciadaPor: operador,
        triagemConcluidaEm: fimDias === null ? null : new Date(entrada.getTime() + fimDias * DIA), triagemConcluidaPor: fimDias === null ? null : operador
    });
    const lotes = [
        lote("LT-1", "ana", 2, 3), lote("LT-2", "bruno", 1, 1.25), lote("LT-3", "bruno", 4, 5),
        lote("LT-4", null, null, null, "RECEBIDO"), lote("LT-5", "ana", 1, null, "EM_TRIAGEM")
    ];
    const agora = new Date(entrada.getTime() + 10 * DIA);

    it("separa espera e triagem, identifica o gargalo e agrupa por operador", () => {
        const r = analisarEficiencia(lotes, agora);
        assert.equal(r.lotesConsiderados, 5);
        assert.equal(r.lotesComTriagemConcluida, 3);
        assert.equal(r.temposDias.espera!.media, 2.33);    // (2 + 1 + 4) / 3
        assert.equal(r.temposDias.triagem!.media, 0.75);   // (1 + 0.25 + 1) / 3
        assert.equal(r.temposDias.total!.mediana, 3);
        assert.equal(r.gargalo!.etapa, "ESPERA");
        assert.equal(r.gargalo!.participacao, arredondar(7 / 9.25, 4));
        // Bruno tem a menor mediana de triagem (0,625 dia) e vem primeiro.
        assert.deepEqual(r.porOperador.map(o => [o.operador, o.lotes]), [["bruno", 2], ["ana", 1]]);
        assert.equal(r.porOperador[0]!.horasPorEquipamento, arredondar((0.25 + 1) * 24 / 8, 3));
        assert.deepEqual(r.porMes.map(m => [m.mes, m.lotes]), [["2026-03", 3]]);
    });

    it("mostra as pendências (fila do almoxarifado) com o lote mais antigo", () => {
        const r = analisarEficiencia(lotes, agora);
        assert.equal(r.pendencias.aguardandoTriagem.quantidade, 1);
        assert.deepEqual(r.pendencias.aguardandoTriagem.maisAntigo, { loteId: "LT-4", dias: 10 });
        assert.equal(r.pendencias.emTriagem.quantidade, 1);
        assert.equal(r.pendencias.emTriagem.maisAntigo!.dias, 9);
    });

    it("aponta lotes atípicos pelo critério de Tukey", () => {
        const muitos = [1, 1.2, 1.1, 0.9, 1, 1.3, 9].map((t, i) => lote(`LT-${i}`, "ana", 0, t));
        const r = analisarEficiencia(muitos, agora);
        assert.deepEqual(r.lotesAtipicos.lotes.map(l => l.loteId), ["LT-6"]);
        assert.equal(analisarEficiencia([], agora).gargalo, null);
    });
});

describe("Análise de rentabilidade", () => {
    const item = (id: string, tipo: TipoEquipamento, marca: string, modelo: string, estadoFisico: EquipamentoParaRentabilidade["estadoFisico"], valor: number, peso = 2): EquipamentoParaRentabilidade => ({
        id, tipo, marca, modelo, estadoFisico, statusRastreamento: "AGUARDANDO_TRIAGEM", pesoQuilogramas: peso,
        valorReferencia: tipo === "SERVIDOR" ? 15000 : 4000, valorRecuperacao: valor
    });
    const itens = [
        item("1", "NOTEBOOK", "Dell", "Latitude", "BOM_ESTADO", 2000), item("2", "NOTEBOOK", "Dell", "Latitude", "BOM_ESTADO", 2200),
        item("3", "NOTEBOOK", "Dell", "Latitude", "USADO_LEVE", 1800), item("4", "NOTEBOOK", "Acer", "Aspire", "DANIFICADO_GRAVE", 300),
        item("5", "SERVIDOR", "HP", "DL380", "USADO_MODERADO", 6000, 20)
    ];

    it("ordena os tipos pelo valor médio e detalha por estado, marca e modelo", () => {
        const r = analisarRentabilidade(itens);
        assert.equal(r.valorTotalRecuperavel, 12300);
        assert.deepEqual(r.prioridade.map(p => p.tipo), ["SERVIDOR", "NOTEBOOK"]);
        const notebook = r.porTipo.find(t => t.tipo === "NOTEBOOK")!;
        assert.equal(notebook.quantidade, 4);
        assert.equal(notebook.valorRecuperacao.media, 1575);
        assert.equal(notebook.valorPorKg, 787.5);
        assert.equal(notebook.participacaoNoValor, arredondar(6300 / 12300, 4));
        assert.deepEqual(notebook.porEstadoFisico.map(e => e.estadoFisico), ["BOM_ESTADO", "USADO_LEVE", "DANIFICADO_GRAVE"]);
        assert.equal(notebook.marcas[0]!.nome, "Dell");
        // Ranking global exige ao menos 2 itens por marca: a HP (1 servidor) fica de fora.
        assert.deepEqual(r.melhoresMarcas.map(m => m.nome), ["Dell"]);
    });

    it("estimativa usa o grupo mais específico com amostra suficiente", () => {
        const porModelo = estimarValorRecuperacao(itens, { tipo: "NOTEBOOK", marca: "dell", modelo: "LATITUDE" });
        assert.equal(porModelo.base, "TIPO_MARCA_MODELO");
        assert.equal(porModelo.amostra, 3);
        assert.equal(porModelo.valorEstimado, 2000);
        const recuaParaTipo = estimarValorRecuperacao(itens, { tipo: "NOTEBOOK", marca: "Acer", estadoFisico: "DANIFICADO_GRAVE" });
        assert.equal(recuaParaTipo.base, "TIPO");
        const poucos = estimarValorRecuperacao(itens, { tipo: "SERVIDOR" });
        assert.equal(poucos.confiavel, false);
        assert.equal(estimarValorRecuperacao(itens, { tipo: "MONITOR" }).base, "SEM_DADOS");
    });
});

describe("Análise preditiva de vida útil", () => {
    const recebido = d("2026-06-01T12:00:00Z");
    const notebook = (id: string, ano: number, estado: EquipamentoParaVidaUtil["estadoFisico"], mudancas: EquipamentoParaVidaUtil["mudancasEstado"] = []): EquipamentoParaVidaUtil => ({
        id, tipo: "NOTEBOOK", anoFabricacao: ano, estadoFisico: estado, statusRastreamento: "EM_TRIAGEM", recebidoEm: recebido, mudancasEstado: mudancas
    });
    const coeficientes = ParametrosGlobais.padrao().coeficientesDepreciacao;

    it("observações vêm da chegada e de cada reclassificação de estado", () => {
        const e = notebook("EQ-1", 2020, "DANIFICADO_LEVE", [{ dataHora: d("2026-09-01T00:00:00Z"), de: "BOM_ESTADO", para: "DANIFICADO_LEVE" }]);
        const obs = observacoesDe(e);
        assert.equal(obs.length, 2);
        assert.equal(obs[0]![1], 1, "estado na chegada: BOM_ESTADO (nível 1)");
        assert.equal(obs[1]![1], 4);
        assert.ok(Math.abs(obs[0]![0] - idadeEmAnos(2020, recebido)) < 1e-9);
    });

    it("ajusta a regressão quando há dados e prevê a idade em que o tipo fica inservível", () => {
        // Nível = 0,5 × idade (exato): fica inservível (nível 6) aos 12 anos.
        const pontos: [number, number][] = [[2, 1], [4, 2], [6, 3], [8, 4], [10, 5]];
        const m = ajustarModelo("NOTEBOOK", pontos, 0.25);
        assert.equal(m.metodo, MetodoPrevisao.REGRESSAO_LINEAR);
        assert.equal(m.inclinacao, 0.5);
        assert.equal(m.r2, 1);
        assert.equal(m.idadePrevistaInservivelAnos, 12);
    });

    it("sem dados suficientes, usa o coeficiente de depreciação do tipo", () => {
        const poucos = ajustarModelo("SERVIDOR", [[3, 2], [5, 3]], 0.2);
        assert.equal(poucos.metodo, MetodoPrevisao.PARAMETRO_DEPRECIACAO);
        assert.equal(poucos.inclinacao, 1.2); // 6 níveis × 0,2 ao ano
        assert.equal(poucos.idadePrevistaInservivelAnos, 5);
        assert.match(poucos.motivoAlternativo!, /ao menos 5/);
        const semPiora = ajustarModelo("MONITOR", [[1, 3], [2, 3], [3, 2], [4, 2], [5, 1]], 0.2);
        assert.equal(semPiora.metodo, MetodoPrevisao.PARAMETRO_DEPRECIACAO);
        assert.match(semPiora.motivoAlternativo!, /não mostra piora/);
        // Tendência positiva mas a idade quase não explica o estado: ajuste fraco é recusado.
        const fraco = ajustarModelo("FONTE_ALIMENTACAO", [[1, 0], [2, 5], [3, 1], [4, 5], [5, 0], [6, 4]], 0.2); // inclinação 0,26; R² 0,04
        assert.equal(fraco.metodo, MetodoPrevisao.PARAMETRO_DEPRECIACAO);
        assert.match(fraco.motivoAlternativo!, /Ajuste fraco/);
    });

    it("prevê cada equipamento ativo a partir do próprio estado e ignora inservíveis e baixados", () => {
        const equipamentos = [
            notebook("EQ-1", 2024, "NOVO"), notebook("EQ-2", 2022, "USADO_LEVE"), notebook("EQ-3", 2020, "USADO_MODERADO"),
            notebook("EQ-4", 2018, "DANIFICADO_LEVE"), notebook("EQ-5", 2016, "DANIFICADO_GRAVE"), notebook("EQ-6", 2012, "INSERVIVEL"),
            { ...notebook("EQ-7", 2019, "BOM_ESTADO"), statusRastreamento: "BAIXA_DEFINITIVA" as const }
        ];
        const r = analisarVidaUtil(equipamentos, coeficientes, recebido, 36);
        const modelo = r.modelos.find(m => m.tipo === "NOTEBOOK")!;
        assert.equal(modelo.metodo, MetodoPrevisao.REGRESSAO_LINEAR);
        assert.ok(modelo.inclinacao > 0.3 && modelo.r2! > 0.7, JSON.stringify(modelo));
        assert.equal(r.equipamentosAtivos, 5);
        // O mais desgastado (DANIFICADO_GRAVE, nível 5) é o primeiro a vencer: 1 nível / inclinação.
        assert.equal(r.previsoes[0]!.equipamentoId, "EQ-5");
        assert.equal(r.previsoes[0]!.anosRestantes, arredondar(1 / modelo.inclinacao));
        assert.equal(r.previsoes.at(-1)!.equipamentoId, "EQ-1");
        assert.equal(r.horizonte.meses, 36);
        assert.equal(r.horizonte.equipamentos, r.previsoes.filter(p => p.anosRestantes <= 3).length);
        assert.ok(r.horizonte.equipamentos >= 1);
    });

    it("aderência compara previsões com a data real e mede o erro médio", () => {
        const geradaEm = d("2026-01-01T00:00:00Z");
        const previsoes = [
            { execucaoId: "x", geradaEm, equipamentoId: "EQ-1", tipo: "NOTEBOOK" as const, dataPrevistaInservivel: d("2026-06-01"), metodo: "REGRESSAO_LINEAR" },
            { execucaoId: "x", geradaEm, equipamentoId: "EQ-2", tipo: "NOTEBOOK" as const, dataPrevistaInservivel: d("2026-06-01"), metodo: "REGRESSAO_LINEAR" },
            { execucaoId: "x", geradaEm, equipamentoId: "EQ-3", tipo: "NOTEBOOK" as const, dataPrevistaInservivel: d("2026-06-01"), metodo: "REGRESSAO_LINEAR" }
        ];
        const reais = new Map([["EQ-1", d("2026-06-11")], ["EQ-2", d("2026-05-22")], ["EQ-3", d("2025-12-01")]]);
        const vencida = { ...previsoes[0]!, equipamentoId: "EQ-4", dataPrevistaInservivel: d("2026-02-01") };
        const aberta = { ...previsoes[0]!, equipamentoId: "EQ-5", dataPrevistaInservivel: d("2027-02-01") };
        const r = compararPrevisoes([...previsoes, vencida, aberta], reais, d("2026-07-01"));
        assert.equal(r.avaliadas, 2, "EQ-3 ficou inservível antes da previsão ser feita: não conta");
        assert.equal(r.vencidasSemOcorrencia, 1, "EQ-4: a data prevista passou e ele continua utilizável");
        assert.equal(r.emAberto, 1, "EQ-5: previsão futura, observação censurada");
        assert.equal(r.erroMedioAbsolutoDias, 10);
        assert.equal(r.vieseMedioDias, 0); // (+10 − 10) / 2: um atraso e uma antecipação de 10 dias
    });
});
