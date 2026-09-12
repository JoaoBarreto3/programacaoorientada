import Endereco from "./endereco"
import Telefone from "./telefone"

export default class Funcionario{
    private nome: string;
    private matricula: string;
    private cpf: string;
    private endereco: Endereco;
    private telefone: Telefone;

    constructor(nome, matricula, cpf, endereco, telefone){
        this.nome = nome;
        this.matricula = matricula;
        this.cpf = cpf;
        this.endereco = endereco;
        this.telefone = telefone;
    }

    getFuncionario(){
        return `\n
        Nome: ${this.nome}\n
        Matrícula: ${this.matricula}\n
        cpf: ${this.cpf}\n
        Telefone: ${this.telefone.getTelefone()}\n
        Endereco: ${this.endereco.getEndereco()}`
    }
}