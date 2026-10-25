// Hierarquia de erros do greencode. Cada classe carrega o status HTTP correspondente,
// de modo que os serviços continuam independentes do protocolo (o mapeamento acontece
// apenas no tratador de erros da camada HTTP).

export type Severidade = "INFO" | "AVISO" | "ERRO" | "CRITICO";

export default class ErroGreencode extends Error {
    public readonly codigo: string;
    public readonly statusHttp: number;
    public readonly severidade: Severidade;

    constructor(mensagem: string, codigo: string, statusHttp: number, severidade: Severidade = "ERRO") {
        super(mensagem);
        this.name = new.target.name;
        this.codigo = codigo;
        this.statusHttp = statusHttp;
        this.severidade = severidade;
    }
}

export class ErroValidacao extends ErroGreencode {
    constructor(mensagem: string) {
        super(mensagem, "VALIDACAO", 400);
    }
}

export class ErroAutenticacao extends ErroGreencode {
    constructor(mensagem: string) {
        super(mensagem, "AUTENTICACAO", 401);
    }
}

export class ErroSessao extends ErroGreencode {
    constructor(mensagem: string = "Sessão expirada ou inválida. Faça login novamente.") {
        super(mensagem, "SESSAO", 401, "AVISO");
    }
}

export class ErroPermissao extends ErroGreencode {
    constructor(mensagem: string = "Operação não permitida para o seu perfil de acesso.") {
        super(mensagem, "PERMISSAO", 403);
    }
}

export class ErroNaoEncontrado extends ErroGreencode {
    constructor(mensagem: string) {
        super(mensagem, "NAO_ENCONTRADO", 404);
    }
}

// Versionamento otimista: o registro mudou desde que o cliente o leu.
export class ErroConflito extends ErroGreencode {
    constructor(mensagem: string) {
        super(mensagem, "CONFLITO", 409, "AVISO");
    }
}

export class ErroRegraNegocio extends ErroGreencode {
    constructor(mensagem: string) {
        super(mensagem, "REGRA_NEGOCIO", 422);
    }
}

export class ErroIntegridade extends ErroGreencode {
    constructor(mensagem: string) {
        super(mensagem, "INTEGRIDADE", 500, "CRITICO");
    }
}
