import { invoke } from '@tauri-apps/api/core';
import { CONFIGURACAO_SOCIAL } from '../lib/configuracaoSocial';

export const EVENTO_FAVORITOS_ATUALIZADOS = 'dome:favoritos-atualizados';
export interface ProjetoFavorito {
    source: 'modrinth' | 'curseforge' | 'dome';
    projectId: string;
}
export interface ContagemFavoritos extends ProjetoFavorito {
    total: number;
    favoritadoPorMim: boolean;
}
interface AlteracaoFavorito extends ProjetoFavorito {
    favoritado: boolean;
    dados?: unknown;
}
const CHAVE_PENDENTES = 'dome_favoritos_pendentes';
let sincronizacao: Promise<void> | null = null;
let perfilSincronizando: string | null = null;
let perfilAtual: string | null = null;

export function obterPerfilFavoritos() { return perfilAtual; }
export function definirPerfilFavoritos(perfilId: string | null) { perfilAtual = perfilId; }
function chavePendentes() { return perfilAtual ? `${CHAVE_PENDENTES}:${perfilAtual}` : CHAVE_PENDENTES; }
function lerPendentes(): AlteracaoFavorito[] {
    try { return JSON.parse(localStorage.getItem(chavePendentes()) || '[]'); }
    catch { return []; }
}

export function registrarFavorito(projeto: ProjetoFavorito, favoritado: boolean, dados?: unknown): void {
    const pendentes = lerPendentes().filter((item) =>
        item.source !== projeto.source || item.projectId !== projeto.projectId);
    pendentes.push({ ...projeto, favoritado, ...(dados ? { dados } : {}) });
    localStorage.setItem(chavePendentes(), JSON.stringify(pendentes));
    window.dispatchEvent(new Event(EVENTO_FAVORITOS_ATUALIZADOS));
    void sincronizarFavoritos().catch(() => undefined);
}

export function sincronizarFavoritos(): Promise<void> {
    if (!perfilAtual) return Promise.resolve();
    if (sincronizacao) {
        if (perfilSincronizando === perfilAtual) return sincronizacao;
        return sincronizacao.catch(() => undefined).then(sincronizarFavoritos);
    }
    const perfilId = perfilAtual;
    perfilSincronizando = perfilId;
    const chave = chavePendentes();
    let alterado = false;
    sincronizacao = (async () => {
        while (perfilId === perfilAtual && lerPendentes().length) {
            const item = lerPendentes()[0];
            await invoke('gerenciar_favoritos_projetos', {
                apiBaseUrl: CONFIGURACAO_SOCIAL.apiBaseUrl,
                acao: 'salvar', dados: { ...item, ...(perfilId ? { perfilId } : {}) },
            });
            if (perfilId !== perfilAtual) return;
            const pendentes = lerPendentes();
            if (JSON.stringify(pendentes[0]) === JSON.stringify(item)) pendentes.shift();
            localStorage.setItem(chave, JSON.stringify(pendentes));
            alterado = true;
        }
    })().finally(() => {
        sincronizacao = null;
        perfilSincronizando = null;
        if (alterado) window.dispatchEvent(new Event(EVENTO_FAVORITOS_ATUALIZADOS));
    });
    return sincronizacao;
}

export function obterTotalFavoritos(projeto: ProjetoFavorito, contagem?: ContagemFavoritos): number {
    const pendente = lerPendentes().find((item) =>
        item.source === projeto.source && item.projectId === projeto.projectId);
    const ajuste = pendente ? Number(pendente.favoritado) - Number(contagem?.favoritadoPorMim || false) : 0;
    return Math.max(0, (contagem?.total || 0) + ajuste);
}

export async function consultarFavoritos(projetos: ProjetoFavorito[]): Promise<ContagemFavoritos[]> {
    await sincronizarFavoritos().catch(() => undefined);
    const resultados: ContagemFavoritos[] = [];
    for (let inicio = 0; inicio < projetos.length; inicio += 150) {
        resultados.push(...await invoke<ContagemFavoritos[]>('gerenciar_favoritos_projetos', {
            apiBaseUrl: CONFIGURACAO_SOCIAL.apiBaseUrl,
            acao: 'contagens', dados: { projetos: projetos.slice(inicio, inicio + 150) },
        }));
    }
    return resultados;
}
