import { FastifyRequest } from "fastify";
import { lerData, Periodo, dataCivil } from "../../comum/datas";

export function dataOpcional(valor: string | undefined, campo: string): Date | undefined {
    return valor ? lerData(valor, campo) : undefined;
}

// Período dos relatórios: padrão de 01/01/2000 até hoje.
export function periodoDaConsulta(q: { inicio?: string; fim?: string }, agora: Date = new Date()): Periodo {
    return {
        inicio: dataOpcional(q.inicio, "inicio") ?? new Date(Date.UTC(2000, 0, 1)),
        fim: dataOpcional(q.fim, "fim") ?? dataCivil(agora)
    };
}

export function urlDoRecurso(requisicao: FastifyRequest, id: string): string {
    return `${requisicao.url.split("?")[0]!.replace(/\/$/, "")}/${encodeURIComponent(id)}`;
}
