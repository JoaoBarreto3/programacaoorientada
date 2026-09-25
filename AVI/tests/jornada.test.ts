import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import { diretorioTemporario, removerDiretorio } from "./auxiliares";

const MAIN = path.join(__dirname, "..", "src", "main.js");
const SENHA_ADMIN = "Verde#2026";
const SENHA = "Coleta#2026";

interface Execucao {
    saida: string;
    codigo: number | null;
}

function executarCLI(diretorio: string, linhas: string[]): Promise<Execucao> {
    return new Promise((resolver, rejeitar) => {
        const filho = spawn(process.execPath, [MAIN, "--dados", diretorio], {
            env: { ...process.env, NO_COLOR: "1" }
        });
        let saida = "";
        filho.stdout.on("data", d => { saida += d.toString(); });
        filho.stderr.on("data", d => { saida += d.toString(); });
        filho.on("error", rejeitar);
        filho.on("close", codigo => resolver({ saida, codigo }));
        filho.stdin.end(linhas.join("\n") + "\n");
    });
}

function login(usuario: string, senha: string): string[] {
    return [usuario, senha];
}

function trecho(saida: string, comando: string): string {
    const inicio = saida.indexOf(`> ${comando}`);
    assert.ok(inicio >= 0, `comando não encontrado na saída: ${comando}`);
    const fim = saida.indexOf("greencode(", inicio + 2);
    return saida.slice(inicio, fim < 0 ? undefined : fim);
}

function hojeISO(deslocamentoDias = 0): string {
    const d = new Date();
    d.setDate(d.getDate() + deslocamentoDias);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

test("Jornada completa: provisionamento → cadastros → triagem → movimentações → rastreabilidade", { timeout: 120_000 }, async () => {
    const dir = diretorioTemporario("greencode-jornada-");
    try {
        const r1 = await executarCLI(dir, [
            "", SENHA_ADMIN, SENHA_ADMIN,
            ...login("admin", SENHA_ADMIN),
            "usuario criar operador --papel OPERADOR_CADASTRO", SENHA, SENHA,
            "usuario criar gestor --papel GESTOR_ALMOXARIFADO", SENHA, SENHA,
            "usuario criar auditor --papel AUDITOR", SENHA, SENHA,
            "param definir depreciacao NOTEBOOK 0.25",
            "sair",
            ...login("operador", SENHA),
            `org criar --razao "Banco Horizonte S.A." --cnpj 11.222.333/0001-81 --email ti@horizonte.com.br --endereco "Av. Paulista, 1000, São Paulo/SP" --telefone "(11) 3333-4444" --vencimento ${hojeISO(365)} --valor 4500 --clausulas "Coleta mensal; Laudo de destinação"`,
            `org criar --razao "Cópia" --cnpj 11222333000181 --email a@b.com --endereco "Rua Qualquer, 10, Santos/SP" --vencimento ${hojeISO(365)} --valor 1 --clausulas X`,
            `org criar --razao "Inválida" --cnpj 11.222.333/0001-00 --email a@b.com --endereco "Rua Qualquer, 10, Santos/SP" --vencimento ${hojeISO(365)} --valor 1 --clausulas X`,
            `contrato renovar --org BR001 --vencimento ${hojeISO(730)}`,
            "lote criar --org BR001 --nf 123456 --transp TransRapida",
            "sair",
            ...login("gestor", SENHA),
            `lote criar --org BR001 --nf 777 --transp TransRapida --data ${hojeISO(1)}`,
            "lote criar --org BR001 --nf 123456 --transp TransRapida",
            'equip adicionar --lote LT-2026-0001 --tipo NOTEBOOK --marca Dell --modelo "Latitude 5490" --ano 2019 --estado BOM_ESTADO --peso 1.9',
            "equip adicionar --lote LT-2026-0001 --tipo MONITOR --marca LG --modelo 24MK430 --ano 2018 --estado USADO_LEVE --peso 3,4",
            "equip status EQ-000001 AGUARDANDO_DESMONTE",
            "lote triagem LT-2026-0001",
            "equip estado EQ-000001 --estado USADO_LEVE",
            "equip estado EQ-000002 --estado DANIFICADO_GRAVE",
            'equip estado EQ-000002 --estado DANIFICADO_GRAVE --justificativa "Painel quebrado e vazamento de cristal líquido"',
            "equip status EQ-000002 DESCARTE_SEGURO",
            "lote triagem LT-2026-0001",
            'equip mover EQ-000001 --destino "Galpão B / Bancada 3"',
            "equip status EQ-000001 AGUARDANDO_DESMONTE",
            'equip mover EQ-000001 --destino "Linha de desmonte 1"',
            "equip status EQ-000001 EM_DESMONTE",
            "equip status EQ-000001 MATERIAL_RECICLAVEL --justificativa \"Placa-mãe e carcaça para reciclagem\"",
            "equip status EQ-000002 DESCARTE_SEGURO",
            "usuario listar",
            "sair",
            ""
        ]);
        const s1 = r1.saida;
        assert.equal(r1.codigo, 0, s1);
        assert.match(s1, /MODO DE PROVISIONAMENTO INICIAL/);
        assert.match(s1, /\[OK\] Provisionamento concluído\. Administrador "admin" criado/);
        assert.ok(!s1.includes(SENHA_ADMIN) && !s1.includes(SENHA), "senhas nunca são exibidas");
        assert.match(s1, /\[OK\] Usuário "auditor" criado com perfil AUDITOR/);
        assert.match(s1, /\[OK\] Organização BR001 cadastrada: Banco Horizonte S\.A\. \(CNPJ 11\.222\.333\/0001-81\), contrato CT-BR001/);
        assert.match(trecho(s1, "org criar --razao \"Cópia\""), /\[ERRO\] CNPJ 11\.222\.333\/0001-81 já cadastrado para BR001/);
        assert.match(trecho(s1, "org criar --razao \"Inválida\""), /\[ERRO\] .*dígitos verificadores/);
        assert.match(s1, /\[OK\] Contrato de BR001 renovado até/);
        assert.match(trecho(s1, "lote criar --org BR001 --nf 123456"), /\[ERRO\] Comando desconhecido ou indisponível para o perfil OPERADOR_CADASTRO/);
        assert.match(trecho(s1, "lote criar --org BR001 --nf 777"), /\[ERRO\] .*está no futuro/);
        assert.match(s1, /\[OK\] Lote LT-2026-0001 criado para BR001 \(NF 123456, TransRapida\)/);
        assert.match(s1, /\[OK\] Equipamento EQ-000001 incluído no lote LT-2026-0001 — código de barras GCNTB\d{8}/);
        assert.match(trecho(s1, "equip status EQ-000001 AGUARDANDO_DESMONTE\n[ERRO]"), /só pode ir para AGUARDANDO_DESMONTE após a triagem completa/);
        assert.match(trecho(s1, "equip estado EQ-000002 --estado DANIFICADO_GRAVE\n"), /\[ERRO\] Justificativa obrigatória/);
        assert.match(s1, /\[OK\] Estado físico de EQ-000002 alterado para DANIFICADO_GRAVE/);
        assert.match(trecho(s1, "equip status EQ-000002 DESCARTE_SEGURO\n[ERRO]"), /conclua a triagem/);
        assert.match(s1, /\[OK\] Triagem do lote LT-2026-0001 concluída/);
        assert.match(s1, /\[OK\] Equipamento EQ-000001 agora está em MATERIAL_RECICLAVEL/);
        assert.match(trecho(s1, "usuario listar"), /indisponível para o perfil GESTOR_ALMOXARIFADO/);

        const arquivos = (function listar(d: string): string[] {
            return fs.readdirSync(d, { withFileTypes: true })
                .flatMap(e => e.isDirectory() ? listar(path.join(d, e.name)) : [path.join(d, e.name)]);
        })(dir);
        for (const arquivo of arquivos.filter(a => !a.endsWith("greencode.conf"))) {
            const conteudo = fs.readFileSync(arquivo, "utf8");
            for (const sensivel of ["Horizonte", "TransRapida", "11222333000181", "operador", "Latitude"]) {
                assert.ok(!conteudo.includes(sensivel), `"${sensivel}" em texto claro em ${arquivo}`);
            }
        }
        assert.ok(fs.existsSync(path.join(dir, "historico", "gestor.dat")), "histórico de comandos persistido por usuário");

        const r2 = await executarCLI(dir, [
            ...login("auditor", "SenhaErrada1"),
            ...login("auditor", SENHA),
            "equip rastrear EQ-000001",
            "relatorio organizacao BR001",
            "relatorio financeiro",
            "relatorio status MATERIAL_RECICLAVEL",
            "journal listar --entidade EQ-000001",
            "journal verificar",
            "lote criar --org BR001 --nf 999 --transp X",
            "equip mover EQ-000001 --destino Qualquer",
            "encerrar"
        ]);
        const s2 = r2.saida;
        assert.equal(r2.codigo, 0, s2);
        assert.match(s2, /\[ERRO\] Usuário ou senha inválidos\./);
        const menu = s2.slice(s2.indexOf("Menu — perfil AUDITOR"), s2.indexOf("greencode(auditor@AUDITOR)>"));
        assert.match(menu, /relatorio financeiro/);
        assert.match(menu, /journal verificar/);
        assert.ok(!/lote criar|equip mover|usuario criar|org criar|param definir/.test(menu), "o menu oculta o que o auditor não pode fazer");

        const rastreio = trecho(s2, "equip rastrear EQ-000001");
        assert.match(rastreio, /Origem: +BR001 — Banco Horizonte S\.A\./);
        assert.match(rastreio, /Lote: +LT-2026-0001 — NF 123456 — TransRapida/);
        assert.match(rastreio, /Situação: +MATERIAL_RECICLAVEL \/ USADO_LEVE \/ local: Linha de desmonte 1/);
        assert.match(rastreio, /Linha do tempo \(8 movimentações\)/);
        for (const etapa of ["RECEBIMENTO", "EM_TRIAGEM", "USADO_LEVE", "Galpão B / Bancada 3", "AGUARDANDO_DESMONTE", "EM_DESMONTE", "MATERIAL_RECICLAVEL", "Linha de desmonte 1"]) {
            assert.ok(rastreio.includes(etapa), `etapa ausente na rastreabilidade: ${etapa}`);
        }
        assert.match(trecho(s2, "relatorio organizacao BR001"), /Total: 1 lote\(s\), 2 equipamento\(s\), 5\.30 kg/);
        assert.match(trecho(s2, "relatorio financeiro"), /Valor residual estimado: +R\$ 387,00/);
        assert.match(trecho(s2, "relatorio status MATERIAL_RECICLAVEL"), /EQ-000001/);
        assert.match(trecho(s2, "journal listar --entidade EQ-000001"), /EQUIPAMENTO_MOVIMENTAR +gestor/);
        assert.match(trecho(s2, "journal verificar"), /\[OK\] Journal íntegro/);
        assert.match(trecho(s2, "lote criar --org BR001 --nf 999"), /indisponível para o perfil AUDITOR/);
        assert.match(trecho(s2, "equip mover EQ-000001"), /indisponível para o perfil AUDITOR/);

        const lotes = path.join(dir, "lotes.dat");
        const original = fs.readFileSync(lotes, "utf8");
        fs.writeFileSync(lotes, original.slice(0, 40) + (original[40] === "A" ? "B" : "A") + original.slice(41));
        const r3 = await executarCLI(dir, [...login("admin", SENHA_ADMIN), "encerrar"]);
        assert.equal(r3.codigo, 1);
        assert.match(r3.saida, /\[CRÍTICO\] Arquivo "lotes\.dat" corrompido ou adulterado/);
        fs.writeFileSync(lotes, original);

        fs.renameSync(path.join(dir, "greencode.conf"), path.join(dir, "greencode.conf.bak"));
        const r4 = await executarCLI(dir, [""]);
        assert.equal(r4.codigo, 1);
        assert.match(r4.saida, /\[CRÍTICO\] .*contém dados, mas o arquivo de configuração mestre/);
    } finally {
        removerDiretorio(dir);
    }
});

test("Provisionamento interrompido é refeito; dados sem configuração mestre não são sobrescritos", { timeout: 60_000 }, async () => {
    const dir = diretorioTemporario("greencode-provisionamento-");
    try {
        fs.writeFileSync(path.join(dir, ".provisionando"), "2026-09-25T10:00:00Z");
        fs.writeFileSync(path.join(dir, "credenciais.dat"), "GC1:parcial");
        const r = await executarCLI(dir, ["", SENHA_ADMIN, SENHA_ADMIN, ""]);
        assert.equal(r.codigo, 0, r.saida);
        assert.match(r.saida, /\[AVISO\] Um provisionamento anterior foi interrompido/);
        assert.match(r.saida, /\[OK\] Provisionamento concluído/);
        assert.equal(fs.existsSync(path.join(dir, ".provisionando")), false);
    } finally {
        removerDiretorio(dir);
    }
});
