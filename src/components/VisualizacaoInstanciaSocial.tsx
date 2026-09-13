import { useEffect, useState } from "react";
import { Check, Download, Loader2, Package } from "../iconesPixelados";
import {
    EVENTO_PROGRESSO_TRANSFERENCIA_SOCIAL,
    EVENTO_INSTALAR_ATIVIDADE_SOCIAL,
    EVENTO_SOLICITAR_TRANSFERENCIA_SOCIAL,
    type EstadoTransferenciaSocial,
    type ProgressoTransferenciaSocial,
} from "../lib/eventosTransferenciaSocial";
import type { AmigoSocial } from "./social/tiposSocial";

interface VisualizacaoInstanciaSocialProps {
    amigo: AmigoSocial;
    onAbrirBiblioteca: () => void;
}

export default function VisualizacaoInstanciaSocial({
    amigo,
    onAbrirBiblioteca,
}: VisualizacaoInstanciaSocialProps) {
    const [estado, setEstado] = useState<EstadoTransferenciaSocial | "ocioso">("ocioso");
    const [mensagem, setMensagem] = useState<string | null>(null);
    const atividade = amigo.atividadeAtual;
    const publicaAmigos = Boolean(atividade?.publicaAmigos && atividade.compartilhamentoId);
    const nome = atividade?.modpackNome || atividade?.instanciaNome || "Instância personalizada";

    const processando = ["solicitando", "aguardando", "preparando", "importando"].includes(estado);

    useEffect(() => {
        const atualizarProgresso = (evento: Event) => {
            const detalhe = (evento as CustomEvent<ProgressoTransferenciaSocial>).detail;
            if (!detalhe || detalhe.friendProfileId !== amigo.friendProfileId) return;

            setEstado(detalhe.estado);
            setMensagem(detalhe.mensagem);
        };

        window.addEventListener(EVENTO_PROGRESSO_TRANSFERENCIA_SOCIAL, atualizarProgresso);
        return () => window.removeEventListener(EVENTO_PROGRESSO_TRANSFERENCIA_SOCIAL, atualizarProgresso);
    }, [amigo.friendProfileId]);

    const solicitarTransferencia = () => {
        if (!atividade || processando) return;

        if (estado === "concluido") {
            onAbrirBiblioteca();
            return;
        }

        window.dispatchEvent(new CustomEvent(
            publicaAmigos ? EVENTO_INSTALAR_ATIVIDADE_SOCIAL : EVENTO_SOLICITAR_TRANSFERENCIA_SOCIAL,
            {
                detail: {
                    friendProfileId: amigo.friendProfileId,
                    atividade,
                },
            }
        ));
    };

    const rotuloBotao = estado === "concluido"
        ? "Ver na biblioteca"
        : estado === "erro"
            ? "Tentar novamente"
            : processando
                ? "Transferindo"
                : publicaAmigos ? "Baixar instância" : "Solicitar transferência";

    return (
        <div className="h-full overflow-y-auto bg-[#0d0d0e] px-6 py-6 scrollbar-hide">
            <div className="mx-auto max-w-5xl">
                <section className="border border-white/10 bg-[#121214]">
                    <div className="flex items-start gap-5 border-b border-white/8 p-5">
                        <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden border border-white/10 bg-black/25">
                            {atividade?.iconeUrl ? (
                                <img src={atividade.iconeUrl} alt={nome} className="h-full w-full object-cover" />
                            ) : (
                                <Package size={28} className="text-white/25" />
                            )}
                        </div>

                        <div className="min-w-0 flex-1">
                            <p className="text-[9px] font-black uppercase tracking-[0.16em] text-emerald-300/70">
                                Instância personalizada
                            </p>
                            <h1 className="mt-1 truncate text-2xl font-black text-white">{nome}</h1>
                            <p className="mt-1 text-sm text-white/55">Criado e compartilhado por {amigo.nome}</p>
                            <div className="mt-4 flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-wide text-white/45">
                                {atividade?.versaoMinecraft && (
                                    <span className="border border-white/10 bg-white/[0.03] px-2 py-1">
                                        Minecraft {atividade.versaoMinecraft}
                                    </span>
                                )}
                                {atividade?.loader && (
                                    <span className="border border-white/10 bg-white/[0.03] px-2 py-1">
                                        {atividade.loader}
                                    </span>
                                )}
                                <span className="border border-white/10 bg-white/[0.03] px-2 py-1">
                                    Social
                                </span>
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={solicitarTransferencia}
                            disabled={!atividade || processando}
                            className="flex min-w-44 shrink-0 items-center justify-center gap-2 border border-emerald-300/30 bg-emerald-500 px-4 py-2 text-xs font-black uppercase tracking-wide text-[#07120a] transition-colors hover:bg-emerald-400 active:translate-y-px disabled:cursor-wait disabled:border-emerald-300/15 disabled:bg-emerald-500/10 disabled:text-emerald-200/65"
                        >
                            {processando ? (
                                <Loader2 size={13} className="animate-spin" />
                            ) : estado === "concluido" ? (
                                <Check size={13} />
                            ) : (
                                <Download size={13} />
                            )}
                            {rotuloBotao}
                        </button>
                    </div>

                    <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_280px]">
                        <div>
                            <h2 className="text-sm font-black uppercase tracking-wide text-white/80">
                                Sobre esta instância
                            </h2>
                            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/50">
                                Esta instância foi personalizada por {amigo.nome}. Você receberá somente as pastas que
                                essa pessoa escolheu publicar.
                            </p>
                        </div>

                        <aside className="border border-white/8 bg-black/15 p-4">
                            <p className="text-[9px] font-black uppercase tracking-[0.14em] text-white/40">
                                Transferência social
                            </p>
                            <p className="mt-2 text-xs leading-5 text-white/55">
                                {publicaAmigos
                                    ? "Você pode baixar diretamente porque é amigo e consegue ver esta atividade."
                                    : "O dono precisa aceitar a solicitação e escolher o conteúdo que será enviado."}
                            </p>
                            {mensagem && (
                                <div
                                    aria-live="polite"
                                    className={`mt-4 flex items-start gap-2 border px-3 py-2.5 text-xs leading-5 ${
                                        estado === "erro"
                                            ? "border-red-400/20 bg-red-500/5 text-red-200/80"
                                            : "border-emerald-300/15 bg-emerald-500/[0.06] text-emerald-100/75"
                                    }`}
                                >
                                    {processando && <Loader2 size={13} className="mt-0.5 shrink-0 animate-spin" />}
                                    {estado === "concluido" && <Check size={13} className="mt-0.5 shrink-0" />}
                                    <span>{mensagem}</span>
                                </div>
                            )}
                        </aside>
                    </div>
                </section>
            </div>
        </div>
    );
}
