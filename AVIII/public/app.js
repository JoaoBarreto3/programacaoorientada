// greencode — front-end SPA (JavaScript puro, sem etapa de build).
// Consome a API interna em /api/v1/internal, guarda o token JWT na sessão do navegador e adapta o menu
// ao papel do usuário. Toda a regra de negócio fica no servidor; aqui só há apresentação.
"use strict";

const API = "/api/v1/internal";
const CHAVE_TOKEN = "greencode.token";

const ENUMS = {
    papel: ["ADMINISTRADOR", "OPERADOR_CADASTRO", "GESTOR_ALMOXARIFADO", "AUDITOR"],
    statusLote: ["RECEBIDO", "EM_TRIAGEM", "TRIAGEM_CONCLUIDA", "ENCAMINHADO", "FINALIZADO"],
    tipo: ["COMPUTADOR_MESA", "NOTEBOOK", "MONITOR", "IMPRESSORA", "SERVIDOR", "ROTEADOR", "CABO_ESTRUTURADO", "FONTE_ALIMENTACAO"],
    estado: ["NOVO", "BOM_ESTADO", "USADO_LEVE", "USADO_MODERADO", "DANIFICADO_LEVE", "DANIFICADO_GRAVE", "INSERVIVEL"],
    status: ["AGUARDANDO_TRIAGEM", "EM_TRIAGEM", "AGUARDANDO_DESMONTE", "EM_DESMONTE", "PECAS_REAPROVEITADAS", "MATERIAL_RECICLAVEL", "DESCARTE_SEGURO", "BAIXA_DEFINITIVA"]
};

// Mesma máquina de estados do servidor: usada só para oferecer as opções válidas.
const TRANSICOES = {
    AGUARDANDO_TRIAGEM: ["EM_TRIAGEM"],
    EM_TRIAGEM: ["AGUARDANDO_DESMONTE", "PECAS_REAPROVEITADAS", "DESCARTE_SEGURO"],
    AGUARDANDO_DESMONTE: ["EM_DESMONTE"],
    EM_DESMONTE: ["PECAS_REAPROVEITADAS", "MATERIAL_RECICLAVEL", "DESCARTE_SEGURO"],
    PECAS_REAPROVEITADAS: ["BAIXA_DEFINITIVA"],
    MATERIAL_RECICLAVEL: ["BAIXA_DEFINITIVA"],
    DESCARTE_SEGURO: ["BAIXA_DEFINITIVA"],
    BAIXA_DEFINITIVA: []
};

const estado = { token: lerToken(), usuario: null, permissoes: new Set() };
const $ = seletor => document.querySelector(seletor);
const conteudo = $("#conteudo");

// ------------------------------------------------------------------ utilitários

function lerToken() {
    try { return sessionStorage.getItem(CHAVE_TOKEN); } catch { return null; }
}

function guardarToken(token) {
    estado.token = token;
    try {
        if (token) sessionStorage.setItem(CHAVE_TOKEN, token); else sessionStorage.removeItem(CHAVE_TOKEN);
    } catch { /* navegação privada: o token fica só em memória */ }
}

function esc(valor) {
    return String(valor ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

const rotuloTexto = valor => String(valor ?? "").replace(/_/g, " ").toLowerCase().replace(/^./, c => c.toUpperCase());
const rotulo = valor => esc(rotuloTexto(valor));
const fmtData = iso => iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—";
const fmtDataHora = iso => iso ? new Date(iso).toLocaleString("pt-BR") : "—";
const fmtMoeda = v => Number(v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtNumero = (v, casas = 2) => Number(v ?? 0).toLocaleString("pt-BR", { maximumFractionDigits: casas });
const fmtPercentual = v => (Number(v ?? 0) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) + "%";
const fmtCNPJ = c => c && c.length === 14 ? `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}` : esc(c);
const hojeISO = () => { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())).toISOString().slice(0, 10); };
const opcoes = (valores, selecionado, vazio) =>
    (vazio !== undefined ? `<option value="">${esc(vazio)}</option>` : "") +
    valores.map(v => `<option value="${esc(v)}"${v === selecionado ? " selected" : ""}>${rotulo(v)}</option>`).join("");

function etiquetaStatus(valor) {
    const ok = ["BAIXA_DEFINITIVA", "FINALIZADO", "PECAS_REAPROVEITADAS", "MATERIAL_RECICLAVEL", "TRIAGEM_CONCLUIDA", "ENCAMINHADO"];
    const alerta = ["EM_TRIAGEM", "AGUARDANDO_DESMONTE", "EM_DESMONTE", "AGUARDANDO_TRIAGEM", "RECEBIDO"];
    const classe = ok.includes(valor) ? "ok" : alerta.includes(valor) ? "alerta" : "ruim";
    return `<span class="etiqueta ${classe}">${rotulo(valor)}</span>`;
}

function pode(permissao) {
    return estado.permissoes.has(permissao);
}

function avisar(mensagem, severidade = "SUCESSO") {
    const titulos = { SUCESSO: "Concluído", INFO: "Informação", AVISO: "Atenção", ERRO: "Erro", CRITICO: "Erro crítico" };
    const caixa = document.createElement("div");
    caixa.className = `aviso ${severidade}`;
    caixa.setAttribute("role", severidade === "ERRO" || severidade === "CRITICO" ? "alert" : "status");
    caixa.innerHTML = `<strong>${esc(titulos[severidade] ?? severidade)}</strong>${esc(mensagem)}`;
    $("#avisos").append(caixa);
    setTimeout(() => caixa.remove(), severidade === "SUCESSO" ? 3500 : 7000);
}

class ErroApi extends Error {
    constructor(status, erro) {
        super(erro?.mensagem ?? `Falha na requisição (HTTP ${status}).`);
        this.status = status;
        this.severidade = erro?.severidade ?? "ERRO";
        // true quando o 401 encerrou a sessão (o aviso já foi dado); um login recusado continua false.
        this.sessaoEncerrada = false;
    }
}

async function api(metodo, rota, corpo) {
    const resposta = await fetch(API + rota, {
        method: metodo,
        headers: {
            ...(corpo !== undefined ? { "content-type": "application/json" } : {}),
            ...(estado.token ? { authorization: `Bearer ${estado.token}` } : {})
        },
        body: corpo !== undefined ? JSON.stringify(corpo) : undefined
    });
    // Renovação deslizante: a cada uso o servidor devolve um token com mais 30 minutos.
    const renovado = resposta.headers.get("x-token-renovado");
    if (renovado) guardarToken(renovado);
    const texto = await resposta.text();
    const dados = texto ? JSON.parse(texto) : null;
    if (!resposta.ok) {
        const erro = new ErroApi(resposta.status, dados?.erro);
        if (resposta.status === 401 && estado.token && !rota.startsWith("/auth/login")) {
            encerrarSessao(dados?.erro?.mensagem ?? "Sessão expirada.");
            erro.sessaoEncerrada = true;
        }
        throw erro;
    }
    return dados;
}

// Envolve um tratador de evento: erros viram avisos na tela.
function tratar(funcao) {
    return async evento => {
        try {
            await funcao(evento);
        } catch (erro) {
            if (erro instanceof ErroApi && erro.sessaoEncerrada) return;
            avisar(erro.message, erro.severidade ?? "ERRO");
            if (erro.status === 409) avisar("Os dados foram alterados por outra pessoa. A tela foi recarregada.", "AVISO");
            if (erro.status === 409) await renderizar();
        }
    };
}

function formularioParaObjeto(form) {
    const dados = {};
    for (const campo of form.elements) {
        if (!campo.name || campo.disabled) continue;
        if (campo.type === "checkbox") dados[campo.name] = campo.checked;
        else if (campo.type === "number") { if (campo.value !== "") dados[campo.name] = Number(campo.value); }
        else if (campo.value.trim() !== "") dados[campo.name] = campo.value.trim();
    }
    return dados;
}

// Diálogo modal genérico: campos em HTML, confirmação assíncrona e erros exibidos sem fechar.
function abrirDialogo(titulo, camposHtml, aoConfirmar, textoBotao = "Salvar", classeBotao = "") {
    const dialogo = $("#dialogo");
    const form = $("#dialogo-form");
    form.innerHTML = `<h2>${esc(titulo)}</h2>${camposHtml}
        <div class="rodape-dialogo">
            <button type="button" class="botao secundario" value="cancelar">Cancelar</button>
            <button type="submit" class="botao ${classeBotao}" value="ok">${esc(textoBotao)}</button>
        </div>`;
    form.querySelector('[value="cancelar"]').onclick = () => dialogo.close();
    form.onsubmit = async evento => {
        evento.preventDefault();
        const botao = form.querySelector('[type="submit"]');
        botao.disabled = true;
        try {
            await aoConfirmar(form);
            dialogo.close();
            await renderizar();
        } catch (erro) {
            if (!(erro instanceof ErroApi && erro.sessaoEncerrada)) avisar(erro.message, erro.severidade ?? "ERRO");
            if (erro.status === 409) { dialogo.close(); await renderizar(); }
        } finally {
            botao.disabled = false;
        }
    };
    dialogo.showModal();
    form.querySelector("input, select, textarea")?.focus();
    return form;
}

function confirmar(mensagem, acao, textoBotao = "Excluir") {
    abrirDialogo("Confirmar", `<p>${esc(mensagem)}</p>`, async () => {
        await acao();
    }, textoBotao, "perigo");
}

function tabela(cabecalhos, linhas, vazio = "Nenhum registro encontrado.") {
    if (!linhas.length) return `<div class="tabela-envoltorio"><div class="vazio">${esc(vazio)}</div></div>`;
    const th = cabecalhos.map(c => typeof c === "string" ? `<th>${esc(c)}</th>` : `<th class="${c.classe}">${esc(c.texto)}</th>`).join("");
    return `<div class="tabela-envoltorio"><table><thead><tr>${th}</tr></thead><tbody>${linhas.map(l => `<tr>${l.join("")}</tr>`).join("")}</tbody></table></div>`;
}
const td = (html, classe = "") => `<td${classe ? ` class="${classe}"` : ""}>${html}</td>`;

function paginacao(resultado, irPara) {
    const paginas = Math.max(1, Math.ceil(resultado.total / resultado.tamanhoPagina));
    const div = document.createElement("div");
    div.className = "paginacao";
    div.innerHTML = `<span>${resultado.total} registro(s) · página ${resultado.pagina} de ${paginas}</span>
        <button class="botao secundario pequeno" ${resultado.pagina <= 1 ? "disabled" : ""} data-p="${resultado.pagina - 1}">Anterior</button>
        <button class="botao secundario pequeno" ${resultado.pagina >= paginas ? "disabled" : ""} data-p="${resultado.pagina + 1}">Próxima</button>`;
    div.querySelectorAll("button").forEach(b => b.onclick = () => irPara(Number(b.dataset.p)));
    return div;
}

function consulta(parametros) {
    const p = new URLSearchParams();
    for (const [chave, valor] of Object.entries(parametros)) if (valor !== undefined && valor !== "" && valor !== null) p.set(chave, valor);
    const texto = p.toString();
    return texto ? `?${texto}` : "";
}

// ------------------------------------------------------------------ sessão

async function carregarUsuario() {
    const eu = await api("GET", "/auth/eu");
    estado.usuario = eu;
    estado.permissoes = new Set(eu.permissoes);
}

function encerrarSessao(mensagem) {
    guardarToken(null);
    estado.usuario = null;
    estado.permissoes = new Set();
    if (mensagem) avisar(mensagem, "AVISO");
    location.hash = "#/login";
    renderizar();
}

$("#botao-sair").onclick = tratar(async () => {
    try { await api("POST", "/auth/logout"); } finally { encerrarSessao("Sessão encerrada."); }
});

const ITENS_MENU = [
    ["#/painel", "Painel", null],
    ["#/organizacoes", "Organizações", "ORGANIZACOES_LER"],
    ["#/lotes", "Lotes", "LOTES_LER"],
    ["#/equipamentos", "Equipamentos", "EQUIPAMENTOS_LER"],
    ["#/relatorios", "Relatórios", "RELATORIOS_GERAR"],
    ["#/analises", "Análises", "ANALISES_LER"],
    ["#/tarefas", "Relatórios em segundo plano", "RELATORIOS_ASSINCRONOS"],
    ["#/chaves-api", "Chaves de API", "CHAVES_API_GERENCIAR"],
    ["#/auditoria", "Auditoria", "AUDITORIA_LER"],
    ["#/usuarios", "Usuários", "USUARIOS_GERENCIAR"],
    ["#/parametros", "Parâmetros", "PARAMETROS_LER"],
    ["#/conta", "Minha conta", null]
];

function montarTopo() {
    const logado = Boolean(estado.usuario);
    $("#topo").hidden = !logado;
    if (!logado) return;
    $("#usuario-nome").textContent = `${estado.usuario.login} · ${rotuloTexto(estado.usuario.papel)}`;
    // Menu adaptado ao papel: só aparecem as áreas que o usuário pode acessar.
    const atual = location.hash.split("/").slice(0, 2).join("/");
    $("#menu").innerHTML = ITENS_MENU.filter(([, , permissao]) => !permissao || pode(permissao))
        .map(([href, texto]) => `<a href="${href}"${href === atual ? ' class="ativo" aria-current="page"' : ""}>${esc(texto)}</a>`).join("");
}

// ------------------------------------------------------------------ telas

async function telaLogin() {
    const { necessario } = await api("GET", "/provisionamento");
    conteudo.innerHTML = `<div class="tela-login"><form class="cartao" id="form-login">
        <div class="marca"><span class="logo">g</span> greencode</div>
        <p class="subtitulo">${necessario
            ? "Primeiro acesso: defina o administrador do sistema (provisionamento inicial)."
            : "Logística reversa de resíduos eletrônicos. Entre com a sua conta."}</p>
        <label>Usuário <input name="login" autocomplete="username" required value="${necessario ? "admin" : ""}"></label>
        <label>Senha <input name="senha" type="password" autocomplete="${necessario ? "new-password" : "current-password"}" required></label>
        ${necessario ? `<label>Confirme a senha <input name="confirmacao" type="password" autocomplete="new-password" required></label>
            <small class="subtitulo">Mínimo de 8 caracteres, com letras e números, sem conter o nome de usuário.</small>` : ""}
        <button class="botao" type="submit">${necessario ? "Provisionar e entrar" : "Entrar"}</button>
    </form></div>`;
    $("#form-login").onsubmit = tratar(async evento => {
        evento.preventDefault();
        const dados = formularioParaObjeto(evento.target);
        if (necessario && dados.senha !== dados.confirmacao) throw new Error("As senhas não conferem.");
        const sessao = await api("POST", necessario ? "/provisionamento" : "/auth/login", { login: dados.login, senha: dados.senha });
        guardarToken(sessao.token);
        await carregarUsuario();
        location.hash = "#/painel";
    });
}

async function telaPainel() {
    const p = await api("GET", "/relatorios/painel");
    const equipamentos = Object.values(p.equipamentosPorStatus).reduce((a, b) => a + b, 0);
    const lotes = Object.values(p.lotesPorStatus).reduce((a, b) => a + b, 0);
    const cartao = (valor, texto) => `<div class="cartao indicador"><div class="valor">${esc(valor)}</div><div class="rotulo">${esc(texto)}</div></div>`;
    conteudo.innerHTML = `<h1>Olá, ${esc(estado.usuario.login)}</h1>
        <p class="subtitulo">Visão geral da operação em ${fmtDataHora(p.geradoEm)}.</p>
        <div class="grade">
            ${cartao(`${p.organizacoesAtivas}/${p.organizacoes}`, "organizações ativas")}
            ${cartao(lotes, "lotes recebidos")}
            ${cartao(equipamentos, "equipamentos rastreados")}
            ${cartao(fmtNumero(p.pesoTotalKg, 1) + " kg", "peso total recebido")}
        </div>
        <div class="grade" style="margin-top:12px">
            <div><h2>Lotes por situação</h2>${tabela(["Situação", { texto: "Lotes", classe: "numero" }],
                ENUMS.statusLote.filter(s => p.lotesPorStatus[s]).map(s => [td(etiquetaStatus(s)), td(p.lotesPorStatus[s], "numero")]), "Nenhum lote.")}</div>
            <div><h2>Equipamentos por status</h2>${tabela(["Status", { texto: "Qtd.", classe: "numero" }],
                ENUMS.status.filter(s => p.equipamentosPorStatus[s]).map(s => [td(etiquetaStatus(s)), td(p.equipamentosPorStatus[s], "numero")]), "Nenhum equipamento.")}</div>
        </div>`;
}

// ---------------------------------------------- organizações

const filtroOrg = { busca: "", ativo: "", pagina: 1 };

function camposOrganizacao(o = {}, comCnpj = true) {
    return `<div class="formulario">
        ${comCnpj ? `<label>CNPJ <input name="cnpj" required placeholder="00.000.000/0000-00" value="${esc(o.cnpj)}"></label>` : ""}
        <label class="largo">Razão social <input name="razaoSocial" required minlength="3" maxlength="150" value="${esc(o.razaoSocial)}"></label>
        <label>E-mail <input name="email" type="email" required value="${esc(o.email)}"></label>
        <label>Telefone <input name="telefone" placeholder="(11) 3333-4444" value="${esc(o.telefone)}"></label>
        <label>Inscrição estadual <input name="inscricaoEstadual" placeholder="ISENTO" value="${esc(o.inscricaoEstadual)}"></label>
        <label class="largo">Endereço completo <input name="enderecoCompleto" required minlength="10" value="${esc(o.enderecoCompleto)}"></label>
    </div>`;
}

function camposContrato(c = {}, prefixo = "") {
    return `<div class="formulario">
        <label>Assinatura <input type="date" name="${prefixo}dataAssinatura" value="${esc(c.dataAssinatura ?? hojeISO())}"></label>
        <label>Vencimento <input type="date" name="${prefixo}dataVencimento" value="${esc(c.dataVencimento ?? "")}"></label>
        <label>Valor mensal (R$) <input type="number" step="0.01" min="0" name="${prefixo}valorMensal" value="${esc(c.valorMensal ?? "")}"></label>
        <label class="caixa-marcacao"><input type="checkbox" name="${prefixo}renovacaoAutomatica"${c.renovacaoAutomatica ? " checked" : ""}> Renovação automática</label>
        <label class="largo">Cláusulas (uma por linha) <textarea name="${prefixo}clausulas">${esc((c.clausulas ?? []).join("\n"))}</textarea></label>
    </div>`;
}

function contratoDoFormulario(dados, prefixo = "") {
    return {
        dataAssinatura: dados[`${prefixo}dataAssinatura`], dataVencimento: dados[`${prefixo}dataVencimento`],
        valorMensal: dados[`${prefixo}valorMensal`], renovacaoAutomatica: Boolean(dados[`${prefixo}renovacaoAutomatica`]),
        clausulas: String(dados[`${prefixo}clausulas`] ?? "").split("\n").map(c => c.trim()).filter(Boolean)
    };
}

async function telaOrganizacoes() {
    const r = await api("GET", "/organizacoes" + consulta({ busca: filtroOrg.busca, ativo: filtroOrg.ativo, pagina: filtroOrg.pagina }));
    conteudo.innerHTML = `<h1>Organizações</h1><p class="subtitulo">Clientes geradores de resíduos e seus contratos de coleta.</p>
        <form class="barra" id="filtros">
            <label>Buscar <input name="busca" placeholder="razão social, CNPJ ou código" value="${esc(filtroOrg.busca)}"></label>
            <label>Situação <select name="ativo">${opcoes(["true", "false"], filtroOrg.ativo, "Todas").replace(">True<", ">Ativas<").replace(">False<", ">Desativadas<")}</select></label>
            <button class="botao secundario">Filtrar</button>
            <span class="espaco"></span>
            ${pode("ORGANIZACOES_ESCREVER") ? `<button type="button" class="botao" id="nova">Nova organização</button>` : ""}
        </form>
        ${tabela(["Código", "Razão social", "CNPJ", "Contrato", "Situação"], r.itens.map(o => [
            td(`<a href="#/organizacoes/${esc(o.id)}">${esc(o.id)}</a>`), td(esc(o.razaoSocial)), td(fmtCNPJ(o.cnpj)),
            td(o.contrato ? (o.contrato.vigente ? `<span class="etiqueta ok">Vigente até ${fmtData(o.contrato.dataVencimento)}</span>` : `<span class="etiqueta ruim">Vencido</span>`) : `<span class="etiqueta">Sem contrato</span>`),
            td(o.ativo ? `<span class="etiqueta ok">Ativa</span>` : `<span class="etiqueta ruim">Desativada</span>`)
        ]))}`;
    conteudo.append(paginacao(r, p => { filtroOrg.pagina = p; renderizar(); }));
    $("#filtros").onsubmit = evento => {
        evento.preventDefault();
        Object.assign(filtroOrg, { busca: evento.target.busca.value.trim(), ativo: evento.target.ativo.value, pagina: 1 });
        renderizar();
    };
    const nova = $("#nova");
    if (nova) nova.onclick = () => {
        const form = abrirDialogo("Nova organização", `${camposOrganizacao()}
            <label class="caixa-marcacao"><input type="checkbox" name="comContrato" id="com-contrato" checked> Cadastrar já com o contrato de coleta</label>
            <div id="area-contrato">${camposContrato({}, "c_")}</div>`, async f => {
            const dados = formularioParaObjeto(f);
            const corpo = { cnpj: dados.cnpj, razaoSocial: dados.razaoSocial, email: dados.email, telefone: dados.telefone,
                inscricaoEstadual: dados.inscricaoEstadual, enderecoCompleto: dados.enderecoCompleto };
            if (dados.comContrato) corpo.contrato = contratoDoFormulario(dados, "c_");
            const criada = await api("POST", "/organizacoes", corpo);
            avisar(`Organização ${criada.id} cadastrada.`);
            location.hash = `#/organizacoes/${criada.id}`;
        });
        form.querySelector("#com-contrato").onchange = e => {
            form.querySelector("#area-contrato").hidden = !e.target.checked;
            form.querySelectorAll("#area-contrato [name]").forEach(c => c.disabled = !e.target.checked);
        };
    };
}

async function telaOrganizacao(id) {
    const o = await api("GET", `/organizacoes/${encodeURIComponent(id)}`);
    const lotes = pode("LOTES_LER") ? await api("GET", `/lotes${consulta({ organizacaoId: o.id, tamanhoPagina: 100 })}`) : null;
    const escrever = pode("ORGANIZACOES_ESCREVER");
    const c = o.contrato;
    conteudo.innerHTML = `<p><a href="#/organizacoes">← Organizações</a></p>
        <div class="barra"><div><h1>${esc(o.razaoSocial)}</h1><p class="subtitulo">${esc(o.id)} · CNPJ ${fmtCNPJ(o.cnpj)} · versão ${o.versao}</p></div>
            <span class="espaco"></span>
            ${escrever ? `<button class="botao secundario" id="editar">Editar</button>
                <button class="botao secundario" id="situacao">${o.ativo ? "Desativar" : "Reativar"}</button>
                <button class="botao perigo" id="excluir">Excluir</button>` : ""}
        </div>
        <div class="cartao detalhes">
            <div><span>Situação</span>${o.ativo ? "Ativa" : "Desativada"}</div>
            <div><span>E-mail</span>${esc(o.email)}</div>
            <div><span>Telefone</span>${esc(o.telefone || "—")}</div>
            <div><span>Inscrição estadual</span>${esc(o.inscricaoEstadual)}</div>
            <div><span>Cadastro</span>${fmtDataHora(o.dataCadastro)}</div>
            <div style="grid-column:1/-1"><span>Endereço</span>${esc(o.enderecoCompleto)}</div>
        </div>
        <div class="barra" style="margin-top:20px"><h2 style="margin:0">Contrato de coleta</h2><span class="espaco"></span>
            ${escrever ? `<button class="botao secundario pequeno" id="contrato">${c ? "Alterar contrato" : "Criar contrato"}</button>
                ${c ? `<button class="botao secundario pequeno" id="renovar">Renovar</button><button class="botao perigo pequeno" id="excluir-contrato">Remover</button>` : ""}` : ""}
        </div>
        ${c ? `<div class="cartao detalhes">
            <div><span>Situação</span>${c.vigente ? '<span class="etiqueta ok">Vigente</span>' : '<span class="etiqueta ruim">Vencido</span>'}</div>
            <div><span>Assinatura</span>${fmtData(c.dataAssinatura)}</div>
            <div><span>Vencimento</span>${fmtData(c.dataVencimento)}</div>
            <div><span>Valor mensal</span>${fmtMoeda(c.valorMensal)}</div>
            <div><span>Renovação automática</span>${c.renovacaoAutomatica ? "Sim" : "Não"}</div>
            <div style="grid-column:1/-1"><span>Cláusulas</span><ul>${c.clausulas.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>
        </div>` : `<div class="cartao vazio">Sem contrato: a organização não pode registrar lotes.</div>`}
        ${lotes ? `<h2>Lotes</h2>${tabela(["Lote", "Entrada", "NF", "Equip.", "Situação"], lotes.itens.map(l => [
            td(`<a href="#/lotes/${esc(l.id)}">${esc(l.id)}</a>`), td(fmtData(l.dataEntrada)), td(esc(l.notaFiscal)),
            td(l.quantidadeEquipamentos, "numero"), td(etiquetaStatus(l.statusProcessamento))]), "Nenhum lote registrado.")}` : ""}`;
    if (!escrever) return;
    $("#editar").onclick = () => abrirDialogo("Editar organização", camposOrganizacao(o) +
        `<small class="subtitulo">O CNPJ só pode ser corrigido enquanto a organização não tiver lotes.</small>`, async f => {
        await api("PUT", `/organizacoes/${o.id}`, { ...formularioParaObjeto(f), versao: o.versao });
        avisar("Dados atualizados.");
    });
    $("#situacao").onclick = tratar(async () => {
        await api("PATCH", `/organizacoes/${o.id}/situacao`, { ativo: !o.ativo, versao: o.versao });
        avisar(o.ativo ? "Organização desativada." : "Organização reativada.");
        renderizar();
    });
    $("#excluir").onclick = () => confirmar(`Excluir a organização ${o.id}? Só é possível se ela não tiver lotes.`, async () => {
        await api("DELETE", `/organizacoes/${o.id}?versao=${o.versao}`);
        avisar("Organização excluída.");
        location.hash = "#/organizacoes";
    });
    $("#contrato").onclick = () => abrirDialogo(c ? "Alterar contrato" : "Criar contrato", camposContrato(c ?? {}), async f => {
        await api("PUT", `/organizacoes/${o.id}/contrato`, { ...contratoDoFormulario(formularioParaObjeto(f)), ...(c ? { versao: c.versao } : {}) });
        avisar("Contrato salvo.");
    });
    if (c) {
        $("#renovar").onclick = () => abrirDialogo("Renovar contrato", `<label>Novo vencimento <input type="date" name="novoVencimento" required></label>`, async f => {
            await api("POST", `/organizacoes/${o.id}/contrato/renovacao`, { ...formularioParaObjeto(f), versao: c.versao });
            avisar("Contrato renovado.");
        }, "Renovar");
        $("#excluir-contrato").onclick = () => confirmar("Remover o contrato desta organização?", async () => {
            await api("DELETE", `/organizacoes/${o.id}/contrato?versao=${c.versao}`);
            avisar("Contrato removido.");
        }, "Remover");
    }
}

// ---------------------------------------------- lotes

const filtroLote = { organizacaoId: "", status: "", inicio: "", fim: "", pagina: 1 };

function linhaEquipamento() {
    return `<div class="equipamento-linha">
        <label>Tipo <select name="tipo">${opcoes(ENUMS.tipo, "NOTEBOOK")}</select></label>
        <label>Marca <input name="marca" required></label>
        <label>Modelo <input name="modelo" required></label>
        <label>Ano <input name="anoFabricacao" type="number" min="1970" max="${new Date().getFullYear()}" required></label>
        <label>Estado <select name="estadoFisico">${opcoes(ENUMS.estado, "BOM_ESTADO")}</select></label>
        <label>Peso (kg) <input name="pesoQuilogramas" type="number" step="0.001" min="0.001" required></label>
        <button type="button" class="botao perigo pequeno remover-linha" aria-label="Remover equipamento">✕</button>
    </div>`;
}

function lerEquipamentos(container) {
    return [...container.querySelectorAll(".equipamento-linha")].map(linha => {
        const v = nome => linha.querySelector(`[name="${nome}"]`).value.trim();
        return { tipo: v("tipo"), marca: v("marca"), modelo: v("modelo"), anoFabricacao: Number(v("anoFabricacao")),
            estadoFisico: v("estadoFisico"), pesoQuilogramas: Number(v("pesoQuilogramas")) };
    });
}

async function telaLotes() {
    const r = await api("GET", "/lotes" + consulta(filtroLote));
    conteudo.innerHTML = `<h1>Lotes</h1><p class="subtitulo">Chegadas ao almoxarifado, triagem e encaminhamento.</p>
        <form class="barra" id="filtros">
            <label>Organização <input name="organizacaoId" placeholder="BR001" size="8" value="${esc(filtroLote.organizacaoId)}"></label>
            <label>Situação <select name="status">${opcoes(ENUMS.statusLote, filtroLote.status, "Todas")}</select></label>
            <label>Entrada de <input type="date" name="inicio" value="${esc(filtroLote.inicio)}"></label>
            <label>até <input type="date" name="fim" value="${esc(filtroLote.fim)}"></label>
            <button class="botao secundario">Filtrar</button>
            <span class="espaco"></span>
            ${pode("LOTES_ESCREVER") ? `<button type="button" class="botao" id="novo">Registrar lote</button>` : ""}
        </form>
        ${tabela(["Lote", "Organização", "Entrada", "NF", "Transportadora", { texto: "Equip.", classe: "numero" }, { texto: "Peso (kg)", classe: "numero" }, "Situação"],
            r.itens.map(l => [td(`<a href="#/lotes/${esc(l.id)}">${esc(l.id)}</a>`), td(`<a href="#/organizacoes/${esc(l.organizacaoId)}">${esc(l.organizacaoId)}</a>`),
                td(fmtData(l.dataEntrada)), td(esc(l.notaFiscal)), td(esc(l.transportadora)), td(l.quantidadeEquipamentos, "numero"),
                td(fmtNumero(l.pesoTotalKg, 3), "numero"), td(etiquetaStatus(l.statusProcessamento))]))}`;
    conteudo.append(paginacao(r, p => { filtroLote.pagina = p; renderizar(); }));
    $("#filtros").onsubmit = evento => {
        evento.preventDefault();
        const f = evento.target;
        Object.assign(filtroLote, { organizacaoId: f.organizacaoId.value.trim(), status: f.status.value, inicio: f.inicio.value, fim: f.fim.value, pagina: 1 });
        renderizar();
    };
    const novo = $("#novo");
    if (!novo) return;
    novo.onclick = tratar(async () => {
        const orgs = await api("GET", "/organizacoes?ativo=true&tamanhoPagina=100");
        const form = abrirDialogo("Registrar lote", `<div class="formulario">
                <label>Organização <select name="organizacaoId" required>${orgs.itens.map(o => `<option value="${esc(o.id)}">${esc(o.id)} · ${esc(o.razaoSocial)}</option>`).join("")}</select></label>
                <label>Nota fiscal <input name="notaFiscal" required pattern="\\d{1,9}"></label>
                <label>Transportadora <input name="transportadora" required></label>
                <label>Data de entrada <input type="date" name="dataEntrada" value="${hojeISO()}" max="${hojeISO()}"></label>
                <label class="largo">Observações <textarea name="observacoes"></textarea></label>
            </div>
            <div class="barra"><h2 style="margin:0">Equipamentos</h2><span class="espaco"></span><button type="button" class="botao secundario pequeno" id="mais">Adicionar equipamento</button></div>
            <div id="equipamentos">${linhaEquipamento()}</div>
            <small class="subtitulo">O lote e todos os equipamentos são gravados juntos: se algum for inválido, nada é gravado.</small>`, async f => {
            const dados = formularioParaObjeto(f);
            const lote = await api("POST", "/lotes", { organizacaoId: dados.organizacaoId, notaFiscal: dados.notaFiscal, transportadora: dados.transportadora,
                dataEntrada: dados.dataEntrada, observacoes: dados.observacoes, equipamentos: lerEquipamentos(f.querySelector("#equipamentos")) });
            avisar(`Lote ${lote.id} registrado com ${lote.quantidadeEquipamentos} equipamento(s).`);
            location.hash = `#/lotes/${lote.id}`;
        }, "Registrar");
        // Os campos de equipamento são lidos à parte (lerEquipamentos), por isso ficam sem "name" no formulário principal.
        const area = form.querySelector("#equipamentos");
        const ligar = () => area.querySelectorAll(".remover-linha").forEach(b => b.onclick = () => b.closest(".equipamento-linha").remove());
        form.querySelector("#mais").onclick = () => { area.insertAdjacentHTML("beforeend", linhaEquipamento()); ligar(); };
        ligar();
    });
}

async function telaLote(id) {
    const l = await api("GET", `/lotes/${encodeURIComponent(id)}`);
    const triagem = await api("GET", `/lotes/${encodeURIComponent(id)}/relatorio-triagem`);
    const escrever = pode("LOTES_ESCREVER");
    const recebido = l.statusProcessamento === "RECEBIDO";
    const podeTriar = ["RECEBIDO", "EM_TRIAGEM"].includes(l.statusProcessamento);
    conteudo.innerHTML = `<p><a href="#/lotes">← Lotes</a></p>
        <div class="barra"><div><h1>Lote ${esc(l.id)}</h1><p class="subtitulo">${etiquetaStatus(l.statusProcessamento)} · versão ${l.versao}</p></div>
            <span class="espaco"></span>
            ${escrever && podeTriar ? `<button class="botao" id="triagem">${recebido ? "Iniciar triagem" : "Concluir triagem"}</button>` : ""}
            ${escrever && recebido ? `<button class="botao secundario" id="adicionar">Adicionar equipamento</button>
                <button class="botao secundario" id="editar">Editar</button><button class="botao perigo" id="excluir">Excluir</button>` : ""}
        </div>
        <div class="cartao detalhes">
            <div><span>Organização</span><a href="#/organizacoes/${esc(l.organizacaoId)}">${esc(l.organizacaoId)}</a></div>
            <div><span>Entrada</span>${fmtData(l.dataEntrada)}</div>
            <div><span>Nota fiscal</span>${esc(l.notaFiscal)}</div>
            <div><span>Transportadora</span>${esc(l.transportadora)}</div>
            <div><span>Equipamentos</span>${l.quantidadeEquipamentos}</div>
            <div><span>Peso total</span>${fmtNumero(l.pesoTotalKg, 3)} kg</div>
            ${l.observacoes ? `<div style="grid-column:1/-1"><span>Observações</span>${esc(l.observacoes)}</div>` : ""}
        </div>
        <h2>Equipamentos</h2>
        ${tabela(["#", "Equipamento", "Código de barras", "Tipo", "Marca / modelo", "Estado físico", "Status", "Local atual"],
            l.equipamentos.map(e => [td(e.posicaoNoLote), td(`<a href="#/equipamentos/${esc(e.id)}">${esc(e.id)}</a>`), td(`<code>${esc(e.codigoBarrasInterno)}</code>`),
                td(rotulo(e.tipo)), td(`${esc(e.marca)} ${esc(e.modelo)}`), td(rotulo(e.estadoFisico)), td(etiquetaStatus(e.statusRastreamento)), td(esc(e.localizacaoAtual ?? "—"))]),
            "Nenhum equipamento neste lote.")}
        <h2>Distribuição por estado físico (triagem)</h2>
        ${tabela(["Estado físico", { texto: "Qtd.", classe: "numero" }], Object.entries(triagem.porEstadoFisico).map(([k, v]) => [td(rotulo(k)), td(v, "numero")]), "—")}`;
    if (!escrever) return;
    const botaoTriagem = $("#triagem");
    if (botaoTriagem) botaoTriagem.onclick = tratar(async () => {
        const r = await api("POST", `/lotes/${l.id}/triagem`, { versao: l.versao });
        avisar(r.etapa === "INICIADA" ? "Triagem iniciada: equipamentos em triagem." : "Triagem concluída: equipamentos liberados para encaminhamento.");
        renderizar();
    });
    if (!recebido) return;
    $("#adicionar").onclick = () => {
        const form = abrirDialogo("Adicionar equipamento", `<div id="um">${linhaEquipamento()}</div>`, async f => {
            const [dados] = lerEquipamentos(f.querySelector("#um"));
            const e = await api("POST", `/lotes/${l.id}/equipamentos`, dados);
            avisar(`Equipamento ${e.id} (${e.codigoBarrasInterno}) adicionado.`);
        }, "Adicionar");
        form.querySelector(".remover-linha").remove();
    };
    $("#editar").onclick = () => abrirDialogo("Editar lote", `<div class="formulario">
            <label>Nota fiscal <input name="notaFiscal" required value="${esc(l.notaFiscal)}"></label>
            <label>Transportadora <input name="transportadora" required value="${esc(l.transportadora)}"></label>
            <label>Data de entrada <input type="date" name="dataEntrada" value="${esc(l.dataEntrada)}" max="${hojeISO()}"></label>
            <label class="largo">Observações <textarea name="observacoes">${esc(l.observacoes)}</textarea></label></div>`, async f => {
        const dados = formularioParaObjeto(f);
        await api("PUT", `/lotes/${l.id}`, { observacoes: "", ...dados, versao: l.versao });
        avisar("Lote atualizado.");
    });
    $("#excluir").onclick = () => confirmar(`Excluir o lote ${l.id} e os seus ${l.quantidadeEquipamentos} equipamento(s)?`, async () => {
        await api("DELETE", `/lotes/${l.id}?versao=${l.versao}`);
        avisar("Lote excluído.");
        location.hash = "#/lotes";
    });
}

// ---------------------------------------------- equipamentos

const filtroEquip = { loteId: "", status: "", tipo: "", estado: "", pagina: 1 };

async function telaEquipamentos() {
    const r = await api("GET", "/equipamentos" + consulta(filtroEquip));
    conteudo.innerHTML = `<h1>Equipamentos</h1><p class="subtitulo">Busque pelo código (EQ-…) ou pelo código de barras para ver a rastreabilidade completa.</p>
        <form class="barra" id="busca"><label>Código ou código de barras <input name="codigo" placeholder="EQ-000001 ou GCNTB…" required></label>
            <button class="botao">Abrir</button></form>
        <form class="barra" id="filtros">
            <label>Lote <input name="loteId" size="12" value="${esc(filtroEquip.loteId)}"></label>
            <label>Status <select name="status">${opcoes(ENUMS.status, filtroEquip.status, "Todos")}</select></label>
            <label>Tipo <select name="tipo">${opcoes(ENUMS.tipo, filtroEquip.tipo, "Todos")}</select></label>
            <label>Estado físico <select name="estado">${opcoes(ENUMS.estado, filtroEquip.estado, "Todos")}</select></label>
            <button class="botao secundario">Filtrar</button>
        </form>
        ${tabela(["Equipamento", "Código de barras", "Tipo", "Marca / modelo", "Lote", "Estado físico", "Status", "Local atual"], r.itens.map(e => [
            td(`<a href="#/equipamentos/${esc(e.id)}">${esc(e.id)}</a>`), td(`<code>${esc(e.codigoBarrasInterno)}</code>`), td(rotulo(e.tipo)),
            td(`${esc(e.marca)} ${esc(e.modelo)}`), td(`<a href="#/lotes/${esc(e.loteId)}">${esc(e.loteId)}</a>`), td(rotulo(e.estadoFisico)),
            td(etiquetaStatus(e.statusRastreamento)), td(esc(e.localizacaoAtual ?? "—"))]))}`;
    conteudo.append(paginacao(r, p => { filtroEquip.pagina = p; renderizar(); }));
    $("#busca").onsubmit = evento => { evento.preventDefault(); location.hash = `#/equipamentos/${encodeURIComponent(evento.target.codigo.value.trim())}`; };
    $("#filtros").onsubmit = evento => {
        evento.preventDefault();
        const f = evento.target;
        Object.assign(filtroEquip, { loteId: f.loteId.value.trim(), status: f.status.value, tipo: f.tipo.value, estado: f.estado.value, pagina: 1 });
        renderizar();
    };
}

async function telaEquipamento(id) {
    const h = await api("GET", `/equipamentos/${encodeURIComponent(id)}/rastreamento`);
    const e = h.equipamento;
    const escrever = pode("EQUIPAMENTOS_ESCREVER");
    const baixado = e.statusRastreamento === "BAIXA_DEFINITIVA";
    const destinos = TRANSICOES[e.statusRastreamento];
    const icone = { LOCALIZACAO: "Local", STATUS: "Status", ESTADO_FISICO: "Estado físico" };
    conteudo.innerHTML = `<p><a href="#/lotes/${esc(e.loteId)}">← Lote ${esc(e.loteId)}</a></p>
        <div class="barra"><div><h1>${esc(e.id)} · ${esc(e.marca)} ${esc(e.modelo)}</h1>
            <p class="subtitulo"><code>${esc(e.codigoBarrasInterno)}</code> · ${etiquetaStatus(e.statusRastreamento)} · versão ${e.versao}</p></div>
            <span class="espaco"></span>
            ${escrever && !baixado ? `${destinos.length ? `<button class="botao" id="status">Alterar status</button>` : ""}
                <button class="botao secundario" id="estado">Reclassificar estado</button>
                <button class="botao secundario" id="mover">Movimentar</button>` : ""}
            ${escrever && e.statusRastreamento === "AGUARDANDO_TRIAGEM" ? `<button class="botao secundario" id="editar">Editar</button>` : ""}
            ${escrever && h.lote.statusProcessamento === "RECEBIDO" ? `<button class="botao perigo" id="excluir">Excluir</button>` : ""}
        </div>
        <div class="cartao detalhes">
            <div><span>Tipo</span>${rotulo(e.tipo)}</div>
            <div><span>Estado físico</span>${rotulo(e.estadoFisico)}</div>
            <div><span>Ano de fabricação</span>${e.anoFabricacao}</div>
            <div><span>Peso</span>${fmtNumero(e.pesoQuilogramas, 3)} kg</div>
            <div><span>Local atual</span>${esc(e.localizacaoAtual ?? "—")}</div>
            <div><span>Posição no lote</span>${e.posicaoNoLote}</div>
            <div><span>Origem</span><a href="#/organizacoes/${esc(h.organizacao.id)}">${esc(h.organizacao.razaoSocial)}</a></div>
            <div><span>Lote</span><a href="#/lotes/${esc(h.lote.id)}">${esc(h.lote.id)}</a> (NF ${esc(h.lote.notaFiscal)}, ${fmtData(h.lote.dataEntrada)})</div>
            <div><span>Depreciação</span>${fmtPercentual(h.depreciacao)}</div>
            <div><span>Valor residual estimado</span>${fmtMoeda(h.valorResidual)}</div>
        </div>
        <div class="grade" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr));align-items:start">
            <div><h2>Histórico de movimentações</h2><div class="cartao"><ol class="linha-tempo">${h.movimentacoes.map(m => `<li>
                <strong>${esc(icone[m.natureza])}:</strong> ${m.natureza === "LOCALIZACAO" ? esc(m.origem) : rotulo(m.origem)} → <strong>${m.natureza === "LOCALIZACAO" ? esc(m.destino) : rotulo(m.destino)}</strong><br>
                <small>${fmtDataHora(m.dataHora)} · ${esc(m.responsavel)}${m.observacao ? ` · “${esc(m.observacao)}”` : ""}</small></li>`).join("")}</ol></div></div>
            <div><h2>Auditoria</h2>${tabela(["Quando", "Operação", "Usuário"], h.auditoria.map(a => [td(fmtDataHora(a.dataHora)), td(rotulo(a.operacao)), td(esc(a.usuario))]))}</div>
        </div>`;
    if (!escrever) return;
    const ligar = (seletor, acao) => { const b = $(seletor); if (b) b.onclick = acao; };
    ligar("#status", () => abrirDialogo("Alterar status de rastreamento", `
        <p class="subtitulo">Status atual: ${rotulo(e.statusRastreamento)}. O desmonte só é aceito depois da triagem completa do lote.</p>
        <label>Novo status <select name="status">${opcoes(destinos)}</select></label>
        <label>Justificativa / observação <textarea name="justificativa"></textarea></label>`, async f => {
        await api("PATCH", `/equipamentos/${e.id}/status`, { ...formularioParaObjeto(f), versao: e.versao });
        avisar("Status atualizado.");
    }));
    ligar("#estado", () => abrirDialogo("Reclassificar estado físico", `
        <p class="subtitulo">Se o estado cair duas ou mais categorias, a justificativa (mín. 10 caracteres) é obrigatória.</p>
        <label>Novo estado <select name="estadoFisico">${opcoes(ENUMS.estado.filter(x => x !== e.estadoFisico))}</select></label>
        <label>Justificativa <textarea name="justificativa"></textarea></label>`, async f => {
        await api("PATCH", `/equipamentos/${e.id}/estado`, { ...formularioParaObjeto(f), versao: e.versao });
        avisar("Estado físico atualizado.");
    }));
    ligar("#mover", () => abrirDialogo("Registrar movimentação", `
        <label>Destino <input name="destino" required minlength="2" maxlength="120" placeholder="Ex.: Galpão A - baia 3"></label>
        <label>Observação <textarea name="observacao"></textarea></label>`, async f => {
        await api("POST", `/equipamentos/${e.id}/movimentacoes`, { ...formularioParaObjeto(f), versao: e.versao });
        avisar("Movimentação registrada.");
    }, "Registrar"));
    ligar("#editar", () => abrirDialogo("Editar equipamento", `<div class="formulario">
        <label>Marca <input name="marca" required value="${esc(e.marca)}"></label>
        <label>Modelo <input name="modelo" required value="${esc(e.modelo)}"></label>
        <label>Ano <input name="anoFabricacao" type="number" required value="${e.anoFabricacao}"></label>
        <label>Peso (kg) <input name="pesoQuilogramas" type="number" step="0.001" required value="${e.pesoQuilogramas}"></label></div>`, async f => {
        await api("PUT", `/equipamentos/${e.id}`, { ...formularioParaObjeto(f), versao: e.versao });
        avisar("Equipamento atualizado.");
    }));
    ligar("#excluir", () => confirmar(`Remover ${e.id} do lote ${e.loteId}?`, async () => {
        await api("DELETE", `/equipamentos/${e.id}?versao=${e.versao}`);
        avisar("Equipamento removido.");
        location.hash = `#/lotes/${e.loteId}`;
    }));
}

// ---------------------------------------------- usuários

async function telaUsuarios() {
    const usuarios = await api("GET", "/usuarios");
    conteudo.innerHTML = `<div class="barra"><div><h1>Usuários</h1><p class="subtitulo">Contas de acesso e papéis.</p></div>
            <span class="espaco"></span><button class="botao" id="novo">Novo usuário</button></div>
        ${tabela(["Login", "Papel", "Situação", "Último acesso", "Ações"], usuarios.map(u => [
            td(`<strong>${esc(u.login)}</strong>`), td(rotulo(u.papel)),
            td(u.ativo ? (u.bloqueadoAte && new Date(u.bloqueadoAte) > new Date() ? '<span class="etiqueta alerta">Bloqueado</span>' : '<span class="etiqueta ok">Ativo</span>') : '<span class="etiqueta ruim">Inativo</span>'),
            td(fmtDataHora(u.ultimoAcesso)),
            td(`<div class="acoes" data-login="${esc(u.login)}"><button class="botao secundario pequeno" data-acao="renomear">Renomear</button>
                <button class="botao secundario pequeno" data-acao="papel">Papel</button>
                <button class="botao secundario pequeno" data-acao="situacao">${u.ativo ? "Desativar" : "Ativar"}</button>
                <button class="botao secundario pequeno" data-acao="senha">Redefinir senha</button>
                <button class="botao perigo pequeno" data-acao="excluir">Excluir</button></div>`)
        ]))}`;
    $("#novo").onclick = () => abrirDialogo("Novo usuário", `<div class="formulario">
        <label>Login <input name="login" required pattern="[a-z][a-z0-9._\\-]{2,31}" title="3 a 32 caracteres minúsculos, começando por letra"></label>
        <label>Papel <select name="papel">${opcoes(ENUMS.papel, "AUDITOR")}</select></label>
        <label class="largo">Senha inicial <input name="senha" type="password" required autocomplete="new-password"></label></div>`, async f => {
        const u = await api("POST", "/usuarios", formularioParaObjeto(f));
        avisar(`Usuário ${u.login} criado.`);
    }, "Criar");
    conteudo.querySelectorAll("[data-acao]").forEach(botao => botao.onclick = tratar(async () => {
        const u = usuarios.find(x => x.login === botao.closest("[data-login]").dataset.login);
        const acao = botao.dataset.acao;
        if (acao === "renomear") abrirDialogo(`Renomear ${u.login}`, `<label>Novo login <input name="login" required value="${esc(u.login)}"
                pattern="[a-z][a-z0-9._\\-]{2,31}" title="3 a 32 caracteres minúsculos, começando por letra"></label>`, async f => {
            const alterado = await api("PATCH", `/usuarios/${u.login}`, { login: f.login.value.trim(), versao: u.versao });
            if (u.login === estado.usuario.login) await carregarUsuario();
            avisar(`Usuário renomeado para ${alterado.login}.`);
        });
        if (acao === "papel") abrirDialogo(`Papel de ${u.login}`, `<label>Papel <select name="papel">${opcoes(ENUMS.papel, u.papel)}</select></label>`, async f => {
            await api("PATCH", `/usuarios/${u.login}`, { papel: f.papel.value, versao: u.versao });
            avisar("Papel alterado; as sessões do usuário foram encerradas.");
        });
        if (acao === "situacao") {
            await api("PATCH", `/usuarios/${u.login}`, { ativo: !u.ativo, versao: u.versao });
            avisar(u.ativo ? "Usuário desativado." : "Usuário reativado.");
            renderizar();
        }
        if (acao === "senha") abrirDialogo(`Redefinir senha de ${u.login}`, `<label>Nova senha <input name="senhaNova" type="password" required autocomplete="new-password"></label>`, async f => {
            await api("PUT", `/usuarios/${u.login}/senha`, { senhaNova: f.senhaNova.value, versao: u.versao });
            avisar("Senha redefinida e conta desbloqueada.");
        });
        if (acao === "excluir") confirmar(`Excluir o usuário ${u.login}?`, async () => {
            await api("DELETE", `/usuarios/${u.login}?versao=${u.versao}`);
            avisar("Usuário excluído.");
        });
    }));
}

// ---------------------------------------------- parâmetros

async function telaParametros() {
    const p = await api("GET", "/parametros");
    const editar = pode("PARAMETROS_GERENCIAR");
    const botao = (grupo, chave, valor) => editar ? `<button class="botao secundario pequeno" data-grupo="${grupo}" data-chave="${esc(chave)}" data-valor="${valor}">Alterar</button>` : "";
    conteudo.innerHTML = `<h1>Parâmetros globais</h1><p class="subtitulo">Versão ${p.versao}. Usados no cálculo de depreciação, valor residual e tributos.</p>
        <div class="barra"><h2 style="margin:0">Alíquotas de impostos</h2><span class="espaco"></span>${editar ? `<button class="botao secundario pequeno" id="nova-aliquota">Nova alíquota</button>` : ""}</div>
        ${tabela(["Imposto", { texto: "Alíquota", classe: "numero" }, ""], Object.entries(p.aliquotas).map(([k, v]) => [td(esc(k)), td(fmtPercentual(v), "numero"),
            td(editar ? `<div class="acoes">${botao("aliquota", k, v)}<button class="botao perigo pequeno" data-remover="${esc(k)}">Remover</button></div>` : "")]))}
        <h2>Por tipo de equipamento</h2>
        ${tabela(["Tipo", { texto: "Depreciação anual", classe: "numero" }, "", { texto: "Valor de referência (novo)", classe: "numero" }, ""],
            ENUMS.tipo.map(t => [td(rotulo(t)), td(fmtPercentual(p.coeficientesDepreciacao[t]), "numero"), td(botao("depreciacao", t, p.coeficientesDepreciacao[t])),
                td(fmtMoeda(p.valoresReferencia[t]), "numero"), td(botao("valor", t, p.valoresReferencia[t]))]))}
        <h2>Retenção da auditoria</h2>
        <div class="cartao barra"><span>${p.retencaoAuditoriaDias} dias (mínimo legal do sistema: 180)</span><span class="espaco"></span>${botao("retencao", "dias", p.retencaoAuditoriaDias)}</div>`;
    if (!editar) return;
    const dicas = { aliquota: "Fração entre 0 e 1 (0.05 = 5%)", depreciacao: "Fração anual entre 0 e 1", valor: "Valor em reais", retencao: "Dias (mínimo 180)" };
    conteudo.querySelectorAll("[data-grupo]").forEach(b => b.onclick = () => abrirDialogo(`Alterar ${rotuloTexto(b.dataset.chave)}`,
        `<label>${esc(dicas[b.dataset.grupo])} <input name="valor" type="number" step="any" required value="${esc(b.dataset.valor)}"></label>`, async f => {
            await api("PUT", `/parametros/${b.dataset.grupo}/${encodeURIComponent(b.dataset.chave)}`, { valor: Number(f.valor.value), versao: p.versao });
            avisar("Parâmetro atualizado.");
        }));
    conteudo.querySelectorAll("[data-remover]").forEach(b => b.onclick = () => confirmar(`Remover a alíquota ${b.dataset.remover}?`, async () => {
        await api("DELETE", `/parametros/aliquota/${encodeURIComponent(b.dataset.remover)}?versao=${p.versao}`);
        avisar("Alíquota removida.");
    }, "Remover"));
    $("#nova-aliquota").onclick = () => abrirDialogo("Nova alíquota", `<div class="formulario">
        <label>Imposto <input name="chave" required pattern="[A-Za-z_]{2,20}" placeholder="ICMS"></label>
        <label>Alíquota (fração) <input name="valor" type="number" step="any" min="0" max="1" required placeholder="0.12"></label></div>`, async f => {
        await api("PUT", `/parametros/aliquota/${encodeURIComponent(f.chave.value.toUpperCase())}`, { valor: Number(f.valor.value), versao: p.versao });
        avisar("Alíquota incluída.");
    });
}

// ---------------------------------------------- relatórios

const filtroRel = { tipo: "financeiro", inicio: "", fim: "", status: "AGUARDANDO_TRIAGEM", organizacaoId: "" };

async function telaRelatorios() {
    const orgs = await api("GET", "/organizacoes?tamanhoPagina=100");
    if (!filtroRel.organizacaoId && orgs.itens[0]) filtroRel.organizacaoId = orgs.itens[0].id;
    const periodo = consulta({ inicio: filtroRel.inicio, fim: filtroRel.fim });
    let corpo = "";
    if (filtroRel.tipo === "financeiro") {
        const r = await api("GET", `/relatorios/financeiro${periodo}`);
        corpo = `<div class="grade">${[["Valor de referência (novo)", r.totais.valorReferencia], ["Valor residual estimado", r.totais.valorResidual],
                ["Tributos", r.totais.tributos], ["Valor líquido estimado", r.totais.valorLiquido]]
                .map(([t, v]) => `<div class="cartao indicador"><div class="valor">${fmtMoeda(v)}</div><div class="rotulo">${esc(t)}</div></div>`).join("")}</div>
            <h2>Tributos</h2>${tabela(["Imposto", { texto: "Alíquota", classe: "numero" }, { texto: "Valor", classe: "numero" }],
                r.tributos.map(t => [td(esc(t.imposto)), td(fmtPercentual(t.aliquota), "numero"), td(fmtMoeda(t.valor), "numero")]))}
            <h2>Equipamentos (${r.totais.equipamentos})</h2>${tabela(["Equipamento", "Lote", "Tipo", "Estado", { texto: "Referência", classe: "numero" }, { texto: "Depreciação", classe: "numero" }, { texto: "Residual", classe: "numero" }],
                r.itens.map(i => [td(`<a href="#/equipamentos/${esc(i.equipamentoId)}">${esc(i.equipamentoId)}</a>`), td(esc(i.loteId)), td(rotulo(i.tipo)), td(rotulo(i.estadoFisico)),
                    td(fmtMoeda(i.valorReferencia), "numero"), td(fmtPercentual(i.depreciacao), "numero"), td(fmtMoeda(i.valorResidual), "numero")]))}`;
    } else if (filtroRel.tipo === "status") {
        const r = await api("GET", `/relatorios/status/${filtroRel.status}`);
        corpo = `<p>${r.total} equipamento(s) com status ${rotulo(r.status)}.</p>${tabela(["Equipamento", "Tipo", "Marca / modelo", "Estado", "Lote", "Organização", "Local atual"],
            r.equipamentos.map(e => [td(`<a href="#/equipamentos/${esc(e.id)}">${esc(e.id)}</a>`), td(rotulo(e.tipo)), td(`${esc(e.marca)} ${esc(e.modelo)}`), td(rotulo(e.estadoFisico)),
                td(esc(e.loteId)), td(esc(e.organizacaoId)), td(esc(e.localizacaoAtual ?? "—"))]))}`;
    } else if (filtroRel.organizacaoId) {
        const r = await api("GET", `/relatorios/organizacoes/${filtroRel.organizacaoId}${periodo}`);
        corpo = `<div class="grade">${[["Lotes", r.totais.lotes], ["Equipamentos", r.totais.equipamentos], ["Peso (kg)", fmtNumero(r.totais.pesoKg, 3)], ["Valor residual", fmtMoeda(r.totais.valorResidualEstimado)]]
                .map(([t, v]) => `<div class="cartao indicador"><div class="valor">${esc(v)}</div><div class="rotulo">${esc(t)}</div></div>`).join("")}</div>
            <h2>Lotes</h2>${tabela(["Lote", "Entrada", "NF", "Transportadora", { texto: "Equip.", classe: "numero" }, "Situação"], r.lotes.map(l => [
                td(`<a href="#/lotes/${esc(l.id)}">${esc(l.id)}</a>`), td(fmtData(l.dataEntrada)), td(esc(l.notaFiscal)), td(esc(l.transportadora)), td(l.quantidadeEquipamentos, "numero"), td(etiquetaStatus(l.statusProcessamento))]))}
            <h2>Equipamentos por status</h2>${tabela(["Status", { texto: "Qtd.", classe: "numero" }], Object.entries(r.equipamentosPorStatus).map(([k, v]) => [td(etiquetaStatus(k)), td(v, "numero")]))}`;
    }
    conteudo.innerHTML = `<h1>Relatórios</h1><p class="subtitulo">Dados gerados na hora a partir do banco.</p>
        <form class="barra" id="filtros">
            <label>Relatório <select name="tipo">${[["financeiro", "Financeiro"], ["status", "Por status"], ["organizacao", "Por organização"]]
                .map(([v, t]) => `<option value="${v}"${v === filtroRel.tipo ? " selected" : ""}>${t}</option>`).join("")}</select></label>
            ${filtroRel.tipo === "status" ? `<label>Status <select name="status">${opcoes(ENUMS.status, filtroRel.status)}</select></label>` : `
                ${filtroRel.tipo === "organizacao" ? `<label>Organização <select name="organizacaoId">${orgs.itens.map(o => `<option value="${esc(o.id)}"${o.id === filtroRel.organizacaoId ? " selected" : ""}>${esc(o.id)} · ${esc(o.razaoSocial)}</option>`).join("")}</select></label>` : ""}
                <label>De <input type="date" name="inicio" value="${esc(filtroRel.inicio)}"></label>
                <label>Até <input type="date" name="fim" value="${esc(filtroRel.fim)}"></label>`}
            <button class="botao secundario">Gerar</button>
        </form>${corpo}`;
    const form = $("#filtros");
    form.tipo.onchange = () => { filtroRel.tipo = form.tipo.value; renderizar(); };
    form.onsubmit = evento => {
        evento.preventDefault();
        for (const campo of ["inicio", "fim", "status", "organizacaoId"]) if (form[campo]) filtroRel[campo] = form[campo].value;
        renderizar();
    };
}

// ---------------------------------------------- auditoria

const filtroAud = { entidade: "", usuario: "", operacao: "", inicio: "", fim: "", pagina: 1 };

async function telaAuditoria() {
    const r = await api("GET", "/auditoria" + consulta(filtroAud));
    conteudo.innerHTML = `<div class="barra"><div><h1>Auditoria</h1><p class="subtitulo">Quem fez o quê e quando, com os dados antes e depois. Registros imutáveis.</p></div>
            <span class="espaco"></span>${pode("AUDITORIA_EXPURGAR") ? `<button class="botao secundario" id="expurgo">Aplicar retenção</button>` : ""}</div>
        <form class="barra" id="filtros">
            <label>Entidade <select name="entidade">${opcoes(["Usuario", "Organizacao", "Lote", "Equipamento", "Parametros", "Auditoria"], filtroAud.entidade, "Todas")}</select></label>
            <label>Usuário <input name="usuario" size="10" value="${esc(filtroAud.usuario)}"></label>
            <label>Operação <input name="operacao" size="14" placeholder="ex.: STATUS" value="${esc(filtroAud.operacao)}"></label>
            <label>De <input type="date" name="inicio" value="${esc(filtroAud.inicio)}"></label>
            <label>Até <input type="date" name="fim" value="${esc(filtroAud.fim)}"></label>
            <button class="botao secundario">Filtrar</button>
        </form>
        ${tabela(["Quando", "Usuário", "Operação", "Entidade", "Detalhes"], r.itens.map(a => [td(fmtDataHora(a.dataHora)), td(esc(a.usuario)), td(rotulo(a.operacao)),
            td(`${esc(a.entidade)} <code>${esc(a.entidadeId)}</code>`),
            td(a.dadosAntes || a.dadosDepois ? `<details><summary>ver</summary><pre style="white-space:pre-wrap;font-size:12px">${esc(JSON.stringify({ antes: a.dadosAntes, depois: a.dadosDepois }, null, 2))}</pre></details>` : "—")]))}`;
    conteudo.append(paginacao(r, p => { filtroAud.pagina = p; renderizar(); }));
    $("#filtros").onsubmit = evento => {
        evento.preventDefault();
        const f = evento.target;
        Object.assign(filtroAud, { entidade: f.entidade.value, usuario: f.usuario.value.trim(), operacao: f.operacao.value.trim(), inicio: f.inicio.value, fim: f.fim.value, pagina: 1 });
        renderizar();
    };
    const expurgo = $("#expurgo");
    if (expurgo) expurgo.onclick = () => confirmar("Remover os registros mais antigos que o prazo de retenção configurado?", async () => {
        const resultado = await api("POST", "/auditoria/expurgo");
        avisar(`${resultado.removidos} registro(s) anteriores a ${fmtDataHora(resultado.limite)} removidos.`, "INFO");
    }, "Aplicar");
}


// ---------------------------------------------- análises (AV3)

const filtroAna = { organizacaoId: "", inicio: "", fim: "" };
const METODOS = { REGRESSAO_LINEAR: "Regressão linear", PARAMETRO_DEPRECIACAO: "Parâmetro de depreciação", TAXA_ARMAZENAGEM: "Taxa de armazenagem" };
const metodo = m => esc(METODOS[m] ?? rotuloTexto(m));
const fmtDias = v => v === null || v === undefined ? "—" : `${fmtNumero(v, 2)} d`;
const barra = (valor, maximo) => `<div class="barra-proporcao" title="${esc(fmtNumero(valor, 2))}"><span style="width:${maximo > 0 ? Math.max(2, Math.round(100 * valor / maximo)) : 0}%"></span></div>`;
const indicador = (valor, texto) => `<div class="cartao indicador"><div class="valor">${esc(valor)}</div><div class="rotulo">${esc(texto)}</div></div>`;

function abasAnalise(atual) {
    const abas = [["eficiencia", "Eficiência operacional"], ["rentabilidade", "Rentabilidade"], ["vida-util", "Vida útil"], ["historico", "Histórico"]];
    return `<div class="abas">${abas.map(([id, texto]) => `<a href="#/analises/${id}"${id === atual ? ' class="ativo" aria-current="page"' : ""}>${esc(texto)}</a>`).join("")}</div>`;
}

async function telaAnalises(aba = "eficiencia") {
    const orgs = await api("GET", "/organizacoes?tamanhoPagina=100");
    const escopo = consulta(filtroAna);
    const filtros = aba === "historico" ? "" : `<form class="barra" id="filtros">
        <label>Organização <select name="organizacaoId"><option value="">Todas</option>${orgs.itens.map(o => `<option value="${esc(o.id)}"${o.id === filtroAna.organizacaoId ? " selected" : ""}>${esc(o.id)} · ${esc(o.razaoSocial)}</option>`).join("")}</select></label>
        <label>Entrada de <input type="date" name="inicio" value="${esc(filtroAna.inicio)}"></label>
        <label>até <input type="date" name="fim" value="${esc(filtroAna.fim)}"></label>
        <button class="botao secundario">Calcular</button>
        <span class="espaco"></span>
        ${pode("ANALISES_EXECUTAR") ? `<button type="button" class="botao" id="gravar">Gravar no histórico</button>` : ""}
    </form>`;
    let corpo = "";
    if (aba === "eficiencia") {
        const r = await api("GET", `/analises/eficiencia${escopo}`);
        const e = r.resultado;
        const maxMes = Math.max(0, ...e.porMes.map(m => m.totalDias.media));
        corpo = `<div class="grade">
                ${indicador(e.lotesComTriagemConcluida, "lotes com triagem concluída")}
                ${indicador(fmtDias(e.temposDias.espera?.mediana), "espera mediana (entrada → triagem)")}
                ${indicador(fmtDias(e.temposDias.triagem?.mediana), "triagem mediana")}
                ${indicador(fmtDias(e.temposDias.total?.p90), "90% dos lotes concluem em até")}
            </div>
            ${e.gargalo ? `<div class="cartao destaque"><strong>Gargalo: ${rotulo(e.gargalo.etapa)}</strong> (${fmtPercentual(e.gargalo.participacao)} do tempo). ${esc(e.gargalo.descricao)}</div>` : ""}
            <h2>Por operador de triagem</h2>${tabela(["Operador", { texto: "Lotes", classe: "numero" }, { texto: "Equip.", classe: "numero" }, { texto: "Triagem mediana", classe: "numero" }, { texto: "Desvio padrão", classe: "numero" }, { texto: "Horas por equip.", classe: "numero" }],
                e.porOperador.map(o => [td(esc(o.operador)), td(o.lotes, "numero"), td(o.equipamentos, "numero"), td(fmtDias(o.triagemDias.mediana), "numero"), td(fmtDias(o.triagemDias.desvioPadrao), "numero"), td(o.horasPorEquipamento === null ? "—" : fmtNumero(o.horasPorEquipamento, 2), "numero")]))}
            <h2>Tempo total médio por mês de conclusão</h2>${tabela(["Mês", { texto: "Lotes", classe: "numero" }, { texto: "Média", classe: "numero" }, ""],
                e.porMes.map(m => [td(esc(m.mes)), td(m.lotes, "numero"), td(fmtDias(m.totalDias.media), "numero"), td(barra(m.totalDias.media, maxMes))]))}
            <h2>Lotes atípicos ${e.lotesAtipicos.limiteDias !== null ? `(acima de ${fmtDias(e.lotesAtipicos.limiteDias)})` : ""}</h2>${tabela(["Lote", "Organização", "Operador", { texto: "Tempo total", classe: "numero" }],
                e.lotesAtipicos.lotes.map(l => [td(`<a href="#/lotes/${esc(l.loteId)}">${esc(l.loteId)}</a>`), td(esc(l.organizacaoId)), td(esc(l.operador ?? "—")), td(fmtDias(l.totalDias), "numero")]), "Nenhum lote fora do padrão.")}
            <h2>Pendências</h2><div class="grade">
                ${indicador(e.pendencias.aguardandoTriagem.quantidade, `aguardando triagem${e.pendencias.aguardandoTriagem.maisAntigo ? ` · mais antigo: ${e.pendencias.aguardandoTriagem.maisAntigo.loteId} (${fmtDias(e.pendencias.aguardandoTriagem.maisAntigo.dias)})` : ""}`)}
                ${indicador(e.pendencias.emTriagem.quantidade, "em triagem")}</div>`;
    } else if (aba === "rentabilidade") {
        const r = await api("GET", `/analises/rentabilidade${escopo}`);
        const x = r.resultado;
        corpo = `<div class="grade">${indicador(x.equipamentos, "equipamentos")}${indicador(fmtMoeda(x.valorTotalRecuperavel), "valor recuperável estimado")}</div>
            <h2>Prioridade por tipo (maior retorno médio primeiro)</h2>${tabela(["#", "Tipo", { texto: "Qtd.", classe: "numero" }, { texto: "Valor médio", classe: "numero" }, { texto: "Mediana", classe: "numero" }, { texto: "R$/kg", classe: "numero" }, { texto: "Retorno s/ novo", classe: "numero" }, { texto: "Part. no valor", classe: "numero" }],
                x.porTipo.map((t, i) => [td(i + 1), td(rotulo(t.tipo)), td(t.quantidade, "numero"), td(fmtMoeda(t.valorRecuperacao.media), "numero"), td(fmtMoeda(t.valorRecuperacao.mediana), "numero"),
                    td(fmtMoeda(t.valorPorKg), "numero"), td(fmtPercentual(t.retornoSobreReferencia), "numero"), td(fmtPercentual(t.participacaoNoValor), "numero")]))}
            <div class="grade"><div><h2>Melhores marcas</h2>${tabela(["Marca", { texto: "Qtd.", classe: "numero" }, { texto: "Valor médio", classe: "numero" }], x.melhoresMarcas.map(m => [td(esc(m.nome)), td(m.quantidade, "numero"), td(fmtMoeda(m.valorMedio), "numero")]))}</div>
                <div><h2>Melhores modelos</h2>${tabela(["Modelo", { texto: "Qtd.", classe: "numero" }, { texto: "Valor médio", classe: "numero" }], x.melhoresModelos.map(m => [td(esc(m.nome)), td(m.quantidade, "numero"), td(fmtMoeda(m.valorMedio), "numero")]))}</div></div>
            <h2>Estimar um equipamento</h2>
            <form class="barra" id="estimativa"><label>Tipo <select name="tipo">${opcoes(ENUMS.tipo, "NOTEBOOK")}</select></label>
                <label>Marca <input name="marca" size="10"></label><label>Modelo <input name="modelo" size="14"></label>
                <label>Estado <select name="estadoFisico">${opcoes(ENUMS.estado, "", "Qualquer")}</select></label>
                <button class="botao secundario">Estimar</button><span id="resultado-estimativa"></span></form>`;
    } else if (aba === "vida-util") {
        const r = await api("GET", `/analises/vida-util${consulta({ ...filtroAna, limitePrevisoes: 100 })}`);
        const v = r.resultado;
        const ad = await api("GET", `/analises/vida-util/aderencia${consulta({ organizacaoId: filtroAna.organizacaoId })}`);
        const a = ad.resultado;
        corpo = `<div class="grade">${indicador(v.equipamentosAtivos, "equipamentos ativos")}${indicador(fmtNumero(v.anosRestantes?.mediana ?? 0, 2) + " anos", "vida remanescente mediana")}
                ${indicador(v.horizonte.equipamentos, `devem ficar inservíveis em ${v.horizonte.meses} meses`)}
                ${indicador(a.erroMedioAbsolutoDias === null ? "—" : fmtNumero(a.erroMedioAbsolutoDias, 0) + " d", `erro médio das previsões já verificadas (${a.avaliadas})`)}</div>
            <h2>Modelos por tipo</h2>${tabela(["Tipo", "Método (perfil por idade)", { texto: "Obs.", classe: "numero" }, { texto: "Níveis/ano", classe: "numero" }, { texto: "R²", classe: "numero" }, { texto: "Idade p/ inservível", classe: "numero" }, "Desgaste no pátio"],
                v.modelos.map(m => [td(rotulo(m.tipo)), td(metodo(m.metodo) + (m.motivoAlternativo ? ` <small class="subtitulo" title="${esc(m.motivoAlternativo)}">ⓘ</small>` : "")), td(m.observacoes, "numero"), td(fmtNumero(m.inclinacao, 3), "numero"),
                    td(m.r2 === null ? "—" : fmtNumero(m.r2, 3), "numero"), td(fmtNumero(m.idadePrevistaInservivelAnos, 1) + " anos", "numero"),
                    td(m.armazenagem?.taxaUsada ? `${fmtNumero(m.armazenagem.taxaUsada, 2)} níveis/ano (${m.armazenagem.fonte === "TIPO" ? "do tipo" : "geral"})` : "sem dados")]))}
            <h2>Previsões mais próximas ${r.previsoesOmitidas ? `<small class="subtitulo">(+${r.previsoesOmitidas}: lista completa em Relatórios em segundo plano)</small>` : ""}</h2>
            ${tabela(["Equipamento", "Tipo", "Estado", { texto: "Idade", classe: "numero" }, { texto: "Anos restantes", classe: "numero" }, "Previsto para", "Método"],
                v.previsoes.map(p => [td(`<a href="#/equipamentos/${esc(p.equipamentoId)}">${esc(p.equipamentoId)}</a>`), td(rotulo(p.tipo)), td(rotulo(p.estadoFisico)), td(fmtNumero(p.idadeAnos, 1), "numero"),
                    td(fmtNumero(p.anosRestantes, 2), "numero"), td(fmtData(p.dataPrevistaInservivel)), td(metodo(p.metodo))]))}
            <h2>Aderência: previsões gravadas × realidade</h2>
            <p class="subtitulo">${a.avaliadas} verificadas · ${a.vencidasSemOcorrencia} vencidas sem ocorrência · ${a.emAberto} em aberto. Erro negativo: ficou inservível antes do previsto.</p>
            ${tabela(["Execução", { texto: "Verificadas", classe: "numero" }, { texto: "Erro médio absoluto", classe: "numero" }], a.porExecucao.map(e => [td(fmtDataHora(e.geradaEm)), td(e.avaliadas, "numero"), td(fmtNumero(e.erroMedioAbsolutoDias, 0) + " d", "numero")]), "Nenhuma previsão gravada já pôde ser verificada.")}`;
    } else {
        const r = await api("GET", "/analises/execucoes?tamanhoPagina=50");
        corpo = tabela(["Concluída em", "Análise", "Origem", "Organização", "Solicitante", { texto: "Previsões", classe: "numero" }, { texto: "Duração", classe: "numero" }, ""],
            r.itens.map(e => [td(fmtDataHora(e.concluidaEm)), td(rotulo(e.tipo)), td(rotulo(e.origem)), td(esc(e.organizacaoId ?? "Todas")), td(esc(e.solicitante)),
                td(e.previsoes || "—", "numero"), td(`${e.duracaoMs} ms`, "numero"), td(`<button class="botao secundario pequeno" data-execucao="${esc(e.id)}">Ver</button>`)]), "Nenhuma execução gravada ainda.");
    }
    conteudo.innerHTML = `<h1>Análises</h1><p class="subtitulo">Indicadores calculados a partir dos dados de lotes, equipamentos e movimentações.</p>${abasAnalise(aba)}${filtros}${corpo}`;
    const form = $("#filtros");
    if (form) {
        form.onsubmit = evento => {
            evento.preventDefault();
            Object.assign(filtroAna, { organizacaoId: form.organizacaoId.value, inicio: form.inicio.value, fim: form.fim.value });
            renderizar();
        };
        const gravar = $("#gravar");
        const tipos = { eficiencia: "EFICIENCIA_OPERACIONAL", rentabilidade: "RENTABILIDADE", "vida-util": "VIDA_UTIL" };
        if (gravar) gravar.onclick = tratar(async () => {
            const e = await api("POST", "/analises/execucoes", { tipo: tipos[aba], ...Object.fromEntries(Object.entries(filtroAna).filter(([, v]) => v)) });
            avisar(`Análise gravada no histórico (${e.duracaoMs} ms).`);
        });
    }
    const est = $("#estimativa");
    if (est) est.onsubmit = tratar(async evento => {
        evento.preventDefault();
        const r = await api("GET", `/analises/rentabilidade/estimativa${consulta({ ...formularioParaObjeto(est), organizacaoId: filtroAna.organizacaoId })}`);
        $("#resultado-estimativa").innerHTML = r.valorEstimado === null ? "Sem dados para estimar."
            : `<strong>${fmtMoeda(r.valorEstimado)}</strong> (faixa ${fmtMoeda(r.faixaProvavel.de)} a ${fmtMoeda(r.faixaProvavel.ate)}; base ${rotulo(r.base)}, ${r.amostra} itens${r.confiavel ? "" : ", pouco confiável"})`;
    });
    conteudo.querySelectorAll("[data-execucao]").forEach(b => b.onclick = tratar(async () => {
        const e = await api("GET", `/analises/execucoes/${b.dataset.execucao}`);
        abrirDialogo(`${rotuloTexto(e.tipo)} · ${fmtDataHora(e.concluidaEm)}`, `<pre style="white-space:pre-wrap;font-size:12px;max-height:60vh;overflow:auto">${esc(JSON.stringify(e.resultado, null, 2))}</pre>`, async () => {}, "Fechar");
    }));
}

// ---------------------------------------------- relatórios em segundo plano (fila)

let temporizadorTarefas = null;

async function baixarArquivo(rota) {
    const resposta = await fetch(API + rota, { headers: { authorization: `Bearer ${estado.token}` } });
    if (!resposta.ok) {
        const dados = await resposta.json().catch(() => null);
        throw new ErroApi(resposta.status, dados?.erro);
    }
    const nome = /filename="([^"]+)"/.exec(resposta.headers.get("content-disposition") ?? "")?.[1] ?? "relatorio";
    const url = URL.createObjectURL(await resposta.blob());
    const link = Object.assign(document.createElement("a"), { href: url, download: nome });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function telaTarefas() {
    clearTimeout(temporizadorTarefas);
    const [orgs, r] = await Promise.all([api("GET", "/organizacoes?tamanhoPagina=100"), api("GET", "/relatorios/tarefas?tamanhoPagina=30")]);
    const tipos = [["VIDA_UTIL", "Vida útil (todos os equipamentos ativos)"], ["INVENTARIO_RASTREABILIDADE", "Inventário com rastreabilidade"], ["RENTABILIDADE", "Rentabilidade (por equipamento)"], ["EFICIENCIA_OPERACIONAL", "Eficiência (por lote)"]];
    const etiqueta = s => `<span class="etiqueta ${s === "CONCLUIDA" ? "ok" : s === "FALHOU" ? "ruim" : "alerta"}">${rotulo(s)}</span>`;
    conteudo.innerHTML = `<h1>Relatórios em segundo plano</h1>
        <p class="subtitulo">Relatórios completos são gerados pela fila de processamento: a solicitação volta na hora e o arquivo fica disponível para download por tempo limitado.</p>
        <form class="barra cartao" id="novo">
            <label>Relatório <select name="tipo">${tipos.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join("")}</select></label>
            <label>Formato <select name="formato"><option>CSV</option><option>JSON</option></select></label>
            <label>Organização <select name="organizacaoId"><option value="">Todas</option>${orgs.itens.map(o => `<option value="${esc(o.id)}">${esc(o.id)} · ${esc(o.razaoSocial)}</option>`).join("")}</select></label>
            <label>Entrada de <input type="date" name="inicio"></label><label>até <input type="date" name="fim"></label>
            <button class="botao">Solicitar</button>
        </form>
        ${tabela(["Solicitado em", "Relatório", "Formato", "Organização", "Situação", { texto: "Tentativas", classe: "numero" }, { texto: "Tamanho", classe: "numero" }, ""],
            r.itens.map(t => [td(fmtDataHora(t.criadaEm)), td(rotulo(t.tipo)), td(esc(t.formato)), td(esc(t.organizacaoId ?? "Todas")),
                td(etiqueta(t.situacao) + (t.erro ? ` <small class="subtitulo" title="${esc(t.erro)}">${esc(t.erro.slice(0, 60))}</small>` : "")), td(t.tentativas, "numero"),
                td(t.tamanhoBytes ? `${fmtNumero(t.tamanhoBytes / 1024, 1)} KB` : "—", "numero"),
                td(`<div class="acoes">${t.situacao === "CONCLUIDA" ? `<button class="botao secundario pequeno" data-baixar="${esc(t.id)}">Baixar</button>` : ""}
                    ${t.situacao === "PROCESSANDO" ? "" : `<button class="botao perigo pequeno" data-excluir="${esc(t.id)}" data-situacao="${esc(t.situacao)}">${t.situacao === "PENDENTE" ? "Cancelar" : "Excluir"}</button>`}</div>`)]), "Nenhum relatório solicitado.")}`;
    $("#novo").onsubmit = tratar(async evento => {
        evento.preventDefault();
        await api("POST", "/relatorios/tarefas", formularioParaObjeto(evento.target));
        avisar("Relatório solicitado: acompanhe a situação abaixo.", "INFO");
        await renderizar();
    });
    conteudo.querySelectorAll("[data-baixar]").forEach(b => b.onclick = tratar(() => baixarArquivo(`/relatorios/tarefas/${b.dataset.baixar}/arquivo`)));
    conteudo.querySelectorAll("[data-excluir]").forEach(b => b.onclick = () => {
        clearTimeout(temporizadorTarefas);
        const cancelar = b.dataset.situacao === "PENDENTE";
        confirmar(cancelar ? "Cancelar este relatório? Ele ainda não foi gerado." : "Excluir este relatório e o arquivo gerado?", async () => {
            await api("DELETE", `/relatorios/tarefas/${b.dataset.excluir}`);
            avisar(cancelar ? "Relatório cancelado." : "Relatório excluído.");
        }, cancelar ? "Cancelar relatório" : "Excluir");
    });
    // Polling: enquanto houver relatório na fila ou em processamento, atualiza a tela a cada 2 s.
    if (r.itens.some(t => t.situacao === "PENDENTE" || t.situacao === "PROCESSANDO")) {
        temporizadorTarefas = setTimeout(() => { if (location.hash === "#/tarefas") renderizar(); }, 2000);
    }
}

// ---------------------------------------------- chaves de API (parceiros)

function mostrarSegredo(titulo, segredo) {
    abrirDialogo(titulo, `<p>Entregue esta chave ao parceiro por um canal seguro. <strong>Ela não será exibida de novo.</strong></p>
        <label>Chave (cabeçalho X-API-Key) <input readonly id="segredo-gerado" value="${esc(segredo)}" style="font-family:monospace"></label>
        <p class="subtitulo">Documentação para o parceiro: <a href="/api/v1/public/docs" target="_blank" rel="noopener">/api/v1/public/docs</a></p>`, async () => {}, "Entendi");
    // Sem atributos onclick no HTML: a Content-Security-Policy bloqueia scripts embutidos.
    const campo = $("#segredo-gerado");
    campo.addEventListener("focus", () => campo.select());
}

async function telaChavesApi() {
    const [chaves, catalogo, orgs] = await Promise.all([api("GET", "/chaves-api"), api("GET", "/chaves-api/catalogo"), api("GET", "/organizacoes?tamanhoPagina=100")]);
    const situacao = s => `<span class="etiqueta ${s === "ATIVA" ? "ok" : s === "INATIVA" ? "alerta" : "ruim"}">${rotulo(s)}</span>`;
    conteudo.innerHTML = `<div class="barra"><div><h1>Chaves de API</h1><p class="subtitulo">Acesso de parceiros externos à API pública (<a href="/api/v1/public/docs" target="_blank" rel="noopener">documentação</a>).</p></div>
        <span class="espaco"></span><button class="botao" id="nova">Nova chave</button></div>
        ${tabela(["Parceiro", "Prefixo", "Organização", "Escopos", "Plano", "Situação", "Último uso", ""], chaves.map(c => [td(esc(c.nome)), td(`<code>${esc(c.prefixo)}</code>`),
            td(esc(c.organizacaoId ?? "Todas")), td(c.escopos.map(e => `<span class="etiqueta">${rotulo(e)}</span>`).join(" ")),
            td(`${rotulo(c.plano)} <small class="subtitulo">${c.limites.requisicoesPorMinuto}/min</small>`), td(situacao(c.situacao)), td(fmtDataHora(c.ultimoUsoEm)),
            td(c.situacao === "REVOGADA" ? "" : `<div class="acoes"><button class="botao secundario pequeno" data-acao="situacao" data-id="${c.id}">${c.ativa ? "Desativar" : "Ativar"}</button>
                <button class="botao secundario pequeno" data-acao="rotacao" data-id="${c.id}">Novo segredo</button>
                <button class="botao perigo pequeno" data-acao="revogar" data-id="${c.id}">Revogar</button></div>`)]), "Nenhuma chave criada.")}
        <h2>Planos</h2>${tabela(["Plano", { texto: "Requisições/min", classe: "numero" }, { texto: "Relatórios simultâneos", classe: "numero" }],
            catalogo.planos.map(p => [td(rotulo(p.plano)), td(p.requisicoesPorMinuto, "numero"), td(p.relatoriosSimultaneos, "numero")]))}`;
    $("#nova").onclick = () => abrirDialogo("Nova chave de API", `<div class="formulario">
            <label class="largo">Parceiro <input name="nome" required minlength="3" maxlength="100" placeholder="ERP do cliente, cooperativa..."></label>
            <label>Organização <select name="organizacaoId"><option value="">Todas (somente leitura)</option>${orgs.itens.map(o => `<option value="${esc(o.id)}">${esc(o.id)} · ${esc(o.razaoSocial)}</option>`).join("")}</select></label>
            <label>Plano <select name="plano">${opcoes(catalogo.planos.map(p => p.plano), "BASICO")}</select></label>
            <fieldset class="largo"><legend>Escopos</legend>${catalogo.escopos.map(e => `<label class="caixa-marcacao"><input type="checkbox" name="escopo" value="${e.escopo}"> ${esc(e.descricao)}</label>`).join("")}</fieldset>
            <label>Expira em (opcional) <input type="date" name="expiraEm"></label></div>`, async f => {
        const escopos = [...f.querySelectorAll('[name="escopo"]:checked')].map(c => c.value);
        const r = await api("POST", "/chaves-api", {
            nome: f.nome.value.trim(), plano: f.plano.value, escopos, organizacaoId: f.organizacaoId.value || null,
            // Fim do dia escolhido, no fuso do navegador.
            ...(f.expiraEm.value ? { expiraEm: new Date(`${f.expiraEm.value}T23:59:59`).toISOString() } : {})
        });
        setTimeout(() => mostrarSegredo(`Chave criada: ${r.chave.prefixo}`, r.segredo), 50);
    }, "Criar");
    conteudo.querySelectorAll("[data-acao]").forEach(b => b.onclick = tratar(async () => {
        const c = chaves.find(x => x.id === b.dataset.id);
        if (b.dataset.acao === "situacao") {
            await api("PATCH", `/chaves-api/${c.id}`, { ativa: !c.ativa, versao: c.versao });
            avisar(c.ativa ? "Chave desativada." : "Chave reativada.");
            await renderizar();
        }
        if (b.dataset.acao === "rotacao") confirmar(`Gerar um novo segredo para ${c.nome}? O atual para de funcionar imediatamente.`, async () => {
            const r = await api("POST", `/chaves-api/${c.id}/rotacao`, { versao: c.versao });
            setTimeout(() => mostrarSegredo(`Novo segredo: ${r.chave.prefixo}`, r.segredo), 50);
        }, "Gerar");
        if (b.dataset.acao === "revogar") confirmar(`Revogar em definitivo a chave de ${c.nome}?`, async () => {
            await api("DELETE", `/chaves-api/${c.id}?versao=${c.versao}`);
            avisar("Chave revogada.");
        }, "Revogar");
    }));
}

// ---------------------------------------------- conta

async function telaConta() {
    conteudo.innerHTML = `<h1>Minha conta</h1><p class="subtitulo">${esc(estado.usuario.login)} · ${rotulo(estado.usuario.papel)}</p>
        <form class="cartao formulario" id="senha" style="max-width:560px">
            <label class="largo">Senha atual <input type="password" name="senhaAtual" required autocomplete="current-password"></label>
            <label>Nova senha <input type="password" name="senhaNova" required autocomplete="new-password"></label>
            <label>Confirme <input type="password" name="confirmacao" required autocomplete="new-password"></label>
            <div class="largo"><button class="botao">Alterar senha</button></div>
        </form>
        <h2>Permissões do seu perfil</h2><p>${[...estado.permissoes].map(p => `<span class="etiqueta">${rotulo(p)}</span>`).join(" ")}</p>`;
    $("#senha").onsubmit = tratar(async evento => {
        evento.preventDefault();
        const dados = formularioParaObjeto(evento.target);
        if (dados.senhaNova !== dados.confirmacao) throw new Error("As senhas não conferem.");
        const sessao = await api("PUT", "/auth/senha", { senhaAtual: dados.senhaAtual, senhaNova: dados.senhaNova });
        guardarToken(sessao.token);
        evento.target.reset();
        avisar("Senha alterada. As outras sessões abertas foram encerradas.");
    });
}

// ------------------------------------------------------------------ roteamento

const ROTAS = [
    [/^#\/painel$/, telaPainel],
    [/^#\/organizacoes$/, telaOrganizacoes],
    [/^#\/organizacoes\/([^/]+)$/, telaOrganizacao],
    [/^#\/lotes$/, telaLotes],
    [/^#\/lotes\/([^/]+)$/, telaLote],
    [/^#\/equipamentos$/, telaEquipamentos],
    [/^#\/equipamentos\/([^/]+)$/, telaEquipamento],
    [/^#\/usuarios$/, telaUsuarios],
    [/^#\/parametros$/, telaParametros],
    [/^#\/relatorios$/, telaRelatorios],
    [/^#\/auditoria$/, telaAuditoria],
    [/^#\/analises$/, () => telaAnalises()],
    [/^#\/analises\/([a-z-]+)$/, telaAnalises],
    [/^#\/tarefas$/, telaTarefas],
    [/^#\/chaves-api$/, telaChavesApi],
    [/^#\/conta$/, telaConta]
];

async function renderizar() {
    try {
        if (estado.token && !estado.usuario) {
            try { await carregarUsuario(); } catch { guardarToken(null); }
        }
        if (!estado.usuario) {
            montarTopo();
            await telaLogin();
            return;
        }
        if (!location.hash || location.hash === "#/login") {
            location.hash = "#/painel";
            return;
        }
        montarTopo();
        const rota = ROTAS.map(([padrao, tela]) => [padrao.exec(location.hash), tela]).find(([m]) => m);
        if (!rota) {
            conteudo.innerHTML = `<h1>Página não encontrada</h1><p><a href="#/painel">Voltar ao painel</a></p>`;
            return;
        }
        const [m, tela] = rota;
        await tela(...m.slice(1).map(decodeURIComponent));
    } catch (erro) {
        if (erro instanceof ErroApi && erro.sessaoEncerrada) return;
        conteudo.innerHTML = `<h1>Não foi possível carregar</h1><p class="subtitulo">${esc(erro.message)}</p><p><a href="#/painel">Voltar ao painel</a></p>`;
    }
}

window.addEventListener("hashchange", renderizar);
renderizar();
