import Telefone from "./telefone.js";
import Endereco from "./endereco.js";

export default class Cliente{
    nome:string;
    endereco:Endereco;
    telefones: Telefone[];
    private cpf:string;

    constructor(nome:string, endereco:Endereco, cpf:string, telefones:Telefone[]){
        this.nome = nome;
        this.endereco = endereco;
        this.cpf = cpf;
        this.telefones = telefones;
    }

    getCpf():string{
        return this.cpf;
    }

    getCpfMaiusculo():string{
        return this.cpf.toUpperCase();
    }

    getCpfMinusculo():string{
        return this.cpf.toLowerCase();
    }

    getNomeMaiusculo():string{
        return this.nome.toUpperCase();
    }

    getNomeMinusculo():string{
        return this.nome.toLowerCase();
    }
}