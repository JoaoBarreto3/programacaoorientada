import { createHash } from "node:crypto";
import { Ator, ehParceiro } from "../dominio/Sessao";
import Permissao from "../dominio/enums/Permissao";
import { LIMITES_PLANO } from "../dominio/enums/PlanoApi";
import { LoteParaEficiencia } from "../analises/AnaliseEficiencia";
import { arredondar } from "../analises/estatistica";
import UnidadeDeTrabalho from "../repositorios/UnidadeDeTrabalho";
import { EscopoAnalise } from "../repositorios/RepositorioAnalises";
import { ResumoTarefa } from "../repositorios/RepositorioTarefas";
import { FalhaDefinitiva, FilaTarefas, InfoTentativa } from "../infra/fila/FilaTarefas";
import Relogio from "../comum/Relogio";
import { ehUuid } from "../comum/uuid";
import { gerarCsv } from "../comum/csv";
import { dataParaISO, lerData } from "../comum/datas";
import ErroGreencode, { ErroConflito, ErroExpirado, ErroNaoEncontrado, ErroRegraNegocio } from "../comum/erros";
import { ParametrosPaginacao } from "../comum/paginacao";
import ServicoAnalise, { previsaoJSON } from "./ServicoAnalise";
import { exigirPermissao } from "./autorizacao";

export const TipoRelatorio = {
    EFICIENCIA_OPERACIONAL: "EFICIENCIA_OPERACIONAL",
    RENTABILIDADE: "RENTABILIDADE",
    VIDA_UTIL: "VIDA_UTIL",
    INVENTARIO_RASTREABILIDADE: "INVENTARIO_RASTREABILIDADE"
} as const;
export type TipoRelatorio = (typeof TipoRelatorio)[keyof typeof TipoRelatorio];

export const FormatoRelatorio = { JSON: "JSON", CSV: "CSV" } as const;
export type FormatoRelatorio = (typeof FormatoRelatorio)[keyof typeof FormatoRelatorio];

export interface PedidoRelatorio {
    tipo: TipoRelatorio;
    formato: FormatoRelatorio;
    organizacaoId?: string;
    inicio?: Date;
    fim?: Date;
}

export interface OpcoesRelatorios {
    // Por quanto tempo o arquivo gerado fica disponível para download.
    retencaoHoras: number;
    // Relatórios em andamento ao mesmo tempo por usuário interno (parceiros: limite do plano).
    simultaneosPorUsuario: number;
}

interface ArquivoGerado {
    conteudo: string;
    tipoConteudo: string;
}

const EXTENSAO: Record<FormatoRelatorio, string> = { JSON: "json", CSV: "csv" };

// Um arquivo de até 10 MB por tarefa (o conteúdo fica numa coluna do PostgreSQL).
const TAMANHO_MAXIMO_BYTES = 10 * 1024 * 1024;

// Relatórios pesados processados em segundo plano (padrão assíncrono com fila e polling):
//   1. POST cria a tarefa (PENDENTE) no banco, publica o id na fila e responde 202 na hora;
//   2. o worker gera o arquivo e grava CONCLUIDA (ou FALHOU, depois das tentativas);
//   3. o cliente consulta a situação e, quando concluída, baixa o arquivo.
export default class ServicoRelatorioAssincrono {
    constructor(private readonly uow: UnidadeDeTrabalho, private readonly relogio: Relogio,
        private readonly analises: ServicoAnalise, private readonly fila: FilaTarefas,
        private readonly opcoes: OpcoesRelatorios) {}

    // ------------------------------------------------------------------ solicitação e consulta

    public async solicitar(ator: Ator, pedido: PedidoRelatorio): Promise<ResumoTarefa> {
        exigirPermissao(ator, Permissao.RELATORIOS_ASSINCRONOS);
        const escopo = await this.analises.resolverEscopo(ator, pedido);
        const parceiro = ehParceiro(ator);
        const limite = parceiro ? LIMITES_PLANO[ator.plano].relatoriosSimultaneos : this.opcoes.simultaneosPorUsuario;
        const tarefa = await this.uow.executar(async tx => {
            // Contagem e inclusão na mesma transação, com trava por solicitante: o limite vale mesmo
            // com várias requisições simultâneas.
            await tx.tarefas.travarSolicitante(parceiro ? ator.id : ator.login);
            const emAndamento = await tx.tarefas.contarEmAndamento(parceiro ? { chaveApiId: ator.id } : { solicitante: ator.login });
            if (emAndamento >= limite) {
                throw new ErroRegraNegocio(`Limite de ${limite} relatório(s) em processamento simultâneo atingido. ` +
                    "Aguarde a conclusão dos anteriores ou cancele algum.");
            }
            const t = await tx.tarefas.criar({
                tipo: pedido.tipo, formato: pedido.formato, organizacaoId: escopo.organizacaoId ?? null,
                parametros: { inicio: escopo.inicio ? dataParaISO(escopo.inicio) : null, fim: escopo.fim ? dataParaISO(escopo.fim) : null },
                solicitante: ator.login, chaveApiId: parceiro ? ator.id : null, criadaEm: this.relogio.agora()
            });
            await tx.auditoria.registrar({
                operacao: "RELATORIO_SOLICITAR", entidade: "TarefaRelatorio", entidadeId: t.id, usuario: ator.login,
                dataHora: t.criadaEm, depois: { tipo: t.tipo, formato: t.formato, organizacaoId: t.organizacaoId }
            });
            return t;
        });
        // A tarefa já está gravada: se o Redis falhar agora, a varredura periódica a recoloca na fila.
        await this.enfileirarComSeguranca(tarefa.id);
        return tarefa;
    }

    private async enfileirarComSeguranca(tarefaId: string): Promise<void> {
        try {
            await this.fila.enfileirar(tarefaId);
        } catch {
            // Silencioso de propósito: a tarefa continua PENDENTE e será recuperada (ver recuperarPendentes).
        }
    }

    private async carregar(ator: Ator, id: string): Promise<ResumoTarefa> {
        const tarefa = ehUuid(id) ? await this.uow.leitura.tarefas.buscar(id) : null;
        if (!tarefa || !this.podeVer(ator, tarefa)) {
            throw new ErroNaoEncontrado(`Tarefa de relatório "${id}" não encontrada.`);
        }
        return tarefa;
    }

    // Cada um vê as próprias tarefas; o administrador vê todas.
    private podeVer(ator: Ator, t: ResumoTarefa): boolean {
        if (ehParceiro(ator)) return t.chaveApiId === ator.id;
        return t.solicitante === ator.login || ator.papel === "ADMINISTRADOR";
    }

    public async consultar(ator: Ator, id: string): Promise<ResumoTarefa> {
        exigirPermissao(ator, Permissao.RELATORIOS_ASSINCRONOS);
        return this.carregar(ator, id);
    }

    public async listar(ator: Ator, paginacao: ParametrosPaginacao) {
        exigirPermissao(ator, Permissao.RELATORIOS_ASSINCRONOS);
        const filtro = ehParceiro(ator) ? { chaveApiId: ator.id }
            : ator.papel === "ADMINISTRADOR" ? {} : { solicitante: ator.login };
        return this.uow.leitura.tarefas.listar(filtro, paginacao);
    }

    // Cancela uma tarefa ainda na fila ou apaga um relatório já finalizado (e o arquivo).
    public async excluir(ator: Ator, id: string): Promise<void> {
        exigirPermissao(ator, Permissao.RELATORIOS_ASSINCRONOS);
        const tarefa = await this.carregar(ator, id);
        if (tarefa.situacao === "PROCESSANDO" || !await this.uow.leitura.tarefas.excluir(tarefa.id)) {
            throw new ErroConflito("O relatório está sendo gerado agora e não pode ser excluído. Tente de novo em instantes.");
        }
        await this.uow.leitura.auditoria.registrar({
            operacao: tarefa.situacao === "PENDENTE" ? "RELATORIO_CANCELAR" : "RELATORIO_EXCLUIR", entidade: "TarefaRelatorio",
            entidadeId: tarefa.id, usuario: ator.login, dataHora: this.relogio.agora(),
            antes: { tipo: tarefa.tipo, formato: tarefa.formato, situacao: tarefa.situacao }
        });
    }

    public async baixar(ator: Ator, id: string): Promise<{ conteudo: string; tipoConteudo: string; nomeArquivo: string; hash: string }> {
        exigirPermissao(ator, Permissao.RELATORIOS_ASSINCRONOS);
        const resumo = await this.carregar(ator, id);
        if (resumo.situacao === "FALHOU") {
            throw new ErroRegraNegocio(`O relatório falhou após ${resumo.tentativas} tentativa(s): ${resumo.erro}`);
        }
        if (resumo.situacao !== "CONCLUIDA") {
            throw new ErroConflito(`O relatório ainda está ${resumo.situacao === "PENDENTE" ? "na fila" : "em processamento"}. ` +
                "Consulte a situação da tarefa e tente de novo quando estiver CONCLUIDA.");
        }
        // O expurgo roda de hora em hora; entre o vencimento e ele, o arquivo já não é entregue.
        if (resumo.expiraEm && resumo.expiraEm.getTime() <= this.relogio.agora().getTime()) {
            throw new ErroExpirado(`O arquivo deste relatório expirou em ${resumo.expiraEm.toISOString()}. Solicite um novo relatório.`);
        }
        const tarefa = (await this.uow.leitura.tarefas.buscarComConteudo(id))!;
        return {
            conteudo: tarefa.conteudo!, tipoConteudo: tarefa.tipoConteudo!, hash: tarefa.hashConteudo!,
            nomeArquivo: `greencode-${tarefa.tipo.toLowerCase().replace(/_/g, "-")}-${dataParaISO(tarefa.criadaEm)}.${EXTENSAO[tarefa.formato]}`
        };
    }

    // ------------------------------------------------------------------ processamento (worker)

    // Executado pelo worker da fila a cada tentativa. Política de retry:
    //  - erro de regra/validação (4xx): repetir não adianta → falha definitiva na hora;
    //  - erro técnico (banco ocupado, timeout...): devolve à fila; na última tentativa → FALHOU.
    public processar = async (tarefaId: string, info: InfoTentativa): Promise<void> => {
        const repos = this.uow.leitura;
        if (!await repos.tarefas.iniciarTentativa(tarefaId, info.tentativa, this.relogio.agora())) {
            return; // tarefa inexistente ou já finalizada (job repetido): nada a fazer
        }
        try {
            const tarefa = (await repos.tarefas.buscar(tarefaId))!;
            const arquivo = await this.gerar(tarefa);
            const tamanhoBytes = Buffer.byteLength(arquivo.conteudo, "utf8");
            if (tamanhoBytes > TAMANHO_MAXIMO_BYTES) {
                throw new ErroRegraNegocio(`O relatório gerado tem ${(tamanhoBytes / 1048576).toFixed(1)} MB, acima do limite de 10 MB. ` +
                    "Restrinja o período ou a organização.");
            }
            const agora = this.relogio.agora();
            await repos.tarefas.concluir(tarefaId, {
                ...arquivo, tamanhoBytes, hashConteudo: createHash("sha256").update(arquivo.conteudo, "utf8").digest("hex"),
                concluidaEm: agora, expiraEm: new Date(agora.getTime() + this.opcoes.retencaoHoras * 3_600_000)
            });
        } catch (erro) {
            const naoRecuperavel = erro instanceof ErroGreencode && erro.statusHttp < 500;
            const definitiva = naoRecuperavel || info.ultimaTentativa;
            const mensagem = erro instanceof Error ? erro.message : String(erro);
            await repos.tarefas.registrarFalha(tarefaId, mensagem, definitiva, this.relogio.agora());
            throw naoRecuperavel ? new FalhaDefinitiva(mensagem) : erro;
        }
    };

    private async gerar(tarefa: ResumoTarefa): Promise<ArquivoGerado> {
        const parametros = tarefa.parametros as { inicio: string | null; fim: string | null };
        const escopo: EscopoAnalise = {
            organizacaoId: tarefa.organizacaoId ?? undefined,
            inicio: parametros.inicio ? lerData(parametros.inicio) : undefined,
            fim: parametros.fim ? lerData(parametros.fim) : undefined
        };
        if (escopo.organizacaoId && !await this.uow.leitura.organizacoes.buscar(escopo.organizacaoId)) {
            throw new ErroNaoEncontrado(`A organização ${escopo.organizacaoId} não existe mais.`);
        }
        const csv = tarefa.formato === FormatoRelatorio.CSV;
        const comoJson = (dados: unknown): ArquivoGerado => ({ conteudo: JSON.stringify(dados, null, 2), tipoConteudo: "application/json; charset=utf-8" });
        const comoCsv = (conteudo: string): ArquivoGerado => ({ conteudo, tipoConteudo: "text/csv; charset=utf-8" });

        switch (tarefa.tipo) {
            case TipoRelatorio.EFICIENCIA_OPERACIONAL: {
                const lotes = await this.analises.dadosEficiencia(escopo);
                if (csv) return comoCsv(csvEficiencia(lotes));
                return comoJson({ ...await this.analises.calcularEficiencia(escopo, lotes), lotes: lotes.map(temposDoLote) });
            }
            case TipoRelatorio.RENTABILIDADE: {
                const itens = await this.analises.dadosRentabilidade(escopo);
                if (csv) {
                    return comoCsv(gerarCsv([
                        { titulo: "equipamento_id", valor: e => e.id }, { titulo: "tipo", valor: e => e.tipo },
                        { titulo: "marca", valor: e => e.marca }, { titulo: "modelo", valor: e => e.modelo },
                        { titulo: "estado_fisico", valor: e => e.estadoFisico }, { titulo: "status", valor: e => e.statusRastreamento },
                        { titulo: "peso_kg", valor: e => e.pesoQuilogramas }, { titulo: "valor_referencia", valor: e => e.valorReferencia },
                        { titulo: "valor_recuperacao", valor: e => e.valorRecuperacao }
                    ], itens));
                }
                return comoJson({ ...await this.analises.calcularRentabilidade(escopo, itens), equipamentos: itens });
            }
            case TipoRelatorio.VIDA_UTIL: {
                const completo = await this.analises.calcularVidaUtilCompleta(escopo);
                const previsoes = completo.previsoes.map(previsaoJSON);
                if (csv) {
                    return comoCsv(gerarCsv([
                        { titulo: "equipamento_id", valor: p => p.equipamentoId }, { titulo: "tipo", valor: p => p.tipo },
                        { titulo: "estado_fisico", valor: p => p.estadoFisico }, { titulo: "idade_anos", valor: p => p.idadeAnos },
                        { titulo: "anos_restantes", valor: p => p.anosRestantes },
                        { titulo: "data_prevista_inservivel", valor: p => p.dataPrevistaInservivel }, { titulo: "metodo", valor: p => p.metodo }
                    ], previsoes));
                }
                return comoJson({ tipo: tarefa.tipo, geradoEm: this.relogio.agora().toISOString(), escopo: { organizacaoId: tarefa.organizacaoId }, resultado: { ...completo, previsoes } });
            }
            case TipoRelatorio.INVENTARIO_RASTREABILIDADE: {
                const itens = await this.uow.leitura.analises.equipamentos(escopo, true);
                const linhas = itens.map(({ equipamento: e, organizacaoId, dataEntrada }) => ({
                    id: e.id, codigoBarrasInterno: e.codigoBarrasInterno, tipo: e.tipo, marca: e.marca, modelo: e.modelo,
                    anoFabricacao: e.anoFabricacao, estadoFisico: e.estadoFisico, statusRastreamento: e.statusRastreamento,
                    pesoQuilogramas: e.pesoQuilogramas, loteId: e.loteId, organizacaoId, dataEntradaLote: dataParaISO(dataEntrada),
                    localizacaoAtual: e.localizacaoAtual(),
                    ultimaMovimentacaoEm: e.historicoMovimentacao[e.historicoMovimentacao.length - 1]?.dataHora.toISOString() ?? null
                }));
                if (csv) {
                    return comoCsv(gerarCsv([
                        { titulo: "equipamento_id", valor: l => l.id }, { titulo: "codigo_barras", valor: l => l.codigoBarrasInterno },
                        { titulo: "tipo", valor: l => l.tipo }, { titulo: "marca", valor: l => l.marca }, { titulo: "modelo", valor: l => l.modelo },
                        { titulo: "ano_fabricacao", valor: l => l.anoFabricacao }, { titulo: "estado_fisico", valor: l => l.estadoFisico },
                        { titulo: "status", valor: l => l.statusRastreamento }, { titulo: "peso_kg", valor: l => l.pesoQuilogramas },
                        { titulo: "lote_id", valor: l => l.loteId }, { titulo: "organizacao_id", valor: l => l.organizacaoId },
                        { titulo: "data_entrada_lote", valor: l => l.dataEntradaLote }, { titulo: "localizacao_atual", valor: l => l.localizacaoAtual },
                        { titulo: "ultima_movimentacao_em", valor: l => l.ultimaMovimentacaoEm }
                    ], linhas));
                }
                return comoJson({ tipo: tarefa.tipo, geradoEm: this.relogio.agora().toISOString(), escopo: { organizacaoId: tarefa.organizacaoId }, total: linhas.length, equipamentos: linhas });
            }
        }
    }

    // ------------------------------------------------------------------ manutenção (agendada)

    // Recoloca na fila as tarefas PENDENTES/PROCESSANDO do banco: cobre a fila em memória depois de
    // um reinício e o Redis fora do ar no momento da solicitação. O jobId único evita duplicar.
    public async recuperarPendentes(): Promise<number> {
        const ids = await this.uow.leitura.tarefas.idsEmAndamento();
        for (const id of ids) await this.enfileirarComSeguranca(id);
        return ids.length;
    }

    public async expurgarExpiradas(): Promise<number> {
        return this.uow.leitura.tarefas.expurgarExpiradas(this.relogio.agora());
    }
}

function temposDoLote(l: LoteParaEficiencia) {
    const dias = (de: Date | null, ate: Date | null) => de && ate ? arredondar(Math.max(0, ate.getTime() - de.getTime()) / 86_400_000) : null;
    return {
        loteId: l.id, organizacaoId: l.organizacaoId, dataEntrada: dataParaISO(l.dataEntrada), statusProcessamento: l.statusProcessamento,
        equipamentos: l.quantidadeEquipamentos, triagemIniciadaEm: l.triagemIniciadaEm?.toISOString() ?? null,
        triagemConcluidaEm: l.triagemConcluidaEm?.toISOString() ?? null, operador: l.triagemIniciadaPor,
        esperaDias: dias(l.dataEntrada, l.triagemIniciadaEm), triagemDias: dias(l.triagemIniciadaEm, l.triagemConcluidaEm),
        totalDias: dias(l.dataEntrada, l.triagemConcluidaEm)
    };
}

function csvEficiencia(lotes: LoteParaEficiencia[]): string {
    return gerarCsv([
        { titulo: "lote_id", valor: t => t.loteId }, { titulo: "organizacao_id", valor: t => t.organizacaoId },
        { titulo: "data_entrada", valor: t => t.dataEntrada }, { titulo: "status", valor: t => t.statusProcessamento },
        { titulo: "equipamentos", valor: t => t.equipamentos }, { titulo: "operador", valor: t => t.operador },
        { titulo: "triagem_iniciada_em", valor: t => t.triagemIniciadaEm }, { titulo: "triagem_concluida_em", valor: t => t.triagemConcluidaEm },
        { titulo: "espera_dias", valor: t => t.esperaDias }, { titulo: "triagem_dias", valor: t => t.triagemDias }, { titulo: "total_dias", valor: t => t.totalDias }
    ], lotes.map(temposDoLote));
}
