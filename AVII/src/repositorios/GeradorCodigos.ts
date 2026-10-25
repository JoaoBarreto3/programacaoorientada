import { ClienteBanco } from "../infra/banco";

// Números sequenciais vindos de sequências do PostgreSQL: seguros sob concorrência (duas
// requisições simultâneas nunca recebem o mesmo número). Uma transação desfeita deixa um
// "buraco" na numeração, o que é aceitável para códigos de identificação.
export default class GeradorCodigos {
    constructor(private readonly db: ClienteBanco) {}

    private async ler(resultado: Promise<{ n: bigint | number }[]>): Promise<number> {
        const [linha] = await resultado;
        return Number(linha!.n);
    }

    public proximaOrganizacao(): Promise<number> {
        return this.ler(this.db.$queryRaw`SELECT nextval('seq_organizacao') AS n`);
    }

    public proximoLote(): Promise<number> {
        return this.ler(this.db.$queryRaw`SELECT nextval('seq_lote') AS n`);
    }

    public proximoEquipamento(): Promise<number> {
        return this.ler(this.db.$queryRaw`SELECT nextval('seq_equipamento') AS n`);
    }

    // Trava consultiva (advisory lock) liberada automaticamente no fim da transação.
    public async travarProvisionamento(): Promise<void> {
        await this.db.$executeRaw`SELECT pg_advisory_xact_lock(7426001)`;
    }
}
