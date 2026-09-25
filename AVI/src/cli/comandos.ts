import Comando, { ContextoComando } from "./Comando";
import Argumentos from "./Argumentos";
import Permissao from "../dominio/enums/Permissao";
import PapelUsuario from "../dominio/enums/PapelUsuario";
import EstadoFisico from "../dominio/enums/EstadoFisico";
import StatusRastreamento from "../dominio/enums/StatusRastreamento";
import TipoEquipamento from "../dominio/enums/TipoEquipamento";
import Organizacao from "../dominio/Organizacao";
import Lote from "../dominio/Lote";
import Equipamento from "../dominio/Equipamento";
import HistoricoCompleto from "../dominio/HistoricoCompleto";
import { MINUTOS_INATIVIDADE } from "../dominio/Sessao";
import { localizacaoAtual, naturezaMovimentacao } from "../dominio/rastreamento";
import ValidadorSenha from "../validacao/ValidadorSenha";
import { exigirValido } from "../validacao/Validador";
import { formatarCNPJ } from "../validacao/cnpj";
import { GRUPOS_PARAMETROS } from "../servicos/ServicoParametros";
import { ErroNaoEncontrado, ErroValidacao } from "../comum/erros";
import { lerEnum } from "../comum/enums";
import { formatarData, formatarDataHora } from "../comum/datas";
import { formatarMoeda, formatarPercentual, formatarTabela } from "../comum/Tabela";

const PAPEIS = Object.values(PapelUsuario);
const ESTADOS = Object.values(EstadoFisico);
const STATUS = Object.values(StatusRastreamento);
const TIPOS = Object.values(TipoEquipamento);
const INICIO_DOS_REGISTROS = new Date(2000, 0, 1);

async function lerNovaSenha(ctx: ContextoComando, usuario: string, rotulo = "Nova senha"): Promise<string> {
    const senha = await ctx.entrada.perguntarSenha(`${rotulo}: `);
    if (senha === null) {
        throw new ErroValidacao("Operação cancelada.");
    }
    exigirValido(new ValidadorSenha(), { usuario, senha });
    const confirmacao = await ctx.entrada.perguntarSenha("Confirme a senha: ");
    if (confirmacao !== senha) {
        throw new ErroValidacao("As senhas não conferem.");
    }
    return senha;
}

function inicioDoAno(): Date {
    return new Date(new Date().getFullYear(), 0, 1);
}

function buscarLote(ctx: ContextoComando, id: string): Lote {
    const lote = ctx.app.lote.consultarLotePorPeriodo(INICIO_DOS_REGISTROS, ctx.app.relogio.agora())
        .find(l => l.id === id.trim().toUpperCase());
    if (!lote) {
        throw new ErroNaoEncontrado(`Lote "${id}" não encontrado.`);
    }
    return lote;
}

function mostrarOrganizacao(ctx: ContextoComando, org: Organizacao): void {
    const c = org.contratoVigente;
    ctx.saida.texto([
        `${org.id} — ${org.razaoSocial} (${org.ativo ? "ATIVA" : "DESATIVADA"})`,
        `  CNPJ:        ${formatarCNPJ(org.cnpj)}      IE: ${org.inscricaoEstadual}`,
        `  Endereço:    ${org.enderecoCompleto}`,
        `  Contato:     ${org.email}${org.telefone ? "  /  " + org.telefone : ""}`,
        `  Cadastro:    ${formatarData(org.dataCadastro)}`,
        `  Contrato:    ${c.id} — ${formatarData(c.dataAssinatura)} a ${formatarData(c.dataVencimento)}` +
        ` — ${formatarMoeda(c.valorMensal)}/mês${c.renovacaoAutomatica ? " — renovação automática" : ""}` +
        ` — ${c.estaVigente() ? "VIGENTE" : "NÃO VIGENTE"}`,
        `  Cláusulas:   ${c.clausulas.join("; ")}`
    ].join("\n"));
}

function mostrarLote(ctx: ContextoComando, lote: Lote): void {
    ctx.saida.texto([
        `${lote.id} — ${lote.statusProcessamento}`,
        `  Organização: ${lote.organizacaoId}    NF: ${lote.notaFiscal}    Transportadora: ${lote.transportadora}`,
        `  Entrada:     ${formatarData(lote.dataEntrada)}    Peso total: ${lote.calcularPesoTotal().toFixed(2)} kg    Equipamentos: ${lote.equipamentos.length}`,
        ...(lote.observacoes ? [`  Observações: ${lote.observacoes}`] : [])
    ].join("\n"));
    if (lote.equipamentos.length) {
        ctx.saida.texto(formatarTabela(["#", "ID", "Código", "Tipo", "Marca/Modelo", "Estado", "Status"],
            lote.equipamentos.map(e => [String(e.posicaoNoLote), e.id, e.codigoBarrasInterno, e.tipo,
                `${e.marca} ${e.modelo}`, e.estadoFisico, e.statusRastreamento])));
    }
}

function mostrarEquipamento(ctx: ContextoComando, e: Equipamento): void {
    ctx.saida.texto([
        `${e.id} — ${e.tipo} ${e.marca} ${e.modelo} (${e.anoFabricacao})`,
        `  Código de barras: ${e.codigoBarrasInterno}`,
        `  Lote:             ${e.loteId} (posição ${e.posicaoNoLote})`,
        `  Estado físico:    ${e.estadoFisico}    Peso: ${e.pesoQuilogramas.toFixed(2)} kg`,
        `  Status:           ${e.statusRastreamento}`,
        `  Localização:      ${localizacaoAtual(e) ?? "-"}`
    ].join("\n"));
}

function mostrarHistorico(ctx: ContextoComando, h: HistoricoCompleto): void {
    const e = h.equipamento;
    ctx.saida.titulo(`Rastreabilidade — ${e.id} / ${e.codigoBarrasInterno}`);
    ctx.saida.texto([
        `  Equipamento:  ${e.tipo} ${e.marca} ${e.modelo} (${e.anoFabricacao}), ${e.pesoQuilogramas.toFixed(2)} kg`,
        `  Origem:       ${h.organizacao.id} — ${h.organizacao.razaoSocial} (CNPJ ${formatarCNPJ(h.organizacao.cnpj)})`,
        `  Lote:         ${h.lote.id} — NF ${h.lote.notaFiscal} — ${h.lote.transportadora} — entrada ${formatarData(h.lote.dataEntrada)}`,
        `  Situação:     ${e.statusRastreamento} / ${e.estadoFisico} / local: ${localizacaoAtual(e) ?? "-"}`,
        `  Depreciação:  ${formatarPercentual(h.depreciacao)} — valor residual estimado ${formatarMoeda(h.valorResidual)}`,
        "",
        `Linha do tempo (${h.movimentacoes.length} movimentações):`
    ].join("\n"));
    ctx.saida.texto(formatarTabela(["Data/hora", "Tipo", "De", "Para", "Responsável", "Observação"],
        h.movimentacoes.map(m => [formatarDataHora(m.dataHora), naturezaMovimentacao(m), m.origem, m.destino, m.responsavel, m.observacao])));
    ctx.saida.texto(`\nTrilha de auditoria: ${h.auditoria.length} transações confirmadas no journal envolvendo ${e.id}.`);
}

export const COMANDOS: readonly Comando[] = [
    {
        nome: "ajuda", grupo: "Geral", permissao: null,
        resumo: "Lista os comandos disponíveis ou detalha um comando",
        uso: "ajuda [comando]", exemplo: "ajuda lote criar",
        executar: (args, ctx) => ctx.exibirAjuda(args.posicionais.join(" ") || undefined)
    },
    {
        nome: "menu", grupo: "Geral", permissao: null,
        resumo: "Exibe o menu do seu perfil", uso: "menu",
        executar: (_args, ctx) => ctx.exibirMenu()
    },
    {
        nome: "quem", grupo: "Geral", permissao: null,
        resumo: "Mostra o usuário, o perfil e a validade da sessão", uso: "quem",
        executar: (_args, ctx) => ctx.saida.info(
            `Usuário ${ctx.sessao.usuario} — perfil ${ctx.sessao.papel} — sessão iniciada em ` +
            `${formatarDataHora(ctx.sessao.criacao)}, expira após ${MINUTOS_INATIVIDADE} min de inatividade ` +
            `(prazo atual: ${formatarDataHora(ctx.sessao.expiracao)}).`)
    },
    {
        nome: "senha", grupo: "Geral", permissao: null,
        resumo: "Altera a sua senha", uso: "senha",
        executar: async (_args, ctx) => {
            const atual = await ctx.entrada.perguntarSenha("Senha atual: ");
            if (atual === null) throw new ErroValidacao("Operação cancelada.");
            const nova = await lerNovaSenha(ctx, ctx.sessao.usuario);
            ctx.app.autenticacao.alterarSenha(ctx.sessao.usuario, atual, nova);
            ctx.saida.sucesso("Senha alterada.");
        }
    },
    {
        nome: "limpar", grupo: "Geral", permissao: null,
        resumo: "Limpa a tela", uso: "limpar",
        executar: () => { process.stdout.write("\x1b[2J\x1b[H"); }
    },
    {
        nome: "sair", grupo: "Geral", permissao: null,
        resumo: "Encerra a sessão (logout) e volta à tela de login", uso: "sair",
        executar: (_args, ctx) => ctx.encerrarSessao()
    },
    {
        nome: "encerrar", grupo: "Geral", permissao: null,
        resumo: "Encerra a sessão e fecha o greencode", uso: "encerrar",
        executar: (_args, ctx) => ctx.encerrarPrograma()
    },

    {
        nome: "usuario criar", grupo: "Contas de acesso", permissao: Permissao.USUARIOS_GERENCIAR,
        resumo: "Cria uma conta de acesso (a senha é pedida de forma oculta)",
        uso: "usuario criar <login> --papel <PAPEL>", exemplo: "usuario criar maria --papel AUDITOR",
        opcoes: [{ nome: "papel", descricao: "perfil de acesso", obrigatoria: true, valores: PAPEIS }],
        executar: async (args, ctx) => {
            const login = args.posicional(0, "o login do novo usuário").toLowerCase();
            const papel = lerEnum(PapelUsuario, args.obrigatoria("papel"), "--papel");
            const senha = await lerNovaSenha(ctx, login, "Senha do novo usuário");
            ctx.app.autenticacao.criarUsuario(login, senha, papel);
            ctx.saida.sucesso(`Usuário "${login}" criado com perfil ${papel}.`);
        }
    },
    {
        nome: "usuario listar", grupo: "Contas de acesso", permissao: Permissao.USUARIOS_GERENCIAR,
        resumo: "Lista as contas de acesso", uso: "usuario listar",
        executar: (_args, ctx) => ctx.saida.texto(formatarTabela(["Login", "Perfil", "Último acesso"],
            ctx.app.autenticacao.credenciais.map(c => [c.usuario, c.papel, formatarDataHora(c.ultimoAcesso)])))
    },

    {
        nome: "param listar", grupo: "Parâmetros globais", permissao: Permissao.PARAMETROS_LER,
        resumo: "Mostra alíquotas, coeficientes de depreciação, valores e retenção", uso: "param listar",
        executar: (_args, ctx) => {
            const p = ctx.app.parametros.consultar();
            ctx.saida.texto("Alíquotas de impostos:");
            ctx.saida.texto(formatarTabela(["Imposto", "Alíquota"],
                Object.entries(p.aliquotas).map(([k, v]) => [k, formatarPercentual(v)])));
            ctx.saida.texto("\nDepreciação anual e valor de referência por tipo:");
            ctx.saida.texto(formatarTabela(["Tipo", "Depreciação a.a.", "Valor referência"],
                TIPOS.map(t => [t, formatarPercentual(p.coeficientesDepreciacao[t]), formatarMoeda(p.valoresReferencia[t])])));
            ctx.saida.texto(`\nRetenção do journal: ${p.retencaoJournalDias} dias`);
        }
    },
    {
        nome: "param definir", grupo: "Parâmetros globais", permissao: Permissao.PARAMETROS_GERENCIAR,
        resumo: "Altera um parâmetro global",
        uso: "param definir <aliquota|depreciacao|valor|retencao> <chave> <valor>",
        exemplo: "param definir depreciacao NOTEBOOK 0.25   |   param definir aliquota ISS 0.05   |   param definir retencao dias 365",
        posicionais: [{ nome: "grupo", valores: GRUPOS_PARAMETROS }, { nome: "chave", valores: TIPOS }],
        executar: (args, ctx) => {
            const grupo = args.posicional(0, "o grupo (aliquota, depreciacao, valor ou retencao)");
            const chave = args.posicional(1, "a chave (imposto ou tipo de equipamento)");
            const valor = Argumentos.converterNumero(args.posicional(2, "o valor"), "valor");
            ctx.app.parametros.definir(grupo, chave, valor);
            ctx.saida.sucesso(`Parâmetro ${grupo}.${chave.toUpperCase()} = ${valor}.`);
        }
    },

    {
        nome: "org criar", grupo: "Organizações e contratos", permissao: Permissao.ORGANIZACOES_ESCREVER,
        resumo: "Cadastra uma organização cliente e seu contrato de coleta (CNPJ validado e único)",
        uso: "org criar --razao <razão social> --cnpj <CNPJ> --email <e-mail> --endereco <endereço> " +
            "--vencimento <data> --valor <R$/mês> --clausulas <c1; c2> [--assinatura <data>] [--renovacao-auto] [--ie <IE>] [--telefone <tel>]",
        exemplo: 'org criar --razao "Banco Horizonte S.A." --cnpj 11.222.333/0001-81 --email ti@horizonte.com.br ' +
            '--endereco "Av. Paulista, 1000, São Paulo/SP" --vencimento 2027-12-31 --valor 4500 --clausulas "Coleta mensal; Laudo"',
        opcoes: [
            { nome: "razao", descricao: "razão social", obrigatoria: true },
            { nome: "cnpj", descricao: "CNPJ (numérico ou alfanumérico)", obrigatoria: true },
            { nome: "email", descricao: "e-mail de contato", obrigatoria: true },
            { nome: "endereco", descricao: "endereço completo", obrigatoria: true },
            { nome: "vencimento", descricao: "vencimento do contrato de coleta", obrigatoria: true },
            { nome: "valor", descricao: "valor mensal do contrato em R$", obrigatoria: true },
            { nome: "clausulas", descricao: "cláusulas separadas por ';'", obrigatoria: true },
            { nome: "assinatura", descricao: "data de assinatura (padrão: hoje)" },
            { nome: "renovacao-auto", descricao: "renova automaticamente ao vencer", flag: true },
            { nome: "ie", descricao: "inscrição estadual (padrão: ISENTO)" },
            { nome: "telefone", descricao: "telefone com DDD" }
        ],
        executar: (args, ctx) => {
            const org = ctx.app.organizacao.cadastrarOrganizacao({
                razaoSocial: args.obrigatoria("razao"), cnpj: args.obrigatoria("cnpj"),
                email: args.obrigatoria("email"), enderecoCompleto: args.obrigatoria("endereco"),
                inscricaoEstadual: args.texto("ie"), telefone: args.texto("telefone"),
                contrato: {
                    dataAssinatura: args.data("assinatura") ?? ctx.app.relogio.agora(),
                    dataVencimento: args.data("vencimento")!,
                    valorMensal: args.numero("valor")!,
                    clausulas: args.obrigatoria("clausulas").split(";"),
                    renovacaoAutomatica: args.flag("renovacao-auto")
                }
            });
            ctx.saida.sucesso(`Organização ${org.id} cadastrada: ${org.razaoSocial} (CNPJ ${formatarCNPJ(org.cnpj)}), ` +
                `contrato ${org.contratoVigente.id} até ${formatarData(org.contratoVigente.dataVencimento)}.`);
        }
    },
    {
        nome: "org listar", grupo: "Organizações e contratos", permissao: Permissao.ORGANIZACOES_LER,
        resumo: "Lista as organizações ativas", uso: "org listar",
        executar: (_args, ctx) => {
            const lista = ctx.app.organizacao.listarOrganizacoesAtivas();
            if (!lista.length) { ctx.saida.info("Nenhuma organização ativa."); return; }
            ctx.saida.texto(formatarTabela(["ID", "Razão social", "CNPJ", "Contrato"],
                lista.map(o => [o.id, o.razaoSocial, formatarCNPJ(o.cnpj),
                    `${o.contratoVigente.id} (${o.contratoVigente.estaVigente() ? "vigente" : "vencido"})`])));
        }
    },
    {
        nome: "org ver", grupo: "Organizações e contratos", permissao: Permissao.ORGANIZACOES_LER,
        resumo: "Detalha uma organização e seu contrato", uso: "org ver <ID>", exemplo: "org ver BR001",
        executar: (args, ctx) => mostrarOrganizacao(ctx, ctx.app.organizacao.buscarOrganizacao(args.posicional(0, "o ID da organização")))
    },
    {
        nome: "contrato renovar", grupo: "Organizações e contratos", permissao: Permissao.ORGANIZACOES_ESCREVER,
        resumo: "Prorroga o vencimento do contrato vigente", uso: "contrato renovar --org <ID> --vencimento <data>",
        opcoes: [
            { nome: "org", descricao: "ID da organização", obrigatoria: true },
            { nome: "vencimento", descricao: "novo vencimento", obrigatoria: true }
        ],
        executar: (args, ctx) => {
            const vencimento = args.data("vencimento")!;
            ctx.app.organizacao.renovarContrato(args.obrigatoria("org"), vencimento);
            ctx.saida.sucesso(`Contrato de ${args.obrigatoria("org").toUpperCase()} renovado até ${formatarData(vencimento)}.`);
        }
    },

    {
        nome: "lote criar", grupo: "Almoxarifado — lotes", permissao: Permissao.LOTES_ESCREVER,
        resumo: "Registra a chegada de um lote (entrada até 90 dias atrás, nunca futura)",
        uso: "lote criar --org <ID> --nf <número> --transp <transportadora> [--data <data de entrada>] [--obs <texto>]",
        exemplo: "lote criar --org BR001 --nf 123456 --transp TransRapida",
        opcoes: [
            { nome: "org", descricao: "ID da organização geradora", obrigatoria: true },
            { nome: "nf", descricao: "número da nota fiscal", obrigatoria: true },
            { nome: "transp", descricao: "transportadora", obrigatoria: true },
            { nome: "data", descricao: "data de entrada (padrão: hoje)" },
            { nome: "obs", descricao: "observações" }
        ],
        executar: (args, ctx) => {
            const lote = ctx.app.lote.criarLote({
                organizacaoId: args.obrigatoria("org"), notaFiscal: args.obrigatoria("nf"),
                transportadora: args.obrigatoria("transp"), dataEntrada: args.data("data"), observacoes: args.texto("obs")
            });
            ctx.saida.sucesso(`Lote ${lote.id} criado para ${lote.organizacaoId} (NF ${lote.notaFiscal}, ${lote.transportadora}).`);
        }
    },
    {
        nome: "lote listar", grupo: "Almoxarifado — lotes", permissao: Permissao.LOTES_LER,
        resumo: "Lista lotes por período de entrada, opcionalmente de uma organização",
        uso: "lote listar [--de <data>] [--ate <data>] [--org <ID>]",
        opcoes: [
            { nome: "de", descricao: "entrada a partir de" },
            { nome: "ate", descricao: "entrada até (padrão: hoje)" },
            { nome: "org", descricao: "filtra por organização" }
        ],
        executar: (args, ctx) => {
            const org = args.texto("org")?.toUpperCase();
            const lotes = ctx.app.lote.consultarLotePorPeriodo(args.data("de") ?? INICIO_DOS_REGISTROS, args.data("ate") ?? ctx.app.relogio.agora())
                .filter(l => !org || l.organizacaoId === org);
            if (!lotes.length) { ctx.saida.info("Nenhum lote encontrado."); return; }
            ctx.saida.texto(formatarTabela(["ID", "Org.", "Entrada", "NF", "Transportadora", "Equip.", "Status"],
                lotes.map(l => [l.id, l.organizacaoId, formatarData(l.dataEntrada), l.notaFiscal, l.transportadora,
                    String(l.equipamentos.length), l.statusProcessamento])));
        }
    },
    {
        nome: "lote ver", grupo: "Almoxarifado — lotes", permissao: Permissao.LOTES_LER,
        resumo: "Detalha um lote e seus equipamentos", uso: "lote ver <ID>",
        executar: (args, ctx) => mostrarLote(ctx, buscarLote(ctx, args.posicional(0, "o ID do lote")))
    },
    {
        nome: "lote triagem", grupo: "Almoxarifado — lotes", permissao: Permissao.LOTES_ESCREVER,
        resumo: "Processa a triagem: 1ª vez inicia (equipamentos em triagem); 2ª vez conclui",
        uso: "lote triagem <ID>",
        executar: (args, ctx) => {
            const id = args.posicional(0, "o ID do lote");
            ctx.app.lote.processarTriagem(id);
            const lote = buscarLote(ctx, id);
            ctx.saida.sucesso(lote.statusProcessamento === "EM_TRIAGEM"
                ? `Triagem do lote ${lote.id} iniciada para ${lote.equipamentos.length} equipamento(s). ` +
                  `Reclassifique o estado físico com "equip estado" e conclua com "lote triagem ${lote.id}".`
                : `Triagem do lote ${lote.id} concluída: os equipamentos podem ser encaminhados.`);
        }
    },

    {
        nome: "equip adicionar", grupo: "Almoxarifado — equipamentos", permissao: Permissao.LOTES_ESCREVER,
        resumo: "Inclui um equipamento no lote e aloca o código de barras interno",
        uso: "equip adicionar --lote <ID> --tipo <TIPO> --marca <marca> --modelo <modelo> --ano <ano> --estado <ESTADO> --peso <kg>",
        exemplo: "equip adicionar --lote LT-2026-0001 --tipo NOTEBOOK --marca Dell --modelo \"Latitude 5490\" --ano 2019 --estado BOM_ESTADO --peso 1.9",
        opcoes: [
            { nome: "lote", descricao: "ID do lote", obrigatoria: true },
            { nome: "tipo", descricao: "tipo de equipamento", obrigatoria: true, valores: TIPOS },
            { nome: "marca", descricao: "fabricante", obrigatoria: true },
            { nome: "modelo", descricao: "modelo", obrigatoria: true },
            { nome: "ano", descricao: "ano de fabricação", obrigatoria: true },
            { nome: "estado", descricao: "estado físico declarado", obrigatoria: true, valores: ESTADOS },
            { nome: "peso", descricao: "peso em kg", obrigatoria: true }
        ],
        executar: (args, ctx) => {
            const equipamento = ctx.app.fabricaEquipamento.criar({
                tipo: lerEnum(TipoEquipamento, args.obrigatoria("tipo"), "--tipo"),
                marca: args.obrigatoria("marca"), modelo: args.obrigatoria("modelo"),
                anoFabricacao: args.numero("ano")!, estadoFisico: args.estado("estado")!, pesoQuilogramas: args.numero("peso")!
            });
            ctx.app.lote.adicionarEquipamentoLote(args.obrigatoria("lote"), equipamento);
            ctx.saida.sucesso(`Equipamento ${equipamento.id} incluído no lote ${equipamento.loteId} — código de barras ${equipamento.codigoBarrasInterno}.`);
        }
    },
    {
        nome: "equip ver", grupo: "Almoxarifado — equipamentos", permissao: Permissao.EQUIPAMENTOS_LER,
        resumo: "Detalha um equipamento (por ID ou código de barras)", uso: "equip ver <ID|código>",
        executar: (args, ctx) => mostrarEquipamento(ctx, ctx.app.equipamento.rastrearEquipamento(args.posicional(0, "o ID ou código de barras")).equipamento)
    },
    {
        nome: "equip estado", grupo: "Almoxarifado — equipamentos", permissao: Permissao.EQUIPAMENTOS_ESCREVER,
        resumo: "Classifica/reclassifica o estado físico (queda de 2+ categorias exige justificativa)",
        uso: "equip estado <ID|código> --estado <ESTADO> [--justificativa <texto>]",
        exemplo: 'equip estado EQ-000002 --estado DANIFICADO_GRAVE --justificativa "Painel quebrado na coleta"',
        opcoes: [
            { nome: "estado", descricao: "novo estado físico", obrigatoria: true, valores: ESTADOS },
            { nome: "justificativa", descricao: "obrigatória se o estado cair 2+ categorias" }
        ],
        executar: (args, ctx) => {
            const id = args.posicional(0, "o ID ou código de barras");
            const estado = args.estado("estado")!;
            const justificativa = args.texto("justificativa");
            if (justificativa === undefined) {
                ctx.app.equipamento.atualizarEstadoFisico(id, estado);
            } else {
                ctx.app.equipamento.atualizarEstadoFisicoJustificado(id, estado, justificativa);
            }
            ctx.saida.sucesso(`Estado físico de ${id.toUpperCase()} alterado para ${estado}.`);
        }
    },
    {
        nome: "equip status", grupo: "Almoxarifado — equipamentos", permissao: Permissao.EQUIPAMENTOS_ESCREVER,
        resumo: "Avança o status de rastreamento (desmonte exige triagem completa)",
        uso: "equip status <ID|código> <STATUS> [--justificativa <texto>]",
        exemplo: "equip status EQ-000001 AGUARDANDO_DESMONTE",
        opcoes: [{ nome: "justificativa", descricao: "observação da mudança" }],
        posicionais: [{ nome: "equipamento" }, { nome: "status", valores: STATUS }],
        executar: (args, ctx) => {
            const id = args.posicional(0, "o ID ou código de barras");
            const status = lerEnum(StatusRastreamento, args.posicional(1, "o novo status"), "status");
            ctx.app.equipamento.atualizarStatus(id, status, args.texto("justificativa") ?? "");
            ctx.saida.sucesso(`Equipamento ${id.toUpperCase()} agora está em ${status}.`);
        }
    },
    {
        nome: "equip mover", grupo: "Almoxarifado — equipamentos", permissao: Permissao.EQUIPAMENTOS_ESCREVER,
        resumo: "Registra a movimentação física do equipamento",
        uso: "equip mover <ID|código> --destino <local>",
        exemplo: 'equip mover EQ-000001 --destino "Galpão B / Bancada 3"',
        opcoes: [{ nome: "destino", descricao: "novo local", obrigatoria: true }],
        executar: (args, ctx) => {
            const id = args.posicional(0, "o ID ou código de barras");
            ctx.app.equipamento.registrarMovimentacao(id, args.obrigatoria("destino"));
            ctx.saida.sucesso(`Equipamento ${id.toUpperCase()} movido para "${args.obrigatoria("destino").trim()}".`);
        }
    },
    {
        nome: "equip rastrear", grupo: "Almoxarifado — equipamentos", permissao: Permissao.EQUIPAMENTOS_LER,
        resumo: "Rastreabilidade completa: origem, lote e todas as movimentações", uso: "equip rastrear <ID|código>",
        executar: (args, ctx) => mostrarHistorico(ctx, ctx.app.equipamento.rastrearEquipamento(args.posicional(0, "o ID ou código de barras")))
    },

    {
        nome: "relatorio organizacao", grupo: "Relatórios", permissao: Permissao.RELATORIOS_GERAR,
        resumo: "Lotes, pesos e status dos equipamentos de uma organização",
        uso: "relatorio organizacao <ID> [--de <data>] [--ate <data>]",
        opcoes: [{ nome: "de", descricao: "início (padrão: 01/01 do ano)" }, { nome: "ate", descricao: "fim (padrão: hoje)" }],
        executar: (args, ctx) => ctx.saida.texto(ctx.app.relatorio.gerarRelatorioPorOrganizacao(
            args.posicional(0, "o ID da organização"),
            { inicio: args.data("de") ?? inicioDoAno(), fim: args.data("ate") ?? ctx.app.relogio.agora() }))
    },
    {
        nome: "relatorio status", grupo: "Relatórios", permissao: Permissao.RELATORIOS_GERAR,
        resumo: "Equipamentos em um status de rastreamento", uso: "relatorio status <STATUS>",
        posicionais: [{ nome: "status", valores: STATUS }],
        executar: (args, ctx) => ctx.saida.texto(ctx.app.relatorio.gerarRelatorioPorStatus(
            lerEnum(StatusRastreamento, args.posicional(0, "o status"), "status")))
    },
    {
        nome: "relatorio financeiro", grupo: "Relatórios", permissao: Permissao.RELATORIOS_GERAR,
        resumo: "Valor de recuperação, depreciação e tributos dos equipamentos recebidos",
        uso: "relatorio financeiro [--de <data>] [--ate <data>]",
        opcoes: [{ nome: "de", descricao: "início (padrão: 01/01 do ano)" }, { nome: "ate", descricao: "fim (padrão: hoje)" }],
        executar: (args, ctx) => ctx.saida.texto(ctx.app.relatorio.gerarRelatorioFinanceiro(
            { inicio: args.data("de") ?? inicioDoAno(), fim: args.data("ate") ?? ctx.app.relogio.agora() }))
    },
    {
        nome: "relatorio triagem", grupo: "Relatórios", permissao: Permissao.LOTES_LER,
        resumo: "Resultado da triagem de um lote", uso: "relatorio triagem <LOTE>",
        executar: (args, ctx) => ctx.saida.texto(buscarLote(ctx, args.posicional(0, "o ID do lote")).gerarRelatorioTriagem())
    },

    {
        nome: "journal listar", grupo: "Auditoria", permissao: Permissao.JOURNAL_LER,
        resumo: "Consulta a trilha de auditoria (transações e eventos de acesso)",
        uso: "journal listar [--usuario <login>] [--entidade <ID>] [--operacao <texto>] [--limite <n>]",
        opcoes: [
            { nome: "usuario", descricao: "filtra por usuário" },
            { nome: "entidade", descricao: "filtra por ID de entidade (ex.: EQ-000001, BR001)" },
            { nome: "operacao", descricao: "filtra por operação (ex.: LOGIN, LOTE)" },
            { nome: "limite", descricao: "quantidade máxima (padrão 50)" }
        ],
        executar: (args, ctx) => {
            const registros = ctx.app.auditoria.listar({
                usuario: args.texto("usuario"), entidade: args.texto("entidade"),
                operacao: args.texto("operacao"), limite: args.numero("limite")
            });
            if (!registros.length) { ctx.saida.info("Nenhum registro encontrado."); return; }
            ctx.saida.texto(formatarTabela(["Data/hora", "Operação", "Usuário", "Entidade", "Situação", "Transação"],
                registros.map(r => [formatarDataHora(r.timestamp), r.operacao, r.usuario, r.entidade, r.situacao, r.id.slice(0, 8)])));
        }
    },
    {
        nome: "journal verificar", grupo: "Auditoria", permissao: Permissao.JOURNAL_LER,
        resumo: "Verifica a integridade da cadeia de hashes do journal", uso: "journal verificar",
        executar: (_args, ctx) => {
            const r = ctx.app.auditoria.verificar();
            const resumo = `${r.arquivos} arquivo(s), ${r.linhas} registro(s), ${r.transacoes} transação(ões) confirmada(s).`;
            if (r.integro) {
                ctx.saida.sucesso(`Journal íntegro: ${resumo}`);
            } else {
                ctx.saida.critico(`Journal com ${r.problemas.length} problema(s) de integridade (${resumo})\n${r.problemas.join("\n")}`);
            }
        }
    },
    {
        nome: "journal reverter", grupo: "Auditoria", permissao: Permissao.JOURNAL_REVERTER,
        resumo: "Desfaz uma transação por compensação (o journal nunca é apagado)",
        uso: "journal reverter <ID da transação (8+ primeiros caracteres)>",
        executar: async (args, ctx) => {
            const transacao = args.posicional(0, "o identificador da transação");
            const confirmacao = await ctx.entrada.perguntar(`Confirma a reversão da transação ${transacao}? (s/N) `);
            if (confirmacao?.trim().toLowerCase() !== "s") {
                ctx.saida.info("Reversão cancelada.");
                return;
            }
            if (ctx.app.auditoria.reverter(transacao)) {
                ctx.saida.sucesso(`Transação ${transacao} revertida por meio de uma transação compensatória.`);
            } else {
                ctx.saida.aviso("Reversão recusada: as entidades foram alteradas depois dessa transação.");
            }
        }
    }
];
