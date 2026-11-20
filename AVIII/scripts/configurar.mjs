// Prepara tudo o que o greencode precisa para rodar (Windows e Linux). Executado automaticamente por
// "npm run dev" e "npm test"; também pode ser chamado direto: npm run configurar
//  1. confere a versão do Node.js;
//  2. cria o .env a partir do .env.example, com um segredo JWT aleatório (se ainda não existir);
//  3. garante PostgreSQL e Redis: se não respondem, sobe os containers do docker-compose.yml. Se a porta
//     configurada já estiver ocupada por outro programa (ex.: um PostgreSQL instalado na máquina), escolhe
//     uma porta livre e atualiza o .env. Sem Redis disponível, a fila passa a rodar em memória;
//  4. cria os bancos da aplicação e dos testes, se ainda não existirem;
//  5. aplica as migrações (tabelas, constraints e triggers);
//  6. carrega os dados de exemplo (seed) se o banco ainda estiver vazio.
// Pode ser executado quantas vezes quiser: o que já estiver pronto é mantido.
// Opção --silencioso: só mostra avisos, erros e o que mudou (usado por "npm run dev").
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arquivoEnv = path.join(raiz, ".env");
const silencioso = process.argv.includes("--silencioso");
const ok = texto => { if (!silencioso) console.log(`  [OK] ${texto}`); };
const aviso = texto => console.log(`  [!!] ${texto}`);
const falhar = texto => {
    console.error(`\n  [ERRO] ${texto}\n`);
    process.exit(1);
};
const esperar = ms => new Promise(r => setTimeout(r, ms));

if (!silencioso) console.log("\nConfigurando o greencode...\n");

// ------------------------------------------------------------------ 1. Node.js
const [maior, menor] = process.versions.node.split(".").map(Number);
if (maior < 20 || (maior === 20 && menor < 19)) {
    falhar(`Node.js ${process.versions.node} encontrado; é necessário o 20.19 ou superior (veja o README).`);
}
ok(`Node.js ${process.versions.node}`);

// ------------------------------------------------------------------ 2. .env
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

// Grava (ou acrescenta) CHAVE="valor" no .env e em process.env.
function definirNoEnv(chave, valor) {
    let conteudo = readFileSync(arquivoEnv, "utf8");
    const linha = `${chave}="${valor}"`;
    const padrao = new RegExp(`^#?\\s*${chave}=.*$`, "m");
    conteudo = padrao.test(conteudo) ? conteudo.replace(padrao, linha) : `${conteudo.replace(/\s*$/, "")}\n${linha}\n`;
    writeFileSync(arquivoEnv, conteudo);
    process.env[chave] = valor;
}

// ------------------------------------------------------------------ 3. PostgreSQL e Redis
const LOCAIS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const PORTA_PADRAO = { postgres: 5432, redis: 6379 };
const servicos = {
    postgres: { variaveis: ["DATABASE_URL", "DATABASE_URL_TESTE"], variavelPorta: "POSTGRES_PORTA", responde: postgresResponde },
    redis: { variaveis: ["REDIS_URL", "REDIS_URL_TESTE"], variavelPorta: "REDIS_PORTA", responde: redisResponde }
};
const urlDe = nome => {
    const texto = process.env[servicos[nome].variaveis[0]];
    return texto ? new URL(texto) : null;
};
const portaDe = url => Number(url.port || PORTA_PADRAO[url.protocol.startsWith("redis") ? "redis" : "postgres"]);

function portaOcupada(porta) {
    return new Promise(resolve => {
        const socket = net.connect({ host: "127.0.0.1", port: porta });
        const fim = ocupada => { socket.destroy(); resolve(ocupada); };
        socket.setTimeout(1000, () => fim(true));
        socket.once("connect", () => fim(true));
        socket.once("error", erro => fim(erro.code !== "ECONNREFUSED"));
    });
}

async function portaLivre(aPartirDe) {
    for (let porta = aPartirDe; porta < aPartirDe + 200; porta++) {
        if (!(await portaOcupada(porta))) return porta;
    }
    falhar(`Nenhuma porta livre encontrada a partir de ${aPartirDe}.`);
}

async function postgresResponde() {
    const url = urlDe("postgres");
    url.pathname = "/postgres";
    url.search = "";
    const cliente = new pg.Client({ connectionString: url.toString(), connectionTimeoutMillis: 2000 });
    try {
        await cliente.connect();
        await cliente.query("SELECT 1");
        return true;
    } catch {
        return false;
    } finally {
        await cliente.end().catch(() => {});
    }
}

function redisResponde() {
    const url = urlDe("redis");
    return new Promise(resolve => {
        const socket = net.connect({ host: url.hostname.replace(/^\[|\]$/g, ""), port: portaDe(url) });
        let resposta = "";
        const fim = valor => { socket.destroy(); resolve(valor); };
        socket.setTimeout(2000, () => fim(false));
        socket.once("error", () => fim(false));
        socket.once("connect", () => {
            const senha = decodeURIComponent(url.password || "");
            socket.write(senha ? `AUTH ${senha}\r\nPING\r\n` : "PING\r\n");
        });
        socket.on("data", dados => {
            resposta += dados.toString();
            if (resposta.includes("+PONG")) fim(true);
            else if (resposta.includes("-")) fim(false);
        });
    });
}

function docker(argumentos, mostrar = false) {
    return spawnSync("docker", argumentos, { cwd: raiz, encoding: "utf8", stdio: mostrar ? "inherit" : "pipe" });
}

async function aguardar(nome, segundos) {
    for (let i = 0; i < segundos; i++) {
        if (await servicos[nome].responde()) return true;
        await esperar(1000);
    }
    return false;
}

async function garantirServicos() {
    const faltando = [];
    for (const nome of Object.keys(servicos)) {
        const url = urlDe(nome);
        if (!url) {
            if (nome === "postgres") falhar("DATABASE_URL não definida no .env.");
            ok("REDIS_URL vazia: fila em memória");
            continue;
        }
        if (await servicos[nome].responde()) {
            ok(`${nome === "postgres" ? "PostgreSQL" : "Redis"} respondendo em ${url.host}`);
        } else {
            faltando.push(nome);
        }
    }
    if (faltando.length === 0) return;

    // Só dá para subir pelo Docker o que aponta para esta máquina.
    const locais = faltando.filter(nome => LOCAIS.has(urlDe(nome).hostname));
    const temDocker = locais.length > 0 && docker(["compose", "version"]).status === 0;
    if (temDocker) {
        const rodando = new Set((docker(["compose", "ps", "--status", "running", "--services"]).stdout || "")
            .split(/\r?\n/).map(s => s.trim()).filter(Boolean));
        const ambiente = { ...process.env };
        for (const nome of locais) {
            const s = servicos[nome];
            let porta = portaDe(urlDe(nome));
            // Porta ocupada por outro programa (não pelo nosso container): muda para uma livre.
            if (!rodando.has(nome) && await portaOcupada(porta)) {
                const nova = await portaLivre(porta + 1);
                for (const variavel of s.variaveis) {
                    if (!process.env[variavel]) continue;
                    const u = new URL(process.env[variavel]);
                    u.port = String(nova);
                    definirNoEnv(variavel, u.toString());
                }
                definirNoEnv(s.variavelPorta, String(nova));
                aviso(`porta ${porta} já está em uso por outro programa: ${nome === "postgres" ? "PostgreSQL" : "Redis"} do greencode vai usar a ${nova} (.env atualizado)`);
                porta = nova;
            }
            ambiente[s.variavelPorta] = String(porta);
        }
        console.log(`  [..] iniciando ${locais.join(" e ")} com Docker (docker compose up -d)...`);
        const subida = spawnSync("docker", ["compose", "up", "-d", ...locais], { cwd: raiz, env: ambiente, encoding: "utf8" });
        if (subida.status !== 0) {
            aviso(`docker compose falhou:\n${subida.stderr || subida.stdout}`);
        }
    }

    for (const nome of faltando) {
        const iniciado = temDocker && locais.includes(nome);
        const respondeu = iniciado && await aguardar(nome, nome === "postgres" ? 90 : 30);
        if (nome === "postgres") {
            if (!respondeu) {
                const url = urlDe("postgres");
                falhar(`Não foi possível conectar ao PostgreSQL em ${url.host}.\n` +
                    "  Instale e abra o Docker (Docker Desktop no Windows) e rode o comando de novo,\n" +
                    "  ou aponte DATABASE_URL no .env para um PostgreSQL seu (veja o README).");
            }
            ok(`PostgreSQL respondendo em ${urlDe("postgres").host}`);
        } else if (respondeu) {
            ok(`Redis respondendo em ${urlDe("redis").host}`);
        } else {
            definirNoEnv("REDIS_URL", "");
            definirNoEnv("REDIS_URL_TESTE", "");
            aviso("Redis indisponível: a fila de relatórios vai rodar em memória (REDIS_URL vazia no .env). " +
                "Com o Docker aberto, preencha REDIS_URL de novo para usar o BullMQ.");
        }
    }
}
await garantirServicos();

// ------------------------------------------------------------------ 4. Bancos de dados
async function garantirBanco(variavel) {
    const texto = process.env[variavel];
    if (!texto) {
        ok(`${variavel} não definida no .env (ignorada)`);
        return;
    }
    const nome = decodeURIComponent(new URL(texto).pathname.slice(1));
    const servidor = new URL(texto);
    servidor.pathname = "/postgres";
    servidor.search = "";
    const cliente = new pg.Client({ connectionString: servidor.toString() });
    try {
        await cliente.connect();
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
        await cliente.end().catch(() => {});
    }
}
await garantirBanco("DATABASE_URL");
await garantirBanco("DATABASE_URL_TESTE");

// ------------------------------------------------------------------ 5. Migrações
const require = createRequire(import.meta.url);
const cliPrisma = require.resolve("prisma/build/index.js");
const envPrisma = { ...process.env, PRISMA_HIDE_UPDATE_MESSAGE: "1", PRISMA_HIDE_UPDATE_NOTIFIER: "1" };
const migracao = spawnSync(process.execPath, [cliPrisma, "migrate", "deploy"], { cwd: raiz, env: envPrisma, encoding: "utf8" });
if (migracao.status !== 0) {
    falhar(`Falha ao aplicar as migrações:\n${migracao.stdout}${migracao.stderr}`);
}
ok("migrações aplicadas (tabelas, constraints e triggers)");

// ------------------------------------------------------------------ 6. Dados de exemplo (seed)
const cliente = new pg.Client({ connectionString: process.env.DATABASE_URL });
await cliente.connect();
const { rows } = await cliente.query("SELECT count(*)::int AS total FROM usuarios");
await cliente.end();
if (rows[0].total > 0) {
    ok("dados de exemplo já carregados");
} else if (!existsSync(path.join(raiz, "dist", "prisma", "seed.js"))) {
    aviso("banco vazio, mas o projeto ainda não foi compilado: rode npm run dev (ou npm run build) para carregar o seed");
} else {
    console.log("  [..] banco vazio: carregando os dados de exemplo (seed, cerca de 15 s)...");
    const seed = spawnSync(process.execPath, [path.join(raiz, "dist", "prisma", "seed.js")], { cwd: raiz, env: envPrisma, stdio: "inherit" });
    if (seed.status !== 0) falhar("Falha ao carregar os dados de exemplo (seed).");
    console.log("  [OK] dados de exemplo carregados. Login: admin, operador, gestor ou auditor, senha Greencode2026");
}

if (!silencioso) {
    console.log(`
Pronto! Próximos passos:
  npm run dev        inicia o servidor em http://localhost:${process.env.PORT || 3000}
  npm test           roda os testes automatizados
  npm run db:resetar apaga tudo e recarrega os dados de exemplo
`);
}
