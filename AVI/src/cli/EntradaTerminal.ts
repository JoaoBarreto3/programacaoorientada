import * as readline from "readline";
import { Writable } from "stream";

class SaidaSilenciavel extends Writable {
    public silenciada = false;

    public override _write(chunk: Buffer | string, codificacao: BufferEncoding, concluir: (erro?: Error | null) => void): void {
        if (!this.silenciada) {
            process.stdout.write(chunk, codificacao);
        }
        concluir();
    }
}

type Completador = (linha: string) => [string[], string];

export default class EntradaTerminal {
    public readonly interativo: boolean;
    private readonly saida = new SaidaSilenciavel();
    private readonly rl: readline.Interface;
    private readonly fila: string[] = [];
    private aguardando: ((linha: string | null) => void) | null = null;
    private fechada = false;
    private completador: Completador = linha => [[], linha];

    constructor() {
        this.interativo = !!process.stdin.isTTY;
        this.rl = readline.createInterface({
            input: process.stdin,
            output: this.saida,
            terminal: this.interativo,
            historySize: 500,
            removeHistoryDuplicates: true,
            completer: (linha: string) => this.completador(linha)
        });
        this.rl.on("line", linha => {
            if (this.aguardando) {
                const resolver = this.aguardando;
                this.aguardando = null;
                resolver(linha);
            } else {
                this.fila.push(linha);
            }
        });
        this.rl.on("close", () => {
            this.fechada = true;
            this.aguardando?.(null);
            this.aguardando = null;
        });
        this.rl.on("SIGINT", () => {
            process.stdout.write("\n");
            this.rl.close();
        });
    }

    public definirCompletador(completador: Completador): void {
        this.completador = completador;
    }

    private proximaLinha(): Promise<string | null> {
        const linha = this.fila.shift();
        if (linha !== undefined) {
            return Promise.resolve(linha);
        }
        if (this.fechada) {
            return Promise.resolve(null);
        }
        return new Promise(resolver => { this.aguardando = resolver; });
    }

    public async perguntar(prompt: string): Promise<string | null> {
        this.rl.setPrompt(prompt);
        this.rl.prompt();
        const linha = await this.proximaLinha();
        if (!this.interativo) {
            process.stdout.write((linha ?? "") + "\n");
        }
        return linha;
    }

    public async perguntarSenha(prompt: string): Promise<string | null> {
        this.rl.setPrompt(prompt);
        this.rl.prompt();
        this.saida.silenciada = true;
        let linha: string | null;
        try {
            linha = await this.proximaLinha();
        } finally {
            this.saida.silenciada = false;
        }
        process.stdout.write(this.interativo ? "\n" : "********\n");
        const historico = (this.rl as unknown as { history?: string[] }).history;
        if (historico && linha !== null && historico[0] === linha) {
            historico.shift();
        }
        return linha;
    }

    public definirHistorico(linhas: string[]): void {
        const rl = this.rl as unknown as { history?: string[] };
        if (Array.isArray(rl.history)) {
            rl.history.splice(0, rl.history.length, ...linhas);
        }
    }

    public fechar(): void {
        if (!this.fechada) {
            this.rl.close();
        }
    }
}
