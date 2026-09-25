import Sessao from "../dominio/Sessao";
import Permissao, { papelPossui } from "../dominio/enums/Permissao";
import { ErroPermissao, ErroSessao } from "../comum/erros";

export default class ContextoSessao {
    public sessao: Sessao | null = null;

    public exigir(permissao?: Permissao): Sessao {
        const sessao = this.sessao;
        if (!sessao || !sessao.isValida()) {
            throw new ErroSessao();
        }
        if (permissao && !papelPossui(sessao.papel, permissao)) {
            throw new ErroPermissao(`O perfil ${sessao.papel} não tem permissão para esta operação.`);
        }
        return sessao;
    }

    public usuario(): string {
        return this.sessao?.usuario ?? "sistema";
    }
}
