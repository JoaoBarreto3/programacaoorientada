import Validador from "./Validador";

export const TAMANHO_MINIMO_SENHA = 8;

export default class ValidadorSenha extends Validador {
    public validar(objeto: { usuario: string; senha: string }): boolean {
        const { usuario, senha } = objeto;
        this.mensagemErro = "";
        if (senha.length < TAMANHO_MINIMO_SENHA) {
            this.mensagemErro = `A senha deve ter ao menos ${TAMANHO_MINIMO_SENHA} caracteres.`;
        } else if (!/[A-Za-zÀ-ÿ]/.test(senha) || !/[0-9]/.test(senha)) {
            this.mensagemErro = "A senha deve conter letras e números.";
        } else if (senha.toLowerCase().includes(usuario.toLowerCase())) {
            this.mensagemErro = "A senha não pode conter o nome de usuário.";
        }
        return this.mensagemErro === "";
    }
}
