import "dotenv/config";
import pino from "pino";
import { carregarConfiguracao } from "./config/configuracao";
import { criarClientePrisma } from "./infra/banco";
import { criarFila } from "./infra/fila/criarFila";
import Repositorios from "./repositorios/Repositorios";
import Servicos from "./servicos/Servicos";
import { iniciarProcessamento } from "./servicos/processamento";
import { RelogioSistema } from "./comum/Relogio";

// Processo worker separado (npm run worker): consome a fila de relatórios e executa os agendamentos.
// Para escalar, rode a API com WORKER_EMBUTIDO=false em várias instâncias e quantos workers forem
// necessários; todos coordenados pelo Redis (BullMQ).
async function iniciar(): Promise<void> {
    const config = carregarConfiguracao();
    const log = pino({ level: config.logNivel, base: { papel: "worker" } });
    if (!config.redisUrl) {
        log.fatal("O worker separado exige REDIS_URL: sem Redis a fila é em memória e só existe dentro do processo da API " +
            "(nesse caso use WORKER_EMBUTIDO=true no servidor e não rode o worker).");
        process.exitCode = 1;
        return;
    }
    const prisma = criarClientePrisma(config.urlBanco);
    const fila = criarFila(config, log);
    // O worker não emite tokens de sessão.
    const semTokens = { emitir: () => { throw new Error("O worker não emite tokens."); } };
    const servicos = new Servicos(prisma, new RelogioSistema(), semTokens, config.iteracoesSenha, fila, {
        retencaoHoras: config.relatorioRetencaoHoras, simultaneosPorUsuario: config.relatoriosSimultaneosPorUsuario
    });
    try {
        await new Repositorios(prisma).parametros.garantirPadrao();
    } catch (erro) {
        log.fatal({ err: erro }, "Não foi possível acessar o banco de dados. Verifique DATABASE_URL e as migrações (npm run db:migrar).");
        await fila.fechar();
        await prisma.$disconnect();
        process.exitCode = 1;
        return;
    }
    await iniciarProcessamento(servicos, config, log);
    log.info(`Worker no ar: concorrência ${config.filaConcorrencia}, ${config.filaTentativas} tentativa(s) por relatório, ` +
        `análises recorrentes: ${config.analisesCron || "desativadas"} (${config.fusoAgendamentos}).`);

    // Graceful shutdown: para de pegar jobs novos e espera os em andamento terminarem.
    let encerrando = false;
    const encerrar = async (sinal: string) => {
        if (encerrando) return;
        encerrando = true;
        log.info(`Sinal ${sinal} recebido: encerrando o worker...`);
        const limite = setTimeout(() => process.exit(1), Math.max(config.tempoDesligamentoMs, 30_000));
        limite.unref();
        await fila.fechar();
        await prisma.$disconnect();
        process.exit(0);
    };
    for (const sinal of ["SIGINT", "SIGTERM", "SIGBREAK"] as const) {
        process.on(sinal, () => void encerrar(sinal));
    }
}

iniciar().catch(erro => {
    console.error(erro instanceof Error ? erro.message : erro);
    process.exit(1);
});
