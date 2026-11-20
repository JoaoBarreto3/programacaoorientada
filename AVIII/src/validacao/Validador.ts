import { ErroValidacao } from "../comum/erros";

export default abstract class Validador {
    protected mensagemErro = "";

    public abstract validar(objeto: any): boolean;

    public obterMensagemErro(): string {
        return this.mensagemErro;
    }
}

export function exigirValido(validador: Validador, valor: unknown): void {
    if (!validador.validar(valor)) {
        throw new ErroValidacao(validador.obterMensagemErro());
    }
}
