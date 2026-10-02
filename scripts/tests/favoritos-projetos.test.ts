import { beforeEach, describe, expect, mock, test } from 'bun:test';

const armazenamento = new Map<string, string>();
const eventos = new EventTarget();
Object.assign(globalThis, {
    localStorage: {
        getItem: (chave: string) => armazenamento.get(chave) ?? null,
        setItem: (chave: string, valor: string) => armazenamento.set(chave, valor),
    },
    window: eventos,
    __DOME_CONFIGURACAO_SOCIAL__: { apiBaseUrl: 'http://localhost:3000' },
});
const chamadas: Array<{ favoritado: boolean; projectId: string; source: string }> = [];
let enviar: () => Promise<void> = async () => undefined;
mock.module('@tauri-apps/api/core', () => ({
    invoke: async (_comando: string, parametros: { acao: string; dados: typeof chamadas[number] }) => {
        if (parametros.acao === 'salvar') { chamadas.push(parametros.dados); await enviar(); }
        return [];
    },
}));
const { registrarFavorito, sincronizarFavoritos, obterTotalFavoritos, EVENTO_FAVORITOS_ATUALIZADOS } =
    await import('../../src/services/favoritosProjetos');
const projeto = { source: 'modrinth', projectId: 'projeto123' } as const;
beforeEach(() => { armazenamento.clear(); chamadas.length = 0; enviar = async () => undefined; });

describe('sincronização de favoritos do launcher', () => {
    test('mantém a alteração offline e a reenvia quando a API retorna', async () => {
        enviar = async () => { throw new Error('Offline'); };
        registrarFavorito(projeto, true);
        await sincronizarFavoritos().catch(() => undefined);
        expect(JSON.parse(armazenamento.get('dome_favoritos_pendentes')!)).toEqual([{ ...projeto, favoritado: true }]);
        enviar = async () => undefined;
        await sincronizarFavoritos();
        expect(JSON.parse(armazenamento.get('dome_favoritos_pendentes')!)).toEqual([]);
    });
    test('um desfavoritar durante o envio prevalece sobre o favorito anterior', async () => {
        let concluir!: () => void;
        enviar = () => new Promise<void>((resolver) => { concluir = resolver; });
        registrarFavorito(projeto, true);
        registrarFavorito(projeto, false);
        enviar = async () => undefined;
        concluir();
        await sincronizarFavoritos();
        expect(chamadas.map((item) => item.favoritado)).toEqual([true, false]);
        expect(JSON.parse(armazenamento.get('dome_favoritos_pendentes')!)).toEqual([]);
    });
    test('não subtrai um voto remoto por ausência do favorito neste dispositivo', () => {
        expect(obterTotalFavoritos(projeto, { ...projeto, total: 8, favoritadoPorMim: true })).toBe(8);
    });
    test('não dispara novas consultas quando a fila já está vazia', async () => {
        let quantidade = 0;
        const contar = () => quantidade++;
        eventos.addEventListener(EVENTO_FAVORITOS_ATUALIZADOS, contar);
        await sincronizarFavoritos();
        eventos.removeEventListener(EVENTO_FAVORITOS_ATUALIZADOS, contar);
        expect(quantidade).toBe(0);
    });
});
