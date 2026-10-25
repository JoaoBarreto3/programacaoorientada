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

    constructor(prisma: PrismaClient, relogio: Relogio, emissor: EmissorToken, iteracoesSenha: number) {
        this.uow = new UnidadeDeTrabalho(prisma);
        this.autenticacao = new ServicoAutenticacao(this.uow, relogio, emissor, iteracoesSenha);
        this.usuarios = new ServicoUsuario(this.uow, relogio, iteracoesSenha);
        this.organizacoes = new ServicoOrganizacao(this.uow, relogio);
        this.lotes = new ServicoLote(this.uow, relogio);
        this.equipamentos = new ServicoEquipamento(this.uow, relogio);
        this.parametros = new ServicoParametros(this.uow, relogio);
        this.relatorios = new ServicoRelatorio(this.uow, relogio);
        this.auditoria = new ServicoAuditoria(this.uow, relogio);
    }
}
