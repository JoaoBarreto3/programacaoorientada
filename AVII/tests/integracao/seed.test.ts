import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { FastifyInstance } from "fastify";
import { construirApp } from "../../src/app";
import { criarClientePrisma, PrismaClient } from "../../src/infra/banco";
import { ClienteApi, configuracaoTeste, limparBanco } from "../auxiliares";

// O seed (prisma/seed.ts) roda de verdade contra o banco de teste. A AV2 pede que os dados
// reflitam os cenários de validação da AV1: aqui conferimos que eles existem e se comportam.

const SEED = path.resolve(__dirname, "..", "..", "prisma", "seed.js");

function rodarSeed() {
    const r = spawnSync(process.execPath, [SEED], {
        env: { ...process.env, DATABASE_URL: configuracaoTeste().urlBanco, SENHA_ITERACOES: "1000" }, encoding: "utf8"
    });
    return { codigo: r.status, saida: r.stdout + r.stderr };
}

describe("Seed de dados representativos", () => {
    let prisma: PrismaClient;
    let app: FastifyInstance;
    let api: ClienteApi;
    before(async () => {
        prisma = criarClientePrisma(configuracaoTeste().urlBanco);
        await limparBanco(prisma);
        const r = rodarSeed();
        assert.equal(r.codigo, 0, r.saida);
        app = await construirApp({ config: configuracaoTeste(), prisma, logger: false });
        await app.ready();
        api = new ClienteApi(app);
    });
    after(async () => {
        await app.close();
        await prisma.$disconnect();
    });

    it("cria um usuário de cada papel, todos capazes de entrar", async () => {
        for (const login of ["admin", "operador", "gestor", "auditor"]) {
            await api.login(login, "Greencode2026");
        }
    });

    it("cobre organizações e contratos em situações variadas", async () => {
        const orgs = await prisma.organizacao.findMany({ include: { contrato: true }, orderBy: { id: "asc" } });
        assert.equal(orgs.length, 5);
        assert.ok(orgs.some(o => !o.ativo), "organização desativada");
        assert.ok(orgs.some(o => !o.contrato), "organização sem contrato");
        assert.ok(orgs.some(o => o.contrato?.renovacaoAutomatica), "contrato com renovação automática");
        assert.ok(orgs.some(o => /[A-Z]/.test(o.cnpj)), "CNPJ alfanumérico");
    });

    it("cobre lotes em todas as etapas e equipamentos em vários status", async () => {
        const lotes = new Set((await prisma.lote.findMany()).map(l => l.statusProcessamento));
        for (const s of ["RECEBIDO", "EM_TRIAGEM", "ENCAMINHADO", "FINALIZADO"]) assert.ok(lotes.has(s as any), `lote ${s}`);
        const status = new Set((await prisma.equipamento.findMany()).map(e => e.statusRastreamento));
        assert.ok(status.size >= 6, `status distintos: ${[...status].join(", ")}`);
        const justificadas = await prisma.movimentacao.count({ where: { natureza: "ESTADO_FISICO", observacao: { not: "" } } });
        assert.ok(justificadas >= 2, "reclassificações com justificativa");
        assert.ok(await prisma.registroAuditoria.count() > 30, "operações auditadas");
    });

    it("os dados do seed respeitam as regras (contrato vencido e organização desativada barram novos lotes)", async () => {
        const gestor = await api.login("gestor", "Greencode2026");
        const vencida = await prisma.organizacao.findFirstOrThrow({ where: { razaoSocial: { contains: "Varejo" } } });
        const r1 = await gestor.post("/api/lotes", { organizacaoId: vencida.id, notaFiscal: "1", transportadora: "TT" });
        assert.equal(r1.status, 422);
        assert.match(r1.corpo.erro.mensagem, /contrato de coleta vigente/);
        const inativa = await prisma.organizacao.findFirstOrThrow({ where: { ativo: false } });
        assert.equal((await gestor.post("/api/lotes", { organizacaoId: inativa.id, notaFiscal: "1", transportadora: "TT" })).status, 422);
        const emTriagem = await prisma.equipamento.findFirstOrThrow({ where: { statusRastreamento: "EM_TRIAGEM" } });
        const r2 = await gestor.patch(`/api/equipamentos/${emTriagem.id}/status`, { status: "AGUARDANDO_DESMONTE" });
        assert.equal(r2.status, 422, "lote ainda em triagem: desmonte recusado");
    });

    it("não duplica dados se rodar de novo", async () => {
        const antes = await prisma.organizacao.count();
        const r = rodarSeed();
        assert.equal(r.codigo, 0);
        assert.match(r.saida, /seed ignorado/);
        assert.equal(await prisma.organizacao.count(), antes);
    });
});
