// Exemplos de resposta da documentação da API pública (/api/v1/public/docs). Valores ilustrativos,
// com a mesma forma das respostas reais (conferida por testes: requisitos.test.ts).

const equipamento = {
    id: "EQ-000017", codigoBarrasInterno: "GCNTB00000017", tipo: "NOTEBOOK", marca: "Dell", modelo: "Latitude 5490",
    anoFabricacao: 2019, estadoFisico: "BOM_ESTADO", pesoQuilogramas: 1.9, loteId: "LT-2026-0031", posicaoNoLote: 1,
    statusRastreamento: "AGUARDANDO_TRIAGEM", localizacaoAtual: "Almoxarifado - recebimento"
};

const lote = {
    id: "LT-2026-0031", dataEntrada: "2026-11-19", organizacaoId: "BR001", notaFiscal: "204511",
    transportadora: "TransRapida Logística", statusProcessamento: "RECEBIDO", observacoes: "",
    quantidadeEquipamentos: 1, pesoTotalKg: 1.9, triagemIniciadaEm: null, triagemConcluidaEm: null,
    equipamentos: [equipamento]
};

const { equipamentos: _equipamentos, ...loteResumo } = lote;

const tarefa = {
    id: "3f6b1c2e-8a41-4d7e-9b0a-2c5d7e9f1a23", tipo: "VIDA_UTIL", formato: "CSV", situacao: "PENDENTE",
    organizacaoId: "BR001", parametros: { inicio: null, fim: null }, solicitante: "api:a84077d0c8c0",
    tentativas: 0, erro: null, criadaEm: "2026-11-19T18:20:00.000Z", iniciadaEm: null, concluidaEm: null,
    expiraEm: null, tamanhoBytes: null, hashConteudo: null,
    links: {
        situacao: "/api/v1/public/relatorios/3f6b1c2e-8a41-4d7e-9b0a-2c5d7e9f1a23",
        arquivo: null
    }
};

const escopo = { organizacaoId: "BR001", inicio: null, fim: null };
const resumo = (media: number, mediana: number) => ({ n: 12, media, mediana, desvioPadrao: 0.4, minimo: 0.3, maximo: 2.1, p25: 0.7, p75: 1.3, p90: 1.8 });

export const EXEMPLOS_PUBLICOS = {
    rastreamento: {
        equipamento: { ...equipamento, statusRastreamento: "EM_DESMONTE", localizacaoAtual: "Linha de desmonte 1" },
        lote: { id: "LT-2026-0031", organizacaoId: "BR001", dataEntrada: "2026-11-19", notaFiscal: "204511", statusProcessamento: "ENCAMINHADO" },
        movimentacoes: [
            { natureza: "LOCALIZACAO", dataHora: "2026-11-19T13:02:11.000Z", origem: "Organização BR001 (TransRapida Logística)", destino: "Almoxarifado - recebimento", observacao: "Recebido no lote LT-2026-0031" },
            { natureza: "STATUS", dataHora: "2026-11-21T09:15:40.000Z", origem: "AGUARDANDO_TRIAGEM", destino: "EM_TRIAGEM", observacao: "Início da triagem do lote LT-2026-0031" }
        ],
        depreciacao: 0.4062,
        valorResidual: 2375.2
    },
    listaLotes: { itens: [loteResumo], total: 1, pagina: 1, tamanhoPagina: 20 },
    lote,
    eficiencia: {
        tipo: "EFICIENCIA_OPERACIONAL", geradoEm: "2026-11-19T18:20:00.000Z", escopo,
        resultado: {
            lotesConsiderados: 14, lotesComTriagemConcluida: 12,
            temposDias: { espera: resumo(2.4, 2.1), triagem: resumo(1.0, 0.9), total: resumo(3.4, 3.0) },
            gargalo: { etapa: "ESPERA", participacao: 0.7, descricao: "A maior parte do tempo é a espera entre a entrada do lote e o início da triagem (fila do almoxarifado)." },
            porOperador: [{ operador: "ana.souza", lotes: 5, equipamentos: 22, triagemDias: resumo(0.6, 0.6), horasPorEquipamento: 3.4 }],
            porMes: [{ mes: "2026-10", lotes: 2, totalDias: resumo(3.1, 3.1) }],
            lotesAtipicos: { limiteDias: 7.6, lotes: [] },
            pendencias: { aguardandoTriagem: { quantidade: 1, idade: null, maisAntigo: { loteId: "LT-2026-0031", dias: 0.2 } }, emTriagem: { quantidade: 0, idade: null, maisAntigo: null } }
        }
    },
    rentabilidade: {
        tipo: "RENTABILIDADE", geradoEm: "2026-11-19T18:20:00.000Z", escopo,
        resultado: {
            equipamentos: 31, valorTotalRecuperavel: 18450.3,
            prioridade: [{ posicao: 1, tipo: "SERVIDOR", valorMedio: 6100, valorPorKg: 244 }, { posicao: 2, tipo: "NOTEBOOK", valorMedio: 1250.5, valorPorKg: 658.2 }],
            porTipo: [{ tipo: "NOTEBOOK", quantidade: 9, valorRecuperacao: resumo(1250.5, 1180), valorTotal: 11254.5, participacaoNoValor: 0.61, valorPorKg: 658.2, retornoSobreReferencia: 0.31,
                porEstadoFisico: [{ estadoFisico: "BOM_ESTADO", quantidade: 4, valorMedio: 1640 }], marcas: [{ nome: "Dell", quantidade: 5, valorMedio: 1390 }], modelos: [{ nome: "Dell Latitude 5490", quantidade: 5, valorMedio: 1390 }] }],
            melhoresMarcas: [{ nome: "Dell", quantidade: 5, valorMedio: 1390 }],
            melhoresModelos: [{ nome: "Dell Latitude 5490", quantidade: 5, valorMedio: 1390 }]
        }
    },
    vidaUtil: {
        tipo: "VIDA_UTIL", geradoEm: "2026-11-19T18:20:00.000Z", escopo,
        resultado: {
            equipamentosAnalisados: 31, equipamentosAtivos: 12,
            armazenagemGeral: { exposicaoAnos: 6.2, niveisPerdidos: 6, eventos: 6, taxaAnual: 0.97 },
            modelos: [{ tipo: "NOTEBOOK", metodo: "REGRESSAO_LINEAR", observacoes: 40, inclinacao: 0.29, intercepto: -0.4, r2: 0.56, idadePrevistaInservivelAnos: 22.1,
                armazenagem: { exposicaoAnos: 2.4, niveisPerdidos: 3, eventos: 3, taxaAnual: 1.25, fonte: "TIPO", taxaUsada: 1.25 } }],
            anosRestantes: resumo(2.6, 2.4),
            porTipo: [{ tipo: "NOTEBOOK", equipamentosAtivos: 5, anosRestantes: resumo(2.2, 2.0) }],
            horizonte: { meses: 12, equipamentos: 2 },
            previsoes: [{ equipamentoId: "EQ-000069", tipo: "NOTEBOOK", estadoFisico: "DANIFICADO_GRAVE", idadeAnos: 4.4, anosRestantes: 0.45, dataPrevistaInservivel: "2027-05-01", metodo: "TAXA_ARMAZENAGEM" }]
        },
        previsoesOmitidas: 11
    },
    tarefaCriada: tarefa,
    tarefaConcluida: {
        ...tarefa, situacao: "CONCLUIDA", tentativas: 1, iniciadaEm: "2026-11-19T18:20:01.000Z", concluidaEm: "2026-11-19T18:20:03.000Z",
        expiraEm: "2026-11-22T18:20:03.000Z", tamanhoBytes: 1834, hashConteudo: "9f2c1a7d3e5b4c6a8d0e2f4a6b8c0d2e4f6a8b0c2d4e6f8a0b2c4d6e8f0a2b4c",
        links: { ...tarefa.links, arquivo: `${tarefa.links.situacao}/arquivo` }
    },
    listaTarefas: { itens: [tarefa], total: 1, pagina: 1, tamanhoPagina: 20 },
    arquivoCsv: "equipamento_id,tipo,estado_fisico,idade_anos,anos_restantes,data_prevista_inservivel,metodo\r\n" +
        "EQ-000069,NOTEBOOK,DANIFICADO_GRAVE,4.4,0.45,2027-05-01,TAXA_ARMAZENAGEM\r\n"
};
