import EstadoFisico from "../dominio/enums/EstadoFisico";
import { ErroValidacao } from "../comum/erros";
import { lerData } from "../comum/datas";
import { lerEnum } from "../comum/enums";

export function tokenizar(linha: string): string[] {
    const tokens: string[] = [];
    let atual = "";
    let aspas: string | null = null;
    let temToken = false;
    for (const c of linha) {
        if (aspas) {
            if (c === aspas) {
                aspas = null;
            } else {
                atual += c;
            }
        } else if (c === '"' || c === "'") {
            aspas = c;
            temToken = true;
        } else if (/\s/.test(c)) {
            if (temToken) {
                tokens.push(atual);
                atual = "";
                temToken = false;
            }
        } else {
            atual += c;
            temToken = true;
        }
    }
    if (aspas) {
        throw new ErroValidacao(`Aspas não fechadas (${aspas}).`);
    }
    if (temToken) {
        tokens.push(atual);
    }
    return tokens;
}

export interface OpcaoComando {
    nome: string;
    descricao: string;
    obrigatoria?: boolean;
    flag?: boolean;
    valores?: readonly string[];
}

export default class Argumentos {
    public readonly posicionais: string[] = [];
    private readonly opcoes = new Map<string, string | true>();

    constructor(tokens: string[], definicoes: readonly OpcaoComando[] = []) {
        const conhecidas = new Map(definicoes.map(d => [d.nome, d]));
        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i]!;
            if (!token.startsWith("--") || token === "--") {
                this.posicionais.push(token);
                continue;
            }
            const igual = token.indexOf("=");
            const nome = token.slice(2, igual > 0 ? igual : undefined).toLowerCase();
            const definicao = conhecidas.get(nome);
            if (!definicao) {
                const validas = [...conhecidas.keys()].map(n => "--" + n).join(", ") || "nenhuma";
                throw new ErroValidacao(`Opção desconhecida: --${nome}. Opções aceitas: ${validas}.`);
            }
            if (this.opcoes.has(nome)) {
                throw new ErroValidacao(`Opção --${nome} informada mais de uma vez.`);
            }
            if (definicao.flag) {
                this.opcoes.set(nome, true);
            } else if (igual > 0) {
                this.opcoes.set(nome, token.slice(igual + 1));
            } else {
                const valor = tokens[i + 1];
                if (valor === undefined || valor.startsWith("--")) {
                    throw new ErroValidacao(`A opção --${nome} exige um valor.`);
                }
                this.opcoes.set(nome, valor);
                i++;
            }
        }
        for (const d of definicoes) {
            if (d.obrigatoria && !this.opcoes.has(d.nome)) {
                throw new ErroValidacao(`Opção obrigatória ausente: --${d.nome} (${d.descricao}).`);
            }
        }
    }

    public texto(nome: string): string | undefined {
        const valor = this.opcoes.get(nome);
        return typeof valor === "string" ? valor : undefined;
    }

    public obrigatoria(nome: string): string {
        const valor = this.texto(nome);
        if (valor === undefined || valor.trim() === "") {
            throw new ErroValidacao(`Opção obrigatória ausente: --${nome}.`);
        }
        return valor;
    }

    public flag(nome: string): boolean {
        return this.opcoes.get(nome) === true;
    }

    public numero(nome: string): number | undefined {
        const valor = this.texto(nome);
        if (valor === undefined) {
            return undefined;
        }
        return Argumentos.converterNumero(valor, `--${nome}`);
    }

    public static converterNumero(valor: string, campo: string): number {
        const numero = Number(valor.replace(",", "."));
        if (valor.trim() === "" || !Number.isFinite(numero)) {
            throw new ErroValidacao(`Valor numérico inválido para ${campo}: "${valor}".`);
        }
        return numero;
    }

    public data(nome: string): Date | undefined {
        const valor = this.texto(nome);
        return valor === undefined ? undefined : lerData(valor);
    }

    public estado(nome: string): EstadoFisico | undefined {
        const valor = this.texto(nome);
        return valor === undefined ? undefined : lerEnum(EstadoFisico, valor, `--${nome}`);
    }

    public posicional(indice: number, descricao: string): string {
        const valor = this.posicionais[indice];
        if (valor === undefined) {
            throw new ErroValidacao(`Informe ${descricao}.`);
        }
        return valor;
    }
}
