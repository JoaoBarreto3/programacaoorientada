import Validador from "./Validador";

export default class ValidadorEmail extends Validador {
    public validar(email: string): boolean {
        const valido = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
        this.mensagemErro = valido ? "" : `E-mail "${email}" inválido.`;
        return valido;
    }
}
