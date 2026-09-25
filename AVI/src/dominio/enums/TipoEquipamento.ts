enum TipoEquipamento {
    COMPUTADOR_MESA = "COMPUTADOR_MESA",
    NOTEBOOK = "NOTEBOOK",
    MONITOR = "MONITOR",
    IMPRESSORA = "IMPRESSORA",
    SERVIDOR = "SERVIDOR",
    ROTEADOR = "ROTEADOR",
    CABO_ESTRUTURADO = "CABO_ESTRUTURADO",
    FONTE_ALIMENTACAO = "FONTE_ALIMENTACAO"
}

export const CODIGO_TIPO: Record<TipoEquipamento, string> = {
    [TipoEquipamento.COMPUTADOR_MESA]: "CPU",
    [TipoEquipamento.NOTEBOOK]: "NTB",
    [TipoEquipamento.MONITOR]: "MON",
    [TipoEquipamento.IMPRESSORA]: "IMP",
    [TipoEquipamento.SERVIDOR]: "SRV",
    [TipoEquipamento.ROTEADOR]: "ROT",
    [TipoEquipamento.CABO_ESTRUTURADO]: "CAB",
    [TipoEquipamento.FONTE_ALIMENTACAO]: "FNT"
};

export default TipoEquipamento;
