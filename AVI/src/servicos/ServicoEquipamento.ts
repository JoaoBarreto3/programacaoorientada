import Equipamento from "../dominio/Equipamento";
import Movimentacao from "../dominio/Movimentacao";
import HistoricoCompleto from "../dominio/HistoricoCompleto";
import EstadoFisico, { degradacaoEstado } from "../dominio/enums/EstadoFisico";
import Permissao from "../dominio/enums/Permissao";
import StatusLote from "../dominio/enums/StatusLote";
import StatusRastreamento, { STATUS_DESMONTE } from "../dominio/enums/StatusRastreamento";
import TipoEquipamento, { CODIGO_TIPO } from "../dominio/enums/TipoEquipamento";
import FabricaEquipamento from "../fabricas/FabricaEquipamento";
import FabricaLote from "../fabricas/FabricaLote";
import FabricaOrganizacao from "../fabricas/FabricaOrganizacao";
import Ambiente from "../fabricas/Ambiente";
import ValidadorCNPJ from "../validacao/ValidadorCNPJ";
import RepositorioArquivo from "../infra/RepositorioArquivo";
import GerenciadorJournal from "../infra/GerenciadorJournal";
import JournalTransacao from "../infra/JournalTransacao";
import RegistroMudancas from "../infra/RegistroMudancas";
import Arquivos from "../infra/Arquivos";
import { ErroRegraNegocio, ErroValidacao } from "../comum/erros";
import ContextoSessao from "./ContextoSessao";

export const DEGRADACAO_EXIGE_JUSTIFICATIVA = 2;
export const TAMANHO_MINIMO_JUSTIFICATIVA = 10;
const LOTE_COM_TRIAGEM_COMPLETA = new Set([StatusLote.TRIAGEM_CONCLUIDA, StatusLote.ENCAMINHADO, StatusLote.FINALIZADO]);

export function digitoVerificador(numero: string): number {
    let soma = 0;
    for (let i = 0; i < numero.length; i++) {
        soma += Number(numero[i]) * ((numero.length - i) % 2 === 1 ? 3 : 1);
    }
    return (10 - (soma % 10)) % 10;
}

export function codigoBarrasValido(codigo: string): boolean {
    const m = /^GC[A-Z]{3}(\d{7})(\d)$/.exec(codigo);
    return !!m && digitoVerificador(m[1]!) === Number(m[2]);
}

export default class ServicoEquipamento {
    public repositorio: RepositorioArquivo;
    private readonly diario: GerenciadorJournal;
    private readonly contexto: ContextoSessao;
    private readonly fabricaEquipamento: FabricaEquipamento;
    private readonly fabricaLote: FabricaLote;
    private readonly fabricaOrganizacao: FabricaOrganizacao;
    private readonly ambiente: Ambiente;

    constructor(repositorio: RepositorioArquivo, diario: GerenciadorJournal, contexto: ContextoSessao, ambiente: Ambiente) {
        this.repositorio = repositorio;
        this.diario = diario;
        this.contexto = contexto;
        this.ambiente = ambiente;
        this.fabricaEquipamento = new FabricaEquipamento(repositorio, ambiente, this);
        this.fabricaLote = new FabricaLote(repositorio, ambiente, this.fabricaEquipamento);
        this.fabricaOrganizacao = new FabricaOrganizacao(repositorio, ambiente, new ValidadorCNPJ());
    }

    public rastrearEquipamento(id: string): HistoricoCompleto {
        this.contexto.exigir(Permissao.EQUIPAMENTOS_LER);
        const equipamento = this.fabricaEquipamento.carregar(id);
        const lote = this.fabricaLote.carregar(equipamento.loteId);
        const organizacao = this.fabricaOrganizacao.carregar(lote.organizacaoId);
        const auditoria = this.diario.listarRegistros()
            .filter(r => r.tipo === "TRANSACAO" && r.situacao === "CONFIRMADA" && r.afetados.includes(equipamento.id))
            .map(r => ({ transacao: r.id, timestamp: r.timestamp, operacao: r.operacao, usuario: r.usuario }));
        const depreciacao = equipamento.calcularDepreciacao();
        return {
            equipamento, lote, organizacao, auditoria, depreciacao,
            movimentacoes: [...equipamento.historicoMovimentacao],
            valorResidual: this.ambiente.parametros().valoresReferencia[equipamento.tipo] * (1 - depreciacao)
        };
    }

    public atualizarEstadoFisico(id: string, novoEstado: EstadoFisico): void {
        this.atualizarEstadoFisicoJustificado(id, novoEstado, "");
    }

    public gerarCodigoBarras(tipo: TipoEquipamento, sequencia: number): string {
        const numero = String(sequencia).padStart(7, "0");
        return `GC${CODIGO_TIPO[tipo]}${numero}${digitoVerificador(numero)}`;
    }

    public atualizarEstadoFisicoJustificado(id: string, novoEstado: EstadoFisico, justificativa: string): void {
        const sessao = this.contexto.exigir(Permissao.EQUIPAMENTOS_ESCREVER);
        const equipamento = this.fabricaEquipamento.carregar(id);
        const anterior = equipamento.estadoFisico;
        if (equipamento.statusRastreamento === StatusRastreamento.BAIXA_DEFINITIVA) {
            throw new ErroRegraNegocio(`O equipamento ${equipamento.id} já recebeu baixa definitiva.`);
        }
        if (novoEstado === anterior) {
            throw new ErroRegraNegocio(`O equipamento ${equipamento.id} já está em ${anterior}.`);
        }
        const texto = justificativa.trim();
        const queda = degradacaoEstado(anterior, novoEstado);
        if (queda >= DEGRADACAO_EXIGE_JUSTIFICATIVA && texto.length < TAMANHO_MINIMO_JUSTIFICATIVA) {
            throw new ErroValidacao(`Justificativa obrigatória: o estado cai de ${anterior} para ${novoEstado} ` +
                `(${queda} categorias). Informe --justificativa com ao menos ${TAMANHO_MINIMO_JUSTIFICATIVA} caracteres.`);
        }
        equipamento.estadoFisico = novoEstado;
        equipamento.historicoMovimentacao.push(new Movimentacao({
            equipamentoId: equipamento.id, dataHora: this.ambiente.relogio.agora(), origem: anterior, destino: novoEstado,
            responsavel: sessao.usuario, observacao: texto
        }));
        this.confirmar("EQUIPAMENTO_ESTADO", equipamento, null, sessao.usuario);
    }

    public atualizarStatus(id: string, novoStatus: StatusRastreamento, justificativa: string): void {
        const sessao = this.contexto.exigir(Permissao.EQUIPAMENTOS_ESCREVER);
        const equipamento = this.fabricaEquipamento.carregar(id);
        const lote = this.fabricaLote.carregar(equipamento.loteId);
        if (STATUS_DESMONTE.has(novoStatus) && !LOTE_COM_TRIAGEM_COMPLETA.has(lote.statusProcessamento)) {
            throw new ErroRegraNegocio(`O equipamento ${equipamento.id} só pode ir para ${novoStatus} após a triagem completa ` +
                `(lote ${lote.id} está em ${lote.statusProcessamento}).`);
        }
        if (!LOTE_COM_TRIAGEM_COMPLETA.has(lote.statusProcessamento)) {
            throw new ErroRegraNegocio(`O lote ${lote.id} está em ${lote.statusProcessamento}: ` +
                `conclua a triagem com "lote triagem ${lote.id}" antes de encaminhar os equipamentos.`);
        }
        equipamento.atualizarStatus(novoStatus, justificativa);
        this.carimbarResponsavel(equipamento, sessao.usuario);
        lote.equipamentos = lote.equipamentos.map(e => e.id === equipamento.id ? equipamento : e);
        if (lote.equipamentos.every(e => e.statusRastreamento === StatusRastreamento.BAIXA_DEFINITIVA)) {
            lote.statusProcessamento = StatusLote.FINALIZADO;
        } else if (lote.equipamentos.every(e => e.statusRastreamento !== StatusRastreamento.EM_TRIAGEM)) {
            lote.statusProcessamento = StatusLote.ENCAMINHADO;
        }
        this.confirmar("EQUIPAMENTO_STATUS", equipamento, lote, sessao.usuario);
    }

    public registrarMovimentacao(id: string, destino: string): void {
        const sessao = this.contexto.exigir(Permissao.EQUIPAMENTOS_ESCREVER);
        const equipamento = this.fabricaEquipamento.carregar(id);
        equipamento.registrarMovimentacao(destino, sessao.usuario);
        this.confirmar("EQUIPAMENTO_MOVIMENTAR", equipamento, null, sessao.usuario);
    }

    private carimbarResponsavel(equipamento: Equipamento, usuario: string): void {
        for (const m of equipamento.historicoMovimentacao) {
            if (!m.responsavel) m.responsavel = usuario;
        }
    }

    private confirmar(operacao: string, equipamento: Equipamento, lote: ReturnType<FabricaLote["carregar"]> | null, usuario: string): void {
        const mudancas = new RegistroMudancas(this.repositorio);
        mudancas.salvar(Arquivos.EQUIPAMENTOS, this.fabricaEquipamento.paraRegistro(equipamento));
        for (const m of equipamento.historicoMovimentacao) {
            if (!this.repositorio.carregarEntidade(Arquivos.MOVIMENTACOES, m.id)) {
                mudancas.salvar(Arquivos.MOVIMENTACOES, this.fabricaEquipamento.movimentacaoParaRegistro(m));
            }
        }
        if (lote) {
            mudancas.salvar(Arquivos.LOTES, this.fabricaLote.paraRegistro(lote));
        }
        new JournalTransacao({
            operacao, entidade: `Equipamento ${equipamento.id}`, usuarioResponsavel: usuario,
            dadosAntes: mudancas.antes, dadosDepois: mudancas.depois
        }, this.diario).registrar();
    }
}
