export default class Telefone{
    numero:string;
    ddd:string;

    constructor(ddd:string, numero:string){
        this.ddd = ddd;
        this.numero = numero;
    }

    getDddMaiusculo():string{
        return this.ddd.toUpperCase();   
    }

    getDddMinusculo():string{
        return this.ddd.toLowerCase();
    }

    getNumeroMaiusculo():string{
        return this.numero.toUpperCase();
    }

    getNumeroMinusculo():string{
        return this.numero.toLowerCase();
    }
}