export default class Endereco{
    private numero: number;
    private rua: string;
    private bairro: string; 
    private cidade: string;

    constructor(numero, rua, bairro, cidade){
        this.numero = numero;
        this.rua = rua;
        this.bairro = bairro;
        this.cidade = cidade;
    }

    getEndereco(){
        return `Rua:${this.rua} Bairro:${this.bairro} Cidade:${this.cidade} Numero: ${this.numero}`
    }
}