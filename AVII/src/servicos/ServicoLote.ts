import Lote, { DadosLoteEditaveis } from "../dominio/Lote";
import Equipamento from "../dominio/Equipamento";
import { UsuarioAutenticado } from "../dominio/Sessao";
import Permissao from "../dominio/enums/Permissao";
import FabricaLote, { DadosLote } from "../fabricas/FabricaLote";
import FabricaEquipamento, { DadosEquipamento } from "../fabricas/FabricaEquipamento";
import Repositorios from "../repositorios/Repositorios";
import UnidadeDeTrabalho from "../repositorios/UnidadeDeTrabalho";
import { FiltroLote } from "../repositorios/RepositorioLote";
import Relogio from "../comum/Relogio";
import { dataCivil, validarPeriodo } from "../comum/datas";
import { ErroNaoEncontrado, ErroRegraNegocio, ErroValidacao } from "../comum/erros";
import { Pagina, ParametrosPaginacao } from "../comum/paginacao";
import { exigirPermissao } from "./autorizacao";

export const MAX_EQUIPAMENTOS_POR_REQUISICAO = 200;

export interface DadosNovoLote extends DadosLote {
    organizacaoId: string;
    equipamentos?: DadosEquipamento[];
}

// Lotes recebidos no almoxarifado e a triagem (papel GESTOR_ALMOXARIFADO).
export default class ServicoLote {
    private readonly fabricaLote: FabricaLote;
    private readonly fabricaEquipamento = new FabricaEquipamento();

    constructor(private readonly uow: UnidadeDeTrabalho, private readonly relogio: Relogio) {
        this.fabricaLote = new FabricaLote(relogio);
    }

    private async carregar(repos: Repositorios, id: string): Promise<Lote> {
        const lote = await repos.lotes.buscar(id);
        if (!lote) {
            throw new ErroNaoEncontrado(`Lote "${id}" não encontrado.`);
        }
        return lote;
    }

    private auditar(repos: Repositorios, operacao: string, lote: Lote, usuario: string, antes?: unknown, depois?: unknown) {
        return repos.auditoria.registrar({
            operacao, entidade: "Lote", entidadeId: lote.id, usuario, dataHora: this.relogio.agora(), antes, depois
        });
    }

    private async exigirNotaFiscalUnica(repos: Repositorios, organizacaoId: string, notaFiscal: string, loteAtual?: string): Promise<void> {
        const existente = await repos.lotes.buscarPorNotaFiscal(organizacaoId, notaFiscal);
        if (existente && existente !== loteAtual) {
            throw new ErroRegraNegocio(`A NF ${notaFiscal} da organização ${organizacaoId} já foi registrada no lote ${existente}.`);
        }
    }

    // Cria e inclui um equipamento no lote, já com a movimentação de recebimento.
    private async incluirEquipamento(repos: Repositorios, lote: Lote, dados: DadosEquipamento, usuario: string): Promise<Equipamento> {
        const agora = this.relogio.agora();
        const equipamento = await this.fabricaEquipamento.criar(dados, repos.codigos, agora.getFullYear());
        lote.adicionarEquipamento(equipamento);
        equipamento.registrarRecebimento(`Organização ${lote.organizacaoId} (${lote.transportadora})`, usuario, agora);
        await repos.equipamentos.inserir(equipamento);
        return equipamento;
    }

    // Transação: o lote e todos os equipamentos informados são gravados juntos. Se um único
    // equipamento for inválido, nada é gravado (nem o lote, nem os demais equipamentos).
    public async criarLote(autenticado: UsuarioAutenticado, dados: DadosNovoLote): Promise<Lote> {
        exigirPermissao(autenticado, Permissao.LOTES_ESCREVER);
        const equipamentos = dados.equipamentos ?? [];
        if (equipamentos.length > MAX_EQUIPAMENTOS_POR_REQUISICAO) {
            throw new ErroValidacao(`Envie no máximo ${MAX_EQUIPAMENTOS_POR_REQUISICAO} equipamentos por requisição.`);
        }
        return this.uow.executar(async repos => {
            const organizacao = await repos.organizacoes.buscar(String(dados.organizacaoId ?? "").trim().toUpperCase());
            if (!organizacao) {
                throw new ErroNaoEncontrado(`Organização "${dados.organizacaoId}" não encontrada.`);
            }
            organizacao.exigirAptaParaColeta(dataCivil(this.relogio.agora()));
            const { notaFiscal } = Lote.validarDadosEditaveis(dados);
            await this.exigirNotaFiscalUnica(repos, organizacao.id, notaFiscal);
            const lote = await this.fabricaLote.criar(dados, organizacao.id, repos.codigos);
            await repos.lotes.inserir(lote);
            for (const [indice, dadosEquipamento] of equipamentos.entries()) {
                try {
                    await this.incluirEquipamento(repos, lote, dadosEquipamento, autenticado.login);
                } catch (erro) {
                    if (erro instanceof ErroValidacao) {
                        throw new ErroValidacao(`Equipamento ${indice + 1}: ${erro.message}`);
                    }
                    throw erro;
                }
            }
            await this.auditar(repos, "LOTE_CRIAR", lote, autenticado.login, undefined, lote.paraJSON(false));
            return lote;
        });
    }

    public async adicionarEquipamentoLote(autenticado: UsuarioAutenticado, loteId: string, dados: DadosEquipamento): Promise<Equipamento> {
        exigirPermissao(autenticado, Permissao.LOTES_ESCREVER);
        return this.uow.executar(async repos => {
            const lote = await this.carregar(repos, loteId);
            const equipamento = await this.incluirEquipamento(repos, lote, dados, autenticado.login);
            await repos.auditoria.registrar({
                operacao: "EQUIPAMENTO_ADICIONAR", entidade: "Equipamento", entidadeId: equipamento.id, usuario: autenticado.login,
                dataHora: this.relogio.agora(), depois: equipamento.paraJSON()
            });
            return equipamento;
        });
    }

    public async buscar(autenticado: UsuarioAutenticado, id: string): Promise<Lote> {
        exigirPermissao(autenticado, Permissao.LOTES_LER);
        return this.carregar(this.uow.leitura, id);
    }

    public async listar(autenticado: UsuarioAutenticado, filtro: FiltroLote, paginacao: ParametrosPaginacao): Promise<Pagina<Lote>> {
        exigirPermissao(autenticado, Permissao.LOTES_LER);
        if (filtro.inicio && filtro.fim) {
            validarPeriodo({ inicio: filtro.inicio, fim: filtro.fim });
        }
        return this.uow.leitura.lotes.listar(filtro, paginacao);
    }

    public async consultarLotePorPeriodo(autenticado: UsuarioAutenticado, dataInicio: Date, dataFim: Date): Promise<Lote[]> {
        exigirPermissao(autenticado, Permissao.LOTES_LER);
        validarPeriodo({ inicio: dataInicio, fim: dataFim });
        return this.uow.leitura.lotes.listarTodos({ inicio: dataInicio, fim: dataFim });
    }

    public async atualizar(autenticado: UsuarioAutenticado, id: string, dados: DadosLoteEditaveis & { dataEntrada?: Date }, versao: number): Promise<Lote> {
        exigirPermissao(autenticado, Permissao.LOTES_ESCREVER);
        return this.uow.executar(async repos => {
            const lote = await this.carregar(repos, id);
            lote.verificarVersao(versao);
            const antes = lote.paraJSON(false);
            lote.alterarDados(dados, this.fabricaLote.validarDataEntrada(dados.dataEntrada ?? lote.dataEntrada));
            await this.exigirNotaFiscalUnica(repos, lote.organizacaoId, lote.notaFiscal, lote.id);
            await repos.lotes.atualizar(lote);
            await this.auditar(repos, "LOTE_ALTERAR", lote, autenticado.login, antes, lote.paraJSON(false));
            return lote;
        });
    }

    public async excluir(autenticado: UsuarioAutenticado, id: string, versao?: number): Promise<void> {
        exigirPermissao(autenticado, Permissao.LOTES_ESCREVER);
        await this.uow.executar(async repos => {
            const lote = await this.carregar(repos, id);
            lote.verificarVersao(versao);
            lote.exigirExcluivel();
            await repos.lotes.excluir(lote);
            await this.auditar(repos, "LOTE_EXCLUIR", lote, autenticado.login, lote.paraJSON(true));
        });
    }

    // Avança a triagem (inicia ou conclui). Lote e todos os equipamentos mudam na mesma transação.
    public async processarTriagem(autenticado: UsuarioAutenticado, loteId: string, versao?: number): Promise<{ lote: Lote; etapa: string }> {
        exigirPermissao(autenticado, Permissao.LOTES_ESCREVER);
        return this.uow.executar(async repos => {
            const lote = await this.carregar(repos, loteId);
            lote.verificarVersao(versao);
            const statusAnterior = lote.statusProcessamento;
            const etapa = lote.avancarTriagem(autenticado.login, this.relogio.agora());
            if (etapa === "INICIADA") {
                for (const equipamento of lote.equipamentos) {
                    await repos.equipamentos.atualizar(equipamento);
                }
            }
            await repos.lotes.atualizar(lote);
            await this.auditar(repos, etapa === "INICIADA" ? "LOTE_TRIAGEM_INICIAR" : "LOTE_TRIAGEM_CONCLUIR", lote, autenticado.login,
                { statusProcessamento: statusAnterior }, { statusProcessamento: lote.statusProcessamento });
            return { lote, etapa };
        });
    }

    public async relatorioTriagem(autenticado: UsuarioAutenticado, loteId: string) {
        return (await this.buscar(autenticado, loteId)).gerarRelatorioTriagem();
    }
}
