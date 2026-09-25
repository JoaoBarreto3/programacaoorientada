import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import Aplicacao from "../src/Aplicacao";
import CriptografiaArquivo from "../src/infra/CriptografiaArquivo";
import ConfiguracaoMestre from "../src/infra/ConfiguracaoMestre";
import { provisionarNucleo } from "../src/cli/Provisionamento";
import { RelogioFixo } from "../src/comum/Relogio";
import PapelUsuario from "../src/dominio/enums/PapelUsuario";
import EstadoFisico from "../src/dominio/enums/EstadoFisico";
import TipoEquipamento from "../src/dominio/enums/TipoEquipamento";
import Equipamento from "../src/dominio/Equipamento";
import Organizacao from "../src/dominio/Organizacao";
import Lote from "../src/dominio/Lote";
import { DadosEquipamento } from "../src/fabricas/FabricaEquipamento";

export const ITERACOES_TESTE = 1_000;
export const SENHA_ADMIN = "Verde#2026";
export const SENHA_PADRAO = "Coleta#2026";

export function diretorioTemporario(prefixo = "greencode-teste-"): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefixo));
}

export function removerDiretorio(diretorio: string): void {
    fs.rmSync(diretorio, { recursive: true, force: true });
}

export interface Ambiente {
    diretorio: string;
    relogio: RelogioFixo;
    app: Aplicacao;
    chave: string;
    reabrir(opcoes?: { tamanhoMaximoJournal?: number }): Aplicacao;
    entrar(usuario: string, senha?: string): void;
}

export function criarAmbiente(opcoes: { tamanhoMaximoJournal?: number; agora?: Date } = {}): Ambiente {
    const diretorio = diretorioTemporario();
    const relogio = new RelogioFixo(opcoes.agora ?? new Date(2026, 8, 25, 10, 0, 0));
    const base = { relogio, iteracoesSenha: ITERACOES_TESTE, tamanhoMaximoJournal: opcoes.tamanhoMaximoJournal };
    provisionarNucleo(diretorio, "admin", SENHA_ADMIN, base);
    const chave = ConfiguracaoMestre.carregar(diretorio, new CriptografiaArquivo()).chaveMestra;
    const reabrir = (extra: { tamanhoMaximoJournal?: number } = {}) => {
        const app = new Aplicacao(diretorio, chave, { ...base, ...extra });
        app.inicializar();
        return app;
    };
    const ambiente: Ambiente = {
        diretorio, relogio, chave, reabrir,
        app: reabrir(),
        entrar(usuario: string, senha?: string) {
            ambiente.app.autenticacao.login(usuario, senha ?? (usuario === "admin" ? SENHA_ADMIN : SENHA_PADRAO));
        }
    };
    ambiente.entrar("admin");
    return ambiente;
}

export function criarUsuario(amb: Ambiente, login: string, papel: PapelUsuario): void {
    amb.entrar("admin");
    amb.app.autenticacao.criarUsuario(login, SENHA_PADRAO, papel);
}

export function notebook(extra: Partial<DadosEquipamento> = {}): DadosEquipamento {
    return {
        tipo: TipoEquipamento.NOTEBOOK, marca: "Dell", modelo: "Latitude 5490", anoFabricacao: 2019,
        estadoFisico: EstadoFisico.BOM_ESTADO, pesoQuilogramas: 1.9, ...extra
    };
}

export function dadosOrganizacao(amb: Ambiente, cnpj = "11.222.333/0001-81") {
    const hoje = amb.relogio.agora();
    return {
        razaoSocial: "Banco Horizonte S.A.", cnpj, email: "ti@horizonte.com.br",
        enderecoCompleto: "Av. Paulista, 1000, São Paulo/SP",
        contrato: {
            dataAssinatura: hoje,
            dataVencimento: new Date(hoje.getFullYear() + 1, hoje.getMonth(), hoje.getDate()),
            clausulas: ["Coleta mensal"], valorMensal: 3000, renovacaoAutomatica: false
        }
    };
}

export function prepararLote(amb: Ambiente, cnpj = "11.222.333/0001-81", nf = "123456"): { org: Organizacao; lote: Lote } {
    const org = amb.app.organizacao.cadastrarOrganizacao(dadosOrganizacao(amb, cnpj));
    const lote = amb.app.lote.criarLote({ organizacaoId: org.id, notaFiscal: nf, transportadora: "TransRapida" });
    return { org, lote };
}

export function adicionar(amb: Ambiente, loteId: string, dados: DadosEquipamento = notebook()): Equipamento {
    const equipamento = amb.app.fabricaEquipamento.criar(dados);
    amb.app.lote.adicionarEquipamentoLote(loteId, equipamento);
    return equipamento;
}
