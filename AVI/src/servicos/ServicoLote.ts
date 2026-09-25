import Lote from "../dominio/Lote";
import Equipamento from "../dominio/Equipamento";
import Permissao from "../dominio/enums/Permissao";
import StatusLote from "../dominio/enums/StatusLote";
import StatusRastreamento from "../dominio/enums/StatusRastreamento";
import FabricaLote from "../fabricas/FabricaLote";
import FabricaEquipamento from "../fabricas/FabricaEquipamento";
import FabricaOrganizacao from "../fabricas/FabricaOrganizacao";
import Ambiente from "../fabricas/Ambiente";
import ValidadorCNPJ from "../validacao/ValidadorCNPJ";
import RepositorioArquivo from "../infra/RepositorioArquivo";
import GerenciadorJournal from "../infra/GerenciadorJournal";
import JournalTransacao from "../infra/JournalTransacao";
import RegistroMudancas from "../infra/RegistroMudancas";
import Arquivos from "../infra/Arquivos";
import { ErroRegraNegocio } from "../comum/erros";
import { dentroDoPeriodo } from "../comum/datas";
import ContextoSessao from "./ContextoSessao";

export default class ServicoLote {
    public repositorio: RepositorioArquivo;
    private readonly diario: GerenciadorJournal;
    private readonly contexto: ContextoSessao;
    private readonly fabricaLote: FabricaLote;
    private readonly fabricaEquipamento: FabricaEquipamento;
    private readonly fabricaOrganizacao: FabricaOrganizacao;

    constructor(repositorio: RepositorioArquivo, diario: GerenciadorJournal, contexto: ContextoSessao,
        ambiente: Ambiente, fabricaEquipamento: FabricaEquipamento) {
        this.repositorio = repositorio;
        this.diario = diario;
        this.contexto = contexto;
        this.fabricaEquipamento = fabricaEquipamento;
        this.fabricaLote = new FabricaLote(repositorio, ambiente, fabricaEquipamento);
        this.fabricaOrganizacao = new FabricaOrganizacao(repositorio, ambiente, new ValidadorCNPJ());
    }

    public criarLote(dados: any): Lote {
        const sessao = this.contexto.exigir(Permissao.LOTES_ESCREVER);
        const organizacao = this.fabricaOrganizacao.carregar(String(dados.organizacaoId ?? ""));
        if (!organizacao.ativo) {
            throw new ErroRegraNegocio(`A organização ${organizacao.id} está desativada.`);
        }
        if (!organizacao.contratoVigente.estaVigente()) {
            throw new ErroRegraNegocio(`A organização ${organizacao.id} não possui contrato de coleta vigente.`);
        }
        const lote = this.fabricaLote.criar({ ...dados, organizacaoId: organizacao.id });
        const duplicado = this.fabricaLote.listar()
            .find(l => l.organizacaoId === lote.organizacaoId && l.notaFiscal === lote.notaFiscal);
        if (duplicado) {
            throw new ErroRegraNegocio(`A NF ${lote.notaFiscal} da organização ${lote.organizacaoId} já foi registrada no lote ${duplicado.id}.`);
        }
        const mudancas = new RegistroMudancas(this.repositorio);
        mudancas.salvar(Arquivos.LOTES, this.fabricaLote.paraRegistro(lote));
        this.registrar("LOTE_CRIAR", lote, mudancas, sessao.usuario);
        return lote;
    }

    public adicionarEquipamentoLote(loteId: string, equipamento: Equipamento): void {
        const sessao = this.contexto.exigir(Permissao.LOTES_ESCREVER);
        const lote = this.fabricaLote.carregar(loteId);
        if (this.repositorio.carregarEntidade(Arquivos.EQUIPAMENTOS, equipamento.id)) {
            throw new ErroRegraNegocio(`O equipamento ${equipamento.id} já está cadastrado.`);
        }
        lote.adicionarEquipamento(equipamento);
        equipamento.registrarMovimentacao("RECEBIMENTO", sessao.usuario);
        const mudancas = new RegistroMudancas(this.repositorio);
        mudancas.salvar(Arquivos.EQUIPAMENTOS, this.fabricaEquipamento.paraRegistro(equipamento));
        for (const m of equipamento.historicoMovimentacao) {
            mudancas.salvar(Arquivos.MOVIMENTACOES, this.fabricaEquipamento.movimentacaoParaRegistro(m));
        }
        mudancas.salvar(Arquivos.LOTES, this.fabricaLote.paraRegistro(lote));
        this.registrar("EQUIPAMENTO_ADICIONAR", lote, mudancas, sessao.usuario);
    }

    public processarTriagem(loteId: string): void {
        const sessao = this.contexto.exigir(Permissao.LOTES_ESCREVER);
        const lote = this.fabricaLote.carregar(loteId);
        const mudancas = new RegistroMudancas(this.repositorio);
        let operacao: string;
        if (lote.statusProcessamento === StatusLote.RECEBIDO) {
            if (lote.equipamentos.length === 0) {
                throw new ErroRegraNegocio(`O lote ${lote.id} não possui equipamentos para triagem.`);
            }
            for (const equipamento of lote.equipamentos) {
                equipamento.atualizarStatus(StatusRastreamento.EM_TRIAGEM, `Início da triagem do lote ${lote.id}`);
                const movimentacao = equipamento.historicoMovimentacao[equipamento.historicoMovimentacao.length - 1]!;
                movimentacao.responsavel = sessao.usuario;
                mudancas.salvar(Arquivos.EQUIPAMENTOS, this.fabricaEquipamento.paraRegistro(equipamento));
                mudancas.salvar(Arquivos.MOVIMENTACOES, this.fabricaEquipamento.movimentacaoParaRegistro(movimentacao));
            }
            lote.statusProcessamento = StatusLote.EM_TRIAGEM;
            operacao = "LOTE_TRIAGEM_INICIAR";
        } else if (lote.statusProcessamento === StatusLote.EM_TRIAGEM) {
            lote.statusProcessamento = StatusLote.TRIAGEM_CONCLUIDA;
            operacao = "LOTE_TRIAGEM_CONCLUIR";
        } else {
            throw new ErroRegraNegocio(`A triagem do lote ${lote.id} já foi concluída (status ${lote.statusProcessamento}).`);
        }
        mudancas.salvar(Arquivos.LOTES, this.fabricaLote.paraRegistro(lote));
        this.registrar(operacao, lote, mudancas, sessao.usuario);
    }

    public consultarLotePorPeriodo(dataInicio: Date, dataFim: Date): Lote[] {
        this.contexto.exigir(Permissao.LOTES_LER);
        return this.fabricaLote.listar()
            .filter(l => dentroDoPeriodo(l.dataEntrada, { inicio: dataInicio, fim: dataFim }))
            .sort((a, b) => a.id.localeCompare(b.id));
    }

    private registrar(operacao: string, lote: Lote, mudancas: RegistroMudancas, usuario: string): void {
        new JournalTransacao({
            operacao, entidade: `Lote ${lote.id}`, usuarioResponsavel: usuario,
            dadosAntes: mudancas.antes, dadosDepois: mudancas.depois
        }, this.diario).registrar();
    }
}
