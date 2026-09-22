import { useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, Check, Loader2, Trash2, X } from "../iconesPixelados";
import { cn } from "../lib/utils";
import {
    dispensarExclusao,
    observarExclusoes,
    obterExclusoes,
    type ExclusaoInstancia,
} from "../stores/exclusoesInstancias";

function tituloExclusao(exclusao: ExclusaoInstancia): string {
    if (exclusao.instancias.length === 1) return exclusao.instancias[0].nome;
    return `${exclusao.instancias.length} instâncias`;
}

function subtituloExclusao(exclusao: ExclusaoInstancia): string {
    if (exclusao.situacao === "erro") return "Exclusão interrompida";
    if (exclusao.situacao === "concluida") return "Exclusão concluída";
    if (exclusao.situacao === "aguardando") return "Aguardando a vez";
    if (exclusao.instancias.length === 1) return exclusao.detalhe;

    return `${exclusao.indiceAtual + 1} de ${exclusao.instancias.length} · ${exclusao.detalhe}`;
}

export default function IndicadorExclusoesInstancias() {
    const exclusoes = useSyncExternalStore(observarExclusoes, obterExclusoes, obterExclusoes);

    return (
        <div className={cn(
            "pointer-events-none absolute right-4 top-20 z-[60] flex max-h-[50vh] flex-col",
            "w-[min(20rem,calc(100vw-2rem))] gap-2 overflow-y-auto"
        )}>
            <AnimatePresence>
                {exclusoes.map((exclusao) => {
                    const emAndamento = ["aguardando", "excluindo"].includes(exclusao.situacao);
                    const falhou = exclusao.situacao === "erro";

                    return (
                        <motion.section
                            key={exclusao.chave}
                            initial={{ opacity: 0, x: 20 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 20 }}
                            role={emAndamento ? undefined : "status"}
                            aria-label={`Exclusão de ${tituloExclusao(exclusao)}`}
                            className={cn(
                                "pointer-events-auto border bg-[#151516] p-3 shadow-2xl",
                                falhou ? "border-red-400/35" : "border-white/15"
                            )}
                        >
                            <div className="flex items-start gap-2.5">
                                <span className={cn(
                                    "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center",
                                    falhou ? "bg-red-400/10 text-red-300" : "bg-white/5 text-white/60"
                                )}>
                                    {falhou ? <AlertCircle size={15} /> : emAndamento
                                        ? <Loader2 size={15} className="animate-spin" />
                                        : <Check size={15} className="text-emerald-300" />}
                                </span>
                                <div className="min-w-0 flex-1">
                                    <p className={cn(
                                        "flex items-center gap-1.5 text-[10px] font-black uppercase",
                                        "tracking-wide text-white/75"
                                    )}>
                                        <Trash2 size={11} className="text-red-300" />
                                        {emAndamento ? "Apagando" : falhou ? "Falha ao apagar" : "Apagada"}
                                    </p>
                                    <p
                                        className="mt-0.5 truncate text-xs font-bold text-white"
                                        title={tituloExclusao(exclusao)}
                                    >
                                        {tituloExclusao(exclusao)}
                                    </p>
                                </div>
                                {emAndamento ? (
                                    <span className="shrink-0 text-base font-black tabular-nums text-red-300">
                                        {exclusao.porcentagem}%
                                    </span>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => dispensarExclusao(exclusao.chave)}
                                        aria-label={`Dispensar resultado da exclusão de ${tituloExclusao(exclusao)}`}
                                        className="p-1 text-white/35 hover:text-white"
                                    >
                                        <X size={14} />
                                    </button>
                                )}
                            </div>
                            <p className={cn(
                                "mt-2 text-[10px] leading-relaxed",
                                falhou ? "text-red-200/70" : "text-white/40"
                            )}>
                                {subtituloExclusao(exclusao)}
                            </p>
                            {falhou && <p className="mt-1 break-words text-[10px] text-red-100/55">{exclusao.erro}</p>}
                            {emAndamento && (
                                <div
                                    role="progressbar"
                                    aria-label={`Progresso da exclusão de ${tituloExclusao(exclusao)}`}
                                    aria-valuemin={0}
                                    aria-valuemax={100}
                                    aria-valuenow={exclusao.porcentagem}
                                    className="mt-2.5 h-1.5 overflow-hidden bg-black/50"
                                >
                                    <motion.div
                                        initial={false}
                                        animate={{ width: `${exclusao.porcentagem}%` }}
                                        transition={{ duration: 0.18, ease: "easeOut" }}
                                        className="h-full bg-red-400"
                                    />
                                </div>
                            )}
                        </motion.section>
                    );
                })}
            </AnimatePresence>
        </div>
    );
}
