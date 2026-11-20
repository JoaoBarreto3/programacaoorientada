import TipoEquipamento, { CODIGO_TIPO } from "./enums/TipoEquipamento";

// Código de barras interno: GC + prefixo do tipo (3 letras) + sequência (7 dígitos) + dígito
// verificador (módulo 10, pesos 3/1 como no EAN). Ex.: GCNTB00000017.
export function digitoVerificador(numero: string): number {
    let soma = 0;
    for (let i = 0; i < numero.length; i++) {
        soma += Number(numero[i]) * ((numero.length - i) % 2 === 1 ? 3 : 1);
    }
    return (10 - (soma % 10)) % 10;
}

export function gerarCodigoBarras(tipo: TipoEquipamento, sequencia: number): string {
    const numero = String(sequencia).padStart(7, "0");
    return `GC${CODIGO_TIPO[tipo]}${numero}${digitoVerificador(numero)}`;
}

export function codigoBarrasValido(codigo: string): boolean {
    const m = /^GC[A-Z]{3}(\d{7})(\d)$/.exec(codigo);
    return !!m && digitoVerificador(m[1]!) === Number(m[2]);
}
