// Prepara o banco de TESTE (DATABASE_URL_TESTE): aplica as migrações pendentes (migrate deploy,
// não destrutivo). Cada arquivo de teste esvazia as tabelas desse banco antes de começar.
// Usa o Node diretamente (sem npx/shell) para funcionar igual no Windows e no Linux.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import dotenv from "dotenv";

dotenv.config({ quiet: true });
const urlTeste = process.env.DATABASE_URL_TESTE;
if (!urlTeste) {
    console.error("Defina DATABASE_URL_TESTE no .env (banco exclusivo para os testes; ele é apagado a cada execução).");
    process.exit(1);
}
if (urlTeste === process.env.DATABASE_URL) {
    console.error("DATABASE_URL_TESTE não pode ser igual a DATABASE_URL: os testes apagam todos os dados.");
    process.exit(1);
}
const require = createRequire(import.meta.url);
const cliPrisma = require.resolve("prisma/build/index.js");
const resultado = spawnSync(process.execPath, [cliPrisma, "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: urlTeste, PRISMA_HIDE_UPDATE_MESSAGE: "1" },
    stdio: ["ignore", "ignore", "inherit"]
});
if (resultado.status !== 0) {
    console.error("Falha ao preparar o banco de teste. O PostgreSQL está rodando e o banco existe?");
    process.exit(resultado.status ?? 1);
}
console.log("Banco de teste com as migrações em dia.");
