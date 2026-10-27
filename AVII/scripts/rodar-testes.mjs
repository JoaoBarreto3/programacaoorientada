// Roda o test runner do Node passando os arquivos *.test.js explicitamente.
// Motivo: no Node 20 "node --test pasta/" procura testes dentro da pasta, mas do Node 22 em
// diante os argumentos viram padrões glob e uma pasta é tratada como arquivo (e falha).
// Listar os arquivos aqui funciona igual em qualquer versão, no Windows e no Linux.
// Uso: node scripts/rodar-testes.mjs [opções do node --test] <pasta>...
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const opcoes = process.argv.slice(2).filter((arg) => arg.startsWith("--"));
const pastas = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));

function buscarTestes(pasta) {
    return readdirSync(pasta, { withFileTypes: true }).flatMap((item) => {
        const caminho = join(pasta, item.name);
        if (item.isDirectory()) return buscarTestes(caminho);
        return item.name.endsWith(".test.js") ? [caminho] : [];
    });
}

const arquivos = pastas
    .flatMap((pasta) => (statSync(pasta).isDirectory() ? buscarTestes(pasta) : [pasta]))
    // Barras normais: do Node 22 em diante os argumentos são glob, e "\" (Windows) seria escape.
    .map((arquivo) => arquivo.replaceAll("\\", "/"))
    .sort();
if (arquivos.length === 0) {
    console.error(`Nenhum arquivo *.test.js encontrado em: ${pastas.join(", ")}`);
    process.exit(1);
}

const resultado = spawnSync(process.execPath, ["--test", ...opcoes, ...arquivos], { stdio: "inherit" });
process.exit(resultado.status ?? 1);
