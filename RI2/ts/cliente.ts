import Telefone from "./telefone";
import Endereco from "./endereco";

export default class Cliente{
    private nome:string;
    private telefoneCelular:Telefone;
    private email:string;
    private endereco:Endereco;

    constructor(nome:string, telefoneCelular:Telefone, email:string, endereco:Endereco){
        this.nome = nome;
        this.telefoneCelular = telefoneCelular;
        this.email = email;
        this.endereco = endereco;
    }
    //SETTERS
    setNome(nome:string){
        this.nome = nome;
    }
    setTelefoneCelular(telefoneCelular:Telefone){
        this.telefoneCelular = telefoneCelular;
    }
    setEmail(email:string){
        this.email = email;
    }
    setEndereco(endereco:Endereco){
        this.endereco = endereco;
    }
    //GETTERS
    getNome(){
        console.log(`Ǹome: ${this.nome}`);
    }
    getTelefoneCelular(){
        console.log(`Telefone Celular: ${this.telefoneCelular}`);
    }
    getEmail(){
        console.log(`E-Mail: ${this.email}`);
    }
    getEnderecol(){
        console.log(`Endereço: ${this.endereco}`);
    }
    //DESCRIÇÃO
    public descricao = () =>{
        console.log(`--------------
Informações do Cliente:
${this.nome}
--------------`)
        console.log();
        console.log(this.telefoneCelular.descricao());
        console.log();
        console.log(this.endereco.descricao());
    }
}