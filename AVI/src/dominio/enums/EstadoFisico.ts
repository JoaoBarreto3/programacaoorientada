enum EstadoFisico {
    NOVO = "NOVO",
    BOM_ESTADO = "BOM_ESTADO",
    USADO_LEVE = "USADO_LEVE",
    USADO_MODERADO = "USADO_MODERADO",
    DANIFICADO_LEVE = "DANIFICADO_LEVE",
    DANIFICADO_GRAVE = "DANIFICADO_GRAVE",
    INSERVIVEL = "INSERVIVEL"
}

const ESCALA: EstadoFisico[] = Object.values(EstadoFisico);

export function nivelEstadoFisico(estado: EstadoFisico): number {
    return ESCALA.indexOf(estado);
}

export function degradacaoEstado(anterior: EstadoFisico, novo: EstadoFisico): number {
    return nivelEstadoFisico(novo) - nivelEstadoFisico(anterior);
}

export default EstadoFisico;
