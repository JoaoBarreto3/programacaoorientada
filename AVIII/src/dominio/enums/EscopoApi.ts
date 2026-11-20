import Permissao from "./Permissao";

// Escopos de uma chave de API: o que o parceiro externo pode fazer, conforme o contrato comercial.
export const EscopoApi = {
    RASTREABILIDADE_LER: "RASTREABILIDADE_LER",
    LOTES_LER: "LOTES_LER",
    LOTES_ESCREVER: "LOTES_ESCREVER",
    RELATORIOS_GERAR: "RELATORIOS_GERAR"
} as const;
export type EscopoApi = (typeof EscopoApi)[keyof typeof EscopoApi];

// Cada escopo concede um conjunto fechado de permissões da camada de negócio. Assim os mesmos
// serviços (com as mesmas regras e a mesma auditoria) atendem usuários e parceiros.
export const PERMISSOES_POR_ESCOPO: Record<EscopoApi, readonly Permissao[]> = {
    [EscopoApi.RASTREABILIDADE_LER]: [Permissao.EQUIPAMENTOS_LER],
    [EscopoApi.LOTES_LER]: [Permissao.LOTES_LER],
    [EscopoApi.LOTES_ESCREVER]: [Permissao.LOTES_ESCREVER],
    [EscopoApi.RELATORIOS_GERAR]: [Permissao.ANALISES_LER, Permissao.RELATORIOS_ASSINCRONOS]
};

export const DESCRICAO_ESCOPO: Record<EscopoApi, string> = {
    [EscopoApi.RASTREABILIDADE_LER]: "Consultar a rastreabilidade de equipamentos",
    [EscopoApi.LOTES_LER]: "Consultar lotes e seus equipamentos",
    [EscopoApi.LOTES_ESCREVER]: "Submeter novos lotes (exige chave ligada a uma organização)",
    [EscopoApi.RELATORIOS_GERAR]: "Consultar análises e solicitar relatórios assíncronos"
};

export default EscopoApi;
