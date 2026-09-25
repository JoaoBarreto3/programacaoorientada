import Argumentos, { OpcaoComando } from "./Argumentos";
import Saida from "./Saida";
import EntradaTerminal from "./EntradaTerminal";
import Aplicacao from "../Aplicacao";
import Sessao from "../dominio/Sessao";
import Permissao from "../dominio/enums/Permissao";

export interface ContextoComando {
    app: Aplicacao;
    sessao: Sessao;
    saida: Saida;
    entrada: EntradaTerminal;
    encerrarSessao(): void;
    encerrarPrograma(): void;
    exibirMenu(): void;
    exibirAjuda(nome?: string): void;
}

export interface PosicionalComando {
    nome: string;
    valores?: readonly string[];
}

export default interface Comando {
    nome: string;
    grupo: string;
    resumo: string;
    uso: string;
    exemplo?: string;
    permissao: Permissao | null;
    opcoes?: readonly OpcaoComando[];
    posicionais?: readonly PosicionalComando[];
    executar(args: Argumentos, ctx: ContextoComando): Promise<void> | void;
}
