// A ordem de declaração é a escala de conservação: do melhor (NOVO) ao pior (INSERVIVEL).
export const EstadoFisico = {
    NOVO: "NOVO",
    BOM_ESTADO: "BOM_ESTADO",
    USADO_LEVE: "USADO_LEVE",
    USADO_MODERADO: "USADO_MODERADO",
    DANIFICADO_LEVE: "DANIFICADO_LEVE",
    DANIFICADO_GRAVE: "DANIFICADO_GRAVE",
    INSERVIVEL: "INSERVIVEL"
} as const;
export type EstadoFisico = (typeof EstadoFisico)[keyof typeof EstadoFisico];

const ESCALA: EstadoFisico[] = Object.values(EstadoFisico);

export function nivelEstadoFisico(estado: EstadoFisico): number {
    return ESCALA.indexOf(estado);
}

// Quantas categorias o estado caiu (positivo = piorou).
export function degradacaoEstado(anterior: EstadoFisico, novo: EstadoFisico): number {
    return nivelEstadoFisico(novo) - nivelEstadoFisico(anterior);
}

export default EstadoFisico;
