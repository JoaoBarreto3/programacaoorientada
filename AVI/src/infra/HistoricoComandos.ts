import * as fs from "fs";
import * as path from "path";
import CriptografiaArquivo from "./CriptografiaArquivo";
import { escreverArquivoAtomico } from "./EscritaAtomica";

export default class HistoricoComandos {
    public static readonly TAMANHO_MAXIMO = 500;

    private readonly diretorio: string;
    private readonly criptografia: CriptografiaArquivo;
    private readonly chave: string;

    constructor(diretorio: string, criptografia: CriptografiaArquivo, chave: string) {
        this.diretorio = path.join(diretorio, "historico");
        this.criptografia = criptografia;
        this.chave = chave;
    }

    private caminho(usuario: string): string {
        return path.join(this.diretorio, `${usuario}.dat`);
    }

    public carregar(usuario: string): string[] {
        const arquivo = this.caminho(usuario);
        if (!fs.existsSync(arquivo)) {
            return [];
        }
        try {
            const conteudo = JSON.parse(this.criptografia.decifrar(fs.readFileSync(arquivo, "utf8"), this.chave)) as
                { usuario?: string; comandos?: unknown };
            if (conteudo.usuario !== usuario || !Array.isArray(conteudo.comandos)) {
                return [];
            }
            return conteudo.comandos.filter((l): l is string => typeof l === "string");
        } catch {
            return [];
        }
    }

    public salvar(usuario: string, historico: string[]): void {
        const recorte = historico.slice(0, HistoricoComandos.TAMANHO_MAXIMO);
        const cifrado = this.criptografia.cifrar(JSON.stringify({ usuario, comandos: recorte }), this.chave);
        escreverArquivoAtomico(this.caminho(usuario), cifrado);
    }
}
