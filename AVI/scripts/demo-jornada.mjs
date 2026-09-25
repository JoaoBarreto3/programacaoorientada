// Executa a jornada de demonstração num diretório de dados novo, em Windows ou Linux:
//   npm run demo
import { spawn } from "node:child_process";
import { createReadStream, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const dados = mkdtempSync(join(tmpdir(), "greencode-demo-"));
console.log(`Diretório de dados da demonstração: ${dados}\n`);
const filho = spawn(process.execPath, [join(raiz, "dist", "src", "main.js"), "--dados", dados], { stdio: ["pipe", "inherit", "inherit"] });
createReadStream(join(raiz, "scripts", "demo-jornada.txt")).pipe(filho.stdin);
filho.on("close", codigo => { process.exitCode = codigo ?? 1; });
