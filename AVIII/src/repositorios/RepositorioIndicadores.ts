import { ClienteBanco } from "../infra/banco";

// Contagens agregadas (GROUP BY) para o painel inicial, calculadas no banco.
export default class RepositorioIndicadores {
    constructor(private readonly db: ClienteBanco) {}

    public async contagens() {
        const [organizacoesAtivas, organizacoes, lotes, equipamentos, usuarios] = await Promise.all([
            this.db.organizacao.count({ where: { ativo: true } }),
            this.db.organizacao.count(),
            this.db.lote.groupBy({ by: ["statusProcessamento"], _count: { _all: true } }),
            this.db.equipamento.groupBy({ by: ["statusRastreamento"], _count: { _all: true }, _sum: { pesoQuilogramas: true } }),
            this.db.usuario.count({ where: { ativo: true } })
        ]);
        return {
            organizacoes, organizacoesAtivas, usuariosAtivos: usuarios,
            lotesPorStatus: Object.fromEntries(lotes.map(l => [l.statusProcessamento, l._count._all])),
            equipamentosPorStatus: Object.fromEntries(equipamentos.map(e => [e.statusRastreamento, e._count._all])),
            pesoTotalKg: Math.round(equipamentos.reduce((s, e) => s + Number(e._sum.pesoQuilogramas ?? 0), 0) * 1000) / 1000
        };
    }
}
