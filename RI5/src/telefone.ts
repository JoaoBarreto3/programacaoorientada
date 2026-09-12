export default class Telefone{
    private ddd:string;
    private numero:string;

    constructor(ddd:string, numero:string){
        this.ddd = ddd;
        this.numero = numero;
    }

    getTelefone(){
        return `(${this.ddd} ${this.numero})`
    }
}