import EntidadeVersionada from "./EntidadeVersionada";
import Equipamento from "./Equipamento";
import EstadoFisico from "./enums/EstadoFisico";
import StatusLote, { LOTE_COM_TRIAGEM_COMPLETA } from "./enums/StatusLote";
import StatusRastreamento, { STATUS_DESMONTE } from "./enums/StatusRastreamento";
import ValidadorNotaFiscal from "../validacao/ValidadorNotaFiscal";
import { exigirValido } from "../validacao/Validador";
import { ErroRegraNegocio, ErroValidacao } from "../comum/erros";

export interface DadosLoteEditaveis {
    notaFiscal: string;
    transportadora: string;
    observacoes: string;
}

export type ResultadoTriagem = "INICIADA" | "CONCLUIDA";

// Lote é a raiz do agregado Lote → Equipamentos: alterações de status dos equipamentos passam
// por ele, porque dependem da situação do lote (triagem completa) e a alteram (encaminhado/finalizado).
export default class Lote extends EntidadeVersionada {
    public readonly id: string;
    public dataEntrada: Date;
    public readonly organizacaoId: string;
    public notaFiscal: string;
    public transportadora: string;
    public equipamentos: Equipamento[];
    public statusProcessamento: StatusLote;
    public observacoes: string;

    constructor(dados: DadosLoteEditaveis & {
        id: string; dataEntrada: Date; organizacaoId: string; equipamentos: Equipamento[];
        statusProcessamento: StatusLote; versao: number;
    }) {
        super(dados.versao);
        this.id = dados.id;
        this.dataEntrada = dados.dataEntrada;
        this.organizacaoId = dados.organizacaoId;
        this.notaFiscal = dados.notaFiscal;
        this.transportadora = dados.transportadora;
        this.equipamentos = dados.equipamentos;
        this.statusProcessamento = dados.statusProcessamento;
        this.observacoes = dados.observacoes;
    }

    public static validarDadosEditaveis(dados: Partial<DadosLoteEditaveis>): DadosLoteEditaveis {
        const notaFiscal = String(dados.notaFiscal ?? "").trim();
        exigirValido(new ValidadorNotaFiscal(), notaFiscal);
        const transportadora = (dados.transportadora ?? "").trim();
        if (transportadora.length < 2 || transportadora.length > 100) {
            throw new ErroValidacao("Informe a transportadora responsável pela coleta (2 a 100 caracteres).");
        }
        const observacoes = (dados.observacoes ?? "").trim();
        if (observacoes.length > 1000) {
            throw new ErroValidacao("Observações: máximo de 1000 caracteres.");
        }
        return { notaFiscal: String(Number(notaFiscal)), transportadora, observacoes };
    }

    public descricao(): string {
        return `O lote ${this.id}`;
    }

    private exigirRecebido(acao: string): void {
        if (this.statusProcessamento !== StatusLote.RECEBIDO) {
            throw new ErroRegraNegocio(`O lote ${this.id} está em ${this.statusProcessamento}; ${acao} só é possível em lotes RECEBIDOS.`);
        }
    }

    public adicionarEquipamento(equip: Equipamento): void {
        this.exigirRecebido("incluir equipamentos");
        if (this.equipamentos.some(e => e.id === equip.id)) {
            throw new ErroRegraNegocio(`O equipamento ${equip.id} já pertence ao lote ${this.id}.`);
        }
        equip.loteId = this.id;
        equip.posicaoNoLote = this.equipamentos.length + 1;
        this.equipamentos.push(equip);
    }

    // Retorna os equipamentos cuja posição mudou (precisam ser regravados).
    public removerEquipamento(equipId: string): Equipamento[] {
        this.exigirRecebido("remover equipamentos");
        const indice = this.equipamentos.findIndex(e => e.id === equipId);
        if (indice < 0) {
            throw new ErroRegraNegocio(`O equipamento ${equipId} não pertence ao lote ${this.id}.`);
        }
        if (this.equipamentos.length === 1) {
            throw new ErroRegraNegocio(`O lote ${this.id} deve conter ao menos um equipamento; exclua o lote inteiro se necessário.`);
        }
        this.equipamentos.splice(indice, 1);
        const reposicionados: Equipamento[] = [];
        this.equipamentos.forEach((e, i) => {
            if (e.posicaoNoLote !== i + 1) {
                e.posicaoNoLote = i + 1;
                reposicionados.push(e);
            }
        });
        return reposicionados;
    }

    public alterarDados(dados: DadosLoteEditaveis, dataEntrada: Date): void {
        this.exigirRecebido("alterar os dados do lote");
        Object.assign(this, Lote.validarDadosEditaveis(dados));
        this.dataEntrada = dataEntrada;
    }

    public exigirExcluivel(): void {
        this.exigirRecebido("excluir o lote");
    }

    public calcularPesoTotal(): number {
        return Math.round(this.equipamentos.reduce((soma, e) => soma + e.pesoQuilogramas, 0) * 1000) / 1000;
    }

    public triagemCompleta(): boolean {
        return LOTE_COM_TRIAGEM_COMPLETA.has(this.statusProcessamento);
    }

    // Primeira chamada: RECEBIDO → EM_TRIAGEM (equipamentos entram em triagem).
    // Segunda chamada: EM_TRIAGEM → TRIAGEM_CONCLUIDA (libera o desmonte).
    public avancarTriagem(responsavel: string, agora: Date): ResultadoTriagem {
        if (this.statusProcessamento === StatusLote.RECEBIDO) {
            if (this.equipamentos.length === 0) {
                throw new ErroRegraNegocio(`O lote ${this.id} não possui equipamentos para triagem.`);
            }
            for (const equipamento of this.equipamentos) {
                equipamento.atualizarStatus(StatusRastreamento.EM_TRIAGEM, `Início da triagem do lote ${this.id}`, responsavel, agora);
            }
            this.statusProcessamento = StatusLote.EM_TRIAGEM;
            return "INICIADA";
        }
        if (this.statusProcessamento === StatusLote.EM_TRIAGEM) {
            this.statusProcessamento = StatusLote.TRIAGEM_CONCLUIDA;
            return "CONCLUIDA";
        }
        throw new ErroRegraNegocio(`A triagem do lote ${this.id} já foi concluída (status ${this.statusProcessamento}).`);
    }

    // Regra da AV1: o equipamento só segue para desmonte (ou qualquer destino) após a triagem completa.
    public atualizarStatusEquipamento(equipamento: Equipamento, novoStatus: StatusRastreamento, justificativa: string,
        responsavel: string, agora: Date): void {
        if (!this.triagemCompleta()) {
            const motivo = STATUS_DESMONTE.has(novoStatus) ? `só pode ir para ${novoStatus} após a triagem completa` : "não pode ser encaminhado antes da triagem completa";
            throw new ErroRegraNegocio(`O equipamento ${equipamento.id} ${motivo} (lote ${this.id} está em ${this.statusProcessamento}).`);
        }
        equipamento.atualizarStatus(novoStatus, justificativa, responsavel, agora);
        this.equipamentos = this.equipamentos.map(e => e.id === equipamento.id ? equipamento : e);
        if (this.equipamentos.every(e => e.statusRastreamento === StatusRastreamento.BAIXA_DEFINITIVA)) {
            this.statusProcessamento = StatusLote.FINALIZADO;
        } else if (this.equipamentos.every(e => e.statusRastreamento !== StatusRastreamento.EM_TRIAGEM)) {
            this.statusProcessamento = StatusLote.ENCAMINHADO;
        }
    }

    public gerarRelatorioTriagem() {
        const porEstado: Partial<Record<EstadoFisico, number>> = {};
        for (const e of this.equipamentos) {
            porEstado[e.estadoFisico] = (porEstado[e.estadoFisico] ?? 0) + 1;
        }
        return {
            loteId: this.id, statusProcessamento: this.statusProcessamento, organizacaoId: this.organizacaoId,
            notaFiscal: this.notaFiscal, dataEntrada: this.dataEntrada.toISOString().slice(0, 10),
            quantidadeEquipamentos: this.equipamentos.length, pesoTotalKg: this.calcularPesoTotal(),
            porEstadoFisico: porEstado,
            equipamentos: this.equipamentos.map(e => ({
                posicao: e.posicaoNoLote, id: e.id, codigoBarrasInterno: e.codigoBarrasInterno, tipo: e.tipo,
                estadoFisico: e.estadoFisico, statusRastreamento: e.statusRastreamento
            }))
        };
    }

    public paraJSON(incluirEquipamentos: boolean = true) {
        return {
            id: this.id, dataEntrada: this.dataEntrada.toISOString().slice(0, 10), organizacaoId: this.organizacaoId,
            notaFiscal: this.notaFiscal, transportadora: this.transportadora, statusProcessamento: this.statusProcessamento,
            observacoes: this.observacoes, quantidadeEquipamentos: this.equipamentos.length,
            pesoTotalKg: this.calcularPesoTotal(), versao: this.versao,
            ...(incluirEquipamentos ? { equipamentos: this.equipamentos.map(e => e.paraJSON()) } : {})
        };
    }
}
