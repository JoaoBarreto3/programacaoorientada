import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { Ambiente, criarOrganizacaoELote, prepararAmbiente } from "../auxiliares";

// Varredura de robustez sobre TODAS as rotas documentadas (API interna e pública): para cada operação,
// envia entradas ausentes, inválidas e maliciosas. Nenhuma pode terminar em erro 500, toda resposta de
// erro segue o formato padronizado e toda rota protegida exige autenticação.

interface Operacao { metodo: string; rota: string; publica: boolean; temCorpo: boolean }

const SEM_AUTENTICACAO = new Set(["GET /api/saude", "GET /api/v1/internal/provisionamento", "POST /api/v1/internal/provisionamento", "POST /api/v1/internal/auth/login"]);
const VALORES_PARAMETRO = ["NAOEXISTE", "-".repeat(36), "00000000-0000-0000-0000-000000000000", "' OR 1=1 --", "A".repeat(300), "%20", "0"];
const CORPOS: unknown[] = [{}, { x: 1 }, { versao: "um", valor: "x", tipo: 5, nome: null, escopos: "LOTES_LER" }, [], { versao: -1, pagina: 0 }];
const CONSULTAS = ["", "?pagina=0", "?tamanhoPagina=999999", "?inicio=2026-02-30", "?inicio=ontem&fim=hoje", "?status=QUALQUER", "?organizacaoId=" + "Z".repeat(50), "?versao=abc"];

describe("Robustez de todas as rotas (nenhum erro 500)", () => {
    let amb: Ambiente;
    let operacoes: Operacao[];
    let chaveCompleta: string;

    before(async () => {
        amb = await prepararAmbiente();
        await criarOrganizacaoELote(amb, "223344556677", "8801");
        const chave = await amb.admin.post("/api/v1/internal/chaves-api", {
            nome: "Varredura", escopos: ["RASTREABILIDADE_LER", "LOTES_LER", "LOTES_ESCREVER", "RELATORIOS_GERAR"], plano: "CORPORATIVO", organizacaoId: "BR001"
        });
        chaveCompleta = chave.corpo.segredo;
        const docs = await Promise.all(["/docs/json", "/api/v1/public/docs/json"].map(u => amb.app.inject({ url: u }).then(r => r.json())));
        operacoes = docs.flatMap(spec => Object.entries<any>(spec.paths).flatMap(([rota, metodos]) =>
            Object.entries<any>(metodos).map(([metodo, doc]) => ({
                metodo: metodo.toUpperCase(), rota: rota.replace(/\/$/, ""), publica: rota.startsWith("/api/v1/public"), temCorpo: Boolean(doc.requestBody)
            }))));
    });
    after(async () => { await amb.fechar(); });

    // O logout invalidaria o token do administrador no meio da varredura (é coberto no teste sem autenticação).
    const varriveis = () => operacoes.filter(o => !o.rota.endsWith("/auth/logout"));
    const chamar = (op: Operacao, url: string, corpo?: unknown, autenticar = true) => amb.app.inject({
        method: op.metodo as "GET", url,
        headers: autenticar ? (op.publica ? { "x-api-key": chaveCompleta } : { authorization: `Bearer ${amb.admin.token}` }) : {},
        ...(corpo !== undefined ? { payload: corpo as object } : {})
    });

    const conferir = (op: Operacao, url: string, r: { statusCode: number; body: string; headers: Record<string, unknown> }) => {
        assert.ok(r.statusCode < 500, `${op.metodo} ${url} → ${r.statusCode}: ${r.body.slice(0, 300)}`);
        if (r.statusCode >= 400 && String(r.headers["content-type"]).includes("json")) {
            const corpo = JSON.parse(r.body);
            assert.ok(corpo.erro?.codigo && corpo.erro?.mensagem, `${op.metodo} ${url}: erro fora do padrão: ${r.body.slice(0, 200)}`);
        }
    };

    it("cobre todas as rotas documentadas (internas e públicas)", () => {
        assert.ok(operacoes.length >= 75, `${operacoes.length} operações`);
    });

    it("toda rota protegida recusa a requisição sem autenticação (401)", async () => {
        const protegidas = operacoes.filter(o => !SEM_AUTENTICACAO.has(`${o.metodo} ${o.rota}`) && !o.rota.includes("/docs"));
        const respostas = await Promise.all(protegidas.map(op => chamar(op, op.rota.replace(/\{[^}]+\}/g, "X"), op.temCorpo ? {} : undefined, false)));
        respostas.forEach((r, i) => assert.equal(r.statusCode, 401, `${protegidas[i]!.metodo} ${protegidas[i]!.rota} sem autenticação → ${r.statusCode}`));
    });

    it("parâmetros de caminho inválidos, inexistentes ou maliciosos nunca geram erro 500", async () => {
        for (const op of varriveis().filter(o => o.rota.includes("{"))) {
            for (const valor of VALORES_PARAMETRO) {
                const url = op.rota.replace(/\{[^}]+\}/g, encodeURIComponent(valor).replace(/%25/g, "%"));
                conferir(op, url, await chamar(op, url, op.temCorpo ? {} : undefined));
            }
        }
    });

    it("corpos malformados e consultas inválidas nunca geram erro 500", async () => {
        for (const op of varriveis()) {
            const base = op.rota.replace(/\{[^}]+\}/g, "NAOEXISTE");
            if (op.temCorpo) {
                for (const corpo of CORPOS) conferir(op, base, await chamar(op, base, corpo));
            }
            for (const consulta of CONSULTAS) conferir(op, base + consulta, await chamar(op, base + consulta, op.temCorpo ? {} : undefined));
        }
    });

    it("o sistema continua íntegro depois da varredura", async () => {
        const [saude, lotes] = await Promise.all([amb.app.inject({ url: "/api/saude" }), amb.gestor.get("/api/v1/internal/lotes")]);
        assert.equal(saude.statusCode, 200);
        assert.equal(lotes.corpo.total, 1, "nenhum lote criado ou apagado pelas entradas inválidas");
    });
});
