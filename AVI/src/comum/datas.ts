import { ErroValidacao } from "./erros";

const MS_POR_DIA = 24 * 60 * 60 * 1000;

export function inicioDoDia(data: Date): Date {
    return new Date(data.getFullYear(), data.getMonth(), data.getDate());
}

export function adicionarDias(data: Date, dias: number): Date {
    const resultado = new Date(data.getTime());
    resultado.setDate(resultado.getDate() + dias);
    return resultado;
}

export function adicionarMeses(data: Date, meses: number): Date {
    const resultado = new Date(data.getTime());
    resultado.setMonth(resultado.getMonth() + meses);
    return resultado;
}

export function diferencaEmDias(a: Date, b: Date): number {
    return Math.round((inicioDoDia(a).getTime() - inicioDoDia(b).getTime()) / MS_POR_DIA);
}

export function lerData(texto: string): Date {
    const valor = texto.trim();
    let ano: number, mes: number, dia: number;
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
    const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(valor);
    if (iso) {
        ano = Number(iso[1]); mes = Number(iso[2]); dia = Number(iso[3]);
    } else if (br) {
        dia = Number(br[1]); mes = Number(br[2]); ano = Number(br[3]);
    } else {
        throw new ErroValidacao(`Data inválida: "${texto}". Use AAAA-MM-DD ou DD/MM/AAAA.`);
    }
    const data = new Date(ano, mes - 1, dia);
    if (data.getFullYear() !== ano || data.getMonth() !== mes - 1 || data.getDate() !== dia) {
        throw new ErroValidacao(`Data inexistente: "${texto}".`);
    }
    return data;
}

export function formatarData(data: Date): string {
    const d = String(data.getDate()).padStart(2, "0");
    const m = String(data.getMonth() + 1).padStart(2, "0");
    return `${d}/${m}/${data.getFullYear()}`;
}

export function formatarDataHora(data: Date): string {
    const h = String(data.getHours()).padStart(2, "0");
    const min = String(data.getMinutes()).padStart(2, "0");
    const s = String(data.getSeconds()).padStart(2, "0");
    return `${formatarData(data)} ${h}:${min}:${s}`;
}

export function dataParaISO(data: Date): string {
    const d = String(data.getDate()).padStart(2, "0");
    const m = String(data.getMonth() + 1).padStart(2, "0");
    return `${data.getFullYear()}-${m}-${d}`;
}

export interface Periodo {
    inicio: Date;
    fim: Date;
}

export function dentroDoPeriodo(data: Date, periodo: Periodo): boolean {
    const dia = inicioDoDia(data).getTime();
    return dia >= inicioDoDia(periodo.inicio).getTime() && dia <= inicioDoDia(periodo.fim).getTime();
}
