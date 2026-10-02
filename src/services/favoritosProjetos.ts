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
}
const CHAVE_PENDENTES = 'dome_favoritos_pendentes';
let sincronizacao: Promise<void> | null = null;
let favoritosLegadosPreparados = false;

function lerPendentes(): AlteracaoFavorito[] {
    try { return JSON.parse(localStorage.getItem(CHAVE_PENDENTES) || '[]'); }
    catch { return []; }
}

export function registrarFavorito(projeto: ProjetoFavorito, favoritado: boolean): void {
    const pendentes = lerPendentes().filter((item) =>
        item.source !== projeto.source || item.projectId !== projeto.projectId);
    pendentes.push({ ...projeto, favoritado });
    localStorage.setItem(CHAVE_PENDENTES, JSON.stringify(pendentes));
    window.dispatchEvent(new Event(EVENTO_FAVORITOS_ATUALIZADOS));
    void sincronizarFavoritos().catch(() => undefined);
}

export function sincronizarFavoritos(): Promise<void> {
    if (sincronizacao) return sincronizacao;
    let alterado = false;
    sincronizacao = (async () => {
        while (lerPendentes().length) {
            const item = lerPendentes()[0];
            await invoke('gerenciar_favoritos_projetos', {
                apiBaseUrl: CONFIGURACAO_SOCIAL.apiBaseUrl, acao: 'salvar', dados: item,
            });
            const pendentes = lerPendentes();
            if (JSON.stringify(pendentes[0]) === JSON.stringify(item)) pendentes.shift();
            localStorage.setItem(CHAVE_PENDENTES, JSON.stringify(pendentes));
            alterado = true;
        }
    })().finally(() => {
        sincronizacao = null;
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
    if (!favoritosLegadosPreparados) {
        favoritosLegadosPreparados = true;
        const pendentes = lerPendentes();
        try {
            const favoritos: Array<{ source: ProjetoFavorito['source']; id: string }> =
                JSON.parse(localStorage.getItem('dome_favorites') || '[]');
            for (const favorito of favoritos) {
                if (pendentes.some((item) => item.source === favorito.source && item.projectId === favorito.id)) continue;
                pendentes.push({ source: favorito.source, projectId: favorito.id, favoritado: true });
            }
            localStorage.setItem(CHAVE_PENDENTES, JSON.stringify(pendentes));
        } catch { /* Favoritos locais inválidos não impedem a consulta pública. */ }
    }
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
