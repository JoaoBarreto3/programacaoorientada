import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { ErroIntegridade } from "../comum/erros";

const ALGORITMO = "aes-256-gcm";
const PREFIXO = "GC1";
const TAMANHO_IV = 12;
const TAMANHO_TAG = 16;

export default class CriptografiaArquivo {
    private chaveBuffer(chave: string): Buffer {
        if (!/^[0-9a-f]{64}$/i.test(chave)) {
            throw new ErroIntegridade("Chave criptográfica mestra inválida: esperados 256 bits em hexadecimal.");
        }
        return Buffer.from(chave, "hex");
    }

    public cifrar(dados: string, chave: string): string {
        const iv = randomBytes(TAMANHO_IV);
        const cifra = createCipheriv(ALGORITMO, this.chaveBuffer(chave), iv);
        const conteudo = Buffer.concat([cifra.update(dados, "utf8"), cifra.final()]);
        return `${PREFIXO}:${Buffer.concat([iv, cifra.getAuthTag(), conteudo]).toString("base64")}`;
    }

    public decifrar(dadosCifrados: string, chave: string): string {
        const [prefixo, corpo] = dadosCifrados.trim().split(":");
        if (prefixo !== PREFIXO || !corpo) {
            throw new ErroIntegridade("Conteúdo não reconhecido como dado cifrado do greencode.");
        }
        const bruto = Buffer.from(corpo, "base64");
        if (bruto.length < TAMANHO_IV + TAMANHO_TAG) {
            throw new ErroIntegridade("Conteúdo cifrado truncado.");
        }
        try {
            const decifra = createDecipheriv(ALGORITMO, this.chaveBuffer(chave), bruto.subarray(0, TAMANHO_IV));
            decifra.setAuthTag(bruto.subarray(TAMANHO_IV, TAMANHO_IV + TAMANHO_TAG));
            return Buffer.concat([decifra.update(bruto.subarray(TAMANHO_IV + TAMANHO_TAG)), decifra.final()]).toString("utf8");
        } catch {
            throw new ErroIntegridade("Falha de autenticação ao decifrar: dado corrompido, adulterado ou chave incorreta.");
        }
    }

    public gerarChave(): string {
        return randomBytes(32).toString("hex");
    }
}
