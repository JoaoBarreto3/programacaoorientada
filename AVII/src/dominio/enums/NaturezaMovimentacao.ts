// Na AV1 a natureza de uma movimentação era deduzida comparando os textos de origem e destino;
// agora é gravada explicitamente.
export const NaturezaMovimentacao = {
    LOCALIZACAO: "LOCALIZACAO",
    STATUS: "STATUS",
    ESTADO_FISICO: "ESTADO_FISICO"
} as const;
export type NaturezaMovimentacao = (typeof NaturezaMovimentacao)[keyof typeof NaturezaMovimentacao];

export default NaturezaMovimentacao;
