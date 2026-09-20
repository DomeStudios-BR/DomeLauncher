import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Download, LogIn, Plus, ShieldCheck } from '../iconesPixelados';
import {
    concluirOnboarding,
    EVENTO_REEXIBIR_ONBOARDING,
    onboardingConcluido,
    onboardingForcado,
} from '../lib/onboarding';

interface OnboardingLauncherProps {
    usuario: { name: string; uuid: string } | null;
    onEntrar: () => Promise<void>;
    onCriarInstancia: () => void;
    onImportar: () => void;
    carregando: boolean;
    temDadosExistentes: boolean;
}

export function OnboardingLauncher({
    usuario,
    onEntrar,
    onCriarInstancia,
    onImportar,
    carregando,
    temDadosExistentes,
}: OnboardingLauncherProps) {
    const [aberto, setAberto] = useState(() => !onboardingConcluido());
    const [entrando, setEntrando] = useState(false);
    const [erroLogin, setErroLogin] = useState<string | null>(null);

    useEffect(() => {
        const reexibir = () => setAberto(true);
        window.addEventListener(EVENTO_REEXIBIR_ONBOARDING, reexibir);
        return () => window.removeEventListener(EVENTO_REEXIBIR_ONBOARDING, reexibir);
    }, []);

    useEffect(() => {
        if (carregando || onboardingConcluido() || onboardingForcado() || !temDadosExistentes) return;
        concluirOnboarding();
        setAberto(false);
    }, [carregando, temDadosExistentes]);

    const concluir = (acao?: () => void) => {
        concluirOnboarding();
        setAberto(false);
        acao?.();
    };

    const entrarComMicrosoft = async () => {
        setEntrando(true);
        setErroLogin(null);
        try {
            await onEntrar();
        } catch (erro) {
            setErroLogin(erro instanceof Error ? erro.message : String(erro));
        } finally {
            setEntrando(false);
        }
    };

    return (
        <AnimatePresence>
            {aberto && !carregando && (
                <motion.section
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="fixed inset-0 z-40 flex items-center justify-center bg-[#090909] p-6"
                >
                    <div className="pointer-events-none absolute inset-0 opacity-25 [background-image:radial-gradient(circle,#fff_1px,transparent_1px)] [background-size:18px_18px] [mask-image:radial-gradient(circle_at_center,black,transparent_72%)]" />
                    <motion.div
                        initial={{ opacity: 0, y: 18 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="relative w-full max-w-2xl border border-white/10 bg-[#111] p-8 shadow-2xl"
                    >
                        <div className="mx-auto flex max-w-lg flex-col items-center text-center">
                            <img src="/dome-launcher.ico" alt="" className="mb-5 h-20 w-20 object-contain" />
                            <p className="mb-2 text-[10px] font-black uppercase tracking-[0.28em] text-emerald-300">
                                Dome Launcher
                            </p>
                            <h1 className="font-['MinecraftTen','Sora',sans-serif] text-3xl text-white">
                                {usuario ? `Tudo pronto, ${usuario.name}` : 'Seu Minecraft começa aqui'}
                            </h1>
                            <p className="mt-3 max-w-md text-sm leading-6 text-white/50">
                                {usuario
                                    ? 'Sua conta Microsoft já criou seu perfil Dome e ativou os recursos sociais.'
                                    : 'Uma única entrada conecta o Minecraft, cria seu perfil Dome e libera a experiência social.'}
                            </p>

                            {!usuario ? (
                                <div className="mt-8 w-full space-y-3">
                                    <button
                                        type="button"
                                        onClick={() => void entrarComMicrosoft()}
                                        disabled={entrando}
                                        className="flex w-full items-center justify-center gap-3 bg-emerald-400 px-5 py-4 text-sm font-black uppercase tracking-wide text-[#07120a] hover:bg-emerald-300 disabled:cursor-wait disabled:bg-emerald-400/60"
                                    >
                                        <LogIn size={17} />
                                        {entrando ? 'Autenticando...' : 'Entrar com Microsoft'}
                                    </button>
                                    {erroLogin && <p className="text-xs text-red-300">{erroLogin}</p>}
                                    <button
                                        type="button"
                                        onClick={() => concluir()}
                                        className="w-full border border-white/10 bg-white/[0.025] px-5 py-3 text-xs font-bold text-white/55 hover:text-white"
                                    >
                                        Explorar antes de entrar
                                    </button>
                                </div>
                            ) : (
                                <div className="mt-8 grid w-full gap-3 sm:grid-cols-2">
                                    <button
                                        type="button"
                                        onClick={() => concluir(onCriarInstancia)}
                                        className="flex items-center justify-center gap-2 bg-emerald-400 px-4 py-4 text-xs font-black uppercase text-[#07120a] hover:bg-emerald-300"
                                    >
                                        <Plus size={15} /> Criar primeira instância
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => concluir(onImportar)}
                                        className="flex items-center justify-center gap-2 border border-white/15 bg-white/[0.04] px-4 py-4 text-xs font-black uppercase text-white/80 hover:border-white/30"
                                    >
                                        <Download size={15} /> Importar existente
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => concluir()}
                                        className="sm:col-span-2 flex items-center justify-center gap-2 px-4 py-2 text-xs text-white/40 hover:text-white/70"
                                    >
                                        <Check size={13} /> Ir para o launcher
                                    </button>
                                </div>
                            )}

                            <div className="mt-7 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-white/25">
                                <ShieldCheck size={12} /> Credenciais protegidas neste dispositivo
                            </div>
                        </div>
                    </motion.div>
                </motion.section>
            )}
        </AnimatePresence>
    );
}
