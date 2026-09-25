import * as os from "os";
import * as path from "path";

export function resolverDiretorioDados(argumento?: string): string {
    if (argumento) {
        return path.resolve(argumento);
    }
    if (process.env["GREENCODE_DADOS"]) {
        return path.resolve(process.env["GREENCODE_DADOS"]);
    }
    if (process.platform === "win32") {
        const appData = process.env["APPDATA"] ?? path.join(os.homedir(), "AppData", "Roaming");
        return path.join(appData, "greencode");
    }
    const xdg = process.env["XDG_DATA_HOME"] ?? path.join(os.homedir(), ".local", "share");
    return path.join(xdg, "greencode");
}
