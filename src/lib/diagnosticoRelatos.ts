const LIMITE_LOGS = 24000;
const registros: string[] = [];
let iniciado = false;

export function sanitizarDiagnostico(texto: string): string {
    const campos = 'access[_-]?token|refresh[_-]?token|id[_-]?token|token|authorization|password|senha|' +
        'client[_-]?secret|secret|cookie|api[_-]?key|session[_-]?id|signature|assinatura|x-amz-signature|' +
        'x-amz-credential|x-amz-security-token|authorization[_-]?code';
    const atribuicao = new RegExp(
        '(\\b(?:' + campos + ')\\b["\\x27]?\\s*[:=]\\s*)' +
        '(?:Bearer\\s+[^\\s"\\x27,;]+|"[^"\\r\\n]*"|\\x27[^\\x27\\r\\n]*\\x27|[^\\s,;&}]+)',
        'gi',
    );
    return texto
        .replace(atribuicao, '$1"[Credencial omitida]"')
        .replace(/\bBearer\s+[^\s"',;]+/gi, 'Bearer "[Credencial omitida]"')
        .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[Credencial omitida]')
        .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)/g, '[Credencial omitida]')
        .replace(/(https?:\/\/)[^/\s@]+:[^/\s@]+@/gi, '$1[Credencial omitida]@')
        .replace(/([A-Za-z]:[\\/]Users[\\/])[^\\/\s"']+/gi, '$1[Usuário]')
        .replace(/(\/(?:home|Users)\/)[^/\s"']+/g, '$1[Usuário]')
        .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[Email omitido]')
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
}

function resumirArgumento(valor: unknown): string {
    if (valor instanceof Error) return `${valor.name}: ${valor.message}\n${valor.stack ?? ''}`;
    if (typeof valor === 'string' || typeof valor === 'number' || typeof valor === 'boolean') return String(valor);
    const visitados = new WeakSet<object>();
    let campos = 0;
    try {
        return JSON.stringify(valor, (chave, item: unknown) => {
            if (++campos > 100) return '[Detalhes adicionais]';
            const credencial = /^(?:access_?token|refresh_?token|token|authorization|password|senha|secret|cookie|api_?key)$/i;
            if (credencial.test(chave)) {
                return '[Credencial omitida]';
            }
            if (typeof item === 'bigint') return item.toString();
            if (item && typeof item === 'object') {
                if (visitados.has(item)) return '[Referência circular]';
                visitados.add(item);
            }
            return item;
        }) ?? String(valor);
    } catch {
        return '[Objeto não serializável]';
    }
}

function registrar(nivel: string, valores: unknown[]): void {
    const mensagem = valores.map(resumirArgumento).join(' ');
    const linha = sanitizarDiagnostico(`${new Date().toISOString()} ${nivel}: ${mensagem}`);
    registros.push(Array.from(linha).slice(0, 4000).join(''));
    while (registros.length > 200 || registros.join('\n').length > LIMITE_LOGS) registros.shift();
}

export function obterLogsRelato(): string {
    return registros.join('\n');
}

export function iniciarDiagnosticoRelatos(): void {
    if (iniciado) return;
    iniciado = true;
    for (const nivel of ['log', 'info', 'warn', 'error'] as const) {
        const original = console[nivel].bind(console);
        console[nivel] = (...valores: unknown[]) => {
            registrar(nivel, valores);
            original(...valores);
        };
    }
    window.addEventListener('error', (evento) => registrar('error', [evento.error ?? evento.message]));
    window.addEventListener('unhandledrejection', (evento) => registrar('error', [evento.reason]));
    registrar('info', ['Interface do launcher iniciada.']);
}
