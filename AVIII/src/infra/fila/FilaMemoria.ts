import cron, { ScheduledTask } from "node-cron";
import { Agendamento, atrasoDaTentativa, FalhaDefinitiva, FilaTarefas, PoliticaRetry, ProcessadorTarefa } from "./FilaTarefas";

interface Registro {
    log: { error(obj: unknown, msg?: string): void; info(msg: string): void };
}

// Fila no próprio processo: mesma política de retry da FilaBullMQ, concorrência limitada e
// agendamentos com node-cron. Adequada a uma única instância (desenvolvimento e testes).
export default class FilaMemoria implements FilaTarefas {
    public readonly tipo = "memoria" as const;
    private processar: ProcessadorTarefa | null = null;
    private readonly espera: { tarefaId: string; tentativa: number }[] = [];
    private readonly emAndamento = new Set<Promise<void>>();
    private readonly temporizadores = new Set<NodeJS.Timeout>();
    private readonly tarefasCron: ScheduledTask[] = [];
    // Tarefas na fila, em execução ou aguardando nova tentativa (equivale ao jobId único do BullMQ).
    private readonly conhecidas = new Set<string>();
    private ativos = 0;
    private fechada = false;

    constructor(private readonly politica: PoliticaRetry, private readonly concorrencia: number, private readonly registro: Registro) {}

    public async enfileirar(tarefaId: string): Promise<void> {
        if (this.fechada) throw new Error("Fila encerrada.");
        // Mesma garantia do jobId do BullMQ: a mesma tarefa não entra duas vezes na fila.
        if (!this.conhecidas.has(tarefaId)) {
            this.conhecidas.add(tarefaId);
            this.espera.push({ tarefaId, tentativa: 1 });
        }
        this.bombear();
    }

    public async iniciarWorker(processar: ProcessadorTarefa): Promise<void> {
        this.processar = processar;
        this.bombear();
    }

    private bombear(): void {
        while (this.processar && !this.fechada && this.ativos < this.concorrencia && this.espera.length > 0) {
            const job = this.espera.shift()!;
            this.ativos++;
            const execucao = this.executar(job).finally(() => {
                this.ativos--;
                this.emAndamento.delete(execucao);
                this.bombear();
            });
            this.emAndamento.add(execucao);
        }
    }

    private async executar(job: { tarefaId: string; tentativa: number }): Promise<void> {
        const ultimaTentativa = job.tentativa >= this.politica.tentativas;
        try {
            await this.processar!(job.tarefaId, { tentativa: job.tentativa, ultimaTentativa });
            this.conhecidas.delete(job.tarefaId);
        } catch (erro) {
            if (erro instanceof FalhaDefinitiva || ultimaTentativa || this.fechada) {
                this.conhecidas.delete(job.tarefaId);
                this.registro.log.error({ err: erro, tarefaId: job.tarefaId }, "tarefa encerrada com falha");
                return;
            }
            const atraso = atrasoDaTentativa(this.politica, job.tentativa);
            const t = setTimeout(() => {
                this.temporizadores.delete(t);
                if (!this.fechada) {
                    this.espera.push({ tarefaId: job.tarefaId, tentativa: job.tentativa + 1 });
                    this.bombear();
                }
            }, atraso);
            t.unref();
            this.temporizadores.add(t);
        }
    }

    public async agendar(agendamentos: Agendamento[], fuso: string): Promise<void> {
        for (const a of agendamentos) {
            const tarefa = cron.schedule(a.cron, async () => {
                try {
                    await a.executar();
                } catch (erro) {
                    this.registro.log.error({ err: erro, agendamento: a.nome }, "falha em tarefa agendada");
                }
            }, { name: a.nome, timezone: fuso, noOverlap: true });
            this.tarefasCron.push(tarefa);
        }
    }

    public async disponivel(): Promise<boolean> {
        return !this.fechada;
    }

    public async fechar(): Promise<void> {
        this.fechada = true;
        for (const t of this.tarefasCron) await t.destroy();
        for (const t of this.temporizadores) clearTimeout(t);
        await Promise.allSettled([...this.emAndamento]);
    }
}
