import Organizacao from "../dominio/Organizacao";
import Contrato from "../dominio/Contrato";
import ValidadorCNPJ from "../validacao/ValidadorCNPJ";
import ValidadorEmail from "../validacao/ValidadorEmail";
import { exigirValido } from "../validacao/Validador";
import { normalizarCNPJ } from "../validacao/cnpj";
import RepositorioArquivo from "../infra/RepositorioArquivo";
import Arquivos from "../infra/Arquivos";
import Ambiente, { proximoNumero } from "./Ambiente";
import { ErroNaoEncontrado, ErroValidacao } from "../comum/erros";
import { inicioDoDia } from "../comum/datas";

export interface DadosOrganizacao {
    razaoSocial: string;
    cnpj: string;
    inscricaoEstadual?: string;
    enderecoCompleto: string;
    telefone?: string;
    email: string;
    contrato: {
        dataAssinatura: Date;
        dataVencimento: Date;
        clausulas: string[];
        valorMensal: number;
        renovacaoAutomatica: boolean;
    };
}

type RegistroOrganizacao = {
    id: string; razaoSocial: string; cnpj: string; inscricaoEstadual: string; enderecoCompleto: string;
    telefone: string; email: string; dataCadastro: string; ativo: boolean; contratoVigenteId: string;
};

type RegistroContrato = {
    id: string; organizacaoId: string; dataAssinatura: string; dataVencimento: string;
    clausulas: string[]; valorMensal: number; renovacaoAutomatica: boolean;
};

export default class FabricaOrganizacao {
    private readonly repositorio: RepositorioArquivo;
    private readonly ambiente: Ambiente;
    private readonly validadorCNPJ: ValidadorCNPJ;
    private readonly validadorEmail = new ValidadorEmail();

    constructor(repositorio: RepositorioArquivo, ambiente: Ambiente, validadorCNPJ: ValidadorCNPJ) {
        this.repositorio = repositorio;
        this.ambiente = ambiente;
        this.validadorCNPJ = validadorCNPJ;
    }

    public criar(dados: DadosOrganizacao): Organizacao {
        const razaoSocial = (dados.razaoSocial ?? "").trim();
        if (razaoSocial.length < 3) {
            throw new ErroValidacao("Razão social deve ter ao menos 3 caracteres.");
        }
        exigirValido(this.validadorCNPJ, dados.cnpj);
        exigirValido(this.validadorEmail, (dados.email ?? "").trim());
        const telefone = (dados.telefone ?? "").replace(/\D/g, "");
        if (telefone && !/^\d{10,13}$/.test(telefone)) {
            throw new ErroValidacao("Telefone deve ter DDD + número (10 a 13 dígitos).");
        }
        const inscricaoEstadual = (dados.inscricaoEstadual ?? "ISENTO").trim().toUpperCase();
        if (inscricaoEstadual !== "ISENTO" && !/^[0-9.\-\/]{8,18}$/.test(inscricaoEstadual)) {
            throw new ErroValidacao("Inscrição estadual inválida (use apenas dígitos/pontuação ou ISENTO).");
        }
        const id = `BR${String(proximoNumero(this.repositorio.listarEntidades(Arquivos.ORGANIZACOES).map(o => o.id), /^BR(\d+)$/)).padStart(3, "0")}`;
        const organizacao = new Organizacao({
            id, razaoSocial, inscricaoEstadual, telefone,
            cnpj: normalizarCNPJ(dados.cnpj),
            enderecoCompleto: "",
            email: dados.email.trim().toLowerCase(),
            dataCadastro: this.ambiente.relogio.agora(),
            ativo: true,
            contratoVigente: this.criarContrato(id, dados.contrato)
        });
        organizacao.alterarEndereco(dados.enderecoCompleto ?? "");
        return organizacao;
    }

    private criarContrato(organizacaoId: string, dados: DadosOrganizacao["contrato"]): Contrato {
        if (inicioDoDia(dados.dataVencimento) <= inicioDoDia(dados.dataAssinatura)) {
            throw new ErroValidacao("A data de vencimento do contrato deve ser posterior à de assinatura.");
        }
        if (!(dados.valorMensal >= 0) || !Number.isFinite(dados.valorMensal)) {
            throw new ErroValidacao("Valor mensal do contrato inválido.");
        }
        const clausulas = dados.clausulas.map(c => c.trim()).filter(c => c.length > 0);
        if (clausulas.length === 0) {
            throw new ErroValidacao("Informe ao menos uma cláusula de coleta (separe várias com ';').");
        }
        return new Contrato({ ...dados, id: `CT-${organizacaoId}`, organizacaoId, clausulas }, this.ambiente.relogio);
    }

    public paraRegistro(o: Organizacao): RegistroOrganizacao {
        return {
            id: o.id, razaoSocial: o.razaoSocial, cnpj: o.cnpj, inscricaoEstadual: o.inscricaoEstadual,
            enderecoCompleto: o.enderecoCompleto, telefone: o.telefone, email: o.email,
            dataCadastro: o.dataCadastro.toISOString(), ativo: o.ativo, contratoVigenteId: o.contratoVigente.id
        };
    }

    public contratoParaRegistro(c: Contrato): RegistroContrato {
        return {
            id: c.id, organizacaoId: c.organizacaoId, dataAssinatura: c.dataAssinatura.toISOString(),
            dataVencimento: c.dataVencimento.toISOString(), clausulas: [...c.clausulas],
            valorMensal: c.valorMensal, renovacaoAutomatica: c.renovacaoAutomatica
        };
    }

    public carregar(id: string): Organizacao {
        const r = this.repositorio.carregarEntidade(Arquivos.ORGANIZACOES, id.trim().toUpperCase()) as RegistroOrganizacao | null;
        if (!r) {
            throw new ErroNaoEncontrado(`Organização "${id}" não encontrada.`);
        }
        const c = this.repositorio.carregarEntidade(Arquivos.CONTRATOS, r.contratoVigenteId) as RegistroContrato | null;
        if (!c) {
            throw new ErroNaoEncontrado(`Contrato ${r.contratoVigenteId} da organização ${r.id} não encontrado.`);
        }
        return new Organizacao({
            ...r,
            dataCadastro: new Date(r.dataCadastro),
            contratoVigente: new Contrato({
                ...c, dataAssinatura: new Date(c.dataAssinatura), dataVencimento: new Date(c.dataVencimento)
            }, this.ambiente.relogio)
        });
    }

    public listar(): Organizacao[] {
        return this.repositorio.listarEntidades(Arquivos.ORGANIZACOES).map(r => this.carregar(r.id));
    }
}
