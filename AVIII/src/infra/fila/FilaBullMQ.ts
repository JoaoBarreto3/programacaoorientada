import { Queue, UnrecoverableError, Worker } from "bullmq";
import { Redis } from "ioredis";
import { Agendamento, FalhaDefinitiva, FilaTarefas, PoliticaRetry, ProcessadorTarefa } from "./FilaTarefas";

interface Registro {
    log: { error(obj: unknown, msg?: string): void; warn(obj: unknown, msg?: string): void; info(msg: string): void };
}

const FILA_RELATORIOS = "greencode-relatorios";
const FILA_AGENDAMENTOS = "greencode-agendamentos";
const JOB_RELATORIO = "gerar-relatorio";
// Tempo máximo para falar com o Redis numa requisição HTTP: se ele estiver fora do ar, a API
// responde mesmo assim (a tarefa fica PENDENTE no banco e a varredura a recoloca na fila depois).
const TEMPO_LIMITE_REDIS_MS = 3000;

function comPrazo<T>(promessa: Promise<T>, ms: number, mensagem: string): Promise<T> {
    let t: NodeJS.Timeout;
    const prazo = new Promise<never>((_, rejeitar) => { t = setTimeout(() => rejeitar(new Error(mensagem)), ms); t.unref(); });
    return Promise.race([promessa, prazo]).finally(() => clearTimeout(t));
}

// Fila de produção: BullMQ sobre Redis.
//  - O job leva só o id da tarefa; o estado completo fica no PostgreSQL.
//  - jobId = id da tarefa: a mesma tarefa nunca fica duas vezes na fila.
//  - Retry: "tentativas" com backoff exponencial; FalhaDefinitiva vira UnrecoverableError (sem repetir).
//  - Job travado (worker que morreu no meio) é detectado pelo BullMQ (stalled) e reprocessado.
//  - Agendamentos recorrentes com upsertJobScheduler: com várias instâncias, cada disparo gera um
//    único job (o Redis coordena), ao contrário do node-cron, que dispararia em todas.
export default class FilaBullMQ implements FilaTarefas {
    public readonly tipo = "bullmq" as const;
    private readonly conexoes: Redis[] = [];
    private readonly relatorios: Queue;
    private readonly produtor: Redis;
    private agendamentos: Queue | null = null;
    private readonly workers: Worker[] = [];

    constructor(private readonly url: string, private readonly politica: PoliticaRetry,
        private readonly concorrencia: number, private readonly registro: Registro, private readonly prefixo = "greencode") {
        this.produtor = this.conectar(false);
        this.relatorios = new Queue(FILA_RELATORIOS, { connection: this.produtor, prefix: prefixo });
        this.relatorios.on("error", erro => this.registro.log.warn({ err: erro }, "fila de relatórios: erro de conexão com o Redis"));
    }

    // Workers usam conexões "bloqueantes" (maxRetriesPerRequest: null, exigência do BullMQ).
    private conectar(bloqueante: boolean): Redis {
        const conexao = new Redis(this.url, {
            maxRetriesPerRequest: bloqueante ? null : 1,
            enableOfflineQueue: bloqueante,
            lazyConnect: false
        });
        conexao.on("error", () => { /* reportado pelas filas e pelo /api/saude */ });
        this.conexoes.push(conexao);
        return conexao;
    }

    public async enfileirar(tarefaId: string): Promise<void> {
        await comPrazo(this.relatorios.add(JOB_RELATORIO, { tarefaId }, {
            jobId: tarefaId,
            attempts: this.politica.tentativas,
            backoff: { type: "exponential", delay: this.politica.atrasoInicialMs },
            // Jobs concluídos saem do Redis em 1 h (o resultado está no banco); falhos ficam 7 dias para inspeção.
            removeOnComplete: { age: 3600, count: 1000 },
            removeOnFail: { age: 7 * 86_400 }
        }), TEMPO_LIMITE_REDIS_MS, "Redis indisponível para enfileirar a tarefa.");
    }

    public async iniciarWorker(processar: ProcessadorTarefa): Promise<void> {
        const worker = new Worker(FILA_RELATORIOS, async job => {
            const tentativa = job.attemptsMade + 1;
            try {
                await processar(String(job.data.tarefaId), { tentativa, ultimaTentativa: tentativa >= (job.opts.attempts ?? 1) });
            } catch (erro) {
                throw erro instanceof FalhaDefinitiva ? new UnrecoverableError(erro.message) : erro;
            }
        }, { connection: this.conectar(true), concurrency: this.concorrencia, prefix: this.prefixo });
        worker.on("error", erro => this.registro.log.error({ err: erro }, "worker de relatórios: erro"));
        worker.on("failed", (job, erro) => this.registro.log.warn({ tarefaId: job?.data.tarefaId, tentativa: job?.attemptsMade, err: erro }, "tentativa de relatório falhou"));
        this.workers.push(worker);
    }

    public async agendar(agendamentos: Agendamento[], fuso: string): Promise<void> {
        this.agendamentos = new Queue(FILA_AGENDAMENTOS, { connection: this.conectar(false), prefix: this.prefixo });
        const fila = this.agendamentos;
        const porNome = new Map(agendamentos.map(a => [a.nome, a]));
        // Remove agendamentos que deixaram de existir (ex.: cron desativado na configuração).
        for (const existente of await fila.getJobSchedulers()) {
            const id = existente.id ?? existente.key;
            if (id && !porNome.has(id)) await fila.removeJobScheduler(id);
        }
        for (const a of agendamentos) {
            await fila.upsertJobScheduler(a.nome, { pattern: a.cron, tz: fuso }, {
                name: a.nome, data: {}, opts: { removeOnComplete: { count: 50 }, removeOnFail: { count: 50 } }
            });
        }
        const worker = new Worker(FILA_AGENDAMENTOS, async job => {
            const agendamento = porNome.get(job.name);
            if (!agendamento) throw new UnrecoverableError(`Agendamento desconhecido: ${job.name}`);
            return agendamento.executar();
        }, { connection: this.conectar(true), concurrency: 1, prefix: this.prefixo });
        worker.on("error", erro => this.registro.log.error({ err: erro }, "worker de agendamentos: erro"));
        worker.on("failed", (job, erro) => this.registro.log.error({ agendamento: job?.name, err: erro }, "falha em tarefa agendada"));
        this.workers.push(worker);
    }

    public async disponivel(): Promise<boolean> {
        try {
            return (await comPrazo(this.produtor.ping(), TEMPO_LIMITE_REDIS_MS, "sem resposta")) === "PONG";
        } catch {
            return false;
        }
    }

    public async fechar(): Promise<void> {
        // Worker.close() espera os jobs em andamento terminarem (graceful shutdown). Com o Redis
        // fora do ar o fechamento não pode travar: depois do prazo, as conexões são cortadas.
        const fechar = async () => {
            await Promise.allSettled(this.workers.map(w => w.close()));
            await Promise.allSettled([this.relatorios.close(), this.agendamentos?.close()]);
        };
        await comPrazo(fechar(), 30_000, "prazo de fechamento da fila esgotado").catch(() => undefined);
        for (const c of this.conexoes) c.disconnect();
    }
}
