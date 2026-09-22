export const EVENTO_NAVEGACAO_INTERNA = "dome:navegacao-interna";

export type DirecaoNavegacaoInterna = -1 | 1;

export function solicitarNavegacaoInterna(direcao: DirecaoNavegacaoInterna): boolean {
    const evento = new CustomEvent<DirecaoNavegacaoInterna>(EVENTO_NAVEGACAO_INTERNA, {
        cancelable: true,
        detail: direcao,
    });
    window.dispatchEvent(evento);
    return evento.defaultPrevented;
}
