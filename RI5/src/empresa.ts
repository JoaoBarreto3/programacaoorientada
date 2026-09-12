import Funcionario from "./funcionario"
import Endereco from "./endereco"
import Telefone from "./telefone"

export default class Empresa {
    private funcionarios: Funcionario[];
    private endereco: Endereco;
    private razaoSocial: string;
    private nomeFantasia: string;
    private cnpj: string;
    private telefones: Telefone[];

    constructor(funcionarios, endereco, razaoSocial, nomeFantasia, cnpj, telefones){
        this.funcionarios = funcionarios;
        this.endereco = endereco;
        //JESUS CRISTO É O SENHOR
        this.razaoSocial = razaoSocial;
        this.nomeFantasia = nomeFantasia;
        this.cnpj = cnpj;
        this.telefones = telefones;
    }

    getEmpresa(){
        return `\n
        Razão Social: ${this.razaoSocial}\n
        Nome Fantasia: ${this.nomeFantasia}\n
        cnpj: ${this.cnpj}\n
        Endereço: ${this.endereco.getEndereco()}`
    }

    detalhes(){
        console.log(this.getEmpresa())

        for (const funcionario of this.funcionarios){
            console.log(funcionario.getFuncionario())
        }
    }
}