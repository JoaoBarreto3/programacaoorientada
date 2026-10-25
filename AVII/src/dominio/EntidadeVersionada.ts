import { ErroConflito } from "../comum/erros";

// Base das entidades alteráveis. "versao" implementa o versionamento otimista pedido na AV2:
// o cliente devolve a versão que leu; se outra requisição gravou antes, a versão não confere
// e a alteração é recusada com HTTP 409 em vez de sobrescrever silenciosamente (lost update).
export default abstract class EntidadeVersionada {
    public versao: number;

    protected constructor(versao: number) {
        this.versao = versao;
    }

    public abstract descricao(): string;

    public verificarVersao(versaoEsperada: number | undefined): void {
        if (versaoEsperada !== undefined && versaoEsperada !== this.versao) {
            throw new ErroConflito(`${this.descricao()} foi alterado(a) por outra operação ` +
                `(versão atual ${this.versao}, informada ${versaoEsperada}). Recarregue os dados e tente novamente.`);
        }
    }
}
