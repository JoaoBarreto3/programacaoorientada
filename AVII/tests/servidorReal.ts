import { ChildProcess, spawn } from "node:child_process";
import path from "node:path";
import { configuracaoTeste } from "./auxiliares";

// Sobe o servidor REAL (dist/src/server.js) em outro processo, numa porta livre, apontando
// para o banco de teste. Usado pela jornada de ponta a ponta e pelos testes da interface.

const SERVIDOR = path.resolve(__dirname, "..", "src", "server.js");

export interface Servidor {
    processo: ChildProcess;
    url: string;
    saida: string[];
}

export function iniciarServidor(): Promise<Servidor> {
    const config = configuracaoTeste();
    const processo = spawn(process.execPath, [SERVIDOR], {
        env: {
            ...process.env, DATABASE_URL: config.urlBanco, PORT: "0", HOST: "127.0.0.1",
            JWT_SEGREDO: config.jwtSegredo, SENHA_ITERACOES: "1000", LOG_NIVEL: "info"
        },
        stdio: ["ignore", "pipe", "pipe"]
    });
    const saida: string[] = [];
    return new Promise((resolver, rejeitar) => {
        const limite = setTimeout(() => rejeitar(new Error("servidor não iniciou:\n" + saida.join(""))), 15_000);
        const ler = (pedaco: Buffer) => {
            saida.push(pedaco.toString());
            const porta = /Server listening at http:\/\/127\.0\.0\.1:(\d+)/.exec(saida.join(""));
            if (porta) {
                clearTimeout(limite);
                resolver({ processo, url: `http://127.0.0.1:${porta[1]}`, saida });
            }
        };
        processo.stdout!.on("data", ler);
        processo.stderr!.on("data", ler);
        processo.on("exit", codigo => rejeitar(new Error(`servidor saiu com código ${codigo}:\n${saida.join("")}`)));
    });
}

export function encerrarServidor(servidor: Servidor): Promise<number | null> {
    return new Promise(resolver => {
        if (servidor.processo.exitCode !== null) return resolver(servidor.processo.exitCode);
        servidor.processo.removeAllListeners("exit");
        servidor.processo.on("exit", codigo => resolver(codigo));
        servidor.processo.kill("SIGTERM");
    });
}
