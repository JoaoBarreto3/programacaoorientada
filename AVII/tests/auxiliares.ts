import assert from "node:assert/strict";
import dotenv from "dotenv";
import { FastifyInstance, LightMyRequestResponse } from "fastify";
import { construirApp } from "../src/app";
import { Configuracao } from "../src/config/configuracao";
import { criarClientePrisma, PrismaClient } from "../src/infra/banco";
import Repositorios from "../src/repositorios/Repositorios";
import Relogio, { RelogioSistema } from "../src/comum/Relogio";
import { calcularDigitoCNPJ } from "../src/validacao/cnpj";

dotenv.config({ quiet: true });

export const SENHA_ADMIN = "Mestre2026x";
export const SENHA_PADRAO = "Acesso2026x";

export function configuracaoTeste(): Configuracao {
    const url = process.env.DATABASE_URL_TESTE;
    if (!url) {
        throw new Error("Defina DATABASE_URL_TESTE no .env para rodar os testes de integração.");
    }
    return {
        porta: 0, host: "127.0.0.1", urlBanco: url, jwtSegredo: "segredo-de-teste-com-mais-de-32-caracteres!!",
        sessaoMinutos: 30, logNivel: "silent", iteracoesSenha: 1000, tempoDesligamentoMs: 1000
    };
}

// CNPJ válido a partir de uma base de 12 caracteres.
export function cnpjValido(base12: string): string {
    const dv1 = calcularDigitoCNPJ(base12);
    return base12 + dv1 + calcularDigitoCNPJ(base12 + dv1);
}

export function hojeISO(deslocamentoDias = 0): string {
    const d = new Date();
    const civil = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate() + deslocamentoDias));
    return civil.toISOString().slice(0, 10);
}

export async function limparBanco(prisma: PrismaClient): Promise<void> {
    // TRUNCATE não dispara as triggers de linha (imutabilidade/retenção), o que é o desejado aqui.
    await prisma.$executeRawUnsafe(
        "TRUNCATE movimentacoes, equipamentos, lotes, contratos, organizacoes, usuarios, registros_auditoria, parametros_globais RESTART IDENTITY CASCADE");
    await prisma.$executeRawUnsafe("ALTER SEQUENCE seq_organizacao RESTART; ALTER SEQUENCE seq_lote RESTART; ALTER SEQUENCE seq_equipamento RESTART");
    await new Repositorios(prisma).parametros.garantirPadrao();
}

export interface Resposta<T = any> {
    status: number;
    corpo: T;
    cabecalhos: LightMyRequestResponse["headers"];
}

// Cliente HTTP mínimo sobre app.inject (requisições em memória, sem abrir porta).
export class ClienteApi {
    public token: string | null = null;

    constructor(private readonly app: FastifyInstance) {}

    public async requisitar<T = any>(metodo: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, corpo?: unknown, token = this.token): Promise<Resposta<T>> {
        const resposta = await this.app.inject({
            method: metodo, url,
            headers: { ...(token ? { authorization: `Bearer ${token}` } : {}) },
            ...(corpo !== undefined ? { payload: corpo as object } : {})
        });
        return { status: resposta.statusCode, corpo: (resposta.body ? resposta.json() : null) as T, cabecalhos: resposta.headers };
    }

    public get<T = any>(url: string) { return this.requisitar<T>("GET", url); }
    public post<T = any>(url: string, corpo: unknown = {}) { return this.requisitar<T>("POST", url, corpo); }
    public put<T = any>(url: string, corpo: unknown) { return this.requisitar<T>("PUT", url, corpo); }
    public patch<T = any>(url: string, corpo: unknown) { return this.requisitar<T>("PATCH", url, corpo); }
    public delete<T = any>(url: string) { return this.requisitar<T>("DELETE", url); }

    public como(token: string): ClienteApi {
        const outro = new ClienteApi(this.app);
        outro.token = token;
        return outro;
    }

    public async login(login: string, senha: string): Promise<ClienteApi> {
        const r = await this.post("/api/auth/login", { login, senha });
        assert.equal(r.status, 200, `login de ${login} falhou: ${JSON.stringify(r.corpo)}`);
        return this.como(r.corpo.token);
    }
}

export interface Ambiente {
    app: FastifyInstance;
    prisma: PrismaClient;
    api: ClienteApi;
    admin: ClienteApi;
    operador: ClienteApi;
    gestor: ClienteApi;
    auditor: ClienteApi;
    fechar(): Promise<void>;
}

// Banco limpo + administrador provisionado + um usuário de cada papel já autenticado.
export async function prepararAmbiente(relogio: Relogio = new RelogioSistema()): Promise<Ambiente> {
    const config = configuracaoTeste();
    const prisma = criarClientePrisma(config.urlBanco);
    await limparBanco(prisma);
    const app = await construirApp({ config, prisma, relogio, logger: false });
    await app.ready();
    const api = new ClienteApi(app);
    const prov = await api.post("/api/provisionamento", { login: "admin", senha: SENHA_ADMIN });
    assert.equal(prov.status, 201, JSON.stringify(prov.corpo));
    const admin = api.como(prov.corpo.token);
    for (const [login, papel] of [["operador", "OPERADOR_CADASTRO"], ["gestor", "GESTOR_ALMOXARIFADO"], ["auditor", "AUDITOR"]]) {
        const r = await admin.post("/api/usuarios", { login, senha: SENHA_PADRAO, papel });
        assert.equal(r.status, 201, JSON.stringify(r.corpo));
    }
    return {
        app, prisma, api, admin,
        operador: await api.login("operador", SENHA_PADRAO),
        gestor: await api.login("gestor", SENHA_PADRAO),
        auditor: await api.login("auditor", SENHA_PADRAO),
        async fechar() {
            await app.close();
            await prisma.$disconnect();
        }
    };
}

export function contratoPadrao(extra: Record<string, unknown> = {}) {
    return {
        dataAssinatura: hojeISO(-30), dataVencimento: hojeISO(365), valorMensal: 4500,
        clausulas: ["Coleta mensal", "Laudo de destinação"], renovacaoAutomatica: false, ...extra
    };
}

export function organizacaoPadrao(cnpj: string, extra: Record<string, unknown> = {}) {
    return {
        razaoSocial: "Banco Horizonte S.A.", cnpj, email: "ti@horizonte.com.br",
        enderecoCompleto: "Av. Paulista, 1000, São Paulo/SP", telefone: "(11) 3333-4444",
        contrato: contratoPadrao(), ...extra
    };
}

export function equipamentoPadrao(extra: Record<string, unknown> = {}) {
    return { tipo: "NOTEBOOK", marca: "Dell", modelo: "Latitude 5490", anoFabricacao: 2019, estadoFisico: "BOM_ESTADO", pesoQuilogramas: 1.9, ...extra };
}

// Cria organização (pelo operador) e lote com equipamentos (pelo gestor).
export async function criarOrganizacaoELote(amb: Ambiente, base12: string, nf: string, equipamentos = [equipamentoPadrao()]) {
    const org = await amb.operador.post("/api/organizacoes", organizacaoPadrao(cnpjValido(base12)));
    assert.equal(org.status, 201, JSON.stringify(org.corpo));
    const lote = await amb.gestor.post("/api/lotes", { organizacaoId: org.corpo.id, notaFiscal: nf, transportadora: "TransRapida", equipamentos });
    assert.equal(lote.status, 201, JSON.stringify(lote.corpo));
    return { organizacao: org.corpo, lote: lote.corpo };
}
