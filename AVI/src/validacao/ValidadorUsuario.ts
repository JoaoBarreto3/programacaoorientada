import Validador from "./Validador";

export default class ValidadorUsuario extends Validador {
    public validar(usuario: string): boolean {
        const valido = /^[a-z][a-z0-9._-]{2,31}$/.test(usuario);
        this.mensagemErro = valido ? "" :
            `Nome de usuário "${usuario}" inválido: 3 a 32 caracteres minúsculos, começando por letra (a-z, 0-9, ".", "_", "-").`;
        return valido;
    }
}
