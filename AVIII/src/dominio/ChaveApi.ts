import EntidadeVersionada from "./EntidadeVersionada";
import EscopoApi from "./enums/EscopoApi";
import PlanoApi, { LIMITES_PLANO, LimitesPlano } from "./enums/PlanoApi";
import { ParceiroAutenticado } from "./Sessao";
import { ErroRegraNegocio, ErroValidacao } from "../comum/erros";

export interface DadosChaveApi {
    nome: string;
    escopos: EscopoApi[];
    plano: PlanoApi;
    organizacaoId: string | null;
    expiraEm: Date | null;
}

// Credencial de um parceiro externo da API pública. O segredo não faz parte da entidade:
// só o hash é guardado (ver credencialApi.ts).
export default class ChaveApi extends EntidadeVersionada {
    public readonly id: string;
    public nome: string;
    public readonly prefixo: string;
    public hashSegredo: string;
    public escopos: EscopoApi[];
    public plano: PlanoApi;
    public readonly organizacaoId: string | null;
    public ativa: boolean;
    public expiraEm: Date | null;
    public revogadaEm: Date | null;
    public ultimoUsoEm: Date | null;
    public readonly criadaPor: string;
    public readonly criadaEm: Date;

    constructor(dados: DadosChaveApi & {
        id: string; prefixo: string; hashSegredo: string; ativa: boolean; revogadaEm: Date | null;
        ultimoUsoEm: Date | null; criadaPor: string; criadaEm: Date; versao: number;
    }) {
        super(dados.versao);
        this.id = dados.id;
        this.nome = dados.nome;
        this.prefixo = dados.prefixo;
        this.hashSegredo = dados.hashSegredo;
        this.escopos = [...dados.escopos];
        this.plano = dados.plano;
        this.organizacaoId = dados.organizacaoId;
        this.ativa = dados.ativa;
        this.expiraEm = dados.expiraEm;
        this.revogadaEm = dados.revogadaEm;
        this.ultimoUsoEm = dados.ultimoUsoEm;
        this.criadaPor = dados.criadaPor;
        this.criadaEm = dados.criadaEm;
    }

    // Regras de consistência entre nome, escopos, organização e validade.
    public static validar(dados: DadosChaveApi, agora: Date): DadosChaveApi {
        const nome = (dados.nome ?? "").trim();
        if (nome.length < 3 || nome.length > 100) {
            throw new ErroValidacao("O nome do parceiro deve ter de 3 a 100 caracteres.");
        }
        const escopos = [...new Set(dados.escopos ?? [])];
        if (escopos.length === 0) {
            throw new ErroValidacao("Informe ao menos um escopo para a chave de API.");
        }
        if (escopos.includes(EscopoApi.LOTES_ESCREVER) && !dados.organizacaoId) {
            throw new ErroRegraNegocio("O escopo LOTES_ESCREVER exige uma chave ligada a uma organização (o lote pertence a ela).");
        }
        if (dados.expiraEm && dados.expiraEm.getTime() <= agora.getTime()) {
            throw new ErroValidacao("A data de expiração da chave deve estar no futuro.");
        }
        return { ...dados, nome, escopos };
    }

    public descricao(): string {
        return `A chave de API ${this.prefixo}`;
    }

    public get limites(): LimitesPlano {
        return LIMITES_PLANO[this.plano];
    }

    public get loginAuditoria(): string {
        return `api:${this.prefixo}`;
    }

    public expirada(agora: Date): boolean {
        return this.expiraEm !== null && this.expiraEm.getTime() <= agora.getTime();
    }

    public utilizavel(agora: Date): boolean {
        return this.ativa && this.revogadaEm === null && !this.expirada(agora);
    }

    private exigirNaoRevogada(): void {
        if (this.revogadaEm) {
            throw new ErroRegraNegocio(`A chave ${this.prefixo} foi revogada; crie uma nova chave para o parceiro.`);
        }
    }

    public alterar(dados: Partial<Omit<DadosChaveApi, "organizacaoId">> & { ativa?: boolean }, agora: Date): void {
        this.exigirNaoRevogada();
        const validos = ChaveApi.validar({
            nome: dados.nome ?? this.nome, escopos: dados.escopos ?? this.escopos, plano: dados.plano ?? this.plano,
            organizacaoId: this.organizacaoId, expiraEm: dados.expiraEm === undefined ? this.expiraEm : dados.expiraEm
        }, agora);
        this.nome = validos.nome;
        this.escopos = validos.escopos;
        this.plano = validos.plano;
        this.expiraEm = validos.expiraEm;
        if (dados.ativa !== undefined) this.ativa = dados.ativa;
    }

    // Troca o segredo: a chave antiga deixa de funcionar na hora; prefixo e permissões continuam.
    public rotacionar(novoHash: string): void {
        this.exigirNaoRevogada();
        this.hashSegredo = novoHash;
    }

    // Revogação é definitiva (diferente de desativar, que é reversível).
    public revogar(agora: Date): void {
        this.exigirNaoRevogada();
        this.revogadaEm = agora;
        this.ativa = false;
    }

    public paraParceiro(): ParceiroAutenticado {
        return {
            id: this.id, login: this.loginAuditoria, nome: this.nome, organizacaoId: this.organizacaoId,
            escopos: [...this.escopos], plano: this.plano
        };
    }

    public paraJSON(agora: Date) {
        return {
            id: this.id, nome: this.nome, prefixo: this.prefixo, escopos: [...this.escopos], plano: this.plano,
            limites: this.limites, organizacaoId: this.organizacaoId, ativa: this.ativa,
            situacao: this.revogadaEm ? "REVOGADA" : this.expirada(agora) ? "EXPIRADA" : this.ativa ? "ATIVA" : "INATIVA",
            expiraEm: this.expiraEm?.toISOString() ?? null, revogadaEm: this.revogadaEm?.toISOString() ?? null,
            ultimoUsoEm: this.ultimoUsoEm?.toISOString() ?? null, criadaPor: this.criadaPor,
            criadaEm: this.criadaEm.toISOString(), versao: this.versao
        };
    }
}
