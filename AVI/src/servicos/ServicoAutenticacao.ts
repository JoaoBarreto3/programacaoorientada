import Credencial, { ITERACOES_PADRAO, calcularHashSenha, gerarSaltEHash } from "../dominio/Credencial";
import Sessao from "../dominio/Sessao";
import PapelUsuario from "../dominio/enums/PapelUsuario";
import Permissao from "../dominio/enums/Permissao";
import FabricaCredencial, { RegistroCredencial } from "../fabricas/FabricaCredencial";
import ValidadorSenha from "../validacao/ValidadorSenha";
import ValidadorUsuario from "../validacao/ValidadorUsuario";
import { exigirValido } from "../validacao/Validador";
import RepositorioArquivo from "../infra/RepositorioArquivo";
import GerenciadorJournal from "../infra/GerenciadorJournal";
import JournalTransacao from "../infra/JournalTransacao";
import RegistroMudancas from "../infra/RegistroMudancas";
import Arquivos from "../infra/Arquivos";
import Relogio from "../comum/Relogio";
import { ErroAutenticacao, ErroRegraNegocio } from "../comum/erros";
import { formatarDataHora } from "../comum/datas";
import ContextoSessao from "./ContextoSessao";

const MENSAGEM_LOGIN_INVALIDO = "Usuário ou senha inválidos.";
const MAX_TENTATIVAS = 5;
const MINUTOS_BLOQUEIO = 15;

export default class ServicoAutenticacao {
    public sessoesAtivas: Sessao[] = [];
    private readonly repositorio: RepositorioArquivo;
    private readonly diario: GerenciadorJournal;
    private readonly relogio: Relogio;
    private readonly contexto: ContextoSessao;
    private readonly iteracoes: number;
    private readonly falhas = new Map<string, { tentativas: number; bloqueadoAte: number }>();

    constructor(repositorio: RepositorioArquivo, diario: GerenciadorJournal, relogio: Relogio,
        contexto: ContextoSessao, iteracoes: number = ITERACOES_PADRAO) {
        this.repositorio = repositorio;
        this.diario = diario;
        this.relogio = relogio;
        this.contexto = contexto;
        this.iteracoes = iteracoes;
    }

    public get credenciais(): Credencial[] {
        return (this.repositorio.listarEntidades(Arquivos.CREDENCIAIS) as RegistroCredencial[])
            .map(FabricaCredencial.deRegistro)
            .sort((a, b) => a.usuario.localeCompare(b.usuario));
    }

    public login(usuario: string, senha: string): Sessao {
        const agora = this.relogio.agora().getTime();
        const login = usuario.trim();
        const bloqueio = this.falhas.get(login);
        if (bloqueio && bloqueio.bloqueadoAte > agora) {
            this.diario.registrarEvento("LOGIN_BLOQUEADO", login, { alvo: login });
            throw new ErroAutenticacao(`Conta temporariamente bloqueada por excesso de tentativas. ` +
                `Tente após ${formatarDataHora(new Date(bloqueio.bloqueadoAte))}.`);
        }
        const registro = this.repositorio.carregarEntidade(Arquivos.CREDENCIAIS, login) as RegistroCredencial | null;
        const credencial = registro ? FabricaCredencial.deRegistro(registro) : null;
        if (!credencial) {
            calcularHashSenha(senha, "00".repeat(16), this.iteracoes);
        }
        if (!credencial || !credencial.autenticar(login, senha)) {
            const estado = this.falhas.get(login) ?? { tentativas: 0, bloqueadoAte: 0 };
            estado.tentativas++;
            if (estado.tentativas >= MAX_TENTATIVAS) {
                estado.tentativas = 0;
                estado.bloqueadoAte = agora + MINUTOS_BLOQUEIO * 60_000;
            }
            this.falhas.set(login, estado);
            this.diario.registrarEvento("LOGIN_FALHA", login.slice(0, 32) || "anonimo", { alvo: login.slice(0, 32) });
            throw new ErroAutenticacao(estado.bloqueadoAte > agora
                ? `${MENSAGEM_LOGIN_INVALIDO} Conta bloqueada por ${MINUTOS_BLOQUEIO} minutos após ${MAX_TENTATIVAS} falhas.`
                : MENSAGEM_LOGIN_INVALIDO);
        }
        this.falhas.delete(login);
        credencial.atualizarUltimoAcesso();
        this.gravar(credencial, "LOGIN", credencial.usuario);
        const sessao = new Sessao(credencial, this.relogio);
        this.sessoesAtivas.push(sessao);
        this.contexto.sessao = sessao;
        return sessao;
    }

    public logout(token: string): void {
        const sessao = this.sessoesAtivas.find(s => s.token === token);
        if (!sessao) {
            return;
        }
        sessao.expiracao = this.relogio.agora();
        this.encerrar(sessao);
        this.diario.registrarEvento("LOGOUT", sessao.usuario, { alvo: sessao.usuario });
    }

    public validarToken(token: string): boolean {
        const sessao = this.sessoesAtivas.find(s => s.token === token);
        if (!sessao) {
            return false;
        }
        if (!sessao.isValida()) {
            this.encerrar(sessao);
            this.diario.registrarEvento("SESSAO_EXPIRADA", sessao.usuario, { alvo: sessao.usuario });
            return false;
        }
        return true;
    }

    public alterarSenha(usuario: string, senhaAntiga: string, senhaNova: string): boolean {
        const registro = this.repositorio.carregarEntidade(Arquivos.CREDENCIAIS, usuario) as RegistroCredencial | null;
        const credencial = registro ? FabricaCredencial.deRegistro(registro) : null;
        if (!credencial || !credencial.autenticar(usuario, senhaAntiga)) {
            throw new ErroAutenticacao("Senha atual incorreta.");
        }
        if (senhaAntiga === senhaNova) {
            throw new ErroRegraNegocio("A nova senha deve ser diferente da atual.");
        }
        exigirValido(new ValidadorSenha(), { usuario, senha: senhaNova });
        Object.assign(credencial, gerarSaltEHash(senhaNova, this.iteracoes));
        this.gravar(credencial, "SENHA_ALTERAR", usuario);
        return true;
    }

    public criarUsuario(usuario: string, senha: string, papel: PapelUsuario): Credencial {
        const sessao = this.contexto.exigir(Permissao.USUARIOS_GERENCIAR);
        exigirValido(new ValidadorUsuario(), usuario);
        if (this.repositorio.carregarEntidade(Arquivos.CREDENCIAIS, usuario)) {
            throw new ErroRegraNegocio(`O usuário "${usuario}" já existe.`);
        }
        exigirValido(new ValidadorSenha(), { usuario, senha });
        const credencial = FabricaCredencial.criar(usuario, senha, papel, this.iteracoes);
        this.gravar(credencial, "USUARIO_CRIAR", sessao.usuario);
        return credencial;
    }

    private encerrar(sessao: Sessao): void {
        this.sessoesAtivas = this.sessoesAtivas.filter(s => s !== sessao);
        if (this.contexto.sessao === sessao) {
            this.contexto.sessao = null;
        }
    }

    private gravar(credencial: Credencial, operacao: string, responsavel: string): void {
        const mudancas = new RegistroMudancas(this.repositorio);
        mudancas.salvar(Arquivos.CREDENCIAIS, FabricaCredencial.paraRegistro(credencial));
        new JournalTransacao({
            operacao, entidade: `Credencial ${credencial.usuario}`, usuarioResponsavel: responsavel,
            dadosAntes: mudancas.antes, dadosDepois: mudancas.depois
        }, this.diario).registrar();
    }
}
