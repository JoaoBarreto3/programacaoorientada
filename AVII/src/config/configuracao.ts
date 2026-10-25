import { ITERACOES_PADRAO } from "../dominio/senha";

export interface Configuracao {
    porta: number;
    host: string;
    urlBanco: string;
    jwtSegredo: string;
    sessaoMinutos: number;
    logNivel: string;
    iteracoesSenha: number;
    // Tempo máximo para concluir as requisições em andamento no desligamento.
    tempoDesligamentoMs: number;
}

const NIVEIS_LOG = ["fatal", "error", "warn", "info", "debug", "trace", "silent"];

function inteiro(valor: string | undefined, padrao: number, nome: string, minimo: number, maximo: number): number {
    if (valor === undefined || valor.trim() === "") return padrao;
    const n = Number(valor);
    if (!Number.isInteger(n) || n < minimo || n > maximo) {
        throw new Error(`Variável de ambiente ${nome} inválida: "${valor}" (esperado inteiro entre ${minimo} e ${maximo}).`);
    }
    return n;
}

// Lê e valida as variáveis de ambiente. Falha cedo, na inicialização, com mensagem clara.
export function carregarConfiguracao(env: NodeJS.ProcessEnv = process.env): Configuracao {
    const urlBanco = env.DATABASE_URL?.trim();
    if (!urlBanco) {
        throw new Error("DATABASE_URL não definida. Copie .env.example para .env e ajuste a conexão com o PostgreSQL.");
    }
    const jwtSegredo = env.JWT_SEGREDO ?? "";
    if (jwtSegredo.length < 32) {
        throw new Error("JWT_SEGREDO deve ter pelo menos 32 caracteres (use um valor aleatório e secreto).");
    }
    const logNivel = (env.LOG_NIVEL ?? "info").toLowerCase();
    if (!NIVEIS_LOG.includes(logNivel)) {
        throw new Error(`LOG_NIVEL inválido: "${env.LOG_NIVEL}". Use: ${NIVEIS_LOG.join(", ")}.`);
    }
    return {
        porta: inteiro(env.PORT, 3000, "PORT", 0, 65535),
        host: env.HOST?.trim() || "0.0.0.0",
        urlBanco,
        jwtSegredo,
        sessaoMinutos: inteiro(env.SESSAO_MINUTOS, 30, "SESSAO_MINUTOS", 1, 24 * 60),
        logNivel,
        iteracoesSenha: inteiro(env.SENHA_ITERACOES, ITERACOES_PADRAO, "SENHA_ITERACOES", 1000, 10_000_000),
        tempoDesligamentoMs: inteiro(env.TEMPO_DESLIGAMENTO_MS, 10_000, "TEMPO_DESLIGAMENTO_MS", 0, 120_000)
    };
}
