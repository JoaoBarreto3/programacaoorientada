import {
    linearRegression, linearRegressionLine, max, mean, median, min, quantile, rSquared, sampleStandardDeviation
} from "simple-statistics";

// Fachada sobre a biblioteca simple-statistics. As análises dependem só destas funções, então
// trocar a biblioteca (por exemplo, pela mathjs) afetaria apenas este arquivo.

export function arredondar(valor: number, casas = 2): number {
    const fator = 10 ** casas;
    return Math.round(valor * fator) / fator;
}

export interface Resumo {
    n: number;
    media: number;
    mediana: number;
    desvioPadrao: number;
    minimo: number;
    maximo: number;
    p25: number;
    p75: number;
    p90: number;
}

// Estatística descritiva de uma amostra. Com amostra vazia devolve null (nada a resumir).
// O desvio padrão é o amostral (n - 1), o adequado para estimar a variação do processo
// a partir de uma amostra dos lotes; com um único valor ele é 0.
export function resumir(valores: readonly number[], casas = 2): Resumo | null {
    if (valores.length === 0) return null;
    const [p25, p75, p90] = quantile(valores, [0.25, 0.75, 0.9]);
    return {
        n: valores.length,
        media: arredondar(mean(valores), casas),
        mediana: arredondar(median(valores), casas),
        desvioPadrao: arredondar(valores.length > 1 ? sampleStandardDeviation(valores) : 0, casas),
        minimo: arredondar(min(valores), casas),
        maximo: arredondar(max(valores), casas),
        p25: arredondar(p25!, casas),
        p75: arredondar(p75!, casas),
        p90: arredondar(p90!, casas)
    };
}

// Limite superior de Tukey (Q3 + 1,5 × IQR): valores acima dele são atípicos (outliers).
// Exige ao menos 4 valores; com menos, não há base para chamar algo de atípico.
export function limiteAtipico(valores: readonly number[]): number | null {
    if (valores.length < 4) return null;
    const [q1, q3] = quantile(valores, [0.25, 0.75]);
    return q3! + 1.5 * (q3! - q1!);
}

export interface Regressao {
    // y = intercepto + inclinacao · x
    inclinacao: number;
    intercepto: number;
    // Coeficiente de determinação (0 a 1): quanto da variação de y a reta explica.
    r2: number;
    n: number;
}

// Regressão linear simples por mínimos quadrados ordinários (MQO).
// Devolve null quando não há como ajustar uma reta: menos de 2 pontos ou todos com o mesmo x.
export function regressaoLinear(pontos: readonly (readonly [number, number])[]): Regressao | null {
    if (pontos.length < 2) return null;
    const primeiroX = pontos[0]![0];
    if (pontos.every(p => p[0] === primeiroX)) return null;
    const dados = pontos.map(p => [p[0], p[1]]);
    const { m, b } = linearRegression(dados);
    const r2 = rSquared(dados, linearRegressionLine({ m, b }));
    return { inclinacao: m, intercepto: b, r2: Number.isFinite(r2) ? r2 : 0, n: pontos.length };
}
