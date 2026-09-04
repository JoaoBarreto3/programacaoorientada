import Endereco from "./endereco.js";
import Cliente from "./cliente.js";
import type Telefone from "./telefone.js";

export default class Empresa{
    endereco:Endereco;
    nomeFantasia:string;
    razaoSocial:string;
    private cnpj:string;
    clientes:Cliente[];
    telefones:Telefone[];

    constructor(razaoSocial:string, nomeFantasia:string, cnpj:string, endereco:Endereco, telefones:Telefone[]){
        this.endereco = endereco;
        this.razaoSocial = razaoSocial;
        this.nomeFantasia = nomeFantasia;
//IAMBATMAN2
        this.cnpj = cnpj;
        this.clientes = [];
        this.telefones = telefones
    }

    getCnpj():string{
        return this.cnpj;
    }

    getNomeFantasiaMaiusculo():string{
    return this.nomeFantasia.toUpperCase();   
    }

    getNomeFantasiaMinusculo():string{
        return this.nomeFantasia.toLowerCase();
    }

    getRazaoSocialMaiusculo():string{
    return this.razaoSocial.toUpperCase();   
    }

    getRazaoSocialMinusculo():string{
    return this.razaoSocial.toLowerCase(); 
    }

    getCnpjMaiusculo():string{
        return this.cnpj.toUpperCase();
    }

    getCnpjMinusculo():string{
        return this.cnpj.toLowerCase();
    }

    adicionarCliente(cliente: Cliente){
        this.clientes.push(cliente);
    }

    detalhe(){
        console.log(`Razão Social: ${this.razaoSocial}`);
        console.log(`Nome fantasia: ${this.nomeFantasia}`);
        console.log("-----------------");
        console.log("");

        for (const cliente of this.clientes) {
            console.log(`Nome: ${cliente.nome}`);
            console.log(`Estado: ${cliente.endereco.estado} cidade: ${cliente.endereco.cidade} rua: ${cliente.endereco.rua} numero: ${cliente.endereco.numero}`);

            for (const telefone of cliente.telefones) {
                console.log(`ddd: ${telefone.ddd} numero: ${telefone.numero}`);
            }

            console.log("");
        }
    }
}