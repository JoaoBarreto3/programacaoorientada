import Equipamento from "../dominio/Equipamento";
import EstadoFisico from "../dominio/enums/EstadoFisico";
import { LoteParaEficiencia } from "../analises/AnaliseEficiencia";
import { EquipamentoParaVidaUtil, PrevisaoEquipamento, PrevisaoRegistrada } from "../analises/AnaliseVidaUtil";
import { ClienteBanco, Prisma } from "../infra/banco";
import type { OrigemAnalise, TipoAnalise } from "../generated/prisma/client";
import { normalizarPaginacao, ParametrosPaginacao } from "../comum/paginacao";
import { equipamentoParaDominio, ORDEM_MOVIMENTACOES } from "./RepositorioEquipamento";

// Recorte dos dados de uma análise: organização (opcional) e período de entrada dos lotes.
export interface EscopoAnalise {
    organizacaoId?: string;
    inicio?: Date;
    fim?: Date;
}

export interface NovaExecucao {
    tipo: TipoAnalise;
    origem: OrigemAnalise;
    organizacaoId: string | null;
    parametros: Record<string, unknown>;
    resultado: unknown;
    solicitante: string;
    iniciadaEm: Date;
    concluidaEm: Date;
    previsoes?: PrevisaoEquipamento[];
}

function filtroLotes(escopo: EscopoAnalise): Prisma.LoteWhereInput {
    return {
        organizacaoId: escopo.organizacaoId,
        ...(escopo.inicio || escopo.fim ? { dataEntrada: { gte: escopo.inicio, lte: escopo.fim } } : {})
    };
}

const json = (valor: unknown) => JSON.parse(JSON.stringify(valor)) as Prisma.InputJsonValue;

// Leituras para a camada analítica (somente as colunas necessárias) e persistência dos resultados.
export default class RepositorioAnalises {
    constructor(private readonly db: ClienteBanco) {}

    public async lotesParaEficiencia(escopo: EscopoAnalise): Promise<LoteParaEficiencia[]> {
        const linhas = await this.db.lote.findMany({
            where: filtroLotes(escopo), orderBy: { id: "asc" },
            select: {
                id: true, organizacaoId: true, dataEntrada: true, statusProcessamento: true,
                triagemIniciadaEm: true, triagemIniciadaPor: true, triagemConcluidaEm: true, triagemConcluidaPor: true,
                _count: { select: { equipamentos: true } }
            }
        });
        return linhas.map(({ _count, ...l }) => ({ ...l, quantidadeEquipamentos: _count.equipamentos }));
    }

    // Equipamentos do escopo como entidades de domínio (para usar o cálculo de valor residual do
    // próprio Equipamento), com a organização do lote. "comLocalizacao" traz o histórico de locais.
    public async equipamentos(escopo: EscopoAnalise, comLocalizacao = false): Promise<{ equipamento: Equipamento; organizacaoId: string; dataEntrada: Date }[]> {
        const linhas = await this.db.equipamento.findMany({
            where: { lote: filtroLotes(escopo) }, orderBy: { id: "asc" },
            include: {
                lote: { select: { organizacaoId: true, dataEntrada: true } },
                ...(comLocalizacao ? { movimentacoes: { where: { natureza: "LOCALIZACAO" as const }, orderBy: ORDEM_MOVIMENTACOES } } : {})
            }
        });
        return linhas.map(l => ({ equipamento: equipamentoParaDominio(l), organizacaoId: l.lote.organizacaoId, dataEntrada: l.lote.dataEntrada }));
    }

    public async equipamentosParaVidaUtil(escopo: EscopoAnalise): Promise<EquipamentoParaVidaUtil[]> {
        const linhas = await this.db.equipamento.findMany({
            where: { lote: filtroLotes(escopo) }, orderBy: { id: "asc" },
            select: {
                id: true, tipo: true, anoFabricacao: true, estadoFisico: true, statusRastreamento: true, criadoEm: true,
                lote: { select: { triagemConcluidaEm: true } },
                movimentacoes: {
                    where: { OR: [{ natureza: "ESTADO_FISICO" }, { natureza: "STATUS", destino: "BAIXA_DEFINITIVA" }] },
                    orderBy: ORDEM_MOVIMENTACOES, select: { natureza: true, dataHora: true, origem: true, destino: true }
                }
            }
        });
        return linhas.map(l => ({
            id: l.id, tipo: l.tipo, anoFabricacao: l.anoFabricacao, estadoFisico: l.estadoFisico,
            statusRastreamento: l.statusRastreamento, recebidoEm: l.criadoEm,
            mudancasEstado: l.movimentacoes.filter(m => m.natureza === "ESTADO_FISICO")
                .map(m => ({ dataHora: m.dataHora, de: m.origem as EstadoFisico, para: m.destino as EstadoFisico })),
            triagemConcluidaEm: l.lote.triagemConcluidaEm,
            baixaEm: l.movimentacoes.find(m => m.natureza === "STATUS")?.dataHora ?? null
        }));
    }

    // Transação: a execução e as previsões por equipamento são gravadas juntas.
    public async salvarExecucao(e: NovaExecucao): Promise<string> {
        const criada = await this.db.execucaoAnalise.create({
            data: {
                tipo: e.tipo, origem: e.origem, organizacaoId: e.organizacaoId, parametros: json(e.parametros),
                resultado: json(e.resultado), solicitante: e.solicitante, iniciadaEm: e.iniciadaEm, concluidaEm: e.concluidaEm,
                duracaoMs: Math.max(0, e.concluidaEm.getTime() - e.iniciadaEm.getTime())
            },
            select: { id: true }
        });
        if (e.previsoes?.length) {
            await this.db.previsaoVidaUtil.createMany({
                data: e.previsoes.map(p => ({
                    execucaoId: criada.id, equipamentoId: p.equipamentoId, tipo: p.tipo, estadoFisico: p.estadoFisico,
                    idadeAnos: new Prisma.Decimal(p.idadeAnos.toFixed(2)), anosRestantes: new Prisma.Decimal(p.anosRestantes.toFixed(2)),
                    dataPrevistaInservivel: p.dataPrevistaInservivel, metodo: p.metodo
                }))
            });
        }
        return criada.id;
    }

    public async listarExecucoes(filtro: { tipo?: TipoAnalise; organizacaoId?: string | null }, paginacao: ParametrosPaginacao) {
        const { pular, tamanhoPagina, pagina } = normalizarPaginacao(paginacao);
        const where: Prisma.ExecucaoAnaliseWhereInput = {
            tipo: filtro.tipo, ...(filtro.organizacaoId !== undefined ? { organizacaoId: filtro.organizacaoId } : {})
        };
        const [itens, total] = await Promise.all([
            this.db.execucaoAnalise.findMany({
                where, orderBy: [{ concluidaEm: "desc" }, { id: "asc" }], skip: pular, take: tamanhoPagina,
                select: {
                    id: true, tipo: true, origem: true, organizacaoId: true, parametros: true, solicitante: true,
                    iniciadaEm: true, concluidaEm: true, duracaoMs: true, _count: { select: { previsoes: true } }
                }
            }),
            this.db.execucaoAnalise.count({ where })
        ]);
        return { itens: itens.map(({ _count, ...i }) => ({ ...i, previsoes: _count.previsoes })), total, pagina, tamanhoPagina };
    }

    public async buscarExecucao(id: string) {
        return this.db.execucaoAnalise.findUnique({ where: { id }, include: { _count: { select: { previsoes: true } } } });
    }

    public async previsoesDaExecucao(execucaoId: string, paginacao: ParametrosPaginacao) {
        const { pular, tamanhoPagina, pagina } = normalizarPaginacao(paginacao);
        const where = { execucaoId };
        const [itens, total] = await Promise.all([
            this.db.previsaoVidaUtil.findMany({ where, orderBy: [{ anosRestantes: "asc" }, { equipamentoId: "asc" }], skip: pular, take: tamanhoPagina }),
            this.db.previsaoVidaUtil.count({ where })
        ]);
        return { itens, total, pagina, tamanhoPagina };
    }

    // Previsões das execuções de um escopo (null = análises globais), para medir a aderência.
    public async previsoesRegistradas(organizacaoId: string | null): Promise<PrevisaoRegistrada[]> {
        const linhas = await this.db.previsaoVidaUtil.findMany({
            where: { execucao: { organizacaoId } },
            select: {
                execucaoId: true, equipamentoId: true, tipo: true, dataPrevistaInservivel: true, metodo: true,
                execucao: { select: { concluidaEm: true } }
            }
        });
        return linhas.map(l => ({
            execucaoId: l.execucaoId, geradaEm: l.execucao.concluidaEm, equipamentoId: l.equipamentoId, tipo: l.tipo,
            dataPrevistaInservivel: l.dataPrevistaInservivel, metodo: l.metodo
        }));
    }

    // Quando cada equipamento foi reclassificado como INSERVIVEL pela primeira vez.
    public async datasInservivel(equipamentoIds: string[]): Promise<Map<string, Date>> {
        if (equipamentoIds.length === 0) return new Map();
        const linhas = await this.db.movimentacao.groupBy({
            by: ["equipamentoId"],
            where: { equipamentoId: { in: equipamentoIds }, natureza: "ESTADO_FISICO", destino: "INSERVIVEL" },
            _min: { dataHora: true }
        });
        return new Map(linhas.filter(l => l._min.dataHora).map(l => [l.equipamentoId, l._min.dataHora!]));
    }
}
