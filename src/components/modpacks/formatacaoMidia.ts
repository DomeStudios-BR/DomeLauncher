export function alinhamentoSeguro(valor: unknown): 'left' | 'center' | 'right' | undefined {
    return valor === 'left' || valor === 'center' || valor === 'right' ? valor : undefined;
}

export function larguraSegura(valor: unknown): number | undefined {
    const numero = Number(valor);
    return Number.isFinite(numero) && numero >= 32 ? Math.min(1600, Math.round(numero)) : undefined;
}

export function siteSeguro(valor: unknown): string | undefined {
    if (typeof valor !== 'string') return;
    try {
        const url = new URL(valor);
        if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
    } catch {
        return undefined;
    }
}
