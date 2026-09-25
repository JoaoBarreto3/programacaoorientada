import Comando, { ContextoComando } from "./Comando";
import { COMANDOS } from "./comandos";
import Argumentos, { tokenizar } from "./Argumentos";
import EntradaTerminal from "./EntradaTerminal";
import Saida from "./Saida";
import Aplicacao from "../Aplicacao";
import Sessao, { MINUTOS_INATIVIDADE } from "../dominio/Sessao";
import PapelUsuario from "../dominio/enums/PapelUsuario";
import { papelPossui } from "../dominio/enums/Permissao";
import ServicoAutenticacao from "../servicos/ServicoAutenticacao";
import ServicoOrganizacao from "../servicos/ServicoOrganizacao";
import ServicoLote from "../servicos/ServicoLote";
import ServicoEquipamento from "../servicos/ServicoEquipamento";
import ServicoRelatorio from "../servicos/ServicoRelatorio";
import ErroGreencode, { ErroSessao } from "../comum/erros";

const APELIDOS: Record<string, string> = {
    equipamento: "equip", organizacao: "org", relatorios: "relatorio", usuarios: "usuario",
    help: "ajuda", "?": "ajuda", logout: "sair", exit: "encerrar", quit: "encerrar"
};

export default class CLIInterface {
    public autenticacao: ServicoAutenticacao;
    public organizacao: ServicoOrganizacao;
    public lote: ServicoLote;
    public equipamento: ServicoEquipamento;
    public relatorio: ServicoRelatorio;
    public sessaoAtual: Sessao | null = null;

    private readonly app: Aplicacao;
    private readonly entrada: EntradaTerminal;
    private readonly saida: Saida;
    private readonly comandos: readonly Comando[];
    private readonly aoEncerrar: () => void;
    private historico: string[] = [];
    private temporizador: NodeJS.Timeout | null = null;
    private execucaoAtual: Promise<void> = Promise.resolve();
    private encerrar = false;

    constructor(app: Aplicacao, entrada: EntradaTerminal, saida: Saida, aoEncerrar: () => void = () => undefined) {
        this.app = app;
        this.entrada = entrada;
        this.saida = saida;
        this.aoEncerrar = aoEncerrar;
        this.comandos = COMANDOS;
        this.autenticacao = app.autenticacao;
        this.organizacao = app.organizacao;
        this.lote = app.lote;
        this.equipamento = app.equipamento;
        this.relatorio = app.relatorio;
        entrada.definirCompletador(linha => this.completar(linha));
    }

    public iniciarLoop(): void {
        void this.executarLaco().finally(() => this.aoEncerrar());
    }

    public processarComando(entrada: string): void {
        this.execucaoAtual = this.executarComando(entrada);
    }

    public exibirMenuPorPapel(papel: PapelUsuario): void {
        const disponiveis = this.comandosDoPapel(papel);
        const grupos = new Map<string, Comando[]>();
        for (const c of disponiveis) {
            grupos.set(c.grupo, [...(grupos.get(c.grupo) ?? []), c]);
        }
        const largura = Math.max(...disponiveis.map(c => c.nome.length));
        this.saida.texto("");
        this.saida.titulo(`Menu — perfil ${papel}`);
        for (const [grupo, lista] of grupos) {
            this.saida.texto(`\n  ${grupo}`);
            for (const c of lista) {
                this.saida.texto(`    ${c.nome.padEnd(largura)}  ${c.resumo}`);
            }
        }
        this.saida.texto(`\n  Use "ajuda <comando>" para ver parâmetros e exemplos. Tab completa comandos e valores.`);
    }

    private async executarLaco(): Promise<void> {
        while (!this.encerrar) {
            if (!this.sessaoAtual) {
                if (!(await this.telaLogin())) {
                    break;
                }
                continue;
            }
            const s = this.sessaoAtual;
            const linha = await this.entrada.perguntar(`greencode(${s.usuario}@${s.papel})> `);
            if (linha === null) {
                this.encerrarSessao();
                break;
            }
            this.processarComando(linha);
            await this.execucaoAtual;
        }
        this.pararTemporizador();
        this.saida.info("greencode encerrado.");
    }

    private async telaLogin(): Promise<boolean> {
        this.saida.texto("");
        this.saida.titulo("Autenticação — deixe o usuário em branco para encerrar.");
        const usuario = await this.entrada.perguntar("Usuário: ");
        if (usuario === null || usuario.trim() === "") {
            return false;
        }
        const senha = await this.entrada.perguntarSenha("Senha: ");
        if (senha === null) {
            return false;
        }
        try {
            const sessao = this.autenticacao.login(usuario.trim(), senha);
            this.sessaoAtual = sessao;
            this.historico = this.app.historico.carregar(sessao.usuario);
            this.entrada.definirHistorico(this.historico);
            this.reiniciarTemporizador();
            this.saida.sucesso(`Bem-vindo(a), ${sessao.usuario} — perfil ${sessao.papel}. ` +
                `A sessão expira após ${MINUTOS_INATIVIDADE} minutos de inatividade.`);
            this.exibirMenuPorPapel(sessao.papel);
        } catch (erro) {
            this.reportarErro(erro);
        }
        return true;
    }

    private async executarComando(entrada: string): Promise<void> {
        const texto = entrada.trim();
        const sessao = this.sessaoAtual;
        if (!sessao) {
            if (texto) this.saida.aviso("Sessão expirada. Autentique-se novamente; o comando digitado não foi executado.");
            return;
        }
        if (!this.autenticacao.validarToken(sessao.token)) {
            this.expirarSessao();
            return;
        }
        if (!texto) {
            return;
        }
        this.reiniciarTemporizador();
        this.registrarHistorico(texto);
        try {
            const tokens = tokenizar(texto);
            const resolvido = this.resolver(tokens);
            if (!resolvido || !this.permitido(resolvido.comando, sessao.papel)) {
                this.saida.erro(`Comando desconhecido ou indisponível para o perfil ${sessao.papel}: "${tokens.slice(0, 2).join(" ")}". ` +
                    `Digite "ajuda" para ver seus comandos.`);
                return;
            }
            const args = new Argumentos(resolvido.resto, resolvido.comando.opcoes);
            await resolvido.comando.executar(args, this.contexto(sessao));
        } catch (erro) {
            this.reportarErro(erro);
        } finally {
            if (this.sessaoAtual === sessao) {
                sessao.renovar();
            }
        }
    }

    private contexto(sessao: Sessao): ContextoComando {
        return {
            app: this.app, sessao, saida: this.saida, entrada: this.entrada,
            encerrarSessao: () => this.encerrarSessao(),
            encerrarPrograma: () => { this.encerrarSessao(); this.encerrar = true; },
            exibirMenu: () => this.exibirMenuPorPapel(sessao.papel),
            exibirAjuda: (nome?: string) => this.exibirAjuda(sessao.papel, nome)
        };
    }

    private reportarErro(erro: unknown): void {
        if (erro instanceof ErroGreencode) {
            this.saida.emitir(erro.severidade, erro.message);
            if (erro instanceof ErroSessao && this.sessaoAtual) {
                this.expirarSessao();
            }
        } else {
            const e = erro as Error;
            this.saida.critico(`Erro inesperado: ${e?.message ?? String(erro)}`);
            if (process.env["GREENCODE_DEBUG"]) {
                this.saida.texto(e?.stack ?? "");
            }
        }
    }

    private reiniciarTemporizador(): void {
        this.pararTemporizador();
        if (this.sessaoAtual) {
            this.temporizador = setTimeout(() => this.verificarInatividade(), MINUTOS_INATIVIDADE * 60_000 + 1_000);
            this.temporizador.unref();
        }
    }

    private pararTemporizador(): void {
        if (this.temporizador) {
            clearTimeout(this.temporizador);
            this.temporizador = null;
        }
    }

    private verificarInatividade(): void {
        const sessao = this.sessaoAtual;
        if (!sessao) return;
        if (this.autenticacao.validarToken(sessao.token)) {
            this.reiniciarTemporizador();
        } else {
            this.expirarSessao();
        }
    }

    private expirarSessao(): void {
        const sessao = this.sessaoAtual;
        if (!sessao) return;
        this.pararTemporizador();
        this.persistirHistorico(sessao.usuario);
        this.autenticacao.validarToken(sessao.token);
        this.sessaoAtual = null;
        this.saida.texto("");
        this.saida.aviso(`Sessão de ${sessao.usuario} expirada após ${MINUTOS_INATIVIDADE} minutos de inatividade. ` +
            "Pressione Enter e autentique-se novamente.");
    }

    private encerrarSessao(): void {
        const sessao = this.sessaoAtual;
        if (!sessao) return;
        this.pararTemporizador();
        this.persistirHistorico(sessao.usuario);
        this.autenticacao.logout(sessao.token);
        this.sessaoAtual = null;
        this.saida.info(`Sessão de ${sessao.usuario} encerrada.`);
    }

    private registrarHistorico(linha: string): void {
        if (this.historico[0] !== linha) {
            this.historico.unshift(linha);
            this.historico.length = Math.min(this.historico.length, 500);
        }
        this.entrada.definirHistorico(this.historico);
    }

    private persistirHistorico(usuario: string): void {
        try {
            this.app.historico.salvar(usuario, this.historico);
        } catch (erro) {
            this.saida.aviso(`Não foi possível salvar o histórico de comandos: ${(erro as Error).message}`);
        }
        this.historico = [];
    }

    private permitido(comando: Comando, papel: PapelUsuario): boolean {
        return comando.permissao === null || papelPossui(papel, comando.permissao);
    }

    private comandosDoPapel(papel: PapelUsuario): Comando[] {
        return this.comandos.filter(c => this.permitido(c, papel));
    }

    private resolver(tokens: string[]): { comando: Comando; resto: string[] } | null {
        const primeiro = (tokens[0] ?? "").toLowerCase();
        const acao = APELIDOS[primeiro] ?? primeiro;
        const segundo = (tokens[1] ?? "").toLowerCase();
        const composto = this.comandos.find(c => c.nome === `${acao} ${segundo}`);
        if (composto) {
            return { comando: composto, resto: tokens.slice(2) };
        }
        const simples = this.comandos.find(c => c.nome === acao);
        return simples ? { comando: simples, resto: tokens.slice(1) } : null;
    }

    private exibirAjuda(papel: PapelUsuario, nome?: string): void {
        if (!nome) {
            this.exibirMenuPorPapel(papel);
            return;
        }
        const resolvido = this.resolver(tokenizar(nome));
        if (!resolvido || !this.permitido(resolvido.comando, papel)) {
            this.saida.erro(`Comando "${nome}" desconhecido ou indisponível para o seu perfil.`);
            return;
        }
        const c = resolvido.comando;
        this.saida.titulo(c.nome);
        this.saida.texto(`  ${c.resumo}\n\n  Uso: ${c.uso}`);
        if (c.opcoes?.length) {
            this.saida.texto("\n  Opções:");
            for (const o of c.opcoes) {
                const valores = o.valores ? ` [${o.valores.join(", ")}]` : "";
                this.saida.texto(`    --${o.nome.padEnd(16)} ${o.descricao}${o.obrigatoria ? " (obrigatória)" : ""}${valores}`);
            }
        }
        if (c.exemplo) {
            this.saida.texto(`\n  Exemplo: ${c.exemplo}`);
        }
    }

    private completar(linha: string): [string[], string] {
        const sessao = this.sessaoAtual;
        if (!sessao) {
            return [[], linha];
        }
        const disponiveis = this.comandosDoPapel(sessao.papel);
        const partes = linha.trimStart().split(/\s+/).filter(p => p.length > 0);
        const atual = /\s$/.test(linha) || partes.length === 0 ? "" : partes.pop()!;
        let candidatos: string[] = [];
        if (partes.length === 0) {
            candidatos = [...new Set(disponiveis.map(c => c.nome.split(" ")[0]!))];
        } else if (partes.length === 1 && disponiveis.some(c => c.nome.startsWith(`${partes[0]!.toLowerCase()} `))) {
            candidatos = disponiveis
                .filter(c => c.nome.startsWith(`${partes[0]!.toLowerCase()} `))
                .map(c => c.nome.split(" ")[1]!);
        } else {
            const resolvido = this.resolver(partes);
            if (resolvido) {
                const { comando, resto } = resolvido;
                const anterior = partes[partes.length - 1] ?? "";
                const opcao = comando.opcoes?.find(o => `--${o.nome}` === anterior);
                if (opcao && !opcao.flag) {
                    candidatos = [...(opcao.valores ?? [])];
                } else if (atual.startsWith("-")) {
                    candidatos = (comando.opcoes ?? []).map(o => `--${o.nome}`).filter(o => !partes.includes(o));
                } else {
                    let posicionais = 0;
                    for (let i = 0; i < resto.length; i++) {
                        const token = resto[i]!;
                        if (token.startsWith("--")) {
                            const definicao = comando.opcoes?.find(o => `--${o.nome}` === token);
                            if (definicao && !definicao.flag) i++;
                        } else {
                            posicionais++;
                        }
                    }
                    candidatos = [...(comando.posicionais?.[posicionais]?.valores ?? [])];
                }
            }
        }
        const prefixo = atual.toLowerCase();
        return [candidatos.filter(c => c.toLowerCase().startsWith(prefixo)).sort().map(c => c + " "), atual];
    }
}
