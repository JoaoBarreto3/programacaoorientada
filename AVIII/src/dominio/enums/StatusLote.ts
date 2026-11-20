export const StatusLote = {
    RECEBIDO: "RECEBIDO",
    EM_TRIAGEM: "EM_TRIAGEM",
    TRIAGEM_CONCLUIDA: "TRIAGEM_CONCLUIDA",
    ENCAMINHADO: "ENCAMINHADO",
    FINALIZADO: "FINALIZADO"
} as const;
export type StatusLote = (typeof StatusLote)[keyof typeof StatusLote];

// Situações em que a triagem do lote já está completa (libera o desmonte).
export const LOTE_COM_TRIAGEM_COMPLETA: ReadonlySet<StatusLote> = new Set<StatusLote>([
    StatusLote.TRIAGEM_CONCLUIDA, StatusLote.ENCAMINHADO, StatusLote.FINALIZADO
]);

export default StatusLote;
