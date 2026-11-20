import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { iniciarProcessamento } from "../../src/servicos/processamento";
import ServicoAnalise from "../../src/servicos/ServicoAnalise";
import { ErroRegraNegocio } from "../../src/comum/erros";
import {
    aguardar, Ambiente, ClienteApi, configuracaoTeste, criarOrganizacaoELote, equipamentoPadrao, prepararAmbiente
} from "../auxiliares";

const TAREFAS = "/api/v1/internal/relatorios/tarefas";
const PUB = "/api/v1/public";
const silencioso = { error() {}, warn() {}, info() {} };

async function chaveDeRelatorios(amb: Ambiente, organizacaoId: string | null, plano = "PROFISSIONAL"): Promise<ClienteApi> {
    const r = await amb.admin.post("/api/v1/internal/chaves-api", { nome: `Relatórios ${organizacaoId ?? "global"} ${plano}`, escopos: ["RELATORIOS_GERAR"], plano, organizacaoId });
    assert.equal(r.status, 201, JSON.stringify(r.corpo));
    return amb.api.comChave(r.corpo.segredo);
}

const concluida = (cliente: ClienteApi, url: string) =>
    aguardar(() => cliente.get(url), r => ["CONCLUIDA", "FALHOU"].includes(r.corpo?.situacao));

describe("Relatórios assíncronos (fila em memória)", () => {
    let amb: Ambiente;
    let parceiroBR001: ClienteApi;

    before(async () => {
        amb = await prepararAmbiente();
        await criarOrganizacaoELote(amb, "102030405060", "3001", [equipamentoPadrao(), equipamentoPadrao({ tipo: "SERVIDOR", marca: "=cmd|'/c calc'!A1", modelo: "R720", pesoQuilogramas: 25 })]);
        await criarOrganizacaoELote(amb, "605040302010", "3002", [equipamentoPadrao({ tipo: "MONITOR", marca: "LG", modelo: "24MK" })]);
        parceiroBR001 = await chaveDeRelatorios(amb, "BR001");
    });
    after(async () => { await amb.fechar(); });

    it("usuário interno: 202 na hora, polling até CONCLUIDA e download do CSV com ETag", async () => {
        const pedido = await amb.auditor.post(TAREFAS, { tipo: "VIDA_UTIL", formato: "CSV" });
        assert.equal(pedido.status, 202, JSON.stringify(pedido.corpo));
        assert.ok(["PENDENTE", "PROCESSANDO", "CONCLUIDA"].includes(pedido.corpo.situacao));
        assert.equal(pedido.cabecalhos.location, `${TAREFAS}/${pedido.corpo.id}`);
        assert.equal(pedido.corpo.links.situacao, `${TAREFAS}/${pedido.corpo.id}`);

        const final = await concluida(amb.auditor, pedido.corpo.links.situacao);
        assert.equal(final.corpo.situacao, "CONCLUIDA", JSON.stringify(final.corpo));
        assert.equal(final.corpo.tentativas, 1);
        assert.equal(final.corpo.links.arquivo, `${TAREFAS}/${pedido.corpo.id}/arquivo`);
        assert.ok(final.corpo.expiraEm);

        const arquivo = await amb.auditor.get(final.corpo.links.arquivo);
        assert.equal(arquivo.status, 200);
        assert.match(String(arquivo.cabecalhos["content-type"]), /^text\/csv/);
        assert.match(String(arquivo.cabecalhos["content-disposition"]), /attachment; filename="greencode-vida-util-\d{4}-\d{2}-\d{2}\.csv"/);
        const conteudo = arquivo.corpo as string;
        assert.equal(arquivo.cabecalhos.etag, `"${createHash("sha256").update(conteudo, "utf8").digest("hex")}"`);
        const linhas = conteudo.replace("﻿", "").trim().split("\r\n");
        assert.equal(linhas[0], "equipamento_id,tipo,estado_fisico,idade_anos,anos_restantes,data_prevista_inservivel,metodo");
        assert.equal(linhas.length, 1 + 3, "uma linha por equipamento ativo");
        assert.equal(final.corpo.tamanhoBytes, Buffer.byteLength(conteudo, "utf8"));
    });

    it("parceiro: relatório restrito à organização, invisível para outros; CSV neutraliza fórmulas", async () => {
        const pedido = await parceiroBR001.post(`${PUB}/relatorios`, { tipo: "INVENTARIO_RASTREABILIDADE", formato: "JSON" });
        assert.equal(pedido.status, 202);
        assert.equal(pedido.corpo.organizacaoId, "BR001");
        assert.match(String(pedido.cabecalhos.location), new RegExp(`^${PUB}/relatorios/`));
        const final = await concluida(parceiroBR001, `${PUB}/relatorios/${pedido.corpo.id}`);
        assert.equal(final.corpo.situacao, "CONCLUIDA");
        const download = await parceiroBR001.get(`${PUB}/relatorios/${pedido.corpo.id}/arquivo`);
        assert.match(String(download.cabecalhos["content-type"]), /^application\/json/);
        const json = download.corpo;
        assert.equal(json.total, 2);
        assert.ok(json.equipamentos.every((e: any) => e.organizacaoId === "BR001"));
        assert.equal(json.equipamentos[0].localizacaoAtual, "Almoxarifado - recebimento");

        const outro = await chaveDeRelatorios(amb, "BR002");
        assert.equal((await outro.get(`${PUB}/relatorios/${pedido.corpo.id}`)).status, 404);
        assert.equal((await outro.get(`${PUB}/relatorios`)).corpo.total, 0);
        assert.equal((await amb.gestor.get(`${TAREFAS}/${pedido.corpo.id}`)).status, 404, "usuário interno não vê tarefa de outro solicitante");
        assert.equal((await amb.admin.get(`${TAREFAS}/${pedido.corpo.id}`)).status, 200, "o administrador vê todas");

        const csv = await parceiroBR001.post(`${PUB}/relatorios`, { tipo: "RENTABILIDADE", formato: "CSV" });
        await concluida(parceiroBR001, `${PUB}/relatorios/${csv.corpo.id}`);
        const texto = (await parceiroBR001.get(`${PUB}/relatorios/${csv.corpo.id}/arquivo`)).corpo as string;
        assert.ok(texto.includes(`"'=cmd|'/c calc'!A1"`) || texto.includes(`'=cmd|'/c calc'!A1`), "a marca maliciosa vira texto, não fórmula");
    });

    it("falha transitória: nova tentativa com backoff e conclusão na 2ª", async () => {
        const analises = amb.app.servicos.analises as ServicoAnalise & { dadosRentabilidade: ServicoAnalise["dadosRentabilidade"] };
        let chamadas = 0;
        analises.dadosRentabilidade = async (escopo) => {
            if (++chamadas === 1) throw new Error("conexão com o banco interrompida");
            return ServicoAnalise.prototype.dadosRentabilidade.call(analises, escopo);
        };
        try {
            const pedido = await amb.auditor.post(TAREFAS, { tipo: "RENTABILIDADE", formato: "JSON" });
            const final = await concluida(amb.auditor, `${TAREFAS}/${pedido.corpo.id}`);
            assert.equal(final.corpo.situacao, "CONCLUIDA");
            assert.equal(final.corpo.tentativas, 2);
            assert.equal(final.corpo.erro, null, "o erro da tentativa anterior é limpo ao concluir");
        } finally {
            delete (analises as Partial<typeof analises>).dadosRentabilidade;
        }
    });

    it("erro de regra: falha definitiva sem repetir; download explica o motivo", async () => {
        const analises = amb.app.servicos.analises as ServicoAnalise & { dadosRentabilidade: ServicoAnalise["dadosRentabilidade"] };
        let chamadas = 0;
        analises.dadosRentabilidade = async () => { chamadas++; throw new ErroRegraNegocio("Período sem dados para o relatório."); };
        try {
            const pedido = await amb.auditor.post(TAREFAS, { tipo: "RENTABILIDADE", formato: "CSV" });
            const final = await concluida(amb.auditor, `${TAREFAS}/${pedido.corpo.id}`);
            assert.equal(final.corpo.situacao, "FALHOU");
            assert.equal(final.corpo.tentativas, 1);
            assert.equal(chamadas, 1);
            assert.match(final.corpo.erro, /Período sem dados/);
            const download = await amb.auditor.get(`${TAREFAS}/${pedido.corpo.id}/arquivo`);
            assert.equal(download.status, 422);
            assert.match(download.corpo.erro.mensagem, /falhou após 1 tentativa/);
        } finally {
            delete (analises as Partial<typeof analises>).dadosRentabilidade;
        }
    });

    it("erro técnico persistente: FALHOU depois de esgotar as 3 tentativas", async () => {
        const analises = amb.app.servicos.analises as ServicoAnalise & { dadosEficiencia: ServicoAnalise["dadosEficiencia"] };
        let chamadas = 0;
        analises.dadosEficiencia = async () => { chamadas++; throw new Error("timeout"); };
        try {
            const pedido = await amb.auditor.post(TAREFAS, { tipo: "EFICIENCIA_OPERACIONAL", formato: "CSV" });
            const final = await concluida(amb.auditor, `${TAREFAS}/${pedido.corpo.id}`);
            assert.equal(final.corpo.situacao, "FALHOU");
            assert.equal(final.corpo.tentativas, 3);
            assert.equal(chamadas, 3);
        } finally {
            delete (analises as Partial<typeof analises>).dadosEficiencia;
        }
    });

    it("validação e permissões", async () => {
        assert.equal((await amb.auditor.post(TAREFAS, { tipo: "OUTRO" })).status, 400);
        assert.equal((await amb.auditor.post(TAREFAS, { tipo: "VIDA_UTIL", formato: "PDF" })).status, 400);
        assert.equal((await amb.operador.post(TAREFAS, { tipo: "VIDA_UTIL" })).status, 403);
        assert.equal((await amb.auditor.post(TAREFAS, { tipo: "VIDA_UTIL", organizacaoId: "BR999" })).status, 404);
        assert.equal((await amb.auditor.get(`${TAREFAS}/nao-e-uuid`)).status, 404);
        assert.equal((await amb.auditor.get(`${TAREFAS}/${"-".repeat(36)}`)).status, 404, "36 caracteres que não formam um UUID: 404, não erro do banco");
        assert.equal((await amb.admin.get(`/api/v1/internal/chaves-api/${"0".repeat(36)}`)).status, 404);
        const lista = await amb.auditor.get(TAREFAS);
        assert.ok(lista.corpo.total >= 4);
        assert.ok(lista.corpo.itens.every((t: any) => t.solicitante === "auditor"));
    });

    it("expurgo apaga relatórios vencidos", async () => {
        const pedido = await amb.auditor.post(TAREFAS, { tipo: "RENTABILIDADE" });
        await concluida(amb.auditor, `${TAREFAS}/${pedido.corpo.id}`);
        await amb.prisma.tarefaRelatorio.update({ where: { id: pedido.corpo.id }, data: { expiraEm: new Date(Date.now() - 1000) } });
        const vencido = await amb.auditor.get(`${TAREFAS}/${pedido.corpo.id}/arquivo`);
        assert.equal(vencido.status, 410, "vencido e ainda não expurgado: o arquivo não é mais entregue");
        assert.equal(vencido.corpo.erro.codigo, "EXPIRADO");
        assert.ok(await amb.app.servicos.relatoriosAssincronos.expurgarExpiradas() >= 1);
        assert.equal((await amb.auditor.get(`${TAREFAS}/${pedido.corpo.id}`)).status, 404);
    });
});

describe("Relatórios assíncronos: limite do plano e recuperação de pendentes", () => {
    let amb: Ambiente;
    // Sem worker: as tarefas ficam PENDENTES, como num pico de demanda ou com o worker fora do ar.
    before(async () => {
        amb = await prepararAmbiente(undefined, { config: { workerEmbutido: false } });
        await criarOrganizacaoELote(amb, "908070605040", "4001");
    });
    after(async () => { await amb.fechar(); });

    it("plano BASICO aceita 2 relatórios simultâneos; download antes de concluir → 409", async () => {
        const parceiro = await chaveDeRelatorios(amb, "BR001", "BASICO");
        const a = await parceiro.post(`${PUB}/relatorios`, { tipo: "VIDA_UTIL" });
        const b = await parceiro.post(`${PUB}/relatorios`, { tipo: "RENTABILIDADE", formato: "CSV" });
        assert.equal(a.status, 202);
        assert.equal(b.status, 202);
        const c = await parceiro.post(`${PUB}/relatorios`, { tipo: "EFICIENCIA_OPERACIONAL" });
        assert.equal(c.status, 422);
        assert.match(c.corpo.erro.mensagem, /Limite de 2 relatório/);
        const cedo = await parceiro.get(`${PUB}/relatorios/${a.corpo.id}/arquivo`);
        assert.equal(cedo.status, 409);
        assert.equal(cedo.corpo.erro.codigo, "CONFLITO");
        assert.equal(a.corpo.links.arquivo, null);

        // O worker sobe depois (ou o servidor reinicia): as pendentes do banco são recolocadas na fila.
        await iniciarProcessamento(amb.app.servicos, configuracaoTeste(), silencioso);
        for (const t of [a, b]) {
            const final = await concluida(parceiro, `${PUB}/relatorios/${t.corpo.id}`);
            assert.equal(final.corpo.situacao, "CONCLUIDA");
        }
        assert.equal((await parceiro.post(`${PUB}/relatorios`, { tipo: "EFICIENCIA_OPERACIONAL" })).status, 202, "com as anteriores concluídas, há vaga de novo");
    });

    it("cancelar e excluir: libera a vaga do plano; ninguém exclui a tarefa de outro", async () => {
        const r = await amb.admin.post("/api/v1/internal/chaves-api", { nome: "Cancelamentos", escopos: ["RELATORIOS_GERAR"], plano: "BASICO", organizacaoId: "BR001" });
        const parceiro = amb.api.comChave(r.corpo.segredo);
        const outro = await chaveDeRelatorios(amb, "BR001", "CORPORATIVO");
        // O worker deste ambiente já está ativo (teste anterior): usa uma tarefa concluída e uma recém-criada.
        const a = await parceiro.post(`${PUB}/relatorios`, { tipo: "RENTABILIDADE" });
        await concluida(parceiro, `${PUB}/relatorios/${a.corpo.id}`);
        assert.equal((await outro.delete(`${PUB}/relatorios/${a.corpo.id}`)).status, 404, "tarefa de outro parceiro");
        assert.equal((await parceiro.delete(`${PUB}/relatorios/${a.corpo.id}`)).status, 204);
        assert.equal((await parceiro.get(`${PUB}/relatorios/${a.corpo.id}`)).status, 404);
        assert.equal((await parceiro.delete(`${PUB}/relatorios/${a.corpo.id}`)).status, 404, "já excluída");
        const aud = await amb.auditor.get(`/api/v1/internal/auditoria?entidade=TarefaRelatorio&entidadeId=${a.corpo.id}`);
        assert.ok(aud.corpo.itens.some((i: any) => i.operacao === "RELATORIO_EXCLUIR"));
    });
});

describe("Relatórios assíncronos: cancelamento na fila e limite sob concorrência", () => {
    let amb: Ambiente;
    before(async () => {
        amb = await prepararAmbiente(undefined, { config: { workerEmbutido: false } });
        await criarOrganizacaoELote(amb, "554433221100", "4101");
    });
    after(async () => { await amb.fechar(); });

    it("5 pedidos simultâneos no plano BASICO: exatamente 2 aceitos", async () => {
        const parceiro = await chaveDeRelatorios(amb, "BR001", "BASICO");
        const status = (await Promise.all(Array.from({ length: 5 }, () => parceiro.post(`${PUB}/relatorios`, { tipo: "VIDA_UTIL" })))).map(r => r.status);
        assert.deepEqual(status.sort(), [202, 202, 422, 422, 422]);
    });

    it("cancelar um relatório ainda na fila libera a vaga; o worker ignora o cancelado", async () => {
        const parceiro = await chaveDeRelatorios(amb, "BR001", "BASICO");
        const [a, b] = await Promise.all([1, 2].map(() => parceiro.post(`${PUB}/relatorios`, { tipo: "RENTABILIDADE" })));
        assert.equal((await parceiro.post(`${PUB}/relatorios`, { tipo: "RENTABILIDADE" })).status, 422);
        assert.equal((await parceiro.delete(`${PUB}/relatorios/${a!.corpo.id}`)).status, 204);
        const c = await parceiro.post(`${PUB}/relatorios`, { tipo: "RENTABILIDADE" });
        assert.equal(c.status, 202, "a vaga foi liberada");
        await iniciarProcessamento(amb.app.servicos, configuracaoTeste(), silencioso);
        for (const t of [b!, c]) assert.equal((await concluida(parceiro, `${PUB}/relatorios/${t.corpo.id}`)).corpo.situacao, "CONCLUIDA");
        assert.equal(await amb.prisma.tarefaRelatorio.count({ where: { id: a!.corpo.id } }), 0, "o cancelado não volta");
    });

    it("tarefa sendo gerada não pode ser excluída (409)", async () => {
        // Criada direto no banco (sem passar pela fila), para nenhum worker concluí-la durante o teste.
        const tarefa = await amb.prisma.tarefaRelatorio.create({
            data: { tipo: "VIDA_UTIL", formato: "JSON", parametros: {}, solicitante: "auditor", situacao: "PROCESSANDO", tentativas: 1 }
        });
        const r = await amb.auditor.delete(`${TAREFAS}/${tarefa.id}`);
        assert.equal(r.status, 409);
        assert.equal(r.corpo.erro.codigo, "CONFLITO");
        assert.equal(await amb.prisma.tarefaRelatorio.count({ where: { id: tarefa.id } }), 1, "continua lá");
    });
});
