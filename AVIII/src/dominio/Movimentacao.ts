import { randomUUID } from "node:crypto";
import NaturezaMovimentacao from "./enums/NaturezaMovimentacao";

// Registro imutável do histórico de um equipamento (mudança de local, de status ou de estado físico).
export default class Movimentacao {
    public readonly id: string;
    public readonly equipamentoId: string;
    public readonly natureza: NaturezaMovimentacao;
    public readonly dataHora: Date;
    public readonly origem: string;
    public readonly destino: string;
    public readonly responsavel: string;
    public readonly observacao: string;

    constructor(dados: {
        equipamentoId: string; natureza: NaturezaMovimentacao; dataHora: Date; origem: string; destino: string;
        responsavel: string; observacao: string; id?: string;
    }) {
        this.id = dados.id ?? randomUUID();
        this.equipamentoId = dados.equipamentoId;
        this.natureza = dados.natureza;
        this.dataHora = dados.dataHora;
        this.origem = dados.origem;
        this.destino = dados.destino;
        this.responsavel = dados.responsavel;
        this.observacao = dados.observacao;
    }

    public paraJSON() {
        return {
            id: this.id, equipamentoId: this.equipamentoId, natureza: this.natureza,
            dataHora: this.dataHora.toISOString(), origem: this.origem, destino: this.destino,
            responsavel: this.responsavel, observacao: this.observacao
        };
    }
}
