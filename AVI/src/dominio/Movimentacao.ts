import { randomUUID } from "crypto";

export default class Movimentacao {
    public id: string;
    public equipamentoId: string;
    public dataHora: Date;
    public origem: string;
    public destino: string;
    public responsavel: string;
    public observacao: string;

    constructor(dados: {
        equipamentoId: string; dataHora: Date; origem: string; destino: string;
        responsavel: string; observacao: string; id?: string;
    }) {
        this.id = dados.id ?? `MV-${randomUUID()}`;
        this.equipamentoId = dados.equipamentoId;
        this.dataHora = dados.dataHora;
        this.origem = dados.origem;
        this.destino = dados.destino;
        this.responsavel = dados.responsavel;
        this.observacao = dados.observacao;
    }
}
