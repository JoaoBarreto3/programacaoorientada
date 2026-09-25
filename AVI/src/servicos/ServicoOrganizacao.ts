import Organizacao from "../dominio/Organizacao";
import Permissao from "../dominio/enums/Permissao";
import FabricaOrganizacao from "../fabricas/FabricaOrganizacao";
import Ambiente from "../fabricas/Ambiente";
import ValidadorCNPJ from "../validacao/ValidadorCNPJ";
import { formatarCNPJ } from "../validacao/cnpj";
import RepositorioArquivo from "../infra/RepositorioArquivo";
import GerenciadorJournal from "../infra/GerenciadorJournal";
import JournalTransacao from "../infra/JournalTransacao";
import RegistroMudancas from "../infra/RegistroMudancas";
import Arquivos from "../infra/Arquivos";
import { ErroRegraNegocio } from "../comum/erros";
import ContextoSessao from "./ContextoSessao";

export default class ServicoOrganizacao {
    public repositorio: RepositorioArquivo;
    public validadorCNPJ: ValidadorCNPJ;
    private readonly diario: GerenciadorJournal;
    private readonly contexto: ContextoSessao;
    private readonly fabrica: FabricaOrganizacao;

    constructor(repositorio: RepositorioArquivo, diario: GerenciadorJournal, contexto: ContextoSessao,
        ambiente: Ambiente, validadorCNPJ: ValidadorCNPJ) {
        this.repositorio = repositorio;
        this.validadorCNPJ = validadorCNPJ;
        this.diario = diario;
        this.contexto = contexto;
        this.fabrica = new FabricaOrganizacao(repositorio, ambiente, validadorCNPJ);
    }

    public cadastrarOrganizacao(dados: any): Organizacao {
        const sessao = this.contexto.exigir(Permissao.ORGANIZACOES_ESCREVER);
        const organizacao = this.fabrica.criar(dados);
        const duplicada = this.fabrica.listar().find(o => o.cnpj === organizacao.cnpj);
        if (duplicada) {
            throw new ErroRegraNegocio(
                `CNPJ ${formatarCNPJ(organizacao.cnpj)} já cadastrado para ${duplicada.id} (${duplicada.razaoSocial}).`);
        }
        const mudancas = new RegistroMudancas(this.repositorio);
        mudancas.salvar(Arquivos.CONTRATOS, this.fabrica.contratoParaRegistro(organizacao.contratoVigente));
        mudancas.salvar(Arquivos.ORGANIZACOES, this.fabrica.paraRegistro(organizacao));
        this.registrar("ORGANIZACAO_CRIAR", organizacao, mudancas, sessao.usuario);
        return organizacao;
    }

    public buscarOrganizacao(id: string): Organizacao {
        this.contexto.exigir(Permissao.ORGANIZACOES_LER);
        return this.fabrica.carregar(id);
    }

    public listarOrganizacoesAtivas(): Organizacao[] {
        this.contexto.exigir(Permissao.ORGANIZACOES_LER);
        return this.fabrica.listar().filter(o => o.ativo).sort((a, b) => a.id.localeCompare(b.id));
    }

    public renovarContrato(organizacaoId: string, novoVencimento: Date): void {
        const sessao = this.contexto.exigir(Permissao.ORGANIZACOES_ESCREVER);
        const organizacao = this.fabrica.carregar(organizacaoId);
        organizacao.contratoVigente.renovar(novoVencimento);
        const mudancas = new RegistroMudancas(this.repositorio);
        mudancas.salvar(Arquivos.CONTRATOS, this.fabrica.contratoParaRegistro(organizacao.contratoVigente));
        this.registrar("CONTRATO_RENOVAR", organizacao, mudancas, sessao.usuario);
    }

    private registrar(operacao: string, organizacao: Organizacao, mudancas: RegistroMudancas, usuario: string): void {
        new JournalTransacao({
            operacao, entidade: `Organização ${organizacao.id}`, usuarioResponsavel: usuario,
            dadosAntes: mudancas.antes, dadosDepois: mudancas.depois
        }, this.diario).registrar();
    }
}
