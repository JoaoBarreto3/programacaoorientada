import Organizacao, { DadosCadastrais } from "../dominio/Organizacao";
import Contrato, { DadosContrato } from "../dominio/Contrato";
import { UsuarioAutenticado } from "../dominio/Sessao";
import Permissao from "../dominio/enums/Permissao";
import FabricaOrganizacao, { DadosOrganizacao } from "../fabricas/FabricaOrganizacao";
import ValidadorCNPJ from "../validacao/ValidadorCNPJ";
import { formatarCNPJ, normalizarCNPJ } from "../validacao/cnpj";
import { exigirValido } from "../validacao/Validador";
import Repositorios from "../repositorios/Repositorios";
import UnidadeDeTrabalho from "../repositorios/UnidadeDeTrabalho";
import { FiltroOrganizacao } from "../repositorios/RepositorioOrganizacao";
import Relogio from "../comum/Relogio";
import { dataCivil } from "../comum/datas";
import { ErroNaoEncontrado, ErroRegraNegocio } from "../comum/erros";
import { Pagina, ParametrosPaginacao } from "../comum/paginacao";
import { exigirPermissao } from "./autorizacao";

// Organizações clientes e seus contratos de coleta (papel OPERADOR_CADASTRO).
export default class ServicoOrganizacao {
    private readonly fabrica: FabricaOrganizacao;

    constructor(private readonly uow: UnidadeDeTrabalho, private readonly relogio: Relogio,
        public readonly validadorCNPJ: ValidadorCNPJ = new ValidadorCNPJ()) {
        this.fabrica = new FabricaOrganizacao(validadorCNPJ);
    }

    public hoje(): Date {
        return dataCivil(this.relogio.agora());
    }

    private async carregar(repos: Repositorios, id: string): Promise<Organizacao> {
        const organizacao = await repos.organizacoes.buscar(id.trim().toUpperCase());
        if (!organizacao) {
            throw new ErroNaoEncontrado(`Organização "${id}" não encontrada.`);
        }
        return organizacao;
    }

    private auditar(repos: Repositorios, operacao: string, o: Organizacao, usuario: string, antes?: unknown, depois?: unknown) {
        return repos.auditoria.registrar({
            operacao, entidade: "Organizacao", entidadeId: o.id, usuario, dataHora: this.relogio.agora(), antes, depois
        });
    }

    public async cadastrarOrganizacao(autenticado: UsuarioAutenticado, dados: DadosOrganizacao): Promise<Organizacao> {
        exigirPermissao(autenticado, Permissao.ORGANIZACOES_ESCREVER);
        exigirValido(this.validadorCNPJ, dados.cnpj);
        return this.uow.executar(async repos => {
            // A duplicidade é verificada antes de reservar o código BRnnn, para não gastar números à toa.
            // O índice único do banco é a garantia final contra cadastros simultâneos.
            const duplicada = await repos.organizacoes.buscarPorCnpj(normalizarCNPJ(dados.cnpj));
            if (duplicada) {
                throw new ErroRegraNegocio(
                    `CNPJ ${formatarCNPJ(duplicada.cnpj)} já cadastrado para ${duplicada.id} (${duplicada.razaoSocial}).`);
            }
            const organizacao = await this.fabrica.criar(dados, repos.codigos, this.relogio.agora());
            await repos.organizacoes.inserir(organizacao);
            await this.auditar(repos, "ORGANIZACAO_CRIAR", organizacao, autenticado.login, undefined, organizacao.paraJSON(this.hoje()));
            return organizacao;
        });
    }

    public async buscarOrganizacao(autenticado: UsuarioAutenticado, id: string): Promise<Organizacao> {
        exigirPermissao(autenticado, Permissao.ORGANIZACOES_LER);
        return this.carregar(this.uow.leitura, id);
    }

    public async listar(autenticado: UsuarioAutenticado, filtro: FiltroOrganizacao, paginacao: ParametrosPaginacao): Promise<Pagina<Organizacao>> {
        exigirPermissao(autenticado, Permissao.ORGANIZACOES_LER);
        return this.uow.leitura.organizacoes.listar(filtro, paginacao);
    }

    public async listarOrganizacoesAtivas(autenticado: UsuarioAutenticado): Promise<Organizacao[]> {
        return (await this.listar(autenticado, { ativo: true }, { tamanhoPagina: 100 })).itens;
    }

    public async atualizar(autenticado: UsuarioAutenticado, id: string, dados: Partial<DadosCadastrais> & { cnpj?: string },
        versao: number): Promise<Organizacao> {
        exigirPermissao(autenticado, Permissao.ORGANIZACOES_ESCREVER);
        if (dados.cnpj !== undefined) {
            exigirValido(this.validadorCNPJ, dados.cnpj);
        }
        return this.uow.executar(async repos => {
            const organizacao = await this.carregar(repos, id);
            organizacao.verificarVersao(versao);
            const antes = organizacao.paraJSON(this.hoje());
            organizacao.alterarDados(dados);
            if (dados.cnpj !== undefined) {
                const cnpj = normalizarCNPJ(dados.cnpj);
                const outra = await repos.organizacoes.buscarPorCnpj(cnpj);
                if (outra && outra.id !== organizacao.id) {
                    throw new ErroRegraNegocio(`CNPJ ${formatarCNPJ(cnpj)} já cadastrado para ${outra.id} (${outra.razaoSocial}).`);
                }
                organizacao.corrigirCnpj(cnpj, await repos.organizacoes.contarLotes(organizacao.id));
            }
            await repos.organizacoes.atualizar(organizacao);
            await this.auditar(repos, "ORGANIZACAO_ALTERAR", organizacao, autenticado.login, antes, organizacao.paraJSON(this.hoje()));
            return organizacao;
        });
    }

    public async alterarSituacao(autenticado: UsuarioAutenticado, id: string, ativo: boolean, versao?: number): Promise<Organizacao> {
        exigirPermissao(autenticado, Permissao.ORGANIZACOES_ESCREVER);
        return this.uow.executar(async repos => {
            const organizacao = await this.carregar(repos, id);
            organizacao.verificarVersao(versao);
            if (ativo) {
                organizacao.reativar();
            } else {
                organizacao.desativar();
            }
            await repos.organizacoes.atualizar(organizacao);
            await this.auditar(repos, ativo ? "ORGANIZACAO_REATIVAR" : "ORGANIZACAO_DESATIVAR", organizacao, autenticado.login,
                { ativo: !ativo }, { ativo });
            return organizacao;
        });
    }

    // Exclusão física só para organizações sem lotes; as demais devem ser desativadas,
    // preservando a rastreabilidade (a chave estrangeira com RESTRICT garante isso no banco).
    public async excluir(autenticado: UsuarioAutenticado, id: string, versao?: number): Promise<void> {
        exigirPermissao(autenticado, Permissao.ORGANIZACOES_ESCREVER);
        await this.uow.executar(async repos => {
            const organizacao = await this.carregar(repos, id);
            organizacao.verificarVersao(versao);
            const lotes = await repos.organizacoes.contarLotes(organizacao.id);
            if (lotes > 0) {
                throw new ErroRegraNegocio(`A organização ${organizacao.id} possui ${lotes} lote(s) registrado(s) e não pode ser excluída; desative-a.`);
            }
            await repos.organizacoes.excluir(organizacao);
            await this.auditar(repos, "ORGANIZACAO_EXCLUIR", organizacao, autenticado.login, organizacao.paraJSON(this.hoje()));
        });
    }

    // ------------------------------------------------------------------ contrato (0..1)

    public async obterContrato(autenticado: UsuarioAutenticado, organizacaoId: string): Promise<Contrato> {
        const organizacao = await this.buscarOrganizacao(autenticado, organizacaoId);
        if (!organizacao.contratoVigente) {
            throw new ErroNaoEncontrado(`A organização ${organizacao.id} não possui contrato.`);
        }
        return organizacao.contratoVigente;
    }

    // Cria o contrato (se a organização não tiver) ou substitui os seus termos.
    public async definirContrato(autenticado: UsuarioAutenticado, organizacaoId: string, dados: DadosContrato,
        versao?: number): Promise<{ contrato: Contrato; criado: boolean }> {
        exigirPermissao(autenticado, Permissao.ORGANIZACOES_ESCREVER);
        return this.uow.executar(async repos => {
            const organizacao = await this.carregar(repos, organizacaoId);
            const atual = organizacao.contratoVigente;
            if (!atual) {
                const contrato = Contrato.criar(organizacao.id, dados);
                await repos.organizacoes.inserirContrato(contrato);
                await this.auditar(repos, "CONTRATO_CRIAR", organizacao, autenticado.login, undefined, contrato.paraJSON(this.hoje()));
                return { contrato, criado: true };
            }
            atual.verificarVersao(versao);
            const antes = atual.paraJSON(this.hoje());
            atual.alterar(dados);
            await repos.organizacoes.atualizarContrato(atual);
            await this.auditar(repos, "CONTRATO_ALTERAR", organizacao, autenticado.login, antes, atual.paraJSON(this.hoje()));
            return { contrato: atual, criado: false };
        });
    }

    public async renovarContrato(autenticado: UsuarioAutenticado, organizacaoId: string, novoVencimento: Date, versao?: number): Promise<Contrato> {
        exigirPermissao(autenticado, Permissao.ORGANIZACOES_ESCREVER);
        return this.uow.executar(async repos => {
            const organizacao = await this.carregar(repos, organizacaoId);
            const contrato = organizacao.contratoVigente;
            if (!contrato) {
                throw new ErroRegraNegocio(`A organização ${organizacao.id} não possui contrato para renovar.`);
            }
            contrato.verificarVersao(versao);
            const antes = { dataVencimento: contrato.paraJSON(this.hoje()).dataVencimento };
            contrato.renovar(novoVencimento, this.hoje());
            await repos.organizacoes.atualizarContrato(contrato);
            await this.auditar(repos, "CONTRATO_RENOVAR", organizacao, autenticado.login, antes,
                { dataVencimento: contrato.paraJSON(this.hoje()).dataVencimento });
            return contrato;
        });
    }

    public async excluirContrato(autenticado: UsuarioAutenticado, organizacaoId: string, versao?: number): Promise<void> {
        exigirPermissao(autenticado, Permissao.ORGANIZACOES_ESCREVER);
        await this.uow.executar(async repos => {
            const organizacao = await this.carregar(repos, organizacaoId);
            const contrato = organizacao.contratoVigente;
            if (!contrato) {
                throw new ErroNaoEncontrado(`A organização ${organizacao.id} não possui contrato.`);
            }
            contrato.verificarVersao(versao);
            await repos.organizacoes.excluirContrato(contrato);
            await this.auditar(repos, "CONTRATO_EXCLUIR", organizacao, autenticado.login, contrato.paraJSON(this.hoje()));
        });
    }
}
