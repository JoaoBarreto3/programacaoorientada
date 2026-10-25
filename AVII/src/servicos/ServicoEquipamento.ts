import Equipamento, { DadosDescritivos } from "../dominio/Equipamento";
import HistoricoCompleto from "../dominio/HistoricoCompleto";
import Lote from "../dominio/Lote";
import Movimentacao from "../dominio/Movimentacao";
import { UsuarioAutenticado } from "../dominio/Sessao";
import EstadoFisico from "../dominio/enums/EstadoFisico";
import Permissao from "../dominio/enums/Permissao";
import StatusRastreamento from "../dominio/enums/StatusRastreamento";
import TipoEquipamento from "../dominio/enums/TipoEquipamento";
import { gerarCodigoBarras } from "../dominio/codigoBarras";
import Repositorios from "../repositorios/Repositorios";
import UnidadeDeTrabalho from "../repositorios/UnidadeDeTrabalho";
import { FiltroEquipamento } from "../repositorios/RepositorioEquipamento";
import Relogio from "../comum/Relogio";
import { ErroIntegridade, ErroNaoEncontrado } from "../comum/erros";
import { Pagina, ParametrosPaginacao } from "../comum/paginacao";
import { exigirPermissao } from "./autorizacao";

export default class ServicoEquipamento {
    constructor(private readonly uow: UnidadeDeTrabalho, private readonly relogio: Relogio) {}

    private async carregar(repos: Repositorios, id: string): Promise<Equipamento> {
        const equipamento = await repos.equipamentos.buscar(id);
        if (!equipamento) {
            throw new ErroNaoEncontrado(`Equipamento "${id}" não encontrado (use o código EQ-... ou o código de barras).`);
        }
        return equipamento;
    }

    // "bloquear" trava o lote até o fim da transação (ver RepositorioLote.bloquear).
    private async carregarLote(repos: Repositorios, equipamento: Equipamento, bloquear = false): Promise<Lote> {
        if (bloquear) {
            await repos.lotes.bloquear(equipamento.loteId);
        }
        const lote = await repos.lotes.buscar(equipamento.loteId);
        if (!lote) {
            throw new ErroIntegridade(`Lote ${equipamento.loteId} do equipamento ${equipamento.id} não encontrado.`);
        }
        return lote;
    }

    private auditar(repos: Repositorios, operacao: string, e: Equipamento, usuario: string, antes?: unknown, depois?: unknown) {
        return repos.auditoria.registrar({
            operacao, entidade: "Equipamento", entidadeId: e.id, usuario, dataHora: this.relogio.agora(), antes, depois
        });
    }

    public gerarCodigoBarras(tipo: TipoEquipamento, sequencia: number): string {
        return gerarCodigoBarras(tipo, sequencia);
    }

    public async buscar(autenticado: UsuarioAutenticado, id: string): Promise<Equipamento> {
        exigirPermissao(autenticado, Permissao.EQUIPAMENTOS_LER);
        return this.carregar(this.uow.leitura, id);
    }

    public async listar(autenticado: UsuarioAutenticado, filtro: FiltroEquipamento, paginacao: ParametrosPaginacao): Promise<Pagina<Equipamento>> {
        exigirPermissao(autenticado, Permissao.EQUIPAMENTOS_LER);
        return this.uow.leitura.equipamentos.listar(filtro, paginacao);
    }

    public async listarMovimentacoes(autenticado: UsuarioAutenticado, id: string): Promise<Movimentacao[]> {
        return (await this.buscar(autenticado, id)).historicoMovimentacao;
    }

    // Rastreabilidade completa: origem, histórico, auditoria e avaliação financeira.
    public async rastrearEquipamento(autenticado: UsuarioAutenticado, id: string): Promise<HistoricoCompleto> {
        exigirPermissao(autenticado, Permissao.EQUIPAMENTOS_LER);
        const repos = this.uow.leitura;
        const equipamento = await this.carregar(repos, id);
        const lote = await this.carregarLote(repos, equipamento);
        const organizacao = await repos.organizacoes.buscar(lote.organizacaoId);
        if (!organizacao) {
            throw new ErroIntegridade(`Organização ${lote.organizacaoId} do lote ${lote.id} não encontrada.`);
        }
        const parametros = await repos.parametros.obter();
        const ano = this.relogio.agora().getFullYear();
        const auditoria = [
            ...await repos.auditoria.listarPorEntidade("Lote", lote.id),
            ...await repos.auditoria.listarPorEntidade("Equipamento", equipamento.id)
        ].sort((a, b) => a.dataHora.getTime() - b.dataHora.getTime());
        return {
            equipamento, lote, organizacao, auditoria,
            depreciacao: equipamento.calcularDepreciacao(parametros, ano),
            valorResidual: equipamento.calcularValorResidual(parametros, ano)
        };
    }

    public async atualizarDados(autenticado: UsuarioAutenticado, id: string, dados: Partial<DadosDescritivos>, versao: number): Promise<Equipamento> {
        exigirPermissao(autenticado, Permissao.EQUIPAMENTOS_ESCREVER);
        return this.uow.executar(async repos => {
            const equipamento = await this.carregar(repos, id);
            equipamento.verificarVersao(versao);
            const antes = equipamento.paraJSON();
            equipamento.alterarDados(dados, this.relogio.agora().getFullYear());
            await repos.equipamentos.atualizar(equipamento);
            await this.auditar(repos, "EQUIPAMENTO_ALTERAR", equipamento, autenticado.login, antes, equipamento.paraJSON());
            return equipamento;
        });
    }

    // Remove um equipamento de um lote ainda RECEBIDO e renumera as posições dos seguintes.
    public async excluir(autenticado: UsuarioAutenticado, id: string, versao?: number): Promise<void> {
        exigirPermissao(autenticado, Permissao.EQUIPAMENTOS_ESCREVER);
        await this.uow.executar(async repos => {
            const equipamento = await this.carregar(repos, id);
            equipamento.verificarVersao(versao);
            const lote = await this.carregarLote(repos, equipamento, true);
            const reposicionados = lote.removerEquipamento(equipamento.id);
            await repos.equipamentos.excluir(equipamento);
            for (const e of reposicionados) {
                await repos.equipamentos.atualizar(e);
            }
            await this.auditar(repos, "EQUIPAMENTO_EXCLUIR", equipamento, autenticado.login, equipamento.paraJSON());
        });
    }

    public async atualizarEstadoFisico(autenticado: UsuarioAutenticado, id: string, novoEstado: EstadoFisico,
        justificativa: string, versao?: number): Promise<Equipamento> {
        exigirPermissao(autenticado, Permissao.EQUIPAMENTOS_ESCREVER);
        return this.uow.executar(async repos => {
            const equipamento = await this.carregar(repos, id);
            equipamento.verificarVersao(versao);
            const anterior = equipamento.estadoFisico;
            equipamento.atualizarEstadoFisico(novoEstado, justificativa, autenticado.login, this.relogio.agora());
            await repos.equipamentos.atualizar(equipamento);
            await this.auditar(repos, "EQUIPAMENTO_ESTADO", equipamento, autenticado.login,
                { estadoFisico: anterior }, { estadoFisico: novoEstado, justificativa: justificativa.trim() });
            return equipamento;
        });
    }

    // Transação: status do equipamento + movimentação + (se mudar) situação do lote + auditoria.
    public async atualizarStatus(autenticado: UsuarioAutenticado, id: string, novoStatus: StatusRastreamento,
        justificativa: string, versao?: number): Promise<Equipamento> {
        exigirPermissao(autenticado, Permissao.EQUIPAMENTOS_ESCREVER);
        return this.uow.executar(async repos => {
            const equipamento = await this.carregar(repos, id);
            equipamento.verificarVersao(versao);
            const lote = await this.carregarLote(repos, equipamento, true);
            const anterior = equipamento.statusRastreamento;
            const statusLoteAnterior = lote.statusProcessamento;
            lote.atualizarStatusEquipamento(equipamento, novoStatus, justificativa, autenticado.login, this.relogio.agora());
            await repos.equipamentos.atualizar(equipamento);
            if (lote.statusProcessamento !== statusLoteAnterior) {
                await repos.lotes.atualizar(lote);
            }
            await this.auditar(repos, "EQUIPAMENTO_STATUS", equipamento, autenticado.login,
                { statusRastreamento: anterior, statusLote: statusLoteAnterior },
                { statusRastreamento: novoStatus, statusLote: lote.statusProcessamento, justificativa: justificativa.trim() });
            return equipamento;
        });
    }

    public async registrarMovimentacao(autenticado: UsuarioAutenticado, id: string, destino: string,
        observacao: string, versao?: number): Promise<Movimentacao> {
        exigirPermissao(autenticado, Permissao.EQUIPAMENTOS_ESCREVER);
        return this.uow.executar(async repos => {
            const equipamento = await this.carregar(repos, id);
            equipamento.verificarVersao(versao);
            equipamento.registrarMovimentacao(destino, autenticado.login, this.relogio.agora(), observacao);
            const movimentacao = equipamento.historicoMovimentacao[equipamento.historicoMovimentacao.length - 1]!;
            await repos.equipamentos.atualizar(equipamento);
            await this.auditar(repos, "EQUIPAMENTO_MOVIMENTAR", equipamento, autenticado.login,
                { local: movimentacao.origem }, { local: movimentacao.destino });
            return movimentacao;
        });
    }
}
