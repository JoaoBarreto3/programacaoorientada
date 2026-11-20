import ParametrosGlobais from "../dominio/ParametrosGlobais";
import TipoEquipamento from "../dominio/enums/TipoEquipamento";
import { ClienteBanco } from "../infra/banco";
import { confirmarGravacao, proximaVersao } from "./versionamento";

export default class RepositorioParametros {
    constructor(private readonly db: ClienteBanco) {}

    // Cria a linha única de parâmetros com os valores padrão, se ainda não existir.
    public async garantirPadrao(): Promise<void> {
        const p = ParametrosGlobais.padrao();
        await this.db.parametrosGlobais.createMany({
            data: [{
                id: ParametrosGlobais.ID, aliquotas: p.aliquotas, coeficientesDepreciacao: p.coeficientesDepreciacao,
                valoresReferencia: p.valoresReferencia, retencaoAuditoriaDias: p.retencaoAuditoriaDias
            }],
            skipDuplicates: true
        });
    }

    public async obter(): Promise<ParametrosGlobais> {
        const linha = await this.db.parametrosGlobais.findUnique({ where: { id: ParametrosGlobais.ID } });
        if (!linha) {
            return ParametrosGlobais.padrao();
        }
        const padrao = ParametrosGlobais.padrao();
        return new ParametrosGlobais({
            aliquotas: linha.aliquotas as Record<string, number>,
            coeficientesDepreciacao: { ...padrao.coeficientesDepreciacao, ...(linha.coeficientesDepreciacao as Record<TipoEquipamento, number>) },
            valoresReferencia: { ...padrao.valoresReferencia, ...(linha.valoresReferencia as Record<TipoEquipamento, number>) },
            retencaoAuditoriaDias: linha.retencaoAuditoriaDias,
            versao: linha.versao
        });
    }

    public async atualizar(p: ParametrosGlobais): Promise<void> {
        const r = await this.db.parametrosGlobais.updateMany({
            where: { id: ParametrosGlobais.ID, versao: p.versao },
            data: {
                aliquotas: p.aliquotas, coeficientesDepreciacao: p.coeficientesDepreciacao,
                valoresReferencia: p.valoresReferencia, retencaoAuditoriaDias: p.retencaoAuditoriaDias,
                versao: proximaVersao()
            }
        });
        confirmarGravacao(r.count, p);
        p.versao++;
    }
}
