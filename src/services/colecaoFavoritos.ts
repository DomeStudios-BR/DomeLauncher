import { invoke } from '@tauri-apps/api/core';
import type { FavoriteItem } from '../components/Favorites';
import { CONFIGURACAO_SOCIAL } from '../lib/configuracaoSocial';
import {
    definirPerfilFavoritos, obterPerfilFavoritos, registrarFavorito, sincronizarFavoritos,
    EVENTO_FAVORITOS_ATUALIZADOS,
} from './favoritosProjetos';

export interface GrupoFavoritos {
    id: string;
    nome: string;
    recolhido: boolean;
    favoritos: string[];
}
export const EVENTO_SINCRONIZACAO_FAVORITOS = 'dome:sincronizacao-favoritos';
let sincronizacao: Promise<void> | null = null;
let sincronizacaoSolicitada = false;
let estadoSincronizacao = { carregando: false, erro: null as string | null };

export function obterEstadoSincronizacaoFavoritos() { return estadoSincronizacao; }
function atualizarEstadoSincronizacao(carregando: boolean, erro: string | null = null) {
    estadoSincronizacao = { carregando, erro };
    window.dispatchEvent(new Event(EVENTO_SINCRONIZACAO_FAVORITOS));
}

function chave(nome: string) {
    const perfilId = obterPerfilFavoritos();
    return perfilId ? `${nome}:${perfilId}` : nome;
}
function ler<T>(nome: string, padrao: T): T {
    try {
        const valor = JSON.parse(localStorage.getItem(chave(nome)) || 'null');
        return Array.isArray(valor) ? valor as T : padrao;
    }
    catch { return padrao; }
}
function notificar() { window.dispatchEvent(new Event(EVENTO_FAVORITOS_ATUALIZADOS)); }
export function chaveFavorito(item: Pick<FavoriteItem, 'source' | 'id'>) { return `${item.source}:${item.id}`; }
export function loadFavorites(): FavoriteItem[] { return ler('dome_favorites', []); }
export function carregarGruposFavoritos(): GrupoFavoritos[] { return ler('dome_grupos_favoritos', []); }

export function saveFavorites(favoritos: FavoriteItem[]) {
    const anteriores = loadFavorites();
    localStorage.setItem(chave('dome_favorites'), JSON.stringify(favoritos));
    for (const item of favoritos) {
        if (JSON.stringify(anteriores.find((anterior) => chaveFavorito(anterior) === chaveFavorito(item)))
            === JSON.stringify(item)) continue;
        registrarFavorito({ source: item.source, projectId: item.id }, true, item);
    }
    for (const item of anteriores) {
        if (favoritos.some((atual) => chaveFavorito(atual) === chaveFavorito(item))) continue;
        registrarFavorito({ source: item.source, projectId: item.id }, false);
    }
    notificar();
    void sincronizarColecaoFavoritos().catch(() => undefined);
}
export function addFavorite(item: FavoriteItem) {
    if (isFavorite(item.id, item.source)) return;
    saveFavorites([...loadFavorites(), item]);
}
export function removeFavorite(id: string, source?: FavoriteItem['source']) {
    saveFavorites(loadFavorites().filter((item) => item.id !== id || (source && item.source !== source)));
}
export function isFavorite(id: string, source?: FavoriteItem['source']) {
    return loadFavorites().some((item) => item.id === id && (!source || item.source === source));
}
export function salvarGruposFavoritos(grupos: GrupoFavoritos[]) {
    localStorage.setItem(chave('dome_grupos_favoritos'), JSON.stringify(grupos));
    localStorage.setItem(chave('dome_grupos_favoritos_pendentes'), JSON.stringify(grupos));
    notificar();
    void sincronizarColecaoFavoritos().catch(() => undefined);
}

/** Ative após persistir a sessão nativa para carregar a coleção do perfil e importar favoritos de visitante. */
export async function ativarContaFavoritos(perfilId: string | null) {
    if (obterPerfilFavoritos() === perfilId) return;
    definirPerfilFavoritos(perfilId);
    atualizarEstadoSincronizacao(false);
    notificar();
    if (perfilId && localStorage.getItem('dome_favorites')) {
        let legados: FavoriteItem[] = [];
        let grupos: GrupoFavoritos[] = [];
        try {
            legados = JSON.parse(localStorage.getItem('dome_favorites') || '[]');
            grupos = JSON.parse(localStorage.getItem('dome_grupos_favoritos') || '[]');
        } catch {
            legados = [];
        }
        saveFavorites([...loadFavorites(), ...legados.filter((item) => !isFavorite(item.id, item.source))]);
        if (grupos.length) {
            localStorage.setItem(chave('dome_grupos_favoritos_importados'), 'true');
            salvarGruposFavoritos(mesclarGruposFavoritos(carregarGruposFavoritos(), grupos));
        }
        localStorage.removeItem('dome_favorites');
        localStorage.removeItem('dome_grupos_favoritos');
        localStorage.removeItem('dome_favoritos_pendentes');
    }
    notificar();
    if (!perfilId) return;
    await sincronizacao?.catch(() => undefined);
    await sincronizarColecaoFavoritos();
}

/** Reenvia alterações pendentes antes de carregar a coleção remota, preservando o cache durante falhas. */
export function sincronizarColecaoFavoritos(): Promise<void> {
    if (sincronizacao) {
        sincronizacaoSolicitada = true;
        return sincronizacao;
    }
    const perfilId = obterPerfilFavoritos();
    if (!perfilId) return Promise.resolve();
    const chaveLista = chave('dome_favorites');
    const chaveGrupos = chave('dome_grupos_favoritos');
    const chavePendentes = chave('dome_grupos_favoritos_pendentes');
    atualizarEstadoSincronizacao(true);
    sincronizacao = (async () => {
        await sincronizarFavoritos();
        if (perfilId !== obterPerfilFavoritos()) return;
        const pendentes = localStorage.getItem(chavePendentes);
        if (pendentes) {
            let grupos = JSON.parse(pendentes) as GrupoFavoritos[];
            const chaveImportacao = `dome_grupos_favoritos_importados:${perfilId}`;
            if (localStorage.getItem(chaveImportacao)) {
                const remoto = await invoke<{ grupos: GrupoFavoritos[] }>('gerenciar_favoritos_projetos', {
                    apiBaseUrl: CONFIGURACAO_SOCIAL.apiBaseUrl, acao: 'listar', dados: { perfilId },
                });
                if (perfilId !== obterPerfilFavoritos()) return;
                grupos = mesclarGruposFavoritos(remoto.grupos, grupos);
            }
            await invoke('gerenciar_favoritos_projetos', {
                apiBaseUrl: CONFIGURACAO_SOCIAL.apiBaseUrl, acao: 'grupos',
                dados: { perfilId, grupos },
            });
            if (localStorage.getItem(chavePendentes) === pendentes) {
                localStorage.removeItem(chavePendentes);
                localStorage.removeItem(chaveImportacao);
            }
        }
        const antes = localStorage.getItem(chaveLista);
        const resposta = await invoke<{
            favoritos: Array<{ source: FavoriteItem['source']; projectId: string; dados: FavoriteItem | null }>;
            grupos: GrupoFavoritos[];
        }>('gerenciar_favoritos_projetos', {
            apiBaseUrl: CONFIGURACAO_SOCIAL.apiBaseUrl, acao: 'listar', dados: { perfilId },
        });
        if (perfilId !== obterPerfilFavoritos()) return;
        const locais = loadFavorites();
        const favoritos: FavoriteItem[] = [];
        for (const item of resposta.favoritos) {
            const local = locais.find((local) => local.id === item.projectId && local.source === item.source);
            if (item.dados || (local && !local.indisponivel)) {
                favoritos.push(item.dados ?? local!);
                continue;
            }
            try {
                const favorito = await recuperarFavoritoLegado(item.source, item.projectId);
                if (perfilId !== obterPerfilFavoritos()) return;
                favoritos.push(favorito);
                if (localStorage.getItem(chaveLista) === antes) {
                    registrarFavorito({ source: item.source, projectId: item.projectId }, true, favorito);
                }
            } catch {
                favoritos.push({
                    id: item.projectId, source: item.source, title: item.projectId, description: '',
                    icon_url: '', author: '', slug: item.projectId, type: 'mod', indisponivel: true,
                });
            }
        }
        if (perfilId !== obterPerfilFavoritos()) return;
        if (localStorage.getItem(chaveLista) === antes) {
            localStorage.setItem(chaveLista, JSON.stringify(favoritos));
        }
        if (!localStorage.getItem(chavePendentes)) localStorage.setItem(chaveGrupos, JSON.stringify(resposta.grupos));
        notificar();
        atualizarEstadoSincronizacao(false);
    })().catch((erro) => {
        if (perfilId === obterPerfilFavoritos()) atualizarEstadoSincronizacao(false, String(erro));
        throw erro;
    }).finally(() => {
        sincronizacao = null;
        if (!sincronizacaoSolicitada) return;
        sincronizacaoSolicitada = false;
        void sincronizarColecaoFavoritos().catch(() => undefined);
    });
    return sincronizacao;
}

function mesclarGruposFavoritos(anteriores: GrupoFavoritos[], novos: GrupoFavoritos[]) {
    const grupos = new Map<string, GrupoFavoritos>();
    const referencias = new Set<string>();
    for (const grupo of [...anteriores, ...novos]) {
        const existente = grupos.get(grupo.id);
        const favoritos = grupo.favoritos.filter((chave) => {
            if (referencias.has(chave)) return false;
            referencias.add(chave);
            return true;
        });
        grupos.set(grupo.id, existente
            ? { ...existente, favoritos: [...existente.favoritos, ...favoritos] }
            : { ...grupo, favoritos });
    }
    return [...grupos.values()];
}

async function recuperarFavoritoLegado(source: FavoriteItem['source'], id: string): Promise<FavoriteItem> {
    if (source === 'curseforge') {
        const dados = await invoke<{
            title: string; description: string; iconUrl: string; author: string;
            slug: string; projectType: FavoriteItem['type'];
        }>('buscar_detalhes_projeto_curseforge', { projectId: id });
        return { id, source, title: dados.title, description: dados.description, icon_url: dados.iconUrl,
            author: dados.author, slug: dados.slug, type: dados.projectType };
    }
    if (source === 'dome') {
        const dados = await invoke<FavoriteItem>('gerenciar_modpacks_dome', {
            apiBaseUrl: CONFIGURACAO_SOCIAL.apiBaseUrl, acao: 'detalhes', id, dados: null,
        });
        return { ...dados, id, source, slug: id, type: 'modpack', author: dados.author ?? 'Dome' };
    }
    const resposta = await fetch(`https://api.modrinth.com/v2/project/${encodeURIComponent(id)}`,
        { signal: AbortSignal.timeout(12000) });
    if (!resposta.ok) throw new Error('Projeto indisponível no Modrinth.');
    const dados = await resposta.json();
    if (!['mod', 'modpack', 'resourcepack', 'shader'].includes(dados.project_type)) {
        throw new Error('Tipo de projeto inválido.');
    }
    return { id, source, title: dados.title, description: dados.description, icon_url: dados.icon_url ?? '',
        author: '', slug: dados.slug, type: dados.project_type };
}
