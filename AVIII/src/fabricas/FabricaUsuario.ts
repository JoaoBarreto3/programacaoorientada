import { randomUUID } from "node:crypto";
import Usuario from "../dominio/Usuario";
import PapelUsuario from "../dominio/enums/PapelUsuario";
import { gerarSaltEHash } from "../dominio/senha";
import ValidadorSenha from "../validacao/ValidadorSenha";
import ValidadorUsuario from "../validacao/ValidadorUsuario";
import { exigirValido } from "../validacao/Validador";

export default class FabricaUsuario {
    constructor(private readonly iteracoes: number) {}

    public async criar(login: string, senha: string, papel: PapelUsuario, agora: Date): Promise<Usuario> {
        const nome = String(login ?? "").trim();
        exigirValido(new ValidadorUsuario(), nome);
        exigirValido(new ValidadorSenha(), { usuario: nome, senha: String(senha ?? "") });
        return new Usuario({
            id: randomUUID(), login: nome, papel, ativo: true, ultimoAcesso: null, tentativasFalhas: 0,
            bloqueadoAte: null, versaoToken: 0, criadoEm: agora, versao: 1, ...await gerarSaltEHash(senha, this.iteracoes)
        });
    }
}
