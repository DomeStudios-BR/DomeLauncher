import type { Instance } from '../hooks/useLauncher';
import type { InstanciaPublicaPerfil, PerfilSocial } from '../components/social/tiposSocial';

export interface CapturaPerfil {
    nome: string;
    instanciaId: string;
    instanciaNome: string;
    criadaEm: string | null;
    dadosUrl: string;
}

export function identificarCaptura(captura: CapturaPerfil): string {
    return `${captura.instanciaId}:${captura.nome}`;
}

/** Mantém as mídias publicadas mesmo quando a página correspondente da galeria ainda não foi carregada. */
export function montarCapturasFavoritas(
    ids: string[],
    publicadas: NonNullable<PerfilSocial['capturasFavoritas']>,
    locais: CapturaPerfil[],
) {
    return ids.slice(0, 3).map((id) => {
        const publicada = publicadas.find((captura) => captura.id === id);
        if (publicada) {
            return {
                id,
                nome: publicada.nome,
                instanciaNome: publicada.instanciaNome,
                criadaEm: publicada.criadaEm ?? null,
                dadosUrl: publicada.imagemUrl,
            };
        }
        const local = locais.find((captura) => identificarCaptura(captura) === id);
        if (!local) throw new Error('Uma captura selecionada não está disponível. Reabra o perfil e tente novamente.');
        return { ...local, id };
    });
}

/** Preserva favoritos de outros computadores e seus ícones já publicados. */
export function montarInstanciasFavoritas(
    ids: string[],
    publicadas: InstanciaPublicaPerfil[],
    locais: Instance[],
): InstanciaPublicaPerfil[] {
    return ids.slice(0, 3).map((id) => {
        const publicada = publicadas.find((instancia) => instancia.id === id);
        if (publicada) return publicada;
        const local = locais.find((instancia) => instancia.id === id);
        if (!local) throw new Error('Uma instância selecionada não está disponível. Reabra o perfil e tente novamente.');
        return {
            id,
            nome: local.name,
            versao: local.version,
            carregador: local.loader_type || local.mc_type,
            iconeUrl: local.icon ?? null,
            horasJogadas: (local.tempo_total_jogado_segundos ?? 0) / 3600,
            ultimaVez: local.last_played ?? null,
        };
    });
}
