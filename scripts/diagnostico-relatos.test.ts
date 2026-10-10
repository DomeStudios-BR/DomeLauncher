import { describe, expect, test } from 'bun:test';
import { sanitizarDiagnostico } from '../src/lib/diagnosticoRelatos';

describe('diagnóstico público do launcher', () => {
    test('preserva horário e endereços usados no diagnóstico de rede', () => {
        const texto = '2026-10-10T17:32:40.000Z Falha de rede em 2001:db8:abcd:12::1 e ::1';
        const seguro = sanitizarDiagnostico(texto);
        expect(seguro).toContain('2026-10-10T17:32:40.000Z');
        expect(seguro).toBe(texto);
    });
    test('remove informações privadas e preserva a mensagem de falha', () => {
        const seguro = sanitizarDiagnostico([
            'access_token: segredo', 'Erro em C:\\Users\\Pessoa\\dome\\arquivo',
            'Erro em /home/pessoa/arquivo', 'Email pessoa@example.com',
            'Download https://exemplo.com/arquivo?assinatura=segredo', 'Falha ao carregar instâncias.',
        ].join('\n'));
        for (const valor of ['segredo', 'Pessoa', '/home/pessoa', 'pessoa@example.com']) {
            expect(seguro).not.toContain(valor);
        }
        expect(seguro).toContain('Falha ao carregar instâncias.');
        expect(seguro).toContain('https://exemplo.com/arquivo');
        expect(seguro).toContain('\\dome\\arquivo');
        expect(sanitizarDiagnostico(seguro)).toBe(seguro);
    });
    test('preserva referências das stack traces e menções sem valores de credenciais', () => {
        const texto = 'Erro ao renovar token\n at invoke (http://localhost:1420/src/main.tsx:20:4)';
        expect(sanitizarDiagnostico(texto)).toBe(texto);
    });
});
