import Equipamento from "../dominio/Equipamento";
import Movimentacao from "../dominio/Movimentacao";
import EstadoFisico from "../dominio/enums/EstadoFisico";
import StatusRastreamento from "../dominio/enums/StatusRastreamento";
import TipoEquipamento from "../dominio/enums/TipoEquipamento";
import { ClienteBanco, Prisma } from "../infra/banco";
import type { Equipamento as LinhaEquipamento, Movimentacao as LinhaMovimentacao } from "../generated/prisma/client";
import { normalizarPaginacao, ParametrosPaginacao } from "../comum/paginacao";
import { confirmarGravacao, proximaVersao } from "./versionamento";

export interface FiltroEquipamento {
    loteId?: string;
    organizacaoId?: string;
    status?: StatusRastreamento;
    tipo?: TipoEquipamento;
    estado?: EstadoFisico;
}

export function movimentacaoParaDominio(m: LinhaMovimentacao): Movimentacao {
    return new Movimentacao({ ...m });
}

export function equipamentoParaDominio(l: LinhaEquipamento & { movimentacoes?: LinhaMovimentacao[] }): Equipamento {
    return new Equipamento({
        id: l.id, codigoBarrasInterno: l.codigoBarrasInterno, tipo: l.tipo, marca: l.marca, modelo: l.modelo,
        anoFabricacao: l.anoFabricacao, estadoFisico: l.estadoFisico, pesoQuilogramas: Number(l.pesoQuilogramas),
        loteId: l.loteId, posicaoNoLote: l.posicaoNoLote, statusRastreamento: l.statusRastreamento, versao: l.versao,
        historicoMovimentacao: (l.movimentacoes ?? []).map(movimentacaoParaDominio)
    });
}

// Histórico em ordem cronológica (desempate pelo id garante ordem estável).
export const ORDEM_MOVIMENTACOES = [{ dataHora: "asc" }, { id: "asc" }] satisfies Prisma.MovimentacaoOrderByWithRelationInput[];

export default class RepositorioEquipamento {
    constructor(private readonly db: ClienteBanco) {}

    // Aceita o código (EQ-000001) ou o código de barras interno.
    public async buscar(idOuCodigo: string): Promise<Equipamento | null> {
        const chave = idOuCodigo.trim().toUpperCase();
        const linha = await this.db.equipamento.findFirst({
            where: { OR: [{ id: chave }, { codigoBarrasInterno: chave }] },
            include: { movimentacoes: { orderBy: ORDEM_MOVIMENTACOES } }
        });
        return linha ? equipamentoParaDominio(linha) : null;
    }

    public async listar(filtro: FiltroEquipamento, paginacao: ParametrosPaginacao) {
        const { pular, tamanhoPagina, pagina } = normalizarPaginacao(paginacao);
        const where: Prisma.EquipamentoWhereInput = {
            loteId: filtro.loteId, statusRastreamento: filtro.status, tipo: filtro.tipo, estadoFisico: filtro.estado,
            ...(filtro.organizacaoId ? { lote: { organizacaoId: filtro.organizacaoId } } : {})
        };
        const [linhas, total] = await Promise.all([
            this.db.equipamento.findMany({
                where, orderBy: { id: "asc" }, skip: pular, take: tamanhoPagina,
                // Só as movimentações de localização são necessárias para mostrar o local atual.
                include: { movimentacoes: { where: { natureza: "LOCALIZACAO" }, orderBy: ORDEM_MOVIMENTACOES } }
            }),
            this.db.equipamento.count({ where })
        ]);
        return { itens: linhas.map(equipamentoParaDominio), total, pagina, tamanhoPagina };
    }

    public async listarPorStatus(status: StatusRastreamento): Promise<{ equipamento: Equipamento; organizacaoId: string }[]> {
        const linhas = await this.db.equipamento.findMany({
            where: { statusRastreamento: status }, orderBy: { id: "asc" },
            include: {
                lote: { select: { organizacaoId: true } },
                movimentacoes: { where: { natureza: "LOCALIZACAO" }, orderBy: ORDEM_MOVIMENTACOES }
            }
        });
        return linhas.map(l => ({ equipamento: equipamentoParaDominio(l), organizacaoId: l.lote.organizacaoId }));
    }

    public async listarMovimentacoes(equipamentoId: string): Promise<Movimentacao[]> {
        const linhas = await this.db.movimentacao.findMany({ where: { equipamentoId }, orderBy: ORDEM_MOVIMENTACOES });
        return linhas.map(movimentacaoParaDominio);
    }

    private async gravarMovimentacoesPendentes(e: Equipamento): Promise<void> {
        const pendentes = e.movimentacoesPendentes();
        if (pendentes.length) {
            await this.db.movimentacao.createMany({
                data: pendentes.map(m => ({
                    id: m.id, equipamentoId: m.equipamentoId, natureza: m.natureza, dataHora: m.dataHora,
                    origem: m.origem, destino: m.destino, responsavel: m.responsavel, observacao: m.observacao
                }))
            });
        }
        e.confirmarMovimentacoes();
    }

    public async inserir(e: Equipamento): Promise<void> {
        await this.db.equipamento.create({
            data: {
                id: e.id, codigoBarrasInterno: e.codigoBarrasInterno, tipo: e.tipo, marca: e.marca, modelo: e.modelo,
                anoFabricacao: e.anoFabricacao, estadoFisico: e.estadoFisico,
                pesoQuilogramas: new Prisma.Decimal(e.pesoQuilogramas.toFixed(3)), loteId: e.loteId,
                posicaoNoLote: e.posicaoNoLote, statusRastreamento: e.statusRastreamento, versao: e.versao
            }
        });
        await this.gravarMovimentacoesPendentes(e);
    }

    public async atualizar(e: Equipamento): Promise<void> {
        const r = await this.db.equipamento.updateMany({
            where: { id: e.id, versao: e.versao },
            data: {
                marca: e.marca, modelo: e.modelo, anoFabricacao: e.anoFabricacao, estadoFisico: e.estadoFisico,
                pesoQuilogramas: new Prisma.Decimal(e.pesoQuilogramas.toFixed(3)), posicaoNoLote: e.posicaoNoLote,
                statusRastreamento: e.statusRastreamento, versao: proximaVersao()
            }
        });
        confirmarGravacao(r.count, e);
        e.versao++;
        await this.gravarMovimentacoesPendentes(e);
    }

    public async excluir(e: Equipamento): Promise<void> {
        const r = await this.db.equipamento.deleteMany({ where: { id: e.id, versao: e.versao } });
        confirmarGravacao(r.count, e);
    }
}
