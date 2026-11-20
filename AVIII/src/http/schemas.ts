// Ativa os campos de documentação (tags, summary, security) no tipo FastifySchema.
import type {} from "@fastify/swagger";
import { FastifyInstance } from "fastify";
import EstadoFisico from "../dominio/enums/EstadoFisico";
import NaturezaMovimentacao from "../dominio/enums/NaturezaMovimentacao";
import PapelUsuario from "../dominio/enums/PapelUsuario";
import StatusLote from "../dominio/enums/StatusLote";
import StatusRastreamento from "../dominio/enums/StatusRastreamento";
import TipoEquipamento from "../dominio/enums/TipoEquipamento";
import EscopoApi from "../dominio/enums/EscopoApi";
import PlanoApi from "../dominio/enums/PlanoApi";

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
    409: respostaErro, 422: respostaErro, 429: respostaErro, 500: respostaErro
} as const;

export const seguranca = [{ bearerAuth: [] }];
export const segurancaParceiro = [{ chaveApi: [] }];

// Respostas de erro da API pública, cada uma com a explicação para o parceiro.
const erroDoc = (description: string) => ({ description, $ref: "Erro#" }) as const;
export const errosPublicos = {
    400: erroDoc("VALIDACAO: parâmetro, corpo ou consulta inválidos."),
    401: erroDoc("CHAVE_API: chave ausente, inválida, desativada, expirada ou revogada."),
    403: erroDoc("PERMISSAO: a chave não tem o escopo exigido pela operação."),
    404: erroDoc("NAO_ENCONTRADO: recurso inexistente ou de outra organização."),
    409: erroDoc("CONFLITO / DUPLICIDADE: estado incompatível (ex.: relatório ainda em processamento, nota fiscal repetida)."),
    410: erroDoc("EXPIRADO: o arquivo do relatório passou do prazo de retenção; solicite um novo."),
    422: erroDoc("REGRA_NEGOCIO: a operação viola uma regra (ex.: contrato vencido, limite de relatórios do plano)."),
    429: erroDoc("LIMITE_REQUISICOES: limite do plano excedido; aguarde o tempo indicado em Retry-After."),
    500: erroDoc("INTERNO: erro inesperado; a operação não foi concluída.")
} as const;

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
    pagina: { type: "integer", minimum: 1, maximum: 1000000, default: 1, description: "Página desejada (começa em 1)" },
    tamanhoPagina: { type: "integer", minimum: 1, maximum: 100, default: 20, description: "Itens por página (máximo 100)" }
} as const;

// Resposta de sucesso documentada com descrição e exemplo. Um "$ref" com irmãos perde o exemplo
// no OpenAPI gerado; envolvido em allOf, o exemplo aparece e a serialização continua pelo schema.
export function respostaDocumentada(descricao: string, schema: Record<string, unknown>, exemplo: unknown) {
    return { description: descricao, ...("$ref" in schema ? { type: "object", allOf: [schema] } : schema), examples: [exemplo] };
}

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
            tipo: { ...enumDe(TipoEquipamento), description: "Tipo do equipamento (define o prefixo do código de barras)" },
            marca: { ...texto(60, 2), description: "Fabricante" },
            modelo: { ...texto(80, 1), description: "Modelo comercial" },
            anoFabricacao: { type: "integer", minimum: 1970, maximum: 2100, description: "Ano de fabricação (até o ano atual)" },
            estadoFisico: { ...enumDe(EstadoFisico), description: "Estado declarado na entrega, do melhor (NOVO) ao pior (INSERVIVEL)" },
            pesoQuilogramas: { type: "number", exclusiveMinimum: 0, maximum: 2000, description: "Peso em kg, até 3 casas decimais" }
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
            triagemIniciadaEm: nulo("string"), triagemIniciadaPor: nulo("string"),
            triagemConcluidaEm: nulo("string"), triagemConcluidaPor: nulo("string"),
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
    // ---------------------------------------------------------------- AV3
    app.addSchema({
        $id: "ChaveApi", type: "object",
        properties: {
            id: { type: "string" }, nome: { type: "string" }, prefixo: { type: "string" },
            escopos: { type: "array", items: enumDe(EscopoApi) }, plano: enumDe(PlanoApi),
            limites: { type: "object", properties: { requisicoesPorMinuto: { type: "integer" }, relatoriosSimultaneos: { type: "integer" } } },
            organizacaoId: nulo("string"), ativa: { type: "boolean" },
            situacao: { type: "string", enum: ["ATIVA", "INATIVA", "EXPIRADA", "REVOGADA"] },
            expiraEm: nulo("string"), revogadaEm: nulo("string"), ultimoUsoEm: nulo("string"),
            criadaPor: { type: "string" }, criadaEm: dataHora, versao: { type: "integer" }
        }
    });
    app.addSchema({
        $id: "TarefaRelatorio", type: "object",
        properties: {
            id: { type: "string", format: "uuid" },
            tipo: { type: "string", enum: ["EFICIENCIA_OPERACIONAL", "RENTABILIDADE", "VIDA_UTIL", "INVENTARIO_RASTREABILIDADE"] },
            formato: { type: "string", enum: ["JSON", "CSV"] },
            situacao: { type: "string", enum: ["PENDENTE", "PROCESSANDO", "CONCLUIDA", "FALHOU"], description: "PENDENTE → PROCESSANDO → CONCLUIDA ou FALHOU" },
            organizacaoId: nulo("string"), parametros: { type: "object", additionalProperties: true },
            solicitante: { type: "string", description: "Login do usuário ou api:<prefixo> da chave" },
            tentativas: { type: "integer" }, erro: nulo("string"), criadaEm: dataHora,
            iniciadaEm: nulo("string"), concluidaEm: nulo("string"), expiraEm: nulo("string"),
            tamanhoBytes: nulo("integer"), hashConteudo: nulo("string"),
            links: {
                type: "object", description: "Endereços para acompanhar e baixar o relatório",
                properties: { situacao: { type: "string" }, arquivo: nulo("string") }
            }
        }
    });
    app.addSchema({
        $id: "MovimentacaoPublica", type: "object",
        properties: { natureza: enumDe(NaturezaMovimentacao), dataHora, origem: { type: "string" }, destino: { type: "string" }, observacao: { type: "string" } }
    });
    app.addSchema({
        $id: "EquipamentoPublico", type: "object",
        properties: {
            id: { type: "string" }, codigoBarrasInterno: { type: "string" }, tipo: enumDe(TipoEquipamento),
            marca: { type: "string" }, modelo: { type: "string" }, anoFabricacao: { type: "integer" },
            estadoFisico: enumDe(EstadoFisico), pesoQuilogramas: { type: "number" }, loteId: { type: "string" },
            posicaoNoLote: { type: "integer" }, statusRastreamento: enumDe(StatusRastreamento), localizacaoAtual: nulo("string")
        }
    });
    app.addSchema({
        $id: "LotePublico", type: "object",
        properties: {
            id: { type: "string" }, dataEntrada: data, organizacaoId: { type: "string" }, notaFiscal: { type: "string" },
            transportadora: { type: "string" }, statusProcessamento: enumDe(StatusLote), observacoes: { type: "string" },
            quantidadeEquipamentos: { type: "integer" }, pesoTotalKg: { type: "number" },
            triagemIniciadaEm: nulo("string"), triagemConcluidaEm: nulo("string"),
            equipamentos: { type: "array", items: { $ref: "EquipamentoPublico#" } }
        }
    });
    app.addSchema({
        $id: "ExecucaoAnalise", type: "object",
        properties: {
            id: { type: "string" }, tipo: { type: "string" }, origem: { type: "string", enum: ["AGENDADA", "MANUAL"] },
            organizacaoId: nulo("string"), parametros: { type: "object", additionalProperties: true },
            solicitante: { type: "string" }, iniciadaEm: dataHora, concluidaEm: dataHora, duracaoMs: { type: "integer" },
            previsoes: { type: "integer", description: "Previsões individuais gravadas (análise de vida útil)" },
            resultado: { type: "object", additionalProperties: true }
        }
    });
    // Resposta das análises: cabeçalho fixo e o resultado (estrutura própria de cada análise).
    app.addSchema({
        $id: "Analise", type: "object", additionalProperties: true,
        properties: {
            tipo: { type: "string", enum: ["EFICIENCIA_OPERACIONAL", "RENTABILIDADE", "VIDA_UTIL"] },
            geradoEm: dataHora,
            escopo: { type: "object", properties: { organizacaoId: nulo("string"), inicio: nulo("string"), fim: nulo("string") } },
            resultado: { type: "object", additionalProperties: true }
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
