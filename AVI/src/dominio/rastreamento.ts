import Equipamento from "./Equipamento";
import Movimentacao from "./Movimentacao";
import EstadoFisico from "./enums/EstadoFisico";
import StatusRastreamento from "./enums/StatusRastreamento";

export type NaturezaMovimentacao = "STATUS" | "ESTADO_FISICO" | "LOCALIZACAO";

const STATUS = new Set<string>(Object.values(StatusRastreamento));
const ESTADOS = new Set<string>(Object.values(EstadoFisico));

export function naturezaMovimentacao(m: Movimentacao): NaturezaMovimentacao {
    if (STATUS.has(m.destino) && STATUS.has(m.origem)) return "STATUS";
    if (ESTADOS.has(m.destino) && ESTADOS.has(m.origem)) return "ESTADO_FISICO";
    return "LOCALIZACAO";
}

export function nomeReservado(local: string): boolean {
    const normalizado = local.trim().toUpperCase();
    return STATUS.has(normalizado) || ESTADOS.has(normalizado);
}

export function localizacaoAtual(equipamento: Equipamento): string | null {
    const locais = equipamento.historicoMovimentacao.filter(m => naturezaMovimentacao(m) === "LOCALIZACAO");
    return locais[locais.length - 1]?.destino ?? null;
}
