import * as path from "path";
import CriptografiaArquivo from "./infra/CriptografiaArquivo";
import RepositorioArquivo from "./infra/RepositorioArquivo";
import GerenciadorJournal, { RelatorioInicializacao } from "./infra/GerenciadorJournal";
import HistoricoComandos from "./infra/HistoricoComandos";
import Arquivos from "./infra/Arquivos";
import { ITERACOES_PADRAO } from "./dominio/Credencial";
import ValidadorCNPJ from "./validacao/ValidadorCNPJ";
import FabricaEquipamento from "./fabricas/FabricaEquipamento";
import Ambiente from "./fabricas/Ambiente";
import ContextoSessao from "./servicos/ContextoSessao";
import ServicoAutenticacao from "./servicos/ServicoAutenticacao";
import ServicoParametros from "./servicos/ServicoParametros";
import ServicoOrganizacao from "./servicos/ServicoOrganizacao";
import ServicoEquipamento from "./servicos/ServicoEquipamento";
import ServicoLote from "./servicos/ServicoLote";
import ServicoRelatorio from "./servicos/ServicoRelatorio";
import ServicoAuditoria from "./servicos/ServicoAuditoria";
import Relogio, { RelogioSistema } from "./comum/Relogio";

export interface OpcoesAplicacao {
    relogio?: Relogio;
    iteracoesSenha?: number;
    tamanhoMaximoJournal?: number;
}

export default class Aplicacao {
    public readonly relogio: Relogio;
    public readonly criptografia: CriptografiaArquivo;
    public readonly repositorio: RepositorioArquivo;
    public readonly contexto: ContextoSessao;
    public readonly journal: GerenciadorJournal;
    public readonly historico: HistoricoComandos;
    public readonly autenticacao: ServicoAutenticacao;
    public readonly parametros: ServicoParametros;
    public readonly organizacao: ServicoOrganizacao;
    public readonly equipamento: ServicoEquipamento;
    public readonly fabricaEquipamento: FabricaEquipamento;
    public readonly lote: ServicoLote;
    public readonly relatorio: ServicoRelatorio;
    public readonly auditoria: ServicoAuditoria;
    public readonly iteracoesSenha: number;

    constructor(diretorio: string, chave: string, opcoes: OpcoesAplicacao = {}) {
        this.relogio = opcoes.relogio ?? new RelogioSistema();
        this.iteracoesSenha = opcoes.iteracoesSenha ?? ITERACOES_PADRAO;
        this.criptografia = new CriptografiaArquivo();
        this.repositorio = new RepositorioArquivo(diretorio, this.criptografia, chave);
        this.contexto = new ContextoSessao();
        this.journal = new GerenciadorJournal({
            diretorio: path.join(diretorio, "journal"),
            criptografia: this.criptografia,
            chave,
            repositorio: this.repositorio,
            relogio: this.relogio,
            tamanhoMaximoBytes: opcoes.tamanhoMaximoJournal,
            retencaoDias: () => this.parametros.obter().retencaoJournalDias,
            usuarioAtual: () => this.contexto.usuario()
        });
        const ambiente: Ambiente = { relogio: this.relogio, parametros: () => this.parametros.obter() };
        this.historico = new HistoricoComandos(diretorio, this.criptografia, chave);
        this.autenticacao = new ServicoAutenticacao(this.repositorio, this.journal, this.relogio, this.contexto, this.iteracoesSenha);
        this.parametros = new ServicoParametros(this.repositorio, this.journal, this.contexto);
        this.organizacao = new ServicoOrganizacao(this.repositorio, this.journal, this.contexto, ambiente, new ValidadorCNPJ());
        this.equipamento = new ServicoEquipamento(this.repositorio, this.journal, this.contexto, ambiente);
        this.fabricaEquipamento = new FabricaEquipamento(this.repositorio, ambiente, this.equipamento);
        this.lote = new ServicoLote(this.repositorio, this.journal, this.contexto, ambiente, this.fabricaEquipamento);
        this.relatorio = new ServicoRelatorio(this.lote, this.equipamento, this.parametros, this.contexto, this.relogio);
        this.auditoria = new ServicoAuditoria(this.journal, this.contexto);
    }

    public inicializar(): RelatorioInicializacao {
        const relatorio = this.journal.inicializar();
        for (const arquivo of Object.values(Arquivos)) {
            this.repositorio.listarEntidades(arquivo);
        }
        return relatorio;
    }
}
