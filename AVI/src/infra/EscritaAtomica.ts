import * as fs from "fs";
import * as path from "path";
import { randomBytes } from "crypto";

const ERROS_TRANSITORIOS = new Set(["EPERM", "EBUSY", "EACCES"]);

function aguardarSincrono(ms: number): void {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function renomearComRetentativa(origem: string, destino: string): void {
    for (let tentativa = 1; ; tentativa++) {
        try {
            fs.renameSync(origem, destino);
            return;
        } catch (erro) {
            const codigo = (erro as NodeJS.ErrnoException).code ?? "";
            if (!ERROS_TRANSITORIOS.has(codigo) || tentativa >= 10) {
                throw erro;
            }
            aguardarSincrono(20 * tentativa);
        }
    }
}

function sincronizarDiretorio(diretorio: string): void {
    if (process.platform === "win32") {
        return;
    }
    try {
        const fd = fs.openSync(diretorio, "r");
        try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    } catch {
    }
}

export interface OpcoesEscrita {
    modo?: number;
    antesDeRenomear?: (arquivoTemporario: string) => void;
}

export function escreverArquivoAtomico(caminho: string, conteudo: string, opcoes: OpcoesEscrita = {}): void {
    const diretorio = path.dirname(caminho);
    fs.mkdirSync(diretorio, { recursive: true, mode: 0o700 });
    const temporario = `${caminho}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    const fd = fs.openSync(temporario, "wx", opcoes.modo ?? 0o600);
    try {
        fs.writeSync(fd, conteudo, null, "utf8");
        fs.fsyncSync(fd);
    } finally {
        fs.closeSync(fd);
    }
    try {
        opcoes.antesDeRenomear?.(temporario);
        renomearComRetentativa(temporario, caminho);
    } catch (erro) {
        fs.rmSync(temporario, { force: true });
        throw erro;
    }
    sincronizarDiretorio(diretorio);
}

export function limparTemporarios(diretorio: string): string[] {
    if (!fs.existsSync(diretorio)) {
        return [];
    }
    const removidos: string[] = [];
    for (const nome of fs.readdirSync(diretorio)) {
        if (nome.endsWith(".tmp")) {
            fs.rmSync(path.join(diretorio, nome), { force: true });
            removidos.push(nome);
        }
    }
    return removidos;
}
