import { useEffect, useRef, type PointerEvent } from 'react';

/** Compartilha o arraste por ponteiro, a prévia flutuante e o cancelamento entre coleções do launcher. */
export function useArrastoItem({
    itemId,
    onIniciar,
    onMover,
    onFinalizar,
}: {
    itemId: string;
    onIniciar: (id: string) => void;
    onMover: (id: string, x: number, y: number) => void;
    onFinalizar: (id?: string, x?: number, y?: number) => void;
}) {
    const inicioRef = useRef<{
        ponteiroId: number;
        x: number;
        y: number;
        ativo: boolean;
    } | null>(null);
    const ignorarCliqueRef = useRef(false);
    const elementoRef = useRef<HTMLDivElement | null>(null);
    const callbacksRef = useRef({ onIniciar, onMover, onFinalizar });
    callbacksRef.current = { onIniciar, onMover, onFinalizar };

    useEffect(() => {
        let quadradoFlutuante: HTMLElement | null = null;
        let deslocamentoX = 0;
        let deslocamentoY = 0;
        const encerrar = (evento?: globalThis.PointerEvent) => {
            const inicio = inicioRef.current;
            if (!inicio || (evento && evento.pointerId !== inicio.ponteiroId)) return;
            inicioRef.current = null;
            quadradoFlutuante?.remove();
            quadradoFlutuante = null;
            if (inicio.ativo) {
                callbacksRef.current.onFinalizar(
                    evento ? itemId : undefined,
                    evento?.clientX,
                    evento?.clientY
                );
            }
        };
        const mover = (evento: globalThis.PointerEvent) => {
            const inicio = inicioRef.current;
            if (!inicio || evento.pointerId !== inicio.ponteiroId) return;
            if ((evento.buttons & 1) === 0) {
                encerrar();
                return;
            }
            if (!inicio.ativo) {
                if (Math.hypot(evento.clientX - inicio.x, evento.clientY - inicio.y) < 5) return;
                inicio.ativo = true;
                ignorarCliqueRef.current = true;
                const elemento = elementoRef.current;
                if (elemento) {
                    const limites = elemento.getBoundingClientRect();
                    deslocamentoX = inicio.x - limites.left;
                    deslocamentoY = inicio.y - limites.top;
                    quadradoFlutuante = elemento.cloneNode(true) as HTMLElement;
                    quadradoFlutuante.removeAttribute("data-instancia-id");
                    quadradoFlutuante.removeAttribute("data-favorito-id");
                    quadradoFlutuante.removeAttribute("data-grupo-id");
                    quadradoFlutuante.removeAttribute("data-destino-arrasto");
                    quadradoFlutuante.setAttribute("aria-hidden", "true");
                    Object.assign(quadradoFlutuante.style, {
                        position: "fixed",
                        width: `${limites.width}px`,
                        height: `${limites.height}px`,
                        margin: "0",
                        pointerEvents: "none",
                        zIndex: "1000",
                        opacity: "1",
                        transform: "none",
                        transition: "none",
                        backgroundColor: "#202523",
                        boxShadow: "0 12px 30px #0008",
                    });
                    document.body.appendChild(quadradoFlutuante);
                }
                callbacksRef.current.onIniciar(itemId);
            }
            if (quadradoFlutuante) {
                quadradoFlutuante.style.left = `${evento.clientX - deslocamentoX}px`;
                quadradoFlutuante.style.top = `${evento.clientY - deslocamentoY}px`;
            }
            evento.preventDefault();
            callbacksRef.current.onMover(itemId, evento.clientX, evento.clientY);
        };
        const cancelar = () => encerrar();
        const tecla = (evento: KeyboardEvent) => {
            if (evento.key === "Escape") cancelar();
        };
        window.addEventListener("pointermove", mover, { passive: false });
        window.addEventListener("pointerup", encerrar, true);
        window.addEventListener("pointercancel", cancelar);
        window.addEventListener("blur", cancelar);
        window.addEventListener("keydown", tecla);
        return () => {
            window.removeEventListener("pointermove", mover);
            window.removeEventListener("pointerup", encerrar, true);
            window.removeEventListener("pointercancel", cancelar);
            window.removeEventListener("blur", cancelar);
            window.removeEventListener("keydown", tecla);
            cancelar();
        };
    }, [itemId]);

    const aoPressionar = (evento: PointerEvent<HTMLDivElement>) => {
        if (evento.button !== 0 || !evento.isPrimary) return;
        ignorarCliqueRef.current = false;
        elementoRef.current = evento.currentTarget;
        inicioRef.current = {
            ponteiroId: evento.pointerId,
            x: evento.clientX,
            y: evento.clientY,
            ativo: false,
        };
        evento.preventDefault();
    };

    const consumirCliqueArrasto = () => {
        if (!ignorarCliqueRef.current) return false;
        ignorarCliqueRef.current = false;
        return true;
    };

    return { aoPressionar, consumirCliqueArrasto };
}
