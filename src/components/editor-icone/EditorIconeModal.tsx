import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { AlertCircle, Check, RefreshCw, Save, Upload, X } from "../../iconesPixelados";
import {
    CONFIGURACOES_BLOQUEADAS,
    FUNDOS_ICONE,
    SIMBOLOS_ICONE,
    type FundoIcone,
    type SimboloIcone,
} from "./catalogoIcones";

interface EditorIconeModalProps {
    aberto: boolean;
    iconeAtual?: string | null;
    chavePersistencia?: string;
    aoFechar: () => void;
    aoSalvar: (icone: string) => void;
}

interface ConfiguracaoPersistida {
    fundoId: string;
    simboloId: string;
    assinatura: string;
}

const LIMITE_IMAGEM_BYTES = 8 * 1024 * 1024;
const TIPOS_IMAGEM_ACEITOS = new Set(["image/png", "image/jpeg", "image/webp"]);

function assinaturaIcone(icone: string): string {
    let valor = 0;
    for (let indice = 0; indice < icone.length; indice += 1) {
        valor = (valor * 31 + icone.charCodeAt(indice)) | 0;
    }
    return `${icone.length}:${valor}`;
}

function estiloFundo(fundo: FundoIcone) {
    return { backgroundImage: `linear-gradient(180deg, ${fundo.topo}, ${fundo.base})` };
}

function carregarImagem(origem: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const imagem = new Image();
        imagem.onload = () => resolve(imagem);
        imagem.onerror = () => reject(new Error("Não foi possível carregar o símbolo do ícone."));
        imagem.src = origem;
    });
}

async function comporIcone(fundo: FundoIcone, simbolo: SimboloIcone): Promise<string> {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const contexto = canvas.getContext("2d");
    if (!contexto) throw new Error("Não foi possível criar o ícone.");

    const gradiente = contexto.createLinearGradient(0, 0, 0, canvas.height);
    gradiente.addColorStop(0, fundo.topo);
    gradiente.addColorStop(1, fundo.base);
    contexto.fillStyle = gradiente;
    contexto.fillRect(0, 0, canvas.width, canvas.height);
    contexto.imageSmoothingEnabled = true;
    contexto.imageSmoothingQuality = "high";
    contexto.drawImage(await carregarImagem(simbolo.arquivo), 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
}

async function prepararImagem(arquivo: File): Promise<string> {
    if (!TIPOS_IMAGEM_ACEITOS.has(arquivo.type)) {
        throw new Error("Selecione uma imagem PNG, JPG ou WebP.");
    }
    if (arquivo.size > LIMITE_IMAGEM_BYTES) {
        throw new Error("A imagem deve ter no máximo 8 MB.");
    }

    const bitmap = await createImageBitmap(arquivo);
    try {
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 256;
        const contexto = canvas.getContext("2d");
        if (!contexto) throw new Error("Não foi possível preparar a imagem.");

        const escala = Math.max(256 / bitmap.width, 256 / bitmap.height);
        const largura = bitmap.width * escala;
        const altura = bitmap.height * escala;
        contexto.imageSmoothingEnabled = true;
        contexto.imageSmoothingQuality = "high";
        contexto.drawImage(bitmap, (256 - largura) / 2, (256 - altura) / 2, largura, altura);
        return canvas.toDataURL("image/png");
    } finally {
        bitmap.close();
    }
}

export async function gerarIconeAleatorio(): Promise<string> {
    const combinacoes = FUNDOS_ICONE.flatMap((fundo) => SIMBOLOS_ICONE
        .filter((simbolo) => !simbolo.excluirDaAleatorizacao)
        .filter((simbolo) => !CONFIGURACOES_BLOQUEADAS.has(`${fundo.id}:${simbolo.id}`))
        .map((simbolo) => ({ fundo, simbolo })));
    const escolha = combinacoes[Math.floor(Math.random() * combinacoes.length)];
    return comporIcone(escolha.fundo, escolha.simbolo);
}

export default function EditorIconeModal({
    aberto,
    iconeAtual,
    chavePersistencia,
    aoFechar,
    aoSalvar,
}: EditorIconeModalProps) {
    const [fundoId, setFundoId] = useState("roxo");
    const [simboloId, setSimboloId] = useState("grass-block");
    const [imagemPersonalizada, setImagemPersonalizada] = useState<string | null>(null);
    const [modo, setModo] = useState<"gerado" | "imagem">("gerado");
    const [salvando, setSalvando] = useState(false);
    const fundosRef = useRef<HTMLDivElement>(null);
    const arquivoRef = useRef<HTMLInputElement>(null);
    const fundo = FUNDOS_ICONE.find((item) => item.id === fundoId) ?? FUNDOS_ICONE[0];
    const simbolo = SIMBOLOS_ICONE.find((item) => item.id === simboloId) ?? SIMBOLOS_ICONE[0];
    const combinacoes = useMemo(() => FUNDOS_ICONE.flatMap((opcaoFundo) => SIMBOLOS_ICONE
        .filter((opcaoSimbolo) => !opcaoSimbolo.excluirDaAleatorizacao)
        .filter((opcaoSimbolo) => !CONFIGURACOES_BLOQUEADAS.has(`${opcaoFundo.id}:${opcaoSimbolo.id}`))
        .map((opcaoSimbolo) => ({ fundo: opcaoFundo.id, simbolo: opcaoSimbolo.id }))), []);

    useEffect(() => {
        if (!aberto) return;

        const chave = chavePersistencia ? `dome:editor-icone:${chavePersistencia}` : null;
        const configuracao = chave ? localStorage.getItem(chave) : null;
        let configuracaoAplicada = false;
        if (configuracao) {
            try {
                const salva = JSON.parse(configuracao) as ConfiguracaoPersistida;
                if (iconeAtual
                    && salva.assinatura === assinaturaIcone(iconeAtual)
                    && FUNDOS_ICONE.some((item) => item.id === salva.fundoId)
                    && SIMBOLOS_ICONE.some((item) => item.id === salva.simboloId)) {
                    setFundoId(salva.fundoId);
                    setSimboloId(salva.simboloId);
                    setModo("gerado");
                    setImagemPersonalizada(null);
                    configuracaoAplicada = true;
                }
            } catch {
                if (chave) localStorage.removeItem(chave);
            }
        }
        if (!configuracaoAplicada && iconeAtual) {
            setImagemPersonalizada(iconeAtual);
            setModo("imagem");
        }

        const aoPressionar = (evento: KeyboardEvent) => {
            if (evento.key === "Escape" && !salvando) aoFechar();
        };
        window.addEventListener("keydown", aoPressionar);
        return () => window.removeEventListener("keydown", aoPressionar);
    }, [aberto, aoFechar, chavePersistencia, iconeAtual, salvando]);

    if (!aberto) return null;

    const aleatorizar = () => {
        const candidatas = combinacoes.filter((item) => item.fundo !== fundoId || item.simbolo !== simboloId);
        const escolha = candidatas[Math.floor(Math.random() * candidatas.length)];
        if (!escolha) return;
        setFundoId(escolha.fundo);
        setSimboloId(escolha.simbolo);
        setModo("gerado");
    };

    const selecionarImagem = async (evento: React.ChangeEvent<HTMLInputElement>) => {
        const arquivo = evento.target.files?.[0];
        evento.target.value = "";
        if (!arquivo) return;

        try {
            setImagemPersonalizada(await prepararImagem(arquivo));
            setModo("imagem");
        } catch (erro) {
            alert(erro instanceof Error ? erro.message : "Não foi possível preparar a imagem.");
        }
    };

    const salvar = async () => {
        setSalvando(true);
        try {
            const icone = modo === "imagem" && imagemPersonalizada
                ? imagemPersonalizada
                : await comporIcone(fundo, simbolo);
            if (chavePersistencia) {
                const chave = `dome:editor-icone:${chavePersistencia}`;
                if (modo === "gerado") {
                    localStorage.setItem(chave, JSON.stringify({
                        fundoId,
                        simboloId,
                        assinatura: assinaturaIcone(icone),
                    }));
                } else {
                    localStorage.removeItem(chave);
                }
            }
            aoSalvar(icone);
            aoFechar();
        } catch (erro) {
            alert(erro instanceof Error ? erro.message : "Não foi possível criar o ícone.");
        } finally {
            setSalvando(false);
        }
    };

    const Previa = ({ tamanho, arredondamento }: { tamanho: number; arredondamento: string }) => (
        <div
            className={`shrink-0 overflow-hidden border border-white/15 bg-[#111] ${arredondamento}`}
            style={{ ...(modo === "gerado" ? estiloFundo(fundo) : {}), width: tamanho, height: tamanho }}
        >
            <img
                src={modo === "imagem" && imagemPersonalizada ? imagemPersonalizada : simbolo.arquivo}
                alt=""
                className="h-full w-full object-cover"
            />
        </div>
    );

    return (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
            <motion.button
                type="button"
                aria-label="Fechar editor de ícone"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                onClick={salvando ? undefined : aoFechar}
                className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div
                role="dialog"
                aria-modal="true"
                aria-labelledby="titulo-editor-icone"
                initial={{ opacity: 0, scale: 0.96, y: 14 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                className="relative flex h-[min(760px,calc(100vh-2rem))] w-full max-w-[1040px] flex-col overflow-hidden border border-white/12 bg-[#151515] shadow-2xl"
            >
                <header className="flex h-16 shrink-0 items-center justify-between border-b border-white/10 px-5">
                    <h2 id="titulo-editor-icone" className="text-lg font-bold text-white">Editor de ícone</h2>
                    <button type="button" onClick={aoFechar} disabled={salvando} aria-label="Fechar"
                        className="grid h-9 w-9 place-items-center border border-white/10 bg-white/5 text-white/55 transition-colors hover:bg-white/10 hover:text-white">
                        <X size={18} />
                    </button>
                </header>

                <div className="flex min-h-0 flex-1 max-md:flex-col">
                    <aside className="flex w-[230px] shrink-0 flex-col gap-3 border-r border-white/10 bg-[#121212] p-5 max-md:w-full max-md:border-b max-md:border-r-0">
                        <div className="flex flex-col items-center gap-3 border border-white/10 bg-[#181818] p-4">
                            <Previa tamanho={132} arredondamento="rounded-lg" />
                            <div className="flex items-center gap-2.5">
                                <Previa tamanho={40} arredondamento="rounded" />
                                <Previa tamanho={30} arredondamento="rounded" />
                                <Previa tamanho={20} arredondamento="rounded-sm" />
                            </div>
                        </div>
                        <button type="button" onClick={aleatorizar}
                            className="flex h-10 w-full items-center justify-center gap-2 border border-white/10 bg-white/8 text-sm font-semibold text-white transition-colors hover:bg-white/12">
                            <RefreshCw size={17} /> Aleatorizar
                        </button>
                        <input ref={arquivoRef} type="file" accept=".png,.jpg,.jpeg,.webp"
                            onChange={(evento) => void selecionarImagem(evento)} className="hidden" />
                        <button type="button" onClick={() => arquivoRef.current?.click()}
                            className="flex h-10 w-full items-center justify-center gap-2 border border-white/10 bg-white/5 text-sm font-semibold text-white/75 transition-colors hover:bg-white/10 hover:text-white">
                            <Upload size={17} /> Usar imagem
                        </button>
                    </aside>

                    <div className="scrollbar-custom min-h-0 min-w-0 flex-1 overflow-y-auto bg-[#101010]">
                        <section className="border-b border-white/10 p-4">
                            <h3 className="mb-3 text-base font-bold text-white">Fundo</h3>
                            <div ref={fundosRef} onWheel={(evento) => {
                                if (!fundosRef.current) return;
                                fundosRef.current.scrollLeft += evento.deltaY;
                            }} className="scrollbar-custom flex gap-2.5 overflow-x-auto pb-2">
                                {FUNDOS_ICONE.map((opcao) => (
                                    <button key={opcao.id} type="button" title={opcao.nome}
                                        aria-pressed={modo === "gerado" && fundoId === opcao.id}
                                        onClick={() => { setFundoId(opcao.id); setModo("gerado"); }}
                                        className={`relative aspect-square w-[86px] shrink-0 rounded-lg border transition-all ${modo === "gerado" && fundoId === opcao.id ? "border-emerald-400 ring-1 ring-emerald-400/30" : "border-white/10 hover:border-white/30"}`}
                                        style={estiloFundo(opcao)}>
                                        {modo === "gerado" && fundoId === opcao.id && <span className="absolute right-2 top-2 grid h-5 w-5 place-items-center bg-emerald-400 text-black"><Check size={13} /></span>}
                                    </button>
                                ))}
                            </div>
                        </section>
                        <section className="p-4">
                            <h3 className="mb-3 text-base font-bold text-white">Símbolo</h3>
                            <div className="grid grid-cols-6 gap-2.5 max-lg:grid-cols-5 max-md:grid-cols-4">
                                {SIMBOLOS_ICONE.map((opcao) => (
                                    <button key={opcao.id} type="button" title={opcao.nome} aria-label={opcao.nome}
                                        aria-pressed={modo === "gerado" && simboloId === opcao.id} onClick={() => { setSimboloId(opcao.id); setModo("gerado"); }}
                                        className={`relative aspect-square overflow-hidden rounded-lg border bg-[#151515] transition-all ${modo === "gerado" && simboloId === opcao.id ? "border-emerald-400 ring-1 ring-emerald-400/30" : "border-white/10 hover:border-white/30"}`}>
                                        <img src={opcao.arquivo} alt="" className="h-full w-full object-cover" />
                                        {modo === "gerado" && simboloId === opcao.id && <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center bg-emerald-400 text-black"><Check size={13} /></span>}
                                    </button>
                                ))}
                            </div>
                        </section>
                    </div>
                </div>

                <footer className="flex min-h-[62px] shrink-0 items-center justify-between gap-4 border-t border-white/10 bg-[#181818] px-5 py-3 max-md:flex-col max-md:items-stretch">
                    <div className="flex min-w-0 items-center gap-2 text-sm text-white/60">
                        <AlertCircle size={20} className="shrink-0 text-blue-400" />
                        Combine elementos para criar um ícone personalizado.
                    </div>
                    <div className="flex shrink-0 justify-end gap-2">
                        <button type="button" onClick={aoFechar} disabled={salvando}
                            className="flex h-9 items-center gap-2 border border-white/10 bg-white/5 px-4 text-sm font-semibold text-white transition-colors hover:bg-white/10">
                            <X size={16} /> Cancelar
                        </button>
                        <button type="button" onClick={() => void salvar()} disabled={salvando}
                            className="flex h-9 items-center gap-2 bg-emerald-400 px-4 text-sm font-semibold text-black transition-colors hover:bg-emerald-300 disabled:opacity-60">
                            <Save size={17} /> {salvando ? "Salvando..." : "Salvar ícone"}
                        </button>
                    </div>
                </footer>
            </motion.div>
        </div>
    );
}
