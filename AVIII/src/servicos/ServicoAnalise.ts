import { Ator } from "../dominio/Sessao";
import Permissao from "../dominio/enums/Permissao";
import TipoEquipamento from "../dominio/enums/TipoEquipamento";
import { analisarEficiencia, LoteParaEficiencia } from "../analises/AnaliseEficiencia";
import { analisarRentabilidade, ConsultaEstimativa, EquipamentoParaRentabilidade, estimarValorRecuperacao } from "../analises/AnaliseRentabilidade";
import { analisarVidaUtil, compararPrevisoes, ResultadoVidaUtil } from "../analises/AnaliseVidaUtil";
import UnidadeDeTrabalho from "../repositorios/UnidadeDeTrabalho";
import { EscopoAnalise } from "../repositorios/RepositorioAnalises";
import Relogio from "../comum/Relogio";
import { dataParaISO, validarPeriodo } from "../comum/datas";
import { ErroNaoEncontrado } from "../comum/erros";
import { ParametrosPaginacao } from "../comum/paginacao";
import { exigirPermissao, organizacaoDoEscopo } from "./autorizacao";

export const TipoAnalise = {
    EFICIENCIA_OPERACIONAL: "EFICIENCIA_OPERACIONAL",
    RENTABILIDADE: "RENTABILIDADE",
    VIDA_UTIL: "VIDA_UTIL"
} as const;
export type TipoAnalise = (typeof TipoAnalise)[keyof typeof TipoAnalise];

export type OrigemAnalise = "AGENDADA" | "MANUAL";

// Quantas previsões individuais a resposta síncrona traz (as mais próximas de vencer).
// A lista completa de um parque grande sai pelo relatório assíncrono (fila).
export const PREVISOES_NA_RESPOSTA_PADRAO = 50;
export const PREVISOES_NA_RESPOSTA_MAXIMO = 500;

// Camada analítica: transforma os dados transacionais em indicadores. Cada análise é uma função
// pura (src/analises) alimentada por consultas enxutas do RepositorioAnalises. O mesmo serviço é
// usado pela API interna, pela API pública (parceiros), pelo worker da fila e pelo agendador.
export default class ServicoAnalise {
    constructor(private readonly uow: UnidadeDeTrabalho, private readonly relogio: Relogio) {}

    // ------------------------------------------------------------------ escopo e cabeçalho

    // Valida o escopo e aplica o isolamento: a chave de um parceiro só vê a própria organização.
    public async resolverEscopo(ator: Ator, pedido: EscopoAnalise): Promise<EscopoAnalise> {
        const organizacaoId = organizacaoDoEscopo(ator, pedido.organizacaoId?.trim().toUpperCase() || undefined);
        if (pedido.inicio && pedido.fim) {
            validarPeriodo({ inicio: pedido.inicio, fim: pedido.fim });
        }
        if (organizacaoId && !await this.uow.leitura.organizacoes.buscar(organizacaoId)) {
            throw new ErroNaoEncontrado(`Organização "${organizacaoId}" não encontrada.`);
        }
        return { organizacaoId, inicio: pedido.inicio, fim: pedido.fim };
    }

    private cabecalho(tipo: TipoAnalise, escopo: EscopoAnalise, agora: Date) {
        return {
            tipo,
            geradoEm: agora.toISOString(),
            escopo: {
                organizacaoId: escopo.organizacaoId ?? null,
                inicio: escopo.inicio ? dataParaISO(escopo.inicio) : null,
                fim: escopo.fim ? dataParaISO(escopo.fim) : null
            }
        };
    }

    // ------------------------------------------------------------------ cálculos (sem autorização)
    // Chamados depois que o escopo foi resolvido e autorizado (ver métodos públicos abaixo).

    public dadosEficiencia(escopo: EscopoAnalise): Promise<LoteParaEficiencia[]> {
        return this.uow.leitura.analises.lotesParaEficiencia(escopo);
    }

    // "dados" já carregados evitam ler o banco duas vezes (ex.: relatório que também anexa os itens).
    public async calcularEficiencia(escopo: EscopoAnalise, dados?: LoteParaEficiencia[]) {
        const agora = this.relogio.agora();
        const lotes = dados ?? await this.dadosEficiencia(escopo);
        return { ...this.cabecalho(TipoAnalise.EFICIENCIA_OPERACIONAL, escopo, agora), resultado: analisarEficiencia(lotes, agora) };
    }

    public async dadosRentabilidade(escopo: EscopoAnalise): Promise<EquipamentoParaRentabilidade[]> {
        const repos = this.uow.leitura;
        const [itens, parametros] = await Promise.all([repos.analises.equipamentos(escopo), repos.parametros.obter()]);
        const ano = this.relogio.agora().getFullYear();
        return itens.map(({ equipamento: e }) => ({
            id: e.id, tipo: e.tipo, marca: e.marca, modelo: e.modelo, estadoFisico: e.estadoFisico,
            statusRastreamento: e.statusRastreamento, pesoQuilogramas: e.pesoQuilogramas,
            valorReferencia: parametros.valoresReferencia[e.tipo],
            valorRecuperacao: Math.round(e.calcularValorResidual(parametros, ano) * 100) / 100
        }));
    }

    public async calcularRentabilidade(escopo: EscopoAnalise, dados?: EquipamentoParaRentabilidade[]) {
        const agora = this.relogio.agora();
        const itens = dados ?? await this.dadosRentabilidade(escopo);
        return { ...this.cabecalho(TipoAnalise.RENTABILIDADE, escopo, agora), resultado: analisarRentabilidade(itens) };
    }

    public async calcularVidaUtilCompleta(escopo: EscopoAnalise, horizonteMeses = 12): Promise<ResultadoVidaUtil> {
        const repos = this.uow.leitura;
        const [equipamentos, parametros] = await Promise.all([repos.analises.equipamentosParaVidaUtil(escopo), repos.parametros.obter()]);
        return analisarVidaUtil(equipamentos, parametros.coeficientesDepreciacao as Record<TipoEquipamento, number>, this.relogio.agora(), horizonteMeses);
    }

    public async calcularVidaUtil(escopo: EscopoAnalise, limitePrevisoes = PREVISOES_NA_RESPOSTA_PADRAO, horizonteMeses = 12) {
        const agora = this.relogio.agora();
        const completo = await this.calcularVidaUtilCompleta(escopo, horizonteMeses);
        return {
            ...this.cabecalho(TipoAnalise.VIDA_UTIL, escopo, agora),
            resultado: { ...completo, previsoes: completo.previsoes.slice(0, limitePrevisoes).map(previsaoJSON) },
            previsoesOmitidas: Math.max(0, completo.previsoes.length - limitePrevisoes)
        };
    }

    public async calcularAderencia(escopo: EscopoAnalise) {
        const agora = this.relogio.agora();
        const repos = this.uow.leitura;
        const previsoes = await repos.analises.previsoesRegistradas(escopo.organizacaoId ?? null);
        const realizacoes = await repos.analises.datasInservivel([...new Set(previsoes.map(p => p.equipamentoId))]);
        return { ...this.cabecalho(TipoAnalise.VIDA_UTIL, escopo, agora), resultado: compararPrevisoes(previsoes, realizacoes, agora) };
    }

    // Executa uma análise e grava o resultado para consulta histórica. Na de vida útil, as
    // previsões de cada equipamento vão para a tabela previsoes_vida_util (na mesma transação).
    public async executarEPersistir(tipo: TipoAnalise, escopo: EscopoAnalise, origem: OrigemAnalise, solicitante: string) {
        const iniciadaEm = this.relogio.agora();
        let resultado: unknown;
        let previsoes: ResultadoVidaUtil["previsoes"] | undefined;
        if (tipo === TipoAnalise.EFICIENCIA_OPERACIONAL) {
            resultado = (await this.calcularEficiencia(escopo)).resultado;
        } else if (tipo === TipoAnalise.RENTABILIDADE) {
            resultado = (await this.calcularRentabilidade(escopo)).resultado;
        } else {
            const completo = await this.calcularVidaUtilCompleta(escopo);
            previsoes = completo.previsoes;
            // As previsões individuais ficam na tabela própria; o JSON guarda os agregados e modelos.
            const { previsoes: _omitidas, ...agregados } = completo;
            resultado = agregados;
        }
        const concluidaEm = new Date(Math.max(this.relogio.agora().getTime(), iniciadaEm.getTime()));
        const parametros = this.cabecalho(tipo, escopo, iniciadaEm).escopo;
        const id = await this.uow.executar(async repos => {
            const execucaoId = await repos.analises.salvarExecucao({
                tipo, origem, organizacaoId: escopo.organizacaoId ?? null, parametros, resultado, solicitante, iniciadaEm, concluidaEm, previsoes
            });
            await repos.auditoria.registrar({
                operacao: "ANALISE_EXECUTAR", entidade: "Analise", entidadeId: execucaoId, usuario: solicitante,
                dataHora: concluidaEm, depois: { tipo, origem, ...parametros, previsoes: previsoes?.length ?? 0 }
            });
            return execucaoId;
        });
        return this.buscarExecucaoSemAutorizacao(id);
    }

    private async buscarExecucaoSemAutorizacao(id: string) {
        const e = await this.uow.leitura.analises.buscarExecucao(id);
        if (!e) {
            throw new ErroNaoEncontrado(`Execução de análise "${id}" não encontrada.`);
        }
        const { _count, ...dados } = e;
        return { ...dados, previsoes: _count.previsoes };
    }

    // ------------------------------------------------------------------ operações autorizadas

    public async eficiencia(ator: Ator, pedido: EscopoAnalise) {
        exigirPermissao(ator, Permissao.ANALISES_LER);
        return this.calcularEficiencia(await this.resolverEscopo(ator, pedido));
    }

    public async rentabilidade(ator: Ator, pedido: EscopoAnalise) {
        exigirPermissao(ator, Permissao.ANALISES_LER);
        return this.calcularRentabilidade(await this.resolverEscopo(ator, pedido));
    }

    public async estimativa(ator: Ator, consulta: ConsultaEstimativa, pedido: EscopoAnalise) {
        exigirPermissao(ator, Permissao.ANALISES_LER);
        const escopo = await this.resolverEscopo(ator, pedido);
        const itens = await this.dadosRentabilidade(escopo);
        return { geradoEm: this.relogio.agora().toISOString(), ...estimarValorRecuperacao(itens, consulta) };
    }

    public async vidaUtil(ator: Ator, pedido: EscopoAnalise, limitePrevisoes?: number, horizonteMeses?: number) {
        exigirPermissao(ator, Permissao.ANALISES_LER);
        return this.calcularVidaUtil(await this.resolverEscopo(ator, pedido), limitePrevisoes, horizonteMeses);
    }

    public async aderencia(ator: Ator, pedido: EscopoAnalise) {
        exigirPermissao(ator, Permissao.ANALISES_LER);
        return this.calcularAderencia(await this.resolverEscopo(ator, { organizacaoId: pedido.organizacaoId }));
    }

    public async executar(ator: Ator, tipo: TipoAnalise, pedido: EscopoAnalise) {
        exigirPermissao(ator, Permissao.ANALISES_EXECUTAR);
        return this.executarEPersistir(tipo, await this.resolverEscopo(ator, pedido), "MANUAL", ator.login);
    }

    public async listarExecucoes(ator: Ator, filtro: { tipo?: TipoAnalise; organizacaoId?: string }, paginacao: ParametrosPaginacao) {
        exigirPermissao(ator, Permissao.ANALISES_LER);
        return this.uow.leitura.analises.listarExecucoes(
            { tipo: filtro.tipo, organizacaoId: filtro.organizacaoId?.trim().toUpperCase() }, paginacao);
    }

    public async buscarExecucao(ator: Ator, id: string) {
        exigirPermissao(ator, Permissao.ANALISES_LER);
        return this.buscarExecucaoSemAutorizacao(id);
    }

    public async previsoesDaExecucao(ator: Ator, id: string, paginacao: ParametrosPaginacao) {
        exigirPermissao(ator, Permissao.ANALISES_LER);
        const execucao = await this.buscarExecucaoSemAutorizacao(id);
        const pagina = await this.uow.leitura.analises.previsoesDaExecucao(execucao.id, paginacao);
        return {
            ...pagina,
            itens: pagina.itens.map(p => ({
                equipamentoId: p.equipamentoId, tipo: p.tipo, estadoFisico: p.estadoFisico, idadeAnos: Number(p.idadeAnos),
                anosRestantes: Number(p.anosRestantes), dataPrevistaInservivel: dataParaISO(p.dataPrevistaInservivel), metodo: p.metodo
            }))
        };
    }
}

export function previsaoJSON(p: ResultadoVidaUtil["previsoes"][number]) {
    return { ...p, dataPrevistaInservivel: dataParaISO(p.dataPrevistaInservivel) };
}
