import { ClienteBanco, Prisma } from "../infra/banco";
import { normalizarPaginacao, ParametrosPaginacao } from "../comum/paginacao";

export interface NovoRegistroAuditoria {
    operacao: string;
    entidade: string;
    entidadeId: string;
    usuario: string;
    dataHora: Date;
    antes?: unknown;
    depois?: unknown;
}

export interface FiltroAuditoria {
    entidade?: string;
    entidadeId?: string;
    usuario?: string;
    operacao?: string;
    inicio?: Date;
    fim?: Date;
}

function json(valor: unknown) {
    return valor === undefined || valor === null
        ? Prisma.DbNull
        : JSON.parse(JSON.stringify(valor)) as Prisma.InputJsonValue;
}

// Trilha de auditoria (sucessora do journal da AV1). Gravada sempre dentro da mesma transação
// da operação de negócio: se a operação falhar, o registro de auditoria também é desfeito.
export default class RepositorioAuditoria {
    constructor(private readonly db: ClienteBanco) {}

    public async registrar(r: NovoRegistroAuditoria): Promise<void> {
        await this.db.registroAuditoria.create({
            data: {
                operacao: r.operacao, entidade: r.entidade, entidadeId: r.entidadeId, usuario: r.usuario,
                dataHora: r.dataHora, dadosAntes: json(r.antes), dadosDepois: json(r.depois)
            }
        });
    }

    public async listar(filtro: FiltroAuditoria, paginacao: ParametrosPaginacao) {
        const { pular, tamanhoPagina, pagina } = normalizarPaginacao(paginacao);
        const where: Prisma.RegistroAuditoriaWhereInput = {
            entidade: filtro.entidade, entidadeId: filtro.entidadeId, usuario: filtro.usuario,
            ...(filtro.operacao ? { operacao: { contains: filtro.operacao.toUpperCase() } } : {}),
            ...(filtro.inicio || filtro.fim ? { dataHora: { gte: filtro.inicio, lt: filtro.fim } } : {})
        };
        const [itens, total] = await Promise.all([
            this.db.registroAuditoria.findMany({ where, orderBy: [{ dataHora: "desc" }, { id: "asc" }], skip: pular, take: tamanhoPagina }),
            this.db.registroAuditoria.count({ where })
        ]);
        return { itens, total, pagina, tamanhoPagina };
    }

    public async listarPorEntidade(entidade: string, entidadeId: string) {
        return this.db.registroAuditoria.findMany({
            where: { entidade, entidadeId }, orderBy: [{ dataHora: "asc" }, { id: "asc" }],
            select: { id: true, dataHora: true, operacao: true, usuario: true }
        });
    }

    // A trigger fn_auditoria_retencao impede, no banco, a exclusão de registros dentro do prazo.
    public async expurgarAnterioresA(limite: Date): Promise<number> {
        const r = await this.db.registroAuditoria.deleteMany({ where: { dataHora: { lt: limite } } });
        return r.count;
    }
}
