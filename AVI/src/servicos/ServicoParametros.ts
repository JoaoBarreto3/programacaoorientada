import ParametrosGlobais, { ParametrosJSON } from "../dominio/ParametrosGlobais";
import Permissao from "../dominio/enums/Permissao";
import TipoEquipamento from "../dominio/enums/TipoEquipamento";
import RepositorioArquivo from "../infra/RepositorioArquivo";
import GerenciadorJournal from "../infra/GerenciadorJournal";
import JournalTransacao from "../infra/JournalTransacao";
import RegistroMudancas from "../infra/RegistroMudancas";
import Arquivos from "../infra/Arquivos";
import { ErroValidacao } from "../comum/erros";
import { lerEnum } from "../comum/enums";
import ContextoSessao from "./ContextoSessao";

export const GRUPOS_PARAMETROS = ["aliquota", "depreciacao", "valor", "retencao"] as const;

export default class ServicoParametros {
    private readonly repositorio: RepositorioArquivo;
    private readonly diario: GerenciadorJournal;
    private readonly contexto: ContextoSessao;

    constructor(repositorio: RepositorioArquivo, diario: GerenciadorJournal, contexto: ContextoSessao) {
        this.repositorio = repositorio;
        this.diario = diario;
        this.contexto = contexto;
    }

    public obter(): ParametrosGlobais {
        const json = this.repositorio.carregarEntidade(Arquivos.PARAMETROS, ParametrosGlobais.ID) as ParametrosJSON | null;
        return json ? ParametrosGlobais.deJSON(json) : ParametrosGlobais.padrao();
    }

    public consultar(): ParametrosGlobais {
        this.contexto.exigir(Permissao.PARAMETROS_LER);
        return this.obter();
    }

    public gravarPadrao(): void {
        this.gravar(ParametrosGlobais.padrao(), "PARAMETROS_INICIAIS", "sistema");
    }

    public definir(grupo: string, chave: string, valor: number): ParametrosGlobais {
        const sessao = this.contexto.exigir(Permissao.PARAMETROS_GERENCIAR);
        if (!Number.isFinite(valor)) {
            throw new ErroValidacao("Valor numérico inválido.");
        }
        const parametros = this.obter();
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
        this.gravar(parametros, `PARAMETRO_DEFINIR ${grupo}.${chave}`, sessao.usuario);
        return parametros;
    }

    private gravar(parametros: ParametrosGlobais, operacao: string, usuario: string): void {
        const mudancas = new RegistroMudancas(this.repositorio);
        mudancas.salvar(Arquivos.PARAMETROS, parametros.paraJSON());
        new JournalTransacao({
            operacao, entidade: "Parâmetros globais", usuarioResponsavel: usuario,
            dadosAntes: mudancas.antes, dadosDepois: mudancas.depois
        }, this.diario).registrar();
    }
}
