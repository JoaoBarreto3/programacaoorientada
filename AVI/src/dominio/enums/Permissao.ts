import PapelUsuario from "./PapelUsuario";

enum Permissao {
    USUARIOS_GERENCIAR = "USUARIOS_GERENCIAR",
    PARAMETROS_GERENCIAR = "PARAMETROS_GERENCIAR",
    PARAMETROS_LER = "PARAMETROS_LER",
    ORGANIZACOES_ESCREVER = "ORGANIZACOES_ESCREVER",
    ORGANIZACOES_LER = "ORGANIZACOES_LER",
    LOTES_ESCREVER = "LOTES_ESCREVER",
    LOTES_LER = "LOTES_LER",
    EQUIPAMENTOS_ESCREVER = "EQUIPAMENTOS_ESCREVER",
    EQUIPAMENTOS_LER = "EQUIPAMENTOS_LER",
    RELATORIOS_GERAR = "RELATORIOS_GERAR",
    JOURNAL_LER = "JOURNAL_LER",
    JOURNAL_REVERTER = "JOURNAL_REVERTER"
}

export const PERMISSOES_POR_PAPEL: Record<PapelUsuario, ReadonlySet<Permissao>> = {
    [PapelUsuario.ADMINISTRADOR]: new Set(Object.values(Permissao)),
    [PapelUsuario.OPERADOR_CADASTRO]: new Set([
        Permissao.ORGANIZACOES_ESCREVER,
        Permissao.ORGANIZACOES_LER
    ]),
    [PapelUsuario.GESTOR_ALMOXARIFADO]: new Set([
        Permissao.ORGANIZACOES_LER,
        Permissao.LOTES_ESCREVER,
        Permissao.LOTES_LER,
        Permissao.EQUIPAMENTOS_ESCREVER,
        Permissao.EQUIPAMENTOS_LER
    ]),
    [PapelUsuario.AUDITOR]: new Set([
        Permissao.PARAMETROS_LER,
        Permissao.ORGANIZACOES_LER,
        Permissao.LOTES_LER,
        Permissao.EQUIPAMENTOS_LER,
        Permissao.RELATORIOS_GERAR,
        Permissao.JOURNAL_LER
    ])
};

export function papelPossui(papel: PapelUsuario, permissao: Permissao): boolean {
    return PERMISSOES_POR_PAPEL[papel].has(permissao);
}

export default Permissao;
