import { validate as cronValido } from "node-cron";
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

    // ---- AV3: fila, agendamentos e API pública
    // Redis para a fila (BullMQ) e para o limite de requisições compartilhado. Sem ele: fila em memória.
    redisUrl: string | null;
    // O servidor também processa a fila e os agendamentos. Com várias instâncias da API, use false
    // e rode um ou mais "npm run worker" separados.
    workerEmbutido: boolean;
    // Expressão cron das análises recorrentes ("" desativa) e o fuso horário dos agendamentos.
    analisesCron: string;
    fusoAgendamentos: string;
    filaTentativas: number;
    filaAtrasoMs: number;
    filaConcorrencia: number;
    relatorioRetencaoHoras: number;
    relatoriosSimultaneosPorUsuario: number;
    // Limites de requisição por IP (login e API pública). O limite por chave vem do plano.
    limiteLoginPorMinuto: number;
    limitePublicoPorIpPorMinuto: number;
}

const NIVEIS_LOG = ["fatal", "error", "warn", "info", "debug", "trace", "silent"];

function booleano(valor: string | undefined, padrao: boolean, nome: string): boolean {
    if (valor === undefined || valor.trim() === "") return padrao;
    const v = valor.trim().toLowerCase();
    if (["true", "1", "sim", "s"].includes(v)) return true;
    if (["false", "0", "nao", "não", "n"].includes(v)) return false;
    throw new Error(`Variável de ambiente ${nome} inválida: "${valor}" (use true ou false).`);
}

function fusoValido(fuso: string): boolean {
    try {
        new Intl.DateTimeFormat("pt-BR", { timeZone: fuso });
        return true;
    } catch {
        return false;
    }
}

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
    const redisUrl = env.REDIS_URL?.trim() || null;
    if (redisUrl && !/^rediss?:\/\//.test(redisUrl)) {
        throw new Error(`REDIS_URL inválida: "${redisUrl}" (esperado redis://host:porta/banco ou rediss://...).`);
    }
    const analisesCron = (env.ANALISES_CRON ?? "0 2 * * *").trim();
    if (analisesCron && !cronValido(analisesCron)) {
        throw new Error(`ANALISES_CRON inválida: "${analisesCron}" (formato cron: minuto hora dia mês dia-da-semana).`);
    }
    const fusoAgendamentos = env.FUSO_AGENDAMENTOS?.trim() || "America/Sao_Paulo";
    if (!fusoValido(fusoAgendamentos)) {
        throw new Error(`FUSO_AGENDAMENTOS inválido: "${fusoAgendamentos}" (ex.: America/Sao_Paulo).`);
    }
    return {
        porta: inteiro(env.PORT, 3000, "PORT", 0, 65535),
        host: env.HOST?.trim() || "0.0.0.0",
        urlBanco,
        jwtSegredo,
        sessaoMinutos: inteiro(env.SESSAO_MINUTOS, 30, "SESSAO_MINUTOS", 1, 24 * 60),
        logNivel,
        iteracoesSenha: inteiro(env.SENHA_ITERACOES, ITERACOES_PADRAO, "SENHA_ITERACOES", 1000, 10_000_000),
        tempoDesligamentoMs: inteiro(env.TEMPO_DESLIGAMENTO_MS, 10_000, "TEMPO_DESLIGAMENTO_MS", 0, 120_000),
        redisUrl,
        workerEmbutido: booleano(env.WORKER_EMBUTIDO, true, "WORKER_EMBUTIDO"),
        analisesCron,
        fusoAgendamentos,
        filaTentativas: inteiro(env.FILA_TENTATIVAS, 3, "FILA_TENTATIVAS", 1, 20),
        filaAtrasoMs: inteiro(env.FILA_ATRASO_MS, 5000, "FILA_ATRASO_MS", 0, 3_600_000),
        filaConcorrencia: inteiro(env.FILA_CONCORRENCIA, 2, "FILA_CONCORRENCIA", 1, 64),
        relatorioRetencaoHoras: inteiro(env.RELATORIO_RETENCAO_HORAS, 72, "RELATORIO_RETENCAO_HORAS", 1, 24 * 90),
        relatoriosSimultaneosPorUsuario: inteiro(env.RELATORIOS_SIMULTANEOS_POR_USUARIO, 5, "RELATORIOS_SIMULTANEOS_POR_USUARIO", 1, 100),
        limiteLoginPorMinuto: inteiro(env.LIMITE_LOGIN_POR_MINUTO, 20, "LIMITE_LOGIN_POR_MINUTO", 1, 100_000),
        limitePublicoPorIpPorMinuto: inteiro(env.LIMITE_PUBLICO_POR_IP_POR_MINUTO, 600, "LIMITE_PUBLICO_POR_IP_POR_MINUTO", 1, 1_000_000)
    };
}
