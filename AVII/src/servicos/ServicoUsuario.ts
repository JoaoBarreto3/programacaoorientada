import Usuario from "../dominio/Usuario";
import { UsuarioAutenticado } from "../dominio/Sessao";
import PapelUsuario from "../dominio/enums/PapelUsuario";
import Permissao from "../dominio/enums/Permissao";
import FabricaUsuario from "../fabricas/FabricaUsuario";
import ValidadorSenha from "../validacao/ValidadorSenha";
import { exigirValido } from "../validacao/Validador";
import Repositorios from "../repositorios/Repositorios";
import UnidadeDeTrabalho from "../repositorios/UnidadeDeTrabalho";
import Relogio from "../comum/Relogio";
import { ErroNaoEncontrado, ErroRegraNegocio } from "../comum/erros";
import { exigirPermissao } from "./autorizacao";

export interface AlteracaoUsuario {
    papel?: PapelUsuario;
    ativo?: boolean;
}

// Gestão de contas de acesso (papel ADMINISTRADOR).
export default class ServicoUsuario {
    private readonly fabrica: FabricaUsuario;

    constructor(private readonly uow: UnidadeDeTrabalho, private readonly relogio: Relogio, private readonly iteracoes: number) {
        this.fabrica = new FabricaUsuario(iteracoes);
    }

    private async carregar(repos: Repositorios, login: string): Promise<Usuario> {
        const usuario = await repos.usuarios.buscarPorLogin(login);
        if (!usuario) {
            throw new ErroNaoEncontrado(`Usuário "${login}" não encontrado.`);
        }
        return usuario;
    }

    // Impede que o sistema fique sem nenhum administrador ativo.
    private async exigirOutroAdministrador(repos: Repositorios, alvo: Usuario): Promise<void> {
        if (alvo.papel === PapelUsuario.ADMINISTRADOR && alvo.ativo && await repos.usuarios.contarAdministradoresAtivos() <= 1) {
            throw new ErroRegraNegocio("Operação recusada: o sistema ficaria sem nenhum administrador ativo.");
        }
    }

    public async listar(autenticado: UsuarioAutenticado, filtro: { papel?: PapelUsuario; ativo?: boolean }): Promise<Usuario[]> {
        exigirPermissao(autenticado, Permissao.USUARIOS_GERENCIAR);
        return this.uow.leitura.usuarios.listar(filtro);
    }

    public async buscar(autenticado: UsuarioAutenticado, login: string): Promise<Usuario> {
        exigirPermissao(autenticado, Permissao.USUARIOS_GERENCIAR);
        return this.carregar(this.uow.leitura, login);
    }

    public async criarUsuario(autenticado: UsuarioAutenticado, login: string, senha: string, papel: PapelUsuario): Promise<Usuario> {
        exigirPermissao(autenticado, Permissao.USUARIOS_GERENCIAR);
        const agora = this.relogio.agora();
        const usuario = await this.fabrica.criar(login, senha, papel, agora);
        return this.uow.executar(async repos => {
            if (await repos.usuarios.buscarPorLogin(usuario.login)) {
                throw new ErroRegraNegocio(`O usuário "${usuario.login}" já existe.`);
            }
            await repos.usuarios.inserir(usuario);
            await repos.auditoria.registrar({
                operacao: "USUARIO_CRIAR", entidade: "Usuario", entidadeId: usuario.login, usuario: autenticado.login,
                dataHora: agora, depois: usuario.paraJSON()
            });
            return usuario;
        });
    }

    public async atualizar(autenticado: UsuarioAutenticado, login: string, alteracao: AlteracaoUsuario, versao: number): Promise<Usuario> {
        exigirPermissao(autenticado, Permissao.USUARIOS_GERENCIAR);
        if (login === autenticado.login && (alteracao.ativo === false || (alteracao.papel && alteracao.papel !== autenticado.papel))) {
            throw new ErroRegraNegocio("Você não pode desativar a própria conta nem alterar o próprio papel.");
        }
        return this.uow.executar(async repos => {
            const usuario = await this.carregar(repos, login);
            usuario.verificarVersao(versao);
            const antes = usuario.paraJSON();
            const rebaixa = alteracao.papel !== undefined && alteracao.papel !== PapelUsuario.ADMINISTRADOR;
            if (rebaixa || alteracao.ativo === false) {
                await this.exigirOutroAdministrador(repos, usuario);
            }
            if (alteracao.papel !== undefined) {
                usuario.alterarPapel(alteracao.papel);
            }
            if (alteracao.ativo === false && usuario.ativo) {
                usuario.desativar();
            } else if (alteracao.ativo === true && !usuario.ativo) {
                usuario.reativar();
            }
            await repos.usuarios.atualizar(usuario);
            await repos.auditoria.registrar({
                operacao: "USUARIO_ALTERAR", entidade: "Usuario", entidadeId: usuario.login, usuario: autenticado.login,
                dataHora: this.relogio.agora(), antes, depois: usuario.paraJSON()
            });
            return usuario;
        });
    }

    // Redefinição de senha pelo administrador (ex.: usuário esqueceu a senha). Encerra as sessões do usuário.
    public async redefinirSenha(autenticado: UsuarioAutenticado, login: string, senhaNova: string, versao?: number): Promise<Usuario> {
        exigirPermissao(autenticado, Permissao.USUARIOS_GERENCIAR);
        return this.uow.executar(async repos => {
            const usuario = await this.carregar(repos, login);
            usuario.verificarVersao(versao);
            exigirValido(new ValidadorSenha(), { usuario: usuario.login, senha: senhaNova });
            await usuario.definirSenha(senhaNova, this.iteracoes);
            usuario.tentativasFalhas = 0;
            usuario.bloqueadoAte = null;
            await repos.usuarios.atualizar(usuario);
            await repos.auditoria.registrar({
                operacao: "USUARIO_SENHA_REDEFINIR", entidade: "Usuario", entidadeId: usuario.login, usuario: autenticado.login,
                dataHora: this.relogio.agora()
            });
            return usuario;
        });
    }

    public async excluir(autenticado: UsuarioAutenticado, login: string, versao?: number): Promise<void> {
        exigirPermissao(autenticado, Permissao.USUARIOS_GERENCIAR);
        if (login === autenticado.login) {
            throw new ErroRegraNegocio("Você não pode excluir a sua própria conta.");
        }
        await this.uow.executar(async repos => {
            const usuario = await this.carregar(repos, login);
            usuario.verificarVersao(versao);
            await this.exigirOutroAdministrador(repos, usuario);
            await repos.usuarios.excluir(usuario);
            await repos.auditoria.registrar({
                operacao: "USUARIO_EXCLUIR", entidade: "Usuario", entidadeId: usuario.login, usuario: autenticado.login,
                dataHora: this.relogio.agora(), antes: usuario.paraJSON()
            });
        });
    }
}
