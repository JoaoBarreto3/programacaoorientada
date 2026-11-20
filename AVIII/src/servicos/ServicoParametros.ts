import ParametrosGlobais from "../dominio/ParametrosGlobais";
import { UsuarioAutenticado } from "../dominio/Sessao";
import Permissao from "../dominio/enums/Permissao";
import TipoEquipamento from "../dominio/enums/TipoEquipamento";
import UnidadeDeTrabalho from "../repositorios/UnidadeDeTrabalho";
import Relogio from "../comum/Relogio";
import { ErroValidacao } from "../comum/erros";
import { lerEnum } from "../comum/enums";
import { exigirPermissao } from "./autorizacao";

export const GRUPOS_PARAMETROS = ["aliquota", "depreciacao", "valor", "retencao"] as const;
export type GrupoParametro = (typeof GRUPOS_PARAMETROS)[number];

// Parâmetros globais: alíquotas e coeficientes de depreciação (papel ADMINISTRADOR).
export default class ServicoParametros {
    constructor(private readonly uow: UnidadeDeTrabalho, private readonly relogio: Relogio) {}

    public obter(): Promise<ParametrosGlobais> {
        return this.uow.leitura.parametros.obter();
    }

    public async consultar(autenticado: UsuarioAutenticado): Promise<ParametrosGlobais> {
        exigirPermissao(autenticado, Permissao.PARAMETROS_LER);
        return this.obter();
    }

    public async definir(autenticado: UsuarioAutenticado, grupo: string, chave: string, valor: number, versao?: number): Promise<ParametrosGlobais> {
        exigirPermissao(autenticado, Permissao.PARAMETROS_GERENCIAR);
        if (!Number.isFinite(valor)) {
            throw new ErroValidacao("Valor numérico inválido.");
        }
        return this.alterar(autenticado, `PARAMETRO_DEFINIR`, `${grupo}.${chave}`, versao, parametros => {
            switch (grupo.toLowerCase()) {
                case "aliquota":
                    parametros.definirAliquota(chave.toUpperCase(), valor);
                    break;
                case "depreciacao":
                    parametros.definirCoeficienteDepreciacao(lerEnum(TipoEquipamento, chave, "tipo de equipamento"), valor);
                    break;
                case "valor":
                    parametros.definirValorReferencia(lerEnum(TipoEquipamento, chave, "tipo de equipamento"), valor);
                    break;
                case "retencao":
                    parametros.definirRetencao(valor);
                    break;
                default:
                    throw new ErroValidacao(`Grupo de parâmetro desconhecido: "${grupo}". Use: ${GRUPOS_PARAMETROS.join(", ")}.`);
            }
        });
    }

    public async removerAliquota(autenticado: UsuarioAutenticado, imposto: string, versao?: number): Promise<ParametrosGlobais> {
        exigirPermissao(autenticado, Permissao.PARAMETROS_GERENCIAR);
        return this.alterar(autenticado, "PARAMETRO_REMOVER", `aliquota.${imposto.toUpperCase()}`, versao,
            parametros => parametros.removerAliquota(imposto.toUpperCase()));
    }

    private alterar(autenticado: UsuarioAutenticado, operacao: string, alvo: string, versao: number | undefined,
        mudanca: (p: ParametrosGlobais) => void): Promise<ParametrosGlobais> {
        return this.uow.executar(async repos => {
            const parametros = await repos.parametros.obter();
            parametros.verificarVersao(versao);
            const antes = parametros.paraJSON();
            mudanca(parametros);
            await repos.parametros.atualizar(parametros);
            await repos.auditoria.registrar({
                operacao, entidade: "Parametros", entidadeId: alvo, usuario: autenticado.login,
                dataHora: this.relogio.agora(), antes, depois: parametros.paraJSON()
            });
            return parametros;
        });
    }
}
