import { useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { Image, Loader2, Play } from '../iconesPixelados';
import { CONFIGURACAO_SOCIAL } from '../lib/configuracaoSocial';

export interface AnexoRelato {
    id: string;
    tipo: string;
    url: string;
    nome: string;
}

export async function removerAnexoRelato(perfilId: string, envioId: string, anexo: AnexoRelato): Promise<void> {
    await invoke('excluir_anexo_relato', {
        apiBaseUrl: CONFIGURACAO_SOCIAL.apiBaseUrl, perfilId, envioId, anexo: { id: anexo.id, tipo: anexo.tipo },
    });
}

interface AnexosRelatoProps {
    perfilId: string;
    envioId: string;
    anexos: AnexoRelato[];
    bloqueado: boolean;
    aoAlterar: (anexos: AnexoRelato[]) => void;
    quantidade: number;
    aoInserir: (anexo: AnexoRelato) => void;
    aoOcupado: (ocupado: boolean) => void;
    aoErro: (erro: string) => void;
}

export function AnexosRelato({
    perfilId, envioId, anexos, bloqueado, quantidade, aoAlterar, aoInserir, aoOcupado, aoErro,
}: AnexosRelatoProps) {
    const [ocupado, setOcupado] = useState(false);
    const operacaoAtiva = useRef(false);
    const ocupar = (valor: boolean) => { operacaoAtiva.current = valor; setOcupado(valor); aoOcupado(valor); };

    const anexar = async (tipo: 'imagem' | 'video') => {
        if (!perfilId || bloqueado || operacaoAtiva.current || quantidade >= 4) return;
        ocupar(true);
        aoErro('');
        try {
            const caminho = await open({ multiple: false, filters: [{
                name: tipo === 'imagem' ? 'Imagem' : 'Vídeo',
                extensions: tipo === 'imagem' ? ['png', 'jpg', 'jpeg', 'webp', 'gif'] : ['mp4', 'webm'],
            }] });
            if (typeof caminho !== 'string') return;
            const anexo = await invoke<Omit<AnexoRelato, 'nome'>>('enviar_anexo_relato', {
                apiBaseUrl: CONFIGURACAO_SOCIAL.apiBaseUrl, perfilId, envioId,
                anexoId: crypto.randomUUID(), caminhoArquivo: caminho,
            });
            const completo = { ...anexo, nome: caminho.split(/[\\/]/).pop() ?? 'Anexo' };
            aoAlterar([...anexos, completo]);
            aoInserir(completo);
        } catch (erro) {
            aoErro(String(erro));
        } finally { ocupar(false); }
    };

    return <div className="space-y-3">
        <div className="flex items-center gap-3 text-xs text-white/65">
            <button type="button" disabled={!perfilId || bloqueado || ocupado || quantidade >= 4}
                onMouseDown={(evento) => evento.preventDefault()}
                onClick={() => void anexar('imagem')}
                className="flex items-center gap-1 hover:text-white disabled:opacity-35">
                <Image size={15} />Anexar imagem
            </button>
            <button type="button" disabled={!perfilId || bloqueado || ocupado || quantidade >= 4}
                onMouseDown={(evento) => evento.preventDefault()}
                onClick={() => void anexar('video')}
                className="flex items-center gap-1 hover:text-white disabled:opacity-35">
                <Play size={15} />Anexar vídeo
            </button>
            {ocupado && <span role="status" className="flex items-center gap-1">
                <Loader2 size={13} className="animate-spin" />Processando anexo...
            </span>}
        </div>
    </div>;
}
