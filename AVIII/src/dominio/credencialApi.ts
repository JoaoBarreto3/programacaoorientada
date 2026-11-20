import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// Formato da chave entregue ao parceiro:  gc_<prefixo>_<segredo>
//   prefixo: 12 caracteres hexadecimais (48 bits), público, localiza a chave no banco;
//   segredo: 43 caracteres base64url (256 bits aleatórios), mostrado UMA vez e nunca gravado.
// No banco fica só o SHA-256 do segredo. Para um segredo aleatório de 256 bits, um hash rápido
// basta: não há dicionário a atacar (ao contrário de senhas, que exigem PBKDF2 lento). Isso
// mantém a verificação barata, importante porque ela acontece em toda requisição de parceiro.

const PADRAO = /^gc_([0-9a-f]{12})_([A-Za-z0-9_-]{43})$/;

export interface CredencialGerada {
    prefixo: string;
    segredo: string;
    hashSegredo: string;
    chaveCompleta: string;
}

export function hashSegredo(segredo: string): string {
    return createHash("sha256").update(segredo, "utf8").digest("hex");
}

export function gerarCredencial(): CredencialGerada {
    const prefixo = randomBytes(6).toString("hex");
    const segredo = randomBytes(32).toString("base64url");
    return { prefixo, segredo, hashSegredo: hashSegredo(segredo), chaveCompleta: `gc_${prefixo}_${segredo}` };
}

export function lerChave(texto: string): { prefixo: string; segredo: string } | null {
    const m = PADRAO.exec(texto.trim());
    return m ? { prefixo: m[1]!, segredo: m[2]! } : null;
}

// Comparação em tempo constante: o tempo de resposta não revela quantos caracteres conferem.
export function segredoConfere(segredo: string, hashGravado: string): boolean {
    const calculado = Buffer.from(hashSegredo(segredo), "hex");
    const gravado = Buffer.from(hashGravado, "hex");
    return calculado.length === gravado.length && timingSafeEqual(calculado, gravado);
}
