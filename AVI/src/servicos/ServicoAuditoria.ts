import Permissao from "../dominio/enums/Permissao";
import GerenciadorJournal, { RegistroJournal, ResultadoVerificacao } from "../infra/GerenciadorJournal";
import ContextoSessao from "./ContextoSessao";

export interface FiltroAuditoria {
    usuario?: string;
    entidade?: string;
    operacao?: string;
    limite?: number;
}

export default class ServicoAuditoria {
    private readonly diario: GerenciadorJournal;
    private readonly contexto: ContextoSessao;

    constructor(diario: GerenciadorJournal, contexto: ContextoSessao) {
        this.diario = diario;
        this.contexto = contexto;
    }

    public listar(filtro: FiltroAuditoria = {}): RegistroJournal[] {
        this.contexto.exigir(Permissao.JOURNAL_LER);
        const alvo = filtro.entidade?.toUpperCase();
        return this.diario.listarRegistros().filter(r =>
            (!filtro.usuario || r.usuario === filtro.usuario) &&
            (!alvo || r.entidade.toUpperCase().includes(alvo) || r.afetados.some(a => a.toUpperCase() === alvo)) &&
            (!filtro.operacao || r.operacao.toUpperCase().includes(filtro.operacao.toUpperCase()))
        ).slice(-(filtro.limite ?? 50));
    }

    public verificar(): ResultadoVerificacao {
        this.contexto.exigir(Permissao.JOURNAL_LER);
        return this.diario.verificarIntegridade();
    }

    public reverter(transacao: string): boolean {
        this.contexto.exigir(Permissao.JOURNAL_REVERTER);
        return this.diario.obterTransacao(transacao).reverter();
    }
}
