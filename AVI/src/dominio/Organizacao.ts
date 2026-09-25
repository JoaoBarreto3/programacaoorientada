import Contrato from "./Contrato";
import { ErroRegraNegocio, ErroValidacao } from "../comum/erros";

export default class Organizacao {
    public id: string;
    public razaoSocial: string;
    public cnpj: string;
    public inscricaoEstadual: string;
    public enderecoCompleto: string;
    public telefone: string;
    public email: string;
    public dataCadastro: Date;
    public ativo: boolean;
    public contratoVigente: Contrato;

    constructor(dados: {
        id: string; razaoSocial: string; cnpj: string; inscricaoEstadual: string; enderecoCompleto: string;
        telefone: string; email: string; dataCadastro: Date; ativo: boolean; contratoVigente: Contrato;
    }) {
        this.id = dados.id;
        this.razaoSocial = dados.razaoSocial;
        this.cnpj = dados.cnpj;
        this.inscricaoEstadual = dados.inscricaoEstadual;
        this.enderecoCompleto = dados.enderecoCompleto;
        this.telefone = dados.telefone;
        this.email = dados.email;
        this.dataCadastro = dados.dataCadastro;
        this.ativo = dados.ativo;
        this.contratoVigente = dados.contratoVigente;
    }

    public alterarEndereco(novoEndereco: string): void {
        const endereco = novoEndereco.trim();
        if (endereco.length < 10) {
            throw new ErroValidacao("Endereço muito curto: informe logradouro, número, cidade e UF.");
        }
        this.enderecoCompleto = endereco;
    }

    public desativar(): void {
        if (!this.ativo) {
            throw new ErroRegraNegocio(`A organização ${this.id} já está desativada.`);
        }
        this.ativo = false;
    }
}
