export function formatarTabela(cabecalhos: string[], linhas: string[][]): string {
    const larguras = cabecalhos.map((c, i) =>
        Math.max(c.length, ...linhas.map(l => (l[i] ?? "").length)));
    const formatarLinha = (celulas: string[]) =>
        celulas.map((c, i) => c.padEnd(larguras[i] ?? 0)).join("  ").trimEnd();
    const separador = larguras.map(l => "-".repeat(l)).join("  ");
    return [formatarLinha(cabecalhos), separador, ...linhas.map(formatarLinha)].join("\n");
}

export function formatarMoeda(valor: number): string {
    return "R$ " + valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatarPercentual(fracao: number): string {
    return (fracao * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + "%";
}
