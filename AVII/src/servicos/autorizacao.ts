import Permissao, { papelPossui } from "../dominio/enums/Permissao";
import { UsuarioAutenticado } from "../dominio/Sessao";
import { ErroPermissao } from "../comum/erros";

// A autorização é decidida nos serviços (e não nas rotas), para valer em qualquer interface
// que use a camada de negócio: HTTP hoje, CLI ou mensageria amanhã.
export function exigirPermissao(usuario: UsuarioAutenticado, permissao: Permissao): void {
    if (!papelPossui(usuario.papel, permissao)) {
        throw new ErroPermissao(`O perfil ${usuario.papel} não tem permissão para esta operação.`);
    }
}
