import * as fs from "fs";
import * as path from "path";
import { createHash, randomUUID } from "crypto";
import CriptografiaArquivo from "./CriptografiaArquivo";
import JournalTransacao from "./JournalTransacao";
import RepositorioArquivo from "./RepositorioArquivo";
import { Mudancas } from "./RegistroMudancas";
import { escreverArquivoAtomico, limparTemporarios } from "./EscritaAtomica";
import Relogio from "../comum/Relogio";
import { ErroIntegridade, ErroNaoEncontrado, ErroValidacao } from "../comum/erros";

const HASH_GENESIS = "0".repeat(64);
const ARQUIVO_ATUAL = "journal-atual.log";
const PADRAO_ROTACIONADO = /^journal-(\d{8}T\d{9}Z)\.log$/;
const MS_POR_DIA = 24 * 60 * 60 * 1000;

export const TAMANHO_MAXIMO_JOURNAL = 10 * 1024 * 1024;
export const RETENCAO_MINIMA_DIAS = 180;

type TransacaoJSON = {
    id: string; timestamp: string; operacao: string; entidade: string;
    dadosAntes: Mudancas; dadosDepois: Mudancas; usuarioResponsavel: string;
};
type LinhaTransacao = { tipo: "TRANSACAO"; hashAnterior: string; transacao: TransacaoJSON };
type LinhaConfirmacao = { tipo: "CONFIRMACAO"; hashAnterior: string; id: string; timestamp: string; recuperada: boolean };
type LinhaEvento = {
    tipo: "EVENTO"; hashAnterior: string; id: string; timestamp: string;
    operacao: string; usuario: string; detalhes: Record<string, unknown>;
};
type Linha = LinhaTransacao | LinhaConfirmacao | LinhaEvento;
type SemHash<T> = T extends unknown ? Omit<T, "hashAnterior"> : never;

interface LinhaLida {
    arquivo: string;
    numero: number;
    linha: Linha | null;
    hash: string | null;
}

export interface RelatorioInicializacao {
    caudaReparada: boolean;
    recuperadas: string[];
    expurgados: string[];
}

export interface ResultadoVerificacao {
    integro: boolean;
    arquivos: number;
    linhas: number;
    transacoes: number;
    problemas: string[];
}

export interface RegistroJournal {
    tipo: "TRANSACAO" | "EVENTO";
    id: string;
    timestamp: Date;
    operacao: string;
    usuario: string;
    entidade: string;
    situacao: "CONFIRMADA" | "PENDENTE" | "EVENTO";
    afetados: string[];
}

export interface OpcoesJournal {
    diretorio: string;
    criptografia: CriptografiaArquivo;
    chave: string;
    repositorio: RepositorioArquivo;
    relogio: Relogio;
    tamanhoMaximoBytes?: number;
    retencaoDias?: () => number;
    usuarioAtual?: () => string;
}

function jsonEstavel(valor: unknown): string {
    if (Array.isArray(valor)) {
        return `[${valor.map(jsonEstavel).join(",")}]`;
    }
    if (valor !== null && typeof valor === "object") {
        const obj = valor as Record<string, unknown>;
        return `{${Object.keys(obj).sort().map(k => `${JSON.stringify(k)}:${jsonEstavel(obj[k])}`).join(",")}}`;
    }
    return JSON.stringify(valor) ?? "null";
}

function sha256(texto: string): string {
    return createHash("sha256").update(texto, "utf8").digest("hex");
}

export default class GerenciadorJournal {
    private readonly diretorio: string;
    private readonly criptografia: CriptografiaArquivo;
    private readonly chave: string;
    private readonly repositorio: RepositorioArquivo;
    private readonly relogio: Relogio;
    private readonly tamanhoMaximoBytes: number;
    private readonly retencaoDias: () => number;
    private readonly usuarioAtual: () => string;
    private ultimoHash = HASH_GENESIS;
    private inconsistente = false;

    constructor(opcoes: OpcoesJournal) {
        this.diretorio = opcoes.diretorio;
        this.criptografia = opcoes.criptografia;
        this.chave = opcoes.chave;
        this.repositorio = opcoes.repositorio;
        this.relogio = opcoes.relogio;
        this.tamanhoMaximoBytes = opcoes.tamanhoMaximoBytes ?? TAMANHO_MAXIMO_JOURNAL;
        this.retencaoDias = opcoes.retencaoDias ?? (() => RETENCAO_MINIMA_DIAS);
        this.usuarioAtual = opcoes.usuarioAtual ?? (() => "sistema");
    }

    private get caminhoAtual(): string {
        return path.join(this.diretorio, ARQUIVO_ATUAL);
    }

    private static nomeRotacionado(data: Date): string {
        return `journal-${data.toISOString().replace(/[-:.]/g, "")}.log`;
    }

    private static dataDoNome(nome: string): Date | null {
        const s = PADRAO_ROTACIONADO.exec(nome)?.[1];
        if (!s) {
            return null;
        }
        return new Date(`${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}.${s.slice(15, 18)}Z`);
    }

    private arquivosRotacionados(): string[] {
        if (!fs.existsSync(this.diretorio)) {
            return [];
        }
        return fs.readdirSync(this.diretorio).filter(n => PADRAO_ROTACIONADO.test(n)).sort();
    }

    public listarArquivos(): string[] {
        const arquivos = this.arquivosRotacionados().map(n => path.join(this.diretorio, n));
        if (fs.existsSync(this.caminhoAtual)) {
            arquivos.push(this.caminhoAtual);
        }
        return arquivos;
    }

    private lerArquivo(caminho: string): LinhaLida[] {
        const brutas = fs.readFileSync(caminho, "utf8").split(/\r?\n/);
        if (brutas[brutas.length - 1] === "") {
            brutas.pop();
        }
        return brutas.map((bruta, i) => {
            try {
                const claro = this.criptografia.decifrar(bruta, this.chave);
                return { arquivo: path.basename(caminho), numero: i + 1, linha: JSON.parse(claro) as Linha, hash: sha256(claro) };
            } catch {
                return { arquivo: path.basename(caminho), numero: i + 1, linha: null, hash: null };
            }
        });
    }

    private lerTudo(): LinhaLida[] {
        return this.listarArquivos().flatMap(a => this.lerArquivo(a));
    }

    private anexar(conteudo: SemHash<Linha>): void {
        const texto = JSON.stringify({ ...conteudo, hashAnterior: this.ultimoHash });
        const existente = fs.existsSync(this.caminhoAtual) ? fs.readFileSync(this.caminhoAtual, "utf8") : "";
        escreverArquivoAtomico(this.caminhoAtual, existente + this.criptografia.cifrar(texto, this.chave) + "\n");
        this.ultimoHash = sha256(texto);
    }

    private aplicar(mudancas: Mudancas): void {
        for (const [arquivo, registros] of Object.entries(mudancas)) {
            for (const [id, valor] of Object.entries(registros)) {
                if (valor === null) {
                    this.repositorio.excluirEntidade(arquivo, id);
                } else {
                    this.repositorio.salvarEntidade(arquivo, valor);
                }
            }
        }
    }

    private static serializar(t: JournalTransacao): TransacaoJSON {
        return {
            id: t.id, timestamp: t.timestamp.toISOString(), operacao: t.operacao, entidade: t.entidade,
            dadosAntes: t.dadosAntes, dadosDepois: t.dadosDepois, usuarioResponsavel: t.usuarioResponsavel
        };
    }

    private desserializar(json: TransacaoJSON): JournalTransacao {
        return new JournalTransacao({ ...json, timestamp: new Date(json.timestamp) }, this);
    }

    public inicializar(): RelatorioInicializacao {
        fs.mkdirSync(this.diretorio, { recursive: true, mode: 0o700 });
        limparTemporarios(this.diretorio);
        const relatorio: RelatorioInicializacao = { caudaReparada: this.repararCauda(), recuperadas: [], expurgados: [] };
        const atual = fs.existsSync(this.caminhoAtual) ? this.lerArquivo(this.caminhoAtual) : [];
        const ilegivel = atual.find(l => l.linha === null);
        if (ilegivel) {
            throw new ErroIntegridade(
                `Journal corrompido ou adulterado (${ilegivel.arquivo}, linha ${ilegivel.numero}). ` +
                "A inicialização foi interrompida para preservar a trilha de auditoria. Restaure o journal de um backup.");
        }
        this.ultimoHash = this.hashFinal(atual);
        const confirmadas = new Set(atual.flatMap(({ linha }) => linha?.tipo === "CONFIRMACAO" ? [linha.id] : []));
        for (const { linha } of atual) {
            if (linha?.tipo === "TRANSACAO" && !confirmadas.has(linha.transacao.id)) {
                this.aplicar(linha.transacao.dadosDepois);
                this.anexar({ tipo: "CONFIRMACAO", id: linha.transacao.id, timestamp: this.relogio.agora().toISOString(), recuperada: true });
                relatorio.recuperadas.push(linha.transacao.id);
            }
        }
        relatorio.expurgados = this.expurgarAntigos();
        return relatorio;
    }

    private repararCauda(): boolean {
        if (!fs.existsSync(this.caminhoAtual)) {
            return false;
        }
        const conteudo = fs.readFileSync(this.caminhoAtual);
        if (conteudo.length === 0 || conteudo[conteudo.length - 1] === 0x0a) {
            return false;
        }
        fs.truncateSync(this.caminhoAtual, conteudo.lastIndexOf(0x0a) + 1);
        return true;
    }

    private hashFinal(linhasAtual: LinhaLida[]): string {
        const ultima = linhasAtual[linhasAtual.length - 1];
        if (ultima?.hash) {
            return ultima.hash;
        }
        const maisRecente = this.arquivosRotacionados().pop();
        if (maisRecente) {
            return this.lerArquivo(path.join(this.diretorio, maisRecente)).pop()?.hash ?? HASH_GENESIS;
        }
        return HASH_GENESIS;
    }

    private rotacionarSeNecessario(): void {
        if (!fs.existsSync(this.caminhoAtual)) {
            return;
        }
        const tamanho = fs.statSync(this.caminhoAtual).size;
        if (tamanho <= this.tamanhoMaximoBytes) {
            return;
        }
        let instante = this.relogio.agora();
        let destino = path.join(this.diretorio, GerenciadorJournal.nomeRotacionado(instante));
        while (fs.existsSync(destino)) {
            instante = new Date(instante.getTime() + 1);
            destino = path.join(this.diretorio, GerenciadorJournal.nomeRotacionado(instante));
        }
        fs.renameSync(this.caminhoAtual, destino);
        this.anexarEvento("JOURNAL_ROTACAO", "sistema", { arquivoAnterior: path.basename(destino), tamanhoBytes: tamanho });
        this.expurgarAntigos();
    }

    private expurgarAntigos(): string[] {
        const dias = Math.max(RETENCAO_MINIMA_DIAS, this.retencaoDias());
        const limite = this.relogio.agora().getTime() - dias * MS_POR_DIA;
        const removidos: string[] = [];
        for (const nome of this.arquivosRotacionados()) {
            const data = GerenciadorJournal.dataDoNome(nome);
            if (!data || data.getTime() >= limite) {
                continue;
            }
            const caminho = path.join(this.diretorio, nome);
            const ultimoHash = this.lerArquivo(caminho).pop()?.hash ?? null;
            fs.rmSync(caminho, { force: true });
            this.anexarEvento("JOURNAL_EXPURGO", "sistema", { arquivo: nome, ultimoHash, retencaoDias: dias });
            removidos.push(nome);
        }
        return removidos;
    }

    private anexarEvento(operacao: string, usuario: string, detalhes: Record<string, unknown>): void {
        this.anexar({ tipo: "EVENTO", id: randomUUID(), timestamp: this.relogio.agora().toISOString(), operacao, usuario, detalhes });
    }

    public executar(transacao: JournalTransacao): void {
        if (this.inconsistente) {
            throw new ErroIntegridade(
                "Uma falha anterior de gravação deixou uma transação pendente. Reinicie o greencode para que ela seja recuperada pelo journal.");
        }
        this.rotacionarSeNecessario();
        this.anexar({ tipo: "TRANSACAO", transacao: GerenciadorJournal.serializar(transacao) });
        try {
            this.aplicar(transacao.dadosDepois);
        } catch (erro) {
            this.inconsistente = true;
            throw new ErroIntegridade(
                `Falha ao gravar a transação ${transacao.id} (${(erro as Error).message}). A operação está preservada no journal ` +
                "e será concluída automaticamente na próxima inicialização.");
        }
        this.anexar({ tipo: "CONFIRMACAO", id: transacao.id, timestamp: this.relogio.agora().toISOString(), recuperada: false });
    }

    public reverter(transacao: JournalTransacao): boolean {
        const depois = transacao.dadosDepois as Mudancas;
        for (const [arquivo, registros] of Object.entries(depois)) {
            for (const [id, valor] of Object.entries(registros)) {
                if (jsonEstavel(this.repositorio.carregarEntidade(arquivo, id)) !== jsonEstavel(valor)) {
                    return false;
                }
            }
        }
        new JournalTransacao({
            operacao: `REVERSAO ${transacao.id}`, entidade: transacao.entidade,
            dadosAntes: transacao.dadosDepois, dadosDepois: transacao.dadosAntes,
            usuarioResponsavel: this.usuarioAtual()
        }, this).registrar();
        return true;
    }

    public registrarEvento(operacao: string, usuario: string, detalhes: Record<string, unknown> = {}): void {
        this.rotacionarSeNecessario();
        this.anexarEvento(operacao, usuario, detalhes);
    }

    public listarRegistros(): RegistroJournal[] {
        const linhas = this.lerTudo();
        const confirmadas = new Set(linhas.flatMap(({ linha }) => linha?.tipo === "CONFIRMACAO" ? [linha.id] : []));
        const registros: RegistroJournal[] = [];
        for (const { linha } of linhas) {
            if (linha?.tipo === "TRANSACAO") {
                const t = linha.transacao;
                registros.push({
                    tipo: "TRANSACAO", id: t.id, timestamp: new Date(t.timestamp), operacao: t.operacao,
                    usuario: t.usuarioResponsavel, entidade: t.entidade,
                    situacao: confirmadas.has(t.id) ? "CONFIRMADA" : "PENDENTE",
                    afetados: Object.values(t.dadosDepois ?? {}).flatMap(r => Object.keys(r))
                });
            } else if (linha?.tipo === "EVENTO") {
                registros.push({
                    tipo: "EVENTO", id: linha.id, timestamp: new Date(linha.timestamp), operacao: linha.operacao,
                    usuario: linha.usuario, entidade: String(linha.detalhes["alvo"] ?? "-"), situacao: "EVENTO", afetados: []
                });
            }
        }
        return registros;
    }

    public obterTransacao(prefixo: string): JournalTransacao {
        const alvo = prefixo.trim().toLowerCase();
        if (alvo.length < 8) {
            throw new ErroValidacao("Informe ao menos os 8 primeiros caracteres do identificador da transação.");
        }
        const linhas = this.lerTudo();
        const confirmadas = new Set(linhas.flatMap(({ linha }) => linha?.tipo === "CONFIRMACAO" ? [linha.id] : []));
        const candidatas = linhas.flatMap(({ linha }) =>
            linha?.tipo === "TRANSACAO" && confirmadas.has(linha.transacao.id) && linha.transacao.id.startsWith(alvo)
                ? [linha.transacao] : []);
        if (candidatas.length === 0) {
            throw new ErroNaoEncontrado(`Transação confirmada "${prefixo}" não encontrada no journal.`);
        }
        if (candidatas.length > 1) {
            throw new ErroValidacao(`O prefixo "${prefixo}" corresponde a ${candidatas.length} transações; informe mais caracteres.`);
        }
        return this.desserializar(candidatas[0]!);
    }

    public verificarIntegridade(): ResultadoVerificacao {
        const arquivos = this.listarArquivos();
        const linhas = arquivos.flatMap(a => this.lerArquivo(a));
        const ancoras = new Set<string>([HASH_GENESIS]);
        for (const { linha } of linhas) {
            if (linha?.tipo === "EVENTO" && linha.operacao === "JOURNAL_EXPURGO" && typeof linha.detalhes["ultimoHash"] === "string") {
                ancoras.add(linha.detalhes["ultimoHash"]);
            }
        }
        const problemas: string[] = [];
        let anterior: string | null | undefined = undefined;
        let transacoes = 0;
        for (const lida of linhas) {
            const local = `${lida.arquivo}, linha ${lida.numero}`;
            if (lida.linha === null || lida.hash === null) {
                problemas.push(`${local}: conteúdo ilegível (adulterado ou corrompido).`);
                anterior = null;
                continue;
            }
            if (anterior === undefined) {
                if (!ancoras.has(lida.linha.hashAnterior)) {
                    problemas.push(`${local}: início da cadeia não corresponde a um expurgo registrado (arquivos antigos removidos indevidamente?).`);
                }
            } else if (anterior !== null && lida.linha.hashAnterior !== anterior) {
                problemas.push(`${local}: quebra no encadeamento de hashes (linha removida, inserida ou reordenada).`);
            }
            if (lida.linha.tipo === "CONFIRMACAO") {
                transacoes++;
            }
            anterior = lida.hash;
        }
        return { integro: problemas.length === 0, arquivos: arquivos.length, linhas: linhas.length, transacoes, problemas };
    }
}
