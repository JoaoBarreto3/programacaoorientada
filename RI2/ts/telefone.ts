export default class Telefone{
    private ddd:string;
    private numero:string;

    constructor(ddd:string, numero:string){
        this.ddd = ddd;
        this.numero = numero;
    }
    //SETTERS
    setDdd(ddd:string){
        this.ddd = ddd;
    }
    setNumero(numero:string){
        this.numero = numero;
    }
    //LETS GET IT
    getDdd(){
        return this.ddd;
    }
    getNumero(){
        return this.numero;
    }

    //FUNÇÕES
    public descricao(){
        return `--------------
Telefone:
DDD: ${this.ddd}
Número: ${this.numero}
--------------`;
    }
}