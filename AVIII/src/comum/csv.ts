// Geração de CSV (RFC 4180): separador vírgula, aspas duplas quando necessário, quebra CRLF e
// BOM UTF-8 (para o Excel reconhecer os acentos). Números com ponto decimal.
//
// Proteção contra "CSV injection": um texto vindo do usuário que comece com = + - @ (ou tab/CR)
// seria interpretado como fórmula pela planilha. Esses valores recebem um apóstrofo na frente.

export type ValorCsv = string | number | boolean | null | undefined | Date;

const INICIO_FORMULA = /^[=+\-@\t\r]/;

function celula(valor: ValorCsv): string {
    if (valor === null || valor === undefined) return "";
    if (valor instanceof Date) return valor.toISOString();
    if (typeof valor === "number") return Number.isFinite(valor) ? String(valor) : "";
    if (typeof valor === "boolean") return valor ? "true" : "false";
    const texto = INICIO_FORMULA.test(valor) ? `'${valor}` : valor;
    return /[",\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

export function gerarCsv<T>(colunas: { titulo: string; valor: (item: T) => ValorCsv }[], itens: readonly T[]): string {
    const linhas = [colunas.map(c => celula(c.titulo)).join(",")];
    for (const item of itens) {
        linhas.push(colunas.map(c => celula(c.valor(item))).join(","));
    }
    return "﻿" + linhas.join("\r\n") + "\r\n";
}
