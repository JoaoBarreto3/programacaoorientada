import { randomUUID } from "crypto";
import type GerenciadorJournal from "./GerenciadorJournal";

export default class JournalTransacao {
    public id: string;
    public timestamp: Date;
    public operacao: string;
    public entidade: string;
    public dadosAntes: any;
    public dadosDepois: any;
    public usuarioResponsavel: string;
    private readonly diario: GerenciadorJournal;

    constructor(dados: {
        operacao: string; entidade: string; dadosAntes: any; dadosDepois: any; usuarioResponsavel: string;
        id?: string; timestamp?: Date;
    }, diario: GerenciadorJournal) {
        this.id = dados.id ?? randomUUID();
        this.timestamp = dados.timestamp ?? new Date();
        this.operacao = dados.operacao;
        this.entidade = dados.entidade;
        this.dadosAntes = dados.dadosAntes;
        this.dadosDepois = dados.dadosDepois;
        this.usuarioResponsavel = dados.usuarioResponsavel;
        this.diario = diario;
    }

    public registrar(): void {
        this.diario.executar(this);
    }

    public reverter(): boolean {
        return this.diario.reverter(this);
    }
}
