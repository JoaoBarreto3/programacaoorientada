import Equipamento from "./Equipamento";
import EstadoFisico from "./enums/EstadoFisico";
import StatusLote from "./enums/StatusLote";
import { ErroRegraNegocio } from "../comum/erros";
import { formatarData } from "../comum/datas";
import { formatarTabela } from "../comum/Tabela";

export default class Lote {
    public id: string;
    public dataEntrada: Date;
    public organizacaoId: string;
    public notaFiscal: string;
    public transportadora: string;
    public equipamentos: Equipamento[];
    public statusProcessamento: StatusLote;
    public observacoes: string;

    constructor(dados: {
        id: string; dataEntrada: Date; organizacaoId: string; notaFiscal: string; transportadora: string;
        equipamentos: Equipamento[]; statusProcessamento: StatusLote; observacoes: string;
    }) {
        this.id = dados.id;
        this.dataEntrada = dados.dataEntrada;
        this.organizacaoId = dados.organizacaoId;
        this.notaFiscal = dados.notaFiscal;
        this.transportadora = dados.transportadora;
        this.equipamentos = dados.equipamentos;
        this.statusProcessamento = dados.statusProcessamento;
        this.observacoes = dados.observacoes;
    }

    public adicionarEquipamento(equip: Equipamento): void {
        if (this.statusProcessamento !== StatusLote.RECEBIDO) {
            throw new ErroRegraNegocio(
                `O lote ${this.id} está em ${this.statusProcessamento}; só é possível incluir equipamentos em lotes RECEBIDOS.`);
        }
        if (this.equipamentos.some(e => e.id === equip.id)) {
            throw new ErroRegraNegocio(`O equipamento ${equip.id} já pertence ao lote ${this.id}.`);
        }
        equip.loteId = this.id;
        equip.posicaoNoLote = this.equipamentos.length + 1;
        this.equipamentos.push(equip);
    }

    public removerEquipamento(equipId: string): boolean {
        if (this.statusProcessamento !== StatusLote.RECEBIDO) {
            throw new ErroRegraNegocio("Equipamentos só podem ser removidos de lotes RECEBIDOS.");
        }
        const indice = this.equipamentos.findIndex(e => e.id === equipId);
        if (indice < 0) {
            return false;
        }
        if (this.equipamentos.length === 1) {
            throw new ErroRegraNegocio(`O lote ${this.id} deve conter ao menos um equipamento.`);
        }
        this.equipamentos.splice(indice, 1);
        this.equipamentos.forEach((e, i) => { e.posicaoNoLote = i + 1; });
        return true;
    }

    public calcularPesoTotal(): number {
        return this.equipamentos.reduce((soma, e) => soma + e.pesoQuilogramas, 0);
    }

    public gerarRelatorioTriagem(): string {
        const porEstado = Object.values(EstadoFisico)
            .map(estado => [estado, String(this.equipamentos.filter(e => e.estadoFisico === estado).length)])
            .filter(([, qtd]) => qtd !== "0");
        return [
            `Relatório de triagem — Lote ${this.id} (${this.statusProcessamento})`,
            `Organização: ${this.organizacaoId}   NF: ${this.notaFiscal}   Entrada: ${formatarData(this.dataEntrada)}`,
            `Equipamentos: ${this.equipamentos.length}   Peso total: ${this.calcularPesoTotal().toFixed(2)} kg`,
            "",
            formatarTabela(["#", "ID", "Código", "Tipo", "Estado", "Status"],
                this.equipamentos.map(e => [String(e.posicaoNoLote), e.id, e.codigoBarrasInterno, e.tipo,
                    e.estadoFisico, e.statusRastreamento])),
            "",
            "Distribuição por estado físico:",
            porEstado.length ? formatarTabela(["Estado", "Qtd"], porEstado) : "(sem equipamentos)"
        ].join("\n");
    }
}
