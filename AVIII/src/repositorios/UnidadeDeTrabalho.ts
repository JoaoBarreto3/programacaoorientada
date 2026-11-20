import { PrismaClient } from "../infra/banco";
import Repositorios from "./Repositorios";

const TEMPO_MAXIMO_TRANSACAO_MS = 15_000;

// Unidade de trabalho: agrupa as gravações de uma operação de negócio em uma única transação
// do banco ($transaction). Ou todas são confirmadas, ou nenhuma é (ex.: lote + equipamentos;
// status do equipamento + movimentação + situação do lote + auditoria).
export default class UnidadeDeTrabalho {
    public readonly leitura: Repositorios;

    constructor(private readonly prisma: PrismaClient) {
        this.leitura = new Repositorios(prisma);
    }

    public executar<T>(operacao: (repos: Repositorios) => Promise<T>): Promise<T> {
        return this.prisma.$transaction(tx => operacao(new Repositorios(tx)), {
            timeout: TEMPO_MAXIMO_TRANSACAO_MS,
            maxWait: TEMPO_MAXIMO_TRANSACAO_MS
        });
    }
}
