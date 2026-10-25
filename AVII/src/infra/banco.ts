import { PrismaPg } from "@prisma/adapter-pg";
import { Prisma, PrismaClient } from "../generated/prisma/client";

export type ClienteBanco = PrismaClient | Prisma.TransactionClient;

// Uma única instância por processo: cada PrismaClient mantém o seu pool de conexões.
export function criarClientePrisma(urlBanco: string): PrismaClient {
    return new PrismaClient({ adapter: new PrismaPg({ connectionString: urlBanco }) });
}

export { Prisma, PrismaClient };
