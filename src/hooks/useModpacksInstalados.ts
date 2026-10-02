import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { Instance } from './useLauncher';

export interface ModpackInstalado {
    projectId: string;
    source: string;
}

export function useModpacksInstalados(instancias: Instance[]) {
    const [projetos, setProjetos] = useState<Set<string>>(new Set());
    const [carregando, setCarregando] = useState(true);
    useEffect(() => {
        let cancelado = false;
        setCarregando(true);
        void Promise.all(instancias.map(async (instancia) => {
            try {
                return await invoke<ModpackInstalado | null>('get_modpack_info', { instanceId: instancia.id });
            } catch { return null; }
        })).then((lista) => {
            if (cancelado) return;
            setProjetos(new Set(lista.filter((item) => item !== null)
                .map((item) => `${item.source.toLowerCase()}:${item.projectId}`)));
            setCarregando(false);
        });
        return () => { cancelado = true; };
    }, [instancias]);
    return { projetos, carregando };
}
