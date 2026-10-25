// As enumerações do domínio são objetos constantes com os mesmos valores das enums do banco
// (prisma/schema.prisma). Por serem uniões de literais, são compatíveis com os tipos gerados
// pelo Prisma sem que o domínio dependa do ORM.
export const PapelUsuario = {
    ADMINISTRADOR: "ADMINISTRADOR",
    OPERADOR_CADASTRO: "OPERADOR_CADASTRO",
    GESTOR_ALMOXARIFADO: "GESTOR_ALMOXARIFADO",
    AUDITOR: "AUDITOR"
} as const;
export type PapelUsuario = (typeof PapelUsuario)[keyof typeof PapelUsuario];

export default PapelUsuario;
