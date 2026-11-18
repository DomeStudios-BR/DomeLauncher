const CHAVE_CACHE_CONTEUDO = "dome:cache-conteudo-instalado:v2";
const LIMITE_CACHE = 512 * 1024;

function registrosValidos(cache: object): [string, Record<string, unknown>][] {
    return Object.entries(cache)
        .filter(([, registro]) => registro && typeof registro === "object" && !Array.isArray(registro))
        .map(([chave, registro]) => {
            const item = { ...registro } as Record<string, unknown>;
            if (typeof item.icon === "string" && item.icon.startsWith("data:")) delete item.icon;
            return [chave, item];
        });
}

/**
 * Reduz o cache de conteúdo instalado ao limite persistido, sem ícones em data URI.
 * Quando excede o limite, preserva as entradas mais recentes (as últimas inseridas) na ordem original.
 */
export function limitarCacheConteudo(valor: string): string {
    const cache: unknown = JSON.parse(valor);
    if (!cache || typeof cache !== "object" || Array.isArray(cache)) return "{}";
    const registros = registrosValidos(cache);
    const mantidos: [string, Record<string, unknown>][] = [];
    let tamanho = 2;
    for (let indice = registros.length - 1; indice >= 0; indice--) {
        const entrada = JSON.stringify({ [registros[indice][0]]: registros[indice][1] });
        if (tamanho + entrada.length > LIMITE_CACHE) break;
        tamanho += entrada.length;
        mantidos.push(registros[indice]);
    }
    return JSON.stringify(Object.fromEntries(mantidos.reverse()));
}

/** Compacta o cache legado de conteúdo antes de montar a interface, removendo-o se estiver corrompido. */
export function prepararArmazenamentoLocal(): void {
    try {
        const cache = localStorage.getItem(CHAVE_CACHE_CONTEUDO);
        if (cache) localStorage.setItem(CHAVE_CACHE_CONTEUDO, limitarCacheConteudo(cache));
    } catch {
        try { localStorage.removeItem(CHAVE_CACHE_CONTEUDO); } catch {}
    }
}

/**
 * Grava uma preferência da interface no localStorage sem lançar exceções.
 * Sem espaço, descarta o cache regenerável de conteúdo e tenta novamente.
 * Retorna `false` quando a gravação não foi confirmada; fluxos que dependem dela devem verificar o resultado.
 */
export function gravarArmazenamentoLocal(chave: string, valor: string): boolean {
    try {
        const conteudo = chave === CHAVE_CACHE_CONTEUDO ? limitarCacheConteudo(valor) : valor;
        try {
            localStorage.setItem(chave, conteudo);
        } catch {
            localStorage.removeItem(CHAVE_CACHE_CONTEUDO);
            localStorage.setItem(chave, conteudo);
        }
        return true;
    } catch {
        console.warn("Não foi possível salvar a preferência local.");
        return false;
    }
}
