import Equipamento from "./Equipamento";
import Lote from "./Lote";
import Movimentacao from "./Movimentacao";
import Organizacao from "./Organizacao";

export interface RegistroAuditoria {
    transacao: string;
    timestamp: Date;
    operacao: string;
    usuario: string;
}

export default interface HistoricoCompleto {
    equipamento: Equipamento;
    lote: Lote;
    organizacao: Organizacao;
    movimentacoes: Movimentacao[];
    auditoria: RegistroAuditoria[];
    depreciacao: number;
    valorResidual: number;
}
