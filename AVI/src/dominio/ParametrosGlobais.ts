import TipoEquipamento from "./enums/TipoEquipamento";
import { ErroValidacao } from "../comum/erros";

export type ParametrosJSON = {
    id: string;
    aliquotas: Record<string, number>;
    coeficientesDepreciacao: Record<TipoEquipamento, number>;
    valoresReferencia: Record<TipoEquipamento, number>;
    retencaoJournalDias: number;
};

export default class ParametrosGlobais {
    public static readonly ID = "globais";
    public static readonly RETENCAO_MINIMA_DIAS = 180;

    public aliquotas: Record<string, number>;
    public coeficientesDepreciacao: Record<TipoEquipamento, number>;
    public valoresReferencia: Record<TipoEquipamento, number>;
    public retencaoJournalDias: number;

    constructor(json: Omit<ParametrosJSON, "id">) {
        this.aliquotas = { ...json.aliquotas };
        this.coeficientesDepreciacao = { ...json.coeficientesDepreciacao };
        this.valoresReferencia = { ...json.valoresReferencia };
        this.retencaoJournalDias = json.retencaoJournalDias;
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
            retencaoJournalDias: ParametrosGlobais.RETENCAO_MINIMA_DIAS
        });
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
        if (!Number.isInteger(dias) || dias < ParametrosGlobais.RETENCAO_MINIMA_DIAS) {
            throw new ErroValidacao(
                `A retenção do journal deve ser de no mínimo ${ParametrosGlobais.RETENCAO_MINIMA_DIAS} dias.`);
        }
        this.retencaoJournalDias = dias;
    }

    public somaAliquotas(): number {
        return Object.values(this.aliquotas).reduce((a, b) => a + b, 0);
    }

    public paraJSON(): ParametrosJSON {
        return {
            id: ParametrosGlobais.ID,
            aliquotas: { ...this.aliquotas },
            coeficientesDepreciacao: { ...this.coeficientesDepreciacao },
            valoresReferencia: { ...this.valoresReferencia },
            retencaoJournalDias: this.retencaoJournalDias
        };
    }

    public static deJSON(json: ParametrosJSON): ParametrosGlobais {
        const padrao = ParametrosGlobais.padrao();
        return new ParametrosGlobais({
            aliquotas: json.aliquotas ?? padrao.aliquotas,
            coeficientesDepreciacao: { ...padrao.coeficientesDepreciacao, ...json.coeficientesDepreciacao },
            valoresReferencia: { ...padrao.valoresReferencia, ...json.valoresReferencia },
            retencaoJournalDias: Math.max(json.retencaoJournalDias ?? 0, ParametrosGlobais.RETENCAO_MINIMA_DIAS)
        });
    }
}
