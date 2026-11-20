// Configuração da CLI do Prisma (migrações, seed e geração do cliente).
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
    schema: "prisma/schema.prisma",
    migrations: {
        path: "prisma/migrations",
        seed: "node dist/prisma/seed.js"
    },
    datasource: {
        // Lido sem exigir: "prisma generate" (rodado no npm install) não precisa de banco.
        // Migrações e seed falham com mensagem clara se DATABASE_URL não estiver definida.
        url: process.env.DATABASE_URL ?? ""
    }
});
