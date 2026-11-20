import Usuario from "../dominio/Usuario";
import PapelUsuario from "../dominio/enums/PapelUsuario";
import { ClienteBanco } from "../infra/banco";
import type { Usuario as LinhaUsuario } from "../generated/prisma/client";
import { confirmarGravacao, proximaVersao } from "./versionamento";

export default class RepositorioUsuario {
    constructor(private readonly db: ClienteBanco) {}

    private paraDominio(l: LinhaUsuario): Usuario {
        return new Usuario({ ...l });
    }

    public async buscarPorId(id: string): Promise<Usuario | null> {
        const linha = await this.db.usuario.findUnique({ where: { id } });
        return linha ? this.paraDominio(linha) : null;
    }

    public async buscarPorLogin(login: string): Promise<Usuario | null> {
        const linha = await this.db.usuario.findUnique({ where: { login } });
        return linha ? this.paraDominio(linha) : null;
    }

    public async listar(filtro: { papel?: PapelUsuario; ativo?: boolean } = {}): Promise<Usuario[]> {
        const linhas = await this.db.usuario.findMany({
            where: { papel: filtro.papel, ativo: filtro.ativo }, orderBy: { login: "asc" }
        });
        return linhas.map(l => this.paraDominio(l));
    }

    public contar(): Promise<number> {
        return this.db.usuario.count();
    }

    public contarAdministradoresAtivos(): Promise<number> {
        return this.db.usuario.count({ where: { papel: PapelUsuario.ADMINISTRADOR, ativo: true } });
    }

    public async inserir(u: Usuario): Promise<void> {
        await this.db.usuario.create({
            data: {
                id: u.id, login: u.login, hashSenha: u.hashSenha, salt: u.salt, papel: u.papel, ativo: u.ativo,
                versaoToken: u.versaoToken, criadoEm: u.criadoEm, versao: u.versao
            }
        });
    }

    public async atualizar(u: Usuario): Promise<void> {
        const r = await this.db.usuario.updateMany({
            where: { id: u.id, versao: u.versao },
            data: {
                login: u.login, hashSenha: u.hashSenha, salt: u.salt, papel: u.papel, ativo: u.ativo, versaoToken: u.versaoToken,
                tentativasFalhas: u.tentativasFalhas, bloqueadoAte: u.bloqueadoAte, ultimoAcesso: u.ultimoAcesso,
                versao: proximaVersao()
            }
        });
        confirmarGravacao(r.count, u);
        u.versao++;
    }

    // Controle de acesso (tentativas, bloqueio, último acesso, versão de token) não altera a
    // "versao" do cadastro: um login não deve causar conflito com a edição feita por um administrador.
    public async registrarAcesso(u: Usuario): Promise<void> {
        await this.db.usuario.update({
            where: { id: u.id },
            data: {
                tentativasFalhas: u.tentativasFalhas, bloqueadoAte: u.bloqueadoAte,
                ultimoAcesso: u.ultimoAcesso, versaoToken: u.versaoToken
            }
        });
    }

    public async excluir(u: Usuario): Promise<void> {
        const r = await this.db.usuario.deleteMany({ where: { id: u.id, versao: u.versao } });
        confirmarGravacao(r.count, u);
    }
}
