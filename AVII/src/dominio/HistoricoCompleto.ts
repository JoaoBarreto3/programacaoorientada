import Equipamento from "./Equipamento";
import Lote from "./Lote";
import Organizacao from "./Organizacao";

export interface RegistroAuditoriaResumo {
    id: string;
    dataHora: Date;
    operacao: string;
    usuario: string;
}

// Rastreabilidade completa de um equipamento: origem (organização e lote), todas as
// movimentações, as operações de auditoria que o afetaram e a avaliação financeira atual.
export default interface HistoricoCompleto {
    equipamento: Equipamento;
    lote: Lote;
    organizacao: Organizacao;
    auditoria: RegistroAuditoriaResumo[];
    depreciacao: number;
    valorResidual: number;
}
