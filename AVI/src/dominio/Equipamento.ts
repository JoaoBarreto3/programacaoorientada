import Movimentacao from "./Movimentacao";
import ParametrosGlobais from "./ParametrosGlobais";
import EstadoFisico from "./enums/EstadoFisico";
import StatusRastreamento, { TRANSICOES_STATUS } from "./enums/StatusRastreamento";
import TipoEquipamento from "./enums/TipoEquipamento";
import { localizacaoAtual, nomeReservado } from "./rastreamento";
import Relogio, { RelogioSistema } from "../comum/Relogio";
import { ErroRegraNegocio, ErroValidacao } from "../comum/erros";

const DEPRECIACAO_MAXIMA_IDADE = 0.9;

const FATOR_ESTADO: Record<EstadoFisico, number> = {
    [EstadoFisico.NOVO]: 0,
    [EstadoFisico.BOM_ESTADO]: 0.05,
    [EstadoFisico.USADO_LEVE]: 0.10,
    [EstadoFisico.USADO_MODERADO]: 0.20,
    [EstadoFisico.DANIFICADO_LEVE]: 0.40,
    [EstadoFisico.DANIFICADO_GRAVE]: 0.70,
    [EstadoFisico.INSERVIVEL]: 0.95
};

export interface AmbienteEquipamento {
    relogio: Relogio;
    parametros: () => ParametrosGlobais;
}
//Jesus Cristo é Deus!
export default class Equipamento {
    public id: string;
    public codigoBarrasInterno: string;
    public tipo: TipoEquipamento;
    public marca: string;
    public modelo: string;
    public anoFabricacao: number;
    public estadoFisico: EstadoFisico;
    public pesoQuilogramas: number;
    public loteId: string;
    public posicaoNoLote: number;
    public statusRastreamento: StatusRastreamento;
    public historicoMovimentacao: Movimentacao[];
    private readonly ambiente: AmbienteEquipamento;

    constructor(dados: {
        id: string; codigoBarrasInterno: string; tipo: TipoEquipamento; marca: string; modelo: string;
        anoFabricacao: number; estadoFisico: EstadoFisico; pesoQuilogramas: number; loteId: string;
        posicaoNoLote: number; statusRastreamento: StatusRastreamento; historicoMovimentacao: Movimentacao[];
    }, ambiente: AmbienteEquipamento = { relogio: new RelogioSistema(), parametros: () => ParametrosGlobais.padrao() }) {
        this.id = dados.id;
        this.codigoBarrasInterno = dados.codigoBarrasInterno;
        this.tipo = dados.tipo;
        this.marca = dados.marca;
        this.modelo = dados.modelo;
        this.anoFabricacao = dados.anoFabricacao;
        this.estadoFisico = dados.estadoFisico;
        this.pesoQuilogramas = dados.pesoQuilogramas;
        this.loteId = dados.loteId;
        this.posicaoNoLote = dados.posicaoNoLote;
        this.statusRastreamento = dados.statusRastreamento;
        this.historicoMovimentacao = dados.historicoMovimentacao;
        this.ambiente = ambiente;
    }

    public atualizarStatus(novoStatus: StatusRastreamento, justificativa: string): void {
        const atual = this.statusRastreamento;
        if (novoStatus === atual) {
            throw new ErroRegraNegocio(`O equipamento ${this.id} já está com status ${atual}.`);
        }
        const permitidos = TRANSICOES_STATUS[atual];
        if (!permitidos.includes(novoStatus)) {
            const opcoes = permitidos.length ? permitidos.join(", ") : "nenhuma (status final)";
            throw new ErroRegraNegocio(`Transição inválida: ${atual} → ${novoStatus}. Permitidas: ${opcoes}.`);
        }
        this.statusRastreamento = novoStatus;
        this.historicoMovimentacao.push(new Movimentacao({
            equipamentoId: this.id, dataHora: this.ambiente.relogio.agora(), origem: atual, destino: novoStatus,
            responsavel: "", observacao: justificativa.trim()
        }));
    }

    public registrarMovimentacao(destino: string, responsavel: string): void {
        const local = destino.trim();
        if (local.length < 2) {
            throw new ErroValidacao("Informe o destino da movimentação.");
        }
        if (nomeReservado(local)) {
            throw new ErroValidacao(`"${local}" é um status/estado do sistema e não pode ser usado como nome de local.`);
        }
        if (this.statusRastreamento === StatusRastreamento.BAIXA_DEFINITIVA) {
            throw new ErroRegraNegocio(`O equipamento ${this.id} já recebeu baixa definitiva e não pode ser movimentado.`);
        }
        const origem = localizacaoAtual(this) ?? `Lote ${this.loteId}`;
        if (origem === local) {
            throw new ErroRegraNegocio(`O equipamento ${this.id} já está em "${local}".`);
        }
        this.historicoMovimentacao.push(new Movimentacao({
            equipamentoId: this.id, dataHora: this.ambiente.relogio.agora(), origem, destino: local,
            responsavel, observacao: ""
        }));
    }

    public calcularDepreciacao(): number {
        const parametros = this.ambiente.parametros();
        const idade = Math.max(0, this.ambiente.relogio.agora().getFullYear() - this.anoFabricacao);
        const porIdade = Math.min(DEPRECIACAO_MAXIMA_IDADE, idade * parametros.coeficientesDepreciacao[this.tipo]);
        return Math.min(1, porIdade + (1 - porIdade) * FATOR_ESTADO[this.estadoFisico]);
    }
}
