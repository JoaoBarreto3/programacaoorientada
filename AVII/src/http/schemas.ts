// Ativa os campos de documentação (tags, summary, security) no tipo FastifySchema.
import type {} from "@fastify/swagger";
import { FastifyInstance } from "fastify";
import EstadoFisico from "../dominio/enums/EstadoFisico";
import NaturezaMovimentacao from "../dominio/enums/NaturezaMovimentacao";
import PapelUsuario from "../dominio/enums/PapelUsuario";
import StatusLote from "../dominio/enums/StatusLote";
import StatusRastreamento from "../dominio/enums/StatusRastreamento";
import TipoEquipamento from "../dominio/enums/TipoEquipamento";

// JSON Schemas das rotas. Servem a três propósitos: validação da entrada pelo Fastify (antes de
// chegar ao controller), serialização rápida da resposta e documentação OpenAPI (/docs).

export const PADRAO_DATA = "^\\d{4}-\\d{2}-\\d{2}$";

export const enumDe = (valores: Record<string, string>) => ({ type: "string", enum: Object.values(valores) }) as const;

const texto = (max: number, min = 0) => ({ type: "string", minLength: min, maxLength: max }) as const;
const data = { type: "string", pattern: PADRAO_DATA, description: "Data no formato AAAA-MM-DD" } as const;
const dataHora = { type: "string", format: "date-time" } as const;
const versao = { type: "integer", minimum: 1, description: "Versão lida (versionamento otimista)" } as const;
const nulo = (tipo: string) => ({ type: [tipo, "null"] }) as const;

export const respostaErro = { $ref: "Erro#" } as const;

// Respostas de erro comuns a todas as rotas protegidas.
export const errosPadrao = {
    400: respostaErro, 401: respostaErro, 403: respostaErro, 404: respostaErro,
    409: respostaErro, 422: respostaErro, 500: respostaErro
} as const;

export const seguranca = [{ bearerAuth: [] }];

export function pagina(ref: string) {
    return {
        type: "object",
        properties: {
            itens: { type: "array", items: { $ref: `${ref}#` } },
            total: { type: "integer" }, pagina: { type: "integer" }, tamanhoPagina: { type: "integer" }
        }
    } as const;
}

export const queryPaginacao = {
    pagina: { type: "integer", minimum: 1, default: 1 },
    tamanhoPagina: { type: "integer", minimum: 1, maximum: 100, default: 20 }
} as const;

export const queryVersao = {
    type: "object", properties: { versao }, additionalProperties: false
} as const;

export const entradas = {
    versao,
    data,
    contrato: {
        type: "object",
        required: ["dataAssinatura", "dataVencimento", "clausulas", "valorMensal"],
        additionalProperties: false,
        properties: {
            dataAssinatura: data,
            dataVencimento: data,
            clausulas: { type: "array", minItems: 1, maxItems: 50, items: texto(500, 1) },
            valorMensal: { type: "number", minimum: 0, maximum: 9999999999.99 },
            renovacaoAutomatica: { type: "boolean", default: false },
            versao
        }
    },
    dadosCadastrais: {
        razaoSocial: texto(150, 3),
        inscricaoEstadual: texto(18),
        enderecoCompleto: texto(300, 10),
        telefone: texto(20),
        email: texto(150, 3)
    },
    equipamento: {
        type: "object",
        required: ["tipo", "marca", "modelo", "anoFabricacao", "estadoFisico", "pesoQuilogramas"],
        additionalProperties: false,
        properties: {
            tipo: enumDe(TipoEquipamento),
            marca: texto(60, 2),
            modelo: texto(80, 1),
            anoFabricacao: { type: "integer", minimum: 1970, maximum: 2100 },
            estadoFisico: enumDe(EstadoFisico),
            pesoQuilogramas: { type: "number", exclusiveMinimum: 0, maximum: 2000 }
        }
    }
} as const;

// Schemas compartilhados (referenciados por "$ref": "Nome#").
export function registrarSchemas(app: FastifyInstance): void {
    app.addSchema({
        $id: "Erro", type: "object",
        properties: {
            statusCode: { type: "integer" },
            erro: {
                type: "object",
                properties: {
                    codigo: { type: "string" }, mensagem: { type: "string" },
                    severidade: { type: "string", enum: ["INFO", "AVISO", "ERRO", "CRITICO"] }
                }
            }
        }
    });
    app.addSchema({
        $id: "Sessao", type: "object",
        properties: {
            token: { type: "string" }, tipo: { type: "string" }, expiraEm: dataHora,
            usuario: { type: "object", properties: { id: { type: "string" }, login: { type: "string" }, papel: enumDe(PapelUsuario) } }
        }
    });
    app.addSchema({
        $id: "Usuario", type: "object",
        properties: {
            id: { type: "string" }, login: { type: "string" }, papel: enumDe(PapelUsuario), ativo: { type: "boolean" },
            ultimoAcesso: nulo("string"), bloqueadoAte: nulo("string"), criadoEm: dataHora, versao: { type: "integer" }
        }
    });
    app.addSchema({
        $id: "Contrato", type: "object",
        properties: {
            id: { type: "string" }, organizacaoId: { type: "string" }, dataAssinatura: data, dataVencimento: data,
            clausulas: { type: "array", items: { type: "string" } }, valorMensal: { type: "number" },
            renovacaoAutomatica: { type: "boolean" }, vigente: { type: "boolean" }, versao: { type: "integer" }
        }
    });
    app.addSchema({
        $id: "Organizacao", type: "object",
        properties: {
            id: { type: "string" }, razaoSocial: { type: "string" }, cnpj: { type: "string" },
            inscricaoEstadual: { type: "string" }, enderecoCompleto: { type: "string" }, telefone: { type: "string" },
            email: { type: "string" }, dataCadastro: dataHora, ativo: { type: "boolean" },
            contrato: { anyOf: [{ $ref: "Contrato#" }, { type: "null" }] }, versao: { type: "integer" }
        }
    });
    app.addSchema({
        $id: "Movimentacao", type: "object",
        properties: {
            id: { type: "string" }, equipamentoId: { type: "string" }, natureza: enumDe(NaturezaMovimentacao),
            dataHora: dataHora, origem: { type: "string" }, destino: { type: "string" },
            responsavel: { type: "string" }, observacao: { type: "string" }
        }
    });
    app.addSchema({
        $id: "Equipamento", type: "object",
        properties: {
            id: { type: "string" }, codigoBarrasInterno: { type: "string" }, tipo: enumDe(TipoEquipamento),
            marca: { type: "string" }, modelo: { type: "string" }, anoFabricacao: { type: "integer" },
            estadoFisico: enumDe(EstadoFisico), pesoQuilogramas: { type: "number" }, loteId: { type: "string" },
            posicaoNoLote: { type: "integer" }, statusRastreamento: enumDe(StatusRastreamento),
            localizacaoAtual: nulo("string"), versao: { type: "integer" }
        }
    });
    app.addSchema({
        $id: "Lote", type: "object",
        properties: {
            id: { type: "string" }, dataEntrada: data, organizacaoId: { type: "string" }, notaFiscal: { type: "string" },
            transportadora: { type: "string" }, statusProcessamento: enumDe(StatusLote), observacoes: { type: "string" },
            quantidadeEquipamentos: { type: "integer" }, pesoTotalKg: { type: "number" }, versao: { type: "integer" },
            equipamentos: { type: "array", items: { $ref: "Equipamento#" } }
        }
    });
    app.addSchema({
        $id: "Parametros", type: "object",
        properties: {
            aliquotas: { type: "object", additionalProperties: { type: "number" } },
            coeficientesDepreciacao: { type: "object", additionalProperties: { type: "number" } },
            valoresReferencia: { type: "object", additionalProperties: { type: "number" } },
            retencaoAuditoriaDias: { type: "integer" }, versao: { type: "integer" }
        }
    });
    app.addSchema({
        $id: "RegistroAuditoria", type: "object",
        properties: {
            id: { type: "string" }, dataHora: dataHora, operacao: { type: "string" }, entidade: { type: "string" },
            entidadeId: { type: "string" }, usuario: { type: "string" },
            dadosAntes: {}, dadosDepois: {}
        }
    });
}
