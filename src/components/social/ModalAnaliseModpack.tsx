import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, Loader2, Star, X } from "../../iconesPixelados";
import { cn } from "../../lib/utils";
import { CONFIGURACAO_SOCIAL } from "../../lib/configuracaoSocial";
import type { AnaliseModpack, SessaoSocial } from "./tiposSocial";

export interface ModpackParaAnalise {
  projectId: string;
  source: "modrinth" | "curseforge";
  name: string;
  author: string;
  icon?: string | null;
  slug: string;
  versionId: string;
  installedVersion: string;
}

interface ModalAnaliseModpackProps {
  modpack: ModpackParaAnalise;
  instanciaId: string;
  instanciaNome: string;
  horasJogados: number;
  analiseExistente?: AnaliseModpack | null;
  onFechar: () => void;
  onPublicada: (analise: AnaliseModpack) => void;
}

const LIMITE_CONTEUDO = 2000;

async function obterTokenSocial(): Promise<string | null> {
  try {
    const conteudo = await invoke<string | null>("carregar_sessao_social_local");
    if (!conteudo) return null;
    const sessao = JSON.parse(conteudo) as SessaoSocial;
    return sessao.accessToken || null;
  } catch {
    return null;
  }
}

/**
 * Modal de publicação de análise de modpack. Só é aberto para instâncias
 * com origem Modrinth/CurseForge — instâncias personalizadas nunca chegam aqui.
 */
export default function ModalAnaliseModpack({
  modpack,
  instanciaId,
  instanciaNome,
  horasJogados,
  analiseExistente,
  onFechar,
  onPublicada,
}: ModalAnaliseModpackProps) {
  const [recomendado, setRecomendado] = useState(analiseExistente?.recomendado ?? true);
  const [conteudo, setConteudo] = useState(analiseExistente?.conteudo ?? "");
  const [publicando, setPublicando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [semSessao, setSemSessao] = useState(false);

  useEffect(() => {
    const fecharComEscape = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") onFechar();
    };
    window.addEventListener("keydown", fecharComEscape);
    return () => window.removeEventListener("keydown", fecharComEscape);
  }, [onFechar]);

  const publicar = async () => {
    if (publicando) return;
    const texto = conteudo.trim();
    if (!texto) {
      setErro("Escreva sua análise antes de publicar.");
      return;
    }
    setErro(null);
    setPublicando(true);
    try {
      const token = await obterTokenSocial();
      if (!token) {
        setSemSessao(true);
        setPublicando(false);
        return;
      }
      const analise = await invoke<AnaliseModpack>("publicar_analise_modpack", {
        apiBaseUrl: CONFIGURACAO_SOCIAL.apiBaseUrl,
        accessToken: token,
        dados: {
          source: modpack.source,
          projectId: modpack.projectId,
          projectNome: modpack.name,
          projectIcon: modpack.icon || null,
          projectAuthor: modpack.author || null,
          slug: modpack.slug || null,
          versionId: modpack.versionId || null,
          installedVersion: modpack.installedVersion || null,
          instanciaId,
          instanciaNome,
          horasRegistradas: Math.round(horasJogados * 10) / 10,
          recomendado,
          conteudo: texto.slice(0, LIMITE_CONTEUDO),
        },
      });
      onPublicada(analise);
      onFechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e) || "Falha ao publicar análise.");
      setPublicando(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs"
      onClick={onFechar}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-white/15 bg-[#141416]"
        onClick={(evento) => evento.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            {modpack.icon ? (
              <img
                src={modpack.icon}
                alt=""
                className="h-11 w-11 shrink-0 rounded-xl border border-white/15 bg-black/30 object-cover"
              />
            ) : (
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-white/15 bg-black/30 text-amber-300">
                <Star size={18} />
              </span>
            )}
            <div className="min-w-0">
              <h3 className="truncate text-sm font-black uppercase tracking-wide">
                {analiseExistente ? "Editar análise" : "Escrever análise"}
              </h3>
              <p className="truncate text-xs text-white/50">
                {modpack.name} · {modpack.source} · {instanciaNome}
              </p>
            </div>
          </div>
          <button
            onClick={onFechar}
            className="rounded-lg p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Fechar"
          >
            <X size={14} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setRecomendado(true)}
              className={cn(
                "flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-black uppercase tracking-wide transition-all",
                recomendado
                  ? "border-emerald-400/60 bg-emerald-500/15 text-emerald-300"
                  : "border-white/10 bg-white/5 text-white/45 hover:text-white/70"
              )}
            >
              <Check size={13} />
              Recomendo
            </button>
            <button
              type="button"
              onClick={() => setRecomendado(false)}
              className={cn(
                "flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-black uppercase tracking-wide transition-all",
                !recomendado
                  ? "border-red-400/60 bg-red-500/15 text-red-300"
                  : "border-white/10 bg-white/5 text-white/45 hover:text-white/70"
              )}
            >
              <X size={13} />
              Não recomendo
            </button>
          </div>

          <div>
            <textarea
              value={conteudo}
              onChange={(evento) => setConteudo(evento.target.value.slice(0, LIMITE_CONTEUDO))}
              placeholder="O que você achou do modpack? Progressão, desempenho, diversão..."
              rows={5}
              className="w-full resize-vertical rounded-xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-white outline-none transition-colors placeholder:text-white/30 focus:border-emerald-400/45"
            />
            <p className="mt-1 text-right text-[11px] text-white/35">
              {conteudo.length}/{LIMITE_CONTEUDO}
            </p>
          </div>

          <p className="text-[11px] text-white/40">
            {horasJogados > 0
              ? `Será publicada com ${horasJogados.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h registradas nesta instância.`
              : "O tempo jogado nesta instância será anexado quando houver."}{" "}
            Uma análise por modpack — publicar de novo atualiza a anterior.
          </p>

          {semSessao && (
            <p className="rounded-xl border border-amber-400/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
              Conecte o Discord na aba social do launcher para publicar análises.
            </p>
          )}
          {erro && <p className="text-xs text-red-300">{erro}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-white/10 px-5 py-3">
          <button
            onClick={onFechar}
            className="rounded-xl px-4 py-2 text-xs font-bold text-white/60 transition-colors hover:bg-white/5 hover:text-white"
          >
            Cancelar
          </button>
          <button
            onClick={() => void publicar()}
            disabled={publicando || !conteudo.trim()}
            className="inline-flex items-center gap-2 rounded-xl border border-emerald-300 bg-emerald-500 px-4 py-2 text-xs font-black uppercase tracking-wide text-black transition-colors hover:bg-emerald-400 disabled:opacity-40"
          >
            {publicando && <Loader2 size={13} className="animate-spin" />}
            {publicando ? "Publicando..." : analiseExistente ? "Atualizar" : "Publicar"}
          </button>
        </div>
      </div>
    </div>
  );
}
