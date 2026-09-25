import ParametrosGlobais from "../dominio/ParametrosGlobais";
import Relogio from "../comum/Relogio";

export default interface Ambiente {
    relogio: Relogio;
    parametros: () => ParametrosGlobais;
}

export function proximoNumero(ids: string[], padrao: RegExp): number {
    const numeros = ids.map(id => Number(padrao.exec(id)?.[1] ?? 0));
    return Math.max(0, ...numeros) + 1;
}
