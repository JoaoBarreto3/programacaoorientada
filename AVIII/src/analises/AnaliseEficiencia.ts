import StatusLote from "../dominio/enums/StatusLote";
import { arredondar, limiteAtipico, resumir } from "./estatistica";

// Análise de eficiência operacional: quanto tempo os lotes levam da entrada no almoxarifado até a
// conclusão da triagem, dividido em duas etapas, para mostrar onde está o gargalo:
//   espera  = entrada → início da triagem (fila do almoxarifado)
//   triagem = início → conclusão da triagem (trabalho do operador)
//   total   = entrada → conclusão
// Função pura: recebe os dados já lidos do banco, o que a torna testável sem banco.

const MS_POR_DIA = 86_400_000;

export interface LoteParaEficiencia {
    id: string;
    organizacaoId: string;
    dataEntrada: Date;
    statusProcessamento: StatusLote;
    quantidadeEquipamentos: number;
    triagemIniciadaEm: Date | null;
    triagemIniciadaPor: string | null;
    triagemConcluidaEm: Date | null;
    triagemConcluidaPor: string | null;
}

interface TemposLote {
    lote: LoteParaEficiencia;
    esperaDias: number;
    triagemDias: number;
    totalDias: number;
}

const dias = (de: Date, ate: Date) => Math.max(0, (ate.getTime() - de.getTime()) / MS_POR_DIA);
const mesDe = (data: Date) => data.toISOString().slice(0, 7);

function pendencia(lotes: LoteParaEficiencia[], desde: (l: LoteParaEficiencia) => Date, agora: Date) {
    const idades = lotes.map(l => ({ loteId: l.id, dias: arredondar(dias(desde(l), agora)) }));
    const maisAntigo = idades.reduce<{ loteId: string; dias: number } | null>((a, b) => (a && a.dias >= b.dias ? a : b), null);
    return { quantidade: lotes.length, idade: resumir(idades.map(i => i.dias)), maisAntigo };
}

export function analisarEficiencia(lotes: readonly LoteParaEficiencia[], agora: Date) {
    const concluidos: TemposLote[] = lotes
        .filter(l => l.triagemIniciadaEm && l.triagemConcluidaEm)
        .map(l => {
            const esperaDias = dias(l.dataEntrada, l.triagemIniciadaEm!);
            const triagemDias = dias(l.triagemIniciadaEm!, l.triagemConcluidaEm!);
            return { lote: l, esperaDias, triagemDias, totalDias: esperaDias + triagemDias };
        });

    // Por operador: quem iniciou a triagem é o responsável por ela.
    const grupos = new Map<string, TemposLote[]>();
    for (const t of concluidos) {
        const operador = t.lote.triagemIniciadaPor ?? "desconhecido";
        grupos.set(operador, [...(grupos.get(operador) ?? []), t]);
    }
    const porOperador = [...grupos.entries()].map(([operador, itens]) => {
        const equipamentos = itens.reduce((s, t) => s + t.lote.quantidadeEquipamentos, 0);
        const horas = itens.reduce((s, t) => s + t.triagemDias * 24, 0);
        return {
            operador,
            lotes: itens.length,
            equipamentos,
            triagemDias: resumir(itens.map(t => t.triagemDias))!,
            horasPorEquipamento: equipamentos > 0 ? arredondar(horas / equipamentos, 3) : null
        };
    }).sort((a, b) => a.triagemDias.mediana - b.triagemDias.mediana || a.operador.localeCompare(b.operador));

    // Por mês de conclusão: mostra a variação ao longo do ano (sazonalidade).
    const meses = new Map<string, TemposLote[]>();
    for (const t of concluidos) {
        const mes = mesDe(t.lote.triagemConcluidaEm!);
        meses.set(mes, [...(meses.get(mes) ?? []), t]);
    }
    const porMes = [...meses.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([mes, itens]) => ({
        mes, lotes: itens.length, totalDias: resumir(itens.map(t => t.totalDias))!
    }));

    // Gargalo: a etapa que ocupa a maior parte do tempo total, em média.
    const esperaTotal = concluidos.reduce((s, t) => s + t.esperaDias, 0);
    const triagemTotal = concluidos.reduce((s, t) => s + t.triagemDias, 0);
    const soma = esperaTotal + triagemTotal;
    const gargalo = soma > 0 ? {
        etapa: esperaTotal >= triagemTotal ? "ESPERA" : "TRIAGEM",
        participacao: arredondar(Math.max(esperaTotal, triagemTotal) / soma, 4),
        descricao: esperaTotal >= triagemTotal
            ? "A maior parte do tempo é a espera entre a entrada do lote e o início da triagem (fila do almoxarifado)."
            : "A maior parte do tempo é a própria triagem (capacidade dos operadores)."
    } : null;

    // Lotes atípicos: tempo total acima do limite de Tukey.
    const totais = concluidos.map(t => t.totalDias);
    const limite = limiteAtipico(totais);
    const lotesAtipicos = limite === null ? [] : concluidos
        .filter(t => t.totalDias > limite)
        .sort((a, b) => b.totalDias - a.totalDias)
        .map(t => ({ loteId: t.lote.id, organizacaoId: t.lote.organizacaoId, totalDias: arredondar(t.totalDias), operador: t.lote.triagemIniciadaPor }));

    const aguardando = lotes.filter(l => l.statusProcessamento === StatusLote.RECEBIDO);
    const emTriagem = lotes.filter(l => l.statusProcessamento === StatusLote.EM_TRIAGEM && l.triagemIniciadaEm);

    return {
        lotesConsiderados: lotes.length,
        lotesComTriagemConcluida: concluidos.length,
        temposDias: {
            espera: resumir(concluidos.map(t => t.esperaDias)),
            triagem: resumir(concluidos.map(t => t.triagemDias)),
            total: resumir(totais)
        },
        gargalo,
        porOperador,
        porMes,
        lotesAtipicos: { limiteDias: limite === null ? null : arredondar(limite), lotes: lotesAtipicos },
        pendencias: {
            aguardandoTriagem: pendencia(aguardando, l => l.dataEntrada, agora),
            emTriagem: pendencia(emTriagem, l => l.triagemIniciadaEm!, agora)
        }
    };
}

export type ResultadoEficiencia = ReturnType<typeof analisarEficiencia>;
