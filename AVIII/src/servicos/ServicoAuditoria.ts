import { UsuarioAutenticado } from "../dominio/Sessao";
import Permissao from "../dominio/enums/Permissao";
import UnidadeDeTrabalho from "../repositorios/UnidadeDeTrabalho";
import { FiltroAuditoria } from "../repositorios/RepositorioAuditoria";
import Relogio from "../comum/Relogio";
import { adicionarDias } from "../comum/datas";
import { ParametrosPaginacao } from "../comum/paginacao";
import { exigirPermissao } from "./autorizacao";

export default class ServicoAuditoria {
    constructor(private readonly uow: UnidadeDeTrabalho, private readonly relogio: Relogio) {}

    public async listar(autenticado: UsuarioAutenticado, filtro: FiltroAuditoria, paginacao: ParametrosPaginacao) {
        exigirPermissao(autenticado, Permissao.AUDITORIA_LER);
        return this.uow.leitura.auditoria.listar(filtro, paginacao);
    }

    // Política de retenção: remove apenas registros mais antigos que o prazo configurado
    // (mínimo de 180 dias, também imposto por trigger no banco).
    public async expurgar(autenticado: UsuarioAutenticado): Promise<{ removidos: number; limite: Date }> {
        exigirPermissao(autenticado, Permissao.AUDITORIA_EXPURGAR);
        return this.uow.executar(async repos => {
            const parametros = await repos.parametros.obter();
            const agora = this.relogio.agora();
            const limite = adicionarDias(agora, -parametros.retencaoAuditoriaDias);
            const removidos = await repos.auditoria.expurgarAnterioresA(limite);
            await repos.auditoria.registrar({
                operacao: "AUDITORIA_EXPURGAR", entidade: "Auditoria", entidadeId: "-", usuario: autenticado.login,
                dataHora: agora, depois: { removidos, limite: limite.toISOString(), retencaoDias: parametros.retencaoAuditoriaDias }
            });
            return { removidos, limite };
        });
    }
}
