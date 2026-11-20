import { FastifyRequest } from "fastify";
import { lerData, Periodo, dataCivil } from "../../comum/datas";
import { ErroValidacao } from "../../comum/erros";

// Instante completo (ISO 8601 com hora), ex.: validade de uma chave de API.
export function dataHoraOpcional(valor: string | null | undefined, campo: string): Date | undefined {
    if (!valor) return undefined;
    const data = new Date(valor);
    if (Number.isNaN(data.getTime())) {
        throw new ErroValidacao(`${campo}: "${valor}" não é uma data e hora válida (use ISO 8601, ex.: 2027-01-31T23:59:59Z).`);
    }
    return data;
}

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

// Escopo das análises a partir da consulta (organização e período de entrada dos lotes).
export function escopoDaConsulta(q: { organizacaoId?: string; inicio?: string; fim?: string }) {
    return { organizacaoId: q.organizacaoId, inicio: dataOpcional(q.inicio, "inicio"), fim: dataOpcional(q.fim, "fim") };
}

// Tarefa de relatório com os links de acompanhamento (padrão de polling: o cliente consulta
// "situacao" até CONCLUIDA e então baixa "arquivo").
export function tarefaComLinks<T extends { id: string; situacao: string }>(tarefa: T, base: string) {
    return {
        ...tarefa,
        links: { situacao: `${base}/${tarefa.id}`, arquivo: tarefa.situacao === "CONCLUIDA" ? `${base}/${tarefa.id}/arquivo` : null }
    };
}

export const respostaArquivo = {
    description: "Arquivo do relatório (application/json ou text/csv). O cabeçalho ETag traz o SHA-256 do conteúdo.",
    type: "string"
} as const;
