import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { RelogioFixo } from "../../src/comum/Relogio";
import { iniciarProcessamento, montarAgendamentos } from "../../src/servicos/processamento";
import ServicoAnalise from "../../src/servicos/ServicoAnalise";
import { ErroRegraNegocio } from "../../src/comum/erros";
import {
    aguardar, Ambiente, ClienteApi, cnpjValido, configuracaoTeste, equipamentoPadrao, organizacaoPadrao, prepararAmbiente, SENHA_PADRAO
} from "../auxiliares";

// Rastreabilidade dos requisitos da AV3 (AV3.pdf): cada teste comprova um requisito do enunciado,
// citado no nome entre aspas. Pensada para ser rápida: um único ambiente compartilhado, dados mínimos
// montados uma vez com relógio controlado, requisições independentes em paralelo e nenhuma espera fixa.
//   npm run test:requisitos

const RAIZ = path.resolve(__dirname, "..", "..", "..");
const ler = (arquivo: string) => readFileSync(path.join(RAIZ, arquivo), "utf8");
const INT = "/api/v1/internal";
const PUB = "/api/v1/public";
const DIA = 86_400_000;

describe("Requisitos da AV3 (AV3.pdf)", () => {
    let amb: Ambiente;
    let gestor2: ClienteApi;
    const relogio = new RelogioFixo(new Date());
    const hoje = new Date();
    // Meio-dia UTC de 20 dias atrás: o contrato padrão (assinado há 30 dias) já está vigente.
    const D = new Date(Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 20, 12));
    const em = (dias: number, horas = 0) => new Date(D.getTime() + dias * DIA + horas * 3_600_000);
    const lotes: string[] = [];
    let notebookMaisGasto = "";
    // Parceiros (chaves de API), um por contrato comercial.
    let soRastreio: ClienteApi, lotesRW: ClienteApi, relatorios: ClienteApi;

    before(async () => {
        relogio.definir(D);
        // Sem worker embutido: o requisito de resposta imediata é verificado com a tarefa ainda na fila.
        amb = await prepararAmbiente(relogio, { config: { workerEmbutido: false } });
        await amb.admin.post(`${INT}/usuarios`, { login: "gestor2", senha: SENHA_PADRAO, papel: "GESTOR_ALMOXARIFADO" });
        gestor2 = await amb.api.login("gestor2", SENHA_PADRAO);
        await amb.operador.post(`${INT}/organizacoes`, organizacaoPadrao(cnpjValido("314159265358")));
        await amb.operador.post(`${INT}/organizacoes`, organizacaoPadrao(cnpjValido("271828182845"), { razaoSocial: "Outra Organização Ltda" }));
        // BR001: lote A com notebooks de idades e estados diferentes + servidor; lotes B e C com um monitor.
        const anos: [number, string][] = [[2024, "NOVO"], [2022, "USADO_LEVE"], [2020, "USADO_MODERADO"], [2018, "DANIFICADO_LEVE"], [2016, "DANIFICADO_GRAVE"]];
        const a = await amb.gestor.post(`${INT}/lotes`, {
            organizacaoId: "BR001", notaFiscal: "1001", transportadora: "TransRapida",
            equipamentos: [...anos.map(([ano, estadoFisico]) => equipamentoPadrao({ anoFabricacao: ano, estadoFisico })),
                equipamentoPadrao({ tipo: "SERVIDOR", marca: "HP", modelo: "DL380", anoFabricacao: 2021, estadoFisico: "USADO_MODERADO", pesoQuilogramas: 25 })]
        });
        assert.equal(a.status, 201, JSON.stringify(a.corpo));
        notebookMaisGasto = a.corpo.equipamentos[4].id;
        lotes.push(a.corpo.id);
        for (const nf of ["1002", "1003"]) {
            const r = await amb.gestor.post(`${INT}/lotes`, { organizacaoId: "BR001", notaFiscal: nf, transportadora: "TransRapida", equipamentos: [equipamentoPadrao({ tipo: "MONITOR", marca: "LG", modelo: "24MK" })] });
            lotes.push(r.corpo.id);
        }
        await amb.gestor.post(`${INT}/lotes`, { organizacaoId: "BR002", notaFiscal: "2001", transportadora: "TransRapida", equipamentos: [equipamentoPadrao()] });
        // Triagem: A pelo gestor (espera 2,5 d, triagem 1 d); B pelo gestor2 (espera 1,5 d, triagem 0,25 d); C fica RECEBIDO.
        const triar = async (c: ClienteApi, lote: string, inicio: Date, fim: Date) => {
            relogio.definir(inicio);
            await c.post(`${INT}/lotes/${lote}/triagem`, {});
            relogio.definir(fim);
            await c.post(`${INT}/lotes/${lote}/triagem`, {});
        };
        await triar(gestor2, lotes[1]!, em(1), em(1, 6));
        await triar(amb.gestor, lotes[0]!, em(2), em(3));
        relogio.definir(em(6));
        const chave = async (corpo: Record<string, unknown>) => amb.api.comChave((await amb.admin.post(`${INT}/chaves-api`, corpo)).corpo.segredo);
        [soRastreio, lotesRW, relatorios] = await Promise.all([
            chave({ nome: "Auditoria ambiental", escopos: ["RASTREABILIDADE_LER"], organizacaoId: "BR001" }),
            chave({ nome: "ERP do cliente", escopos: ["LOTES_LER", "LOTES_ESCREVER"], plano: "PROFISSIONAL", organizacaoId: "BR001" }),
            chave({ nome: "BI do cliente", escopos: ["RELATORIOS_GERAR"], plano: "CORPORATIVO", organizacaoId: "BR001" })
        ]);
    });
    after(async () => { await amb.fechar(); });

    // ================================================================== 1º pilar: camada analítica

    it('R01 "utilizando exclusivamente Node.js, TypeScript e Prisma ORM" + biblioteca estatística (simple-statistics ou mathjs)', () => {
        const pacote = JSON.parse(ler("package.json"));
        for (const dep of ["@prisma/client", "simple-statistics"]) assert.ok(pacote.dependencies[dep], dep);
        assert.ok(pacote.devDependencies.typescript && pacote.devDependencies.prisma);
        assert.match(ler("src/analises/estatistica.ts"), /from "simple-statistics"/);
        assert.match(ler("src/repositorios/RepositorioAnalises.ts"), /this\.db\.(lote|equipamento)\.findMany/, "dados lidos pelo Prisma");
    });

    it('R02 "conjunto de serviços independentes, acessíveis por meio de endpoints específicos na API"', async () => {
        const respostas = await Promise.all(["eficiencia", "rentabilidade", "vida-util"].map(a => amb.auditor.get(`${INT}/analises/${a}`)));
        assert.deepEqual(respostas.map(r => r.status), [200, 200, 200]);
        assert.deepEqual(respostas.map(r => r.corpo.tipo), ["EFICIENCIA_OPERACIONAL", "RENTABILIDADE", "VIDA_UTIL"]);
        assert.equal(amb.app.servicos.analises.constructor.name, "ServicoAnalise");
    });

    it('R03 "...quanto por tarefas agendadas que executam cálculos em segundo plano" (node-cron / jobs recorrentes no worker)', async () => {
        const agendamentos = montarAgendamentos(amb.app.servicos, configuracaoTeste({ analisesCron: "0 2 * * *" }), { error() {}, warn() {}, info() {} });
        const analises = agendamentos.find(a => a.nome === "analises-recorrentes")!;
        assert.equal(analises.cron, "0 2 * * *");
        await analises.executar();
        const r = await amb.auditor.get(`${INT}/analises/execucoes?tamanhoPagina=10`);
        assert.deepEqual(r.corpo.itens.filter((e: any) => e.origem === "AGENDADA").map((e: any) => e.tipo).sort(), ["EFICIENCIA_OPERACIONAL", "RENTABILIDADE", "VIDA_UTIL"]);
        assert.match(ler("src/infra/fila/FilaBullMQ.ts"), /upsertJobScheduler/, "com Redis: job recorrente no worker (BullMQ)");
        assert.match(ler("src/infra/fila/FilaMemoria.ts"), /cron\.schedule/, "sem Redis: node-cron");
    });

    it('R04 "eficiência operacional: tempo médio de processamento de lotes desde a entrada até a conclusão da triagem, identificando gargalos e variações entre diferentes operadores ou períodos do ano"', async () => {
        const e = (await amb.auditor.get(`${INT}/analises/eficiencia?organizacaoId=BR001`)).corpo.resultado;
        assert.equal(e.lotesComTriagemConcluida, 2);
        assert.equal(e.temposDias.total.media, 2.63);      // (3,5 + 1,75) / 2
        assert.equal(e.temposDias.espera.media, 2);         // (2,5 + 1,5) / 2
        assert.equal(e.temposDias.triagem.media, 0.63);     // (1 + 0,25) / 2
        assert.equal(e.gargalo.etapa, "ESPERA");
        assert.deepEqual(e.porOperador.map((o: any) => [o.operador, o.triagemDias.mediana]), [["gestor2", 0.25], ["gestor", 1]]);
        assert.ok(e.porMes.length >= 1 && e.porMes.every((m: any) => /^\d{4}-\d{2}$/.test(m.mes)), "variação por período");
        assert.equal(e.pendencias.aguardandoTriagem.quantidade, 1);
    });

    it('R05 "rentabilidade por tipo de equipamento: valor médio de recuperação com base no estado físico, na marca e no modelo"', async () => {
        const x = (await amb.auditor.get(`${INT}/analises/rentabilidade?organizacaoId=BR001`)).corpo.resultado;
        const notebook = x.porTipo.find((t: any) => t.tipo === "NOTEBOOK");
        assert.equal(notebook.quantidade, 5);
        assert.ok(notebook.valorRecuperacao.media > 0);
        assert.equal(notebook.porEstadoFisico.length, 5, "por estado físico");
        assert.equal(notebook.marcas[0].nome, "Dell", "por marca");
        assert.equal(notebook.modelos[0].nome, "Dell Latitude 5490", "por modelo");
        assert.equal(x.prioridade[0].tipo, "SERVIDOR", "permite priorizar o maior retorno");
        const media = notebook.porEstadoFisico.reduce((s: number, g: any) => s + g.valorMedio * g.quantidade, 0) / 5;
        assert.ok(Math.abs(media - notebook.valorRecuperacao.media) < 0.02, "a média do tipo é coerente com o detalhamento");
    });

    it('R06 "análise preditiva de vida útil: regressão simples (mínimos quadrados ordinários) para projetar quando um tipo de equipamento atingirá o estado inservível"', async () => {
        const v = (await amb.auditor.get(`${INT}/analises/vida-util?organizacaoId=BR001&limitePrevisoes=500`)).corpo.resultado;
        const m = v.modelos.find((x: any) => x.tipo === "NOTEBOOK");
        assert.equal(m.metodo, "REGRESSAO_LINEAR");
        assert.ok(m.inclinacao > 0 && m.r2 >= 0.2);
        // idade em que o nível previsto chega a 6 (INSERVIVEL): (6 − a) / b
        assert.ok(Math.abs(m.idadePrevistaInservivelAnos - (6 - m.intercepto) / m.inclinacao) < 0.02);
        assert.equal(v.previsoes.length, v.equipamentosAtivos);
        assert.ok(v.previsoes.every((p: any) => /^\d{4}-\d{2}-\d{2}$/.test(p.dataPrevistaInservivel)));
    });

    it('R07 "armazenar os resultados em novas tabelas no banco de dados, de modo que relatórios anteriores fiquem disponíveis para consulta histórica"', async () => {
        const exec = await amb.auditor.post(`${INT}/analises/execucoes`, { tipo: "VIDA_UTIL", organizacaoId: "BR001" });
        assert.equal(exec.status, 201);
        const [linha, previsoes] = await Promise.all([
            amb.prisma.execucaoAnalise.findUnique({ where: { id: exec.corpo.id } }),
            amb.prisma.previsaoVidaUtil.count({ where: { execucaoId: exec.corpo.id } })
        ]);
        assert.ok(linha, "tabela execucoes_analise");
        assert.equal(previsoes, exec.corpo.previsoes, "tabela previsoes_vida_util");
        const [historico, consulta] = await Promise.all([
            amb.auditor.get(`${INT}/analises/execucoes?tipo=VIDA_UTIL`),
            amb.auditor.get(`${INT}/analises/execucoes/${exec.corpo.id}`)
        ]);
        assert.ok(historico.corpo.itens.some((e: any) => e.id === exec.corpo.id));
        assert.ok(consulta.corpo.resultado.modelos.length >= 1);
    });

    it('R08 "permite que você compare previsões com realizações futuras e refine continuamente os modelos"', async () => {
        relogio.definir(em(40));
        await amb.gestor.patch(`${INT}/equipamentos/${notebookMaisGasto}/estado`, { estadoFisico: "INSERVIVEL", justificativa: "Carcaça e placa danificadas" });
        const a = (await amb.auditor.get(`${INT}/analises/vida-util/aderencia?organizacaoId=BR001`)).corpo.resultado;
        assert.ok(a.avaliadas >= 1);
        assert.equal(typeof a.erroMedioAbsolutoDias, "number");
        assert.ok(a.porExecucao.length >= 1, "evolução do erro por execução");
        assert.ok("vencidasSemOcorrencia" in a && "emAberto" in a, "considera previsões ainda sem desfecho (censura)");
    });

    // ================================================================== 2º pilar: API pública

    it('R09 "API pública documentada... autenticação baseada em chaves de API"', async () => {
        const [semChave, comChave] = await Promise.all([amb.api.get(`${PUB}/eu`), lotesRW.get(`${PUB}/eu`)]);
        assert.equal(semChave.status, 401);
        assert.equal(semChave.corpo.erro.codigo, "CHAVE_API");
        assert.equal(comChave.status, 200);
    });

    it('R10 "cada parceiro deve receber uma chave de API única, gerada e gerenciada por um novo módulo dentro do seu serviço de autenticação"', async () => {
        const s = amb.app.servicos;
        assert.equal(s.autenticacao.chavesApi, s.chavesApi, "módulo composto pelo serviço de autenticação");
        const [a, b] = await Promise.all([1, 2].map(i => amb.admin.post(`${INT}/chaves-api`, { nome: `Parceiro ${i}`, escopos: ["LOTES_LER"] })));
        assert.notEqual(a!.corpo.segredo, b!.corpo.segredo);
        assert.notEqual(a!.corpo.chave.prefixo, b!.corpo.chave.prefixo);
        const linhas = await amb.prisma.chaveApi.findMany();
        assert.ok(linhas.every(l => !JSON.stringify(l).includes(a!.corpo.segredo.split("_")[2])), "o segredo não é gravado (só o hash)");
        const gestao = await Promise.all([
            amb.admin.post(`${INT}/chaves-api/${a!.corpo.chave.id}/rotacao`, {}),
            amb.admin.delete(`${INT}/chaves-api/${b!.corpo.chave.id}`),
            amb.gestor.get(`${INT}/chaves-api`)
        ]);
        assert.deepEqual(gestao.map(r => r.status), [200, 204, 403], "gerenciada pelo administrador: rotacionar, revogar; outros papéis não");
    });

    it('R11 "chave associada a permissões específicas, como apenas leitura de dados de rastreabilidade, ou leitura e escrita de lotes"', async () => {
        const equipamento = (await amb.gestor.get(`${INT}/equipamentos?organizacaoId=BR001`)).corpo.itens[0].id;
        const [rastreio, rastreioLotes, rwRastreio, rwLista, rwGrava, soLeituraGrava] = await Promise.all([
            soRastreio.get(`${PUB}/equipamentos/${equipamento}/rastreamento`),
            soRastreio.get(`${PUB}/lotes`),
            lotesRW.get(`${PUB}/equipamentos/${equipamento}/rastreamento`),
            lotesRW.get(`${PUB}/lotes`),
            lotesRW.post(`${PUB}/lotes`, { notaFiscal: "1100", transportadora: "Frota própria", equipamentos: [equipamentoPadrao()] }),
            soRastreio.post(`${PUB}/lotes`, { notaFiscal: "1101", transportadora: "Frota própria" })
        ]);
        assert.deepEqual([rastreio.status, rastreioLotes.status, rwRastreio.status, rwLista.status, rwGrava.status, soLeituraGrava.status], [200, 403, 403, 200, 201, 403]);
        assert.equal(rwGrava.corpo.organizacaoId, "BR001");
    });

    it('R12 "limites de taxa de requisição... configuração flexível de janelas de tempo e limites por cliente" (@fastify/rate-limit)', async () => {
        const basico = amb.api.comChave((await amb.admin.post(`${INT}/chaves-api`, { nome: "Plano básico", escopos: ["LOTES_LER"], plano: "BASICO" })).corpo.segredo);
        const status = (await Promise.all(Array.from({ length: 61 }, () => basico.get(`${PUB}/eu`)))).map(r => r.status);
        assert.equal(status.filter(s => s === 200).length, 60, "plano BASICO: 60 por minuto");
        assert.equal(status.filter(s => s === 429).length, 1);
        const [outra, excedida] = await Promise.all([relatorios.get(`${PUB}/eu`), basico.get(`${PUB}/eu`)]);
        assert.equal(outra.status, 200, "o limite é por cliente");
        assert.equal(outra.cabecalhos["x-ratelimit-limit"], "1200", "outro plano, outro limite");
        assert.ok(Number(excedida.cabecalhos["retry-after"]) > 0);
        assert.ok(JSON.parse(ler("package.json")).dependencies["@fastify/rate-limit"]);
    });

    it('R13 "documentação interativa gerada com @fastify/swagger... exemplos de requisição e resposta, códigos de erro possíveis e descrições claras de cada parâmetro"', async () => {
        const [ui, spec] = await Promise.all([
            amb.app.inject({ url: `${PUB}/docs` }),
            amb.app.inject({ url: `${PUB}/docs/json` }).then(r => r.json())
        ]);
        assert.equal(ui.statusCode, 200, "interface interativa no navegador");
        const operacoes = Object.entries<any>(spec.paths).flatMap(([rota, ms]) => Object.entries<any>(ms).map(([m, d]) => ({ op: `${m.toUpperCase()} ${rota}`, d })));
        assert.equal(operacoes.length, 13);
        for (const { op, d } of operacoes) {
            assert.ok(d.summary && d.description || d.summary, `${op}: resumo`);
            for (const p of d.parameters ?? []) assert.ok(p.description, `${op}: parâmetro ${p.name} sem descrição`);
            if (d.requestBody) {
                const corpo = JSON.stringify(d.requestBody);
                assert.ok(corpo.includes('"example'), `${op}: corpo sem exemplo`);
                const props = d.requestBody.content["application/json"].schema.properties;
                for (const [nome, prop] of Object.entries<any>(props)) assert.ok(prop.description, `${op}: campo ${nome} sem descrição`);
            }
            const [codigoSucesso, sucesso] = Object.entries<any>(d.responses).find(([c]) => c.startsWith("2"))!;
            assert.notEqual(sucesso.description, "Default Response", `${op}: resposta de sucesso sem descrição`);
            if (codigoSucesso !== "204") assert.ok(JSON.stringify(sucesso).includes('"example'), `${op}: resposta sem exemplo`);
            for (const codigo of ["400", "401", "403", "404", "429", "500"]) assert.match(d.responses[codigo]?.description ?? "", /[A-Z_]+:/, `${op}: erro ${codigo} sem explicação`);
        }
    });

    it('R14 "segregação: /api/v1/public para parceiros e /api/v1/internal (ou admin) para o front-end e a gestão"', async () => {
        const interna = (await amb.app.inject({ url: "/docs/json" })).json();
        assert.ok(Object.keys(interna.paths).every(r => r.startsWith(INT) || r === "/api/saude"));
        const [jwtNaPublica, chaveNaInterna] = await Promise.all([
            amb.admin.get(`${PUB}/lotes`),
            lotesRW.get(`${INT}/lotes`)
        ]);
        assert.equal(jwtNaPublica.status, 401, "token de usuário não vale na API pública");
        assert.equal(chaveNaInterna.status, 401, "chave de parceiro não vale na API interna");
    });

    it('R15 "a versão da API deve ser um parâmetro explícito na URL ou no cabeçalho" e "depreciação gradual de versões antigas"', async () => {
        const [publica, antiga] = await Promise.all([
            relatorios.get(`${PUB}/eu`),
            amb.app.inject({ url: "/api/lotes" })
        ]);
        assert.equal(publica.corpo.versaoApi, "1.0.0");
        assert.equal(publica.cabecalhos["api-version"], "1.0.0", "versão também no cabeçalho");
        assert.equal(antiga.statusCode, 308, "rota sem versão (AV2) redirecionada");
        assert.equal(antiga.headers.location, `${INT}/lotes`);
        assert.equal(antiga.headers.deprecation, "true");
    });

    // ================================================================== 3º pilar: processamento assíncrono

    it('R16 "publicando uma tarefa de geração de relatório... e retornando imediatamente ao cliente um identificador único da tarefa"', async () => {
        const r = await relatorios.post(`${PUB}/relatorios`, { tipo: "VIDA_UTIL", formato: "CSV" });
        assert.equal(r.status, 202);
        assert.match(r.corpo.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        assert.equal(r.corpo.situacao, "PENDENTE", "a resposta não espera o processamento");
        assert.equal(r.cabecalhos.location, `${PUB}/relatorios/${r.corpo.id}`);
        const cedo = await relatorios.get(`${PUB}/relatorios/${r.corpo.id}/arquivo`);
        assert.equal(cedo.status, 409, "ainda não há arquivo");
        assert.match(ler("src/infra/fila/FilaBullMQ.ts"), /from "bullmq"/, "fila BullMQ + Redis");
    });

    it('R17 "consultar um endpoint de status... e, quando disponível, fazer o download do arquivo" (CSV ou JSON) com "todos os seus equipamentos ativos"', async () => {
        await iniciarProcessamento(amb.app.servicos, configuracaoTeste(), { error() {}, warn() {}, info() {} });
        const lista = (await relatorios.get(`${PUB}/relatorios`)).corpo.itens;
        const csv = await aguardar(() => relatorios.get(`${PUB}/relatorios/${lista[0].id}`), r => r.corpo.situacao === "CONCLUIDA", 5000, 10);
        const json = await relatorios.post(`${PUB}/relatorios`, { tipo: "VIDA_UTIL", formato: "JSON" });
        await aguardar(() => relatorios.get(`${PUB}/relatorios/${json.corpo.id}`), r => r.corpo.situacao === "CONCLUIDA", 5000, 10);
        const [arquivoCsv, arquivoJson, ativos] = await Promise.all([
            relatorios.get(csv.corpo.links.arquivo),
            relatorios.get(`${PUB}/relatorios/${json.corpo.id}/arquivo`),
            amb.auditor.get(`${INT}/analises/vida-util?organizacaoId=BR001&limitePrevisoes=0`)
        ]);
        const total = ativos.corpo.resultado.equipamentosAtivos;
        assert.equal((arquivoCsv.corpo as string).trim().split("\r\n").length, total + 1, "uma linha por equipamento ativo");
        assert.equal(arquivoJson.corpo.resultado.previsoes.length, total);
        assert.match(String(arquivoCsv.cabecalhos["content-type"]), /text\/csv/);
        assert.match(String(arquivoJson.cabecalhos["content-type"]), /application\/json/);
    });

    it('R18 "qual política de retry adotou para tarefas com falha": erro transitório é repetido; erro de regra falha sem repetir', async () => {
        const analises = amb.app.servicos.analises as ServicoAnalise & { dadosRentabilidade: ServicoAnalise["dadosRentabilidade"] };
        let chamadas = 0;
        analises.dadosRentabilidade = async escopo => {
            chamadas++;
            if (chamadas === 1) throw new Error("conexão interrompida");
            if (chamadas >= 3) throw new ErroRegraNegocio("dados insuficientes");
            return ServicoAnalise.prototype.dadosRentabilidade.call(analises, escopo);
        };
        try {
            const transitoria = await relatorios.post(`${PUB}/relatorios`, { tipo: "RENTABILIDADE" });
            const ok = await aguardar(() => relatorios.get(`${PUB}/relatorios/${transitoria.corpo.id}`), r => r.corpo.situacao === "CONCLUIDA", 5000, 10);
            assert.equal(ok.corpo.tentativas, 2);
            const definitiva = await relatorios.post(`${PUB}/relatorios`, { tipo: "RENTABILIDADE" });
            const falhou = await aguardar(() => relatorios.get(`${PUB}/relatorios/${definitiva.corpo.id}`), r => r.corpo.situacao === "FALHOU", 5000, 10);
            assert.equal(falhou.corpo.tentativas, 1);
            assert.equal(chamadas, 3, "uma leitura por tentativa: 2 da transitória + 1 da definitiva");
        } finally {
            delete (analises as Partial<typeof analises>).dadosRentabilidade;
        }
    });

    // ================================================================== entrega

    it('R19 "relatório técnico": biblioteca de estatística, modelagem das tabelas, política de retry e evolução para centenas ou milhares de parceiros', () => {
        const relatorio = ler("docs/RELATORIO_TECNICO.md");
        for (const [assunto, padrao] of [
            ["biblioteca de estatística", /Biblioteca de estatística: simple-statistics/],
            ["modelagem das tabelas", /como as tabelas foram modeladas/],
            ["política de retry", /Política de retry/],
            ["escala para centenas ou milhares", /centenas ou milhares de parceiros/]
        ] as const) {
            assert.match(relatorio, padrao, assunto);
        }
    });

    it('R20 "compatível com Windows 10 ou superior, Linux Ubuntu 24.04.03 ou superior e derivados"', () => {
        const pacote = JSON.parse(ler("package.json"));
        assert.equal(pacote.engines.node, ">=20.19");
        // Comandos npm portáveis: nada de rm, export, variáveis inline (VAR=x) ou caminhos com barra invertida.
        for (const [nome, comando] of Object.entries<string>(pacote.scripts)) {
            assert.doesNotMatch(comando, /\brm |\bexport |(^|\s)[A-Z_]+=\S|\\/, `script ${nome} não portável: ${comando}`);
        }
        // Dependências com etapa nativa só se forem opcionais (há alternativa em JavaScript) ou o Prisma,
        // que baixa/gera arquivos sem compilar nada.
        const lock = JSON.parse(ler("package-lock.json")).packages as Record<string, { hasInstallScript?: boolean; optional?: boolean }>;
        const nativas = Object.entries(lock).filter(([nome, p]) => nome && p.hasInstallScript && !p.optional).map(([nome]) => nome);
        assert.deepEqual(nativas.sort(), ["node_modules/@prisma/engines", "node_modules/prisma"]);
        assert.match(ler("src/worker.ts"), /SIGBREAK/, "Ctrl+Break no Windows");
        assert.match(ler("src/config/configuracao.ts"), /REDIS_URL/, "Redis opcional (fila em memória sem ele)");
    });
});
