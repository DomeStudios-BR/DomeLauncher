import { lazy, Suspense, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Loader2 } from "../iconesPixelados";
import { DataLancamento } from "./DataLancamento";
import type { FonteProjetoConteudo } from "./ProjetoDetalheModal";

const DescricaoProjetoMarkdown = lazy(() => import("./modpacks/DescricaoProjetoMarkdown").then((modulo) => ({
    default: modulo.DescricaoProjetoMarkdown,
})));

export interface VersaoChangelog {
    id: string;
    version_number: string;
    game_versions: string[];
    loaders: string[];
    date_published?: string | null;
    files: Array<{ filename: string }>;
    changelog?: string | null;
}

interface ChangelogVersaoProps {
    fonte: FonteProjetoConteudo;
    projetoId: string;
    versao: VersaoChangelog;
}

export function ChangelogVersao({ fonte, projetoId, versao }: ChangelogVersaoProps) {
    const [conteudo, setConteudo] = useState("");
    const [carregando, setCarregando] = useState(true);
    const [erro, setErro] = useState<string | null>(null);
    const [tentativa, setTentativa] = useState(0);

    useEffect(() => {
        let cancelado = false;
        const controlador = new AbortController();
        setCarregando(true);
        setErro(null);
        setConteudo("");

        async function carregar() {
            try {
                let changelog = versao.changelog ?? "";
                if (fonte === "curseforge") {
                    changelog = await invoke<string>("obter_changelog_versao_curseforge", {
                        projectId: projetoId,
                        fileId: versao.id,
                    });
                } else if (fonte === "modrinth" && versao.changelog == null) {
                    const resposta = await fetch(
                        `https://api.modrinth.com/v2/version/${encodeURIComponent(versao.id)}`,
                        { signal: controlador.signal }
                    );
                    if (!resposta.ok) throw new Error(`Modrinth respondeu com status ${resposta.status}.`);
                    const dados: { changelog?: string | null } = await resposta.json();
                    changelog = dados.changelog ?? "";
                }
                if (!cancelado) setConteudo(changelog);
            } catch {
                if (!cancelado) setErro("Não foi possível carregar o changelog desta versão.");
            } finally {
                if (!cancelado) setCarregando(false);
            }
        }

        void carregar();
        return () => {
            cancelado = true;
            controlador.abort();
        };
    }, [fonte, projetoId, versao.id, versao.changelog, tentativa]);

    return (
        <section aria-label={`Changelog da versão ${versao.version_number}`} className="min-w-0 space-y-4">
            <header className="space-y-2">
                <h2 className="break-words text-lg font-black text-white">{versao.version_number}</h2>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/50">
                    <DataLancamento data={versao.date_published} className="flex items-center gap-1" />
                    {versao.game_versions.length > 0 && <span>Minecraft {versao.game_versions.join(", ")}</span>}
                    {versao.loaders.length > 0 && <span>{versao.loaders.join(", ")}</span>}
                </div>
                {versao.files.map((arquivo) => (
                    <p key={arquivo.filename} className="break-all text-xs text-white/40">{arquivo.filename}</p>
                ))}
            </header>
            {carregando ? (
                <p role="status" className="flex items-center gap-2 text-sm text-white/50">
                    <Loader2 size={14} className="animate-spin" /> Carregando changelog...
                </p>
            ) : erro ? (
                <div role="alert" className="space-y-2 text-sm text-red-200">
                    <p>{erro}</p>
                    <button type="button" onClick={() => setTentativa((atual) => atual + 1)}
                        className="rounded border border-white/15 px-3 py-1.5 text-white/80 hover:bg-white/10">
                        Tentar novamente
                    </button>
                </div>
            ) : conteudo.trim() ? (
                <article className="min-w-0 break-words rounded-xl border border-white/10 bg-black/20 p-4">
                    <Suspense fallback={<p role="status" className="text-sm text-white/50">Carregando changelog...</p>}>
                        <DescricaoProjetoMarkdown conteudo={conteudo} formatoEditor={fonte === "dome"} />
                    </Suspense>
                </article>
            ) : (
                <p className="text-sm text-white/55">O autor não publicou um changelog para esta versão.</p>
            )}
        </section>
    );
}
