// Configuração inicial depois de clonar (Windows e Linux): npm run configurar
//  1. confere a versão do Node.js;
//  2. cria o .env a partir do .env.example, com um segredo JWT aleatório (se ainda não existir);
//  3. cria os bancos da aplicação e dos testes no PostgreSQL, se ainda não existirem;
//  4. aplica as migrações (tabelas, constraints e triggers).
// Pode ser executado mais de uma vez: o que já estiver pronto é mantido.
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arquivoEnv = path.join(raiz, ".env");
const ok = texto => console.log(`  [OK] ${texto}`);
const falhar = texto => {
    console.error(`\n  [ERRO] ${texto}\n`);
    process.exit(1);
};

console.log("\nConfigurando o greencode...\n");

// 1. Node.js
const [maior, menor] = process.versions.node.split(".").map(Number);
if (maior < 20 || (maior === 20 && menor < 19)) {
    falhar(`Node.js ${process.versions.node} encontrado; é necessário o 20.19 ou superior (veja o README).`);
}
ok(`Node.js ${process.versions.node}`);

// 2. .env
if (existsSync(arquivoEnv)) {
    ok(".env já existe (mantido)");
} else {
    copyFileSync(path.join(raiz, ".env.example"), arquivoEnv);
    const conteudo = readFileSync(arquivoEnv, "utf8")
        .replace(/^JWT_SEGREDO=.*$/m, `JWT_SEGREDO="${randomBytes(48).toString("hex")}"`);
    writeFileSync(arquivoEnv, conteudo);
    ok(".env criado a partir do .env.example, com um segredo JWT aleatório");
}
dotenv.config({ path: arquivoEnv, quiet: true });

// 3. Bancos de dados
async function garantirBanco(variavel) {
    const texto = process.env[variavel];
    if (!texto) {
        console.log(`  [--] ${variavel} não definida no .env (ignorada)`);
        return;
    }
    const url = new URL(texto);
    const nome = decodeURIComponent(url.pathname.slice(1));
    const servidor = new URL(texto);
    servidor.pathname = "/postgres";
    servidor.search = "";
    const cliente = new pg.Client({ connectionString: servidor.toString() });
    try {
        await cliente.connect();
    } catch (erro) {
        falhar(`Não foi possível conectar ao PostgreSQL em ${url.hostname}:${url.port || 5432} (${erro.message}).\n` +
            "  Verifique se ele está rodando (com Docker: docker compose up -d) e se usuário/senha do .env estão corretos.");
    }
    try {
        const existe = await cliente.query("SELECT 1 FROM pg_database WHERE datname = $1", [nome]);
        if (existe.rowCount) {
            ok(`banco "${nome}" já existe`);
        } else {
            await cliente.query(`CREATE DATABASE "${nome.replace(/"/g, '""')}"`);
            ok(`banco "${nome}" criado`);
        }
    } catch (erro) {
        falhar(`Não foi possível criar o banco "${nome}" (${erro.message}). Crie-o manualmente (veja o README).`);
    } finally {
        await cliente.end();
    }
}
await garantirBanco("DATABASE_URL");
await garantirBanco("DATABASE_URL_TESTE");

// 4. Migrações
const require = createRequire(import.meta.url);
const migracao = spawnSync(process.execPath, [require.resolve("prisma/build/index.js"), "migrate", "deploy"], {
    cwd: raiz, env: { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: "1" }, encoding: "utf8"
});
if (migracao.status !== 0) {
    falhar(`Falha ao aplicar as migrações:\n${migracao.stdout}${migracao.stderr}`);
}
ok("migrações aplicadas (tabelas, constraints e triggers)");

console.log(`
Pronto! Próximos passos:
  npm run db:seed    (opcional) dados de exemplo — usuários admin, operador, gestor e auditor, senha Greencode2026
  npm run dev        inicia o servidor em http://localhost:${process.env.PORT || 3000}
  npm test           roda os testes automatizados
`);
