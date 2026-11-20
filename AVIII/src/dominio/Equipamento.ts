import EntidadeVersionada from "./EntidadeVersionada";
import Movimentacao from "./Movimentacao";
import ParametrosGlobais from "./ParametrosGlobais";
import EstadoFisico, { degradacaoEstado } from "./enums/EstadoFisico";
import NaturezaMovimentacao from "./enums/NaturezaMovimentacao";
import StatusRastreamento, { TRANSICOES_STATUS } from "./enums/StatusRastreamento";
import TipoEquipamento from "./enums/TipoEquipamento";
import { ErroRegraNegocio, ErroValidacao } from "../comum/erros";

export const DEGRADACAO_EXIGE_JUSTIFICATIVA = 2;
export const TAMANHO_MINIMO_JUSTIFICATIVA = 10;
export const ANO_MINIMO_FABRICACAO = 1970;
export const PESO_MAXIMO_KG = 2000;
const DEPRECIACAO_MAXIMA_IDADE = 0.9;
export const LOCAL_RECEBIMENTO = "Almoxarifado - recebimento";

const FATOR_ESTADO: Record<EstadoFisico, number> = {
    [EstadoFisico.NOVO]: 0,
    [EstadoFisico.BOM_ESTADO]: 0.05,
    [EstadoFisico.USADO_LEVE]: 0.10,
    [EstadoFisico.USADO_MODERADO]: 0.20,
    [EstadoFisico.DANIFICADO_LEVE]: 0.40,
    [EstadoFisico.DANIFICADO_GRAVE]: 0.70,
    [EstadoFisico.INSERVIVEL]: 0.95
};

// Nomes que não podem ser usados como local (evita confundir local com status/estado).
const RESERVADOS = new Set<string>([...Object.values(StatusRastreamento), ...Object.values(EstadoFisico)]);

export interface DadosDescritivos {
    marca: string;
    modelo: string;
    anoFabricacao: number;
    pesoQuilogramas: number;
}

export default class Equipamento extends EntidadeVersionada {
    public readonly id: string;
    public readonly codigoBarrasInterno: string;
    public readonly tipo: TipoEquipamento;
    public marca: string;
    public modelo: string;
    public anoFabricacao: number;
    public estadoFisico: EstadoFisico;
    public pesoQuilogramas: number;
    public loteId: string;
    public posicaoNoLote: number;
    public statusRastreamento: StatusRastreamento;
    public historicoMovimentacao: Movimentacao[];
    // Movimentações criadas nesta operação e ainda não gravadas (o histórico é só-inclusão).
    private pendentes: Movimentacao[] = [];

    constructor(dados: DadosDescritivos & {
        id: string; codigoBarrasInterno: string; tipo: TipoEquipamento; estadoFisico: EstadoFisico; loteId: string;
        posicaoNoLote: number; statusRastreamento: StatusRastreamento; historicoMovimentacao: Movimentacao[]; versao: number;
    }) {
        super(dados.versao);
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
    }

    public static validarDadosDescritivos(dados: Partial<DadosDescritivos>, anoAtual: number): DadosDescritivos {
        const marca = (dados.marca ?? "").trim();
        const modelo = (dados.modelo ?? "").trim();
        if (marca.length < 2 || marca.length > 60) {
            throw new ErroValidacao("Marca deve ter de 2 a 60 caracteres.");
        }
        if (modelo.length < 1 || modelo.length > 80) {
            throw new ErroValidacao("Modelo deve ter de 1 a 80 caracteres.");
        }
        const ano = Number(dados.anoFabricacao);
        if (!Number.isInteger(ano) || ano < ANO_MINIMO_FABRICACAO || ano > anoAtual) {
            throw new ErroValidacao(`Ano de fabricação deve estar entre ${ANO_MINIMO_FABRICACAO} e ${anoAtual}.`);
        }
        const peso = Number(dados.pesoQuilogramas);
        if (!(peso > 0) || peso > PESO_MAXIMO_KG) {
            throw new ErroValidacao(`Peso deve ser maior que 0 e no máximo ${PESO_MAXIMO_KG} kg.`);
        }
        if (Math.abs(peso * 1000 - Math.round(peso * 1000)) > 1e-6) {
            throw new ErroValidacao("O peso aceita no máximo três casas decimais (gramas).");
        }
        return { marca, modelo, anoFabricacao: ano, pesoQuilogramas: peso };
    }

    public descricao(): string {
        return `O equipamento ${this.id}`;
    }

    public movimentacoesPendentes(): readonly Movimentacao[] {
        return this.pendentes;
    }

    public confirmarMovimentacoes(): void {
        this.pendentes = [];
    }

    private registrar(m: Omit<ConstructorParameters<typeof Movimentacao>[0], "equipamentoId">): void {
        const movimentacao = new Movimentacao({ ...m, equipamentoId: this.id });
        this.historicoMovimentacao.push(movimentacao);
        this.pendentes.push(movimentacao);
    }

    private exigirAtivo(): void {
        if (this.statusRastreamento === StatusRastreamento.BAIXA_DEFINITIVA) {
            throw new ErroRegraNegocio(`O equipamento ${this.id} já recebeu baixa definitiva.`);
        }
    }

    public atualizarStatus(novoStatus: StatusRastreamento, justificativa: string, responsavel: string, agora: Date): void {
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
        this.registrar({
            natureza: NaturezaMovimentacao.STATUS, dataHora: agora, origem: atual, destino: novoStatus,
            responsavel, observacao: justificativa.trim()
        });
    }

    // Regra da AV1: justificativa obrigatória quando o estado cai duas ou mais categorias.
    public atualizarEstadoFisico(novoEstado: EstadoFisico, justificativa: string, responsavel: string, agora: Date): void {
        this.exigirAtivo();
        const anterior = this.estadoFisico;
        if (novoEstado === anterior) {
            throw new ErroRegraNegocio(`O equipamento ${this.id} já está em ${anterior}.`);
        }
        const texto = justificativa.trim();
        const queda = degradacaoEstado(anterior, novoEstado);
        if (queda >= DEGRADACAO_EXIGE_JUSTIFICATIVA && texto.length < TAMANHO_MINIMO_JUSTIFICATIVA) {
            throw new ErroValidacao(`Justificativa obrigatória: o estado cai de ${anterior} para ${novoEstado} ` +
                `(${queda} categorias). Informe uma justificativa com ao menos ${TAMANHO_MINIMO_JUSTIFICATIVA} caracteres.`);
        }
        this.estadoFisico = novoEstado;
        this.registrar({
            natureza: NaturezaMovimentacao.ESTADO_FISICO, dataHora: agora, origem: anterior, destino: novoEstado,
            responsavel, observacao: texto
        });
    }

    // Primeira movimentação: chegada ao almoxarifado junto com o lote.
    public registrarRecebimento(origem: string, responsavel: string, agora: Date): void {
        this.registrar({
            natureza: NaturezaMovimentacao.LOCALIZACAO, dataHora: agora, origem, destino: LOCAL_RECEBIMENTO,
            responsavel, observacao: `Recebido no lote ${this.loteId}`
        });
    }

    public registrarMovimentacao(destino: string, responsavel: string, agora: Date, observacao: string = ""): void {
        const local = destino.trim();
        if (local.length < 2 || local.length > 120) {
            throw new ErroValidacao("O destino da movimentação deve ter de 2 a 120 caracteres.");
        }
        if (RESERVADOS.has(local.toUpperCase())) {
            throw new ErroValidacao(`"${local}" é um status/estado do sistema e não pode ser usado como nome de local.`);
        }
        this.exigirAtivo();
        const origem = this.localizacaoAtual() ?? `Lote ${this.loteId}`;
        if (origem === local) {
            throw new ErroRegraNegocio(`O equipamento ${this.id} já está em "${local}".`);
        }
        this.registrar({
            natureza: NaturezaMovimentacao.LOCALIZACAO, dataHora: agora, origem, destino: local,
            responsavel, observacao: observacao.trim()
        });
    }

    public localizacaoAtual(): string | null {
        const locais = this.historicoMovimentacao.filter(m => m.natureza === NaturezaMovimentacao.LOCALIZACAO);
        return locais[locais.length - 1]?.destino ?? null;
    }

    // Dados descritivos só podem ser corrigidos antes da triagem.
    public alterarDados(dados: Partial<DadosDescritivos>, anoAtual: number): void {
        if (this.statusRastreamento !== StatusRastreamento.AGUARDANDO_TRIAGEM) {
            throw new ErroRegraNegocio(`O equipamento ${this.id} já entrou em triagem; os dados descritivos não podem mais ser alterados.`);
        }
        Object.assign(this, Equipamento.validarDadosDescritivos({
            marca: dados.marca ?? this.marca, modelo: dados.modelo ?? this.modelo,
            anoFabricacao: dados.anoFabricacao ?? this.anoFabricacao, pesoQuilogramas: dados.pesoQuilogramas ?? this.pesoQuilogramas
        }, anoAtual));
    }

    // Fração de valor perdida (0 a 1): idade × coeficiente anual do tipo, mais o desgaste do estado físico.
    public calcularDepreciacao(parametros: ParametrosGlobais, anoReferencia: number): number {
        const idade = Math.max(0, anoReferencia - this.anoFabricacao);
        const porIdade = Math.min(DEPRECIACAO_MAXIMA_IDADE, idade * parametros.coeficientesDepreciacao[this.tipo]);
        return Math.min(1, porIdade + (1 - porIdade) * FATOR_ESTADO[this.estadoFisico]);
    }

    public calcularValorResidual(parametros: ParametrosGlobais, anoReferencia: number): number {
        return parametros.valoresReferencia[this.tipo] * (1 - this.calcularDepreciacao(parametros, anoReferencia));
    }

    public paraJSON() {
        return {
            id: this.id, codigoBarrasInterno: this.codigoBarrasInterno, tipo: this.tipo, marca: this.marca,
            modelo: this.modelo, anoFabricacao: this.anoFabricacao, estadoFisico: this.estadoFisico,
            pesoQuilogramas: this.pesoQuilogramas, loteId: this.loteId, posicaoNoLote: this.posicaoNoLote,
            statusRastreamento: this.statusRastreamento, localizacaoAtual: this.localizacaoAtual(), versao: this.versao
        };
    }
}
