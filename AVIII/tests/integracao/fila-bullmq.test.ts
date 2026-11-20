import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { FastifyInstance } from "fastify";
import { construirApp } from "../../src/app";
import ServicoAnalise from "../../src/servicos/ServicoAnalise";
import { ErroRegraNegocio } from "../../src/comum/erros";
import {
    aguardar, Ambiente, ClienteApi, configuracaoTeste, criarOrganizacaoELote, equipamentoPadrao, prepararAmbiente
} from "../auxiliares";

// Testes com Redis + BullMQ de verdade (a fila de produção). Exigem REDIS_URL_TESTE no .env
// (ex.: redis://localhost:6379/1); sem ela, são ignorados e só a fila em memória é testada.
const REDIS = process.env.REDIS_URL_TESTE;
const PUB = "/api/v1/public";
const TAREFAS = "/api/v1/internal/relatorios/tarefas";

describe("Fila BullMQ + Redis", { skip: !REDIS && "defina REDIS_URL_TESTE para testar a fila BullMQ" }, () => {
    let amb: Ambiente;
    let parceiro: ClienteApi;
    let segredo: string;
    // Prefixo exclusivo por execução: não mistura com a fila de desenvolvimento nem com execuções anteriores.
    const prefixo = `greencode-teste-${randomBytes(4).toString("hex")}`;
    const extra = { redisUrl: REDIS!, analisesCron: "0 2 * * *" };

    before(async () => {
        amb = await prepararAmbiente(undefined, { config: extra, prefixoRedis: prefixo });
        await criarOrganizacaoELote(amb, "121314151617", "6001", [equipamentoPadrao(), equipamentoPadrao({ tipo: "ROTEADOR", marca: "Cisco", modelo: "ISR", pesoQuilogramas: 5 })]);
        const r = await amb.admin.post("/api/v1/internal/chaves-api", { nome: "Parceiro BullMQ", escopos: ["RELATORIOS_GERAR", "LOTES_LER"], plano: "BASICO", organizacaoId: "BR001" });
        assert.equal(r.status, 201);
        segredo = r.corpo.segredo;
        parceiro = amb.api.comChave(segredo);
    });
    after(async () => {
        await amb.fechar();
        const conexao = new Redis(REDIS!, { maxRetriesPerRequest: null });
        for (const nome of ["greencode-relatorios", "greencode-agendamentos"]) {
            const fila = new Queue(nome, { connection: conexao, prefix: prefixo });
            await fila.obliterate({ force: true });
            await fila.close();
        }
        conexao.disconnect();
    });

    it("saúde informa a fila BullMQ disponível", async () => {
        const r = await amb.app.inject({ method: "GET", url: "/api/saude" });
        assert.deepEqual([r.json().status, r.json().fila, r.json().tipoFila], ["ok", "ok", "bullmq"]);
    });

    it("relatório do parceiro processado pelo worker BullMQ", async () => {
        const pedido = await parceiro.post(`${PUB}/relatorios`, { tipo: "INVENTARIO_RASTREABILIDADE", formato: "CSV" });
        assert.equal(pedido.status, 202);
        const final = await aguardar(() => parceiro.get(`${PUB}/relatorios/${pedido.corpo.id}`), r => r.corpo.situacao === "CONCLUIDA");
        assert.equal(final.corpo.tentativas, 1);
        const arquivo = await parceiro.get(final.corpo.links.arquivo);
        assert.equal((arquivo.corpo as string).trim().split("\r\n").length, 3);
    });

    it("retry com backoff exponencial e falha definitiva sem repetição (UnrecoverableError)", async () => {
        const analises = amb.app.servicos.analises as ServicoAnalise & { dadosRentabilidade: ServicoAnalise["dadosRentabilidade"] };
        let chamadas = 0;
        analises.dadosRentabilidade = async escopo => {
            if (++chamadas === 1) throw new Error("falha transitória");
            return ServicoAnalise.prototype.dadosRentabilidade.call(analises, escopo);
        };
        try {
            const ok = await amb.auditor.post(TAREFAS, { tipo: "RENTABILIDADE" });
            const final = await aguardar(() => amb.auditor.get(`${TAREFAS}/${ok.corpo.id}`), r => r.corpo.situacao === "CONCLUIDA");
            assert.equal(final.corpo.tentativas, 2);

            analises.dadosRentabilidade = async () => { chamadas++; throw new ErroRegraNegocio("dados insuficientes"); };
            const antes = chamadas;
            const ruim = await amb.auditor.post(TAREFAS, { tipo: "RENTABILIDADE" });
            const falhou = await aguardar(() => amb.auditor.get(`${TAREFAS}/${ruim.corpo.id}`), r => r.corpo.situacao === "FALHOU");
            assert.equal(falhou.corpo.tentativas, 1);
            await new Promise(r => setTimeout(r, 200));
            assert.equal(chamadas - antes, 1, "o BullMQ não repete um UnrecoverableError");
        } finally {
            delete (analises as Partial<typeof analises>).dadosRentabilidade;
        }
    });

    it("agendamentos recorrentes ficam registrados no Redis (um por nome, sem duplicar)", async () => {
        const conexao = new Redis(REDIS!, { maxRetriesPerRequest: null });
        const fila = new Queue("greencode-agendamentos", { connection: conexao, prefix: prefixo });
        try {
            const agendadores = await aguardar(() => fila.getJobSchedulers(), l => l.length === 3);
            const porNome = Object.fromEntries(agendadores.map(a => [a.id ?? a.key, a.pattern]));
            assert.deepEqual(porNome, { "analises-recorrentes": "0 2 * * *", "relatorios-varredura": "*/5 * * * *", "relatorios-expurgo": "17 * * * *" });
        } finally {
            await fila.close();
            conexao.disconnect();
        }
    });

    it("limite do plano compartilhado entre duas instâncias da API (store no Redis)", async () => {
        const segunda: FastifyInstance = await construirApp({
            config: configuracaoTeste({ ...extra, workerEmbutido: false }), prisma: amb.prisma, logger: false, prefixoRedis: prefixo
        });
        await segunda.ready();
        try {
            const instancias = [amb.app, segunda];
            const pedir = (i: number) => instancias[i % 2]!.inject({ method: "GET", url: `${PUB}/eu`, headers: { "x-api-key": segredo } });
            let aceitas = 0;
            // As requisições anteriores deste teste já consumiram parte da cota do minuto.
            for (let i = 0; i < 70; i++) {
                if ((await pedir(i)).statusCode === 200) aceitas++;
            }
            assert.ok(aceitas <= 60, `${aceitas} aceitas: o limite de 60/min vale para a soma das instâncias`);
            assert.equal((await pedir(0)).statusCode, 429);
            assert.equal((await pedir(1)).statusCode, 429);
        } finally {
            await segunda.close();
        }
    });
});

describe("Redis fora do ar", { skip: !REDIS && "defina REDIS_URL_TESTE" }, () => {
    let amb: Ambiente;
    before(async () => {
        amb = await prepararAmbiente(undefined, { config: { redisUrl: "redis://127.0.0.1:1/0", workerEmbutido: false } });
        await criarOrganizacaoELote(amb, "181716151413", "6101");
    });
    after(async () => { await amb.fechar(); });

    it("a API continua atendendo: saúde degradada e relatório aceito (fica PENDENTE no banco)", async () => {
        const saude = (await amb.app.inject({ method: "GET", url: "/api/saude" })).json();
        assert.deepEqual([saude.status, saude.banco, saude.fila], ["degradado", "ok", "indisponivel"]);
        const pedido = await amb.auditor.post(TAREFAS, { tipo: "VIDA_UTIL" });
        assert.equal(pedido.status, 202);
        assert.equal((await amb.auditor.get(`${TAREFAS}/${pedido.corpo.id}`)).corpo.situacao, "PENDENTE");
        assert.equal((await amb.gestor.get("/api/v1/internal/lotes")).status, 200, "o limite de requisições não derruba a API sem Redis");
    });
});
