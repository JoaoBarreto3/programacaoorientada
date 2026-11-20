import { Configuracao } from "../../config/configuracao";
import FilaBullMQ from "./FilaBullMQ";
import FilaMemoria from "./FilaMemoria";
import { FilaTarefas } from "./FilaTarefas";

export interface RegistroLog {
    error(obj: unknown, msg?: string): void;
    warn(obj: unknown, msg?: string): void;
    info(msg: string): void;
}

// Com REDIS_URL: BullMQ (produção, várias instâncias). Sem: fila em memória (desenvolvimento).
export function criarFila(config: Configuracao, log: RegistroLog, prefixoRedis?: string): FilaTarefas {
    const politica = { tentativas: config.filaTentativas, atrasoInicialMs: config.filaAtrasoMs };
    const registro = { log };
    return config.redisUrl
        ? new FilaBullMQ(config.redisUrl, politica, config.filaConcorrencia, registro, prefixoRedis)
        : new FilaMemoria(politica, config.filaConcorrencia, registro);
}
