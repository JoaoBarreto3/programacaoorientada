import { ClienteBanco, Prisma } from "../infra/banco";
import type { FormatoRelatorio, SituacaoTarefa, TarefaRelatorio, TipoRelatorio } from "../generated/prisma/client";
import { normalizarPaginacao, ParametrosPaginacao } from "../comum/paginacao";

export interface NovaTarefa {
    tipo: TipoRelatorio;
    formato: FormatoRelatorio;
    parametros: Record<string, unknown>;
    organizacaoId: string | null;
    solicitante: string;
    chaveApiId: string | null;
    criadaEm: Date;
}

export interface FiltroTarefas {
    solicitante?: string;
    chaveApiId?: string;
    situacao?: SituacaoTarefa;
}

// Colunas de uma tarefa sem o arquivo (que pode ter vários megabytes).
const SEM_CONTEUDO = {
    id: true, tipo: true, formato: true, parametros: true, organizacaoId: true, solicitante: true, chaveApiId: true,
    situacao: true, tentativas: true, erro: true, criadaEm: true, iniciadaEm: true, concluidaEm: true, expiraEm: true,
    tipoConteudo: true, tamanhoBytes: true, hashConteudo: true
} satisfies Prisma.TarefaRelatorioSelect;

export type ResumoTarefa = Omit<TarefaRelatorio, "conteudo">;

// O banco é a fonte da verdade da situação de cada tarefa; a fila só transporta o id.
export default class RepositorioTarefas {
    constructor(private readonly db: ClienteBanco) {}

    public async criar(t: NovaTarefa): Promise<ResumoTarefa> {
        return this.db.tarefaRelatorio.create({
            data: { ...t, parametros: JSON.parse(JSON.stringify(t.parametros)) as Prisma.InputJsonValue },
            select: SEM_CONTEUDO
        });
    }

    public async buscar(id: string): Promise<ResumoTarefa | null> {
        return this.db.tarefaRelatorio.findUnique({ where: { id }, select: SEM_CONTEUDO });
    }

    public async buscarComConteudo(id: string): Promise<TarefaRelatorio | null> {
        return this.db.tarefaRelatorio.findUnique({ where: { id } });
    }

    public async listar(filtro: FiltroTarefas, paginacao: ParametrosPaginacao) {
        const { pular, tamanhoPagina, pagina } = normalizarPaginacao(paginacao);
        const where: Prisma.TarefaRelatorioWhereInput = { ...filtro };
        const [itens, total] = await Promise.all([
            this.db.tarefaRelatorio.findMany({ where, orderBy: [{ criadaEm: "desc" }, { id: "asc" }], skip: pular, take: tamanhoPagina, select: SEM_CONTEUDO }),
            this.db.tarefaRelatorio.count({ where })
        ]);
        return { itens, total, pagina, tamanhoPagina };
    }

    public contarEmAndamento(filtro: { chaveApiId?: string; solicitante?: string }): Promise<number> {
        return this.db.tarefaRelatorio.count({ where: { ...filtro, situacao: { in: ["PENDENTE", "PROCESSANDO"] } } });
    }

    public async idsEmAndamento(): Promise<string[]> {
        const linhas = await this.db.tarefaRelatorio.findMany({
            where: { situacao: { in: ["PENDENTE", "PROCESSANDO"] } }, orderBy: { criadaEm: "asc" }, select: { id: true }
        });
        return linhas.map(l => l.id);
    }

    // Marca o início de uma tentativa. Só avança tarefas ainda não finalizadas (idempotente:
    // um job repetido de uma tarefa já concluída não a reprocessa).
    public async iniciarTentativa(id: string, tentativa: number, agora: Date): Promise<boolean> {
        const r = await this.db.tarefaRelatorio.updateMany({
            where: { id, situacao: { in: ["PENDENTE", "PROCESSANDO"] } },
            data: { situacao: "PROCESSANDO", tentativas: tentativa, iniciadaEm: agora }
        });
        return r.count === 1;
    }

    // updateMany (e não update): se a tarefa foi excluída durante o processamento, nada é gravado
    // e nenhum erro é lançado. Só conclui o que ainda está PROCESSANDO.
    public async concluir(id: string, dados: { conteudo: string; tipoConteudo: string; tamanhoBytes: number; hashConteudo: string; concluidaEm: Date; expiraEm: Date }): Promise<void> {
        await this.db.tarefaRelatorio.updateMany({ where: { id, situacao: "PROCESSANDO" }, data: { ...dados, situacao: "CONCLUIDA", erro: null } });
    }

    // Falha de uma tentativa: volta para PENDENTE (haverá nova tentativa) ou FALHOU (definitiva).
    public async registrarFalha(id: string, erro: string, definitiva: boolean, agora: Date): Promise<void> {
        await this.db.tarefaRelatorio.updateMany({
            where: { id, situacao: "PROCESSANDO" },
            data: { situacao: definitiva ? "FALHOU" : "PENDENTE", erro: erro.slice(0, 1000), ...(definitiva ? { concluidaEm: agora } : {}) }
        });
    }

    // Exclusão pelo solicitante: qualquer situação, menos PROCESSANDO (o worker está gerando o arquivo).
    // Uma tarefa PENDENTE excluída é simplesmente ignorada quando o job chegar ao worker.
    public async excluir(id: string): Promise<boolean> {
        const r = await this.db.tarefaRelatorio.deleteMany({ where: { id, situacao: { not: "PROCESSANDO" } } });
        return r.count === 1;
    }

    // Trava (até o fim da transação) as solicitações de um mesmo solicitante: duas requisições
    // simultâneas não passam juntas pela contagem do limite de relatórios em andamento.
    public async travarSolicitante(chave: string): Promise<void> {
        await this.db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"relatorios:" + chave}))`;
    }

    // Retenção: tarefas finalizadas há mais tempo que o prazo são apagadas (com o arquivo).
    public async expurgarExpiradas(agora: Date): Promise<number> {
        const r = await this.db.tarefaRelatorio.deleteMany({
            where: { OR: [{ expiraEm: { lt: agora } }, { situacao: "FALHOU", concluidaEm: { lt: new Date(agora.getTime() - 7 * 86_400_000) } }] }
        });
        return r.count;
    }
}
