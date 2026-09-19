import { useState, useEffect, useRef, useCallback } from "react";
import {
  Search,
  Download,
  Star,
  Heart,
  Package,
  Image,
  Sparkles,
  Filter,
  X,
  ChevronDown,
} from "../iconesPixelados";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "../lib/utils";
import { EsqueletoExplore } from "./EsqueletoCarregamento";
import { addFavorite, removeFavorite, isFavorite, type FavoriteItem } from "./Favorites";
import type { ProjetoConteudo, TipoProjetoConteudo } from "./ProjetoDetalheModal";
import { invoke } from "@tauri-apps/api/core";
import { obterImagemProjeto } from "../lib/imagemProjeto";

type ContentType = "modpack" | "mod" | "resourcepack" | "shader";
type Source = "modrinth" | "curseforge";
type LoaderFiltro = "" | "fabric" | "forge" | "neoforge" | "quilt";
type OrdenacaoBusca = "relevancia" | "popularidade" | "downloads" | "atualizados" | "recentes";

interface FiltrosBusca {
  versaoMinecraft: string;
  loader: LoaderFiltro;
  ordenacao: OrdenacaoBusca;
}

interface ManifestoVersoesMinecraft {
  versions: Array<{ id: string; type: string }>;
}

interface SearchResult {
  chave: string;
  id: string;
  title: string;
  description: string;
  icon_url?: string;
  author: string;
  downloads?: number;
  follows?: number;
  project_type: TipoProjetoConteudo;
  slug: string;
  source: Source;
  fontes: Source[];
  variantes: Partial<Record<Source, VarianteResultadoBusca>>;
}

interface VarianteResultadoBusca {
  id: string;
  title: string;
  description: string;
  icon_url?: string;
  author: string;
  downloads?: number;
  follows?: number;
  project_type: TipoProjetoConteudo;
  slug: string;
  source: Source;
}

interface ResultadoBuscaApi {
  id?: string | number;
  name?: string;
  title?: string;
  description?: string;
  iconUrl?: string;
  icon_url?: string;
  author?: string;
  downloadCount?: number;
  download_count?: number;
  follows?: number;
  projectType?: TipoProjetoConteudo;
  project_type?: TipoProjetoConteudo;
  slug?: string;
  platform?: Source;
}

const CONTENT_TYPES = [
  { id: "modpack" as ContentType, label: "Modpacks", icon: Package },
  { id: "mod" as ContentType, label: "Mods", icon: Package },
  { id: "resourcepack" as ContentType, label: "Textures", icon: Image },
  { id: "shader" as ContentType, label: "Shaders", icon: Sparkles },
];

const LIMITE_RESULTADOS_POR_PAGINA = 20;
const LIMITE_VERSOES_FILTRO = 80;
const FONTE_PRIORITARIA: Source = "modrinth";
const FONTES: Source[] = ["modrinth", "curseforge"];
const LOADERS: Array<{ id: Exclude<LoaderFiltro, "">; nome: string }> = [
  { id: "fabric", nome: "Fabric" },
  { id: "forge", nome: "Forge" },
  { id: "neoforge", nome: "NeoForge" },
  { id: "quilt", nome: "Quilt" },
];
const ORDENACOES: Array<{ id: OrdenacaoBusca; nome: string }> = [
  { id: "relevancia", nome: "Relevância" },
  { id: "popularidade", nome: "Popularidade" },
  { id: "downloads", nome: "Mais baixados" },
  { id: "atualizados", nome: "Atualizados recentemente" },
  { id: "recentes", nome: "Mais novos" },
];

const normalizarIdentificador = (valor: string) =>
  valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const obterChavesCorrespondencia = (item: VarianteResultadoBusca) => {
  const chaves = [`id:${item.source}:${item.id}`];
  const slug = normalizarIdentificador(item.slug);
  const titulo = normalizarIdentificador(item.title);

  if (slug) chaves.push(`slug:${slug}`);
  if (titulo) chaves.push(`titulo:${titulo}`);
  return chaves;
};

const mapearResultadoBusca = (
  item: ResultadoBuscaApi,
  tipoPadrao: ContentType
): VarianteResultadoBusca => {
  const id = String(item.id || "");
  return {
    id,
    title: String(item.name || item.title || "Sem nome"),
    description: String(item.description || ""),
    icon_url: item.iconUrl || item.icon_url || undefined,
    author: String(item.author || "Desconhecido"),
    downloads:
      typeof item.downloadCount === "number"
        ? item.downloadCount
        : typeof item.download_count === "number"
          ? item.download_count
          : undefined,
    follows: typeof item.follows === "number" ? item.follows : undefined,
    project_type: (item.projectType || item.project_type || tipoPadrao) as TipoProjetoConteudo,
    slug: String(item.slug || "").trim() || id.trim(),
    source: item.platform === "curseforge" ? "curseforge" : "modrinth",
  };
};

const criarResultadoMesclado = (
  variantes: Partial<Record<Source, VarianteResultadoBusca>>
): SearchResult => {
  const principal = variantes[FONTE_PRIORITARIA] || variantes.curseforge;
  if (!principal) throw new Error("Resultado sem plataforma de origem.");

  const fontes = FONTES.filter((fonte) => variantes[fonte]);
  const chave = obterChavesCorrespondencia(principal).find((valor) => !valor.startsWith("id:"))
    || `id:${principal.source}:${principal.id}`;

  return {
    ...principal,
    chave,
    fontes,
    variantes,
  };
};

const mesclarResultados = (
  itens: VarianteResultadoBusca[],
  ordenacao: OrdenacaoBusca
): SearchResult[] => {
  const grupos: Array<Partial<Record<Source, VarianteResultadoBusca>>> = [];
  const indicePorChave = new Map<string, number>();

  itens.forEach((item) => {
    const chaves = obterChavesCorrespondencia(item);
    const indice = chaves.map((chave) => indicePorChave.get(chave)).find((valor) => valor !== undefined);

    if (indice === undefined) {
      const novoIndice = grupos.length;
      grupos.push({ [item.source]: item });
      chaves.forEach((chave) => indicePorChave.set(chave, novoIndice));
      return;
    }

    grupos[indice][item.source] = item;
    chaves.forEach((chave) => indicePorChave.set(chave, indice));
  });

  const resultados = grupos.map(criarResultadoMesclado);
  if (ordenacao === "downloads") {
    resultados.sort((a, b) => {
      const downloadsA = Math.max(...a.fontes.map((fonte) => a.variantes[fonte]?.downloads || 0));
      const downloadsB = Math.max(...b.fontes.map((fonte) => b.variantes[fonte]?.downloads || 0));
      return downloadsB - downloadsA;
    });
  }
  return resultados;
};

interface ExploreProps {
  onAtualizarPresencaExplore?: (contexto: {
    tipo: ContentType;
    fonte: Source | "ambas";
    titulo?: string;
  }) => void;
  onAbrirProjeto: (projeto: ProjetoConteudo) => void;
}

export default function Explore({
  onAtualizarPresencaExplore,
  onAbrirProjeto,
}: ExploreProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [temMaisResultados, setTemMaisResultados] = useState(true);
  const [falhaCarregamentoMais, setFalhaCarregamentoMais] = useState(false);
  const [contentType, setContentType] = useState<ContentType>("modpack");
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [filtrosAbertos, setFiltrosAbertos] = useState(false);
  const [versoesMinecraft, setVersoesMinecraft] = useState<string[]>([]);
  const [versaoMinecraft, setVersaoMinecraft] = useState("");
  const [pesquisaVersao, setPesquisaVersao] = useState("");
  const [seletorVersaoAberto, setSeletorVersaoAberto] = useState(false);
  const [loader, setLoader] = useState<LoaderFiltro>("");
  const [ordenacao, setOrdenacao] = useState<OrdenacaoBusca>("relevancia");
  const [fonte, setFonte] = useState<Source | "ambas">("ambas");

  const hasLoaded = useRef(false);
  const lastSearch = useRef({ query: "", contentType: "", filtros: "" });
  const fimListaRef = useRef<HTMLDivElement | null>(null);
  const seletorVersaoRef = useRef<HTMLDivElement | null>(null);
  const proximosOffsetsRef = useRef<Record<Source, number>>({ modrinth: 0, curseforge: 0 });
  const temMaisPorFonteRef = useRef<Record<Source, boolean>>({ modrinth: true, curseforge: true });
  const carregandoMaisRef = useRef(false);
  const geracaoBuscaRef = useRef(0);

  useEffect(() => {
    const favIds = new Set<string>();
    results.forEach((resultado) => {
      if (resultado.fontes.some((fonte) => isFavorite(resultado.variantes[fonte]?.id || ""))) {
        favIds.add(resultado.id);
      }
    });
    setFavorites(favIds);
  }, [results]);

  useEffect(() => {
    let cancelado = false;
    void invoke<ManifestoVersoesMinecraft>("get_minecraft_versions")
      .then((manifesto) => {
        if (cancelado) return;
        const versoes = manifesto.versions
          .filter((versao) => versao.type === "release")
          .slice(0, LIMITE_VERSOES_FILTRO)
          .map((versao) => versao.id);
        setVersoesMinecraft(versoes);
      })
      .catch((erro) => console.error("Erro ao carregar versões para os filtros:", erro));

    return () => {
      cancelado = true;
    };
  }, []);

  useEffect(() => {
    if (!seletorVersaoAberto) return;

    const fecharAoClicarFora = (evento: MouseEvent) => {
      if (!seletorVersaoRef.current?.contains(evento.target as Node)) {
        setSeletorVersaoAberto(false);
        setPesquisaVersao("");
      }
    };

    document.addEventListener("mousedown", fecharAoClicarFora);
    return () => document.removeEventListener("mousedown", fecharAoClicarFora);
  }, [seletorVersaoAberto]);

  useEffect(() => {
    const aceitaLoader = contentType === "mod" || contentType === "modpack";
    if (!aceitaLoader || !versaoMinecraft) setLoader("");
  }, [contentType, versaoMinecraft]);

  const buscarEmFontes = useCallback(async (
    q: string,
    type: ContentType,
    fontes: Source[],
    filtros: FiltrosBusca
  ) => {
    const respostas = await Promise.allSettled(
      fontes.map(async (fonte) => {
        const resultados = await invoke<ResultadoBuscaApi[]>("search_mods_online", {
          query: q,
          platform: fonte,
          contentType: type,
          filtros: {
            gameVersion: filtros.versaoMinecraft || null,
            loader: filtros.loader || null,
            sort: filtros.ordenacao,
            offset: proximosOffsetsRef.current[fonte],
            limit: LIMITE_RESULTADOS_POR_PAGINA,
          },
        });
        return { fonte, resultados };
      })
    );
    const sucessos = respostas
      .filter((resposta): resposta is PromiseFulfilledResult<{
        fonte: Source;
        resultados: ResultadoBuscaApi[];
      }> => resposta.status === "fulfilled")
      .map((resposta) => resposta.value);

    if (sucessos.length === 0) {
      const motivos = respostas
        .filter((resposta): resposta is PromiseRejectedResult => resposta.status === "rejected")
        .map((resposta) => String(resposta.reason));
      throw new Error(motivos.join(" | ") || "Não foi possível consultar os catálogos.");
    }

    const maiorPagina = Math.max(...sucessos.map(({ resultados }) => resultados.length));
    const resultadosIntercalados = Array.from({ length: maiorPagina }).flatMap((_, indice) =>
      sucessos.flatMap(({ resultados }) => resultados[indice] ? [resultados[indice]] : [])
    );

    return {
      resultados: resultadosIntercalados.map((item) => mapearResultadoBusca(item, type)),
      paginas: sucessos,
      fontesComFalha: respostas.flatMap((resposta, indice) =>
        resposta.status === "rejected" ? [fontes[indice]] : []
      ),
    };
  }, []);

  const atualizarPaginacao = useCallback((resposta: Awaited<ReturnType<typeof buscarEmFontes>>) => {
    resposta.fontesComFalha.forEach((fonte) => {
      temMaisPorFonteRef.current[fonte] = false;
    });
    resposta.paginas.forEach(({ fonte, resultados }) => {
      proximosOffsetsRef.current[fonte] += resultados.length;
      temMaisPorFonteRef.current[fonte] = resultados.length === LIMITE_RESULTADOS_POR_PAGINA;
    });
  }, [buscarEmFontes]);

  const searchContent = useCallback(async (q: string, type: ContentType, filtros: FiltrosBusca) => {
    const chaveFiltros = JSON.stringify({ ...filtros, fonte });
    if (
      lastSearch.current.query === q &&
      lastSearch.current.contentType === type &&
      lastSearch.current.filtros === chaveFiltros
    ) {
      return;
    }
    lastSearch.current = { query: q, contentType: type, filtros: chaveFiltros };
    const geracao = geracaoBuscaRef.current + 1;
    geracaoBuscaRef.current = geracao;
    proximosOffsetsRef.current = { modrinth: 0, curseforge: 0 };
    temMaisPorFonteRef.current = {
      modrinth: fonte === "ambas" || fonte === "modrinth",
      curseforge: fonte === "ambas" || fonte === "curseforge",
    };
    carregandoMaisRef.current = false;

    setLoading(true);
    setCarregandoMais(false);
    setTemMaisResultados(true);
    setFalhaCarregamentoMais(false);
    try {
      const fontesSelecionadas = fonte === "ambas" ? FONTES : [fonte];
      const resposta = await buscarEmFontes(q, type, fontesSelecionadas, filtros);

      if (geracaoBuscaRef.current !== geracao) return;
      atualizarPaginacao(resposta);
      setResults(mesclarResultados(resposta.resultados, filtros.ordenacao));
      setTemMaisResultados(Object.values(temMaisPorFonteRef.current).some(Boolean));
    } catch (error) {
      console.error("Erro ao buscar:", error);
      if (geracaoBuscaRef.current === geracao) {
        setResults([]);
        setTemMaisResultados(false);
      }
    } finally {
      if (geracaoBuscaRef.current === geracao) setLoading(false);
    }
  }, [atualizarPaginacao, buscarEmFontes, fonte]);

  const carregarMaisResultados = useCallback(async () => {
    if (loading || !temMaisResultados || carregandoMaisRef.current) return;

    const geracao = geracaoBuscaRef.current;
    carregandoMaisRef.current = true;
    setCarregandoMais(true);
    setFalhaCarregamentoMais(false);

    try {
      const fontesPermitidas = fonte === "ambas" ? FONTES : [fonte];
      const fontesComMaisResultados = fontesPermitidas.filter((item) => temMaisPorFonteRef.current[item]);
      const filtros = { versaoMinecraft, loader, ordenacao };
      const resposta = await buscarEmFontes(query, contentType, fontesComMaisResultados, filtros);

      if (geracaoBuscaRef.current !== geracao) return;
      atualizarPaginacao(resposta);
      setResults((anteriores) => {
        const variantesAnteriores = anteriores.flatMap((item) =>
          item.fontes.flatMap((fonte) => item.variantes[fonte] ? [item.variantes[fonte]] : [])
        ) as VarianteResultadoBusca[];
        return mesclarResultados(
          [...variantesAnteriores, ...resposta.resultados],
          ordenacao
        );
      });
      setTemMaisResultados(Object.values(temMaisPorFonteRef.current).some(Boolean));
    } catch (error) {
      console.error("Erro ao carregar mais conteúdos:", error);
      if (geracaoBuscaRef.current === geracao) setFalhaCarregamentoMais(true);
    } finally {
      if (geracaoBuscaRef.current === geracao) setCarregandoMais(false);
      carregandoMaisRef.current = false;
    }
  }, [
    atualizarPaginacao,
    buscarEmFontes,
    contentType,
    fonte,
    loader,
    loading,
    ordenacao,
    query,
    temMaisResultados,
    versaoMinecraft,
  ]);

  useEffect(() => {
    if (!hasLoaded.current) {
      hasLoaded.current = true;
      void searchContent("", contentType, { versaoMinecraft, loader, ordenacao });
    }
  }, [contentType, fonte, loader, ordenacao, searchContent, versaoMinecraft]);

  useEffect(() => {
    if (hasLoaded.current) {
      void searchContent(query, contentType, { versaoMinecraft, loader, ordenacao });
    }
  }, [contentType, loader, ordenacao, searchContent, versaoMinecraft]);

  useEffect(() => {
    if (!hasLoaded.current) return;
    const timer = setTimeout(() => {
      void searchContent(query, contentType, { versaoMinecraft, loader, ordenacao });
    }, 400);
    return () => clearTimeout(timer);
  }, [contentType, fonte, loader, ordenacao, query, searchContent, versaoMinecraft]);

  useEffect(() => {
    const fimLista = fimListaRef.current;
    if (!fimLista || loading || carregandoMais || falhaCarregamentoMais || !temMaisResultados) return;

    const observador = new IntersectionObserver(
      ([entrada]) => {
        if (entrada.isIntersecting) void carregarMaisResultados();
      },
      { rootMargin: "600px 0px" }
    );

    observador.observe(fimLista);
    return () => observador.disconnect();
  }, [
    carregandoMais,
    carregarMaisResultados,
    falhaCarregamentoMais,
    loading,
    results.length,
    temMaisResultados,
  ]);

  useEffect(() => {
    onAtualizarPresencaExplore?.({
      tipo: contentType,
      fonte,
    });
  }, [contentType, fonte, onAtualizarPresencaExplore]);

  const toggleFavorite = (item: SearchResult) => {
    const variante = item.variantes[FONTE_PRIORITARIA] || item.variantes.curseforge || item;
    if (favorites.has(item.id)) {
      item.fontes.forEach((fonte) => {
        const id = item.variantes[fonte]?.id;
        if (id) removeFavorite(id);
      });
      setFavorites((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    } else {
      const favItem: FavoriteItem = {
        id: variante.id,
        title: variante.title,
        description: variante.description,
        icon_url: variante.icon_url || "",
        author: variante.author,
        type: contentType,
        source: variante.source,
        slug: variante.slug,
        downloads: variante.downloads,
      };
      addFavorite(favItem);
      setFavorites((prev) => new Set(prev).add(item.id));
    }
  };

  const abrirDetalheProjeto = (item: SearchResult) => {
    const variante = item.variantes[FONTE_PRIORITARIA] || item.variantes.curseforge || item;
    onAbrirProjeto({
      ...variante,
      icon_url: variante.icon_url || "",
    });
  };

  const quantidadeFiltrosAtivos = Number(Boolean(versaoMinecraft))
    + Number(Boolean(loader))
    + Number(ordenacao !== "relevancia")
    + Number(fonte !== "ambas");

  const limparFiltros = () => {
    setVersaoMinecraft("");
    setLoader("");
    setOrdenacao("relevancia");
    setFonte("ambas");
  };

  const versoesMinecraftFiltradas = versoesMinecraft.filter((versao) =>
    versao.toLowerCase().includes(pesquisaVersao.trim().toLowerCase())
  );

  const selecionarVersaoMinecraft = (versao: string) => {
    setVersaoMinecraft(versao);
    setPesquisaVersao("");
    setSeletorVersaoAberto(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20" size={20} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Pesquisar modpacks, mods, textures, shaders..."
            className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-12 pr-4 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 transition-all"
          />
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-4">
          <div className="custom-scrollbar flex max-w-full overflow-x-auto rounded-xl border border-white/10 bg-white/5 p-1">
            {CONTENT_TYPES.map((type) => (
              <button
                key={type.id}
                onClick={() => setContentType(type.id)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition-all",
                  contentType === type.id
                    ? "bg-emerald-500 text-black"
                    : "text-white/40 hover:text-white"
                )}
              >
                <type.icon size={14} />
                {type.label}
              </button>
            ))}
          </div>

          <div className="flex-1" />

          <button
            type="button"
            onClick={() => setFiltrosAbertos((abertos) => !abertos)}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold transition-all",
              filtrosAbertos || quantidadeFiltrosAtivos > 0
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                : "border-white/10 bg-white/5 text-white/50 hover:text-white"
            )}
            aria-expanded={filtrosAbertos}
          >
            <Filter size={14} />
            Filtros
            {quantidadeFiltrosAtivos > 0 && (
              <span className="rounded bg-emerald-400 px-1.5 py-0.5 text-[9px] text-black">
                {quantidadeFiltrosAtivos}
              </span>
            )}
          </button>

        </div>

        <AnimatePresence initial={false}>
          {filtrosAbertos && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className={seletorVersaoAberto ? "overflow-visible" : "overflow-hidden"}
            >
              <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.035] p-3 md:grid-cols-4">
                <div className="order-2 min-w-0">
                  <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-white/35">
                    Minecraft
                  </span>
                  <div ref={seletorVersaoRef} className="relative">
                    <div
                      className={cn(
                        "flex items-center rounded-xl border border-white/10 bg-[#171717]",
                        "focus-within:border-emerald-500/50"
                      )}
                    >
                      <Search size={13} className="ml-3 shrink-0 text-white/35" />
                      <input
                        type="text"
                        role="combobox"
                        aria-label="Pesquisar versão do Minecraft"
                        aria-expanded={seletorVersaoAberto}
                        aria-controls="opcoes-versao-minecraft"
                        autoComplete="off"
                        value={seletorVersaoAberto ? pesquisaVersao : versaoMinecraft}
                        placeholder={versaoMinecraft || "Todas as versões"}
                        onFocus={() => setSeletorVersaoAberto(true)}
                        onChange={(evento) => {
                          setPesquisaVersao(evento.target.value);
                          setSeletorVersaoAberto(true);
                        }}
                        className="min-w-0 flex-1 bg-transparent px-2 py-2 text-xs font-bold text-white outline-none"
                      />
                      <button
                        type="button"
                        aria-label={seletorVersaoAberto ? "Fechar versões" : "Abrir versões"}
                        onClick={() => {
                          setPesquisaVersao("");
                          setSeletorVersaoAberto((aberto) => !aberto);
                        }}
                        className="self-stretch px-3 text-white/35 transition-colors hover:text-white/70"
                      >
                        <ChevronDown
                          size={14}
                          className={cn("transition-transform", seletorVersaoAberto && "rotate-180")}
                        />
                      </button>
                    </div>

                    <AnimatePresence>
                      {seletorVersaoAberto && (
                        <motion.div
                          id="opcoes-versao-minecraft"
                          role="listbox"
                          initial={{ opacity: 0, y: -4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -4 }}
                          className={cn(
                            "scrollbar-custom absolute left-0 right-0 top-full z-30 mt-1 max-h-52 overflow-y-auto",
                            "rounded-xl border border-white/10 bg-[#171717] p-1 shadow-2xl"
                          )}
                        >
                          <button
                            type="button"
                            role="option"
                            aria-selected={!versaoMinecraft}
                            onClick={() => selecionarVersaoMinecraft("")}
                            className={cn(
                              "w-full rounded-lg px-3 py-2 text-left text-xs font-bold transition-colors hover:bg-white/10",
                              !versaoMinecraft && "bg-emerald-500/15 text-emerald-300"
                            )}
                          >
                            Todas as versões
                          </button>
                          {versoesMinecraftFiltradas.map((versao) => (
                            <button
                              key={versao}
                              type="button"
                              role="option"
                              aria-selected={versaoMinecraft === versao}
                              onClick={() => selecionarVersaoMinecraft(versao)}
                              className={cn(
                                "w-full rounded-lg px-3 py-2 text-left text-xs font-bold transition-colors hover:bg-white/10",
                                versaoMinecraft === versao && "bg-emerald-500/15 text-emerald-300"
                              )}
                            >
                              {versao}
                            </button>
                          ))}
                          {versoesMinecraftFiltradas.length === 0 && pesquisaVersao.trim() && (
                            <p className="px-3 py-4 text-center text-xs text-white/40">
                              Nenhuma versão encontrada.
                            </p>
                          )}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                <label className="order-3 min-w-0">
                  <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-white/35">
                    Modloader
                  </span>
                  <div className="relative">
                    <select
                      value={loader}
                      aria-label="Modloader"
                      title={!versaoMinecraft ? "Escolha uma versão do Minecraft primeiro" : undefined}
                      onChange={(evento) => setLoader(evento.target.value as LoaderFiltro)}
                      disabled={!versaoMinecraft || !["mod", "modpack"].includes(contentType)}
                      className={cn(
                        "w-full appearance-none rounded-xl border border-white/10 bg-[#171717]",
                        "px-3 py-2 pr-9 text-xs font-bold text-white outline-none focus:border-emerald-500/50",
                        "disabled:cursor-not-allowed disabled:opacity-35"
                      )}
                    >
                      <option value="">Todos os loaders</option>
                      {LOADERS.map((opcao) => (
                        <option key={opcao.id} value={opcao.id}>{opcao.nome}</option>
                      ))}
                    </select>
                    <ChevronDown
                      size={14}
                      className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-white/35"
                    />
                  </div>
                </label>

                <div className="order-1 min-w-0">
                  <span
                    className={cn(
                      "mb-1.5 flex items-center justify-between text-[10px] font-bold uppercase",
                      "tracking-wider text-white/35"
                    )}
                  >
                    Ordenar por
                    {quantidadeFiltrosAtivos > 0 && (
                      <button
                        type="button"
                        onClick={limparFiltros}
                        className="flex items-center gap-1 text-white/40 transition-colors hover:text-white"
                      >
                        <X size={10} /> Limpar
                      </button>
                    )}
                  </span>
                  <div className="relative">
                    <select
                      aria-label="Ordenação dos resultados"
                      value={ordenacao}
                      onChange={(evento) => setOrdenacao(evento.target.value as OrdenacaoBusca)}
                      className={cn(
                        "w-full appearance-none rounded-xl border border-white/10 bg-[#171717]",
                        "px-3 py-2 pr-9 text-xs font-bold text-white outline-none focus:border-emerald-500/50"
                      )}
                    >
                      {ORDENACOES.map((opcao) => (
                        <option key={opcao.id} value={opcao.id}>{opcao.nome}</option>
                      ))}
                    </select>
                    <ChevronDown
                      size={14}
                      className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-white/35"
                    />
                  </div>
                </div>

                <label className="order-4 min-w-0">
                  <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-white/35">
                    Fonte
                  </span>
                  <div className="relative">
                    <select
                      aria-label="Fonte dos resultados"
                      value={fonte}
                      onChange={(evento) => setFonte(evento.target.value as Source | "ambas")}
                      className={cn(
                        "w-full appearance-none rounded-xl border border-white/10 bg-[#171717]",
                        "px-3 py-2 pr-9 text-xs font-bold text-white outline-none focus:border-emerald-500/50"
                      )}
                    >
                      <option value="ambas">Modrinth e CurseForge</option>
                      <option value="modrinth">Somente Modrinth</option>
                      <option value="curseforge">Somente CurseForge</option>
                    </select>
                    <ChevronDown
                      size={14}
                      className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-white/35"
                    />
                  </div>
                </label>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {loading ? (
        <EsqueletoExplore />
      ) : (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="grid grid-cols-1 gap-6 lg:grid-cols-2 2xl:grid-cols-3"
          >
          {results.map((item, index) => (
            <motion.div
              key={item.chave}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: index * 0.03 }}
              className="group flex min-w-0 cursor-pointer flex-col gap-4 overflow-hidden rounded-3xl border border-white/5 bg-white/5 p-5 transition-all hover:border-white/20"
              onClick={() => abrirDetalheProjeto(item)}
              onMouseEnter={() =>
                onAtualizarPresencaExplore?.({
                  tipo: item.project_type as ContentType,
                  fonte: item.fontes.length > 1 ? "ambas" : item.fontes[0],
                  titulo: item.title,
                })
              }
              onMouseLeave={() =>
                onAtualizarPresencaExplore?.({
                  tipo: contentType,
                  fonte: "ambas",
                })
              }
            >
              <div className="flex min-w-0 gap-4">
                <img
                  src={obterImagemProjeto(item.icon_url, item.project_type, item.id)}
                  alt={item.title}
                  className="h-16 w-16 shrink-0 rounded-2xl bg-black/40 object-cover"
                />
                <div className="flex-1 min-w-0">
                  <h3 className="font-bold text-lg truncate group-hover:text-emerald-400 transition-colors">
                    {item.title}
                  </h3>
                  <p className="mb-2 flex min-w-0 items-center gap-1 text-xs text-white/40">
                    <span className="shrink-0">por</span>
                    <span className="truncate font-medium text-white/60">{item.author}</span>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {item.fontes.includes("modrinth") && (
                      <span
                        className={cn(
                          "rounded-full border border-[#1bd96a]/20 bg-[#1bd96a]/10",
                          "px-2 py-0.5 text-[10px] font-bold text-[#1bd96a]"
                        )}
                      >
                        Modrinth
                      </span>
                    )}
                    {item.fontes.includes("curseforge") && (
                      <span
                        className={cn(
                          "rounded-full border border-[#f16436]/25 bg-[#f16436]/10",
                          "px-2 py-0.5 text-[10px] font-bold text-[#f58a67]"
                        )}
                      >
                        CurseForge
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <p className="text-sm text-white/60 line-clamp-3 leading-relaxed">
                {item.description}
              </p>

              <div className="mt-auto flex flex-wrap items-center gap-3 border-t border-white/5 pt-4">
                <div className="flex shrink-0 gap-4 text-white/40">
                  <div className="flex items-center gap-1 text-[10px] font-bold">
                    <Download size={12} />
                    {(() => {
                      const qtdDownloads = item.downloads || 0;
                      if (qtdDownloads >= 1000000) return `${(qtdDownloads / 1000000).toFixed(1)}M`;
                      if (qtdDownloads >= 1000) return `${(qtdDownloads / 1000).toFixed(1)}K`;
                      return qtdDownloads;
                    })()}
                  </div>
                  <div className="flex items-center gap-1 text-[10px] font-bold">
                    <Star size={12} className="text-yellow-500/50" />
                    {(() => {
                      const qtdSeguidores = item.follows || 0;
                      return qtdSeguidores >= 1000
                        ? `${(qtdSeguidores / 1000).toFixed(1)}K`
                        : qtdSeguidores;
                    })()}
                  </div>
                </div>

                <div className="ml-auto flex shrink-0 gap-2">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFavorite(item);
                    }}
                    className={cn(
                      "p-2 rounded-xl transition-all",
                      favorites.has(item.id)
                        ? "bg-pink-500/20 text-pink-400"
                        : "bg-white/5 hover:bg-white/10 text-white/40"
                    )}
                  >
                    <Heart size={16} fill={favorites.has(item.id) ? "currentColor" : "none"} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      abrirDetalheProjeto(item);
                    }}
                    className="px-4 py-2 rounded-xl text-xs font-bold transition-all active:scale-95 flex items-center gap-1.5 bg-emerald-500 hover:bg-emerald-400 text-black"
                  >
                    <Download size={14} />
                    Instalar
                  </button>
                </div>
              </div>
            </motion.div>
          ))}
          </motion.div>

          <div ref={fimListaRef} className="flex h-12 items-center justify-center" aria-live="polite">
            {carregandoMais && (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/10 border-t-emerald-400/70" />
            )}
            {falhaCarregamentoMais && (
              <button
                type="button"
                onClick={() => void carregarMaisResultados()}
                className="text-[10px] font-bold uppercase tracking-wider text-white/35 transition-colors hover:text-emerald-300"
              >
                Tentar novamente
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
