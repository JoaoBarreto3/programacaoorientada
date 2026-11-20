import { ErroValidacao } from "./erros";

// Datas "civis" (sem hora: data de entrada do lote, assinatura e vencimento de contrato)
// são representadas como Date à meia-noite UTC, que é como o PostgreSQL devolve colunas DATE.
// Assim a data não "volta um dia" em fusos negativos como o de Brasília (UTC-3).

const MS_POR_DIA = 24 * 60 * 60 * 1000;

// Converte um instante na data do calendário local (fuso do servidor), à meia-noite UTC.
export function dataCivil(instante: Date): Date {
    return new Date(Date.UTC(instante.getFullYear(), instante.getMonth(), instante.getDate()));
}

export function adicionarDias(data: Date, dias: number): Date {
    return new Date(data.getTime() + dias * MS_POR_DIA);
}

export function adicionarMeses(data: Date, meses: number): Date {
    const resultado = new Date(data.getTime());
    resultado.setUTCMonth(resultado.getUTCMonth() + meses);
    return resultado;
}

// Diferença em dias entre duas datas civis (a - b).
export function diferencaEmDias(a: Date, b: Date): number {
    return Math.round((a.getTime() - b.getTime()) / MS_POR_DIA);
}

// Aceita AAAA-MM-DD (padrão da API) e DD/MM/AAAA. Também aceita um ISO completo, usando só a data.
export function lerData(texto: string, campo: string = "data"): Date {
    const valor = String(texto ?? "").trim();
    const iso = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(valor);
    const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(valor);
    let ano: number, mes: number, dia: number;
    if (iso) {
        ano = Number(iso[1]); mes = Number(iso[2]); dia = Number(iso[3]);
    } else if (br) {
        dia = Number(br[1]); mes = Number(br[2]); ano = Number(br[3]);
    } else {
        throw new ErroValidacao(`${campo}: "${valor}" não é uma data válida. Use AAAA-MM-DD.`);
    }
    const data = new Date(Date.UTC(ano, mes - 1, dia));
    if (data.getUTCFullYear() !== ano || data.getUTCMonth() !== mes - 1 || data.getUTCDate() !== dia) {
        throw new ErroValidacao(`${campo}: a data "${valor}" não existe.`);
    }
    return data;
}

export function dataParaISO(data: Date): string {
    return data.toISOString().slice(0, 10);
}

export function formatarData(data: Date): string {
    const [ano, mes, dia] = dataParaISO(data).split("-");
    return `${dia}/${mes}/${ano}`;
}

export interface Periodo {
    inicio: Date;
    fim: Date;
}

export function validarPeriodo(periodo: Periodo): void {
    if (periodo.fim.getTime() < periodo.inicio.getTime()) {
        throw new ErroValidacao("Período inválido: a data final é anterior à inicial.");
    }
}
