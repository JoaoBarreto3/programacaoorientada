import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { ChildProcess, spawn } from "node:child_process";
import path from "node:path";
import { aguardar, cnpjValido, configuracaoTeste, equipamentoPadrao, limparBanco, organizacaoPadrao, SENHA_ADMIN } from "./auxiliares";
import { criarClientePrisma } from "../src/infra/banco";
import { encerrarServidor, iniciarServidor, Servidor } from "./servidorReal";

// Implantação em escala, com processos de verdade: a API sem worker embutido (WORKER_EMBUTIDO=false)
// e o worker separado (npm run worker), coordenados pelo Redis. Exige REDIS_URL_TESTE.

const WORKER = path.resolve(__dirname, "..", "src", "worker.js");
const REDIS = process.env.REDIS_URL_TESTE;

function iniciarWorker(ambiente: Record<string, string>): { processo: ChildProcess; saida: string[]; fim: Promise<number | null> } {
    const config = configuracaoTeste();
    const processo = spawn(process.execPath, [WORKER], {
        env: { ...process.env, DATABASE_URL: config.urlBanco, JWT_SEGREDO: config.jwtSegredo, LOG_NIVEL: "info", ANALISES_CRON: "", FILA_ATRASO_MS: "100", ...ambiente },
        stdio: ["ignore", "pipe", "pipe"]
    });
    const saida: string[] = [];
    processo.stdout!.on("data", (p: Buffer) => saida.push(p.toString()));
    processo.stderr!.on("data", (p: Buffer) => saida.push(p.toString()));
    const fim = new Promise<number | null>(resolver => processo.on("exit", codigo => resolver(codigo)));
    return { processo, saida, fim };
}

describe("API e worker em processos separados (BullMQ + Redis)", { skip: !REDIS && "defina REDIS_URL_TESTE" }, () => {
    let servidor: Servidor;
    let token = "";
    const http = async (metodo: string, rota: string, corpo?: unknown) => {
        const r = await fetch(servidor.url + rota, {
            method: metodo,
            headers: { authorization: `Bearer ${token}`, ...(corpo ? { "content-type": "application/json" } : {}) },
            body: corpo ? JSON.stringify(corpo) : undefined
        });
        return { status: r.status, corpo: await r.json().catch(() => null) as any };
    };

    before(async () => {
        const prisma = criarClientePrisma(configuracaoTeste().urlBanco);
        await limparBanco(prisma);
        await prisma.$disconnect();
        servidor = await iniciarServidor({ WORKER_EMBUTIDO: "false" });
        token = (await http("POST", "/api/v1/internal/provisionamento", { login: "admin", senha: SENHA_ADMIN })).corpo.token;
        assert.equal((await http("POST", "/api/v1/internal/organizacoes", organizacaoPadrao(cnpjValido("909192939495")))).status, 201);
        assert.equal((await http("POST", "/api/v1/internal/lotes", { organizacaoId: "BR001", notaFiscal: "77", transportadora: "TransRapida", equipamentos: [equipamentoPadrao(), equipamentoPadrao()] })).status, 201);
    });
    after(async () => { if (servidor) await encerrarServidor(servidor); });

    it("sem worker, o relatório fica na fila; o worker separado o processa; SIGTERM encerra com código 0", async () => {
        const saude = await http("GET", "/api/saude");
        assert.deepEqual([saude.corpo.status, saude.corpo.tipoFila], ["ok", "bullmq"]);
        const pedido = await http("POST", "/api/v1/internal/relatorios/tarefas", { tipo: "INVENTARIO_RASTREABILIDADE", formato: "CSV" });
        assert.equal(pedido.status, 202);
        await new Promise(r => setTimeout(r, 500));
        assert.equal((await http("GET", `/api/v1/internal/relatorios/tarefas/${pedido.corpo.id}`)).corpo.situacao, "PENDENTE", "a API não processa a fila");

        const worker = iniciarWorker({ REDIS_URL: REDIS! });
        try {
            const final = await aguardar(() => http("GET", `/api/v1/internal/relatorios/tarefas/${pedido.corpo.id}`), r => r.corpo.situacao === "CONCLUIDA", 15_000, 100);
            assert.equal(final.corpo.tentativas, 1);
            const arquivo = await fetch(`${servidor.url}/api/v1/internal/relatorios/tarefas/${pedido.corpo.id}/arquivo`, { headers: { authorization: `Bearer ${token}` } });
            assert.equal((await arquivo.text()).trim().split("\r\n").length, 3);
            assert.match(worker.saida.join(""), /Worker no ar/);
        } finally {
            worker.processo.kill("SIGTERM");
        }
        assert.equal(await worker.fim, 0, "graceful shutdown do worker:\n" + worker.saida.join(""));
    });

    it("o worker separado se recusa a subir sem Redis, com mensagem clara", async () => {
        const worker = iniciarWorker({ REDIS_URL: "" });
        assert.equal(await worker.fim, 1);
        assert.match(worker.saida.join(""), /exige REDIS_URL/);
    });
});
