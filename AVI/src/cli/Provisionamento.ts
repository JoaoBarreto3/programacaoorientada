import * as fs from "fs";
import * as path from "path";
import EntradaTerminal from "./EntradaTerminal";
import Saida from "./Saida";
import Aplicacao, { OpcoesAplicacao } from "../Aplicacao";
import CriptografiaArquivo from "../infra/CriptografiaArquivo";
import ConfiguracaoMestre from "../infra/ConfiguracaoMestre";
import { escreverArquivoAtomico } from "../infra/EscritaAtomica";
import JournalTransacao from "../infra/JournalTransacao";
import RegistroMudancas from "../infra/RegistroMudancas";
import Arquivos from "../infra/Arquivos";
import FabricaCredencial from "../fabricas/FabricaCredencial";
import PapelUsuario from "../dominio/enums/PapelUsuario";
import ValidadorSenha from "../validacao/ValidadorSenha";
import ValidadorUsuario from "../validacao/ValidadorUsuario";
import ErroGreencode, { ErroIntegridade } from "../comum/erros";
import Severidade from "../comum/Severidade";

const MAX_TENTATIVAS = 3;

function possuiDados(diretorio: string): boolean {
    if (!fs.existsSync(diretorio)) return false;
    return fs.readdirSync(diretorio).some(n => n.endsWith(".dat") || n === "journal" || n === "historico");
}

function limparDadosIncompletos(diretorio: string): void {
    for (const nome of fs.readdirSync(diretorio)) {
        if (nome.endsWith(".dat") || nome === "journal" || nome === "historico") {
            fs.rmSync(path.join(diretorio, nome), { recursive: true, force: true });
        }
    }
}

async function perguntarComValidacao(saida: Saida, pergunta: () => Promise<string | null>,
    validar: (valor: string) => string | null): Promise<string> {
    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
        const valor = await pergunta();
        if (valor === null) {
            throw new ErroGreencode("Provisionamento cancelado: entrada encerrada.", Severidade.ERRO, "PROVISIONAMENTO");
        }
        const erro = validar(valor);
        if (!erro) return valor;
        saida.erro(`${erro} (tentativa ${tentativa} de ${MAX_TENTATIVAS})`);
    }
    throw new ErroGreencode("Provisionamento cancelado após tentativas inválidas.", Severidade.ERRO, "PROVISIONAMENTO");
}

export function provisionarNucleo(diretorio: string, usuario: string, senha: string,
    opcoes: OpcoesAplicacao = {}): ConfiguracaoMestre {
    const marcador = ConfiguracaoMestre.caminhoMarcador(diretorio);
    escreverArquivoAtomico(marcador, new Date().toISOString());
    const criptografia = new CriptografiaArquivo();
    const chave = criptografia.gerarChave();
    const app = new Aplicacao(diretorio, chave, opcoes);
    app.journal.inicializar();
    if (app.autenticacao.credenciais.length > 0) {
        throw new ErroIntegridade("O sistema já possui usuários; o provisionamento inicial não pode ser repetido.");
    }
    const administrador = FabricaCredencial.criar(usuario, senha, PapelUsuario.ADMINISTRADOR, app.iteracoesSenha);
    const mudancas = new RegistroMudancas(app.repositorio);
    mudancas.salvar(Arquivos.CREDENCIAIS, FabricaCredencial.paraRegistro(administrador));
    new JournalTransacao({
        operacao: "PROVISIONAMENTO_ADMIN", entidade: `Credencial ${usuario}`, usuarioResponsavel: "sistema",
        dadosAntes: mudancas.antes, dadosDepois: mudancas.depois
    }, app.journal).registrar();
    app.parametros.gravarPadrao();
    app.journal.registrarEvento("PROVISIONAMENTO", "sistema", { alvo: usuario });
    const configuracao = ConfiguracaoMestre.salvar(diretorio, chave, usuario, app.relogio.agora(), criptografia);
    fs.rmSync(marcador, { force: true });
    return configuracao;
}

export async function provisionar(diretorio: string, entrada: EntradaTerminal, saida: Saida,
    opcoes: OpcoesAplicacao = {}): Promise<void> {
    const marcador = ConfiguracaoMestre.caminhoMarcador(diretorio);
    if (possuiDados(diretorio)) {
        if (!fs.existsSync(marcador)) {
            throw new ErroIntegridade(
                `O diretório ${diretorio} contém dados, mas o arquivo de configuração mestre (greencode.conf) não existe. ` +
                "Sem a chave mestra esses dados não podem ser lidos: restaure o greencode.conf de um backup ou use outro diretório.");
        }
        saida.aviso("Um provisionamento anterior foi interrompido; os arquivos parciais serão descartados.");
        limparDadosIncompletos(diretorio);
    }

    saida.texto("");
    saida.titulo("=== greencode — MODO DE PROVISIONAMENTO INICIAL ===");
    saida.info(`Nenhuma configuração mestre encontrada em ${diretorio}.\n` +
        "Será gerada uma chave criptográfica AES-256 e cadastrado o primeiro administrador.");

    const validadorUsuario = new ValidadorUsuario();
    const usuario = (await perguntarComValidacao(saida,
        () => entrada.perguntar("Login do administrador [admin]: "),
        v => validadorUsuario.validar(v.trim() || "admin") ? null : validadorUsuario.obterMensagemErro())).trim() || "admin";

    const validadorSenha = new ValidadorSenha();
    const senha = await perguntarComValidacao(saida, async () => {
        const s = await entrada.perguntarSenha("Senha do administrador: ");
        if (s === null) return null;
        const confirmacao = await entrada.perguntarSenha("Confirme a senha: ");
        return confirmacao === null ? null : (confirmacao === s ? s : "\u0000divergente");
    }, v => v === "\u0000divergente" ? "As senhas não conferem."
        : validadorSenha.validar({ usuario, senha: v }) ? null : validadorSenha.obterMensagemErro());

    provisionarNucleo(diretorio, usuario, senha, opcoes);
    saida.sucesso(`Provisionamento concluído. Administrador "${usuario}" criado; chave mestra gerada em ` +
        `${ConfiguracaoMestre.caminho(diretorio)}.`);
    saida.aviso("Faça backup do greencode.conf em local seguro: sem ele os dados cifrados são irrecuperáveis.");
}
