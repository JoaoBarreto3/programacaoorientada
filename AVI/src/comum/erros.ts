import Severidade from "./Severidade";

export default class ErroGreencode extends Error {
    public readonly severidade: Severidade;
    public readonly codigo: string;

    constructor(mensagem: string, severidade: Severidade = Severidade.ERRO, codigo: string = "ERRO_GENERICO") {
        super(mensagem);
        this.name = new.target.name;
        this.severidade = severidade;
        this.codigo = codigo;
    }
}

export class ErroValidacao extends ErroGreencode {
    constructor(mensagem: string) {
        super(mensagem, Severidade.ERRO, "VALIDACAO");
    }
}

export class ErroRegraNegocio extends ErroGreencode {
    constructor(mensagem: string) {
        super(mensagem, Severidade.ERRO, "REGRA_NEGOCIO");
    }
}

export class ErroNaoEncontrado extends ErroGreencode {
    constructor(mensagem: string) {
        super(mensagem, Severidade.ERRO, "NAO_ENCONTRADO");
    }
}

export class ErroPermissao extends ErroGreencode {
    constructor(mensagem: string = "Operação não permitida para o seu perfil de acesso.") {
        super(mensagem, Severidade.ERRO, "PERMISSAO");
    }
}

export class ErroAutenticacao extends ErroGreencode {
    constructor(mensagem: string) {
        super(mensagem, Severidade.ERRO, "AUTENTICACAO");
    }
}

export class ErroSessao extends ErroGreencode {
    constructor(mensagem: string = "Sessão expirada ou inválida. Faça login novamente.") {
        super(mensagem, Severidade.AVISO, "SESSAO");
    }
}

export class ErroIntegridade extends ErroGreencode {
    constructor(mensagem: string) {
        super(mensagem, Severidade.CRITICO, "INTEGRIDADE");
    }
}
