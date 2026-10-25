import EntidadeVersionada from "./EntidadeVersionada";
import TipoEquipamento from "./enums/TipoEquipamento";
import { ErroValidacao } from "../comum/erros";

export const RETENCAO_MINIMA_DIAS = 180;

// Parâmetros configurados pelo administrador: alíquotas de impostos, coeficientes de
// depreciação e valores de referência por tipo de equipamento, e retenção da auditoria.
export default class ParametrosGlobais extends EntidadeVersionada {
    public static readonly ID = "globais";

    public aliquotas: Record<string, number>;
    public coeficientesDepreciacao: Record<TipoEquipamento, number>;
    public valoresReferencia: Record<TipoEquipamento, number>;
    public retencaoAuditoriaDias: number;

    constructor(dados: {
        aliquotas: Record<string, number>;
        coeficientesDepreciacao: Record<TipoEquipamento, number>;
        valoresReferencia: Record<TipoEquipamento, number>;
        retencaoAuditoriaDias: number;
        versao: number;
    }) {
        super(dados.versao);
        this.aliquotas = { ...dados.aliquotas };
        this.coeficientesDepreciacao = { ...dados.coeficientesDepreciacao };
        this.valoresReferencia = { ...dados.valoresReferencia };
        this.retencaoAuditoriaDias = dados.retencaoAuditoriaDias;
    }

    public static padrao(): ParametrosGlobais {
        return new ParametrosGlobais({
            aliquotas: { ISS: 0.05, PIS: 0.0165, COFINS: 0.076 },
            coeficientesDepreciacao: {
                [TipoEquipamento.COMPUTADOR_MESA]: 0.20,
                [TipoEquipamento.NOTEBOOK]: 0.25,
                [TipoEquipamento.MONITOR]: 0.20,
                [TipoEquipamento.IMPRESSORA]: 0.20,
                [TipoEquipamento.SERVIDOR]: 0.20,
                [TipoEquipamento.ROTEADOR]: 0.20,
                [TipoEquipamento.CABO_ESTRUTURADO]: 0.10,
                [TipoEquipamento.FONTE_ALIMENTACAO]: 0.20
            },
            valoresReferencia: {
                [TipoEquipamento.COMPUTADOR_MESA]: 3000,
                [TipoEquipamento.NOTEBOOK]: 4000,
                [TipoEquipamento.MONITOR]: 900,
                [TipoEquipamento.IMPRESSORA]: 1200,
                [TipoEquipamento.SERVIDOR]: 15000,
                [TipoEquipamento.ROTEADOR]: 400,
                [TipoEquipamento.CABO_ESTRUTURADO]: 50,
                [TipoEquipamento.FONTE_ALIMENTACAO]: 150
            },
            retencaoAuditoriaDias: RETENCAO_MINIMA_DIAS,
            versao: 1
        });
    }

    public descricao(): string {
        return "Os parâmetros globais";
    }

    public definirAliquota(imposto: string, valor: number): void {
        if (!/^[A-Z_]{2,20}$/.test(imposto)) {
            throw new ErroValidacao("Nome de imposto inválido (use letras maiúsculas, ex.: ISS, COFINS).");
        }
        if (!(valor >= 0 && valor <= 1)) {
            throw new ErroValidacao("Alíquota deve ser uma fração entre 0 e 1 (ex.: 0.05 = 5%).");
        }
        this.aliquotas[imposto] = valor;
    }

    public removerAliquota(imposto: string): void {
        if (!(imposto in this.aliquotas)) {
            throw new ErroValidacao(`Não existe alíquota "${imposto}".`);
        }
        delete this.aliquotas[imposto];
    }

    public definirCoeficienteDepreciacao(tipo: TipoEquipamento, valor: number): void {
        if (!(valor > 0 && valor <= 1)) {
            throw new ErroValidacao("Coeficiente de depreciação anual deve estar entre 0 (exclusivo) e 1.");
        }
        this.coeficientesDepreciacao[tipo] = valor;
    }

    public definirValorReferencia(tipo: TipoEquipamento, valor: number): void {
        if (!(valor >= 0)) {
            throw new ErroValidacao("Valor de referência não pode ser negativo.");
        }
        this.valoresReferencia[tipo] = valor;
    }

    public definirRetencao(dias: number): void {
        if (!Number.isInteger(dias) || dias < RETENCAO_MINIMA_DIAS) {
            throw new ErroValidacao(`A retenção da auditoria deve ser de no mínimo ${RETENCAO_MINIMA_DIAS} dias.`);
        }
        this.retencaoAuditoriaDias = dias;
    }

    public somaAliquotas(): number {
        return Object.values(this.aliquotas).reduce((a, b) => a + b, 0);
    }

    public paraJSON() {
        return {
            aliquotas: { ...this.aliquotas },
            coeficientesDepreciacao: { ...this.coeficientesDepreciacao },
            valoresReferencia: { ...this.valoresReferencia },
            retencaoAuditoriaDias: this.retencaoAuditoriaDias,
            versao: this.versao
        };
    }
}
