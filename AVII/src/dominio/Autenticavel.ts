// Interface do UML da AV1. Na AV2 a autenticação é assíncrona (hash fora do event loop).
export default interface Autenticavel {
    autenticar(usuario: string, senha: string): Promise<boolean>;
}
