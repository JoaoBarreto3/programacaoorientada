import Lote, { DadosLoteEditaveis } from "../dominio/Lote";
import StatusLote from "../dominio/enums/StatusLote";
import ValidadorDataEntrada from "../validacao/ValidadorDataEntrada";
import { exigirValido } from "../validacao/Validador";
import GeradorCodigos from "../repositorios/GeradorCodigos";
import Relogio from "../comum/Relogio";
import { dataCivil } from "../comum/datas";

export interface DadosLote extends Partial<DadosLoteEditaveis> {
    dataEntrada?: Date;
}

export default class FabricaLote {
    private readonly validadorData: ValidadorDataEntrada;

    constructor(private readonly relogio: Relogio) {
        this.validadorData = new ValidadorDataEntrada(relogio);
    }

    // Data de entrada: hoje (padrão) ou informada; nunca futura nem anterior a 90 dias.
    public validarDataEntrada(data: Date | undefined): Date {
        const dataEntrada = data ?? dataCivil(this.relogio.agora());
        exigirValido(this.validadorData, dataEntrada);
        return dataEntrada;
    }

    public async criar(dados: DadosLote, organizacaoId: string, codigos: GeradorCodigos): Promise<Lote> {
        const dataEntrada = this.validarDataEntrada(dados.dataEntrada);
        const editaveis = Lote.validarDadosEditaveis(dados);
        const ano = dataCivil(this.relogio.agora()).getUTCFullYear();
        const numero = await codigos.proximoLote();
        return new Lote({
            ...editaveis, id: `LT-${ano}-${String(numero).padStart(4, "0")}`, dataEntrada, organizacaoId,
            equipamentos: [], statusProcessamento: StatusLote.RECEBIDO, versao: 1
        });
    }
}
