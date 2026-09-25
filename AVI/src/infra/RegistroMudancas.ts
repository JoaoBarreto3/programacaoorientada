import RepositorioArquivo from "./RepositorioArquivo";

export type Mudancas = Record<string, Record<string, any>>;

export default class RegistroMudancas {
    public readonly antes: Mudancas = {};
    public readonly depois: Mudancas = {};
    private readonly repositorio: RepositorioArquivo;

    constructor(repositorio: RepositorioArquivo) {
        this.repositorio = repositorio;
    }

    public salvar(arquivo: string, registro: { id: string }): void {
        this.registrar(arquivo, registro.id, structuredClone(registro));
    }

    public excluir(arquivo: string, id: string): void {
        this.registrar(arquivo, id, null);
    }

    private registrar(arquivo: string, id: string, valor: any): void {
        this.antes[arquivo] ??= {};
        this.depois[arquivo] ??= {};
        if (!(id in this.antes[arquivo]!)) {
            this.antes[arquivo]![id] = this.repositorio.carregarEntidade(arquivo, id);
        }
        this.depois[arquivo]![id] = valor;
    }
}
