import * as fs from "fs";
import * as path from "path";
import CriptografiaArquivo from "./CriptografiaArquivo";
import { escreverArquivoAtomico } from "./EscritaAtomica";
import { ErroIntegridade } from "../comum/erros";

interface ConteudoArquivo {
    formato: "greencode-dados";
    versao: 1;
    colecao: string;
    registros: any[];
}

export default class RepositorioArquivo {
    public diretorioBase: string;
    public criptografia: CriptografiaArquivo;
    private readonly chave: string;
    private readonly cache = new Map<string, Map<string, any>>();

    constructor(diretorioBase: string, criptografia: CriptografiaArquivo, chave: string) {
        this.diretorioBase = diretorioBase;
        this.criptografia = criptografia;
        this.chave = chave;
    }

    public salvarEntidade(nomeArquivo: string, entidade: any): void {
        this.colecao(nomeArquivo).set(entidade.id, structuredClone(entidade));
        this.persistir(nomeArquivo);
    }

    public carregarEntidade(nomeArquivo: string, id: string): any {
        const registro = this.colecao(nomeArquivo).get(id);
        return registro === undefined ? null : structuredClone(registro);
    }

    public listarEntidades(nomeArquivo: string): any[] {
        return [...this.colecao(nomeArquivo).values()].map(r => structuredClone(r));
    }

    public excluirEntidade(nomeArquivo: string, id: string): void {
        if (this.colecao(nomeArquivo).delete(id)) {
            this.persistir(nomeArquivo);
        }
    }

    private colecao(nomeArquivo: string): Map<string, any> {
        const emCache = this.cache.get(nomeArquivo);
        if (emCache) {
            return emCache;
        }
        const colecao = new Map<string, any>();
        const arquivo = path.join(this.diretorioBase, nomeArquivo);
        if (fs.existsSync(arquivo)) {
            let conteudo: ConteudoArquivo;
            try {
                conteudo = JSON.parse(this.criptografia.decifrar(fs.readFileSync(arquivo, "utf8"), this.chave)) as ConteudoArquivo;
            } catch (erro) {
                throw new ErroIntegridade(`Arquivo "${nomeArquivo}" corrompido ou adulterado (${(erro as Error).message}). ` +
                    "Restaure-o de um backup; o journal permite auditar o último estado conhecido.");
            }
            if (conteudo.formato !== "greencode-dados" || conteudo.colecao !== nomeArquivo) {
                throw new ErroIntegridade(`Arquivo "${nomeArquivo}" corrompido ou adulterado (conteúdo de outra coleção).`);
            }
            for (const registro of conteudo.registros) {
                colecao.set(registro.id, registro);
            }
        }
        this.cache.set(nomeArquivo, colecao);
        return colecao;
    }

    private persistir(nomeArquivo: string): void {
        const conteudo: ConteudoArquivo = {
            formato: "greencode-dados", versao: 1, colecao: nomeArquivo,
            registros: [...this.colecao(nomeArquivo).values()]
        };
        escreverArquivoAtomico(path.join(this.diretorioBase, nomeArquivo),
            this.criptografia.cifrar(JSON.stringify(conteudo), this.chave));
    }
}
