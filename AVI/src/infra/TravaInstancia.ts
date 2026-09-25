import * as fs from "fs";
import * as path from "path";
import ErroGreencode from "../comum/erros";
import Severidade from "../comum/Severidade";

function processoAtivo(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (erro) {
        return (erro as NodeJS.ErrnoException).code === "EPERM";
    }
}

export default class TravaInstancia {
    private readonly caminho: string;
    private adquirida = false;

    private constructor(caminho: string) {
        this.caminho = caminho;
    }

    public static adquirir(diretorio: string): TravaInstancia {
        const trava = new TravaInstancia(path.join(diretorio, "greencode.lock"));
        for (let tentativa = 0; tentativa < 2; tentativa++) {
            try {
                const fd = fs.openSync(trava.caminho, "wx", 0o600);
                fs.writeSync(fd, String(process.pid));
                fs.closeSync(fd);
                trava.adquirida = true;
                return trava;
            } catch (erro) {
                if ((erro as NodeJS.ErrnoException).code !== "EEXIST") {
                    throw erro;
                }
                const pid = Number(fs.readFileSync(trava.caminho, "utf8").trim());
                if (Number.isInteger(pid) && pid > 0 && pid !== process.pid && processoAtivo(pid)) {
                    throw new ErroGreencode(
                        `Outra instância do greencode (PID ${pid}) já está usando o diretório ${diretorio}.`,
                        Severidade.CRITICO, "INSTANCIA_DUPLICADA");
                }
                fs.rmSync(trava.caminho, { force: true });
            }
        }
        throw new ErroGreencode("Não foi possível adquirir a trava do diretório de dados.", Severidade.CRITICO, "TRAVA");
    }

    public liberar(): void {
        if (this.adquirida) {
            fs.rmSync(this.caminho, { force: true });
            this.adquirida = false;
        }
    }
}
