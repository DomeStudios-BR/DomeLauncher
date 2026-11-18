import { afterEach, describe, expect, test } from 'bun:test';
import {
    gravarArmazenamentoLocal, limitarCacheConteudo, prepararArmazenamentoLocal,
} from '../../src/lib/armazenamentoLocal';

const chaveCache = 'dome:cache-conteudo-instalado:v2';
const descritor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

afterEach(() => {
    if (descritor) Object.defineProperty(globalThis, 'localStorage', descritor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
});

function simularArmazenamento(limite: number, iniciais: Record<string, string> = {}) {
    const dados = new Map(Object.entries(iniciais));
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
        getItem: (chave: string) => dados.get(chave) ?? null,
        removeItem: (chave: string) => dados.delete(chave),
        setItem: (chave: string, valor: string) => {
            const copia = new Map(dados).set(chave, valor);
            if ([...copia.values()].join('').length > limite) throw new DOMException('Cheio', 'QuotaExceededError');
            dados.set(chave, valor);
        },
    } });
    return dados;
}

describe('armazenamento cheio', () => {
    test('libera apenas cache regenerável e preserva biblioteca e contas', () => {
        const dados = simularArmazenamento(100, { [chaveCache]: 'x'.repeat(90), conta: 'conta' });
        expect(gravarArmazenamentoLocal('dome-library-state', 'biblioteca')).toBe(true);
        expect(dados.get('conta')).toBe('conta');
        expect(dados.get('dome-library-state')).toBe('biblioteca');
        expect(dados.has(chaveCache)).toBe(false);
    });
    test('não propaga falha quando nem a limpeza libera espaço suficiente', () => {
        simularArmazenamento(0);
        expect(gravarArmazenamentoLocal('biblioteca', 'estado')).toBe(false);
    });
    test('migra ícones incorporados sem remover metadados dos mods', () => {
        const dados = simularArmazenamento(1000, { [chaveCache]: JSON.stringify({
            mod: { icon: 'data:image/png;base64,abc', projectId: 'projeto', name: 'Mod' },
        }) });
        prepararArmazenamentoLocal();
        expect(JSON.parse(dados.get(chaveCache)!)).toEqual({ mod: { projectId: 'projeto', name: 'Mod' } });
    });
    test('limita o tamanho persistido e preserva URLs remotas', () => {
        const cache = Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [String(i), {
            name: 'm'.repeat(200), icon: 'https://example.com/icon.png',
        }]));
        const limitado = limitarCacheConteudo(JSON.stringify(cache));
        expect(limitado.length).toBeLessThanOrEqual(512 * 1024);
        expect(limitado).toContain('https://example.com/icon.png');
    });
    test('mantém as entradas mais recentes na ordem original em gravações sucessivas', () => {
        const cache = Object.fromEntries(
            Array.from({ length: 5000 }, (_, i) => [String(i), { name: 'm'.repeat(200) }]));
        const primeira = Object.keys(JSON.parse(limitarCacheConteudo(JSON.stringify(cache))));
        const segunda = Object.keys(JSON.parse(limitarCacheConteudo(JSON.stringify({
            ...JSON.parse(limitarCacheConteudo(JSON.stringify(cache))), novo: { name: 'n' },
        }))));
        expect(primeira.at(-1)).toBe('4999');
        expect(Number(primeira[1])).toBeGreaterThan(Number(primeira[0]));
        expect(segunda.at(-1)).toBe('novo');
        expect(segunda).toContain('4999');
    });
});
