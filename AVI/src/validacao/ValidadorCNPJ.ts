import Validador from "./Validador";
import { calcularDigitoCNPJ, normalizarCNPJ } from "./cnpj";

export default class ValidadorCNPJ extends Validador {
    public validar(cnpj: string): boolean {
        const c = normalizarCNPJ(cnpj ?? "");
        if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(c)) {
            this.mensagemErro = `CNPJ "${cnpj}" com formato inválido: são 12 caracteres (letras ou números) + 2 dígitos verificadores.`;
            return false;
        }
        if (/^(.)\1{13}$/.test(c)) {
            this.mensagemErro = `CNPJ "${cnpj}" inválido: sequência de caracteres repetidos.`;
            return false;
        }
        const dv1 = calcularDigitoCNPJ(c.slice(0, 12));
        const dv2 = calcularDigitoCNPJ(c.slice(0, 12) + dv1);
        if (c.slice(12) !== `${dv1}${dv2}`) {
            this.mensagemErro = `CNPJ "${cnpj}" inválido: dígitos verificadores não conferem.`;
            return false;
        }
        this.mensagemErro = "";
        return true;
    }
}
