import { useState, useEffect, useRef, useCallback } from "react";
import {
  Play,
  Search,
  Plus,
  RefreshCw,
  Download,
  Trash2,
  MoreVertical,
  Globe,
  Clock,
  Package,
  Image,
  Sparkles,
  Loader2,
  ChevronLeft,
  X,
  FolderOpen,
  FileText,
  Calendar,
  HardDrive,
  Pencil,
  Save,
  Users,
  Heart,
} from "../iconesPixelados";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { cn } from "../lib/utils";
import { ICONE_DOME_LAUNCHER } from "../lib/imagemProjeto";
import { arquivoPodePertencerAoProjeto } from "../lib/conteudoInstalado";
import Configuracao from "../pages/instance/Configuracao";
import type { ProjetoConteudo } from "./ProjetoDetalheModal";
import EditorIconeModal from "./editor-icone/EditorIconeModal";
import {
  CabecalhoMenuContextual,
  ItemMenuContextual,
  MenuContextual,
  SeparadorMenuContextual,
} from "./context-menu/MenuContextual";
import { AreaRolagemPersonalizada } from "./scroll/AreaRolagemPersonalizada";
import { loadFavorites, saveFavorites, type FavoriteItem } from "./Favorites";

interface InstanceManagerProps {
  instanceId: string;
  onBack: () => void;
  onAbrirSocial?: () => void;
  onAbrirProjeto?: (projeto: ProjetoConteudo) => void;
  onInstanceUpdate?: (novoId?: string) => void;
}

interface InstanceDetails {
  id: string;
  name: string;
  version: string;
  mcType: string;
  loaderType?: string;
  loaderVersion?: string;
  icon?: string;
  lastPlayed?: string;
  tempoTotalJogadoSegundos?: number;
  path: string;
  created?: string;
  javaArgs?: string;
  mcArgs?: string;
  memory?: number | null;
  width?: number;
  height?: number;
}

interface InstalledMod {
  name: string;
  fileName: string;
  version: string;
  author: string;
  icon?: string;
  enabled: boolean;
  projectId?: string;
  source?: BrowseSource;
  projectType?: TipoProjetoCache;
  latestVersion?: string;
  updateAvailable?: boolean;
  updateFileName?: string;
  updateDownloadUrl?: string;
  updating?: boolean;
}

interface ArquivoVersaoConteudo {
  url: string;
  filename: string;
  primary?: boolean;
}

interface VersaoConteudo {
  id: string;
  version_number: string;
  version_type?: string;
  game_versions: string[];
  loaders: string[];
  date_published?: string;
  files: ArquivoVersaoConteudo[];
}

type EstabilidadeVersao = "release" | "beta" | "alpha";

const ROTULOS_ESTABILIDADE: Record<EstabilidadeVersao, string> = {
  release: "Estável",
  beta: "Beta",
  alpha: "Alpha",
};

const CLASSES_ESTABILIDADE: Record<EstabilidadeVersao, string> = {
  release: "border-emerald-400/20 bg-emerald-400/8 text-emerald-300",
  beta: "border-amber-400/20 bg-amber-400/8 text-amber-300",
  alpha: "border-red-400/20 bg-red-400/8 text-red-300",
};

function obterEstabilidadeVersao(versao: VersaoConteudo): EstabilidadeVersao {
  const tipoOficial = versao.version_type?.trim().toLowerCase();
  if (tipoOficial === "alpha" || tipoOficial === "beta" || tipoOficial === "release") {
    return tipoOficial;
  }

  const identificador = `${versao.version_number} ${versao.files.map((arquivo) => arquivo.filename).join(" ")}`;
  if (/\b(alpha|snapshot|nightly|dev)\b/i.test(identificador)) return "alpha";
  if (/\b(beta|pre|preview|rc)\b/i.test(identificador)) return "beta";
  return "release";
}

interface ConteudoInstaladoDetalhado {
  fileName: string;
  name: string;
  version: string;
  author: string;
  icon?: string;
  enabled: boolean;
}

interface SearchResult {
  id: string;
  title: string;
  description: string;
  icon_url?: string;
  author: string;
  downloads?: number;
  slug: string;
  project_type: string;
  latest_version?: string;
  file_name?: string;
  source: BrowseSource;
  fontes?: BrowseSource[];
  idsPorFonte?: Partial<Record<BrowseSource, string>>;
}

interface WorldInfo {
  name: string;
  path: string;
  gameMode: string;
  difficulty: string;
  lastPlayed: string;
  sizeOnDisk: string;
}

interface LogFile {
  filename: string;
  path: string;
  size: number;
  modified: string;
}

interface ConfiguracoesGlobais {
  close_on_launch?: boolean;
}

type ContentTab = "content" | "worlds" | "configuration" | "logs";
type ContentFilter = "mods" | "resourcepacks" | "shaders";
type ViewMode = "installed" | "browse";
type BrowseSource = "modrinth" | "curseforge";
type FiltroFonteBusca = BrowseSource | "ambas";
type TipoProjetoCache = "mod" | "resourcepack" | "shader";

interface RegistroCacheConteudo {
  name: string;
  author: string;
  icon?: string;
  projectId?: string;
  source?: BrowseSource;
  projectType?: TipoProjetoCache;
  latestVersion?: string;
  updateAvailable?: boolean;
  updateFileName?: string;
  updateDownloadUrl?: string;
  atualizacaoVerificadaEm?: number;
  versaoIdentificacao?: number;
  atualizadoEm: number;
}

type EstruturaCacheConteudo = Record<string, RegistroCacheConteudo>;

const CHAVE_CACHE_CONTEUDO_INSTALADO = "dome:cache-conteudo-instalado:v2";
const TTL_CACHE_CONTEUDO_MS = 1000 * 60 * 60 * 24 * 30;
const TTL_CACHE_ATUALIZACAO_MS = 1000 * 60 * 60 * 6;
const TTL_RETENTATIVA_ENRIQUECIMENTO_MS = 1000 * 60 * 60 * 24;
const LIMITE_ENRIQUECIMENTO_POR_CICLO = 8;
const VERSAO_IDENTIFICACAO_CONTEUDO = 2;

const tipoProjetoPorFiltro = (filtro: ContentFilter): TipoProjetoCache => {
  if (filtro === "resourcepacks") return "resourcepack";
  if (filtro === "shaders") return "shader";
  return "mod";
};

const chaveCorrespondenciaProjeto = (item: Pick<SearchResult, "slug" | "title">): string => {
  const valor = item.slug || item.title;
  return valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
};

const mesclarResultadosBusca = (atual: SearchResult, novo: SearchResult): SearchResult => ({
  ...atual,
  description: atual.description || novo.description,
  icon_url: atual.icon_url || novo.icon_url,
  downloads: Math.max(atual.downloads ?? 0, novo.downloads ?? 0),
  latest_version: atual.latest_version || novo.latest_version,
  file_name: atual.file_name || novo.file_name,
  fontes: Array.from(new Set([...(atual.fontes ?? [atual.source]), ...(novo.fontes ?? [novo.source])])),
  idsPorFonte: {
    ...(atual.idsPorFonte ?? { [atual.source]: atual.id }),
    ...(novo.idsPorFonte ?? { [novo.source]: novo.id }),
  },
});

async function obterDownloadsFavorito(favorito: FavoriteItem): Promise<number | undefined> {
  try {
    if (favorito.source === "modrinth") {
      const resposta = await fetch(`https://api.modrinth.com/v2/project/${favorito.id}`);
      if (!resposta.ok) return undefined;
      const dados = await resposta.json();
      return typeof dados.downloads === "number" ? dados.downloads : undefined;
    }

    const dados = await invoke<{ downloads?: number }>("buscar_detalhes_projeto_curseforge", {
      projectId: favorito.id,
    });
    return typeof dados.downloads === "number" ? dados.downloads : undefined;
  } catch {
    return undefined;
  }
}

async function hidratarDownloadsFavoritos(favoritos: FavoriteItem[]): Promise<FavoriteItem[]> {
  const pendentes = favoritos.filter((favorito) => favorito.downloads === undefined);
  if (pendentes.length === 0) return favoritos;

  const downloadsPorId = new Map<string, number>();
  let proximoIndice = 0;
  const trabalhadores = Array.from({ length: Math.min(4, pendentes.length) }, async () => {
    while (proximoIndice < pendentes.length) {
      const favorito = pendentes[proximoIndice];
      proximoIndice += 1;
      const downloads = await obterDownloadsFavorito(favorito);
      if (downloads !== undefined) downloadsPorId.set(favorito.id, downloads);
    }
  });
  await Promise.all(trabalhadores);
  if (downloadsPorId.size === 0) return favoritos;

  const todosAtualizados = loadFavorites().map((favorito) => {
    const downloads = downloadsPorId.get(favorito.id);
    return downloads === undefined ? favorito : { ...favorito, downloads };
  });
  saveFavorites(todosAtualizados);
  return favoritos.map((favorito) => {
    const downloads = downloadsPorId.get(favorito.id);
    return downloads === undefined ? favorito : { ...favorito, downloads };
  });
}

const montarChaveCacheConteudo = (
  instanceId: string,
  tipoProjeto: TipoProjetoCache,
  fileName: string
) => `${instanceId}::${tipoProjeto}::${fileName.toLowerCase()}`;

const lerCacheConteudoInstalado = (): EstruturaCacheConteudo => {
  try {
    const bruto = localStorage.getItem(CHAVE_CACHE_CONTEUDO_INSTALADO);
    if (!bruto) return {};
    const json = JSON.parse(bruto);
    if (!json || typeof json !== "object") return {};
    return json as EstruturaCacheConteudo;
  } catch {
    return {};
  }
};

const salvarCacheConteudoInstalado = (cache: EstruturaCacheConteudo) => {
  try {
    localStorage.setItem(CHAVE_CACHE_CONTEUDO_INSTALADO, JSON.stringify(cache));
  } catch {
    // Ignorar erro de armazenamento
  }
};

const obterRegistroCacheConteudo = (
  cache: EstruturaCacheConteudo,
  instanceId: string,
  tipoProjeto: TipoProjetoCache,
  fileName: string
): RegistroCacheConteudo | null => {
  const chave = montarChaveCacheConteudo(instanceId, tipoProjeto, fileName);
  const registro = cache[chave];
  if (!registro) return null;
  if (Date.now() - registro.atualizadoEm > TTL_CACHE_CONTEUDO_MS) return null;
  return registro;
};

const definirRegistroCacheConteudo = (
  cache: EstruturaCacheConteudo,
  instanceId: string,
  tipoProjeto: TipoProjetoCache,
  fileName: string,
  registro: Omit<RegistroCacheConteudo, "atualizadoEm">
) => {
  const chave = montarChaveCacheConteudo(instanceId, tipoProjeto, fileName);
  cache[chave] = {
    ...registro,
    atualizadoEm: Date.now(),
  };
};

const removerRegistroCacheConteudo = (
  cache: EstruturaCacheConteudo,
  instanceId: string,
  tipoProjeto: TipoProjetoCache,
  fileName: string
) => {
  const chave = montarChaveCacheConteudo(instanceId, tipoProjeto, fileName);
  delete cache[chave];
};

const removerCacheInstanciaInteira = (
  cache: EstruturaCacheConteudo,
  instanceId: string
) => {
  const prefixo = `${instanceId}::`;
  for (const chave of Object.keys(cache)) {
    if (chave.startsWith(prefixo)) {
      delete cache[chave];
    }
  }
};

const limparCacheOrfaoPorTipo = (
  cache: EstruturaCacheConteudo,
  instanceId: string,
  tipoProjeto: TipoProjetoCache,
  arquivosAtuais: string[]
) => {
  const prefixo = `${instanceId}::${tipoProjeto}::`;
  const arquivos = new Set(arquivosAtuais.map((a) => a.toLowerCase()));
  for (const chave of Object.keys(cache)) {
    if (!chave.startsWith(prefixo)) continue;
    const arquivo = chave.slice(prefixo.length);
    if (!arquivos.has(arquivo)) {
      delete cache[chave];
    }
  }
};

const formatarUltimoAcesso = (data?: string): string => {
  if (!data) return "Nunca jogado";
  const dataConvertida = new Date(data);
  if (Number.isNaN(dataConvertida.getTime())) return "Nunca jogado";
  return dataConvertida.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatarTempoJogadoTotal = (segundos?: number): string => {
  const total = Math.max(0, Math.floor(segundos ?? 0));
  if (total === 0) return "0 min";
  if (total < 60) return "<1 min";

  const minutos = Math.floor(total / 60);
  if (minutos < 60) return `${minutos} min`;

  const horas = Math.floor(minutos / 60);
  const minutosRestantes = minutos % 60;
  if (horas < 24) {
    return minutosRestantes > 0 ? `${horas}h ${minutosRestantes}m` : `${horas}h`;
  }

  const dias = Math.floor(horas / 24);
  const horasRestantes = horas % 24;
  return horasRestantes > 0 ? `${dias}d ${horasRestantes}h` : `${dias}d`;
};

export default function InstanceManager({
  instanceId,
  onBack,
  onAbrirSocial,
  onAbrirProjeto,
  onInstanceUpdate,
}: InstanceManagerProps) {
  const [instanceDetails, setInstanceDetails] = useState<InstanceDetails | null>(null);
  const [activeTab, setActiveTab] = useState<ContentTab>("content");
  const [activeFilter, setActiveFilter] = useState<ContentFilter>("mods");
  const [viewMode, setViewMode] = useState<ViewMode>("installed");
  const [browseSource, setBrowseSource] = useState<FiltroFonteBusca>("ambas");
  const [searchQuery, setSearchQuery] = useState("");
  const [installedMods, setInstalledMods] = useState<InstalledMod[]>([]);
  const [installedResourcePacks, setInstalledResourcePacks] = useState<InstalledMod[]>([]);
  const [installedShaders, setInstalledShaders] = useState<InstalledMod[]>([]);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [carregandoMaisResultados, setCarregandoMaisResultados] = useState(false);
  const [temMaisResultados, setTemMaisResultados] = useState(true);
  const [instalacoesEmAndamento, setInstalacoesEmAndamento] = useState<Set<string>>(new Set());
  const [worlds, setWorlds] = useState<WorldInfo[]>([]);
  const [logs, setLogs] = useState<LogFile[]>([]);
  const [selectedLog, setSelectedLog] = useState<string | null>(null);
  const [logContent, setLogContent] = useState("");
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [updatingAll, setUpdatingAll] = useState(false);
  const [modoSelecaoLote, setModoSelecaoLote] = useState(false);
  const [arquivosSelecionados, setArquivosSelecionados] = useState<Set<string>>(new Set());
  const [processandoLote, setProcessandoLote] = useState(false);
  const [menuConteudo, setMenuConteudo] = useState<{
    item: InstalledMod;
    filtro: ContentFilter;
    x: number;
    y: number;
  } | null>(null);
  const [itemTrocaVersao, setItemTrocaVersao] = useState<InstalledMod | null>(null);
  const [filtroTrocaVersao, setFiltroTrocaVersao] = useState<ContentFilter>("mods");
  const [versoesConteudo, setVersoesConteudo] = useState<VersaoConteudo[]>([]);
  const [versaoConteudoSelecionadaId, setVersaoConteudoSelecionadaId] = useState("");
  const [carregandoVersoesConteudo, setCarregandoVersoesConteudo] = useState(false);
  const [trocandoVersaoConteudo, setTrocandoVersaoConteudo] = useState(false);
  const [erroTrocaVersao, setErroTrocaVersao] = useState<string | null>(null);
  const [indicadorRolagem, setIndicadorRolagem] = useState({
    altura: 0,
    topo: 0,
    visivel: false,
  });
  
  // Estados para edição
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editIcon, setEditIcon] = useState("");
  const [saving, setSaving] = useState(false);
  const [editorIconeAberto, setEditorIconeAberto] = useState(false);
  const editorIconeAbriuEdicaoRef = useRef(false);

  const lastSearch = useRef({ query: "", filter: "", source: "" });
  const offsetsBuscaPorFonteRef = useRef<Record<BrowseSource, number>>({ modrinth: 0, curseforge: 0 });
  const carregandoMaisResultadosRef = useRef(false);
  const instalacoesEmAndamentoRef = useRef<Set<string>>(new Set());
  const listaConteudoRef = useRef<HTMLDivElement | null>(null);
  const nomeInstanciaRef = useRef<HTMLInputElement | null>(null);
  const arrasteIndicadorRef = useRef<{
    ponteiroId: number;
    inicioY: number;
    scrollInicial: number;
  } | null>(null);

  useEffect(() => {
    setActiveTab("content");
    setActiveFilter("mods");
    setViewMode("installed");
    loadInstanceDetails();
  }, [instanceId]);

  useEffect(() => {
    if (activeTab === "worlds") loadWorlds();
    if (activeTab === "logs") loadLogs();
  }, [activeTab]);

  // Carregar conteúdo quando mudar o filtro
  useEffect(() => {
    if (activeTab === "content" && instanceDetails) {
      loadInstalledContent(activeFilter);
    }
  }, [activeFilter, activeTab, instanceDetails?.id]);

  // Verificar se instância é vanilla (não mostrar mods/shaders)
  // Corrigido: usar loaderType (camelCase) que vem do backend
  const isVanilla = !instanceDetails?.loaderType || 
                    instanceDetails?.loaderType === "Vanilla" ||
                    instanceDetails?.loaderType === "vanilla";

  // Buscar quando mudar para browse mode ou filtro
  useEffect(() => {
    if (viewMode === "browse") {
      searchContent(searchQuery);
    }
  }, [viewMode, activeFilter, browseSource, instanceDetails?.version, instanceDetails?.loaderType]);

  useEffect(() => {
    setArquivosSelecionados(new Set());
    if (viewMode !== "installed") {
      setModoSelecaoLote(false);
    }
  }, [activeFilter, viewMode, instanceId]);

  // Debounce na busca
  useEffect(() => {
    if (viewMode !== "browse") return;
    if (lastSearch.current.query === searchQuery &&
        lastSearch.current.filter === activeFilter &&
        lastSearch.current.source === browseSource) return;
    
    const timer = setTimeout(() => {
      searchContent(searchQuery);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery, viewMode]);

  const loadInstanceDetails = async () => {
    try {
      const details: InstanceDetails = await invoke("get_instance_details", { instanceId });
      setInstanceDetails(details);
      // Preencher campos de edição
      setEditName(details.name);
      setEditIcon(details.icon || "");
    } catch (error) {
      console.error("Erro ao carregar detalhes:", error);
    }
  };

  // Função genérica para carregar conteúdo instalado (mods, resourcepacks, shaders)
  const loadInstalledContent = async (
    contentType: ContentFilter,
    silencioso = false
  ) => {
    if (!silencioso) setLoading(true);
    try {
      const detalhes = await invoke<ConteudoInstaladoDetalhado[]>(
        "obter_conteudo_instalado_detalhado",
        { instanceId, contentType }
      );
      const files = detalhes.map((detalhe) => detalhe.fileName);

      const tipoProjeto = tipoProjetoPorFiltro(contentType);
      const cacheConteudo = lerCacheConteudoInstalado();
      limparCacheOrfaoPorTipo(cacheConteudo, instanceId, tipoProjeto, files);
      salvarCacheConteudoInstalado(cacheConteudo);
      
      // Formatar lista
      const formattedContent: InstalledMod[] = detalhes.map((detalhe) => {
        const fileName = detalhe.fileName;
        const registro = obterRegistroCacheConteudo(cacheConteudo, instanceId, tipoProjeto, fileName);
        const cacheIdentificado = Boolean(registro?.projectId);
        const atualizacaoCacheValida = Boolean(
          registro?.atualizacaoVerificadaEm &&
            Date.now() - registro.atualizacaoVerificadaEm <= TTL_CACHE_ATUALIZACAO_MS
        );

        return {
          name:
            (cacheIdentificado ? registro?.name : detalhe.name) ||
            fileName
              .replace(".jar", "")
              .replace(".zip", "")
              .replace(".disabled", "")
              .replace(/[-_]/g, " "),
          fileName,
          version: detalhe.version || extractVersion(fileName),
          author: (cacheIdentificado ? registro?.author : detalhe.author) || "Unknown",
          icon: (cacheIdentificado ? registro?.icon : detalhe.icon) || registro?.icon,
          projectId: registro?.projectId,
          source: registro?.source,
          projectType: registro?.projectType || tipoProjeto,
          latestVersion: registro?.latestVersion,
          updateAvailable: atualizacaoCacheValida ? registro?.updateAvailable : false,
          updateFileName: atualizacaoCacheValida ? registro?.updateFileName : undefined,
          updateDownloadUrl: atualizacaoCacheValida ? registro?.updateDownloadUrl : undefined,
          enabled: detalhe.enabled,
        };
      });
      
      // Atualizar estado correto baseado no tipo
      if (contentType === "mods") {
        setInstalledMods(formattedContent);
        // Enriquecer os que estão sem metadata (em background)
        enrichModsWithModrinthData(formattedContent, "mod");
      } else if (contentType === "resourcepacks") {
        setInstalledResourcePacks(formattedContent);
        enrichModsWithModrinthData(formattedContent, "resourcepack");
      } else if (contentType === "shaders") {
        setInstalledShaders(formattedContent);
        enrichModsWithModrinthData(formattedContent, "shader");
      }
    } catch (error) {
      console.error(`Erro ao carregar ${contentType}:`, error);
    } finally {
      if (!silencioso) setLoading(false);
    }
  };

  const normalizarChaveProjeto = (valor: string): string =>
    valor
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

  const compactarChaveProjeto = (valor: string): string =>
    normalizarChaveProjeto(valor).replace(/-/g, "");

  const gerarConsultasArquivo = (fileName: string): string[] => {
    const base = fileName
      .replace(/\.disabled$/i, "")
      .replace(/\.(jar|zip)$/i, "");

    const consultas = new Set<string>();
    const adicionarConsulta = (valor: string) => {
      const normalizada = normalizarChaveProjeto(valor);
      if (normalizada.length >= 3) {
        consultas.add(normalizada);
      }
    };

    let limpa = base.toLowerCase();
    limpa = limpa
      .replace(/[_+.-](fabric|forge|neoforge|quilt)(?=[_+.-]|$)/gi, "-")
      .replace(/[_+.-](client|server|universal|all)(?=[_+.-]|$)/gi, "-")
      .replace(/[_+.-]?mc[_+.-]?\d[\w.+-]*/gi, "")
      .replace(/[_+.-]?v?\d+(?:\.\d+){1,4}(?:[_+.-]?[a-z0-9-]+)*$/gi, "");

    adicionarConsulta(limpa);
    adicionarConsulta(base);

    const primeiraParte = limpa.split(/[_+.-]/).filter(Boolean)[0];
    if (primeiraParte && primeiraParte.length >= 4) {
      adicionarConsulta(primeiraParte);
    }

    return Array.from(consultas);
  };

  const pontuarHitProjeto = (consulta: string, hit: any): number => {
    const slug = normalizarChaveProjeto(String(hit?.slug || ""));
    const titulo = normalizarChaveProjeto(String(hit?.title || ""));
    const consultaCompacta = compactarChaveProjeto(consulta);
    const slugCompacto = compactarChaveProjeto(slug);
    const tituloCompacto = compactarChaveProjeto(titulo);
    const tokens = consulta.split("-").filter((t) => t.length >= 2);

    if (!slug && !titulo) return 0;
    if (slug === consulta) return 100;
    if (titulo === consulta) return 95;
    if (slugCompacto === consultaCompacta) return 92;
    if (tituloCompacto === consultaCompacta) return 90;
    if (slug.startsWith(`${consulta}-`)) return 84;
    if (titulo.startsWith(`${consulta}-`)) return 80;

    if (tokens.length >= 2) {
      const matchSlug = tokens.filter((token) => slug.includes(token)).length;
      const matchTitulo = tokens.filter((token) => titulo.includes(token)).length;
      const cobertura = Math.max(matchSlug, matchTitulo) / tokens.length;
      if (cobertura >= 1) return 74;
      if (cobertura >= 0.75) return 62;
    }

    if (tokens.length === 1 && tokens[0].length >= 5) {
      const token = tokens[0];
      if (slug.includes(token) || titulo.includes(token)) return 45;
    }

    return 0;
  };

  const escolherMelhorHitProjeto = (consultas: string[], hits: any[]): any | null => {
    let melhorHit: any | null = null;
    let melhorScore = 0;
    let consultaEscolhida = "";

    for (const consulta of consultas) {
      for (const hit of hits) {
        const score = pontuarHitProjeto(consulta, hit);
        if (score > melhorScore) {
          melhorScore = score;
          melhorHit = hit;
          consultaEscolhida = consulta;
        }
      }
    }

    if (!melhorHit) return null;

    const tokensConsulta = consultaEscolhida.split("-").filter((token) => token.length >= 2);
    const scoreMinimo = tokensConsulta.length <= 1 ? 90 : 62;
    return melhorScore >= scoreMinimo ? melhorHit : null;
  };

  // Buscar informações do Modrinth para conteúdo instalado
  const enrichModsWithModrinthData = async (
    items: InstalledMod[],
    projectType: string = "mod"
  ) => {
    const enrichedItems = [...items];
    const tipoProjeto = (projectType === "resourcepack" || projectType === "shader"
      ? projectType
      : "mod") as TipoProjetoCache;
    const cacheConteudo = lerCacheConteudoInstalado();
    let cacheAlterado = false;
    let processadosNoCiclo = 0;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.projectId) continue;
      if (processadosNoCiclo >= LIMITE_ENRIQUECIMENTO_POR_CICLO) break;

      const registroExistente = obterRegistroCacheConteudo(
        cacheConteudo,
        instanceId,
        tipoProjeto,
        item.fileName
      );
      if (
        registroExistente &&
        !registroExistente.projectId &&
        registroExistente.versaoIdentificacao === VERSAO_IDENTIFICACAO_CONTEUDO &&
        Date.now() - registroExistente.atualizadoEm <= TTL_RETENTATIVA_ENRIQUECIMENTO_MS
      ) {
        continue;
      }

      try {
        const consultas = gerarConsultasArquivo(item.name || item.fileName).slice(0, 2);
        if (consultas.length === 0) continue;

        const hitsUnicos = new Map<string, any>();
        for (const consulta of consultas) {
          const variacoesConsulta = Array.from(
            new Set(
              [
                consulta,
                consulta.replace(/-/g, " "),
                consulta.replace(/-/g, "+"),
              ].filter((q) => q.trim().length > 0)
            )
          ).slice(0, 1);

          for (const termoBusca of variacoesConsulta) {
            const resultadosBusca: any[] = await invoke("search_mods_online", {
              query: termoBusca,
              platform: "modrinth",
              contentType: projectType,
              filtros: null,
            });

            for (const resultado of resultadosBusca) {
              const id = String(resultado?.id || "");
              const slug = String(resultado?.slug || "");
              const title = String(resultado?.name || resultado?.title || "");
              const chave = [id, slug, title].join("|");
              if (!chave.replace(/\|/g, "").trim()) continue;
              if (!hitsUnicos.has(chave)) {
                hitsUnicos.set(chave, {
                  project_id: id,
                  slug,
                  title,
                  author: String(resultado?.author || "Unknown"),
                  icon_url: resultado?.iconUrl || resultado?.icon_url,
                  source: String(resultado?.platform || "modrinth"),
                  latest_version: resultado?.latestVersion || resultado?.latest_version,
                });
              }
            }
          }
        }
        processadosNoCiclo += 1;

        const bestMatch = escolherMelhorHitProjeto(consultas, Array.from(hitsUnicos.values()));
        if (bestMatch) {
          enrichedItems[i] = {
            ...item,
            name: String(bestMatch.title || item.name),
            author: String(bestMatch.author || "Unknown"),
            icon: bestMatch.icon_url,
            projectId: bestMatch.project_id,
            source: bestMatch.source === "curseforge" ? "curseforge" : "modrinth",
            projectType: tipoProjeto,
            latestVersion: bestMatch.latest_version,
            updateAvailable: false,
          };

          definirRegistroCacheConteudo(cacheConteudo, instanceId, tipoProjeto, item.fileName, {
            name: enrichedItems[i].name,
            author: enrichedItems[i].author,
            icon: enrichedItems[i].icon,
            projectId: enrichedItems[i].projectId,
            source: enrichedItems[i].source,
            projectType: tipoProjeto,
            latestVersion: enrichedItems[i].latestVersion,
            updateAvailable: false,
            updateFileName: undefined,
            updateDownloadUrl: undefined,
            versaoIdentificacao: VERSAO_IDENTIFICACAO_CONTEUDO,
          });
          cacheAlterado = true;
        } else {
          definirRegistroCacheConteudo(cacheConteudo, instanceId, tipoProjeto, item.fileName, {
            name: item.name,
            author: item.author,
            icon: item.icon,
            projectId: undefined,
            source: "modrinth",
            projectType: tipoProjeto,
            latestVersion: item.latestVersion,
            updateAvailable: false,
            updateFileName: undefined,
            updateDownloadUrl: undefined,
            versaoIdentificacao: VERSAO_IDENTIFICACAO_CONTEUDO,
          });
          cacheAlterado = true;
        }
      } catch (e) {
        // Ignorar erros de busca individual
        console.warn(`Falha ao buscar info para ${item.fileName}:`, e);
      }
    }

    if (cacheAlterado) {
      salvarCacheConteudoInstalado(cacheConteudo);
    }

    // Atualizar o estado correto baseado no tipo
    if (projectType === "mod") {
      setInstalledMods(enrichedItems);
    } else if (projectType === "resourcepack") {
      setInstalledResourcePacks(enrichedItems);
    } else if (projectType === "shader") {
      setInstalledShaders(enrichedItems);
    }

    verificarAtualizacoesConteudo(enrichedItems, tipoProjeto);
  };

  const atualizarListaPorTipo = (
    tipoProjeto: TipoProjetoCache,
    atualizador: (lista: InstalledMod[]) => InstalledMod[]
  ) => {
    if (tipoProjeto === "mod") {
      setInstalledMods((prev) => atualizador(prev));
    } else if (tipoProjeto === "resourcepack") {
      setInstalledResourcePacks((prev) => atualizador(prev));
    } else {
      setInstalledShaders((prev) => atualizador(prev));
    }
  };

  const verificarAtualizacoesConteudo = async (
    itens: InstalledMod[],
    tipoProjeto: TipoProjetoCache
  ) => {
    if (!instanceDetails) return;

    const cacheConteudo = lerCacheConteudoInstalado();
    let cacheAlterado = false;
    const itensAtualizados = [...itens];

    for (let i = 0; i < itensAtualizados.length; i++) {
      const item = itensAtualizados[i];
      if (!item.projectId) continue;

      const registroCache = obterRegistroCacheConteudo(
        cacheConteudo,
        instanceId,
        tipoProjeto,
        item.fileName
      );
      const cacheAtualizacaoValido = Boolean(
        registroCache?.atualizacaoVerificadaEm &&
          Date.now() - registroCache.atualizacaoVerificadaEm <= TTL_CACHE_ATUALIZACAO_MS
      );

      if (cacheAtualizacaoValido) {
        itensAtualizados[i] = {
          ...item,
          updateAvailable: registroCache?.updateAvailable || false,
          latestVersion: registroCache?.latestVersion || item.latestVersion,
          updateFileName: registroCache?.updateFileName,
          updateDownloadUrl: registroCache?.updateDownloadUrl,
        };
        continue;
      }

      // CurseForge: sem endpoint leve de "update id", manter apenas botão manual de atualizar.
      if (item.source === "curseforge") {
        definirRegistroCacheConteudo(cacheConteudo, instanceId, tipoProjeto, item.fileName, {
          name: item.name,
          author: item.author,
          icon: item.icon,
          projectId: item.projectId,
          source: "curseforge",
          projectType: tipoProjeto,
          latestVersion: item.latestVersion,
          updateAvailable: false,
          updateFileName: undefined,
          updateDownloadUrl: undefined,
          atualizacaoVerificadaEm: Date.now(),
        });
        cacheAlterado = true;
        continue;
      }

      try {
        const params = new URLSearchParams();
        params.set("game_versions", JSON.stringify([instanceDetails.version]));
        if (tipoProjeto === "mod") {
          const loaderAtual = (instanceDetails.loaderType || "").toLowerCase();
          if (["fabric", "forge", "quilt", "neoforge"].includes(loaderAtual)) {
            params.set("loaders", JSON.stringify([loaderAtual]));
          }
        }

        const resposta = await fetch(
          `https://api.modrinth.com/v2/project/${item.projectId}/version?${params.toString()}`
        );
        if (!resposta.ok) {
          throw new Error(`Modrinth respondeu ${resposta.status}`);
        }
        const versoes = await resposta.json();
        if (!Array.isArray(versoes) || versoes.length === 0) {
          itensAtualizados[i] = {
            ...item,
            updateAvailable: false,
            updateFileName: undefined,
            updateDownloadUrl: undefined,
          };
          definirRegistroCacheConteudo(cacheConteudo, instanceId, tipoProjeto, item.fileName, {
            name: item.name,
            author: item.author,
            icon: item.icon,
            projectId: item.projectId,
            source: "modrinth",
            projectType: tipoProjeto,
            latestVersion: item.latestVersion,
            updateAvailable: false,
            updateFileName: undefined,
            updateDownloadUrl: undefined,
            atualizacaoVerificadaEm: Date.now(),
          });
          cacheAlterado = true;
          continue;
        }

        const versaoAlvo = versoes[0];
        const arquivoAlvo =
          versaoAlvo?.files?.find((f: any) => f?.primary) || versaoAlvo?.files?.[0];
        if (!arquivoAlvo?.filename || !arquivoAlvo?.url) continue;

        const nomeAtual = item.fileName.replace(/\.disabled$/i, "").toLowerCase();
        const updateDisponivel = String(arquivoAlvo.filename).toLowerCase() !== nomeAtual;

        const latestVersion =
          String(versaoAlvo?.version_number || "") || item.latestVersion || undefined;

        itensAtualizados[i] = {
          ...item,
          latestVersion,
          updateAvailable: updateDisponivel,
          updateFileName: updateDisponivel ? String(arquivoAlvo.filename) : undefined,
          updateDownloadUrl: updateDisponivel ? String(arquivoAlvo.url) : undefined,
        };

        definirRegistroCacheConteudo(cacheConteudo, instanceId, tipoProjeto, item.fileName, {
          name: itensAtualizados[i].name,
          author: itensAtualizados[i].author,
          icon: itensAtualizados[i].icon,
          projectId: itensAtualizados[i].projectId,
          source: "modrinth",
          projectType: tipoProjeto,
          latestVersion: itensAtualizados[i].latestVersion,
          updateAvailable: itensAtualizados[i].updateAvailable,
          updateFileName: itensAtualizados[i].updateFileName,
          updateDownloadUrl: itensAtualizados[i].updateDownloadUrl,
          atualizacaoVerificadaEm: Date.now(),
        });
        cacheAlterado = true;
      } catch (erro) {
        console.warn(`Falha ao verificar atualização para ${item.fileName}:`, erro);
      }
    }

    if (cacheAlterado) {
      salvarCacheConteudoInstalado(cacheConteudo);
    }

    if (tipoProjeto === "mod") {
      setInstalledMods(itensAtualizados);
    } else if (tipoProjeto === "resourcepack") {
      setInstalledResourcePacks(itensAtualizados);
    } else {
      setInstalledShaders(itensAtualizados);
    }
  };

  const loadWorlds = async () => {
    try {
      const worldList: WorldInfo[] = await invoke("get_worlds", { instanceId });
      setWorlds(worldList);
    } catch (error) {
      console.error("Erro ao carregar mundos:", error);
      setWorlds([]);
    }
  };

  const loadLogs = async () => {
    try {
      const logList: LogFile[] = await invoke("get_log_files", { instanceId });
      setLogs(logList);
    } catch (error) {
      console.error("Erro ao carregar logs:", error);
      setLogs([]);
    }
  };

  const viewLog = async (filePath: string) => {
    try {
      const content: string = await invoke("get_log_content", { instanceId, filePath });
      setLogContent(content);
      setSelectedLog(filePath);
    } catch (error) {
      console.error("Erro ao ler log:", error);
    }
  };

  const extractVersion = (fileName: string): string => {
    const match = fileName.match(/[\d]+\.[\d]+\.?[\d]*/);
    return match ? match[0] : "";
  };

  const searchContent = async (query: string, acumular = false) => {
    if (!instanceDetails) return;
    if (acumular && carregandoMaisResultadosRef.current) return;
    if (!acumular) offsetsBuscaPorFonteRef.current = { modrinth: 0, curseforge: 0 };
    const assinaturaBusca = { query, filter: activeFilter, source: browseSource };
    lastSearch.current = assinaturaBusca;
    if (acumular) {
      carregandoMaisResultadosRef.current = true;
      setCarregandoMaisResultados(true);
    } else {
      setSearching(true);
      setTemMaisResultados(true);
    }
    try {
      const typeMap: Record<ContentFilter, string> = {
        mods: "mod",
        resourcepacks: "resourcepack",
        shaders: "shader",
      };
      const tipoConteudo = typeMap[activeFilter];
      const loaderInstancia = instanceDetails.loaderType?.trim().toLowerCase();
      const fontes: BrowseSource[] = browseSource === "ambas"
        ? ["modrinth", "curseforge"]
        : [browseSource];
      const promessaFavoritos = acumular
        ? Promise.resolve([] as FavoriteItem[])
        : hidratarDownloadsFavoritos(loadFavorites()
            .filter((item) => item.type === tipoConteudo)
            .filter((item) => browseSource === "ambas" || item.source === browseSource)
            .filter((item) => !query.trim()
              || `${item.title} ${item.author}`.toLowerCase().includes(query.trim().toLowerCase())));
      const paginas = await Promise.all(fontes.map(async (fonte) => {
        const resultados: any[] = await invoke("search_mods_online", {
          query,
          platform: fonte,
          contentType: tipoConteudo,
          filtros: {
            gameVersion: instanceDetails.version,
            loader: tipoConteudo === "mod" && loaderInstancia ? loaderInstancia : null,
            offset: offsetsBuscaPorFonteRef.current[fonte],
            limit: 20,
          },
        });
        return { fonte, resultados };
      }));

      const maiorPagina = Math.max(...paginas.map(({ resultados }) => resultados.length));
      const resultadosIntercalados = Array.from({ length: maiorPagina }).flatMap((_, indice) =>
        paginas.flatMap(({ fonte, resultados }) => resultados[indice] ? [{ fonte, item: resultados[indice] }] : [])
      );
      const paginaApiBruta = resultadosIntercalados.map(({ fonte, item }: { fonte: BrowseSource; item: any }) => ({
          id: String(item.id || ""),
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
          slug:
            String(item.slug || "").trim() ||
            String(item.id || "").trim(),
          project_type: String(item.projectType || item.project_type || tipoConteudo),
          latest_version: item.latestVersion || item.latest_version || undefined,
          file_name: item.fileName || item.file_name || undefined,
          source: fonte,
          fontes: [fonte],
          idsPorFonte: { [fonte]: String(item.id || "") },
        } satisfies SearchResult));
      const paginaApi = Array.from(paginaApiBruta.reduce((mapa, item) => {
        const chave = chaveCorrespondenciaProjeto(item) || `${item.source}:${item.id}`;
        const existente = mapa.get(chave);
        mapa.set(chave, existente ? mesclarResultadosBusca(existente, item) : item);
        return mapa;
      }, new Map<string, SearchResult>()).values());
      const favoritos = (await promessaFavoritos)
        .map((item) => ({
          id: item.id,
          title: item.title,
          description: item.description,
          icon_url: item.icon_url || undefined,
          author: item.author,
          slug: item.slug,
          project_type: item.type,
          source: item.source,
          fontes: [item.source],
          downloads: item.downloads,
          idsPorFonte: { [item.source]: item.id },
        } satisfies SearchResult))
        .filter((item) => !projetoJaInstalado(item));
      const pagina = Array.from([...favoritos, ...paginaApi].reduce((mapa, item) => {
        const chave = chaveCorrespondenciaProjeto(item) || `${item.source}:${item.id}`;
        const existente = mapa.get(chave);
        mapa.set(chave, existente ? mesclarResultadosBusca(existente, item) : item);
        return mapa;
      }, new Map<string, SearchResult>()).values());
      if (lastSearch.current.query !== assinaturaBusca.query
          || lastSearch.current.filter !== assinaturaBusca.filter
          || lastSearch.current.source !== assinaturaBusca.source) {
        return;
      }
      paginas.forEach(({ fonte, resultados }) => {
        offsetsBuscaPorFonteRef.current[fonte] += resultados.length;
      });
      setTemMaisResultados(paginas.some(({ resultados }) => resultados.length === 20));
      setSearchResults((atuais) => {
        if (!acumular) return pagina;
        const resultados = new Map<string, SearchResult>();
        for (const item of [...atuais, ...pagina]) {
          const chave = chaveCorrespondenciaProjeto(item) || `${item.source}:${item.id}`;
          const existente = resultados.get(chave);
          resultados.set(chave, existente ? mesclarResultadosBusca(existente, item) : item);
        }
        return Array.from(resultados.values());
      });
    } catch (error) {
      console.error("Erro ao buscar:", error);
      if (!acumular) setSearchResults([]);
    } finally {
      if (acumular) {
        carregandoMaisResultadosRef.current = false;
        setCarregandoMaisResultados(false);
      } else {
        setSearching(false);
      }
    }
  };

  const installContent = async (item: SearchResult) => {
    if (!instanceDetails) return;
    const chaveInstalacao = `${item.source}:${item.id}`;
    if (instalacoesEmAndamentoRef.current.has(chaveInstalacao)) return;

    instalacoesEmAndamentoRef.current.add(chaveInstalacao);
    setInstalacoesEmAndamento(new Set(instalacoesEmAndamentoRef.current));

    try {
      const typeMap: Record<ContentFilter, string> = {
        mods: "mod",
        resourcepacks: "resourcepack",
        shaders: "shader",
      };
      const tipoProjeto = typeMap[activeFilter];

      if (item.source === "curseforge") {
        if (tipoProjeto === "mod") {
          await invoke("install_mod", {
            instanceId,
            modInfo: {
              id: item.id,
              name: item.title,
              description: item.description,
              author: item.author,
              version: item.latest_version || "latest",
              download_url: "",
              file_name: item.file_name || "",
              platform: "curseforge",
              dependencies: [],
            },
          });
        } else {
          await invoke("install_curseforge_project_file", {
            instanceId,
            projectType: tipoProjeto,
            projectId: item.id,
          });
        }

        const cacheConteudo = lerCacheConteudoInstalado();
        const tipoProjetoCache = tipoProjeto as TipoProjetoCache;
        const nomeArquivoCache = item.file_name || item.slug || item.id;
        definirRegistroCacheConteudo(cacheConteudo, instanceId, tipoProjetoCache, nomeArquivoCache, {
          name: item.title,
          author: item.author,
          icon: item.icon_url,
          projectId: item.id,
          source: "curseforge",
          projectType: tipoProjetoCache,
          latestVersion: item.latest_version,
          updateAvailable: false,
        });
        salvarCacheConteudoInstalado(cacheConteudo);

        await loadInstalledContent(activeFilter);
        return;
      }

      // Determinar o loader correto para filtrar versões
      const loaderType = instanceDetails.loaderType?.toLowerCase() || "";
      const loadersSuportados = ["fabric", "forge", "quilt", "neoforge"];
      const params = new URLSearchParams();
      params.set("game_versions", JSON.stringify([instanceDetails.version]));
      if (activeFilter === "mods" && loadersSuportados.includes(loaderType)) {
        params.set("loaders", JSON.stringify([loaderType]));
      }
      
      // Buscar versões compatíveis com versão do MC E loader
      const versionsRes = await fetch(
        `https://api.modrinth.com/v2/project/${item.id}/version?${params.toString()}`
      );
      const versions = await versionsRes.json();

      if (versions.length === 0) {
        const alvoCompat = loaderType ? `${loaderType} ${instanceDetails.version}` : instanceDetails.version;
        alert(`Nenhuma versão compatível com ${alvoCompat}`);
        return;
      }

      const version = versions[0];
      const file = version.files.find((f: any) => f.primary) || version.files[0];

      if (!file) {
        alert("Arquivo não encontrado");
        return;
      }

      if (tipoProjeto === "mod") {
        await invoke("install_mod", {
          instanceId,
          modInfo: {
            id: item.id,
            name: item.title,
            description: item.description,
            author: item.author,
            version: version.version_number,
            download_url: file.url,
            file_name: file.filename,
            platform: "modrinth",
            dependencies: [],
            version_id: version.id,
          },
        });
      } else {
        await invoke("install_project_file", {
          instanceId,
          projectType: tipoProjeto,
          downloadUrl: file.url,
          fileName: file.filename,
        });
      }

      const cacheConteudo = lerCacheConteudoInstalado();
      const tipoProjetoCache = tipoProjeto as TipoProjetoCache;
      const nomeArquivoCache = file.filename || item.file_name || item.slug || item.id;
      definirRegistroCacheConteudo(cacheConteudo, instanceId, tipoProjetoCache, nomeArquivoCache, {
        name: item.title,
        author: item.author,
        icon: item.icon_url,
        projectId: item.id,
        source: "modrinth",
        projectType: tipoProjetoCache,
        latestVersion: version.version_number,
        updateAvailable: false,
        updateFileName: undefined,
        updateDownloadUrl: undefined,
        atualizacaoVerificadaEm: Date.now(),
      });
      salvarCacheConteudoInstalado(cacheConteudo);

      await loadInstalledContent(activeFilter);
    } catch (error) {
      console.error("Erro ao instalar:", error);
      alert(`Erro: ${error}`);
    } finally {
      instalacoesEmAndamentoRef.current.delete(chaveInstalacao);
      setInstalacoesEmAndamento(new Set(instalacoesEmAndamentoRef.current));
    }
  };

  const toggleMod = async (mod: InstalledMod) => {
    const tipoProjeto = tipoProjetoPorFiltro(activeFilter);
    try {
      const novoNomeArquivo = await invoke<string>("toggle_project_file_enabled", {
        instanceId,
        projectType: tipoProjeto,
        fileName: mod.fileName,
        enabled: !mod.enabled,
      });

      const cacheConteudo = lerCacheConteudoInstalado();
      const registroAtual = obterRegistroCacheConteudo(
        cacheConteudo,
        instanceId,
        tipoProjeto,
        mod.fileName
      );
      if (registroAtual) {
        removerRegistroCacheConteudo(cacheConteudo, instanceId, tipoProjeto, mod.fileName);
        definirRegistroCacheConteudo(cacheConteudo, instanceId, tipoProjeto, novoNomeArquivo, {
          ...registroAtual,
        });
        salvarCacheConteudoInstalado(cacheConteudo);
      }

      await loadInstalledContent(activeFilter);
    } catch (error) {
      console.error("Erro ao alternar estado do arquivo:", error);
      alert(`Erro ao alterar estado: ${error}`);
    }
  };

  const removerConteudoInstalado = async (mod: InstalledMod, filtro: ContentFilter) => {
    const tipoProjeto = tipoProjetoPorFiltro(filtro);
    try {
      await invoke("remove_project_file", {
        instanceId,
        projectType: tipoProjeto,
        fileName: mod.fileName,
      });
      atualizarListaPorTipo(tipoProjeto, (prev) =>
        prev.filter((m) => m.fileName !== mod.fileName)
      );

      const cacheConteudo = lerCacheConteudoInstalado();
      removerRegistroCacheConteudo(cacheConteudo, instanceId, tipoProjeto, mod.fileName);
      salvarCacheConteudoInstalado(cacheConteudo);
    } catch (error) {
      console.error("Erro ao remover:", error);
    }
  };

  const deleteMod = async (mod: InstalledMod) => {
    if (!confirm(`Remover "${mod.name}"?`)) return;
    await removerConteudoInstalado(mod, activeFilter);
  };

  const alternarSelecaoArquivo = (fileName: string) => {
    const selecionando = !arquivosSelecionados.has(fileName);
    if (selecionando) setModoSelecaoLote(true);

    setArquivosSelecionados((anterior) => {
      const proximo = new Set(anterior);
      if (proximo.has(fileName)) {
        proximo.delete(fileName);
      } else {
        proximo.add(fileName);
      }
      return proximo;
    });
  };

  const selecionarTodosArquivos = (lista: InstalledMod[]) => {
    const nomesVisiveis = lista.map((item) => item.fileName);
    const todosSelecionados = nomesVisiveis.every((nome) => arquivosSelecionados.has(nome));
    if (!todosSelecionados) setModoSelecaoLote(true);

    setArquivosSelecionados((anterior) => {
      const proximo = new Set(anterior);
      if (todosSelecionados) {
        nomesVisiveis.forEach((nome) => proximo.delete(nome));
      } else {
        nomesVisiveis.forEach((nome) => proximo.add(nome));
      }
      return proximo;
    });
  };

  const executarAcaoEmLote = async (
    acao: "remover" | "ativar" | "desativar",
    itensAlvo: InstalledMod[]
  ) => {
    if (itensAlvo.length === 0 || processandoLote) return;
    const tipoProjeto = tipoProjetoPorFiltro(activeFilter);
    setProcessandoLote(true);
    try {
      for (const item of itensAlvo) {
        if (acao === "remover") {
          await removerConteudoInstalado(item, activeFilter);
          continue;
        }

        const deveFicarAtivo = acao === "ativar";
        if (item.enabled === deveFicarAtivo) continue;
        await invoke("toggle_project_file_enabled", {
          instanceId,
          projectType: tipoProjeto,
          fileName: item.fileName,
          enabled: deveFicarAtivo,
        });
      }

      setArquivosSelecionados(new Set());
      await loadInstalledContent(activeFilter);
    } catch (error) {
      console.error("Erro ao executar ação em lote:", error);
      alert(`Erro ao processar itens selecionados: ${error}`);
    } finally {
      setProcessandoLote(false);
    }
  };

  const atualizarItemInstalado = async (item: InstalledMod, filtro: ContentFilter) => {
    const tipoProjeto = tipoProjetoPorFiltro(filtro);
    if (!item.projectId) return;
    if (item.updating) return;

    atualizarListaPorTipo(tipoProjeto, (prev) =>
      prev.map((m) => (m.fileName === item.fileName ? { ...m, updating: true } : m))
    );

    try {
      if (item.source === "curseforge") {
        if (tipoProjeto === "mod") {
          await invoke("install_mod", {
            instanceId,
            modInfo: {
              id: item.projectId,
              name: item.name,
              description: "",
              author: item.author,
              version: item.latestVersion || "latest",
              download_url: "",
              file_name: "",
              platform: "curseforge",
              dependencies: [],
            },
          });
        } else {
          await invoke("install_curseforge_project_file", {
            instanceId,
            projectType: tipoProjeto,
            projectId: item.projectId,
          });
        }
      } else {
        let downloadUrl = item.updateDownloadUrl;
        let fileName = item.updateFileName;
        let latestVersion = item.latestVersion;
        let versionId: string | undefined;

        if (!downloadUrl || !fileName) {
          const params = new URLSearchParams();
          params.set("game_versions", JSON.stringify([instanceDetails?.version || ""]));
          if (tipoProjeto === "mod") {
            const loaderAtual = (instanceDetails?.loaderType || "").toLowerCase();
            if (["fabric", "forge", "quilt", "neoforge"].includes(loaderAtual)) {
              params.set("loaders", JSON.stringify([loaderAtual]));
            }
          }

          const resposta = await fetch(
            `https://api.modrinth.com/v2/project/${item.projectId}/version?${params.toString()}`
          );
          const versoes = await resposta.json();
          const versaoAlvo = Array.isArray(versoes) ? versoes[0] : null;
          const arquivoAlvo =
            versaoAlvo?.files?.find((f: any) => f?.primary) || versaoAlvo?.files?.[0];
          if (!arquivoAlvo?.url || !arquivoAlvo?.filename) {
            throw new Error("Nenhuma atualização compatível encontrada.");
          }
          downloadUrl = String(arquivoAlvo.url);
          fileName = String(arquivoAlvo.filename);
          latestVersion = String(versaoAlvo?.version_number || latestVersion || "");
          versionId = versaoAlvo?.id ? String(versaoAlvo.id) : undefined;
        }

        if (tipoProjeto === "mod") {
          await invoke("install_mod", {
            instanceId,
            modInfo: {
              id: item.projectId,
              name: item.name,
              description: "",
              author: item.author,
              version: latestVersion || item.version || "latest",
              download_url: downloadUrl,
              file_name: fileName,
              platform: "modrinth",
              dependencies: [],
              version_id: versionId,
            },
          });
        } else {
          await invoke("install_project_file", {
            instanceId,
            projectType: tipoProjeto,
            downloadUrl,
            fileName,
          });
        }
      }

      if (item.updateFileName && item.updateFileName !== item.fileName) {
        await removerConteudoInstalado(item, filtro);
      }

      await loadInstalledContent(filtro);
    } catch (error) {
      console.error("Erro ao atualizar conteúdo:", error);
      alert(`Erro ao atualizar "${item.name}": ${error}`);
      atualizarListaPorTipo(tipoProjeto, (prev) =>
        prev.map((m) => (m.fileName === item.fileName ? { ...m, updating: false } : m))
      );
    }
  };

  const atualizarTodosConteudos = async () => {
    if (updatingAll) return;

    const tipoProjeto = tipoProjetoPorFiltro(activeFilter);
    const listaAtual =
      tipoProjeto === "mod"
        ? installedMods
        : tipoProjeto === "resourcepack"
          ? installedResourcePacks
          : installedShaders;
    const pendentes = listaAtual.filter((item) => item.updateAvailable);
    if (pendentes.length === 0) return;

    setUpdatingAll(true);
    try {
      for (const item of pendentes) {
        await atualizarItemInstalado(item, activeFilter);
      }
    } finally {
      setUpdatingAll(false);
    }
  };

  const abrirDetalhesConteudoInstalado = (item: InstalledMod, filtro: ContentFilter) => {
    if (!onAbrirProjeto || !item.projectId || !item.source) return;
    onAbrirProjeto({
      id: item.projectId,
      title: item.name,
      description: "",
      icon_url: item.icon || "",
      author: item.author,
      slug: item.projectId,
      source: item.source,
      project_type: tipoProjetoPorFiltro(filtro),
    });
  };

  const carregarVersoesConteudo = async (item: InstalledMod, filtro: ContentFilter) => {
    if (!item.projectId || !item.source || !instanceDetails) return;
    setCarregandoVersoesConteudo(true);
    setErroTrocaVersao(null);
    setVersoesConteudo([]);
    try {
      let versoes: VersaoConteudo[];
      if (item.source === "curseforge") {
        const loader = filtro === "mods"
          ? (instanceDetails.loaderType || instanceDetails.mcType || "").toLowerCase()
          : null;
        versoes = await invoke<VersaoConteudo[]>("listar_versoes_projeto_curseforge", {
          projectId: item.projectId,
          gameVersion: instanceDetails.version,
          loader,
          projectType: tipoProjetoPorFiltro(filtro),
        });
      } else {
        const parametros = new URLSearchParams({
          game_versions: JSON.stringify([instanceDetails.version]),
        });
        if (filtro === "mods") {
          const loader = (instanceDetails.loaderType || instanceDetails.mcType || "").toLowerCase();
          if (["fabric", "forge", "quilt", "neoforge"].includes(loader)) {
            parametros.set("loaders", JSON.stringify([loader]));
          }
        }
        const resposta = await fetch(
          `https://api.modrinth.com/v2/project/${item.projectId}/version?${parametros.toString()}`
        );
        if (!resposta.ok) throw new Error(`Modrinth respondeu com status ${resposta.status}.`);
        versoes = await resposta.json() as VersaoConteudo[];
      }

      const compativeis = versoes.filter((versao) => versao.files?.length > 0);
      if (compativeis.length === 0) {
        throw new Error("Nenhuma versão compatível foi encontrada para esta instância.");
      }
      setVersoesConteudo(compativeis);
      const nomeArquivoAtual = item.fileName.replace(/\.disabled$/i, "");
      const atual = compativeis.find((versao) =>
        versao.version_number === item.version ||
        versao.files.some((arquivo) => arquivo.filename === nomeArquivoAtual)
      );
      setVersaoConteudoSelecionadaId(atual?.id || compativeis[0].id);
    } catch (erro) {
      setErroTrocaVersao(erro instanceof Error ? erro.message : String(erro));
    } finally {
      setCarregandoVersoesConteudo(false);
    }
  };

  const abrirTrocaVersao = (item: InstalledMod, filtro: ContentFilter) => {
    setMenuConteudo(null);
    setItemTrocaVersao(item);
    setFiltroTrocaVersao(filtro);
    void carregarVersoesConteudo(item, filtro);
  };

  const trocarVersaoConteudo = async () => {
    if (!itemTrocaVersao || !itemTrocaVersao.projectId || !itemTrocaVersao.source) return;
    const versao = versoesConteudo.find((item) => item.id === versaoConteudoSelecionadaId);
    const arquivo = versao?.files.find((item) => item.primary) || versao?.files[0];
    if (!versao || !arquivo) return;

    const tipoProjeto = tipoProjetoPorFiltro(filtroTrocaVersao);
    setTrocandoVersaoConteudo(true);
    setErroTrocaVersao(null);
    try {
      if (tipoProjeto === "mod") {
        await invoke("install_mod", {
          instanceId,
          modInfo: {
            id: itemTrocaVersao.projectId,
            name: itemTrocaVersao.name,
            description: "",
            author: itemTrocaVersao.author,
            version: versao.version_number,
            download_url: arquivo.url,
            file_name: arquivo.filename,
            platform: itemTrocaVersao.source,
            dependencies: [],
            version_id: versao.id,
          },
        });
      } else {
        await invoke("install_project_file", {
          instanceId,
          projectType: tipoProjeto,
          downloadUrl: arquivo.url,
          fileName: arquivo.filename,
        });
      }

      if (arquivo.filename !== itemTrocaVersao.fileName) {
        await removerConteudoInstalado(itemTrocaVersao, filtroTrocaVersao);
      }
      await loadInstalledContent(filtroTrocaVersao);
      setItemTrocaVersao(null);
    } catch (erro) {
      console.error("Erro ao trocar versão do conteúdo:", erro);
      setErroTrocaVersao(erro instanceof Error ? erro.message : String(erro));
    } finally {
      setTrocandoVersaoConteudo(false);
    }
  };

  const deleteWorld = async (world: WorldInfo) => {
    if (!confirm(`Deletar mundo "${world.name}"? Esta ação não pode ser desfeita.`)) return;
    try {
      await invoke("delete_world", { instanceId, worldPath: world.path });
      await loadWorlds();
    } catch (error) {
      console.error("Erro ao deletar mundo:", error);
    }
  };

  const launchInstance = async () => {
    try {
      await invoke("launch_instance", { id: instanceId });

      try {
        const configuracoes = await invoke<ConfiguracoesGlobais>("get_settings");
        if (configuracoes?.close_on_launch) {
          await getCurrentWindow().minimize();
        }
      } catch (erroConfig) {
        console.warn("Falha ao aplicar close_on_launch:", erroConfig);
      }
    } catch (error) {
      console.error("Erro ao iniciar:", error);
      alert(`Erro: ${error}`);
    }
  };

  const saveInstanceSettings = async () => {
    if (!instanceDetails) return;
    const nomeAtualizado = editName.trim();
    if (!nomeAtualizado) {
      alert("O nome da instância não pode ficar vazio.");
      return;
    }

    setSaving(true);
    try {
      let idAtual = instanceId;

      // Atualizar nome se mudou
      if (nomeAtualizado !== instanceDetails.name) {
        idAtual = await invoke<string>("rename_instance_folder", {
          instanceId,
          newFolderName: nomeAtualizado,
        });
        await invoke("update_instance_name", {
          instanceId: idAtual,
          newName: nomeAtualizado,
        });
      }

      if (editIcon && editIcon !== instanceDetails.icon) {
        await invoke("update_instance_icon", {
          instanceId: idAtual,
          icon: editIcon,
        });
      }

      setIsEditing(false);
      if (idAtual !== instanceId) {
        onInstanceUpdate?.(idAtual);
        return;
      }

      await loadInstanceDetails();
      onInstanceUpdate?.();
    } catch (error) {
      console.error("Erro ao salvar:", error);
      alert(`Erro ao salvar: ${error}`);
    } finally {
      setSaving(false);
    }
  };

  const abrirPaginaProjeto = (item: SearchResult) => {
    if (!onAbrirProjeto) return;

    onAbrirProjeto({
      id: item.id,
      title: item.title,
      description: item.description,
      icon_url: item.icon_url || "",
      author: item.author,
      slug: item.slug,
      source: item.source,
      project_type: tipoProjetoPorFiltro(activeFilter),
      downloads: item.downloads,
    });
  };

  const startEditingInstance = () => {
    if (!instanceDetails) return;
    setEditName(instanceDetails.name);
    setEditIcon(instanceDetails.icon || "");
    setIsEditing(true);
  };

  const editarNomeDiretamente = () => {
    startEditingInstance();
    requestAnimationFrame(() => {
      nomeInstanciaRef.current?.focus();
      nomeInstanciaRef.current?.select();
    });
  };

  const editarIconeDiretamente = () => {
    editorIconeAbriuEdicaoRef.current = !isEditing;
    startEditingInstance();
    setEditorIconeAberto(true);
  };

  const salvarIconeDiretamente = async (icone: string) => {
    if (!instanceDetails) return;
    await invoke("update_instance_icon", { instanceId, icon: icone });
    setEditIcon(icone);
    await loadInstanceDetails();
    onInstanceUpdate?.();
    if (editorIconeAbriuEdicaoRef.current) setIsEditing(false);
    editorIconeAbriuEdicaoRef.current = false;
  };

  const cancelEditingInstance = () => {
    if (instanceDetails) {
      setEditName(instanceDetails.name);
      setEditIcon(instanceDetails.icon || "");
    }
    setIsEditing(false);
  };

  const openInstanceFolder = async () => {
    setShowMoreMenu(false);
    if (!instanceDetails?.path) return;

    try {
      await invoke("abrir_pasta_instancia", { instanceId });
    } catch (error) {
      console.error("Erro ao abrir local da instância:", error);
      alert("Não foi possível abrir o local da instância.");
    }
  };

  const deleteInstance = async () => {
    if (!confirm(`Excluir instância "${instanceDetails?.name}"? Esta ação não pode ser desfeita.`)) return;
    try {
      await invoke("delete_instance", { id: instanceId });

      const cacheConteudo = lerCacheConteudoInstalado();
      removerCacheInstanciaInteira(cacheConteudo, instanceId);
      salvarCacheConteudoInstalado(cacheConteudo);

      onBack();
      onInstanceUpdate?.();
    } catch (error) {
      console.error("Erro ao excluir:", error);
      alert(`Erro: ${error}`);
    }
  };

  const abrirPastaMundo = async (worldPath: string) => {
    try {
      await invoke("abrir_pasta_mundo", { instanceId, worldPath });
    } catch (error) {
      console.error("Erro ao abrir pasta do mundo:", error);
    }
  };

  // Obter conteúdo baseado no filtro ativo
  const currentContent = 
    activeFilter === "mods" ? installedMods :
    activeFilter === "resourcepacks" ? installedResourcePacks :
    installedShaders;

  // Filtrar conteúdo instalado
  const filteredContent = currentContent.filter((item) =>
    item.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const itensSelecionados = currentContent.filter((item) =>
    arquivosSelecionados.has(item.fileName)
  );
  const todosConteudosVisiveisSelecionados =
    filteredContent.length > 0 &&
    filteredContent.every((item) => arquivosSelecionados.has(item.fileName));
  const quantidadeAtualizaveis = filteredContent.filter((item) => item.updateAvailable).length;
  const mostrarControlesAtualizacao = quantidadeAtualizaveis > 0 || updatingAll;

  const sincronizarIndicadorRolagem = useCallback(() => {
    const lista = listaConteudoRef.current;
    if (!lista) return;

    const { clientHeight, scrollHeight, scrollTop } = lista;
    if (scrollHeight <= clientHeight) {
      setIndicadorRolagem({ altura: 0, topo: 0, visivel: false });
      return;
    }

    const alturaTrilho = Math.max(0, clientHeight - 16);
    const altura = Math.max(36, (alturaTrilho * clientHeight) / scrollHeight);
    const topoMaximo = alturaTrilho - altura;
    const topo = (scrollTop / (scrollHeight - clientHeight)) * topoMaximo;
    setIndicadorRolagem({ altura, topo, visivel: true });
  }, []);

  const aoRolarListaConteudo = () => {
    sincronizarIndicadorRolagem();
    const lista = listaConteudoRef.current;
    if (!lista || viewMode !== "browse" || searching || carregandoMaisResultados || !temMaisResultados) {
      return;
    }

    const distanciaDoFim = lista.scrollHeight - lista.scrollTop - lista.clientHeight;
    if (distanciaDoFim <= 240) {
      void searchContent(lastSearch.current.query, true);
    }
  };

  const rolarAoClicarTrilho = useCallback((evento: React.MouseEvent<HTMLDivElement>) => {
    if (evento.target !== evento.currentTarget) return;

    const lista = listaConteudoRef.current;
    if (!lista) return;

    const limites = evento.currentTarget.getBoundingClientRect();
    const posicaoClique = evento.clientY - limites.top;
    const centroIndicador = indicadorRolagem.topo + indicadorRolagem.altura / 2;
    const direcao = posicaoClique < centroIndicador ? -1 : 1;

    lista.scrollBy({
      top: direcao * lista.clientHeight * 0.85,
      behavior: "smooth",
    });
  }, [indicadorRolagem.altura, indicadorRolagem.topo]);

  const iniciarArrasteIndicador = useCallback((evento: React.PointerEvent<HTMLDivElement>) => {
    const lista = listaConteudoRef.current;
    if (!lista) return;

    evento.preventDefault();
    evento.stopPropagation();
    evento.currentTarget.setPointerCapture(evento.pointerId);
    arrasteIndicadorRef.current = {
      ponteiroId: evento.pointerId,
      inicioY: evento.clientY,
      scrollInicial: lista.scrollTop,
    };
  }, []);

  const arrastarIndicador = useCallback((evento: React.PointerEvent<HTMLDivElement>) => {
    const lista = listaConteudoRef.current;
    const arraste = arrasteIndicadorRef.current;
    if (!lista || !arraste || arraste.ponteiroId !== evento.pointerId) return;

    const alturaTrilho = Math.max(0, lista.clientHeight - 16);
    const percursoIndicador = alturaTrilho - indicadorRolagem.altura;
    const percursoConteudo = lista.scrollHeight - lista.clientHeight;
    if (percursoIndicador <= 0 || percursoConteudo <= 0) return;

    const deltaY = evento.clientY - arraste.inicioY;
    lista.scrollTop = arraste.scrollInicial + (deltaY / percursoIndicador) * percursoConteudo;
  }, [indicadorRolagem.altura]);

  const encerrarArrasteIndicador = useCallback((evento: React.PointerEvent<HTMLDivElement>) => {
    if (arrasteIndicadorRef.current?.ponteiroId !== evento.pointerId) return;
    arrasteIndicadorRef.current = null;
    if (evento.currentTarget.hasPointerCapture(evento.pointerId)) {
      evento.currentTarget.releasePointerCapture(evento.pointerId);
    }
  }, []);

  const rolarIndicadorComTeclado = useCallback((evento: React.KeyboardEvent<HTMLDivElement>) => {
    const lista = listaConteudoRef.current;
    if (!lista) return;

    const deslocamentos: Record<string, number> = {
      ArrowUp: -48,
      ArrowDown: 48,
      PageUp: -lista.clientHeight * 0.85,
      PageDown: lista.clientHeight * 0.85,
      Home: -lista.scrollHeight,
      End: lista.scrollHeight,
    };
    const deslocamento = deslocamentos[evento.key];
    if (deslocamento === undefined) return;

    evento.preventDefault();
    lista.scrollBy({ top: deslocamento, behavior: "smooth" });
  }, []);

  useEffect(() => {
    const quadro = requestAnimationFrame(sincronizarIndicadorRolagem);
    window.addEventListener("resize", sincronizarIndicadorRolagem);
    return () => {
      cancelAnimationFrame(quadro);
      window.removeEventListener("resize", sincronizarIndicadorRolagem);
    };
  }, [
    activeFilter,
    filteredContent.length,
    loading,
    searchResults.length,
    sincronizarIndicadorRolagem,
    viewMode,
  ]);
  const idsProjetosInstalados = new Set(
    currentContent
      .map((item) => (item.projectId ? String(item.projectId).toLowerCase() : ""))
      .filter((item) => item.length > 0)
  );
  const favoritosAtuais = loadFavorites();

  const projetoJaInstalado = (item: SearchResult) => {
    const idsProjeto = new Set([
      item.id,
      ...Object.values(item.idsPorFonte ?? {}),
    ].filter((id): id is string => Boolean(id)).map((id) => id.toLowerCase()));
    if ([...idsProjeto].some((id) => idsProjetosInstalados.has(id))) return true;

    return currentContent.some((instalado) =>
      arquivoPodePertencerAoProjeto(instalado.fileName, item.slug)
    );
  };

  const projetoFavorito = (item: SearchResult) => {
    const idsProjeto = new Set([
      item.id,
      ...Object.values(item.idsPorFonte ?? {}),
    ].filter((id): id is string => Boolean(id)));
    const chaveProjeto = chaveCorrespondenciaProjeto(item);
    return favoritosAtuais.some((favorito) =>
      idsProjeto.has(favorito.id) || chaveCorrespondenciaProjeto(favorito) === chaveProjeto
    );
  };

  // Filtros disponíveis baseado no tipo de instância
  const availableFilters: ContentFilter[] = isVanilla 
    ? ["resourcepacks"] 
    : ["mods", "resourcepacks", "shaders"];

  // Ajustar filtro se necessário
  useEffect(() => {
    if (!instanceDetails) return;
    setActiveFilter(isVanilla ? "resourcepacks" : "mods");
  }, [instanceDetails?.id, isVanilla]);

  if (!instanceDetails) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="animate-spin text-emerald-500" size={32} />
      </div>
    );
  }

  const filterIcons: Record<ContentFilter, any> = {
    mods: Package,
    resourcepacks: Image,
    shaders: Sparkles,
  };

  return (
    <div className="flex flex-col h-full bg-[#0d0d0e]">
      {/* Header */}
      <div className="bg-[#121214] border-b border-white/5 px-6 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {/* Ícone editável */}
            <button
              type="button"
              onClick={editarIconeDiretamente}
              aria-label="Editar ícone da instância"
              title="Editar ícone"
              className="relative group shrink-0 rounded-xl text-left"
            >
              <div className="w-14 h-14 rounded-xl bg-[#1a1a1c] border border-white/10 overflow-hidden flex items-center justify-center">
                <img
                  src={(isEditing ? editIcon : instanceDetails.icon) || ICONE_DOME_LAUNCHER}
                  alt=""
                  className="w-full h-full object-cover"
                />
              </div>
              <span className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/60 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
                <Pencil size={16} className="text-white" />
              </span>
            </button>

            <div className="min-w-0">
              {isEditing ? (
                <input
                  ref={nomeInstanciaRef}
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  aria-label="Nome da instância"
                  className="w-full max-w-sm rounded-lg border border-white/20 bg-white/5 px-3 py-1 text-xl font-bold text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              ) : (
                <div className="flex min-w-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={editarNomeDiretamente}
                    title="Editar nome"
                    className="min-w-0 cursor-text text-left"
                  >
                    <h1 className="truncate text-xl font-bold text-white">{instanceDetails.name}</h1>
                  </button>
                  <button 
                    onClick={editarNomeDiretamente}
                    className="p-1 rounded hover:bg-white/10 text-white/30 hover:text-white transition-colors"
                  >
                    <Pencil size={14} />
                  </button>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/50">
                <span className="flex items-center gap-1">
                  <Globe size={14} />
                  {instanceDetails.loaderType || "Vanilla"} {instanceDetails.version}
                </span>
                <span className="flex items-center gap-1">
                  <Clock size={14} />
                  {formatarTempoJogadoTotal(instanceDetails.tempoTotalJogadoSegundos)}
                </span>
                <span className="flex items-center gap-1">
                  <Calendar size={14} />
                  {formatarUltimoAcesso(instanceDetails.lastPlayed)}
                </span>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {onAbrirSocial && (
              <button
                onClick={onAbrirSocial}
                aria-label="Abrir barra social"
                className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 transition-colors xl:hidden"
              >
                <Users size={18} className="text-white/60" />
              </button>
            )}
            {isEditing ? (
              <>
                <button
                  onClick={cancelEditingInstance}
                  className="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white/60 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={saveInstanceSettings}
                  disabled={saving}
                  className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-black px-4 py-2 rounded-xl font-bold transition-all active:scale-95 disabled:opacity-50"
                >
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  Salvar
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={launchInstance}
                  className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-black px-5 py-2.5 rounded-xl font-bold transition-all active:scale-95"
                >
                  <Play size={18} fill="currentColor" />
                  Play
                </button>
                
                {/* More Options Button */}
                <div className="relative">
                  <button 
                    onClick={() => setShowMoreMenu(!showMoreMenu)}
                    className="p-2.5 rounded-xl bg-white/5 hover:bg-white/10 transition-colors"
                  >
                    <MoreVertical size={18} className="text-white/60" />
                  </button>
                  
                  {showMoreMenu && (
                    <div className="absolute right-0 top-full mt-2 w-56 bg-[#1a1a1c] border border-white/10 rounded-xl shadow-xl z-50">
                      <div className="p-2">
                        <button 
                          onClick={() => { startEditingInstance(); setShowMoreMenu(false); }}
                          className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/5 text-sm flex items-center gap-2"
                        >
                          <Pencil size={14} className="text-white/40" />
                          Editar instância
                        </button>
                        <button 
                          onClick={openInstanceFolder}
                          className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/5 text-sm flex items-center gap-2"
                        >
                          <FolderOpen size={14} className="text-white/40" />
                          Abrir local do arquivo
                        </button>
                        <div className="border-t border-white/5 my-1" />
                        <button 
                          onClick={deleteInstance}
                          className="w-full text-left px-3 py-2 rounded-lg hover:bg-red-500/10 text-red-400 text-sm flex items-center gap-2"
                        >
                          <Trash2 size={14} />
                          Excluir instância
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-6 pt-4 pb-2 border-b border-white/5">
        <div className="flex gap-1">
          {(
            isVanilla
              ? (["content", "worlds", "logs"] as ContentTab[])
              : (["content", "worlds", "configuration", "logs"] as ContentTab[])
          ).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "px-4 py-2 rounded-lg text-sm font-medium transition-all capitalize",
                activeTab === tab
                  ? "bg-emerald-500 text-black"
                  : "text-white/50 hover:text-white hover:bg-white/5"
              )}
            >
              {tab === "content"
                ? "Conteúdo"
                : tab === "worlds"
                  ? "Mundos"
                  : tab === "configuration"
                    ? "Configuração"
                    : "Logs"}
            </button>
          ))}
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-hidden flex flex-col" onClick={() => setShowMoreMenu(false)}>
        {activeTab === "content" && (
          <>
            {/* Search & Actions Bar */}
            <div className="flex flex-wrap items-center gap-3 border-b border-white/5 px-6 py-4">
              {viewMode === "browse" && (
                <button
                  onClick={() => setViewMode("installed")}
                  className="p-2 rounded-lg hover:bg-white/10 transition-colors text-white/60"
                >
                  <ChevronLeft size={20} />
                </button>
              )}

              <div className="relative min-w-[220px] flex-1">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={
                    viewMode === "installed"
                      ? `Buscar em ${filteredContent.length} projetos...`
                      : browseSource === "ambas"
                        ? "Buscar no Modrinth e CurseForge..."
                        : `Buscar no ${browseSource === "modrinth" ? "Modrinth" : "CurseForge"}...`
                  }
                  className="w-full bg-white/5 border border-white/10 rounded-lg py-2 pl-10 pr-10 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {viewMode === "installed" ? (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => {
                      setModoSelecaoLote((anterior) => !anterior);
                      setArquivosSelecionados(new Set());
                    }}
                    className={cn(
                      "px-3 py-2 rounded-lg text-xs font-bold border transition-all",
                      modoSelecaoLote
                        ? "bg-white/15 border-white/25 text-white"
                        : "bg-white/5 border-white/10 text-white/60 hover:text-white"
                    )}
                  >
                    {modoSelecaoLote ? "Cancelar seleção" : "Selecionar"}
                  </button>
                  <button
                    onClick={() => setViewMode("browse")}
                    className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-black px-4 py-2 rounded-lg font-medium text-sm transition-all whitespace-nowrap"
                  >
                    <Plus size={16} />
                    Adicionar conteúdo
                  </button>
                </div>
              ) : (
                <div className="flex bg-white/5 p-1 rounded-lg border border-white/10">
                  <button
                    onClick={() => setBrowseSource("ambas")}
                    className={cn(
                      "px-3 py-1.5 rounded text-xs font-bold transition-all",
                      browseSource === "ambas" ? "bg-white/15 text-white" : "text-white/40"
                    )}
                  >
                    Ambos
                  </button>
                  <button
                    onClick={() => setBrowseSource("modrinth")}
                    className={cn(
                      "px-3 py-1.5 rounded text-xs font-bold transition-all",
                      browseSource === "modrinth" ? "bg-emerald-500 text-black" : "text-white/40"
                    )}
                  >
                    Modrinth
                  </button>
                  <button
                    onClick={() => setBrowseSource("curseforge")}
                    className={cn(
                      "px-3 py-1.5 rounded text-xs font-bold transition-all",
                      browseSource === "curseforge" ? "bg-[#f16436] text-white" : "text-white/40"
                    )}
                  >
                    CurseForge
                  </button>
                </div>
              )}
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 px-6 py-3">
              <div className="flex flex-wrap items-center gap-2">
                {availableFilters.map((filter) => {
                  const Icon = filterIcons[filter];
                  return (
                    <button
                      key={filter}
                      onClick={() => setActiveFilter(filter)}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5",
                        activeFilter === filter
                          ? "bg-white/10 text-white"
                          : "text-white/40 hover:text-white/60"
                      )}
                    >
                      <Icon size={12} />
                      {filter === "resourcepacks" ? "Resource Packs" : filter.charAt(0).toUpperCase() + filter.slice(1)}
                    </button>
                  );
                })}
                
                {isVanilla && (
                  <span className="text-xs text-white/30 ml-2">
                    (Instância Vanilla - apenas resource packs)
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {viewMode === "installed" && mostrarControlesAtualizacao && (
                  <button
                    onClick={atualizarTodosConteudos}
                    disabled={updatingAll || quantidadeAtualizaveis === 0}
                    className={cn(
                      "flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-1.5",
                      "text-xs font-bold transition-colors",
                      updatingAll || quantidadeAtualizaveis === 0
                        ? "cursor-not-allowed border-white/10 bg-white/5 text-white/25"
                        : "border-amber-400/25 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
                    )}
                  >
                    {updatingAll ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Download size={12} />
                    )}
                    Atualizar todos
                  </button>
                )}

                {viewMode === "installed" && itensSelecionados.length > 0 && (
                  <>
                    <button
                      onClick={() => executarAcaoEmLote("ativar", itensSelecionados)}
                      disabled={processandoLote}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 disabled:opacity-40 transition-all"
                    >
                      Ativar ({itensSelecionados.length})
                    </button>
                    <button
                      onClick={() => executarAcaoEmLote("desativar", itensSelecionados)}
                      disabled={processandoLote}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 disabled:opacity-40 transition-all"
                    >
                      Desativar
                    </button>
                    <button
                      onClick={() => executarAcaoEmLote("remover", itensSelecionados)}
                      disabled={processandoLote}
                      className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-red-500/15 text-red-300 hover:bg-red-500/25 disabled:opacity-40 transition-all"
                    >
                      Excluir
                    </button>
                  </>
                )}

              </div>
            </div>

            {/* List */}
            <div className="relative min-h-0 flex-1">
              <div
                id="lista-conteudo-instancia"
                ref={listaConteudoRef}
                onScroll={aoRolarListaConteudo}
                className="h-full overflow-y-auto scrollbar-hide"
              >
              {viewMode === "installed" ? (
                loading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="animate-spin text-emerald-500" size={32} />
                  </div>
                ) : filteredContent.length === 0 ? (
                  <div className="flex items-center justify-center py-12 text-white/40">
                    <div className="text-center">
                      <Package size={40} className="mx-auto mb-3 opacity-30" />
                      <p className="font-medium">Nenhum conteúdo instalado</p>
                      <button
                        onClick={() => setViewMode("browse")}
                        className="mt-3 text-emerald-400 hover:text-emerald-300 text-sm"
                      >
                        + Adicionar conteúdo
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div
                      className={cn(
                        "sticky top-0 z-10 grid grid-cols-[2rem_3rem_minmax(0,1fr)_3.5rem_8rem]",
                        "items-center gap-x-4 border-b border-white/5",
                        "bg-[#0d0d0e] px-6 py-2 text-xs text-white/40"
                      )}
                    >
                      <div className="flex items-center justify-center">
                        <input
                          type="checkbox"
                          checked={todosConteudosVisiveisSelecionados}
                          onChange={() => selecionarTodosArquivos(filteredContent)}
                          className={cn(
                            "w-4 h-4 rounded border-white/20 bg-white/5 transition-opacity",
                            modoSelecaoLote
                              ? "opacity-100"
                              : "opacity-0 pointer-events-none"
                          )}
                        />
                      </div>
                      <div />
                      <div className="min-w-0">Nome</div>
                      <div className="text-right">Ativo</div>
                      <div />
                    </div>

                    {filteredContent.map((mod: InstalledMod) => (
                      <div
                        key={mod.fileName}
                        onContextMenu={(evento) => {
                          evento.preventDefault();
                          evento.stopPropagation();
                          setMenuConteudo({
                            item: mod,
                            filtro: activeFilter,
                            x: evento.clientX,
                            y: evento.clientY,
                          });
                        }}
                        className={cn(
                          "group grid grid-cols-[2rem_3rem_minmax(0,1fr)_3.5rem_8rem]",
                          "items-center gap-x-4 border-b border-white/5 px-6 py-3 hover:bg-white/2"
                        )}
                      >
                        <div
                          className={cn(
                            "flex items-center justify-center transition-opacity",
                            modoSelecaoLote || arquivosSelecionados.has(mod.fileName)
                              ? "opacity-100"
                              : "opacity-0 group-hover:opacity-100"
                          )}
                        >
                          <input
                            type="checkbox"
                            checked={arquivosSelecionados.has(mod.fileName)}
                            onChange={() => alternarSelecaoArquivo(mod.fileName)}
                            className="w-4 h-4 rounded border-white/20 bg-white/5"
                          />
                        </div>

                        <div
                          className={cn(
                            "flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden",
                            "rounded-lg border border-white/10 bg-white/5"
                          )}
                        >
                          {mod.icon ? (
                            <img src={mod.icon} alt="" className="w-full h-full object-cover" />
                          ) : (
                            <Package size={18} className="text-white/30" />
                          )}
                        </div>

                        <div className="min-w-0">
                          <p className="font-medium text-white truncate">{mod.name}</p>
                          <p className="text-xs text-white/40">por {mod.author}</p>
                          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] text-white/30">
                            <span className="shrink-0 font-semibold text-white/55">{mod.version || "-"}</span>
                            <span aria-hidden="true">•</span>
                            <span className="truncate">{mod.fileName}</span>
                          </div>
                          {mod.updateAvailable && (
                            <p className="text-[10px] text-amber-300 mt-0.5 uppercase tracking-wide">
                              Atualização disponível {mod.latestVersion ? `(${mod.latestVersion})` : ""}
                            </p>
                          )}
                        </div>

                        <div className="flex items-center justify-end">
                          <button
                            onClick={() => toggleMod(mod)}
                            aria-label={mod.enabled ? `Desativar ${mod.name}` : `Ativar ${mod.name}`}
                            className={cn(
                              "w-10 h-5 rounded-full transition-all relative",
                              mod.enabled ? "bg-emerald-500" : "bg-white/20"
                            )}
                          >
                            <div
                              className={cn(
                                "absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all",
                                mod.enabled ? "left-5" : "left-0.5"
                              )}
                            />
                          </button>
                        </div>

                        <div className="flex items-center justify-end gap-1 border-l border-white/5 pl-4">
                          {(mod.updateAvailable || mod.updating) && (
                            <button
                              onClick={() => atualizarItemInstalado(mod, activeFilter)}
                              disabled={!mod.updateAvailable || mod.updating || updatingAll}
                              className={cn(
                                "flex items-center gap-1 whitespace-nowrap rounded px-2.5 py-1.5",
                                "text-xs font-bold transition-all",
                                !mod.updateAvailable || mod.updating || updatingAll
                                  ? "cursor-not-allowed bg-white/5 text-white/30"
                                  : "bg-amber-500/20 text-amber-300 hover:bg-amber-500/30"
                              )}
                            >
                              {mod.updating ? (
                                <Loader2 size={11} className="animate-spin" />
                              ) : (
                                <RefreshCw size={11} />
                              )}
                              Atualizar
                            </button>
                          )}
                          <button
                            onClick={() => deleteMod(mod)}
                            aria-label={`Excluir ${mod.name}`}
                            className="p-1.5 rounded hover:bg-red-500/20 text-white/30 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              ) : (
                searching ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="animate-spin text-emerald-500" size={32} />
                  </div>
                ) : searchResults.length === 0 ? (
                  <div className="flex items-center justify-center py-12 text-white/40">
                    <p>Nenhum resultado encontrado</p>
                  </div>
                ) : (
                  <div className="p-4 grid grid-cols-1 gap-3">
                    {searchResults.map((item) => (
                      <div
                        key={`${item.source}:${item.id}`}
                        className={cn(
                          "rounded-xl border p-4 flex gap-4 transition-all group",
                          projetoFavorito(item)
                            ? "border-pink-400/55 bg-pink-500/[0.06] shadow-[inset_0_0_0_1px_rgba(244,114,182,0.08)] hover:bg-pink-500/[0.09]"
                            : "border-white/5 bg-white/3 hover:bg-white/5"
                        )}
                      >
                        <img
                          src={item.icon_url || `https://api.dicebear.com/9.x/shapes/svg?seed=${item.id}`}
                          alt=""
                          className="w-14 h-14 rounded-xl bg-black/40 object-cover shrink-0"
                        />

                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => abrirPaginaProjeto(item)}
                                  className="cursor-pointer text-left font-bold text-white transition-colors hover:text-emerald-400"
                                >
                                  {item.title}
                                </button>
                                {projetoFavorito(item) && (
                                  <Heart
                                    size={14}
                                    fill="currentColor"
                                    aria-label="Conteúdo favorito"
                                    className="shrink-0 text-pink-400 drop-shadow-[0_0_5px_rgba(244,114,182,0.45)]"
                                  />
                                )}
                              </div>
                              <div className="flex flex-wrap items-center gap-1 text-xs text-white/40">
                                <span>por {item.author} • via</span>
                                {(item.fontes ?? [item.source]).map((fonte) => (
                                  <span
                                    key={fonte}
                                    className={fonte === "modrinth" ? "text-emerald-400" : "text-orange-400"}
                                  >
                                    {fonte === "modrinth" ? "Modrinth" : "CurseForge"}
                                  </span>
                                ))}
                              </div>
                            </div>

                            <div className="flex shrink-0 items-center gap-2">
                              {projetoJaInstalado(item) ? (
                                <button
                                  disabled
                                  className="flex shrink-0 cursor-not-allowed items-center gap-2 rounded-xl bg-white/10 px-4 py-2 text-sm font-bold text-white/50"
                                >
                                  <Download size={14} />
                                  Instalado
                                </button>
                              ) : (
                                <button
                                  onClick={() => installContent(item)}
                                  disabled={instalacoesEmAndamento.has(`${item.source}:${item.id}`)}
                                  className={cn(
                                    "px-4 py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-2 shrink-0",
                                    instalacoesEmAndamento.has(`${item.source}:${item.id}`)
                                      ? "bg-white/10 text-white/40"
                                      : "bg-emerald-500 hover:bg-emerald-400 text-black active:scale-95"
                                  )}
                                >
                                  {instalacoesEmAndamento.has(`${item.source}:${item.id}`) ? (
                                    <>
                                      <Loader2 size={14} className="animate-spin" />
                                      Instalando...
                                    </>
                                  ) : (
                                    <>
                                      <Download size={14} />
                                      Instalar
                                    </>
                                  )}
                                </button>
                              )}
                            </div>
                          </div>

                          <p className="text-sm text-white/50 line-clamp-2 mt-2">
                            {item.description}
                          </p>

                          <div className="flex items-center gap-3 mt-2 text-xs text-white/30">
                            <span className="flex items-center gap-1">
                              <Download size={10} />
                              {(() => {
                                if (item.downloads === undefined) return "—";
                                const qtdDownloads = item.downloads;
                                if (qtdDownloads >= 1000000) return `${(qtdDownloads / 1000000).toFixed(1)}M`;
                                if (qtdDownloads >= 1000) return `${(qtdDownloads / 1000).toFixed(1)}K`;
                                return qtdDownloads;
                              })()}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                    {carregandoMaisResultados && (
                      <div className="flex items-center justify-center gap-2 py-5 text-sm text-white/45">
                        <Loader2 size={17} className="animate-spin text-emerald-400" />
                        Carregando mais resultados...
                      </div>
                    )}
                  </div>
                )
              )}
              </div>

              {indicadorRolagem.visivel && (
                <div
                  role="scrollbar"
                  aria-label="Rolagem da lista de conteúdos"
                  aria-controls="lista-conteudo-instancia"
                  aria-orientation="vertical"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(
                    (indicadorRolagem.topo /
                      Math.max(1, Math.max(0, (listaConteudoRef.current?.clientHeight ?? 16) - 16) - indicadorRolagem.altura)) *
                    100
                  )}
                  tabIndex={0}
                  onClick={rolarAoClicarTrilho}
                  onKeyDown={rolarIndicadorComTeclado}
                  className="absolute bottom-2 right-0.5 top-2 z-20 w-2 cursor-pointer rounded-full bg-white/[0.04] outline-none focus:bg-white/[0.08]"
                >
                  <div
                    onClick={(evento) => evento.stopPropagation()}
                    onPointerDown={iniciarArrasteIndicador}
                    onPointerMove={arrastarIndicador}
                    onPointerUp={encerrarArrasteIndicador}
                    onPointerCancel={encerrarArrasteIndicador}
                    className="absolute left-0 w-full cursor-grab touch-none rounded-full bg-white/20 transition-colors hover:bg-white/35 active:cursor-grabbing active:bg-emerald-300/60"
                    style={{
                      height: `${indicadorRolagem.altura}px`,
                      transform: `translateY(${indicadorRolagem.topo}px)`,
                    }}
                  />
                </div>
              )}
            </div>
          </>
        )}

        {/* WORLDS TAB */}
        {activeTab === "worlds" && (
          <div className="flex-1 overflow-y-auto p-6">
            {worlds.length === 0 ? (
              <div className="flex items-center justify-center h-full text-white/40">
                <div className="text-center">
                  <Globe size={48} className="mx-auto mb-4 opacity-30" />
                  <p className="font-medium">Nenhum mundo encontrado</p>
                  <p className="text-sm mt-1">Crie um novo mundo no jogo</p>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {worlds.map((world) => (
                  <div
                    key={world.path}
                    className="bg-white/5 border border-white/10 rounded-xl p-4 hover:bg-white/10 transition-all group"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 bg-emerald-500/10 rounded-xl flex items-center justify-center">
                          <Globe size={24} className="text-emerald-400" />
                        </div>
                        <div>
                          <h3 className="font-bold text-white">{world.name}</h3>
                          <p className="text-xs text-white/40 flex items-center gap-1">
                            <Calendar size={10} />
                            {world.lastPlayed}
                          </p>
                        </div>
                      </div>
                      <button
                        onClick={() => deleteWorld(world)}
                        className="p-2 rounded-lg hover:bg-red-500/20 text-white/30 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                    <div className="flex items-center justify-between text-xs text-white/40">
                      <span className="flex items-center gap-1">
                        <HardDrive size={10} />
                        {world.sizeOnDisk}
                      </span>
                      <button
                        onClick={() => abrirPastaMundo(world.path)}
                        className="text-emerald-400 hover:text-emerald-300"
                      >
                        Abrir pasta
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "configuration" && instanceDetails && (
          <Configuracao
            instanceId={instanceId}
            memoriaPersonalizada={instanceDetails.memory}
            argumentosJvm={instanceDetails.javaArgs}
            largura={instanceDetails.width}
            altura={instanceDetails.height}
            onSalvar={loadInstanceDetails}
          />
        )}

        {/* LOGS TAB */}
        {activeTab === "logs" && (
          <div className="flex-1 overflow-hidden flex">
            <div className="w-64 border-r border-white/5 overflow-y-auto">
              <div className="p-3 border-b border-white/5">
                <p className="text-xs text-white/40 uppercase font-bold">Arquivos de Log</p>
              </div>
              {logs.length === 0 ? (
                <div className="p-4 text-center text-white/40 text-sm">
                  Nenhum log encontrado
                </div>
              ) : (
                logs.map((log) => (
                  <button
                    key={log.path}
                    onClick={() => viewLog(log.path)}
                    className={cn(
                      "w-full text-left p-3 hover:bg-white/5 transition-all border-b border-white/5",
                      selectedLog === log.path && "bg-white/10"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <FileText size={14} className="text-white/40" />
                      <span className="text-sm font-medium truncate">{log.filename}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1 text-xs text-white/30">
                      <span>{(log.size / 1024).toFixed(1)} KB</span>
                      <span>•</span>
                      <span>{log.modified}</span>
                    </div>
                  </button>
                ))
              )}
            </div>

            <div className="flex-1 overflow-hidden flex flex-col">
              {selectedLog ? (
                <>
                  <div className="p-3 border-b border-white/5 flex items-center justify-between">
                    <p className="text-sm font-medium">{logs.find(l => l.path === selectedLog)?.filename}</p>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => navigator.clipboard.writeText(logContent)}
                        className="text-xs text-white/40 hover:text-white px-2 py-1 rounded hover:bg-white/10"
                      >
                        Copiar
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 overflow-auto p-4 bg-black/30">
                    <pre className="text-xs text-white/70 font-mono whitespace-pre-wrap">
                      {logContent || "Carregando..."}
                    </pre>
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-center h-full text-white/40">
                  <div className="text-center">
                    <FileText size={40} className="mx-auto mb-3 opacity-30" />
                    <p className="text-sm">Selecione um arquivo de log</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <MenuContextual
        aberto={menuConteudo !== null}
        x={menuConteudo?.x ?? 0}
        y={menuConteudo?.y ?? 0}
        onFechar={() => setMenuConteudo(null)}
        rotulo="Ações do conteúdo instalado"
      >
        {menuConteudo && (
          <>
            <CabecalhoMenuContextual
              titulo={menuConteudo.item.name}
              subtitulo={`${menuConteudo.item.version || "Versão desconhecida"} · ${menuConteudo.item.fileName}`}
            />
            <ItemMenuContextual
              icone={<Package size={13} />}
              disabled={!menuConteudo.item.projectId || !menuConteudo.item.source || !onAbrirProjeto}
              onClick={() => {
                abrirDetalhesConteudoInstalado(menuConteudo.item, menuConteudo.filtro);
                setMenuConteudo(null);
              }}
            >
              Ver detalhes do projeto
            </ItemMenuContextual>
            <ItemMenuContextual
              icone={<RefreshCw size={13} />}
              disabled={!menuConteudo.item.projectId || !menuConteudo.item.source}
              onClick={() => abrirTrocaVersao(menuConteudo.item, menuConteudo.filtro)}
            >
              Trocar versão
            </ItemMenuContextual>
            {menuConteudo.item.updateAvailable && (
              <ItemMenuContextual icone={<Download size={13} />} destaque onClick={() => {
                const { item, filtro } = menuConteudo;
                setMenuConteudo(null);
                void atualizarItemInstalado(item, filtro);
              }}>
                Atualizar para a mais recente
              </ItemMenuContextual>
            )}
            <ItemMenuContextual icone={<MoreVertical size={13} />} onClick={() => {
              const item = menuConteudo.item;
              setMenuConteudo(null);
              void toggleMod(item);
            }}>
              {menuConteudo.item.enabled ? "Desativar" : "Ativar"}
            </ItemMenuContextual>
            <ItemMenuContextual icone={<Plus size={13} />} onClick={() => {
              alternarSelecaoArquivo(menuConteudo.item.fileName);
              setMenuConteudo(null);
            }}>
              {arquivosSelecionados.has(menuConteudo.item.fileName) ? "Remover da seleção" : "Selecionar"}
            </ItemMenuContextual>
            <SeparadorMenuContextual />
            <ItemMenuContextual icone={<Trash2 size={13} />} perigo onClick={() => {
              const item = menuConteudo.item;
              setMenuConteudo(null);
              void deleteMod(item);
            }}>
              Remover conteúdo
            </ItemMenuContextual>
          </>
        )}
      </MenuContextual>

      {itemTrocaVersao && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 p-5 backdrop-blur-sm"
          onMouseDown={() => {
            if (!trocandoVersaoConteudo) setItemTrocaVersao(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="titulo-trocar-versao"
            className="isolate flex max-h-[78vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-white/15 bg-[#151516] shadow-2xl"
            onMouseDown={(evento) => evento.stopPropagation()}
          >
            <div className="relative z-10 flex shrink-0 items-start justify-between gap-4 border-b border-white/8 bg-[#151516] px-5 py-4">
              <div className="min-w-0">
                <h3 id="titulo-trocar-versao" className="truncate text-base font-black text-white">
                  Trocar versão de {itemTrocaVersao.name}
                </h3>
                <p className="mt-1 text-xs text-white/40">
                  Somente versões compatíveis com Minecraft {instanceDetails?.version} são exibidas.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="Tipos de versão">
                  {(["release", "beta", "alpha"] as EstabilidadeVersao[]).map((tipo) => (
                    <span
                      key={tipo}
                      className={cn(
                        "border px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wide",
                        CLASSES_ESTABILIDADE[tipo]
                      )}
                    >
                      {ROTULOS_ESTABILIDADE[tipo]}
                    </span>
                  ))}
                </div>
              </div>
              <button
                type="button"
                aria-label="Fechar"
                disabled={trocandoVersaoConteudo}
                onClick={() => setItemTrocaVersao(null)}
                className="rounded-lg p-2 text-white/35 transition-colors hover:bg-white/8 hover:text-white disabled:opacity-30"
              >
                <X size={15} />
              </button>
            </div>

            <AreaRolagemPersonalizada
              className="flex-1"
              classNameConteudo="p-3 pb-5"
              rotulo="Lista de versões disponíveis"
            >
              {carregandoVersoesConteudo ? (
                <div className="flex items-center justify-center gap-2 py-14 text-xs text-white/45">
                  <Loader2 size={16} className="animate-spin text-emerald-300" />
                  Buscando versões compatíveis...
                </div>
              ) : erroTrocaVersao && versoesConteudo.length === 0 ? (
                <div className="border border-red-400/15 bg-red-400/5 px-4 py-3 text-xs text-red-200/80">
                  {erroTrocaVersao}
                </div>
              ) : (
                <div className="space-y-1">
                  {versoesConteudo.map((versao, indice) => {
                    const arquivo = versao.files.find((item) => item.primary) || versao.files[0];
                    const nomeAtual = itemTrocaVersao.fileName.replace(/\.disabled$/i, "");
                    const atual = versao.version_number === itemTrocaVersao.version || arquivo?.filename === nomeAtual;
                    const estabilidade = obterEstabilidadeVersao(versao);
                    return (
                      <label
                        key={versao.id}
                        className={cn(
                          "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-3 transition-colors",
                          versaoConteudoSelecionadaId === versao.id
                            ? "border-emerald-400/35 bg-emerald-400/8"
                            : "border-white/6 bg-white/[0.02] hover:bg-white/[0.05]"
                        )}
                      >
                        <input
                          type="radio"
                          name="versao-conteudo"
                          value={versao.id}
                          checked={versaoConteudoSelecionadaId === versao.id}
                          onChange={() => setVersaoConteudoSelecionadaId(versao.id)}
                          className="accent-emerald-400"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-bold text-white">{versao.version_number}</span>
                            <span
                              className={cn(
                                "shrink-0 border px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wide",
                                CLASSES_ESTABILIDADE[estabilidade]
                              )}
                            >
                              {ROTULOS_ESTABILIDADE[estabilidade]}
                            </span>
                            {indice === 0 && (
                              <span className="shrink-0 bg-emerald-400/10 px-1.5 py-0.5 text-[8px] font-black uppercase text-emerald-300">
                                Mais recente
                              </span>
                            )}
                            {atual && (
                              <span className="shrink-0 bg-white/8 px-1.5 py-0.5 text-[8px] font-black uppercase text-white/50">
                                Atual
                              </span>
                            )}
                          </div>
                          <p className="mt-1 truncate text-[10px] text-white/35">
                            {arquivo?.filename}
                            {versao.date_published
                              ? ` · ${new Date(versao.date_published).toLocaleDateString("pt-BR")}`
                              : ""}
                          </p>
                        </div>
                        <span className="shrink-0 text-[9px] font-semibold uppercase text-white/25">
                          {versao.loaders?.join(", ") || tipoProjetoPorFiltro(filtroTrocaVersao)}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
              {erroTrocaVersao && versoesConteudo.length > 0 && (
                <p className="mt-3 text-xs text-red-300/80">{erroTrocaVersao}</p>
              )}
            </AreaRolagemPersonalizada>

            <div className="relative z-10 grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-t border-white/8 bg-[#151516] px-5 py-3 shadow-[0_-10px_24px_rgba(0,0,0,0.28)]">
              <p className="max-w-64 text-[10px] leading-relaxed text-white/30">
                O arquivo atual só é removido após a nova versão ser instalada.
              </p>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  disabled={trocandoVersaoConteudo}
                  onClick={() => setItemTrocaVersao(null)}
                  className="px-3 py-2 text-xs font-bold text-white/45 hover:text-white disabled:opacity-30"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={carregandoVersoesConteudo || trocandoVersaoConteudo || !versaoConteudoSelecionadaId}
                  onClick={() => void trocarVersaoConteudo()}
                  className="flex items-center gap-2 bg-emerald-400 px-4 py-2 text-xs font-black text-black transition-colors hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-35"
                >
                  {trocandoVersaoConteudo && <Loader2 size={13} className="animate-spin" />}
                  Trocar versão
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <EditorIconeModal
        aberto={editorIconeAberto}
        iconeAtual={editIcon || instanceDetails?.icon}
        chavePersistencia={instanceId}
        aoFechar={() => {
          if (editorIconeAbriuEdicaoRef.current && instanceDetails) {
            setEditName(instanceDetails.name);
            setEditIcon(instanceDetails.icon || "");
            setIsEditing(false);
          }
          editorIconeAbriuEdicaoRef.current = false;
          setEditorIconeAberto(false);
        }}
        aoSalvar={salvarIconeDiretamente}
      />
    </div>
  );
}
