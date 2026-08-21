export default class Endereco{
    private rua:string;
    private numero:string;
    private cidade:string;
    private estado:string;

    constructor(rua:string, numero:string, cidade:string, estado:string){
        this.rua = rua;
        this.numero = numero;
        this.cidade = cidade;
        this.estado = estado;
    }
    //SETTERS
    setRua(rua:string){
        this.rua = rua;
    }
    setNumero(numero:string){
        this.numero = numero;
    }
    setCidade(cidade:string){
        this.cidade = cidade;
    }
    setEstado(estado:string){
        this.estado = estado;
    }
    //GETTERS
    getRua(){
        return this.rua;
    }
    getNumero(){
        return this.numero;
    }
    getCidade(){
        return this.cidade;
    }
    getEstado(){
        return this.estado;
    }

    //FUNÇÕES
    public descricao(): string {
        return `--------------
Endereço:
Rua: ${this.rua}
Número: ${this.numero}
Cidade: ${this.cidade}
Estado: ${this.estado}
--------------`;
    }
}