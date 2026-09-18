import Calculo from "./calculo"

export default class Bhaskara extends Calculo {
    public calcular(a: number, b: number, c: number): number[] {
        let delta = b ** 2 - 4 * a * c;
        let raiz = delta ** 0.5;
        return [(-b + raiz) / (2 * a), (-b - raiz) / (2 * a)];
    }
}
