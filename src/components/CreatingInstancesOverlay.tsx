import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, CheckCircle, XCircle, Download } from "../iconesPixelados";
import {
  getCreatingInstances,
  subscribeToCreating,
  removeCreatingInstance,
  type CreatingInstance,
} from "../stores/creatingInstances";

export default function CreatingInstancesOverlay() {
  const [creating, setCreating] = useState<CreatingInstance[]>([]);

  useEffect(() => {
    // Carregar estado inicial
    setCreating(getCreatingInstances());

    // Subscrever a atualizações
    const unsubscribe = subscribeToCreating(() => {
      setCreating(getCreatingInstances());
    });

    return unsubscribe;
  }, []);

  if (creating.length === 0) return null;

  return (
    <div className="fixed bottom-24 right-8 z-40 flex w-80 max-w-[calc(100vw-4rem)] flex-col gap-3">
      <AnimatePresence mode="popLayout">
        {creating.map((instance) => (
          <motion.div
            key={instance.id}
            initial={{ opacity: 0, x: 100, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 100, scale: 0.9 }}
            className="w-full bg-[#161618] border border-white/10 rounded-2xl p-4 shadow-xl backdrop-blur-xl"
          >
            <div className="flex items-center gap-3">
              {/* Ícone de Status */}
              <div className="relative">
                <div className="w-12 h-12 rounded-xl bg-white/5 overflow-hidden">
                  <img
                    src={instance.icon}
                    alt={instance.name}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="absolute -bottom-1 -right-1">
                  {instance.status === "downloading" ||
                  instance.status === "installing" ? (
                    <div className="w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center">
                      <Loader2 size={12} className="text-black animate-spin" />
                    </div>
                  ) : instance.status === "complete" ? (
                    <div className="w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center">
                      <CheckCircle size={12} className="text-black" />
                    </div>
                  ) : instance.status === "error" ? (
                    <div className="w-5 h-5 bg-red-500 rounded-full flex items-center justify-center">
                      <XCircle size={12} className="text-white" />
                    </div>
                  ) : null}
                </div>
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm truncate">{instance.name}</p>
                <p className="text-xs text-white/40">{instance.message}</p>
              </div>

              {/* Fechar se erro */}
              {instance.status === "error" && (
                <button
                  onClick={() => removeCreatingInstance(instance.id)}
                  className="p-1 text-white/40 hover:text-white"
                >
                  <XCircle size={18} />
                </button>
              )}
            </div>

            {/* Barra de Progresso */}
            {(instance.status === "downloading" ||
              instance.status === "installing") && (
              <div className="mt-3">
                <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                  {instance.progressoIndeterminado ? (
                    <motion.div
                      className="h-full w-1/3 bg-emerald-400"
                      initial={{ x: "-100%" }}
                      animate={{ x: "300%" }}
                      transition={{
                        duration: 1.1,
                        ease: "linear",
                        repeat: Infinity,
                      }}
                    />
                  ) : (
                    <motion.div
                      className="h-full bg-emerald-500"
                      initial={{ width: 0 }}
                      animate={{ width: `${instance.progress}%` }}
                      transition={{ duration: 0.3 }}
                    />
                  )}
                </div>
                <p className="text-[10px] text-white/30 mt-1 flex items-center gap-1">
                  <Download size={10} />
                  {instance.progressoIndeterminado
                    ? "Processando..."
                    : `${Math.round(instance.progress)}%`}
                </p>
              </div>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
