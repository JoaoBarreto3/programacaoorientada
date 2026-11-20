// Planos de acesso da API pública: cada plano tem um limite de requisições por minuto e de
// relatórios em processamento ao mesmo tempo (proteção do worker contra um único parceiro).
export const PlanoApi = {
    BASICO: "BASICO",
    PROFISSIONAL: "PROFISSIONAL",
    CORPORATIVO: "CORPORATIVO"
} as const;
export type PlanoApi = (typeof PlanoApi)[keyof typeof PlanoApi];

export interface LimitesPlano {
    requisicoesPorMinuto: number;
    relatoriosSimultaneos: number;
}

export const LIMITES_PLANO: Record<PlanoApi, LimitesPlano> = {
    [PlanoApi.BASICO]: { requisicoesPorMinuto: 60, relatoriosSimultaneos: 2 },
    [PlanoApi.PROFISSIONAL]: { requisicoesPorMinuto: 300, relatoriosSimultaneos: 5 },
    [PlanoApi.CORPORATIVO]: { requisicoesPorMinuto: 1200, relatoriosSimultaneos: 20 }
};

export default PlanoApi;
