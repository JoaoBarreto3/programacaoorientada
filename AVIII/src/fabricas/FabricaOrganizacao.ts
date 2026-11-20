import Organizacao, { DadosCadastrais } from "../dominio/Organizacao";
import Contrato, { DadosContrato } from "../dominio/Contrato";
import ValidadorCNPJ from "../validacao/ValidadorCNPJ";
import { exigirValido } from "../validacao/Validador";
import { normalizarCNPJ } from "../validacao/cnpj";
import GeradorCodigos from "../repositorios/GeradorCodigos";

export interface DadosOrganizacao extends Partial<DadosCadastrais> {
    cnpj: string;
    contrato?: DadosContrato | null;
}

// Cria o objeto composto Organização (+ Contrato opcional), já validado e com o código BRnnn.
export default class FabricaOrganizacao {
    constructor(private readonly validadorCNPJ: ValidadorCNPJ = new ValidadorCNPJ()) {}

    public async criar(dados: DadosOrganizacao, codigos: GeradorCodigos, agora: Date): Promise<Organizacao> {
        const cadastrais = Organizacao.validarDadosCadastrais(dados);
        exigirValido(this.validadorCNPJ, dados.cnpj);
        const contratoValidado = dados.contrato ? Contrato.validar(dados.contrato) : null;
        const id = `BR${String(await codigos.proximaOrganizacao()).padStart(3, "0")}`;
        return new Organizacao({
            ...cadastrais, id, cnpj: normalizarCNPJ(dados.cnpj), dataCadastro: agora, ativo: true, versao: 1,
            contratoVigente: contratoValidado ? Contrato.criar(id, contratoValidado) : null
        });
    }
}
