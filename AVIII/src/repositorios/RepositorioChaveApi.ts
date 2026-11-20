import ChaveApi from "../dominio/ChaveApi";
import { ClienteBanco } from "../infra/banco";
import type { ChaveApi as LinhaChaveApi } from "../generated/prisma/client";
import { confirmarGravacao, proximaVersao } from "./versionamento";

function paraDominio(l: LinhaChaveApi): ChaveApi {
    return new ChaveApi({ ...l });
}

export interface FiltroChaveApi {
    organizacaoId?: string;
    ativa?: boolean;
}

export default class RepositorioChaveApi {
    constructor(private readonly db: ClienteBanco) {}

    public async buscar(id: string): Promise<ChaveApi | null> {
        const linha = await this.db.chaveApi.findUnique({ where: { id } });
        return linha ? paraDominio(linha) : null;
    }

    public async buscarPorPrefixo(prefixo: string): Promise<ChaveApi | null> {
        const linha = await this.db.chaveApi.findUnique({ where: { prefixo } });
        return linha ? paraDominio(linha) : null;
    }

    public async listar(filtro: FiltroChaveApi): Promise<ChaveApi[]> {
        const linhas = await this.db.chaveApi.findMany({
            where: { organizacaoId: filtro.organizacaoId, ativa: filtro.ativa }, orderBy: [{ criadaEm: "desc" }, { id: "asc" }]
        });
        return linhas.map(paraDominio);
    }

    public async inserir(c: ChaveApi): Promise<void> {
        await this.db.chaveApi.create({
            data: {
                id: c.id, nome: c.nome, prefixo: c.prefixo, hashSegredo: c.hashSegredo, escopos: c.escopos, plano: c.plano,
                organizacaoId: c.organizacaoId, ativa: c.ativa, expiraEm: c.expiraEm, criadaPor: c.criadaPor,
                criadaEm: c.criadaEm, versao: c.versao
            }
        });
    }

    public async atualizar(c: ChaveApi): Promise<void> {
        const r = await this.db.chaveApi.updateMany({
            where: { id: c.id, versao: c.versao },
            data: {
                nome: c.nome, hashSegredo: c.hashSegredo, escopos: c.escopos, plano: c.plano, ativa: c.ativa,
                expiraEm: c.expiraEm, revogadaEm: c.revogadaEm, versao: proximaVersao()
            }
        });
        confirmarGravacao(r.count, c);
        c.versao++;
    }

    // Registro de uso: não incrementa a versão (não deve conflitar com a edição pelo administrador).
    public async registrarUso(id: string, instante: Date): Promise<void> {
        await this.db.chaveApi.updateMany({ where: { id }, data: { ultimoUsoEm: instante } });
    }
}
