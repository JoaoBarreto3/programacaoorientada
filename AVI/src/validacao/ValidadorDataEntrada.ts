import Validador from "./Validador";
import Relogio, { RelogioSistema } from "../comum/Relogio";
import { diferencaEmDias, formatarData } from "../comum/datas";

export const LIMITE_DIAS_ENTRADA = 90;

export default class ValidadorDataEntrada extends Validador {
    private readonly relogio: Relogio;

    constructor(relogio: Relogio = new RelogioSistema()) {
        super();
        this.relogio = relogio;
    }

    public validar(data: Date): boolean {
        if (!(data instanceof Date) || Number.isNaN(data.getTime())) {
            this.mensagemErro = "Data de entrada inválida.";
            return false;
        }
        const dias = diferencaEmDias(this.relogio.agora(), data);
        if (dias < 0) {
            this.mensagemErro = `A data de entrada ${formatarData(data)} está no futuro.`;
            return false;
        }
        if (dias > LIMITE_DIAS_ENTRADA) {
            this.mensagemErro = `A data de entrada ${formatarData(data)} é anterior a ${LIMITE_DIAS_ENTRADA} dias (${dias} dias atrás).`;
            return false;
        }
        this.mensagemErro = "";
        return true;
    }
}
