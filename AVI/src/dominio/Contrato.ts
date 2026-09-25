import Relogio, { RelogioSistema } from "../comum/Relogio";
import { ErroRegraNegocio } from "../comum/erros";
import { formatarData, inicioDoDia } from "../comum/datas";

export default class Contrato {
    public id: string;
    public organizacaoId: string;
    public dataAssinatura: Date;
    public dataVencimento: Date;
    public clausulas: string[];
    public valorMensal: number;
    public renovacaoAutomatica: boolean;
    private readonly relogio: Relogio;

    constructor(dados: {
        id: string; organizacaoId: string; dataAssinatura: Date; dataVencimento: Date;
        clausulas: string[]; valorMensal: number; renovacaoAutomatica: boolean;
    }, relogio: Relogio = new RelogioSistema()) {
        this.id = dados.id;
        this.organizacaoId = dados.organizacaoId;
        this.dataAssinatura = dados.dataAssinatura;
        this.dataVencimento = dados.dataVencimento;
        this.clausulas = dados.clausulas;
        this.valorMensal = dados.valorMensal;
        this.renovacaoAutomatica = dados.renovacaoAutomatica;
        this.relogio = relogio;
    }

    public estaVigente(): boolean {
        const hoje = inicioDoDia(this.relogio.agora()).getTime();
        if (hoje < inicioDoDia(this.dataAssinatura).getTime()) {
            return false;
        }
        return this.renovacaoAutomatica || hoje <= inicioDoDia(this.dataVencimento).getTime();
    }

    public renovar(novoVencimento: Date): void {
        if (inicioDoDia(novoVencimento) <= inicioDoDia(this.dataVencimento)) {
            throw new ErroRegraNegocio(
                `O novo vencimento deve ser posterior ao atual (${formatarData(this.dataVencimento)}).`);
        }
        if (inicioDoDia(novoVencimento) <= inicioDoDia(this.relogio.agora())) {
            throw new ErroRegraNegocio("O novo vencimento deve ser uma data futura.");
        }
        this.dataVencimento = novoVencimento;
    }
}
