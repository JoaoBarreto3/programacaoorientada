import Permissao, { papelPossui } from "../dominio/enums/Permissao";
import EscopoApi, { PERMISSOES_POR_ESCOPO } from "../dominio/enums/EscopoApi";
import { Ator, ehParceiro, ParceiroAutenticado } from "../dominio/Sessao";
import { ErroNaoEncontrado, ErroPermissao } from "../comum/erros";

// A autorização é decidida nos serviços (e não nas rotas), para valer em qualquer interface
// que use a camada de negócio: HTTP (usuário ou parceiro), worker da fila, CLI.
export function possuiPermissao(ator: Ator, permissao: Permissao): boolean {
    if (ehParceiro(ator)) {
        return ator.escopos.some(escopo => PERMISSOES_POR_ESCOPO[escopo].includes(permissao));
    }
    return papelPossui(ator.papel, permissao);
}

export function exigirPermissao(ator: Ator, permissao: Permissao): void {
    if (!possuiPermissao(ator, permissao)) {
        throw new ErroPermissao(ehParceiro(ator)
            ? `A chave de API não possui o escopo necessário para esta operação.`
            : `O perfil ${ator.papel} não tem permissão para esta operação.`);
    }
}

export function exigirEscopo(parceiro: ParceiroAutenticado, escopo: EscopoApi): void {
    if (!parceiro.escopos.includes(escopo)) {
        throw new ErroPermissao(`A chave de API não possui o escopo ${escopo}.`);
    }
}

// Isolamento entre clientes: uma chave ligada a uma organização só enxerga os dados dela.
// Recurso de outra organização responde 404 (e não 403) para não revelar que ele existe.
export function exigirMesmaOrganizacao(ator: Ator, organizacaoId: string, recurso: string): void {
    if (ehParceiro(ator) && ator.organizacaoId !== null && ator.organizacaoId !== organizacaoId) {
        throw new ErroNaoEncontrado(`${recurso} não encontrado.`);
    }
}

// Organização a que a consulta se restringe: a da chave (se houver) ou a pedida pelo usuário.
export function organizacaoDoEscopo(ator: Ator, pedida?: string): string | undefined {
    if (ehParceiro(ator) && ator.organizacaoId !== null) {
        if (pedida && pedida !== ator.organizacaoId) {
            throw new ErroPermissao("A chave de API só dá acesso aos dados da própria organização.");
        }
        return ator.organizacaoId;
    }
    return pedida;
}
