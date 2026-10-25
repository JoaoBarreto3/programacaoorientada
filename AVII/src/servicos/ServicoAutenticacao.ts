import Sessao, { UsuarioAutenticado } from "../dominio/Sessao";
import Usuario, { MAX_TENTATIVAS_LOGIN, MINUTOS_BLOQUEIO } from "../dominio/Usuario";
import PapelUsuario from "../dominio/enums/PapelUsuario";
import { calcularHashSenha } from "../dominio/senha";
import FabricaUsuario from "../fabricas/FabricaUsuario";
import ValidadorSenha from "../validacao/ValidadorSenha";
import { exigirValido } from "../validacao/Validador";
import UnidadeDeTrabalho from "../repositorios/UnidadeDeTrabalho";
import Relogio from "../comum/Relogio";
import { ErroAutenticacao, ErroRegraNegocio, ErroSessao } from "../comum/erros";

const MENSAGEM_LOGIN_INVALIDO = "Usuário ou senha inválidos.";
const SALT_FICTICIO = "00".repeat(16);

export interface ConteudoToken {
    sub: string;
    login: string;
    papel: PapelUsuario;
    // Versão de token do usuário no momento da emissão (ver Usuario.versaoToken).
    tv: number;
}

// Porta para a emissão de tokens: o serviço não conhece a biblioteca de JWT usada pela camada HTTP.
export interface EmissorToken {
    emitir(conteudo: ConteudoToken): { token: string; criacao: Date; expiracao: Date };
}

export default class ServicoAutenticacao {
    private readonly fabrica: FabricaUsuario;

    constructor(private readonly uow: UnidadeDeTrabalho, private readonly relogio: Relogio,
        private readonly emissor: EmissorToken, private readonly iteracoes: number) {
        this.fabrica = new FabricaUsuario(iteracoes);
    }

    private emitirSessao(u: Usuario): Sessao {
        const { token, criacao, expiracao } = this.emissor.emitir({ sub: u.id, login: u.login, papel: u.papel, tv: u.versaoToken });
        return new Sessao({ token, usuarioId: u.id, usuario: u.login, papel: u.papel, criacao, expiracao });
    }

    public async precisaProvisionar(): Promise<boolean> {
        return (await this.uow.leitura.usuarios.contar()) === 0;
    }

    // Provisionamento inicial (equivalente ao modo de provisionamento da AV1): só funciona com o
    // banco sem nenhum usuário e cria o primeiro administrador.
    public async provisionar(login: string, senha: string): Promise<Sessao> {
        const agora = this.relogio.agora();
        const admin = await this.fabrica.criar(login, senha, PapelUsuario.ADMINISTRADOR, agora);
        await this.uow.executar(async repos => {
            // Trava de transação: duas requisições simultâneas de provisionamento não criam dois administradores.
            await repos.codigos.travarProvisionamento();
            if (await repos.usuarios.contar() > 0) {
                throw new ErroRegraNegocio("O sistema já foi provisionado. Entre com um usuário existente.");
            }
            await repos.parametros.garantirPadrao();
            await repos.usuarios.inserir(admin);
            await repos.auditoria.registrar({
                operacao: "PROVISIONAMENTO", entidade: "Usuario", entidadeId: admin.login, usuario: admin.login,
                dataHora: agora, depois: admin.paraJSON()
            });
        });
        return this.emitirSessao(admin);
    }

    public async login(login: string, senha: string): Promise<Sessao> {
        const agora = this.relogio.agora();
        const nome = String(login ?? "").trim().slice(0, 32);
        const usuario = await this.uow.leitura.usuarios.buscarPorLogin(nome);
        if (!usuario) {
            // Mesmo custo de um login real: o tempo de resposta não revela se o usuário existe.
            await calcularHashSenha(senha, SALT_FICTICIO, this.iteracoes);
            await this.registrarEvento("LOGIN_FALHA", nome || "anonimo", agora);
            throw new ErroAutenticacao(MENSAGEM_LOGIN_INVALIDO);
        }
        if (usuario.estaBloqueado(agora)) {
            await this.registrarEvento("LOGIN_BLOQUEADO", usuario.login, agora);
            throw new ErroAutenticacao("Conta temporariamente bloqueada por excesso de tentativas. " +
                `Tente novamente após ${usuario.bloqueadoAte!.toISOString()}.`);
        }
        if (!await usuario.autenticar(nome, senha)) {
            const bloqueou = usuario.registrarFalhaLogin(agora);
            await this.uow.executar(async repos => {
                await repos.usuarios.registrarAcesso(usuario);
                await repos.auditoria.registrar({ operacao: "LOGIN_FALHA", entidade: "Usuario", entidadeId: usuario.login, usuario: usuario.login, dataHora: agora });
            });
            throw new ErroAutenticacao(bloqueou
                ? `${MENSAGEM_LOGIN_INVALIDO} Conta bloqueada por ${MINUTOS_BLOQUEIO} minutos após ${MAX_TENTATIVAS_LOGIN} falhas.`
                : MENSAGEM_LOGIN_INVALIDO);
        }
        usuario.registrarLogin(agora);
        await this.uow.executar(async repos => {
            await repos.usuarios.registrarAcesso(usuario);
            await repos.auditoria.registrar({ operacao: "LOGIN", entidade: "Usuario", entidadeId: usuario.login, usuario: usuario.login, dataHora: agora });
        });
        return this.emitirSessao(usuario);
    }

    // Chamado a cada requisição autenticada, depois que a assinatura e a validade do JWT foram
    // conferidas: garante que o usuário ainda existe, está ativo e não saiu (logout) desde a emissão.
    public async validarSessao(conteudo: ConteudoToken): Promise<UsuarioAutenticado> {
        const usuario = await this.uow.leitura.usuarios.buscarPorId(conteudo.sub);
        if (!usuario || !usuario.ativo || usuario.versaoToken !== conteudo.tv) {
            throw new ErroSessao();
        }
        return { id: usuario.id, login: usuario.login, papel: usuario.papel };
    }

    // Renovação da sessão: novo token com mais 30 minutos (expiração por inatividade).
    public async renovar(autenticado: UsuarioAutenticado): Promise<Sessao> {
        const usuario = await this.uow.leitura.usuarios.buscarPorId(autenticado.id);
        if (!usuario || !usuario.ativo) {
            throw new ErroSessao();
        }
        return this.emitirSessao(usuario);
    }

    public async logout(autenticado: UsuarioAutenticado): Promise<void> {
        const agora = this.relogio.agora();
        await this.uow.executar(async repos => {
            const usuario = await repos.usuarios.buscarPorId(autenticado.id);
            if (!usuario) return;
            usuario.invalidarTokens();
            await repos.usuarios.registrarAcesso(usuario);
            await repos.auditoria.registrar({ operacao: "LOGOUT", entidade: "Usuario", entidadeId: usuario.login, usuario: usuario.login, dataHora: agora });
        });
    }

    // Troca a própria senha. Todos os tokens anteriores deixam de valer; devolve uma sessão nova.
    public async alterarSenha(autenticado: UsuarioAutenticado, senhaAtual: string, senhaNova: string): Promise<Sessao> {
        const agora = this.relogio.agora();
        const usuario = await this.uow.executar(async repos => {
            const u = await repos.usuarios.buscarPorId(autenticado.id);
            if (!u || !await u.verificarSenha(senhaAtual)) {
                throw new ErroAutenticacao("Senha atual incorreta.");
            }
            if (senhaAtual === senhaNova) {
                throw new ErroRegraNegocio("A nova senha deve ser diferente da atual.");
            }
            exigirValido(new ValidadorSenha(), { usuario: u.login, senha: senhaNova });
            await u.definirSenha(senhaNova, this.iteracoes);
            await repos.usuarios.atualizar(u);
            await repos.auditoria.registrar({ operacao: "SENHA_ALTERAR", entidade: "Usuario", entidadeId: u.login, usuario: u.login, dataHora: agora });
            return u;
        });
        return this.emitirSessao(usuario);
    }

    private async registrarEvento(operacao: string, login: string, agora: Date): Promise<void> {
        await this.uow.executar(repos => repos.auditoria.registrar({
            operacao, entidade: "Usuario", entidadeId: login, usuario: login, dataHora: agora
        }));
    }
}
