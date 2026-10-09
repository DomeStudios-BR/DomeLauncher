import { beforeEach, describe, expect, mock, test } from 'bun:test';

const armazenamento = new Map<string, string>();
const eventos = new EventTarget();
Object.assign(globalThis, {
    localStorage: {
        getItem: (chave: string) => armazenamento.get(chave) ?? null,
        setItem: (chave: string, valor: string) => armazenamento.set(chave, valor),
        removeItem: (chave: string) => armazenamento.delete(chave),
    },
    window: eventos,
    __DOME_CONFIGURACAO_SOCIAL__: { apiBaseUrl: 'http://localhost:3000' },
});
const chamadas: Array<{ favoritado: boolean; projectId: string; source: string }> = [];
let enviar: () => Promise<void> = async () => undefined;
type Favorito = import('../../src/components/Favorites').FavoriteItem;
type Grupo = import('../../src/services/colecaoFavoritos').GrupoFavoritos;
const remotos = new Map<string, { favoritos: Array<{ source: string; projectId: string; dados: Favorito }>;
    grupos: Grupo[] }>();
let antesListar: () => Promise<void> = async () => undefined;
function remoto(perfilId: string) {
    if (!remotos.has(perfilId)) remotos.set(perfilId, { favoritos: [], grupos: [] });
    return remotos.get(perfilId)!;
}
mock.module('@tauri-apps/api/core', () => ({
    invoke: async (_comando: string, parametros: { acao: string;
        dados: typeof chamadas[number] & { perfilId: string; dados?: Favorito; grupos?: Grupo[] } }) => {
        const colecao = remoto(parametros.dados.perfilId);
        if (parametros.acao === 'salvar') {
            chamadas.push(parametros.dados); await enviar();
            const { source, projectId, favoritado, dados } = parametros.dados;
            colecao.favoritos = colecao.favoritos.filter((item) => item.source !== source || item.projectId !== projectId);
            if (favoritado && dados) colecao.favoritos.push({ source, projectId, dados });
        }
        if (parametros.acao === 'listar') {
            const resposta = JSON.parse(JSON.stringify(colecao));
            await antesListar();
            return resposta;
        }
        if (parametros.acao === 'grupos') colecao.grupos = parametros.dados.grupos!;
        return [];
    },
}));
const { registrarFavorito, sincronizarFavoritos, obterTotalFavoritos, EVENTO_FAVORITOS_ATUALIZADOS,
    definirPerfilFavoritos } =
    await import('../../src/services/favoritosProjetos');
const projeto = { source: 'modrinth', projectId: 'projeto123' } as const;
const { loadFavorites, saveFavorites, ativarContaFavoritos, sincronizarColecaoFavoritos,
    carregarGruposFavoritos, salvarGruposFavoritos } = await import('../../src/services/colecaoFavoritos');
const favorito: Favorito = { id: 'projeto123', source: 'modrinth', title: 'Projeto', description: '',
    author: 'Autor', icon_url: '', slug: 'projeto', type: 'modpack' };
beforeEach(async () => {
    await new Promise((resolver) => setTimeout(resolver, 0));
    await sincronizarColecaoFavoritos().catch(() => undefined);
    armazenamento.clear(); chamadas.length = 0; enviar = async () => undefined;
    remotos.clear(); antesListar = async () => undefined;
    definirPerfilFavoritos('perfil_teste');
});

describe('sincronização de favoritos do launcher', () => {
    test('mantém a alteração offline e a reenvia quando a API retorna', async () => {
        enviar = async () => { throw new Error('Offline'); };
        registrarFavorito(projeto, true);
        await sincronizarFavoritos().catch(() => undefined);
        expect(JSON.parse(armazenamento.get('dome_favoritos_pendentes:perfil_teste')!))
            .toEqual([{ ...projeto, favoritado: true }]);
        enviar = async () => undefined;
        await sincronizarFavoritos();
        expect(JSON.parse(armazenamento.get('dome_favoritos_pendentes:perfil_teste')!)).toEqual([]);
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
        expect(JSON.parse(armazenamento.get('dome_favoritos_pendentes:perfil_teste')!)).toEqual([]);
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
    test('não envia favoritos de visitante para uma sessão nativa que ainda não foi ativada', async () => {
        definirPerfilFavoritos(null);
        registrarFavorito(projeto, true);
        await sincronizarFavoritos();
        expect(chamadas).toEqual([]);
        expect(JSON.parse(armazenamento.get('dome_favoritos_pendentes')!)).toHaveLength(1);
    });
    test('carrega favoritos e grupos salvos em outro computador', async () => {
        remoto('conta_a').favoritos = [{ ...projeto, dados: favorito }];
        remoto('conta_a').grupos = [{ id: 'grupo', nome: 'Coleção', recolhido: true, favoritos: ['modrinth:projeto123'] }];
        await ativarContaFavoritos('conta_a');
        expect(loadFavorites()).toEqual([favorito]);
        expect(carregarGruposFavoritos()).toEqual(remoto('conta_a').grupos);
    });
    test('descarta uma resposta antiga quando a conta muda durante a consulta', async () => {
        remoto('conta_a').favoritos = [{ ...projeto, dados: favorito }];
        const favoritoB = { ...favorito, id: 'projeto_b', title: 'Outra conta' };
        remoto('conta_b').favoritos = [{ source: favoritoB.source, projectId: favoritoB.id, dados: favoritoB }];
        let liberar!: () => void;
        let avisar!: () => void;
        const iniciada = new Promise<void>((resolver) => { avisar = resolver; });
        antesListar = () => { avisar(); return new Promise<void>((resolver) => { liberar = resolver; }); };
        const contaA = ativarContaFavoritos('conta_a');
        await iniciada;
        const contaB = ativarContaFavoritos('conta_b');
        antesListar = async () => undefined;
        liberar();
        await Promise.all([contaA, contaB]);
        expect(loadFavorites()).toEqual([favoritoB]);
        await ativarContaFavoritos(null);
        expect(loadFavorites()).toEqual([]);
    });
    test('mantém favoritos e grupos offline e reenvia após recuperar a conexão', async () => {
        enviar = async () => { throw new Error('Offline'); };
        saveFavorites([favorito]);
        const grupos: Grupo[] = [{ id: 'grupo', nome: 'Coleção', recolhido: false, favoritos: ['modrinth:projeto123'] }];
        salvarGruposFavoritos(grupos);
        await sincronizarColecaoFavoritos().catch(() => undefined);
        expect(loadFavorites()).toEqual([favorito]);
        expect(carregarGruposFavoritos()).toEqual(grupos);
        enviar = async () => undefined;
        await new Promise((resolver) => setTimeout(resolver, 0));
        await sincronizarColecaoFavoritos();
        expect(remoto('perfil_teste').favoritos).toEqual([{ ...projeto, dados: favorito }]);
        expect(remoto('perfil_teste').grupos).toEqual(grupos);
        expect(armazenamento.has('dome_grupos_favoritos_pendentes:perfil_teste')).toBe(false);
    });
    test('importa visitantes uma vez e preserva os grupos já salvos na conta', async () => {
        definirPerfilFavoritos(null);
        armazenamento.set('dome_favorites', JSON.stringify([favorito]));
        armazenamento.set('dome_grupos_favoritos', JSON.stringify([
            { id: 'novo', nome: 'Novos', recolhido: false, favoritos: ['modrinth:projeto123'] },
        ]));
        remoto('conta_a').grupos = [{ id: 'antigo', nome: 'Antigos', recolhido: true, favoritos: [] }];
        await ativarContaFavoritos('conta_a');
        await new Promise((resolver) => setTimeout(resolver, 0));
        await sincronizarColecaoFavoritos();
        expect(carregarGruposFavoritos().map((grupo) => grupo.id)).toEqual(['antigo', 'novo']);
        expect(armazenamento.has('dome_favorites')).toBe(false);
        await ativarContaFavoritos('conta_b');
        expect(loadFavorites()).toEqual([]);
        expect(remoto('conta_b').favoritos).toEqual([]);
    });
});
