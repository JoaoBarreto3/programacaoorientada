import EstadoFisico from "../dominio/enums/EstadoFisico";
import StatusRastreamento from "../dominio/enums/StatusRastreamento";
import TipoEquipamento from "../dominio/enums/TipoEquipamento";
import { arredondar, resumir } from "./estatistica";

// Análise de rentabilidade por tipo de equipamento: valor médio de recuperação (valor residual =
// valor de referência do tipo × (1 − depreciação por idade e estado físico)), detalhado por estado
// físico, marca e modelo. Responde à pergunta "quais equipamentos dão maior retorno financeiro?".

export interface EquipamentoParaRentabilidade {
    id: string;
    tipo: TipoEquipamento;
    marca: string;
    modelo: string;
    estadoFisico: EstadoFisico;
    statusRastreamento: StatusRastreamento;
    pesoQuilogramas: number;
    valorReferencia: number;
    valorRecuperacao: number;
}

// Grupos com menos itens que isto não entram nos rankings de marca/modelo (média pouco confiável).
export const MINIMO_POR_GRUPO = 2;
const TOP = 10;

const soma = (valores: number[]) => valores.reduce((a, b) => a + b, 0);

function agrupar<T>(itens: readonly T[], chave: (item: T) => string): Map<string, T[]> {
    const grupos = new Map<string, T[]>();
    for (const item of itens) {
        const k = chave(item);
        grupos.set(k, [...(grupos.get(k) ?? []), item]);
    }
    return grupos;
}

function ranking(itens: EquipamentoParaRentabilidade[], chave: (e: EquipamentoParaRentabilidade) => string, minimo = MINIMO_POR_GRUPO) {
    return [...agrupar(itens, chave).entries()]
        .filter(([, grupo]) => grupo.length >= minimo)
        .map(([nome, grupo]) => ({
            nome, quantidade: grupo.length, valorMedio: arredondar(soma(grupo.map(e => e.valorRecuperacao)) / grupo.length)
        }))
        .sort((a, b) => b.valorMedio - a.valorMedio || b.quantidade - a.quantidade || a.nome.localeCompare(b.nome))
        .slice(0, TOP);
}

export function analisarRentabilidade(itens: readonly EquipamentoParaRentabilidade[]) {
    const total = soma(itens.map(e => e.valorRecuperacao));
    const porTipo = [...agrupar(itens, e => e.tipo).entries()].map(([tipo, grupo]) => {
        const valores = grupo.map(e => e.valorRecuperacao);
        const valorTotal = soma(valores);
        const peso = soma(grupo.map(e => e.pesoQuilogramas));
        const porEstado = Object.values(EstadoFisico)
            .map(estado => grupo.filter(e => e.estadoFisico === estado))
            .filter(g => g.length > 0)
            .map(g => ({ estadoFisico: g[0]!.estadoFisico, quantidade: g.length, valorMedio: arredondar(soma(g.map(e => e.valorRecuperacao)) / g.length) }));
        return {
            tipo: tipo as TipoEquipamento,
            quantidade: grupo.length,
            valorRecuperacao: resumir(valores)!,
            valorTotal: arredondar(valorTotal),
            participacaoNoValor: total > 0 ? arredondar(valorTotal / total, 4) : 0,
            valorPorKg: peso > 0 ? arredondar(valorTotal / peso) : 0,
            // Fração do valor de um equipamento novo que ainda é recuperável, em média.
            retornoSobreReferencia: arredondar(soma(grupo.map(e => e.valorReferencia > 0 ? e.valorRecuperacao / e.valorReferencia : 0)) / grupo.length, 4),
            porEstadoFisico: porEstado,
            marcas: ranking(grupo, e => e.marca, 1),
            modelos: ranking(grupo, e => `${e.marca} ${e.modelo}`, 1)
        };
    }).sort((a, b) => b.valorRecuperacao.media - a.valorRecuperacao.media);

    return {
        equipamentos: itens.length,
        valorTotalRecuperavel: arredondar(total),
        // Ordem de prioridade: tipos com maior valor médio de recuperação primeiro.
        prioridade: porTipo.map((t, i) => ({ posicao: i + 1, tipo: t.tipo, valorMedio: t.valorRecuperacao.media, valorPorKg: t.valorPorKg })),
        porTipo,
        melhoresMarcas: ranking([...itens], e => e.marca),
        melhoresModelos: ranking([...itens], e => `${e.marca} ${e.modelo}`)
    };
}

export type ResultadoRentabilidade = ReturnType<typeof analisarRentabilidade>;

export interface ConsultaEstimativa {
    tipo: TipoEquipamento;
    marca?: string;
    modelo?: string;
    estadoFisico?: EstadoFisico;
}

// Estimativa do valor de recuperação de um equipamento ainda não recebido, a partir do histórico.
// Usa o grupo mais específico que tenha amostra suficiente (modelo → marca → estado → tipo):
// quanto mais parecido o grupo, melhor a estimativa, desde que haja dados para sustentá-la.
export function estimarValorRecuperacao(itens: readonly EquipamentoParaRentabilidade[], consulta: ConsultaEstimativa, minimo = 3) {
    const igual = (a?: string, b?: string) => a !== undefined && b !== undefined && a.trim().toLowerCase() === b.trim().toLowerCase();
    const niveis: { base: string; filtro: (e: EquipamentoParaRentabilidade) => boolean; aplicavel: boolean }[] = [
        { base: "TIPO_MARCA_MODELO_ESTADO", aplicavel: !!(consulta.marca && consulta.modelo && consulta.estadoFisico),
            filtro: e => igual(e.marca, consulta.marca) && igual(e.modelo, consulta.modelo) && e.estadoFisico === consulta.estadoFisico },
        { base: "TIPO_MARCA_MODELO", aplicavel: !!(consulta.marca && consulta.modelo),
            filtro: e => igual(e.marca, consulta.marca) && igual(e.modelo, consulta.modelo) },
        { base: "TIPO_MARCA_ESTADO", aplicavel: !!(consulta.marca && consulta.estadoFisico),
            filtro: e => igual(e.marca, consulta.marca) && e.estadoFisico === consulta.estadoFisico },
        { base: "TIPO_ESTADO", aplicavel: !!consulta.estadoFisico, filtro: e => e.estadoFisico === consulta.estadoFisico },
        { base: "TIPO_MARCA", aplicavel: !!consulta.marca, filtro: e => igual(e.marca, consulta.marca) },
        { base: "TIPO", aplicavel: true, filtro: () => true }
    ];
    const doTipo = itens.filter(e => e.tipo === consulta.tipo);
    for (const nivel of niveis.filter(n => n.aplicavel)) {
        const amostra = doTipo.filter(nivel.filtro).map(e => e.valorRecuperacao);
        if (amostra.length >= minimo || (nivel.base === "TIPO" && amostra.length > 0)) {
            const r = resumir(amostra)!;
            return {
                consulta, base: nivel.base, amostra: r.n, valorEstimado: r.mediana,
                faixaProvavel: { de: r.p25, ate: r.p75 }, confiavel: r.n >= minimo
            };
        }
    }
    return { consulta, base: "SEM_DADOS", amostra: 0, valorEstimado: null, faixaProvavel: null, confiavel: false };
}
