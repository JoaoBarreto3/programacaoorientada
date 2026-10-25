export interface Pagina<T> {
    itens: T[];
    total: number;
    pagina: number;
    tamanhoPagina: number;
}

export interface ParametrosPaginacao {
    pagina?: number;
    tamanhoPagina?: number;
}

export const TAMANHO_PAGINA_PADRAO = 20;
export const TAMANHO_PAGINA_MAXIMO = 100;

export function normalizarPaginacao(p: ParametrosPaginacao): { pagina: number; tamanhoPagina: number; pular: number } {
    const pagina = Math.max(1, Math.floor(p.pagina ?? 1));
    const tamanhoPagina = Math.min(TAMANHO_PAGINA_MAXIMO, Math.max(1, Math.floor(p.tamanhoPagina ?? TAMANHO_PAGINA_PADRAO)));
    return { pagina, tamanhoPagina, pular: (pagina - 1) * tamanhoPagina };
}
