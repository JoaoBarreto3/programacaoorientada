import { Configuracao } from "../config/configuracao";
import { Agendamento } from "../infra/fila/FilaTarefas";
import { RegistroLog } from "../infra/fila/criarFila";
import Servicos from "./Servicos";
import { TipoAnalise } from "./ServicoAnalise";

// Login gravado na auditoria e nas execuções disparadas pelo agendador.
export const LOGIN_AGENDADOR = "agendador";

// Tarefas recorrentes do worker:
//  - análises: as três análises globais, gravadas para consulta histórica (ANALISES_CRON);
//  - varredura: recoloca na fila tarefas PENDENTES que não chegaram a ela (Redis fora do ar na hora);
//  - expurgo: apaga arquivos de relatório vencidos (RELATORIO_RETENCAO_HORAS).
export function montarAgendamentos(servicos: Servicos, config: Configuracao, log: RegistroLog): Agendamento[] {
    const agendamentos: Agendamento[] = [
        { nome: "relatorios-varredura", cron: "*/5 * * * *", executar: () => servicos.relatoriosAssincronos.recuperarPendentes() },
        { nome: "relatorios-expurgo", cron: "17 * * * *", executar: () => servicos.relatoriosAssincronos.expurgarExpiradas() }
    ];
    if (config.analisesCron) {
        agendamentos.push({
            nome: "analises-recorrentes", cron: config.analisesCron,
            executar: async () => {
                for (const tipo of Object.values(TipoAnalise)) {
                    const execucao = await servicos.analises.executarEPersistir(tipo, {}, "AGENDADA", LOGIN_AGENDADOR);
                    log.info(`Análise ${tipo} executada pelo agendador (${execucao.id}, ${execucao.duracaoMs} ms).`);
                }
            }
        });
    }
    return agendamentos;
}

// Papel de worker: consome a fila de relatórios, registra os agendamentos e recupera o que ficou
// pendente (ex.: tarefas da fila em memória perdidas num reinício).
export async function iniciarProcessamento(servicos: Servicos, config: Configuracao, log: RegistroLog): Promise<void> {
    await servicos.fila.iniciarWorker(servicos.relatoriosAssincronos.processar);
    await servicos.fila.agendar(montarAgendamentos(servicos, config, log), config.fusoAgendamentos);
    const recuperadas = await servicos.relatoriosAssincronos.recuperarPendentes();
    if (recuperadas > 0) {
        log.info(`${recuperadas} tarefa(s) de relatório pendente(s) recolocada(s) na fila.`);
    }
}
