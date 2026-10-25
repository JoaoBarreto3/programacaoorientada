import "dotenv/config";
import { carregarConfiguracao } from "./config/configuracao";
import { criarClientePrisma } from "./infra/banco";
import Repositorios from "./repositorios/Repositorios";
import { construirApp } from "./app";

// Ponto de entrada do servidor HTTP.
async function iniciar(): Promise<void> {
    const config = carregarConfiguracao();
    const prisma = criarClientePrisma(config.urlBanco);
    const app = await construirApp({ config, prisma });
    app.addHook("onClose", async () => {
        await prisma.$disconnect();
    });

    try {
        // Confere a conexão e garante a linha de parâmetros globais antes de aceitar requisições.
        await new Repositorios(prisma).parametros.garantirPadrao();
    } catch (erro) {
        app.log.fatal({ err: erro }, "Não foi possível acessar o banco de dados. Verifique DATABASE_URL e se as migrações foram aplicadas (npm run db:migrar).");
        await app.close();
        process.exitCode = 1;
        return;
    }

    // Graceful shutdown: para de aceitar conexões, conclui as requisições em andamento,
    // fecha o pool do banco e só então encerra o processo.
    let encerrando = false;
    const encerrar = async (sinal: string) => {
        if (encerrando) return;
        encerrando = true;
        app.log.info(`Sinal ${sinal} recebido: encerrando o servidor...`);
        const limite = setTimeout(() => {
            app.log.error(`Requisições não concluídas em ${config.tempoDesligamentoMs} ms; encerrando à força.`);
            process.exit(1);
        }, config.tempoDesligamentoMs);
        limite.unref();
        try {
            await app.close();
            app.log.info("Servidor encerrado.");
            process.exit(0);
        } catch (erro) {
            app.log.error({ err: erro }, "Falha ao encerrar o servidor.");
            process.exit(1);
        }
    };
    // SIGINT = Ctrl+C (Windows e Linux); SIGTERM = systemd/docker; SIGBREAK = Ctrl+Break (Windows).
    for (const sinal of ["SIGINT", "SIGTERM", "SIGBREAK"] as const) {
        process.on(sinal, () => void encerrar(sinal));
    }
    process.on("unhandledRejection", motivo => app.log.error({ err: motivo }, "Promise rejeitada sem tratamento"));

    await app.listen({ port: config.porta, host: config.host });
    app.log.info(`Front-end: http://localhost:${config.porta}/  ·  Documentação da API: http://localhost:${config.porta}/docs`);
}

iniciar().catch(erro => {
    console.error(erro instanceof Error ? erro.message : erro);
    process.exit(1);
});
