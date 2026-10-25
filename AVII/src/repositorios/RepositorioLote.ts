import Lote from "../dominio/Lote";
import StatusLote from "../dominio/enums/StatusLote";
import { ClienteBanco, Prisma } from "../infra/banco";
import type { Equipamento as LinhaEquipamento, Lote as LinhaLote, Movimentacao as LinhaMovimentacao } from "../generated/prisma/client";
import { normalizarPaginacao, ParametrosPaginacao } from "../comum/paginacao";
import { equipamentoParaDominio, ORDEM_MOVIMENTACOES } from "./RepositorioEquipamento";
import { confirmarGravacao, proximaVersao } from "./versionamento";

export interface FiltroLote {
    organizacaoId?: string;
    status?: StatusLote;
    inicio?: Date;
    fim?: Date;
}

type LinhaLoteCompleta = LinhaLote & { equipamentos: (LinhaEquipamento & { movimentacoes?: LinhaMovimentacao[] })[] };

function loteParaDominio(l: LinhaLoteCompleta): Lote {
    return new Lote({
        id: l.id, dataEntrada: l.dataEntrada, organizacaoId: l.organizacaoId, notaFiscal: l.notaFiscal,
        transportadora: l.transportadora, statusProcessamento: l.statusProcessamento, observacoes: l.observacoes,
        versao: l.versao, equipamentos: l.equipamentos.map(equipamentoParaDominio)
    });
}

function filtroParaWhere(filtro: FiltroLote): Prisma.LoteWhereInput {
    return {
        organizacaoId: filtro.organizacaoId,
        statusProcessamento: filtro.status,
        ...(filtro.inicio || filtro.fim ? { dataEntrada: { gte: filtro.inicio, lte: filtro.fim } } : {})
    };
}

export default class RepositorioLote {
    constructor(private readonly db: ClienteBanco) {}

    // Carrega o agregado completo: lote + equipamentos (em ordem) + histórico de cada equipamento.
    // Eager loading em uma única chamada ao Prisma, sem consultas N+1.
    public async buscar(id: string): Promise<Lote | null> {
        const linha = await this.db.lote.findUnique({
            where: { id: id.trim().toUpperCase() },
            include: { equipamentos: { orderBy: { posicaoNoLote: "asc" }, include: { movimentacoes: { orderBy: ORDEM_MOVIMENTACOES } } } }
        });
        return linha ? loteParaDominio(linha) : null;
    }

    public async listar(filtro: FiltroLote, paginacao: ParametrosPaginacao) {
        const { pular, tamanhoPagina, pagina } = normalizarPaginacao(paginacao);
        const where = filtroParaWhere(filtro);
        const [linhas, total] = await Promise.all([
            this.db.lote.findMany({
                where, orderBy: { id: "asc" }, skip: pular, take: tamanhoPagina,
                include: { equipamentos: { orderBy: { posicaoNoLote: "asc" } } }
            }),
            this.db.lote.count({ where })
        ]);
        return { itens: linhas.map(loteParaDominio), total, pagina, tamanhoPagina };
    }

    // Para relatórios: todos os lotes do filtro, com equipamentos (sem o histórico).
    public async listarTodos(filtro: FiltroLote): Promise<Lote[]> {
        const linhas = await this.db.lote.findMany({
            where: filtroParaWhere(filtro), orderBy: { id: "asc" },
            include: { equipamentos: { orderBy: { posicaoNoLote: "asc" } } }
        });
        return linhas.map(loteParaDominio);
    }

    public async buscarPorNotaFiscal(organizacaoId: string, notaFiscal: string): Promise<string | null> {
        const linha = await this.db.lote.findUnique({
            where: { organizacaoId_notaFiscal: { organizacaoId, notaFiscal } }, select: { id: true }
        });
        return linha?.id ?? null;
    }

    public async inserir(l: Lote): Promise<void> {
        await this.db.lote.create({
            data: {
                id: l.id, dataEntrada: l.dataEntrada, organizacaoId: l.organizacaoId, notaFiscal: l.notaFiscal,
                transportadora: l.transportadora, statusProcessamento: l.statusProcessamento,
                observacoes: l.observacoes, versao: l.versao
            }
        });
    }

    public async atualizar(l: Lote): Promise<void> {
        const r = await this.db.lote.updateMany({
            where: { id: l.id, versao: l.versao },
            data: {
                dataEntrada: l.dataEntrada, notaFiscal: l.notaFiscal, transportadora: l.transportadora,
                statusProcessamento: l.statusProcessamento, observacoes: l.observacoes, versao: proximaVersao()
            }
        });
        confirmarGravacao(r.count, l);
        l.versao++;
    }

    // Os equipamentos (e o histórico deles) saem em cascata, garantida pela chave estrangeira.
    public async excluir(l: Lote): Promise<void> {
        const r = await this.db.lote.deleteMany({ where: { id: l.id, versao: l.versao } });
        confirmarGravacao(r.count, l);
    }
}
