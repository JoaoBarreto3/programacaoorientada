import { randomUUID } from "node:crypto";
import EntidadeVersionada from "./EntidadeVersionada";
import { ErroRegraNegocio, ErroValidacao } from "../comum/erros";
import { formatarData } from "../comum/datas";

export interface DadosContrato {
    dataAssinatura: Date;
    dataVencimento: Date;
    clausulas: string[];
    valorMensal: number;
    renovacaoAutomatica: boolean;
}

export const MAX_CLAUSULAS = 50;

export default class Contrato extends EntidadeVersionada {
    public readonly id: string;
    public organizacaoId: string;
    public dataAssinatura: Date;
    public dataVencimento: Date;
    public clausulas: string[];
    public valorMensal: number;
    public renovacaoAutomatica: boolean;

    constructor(dados: DadosContrato & { id: string; organizacaoId: string; versao: number }) {
        super(dados.versao);
        this.id = dados.id;
        this.organizacaoId = dados.organizacaoId;
        this.dataAssinatura = dados.dataAssinatura;
        this.dataVencimento = dados.dataVencimento;
        this.clausulas = dados.clausulas;
        this.valorMensal = dados.valorMensal;
        this.renovacaoAutomatica = dados.renovacaoAutomatica;
    }

    public static criar(organizacaoId: string, dados: DadosContrato): Contrato {
        return new Contrato({ ...Contrato.validar(dados), id: randomUUID(), organizacaoId, versao: 1 });
    }

    public static validar(dados: DadosContrato): DadosContrato {
        if (dados.dataVencimento.getTime() <= dados.dataAssinatura.getTime()) {
            throw new ErroValidacao("A data de vencimento do contrato deve ser posterior à de assinatura.");
        }
        if (!Number.isFinite(dados.valorMensal) || dados.valorMensal < 0) {
            throw new ErroValidacao("Valor mensal do contrato inválido.");
        }
        if (Math.round(dados.valorMensal * 100) !== dados.valorMensal * 100) {
            throw new ErroValidacao("O valor mensal deve ter no máximo duas casas decimais.");
        }
        const clausulas = dados.clausulas.map(c => c.trim()).filter(c => c.length > 0);
        if (clausulas.length === 0) {
            throw new ErroValidacao("Informe ao menos uma cláusula de coleta.");
        }
        if (clausulas.length > MAX_CLAUSULAS) {
            throw new ErroValidacao(`O contrato pode ter no máximo ${MAX_CLAUSULAS} cláusulas.`);
        }
        return { ...dados, clausulas };
    }

    public descricao(): string {
        return `O contrato da organização ${this.organizacaoId}`;
    }

    // hoje: data civil (ver comum/datas.ts).
    public estaVigente(hoje: Date): boolean {
        if (hoje.getTime() < this.dataAssinatura.getTime()) {
            return false;
        }
        return this.renovacaoAutomatica || hoje.getTime() <= this.dataVencimento.getTime();
    }

    public renovar(novoVencimento: Date, hoje: Date): void {
        if (novoVencimento.getTime() <= this.dataVencimento.getTime()) {
            throw new ErroRegraNegocio(
                `O novo vencimento deve ser posterior ao atual (${formatarData(this.dataVencimento)}).`);
        }
        if (novoVencimento.getTime() <= hoje.getTime()) {
            throw new ErroRegraNegocio("O novo vencimento deve ser uma data futura.");
        }
        this.dataVencimento = novoVencimento;
    }

    public alterar(dados: DadosContrato): void {
        Object.assign(this, Contrato.validar(dados));
    }

    public paraJSON(hoje: Date) {
        return {
            id: this.id, organizacaoId: this.organizacaoId,
            dataAssinatura: this.dataAssinatura.toISOString().slice(0, 10),
            dataVencimento: this.dataVencimento.toISOString().slice(0, 10),
            clausulas: [...this.clausulas], valorMensal: this.valorMensal,
            renovacaoAutomatica: this.renovacaoAutomatica, vigente: this.estaVigente(hoje), versao: this.versao
        };
    }
}
