import Equipamento from "../dominio/Equipamento";
import Movimentacao from "../dominio/Movimentacao";
import EstadoFisico from "../dominio/enums/EstadoFisico";
import StatusRastreamento from "../dominio/enums/StatusRastreamento";
import TipoEquipamento from "../dominio/enums/TipoEquipamento";
import RepositorioArquivo from "../infra/RepositorioArquivo";
import Arquivos from "../infra/Arquivos";
import Ambiente, { proximoNumero } from "./Ambiente";
import { ErroNaoEncontrado, ErroValidacao } from "../comum/erros";

export interface DadosEquipamento {
    tipo: TipoEquipamento;
    marca: string;
    modelo: string;
    anoFabricacao: number;
    estadoFisico: EstadoFisico;
    pesoQuilogramas: number;
}

type RegistroEquipamento = {
    id: string; codigoBarrasInterno: string; tipo: TipoEquipamento; marca: string; modelo: string;
    anoFabricacao: number; estadoFisico: EstadoFisico; pesoQuilogramas: number; loteId: string;
    posicaoNoLote: number; statusRastreamento: StatusRastreamento;
};

type RegistroMovimentacao = {
    id: string; equipamentoId: string; dataHora: string; origem: string; destino: string;
    responsavel: string; observacao: string;
};

const ANO_MINIMO = 1970;

export interface GeradorCodigoBarras {
    gerarCodigoBarras(tipo: TipoEquipamento, sequencia: number): string;
}

export default class FabricaEquipamento {
    private readonly repositorio: RepositorioArquivo;
    private readonly ambiente: Ambiente;
    private readonly gerador: GeradorCodigoBarras;

    constructor(repositorio: RepositorioArquivo, ambiente: Ambiente, gerador: GeradorCodigoBarras) {
        this.repositorio = repositorio;
        this.ambiente = ambiente;
        this.gerador = gerador;
    }

    public criar(dados: DadosEquipamento): Equipamento {
        const marca = (dados.marca ?? "").trim();
        const modelo = (dados.modelo ?? "").trim();
        const ano = this.ambiente.relogio.agora().getFullYear();
        if (marca.length < 2 || modelo.length < 1) {
            throw new ErroValidacao("Informe marca (mín. 2 caracteres) e modelo do equipamento.");
        }
        if (!Number.isInteger(dados.anoFabricacao) || dados.anoFabricacao < ANO_MINIMO || dados.anoFabricacao > ano) {
            throw new ErroValidacao(`Ano de fabricação deve estar entre ${ANO_MINIMO} e ${ano}.`);
        }
        if (!(dados.pesoQuilogramas > 0) || dados.pesoQuilogramas > 2000) {
            throw new ErroValidacao("Peso deve ser maior que 0 e no máximo 2000 kg.");
        }
        const sequencia = proximoNumero(this.repositorio.listarEntidades(Arquivos.EQUIPAMENTOS).map(e => e.id), /^EQ-(\d+)$/);
        return new Equipamento({
            ...dados, marca, modelo,
            id: `EQ-${String(sequencia).padStart(6, "0")}`,
            codigoBarrasInterno: this.gerador.gerarCodigoBarras(dados.tipo, sequencia),
            loteId: "", posicaoNoLote: 0,
            statusRastreamento: StatusRastreamento.AGUARDANDO_TRIAGEM,
            historicoMovimentacao: []
        }, this.ambiente);
    }

    public paraRegistro(e: Equipamento): RegistroEquipamento {
        return {
            id: e.id, codigoBarrasInterno: e.codigoBarrasInterno, tipo: e.tipo, marca: e.marca, modelo: e.modelo,
            anoFabricacao: e.anoFabricacao, estadoFisico: e.estadoFisico, pesoQuilogramas: e.pesoQuilogramas,
            loteId: e.loteId, posicaoNoLote: e.posicaoNoLote, statusRastreamento: e.statusRastreamento
        };
    }

    public movimentacaoParaRegistro(m: Movimentacao): RegistroMovimentacao {
        return {
            id: m.id, equipamentoId: m.equipamentoId, dataHora: m.dataHora.toISOString(),
            origem: m.origem, destino: m.destino, responsavel: m.responsavel, observacao: m.observacao
        };
    }

    private montar(r: RegistroEquipamento, movimentacoes: RegistroMovimentacao[]): Equipamento {
        return new Equipamento({
            ...r,
            historicoMovimentacao: movimentacoes
                .map(m => new Movimentacao({ ...m, dataHora: new Date(m.dataHora) }))
                .sort((a, b) => a.dataHora.getTime() - b.dataHora.getTime())
        }, this.ambiente);
    }

    private movimentacoesPorEquipamento(): Map<string, RegistroMovimentacao[]> {
        const mapa = new Map<string, RegistroMovimentacao[]>();
        for (const m of this.repositorio.listarEntidades(Arquivos.MOVIMENTACOES) as RegistroMovimentacao[]) {
            mapa.set(m.equipamentoId, [...(mapa.get(m.equipamentoId) ?? []), m]);
        }
        return mapa;
    }

    public carregar(idOuCodigo: string): Equipamento {
        const chave = idOuCodigo.trim().toUpperCase();
        const registro = (this.repositorio.carregarEntidade(Arquivos.EQUIPAMENTOS, chave) as RegistroEquipamento | null)
            ?? (this.repositorio.listarEntidades(Arquivos.EQUIPAMENTOS) as RegistroEquipamento[]).find(e => e.codigoBarrasInterno === chave);
        if (!registro) {
            throw new ErroNaoEncontrado(`Equipamento "${idOuCodigo}" não encontrado (use o ID ou o código de barras).`);
        }
        return this.montar(registro, this.movimentacoesPorEquipamento().get(registro.id) ?? []);
    }

    public listarDoLote(loteId: string): Equipamento[] {
        const movs = this.movimentacoesPorEquipamento();
        return (this.repositorio.listarEntidades(Arquivos.EQUIPAMENTOS) as RegistroEquipamento[])
            .filter(e => e.loteId === loteId)
            .map(e => this.montar(e, movs.get(e.id) ?? []))
            .sort((a, b) => a.posicaoNoLote - b.posicaoNoLote);
    }
}
