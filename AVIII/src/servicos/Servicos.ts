import { PrismaClient } from "../infra/banco";
import UnidadeDeTrabalho from "../repositorios/UnidadeDeTrabalho";
import Relogio from "../comum/Relogio";
import ServicoAuditoria from "./ServicoAuditoria";
import ServicoAutenticacao, { EmissorToken } from "./ServicoAutenticacao";
import ServicoEquipamento from "./ServicoEquipamento";
import ServicoLote from "./ServicoLote";
import ServicoOrganizacao from "./ServicoOrganizacao";
import ServicoParametros from "./ServicoParametros";
import ServicoRelatorio from "./ServicoRelatorio";
import ServicoUsuario from "./ServicoUsuario";
import ServicoAnalise from "./ServicoAnalise";
import ServicoChaveApi from "./ServicoChaveApi";
import ServicoRelatorioAssincrono, { OpcoesRelatorios } from "./ServicoRelatorioAssincrono";
import FilaMemoria from "../infra/fila/FilaMemoria";
import { FilaTarefas, POLITICA_PADRAO } from "../infra/fila/FilaTarefas";

const OPCOES_RELATORIOS_PADRAO: OpcoesRelatorios = { retencaoHoras: 72, simultaneosPorUsuario: 5 };
const SEM_LOG = { log: { error: () => undefined, info: () => undefined } };

// Raiz de composição da camada de negócio: cria todos os serviços com as suas dependências.
export default class Servicos {
    public readonly uow: UnidadeDeTrabalho;
    public readonly autenticacao: ServicoAutenticacao;
    public readonly usuarios: ServicoUsuario;
    public readonly organizacoes: ServicoOrganizacao;
    public readonly lotes: ServicoLote;
    public readonly equipamentos: ServicoEquipamento;
    public readonly parametros: ServicoParametros;
    public readonly relatorios: ServicoRelatorio;
    public readonly auditoria: ServicoAuditoria;
    // AV3
    public readonly analises: ServicoAnalise;
    public readonly chavesApi: ServicoChaveApi;
    public readonly relatoriosAssincronos: ServicoRelatorioAssincrono;
    public readonly fila: FilaTarefas;

    // A fila é opcional para quem só usa a camada de negócio de forma síncrona (ex.: o seed).
    constructor(prisma: PrismaClient, relogio: Relogio, emissor: EmissorToken, iteracoesSenha: number,
        fila: FilaTarefas = new FilaMemoria(POLITICA_PADRAO, 1, SEM_LOG), opcoesRelatorios: OpcoesRelatorios = OPCOES_RELATORIOS_PADRAO) {
        this.uow = new UnidadeDeTrabalho(prisma);
        this.autenticacao = new ServicoAutenticacao(this.uow, relogio, emissor, iteracoesSenha);
        this.usuarios = new ServicoUsuario(this.uow, relogio, iteracoesSenha);
        this.organizacoes = new ServicoOrganizacao(this.uow, relogio);
        this.lotes = new ServicoLote(this.uow, relogio);
        this.equipamentos = new ServicoEquipamento(this.uow, relogio);
        this.parametros = new ServicoParametros(this.uow, relogio);
        this.relatorios = new ServicoRelatorio(this.uow, relogio);
        this.auditoria = new ServicoAuditoria(this.uow, relogio);
        this.fila = fila;
        this.analises = new ServicoAnalise(this.uow, relogio);
        // Módulo de chaves de API dentro do serviço de autenticação (atalho para os controllers).
        this.chavesApi = this.autenticacao.chavesApi;
        this.relatoriosAssincronos = new ServicoRelatorioAssincrono(this.uow, relogio, this.analises, fila, opcoesRelatorios);
    }
}
