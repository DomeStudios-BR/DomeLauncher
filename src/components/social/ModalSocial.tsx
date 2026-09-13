import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function ModalSocial({ children, onFechar }: { children: ReactNode; onFechar: () => void }) {
    const conteudo = useRef<HTMLDivElement>(null);
    const fechar = useRef(onFechar);
    fechar.current = onFechar;
    useEffect(() => {
        const anterior = document.activeElement as HTMLElement | null;
        const aoTeclar = (evento: KeyboardEvent) => {
            const modais = document.querySelectorAll('[data-modal-social]');
            if (modais[modais.length - 1] !== conteudo.current) return;
            if (evento.key === 'Escape') { evento.preventDefault(); evento.stopPropagation(); fechar.current(); }
            if (evento.key !== 'Tab') return;
            const controles = Array.from(conteudo.current?.querySelectorAll<HTMLElement>(
                'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]',
            ) ?? []).filter((elemento) => elemento.getClientRects().length > 0);
            const primeiro = controles[0];
            const ultimo = controles[controles.length - 1];
            if (!primeiro) { evento.preventDefault(); return; }
            if (evento.shiftKey && document.activeElement === primeiro) { evento.preventDefault(); ultimo.focus(); }
            else if (!evento.shiftKey && document.activeElement === ultimo) { evento.preventDefault(); primeiro.focus(); }
        };
        document.addEventListener('keydown', aoTeclar, true);
        return () => { document.removeEventListener('keydown', aoTeclar, true); anterior?.focus(); };
    }, []);
    return createPortal(<div ref={conteudo} data-modal-social
        className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-5"
        onMouseDown={(evento) => { if (evento.target === evento.currentTarget) onFechar(); }}>{children}</div>, document.body);
}
