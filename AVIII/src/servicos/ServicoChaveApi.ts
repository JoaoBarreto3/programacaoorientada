import { randomUUID } from "node:crypto";
import ChaveApi, { DadosChaveApi } from "../dominio/ChaveApi";
import { gerarCredencial, lerChave, segredoConfere } from "../dominio/credencialApi";
import { ParceiroAutenticado, UsuarioAutenticado } from "../dominio/Sessao";
import Permissao from "../dominio/enums/Permissao";
import Repositorios from "../repositorios/Repositorios";
import UnidadeDeTrabalho from "../repositorios/UnidadeDeTrabalho";
import Relogio from "../comum/Relogio";
import { ehUuid } from "../comum/uuid";
import { ErroChaveApi, ErroNaoEncontrado } from "../comum/erros";
import { exigirPermissao } from "./autorizacao";

// Intervalo mínimo entre duas gravações de "último uso" da mesma chave: evita uma escrita no
// banco a cada requisição de parceiro (o dado serve para auditoria, não precisa de precisão).
const INTERVALO_REGISTRO_USO_MS = 60_000;

// Gestão das chaves de API dos parceiros (papel ADMINISTRADOR) e autenticação das requisições
// da API pública. É o "novo módulo dentro do serviço de autenticação" pedido na AV3.
export default class ServicoChaveApi {
    constructor(private readonly uow: UnidadeDeTrabalho, private readonly relogio: Relogio) {}

    private async carregar(repos: Repositorios, id: string): Promise<ChaveApi> {
        const chave = ehUuid(id) ? await repos.chavesApi.buscar(id) : await repos.chavesApi.buscarPorPrefixo(id);
        if (!chave) {
            throw new ErroNaoEncontrado(`Chave de API "${id}" não encontrada.`);
        }
        return chave;
    }

    private auditar(repos: Repositorios, operacao: string, c: ChaveApi, usuario: string, antes?: unknown, depois?: unknown) {
        return repos.auditoria.registrar({
            operacao, entidade: "ChaveApi", entidadeId: c.prefixo, usuario, dataHora: this.relogio.agora(), antes, depois
        });
    }

    // Cria a chave e devolve o segredo completo. Ele só é mostrado agora: o banco guarda o hash.
    public async criar(autenticado: UsuarioAutenticado, dados: DadosChaveApi): Promise<{ chave: ChaveApi; segredo: string }> {
        exigirPermissao(autenticado, Permissao.CHAVES_API_GERENCIAR);
        const agora = this.relogio.agora();
        const organizacaoId = dados.organizacaoId?.trim().toUpperCase() || null;
        const validos = ChaveApi.validar({ ...dados, organizacaoId }, agora);
        const credencial = gerarCredencial();
        return this.uow.executar(async repos => {
            if (organizacaoId && !await repos.organizacoes.buscar(organizacaoId)) {
                throw new ErroNaoEncontrado(`Organização "${organizacaoId}" não encontrada.`);
            }
            const chave = new ChaveApi({
                ...validos, id: randomUUID(), prefixo: credencial.prefixo, hashSegredo: credencial.hashSegredo, ativa: true,
                revogadaEm: null, ultimoUsoEm: null, criadaPor: autenticado.login, criadaEm: agora, versao: 1
            });
            await repos.chavesApi.inserir(chave);
            await this.auditar(repos, "CHAVE_API_CRIAR", chave, autenticado.login, undefined, chave.paraJSON(agora));
            return { chave, segredo: credencial.chaveCompleta };
        });
    }

    public async listar(autenticado: UsuarioAutenticado, filtro: { organizacaoId?: string; ativa?: boolean }): Promise<ChaveApi[]> {
        exigirPermissao(autenticado, Permissao.CHAVES_API_GERENCIAR);
        return this.uow.leitura.chavesApi.listar({ ...filtro, organizacaoId: filtro.organizacaoId?.toUpperCase() });
    }

    public async buscar(autenticado: UsuarioAutenticado, id: string): Promise<ChaveApi> {
        exigirPermissao(autenticado, Permissao.CHAVES_API_GERENCIAR);
        return this.carregar(this.uow.leitura, id);
    }

    public async atualizar(autenticado: UsuarioAutenticado, id: string,
        dados: Partial<Omit<DadosChaveApi, "organizacaoId">> & { ativa?: boolean }, versao: number): Promise<ChaveApi> {
        exigirPermissao(autenticado, Permissao.CHAVES_API_GERENCIAR);
        return this.uow.executar(async repos => {
            const chave = await this.carregar(repos, id);
            chave.verificarVersao(versao);
            const agora = this.relogio.agora();
            const antes = chave.paraJSON(agora);
            chave.alterar(dados, agora);
            await repos.chavesApi.atualizar(chave);
            await this.auditar(repos, "CHAVE_API_ALTERAR", chave, autenticado.login, antes, chave.paraJSON(agora));
            return chave;
        });
    }

    public async rotacionar(autenticado: UsuarioAutenticado, id: string, versao?: number): Promise<{ chave: ChaveApi; segredo: string }> {
        exigirPermissao(autenticado, Permissao.CHAVES_API_GERENCIAR);
        return this.uow.executar(async repos => {
            const chave = await this.carregar(repos, id);
            chave.verificarVersao(versao);
            const credencial = gerarCredencial();
            chave.rotacionar(credencial.hashSegredo);
            await repos.chavesApi.atualizar(chave);
            await this.auditar(repos, "CHAVE_API_ROTACIONAR", chave, autenticado.login);
            // O prefixo não muda: só o segredo é novo.
            return { chave, segredo: `gc_${chave.prefixo}_${credencial.segredo}` };
        });
    }

    public async revogar(autenticado: UsuarioAutenticado, id: string, versao?: number): Promise<ChaveApi> {
        exigirPermissao(autenticado, Permissao.CHAVES_API_GERENCIAR);
        return this.uow.executar(async repos => {
            const chave = await this.carregar(repos, id);
            chave.verificarVersao(versao);
            const agora = this.relogio.agora();
            chave.revogar(agora);
            await repos.chavesApi.atualizar(chave);
            await this.auditar(repos, "CHAVE_API_REVOGAR", chave, autenticado.login, { ativa: true }, { ativa: false, revogadaEm: agora.toISOString() });
            return chave;
        });
    }

    // Autenticação de cada requisição da API pública. A mensagem é a mesma para chave malformada,
    // inexistente ou com segredo errado (não revela quais prefixos existem).
    public async autenticar(texto: string): Promise<ParceiroAutenticado> {
        const partes = lerChave(texto);
        const chave = partes ? await this.uow.leitura.chavesApi.buscarPorPrefixo(partes.prefixo) : null;
        if (!partes || !chave || !segredoConfere(partes.segredo, chave.hashSegredo)) {
            throw new ErroChaveApi("Chave de API inválida.");
        }
        const agora = this.relogio.agora();
        if (!chave.utilizavel(agora)) {
            throw new ErroChaveApi(chave.revogadaEm ? "Chave de API revogada." : chave.expirada(agora) ? "Chave de API expirada." : "Chave de API desativada.");
        }
        if (!chave.ultimoUsoEm || agora.getTime() - chave.ultimoUsoEm.getTime() >= INTERVALO_REGISTRO_USO_MS) {
            await this.uow.leitura.chavesApi.registrarUso(chave.id, agora);
        }
        return chave.paraParceiro();
    }
}
