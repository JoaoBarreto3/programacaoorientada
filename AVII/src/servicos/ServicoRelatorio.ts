import { UsuarioAutenticado } from "../dominio/Sessao";
import Permissao from "../dominio/enums/Permissao";
import StatusRastreamento from "../dominio/enums/StatusRastreamento";
import UnidadeDeTrabalho from "../repositorios/UnidadeDeTrabalho";
import Relogio from "../comum/Relogio";
import { dataParaISO, Periodo, validarPeriodo } from "../comum/datas";
import { ErroNaoEncontrado } from "../comum/erros";
import { exigirPermissao } from "./autorizacao";

const centavos = (valor: number) => Math.round(valor * 100) / 100;

// Relatórios gerenciais (papel AUDITOR e ADMINISTRADOR). Devolvem dados estruturados (JSON);
// a formatação fica por conta de quem consome a API (o front-end SPA, por exemplo).
export default class ServicoRelatorio {
    constructor(private readonly uow: UnidadeDeTrabalho, private readonly relogio: Relogio) {}

    private cabecalho(periodo?: Periodo) {
        return {
            geradoEm: this.relogio.agora().toISOString(),
            ...(periodo ? { periodo: { inicio: dataParaISO(periodo.inicio), fim: dataParaISO(periodo.fim) } } : {})
        };
    }

    public async gerarRelatorioPorOrganizacao(autenticado: UsuarioAutenticado, organizacaoId: string, periodo: Periodo) {
        exigirPermissao(autenticado, Permissao.RELATORIOS_GERAR);
        validarPeriodo(periodo);
        const repos = this.uow.leitura;
        const id = organizacaoId.trim().toUpperCase();
        const organizacao = await repos.organizacoes.buscar(id);
        if (!organizacao) {
            throw new ErroNaoEncontrado(`Organização "${organizacaoId}" não encontrada.`);
        }
        const [lotes, parametros] = await Promise.all([
            repos.lotes.listarTodos({ organizacaoId: id, inicio: periodo.inicio, fim: periodo.fim }),
            repos.parametros.obter()
        ]);
        const ano = this.relogio.agora().getFullYear();
        const equipamentos = lotes.flatMap(l => l.equipamentos);
        const porStatus: Record<string, number> = {};
        for (const e of equipamentos) {
            porStatus[e.statusRastreamento] = (porStatus[e.statusRastreamento] ?? 0) + 1;
        }
        return {
            ...this.cabecalho(periodo),
            organizacao: { id: organizacao.id, razaoSocial: organizacao.razaoSocial, cnpj: organizacao.cnpj, ativo: organizacao.ativo },
            lotes: lotes.map(l => l.paraJSON(false)),
            equipamentosPorStatus: porStatus,
            totais: {
                lotes: lotes.length,
                equipamentos: equipamentos.length,
                pesoKg: Math.round(equipamentos.reduce((s, e) => s + e.pesoQuilogramas, 0) * 1000) / 1000,
                valorResidualEstimado: centavos(equipamentos.reduce((s, e) => s + e.calcularValorResidual(parametros, ano), 0))
            }
        };
    }

    public async gerarRelatorioPorStatus(autenticado: UsuarioAutenticado, status: StatusRastreamento) {
        exigirPermissao(autenticado, Permissao.RELATORIOS_GERAR);
        const itens = await this.uow.leitura.equipamentos.listarPorStatus(status);
        return {
            ...this.cabecalho(),
            status,
            total: itens.length,
            equipamentos: itens.map(({ equipamento: e, organizacaoId }) => ({
                id: e.id, codigoBarrasInterno: e.codigoBarrasInterno, tipo: e.tipo, marca: e.marca, modelo: e.modelo,
                estadoFisico: e.estadoFisico, loteId: e.loteId, organizacaoId, localizacaoAtual: e.localizacaoAtual()
            }))
        };
    }

    public async gerarRelatorioFinanceiro(autenticado: UsuarioAutenticado, periodo: Periodo) {
        exigirPermissao(autenticado, Permissao.RELATORIOS_GERAR);
        validarPeriodo(periodo);
        const repos = this.uow.leitura;
        const [lotes, parametros] = await Promise.all([
            repos.lotes.listarTodos({ inicio: periodo.inicio, fim: periodo.fim }),
            repos.parametros.obter()
        ]);
        const ano = this.relogio.agora().getFullYear();
        const itens = lotes.flatMap(l => l.equipamentos).map(e => {
            const depreciacao = e.calcularDepreciacao(parametros, ano);
            return {
                equipamentoId: e.id, loteId: e.loteId, tipo: e.tipo, estadoFisico: e.estadoFisico,
                valorReferencia: parametros.valoresReferencia[e.tipo],
                depreciacao: Math.round(depreciacao * 10000) / 10000,
                valorResidual: centavos(e.calcularValorResidual(parametros, ano))
            };
        });
        const referencia = itens.reduce((s, i) => s + i.valorReferencia, 0);
        const residual = centavos(itens.reduce((s, i) => s + i.valorResidual, 0));
        const tributos = Object.entries(parametros.aliquotas).map(([imposto, aliquota]) => ({
            imposto, aliquota, valor: centavos(residual * aliquota)
        }));
        const totalTributos = centavos(tributos.reduce((s, t) => s + t.valor, 0));
        return {
            ...this.cabecalho(periodo),
            itens,
            tributos,
            totais: {
                equipamentos: itens.length,
                valorReferencia: centavos(referencia),
                valorResidual: residual,
                tributos: totalTributos,
                valorLiquido: centavos(residual - totalTributos)
            }
        };
    }

    // Indicadores do painel inicial: qualquer usuário autenticado pode ver as contagens.
    public async painel(_autenticado: UsuarioAutenticado) {
        return { ...this.cabecalho(), ...await this.uow.leitura.indicadores.contagens() };
    }
}
