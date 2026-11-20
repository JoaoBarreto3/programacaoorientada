import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { RelogioFixo } from "../../src/comum/Relogio";
import { montarAgendamentos } from "../../src/servicos/processamento";
import {
    Ambiente, ClienteApi, cnpjValido, configuracaoTeste, equipamentoPadrao, organizacaoPadrao, prepararAmbiente, SENHA_PADRAO
} from "../auxiliares";

const DIA = 86_400_000;
const HORA = 3_600_000;
const BASE = "/api/v1/internal/analises";

// Relógio controlado: os lotes entram num dia D e a triagem acontece dias depois, por operadores
// diferentes. Assim os tempos de espera e de triagem são conhecidos e conferidos exatamente.
describe("Camada analítica (API interna)", () => {
    let amb: Ambiente;
    let gestor2: ClienteApi;
    const relogio = new RelogioFixo(new Date());
    // Meio-dia UTC de 20 dias atrás: o contrato padrão (assinado há 30 dias) já está vigente.
    const hoje = new Date();
    const D = new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 20, 12));
    const em = (dias: number, horas = 0) => new Date(D.getTime() + dias * DIA + horas * HORA);
    let lotes: string[] = [];
    let notebooks: string[] = [];

    before(async () => {
        relogio.definir(D);
        amb = await prepararAmbiente(relogio);
        assert.equal((await amb.admin.post("/api/v1/internal/usuarios", { login: "gestor2", senha: SENHA_PADRAO, papel: "GESTOR_ALMOXARIFADO" })).status, 201);
        gestor2 = await amb.api.login("gestor2", SENHA_PADRAO);
        const org = await amb.operador.post("/api/v1/internal/organizacoes", organizacaoPadrao(cnpjValido("556677889900")));
        assert.equal(org.status, 201, JSON.stringify(org.corpo));

        // Lote A: notebooks de idades e estados diferentes (base da regressão de vida útil) e um servidor.
        const anos: [number, string][] = [[2024, "NOVO"], [2022, "USADO_LEVE"], [2020, "USADO_MODERADO"], [2018, "DANIFICADO_LEVE"], [2016, "DANIFICADO_GRAVE"]];
        const a = await amb.gestor.post("/api/v1/internal/lotes", {
            organizacaoId: "BR001", notaFiscal: "7001", transportadora: "TransRapida",
            equipamentos: [
                ...anos.map(([ano, estadoFisico]) => equipamentoPadrao({ anoFabricacao: ano, estadoFisico })),
                equipamentoPadrao({ tipo: "SERVIDOR", marca: "HP", modelo: "DL380", anoFabricacao: 2021, estadoFisico: "USADO_MODERADO", pesoQuilogramas: 25 })
            ]
        });
        assert.equal(a.status, 201, JSON.stringify(a.corpo));
        notebooks = a.corpo.equipamentos.filter((e: any) => e.tipo === "NOTEBOOK").map((e: any) => e.id);
        const outros = [];
        for (const nf of ["7002", "7003", "7004"]) {
            const r = await amb.gestor.post("/api/v1/internal/lotes", {
                organizacaoId: "BR001", notaFiscal: nf, transportadora: "TransRapida",
                equipamentos: [equipamentoPadrao({ tipo: "MONITOR", marca: "LG", modelo: "24MK430H", pesoQuilogramas: 3.2 })]
            });
            assert.equal(r.status, 201);
            outros.push(r.corpo.id);
        }
        lotes = [a.corpo.id, ...outros];
        const triagem = async (cliente: ClienteApi, lote: string, inicio: Date, fim: Date | null) => {
            relogio.definir(inicio);
            assert.equal((await cliente.post(`/api/v1/internal/lotes/${lote}/triagem`, {})).status, 200);
            if (fim) {
                relogio.definir(fim);
                assert.equal((await cliente.post(`/api/v1/internal/lotes/${lote}/triagem`, {})).status, 200);
            }
        };
        // Entrada no dia D (00:00 UTC). Espera e triagem, em dias:
        //   A (gestor):  espera 2,5  triagem 1,0     B (gestor2): espera 1,5  triagem 0,25
        //   C (gestor2): espera 4,5  triagem 1,0     D: sem triagem (pendente)
        await triagem(gestor2, lotes[1]!, em(1), em(1, 6));
        await triagem(amb.gestor, lotes[0]!, em(2), em(3));
        await triagem(gestor2, lotes[2]!, em(4), em(5));
        relogio.definir(em(6));
    });
    after(async () => { await amb.fechar(); });

    it("eficiência: espera, triagem, gargalo, operadores e pendências", async () => {
        const r = await amb.auditor.get(`${BASE}/eficiencia`);
        assert.equal(r.status, 200, JSON.stringify(r.corpo));
        const e = r.corpo.resultado;
        assert.equal(e.lotesConsiderados, 4);
        assert.equal(e.lotesComTriagemConcluida, 3);
        assert.equal(e.temposDias.espera.media, 2.83);   // (2,5 + 1,5 + 4,5) / 3
        assert.equal(e.temposDias.triagem.media, 0.75);  // (1 + 0,25 + 1) / 3
        assert.equal(e.gargalo.etapa, "ESPERA");
        assert.deepEqual(e.porOperador.map((o: any) => [o.operador, o.lotes, o.equipamentos]), [["gestor2", 2, 2], ["gestor", 1, 6]]);
        assert.equal(e.pendencias.aguardandoTriagem.quantidade, 1);
        assert.equal(e.pendencias.aguardandoTriagem.maisAntigo.loteId, lotes[3]);
        // O lote expõe os marcos da triagem.
        const lote = await amb.gestor.get(`/api/v1/internal/lotes/${lotes[0]}`);
        assert.equal(lote.corpo.triagemIniciadaPor, "gestor");
        assert.equal(lote.corpo.triagemConcluidaEm, em(3).toISOString());
    });

    it("eficiência respeita o escopo: organização inexistente → 404, período invertido → 400", async () => {
        assert.equal((await amb.auditor.get(`${BASE}/eficiencia?organizacaoId=BR999`)).status, 404);
        assert.equal((await amb.auditor.get(`${BASE}/eficiencia?inicio=2026-05-10&fim=2026-05-01`)).status, 400);
        const vazio = await amb.auditor.get(`${BASE}/eficiencia?inicio=2000-01-01&fim=2000-01-31`);
        assert.equal(vazio.corpo.resultado.lotesConsiderados, 0);
        assert.equal(vazio.corpo.escopo.inicio, "2000-01-01");
    });

    it("rentabilidade: prioridade por valor médio e detalhamento por tipo", async () => {
        const r = await amb.gestor.get(`${BASE}/rentabilidade?organizacaoId=br001`);
        assert.equal(r.status, 200);
        const x = r.corpo.resultado;
        assert.equal(x.equipamentos, 9);
        assert.equal(x.prioridade[0].tipo, "SERVIDOR");
        const notebook = x.porTipo.find((t: any) => t.tipo === "NOTEBOOK");
        assert.equal(notebook.quantidade, 5);
        assert.ok(notebook.valorRecuperacao.maximo <= 4000 && notebook.valorRecuperacao.minimo >= 0);
        const est = await amb.gestor.get(`${BASE}/rentabilidade/estimativa?tipo=NOTEBOOK&marca=Dell&modelo=Latitude%205490`);
        assert.equal(est.status, 200);
        assert.equal(est.corpo.base, "TIPO_MARCA_MODELO");
        assert.equal(est.corpo.amostra, 5);
    });

    it("vida útil: regressão por tipo, previsões ordenadas e alternativa por parâmetro", async () => {
        const r = await amb.auditor.get(`${BASE}/vida-util?limitePrevisoes=3`);
        assert.equal(r.status, 200, JSON.stringify(r.corpo));
        const v = r.corpo.resultado;
        const nb = v.modelos.find((m: any) => m.tipo === "NOTEBOOK");
        assert.equal(nb.metodo, "REGRESSAO_LINEAR");
        assert.ok(nb.inclinacao > 0 && nb.r2 > 0.9, JSON.stringify(nb));
        assert.equal(v.modelos.find((m: any) => m.tipo === "MONITOR").metodo, "PARAMETRO_DEPRECIACAO", "3 monitores da mesma idade não definem tendência");
        const srv = v.modelos.find((m: any) => m.tipo === "SERVIDOR");
        assert.equal(srv.metodo, "PARAMETRO_DEPRECIACAO");
        assert.equal(v.equipamentosAtivos, 9);
        assert.equal(v.previsoes.length, 3);
        assert.equal(r.corpo.previsoesOmitidas, 6);
        assert.ok(v.previsoes[0].anosRestantes <= v.previsoes[1].anosRestantes);
        assert.match(v.previsoes[0].dataPrevistaInservivel, /^\d{4}-\d{2}-\d{2}$/);
    });

    it("execução gravada no histórico; aderência compara a previsão com o que aconteceu", async () => {
        const exec = await amb.auditor.post(`${BASE}/execucoes`, { tipo: "VIDA_UTIL" });
        assert.equal(exec.status, 201, JSON.stringify(exec.corpo));
        assert.equal(exec.corpo.origem, "MANUAL");
        assert.equal(exec.corpo.solicitante, "auditor");
        assert.equal(exec.corpo.previsoes, 9);
        assert.equal(exec.corpo.resultado.previsoes, undefined, "as previsões ficam na tabela própria, não no JSON");
        const previsoes = await amb.auditor.get(`${BASE}/execucoes/${exec.corpo.id}/previsoes?tamanhoPagina=100`);
        assert.equal(previsoes.corpo.total, 9);
        const prevista = previsoes.corpo.itens.find((p: any) => p.equipamentoId === notebooks[4]);
        assert.ok(prevista, "o notebook mais desgastado tem previsão");

        // 30 dias depois o notebook DANIFICADO_GRAVE fica inservível.
        relogio.definir(new Date(em(6).getTime() + 30 * DIA));
        const reclass = await amb.gestor.patch(`/api/v1/internal/equipamentos/${notebooks[4]}/estado`, { estadoFisico: "INSERVIVEL", justificativa: "Placa-mãe em curto" });
        assert.equal(reclass.status, 200, JSON.stringify(reclass.corpo));
        const ad = await amb.auditor.get(`${BASE}/vida-util/aderencia`);
        assert.equal(ad.status, 200);
        assert.equal(ad.corpo.resultado.avaliadas, 1);
        const esperado = Math.round((relogio.agora().getTime() - new Date(prevista.dataPrevistaInservivel).getTime()) / DIA);
        assert.equal(ad.corpo.resultado.detalhes[0].erroDias, esperado);
        assert.equal(ad.corpo.resultado.erroMedioAbsolutoDias, Math.abs(esperado));

        const historico = await amb.auditor.get(`${BASE}/execucoes?tipo=VIDA_UTIL`);
        assert.equal(historico.corpo.total, 1);
        const auditoria = await amb.auditor.get("/api/v1/internal/auditoria?operacao=ANALISE_EXECUTAR");
        assert.equal(auditoria.corpo.total, 1);
    });

    it("agendador grava as três análises com origem AGENDADA", async () => {
        const agendamentos = montarAgendamentos(amb.app.servicos, configuracaoTeste({ analisesCron: "0 2 * * *" }), { error() {}, warn() {}, info() {} });
        assert.deepEqual(agendamentos.map(a => a.nome).sort(), ["analises-recorrentes", "relatorios-expurgo", "relatorios-varredura"]);
        await agendamentos.find(a => a.nome === "analises-recorrentes")!.executar();
        const r = await amb.auditor.get(`${BASE}/execucoes?tamanhoPagina=10`);
        const agendadas = r.corpo.itens.filter((i: any) => i.origem === "AGENDADA");
        assert.deepEqual(agendadas.map((i: any) => i.tipo).sort(), ["EFICIENCIA_OPERACIONAL", "RENTABILIDADE", "VIDA_UTIL"]);
        assert.ok(agendadas.every((i: any) => i.solicitante === "agendador"));
        const uma = await amb.auditor.get(`${BASE}/execucoes/${agendadas[0].id}`);
        assert.ok(uma.corpo.resultado && typeof uma.corpo.resultado === "object");
        assert.equal(montarAgendamentos(amb.app.servicos, configuracaoTeste(), { error() {}, warn() {}, info() {} }).length, 2, "ANALISES_CRON vazio desliga as análises recorrentes");
    });

    it("permissões: operador não vê análises; gestor lê mas não grava execuções", async () => {
        assert.equal((await amb.operador.get(`${BASE}/eficiencia`)).status, 403);
        assert.equal((await amb.gestor.post(`${BASE}/execucoes`, { tipo: "RENTABILIDADE" })).status, 403);
        assert.equal((await amb.api.get(`${BASE}/eficiencia`)).status, 401);
        assert.equal((await amb.auditor.post(`${BASE}/execucoes`, { tipo: "OUTRA" })).status, 400);
    });
});
