import { ClienteBanco } from "../infra/banco";
import GeradorCodigos from "./GeradorCodigos";
import RepositorioAuditoria from "./RepositorioAuditoria";
import RepositorioEquipamento from "./RepositorioEquipamento";
import RepositorioIndicadores from "./RepositorioIndicadores";
import RepositorioLote from "./RepositorioLote";
import RepositorioOrganizacao from "./RepositorioOrganizacao";
import RepositorioParametros from "./RepositorioParametros";
import RepositorioUsuario from "./RepositorioUsuario";

// Conjunto de repositórios ligados ao mesmo cliente de banco: o cliente principal (leituras)
// ou o cliente de uma transação (escritas), de modo que tudo o que um serviço grava numa
// operação participa da mesma transação.
export default class Repositorios {
    public readonly usuarios: RepositorioUsuario;
    public readonly organizacoes: RepositorioOrganizacao;
    public readonly lotes: RepositorioLote;
    public readonly equipamentos: RepositorioEquipamento;
    public readonly parametros: RepositorioParametros;
    public readonly auditoria: RepositorioAuditoria;
    public readonly codigos: GeradorCodigos;
    public readonly indicadores: RepositorioIndicadores;

    constructor(db: ClienteBanco) {
        this.usuarios = new RepositorioUsuario(db);
        this.organizacoes = new RepositorioOrganizacao(db);
        this.lotes = new RepositorioLote(db);
        this.equipamentos = new RepositorioEquipamento(db);
        this.parametros = new RepositorioParametros(db);
        this.auditoria = new RepositorioAuditoria(db);
        this.codigos = new GeradorCodigos(db);
        this.indicadores = new RepositorioIndicadores(db);
    }
}
