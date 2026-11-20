// Massa histórica para a camada analítica (AV3): 12 meses de operação de uma organização, com três
// operadores de ritmos diferentes, sazonalidade de fim de ano, desgaste dos equipamentos e destinação.
// Tudo passa pelos mesmos serviços da API (regras, transações e auditoria), com um relógio controlado
// que "volta no tempo" e executa os eventos em ordem cronológica. Gerador pseudoaleatório com semente
// fixa: o seed produz sempre os mesmos dados.
import { RelogioFixo } from "../src/comum/Relogio";
import { adicionarDias } from "../src/comum/datas";
import { UsuarioAutenticado } from "../src/dominio/Sessao";
import EstadoFisico from "../src/dominio/enums/EstadoFisico";
import StatusRastreamento from "../src/dominio/enums/StatusRastreamento";
import TipoEquipamento from "../src/dominio/enums/TipoEquipamento";
import { DadosEquipamento } from "../src/fabricas/FabricaEquipamento";
import Servicos from "../src/servicos/Servicos";
import { TipoAnalise } from "../src/servicos/ServicoAnalise";
import { LOGIN_AGENDADOR } from "../src/servicos/processamento";
import { calcularDigitoCNPJ } from "../src/validacao/cnpj";

const DIA = 86_400_000;

function cnpjDe(base12: string): string {
    const dv1 = calcularDigitoCNPJ(base12);
    return base12 + dv1 + calcularDigitoCNPJ(base12 + dv1);
}
const ESCALA = Object.values(EstadoFisico);

// mulberry32: gerador pseudoaleatório simples e reprodutível.
function gerador(semente: number) {
    let a = semente >>> 0;
    const proximo = () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
        numero: proximo,
        entre: (min: number, max: number) => min + proximo() * (max - min),
        inteiro: (min: number, max: number) => Math.floor(min + proximo() * (max - min + 1)),
        escolher: <T>(itens: readonly T[]) => itens[Math.floor(proximo() * itens.length)]!
    };
}

const CATALOGO: { tipo: TipoEquipamento; peso: number; modelos: [string, string][] }[] = [
    { tipo: "NOTEBOOK", peso: 1.8, modelos: [["Dell", "Latitude 5490"], ["Lenovo", "ThinkPad T480"], ["HP", "ProBook 440 G5"], ["Acer", "Aspire 5"]] },
    { tipo: "COMPUTADOR_MESA", peso: 6.5, modelos: [["Dell", "OptiPlex 7050"], ["Lenovo", "ThinkCentre M720"], ["Positivo", "Master D3400"]] },
    { tipo: "MONITOR", peso: 3.1, modelos: [["LG", "24MK430H"], ["Samsung", "S22F350"], ["Dell", "P2419H"]] },
    { tipo: "IMPRESSORA", peso: 8.5, modelos: [["HP", "LaserJet M402"], ["Brother", "HL-L2360DW"]] },
    { tipo: "SERVIDOR", peso: 24, modelos: [["Dell", "PowerEdge R720"], ["HP", "ProLiant DL380"]] },
    { tipo: "ROTEADOR", peso: 4.2, modelos: [["Cisco", "ISR 1941"], ["MikroTik", "CCR1036"]] },
    { tipo: "FONTE_ALIMENTACAO", peso: 1.3, modelos: [["Seasonic", "S12III 500W"], ["Corsair", "CV450"]] }
];
// Peso de sorteio de cada linha do catálogo (notebooks e desktops são a maior parte do descarte).
const FREQUENCIA = [5, 4, 3, 2, 1, 1, 1];

interface Evento {
    quando: Date;
    ordem: number;
    executar: () => Promise<unknown>;
}

export interface UsuariosHistorico {
    operador: UsuarioAutenticado;
    gestores: UsuarioAutenticado[];
}

export async function semearHistorico(s: Servicos, relogio: RelogioFixo, usuarios: UsuariosHistorico, agora: Date) {
    const rnd = gerador(20261119);
    const inicio = adicionarDias(agora, -370);
    relogio.definir(inicio);
    const hoje = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

    const prefeitura = await s.organizacoes.cadastrarOrganizacao(usuarios.operador, {
        razaoSocial: "Prefeitura Municipal de Vale Verde", cnpj: cnpjDe("456789010001"), inscricaoEstadual: "ISENTO",
        enderecoCompleto: "Praça da Matriz, 1, Centro, Vale Verde/SP", telefone: "(19) 3321-4000", email: "ti@valeverde.sp.gov.br",
        contrato: {
            dataAssinatura: hoje(adicionarDias(agora, -400)), dataVencimento: hoje(adicionarDias(agora, 330)), valorMensal: 6200,
            clausulas: ["Coleta quinzenal nas secretarias", "Relatório trimestral de destinação", "Sanitização de discos"], renovacaoAutomatica: true
        }
    });

    // Ritmo de cada operador (dias de triagem por lote, mais um adicional por equipamento).
    const ritmo = new Map<string, number>([[usuarios.gestores[0]!.login, 1.1], [usuarios.gestores[1]!.login, 0.3], [usuarios.gestores[2]!.login, 0.6]]);
    const eventos: Evento[] = [];
    let ordem = 0;
    const agendar = (quando: Date, executar: () => Promise<unknown>) => {
        if (quando.getTime() < agora.getTime() - 3_600_000) eventos.push({ quando, ordem: ordem++, executar });
    };

    for (let i = 0; i < 24; i++) {
        // Entrada às 10h (13h UTC), a cada ~15 dias.
        const dia = hoje(adicionarDias(inicio, 5 + i * 15 + rnd.inteiro(0, 4)));
        const entrada = new Date(dia.getTime() + 13 * 3_600_000);
        if (entrada.getTime() > agora.getTime() - 4 * DIA) break;
        const fimDeAno = [10, 11].includes(entrada.getUTCMonth());
        const operador = rnd.escolher(usuarios.gestores);
        const equipamentos: (DadosEquipamento & { nivel: number })[] = [];
        for (let k = rnd.inteiro(3, 7); k > 0; k--) {
            let sorteio = rnd.numero() * FREQUENCIA.reduce((a, b) => a + b, 0);
            const linha = CATALOGO[FREQUENCIA.findIndex(f => (sorteio -= f) < 0)]!;
            const [marca, modelo] = rnd.escolher(linha.modelos);
            const ano = rnd.inteiro(2011, 2024);
            const idade = entrada.getUTCFullYear() - ano + 0.5;
            // Desgaste cresce com a idade (≈ 0,45 nível por ano), com variação entre equipamentos.
            const nivel = Math.max(0, Math.min(5, Math.round(0.45 * idade + rnd.entre(-1.2, 1.2))));
            equipamentos.push({
                tipo: linha.tipo, marca, modelo, anoFabricacao: ano, estadoFisico: ESCALA[nivel]!, nivel,
                pesoQuilogramas: Math.round(linha.peso * rnd.entre(0.85, 1.15) * 1000) / 1000
            });
        }
        // Espera maior no fim do ano (recesso e pico de descarte de fim de exercício).
        const espera = fimDeAno ? rnd.entre(3, 8) : rnd.entre(0.4, 3);
        const triagem = ritmo.get(operador.login)! * rnd.entre(0.7, 1.3) + 0.08 * equipamentos.length;
        const inicioTriagem = new Date(entrada.getTime() + espera * DIA);
        const fimTriagem = new Date(inicioTriagem.getTime() + triagem * DIA);
        const lote = { id: "", equipamentos: [] as string[] };

        agendar(entrada, async () => {
            const criado = await s.lotes.criarLote(operador, {
                organizacaoId: prefeitura.id, notaFiscal: String(30000 + i * 7), transportadora: rnd.escolher(["EcoLog SP", "TransRapida Logística", "Frota Municipal"]),
                dataEntrada: dia, equipamentos: equipamentos.map(({ nivel: _n, ...e }) => e)
            });
            lote.id = criado.id;
            lote.equipamentos = criado.equipamentos.map(e => e.id);
        });
        agendar(inicioTriagem, () => s.lotes.processarTriagem(operador, lote.id));
        // Na triagem, parte dos equipamentos é reclassificada para um estado pior que o declarado.
        equipamentos.forEach((e, k) => {
            if (rnd.numero() < 0.35 && e.nivel < 5) {
                const novo = Math.min(5, e.nivel + rnd.inteiro(1, 2));
                const quando = new Date(inicioTriagem.getTime() + (fimTriagem.getTime() - inicioTriagem.getTime()) * rnd.entre(0.2, 0.8));
                agendar(quando, () => s.equipamentos.atualizarEstadoFisico(operador, lote.equipamentos[k]!, ESCALA[novo]!,
                    "Avaliação na triagem: desgaste maior que o declarado na nota"));
                e.nivel = novo;
            }
        });
        agendar(fimTriagem, () => s.lotes.processarTriagem(operador, lote.id));

        // Destinação depois da triagem, conforme o estado.
        equipamentos.forEach((e, k) => {
            const id = () => lote.equipamentos[k]!;
            const depois = (dias: number) => new Date(fimTriagem.getTime() + dias * DIA + k * 60_000);
            const status = (dias: number, novo: StatusRastreamento, justificativa = "") =>
                agendar(depois(dias), () => s.equipamentos.atualizarStatus(operador, id(), novo, justificativa));
            if (e.nivel <= 2) {
                status(rnd.entre(1, 4), "PECAS_REAPROVEITADAS", "Apto para recondicionamento");
                status(rnd.entre(15, 30), "BAIXA_DEFINITIVA", "Vendido para recondicionadora parceira");
            } else if (e.nivel <= 3) {
                status(1, "AGUARDANDO_DESMONTE");
                status(rnd.entre(3, 8), "EM_DESMONTE");
                status(rnd.entre(10, 18), "MATERIAL_RECICLAVEL", "Metais e plásticos separados");
                status(rnd.entre(25, 40), "BAIXA_DEFINITIVA", "Material entregue à recicladora");
            } else {
                // Equipamentos muito desgastados: alguns terminam de se deteriorar no pátio antes da baixa
                // (vira INSERVIVEL), o que permite comparar as previsões de vida útil com o real.
                status(rnd.entre(1, 3), "DESCARTE_SEGURO", "Sem condições de reaproveitamento");
                const piora = e.nivel >= 5 && rnd.numero() < 0.5 ? rnd.entre(60, 300) : null;
                if (piora !== null) {
                    agendar(depois(piora), () => s.equipamentos.atualizarEstadoFisico(operador, id(), "INSERVIVEL",
                        "Oxidação e quebra durante o armazenamento no pátio"));
                }
                status((piora ?? 10) + rnd.entre(5, 15), "BAIXA_DEFINITIVA", "Descarte com laudo ambiental");
            }
        });
    }

    // Análises recorrentes "do passado" (como o agendador faria), para o histórico e a aderência.
    for (const diasAtras of [240, 150, 60]) {
        const quando = new Date(hoje(adicionarDias(agora, -diasAtras)).getTime() + 5 * 3_600_000);
        for (const tipo of Object.values(TipoAnalise)) {
            agendar(quando, () => s.analises.executarEPersistir(tipo, {}, "AGENDADA", LOGIN_AGENDADOR));
        }
    }

    eventos.sort((a, b) => a.quando.getTime() - b.quando.getTime() || a.ordem - b.ordem);
    for (const e of eventos) {
        relogio.definir(e.quando);
        await e.executar();
    }
    relogio.definir(agora);
    return { organizacao: prefeitura, eventos: eventos.length };
}
