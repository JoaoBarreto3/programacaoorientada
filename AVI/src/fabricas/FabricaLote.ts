import Lote from "../dominio/Lote";
import StatusLote from "../dominio/enums/StatusLote";
import FabricaEquipamento from "./FabricaEquipamento";
import ValidadorDataEntrada from "../validacao/ValidadorDataEntrada";
import ValidadorNotaFiscal from "../validacao/ValidadorNotaFiscal";
import { exigirValido } from "../validacao/Validador";
import RepositorioArquivo from "../infra/RepositorioArquivo";
import Arquivos from "../infra/Arquivos";
import Ambiente, { proximoNumero } from "./Ambiente";
import { ErroNaoEncontrado, ErroValidacao } from "../comum/erros";

export interface DadosLote {
    organizacaoId: string;
    notaFiscal: string;
    transportadora: string;
    dataEntrada?: Date;
    observacoes?: string;
}

type RegistroLote = {
    id: string; dataEntrada: string; organizacaoId: string; notaFiscal: string; transportadora: string;
    equipamentoIds: string[]; statusProcessamento: StatusLote; observacoes: string;
};

export default class FabricaLote {
    private readonly repositorio: RepositorioArquivo;
    private readonly ambiente: Ambiente;
    private readonly fabricaEquipamento: FabricaEquipamento;
    private readonly validadorData: ValidadorDataEntrada;
    private readonly validadorNotaFiscal = new ValidadorNotaFiscal();

    constructor(repositorio: RepositorioArquivo, ambiente: Ambiente, fabricaEquipamento: FabricaEquipamento) {
        this.repositorio = repositorio;
        this.ambiente = ambiente;
        this.fabricaEquipamento = fabricaEquipamento;
        this.validadorData = new ValidadorDataEntrada(ambiente.relogio);
    }

    public criar(dados: DadosLote): Lote {
        const hoje = this.ambiente.relogio.agora();
        const dataEntrada = dados.dataEntrada ?? new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
        exigirValido(this.validadorData, dataEntrada);
        exigirValido(this.validadorNotaFiscal, String(dados.notaFiscal ?? ""));
        const transportadora = (dados.transportadora ?? "").trim();
        if (transportadora.length < 2) {
            throw new ErroValidacao("Informe a transportadora responsável pela coleta.");
        }
        const ano = hoje.getFullYear();
        const padrao = new RegExp(`^LT-${ano}-(\\d+)$`);
        const numero = proximoNumero(this.repositorio.listarEntidades(Arquivos.LOTES).map(l => l.id), padrao);
        return new Lote({
            id: `LT-${ano}-${String(numero).padStart(4, "0")}`,
            dataEntrada, transportadora,
            organizacaoId: dados.organizacaoId.trim().toUpperCase(),
            notaFiscal: String(Number(dados.notaFiscal)),
            equipamentos: [],
            statusProcessamento: StatusLote.RECEBIDO,
            observacoes: (dados.observacoes ?? "").trim()
        });
    }

    public paraRegistro(l: Lote): RegistroLote {
        return {
            id: l.id, dataEntrada: l.dataEntrada.toISOString(), organizacaoId: l.organizacaoId, notaFiscal: l.notaFiscal,
            transportadora: l.transportadora, equipamentoIds: l.equipamentos.map(e => e.id),
            statusProcessamento: l.statusProcessamento, observacoes: l.observacoes
        };
    }

    public carregar(id: string): Lote {
        const r = this.repositorio.carregarEntidade(Arquivos.LOTES, id.trim().toUpperCase()) as RegistroLote | null;
        if (!r) {
            throw new ErroNaoEncontrado(`Lote "${id}" não encontrado.`);
        }
        return this.montar(r);
    }

    private montar(r: RegistroLote): Lote {
        const { equipamentoIds: _ids, ...dados } = r;
        return new Lote({ ...dados, dataEntrada: new Date(r.dataEntrada), equipamentos: this.fabricaEquipamento.listarDoLote(r.id) });
    }

    public listar(): Lote[] {
        return (this.repositorio.listarEntidades(Arquivos.LOTES) as RegistroLote[]).map(r => this.montar(r));
    }
}
