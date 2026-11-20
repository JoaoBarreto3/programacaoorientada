import Validador from "./Validador";

export default class ValidadorNotaFiscal extends Validador {
    public validar(numero: string): boolean {
        const valido = /^\d{1,9}$/.test(numero) && Number(numero) !== 0;
        this.mensagemErro = valido ? "" : `Número de nota fiscal "${numero}" inválido: use de 1 a 9 dígitos, diferente de zero.`;
        return valido;
    }
}
