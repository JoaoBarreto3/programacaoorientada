// Formato canônico de UUID. Validar antes de consultar evita que um texto qualquer chegue ao
// PostgreSQL numa coluna UUID (o que geraria erro 500 em vez de 404).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ehUuid(texto: string): boolean {
    return UUID.test(texto);
}
