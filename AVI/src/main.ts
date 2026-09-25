#!/usr/bin/env node
import * as fs from "fs";
import Aplicacao from "./Aplicacao";
import CLIInterface from "./cli/CLIInterface";
import EntradaTerminal from "./cli/EntradaTerminal";
import Saida from "./cli/Saida";
import { provisionar } from "./cli/Provisionamento";
import CriptografiaArquivo from "./infra/CriptografiaArquivo";
import ConfiguracaoMestre from "./infra/ConfiguracaoMestre";
import TravaInstancia from "./infra/TravaInstancia";
import { limparTemporarios } from "./infra/EscritaAtomica";
import { resolverDiretorioDados } from "./infra/Caminhos";
import ErroGreencode from "./comum/erros";
import * as path from "path";

const VERSAO = "1.0.0";

const AJUDA = `greencode ${VERSAO} — gestão de logística reversa de resíduos eletrônicos

Uso: greencode [--dados <diretório>] [--ajuda] [--versao]

  --dados <dir>   diretório de dados (padrão: %APPDATA%\\greencode no Windows,
                  ~/.local/share/greencode no Linux; ou variável GREENCODE_DADOS)
  --ajuda         mostra esta ajuda
  --versao        mostra a versão

Na primeira execução o sistema entra em modo de provisionamento inicial.
Depois de autenticado, digite "ajuda" para ver os comandos do seu perfil.`;

function lerArgumentos(argv: string[]): { dados?: string; ajuda: boolean; versao: boolean } {
    const resultado: { dados?: string; ajuda: boolean; versao: boolean } = { ajuda: false, versao: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--dados") resultado.dados = argv[++i];
        else if (a?.startsWith("--dados=")) resultado.dados = a.slice(8);
        else if (a === "--ajuda" || a === "-h" || a === "--help") resultado.ajuda = true;
        else if (a === "--versao" || a === "-v" || a === "--version") resultado.versao = true;
        else throw new Error(`Argumento desconhecido: ${a}. Use --ajuda.`);
    }
    return resultado;
}

async function principal(argv: string[]): Promise<number> {
    const saida = new Saida();
    let trava: TravaInstancia | null = null;
    let entrada: EntradaTerminal | null = null;
    try {
        const args = lerArgumentos(argv);
        if (args.ajuda) { saida.texto(AJUDA); return 0; }
        if (args.versao) { saida.texto(VERSAO); return 0; }

        const diretorio = resolverDiretorioDados(args.dados);
        fs.mkdirSync(diretorio, { recursive: true, mode: 0o700 });
        trava = TravaInstancia.adquirir(diretorio);
        const liberar = trava;
        process.once("exit", () => liberar.liberar());

        const orfaos = [...limparTemporarios(diretorio), ...limparTemporarios(path.join(diretorio, "historico"))];
        if (orfaos.length) {
            saida.aviso(`Removidos ${orfaos.length} arquivo(s) temporário(s) de uma gravação interrompida; os dados originais estão íntegros.`);
        }

        entrada = new EntradaTerminal();
        const fecharEntrada = entrada;
        process.once("SIGTERM", () => fecharEntrada.fechar());

        if (!ConfiguracaoMestre.existe(diretorio)) {
            await provisionar(diretorio, entrada, saida);
        }
        const configuracao = ConfiguracaoMestre.carregar(diretorio, new CriptografiaArquivo());
        const app = new Aplicacao(diretorio, configuracao.chaveMestra);
        const relatorio = app.inicializar();
        if (relatorio.caudaReparada) {
            saida.aviso("O journal terminava com uma linha incompleta; ela foi descartada sem alterar nenhum dado.");
        }
        if (relatorio.recuperadas.length) {
            saida.aviso(`${relatorio.recuperadas.length} transação(ões) interrompida(s) foram concluídas a partir do journal.`);
        }
        if (relatorio.expurgados.length) {
            saida.info(`Política de retenção: ${relatorio.expurgados.length} arquivo(s) antigo(s) do journal removidos.`);
        }
        saida.info(`greencode ${VERSAO} — dados em ${diretorio}`);
        const cliEntrada = entrada;
        await new Promise<void>(encerrado => new CLIInterface(app, cliEntrada, saida, encerrado).iniciarLoop());
        return 0;
    } catch (erro) {
        if (erro instanceof ErroGreencode) {
            saida.emitir(erro.severidade, erro.message);
        } else {
            saida.critico(`Falha fatal: ${(erro as Error).message}`);
            if (process.env["GREENCODE_DEBUG"]) saida.texto((erro as Error).stack ?? "");
        }
        return 1;
    } finally {
        entrada?.fechar();
        trava?.liberar();
    }
}

principal(process.argv.slice(2)).then(codigo => { process.exitCode = codigo; });
