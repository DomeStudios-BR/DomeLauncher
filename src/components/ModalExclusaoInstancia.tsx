import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { AlertCircle, Trash2, X } from "../iconesPixelados";
import { cn } from "../lib/utils";
import {
    iniciarExclusaoInstancias,
    type InstanciaParaExclusao,
} from "../stores/exclusoesInstancias";

interface ModalExclusaoInstanciaProps {
    instancias: InstanciaParaExclusao[];
    aoFechar: () => void;
    aoExcluir: (id: string) => Promise<void>;
    aoIniciar?: () => void;
}

export default function ModalExclusaoInstancia({
    instancias,
    aoFechar,
    aoExcluir,
    aoIniciar,
}: ModalExclusaoInstanciaProps) {
    const botaoConfirmarRef = useRef<HTMLButtonElement>(null);
    const confirmacaoIniciada = useRef(false);
    const umaInstancia = instancias.length === 1;

    useEffect(() => {
        botaoConfirmarRef.current?.focus();
    }, []);

    useEffect(() => {
        const fecharComEscape = (evento: KeyboardEvent) => {
            if (evento.key === "Escape") aoFechar();
        };
        window.addEventListener("keydown", fecharComEscape);
        return () => window.removeEventListener("keydown", fecharComEscape);
    }, [aoFechar]);

    const confirmarExclusao = () => {
        if (confirmacaoIniciada.current) return;
        confirmacaoIniciada.current = true;
        iniciarExclusaoInstancias(instancias, aoExcluir);
        aoFechar();
        aoIniciar?.();
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[130] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
            onMouseDown={aoFechar}
        >
            <motion.section
                initial={{ opacity: 0, y: 12, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, scale: 0.98 }}
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="titulo-exclusao-instancia"
                aria-describedby="descricao-exclusao-instancia"
                className="w-full max-w-md overflow-hidden border border-red-300/20 bg-[#141415] shadow-2xl"
                onMouseDown={(evento) => evento.stopPropagation()}
            >
                <header className="flex items-start gap-3 border-b border-white/8 px-5 py-4">
                    <div className={cn(
                        "flex h-10 w-10 shrink-0 items-center justify-center border",
                        "border-red-300/20 bg-red-400/10 text-red-300"
                    )}>
                        <AlertCircle size={20} />
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-[9px] font-black uppercase tracking-[0.2em] text-red-300/70">
                            Você está apagando a instância
                        </p>
                        <h2 id="titulo-exclusao-instancia" className="mt-1 truncate text-base font-black text-white">
                            {umaInstancia
                                ? instancias[0]?.nome
                                : `${instancias.length} instâncias`}
                        </h2>
                    </div>
                    <button
                        type="button"
                        aria-label="Fechar aviso de exclusão"
                        onClick={aoFechar}
                        className="p-2 text-white/35 transition-colors hover:bg-white/8 hover:text-white"
                    >
                        <X size={15} />
                    </button>
                </header>

                <div className="px-5 py-5">
                    <p id="descricao-exclusao-instancia" className="text-sm leading-relaxed text-white/65">
                        A pasta {umaInstancia ? "desta instância" : "de cada instância selecionada"} será
                        removida por completo. Esta ação não pode ser desfeita.
                    </p>
                    <div className={cn(
                        "mt-4 grid grid-cols-2 gap-px bg-white/8 p-px text-[10px] font-bold",
                        "uppercase tracking-wide text-white/45"
                    )}>
                        {["Mundos", "Mods e packs", "Configurações", "Capturas"].map((item) => (
                            <span key={item} className="bg-[#181819] px-3 py-2.5">
                                {item}
                            </span>
                        ))}
                    </div>
                    {!umaInstancia && (
                        <p className="mt-3 truncate text-[11px] text-white/35">
                            {instancias.map((instancia) => instancia.nome).join(" • ")}
                        </p>
                    )}
                </div>

                <footer className="flex items-center justify-end gap-2 border-t border-white/8 bg-black/15 px-5 py-3">
                    <button
                        type="button"
                        onClick={aoFechar}
                        className="px-3 py-2 text-xs font-bold text-white/45 transition-colors hover:text-white"
                    >
                        Cancelar
                    </button>
                    <button
                        ref={botaoConfirmarRef}
                        type="button"
                        onClick={confirmarExclusao}
                        className={cn(
                            "flex items-center gap-2 border border-red-300/25 bg-red-400 px-4 py-2",
                            "text-xs font-black text-[#210808] transition-colors hover:bg-red-300",
                            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-300"
                        )}
                    >
                        <Trash2 size={13} />
                        Apagar definitivamente
                    </button>
                </footer>
            </motion.section>
        </motion.div>
    );
}
