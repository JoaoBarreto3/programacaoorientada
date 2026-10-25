import Equipamento, { DadosDescritivos } from "../dominio/Equipamento";
import EstadoFisico from "../dominio/enums/EstadoFisico";
import StatusRastreamento from "../dominio/enums/StatusRastreamento";
import TipoEquipamento from "../dominio/enums/TipoEquipamento";
import { gerarCodigoBarras } from "../dominio/codigoBarras";
import GeradorCodigos from "../repositorios/GeradorCodigos";

export interface DadosEquipamento extends Partial<DadosDescritivos> {
    tipo: TipoEquipamento;
    estadoFisico: EstadoFisico;
}

export default class FabricaEquipamento {
    // Valida e cria o equipamento com o código EQ-nnnnnn e o código de barras interno alocados.
    public async criar(dados: DadosEquipamento, codigos: GeradorCodigos, anoAtual: number): Promise<Equipamento> {
        const descritivos = Equipamento.validarDadosDescritivos(dados, anoAtual);
        const sequencia = await codigos.proximoEquipamento();
        return new Equipamento({
            ...descritivos, tipo: dados.tipo, estadoFisico: dados.estadoFisico,
            id: `EQ-${String(sequencia).padStart(6, "0")}`,
            codigoBarrasInterno: gerarCodigoBarras(dados.tipo, sequencia),
            loteId: "", posicaoNoLote: 0, statusRastreamento: StatusRastreamento.AGUARDANDO_TRIAGEM,
            historicoMovimentacao: [], versao: 1
        });
    }
}
