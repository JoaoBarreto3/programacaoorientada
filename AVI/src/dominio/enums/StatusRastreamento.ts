enum StatusRastreamento {
    AGUARDANDO_TRIAGEM = "AGUARDANDO_TRIAGEM",
    EM_TRIAGEM = "EM_TRIAGEM",
    AGUARDANDO_DESMONTE = "AGUARDANDO_DESMONTE",
    EM_DESMONTE = "EM_DESMONTE",
    PECAS_REAPROVEITADAS = "PECAS_REAPROVEITADAS",
    MATERIAL_RECICLAVEL = "MATERIAL_RECICLAVEL",
    DESCARTE_SEGURO = "DESCARTE_SEGURO",
    BAIXA_DEFINITIVA = "BAIXA_DEFINITIVA"
}

export const STATUS_DESMONTE: ReadonlySet<StatusRastreamento> = new Set([
    StatusRastreamento.AGUARDANDO_DESMONTE,
    StatusRastreamento.EM_DESMONTE
]);

export const TRANSICOES_STATUS: Record<StatusRastreamento, StatusRastreamento[]> = {
    [StatusRastreamento.AGUARDANDO_TRIAGEM]: [StatusRastreamento.EM_TRIAGEM],
    [StatusRastreamento.EM_TRIAGEM]: [
        StatusRastreamento.AGUARDANDO_DESMONTE,
        StatusRastreamento.PECAS_REAPROVEITADAS,
        StatusRastreamento.DESCARTE_SEGURO
    ],
    [StatusRastreamento.AGUARDANDO_DESMONTE]: [StatusRastreamento.EM_DESMONTE],
    [StatusRastreamento.EM_DESMONTE]: [
        StatusRastreamento.PECAS_REAPROVEITADAS,
        StatusRastreamento.MATERIAL_RECICLAVEL,
        StatusRastreamento.DESCARTE_SEGURO
    ],
    [StatusRastreamento.PECAS_REAPROVEITADAS]: [StatusRastreamento.BAIXA_DEFINITIVA],
    [StatusRastreamento.MATERIAL_RECICLAVEL]: [StatusRastreamento.BAIXA_DEFINITIVA],
    [StatusRastreamento.DESCARTE_SEGURO]: [StatusRastreamento.BAIXA_DEFINITIVA],
    [StatusRastreamento.BAIXA_DEFINITIVA]: []
};

export default StatusRastreamento;
