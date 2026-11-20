import EstadoFisico, { nivelEstadoFisico } from "../dominio/enums/EstadoFisico";
import StatusRastreamento from "../dominio/enums/StatusRastreamento";
import TipoEquipamento from "../dominio/enums/TipoEquipamento";
import { arredondar, regressaoLinear, resumir } from "./estatistica";

// Análise preditiva de vida útil remanescente.
//
// Modelo: o estado físico é uma escala ordinal de 0 (NOVO) a 6 (INSERVIVEL). Para cada tipo de
// equipamento, ajusta-se por mínimos quadrados ordinários a reta  nivel = a + b · idade,  usando
// como observações cada inspeção registrada no histórico (o estado na chegada ao almoxarifado e
// cada reclassificação de estado, com a idade do equipamento naquele momento).
//   b (inclinação) = quantos níveis de estado o tipo perde por ano;
//   idade prevista para ficar inservível = (6 − a) / b.
// Para um equipamento específico, a vida remanescente parte do estado DELE: (6 − nivelAtual) / b,
// descontado o tempo decorrido desde a última inspeção.
//
// Quando não há dados suficientes para a regressão (poucas observações, idades iguais, reta sem
// tendência de piora ou ajuste fraco), usa-se o coeficiente de depreciação anual do tipo (parâmetro
// global): um coeficiente c significa perder o valor todo em 1/c anos, ou seja, b = 6 · c níveis/ano.
//
// Refinamento pela aderência: a regressão por idade descreve o desgaste DURANTE O USO (o estado com
// que o equipamento chega). Mas os equipamentos previstos estão parados no pátio do almoxarifado,
// onde o desgaste segue outro ritmo. Comparando previsões antigas com o que aconteceu, a regressão
// errava por anos. Por isso, quando o histórico tem exposição suficiente, a vida remanescente de cada
// equipamento usa a TAXA DE ARMAZENAGEM do tipo: níveis perdidos depois da triagem ÷ anos-equipamento
// de permanência no pátio (estimador de taxa de eventos por tempo de exposição). A regressão por
// idade continua como o perfil do tipo (idade prevista para ficar inservível em uso).

export const NIVEL_INSERVIVEL = nivelEstadoFisico(EstadoFisico.INSERVIVEL);
export const MINIMO_OBSERVACOES = 5;
const INCLINACAO_MINIMA = 0.01;
// Abaixo disso a idade explica muito pouco da variação do estado: a reta não é confiável.
export const R2_MINIMO = 0.2;
// Taxa de armazenagem: exposição mínima (anos-equipamento) e eventos de piora para confiar nela.
export const EXPOSICAO_MINIMA_ANOS = 1;
export const EVENTOS_MINIMOS_ARMAZENAGEM = 3;
const DIAS_POR_ANO = 365.25;
const MS_POR_ANO = DIAS_POR_ANO * 86_400_000;

export const MetodoPrevisao = {
    REGRESSAO_LINEAR: "REGRESSAO_LINEAR",
    PARAMETRO_DEPRECIACAO: "PARAMETRO_DEPRECIACAO",
    TAXA_ARMAZENAGEM: "TAXA_ARMAZENAGEM"
} as const;
export type MetodoPrevisao = (typeof MetodoPrevisao)[keyof typeof MetodoPrevisao];

export interface MudancaEstado {
    dataHora: Date;
    de: EstadoFisico;
    para: EstadoFisico;
}

export interface EquipamentoParaVidaUtil {
    id: string;
    tipo: TipoEquipamento;
    anoFabricacao: number;
    estadoFisico: EstadoFisico;
    statusRastreamento: StatusRastreamento;
    recebidoEm: Date;
    // Em ordem cronológica.
    mudancasEstado: MudancaEstado[];
    // Início e fim da permanência no pátio depois da triagem (para a taxa de armazenagem).
    triagemConcluidaEm?: Date | null;
    baixaEm?: Date | null;
}

export interface TaxaArmazenagem {
    exposicaoAnos: number;
    niveisPerdidos: number;
    eventos: number;
    // Níveis perdidos por ano no pátio (null = exposição ou eventos insuficientes).
    taxaAnual: number | null;
}

export interface ModeloVidaUtil {
    tipo: TipoEquipamento;
    metodo: MetodoPrevisao;
    observacoes: number;
    // Níveis de estado perdidos por ano.
    inclinacao: number;
    intercepto: number;
    r2: number | null;
    idadePrevistaInservivelAnos: number;
    motivoAlternativo?: string;
    // Desgaste no pátio do almoxarifado; "fonte" diz se a taxa usada nas previsões é do próprio
    // tipo, a geral (todos os tipos) ou nenhuma (sem dados: vale a inclinação acima).
    armazenagem?: TaxaArmazenagem & { fonte: "TIPO" | "GERAL" | null; taxaUsada: number | null };
}

export interface PrevisaoEquipamento {
    equipamentoId: string;
    tipo: TipoEquipamento;
    estadoFisico: EstadoFisico;
    idadeAnos: number;
    anosRestantes: number;
    dataPrevistaInservivel: Date;
    metodo: MetodoPrevisao;
}

// Idade em anos numa data, supondo fabricação no meio do ano (melhor estimativa sem o mês).
export function idadeEmAnos(anoFabricacao: number, data: Date): number {
    return Math.max(0, (data.getTime() - Date.UTC(anoFabricacao, 6, 1)) / MS_POR_ANO);
}

// Observações (idade, nível) de um equipamento: o estado na chegada e cada reclassificação.
export function observacoesDe(e: EquipamentoParaVidaUtil): [number, number][] {
    const inicial = e.mudancasEstado[0]?.de ?? e.estadoFisico;
    return [
        [idadeEmAnos(e.anoFabricacao, e.recebidoEm), nivelEstadoFisico(inicial)],
        ...e.mudancasEstado.map(m => [idadeEmAnos(e.anoFabricacao, m.dataHora), nivelEstadoFisico(m.para)] as [number, number])
    ];
}

export function ajustarModelo(tipo: TipoEquipamento, pontos: [number, number][], coeficienteDepreciacao: number): ModeloVidaUtil {
    const regressao = pontos.length >= MINIMO_OBSERVACOES ? regressaoLinear(pontos) : null;
    if (regressao && regressao.inclinacao >= INCLINACAO_MINIMA && regressao.r2 >= R2_MINIMO) {
        return {
            tipo, metodo: MetodoPrevisao.REGRESSAO_LINEAR, observacoes: pontos.length,
            inclinacao: arredondar(regressao.inclinacao, 4), intercepto: arredondar(regressao.intercepto, 4), r2: arredondar(regressao.r2, 4),
            idadePrevistaInservivelAnos: arredondar(Math.max(0, (NIVEL_INSERVIVEL - regressao.intercepto) / regressao.inclinacao))
        };
    }
    const inclinacao = NIVEL_INSERVIVEL * coeficienteDepreciacao;
    return {
        tipo, metodo: MetodoPrevisao.PARAMETRO_DEPRECIACAO, observacoes: pontos.length,
        inclinacao: arredondar(inclinacao, 4), intercepto: 0, r2: null,
        idadePrevistaInservivelAnos: arredondar(NIVEL_INSERVIVEL / inclinacao),
        motivoAlternativo: pontos.length < MINIMO_OBSERVACOES
            ? `Apenas ${pontos.length} observação(ões); a regressão exige ao menos ${MINIMO_OBSERVACOES}.`
            : !regressao
                ? "Todas as observações têm a mesma idade; não há como estimar a tendência."
                : regressao.inclinacao < INCLINACAO_MINIMA
                    ? "O histórico não mostra piora do estado com a idade; usado o coeficiente de depreciação do tipo."
                    : `Ajuste fraco (R² = ${arredondar(regressao.r2, 3)}, mínimo ${R2_MINIMO}): a idade explica pouco o estado deste tipo; usado o coeficiente de depreciação.`
    };
}

// Taxa de desgaste no pátio: níveis perdidos depois da triagem ÷ anos-equipamento de permanência.
// A exposição de cada equipamento vai da conclusão da triagem até a baixa, até ficar inservível
// (não há como piorar depois) ou até agora. As reclassificações feitas na triagem não entram:
// elas corrigem o estado declarado, não medem desgaste ao longo do tempo.
export function taxaArmazenagem(equipamentos: readonly EquipamentoParaVidaUtil[], agora: Date): TaxaArmazenagem {
    let exposicaoMs = 0, niveis = 0, eventos = 0;
    for (const e of equipamentos) {
        if (!e.triagemConcluidaEm) continue;
        const inicio = e.triagemConcluidaEm.getTime();
        const inservivel = e.mudancasEstado.find(m => m.para === EstadoFisico.INSERVIVEL && m.dataHora.getTime() > inicio)?.dataHora;
        const fim = Math.min(agora.getTime(), e.baixaEm?.getTime() ?? Infinity, inservivel?.getTime() ?? Infinity);
        if (fim <= inicio) continue;
        exposicaoMs += fim - inicio;
        for (const m of e.mudancasEstado) {
            const t = m.dataHora.getTime();
            const queda = nivelEstadoFisico(m.para) - nivelEstadoFisico(m.de);
            if (t > inicio && t <= fim && queda > 0) {
                niveis += queda;
                eventos++;
            }
        }
    }
    const exposicaoAnos = exposicaoMs / MS_POR_ANO;
    const suficiente = exposicaoAnos >= EXPOSICAO_MINIMA_ANOS && eventos >= EVENTOS_MINIMOS_ARMAZENAGEM;
    return {
        exposicaoAnos: arredondar(exposicaoAnos), niveisPerdidos: niveis, eventos,
        taxaAnual: suficiente ? arredondar(niveis / exposicaoAnos, 4) : null
    };
}

// Equipamentos ainda em uso para efeito de previsão: não baixados e ainda não inservíveis.
export function estaAtivo(e: Pick<EquipamentoParaVidaUtil, "estadoFisico" | "statusRastreamento">): boolean {
    return e.estadoFisico !== EstadoFisico.INSERVIVEL && e.statusRastreamento !== StatusRastreamento.BAIXA_DEFINITIVA;
}

export function preverEquipamento(e: EquipamentoParaVidaUtil, modelo: ModeloVidaUtil, agora: Date): PrevisaoEquipamento {
    const ultimaInspecao = e.mudancasEstado[e.mudancasEstado.length - 1]?.dataHora ?? e.recebidoEm;
    const decorridos = Math.max(0, (agora.getTime() - ultimaInspecao.getTime()) / MS_POR_ANO);
    const taxa = modelo.armazenagem?.taxaUsada ?? null;
    const ritmo = taxa ?? modelo.inclinacao;
    const restantes = Math.max(0, (NIVEL_INSERVIVEL - nivelEstadoFisico(e.estadoFisico)) / ritmo - decorridos);
    return {
        equipamentoId: e.id, tipo: e.tipo, estadoFisico: e.estadoFisico,
        idadeAnos: arredondar(idadeEmAnos(e.anoFabricacao, agora)),
        anosRestantes: arredondar(restantes),
        // Data civil (meia-noite UTC), como as demais datas sem hora do sistema.
        dataPrevistaInservivel: new Date(new Date(agora.getTime() + restantes * MS_POR_ANO).toISOString().slice(0, 10)),
        metodo: taxa !== null ? MetodoPrevisao.TAXA_ARMAZENAGEM : modelo.metodo
    };
}

export function analisarVidaUtil(equipamentos: readonly EquipamentoParaVidaUtil[],
    coeficientes: Record<TipoEquipamento, number>, agora: Date, horizonteMeses = 12) {
    const tipos = Object.values(TipoEquipamento).filter(t => equipamentos.some(e => e.tipo === t));
    // Taxa de armazenagem: a do tipo, se houver dados; senão a geral (todos os tipos juntos).
    const geral = taxaArmazenagem(equipamentos, agora);
    const modelos = new Map<TipoEquipamento, ModeloVidaUtil>(tipos.map(tipo => {
        const doTipo = equipamentos.filter(e => e.tipo === tipo);
        const modelo = ajustarModelo(tipo, doTipo.flatMap(observacoesDe), coeficientes[tipo]);
        const propria = taxaArmazenagem(doTipo, agora);
        const fonte = propria.taxaAnual ? "TIPO" as const : geral.taxaAnual ? "GERAL" as const : null;
        const taxaUsada = fonte === "TIPO" ? propria.taxaAnual : fonte === "GERAL" ? geral.taxaAnual : null;
        return [tipo, { ...modelo, armazenagem: { ...propria, fonte, taxaUsada } }];
    }));
    const previsoes = equipamentos.filter(estaAtivo)
        .map(e => preverEquipamento(e, modelos.get(e.tipo)!, agora))
        .sort((a, b) => a.anosRestantes - b.anosRestantes || a.equipamentoId.localeCompare(b.equipamentoId));
    const horizonte = horizonteMeses / 12;
    return {
        equipamentosAnalisados: equipamentos.length,
        equipamentosAtivos: previsoes.length,
        armazenagemGeral: geral,
        modelos: [...modelos.values()],
        anosRestantes: resumir(previsoes.map(p => p.anosRestantes)),
        porTipo: tipos.map(tipo => {
            const doTipo = previsoes.filter(p => p.tipo === tipo);
            return { tipo, equipamentosAtivos: doTipo.length, anosRestantes: resumir(doTipo.map(p => p.anosRestantes)) };
        }),
        // Quantos equipamentos devem ficar inservíveis no horizonte (planejamento de capacidade de desmonte).
        horizonte: { meses: horizonteMeses, equipamentos: previsoes.filter(p => p.anosRestantes <= horizonte).length },
        previsoes
    };
}

export type ResultadoVidaUtil = ReturnType<typeof analisarVidaUtil>;

export interface PrevisaoRegistrada {
    execucaoId: string;
    geradaEm: Date;
    equipamentoId: string;
    tipo: TipoEquipamento;
    dataPrevistaInservivel: Date;
    metodo: string;
}

// Aderência do modelo: compara previsões já gravadas com o que aconteceu depois (a data real em
// que o equipamento foi reclassificado como INSERVIVEL). Erro positivo = ficou inservível depois
// do previsto (o modelo foi pessimista); negativo = antes (otimista).
//
// Cuidado com a censura: num período curto, só os equipamentos que falharam CEDO têm data real;
// os que vão falhar no prazo previsto ainda não falharam. Medir o erro só sobre os realizados
// puxaria o resultado para "otimista". Por isso o resultado também conta as previsões já vencidas
// sem a falha acontecer (sinal de pessimismo) e as ainda em aberto (sem conclusão possível).
export function compararPrevisoes(previsoes: readonly PrevisaoRegistrada[], realizacoes: ReadonlyMap<string, Date>, agora: Date = new Date()) {
    const avaliadas = previsoes.flatMap(p => {
        const real = realizacoes.get(p.equipamentoId);
        if (!real || real.getTime() <= p.geradaEm.getTime()) return [];
        const erroDias = Math.round((real.getTime() - p.dataPrevistaInservivel.getTime()) / 86_400_000);
        return [{ ...p, dataReal: real, erroDias }];
    });
    const erros = avaliadas.map(a => a.erroDias);
    const naoRealizadas = previsoes.filter(p => !realizacoes.has(p.equipamentoId));
    const vencidas = naoRealizadas.filter(p => p.dataPrevistaInservivel.getTime() < agora.getTime());
    const porMetodo = [...new Set(avaliadas.map(a => a.metodo))].map(metodo => {
        const doMetodo = avaliadas.filter(a => a.metodo === metodo).map(a => a.erroDias);
        return { metodo, avaliadas: doMetodo.length, erroMedioAbsolutoDias: arredondar(doMetodo.reduce((s, e) => s + Math.abs(e), 0) / doMetodo.length, 1) };
    });
    // Evolução do erro por execução: mostra se o modelo melhora conforme o histórico cresce.
    const porExecucao = [...new Set(avaliadas.map(a => a.execucaoId))].map(execucaoId => {
        const daExecucao = avaliadas.filter(a => a.execucaoId === execucaoId);
        return {
            execucaoId, geradaEm: daExecucao[0]!.geradaEm.toISOString(), avaliadas: daExecucao.length,
            erroMedioAbsolutoDias: arredondar(daExecucao.reduce((s, a) => s + Math.abs(a.erroDias), 0) / daExecucao.length, 1)
        };
    }).sort((a, b) => a.geradaEm.localeCompare(b.geradaEm));
    return {
        previsoesConsideradas: previsoes.length,
        avaliadas: avaliadas.length,
        // Previsão já vencida e o equipamento ainda não ficou inservível: o modelo foi pessimista.
        vencidasSemOcorrencia: vencidas.length,
        // Previsão no futuro e ainda sem falha: nada a concluir por enquanto (observação censurada).
        emAberto: naoRealizadas.length - vencidas.length,
        erroMedioAbsolutoDias: erros.length ? arredondar(erros.reduce((s, e) => s + Math.abs(e), 0) / erros.length, 1) : null,
        vieseMedioDias: erros.length ? arredondar(erros.reduce((s, e) => s + e, 0) / erros.length, 1) : null,
        erros: resumir(erros, 1),
        porMetodo,
        porExecucao,
        detalhes: avaliadas
            .sort((a, b) => Math.abs(b.erroDias) - Math.abs(a.erroDias))
            .slice(0, 50)
            .map(a => ({
                execucaoId: a.execucaoId, equipamentoId: a.equipamentoId, tipo: a.tipo, metodo: a.metodo,
                previstaEm: a.dataPrevistaInservivel.toISOString().slice(0, 10), realEm: a.dataReal.toISOString(), erroDias: a.erroDias
            }))
    };
}
