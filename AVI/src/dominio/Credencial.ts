import { pbkdf2Sync, randomBytes, timingSafeEqual } from "crypto";
import Autenticavel from "./Autenticavel";
import PapelUsuario from "./enums/PapelUsuario";

export const ALGORITMO_SENHA = "pbkdf2-sha256";
export const ITERACOES_PADRAO = 600_000;

export function calcularHashSenha(senha: string, saltHex: string, iteracoes: number): string {
    const hash = pbkdf2Sync(senha.normalize("NFC"), Buffer.from(saltHex, "hex"), iteracoes, 32, "sha256").toString("hex");
    return `${ALGORITMO_SENHA}$${iteracoes}$${hash}`;
}

export default class Credencial implements Autenticavel {
    public usuario: string;
    public hashSenha: string;
    public salt: string;
    public ultimoAcesso: Date;
    public papel: PapelUsuario;

    constructor(dados: { usuario: string; hashSenha: string; salt: string; ultimoAcesso: Date; papel: PapelUsuario }) {
        this.usuario = dados.usuario;
        this.hashSenha = dados.hashSenha;
        this.salt = dados.salt;
        this.ultimoAcesso = dados.ultimoAcesso;
        this.papel = dados.papel;
    }

    public verificarSenha(senhaPlana: string): boolean {
        const iteracoes = Number(this.hashSenha.split("$")[1]);
        if (!Number.isInteger(iteracoes) || iteracoes <= 0) {
            return false;
        }
        const calculado = Buffer.from(calcularHashSenha(senhaPlana, this.salt, iteracoes));
        const armazenado = Buffer.from(this.hashSenha);
        return calculado.length === armazenado.length && timingSafeEqual(calculado, armazenado);
    }

    public atualizarUltimoAcesso(): void {
        this.ultimoAcesso = new Date();
    }

    public autenticar(usuario: string, senha: string): boolean {
        return usuario === this.usuario && this.verificarSenha(senha);
    }

    public renovarToken(): string {
        return randomBytes(32).toString("hex");
    }
}

export function gerarSaltEHash(senha: string, iteracoes: number = ITERACOES_PADRAO): { salt: string; hashSenha: string } {
    const salt = randomBytes(16).toString("hex");
    return { salt, hashSenha: calcularHashSenha(senha, salt, iteracoes) };
}
