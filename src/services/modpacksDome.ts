import { invoke } from '@tauri-apps/api/core';
import { CONFIGURACAO_SOCIAL } from '../lib/configuracaoSocial';

export function consultarModpacksDome<T>(
    acao: 'buscar' | 'detalhes' | 'versoes' | 'minhas-versoes' | 'permissao' | 'meus' | 'criar' | 'editar'
        | 'retirar' | 'excluir' | 'excluir-versao',
    id?: string,
    dados?: Record<string, unknown>,
): Promise<T> {
    return invoke<T>('gerenciar_modpacks_dome', {
        apiBaseUrl: CONFIGURACAO_SOCIAL.apiBaseUrl,
        acao,
        id: id ?? null,
        dados: dados ?? null,
    });
}

export interface ModpackDome {
    id: string;
    title: string;
    description: string;
    body: string;
    icon_url: string;
    publicado: boolean;
}

export interface VersaoModpackDome {
    id: string;
    version_number: string;
    changelog: string;
    version_type: 'release' | 'beta' | 'alpha';
    game_versions: string[];
    loaders: string[];
}
