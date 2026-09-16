import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "framer-motion";
import { Calendar, ChevronRight, Loader2, Newspaper, X } from "../iconesPixelados";
import { AreaRolagemPersonalizada } from "./scroll/AreaRolagemPersonalizada";
import { CONFIGURACAO_SOCIAL } from "../lib/configuracaoSocial";
import ReactMarkdown from "react-markdown";

interface NoticiaMinecraft {
    titulo: string;
    descricao: string;
    url: string;
    imagem_url: string | null;
    publicado_em: string;
    origem?: "minecraft" | "dome";
    categoria?: "noticia" | "atualizacao";
    conteudo_local?: string;
}

interface NovidadeDomeApi {
    id: string;
    titulo: string;
    resumo: string;
    conteudo: string;
    imagemUrl: string;
    categoria: "noticia" | "atualizacao";
    versao: string;
    publicadoEm: string;
}

interface BlocoNoticiaMinecraft {
    tipo: "titulo" | "paragrafo" | "imagem";
    texto: string | null;
    url: string | null;
    descricao: string | null;
}

interface ConteudoNoticiaMinecraft {
    autor: string | null;
    blocos: BlocoNoticiaMinecraft[];
    markdown?: string;
}

function formatarData(data: string): string {
    const dataConvertida = new Date(data);
    if (Number.isNaN(dataConvertida.getTime())) return "Dome Studios";

    return dataConvertida.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "short",
        year: "numeric",
    });
}

export function NoticiasMinecraft() {
    const [noticias, setNoticias] = useState<NoticiaMinecraft[]>([]);
    const [carregando, setCarregando] = useState(true);
    const [erro, setErro] = useState<string | null>(null);
    const [noticiaAberta, setNoticiaAberta] = useState<NoticiaMinecraft | null>(null);
    const [conteudo, setConteudo] = useState<ConteudoNoticiaMinecraft | null>(null);
    const [carregandoArtigo, setCarregandoArtigo] = useState(false);
    const [erroArtigo, setErroArtigo] = useState<string | null>(null);

    const carregarNoticias = async () => {
        setCarregando(true);
        setErro(null);
        try {
            const [minecraft, dome] = await Promise.allSettled([
                invoke<NoticiaMinecraft[]>("get_minecraft_news", { limit: 4 }),
                fetch(`${CONFIGURACAO_SOCIAL.apiBaseUrl}/api/launcher/novidades?limite=8`).then(async (resposta) => {
                    if (!resposta.ok) throw new Error("Falha ao carregar novidades da Dome.");
                    return resposta.json() as Promise<{ novidades: NovidadeDomeApi[] }>;
                }),
            ]);

            const todas: NoticiaMinecraft[] = [];
            if (minecraft.status === "fulfilled") {
                todas.push(...minecraft.value.map((item) => ({ ...item, origem: "minecraft" as const })));
            }
            if (dome.status === "fulfilled") {
                todas.push(...dome.value.novidades.map((item) => ({
                    titulo: item.titulo,
                    descricao: item.resumo,
                    url: `dome://${item.id}`,
                    imagem_url: item.imagemUrl || null,
                    publicado_em: item.publicadoEm,
                    origem: "dome" as const,
                    categoria: item.categoria,
                    conteudo_local: item.conteudo,
                })));
            }
            todas.sort((a, b) => new Date(b.publicado_em).getTime() - new Date(a.publicado_em).getTime());
            setNoticias(todas.slice(0, 4));
            if (!todas.length) throw new Error("Nenhuma novidade disponível.");
        } catch {
            setErro("As notícias não puderam ser carregadas agora.");
        } finally {
            setCarregando(false);
        }
    };

    useEffect(() => {
        void carregarNoticias();
    }, []);

    useEffect(() => {
        if (!noticiaAberta) return;

        const fecharComEscape = (evento: KeyboardEvent) => {
            if (evento.key === "Escape") setNoticiaAberta(null);
        };
        window.addEventListener("keydown", fecharComEscape);
        return () => window.removeEventListener("keydown", fecharComEscape);
    }, [noticiaAberta]);

    const abrirNoticia = async (noticia: NoticiaMinecraft) => {
        setNoticiaAberta(noticia);
        setConteudo(null);
        setErroArtigo(null);
        if (noticia.origem !== "minecraft") {
            setConteudo({
                autor: "Dome Studios",
                blocos: [],
                markdown: noticia.conteudo_local || noticia.descricao,
            });
            setCarregandoArtigo(false);
            return;
        }
        setCarregandoArtigo(true);
        try {
            setConteudo(await invoke<ConteudoNoticiaMinecraft>("get_minecraft_article", { url: noticia.url }));
        } catch {
            setErroArtigo("Não foi possível abrir o conteúdo completo desta notícia.");
        } finally {
            setCarregandoArtigo(false);
        }
    };

    return (
        <>
            <motion.section
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.02 }}
                className="space-y-3 pb-2"
            >
                <div className="flex items-end justify-between gap-4">
                    <div>
                        <h2 className="font-['MinecraftTen','Sora',sans-serif] text-[14px] uppercase tracking-[0.28px] text-white/80">
                            Novidades
                        </h2>
                    </div>
                    <Newspaper size={18} className="text-emerald-300/70" />
                </div>

                {carregando && (
                    <div className="grid min-h-32 place-items-center border border-white/10 bg-white/[0.025]">
                        <Loader2 size={18} className="animate-spin text-emerald-300" />
                    </div>
                )}

                {!carregando && erro && (
                    <button
                        type="button"
                        onClick={() => void carregarNoticias()}
                        className="w-full border border-white/10 bg-white/[0.025] px-4 py-6 text-left text-xs text-white/55 transition-colors hover:border-white/20 hover:text-white/80"
                    >
                        {erro} <span className="ml-1 text-emerald-300">Tentar novamente</span>
                    </button>
                )}

                {!carregando && !erro && (
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-4">
                        {noticias.map((noticia, indice) => (
                            <motion.button
                                key={noticia.url}
                                type="button"
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.04 + indice * 0.035 }}
                                onClick={() => void abrirNoticia(noticia)}
                                className="group relative min-h-36 overflow-hidden border border-white/10 bg-[#171717] text-left transition-colors hover:border-emerald-300/45"
                            >
                                {noticia.imagem_url ? (
                                    <img
                                        src={noticia.imagem_url}
                                        alt=""
                                        className="absolute inset-0 h-full w-full object-cover opacity-45 transition duration-300 group-hover:scale-[1.03] group-hover:opacity-55"
                                    />
                                ) : null}
                                <div className="absolute inset-0 bg-gradient-to-t from-[#0b0b0b] via-[#0b0b0b]/75 to-black/10" />
                                <div className="relative flex min-h-36 flex-col justify-end p-4">
                                    <span className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-white/55">
                                        <Calendar size={10} />
                                        {formatarData(noticia.publicado_em)}
                                        {noticia.origem !== "minecraft" && (
                                            <span className="text-emerald-300">· {noticia.categoria === "atualizacao" ? "Atualização" : "Dome Launcher"}</span>
                                        )}
                                    </span>
                                    <h3 className="line-clamp-2 font-['MinecraftTen','Sora',sans-serif] text-[15px] leading-5 tracking-[0.2px] text-white">
                                        {noticia.titulo}
                                    </h3>
                                    <span className="mt-2 flex items-center gap-1 text-[11px] text-emerald-300/90">
                                        Ler no launcher <ChevronRight size={11} />
                                    </span>
                                </div>
                            </motion.button>
                        ))}
                    </div>
                )}
            </motion.section>

            <AnimatePresence>
                {noticiaAberta && (
                    <motion.div
                        className="fixed inset-0 z-[120] grid place-items-center bg-black/80 p-5 backdrop-blur-sm"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onMouseDown={(evento) => {
                            if (evento.target === evento.currentTarget) setNoticiaAberta(null);
                        }}
                    >
                        <motion.div
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="titulo-noticia-minecraft"
                            initial={{ opacity: 0, y: 20, scale: 0.985 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 12, scale: 0.99 }}
                            className="flex h-[min(780px,90vh)] w-full max-w-4xl flex-col overflow-hidden border border-white/15 bg-[#111] shadow-2xl"
                        >
                            <header className="relative shrink-0 overflow-hidden border-b border-white/10 bg-[#171717]">
                                {noticiaAberta.imagem_url && (
                                    <img
                                        src={noticiaAberta.imagem_url}
                                        alt=""
                                        className="absolute inset-0 h-full w-full object-cover opacity-30"
                                    />
                                )}
                                <div className="absolute inset-0 bg-gradient-to-r from-[#111] via-[#111]/90 to-[#111]/55" />
                                <div className="relative flex items-start gap-5 p-6 pr-16">
                                    <div className="min-w-0 flex-1">
                                        <p className="mb-2 text-[10px] uppercase tracking-[0.18em] text-emerald-300">
                                            {noticiaAberta.origem === "minecraft"
                                                ? "Minecraft News"
                                                : noticiaAberta.categoria === "atualizacao" ? "Atualização do Dome Launcher" : "Dome Launcher"}
                                        </p>
                                        <h2
                                            id="titulo-noticia-minecraft"
                                            className="font-['MinecraftTen','Sora',sans-serif] text-[25px] leading-8 text-white"
                                        >
                                            {noticiaAberta.titulo}
                                        </h2>
                                        <p className="mt-2 text-xs text-white/55">
                                            {conteudo?.autor ? `Por ${conteudo.autor} · ` : ""}
                                            {formatarData(noticiaAberta.publicado_em)}
                                        </p>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    aria-label="Fechar notícia"
                                    onClick={() => setNoticiaAberta(null)}
                                    className="absolute right-5 top-5 grid h-9 w-9 place-items-center border border-white/15 bg-black/35 text-white/70 transition hover:border-white/30 hover:text-white"
                                >
                                    <X size={16} />
                                </button>
                            </header>

                            <AreaRolagemPersonalizada className="flex-1" rotulo="Conteúdo da notícia">
                                <article className="mx-auto max-w-3xl space-y-5 px-7 py-7">
                                    {carregandoArtigo && (
                                        <div className="grid min-h-56 place-items-center">
                                            <div className="flex items-center gap-2 text-sm text-white/55">
                                                <Loader2 size={16} className="animate-spin text-emerald-300" />
                                                Carregando notícia...
                                            </div>
                                        </div>
                                    )}

                                    {erroArtigo && <p className="py-16 text-center text-sm text-red-200/80">{erroArtigo}</p>}

                                    {conteudo?.markdown && (
                                        <div className="space-y-4 text-[14px] leading-7 text-white/75">
                                            <ReactMarkdown
                                                components={{
                                                    h1: ({ children }) => <h3 className="pt-2 font-['MinecraftTen'] text-2xl text-white">{children}</h3>,
                                                    h2: ({ children }) => <h3 className="pt-2 font-['MinecraftTen'] text-xl text-white">{children}</h3>,
                                                    h3: ({ children }) => <h4 className="pt-1 font-['MinecraftTen'] text-lg text-white">{children}</h4>,
                                                    p: ({ children }) => <p>{children}</p>,
                                                    ul: ({ children }) => <ul className="list-disc space-y-2 pl-6">{children}</ul>,
                                                    ol: ({ children }) => <ol className="list-decimal space-y-2 pl-6">{children}</ol>,
                                                    li: ({ children }) => <li className="pl-1">{children}</li>,
                                                    strong: ({ children }) => <strong className="font-bold text-white">{children}</strong>,
                                                    blockquote: ({ children }) => (
                                                        <blockquote className="border-l-2 border-emerald-300/50 pl-4 text-white/60">
                                                            {children}
                                                        </blockquote>
                                                    ),
                                                    code: ({ children }) => (
                                                        <code className="bg-white/8 px-1.5 py-0.5 font-mono text-[13px] text-emerald-200">
                                                            {children}
                                                        </code>
                                                    ),
                                                    a: ({ href, children }) => (
                                                        <a
                                                            href={href}
                                                            target="_blank"
                                                            rel="noreferrer"
                                                            className="text-emerald-300 underline decoration-emerald-300/35 underline-offset-2"
                                                        >
                                                            {children}
                                                        </a>
                                                    ),
                                                }}
                                            >
                                                {conteudo.markdown}
                                            </ReactMarkdown>
                                        </div>
                                    )}

                                    {conteudo?.blocos.map((bloco, indice) => {
                                        if (bloco.tipo === "imagem" && bloco.url) {
                                            return (
                                                <figure key={`${bloco.url}-${indice}`} className="space-y-2 py-2">
                                                    <img
                                                        src={bloco.url}
                                                        alt={bloco.descricao ?? "Imagem da notícia"}
                                                        className="w-full border border-white/10 bg-black/30 object-cover"
                                                    />
                                                    {bloco.descricao && (
                                                        <figcaption className="text-center text-[11px] text-white/40">
                                                            {bloco.descricao}
                                                        </figcaption>
                                                    )}
                                                </figure>
                                            );
                                        }

                                        if (bloco.tipo === "titulo" && bloco.texto) {
                                            return (
                                                <h3
                                                    key={`${bloco.texto}-${indice}`}
                                                    className="pt-3 font-['MinecraftTen','Sora',sans-serif] text-xl leading-7 text-white"
                                                >
                                                    {bloco.texto}
                                                </h3>
                                            );
                                        }

                                        return bloco.texto ? (
                                            <p key={`${bloco.texto}-${indice}`} className="text-[14px] leading-7 text-white/75">
                                                {bloco.texto}
                                            </p>
                                        ) : null;
                                    })}
                                </article>
                            </AreaRolagemPersonalizada>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
}
