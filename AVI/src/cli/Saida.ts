import Severidade from "../comum/Severidade";

const ROTULOS: Record<Severidade, string> = {
    [Severidade.SUCESSO]: "[OK]",
    [Severidade.INFO]: "[INFO]",
    [Severidade.AVISO]: "[AVISO]",
    [Severidade.ERRO]: "[ERRO]",
    [Severidade.CRITICO]: "[CRÍTICO]"
};

const CORES: Record<Severidade, string> = {
    [Severidade.SUCESSO]: "\x1b[32m",
    [Severidade.INFO]: "\x1b[36m",
    [Severidade.AVISO]: "\x1b[33m",
    [Severidade.ERRO]: "\x1b[31m",
    [Severidade.CRITICO]: "\x1b[1;97;41m"
};

const RESET = "\x1b[0m";

export default class Saida {
    private readonly fluxo: NodeJS.WritableStream;
    private readonly cores: boolean;

    constructor(fluxo: NodeJS.WritableStream = process.stdout, cores?: boolean) {
        this.fluxo = fluxo;
        this.cores = cores ?? (!!process.stdout.isTTY && !process.env["NO_COLOR"]);
    }

    public emitir(severidade: Severidade, mensagem: string): void {
        const rotulo = this.cores ? `${CORES[severidade]}${ROTULOS[severidade]}${RESET}` : ROTULOS[severidade];
        const recuo = " ".repeat(ROTULOS[severidade].length + 1);
        this.fluxo.write(`${rotulo} ${mensagem.split("\n").join("\n" + recuo)}\n`);
    }

    public sucesso(mensagem: string): void { this.emitir(Severidade.SUCESSO, mensagem); }
    public info(mensagem: string): void { this.emitir(Severidade.INFO, mensagem); }
    public aviso(mensagem: string): void { this.emitir(Severidade.AVISO, mensagem); }
    public erro(mensagem: string): void { this.emitir(Severidade.ERRO, mensagem); }
    public critico(mensagem: string): void { this.emitir(Severidade.CRITICO, mensagem); }

    public texto(mensagem: string = ""): void {
        this.fluxo.write(mensagem + "\n");
    }

    public titulo(mensagem: string): void {
        this.texto(this.cores ? `\x1b[1m${mensagem}${RESET}` : mensagem);
    }
}
