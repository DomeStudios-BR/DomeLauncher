import { useCallback, useEffect, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
    Globe,
    Loader2,
    Play,
    Plus,
    RefreshCw,
    Trash2,
    Users,
    Wifi,
    WifiOff,
    X,
} from "../../iconesPixelados";
import { cn } from "../../lib/utils";
import { AreaRolagemPersonalizada } from "../../components/scroll/AreaRolagemPersonalizada";

interface ServidoresProps {
    instanceId: string;
}

interface ServidorInfo {
    name: string;
    address: string;
    port: number;
    icon?: string | null;
    motd?: string | null;
    playerCount?: string | null;
    ping?: number | null;
}

interface ConfiguracoesGlobais {
    close_on_launch?: boolean;
}

type EstadoServidor =
    | { tipo: "nao-verificado" }
    | { tipo: "verificando" }
    | { tipo: "online"; dados: ServidorInfo }
    | { tipo: "offline" };

function montarEndereco(servidor: ServidorInfo, incluirPortaPadrao = false): string {
    if (!incluirPortaPadrao && servidor.port === 25565) return servidor.address;
    return `${servidor.address}:${servidor.port}`;
}

function chaveServidor(servidor: ServidorInfo): string {
    return montarEndereco(servidor, true).toLowerCase();
}

function mensagemErro(erro: unknown): string {
    return erro instanceof Error ? erro.message : String(erro);
}

export default function Servidores({ instanceId }: ServidoresProps) {
    const [servidores, setServidores] = useState<ServidorInfo[]>([]);
    const [estados, setEstados] = useState<Record<string, EstadoServidor>>({});
    const [carregando, setCarregando] = useState(true);
    const [recarregando, setRecarregando] = useState(false);
    const [erroPagina, setErroPagina] = useState<string | null>(null);
    const [modalAberto, setModalAberto] = useState(false);
    const [nome, setNome] = useState("");
    const [endereco, setEndereco] = useState("");
    const [erroFormulario, setErroFormulario] = useState<string | null>(null);
    const [salvando, setSalvando] = useState(false);
    const [servidorRemovendo, setServidorRemovendo] = useState<string | null>(null);
    const [servidorIniciando, setServidorIniciando] = useState<string | null>(null);

    const carregarServidores = useCallback(async (exibirCarregamento = false) => {
        if (exibirCarregamento) setCarregando(true);
        setErroPagina(null);

        try {
            const lista = await invoke<ServidorInfo[]>("get_servers", { instanceId });
            setServidores(lista);
            setEstados((anteriores) => Object.fromEntries(
                lista.map((servidor) => [
                    chaveServidor(servidor),
                    anteriores[chaveServidor(servidor)] ?? { tipo: "nao-verificado" },
                ])
            ));
        } catch (erro) {
            setErroPagina(`Não foi possível carregar os servidores: ${mensagemErro(erro)}`);
        } finally {
            setCarregando(false);
            setRecarregando(false);
        }
    }, [instanceId]);

    useEffect(() => {
        void carregarServidores(true);
    }, [carregarServidores]);

    useEffect(() => {
        if (!modalAberto) return;

        const fecharComEscape = (evento: KeyboardEvent) => {
            if (evento.key === "Escape" && !salvando) setModalAberto(false);
        };

        window.addEventListener("keydown", fecharComEscape);
        return () => window.removeEventListener("keydown", fecharComEscape);
    }, [modalAberto, salvando]);

    const abrirModal = () => {
        setNome("");
        setEndereco("");
        setErroFormulario(null);
        setModalAberto(true);
    };

    const recarregarLista = () => {
        if (recarregando) return;
        setRecarregando(true);
        void carregarServidores();
    };

    const adicionarServidor = async (evento: FormEvent<HTMLFormElement>) => {
        evento.preventDefault();
        const nomeLimpo = nome.trim();
        const enderecoLimpo = endereco.trim();

        if (!nomeLimpo || !enderecoLimpo || salvando) return;

        setSalvando(true);
        setErroFormulario(null);
        try {
            await invoke("add_server", {
                instanceId,
                name: nomeLimpo,
                address: enderecoLimpo,
            });
            setModalAberto(false);
            await carregarServidores();
        } catch (erro) {
            setErroFormulario(`Não foi possível adicionar o servidor: ${mensagemErro(erro)}`);
        } finally {
            setSalvando(false);
        }
    };

    const verificarServidor = async (servidor: ServidorInfo) => {
        const chave = chaveServidor(servidor);
        setEstados((anteriores) => ({
            ...anteriores,
            [chave]: { tipo: "verificando" },
        }));

        try {
            const dados = await invoke<ServidorInfo>("ping_server", {
                address: montarEndereco(servidor),
            });
            setEstados((anteriores) => ({
                ...anteriores,
                [chave]: { tipo: "online", dados },
            }));
        } catch {
            setEstados((anteriores) => ({
                ...anteriores,
                [chave]: { tipo: "offline" },
            }));
        }
    };

    const removerServidor = async (servidor: ServidorInfo) => {
        const chave = chaveServidor(servidor);
        if (servidorRemovendo || !confirm(`Remover o servidor "${servidor.name}" desta instância?`)) return;

        setServidorRemovendo(chave);
        setErroPagina(null);
        try {
            await invoke("remove_server", {
                instanceId,
                address: montarEndereco(servidor, true),
            });
            await carregarServidores();
        } catch (erro) {
            setErroPagina(`Não foi possível remover o servidor: ${mensagemErro(erro)}`);
        } finally {
            setServidorRemovendo(null);
        }
    };

    const iniciarServidor = async (servidor: ServidorInfo) => {
        const chave = chaveServidor(servidor);
        if (servidorIniciando) return;

        setServidorIniciando(chave);
        setErroPagina(null);
        try {
            await invoke("launch_instance_to_server", {
                id: instanceId,
                address: montarEndereco(servidor),
            });

            try {
                const configuracoes = await invoke<ConfiguracoesGlobais>("get_settings");
                if (configuracoes?.close_on_launch) await getCurrentWindow().minimize();
            } catch (erroConfiguracoes) {
                console.warn("Falha ao aplicar close_on_launch:", erroConfiguracoes);
            }
        } catch (erro) {
            setErroPagina(`Não foi possível entrar no servidor: ${mensagemErro(erro)}`);
        } finally {
            setServidorIniciando(null);
        }
    };

    return (
        <>
            <div
                className={cn(
                    "flex shrink-0 flex-wrap items-center justify-between gap-3",
                    "border-b border-white/5 px-6 py-4"
                )}
            >
                <div className="flex items-center gap-3 text-sm text-white/45">
                    <span className="font-bold text-white/75">
                        {servidores.length} {servidores.length === 1 ? "servidor" : "servidores"}
                    </span>
                    <span className="hidden h-3 w-px bg-white/10 sm:block" />
                    <span className="hidden text-xs sm:block">Lista multiplayer desta instância</span>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        aria-label="Recarregar lista de servidores"
                        title="Recarregar lista"
                        disabled={recarregando}
                        onClick={recarregarLista}
                        className={cn(
                            "rounded-lg border border-white/10 bg-white/[0.035] p-2.5 text-white/55",
                            "transition-colors hover:bg-white/[0.07] hover:text-white",
                            "disabled:cursor-wait disabled:opacity-45"
                        )}
                    >
                        <RefreshCw size={16} className={cn(recarregando && "animate-spin")} />
                    </button>
                    <button
                        type="button"
                        onClick={abrirModal}
                        className={cn(
                            "flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5",
                            "text-xs font-black text-black transition-colors hover:bg-emerald-400 active:scale-[0.98]"
                        )}
                    >
                        <Plus size={15} />
                        Adicionar servidor
                    </button>
                </div>
            </div>

            {erroPagina && (
                <div
                    role="alert"
                    className="mx-6 mt-4 border border-red-400/20 bg-red-400/5 px-4 py-3 text-xs text-red-200/85"
                >
                    {erroPagina}
                </div>
            )}

            {carregando ? (
                <div className="flex flex-1 items-center justify-center gap-2 text-sm text-white/40">
                    <Loader2 size={18} className="animate-spin text-emerald-300" />
                    Carregando servidores...
                </div>
            ) : servidores.length === 0 ? (
                <div className="flex flex-1 items-center justify-center px-6">
                    <div className="max-w-sm text-center">
                        <div
                            className={cn(
                                "mx-auto mb-5 flex h-16 w-16 items-center justify-center",
                                "border border-emerald-300/15 bg-emerald-400/[0.06] text-emerald-300"
                            )}
                        >
                            <Globe size={30} />
                        </div>
                        <p className="font-bold text-white/75">Nenhum servidor nesta instância</p>
                        <p className="mt-1 text-xs leading-relaxed text-white/35">
                            Os servidores adicionados aqui também aparecem na lista multiplayer do Minecraft.
                        </p>
                        <button
                            type="button"
                            onClick={abrirModal}
                            className={cn(
                                "mt-5 inline-flex items-center gap-2 border border-emerald-300/25",
                                "bg-emerald-400/10 px-4 py-2 text-xs font-bold text-emerald-200",
                                "transition-colors hover:bg-emerald-400/15"
                            )}
                        >
                            <Plus size={14} />
                            Adicionar o primeiro
                        </button>
                    </div>
                </div>
            ) : (
                <AreaRolagemPersonalizada
                    className="flex-1"
                    classNameConteudo="grid grid-cols-1 gap-3 p-6 md:grid-cols-2 xl:grid-cols-3"
                    rotulo="Lista de servidores da instância"
                >
                    {servidores.map((servidor) => {
                        const chave = chaveServidor(servidor);
                        const estado = estados[chave] ?? { tipo: "nao-verificado" };
                        const dadosStatus = estado.tipo === "online" ? estado.dados : null;
                        const icone = dadosStatus?.icon ?? servidor.icon;
                        const removendo = servidorRemovendo === chave;
                        const iniciando = servidorIniciando === chave;

                        return (
                            <article
                                key={chave}
                                className={cn(
                                    "group flex min-h-52 flex-col border border-white/8 bg-white/[0.025] p-4",
                                    "transition-colors hover:border-white/15 hover:bg-white/[0.045]"
                                )}
                            >
                                <div className="flex items-start gap-3">
                                    <div
                                        className={cn(
                                            "flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden",
                                            "border border-white/10 bg-black/30 text-emerald-300"
                                        )}
                                    >
                                        {icone ? (
                                            <img src={icone} alt="" className="h-full w-full object-cover" />
                                        ) : (
                                            <Globe size={23} />
                                        )}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <h3 className="truncate text-sm font-black text-white/90" title={servidor.name}>
                                            {servidor.name}
                                        </h3>
                                        <p
                                            className="mt-1 truncate font-mono text-[10px] text-white/38"
                                            title={montarEndereco(servidor)}
                                        >
                                            {montarEndereco(servidor)}
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        aria-label={`Remover ${servidor.name}`}
                                        title="Remover servidor"
                                        disabled={Boolean(servidorRemovendo)}
                                        onClick={() => void removerServidor(servidor)}
                                        className={cn(
                                            "p-2 text-white/25 opacity-0 transition-all hover:bg-red-400/10",
                                            "hover:text-red-300 group-hover:opacity-100 focus-visible:opacity-100",
                                            "disabled:cursor-wait disabled:opacity-30"
                                        )}
                                    >
                                        {removendo
                                            ? <Loader2 size={14} className="animate-spin" />
                                            : <Trash2 size={14} />}
                                    </button>
                                </div>

                                <div className="mt-4 min-h-10 text-xs leading-relaxed text-white/45">
                                    {dadosStatus?.motd
                                        || "Verifique o servidor para consultar sua mensagem e jogadores."}
                                </div>

                                <div
                                    className={cn(
                                        "mt-auto flex min-h-7 items-center gap-2 border-t border-white/6 pt-3",
                                        "text-[10px] font-bold uppercase tracking-wide"
                                    )}
                                >
                                    {estado.tipo === "verificando" ? (
                                        <span className="flex items-center gap-1.5 text-white/40">
                                            <Loader2 size={12} className="animate-spin" /> Verificando
                                        </span>
                                    ) : estado.tipo === "online" ? (
                                        <>
                                            <span className="flex items-center gap-1.5 text-emerald-300">
                                                <Wifi size={12} /> Online
                                            </span>
                                            {dadosStatus?.playerCount && (
                                                <span className="flex items-center gap-1 text-white/40">
                                                    <Users size={11} /> {dadosStatus.playerCount}
                                                </span>
                                            )}
                                            {dadosStatus?.ping !== null && dadosStatus?.ping !== undefined && (
                                                <span className="ml-auto text-white/30">{dadosStatus.ping} ms</span>
                                            )}
                                        </>
                                    ) : estado.tipo === "offline" ? (
                                        <span className="flex items-center gap-1.5 text-red-300/80">
                                            <WifiOff size={12} /> Offline
                                        </span>
                                    ) : (
                                        <span className="text-white/25">Status não verificado</span>
                                    )}
                                </div>

                                <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                                    <button
                                        type="button"
                                        disabled={Boolean(servidorIniciando)}
                                        onClick={() => void iniciarServidor(servidor)}
                                        className={cn(
                                            "flex items-center justify-center gap-2 bg-emerald-500 px-3 py-2",
                                            "text-xs font-black text-black transition-colors hover:bg-emerald-400",
                                            "disabled:cursor-wait disabled:opacity-50"
                                        )}
                                    >
                                        {iniciando
                                            ? <Loader2 size={14} className="animate-spin" />
                                            : <Play size={14} />}
                                        {iniciando ? "Iniciando..." : "Entrar"}
                                    </button>
                                    <button
                                        type="button"
                                        aria-label={`Verificar ${servidor.name}`}
                                        title="Verificar status"
                                        disabled={estado.tipo === "verificando"}
                                        onClick={() => void verificarServidor(servidor)}
                                        className={cn(
                                            "border border-white/10 bg-white/[0.035] p-2 text-white/45",
                                            "transition-colors hover:bg-white/[0.07] hover:text-white",
                                            "disabled:cursor-wait disabled:opacity-35"
                                        )}
                                    >
                                        <RefreshCw
                                            size={14}
                                            className={cn(estado.tipo === "verificando" && "animate-spin")}
                                        />
                                    </button>
                                </div>
                            </article>
                        );
                    })}
                </AreaRolagemPersonalizada>
            )}

            {modalAberto && (
                <div
                    className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 p-5 backdrop-blur-sm"
                    onMouseDown={() => {
                        if (!salvando) setModalAberto(false);
                    }}
                >
                    <form
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="titulo-adicionar-servidor"
                        onSubmit={adicionarServidor}
                        onMouseDown={(evento) => evento.stopPropagation()}
                        className="w-full max-w-md border border-white/15 bg-[#151516] shadow-2xl"
                    >
                        <div className="flex items-start justify-between gap-4 border-b border-white/8 px-5 py-4">
                            <div>
                                <h3 id="titulo-adicionar-servidor" className="text-base font-black text-white">
                                    Adicionar servidor
                                </h3>
                                <p className="mt-1 text-xs text-white/40">
                                    O servidor será salvo somente nesta instância.
                                </p>
                            </div>
                            <button
                                type="button"
                                aria-label="Fechar"
                                disabled={salvando}
                                onClick={() => setModalAberto(false)}
                                className={cn(
                                    "p-2 text-white/35 transition-colors hover:bg-white/8 hover:text-white",
                                    "disabled:opacity-30"
                                )}
                            >
                                <X size={15} />
                            </button>
                        </div>

                        <div className="space-y-4 px-5 py-5">
                            <label className="block">
                                <span
                                    className={cn(
                                        "mb-1.5 block text-[10px] font-black uppercase",
                                        "tracking-wider text-white/40"
                                    )}
                                >
                                    Nome
                                </span>
                                <input
                                    autoFocus
                                    required
                                    maxLength={80}
                                    value={nome}
                                    onChange={(evento) => setNome(evento.target.value)}
                                    placeholder="Meu servidor"
                                    className={cn(
                                        "w-full border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white",
                                        "outline-none placeholder:text-white/20 focus:border-emerald-400/40"
                                    )}
                                />
                            </label>
                            <label className="block">
                                <span
                                    className={cn(
                                        "mb-1.5 block text-[10px] font-black uppercase",
                                        "tracking-wider text-white/40"
                                    )}
                                >
                                    Endereço
                                </span>
                                <input
                                    required
                                    maxLength={255}
                                    value={endereco}
                                    onChange={(evento) => setEndereco(evento.target.value)}
                                    placeholder="play.exemplo.com ou 127.0.0.1:25565"
                                    spellCheck={false}
                                    className={cn(
                                        "w-full border border-white/10 bg-black/20 px-3 py-2.5 font-mono text-sm",
                                        "text-white outline-none placeholder:text-white/20 focus:border-emerald-400/40"
                                    )}
                                />
                            </label>
                            {erroFormulario && (
                                <p
                                    role="alert"
                                    className="border border-red-400/20 bg-red-400/5 px-3 py-2 text-xs text-red-200/85"
                                >
                                    {erroFormulario}
                                </p>
                            )}
                        </div>

                        <div className="flex justify-end gap-2 border-t border-white/8 px-5 py-4">
                            <button
                                type="button"
                                disabled={salvando}
                                onClick={() => setModalAberto(false)}
                                className={cn(
                                    "border border-white/10 px-4 py-2 text-xs font-bold text-white/55",
                                    "transition-colors hover:bg-white/5 hover:text-white disabled:opacity-30"
                                )}
                            >
                                Cancelar
                            </button>
                            <button
                                type="submit"
                                disabled={!nome.trim() || !endereco.trim() || salvando}
                                className={cn(
                                    "flex min-w-24 items-center justify-center gap-2 bg-emerald-500 px-4 py-2",
                                    "text-xs font-black text-black transition-colors hover:bg-emerald-400",
                                    "disabled:cursor-not-allowed disabled:opacity-40"
                                )}
                            >
                                {salvando && <Loader2 size={13} className="animate-spin" />}
                                {salvando ? "Salvando..." : "Adicionar"}
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </>
    );
}
