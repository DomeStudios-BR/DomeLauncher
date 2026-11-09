import { useEffect, useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { criarCanalProgresso } from "../hooks/useProgressoOperacao";
import { RefreshCw, X } from "../iconesPixelados";
import type { Instance } from "../hooks/useLauncher";
import { addCreatingInstance, completeCreatingInstance, errorCreatingInstance,
    updateCreatingInstance } from "../stores/creatingInstances";

interface ResultadoMigracao {
    modsMigrados: number;
    modsDesativados: string[];
}

interface MigrarVersaoInstanciaModalProps {
    instancia: Instance | null;
    onClose?: () => void;
    onMigrada: () => Promise<void>;
    embutido?: boolean;
}

const LOADERS = ["Vanilla", "Fabric", "Forge", "NeoForge"];
const CLASSE_SELETOR = "mt-2 h-11 w-full min-w-0 border border-white/10 bg-[#0f0f10] px-3 "
    + "text-sm text-white disabled:opacity-50";

export default function MigrarVersaoInstanciaModal({
    instancia, onClose, onMigrada, embutido = false,
}: MigrarVersaoInstanciaModalProps) {
    const [versoes, setVersoes] = useState<string[]>([]);
    const [versao, setVersao] = useState("");
    const [loader, setLoader] = useState("Vanilla");
    const [versoesLoader, setVersoesLoader] = useState<string[]>([]);
    const [versaoLoader, setVersaoLoader] = useState("");
    const [carregandoMinecraft, setCarregandoMinecraft] = useState(false);
    const [carregandoLoader, setCarregandoLoader] = useState(false);
    const [alterando, setAlterando] = useState(false);
    const [erroMinecraft, setErroMinecraft] = useState<string | null>(null);
    const [erroLoader, setErroLoader] = useState<string | null>(null);
    const [erroOperacao, setErroOperacao] = useState<string | null>(null);

    useEffect(() => {
        if (!instancia || embutido) return;
        const fechar = (evento: KeyboardEvent) => {
            if (evento.key !== "Escape") return;
            evento.stopPropagation();
            onClose?.();
        };
        window.addEventListener("keydown", fechar, true);
        return () => window.removeEventListener("keydown", fechar, true);
    }, [Boolean(instancia), embutido, onClose]);

    useEffect(() => {
        if (!instancia) return;
        let cancelado = false;
        const atual = instancia.loader_type || instancia.mc_type || "Vanilla";
        setVersao(instancia.version);
        setLoader(LOADERS.find((item) => item.toLowerCase() === atual.toLowerCase()) || "Vanilla");
        setErroMinecraft(null);
        setErroOperacao(null);
        setVersoes([]);
        setCarregandoMinecraft(true);
        void Promise.all([
            invoke<{ versions: Array<{ id: string; type: string }> }>("get_minecraft_versions"),
            invoke<{ show_snapshots?: boolean } | null>("get_settings")
                .catch(() => ({ show_snapshots: false })),
        ])
            .then(([resposta, configuracoes]) => {
                if (cancelado) return;
                const itens = resposta.versions.filter((item) => item.type === "release"
                    || (configuracoes?.show_snapshots && item.type === "snapshot")).map((item) => item.id);
                setVersoes(itens.includes(instancia.version) ? itens : [instancia.version, ...itens]);
            })
            .catch((falha) => { if (!cancelado) setErroMinecraft(String(falha)); })
            .finally(() => { if (!cancelado) setCarregandoMinecraft(false); });
        return () => { cancelado = true; };
    }, [instancia?.id, instancia?.version, instancia?.loader_type, instancia?.mc_type]);

    useEffect(() => {
        let cancelado = false;
        setErroLoader(null);
        setVersoesLoader([]);
        setVersaoLoader("");
        if (!instancia || loader.toLowerCase() === "vanilla" || !versao) {
            setCarregandoLoader(false);
            return;
        }
        setCarregandoLoader(true);
        void invoke<{ versions: Array<{ version: string; stable?: boolean }> }>("get_loader_versions", {
            loaderType: loader.toLowerCase(), minecraftVersion: versao,
        }).then((resposta) => {
            if (cancelado) return;
            const itens = resposta.versions.map((item) => item.version);
            const atual = instancia.loader_version;
            setVersoesLoader(itens);
            setVersaoLoader(atual && itens.includes(atual) ? atual
                : resposta.versions.find((item) => item.stable !== false)?.version || itens[0] || "");
        }).catch((falha) => { if (!cancelado) setErroLoader(String(falha)); })
            .finally(() => { if (!cancelado) setCarregandoLoader(false); });
        return () => { cancelado = true; };
    }, [instancia?.id, instancia?.loader_version, loader, versao]);

    if (!instancia) return null;

    const vanilla = loader.toLowerCase() === "vanilla";
    const loaderAtual = (instancia.loader_type || instancia.mc_type || "Vanilla").toLowerCase();
    const mudou = versao !== instancia.version || loader.toLowerCase() !== loaderAtual
        || (!vanilla && versaoLoader !== instancia.loader_version);
    const podeMigrar = mudou && !alterando && !carregandoMinecraft && !carregandoLoader
        && !erroMinecraft && !erroLoader && Boolean(versao && (vanilla || versaoLoader));
    const erro = erroOperacao || erroMinecraft || erroLoader;

    const migrar = async (evento: FormEvent) => {
        evento.preventDefault();
        if (!podeMigrar) return;
        setAlterando(true);
        setErroOperacao(null);
        const idTarefa = `migracao-${instancia.id}-${Date.now()}`;
        addCreatingInstance({
            id: idTarefa, name: instancia.name, version: versao, type: loader, status: "installing",
            progress: 0, progressoIndeterminado: false, message: "Migrando versão e conteúdos...",
            icon: instancia.icon || "",
        });
        if (!embutido) onClose?.();
        try {
            const resposta = await invoke<ResultadoMigracao>("migrar_versao_instancia", {
                progresso: criarCanalProgresso((dados) => updateCreatingInstance(idTarefa, {
                    progress: dados.porcentagem, message: dados.etapa, progressoIndeterminado: false,
                })),
                instanceId: instancia.id, version: versao, loaderType: loader.toLowerCase(),
                loaderVersion: vanilla ? null : versaoLoader,
            });
            await onMigrada();
            const desativados = resposta.modsDesativados?.length || 0;
            completeCreatingInstance(idTarefa, `${resposta.modsMigrados} mods atualizados${desativados
                ? `; ${desativados} desativados` : ""}`);
        } catch (falha) {
            const mensagem = falha instanceof Error ? falha.message : String(falha);
            errorCreatingInstance(idTarefa, mensagem);
            setErroOperacao(mensagem);
        } finally {
            setAlterando(false);
        }
    };

    const formulario = <form aria-label="Alterar versão e loader" aria-busy={alterando} onSubmit={migrar}>
        <div className="space-y-4 p-5">
            <div className="grid gap-4 md:grid-cols-3">
                <label className="min-w-0 text-xs font-bold text-white/65">
                    Versão do Minecraft
                    <select aria-label="Versão do Minecraft" className={CLASSE_SELETOR} value={versao}
                        disabled={alterando || carregandoMinecraft} onChange={(evento) => setVersao(evento.target.value)}>
                        {carregandoMinecraft && <option value="">Carregando...</option>}
                        {versoes.map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                </label>
                <label className="min-w-0 text-xs font-bold text-white/65">
                    Loader
                    <select aria-label="Loader" className={CLASSE_SELETOR} value={loader} disabled={alterando}
                        onChange={(evento) => setLoader(evento.target.value)}>
                        {LOADERS.map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                </label>
                <label className="min-w-0 text-xs font-bold text-white/65">
                    Versão do Loader
                    <select aria-label="Versão do Loader" className={CLASSE_SELETOR} value={versaoLoader}
                        disabled={alterando || vanilla || carregandoLoader || !versoesLoader.length}
                        onChange={(evento) => setVersaoLoader(evento.target.value)}>
                        {vanilla ? <option value="">Não se aplica</option>
                            : carregandoLoader ? <option value="">Carregando...</option>
                            : !versoesLoader.length ? <option value="">Nenhuma versão compatível</option> : null}
                        {versoesLoader.map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                </label>
            </div>
            <p className="border border-amber-300/15 bg-amber-300/5 p-3 text-xs leading-relaxed text-amber-100/65">
                Mods priorizam Estável → Beta → Alpha. Sem identificação ou versão compatível, ficam desativados.
            </p>
            {erro && <p role="alert" className="text-xs text-red-200">{erro}</p>}
        </div>
        <footer className="flex justify-end gap-2 border-t border-white/10 px-5 py-4">
            {!embutido && <button type="button" onClick={onClose}
                className="px-4 py-2 text-xs font-bold text-white/50 hover:text-white">Cancelar</button>}
            <button type="submit" disabled={!podeMigrar}
                className="flex items-center gap-2 bg-emerald-400 px-4 py-2 text-xs font-black text-black
                    disabled:opacity-40">
                <RefreshCw size={14} className={alterando ? "animate-spin" : undefined} />
                {alterando ? "Alterando..." : "Alterar"}
            </button>
        </footer>
    </form>;

    if (embutido) return formulario;

    return <div className="fixed inset-0 z-[100] grid place-items-center bg-black/75 p-4" onClick={onClose}>
        <div role="dialog" aria-modal="true" aria-labelledby="titulo-alterar-ambiente"
            className="max-h-[calc(100dvh-2rem)] w-full max-w-3xl overflow-y-auto border border-white/12
                bg-[#151516] shadow-2xl" onClick={(evento) => evento.stopPropagation()}>
            <header className="flex items-center justify-between border-b border-white/10 px-5 py-4">
                <h2 id="titulo-alterar-ambiente" className="text-lg font-black text-white">
                    Trocar versão de {instancia.name}
                </h2>
                <button type="button" aria-label="Fechar alteração" onClick={onClose}
                    className="p-2 text-white/45 hover:text-white"><X size={18} /></button>
            </header>
            {formulario}
        </div>
    </div>;
}
