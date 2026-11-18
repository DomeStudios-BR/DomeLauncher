import { useEffect, useRef } from "react";
import { motion } from "framer-motion";

interface Propriedades {
  nomeEmExecucao: string;
  nomeParaIniciar: string;
  onCancelar: () => void;
  onIniciarJunto: () => void;
  onEncerrarEIniciar: () => void;
}

/**
 * Confirma o início de uma instância enquanto outra está em execução.
 * Use antes de iniciar a seleção da barra inferior quando a instância em execução for diferente.
 */
export function ConfirmarTrocaInstanciaModal({
  nomeEmExecucao, nomeParaIniciar, onCancelar, onIniciarJunto, onEncerrarEIniciar,
}: Propriedades) {
  const botaoPrincipal = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    botaoPrincipal.current?.focus();
    const fecharComEscape = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") onCancelar();
    };
    document.addEventListener("keydown", fecharComEscape);
    return () => document.removeEventListener("keydown", fecharComEscape);
  }, [onCancelar]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" onClick={onCancelar}>
      <div role="dialog" aria-modal="true" aria-labelledby="troca-instancia-titulo"
        className="w-full max-w-md border border-white/15 bg-[#181818] p-5 shadow-xl"
        onClick={(evento) => evento.stopPropagation()}>
        <h2 id="troca-instancia-titulo" className="text-sm font-bold">{nomeEmExecucao} está em execução</h2>
        <p className="mt-2 text-sm text-white/60">Encerrar {nomeEmExecucao} e iniciar {nomeParaIniciar}?</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2 text-xs font-bold">
          <button type="button" onClick={onCancelar}
            className="border border-white/15 px-3 py-2 text-white/70 hover:border-white/30 hover:text-white">
            Cancelar
          </button>
          <button type="button" onClick={onIniciarJunto}
            className="border border-white/15 bg-white/[0.04] px-3 py-2 text-white/80 hover:border-white/30">
            Iniciar junto
          </button>
          <button type="button" ref={botaoPrincipal} onClick={onEncerrarEIniciar}
            className="border border-emerald-400 bg-emerald-500 px-3 py-2 text-[#07120a] hover:bg-emerald-400">
            Encerrar e iniciar
          </button>
        </div>
      </div>
    </motion.div>
  );
}
