import { randomBytes, timingSafeEqual } from "crypto";
import Autenticavel from "./Autenticavel";
import Credencial from "./Credencial";
import PapelUsuario from "./enums/PapelUsuario";
import Relogio, { RelogioSistema } from "../comum/Relogio";

export const MINUTOS_INATIVIDADE = 30;

export default class Sessao implements Autenticavel {
    public token: string;
    public usuario: string;
    public papel: PapelUsuario;
    public criacao: Date;
    public expiracao: Date;
    private readonly relogio: Relogio;

    constructor(credencial: Credencial, relogio: Relogio = new RelogioSistema()) {
        this.relogio = relogio;
        this.token = credencial.renovarToken();
        this.usuario = credencial.usuario;
        this.papel = credencial.papel;
        this.criacao = relogio.agora();
        this.expiracao = this.proximaExpiracao();
    }

    private proximaExpiracao(): Date {
        return new Date(this.relogio.agora().getTime() + MINUTOS_INATIVIDADE * 60_000);
    }

    public isValida(): boolean {
        return this.relogio.agora().getTime() < this.expiracao.getTime();
    }

    public renovar(): void {
        if (this.isValida()) {
            this.expiracao = this.proximaExpiracao();
        }
    }

    public autenticar(usuario: string, senha: string): boolean {
        const a = Buffer.from(senha);
        const b = Buffer.from(this.token);
        return this.isValida() && usuario === this.usuario && a.length === b.length && timingSafeEqual(a, b);
    }

    public renovarToken(): string {
        this.token = randomBytes(32).toString("hex");
        this.renovar();
        return this.token;
    }
}
