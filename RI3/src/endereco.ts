export default class Endereco{
    rua:string;
    numero:string;
    estado:string;
    cidade:string;

    constructor(rua:string, numero:string, estado:string, cidade:string){
        this.rua = rua;
        this.numero = numero;
        this.estado = estado;
        this.cidade = cidade;
    }

        getRuaMaiusculo():string{
            return this.rua.toUpperCase();
        }

        getRuaMinusculo():string{
            return this.rua.toLowerCase();
        }

        getNumeroMaiusculo():string{
            return this.numero.toUpperCase();
        }

        getNumeroMinusculo():string{
            return this.numero.toLowerCase();
        }

        getEstadoMaiusculo():string{
            return this.estado.toUpperCase();
        }

        getEstadoMinusculo():string{
            return this.estado.toLowerCase();
        }

        getCidadeMaiusculo():string{
            return this.cidade.toUpperCase();
        }

        getCidadeMinusculo():string{
            return this.cidade.toLowerCase();
        }
}