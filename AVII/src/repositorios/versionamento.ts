import EntidadeVersionada from "../dominio/EntidadeVersionada";
import { ErroConflito } from "../comum/erros";

// Toda gravação de uma entidade versionada usa "WHERE id = ? AND versao = ?". Se nenhuma linha
// foi afetada, outra transação alterou (ou excluiu) o registro depois que ele foi lido.
export function confirmarGravacao(afetados: number, entidade: EntidadeVersionada): void {
    if (afetados === 0) {
        throw new ErroConflito(`${entidade.descricao()} foi alterado(a) ou excluído(a) por outra operação. ` +
            "Recarregue os dados e tente novamente.");
    }
}

export function proximaVersao() {
    return { increment: 1 } as const;
}
