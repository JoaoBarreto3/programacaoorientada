import Autenticavel from "./Autenticavel";
import EntidadeVersionada from "./EntidadeVersionada";
import PapelUsuario from "./enums/PapelUsuario";
import { conferirSenha, gerarSaltEHash } from "./senha";
import { ErroRegraNegocio } from "../comum/erros";

export const MAX_TENTATIVAS_LOGIN = 5;
export const MINUTOS_BLOQUEIO = 15;

// Sucessor da classe Credencial da AV1: além do hash e do papel, guarda o controle de
// tentativas de login e a "versão de token", que invalida JWTs emitidos antes de um logout,
// troca de senha ou desativação (JWT é stateless; sem isso um token roubado valeria até expirar).
export default class Usuario extends EntidadeVersionada implements Autenticavel {
    public readonly id: string;
    public login: string;
    public hashSenha: string;
    public salt: string;
    public papel: PapelUsuario;
    public ativo: boolean;
    public ultimoAcesso: Date | null;
    public tentativasFalhas: number;
    public bloqueadoAte: Date | null;
    public versaoToken: number;
    public criadoEm: Date;

    constructor(dados: {
        id: string; login: string; hashSenha: string; salt: string; papel: PapelUsuario; ativo: boolean;
        ultimoAcesso: Date | null; tentativasFalhas: number; bloqueadoAte: Date | null; versaoToken: number;
        criadoEm: Date; versao: number;
    }) {
        super(dados.versao);
        this.id = dados.id;
        this.login = dados.login;
        this.hashSenha = dados.hashSenha;
        this.salt = dados.salt;
        this.papel = dados.papel;
        this.ativo = dados.ativo;
        this.ultimoAcesso = dados.ultimoAcesso;
        this.tentativasFalhas = dados.tentativasFalhas;
        this.bloqueadoAte = dados.bloqueadoAte;
        this.versaoToken = dados.versaoToken;
        this.criadoEm = dados.criadoEm;
    }

    public descricao(): string {
        return `O usuário ${this.login}`;
    }

    public verificarSenha(senhaPlana: string): Promise<boolean> {
        return conferirSenha(senhaPlana, this.salt, this.hashSenha);
    }

    public async autenticar(usuario: string, senha: string): Promise<boolean> {
        return this.ativo && usuario === this.login && await this.verificarSenha(senha);
    }

    public async definirSenha(senhaNova: string, iteracoes: number): Promise<void> {
        Object.assign(this, await gerarSaltEHash(senhaNova, iteracoes));
        this.invalidarTokens();
    }

    public estaBloqueado(agora: Date): boolean {
        return this.bloqueadoAte !== null && this.bloqueadoAte.getTime() > agora.getTime();
    }

    // Retorna true quando esta falha provocou o bloqueio.
    public registrarFalhaLogin(agora: Date): boolean {
        this.tentativasFalhas++;
        if (this.tentativasFalhas >= MAX_TENTATIVAS_LOGIN) {
            this.tentativasFalhas = 0;
            this.bloqueadoAte = new Date(agora.getTime() + MINUTOS_BLOQUEIO * 60_000);
            return true;
        }
        return false;
    }

    public registrarLogin(agora: Date): void {
        this.tentativasFalhas = 0;
        this.bloqueadoAte = null;
        this.ultimoAcesso = agora;
    }

    public atualizarUltimoAcesso(agora: Date): void {
        this.ultimoAcesso = agora;
    }

    public invalidarTokens(): void {
        this.versaoToken++;
    }

    public alterarPapel(papel: PapelUsuario): void {
        if (papel !== this.papel) {
            this.papel = papel;
            this.invalidarTokens();
        }
    }

    public desativar(): void {
        if (!this.ativo) {
            throw new ErroRegraNegocio(`O usuário ${this.login} já está desativado.`);
        }
        this.ativo = false;
        this.invalidarTokens();
    }

    public reativar(): void {
        if (this.ativo) {
            throw new ErroRegraNegocio(`O usuário ${this.login} já está ativo.`);
        }
        this.ativo = true;
        this.tentativasFalhas = 0;
        this.bloqueadoAte = null;
    }

    public paraJSON() {
        return {
            id: this.id, login: this.login, papel: this.papel, ativo: this.ativo,
            ultimoAcesso: this.ultimoAcesso?.toISOString() ?? null,
            bloqueadoAte: this.bloqueadoAte?.toISOString() ?? null,
            criadoEm: this.criadoEm.toISOString(), versao: this.versao
        };
    }
}
