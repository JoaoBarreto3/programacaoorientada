// Seed: popula o banco com uma massa de dados representativa, passando pelos mesmos serviços
// da API (todas as validações, regras de negócio e auditoria são aplicadas).
// Uso: npm run db:seed   (só roda com o banco sem usuários; para recomeçar: npm run db:resetar)
import "dotenv/config";
import { criarClientePrisma } from "../src/infra/banco";
import Servicos from "../src/servicos/Servicos";
import { RelogioSistema } from "../src/comum/Relogio";
import { adicionarDias, dataCivil } from "../src/comum/datas";
import { UsuarioAutenticado } from "../src/dominio/Sessao";
import { DadosEquipamento } from "../src/fabricas/FabricaEquipamento";
import { calcularDigitoCNPJ } from "../src/validacao/cnpj";
import { ITERACOES_PADRAO } from "../src/dominio/senha";

const SENHA = process.env.SEED_SENHA ?? "Greencode2026";

function cnpj(base12: string): string {
    const dv1 = calcularDigitoCNPJ(base12);
    return base12 + dv1 + calcularDigitoCNPJ(base12 + dv1);
}

function equipamento(tipo: DadosEquipamento["tipo"], marca: string, modelo: string, ano: number, estado: DadosEquipamento["estadoFisico"], peso: number): DadosEquipamento {
    return { tipo, marca, modelo, anoFabricacao: ano, estadoFisico: estado, pesoQuilogramas: peso };
}

async function semear(): Promise<void> {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL não definida (veja o .env.example).");
    const prisma = criarClientePrisma(url);
    const relogio = new RelogioSistema();
    const emissorSemToken = { emitir: () => ({ token: "", criacao: new Date(), expiracao: new Date() }) };
    const iteracoes = Number(process.env.SENHA_ITERACOES) || ITERACOES_PADRAO;
    const s = new Servicos(prisma, relogio, emissorSemToken, iteracoes);
    try {
        if (!await s.autenticacao.precisaProvisionar()) {
            console.log("O banco já possui usuários: seed ignorado. Para recomeçar do zero use: npm run db:resetar");
            return;
        }
        const hoje = dataCivil(relogio.agora());
        const dias = (n: number) => adicionarDias(hoje, n);

        // ---------------------------------------------------------------- usuários (um por papel)
        await s.autenticacao.provisionar("admin", SENHA);
        const admin = await prisma.usuario.findUniqueOrThrow({ where: { login: "admin" } });
        const comoAdmin: UsuarioAutenticado = { id: admin.id, login: "admin", papel: "ADMINISTRADOR" };
        const usuarios: Record<string, UsuarioAutenticado> = {};
        for (const [login, papel] of [["operador", "OPERADOR_CADASTRO"], ["gestor", "GESTOR_ALMOXARIFADO"], ["auditor", "AUDITOR"]] as const) {
            const u = await s.usuarios.criarUsuario(comoAdmin, login, SENHA, papel);
            usuarios[login] = { id: u.id, login, papel };
        }
        const operador = usuarios.operador!;
        const gestor = usuarios.gestor!;
        await s.parametros.definir(comoAdmin, "aliquota", "CSLL", 0.09);

        // ---------------------------------------------------------------- organizações e contratos
        const contrato = (assinatura: number, vencimento: number, valor: number, clausulas: string[], renovacaoAutomatica = false) =>
            ({ dataAssinatura: dias(assinatura), dataVencimento: dias(vencimento), valorMensal: valor, clausulas, renovacaoAutomatica });

        const banco = await s.organizacoes.cadastrarOrganizacao(operador, {
            razaoSocial: "Banco Horizonte S.A.", cnpj: "11.222.333/0001-81", inscricaoEstadual: "110.042.490.114",
            enderecoCompleto: "Av. Paulista, 1000, Bela Vista, São Paulo/SP", telefone: "(11) 3003-4000", email: "ti@bancohorizonte.com.br",
            contrato: contrato(-200, 530, 4500, ["Coleta mensal nas agências da Grande SP", "Laudo de destinação por lote", "Sanitização de discos (NIST 800-88)"])
        });
        const hospital = await s.organizacoes.cadastrarOrganizacao(operador, {
            razaoSocial: "Hospital Santa Clara", cnpj: cnpj("459876120001"), enderecoCompleto: "Rua das Acácias, 250, Centro, Belo Horizonte/MG",
            telefone: "(31) 3274-9000", email: "patrimonio@santaclara.org.br",
            contrato: contrato(-400, -35, 2800, ["Coleta quinzenal", "Equipamentos médicos excluídos"], true)
        });
        const universidade = await s.organizacoes.cadastrarOrganizacao(operador, {
            razaoSocial: "Universidade Federal do Vale", cnpj: cnpj("12ABC34501DE"), inscricaoEstadual: "ISENTO",
            enderecoCompleto: "Campus Universitário, s/n, Petrolina/PE", telefone: "(87) 2101-6800", email: "sustentabilidade@ufvale.edu.br",
            contrato: contrato(-90, 640, 1500, ["Coleta semestral dos laboratórios", "Relatório anual de sustentabilidade"])
        });
        const varejo = await s.organizacoes.cadastrarOrganizacao(operador, {
            razaoSocial: "Rede Varejo Sul Ltda", cnpj: cnpj("778899001234"), enderecoCompleto: "Av. Ipiranga, 6681, Porto Alegre/RS",
            email: "compras@varejosul.com.br",
            // Contrato vencido e sem renovação automática: a organização não pode registrar novos lotes.
            contrato: contrato(-500, -10, 3900, ["Coleta mensal dos PDVs"])
        });
        const construtora = await s.organizacoes.cadastrarOrganizacao(operador, {
            razaoSocial: "Construtora Alfa Engenharia", cnpj: cnpj("334455667788"), enderecoCompleto: "Rua XV de Novembro, 120, Curitiba/PR",
            email: "adm@alfaeng.com.br"
        });
        await s.organizacoes.alterarSituacao(operador, construtora.id, false);
        void varejo;

        // ---------------------------------------------------------------- lotes e equipamentos
        // Lote 1 (Banco, 60 dias atrás): triagem concluída e equipamentos em vários destinos.
        const l1 = await s.lotes.criarLote(gestor, {
            organizacaoId: banco.id, notaFiscal: "104233", transportadora: "TransRapida Logística", dataEntrada: dias(-60),
            observacoes: "Renovação do parque de estações das agências",
            equipamentos: [
                equipamento("COMPUTADOR_MESA", "Dell", "OptiPlex 7050", 2017, "USADO_MODERADO", 7.4),
                equipamento("NOTEBOOK", "Lenovo", "ThinkPad T470", 2018, "BOM_ESTADO", 1.6),
                equipamento("MONITOR", "LG", "24MK430H", 2019, "USADO_LEVE", 3.2),
                equipamento("IMPRESSORA", "HP", "LaserJet M402", 2016, "DANIFICADO_LEVE", 8.9),
                equipamento("FONTE_ALIMENTACAO", "Seasonic", "S12III 500W", 2015, "USADO_MODERADO", 1.3)
            ]
        });
        await s.lotes.processarTriagem(gestor, l1.id);
        const [cpu, ntb, mon, imp, fnt] = l1.equipamentos.map(e => e.id) as [string, string, string, string, string];
        await s.equipamentos.atualizarEstadoFisico(gestor, imp, "INSERVIVEL", "Placa lógica queimada e carcaça trincada");
        await s.equipamentos.atualizarEstadoFisico(gestor, cpu, "DANIFICADO_LEVE", "Gabinete amassado e fonte inoperante");
        await s.lotes.processarTriagem(gestor, l1.id);
        await s.equipamentos.registrarMovimentacao(gestor, cpu, "Galpão A - baia 3", "");
        await s.equipamentos.atualizarStatus(gestor, cpu, "AGUARDANDO_DESMONTE", "");
        await s.equipamentos.registrarMovimentacao(gestor, cpu, "Linha de desmonte 1", "");
        await s.equipamentos.atualizarStatus(gestor, cpu, "EM_DESMONTE", "Retirada de memória e processador");
        await s.equipamentos.atualizarStatus(gestor, ntb, "PECAS_REAPROVEITADAS", "Apto para recondicionamento");
        await s.equipamentos.registrarMovimentacao(gestor, ntb, "Estoque de recondicionados", "");
        await s.equipamentos.atualizarStatus(gestor, mon, "AGUARDANDO_DESMONTE", "");
        await s.equipamentos.atualizarStatus(gestor, imp, "DESCARTE_SEGURO", "Toner e placa sem condições de reuso");
        await s.equipamentos.atualizarStatus(gestor, imp, "BAIXA_DEFINITIVA", "Laudo de destinação emitido");
        await s.equipamentos.atualizarStatus(gestor, fnt, "AGUARDANDO_DESMONTE", "");
        await s.equipamentos.atualizarStatus(gestor, fnt, "EM_DESMONTE", "");
        await s.equipamentos.atualizarStatus(gestor, fnt, "MATERIAL_RECICLAVEL", "Cobre e alumínio separados");

        // Lote 2 (Banco, 40 dias atrás): todo o lote já recebeu baixa (FINALIZADO).
        const l2 = await s.lotes.criarLote(gestor, {
            organizacaoId: banco.id, notaFiscal: "104871", transportadora: "TransRapida Logística", dataEntrada: dias(-40),
            equipamentos: [
                equipamento("ROTEADOR", "Cisco", "ISR 1941", 2014, "USADO_MODERADO", 5.1),
                equipamento("CABO_ESTRUTURADO", "Furukawa", "Cat5e (caixa 305 m)", 2012, "USADO_LEVE", 9.5)
            ]
        });
        await s.lotes.processarTriagem(gestor, l2.id);
        await s.lotes.processarTriagem(gestor, l2.id);
        for (const e of l2.equipamentos) {
            await s.equipamentos.atualizarStatus(gestor, e.id, "PECAS_REAPROVEITADAS", "");
            await s.equipamentos.atualizarStatus(gestor, e.id, "BAIXA_DEFINITIVA", "Vendido a recicladora parceira");
        }

        // Lote 3 (Hospital, 20 dias atrás): em triagem.
        const l3 = await s.lotes.criarLote(gestor, {
            organizacaoId: hospital.id, notaFiscal: "5521", transportadora: "EcoLog Minas", dataEntrada: dias(-20),
            equipamentos: [
                equipamento("COMPUTADOR_MESA", "Positivo", "Master D3400", 2016, "USADO_LEVE", 6.8),
                equipamento("MONITOR", "Samsung", "S22F350", 2017, "BOM_ESTADO", 2.7),
                equipamento("SERVIDOR", "Dell", "PowerEdge R720", 2013, "USADO_MODERADO", 27.5)
            ]
        });
        await s.lotes.processarTriagem(gestor, l3.id);
        await s.equipamentos.atualizarEstadoFisico(gestor, l3.equipamentos[2]!.id, "DANIFICADO_GRAVE", "Controladora RAID e duas fontes queimadas");

        // Lote 4 (Universidade, 5 dias atrás): recém-recebido, aguardando triagem.
        const l4 = await s.lotes.criarLote(gestor, {
            organizacaoId: universidade.id, notaFiscal: "880012", transportadora: "Sertão Cargas", dataEntrada: dias(-5),
            observacoes: "Laboratório de informática do bloco B",
            equipamentos: [
                equipamento("COMPUTADOR_MESA", "Lenovo", "ThinkCentre M720", 2019, "BOM_ESTADO", 5.9),
                equipamento("COMPUTADOR_MESA", "Lenovo", "ThinkCentre M720", 2019, "USADO_LEVE", 5.9),
                equipamento("NOTEBOOK", "Acer", "Aspire 5", 2020, "NOVO", 1.8),
                equipamento("IMPRESSORA", "Brother", "HL-L2360DW", 2018, "USADO_MODERADO", 7.2)
            ]
        });
        await s.equipamentos.registrarMovimentacao(gestor, l4.equipamentos[0]!.id, "Galpão B - recebimento de TI", "");

        const resumo = await s.relatorios.painel(comoAdmin);
        console.log("Seed concluído:");
        console.log(`  usuários: admin, operador, gestor, auditor (senha: ${SENHA})`);
        console.log(`  organizações: ${resumo.organizacoes} (${resumo.organizacoesAtivas} ativas)`);
        console.log(`  lotes por status: ${JSON.stringify(resumo.lotesPorStatus)}`);
        console.log(`  equipamentos por status: ${JSON.stringify(resumo.equipamentosPorStatus)}`);
    } finally {
        await prisma.$disconnect();
    }
}

semear().catch(erro => {
    console.error("Falha no seed:", erro instanceof Error ? erro.message : erro);
    process.exit(1);
});
