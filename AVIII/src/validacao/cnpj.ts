
export function normalizarCNPJ(cnpj: string): string {
    return cnpj.toUpperCase().replace(/[.\/\-\s]/g, "");
}

export function calcularDigitoCNPJ(base: string): number {
    let soma = 0;
    let peso = 2;
    for (let i = base.length - 1; i >= 0; i--) {
        soma += (base.charCodeAt(i) - 48) * peso;
        peso = peso === 9 ? 2 : peso + 1;
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
}

export function formatarCNPJ(cnpj: string): string {
    const c = normalizarCNPJ(cnpj);
    return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
}
