import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import { CheckCircle, X } from "../iconesPixelados";
import { AreaRolagemPersonalizada } from "./scroll/AreaRolagemPersonalizada";

export interface NovidadesVersao {
    versao: string;
    conteudo: string;
}

interface NovidadesVersaoModalProps {
    novidades: NovidadesVersao | null;
    onClose: () => void;
}

function limparDescricaoRelease(conteudo: string): string {
    const linhas = conteudo.trim().split("\n");
    const tituloCommit = /^(?:feat|fix|perf|refactor|style|docs|build|ci|chore|test|revert)(?:\([^)]*\))?!?:\s+/i;

    if (tituloCommit.test(linhas[0]?.trim() ?? "")) {
        linhas.shift();
    }

    return linhas.join("\n").trim();
}

export function NovidadesVersaoModal({ novidades, onClose }: NovidadesVersaoModalProps) {
    const descricaoRelease = novidades ? limparDescricaoRelease(novidades.conteudo) : "";
    useEffect(() => {
        if (!novidades) return;

        const fecharComEscape = (evento: KeyboardEvent) => {
            if (evento.key === "Escape") onClose();
        };
        window.addEventListener("keydown", fecharComEscape);
        return () => window.removeEventListener("keydown", fecharComEscape);
    }, [novidades, onClose]);

    return (
        <AnimatePresence>
            {novidades && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-[140] grid place-items-center bg-black/80 p-5 backdrop-blur-sm"
                >
                    <motion.section
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="titulo-novidades-versao"
                        initial={{ opacity: 0, y: 22, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 14, scale: 0.99 }}
                        className="flex max-h-[82vh] w-full max-w-2xl flex-col overflow-hidden border border-emerald-300/35 bg-[#111] shadow-2xl"
                    >
                        <header className="relative shrink-0 border-b border-white/10 bg-[linear-gradient(120deg,#14251d_0%,#151515_58%)] px-7 py-6 pr-16">
                            <p className="mb-2 text-[10px] uppercase tracking-[0.2em] text-emerald-300">
                                Atualização concluída · v{novidades.versao.replace(/^v/i, "")}
                            </p>
                            <h2
                                id="titulo-novidades-versao"
                                className="font-['MinecraftTen','Sora',sans-serif] text-[30px] leading-9 text-white"
                            >
                                O que há de novo!
                            </h2>
                            <button
                                type="button"
                                aria-label="Fechar novidades"
                                onClick={onClose}
                                className="absolute right-5 top-5 grid h-9 w-9 place-items-center border border-white/15 bg-black/25 text-white/70 transition hover:border-white/30 hover:text-white"
                            >
                                <X size={16} />
                            </button>
                        </header>

                        <AreaRolagemPersonalizada className="min-h-0 flex-1" rotulo="Novidades da versão">
                            <article className="prose-invert px-7 py-6 text-sm leading-7 text-white/75">
                                <ReactMarkdown
                                    remarkPlugins={[remarkGfm]}
                                    rehypePlugins={[rehypeSanitize]}
                                    components={{
                                        h1: ({ children }) => <h3 className="mb-3 text-xl font-bold text-white">{children}</h3>,
                                        h2: ({ children }) => <h3 className="mb-3 mt-5 text-lg font-bold text-white">{children}</h3>,
                                        h3: ({ children }) => <h4 className="mb-2 mt-4 font-bold text-white">{children}</h4>,
                                        p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
                                        ul: ({ children }) => <ul className="mb-3 space-y-2">{children}</ul>,
                                        ol: ({ children }) => <ol className="mb-3 list-decimal space-y-2 pl-5">{children}</ol>,
                                        li: ({ children }) => (
                                            <li className="flex items-start gap-2">
                                                <CheckCircle size={13} className="mt-[7px] shrink-0 text-emerald-300" />
                                                <span>{children}</span>
                                            </li>
                                        ),
                                        a: ({ children }) => <span className="text-emerald-300">{children}</span>,
                                    }}
                                >
                                    {descricaoRelease || "Melhorias gerais e correções para deixar sua experiência mais estável."}
                                </ReactMarkdown>
                            </article>
                        </AreaRolagemPersonalizada>

                        <footer className="shrink-0 border-t border-white/10 bg-[#151515] px-7 py-4 text-right">
                            <button
                                type="button"
                                onClick={onClose}
                                className="border border-emerald-300/60 bg-emerald-400 px-5 py-2 font-['MinecraftTen','Sora',sans-serif] text-xs uppercase tracking-[0.1em] text-[#07120a] transition-colors hover:bg-emerald-300"
                            >
                                Começar a jogar
                            </button>
                        </footer>
                    </motion.section>
                </motion.div>
            )}
        </AnimatePresence>
    );
}
