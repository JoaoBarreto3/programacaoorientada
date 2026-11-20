// Porta da fila de processamento assíncrono. Duas implementações:
//  - FilaBullMQ: Redis + BullMQ. Jobs persistentes, vários workers em vários processos ou máquinas,
//    agendamentos recorrentes sem duplicidade entre instâncias. É a opção de produção.
//  - FilaMemoria: no próprio processo, sem Redis. Para desenvolvimento e testes. Não sobrevive a
//    um reinício (o servidor recoloca na fila as tarefas pendentes do banco ao subir).
// As duas seguem a mesma política de retry, então o comportamento observado pela API é o mesmo.

export interface InfoTentativa {
    // 1, 2, 3...
    tentativa: number;
    ultimaTentativa: boolean;
}

export type ProcessadorTarefa = (tarefaId: string, info: InfoTentativa) => Promise<void>;

export interface PoliticaRetry {
    // Total de tentativas (a primeira execução mais as repetições).
    tentativas: number;
    // Espera antes da 2ª tentativa; dobra a cada nova falha (backoff exponencial).
    atrasoInicialMs: number;
}

export interface Agendamento {
    nome: string;
    // Expressão cron (minuto hora dia mês dia-da-semana).
    cron: string;
    executar: () => Promise<unknown>;
}

// Lançada pelo processador quando repetir não adianta (ex.: escopo inválido, organização apagada).
// A fila encerra a tarefa sem consumir as tentativas restantes.
export class FalhaDefinitiva extends Error {
    constructor(mensagem: string) {
        super(mensagem);
        this.name = "FalhaDefinitiva";
    }
}

export interface FilaTarefas {
    readonly tipo: "bullmq" | "memoria";
    enfileirar(tarefaId: string): Promise<void>;
    // Só no processo que faz o papel de worker (o servidor, com WORKER_EMBUTIDO, ou o npm run worker).
    iniciarWorker(processar: ProcessadorTarefa): Promise<void>;
    agendar(agendamentos: Agendamento[], fuso: string): Promise<void>;
    // Indica se a fila consegue receber trabalho (usado em /api/saude).
    disponivel(): Promise<boolean>;
    // Para de pegar trabalho novo e espera os jobs em andamento terminarem.
    fechar(): Promise<void>;
}

export const POLITICA_PADRAO: PoliticaRetry = { tentativas: 3, atrasoInicialMs: 5000 };

export function atrasoDaTentativa(politica: PoliticaRetry, tentativaQueFalhou: number): number {
    return politica.atrasoInicialMs * 2 ** (tentativaQueFalhou - 1);
}
