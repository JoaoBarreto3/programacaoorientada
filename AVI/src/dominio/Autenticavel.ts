export default interface Autenticavel {
    autenticar(usuario: string, senha: string): boolean;
    renovarToken(): string;
}
