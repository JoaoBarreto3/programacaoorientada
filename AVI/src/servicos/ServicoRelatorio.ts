import Lote from "../dominio/Lote";
import Permissao from "../dominio/enums/Permissao";
import StatusRastreamento from "../dominio/enums/StatusRastreamento";
import TipoEquipamento from "../dominio/enums/TipoEquipamento";
import { localizacaoAtual } from "../dominio/rastreamento";
import Relogio from "../comum/Relogio";
import { ErroValidacao } from "../comum/erros";
import { formatarData, inicioDoDia } from "../comum/datas";
import { formatarMoeda, formatarPercentual, formatarTabela } from "../comum/Tabela";
import ServicoLote from "./ServicoLote";
import ServicoEquipamento from "./ServicoEquipamento";
import ServicoParametros from "./ServicoParametros";
import ContextoSessao from "./ContextoSessao";

const INICIO_DOS_REGISTROS = new Date(2000, 0, 1);

export default class ServicoRelatorio {
    private readonly lote: ServicoLote;
    private readonly equipamento: ServicoEquipamento;
    private readonly parametros: ServicoParametros;
    private readonly contexto: ContextoSessao;
    private readonly relogio: Relogio;

    constructor(lote: ServicoLote, equipamento: ServicoEquipamento, parametros: ServicoParametros,
        contexto: ContextoSessao, relogio: Relogio) {
        this.lote = lote;
        this.equipamento = equipamento;
        this.parametros = parametros;
        this.contexto = contexto;
        this.relogio = relogio;
    }

    public gerarRelatorioPorOrganizacao(organizacaoId: string, periodo: { inicio: Date; fim: Date }): string {
        this.contexto.exigir(Permissao.RELATORIOS_GERAR);
        this.validarPeriodo(periodo);
        const id = organizacaoId.trim().toUpperCase();
        const lotes = this.lote.consultarLotePorPeriodo(periodo.inicio, periodo.fim).filter(l => l.organizacaoId === id);
        const equipamentos = lotes.flatMap(l => l.equipamentos);
        const origem = equipamentos[0] ? this.equipamento.rastrearEquipamento(equipamentos[0].id).organizacao : null;
        const porStatus = Object.values(StatusRastreamento)
            .map(s => [s, String(equipamentos.filter(e => e.statusRastreamento === s).length)])
            .filter(([, qtd]) => qtd !== "0");
        const residual = equipamentos.reduce((s, e) => s + this.valorResidual(e.tipo, e.calcularDepreciacao()), 0);
        return [
            ...this.cabecalho(`Relatório da organização ${id}${origem ? ` — ${origem.razaoSocial}` : ""}`, periodo),
            "",
            lotes.length
                ? formatarTabela(["Lote", "Entrada", "NF", "Transportadora", "Equip.", "Peso (kg)", "Status"],
                    lotes.map(l => [l.id, formatarData(l.dataEntrada), l.notaFiscal, l.transportadora,
                        String(l.equipamentos.length), l.calcularPesoTotal().toFixed(2), l.statusProcessamento]))
                : "Nenhum lote no período.",
            "",
            `Total: ${lotes.length} lote(s), ${equipamentos.length} equipamento(s), ` +
            `${equipamentos.reduce((s, e) => s + e.pesoQuilogramas, 0).toFixed(2)} kg, valor residual estimado ${formatarMoeda(residual)}`,
            ...(porStatus.length ? ["", "Equipamentos por status:", formatarTabela(["Status", "Qtd"], porStatus)] : [])
        ].join("\n");
    }

    public gerarRelatorioPorStatus(status: StatusRastreamento): string {
        this.contexto.exigir(Permissao.RELATORIOS_GERAR);
        const equipamentos = this.todosOsLotes().flatMap(l => l.equipamentos).filter(e => e.statusRastreamento === status);
        const linhas = equipamentos.map(e => {
            const h = this.equipamento.rastrearEquipamento(e.id);
            return [e.id, e.codigoBarrasInterno, e.tipo, `${e.marca} ${e.modelo}`, e.estadoFisico, e.loteId,
                h.organizacao.id, localizacaoAtual(h.equipamento) ?? "-"];
        });
        return [
            ...this.cabecalho(`Equipamentos com status ${status}`),
            "",
            linhas.length
                ? formatarTabela(["ID", "Código", "Tipo", "Marca/Modelo", "Estado", "Lote", "Org.", "Local"], linhas)
                : "Nenhum equipamento neste status.",
            "",
            `Total: ${linhas.length}`
        ].join("\n");
    }

    public gerarRelatorioFinanceiro(periodo: { inicio: Date; fim: Date }): string {
        this.contexto.exigir(Permissao.RELATORIOS_GERAR);
        this.validarPeriodo(periodo);
        const parametros = this.parametros.obter();
        const equipamentos = this.lote.consultarLotePorPeriodo(periodo.inicio, periodo.fim).flatMap(l => l.equipamentos);
        let bruto = 0;
        let residual = 0;
        const linhas = equipamentos.map(e => {
            const depreciacao = e.calcularDepreciacao();
            const referencia = parametros.valoresReferencia[e.tipo];
            const valor = this.valorResidual(e.tipo, depreciacao);
            bruto += referencia;
            residual += valor;
            return [e.id, e.tipo, e.estadoFisico, formatarMoeda(referencia), formatarPercentual(depreciacao), formatarMoeda(valor)];
        });
        const tributos = Object.entries(parametros.aliquotas).map(([nome, aliquota]) =>
            [nome, formatarPercentual(aliquota), formatarMoeda(residual * aliquota)]);
        const totalTributos = residual * parametros.somaAliquotas();
        return [
            ...this.cabecalho("Relatório financeiro", periodo),
            "",
            linhas.length
                ? formatarTabela(["Equip.", "Tipo", "Estado", "Referência", "Depreciação", "Residual"], linhas)
                : "Nenhum equipamento recebido no período.",
            "",
            "Tributos sobre o valor de recuperação:",
            formatarTabela(["Imposto", "Alíquota", "Valor"], tributos),
            "",
            `Valor de referência (novo): ${formatarMoeda(bruto)}`,
            `Valor residual estimado:    ${formatarMoeda(residual)}`,
            `Tributos:                   ${formatarMoeda(totalTributos)}`,
            `Valor líquido estimado:     ${formatarMoeda(residual - totalTributos)}`
        ].join("\n");
    }

    private valorResidual(tipo: TipoEquipamento, depreciacao: number): number {
        return this.parametros.obter().valoresReferencia[tipo] * (1 - depreciacao);
    }

    private todosOsLotes(): Lote[] {
        return this.lote.consultarLotePorPeriodo(INICIO_DOS_REGISTROS, this.relogio.agora());
    }

    private validarPeriodo(periodo: { inicio: Date; fim: Date }): void {
        if (inicioDoDia(periodo.fim) < inicioDoDia(periodo.inicio)) {
            throw new ErroValidacao("Período inválido: a data final é anterior à inicial.");
        }
    }

    private cabecalho(titulo: string, periodo?: { inicio: Date; fim: Date }): string[] {
        const linhas = [`=== ${titulo} ===`, `Gerado em ${formatarData(this.relogio.agora())}`];
        if (periodo) {
            linhas.push(`Período: ${formatarData(periodo.inicio)} a ${formatarData(periodo.fim)}`);
        }
        return linhas;
    }
}
