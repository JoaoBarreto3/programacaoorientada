import { ErroValidacao } from "./erros";

// Converte texto livre ("em triagem", "em-triagem") no valor de uma enumeração.
export function lerEnum<T extends string>(enumeracao: Record<string, T>, valor: string, campo: string): T {
    const normalizado = String(valor ?? "").trim().toUpperCase().replace(/[-\s]+/g, "_");
    const valores = Object.values(enumeracao);
    const encontrado = valores.find(v => v === normalizado);
    if (!encontrado) {
        throw new ErroValidacao(`Valor inválido para ${campo}: "${valor}". Opções: ${valores.join(", ")}.`);
    }
    return encontrado;
}
