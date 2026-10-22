import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, ChevronDown, ChevronUp, HardDrive, Monitor, Terminal } from "../../iconesPixelados";
import { cn } from "../../lib/utils";
import OpcoesJogo from "./OpcoesJogo";
import SecaoConfiguracao from "./SecaoConfiguracao";

interface ConfiguracaoProps {
    instanceId: string;
    memoriaPersonalizada?: number | null;
    argumentosJvm?: string | null;
    largura?: number;
    altura?: number;
    onSalvar: () => Promise<void> | void;
}

interface ConfiguracoesGlobais {
    ram_mb: number;
    java_args: string;
}

const MEMORIA_MINIMA_MB = 512;
const MEMORIA_MAXIMA_MB = 32768;
const ATRASO_SALVAMENTO_MS = 180;

const PRESETS_JVM = [
    {
        nome: "Padrão",
        descricao: "Configuração balanceada",
        argumentos: "-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200",
    },
    {
        nome: "Performance",
        descricao: "Otimizado para FPS alto",
        argumentos: "-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 "
            + "-XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:G1NewSizePercent=30 "
            + "-XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M -XX:G1ReservePercent=20 "
            + "-XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4",
    },
    {
        nome: "Mínimo",
        descricao: "Sem argumentos extras",
        argumentos: "",
    },
] as const;

function limitarMemoria(memoria: number, memoriaSistema: number): number {
    const limite = Math.max(MEMORIA_MINIMA_MB, Math.min(memoriaSistema, MEMORIA_MAXIMA_MB));
    return Math.min(Math.max(memoria, MEMORIA_MINIMA_MB), limite);
}

function assinaturaMemoria(usarPersonalizada: boolean, memoriaMb: number): string {
    return usarPersonalizada ? `personalizada:${memoriaMb}` : "global";
}

function assinaturaResolucao(largura: number, altura: number): string {
    return `${largura}x${altura}`;
}

export default function Configuracao({
    instanceId,
    memoriaPersonalizada,
    argumentosJvm,
    largura = 854,
    altura = 480,
    onSalvar,
}: ConfiguracaoProps) {
    const [usarMemoriaPersonalizada, setUsarMemoriaPersonalizada] = useState(
        memoriaPersonalizada != null,
    );
    const [memoriaMb, setMemoriaMb] = useState(memoriaPersonalizada ?? 4096);
    const [memoriaGlobalMb, setMemoriaGlobalMb] = useState(4096);
    const [memoriaSistemaMb, setMemoriaSistemaMb] = useState(16384);
    const [argumentosJvmEditaveis, setArgumentosJvmEditaveis] = useState(argumentosJvm ?? "");
    const [argumentosJvmAlterados, setArgumentosJvmAlterados] = useState(false);
    const [jvmAberto, setJvmAberto] = useState(false);
    const [larguraEditavel, setLarguraEditavel] = useState(String(largura));
    const [alturaEditavel, setAlturaEditavel] = useState(String(altura));
    const [configuracaoCarregada, setConfiguracaoCarregada] = useState(false);
    const [erro, setErro] = useState<string | null>(null);
    const ultimaMemoriaSalvaRef = useRef(
        assinaturaMemoria(memoriaPersonalizada != null, memoriaPersonalizada ?? 4096),
    );
    const ultimosArgumentosSalvosRef = useRef(argumentosJvm);
    const ultimaResolucaoSalvaRef = useRef(assinaturaResolucao(largura, altura));

    useEffect(() => {
        const usarPersonalizada = memoriaPersonalizada != null;
        setUsarMemoriaPersonalizada(usarPersonalizada);
        if (memoriaPersonalizada != null) setMemoriaMb(memoriaPersonalizada);
        ultimaMemoriaSalvaRef.current = assinaturaMemoria(
            usarPersonalizada,
            memoriaPersonalizada ?? memoriaMb,
        );
        setArgumentosJvmAlterados(false);
        ultimosArgumentosSalvosRef.current = argumentosJvm;
        if (argumentosJvm != null) setArgumentosJvmEditaveis(argumentosJvm);
        setLarguraEditavel(String(largura));
        setAlturaEditavel(String(altura));
        ultimaResolucaoSalvaRef.current = assinaturaResolucao(largura, altura);
    }, [instanceId, memoriaPersonalizada, argumentosJvm, largura, altura]);

    useEffect(() => {
        const carregarConfiguracaoGlobal = async () => {
            setConfiguracaoCarregada(false);
            try {
                const [configuracoes, memoriaSistema] = await Promise.all([
                    invoke<ConfiguracoesGlobais>("get_settings"),
                    invoke<number>("get_system_ram"),
                ]);
                setMemoriaGlobalMb(configuracoes.ram_mb);
                setMemoriaSistemaMb(memoriaSistema);
                if (memoriaPersonalizada == null) {
                    setMemoriaMb(limitarMemoria(configuracoes.ram_mb, memoriaSistema));
                }
                if (argumentosJvm == null) setArgumentosJvmEditaveis(configuracoes.java_args);
            } catch (falha) {
                console.error("Erro ao carregar configuração de desempenho da instância:", falha);
            } finally {
                setConfiguracaoCarregada(true);
            }
        };

        void carregarConfiguracaoGlobal();
    }, [instanceId]);

    useEffect(() => {
        if (!configuracaoCarregada) return;

        const assinatura = assinaturaMemoria(usarMemoriaPersonalizada, memoriaMb);
        if (assinatura === ultimaMemoriaSalvaRef.current) return;

        const temporizador = window.setTimeout(async () => {
            try {
                await invoke("update_instance_settings", {
                    instanceId,
                    memory: usarMemoriaPersonalizada ? memoriaMb : undefined,
                    usarMemoriaPersonalizada,
                });
                ultimaMemoriaSalvaRef.current = assinatura;
                setErro(null);
                await onSalvar();
            } catch (falha) {
                setErro(String(falha));
            }
        }, ATRASO_SALVAMENTO_MS);

        return () => window.clearTimeout(temporizador);
    }, [configuracaoCarregada, instanceId, memoriaMb, onSalvar, usarMemoriaPersonalizada]);

    useEffect(() => {
        if (!configuracaoCarregada || !argumentosJvmAlterados) return;
        if (argumentosJvmEditaveis === ultimosArgumentosSalvosRef.current) return;

        const temporizador = window.setTimeout(async () => {
            try {
                await invoke("update_instance_settings", {
                    instanceId,
                    javaArgs: argumentosJvmEditaveis,
                    usarArgumentosJvmPersonalizados: true,
                });
                ultimosArgumentosSalvosRef.current = argumentosJvmEditaveis;
                setArgumentosJvmAlterados(false);
                setErro(null);
                await onSalvar();
            } catch (falha) {
                setErro(String(falha));
            }
        }, ATRASO_SALVAMENTO_MS);

        return () => window.clearTimeout(temporizador);
    }, [argumentosJvmAlterados, argumentosJvmEditaveis, configuracaoCarregada, instanceId, onSalvar]);

    useEffect(() => {
        if (!configuracaoCarregada) return;

        const novaLargura = Number.parseInt(larguraEditavel, 10);
        const novaAltura = Number.parseInt(alturaEditavel, 10);
        if (!Number.isFinite(novaLargura) || !Number.isFinite(novaAltura)) return;
        if (novaLargura < 320 || novaLargura > 7680 || novaAltura < 240 || novaAltura > 4320) return;

        const assinatura = assinaturaResolucao(novaLargura, novaAltura);
        if (assinatura === ultimaResolucaoSalvaRef.current) return;

        const temporizador = window.setTimeout(async () => {
            try {
                await invoke("update_instance_settings", {
                    instanceId,
                    width: novaLargura,
                    height: novaAltura,
                });
                ultimaResolucaoSalvaRef.current = assinatura;
                setErro(null);
                await onSalvar();
            } catch (falha) {
                setErro(String(falha));
            }
        }, ATRASO_SALVAMENTO_MS);

        return () => window.clearTimeout(temporizador);
    }, [alturaEditavel, configuracaoCarregada, instanceId, larguraEditavel, onSalvar]);

    const limiteMemoriaMb = useMemo(
        () => Math.max(MEMORIA_MINIMA_MB, Math.min(memoriaSistemaMb, MEMORIA_MAXIMA_MB)),
        [memoriaSistemaMb],
    );
    const memoriaEfetivaMb = usarMemoriaPersonalizada ? memoriaMb : memoriaGlobalMb;
    const proporcaoMemoria = Math.min(100, (memoriaEfetivaMb / memoriaSistemaMb) * 100);

    const atualizarArgumentosJvm = (valor: string) => {
        setArgumentosJvmEditaveis(valor);
        setArgumentosJvmAlterados(true);
    };

    return (
        <div className="flex-1 space-y-5 overflow-y-auto p-6">
            <SecaoConfiguracao titulo="Desempenho" icone={<HardDrive size={15} />}>
                <div className="space-y-4 px-5 py-5">
                    <label className="flex w-fit cursor-pointer items-center gap-2.5">
                        <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-white/45">
                            Alocação própria
                        </span>
                        <input
                            type="checkbox"
                            className="sr-only"
                            checked={usarMemoriaPersonalizada}
                            onChange={(evento) => setUsarMemoriaPersonalizada(evento.target.checked)}
                        />
                        <span
                            className={cn(
                                "relative h-6 w-11 border transition-colors",
                                usarMemoriaPersonalizada
                                    ? "border-emerald-400/55 bg-emerald-400/25"
                                    : "border-white/15 bg-white/[0.04]",
                            )}
                        >
                            <span
                                className={cn(
                                    "absolute left-1 top-1 h-3.5 w-3.5 bg-white transition-transform",
                                    usarMemoriaPersonalizada ? "translate-x-5" : "translate-x-0",
                                )}
                            />
                        </span>
                    </label>
                    <div className="flex flex-wrap items-end justify-between gap-3">
                        <div>
                            <p className="flex items-center gap-2 text-sm font-bold text-white/85">
                                <HardDrive size={12} /> Memória RAM do modpack
                            </p>
                            <p className="mt-2 text-[11px] leading-relaxed text-white/35">
                                {usarMemoriaPersonalizada
                                    ? "Este modpack utiliza uma alocação exclusiva."
                                    : "Usando a memória RAM padrão definida nas configurações do Launcher."}
                            </p>
                        </div>
                        <p className="text-lg font-black tabular-nums text-emerald-300">
                            {(memoriaEfetivaMb / 1024).toFixed(1)} GB
                            <span className="ml-1 text-[10px] text-white/35">
                                / {(memoriaSistemaMb / 1024).toFixed(0)} GB
                            </span>
                        </p>
                    </div>

                    <div className={cn("space-y-3", !usarMemoriaPersonalizada && "opacity-55")}>
                        <div className="relative">
                            <div className="h-2 overflow-hidden bg-white/[0.06]">
                                <motion.div
                                    className={cn("h-full", proporcaoMemoria > 75 ? "bg-amber-400" : "bg-emerald-400")}
                                    animate={{ width: `${proporcaoMemoria}%` }}
                                />
                            </div>
                            <input
                                type="range"
                                min={MEMORIA_MINIMA_MB}
                                max={limiteMemoriaMb}
                                step={512}
                                value={limitarMemoria(memoriaMb, memoriaSistemaMb)}
                                disabled={!usarMemoriaPersonalizada}
                                onChange={(evento) => setMemoriaMb(Number.parseInt(evento.target.value, 10))}
                                className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                            />
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold text-white/35">
                            <span>512 MB</span>
                            <div className="flex gap-2">
                                {[2, 4, 8, 16].map((gb) =>
                                    gb * 1024 <= limiteMemoriaMb ? (
                                        <button
                                            key={gb}
                                            type="button"
                                            disabled={!usarMemoriaPersonalizada}
                                            onClick={() => setMemoriaMb(gb * 1024)}
                                            className={cn(
                                                "px-1.5 py-0.5 transition-colors",
                                                memoriaMb === gb * 1024 ? "text-emerald-300" : "hover:text-white/70",
                                            )}
                                        >
                                            {gb} GB
                                        </button>
                                    ) : null,
                                )}
                            </div>
                            <span>{(limiteMemoriaMb / 1024).toFixed(0)} GB</span>
                        </div>
                    </div>

                    {proporcaoMemoria > 75 && (
                        <p className="flex items-center gap-2 text-[10px] text-amber-300/70">
                            <AlertCircle size={12} /> Mais de 75% da RAM pode deixar o sistema instável.
                        </p>
                    )}

                    <div className="space-y-3 border-t border-white/8 pt-4">
                        <div>
                            <p className="flex items-center gap-2 text-sm font-bold text-white/85">
                                <Monitor size={13} /> Resolução da janela
                            </p>
                            <p className="mt-1 text-[11px] text-white/35">
                                Tamanho usado ao iniciar esta instância em modo janela.
                            </p>
                        </div>

                        <div className="flex max-w-md items-center gap-2">
                            <label className="min-w-0 flex-1">
                                <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.1em] text-white/35">
                                    Largura
                                </span>
                                <input
                                    type="number"
                                    min={320}
                                    max={7680}
                                    value={larguraEditavel}
                                    onChange={(evento) => setLarguraEditavel(evento.target.value)}
                                    className="w-full border border-white/10 bg-white/[0.025] px-3 py-2 text-sm font-bold tabular-nums text-white/80 outline-none transition-colors focus:border-emerald-400/35"
                                />
                            </label>
                            <span className="mt-5 text-sm font-bold text-white/25">×</span>
                            <label className="min-w-0 flex-1">
                                <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.1em] text-white/35">
                                    Altura
                                </span>
                                <input
                                    type="number"
                                    min={240}
                                    max={4320}
                                    value={alturaEditavel}
                                    onChange={(evento) => setAlturaEditavel(evento.target.value)}
                                    className="w-full border border-white/10 bg-white/[0.025] px-3 py-2 text-sm font-bold tabular-nums text-white/80 outline-none transition-colors focus:border-emerald-400/35"
                                />
                            </label>
                        </div>
                    </div>

                    <div className="space-y-3 border-t border-white/8 pt-4">
                        <button
                            type="button"
                            onClick={() => setJvmAberto((aberto) => !aberto)}
                            className="flex w-full items-center justify-between text-sm font-medium text-white/60 transition-colors hover:text-white/85"
                        >
                            <span className="flex items-center gap-2">
                                <Terminal size={13} /> Argumentos JVM
                            </span>
                            {jvmAberto ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                        </button>

                        <AnimatePresence initial={false}>
                            {jvmAberto && (
                                <motion.div
                                    initial={{ height: 0, opacity: 0 }}
                                    animate={{ height: "auto", opacity: 1 }}
                                    exit={{ height: 0, opacity: 0 }}
                                    className="space-y-3 overflow-hidden"
                                >
                                    <div className="grid grid-cols-3 gap-2">
                                        {PRESETS_JVM.map((preset) => (
                                            <button
                                                key={preset.nome}
                                                type="button"
                                                onClick={() => atualizarArgumentosJvm(preset.argumentos)}
                                                className={cn(
                                                    "border px-3 py-2 text-xs font-medium transition-colors",
                                                    argumentosJvmEditaveis === preset.argumentos
                                                        ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
                                                        : "border-white/8 bg-white/[0.025] text-white/45 hover:border-white/15 hover:text-white/65",
                                                )}
                                            >
                                                <span className="block font-bold">{preset.nome}</span>
                                                <span className="mt-0.5 block text-[9px] opacity-60">
                                                    {preset.descricao}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                    <textarea
                                        value={argumentosJvmEditaveis}
                                        onChange={(evento) => atualizarArgumentosJvm(evento.target.value)}
                                        placeholder="-XX:+UseG1GC ..."
                                        rows={4}
                                        className="w-full resize-none border border-white/8 bg-white/[0.025] p-3 font-mono text-xs leading-relaxed text-white/70 outline-none focus:border-emerald-400/30"
                                    />
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    {erro && <p className="text-[10px] text-red-300/75">{erro}</p>}
                </div>
            </SecaoConfiguracao>
            <OpcoesJogo key={instanceId} instanceId={instanceId} />
        </div>
    );
}
