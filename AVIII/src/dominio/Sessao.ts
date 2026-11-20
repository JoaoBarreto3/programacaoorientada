import PapelUsuario from "./enums/PapelUsuario";
import EscopoApi from "./enums/EscopoApi";
import PlanoApi from "./enums/PlanoApi";

// Sessão do UML da AV1, agora representada por um JWT assinado. O servidor não guarda a
// sessão em memória (API stateless): tudo o que ela precisa está no token.
export default class Sessao {
    public readonly token: string;
    public readonly usuarioId: string;
    public readonly usuario: string;
    public readonly papel: PapelUsuario;
    public readonly criacao: Date;
    public readonly expiracao: Date;

    constructor(dados: { token: string; usuarioId: string; usuario: string; papel: PapelUsuario; criacao: Date; expiracao: Date }) {
        this.token = dados.token;
        this.usuarioId = dados.usuarioId;
        this.usuario = dados.usuario;
        this.papel = dados.papel;
        this.criacao = dados.criacao;
        this.expiracao = dados.expiracao;
    }

    public isValida(agora: Date): boolean {
        return agora.getTime() < this.expiracao.getTime();
    }

    public paraJSON() {
        return {
            token: this.token,
            tipo: "Bearer",
            expiraEm: this.expiracao.toISOString(),
            usuario: { id: this.usuarioId, login: this.usuario, papel: this.papel }
        };
    }
}

// Dados do usuário autenticado que a camada HTTP injeta na requisição e repassa aos serviços,
// que decidem a autorização a partir do papel.
export interface UsuarioAutenticado {
    id: string;
    login: string;
    papel: PapelUsuario;
}

// AV3: parceiro externo autenticado por chave de API. "login" (api:<prefixo>) identifica o parceiro
// na auditoria e nas movimentações, do mesmo jeito que o login de um usuário.
export interface ParceiroAutenticado {
    id: string;
    login: string;
    nome: string;
    organizacaoId: string | null;
    escopos: readonly EscopoApi[];
    plano: PlanoApi;
}

// Quem executa uma operação de negócio: um usuário (papel) ou um parceiro (escopos).
export type Ator = UsuarioAutenticado | ParceiroAutenticado;

export function ehParceiro(ator: Ator): ator is ParceiroAutenticado {
    return "escopos" in ator;
}
