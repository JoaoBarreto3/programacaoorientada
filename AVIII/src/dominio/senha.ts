import { pbkdf2, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

// Hash de senha: PBKDF2-HMAC-SHA256 com salt aleatório de 128 bits (mesmo esquema da AV1,
// do módulo nativo node:crypto, sem dependências nativas — funciona igual em Windows e Linux).
// No servidor a versão assíncrona é obrigatória: as 600 mil iterações rodam no pool de threads
// do libuv e não travam o event loop enquanto outras requisições são atendidas.

const pbkdf2Async = promisify(pbkdf2);

export const ALGORITMO_SENHA = "pbkdf2-sha256";
export const ITERACOES_PADRAO = 600_000;

export async function calcularHashSenha(senha: string, saltHex: string, iteracoes: number): Promise<string> {
    const hash = await pbkdf2Async(senha.normalize("NFC"), Buffer.from(saltHex, "hex"), iteracoes, 32, "sha256");
    return `${ALGORITMO_SENHA}$${iteracoes}$${hash.toString("hex")}`;
}

export async function gerarSaltEHash(senha: string, iteracoes: number): Promise<{ salt: string; hashSenha: string }> {
    const salt = randomBytes(16).toString("hex");
    return { salt, hashSenha: await calcularHashSenha(senha, salt, iteracoes) };
}

export async function conferirSenha(senha: string, saltHex: string, hashArmazenado: string): Promise<boolean> {
    const [algoritmo, iteracoesTexto] = hashArmazenado.split("$");
    const iteracoes = Number(iteracoesTexto);
    if (algoritmo !== ALGORITMO_SENHA || !Number.isInteger(iteracoes) || iteracoes <= 0) {
        return false;
    }
    const calculado = Buffer.from(await calcularHashSenha(senha, saltHex, iteracoes));
    const armazenado = Buffer.from(hashArmazenado);
    // Comparação em tempo constante: não revela quantos caracteres coincidiram.
    return calculado.length === armazenado.length && timingSafeEqual(calculado, armazenado);
}
