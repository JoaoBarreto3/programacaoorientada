import Contrato from "./Contrato";
import EntidadeVersionada from "./EntidadeVersionada";
import ValidadorEmail from "../validacao/ValidadorEmail";
import { exigirValido } from "../validacao/Validador";
import { ErroRegraNegocio, ErroValidacao } from "../comum/erros";

export interface DadosCadastrais {
    razaoSocial: string;
    inscricaoEstadual: string;
    enderecoCompleto: string;
    telefone: string;
    email: string;
}

export default class Organizacao extends EntidadeVersionada {
    public readonly id: string;
    public razaoSocial: string;
    public cnpj: string;
    public inscricaoEstadual: string;
    public enderecoCompleto: string;
    public telefone: string;
    public email: string;
    public dataCadastro: Date;
    public ativo: boolean;
    // Cardinalidade 0..1 (AV2: "uma Organizacao possui um Contrato opcional").
    public contratoVigente: Contrato | null;

    constructor(dados: DadosCadastrais & {
        id: string; cnpj: string; dataCadastro: Date; ativo: boolean; contratoVigente: Contrato | null; versao: number;
    }) {
        super(dados.versao);
        this.id = dados.id;
        this.razaoSocial = dados.razaoSocial;
        this.cnpj = dados.cnpj;
        this.inscricaoEstadual = dados.inscricaoEstadual;
        this.enderecoCompleto = dados.enderecoCompleto;
        this.telefone = dados.telefone;
        this.email = dados.email;
        this.dataCadastro = dados.dataCadastro;
        this.ativo = dados.ativo;
        this.contratoVigente = dados.contratoVigente;
    }

    // Valida e normaliza os dados cadastrais (usado no cadastro e na alteração).
    public static validarDadosCadastrais(dados: Partial<DadosCadastrais>): DadosCadastrais {
        const razaoSocial = (dados.razaoSocial ?? "").trim().replace(/\s+/g, " ");
        if (razaoSocial.length < 3 || razaoSocial.length > 150) {
            throw new ErroValidacao("Razão social deve ter de 3 a 150 caracteres.");
        }
        const email = (dados.email ?? "").trim().toLowerCase();
        exigirValido(new ValidadorEmail(), email);
        const telefone = (dados.telefone ?? "").replace(/\D/g, "");
        if (telefone && !/^\d{10,13}$/.test(telefone)) {
            throw new ErroValidacao("Telefone deve ter DDD + número (10 a 13 dígitos).");
        }
        const inscricaoEstadual = (dados.inscricaoEstadual || "ISENTO").trim().toUpperCase();
        if (inscricaoEstadual !== "ISENTO" && !/^[0-9.\-\/]{8,18}$/.test(inscricaoEstadual)) {
            throw new ErroValidacao("Inscrição estadual inválida (use apenas dígitos/pontuação ou ISENTO).");
        }
        return { razaoSocial, email, telefone, inscricaoEstadual, enderecoCompleto: Organizacao.validarEndereco(dados.enderecoCompleto ?? "") };
    }

    private static validarEndereco(endereco: string): string {
        const texto = endereco.trim();
        if (texto.length < 10 || texto.length > 300) {
            throw new ErroValidacao("Endereço deve ter de 10 a 300 caracteres: logradouro, número, cidade e UF.");
        }
        return texto;
    }

    public descricao(): string {
        return `A organização ${this.id}`;
    }

    public alterarDados(dados: Partial<DadosCadastrais>): void {
        Object.assign(this, Organizacao.validarDadosCadastrais(dados));
    }

    // Correção de CNPJ digitado errado: só enquanto não houver lotes (depois disso o CNPJ
    // identifica a origem dos equipamentos e fica fixo, preservando a rastreabilidade).
    public corrigirCnpj(cnpjNormalizado: string, quantidadeLotes: number): void {
        if (cnpjNormalizado === this.cnpj) return;
        if (quantidadeLotes > 0) {
            throw new ErroRegraNegocio(`O CNPJ da organização ${this.id} não pode mais ser alterado: ela já possui ${quantidadeLotes} lote(s).`);
        }
        this.cnpj = cnpjNormalizado;
    }

    public alterarEndereco(novoEndereco: string): void {
        this.enderecoCompleto = Organizacao.validarEndereco(novoEndereco);
    }

    public desativar(): void {
        if (!this.ativo) {
            throw new ErroRegraNegocio(`A organização ${this.id} já está desativada.`);
        }
        this.ativo = false;
    }

    public reativar(): void {
        if (this.ativo) {
            throw new ErroRegraNegocio(`A organização ${this.id} já está ativa.`);
        }
        this.ativo = true;
    }

    // Pré-condição para registrar lotes: organização ativa e com contrato vigente.
    public exigirAptaParaColeta(hoje: Date): void {
        if (!this.ativo) {
            throw new ErroRegraNegocio(`A organização ${this.id} está desativada.`);
        }
        if (!this.contratoVigente || !this.contratoVigente.estaVigente(hoje)) {
            throw new ErroRegraNegocio(`A organização ${this.id} não possui contrato de coleta vigente.`);
        }
    }

    public paraJSON(hoje: Date) {
        return {
            id: this.id, razaoSocial: this.razaoSocial, cnpj: this.cnpj, inscricaoEstadual: this.inscricaoEstadual,
            enderecoCompleto: this.enderecoCompleto, telefone: this.telefone, email: this.email,
            dataCadastro: this.dataCadastro.toISOString(), ativo: this.ativo,
            contrato: this.contratoVigente?.paraJSON(hoje) ?? null, versao: this.versao
        };
    }
}
