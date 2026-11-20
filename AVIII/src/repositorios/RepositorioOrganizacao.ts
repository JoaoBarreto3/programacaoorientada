import Organizacao from "../dominio/Organizacao";
import Contrato from "../dominio/Contrato";
import { ClienteBanco, Prisma } from "../infra/banco";
import type { Contrato as LinhaContrato, Organizacao as LinhaOrganizacao } from "../generated/prisma/client";
import { normalizarPaginacao, ParametrosPaginacao } from "../comum/paginacao";
import { confirmarGravacao, proximaVersao } from "./versionamento";

export interface FiltroOrganizacao {
    ativo?: boolean;
    // Busca por parte da razão social, pelo CNPJ ou pelo código.
    busca?: string;
}

type LinhaComContrato = LinhaOrganizacao & { contrato: LinhaContrato | null };

export function contratoParaDominio(c: LinhaContrato): Contrato {
    return new Contrato({
        id: c.id, organizacaoId: c.organizacaoId, dataAssinatura: c.dataAssinatura, dataVencimento: c.dataVencimento,
        clausulas: (c.clausulas as string[]) ?? [], valorMensal: Number(c.valorMensal),
        renovacaoAutomatica: c.renovacaoAutomatica, versao: c.versao
    });
}

export function organizacaoParaDominio(l: LinhaComContrato): Organizacao {
    return new Organizacao({
        id: l.id, razaoSocial: l.razaoSocial, cnpj: l.cnpj, inscricaoEstadual: l.inscricaoEstadual,
        enderecoCompleto: l.enderecoCompleto, telefone: l.telefone, email: l.email, dataCadastro: l.dataCadastro,
        ativo: l.ativo, versao: l.versao, contratoVigente: l.contrato ? contratoParaDominio(l.contrato) : null
    });
}

function dadosContrato(c: Contrato) {
    return {
        dataAssinatura: c.dataAssinatura, dataVencimento: c.dataVencimento, clausulas: c.clausulas,
        valorMensal: new Prisma.Decimal(c.valorMensal.toFixed(2)), renovacaoAutomatica: c.renovacaoAutomatica
    };
}

export default class RepositorioOrganizacao {
    constructor(private readonly db: ClienteBanco) {}

    public async buscar(id: string): Promise<Organizacao | null> {
        const linha = await this.db.organizacao.findUnique({ where: { id }, include: { contrato: true } });
        return linha ? organizacaoParaDominio(linha) : null;
    }

    public async buscarPorCnpj(cnpj: string): Promise<Organizacao | null> {
        const linha = await this.db.organizacao.findUnique({ where: { cnpj }, include: { contrato: true } });
        return linha ? organizacaoParaDominio(linha) : null;
    }

    public async listar(filtro: FiltroOrganizacao, paginacao: ParametrosPaginacao) {
        const { pular, tamanhoPagina, pagina } = normalizarPaginacao(paginacao);
        const busca = filtro.busca?.trim();
        const where: Prisma.OrganizacaoWhereInput = {
            ativo: filtro.ativo,
            ...(busca ? {
                OR: [
                    { razaoSocial: { contains: busca, mode: "insensitive" } },
                    { cnpj: { contains: busca.toUpperCase().replace(/[.\/\-\s]/g, "") } },
                    { id: { equals: busca.toUpperCase() } }
                ]
            } : {})
        };
        const [linhas, total] = await Promise.all([
            this.db.organizacao.findMany({ where, include: { contrato: true }, orderBy: { id: "asc" }, skip: pular, take: tamanhoPagina }),
            this.db.organizacao.count({ where })
        ]);
        return { itens: linhas.map(organizacaoParaDominio), total, pagina, tamanhoPagina };
    }

    public async listarTodas(): Promise<Organizacao[]> {
        const linhas = await this.db.organizacao.findMany({ include: { contrato: true }, orderBy: { id: "asc" } });
        return linhas.map(organizacaoParaDominio);
    }

    public contarLotes(id: string): Promise<number> {
        return this.db.lote.count({ where: { organizacaoId: id } });
    }

    // Organização e contrato (se houver) gravados no mesmo comando (create aninhado).
    public async inserir(o: Organizacao): Promise<void> {
        const c = o.contratoVigente;
        await this.db.organizacao.create({
            data: {
                id: o.id, razaoSocial: o.razaoSocial, cnpj: o.cnpj, inscricaoEstadual: o.inscricaoEstadual,
                enderecoCompleto: o.enderecoCompleto, telefone: o.telefone, email: o.email, dataCadastro: o.dataCadastro,
                ativo: o.ativo, versao: o.versao,
                ...(c ? { contrato: { create: { id: c.id, versao: c.versao, ...dadosContrato(c) } } } : {})
            }
        });
    }

    public async atualizar(o: Organizacao): Promise<void> {
        const r = await this.db.organizacao.updateMany({
            where: { id: o.id, versao: o.versao },
            data: {
                razaoSocial: o.razaoSocial, cnpj: o.cnpj, inscricaoEstadual: o.inscricaoEstadual, enderecoCompleto: o.enderecoCompleto,
                telefone: o.telefone, email: o.email, ativo: o.ativo, versao: proximaVersao()
            }
        });
        confirmarGravacao(r.count, o);
        o.versao++;
    }

    public async excluir(o: Organizacao): Promise<void> {
        const r = await this.db.organizacao.deleteMany({ where: { id: o.id, versao: o.versao } });
        confirmarGravacao(r.count, o);
    }

    public async inserirContrato(c: Contrato): Promise<void> {
        await this.db.contrato.create({ data: { id: c.id, organizacaoId: c.organizacaoId, versao: c.versao, ...dadosContrato(c) } });
    }

    public async atualizarContrato(c: Contrato): Promise<void> {
        const r = await this.db.contrato.updateMany({
            where: { id: c.id, versao: c.versao },
            data: { ...dadosContrato(c), versao: proximaVersao() }
        });
        confirmarGravacao(r.count, c);
        c.versao++;
    }

    public async excluirContrato(c: Contrato): Promise<void> {
        const r = await this.db.contrato.deleteMany({ where: { id: c.id, versao: c.versao } });
        confirmarGravacao(r.count, c);
    }
}
