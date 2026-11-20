import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fastifyRateLimit, { errorResponseBuilderContext } from "@fastify/rate-limit";
import { Redis } from "ioredis";
import { ErroLimiteRequisicoes } from "../../comum/erros";

// Limite de requisições (@fastify/rate-limit). Com Redis, a contagem é compartilhada entre todas
// as instâncias da API (o limite do plano vale para o parceiro, não para cada servidor); sem Redis,
// cada processo conta em memória. Se o Redis cair, a API continua respondendo (skipOnError):
// preferimos atender sem limite por alguns instantes a derrubar a integração dos parceiros.
export async function registrarLimites(app: FastifyInstance, redisUrl: string | null): Promise<void> {
    let redis: Redis | undefined;
    if (redisUrl) {
        redis = new Redis(redisUrl, { connectTimeout: 2000, maxRetriesPerRequest: 1, enableOfflineQueue: false });
        redis.on("error", () => { /* skipOnError: a API segue sem limite enquanto o Redis estiver fora */ });
        app.addHook("onClose", async () => { redis!.disconnect(); });
    }
    await app.register(fastifyRateLimit, {
        global: false, skipOnError: true, nameSpace: "greencode-limite:",
        ...(redis ? { redis } : {})
    });
}

// Erro 429 no formato padronizado da API (o cabeçalho Retry-After é preenchido pelo plugin).
export function construtorErroLimite(motivo: string) {
    return (_req: FastifyRequest, ctx: errorResponseBuilderContext) =>
        new ErroLimiteRequisicoes(`${motivo}: máximo de ${ctx.max} por minuto. Tente novamente em ${ctx.after}.`, Math.ceil(ctx.ttl / 1000));
}

// Limite "de proteção" por IP. Usa createRateLimit (só verifica) em vez do handler do plugin,
// porque o handler marca a requisição e ignora qualquer outro limite aplicado depois dele: assim o
// limite por IP convive com o limite do plano da chave, que é o que aparece nos cabeçalhos x-ratelimit-*.
export function limitePorIp(app: FastifyInstance, chave: string, maximoPorMinuto: number, motivo: string) {
    const verificar = app.createRateLimit({ max: maximoPorMinuto, timeWindow: 60_000, keyGenerator: req => `${chave}:${req.ip}` });
    return async (req: FastifyRequest, res: FastifyReply): Promise<void> => {
        const r = await verificar(req);
        if (!r.isAllowed && r.isExceeded) {
            res.header("retry-after", String(r.ttlInSeconds));
            throw new ErroLimiteRequisicoes(`${motivo}: máximo de ${r.max} por minuto. Tente novamente em ${r.ttlInSeconds} s.`, r.ttlInSeconds);
        }
    };
}
