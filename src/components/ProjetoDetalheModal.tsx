import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Gamepad2,
  Loader2,
  Heart,
  Search,
} from "../iconesPixelados";
import { cn } from "../lib/utils";
import { obterImagemProjeto } from "../lib/imagemProjeto";
import { CONFIGURACAO_SOCIAL } from "../lib/configuracaoSocial";
import type { AnaliseModpack, SessaoSocial } from "./social/tiposSocial";
import type { Instance } from "../hooks/useLauncher";
import { addFavorite, isFavorite, removeFavorite, type FavoriteItem } from "./Favorites";
import {
  addCreatingInstance,
  completeCreatingInstance,
  errorCreatingInstance,
  type CreatingInstance,
  updateCreatingInstance,
} from "../stores/creatingInstances";

export type TipoProjetoConteudo = "modpack" | "mod" | "resourcepack" | "shader";
export type FonteProjetoConteudo = "modrinth" | "curseforge";
export type AbaOrigemProjeto =
  | "home"
  | "explore"
  | "favorites"
  | "instances"
  | "instance-manager";
type AbaConteudoProjeto = "descricao" | "versoes" | "galeria";

interface ImagemGaleriaProjeto {
  url: string;
  raw_url?: string;
  title?: string;
  description?: string;
  featured?: boolean;
}

export interface ProjetoConteudo {
  id: string;
  title: string;
  description: string;
  icon_url: string;
  author: string;
  slug: string;
  source: FonteProjetoConteudo;
  project_type: TipoProjetoConteudo;
  downloads?: number;
  follows?: number;
  body?: string;
  categorias?: string[];
  galeria?: ImagemGaleriaProjeto[];
  versaoInicialId?: string;
}

interface ArquivoProjeto {
  url: string;
  filename: string;
  primary?: boolean;
  hashes?: Record<string, string>;
}

interface VersaoProjeto {
  id: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
  date_published?: string;
  files: ArquivoProjeto[];
}

interface CompatibilidadeInstancia {
  instancia: Instance;
  versaoIdeal: VersaoProjeto | null;
  arquivoIdeal: ArquivoProjeto | null;
  motivoIncompatibilidade: string | null;
}

interface LoaderVersionsResponse {
  versions: Array<{ version: string; stable?: boolean }>;
}

interface ImagemGaleriaProjetoCurseforgeApi {
  url: string;
  rawUrl?: string;
  title?: string;
  description?: string;
  featured?: boolean;
}

interface DetalhesProjetoCurseforgeApi {
  id: string;
  title: string;
  description: string;
  body: string;
  iconUrl: string;
  author: string;
  slug: string;
  downloads?: number;
  categorias: string[];
  galeria: ImagemGaleriaProjetoCurseforgeApi[];
}

interface ProjetoDetalhePaginaProps {
  projeto: ProjetoConteudo;
  instancias: Instance[];
  instanciaInicialId?: string;
  usuarioLogado?: boolean;
  onSolicitarLogin?: () => void;
  onInstanciaCriada?: () => void;
  instalarAoAbrir?: boolean;
  onInstalacaoAutomaticaIniciada?: () => void;
  onVoltar: () => void;
  rotuloAcao?: string;
}

const ORDEM_LOADER_MODPACK = ["fabric", "forge", "neoforge"] as const;

function urlHttpsSegura(valor?: string): string | undefined {
  if (!valor) return undefined;
  try {
    const url = new URL(valor);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

const COMPONENTES_MARKDOWN: Components = {
  h1: ({ children }) => (
    <h1 className="mt-6 text-2xl font-black text-white first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-5 text-xl font-black text-white first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-4 text-lg font-bold text-white first:mt-0">{children}</h3>
  ),
  p: ({ children }) => <p className="leading-7 text-white/85">{children}</p>,
  strong: ({ children }) => <strong className="font-black text-white">{children}</strong>,
  em: ({ children }) => <em className="text-white/80 italic">{children}</em>,
  a: ({ href, children }) => (
    <a
      href={urlHttpsSegura(href)}
      target="_blank"
      rel="noreferrer"
      className="text-sky-300 underline underline-offset-2 hover:text-sky-200"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="list-disc space-y-1 pl-6 text-white/85">{children}</ul>,
  ol: ({ children }) => (
    <ol className="list-decimal space-y-1 pl-6 text-white/85">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-6">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-white/20 pl-4 text-white/70 italic">
      {children}
    </blockquote>
  ),
  code: ({ children, className }) => (
    <code className={cn("rounded bg-black/45 px-1.5 py-0.5 text-xs text-white", className)}>
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="overflow-x-auto rounded-xl border border-white/10 bg-black/45 p-3 text-xs text-white">
      {children}
    </pre>
  ),
  img: ({ src, alt }) => (
    <img
      src={urlHttpsSegura(src) || ""}
      alt={alt || ""}
      loading="lazy"
      className="mx-auto my-3 block h-auto max-h-[420px] w-auto max-w-full rounded-xl border border-white/10 bg-black/35 object-contain"
    />
  ),
};

function normalizarLoader(loader?: string | null): string | null {
  if (!loader) return null;
  const valor = loader.trim().toLowerCase();
  if (!valor || valor === "vanilla") return null;
  return valor;
}

function labelLoader(instancia: Instance): string {
  const loader = instancia.loader_type || instancia.mc_type;
  return loader && loader.trim() ? loader : "Vanilla";
}

function formatarNumero(numero: number): string {
  if (!Number.isFinite(numero)) return "0";
  if (numero >= 1_000_000) return `${(numero / 1_000_000).toFixed(1)}M`;
  if (numero >= 1_000) return `${(numero / 1_000).toFixed(1)}K`;
  return numero.toString();
}

function normalizarDescricaoProjeto(descricao: string): string {
  if (!descricao) return "";
  const possuiTagsEscapadas = /\\<(?:\/)?(?:center|p|span|font|img|a|iframe|ul|ol|li|strong|em|br|h[1-6]|div)/i.test(
    descricao
  );
  if (!possuiTagsEscapadas) return descricao;
  return descricao.replace(/\\</g, "<").replace(/\\>/g, ">");
}

function compararVersoesPorData(a: VersaoProjeto, b: VersaoProjeto): number {
  const dataA = a.date_published ? new Date(a.date_published).getTime() : 0;
  const dataB = b.date_published ? new Date(b.date_published).getTime() : 0;
  return dataB - dataA;
}

function tagVersaoCompativel(tag: string, versaoInstancia: string): boolean {
  if (tag === versaoInstancia) return true;
  const ehNumerica = /^[0-9.]+$/.test(tag);
  if (ehNumerica && tag.split(".").length === 2) {
    return versaoInstancia.startsWith(`${tag}.`);
  }
  return false;
}

function versaoMinecraftCompativel(tags: string[], versaoInstancia: string): boolean {
  if (tags.length === 0) return true;
  return tags.some((tag) => tagVersaoCompativel(tag, versaoInstancia));
}

function loaderCompativel(
  loadersVersao: string[],
  loaderInstancia: string | null,
  tipoProjeto: TipoProjetoConteudo
): boolean {
  if (tipoProjeto === "resourcepack" || tipoProjeto === "shader") return true;
  if (loadersVersao.length === 0) return true;
  if (!loaderInstancia) return false;
  return loadersVersao.map((item) => item.toLowerCase()).includes(loaderInstancia);
}

function escolherArquivoIdeal(
  versao: VersaoProjeto,
  tipoProjeto: TipoProjetoConteudo
): ArquivoProjeto | null {
  const arquivos = versao.files || [];
  if (arquivos.length === 0) return null;

  const extensao =
    tipoProjeto === "modpack" ? ".mrpack" : tipoProjeto === "mod" ? ".jar" : ".zip";
  const primario = arquivos.find(
    (item) => item.primary && item.filename.toLowerCase().endsWith(extensao)
  );
  if (primario) return primario;
  const porExtensao = arquivos.find((item) =>
    item.filename.toLowerCase().endsWith(extensao)
  );
  return porExtensao || arquivos[0];
}

function escolherVersaoMinecraftIdeal(gameVersions: string[]): string | null {
  if (gameVersions.length === 0) return null;
  const releases = gameVersions.filter((item) => /^[0-9]+\.[0-9]+(\.[0-9]+)?$/.test(item));
  if (releases.length === 0) return gameVersions[0] || null;
  releases.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  return releases[0] || null;
}

function extrairMensagemErro(erro: unknown, padrao: string): string {
  if (erro instanceof Error && erro.message.trim()) return erro.message;
  if (typeof erro === "string" && erro.trim()) return erro;
  if (erro && typeof erro === "object") {
    const possivelMensagem = (erro as { message?: unknown }).message;
    if (typeof possivelMensagem === "string" && possivelMensagem.trim()) {
      return possivelMensagem;
    }
  }
  return padrao;
}

function gerarNomeInstanciaDisponivel(nomeBase: string, nomesExistentes: string[]): string {
  const base = nomeBase.trim() || "Novo Modpack";
  const nomes = new Set(nomesExistentes.map((item) => item.toLowerCase()));
  if (!nomes.has(base.toLowerCase())) return base;
  let sufixo = 2;
  while (nomes.has(`${base} ${sufixo}`.toLowerCase())) sufixo += 1;
  return `${base} ${sufixo}`;
}

function gerarIdInstancia(nomeInstancia: string): string {
  return encodeURIComponent(nomeInstancia.toLowerCase().replace(/\s+/g, "_"));
}

function escolherVersaoLoaderIdeal(
  loader: string,
  versoes: Array<{ version: string; stable?: boolean }>,
  versaoMinecraft: string
): string | null {
  if (versoes.length === 0) return null;
  if (loader === "forge" || loader === "neoforge") {
    const compativel = versoes.find(
      (item) =>
        item.version.startsWith(`${versaoMinecraft}-`) || item.version.includes(versaoMinecraft)
    );
    return compativel?.version || versoes[0].version;
  }
  return versoes.find((item) => item.stable !== false)?.version || versoes[0].version;
}

function normalizarTipoProjeto(valor: string): TipoProjetoConteudo {
  if (valor === "modpack" || valor === "mod" || valor === "resourcepack" || valor === "shader") {
    return valor;
  }
  return "mod";
}

async function buscarDetalhesProjetoModrinth(projectId: string): Promise<Partial<ProjetoConteudo>> {
  const resposta = await fetch(`https://api.modrinth.com/v2/project/${projectId}`);
  if (!resposta.ok) {
    throw new Error(`Erro ao buscar detalhes (${resposta.status})`);
  }

  const dados = await resposta.json();
  const categorias = [
    ...(Array.isArray(dados.categories) ? dados.categories : []),
    ...(Array.isArray(dados.additional_categories) ? dados.additional_categories : []),
  ].filter((item): item is string => typeof item === "string" && item.trim().length > 0);

  const galeria = Array.isArray(dados.gallery)
    ? dados.gallery
        .filter((imagem: any) => typeof imagem?.url === "string" && imagem.url.trim().length > 0)
        .map(
          (imagem: any): ImagemGaleriaProjeto => ({
            url: imagem.url,
            raw_url: typeof imagem.raw_url === "string" ? imagem.raw_url : undefined,
            title: typeof imagem.title === "string" ? imagem.title : undefined,
            description: typeof imagem.description === "string" ? imagem.description : undefined,
            featured: Boolean(imagem.featured),
          })
        )
    : [];

  return {
    id: typeof dados.id === "string" ? dados.id : projectId,
    title: typeof dados.title === "string" ? dados.title : "",
    description: typeof dados.description === "string" ? dados.description : "",
    body: typeof dados.body === "string" ? dados.body : "",
    icon_url: typeof dados.icon_url === "string" ? dados.icon_url : "",
    slug: typeof dados.slug === "string" ? dados.slug : "",
    project_type: normalizarTipoProjeto(String(dados.project_type || "mod")),
    downloads: typeof dados.downloads === "number" ? dados.downloads : undefined,
    follows: typeof dados.followers === "number" ? dados.followers : undefined,
    categorias: categorias.length > 0 ? categorias : undefined,
    galeria,
  };
}

async function buscarDetalhesProjetoCurseforge(
  projectId: string
): Promise<Partial<ProjetoConteudo>> {
  const dados = await invoke<DetalhesProjetoCurseforgeApi>(
    "buscar_detalhes_projeto_curseforge",
    { projectId }
  );

  return {
    id: typeof dados.id === "string" ? dados.id : projectId,
    title: typeof dados.title === "string" ? dados.title : "",
    description: typeof dados.description === "string" ? dados.description : "",
    body: typeof dados.body === "string" ? dados.body : "",
    icon_url: typeof dados.iconUrl === "string" ? dados.iconUrl : "",
    author: typeof dados.author === "string" ? dados.author : "",
    slug: typeof dados.slug === "string" ? dados.slug : "",
    downloads: typeof dados.downloads === "number" ? dados.downloads : undefined,
    categorias: Array.isArray(dados.categorias) ? dados.categorias : undefined,
    galeria: Array.isArray(dados.galeria)
      ? dados.galeria
          .filter((imagem) => typeof imagem?.url === "string" && imagem.url.trim().length > 0)
          .map((imagem): ImagemGaleriaProjeto => ({
            url: imagem.url,
            raw_url: typeof imagem.rawUrl === "string" ? imagem.rawUrl : undefined,
            title: typeof imagem.title === "string" ? imagem.title : undefined,
            description:
              typeof imagem.description === "string" ? imagem.description : undefined,
            featured: Boolean(imagem.featured),
          }))
      : undefined,
  };
}

async function buscarVersoesProjetoModrinth(
  projectId: string
): Promise<VersaoProjeto[]> {
  const resposta = await fetch(`https://api.modrinth.com/v2/project/${projectId}/version`);
  if (!resposta.ok) {
    throw new Error(`Erro ao buscar versões (${resposta.status})`);
  }
  const dados = await resposta.json();
  if (!Array.isArray(dados)) return [];
  return dados.map((versao: any) => ({
    id: versao.id,
    version_number: versao.version_number,
    game_versions: Array.isArray(versao.game_versions) ? versao.game_versions : [],
    loaders: Array.isArray(versao.loaders) ? versao.loaders : [],
    date_published: versao.date_published,
    files: Array.isArray(versao.files)
      ? versao.files.map((arquivo: any) => ({
          url: arquivo.url,
          filename: arquivo.filename,
          primary: Boolean(arquivo.primary),
        }))
      : [],
  }));
}

interface ConteudoInstaladoDetalhado {
  fileName: string;
  version: string;
}

interface ModpackInstalado {
  projectId: string;
  versionId: string;
  source: string;
  installedVersion: string;
}

function normalizarPesquisaInstancia(valor: string): string {
  return valor
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLocaleLowerCase("pt-BR");
}

function normalizarNomeArquivoInstalado(nomeArquivo: string): string {
  return nomeArquivo.trim().toLocaleLowerCase("pt-BR").replace(/\.disabled$/i, "");
}

async function buscarVersoesProjetoCurseforge(
  projectId: string,
  instancia: Instance | null,
  tipoProjeto: TipoProjetoConteudo,
  versaoInicialId?: string
): Promise<VersaoProjeto[]> {
  const loader = tipoProjeto === "mod"
    ? normalizarLoader(instancia?.loader_type || instancia?.mc_type)
    : null;
  const versoes = await invoke<VersaoProjeto[]>("listar_versoes_projeto_curseforge", {
    projectId,
    gameVersion: instancia?.version || null,
    loader,
    projectType: tipoProjeto,
  });
  if (!versaoInicialId || versoes.some((versao) => String(versao.id) === String(versaoInicialId))) {
    return versoes;
  }
  const versaoExata = await invoke<VersaoProjeto>("obter_versao_projeto_curseforge", {
    projectId,
    fileId: versaoInicialId,
    projectType: tipoProjeto,
  });
  return [versaoExata, ...versoes];
}

export default function ProjetoDetalheModal({
  projeto,
  instancias,
  instanciaInicialId,
  usuarioLogado = false,
  onSolicitarLogin,
  onInstanciaCriada,
  instalarAoAbrir = false,
  onInstalacaoAutomaticaIniciada,
  onVoltar,
  rotuloAcao = "Instalar",
}: ProjetoDetalhePaginaProps) {
  const [versoesProjeto, setVersoesProjeto] = useState<VersaoProjeto[]>([]);
  const [versaoSelecionadaId, setVersaoSelecionadaId] = useState<string | null>(null);
  const [instanciaSelecionadaId, setInstanciaSelecionadaId] = useState<string | null>(
    instanciaInicialId ?? null
  );
  const [abaConteudo, setAbaConteudo] = useState<AbaConteudoProjeto>("descricao");
  const [detalhesProjeto, setDetalhesProjeto] = useState<Partial<ProjetoConteudo> | null>(null);
  const [carregandoDetalhes, setCarregandoDetalhes] = useState(false);
  const [erroDetalhes, setErroDetalhes] = useState<string | null>(null);
  const [carregandoVersoes, setCarregandoVersoes] = useState(false);
  const [conteudosInstalados, setConteudosInstalados] = useState<ConteudoInstaladoDetalhado[]>([]);
  const [modpacksInstalados, setModpacksInstalados] = useState<ModpackInstalado[]>([]);
  const [revisaoConteudoInstalado, setRevisaoConteudoInstalado] = useState(0);
  const [pesquisaInstancia, setPesquisaInstancia] = useState("");
  const [instalando, setInstalando] = useState(false);
  const [sucesso, setSucesso] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [favorito, setFavorito] = useState(() => isFavorite(projeto.id));
  const [analises, setAnalises] = useState<AnaliseModpack[]>([]);
  const [indiceAnalise, setIndiceAnalise] = useState(0);
  const [erroAnalises, setErroAnalises] = useState<string | null>(null);
  const [tokenSocial, setTokenSocial] = useState<string | null | undefined>(undefined);
  const [curtindoId, setCurtindoId] = useState<string | null>(null);
  const instalacaoAutomaticaIniciada = useRef(false);

  useEffect(() => {
    const voltarComEscape = (evento: KeyboardEvent) => {
      if (evento.key !== "Escape" || evento.defaultPrevented || evento.repeat) return;
      evento.preventDefault();
      onVoltar();
    };

    window.addEventListener("keydown", voltarComEscape);
    return () => window.removeEventListener("keydown", voltarComEscape);
  }, [onVoltar]);

  useEffect(() => {
    let cancelado = false;
    setAbaConteudo("descricao");
    setInstanciaSelecionadaId(instanciaInicialId ?? null);
    setVersaoSelecionadaId(projeto.versaoInicialId ?? null);
    setFavorito(isFavorite(projeto.id));
    setPesquisaInstancia("");
    setVersoesProjeto([]);
    setDetalhesProjeto(null);
    setErroDetalhes(null);
    setCarregandoDetalhes(true);

    const carregarDetalhes = async () => {
      try {
        let detalhes: Partial<ProjetoConteudo> | null = null;
        if (projeto.source === "modrinth") {
          detalhes = await buscarDetalhesProjetoModrinth(projeto.id);
        } else if (projeto.source === "curseforge") {
          detalhes = await buscarDetalhesProjetoCurseforge(projeto.id);
        }

        if (!cancelado) setDetalhesProjeto(detalhes);
      } catch (e) {
        if (!cancelado) {
          console.error("Erro ao buscar detalhes do projeto:", e);
          setErroDetalhes("Não foi possível carregar a descrição completa.");
        }
      } finally {
        if (!cancelado) setCarregandoDetalhes(false);
      }
    };

    carregarDetalhes();
    return () => {
      cancelado = true;
    };
  }, [instanciaInicialId, projeto.id, projeto.source, projeto.versaoInicialId]);

  useEffect(() => {
    setAnalises([]);
    setIndiceAnalise(0);
    setErroAnalises(null);
    setTokenSocial(undefined);
  }, [projeto.id, projeto.source]);

  useEffect(() => {
    let cancelado = false;
    setErroAnalises(null);
    const carregar = async () => {
      try {
        let token: string | null = null;
        try {
          const conteudo = await invoke<string | null>("carregar_sessao_social_local");
          token = conteudo ? ((JSON.parse(conteudo) as SessaoSocial).accessToken ?? null) : null;
        } catch {
          token = null;
        }
        if (!cancelado) setTokenSocial(token);
        if (!token) {
          if (!cancelado) {
            setErroAnalises("Entre com a Microsoft para ver as análises dos seus amigos.");
          }
          return;
        }
        const lista = await invoke<AnaliseModpack[]>("listar_analises_projeto", {
          apiBaseUrl: CONFIGURACAO_SOCIAL.apiBaseUrl,
          accessToken: token,
          source: projeto.source,
          projectId: projeto.id,
        });
        if (!cancelado) setAnalises(Array.isArray(lista) ? lista : []);
      } catch (e) {
        if (!cancelado) setErroAnalises(extrairMensagemErro(e, "Não foi possível carregar as análises."));
      }
    };
    void carregar();
    return () => {
      cancelado = true;
    };
  }, [projeto.id, projeto.source]);

  const curtirAnalise = async (analise: AnaliseModpack) => {
    if (!tokenSocial || curtindoId) return;
    setCurtindoId(analise.id);
    try {
      const resposta = await invoke<{ curtido: boolean; totalCurtidas: number }>(
        "curtir_analise_modpack",
        {
          apiBaseUrl: CONFIGURACAO_SOCIAL.apiBaseUrl,
          accessToken: tokenSocial,
          analiseId: analise.id,
        }
      );
      setAnalises((atuais) =>
        atuais.map((item) =>
          item.id === analise.id
            ? { ...item, curtidoPorMim: resposta.curtido, totalCurtidas: resposta.totalCurtidas }
            : item
        )
      );
    } catch (e) {
      setErroAnalises(extrairMensagemErro(e, "Não foi possível curtir a análise."));
    } finally {
      setCurtindoId(null);
    }
  };

  const instanciaSelecionada = useMemo(
    () =>
      instancias.find((instancia) => instancia.id === instanciaSelecionadaId) ||
      instancias[0] ||
      null,
    [instanciaSelecionadaId, instancias]
  );

  const instanciaConsultaVersoes =
    projeto.source === "curseforge" && projeto.project_type !== "modpack"
      ? instanciaSelecionada
      : null;
  const assinaturaInstancias = useMemo(
    () => instancias.map((instancia) => instancia.id).sort().join("|"),
    [instancias]
  );

  useEffect(() => {
    let cancelado = false;
    if (!instanciaSelecionada || projeto.project_type === "modpack") {
      setConteudosInstalados([]);
      return;
    }

    const tipoConteudo = projeto.project_type === "mod"
      ? "mods"
      : projeto.project_type === "resourcepack"
        ? "resourcepacks"
        : "shaders";

    const carregarConteudoInstalado = async () => {
      try {
        const conteudos = await invoke<ConteudoInstaladoDetalhado[]>(
          "obter_conteudo_instalado_detalhado",
          {
            instanceId: instanciaSelecionada.id,
            contentType: tipoConteudo,
          }
        );
        if (!cancelado) setConteudosInstalados(conteudos);
      } catch (erroLeitura) {
        if (!cancelado) {
          console.error("Erro ao verificar versões instaladas:", erroLeitura);
          setConteudosInstalados([]);
        }
      }
    };

    void carregarConteudoInstalado();
    return () => {
      cancelado = true;
    };
  }, [instanciaSelecionada?.id, projeto.project_type, revisaoConteudoInstalado]);

  useEffect(() => {
    let cancelado = false;
    if (projeto.project_type !== "modpack") {
      setModpacksInstalados([]);
      return;
    }

    const carregarModpacksInstalados = async () => {
      const resultados = await Promise.all(
        instancias.map(async (instancia) => {
          try {
            return await invoke<ModpackInstalado | null>("get_modpack_info", {
              instanceId: instancia.id,
            });
          } catch {
            return null;
          }
        })
      );
      if (cancelado) return;
      setModpacksInstalados(
        resultados.filter(
          (info): info is ModpackInstalado =>
            info !== null &&
            String(info.projectId) === String(projeto.id) &&
            info.source.toLocaleLowerCase("pt-BR") === projeto.source
        )
      );
    };

    void carregarModpacksInstalados();
    return () => {
      cancelado = true;
    };
  }, [assinaturaInstancias, projeto.id, projeto.project_type, projeto.source]);

  useEffect(() => {
    let cancelado = false;
    setErro(null);
    setSucesso(false);
    setCarregandoVersoes(true);

    const carregar = async () => {
      try {
        const versoes = projeto.source === "modrinth"
          ? await buscarVersoesProjetoModrinth(projeto.id)
          : await buscarVersoesProjetoCurseforge(
              projeto.id,
              instanciaConsultaVersoes,
              projeto.project_type,
              projeto.versaoInicialId
            );
        if (!cancelado) setVersoesProjeto(versoes);
      } catch (e) {
        if (!cancelado) {
          console.error("Erro ao buscar versões:", e);
          setErro(extrairMensagemErro(e, "Não foi possível carregar versões do projeto."));
        }
      } finally {
        if (!cancelado) setCarregandoVersoes(false);
      }
    };

    carregar();
    return () => {
      cancelado = true;
    };
  }, [
    instanciaConsultaVersoes?.id,
    instanciaConsultaVersoes?.loader_type,
    instanciaConsultaVersoes?.mc_type,
    instanciaConsultaVersoes?.version,
    projeto.id,
    projeto.project_type,
    projeto.source,
    projeto.versaoInicialId,
  ]);

  const projetoExibicao = useMemo<ProjetoConteudo>(
    () => ({
      ...projeto,
      ...detalhesProjeto,
      author: detalhesProjeto?.author || projeto.author,
    }),
    [detalhesProjeto, projeto]
  );

  const descricaoCompletaProjeto = useMemo(
    () => normalizarDescricaoProjeto(projetoExibicao.body?.trim() || ""),
    [projetoExibicao.body]
  );
  const galeriaProjeto = projetoExibicao.galeria || [];
  const requerCompatibilidade =
    projeto.project_type !== "modpack";

  const compatibilidades = useMemo<CompatibilidadeInstancia[]>(() => {
    if (projeto.project_type === "modpack") return [];
    if (!requerCompatibilidade) {
      return instancias.map((instancia) => ({
        instancia,
        versaoIdeal: null,
        arquivoIdeal: null,
        motivoIncompatibilidade: null,
      }));
    }

    const ordenadas = [...versoesProjeto].sort(compararVersoesPorData);
    return instancias.map((instancia) => {
      if (
        projeto.source === "curseforge" &&
        projeto.project_type !== "modpack" &&
        instancia.id !== instanciaSelecionada?.id
      ) {
        return {
          instancia,
          versaoIdeal: null,
          arquivoIdeal: null,
          motivoIncompatibilidade: null,
        };
      }

      const loaderInstancia = normalizarLoader(instancia.loader_type || instancia.mc_type);
      let encontrouMc = false;
      let encontrouLoader = false;
      for (const versao of ordenadas) {
        if (!versaoMinecraftCompativel(versao.game_versions || [], instancia.version)) {
          continue;
        }
        encontrouMc = true;
        if (!loaderCompativel(versao.loaders || [], loaderInstancia, projeto.project_type)) {
          continue;
        }
        encontrouLoader = true;
        const arquivoIdeal = escolherArquivoIdeal(versao, projeto.project_type);
        if (!arquivoIdeal) continue;
        return {
          instancia,
          versaoIdeal: versao,
          arquivoIdeal,
          motivoIncompatibilidade: null,
        };
      }

      if (!encontrouMc) {
        return {
          instancia,
          versaoIdeal: null,
          arquivoIdeal: null,
          motivoIncompatibilidade: "Sem versão compatível com o Minecraft dessa instância",
        };
      }
      if (!encontrouLoader && projeto.project_type === "mod") {
        return {
          instancia,
          versaoIdeal: null,
          arquivoIdeal: null,
          motivoIncompatibilidade: "Sem compatibilidade com o loader da instância",
        };
      }
      return {
        instancia,
        versaoIdeal: null,
        arquivoIdeal: null,
        motivoIncompatibilidade: "Nenhum arquivo instalável encontrado para esta instância",
      };
    });
  }, [
    instanciaSelecionada?.id,
    instancias,
    projeto.project_type,
    projeto.source,
    requerCompatibilidade,
    versoesProjeto,
  ]);

  const compatibilidadesOrdenadas = useMemo(() => {
    const termoPesquisa = normalizarPesquisaInstancia(pesquisaInstancia);
    const filtradas = compatibilidades.filter((item) => {
      if (!termoPesquisa) return true;
      const textoInstancia = normalizarPesquisaInstancia(
        `${item.instancia.name} ${labelLoader(item.instancia)} ${item.instancia.version}`
      );
      return textoInstancia.includes(termoPesquisa);
    });

    filtradas.sort((a, b) =>
      a.instancia.name.localeCompare(b.instancia.name, "pt-BR", {
        numeric: true,
        sensitivity: "base",
      })
    );

    return filtradas.sort((a, b) => {
      const aCompativel = !requerCompatibilidade || Boolean(a.versaoIdeal && a.arquivoIdeal);
      const bCompativel = !requerCompatibilidade || Boolean(b.versaoIdeal && b.arquivoIdeal);
      return Number(bCompativel) - Number(aCompativel);
    });
  }, [compatibilidades, pesquisaInstancia, requerCompatibilidade]);

  useEffect(() => {
    if (projeto.project_type === "modpack" && !instanciaInicialId) {
      setInstanciaSelecionadaId(null);
      return;
    }

    if (
      instanciaSelecionadaId &&
      instancias.some((instancia) => instancia.id === instanciaSelecionadaId)
    ) {
      return;
    }

    const instanciaInicialCompativel = compatibilidades.find(
      (item) =>
        item.instancia.id === instanciaInicialId &&
        item.versaoIdeal &&
        item.arquivoIdeal
    );
    const primeiraCompativel = compatibilidades.find(
      (item) => item.versaoIdeal && item.arquivoIdeal
    );
    setInstanciaSelecionadaId(
      instanciaInicialCompativel?.instancia.id ||
      primeiraCompativel?.instancia.id ||
      instancias[0]?.id ||
      null
    );
  }, [
    compatibilidades,
    instanciaInicialId,
    instanciaSelecionadaId,
    instancias,
    projeto.project_type,
  ]);

  const alternarFavorito = () => {
    if (favorito) {
      removeFavorite(projeto.id);
      setFavorito(false);
      return;
    }

    const item: FavoriteItem = {
      id: projeto.id,
      title: projetoExibicao.title,
      description: projetoExibicao.description,
      icon_url: projetoExibicao.icon_url,
      author: projetoExibicao.author,
      type: projeto.project_type,
      source: projeto.source,
      slug: projetoExibicao.slug,
      downloads: projetoExibicao.downloads,
    };
    addFavorite(item);
    setFavorito(true);
  };

  const compatibilidadeSelecionada = useMemo(() => {
    if (!instanciaSelecionadaId) return null;
    return compatibilidades.find((item) => item.instancia.id === instanciaSelecionadaId) || null;
  }, [compatibilidades, instanciaSelecionadaId]);

  const versoesExibidas = useMemo(() => {
    const ordenadas = [...versoesProjeto]
      .sort(compararVersoesPorData)
      .filter((versao) => {
        if (!escolherArquivoIdeal(versao, projeto.project_type)) return false;
        if (projeto.project_type !== "modpack") return true;
        const loaders = (versao.loaders || []).map((item) => item.toLowerCase());
        if (loaders.includes("quilt")) return false;
        return loaders.length === 0 || ORDEM_LOADER_MODPACK.some((loader) => loaders.includes(loader));
      });
    if (projeto.project_type === "modpack") {
      if (!instanciaInicialId || !instanciaSelecionada) return ordenadas;
      const loaderInstancia = normalizarLoader(
        instanciaSelecionada.loader_type || instanciaSelecionada.mc_type
      );
      return ordenadas.filter(
        (versao) =>
          versaoMinecraftCompativel(versao.game_versions || [], instanciaSelecionada.version) &&
          loaderCompativel(versao.loaders || [], loaderInstancia, projeto.project_type)
      );
    }
    if (!instanciaSelecionada) return ordenadas;
    if (projeto.source === "curseforge" && carregandoVersoes && ordenadas.length > 0) {
      return ordenadas;
    }

    const loaderInstancia = normalizarLoader(
      instanciaSelecionada.loader_type || instanciaSelecionada.mc_type
    );
    return ordenadas.filter(
      (versao) =>
        versaoMinecraftCompativel(versao.game_versions || [], instanciaSelecionada.version) &&
        loaderCompativel(versao.loaders || [], loaderInstancia, projeto.project_type)
    );
  }, [
    carregandoVersoes,
    instanciaSelecionada,
    instanciaInicialId,
    projeto.project_type,
    projeto.source,
    versoesProjeto,
  ]);

  useEffect(() => {
    if (carregandoVersoes) return;
    if (versoesExibidas.some((versao) => versao.id === versaoSelecionadaId)) return;
    setVersaoSelecionadaId(versoesExibidas[0]?.id || null);
  }, [carregandoVersoes, versaoSelecionadaId, versoesExibidas]);

  const versaoSelecionada = useMemo(
    () => versoesExibidas.find((versao) => versao.id === versaoSelecionadaId) || null,
    [versaoSelecionadaId, versoesExibidas]
  );
  const arquivoVersaoSelecionada = useMemo(
    () => versaoSelecionada && escolherArquivoIdeal(versaoSelecionada, projeto.project_type),
    [projeto.project_type, versaoSelecionada]
  );
  const versoesInstaladasIds = useMemo(() => {
    if (projeto.project_type === "modpack") {
      return new Set(
        versoesExibidas
          .filter((versao) =>
            modpacksInstalados.some(
              (info) =>
                String(info.versionId) === String(versao.id) ||
                info.installedVersion === versao.version_number
            )
          )
          .map((versao) => versao.id)
      );
    }

    const nomesInstalados = new Set(
      conteudosInstalados.map((conteudo) => normalizarNomeArquivoInstalado(conteudo.fileName))
    );
    return new Set(
      versoesExibidas
        .filter((versao) =>
          (versao.files || []).some((arquivo) =>
            nomesInstalados.has(normalizarNomeArquivoInstalado(arquivo.filename))
          )
        )
        .map((versao) => versao.id)
    );
  }, [conteudosInstalados, modpacksInstalados, projeto.project_type, versoesExibidas]);

  const instalarProjeto = async () => {
    if (instalando) return;

    if (projeto.project_type === "modpack") {
      if (!usuarioLogado) {
        onSolicitarLogin?.();
        setErro("Faça login para instalar modpacks como nova instância.");
        return;
      }

      setErro(null);
      setInstalando(true);
      let idOverlayCriacao = "";
      try {
        let nomeBaseInstancia = projetoExibicao.title;
        let versaoMinecraft = "";
        let loaderSelecionado: "vanilla" | "fabric" | "forge" | "neoforge" = "vanilla";
        let arquivoModpackUrl = "";
        let arquivoModpackNome = "";
        let arquivoModpackHash: string | null = null;
        let versaoInstalada = "latest";
        let versaoId = "";

        if (!versaoSelecionada || !arquivoVersaoSelecionada) {
          throw new Error("Selecione uma versão do modpack para instalar.");
        }
        const versaoMinecraftSelecionada = escolherVersaoMinecraftIdeal(
          versaoSelecionada.game_versions || []
        );
        if (!versaoMinecraftSelecionada) {
          throw new Error("A versão selecionada não informa uma versão compatível do Minecraft.");
        }

        const loadersVersao = (versaoSelecionada.loaders || []).map((item) =>
          item.toLowerCase()
        );
        loaderSelecionado =
          ORDEM_LOADER_MODPACK.find((loader) => loadersVersao.includes(loader)) || "vanilla";
        versaoMinecraft = versaoMinecraftSelecionada;
        arquivoModpackUrl = arquivoVersaoSelecionada.url;
        arquivoModpackNome = arquivoVersaoSelecionada.filename;
        arquivoModpackHash =
          arquivoVersaoSelecionada.hashes?.sha1 ||
          arquivoVersaoSelecionada.hashes?.sha512 ||
          null;
        versaoInstalada = versaoSelecionada.version_number;
        versaoId = versaoSelecionada.id;

        const instanciaModpackAlvo = instanciaInicialId
          ? instancias.find((item) => item.id === instanciaInicialId) ?? null
          : null;
        const nomeInstancia = instanciaModpackAlvo?.name || gerarNomeInstanciaDisponivel(
          nomeBaseInstancia,
          instancias.map((item) => item.name)
        );
        const idInstancia = instanciaModpackAlvo?.id || gerarIdInstancia(nomeInstancia);
        idOverlayCriacao = `${idInstancia}_${Date.now().toString(36)}`;

        const criandoInstancia: CreatingInstance = {
          id: idOverlayCriacao,
          name: nomeInstancia,
          version: versaoMinecraft,
          type: loaderSelecionado,
          status: "downloading",
          progress: 0,
          message: "Preparando instalação do modpack...",
          icon: obterImagemProjeto(
            projetoExibicao.icon_url,
            projetoExibicao.project_type,
            projetoExibicao.id,
          ),
        };
        addCreatingInstance(criandoInstancia);

        let loaderVersion: string | undefined;
        if (!instanciaModpackAlvo && loaderSelecionado !== "vanilla") {
          updateCreatingInstance(idOverlayCriacao, {
            progress: 8,
            message: "Buscando versão ideal do loader...",
          });
          const respostaLoader = await invoke<LoaderVersionsResponse>("get_loader_versions", {
            loaderType: loaderSelecionado,
            minecraftVersion: versaoMinecraft,
          });
          loaderVersion =
            escolherVersaoLoaderIdeal(
              loaderSelecionado,
              respostaLoader.versions || [],
              versaoMinecraft
            ) || undefined;
          if (!loaderVersion) {
            throw new Error(`Nenhuma versão válida do ${loaderSelecionado} foi encontrada.`);
          }
        }

        updateCreatingInstance(idOverlayCriacao, {
          progress: 20,
          progressoIndeterminado: true,
          message: "Preparando arquivos da instância...",
        });

        if (!instanciaModpackAlvo) {
          const paramsCriacao: Record<string, unknown> = {
            name: nomeInstancia,
            version: versaoMinecraft,
            mcType: loaderSelecionado,
          };
          if (loaderSelecionado !== "vanilla") {
            paramsCriacao.loaderType = loaderSelecionado;
            paramsCriacao.loaderVersion = loaderVersion;
          }
          await invoke("create_instance", paramsCriacao);
        }
        updateCreatingInstance(idOverlayCriacao, {
          progress: 45,
          progressoIndeterminado: false,
          message: instanciaModpackAlvo
            ? "Substituindo arquivos do modpack..."
            : "Instalando arquivos do modpack...",
        });
        updateCreatingInstance(idOverlayCriacao, {
          progress: 60,
          progressoIndeterminado: true,
          message: "Instalando arquivos do modpack...",
        });
        await invoke("install_modpack_files", {
          instanceId: idInstancia,
          downloadUrl: arquivoModpackUrl,
          fileName: arquivoModpackNome,
          substituirConteudo: Boolean(instanciaModpackAlvo),
        });
        await invoke("save_modpack_info", {
          instanceId: idInstancia,
          modpackInfo: {
            projectId: projeto.id,
            versionId: versaoId,
            fileId: arquivoModpackHash,
            name: nomeBaseInstancia,
            author: projetoExibicao.author,
            icon: projetoExibicao.icon_url,
            slug: projetoExibicao.slug,
            source: projeto.source,
            installedVersion: versaoInstalada,
          },
        });
        completeCreatingInstance(idOverlayCriacao);
        setInstalando(false);
        setSucesso(true);
        onInstanciaCriada?.();
      } catch (e) {
        const mensagem = extrairMensagemErro(e, "Falha ao instalar modpack.");
        setErro(mensagem);
        if (idOverlayCriacao) errorCreatingInstance(idOverlayCriacao, mensagem);
        setInstalando(false);
      }
      return;
    }

    const instanciaAlvo = instancias.find((item) => item.id === instanciaSelecionadaId);
    if (!instanciaAlvo) {
      setErro("Selecione uma instância para continuar.");
      return;
    }

    if (
      requerCompatibilidade &&
      (!compatibilidadeSelecionada?.versaoIdeal || !compatibilidadeSelecionada.arquivoIdeal)
    ) {
      setErro("Selecione uma instância compatível para continuar.");
      return;
    }

    if (!versaoSelecionada || !arquivoVersaoSelecionada) {
      setErro("Selecione uma versão para continuar.");
      return;
    }

    setErro(null);
    setInstalando(true);
    try {
      if (projeto.project_type === "mod") {
        await invoke("install_mod", {
          instanceId: instanciaAlvo.id,
          modInfo: {
            id: projeto.id,
            name: projetoExibicao.title,
            description: projetoExibicao.description,
            author: projetoExibicao.author,
            version: versaoSelecionada.version_number,
            download_url: arquivoVersaoSelecionada.url,
            file_name: arquivoVersaoSelecionada.filename,
            platform: projeto.source,
            dependencies: [],
            version_id: versaoSelecionada.id,
          },
        });
      } else {
        await invoke("install_project_file", {
          instanceId: instanciaAlvo.id,
          projectType: projeto.project_type,
          downloadUrl: arquivoVersaoSelecionada.url,
          fileName: arquivoVersaoSelecionada.filename,
        });
      }
      setSucesso(true);
      setRevisaoConteudoInstalado((revisao) => revisao + 1);
      setInstalando(false);
    } catch (e) {
      setErro(extrairMensagemErro(e, "Erro ao instalar projeto."));
      setInstalando(false);
    }
  };

  useEffect(() => {
    if (!instalarAoAbrir || instalacaoAutomaticaIniciada.current) return;
    if (projeto.project_type !== "modpack" || carregandoVersoes) return;
    if (!versaoSelecionada || !arquivoVersaoSelecionada) return;

    instalacaoAutomaticaIniciada.current = true;
    onInstalacaoAutomaticaIniciada?.();
    void instalarProjeto();
  }, [
    arquivoVersaoSelecionada,
    carregandoVersoes,
    instalarAoAbrir,
    onInstalacaoAutomaticaIniciada,
    projeto.project_type,
    versaoSelecionada,
  ]);

  return (
    <div className="min-h-full space-y-6">
      <section>
        <div className="border-b border-white/10 p-5">
          <div className="flex items-start gap-4">
            <img
              src={obterImagemProjeto(
                projetoExibicao.icon_url,
                projetoExibicao.project_type,
                projetoExibicao.id,
              )}
              alt={projetoExibicao.title}
              className="h-20 w-20 rounded-xl border border-white/15 bg-black/30 object-cover"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-4">
                <h1 className="min-w-0 truncate text-3xl font-black tracking-tight">
                  {projetoExibicao.title}
                </h1>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={alternarFavorito}
                    aria-label={favorito ? "Remover dos favoritos" : "Adicionar aos favoritos"}
                    title={favorito ? "Remover dos favoritos" : "Adicionar aos favoritos"}
                    className={cn(
                      "inline-flex h-9 w-9 items-center justify-center rounded-xl transition-all",
                      favorito
                        ? "bg-pink-500/20 text-pink-400"
                        : "bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/70"
                    )}
                  >
                    <Heart size={16} fill={favorito ? "currentColor" : "none"} />
                  </button>
                  <button
                    onClick={instalarProjeto}
                    disabled={
                      instalando ||
                      carregandoVersoes ||
                      !versaoSelecionada ||
                      !arquivoVersaoSelecionada ||
                      (projeto.project_type !== "modpack" && !instanciaSelecionadaId) ||
                      (requerCompatibilidade &&
                        (!compatibilidadeSelecionada?.versaoIdeal ||
                          !compatibilidadeSelecionada.arquivoIdeal))
                    }
                    className={cn(
                      "inline-flex items-center gap-2 border px-4 py-2 text-xs font-black uppercase tracking-wide",
                      instalando
                        ? "border-white/20 bg-white/10 text-white/45"
                        : sucesso
                          ? "border-emerald-300 bg-emerald-500 text-black"
                          : "border-emerald-300 bg-emerald-500 text-black hover:bg-emerald-400"
                    )}
                  >
                    {instalando ? (
                      <>
                        <Loader2 size={13} className="animate-spin" />
                        Instalando...
                      </>
                    ) : sucesso ? (
                      <>
                        <Check size={13} />
                        Instalado
                      </>
                    ) : (
                      <>
                        <Download size={13} />
                        {instanciaInicialId && projeto.project_type === "modpack"
                          ? "Trocar versão"
                          : rotuloAcao}
                      </>
                    )}
                  </button>
                </div>
              </div>
              <p className="text-sm text-white/60">por {projetoExibicao.author}</p>
              <p className="mt-2 text-sm text-white/75">
                {projetoExibicao.description || "Sem descrição disponível."}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-white/45">
                {typeof projetoExibicao.downloads === "number" && (
                  <span className="flex items-center gap-1">
                    <Download size={11} />
                    {formatarNumero(projetoExibicao.downloads)}
                  </span>
                )}
                {typeof projetoExibicao.follows === "number" && (
                  <span className="flex items-center gap-1">
                    <Check size={11} />
                    {formatarNumero(projetoExibicao.follows)}
                  </span>
                )}
                <span className="uppercase">{projetoExibicao.project_type}</span>
                <span className="uppercase">{projetoExibicao.source}</span>
                {(projetoExibicao.categorias || []).slice(0, 5).map((categoria) => (
                  <span
                    key={categoria}
                    className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 capitalize text-white/60"
                  >
                    {categoria}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="border-b border-white/10 px-5 py-3">
          <div className="inline-flex rounded-xl border border-white/10 bg-black/25 p-1">
            <button
              onClick={() => setAbaConteudo("descricao")}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-bold transition-colors",
                abaConteudo === "descricao"
                  ? "bg-emerald-500 text-black"
                  : "text-white/60 hover:text-white"
              )}
            >
              Descrição
            </button>
            <button
              onClick={() => setAbaConteudo("versoes")}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-bold transition-colors",
                abaConteudo === "versoes"
                  ? "bg-emerald-500 text-black"
                  : "text-white/60 hover:text-white"
              )}
            >
              Versões
            </button>
            <button
              onClick={() => setAbaConteudo("galeria")}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-bold transition-colors",
                abaConteudo === "galeria"
                  ? "bg-emerald-500 text-black"
                  : "text-white/60 hover:text-white"
              )}
            >
              Galeria
            </button>
          </div>
        </div>

        <div
          className={cn(
            "grid grid-cols-1 gap-6 p-5",
            abaConteudo === "versoes" &&
              projeto.project_type !== "modpack" &&
              "xl:grid-cols-[minmax(0,1fr)_360px]"
          )}
        >
          <div
            className={cn(
              "min-w-0 space-y-4",
              abaConteudo === "descricao" && "mx-auto w-full max-w-5xl"
            )}
          >
            {abaConteudo === "descricao" && (
              <>
                {analises.length > 0 && <section
                  className="mx-auto w-full max-w-5xl space-y-3"
                  aria-label="Análises da comunidade"
                >
                  {erroAnalises && <p className="text-xs text-orange-200">{erroAnalises}</p>}
                  {analises[indiceAnalise] && (() => {
                    const analise = analises[indiceAnalise];
                    return (
                      <article className="rounded-2xl border border-white/10 bg-black/25 p-4">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            {analises.length > 1 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setIndiceAnalise((atual) => (atual - 1 + analises.length) % analises.length)
                                }
                                aria-label="Análise anterior"
                                title="Análise anterior"
                                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                              >
                                <ChevronLeft size={15} />
                              </button>
                            )}
                            <div className="min-w-0">
                              <p className="truncate text-xs font-bold text-white/90">
                                {analise.autorNome}
                                {analise.autorHandle && (
                                  <span className="ml-1 font-normal text-white/40">@{analise.autorHandle}</span>
                                )}
                              </p>
                              <p className="mt-0.5 text-[11px] text-white/40">
                                <span
                                  className={
                                    analise.recomendado
                                      ? "font-bold text-emerald-300"
                                      : "font-bold text-red-300"
                                  }
                                >
                                  {analise.recomendado ? "◆ Recomendo" : "◆ Não recomendo"}
                                </span>
                                {typeof analise.horasRegistradas === "number" && (
                                  <span>
                                    {" "}· {analise.horasRegistradas.toLocaleString("pt-BR", {
                                      maximumFractionDigits: 1,
                                    })} h registradas
                                  </span>
                                )}
                              </p>
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {analises.length > 1 && (
                              <span className="text-[11px] text-white/40">
                                {indiceAnalise + 1}/{analises.length}
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => void curtirAnalise(analise)}
                              disabled={!tokenSocial || curtindoId === analise.id}
                              title={analise.curtidoPorMim ? "Remover curtida" : "Achar útil"}
                              className={cn(
                                "inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[11px] font-bold transition-colors disabled:opacity-40",
                                analise.curtidoPorMim
                                  ? "border-pink-400/50 bg-pink-500/15 text-pink-300"
                                  : "border-white/10 bg-white/5 text-white/55 hover:text-white"
                              )}
                            >
                              <Heart size={12} fill={analise.curtidoPorMim ? "currentColor" : "none"} />
                              {analise.totalCurtidas}
                            </button>
                            {analises.length > 1 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setIndiceAnalise((atual) => (atual + 1) % analises.length)
                                }
                                aria-label="Próxima análise"
                                title="Próxima análise"
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                              >
                                <ChevronRight size={15} />
                              </button>
                            )}
                          </div>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-white/80">“{analise.conteudo}”</p>
                      </article>
                    );
                  })()}
                </section>}
                {carregandoDetalhes && !descricaoCompletaProjeto && (
                  <div className="flex items-center gap-2 text-sm text-white/50">
                    <Loader2 size={14} className="animate-spin" />
                    Carregando descrição completa...
                  </div>
                )}
                {erroDetalhes && <p className="text-xs text-orange-200">{erroDetalhes}</p>}
                {descricaoCompletaProjeto ? (
                  <article className="space-y-4 rounded-2xl border border-white/10 bg-black/25 p-4">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeRaw, rehypeSanitize]}
                      components={COMPONENTES_MARKDOWN}
                    >
                      {descricaoCompletaProjeto}
                    </ReactMarkdown>
                  </article>
                ) : (
                  <article className="rounded-2xl border border-white/10 bg-black/25 p-4 text-sm text-white/75 leading-7">
                    {projetoExibicao.description || "Sem descrição disponível."}
                  </article>
                )}
              </>
            )}

            {abaConteudo === "versoes" &&
              (carregandoVersoes && versoesProjeto.length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-white/50">
                  <Loader2 size={14} className="animate-spin" />
                  Carregando versões...
                </div>
              ) : projeto.project_type !== "modpack" && !instanciaSelecionada ? (
                <p className="text-sm text-white/55">
                  Selecione uma instância para consultar as versões compatíveis.
                </p>
              ) : versoesExibidas.length === 0 ? (
                <p className="text-sm text-white/55">
                  {projeto.project_type !== "modpack" && instanciaSelecionada
                    ? `Nenhuma versão compatível com ${labelLoader(instanciaSelecionada)} ${instanciaSelecionada.version}.`
                    : "Nenhuma versão encontrada para este projeto."}
                </p>
              ) : (
                <div className="relative">
                  {carregandoVersoes && (
                    <div
                      className={cn(
                        "absolute right-2 top-2 z-10 flex items-center gap-2 bg-[#141416]/90",
                        "px-2 py-1 text-[11px] text-white/65"
                      )}
                    >
                      <Loader2 size={12} className="animate-spin" />
                      Atualizando versões...
                    </div>
                  )}
                  <div
                    className={cn(
                      "grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3",
                      carregandoVersoes && "opacity-45"
                    )}
                  >
                    {versoesExibidas.map((versao) => {
                      const selecionada = versaoSelecionadaId === versao.id;
                      const instalada = versoesInstaladasIds.has(versao.id);
                      return (
                        <button
                          type="button"
                          key={versao.id}
                          aria-pressed={selecionada}
                          onClick={() => {
                            setVersaoSelecionadaId(versao.id);
                            setSucesso(false);
                            setErro(null);
                          }}
                          className={cn(
                            "min-h-32 border px-3 py-3 text-left text-xs transition-colors",
                            selecionada
                              ? "border-emerald-400/60 bg-emerald-500/10"
                              : instalada
                                ? "border-sky-400/45 bg-sky-500/10"
                              : "border-white/10 bg-black/20 hover:border-white/25"
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="line-clamp-2 font-bold text-white/90">
                              {versao.version_number}
                            </p>
                            {selecionada && (
                              <span className="flex shrink-0 items-center gap-1 text-[10px] font-bold text-emerald-300">
                                <Check size={11} />
                                Selecionada
                              </span>
                            )}
                          </div>
                          {instalada && (
                            <p className="mt-2 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-sky-300">
                              <Check size={11} />
                              Instalada
                            </p>
                          )}
                          <p className="mt-1 text-white/55">
                            MC: {(versao.game_versions || []).slice(0, 4).join(", ") || "qualquer"}
                          </p>
                          <p className="mt-0.5 text-white/55">
                            Loader: {(versao.loaders || []).join(", ") || "não informado"}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

            {abaConteudo === "versoes" && projeto.project_type === "modpack" && erro && (
              <p className="text-xs text-red-300">{erro}</p>
            )}

            {abaConteudo === "galeria" &&
              (carregandoDetalhes ? (
                <div className="flex items-center gap-2 text-sm text-white/50">
                  <Loader2 size={14} className="animate-spin" />
                  Carregando galeria...
                </div>
              ) : galeriaProjeto.length === 0 ? (
                <p className="text-sm text-white/55">Este projeto não possui imagens na galeria.</p>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {galeriaProjeto.map((imagem, indice) => (
                    <a
                      key={`${imagem.url}_${indice}`}
                      href={imagem.raw_url || imagem.url}
                      target="_blank"
                      rel="noreferrer"
                      className="group overflow-hidden rounded-xl border border-white/10 bg-black/30"
                    >
                      <img
                        src={imagem.url}
                        alt={imagem.title || `Imagem ${indice + 1}`}
                        className="h-44 w-full object-cover transition-transform duration-300 group-hover:scale-[1.02] xl:h-52"
                      />
                      {(imagem.title || imagem.description) && (
                        <div className="space-y-1 border-t border-white/10 p-3">
                          {imagem.title && (
                            <p className="text-xs font-bold text-white/90">{imagem.title}</p>
                          )}
                          {imagem.description && (
                            <p className="text-xs text-white/60">{imagem.description}</p>
                          )}
                        </div>
                      )}
                    </a>
                  ))}
                </div>
              ))}

          </div>

          {abaConteudo === "versoes" && projeto.project_type !== "modpack" && (
            <aside className="h-fit space-y-3 border border-white/10 bg-black/20 p-4">
              <h3 className="text-xs font-black uppercase tracking-wide text-white/70">
                Instalação
              </h3>

              <div className="space-y-2">
                <p className="text-xs text-white/65">Escolha a instância:</p>
                <label className="relative block">
                  <Search
                    size={13}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/35"
                  />
                  <input
                    type="search"
                    value={pesquisaInstancia}
                    onChange={(evento) => setPesquisaInstancia(evento.target.value)}
                    placeholder="Pesquisar instância..."
                    aria-label="Pesquisar instâncias instaladas"
                    className={cn(
                      "w-full border border-white/10 bg-black/25 py-2 pl-9 pr-3 text-xs text-white",
                      "outline-none transition-colors placeholder:text-white/30 focus:border-emerald-400/45"
                    )}
                  />
                </label>
                {compatibilidadesOrdenadas.map((item) => {
                  const selecionada = instanciaSelecionadaId === item.instancia.id;
                  const atualizandoSelecionada =
                    carregandoVersoes &&
                    selecionada &&
                    projeto.source === "curseforge" &&
                    projeto.project_type !== "modpack";
                  const compativel =
                    atualizandoSelecionada ||
                    !requerCompatibilidade ||
                    (projeto.source === "curseforge" &&
                      projeto.project_type !== "modpack" &&
                      item.instancia.id !== instanciaSelecionadaId) ||
                    Boolean(item.versaoIdeal && item.arquivoIdeal);
                  return (
                    <button
                      key={item.instancia.id}
                      onClick={() => {
                        if (selecionada) return;
                        if (
                          projeto.source === "curseforge" &&
                          projeto.project_type !== "modpack"
                        ) {
                          setCarregandoVersoes(true);
                        }
                        setInstanciaSelecionadaId(item.instancia.id);
                      }}
                      className={cn(
                        "w-full border px-3 py-2 text-left",
                        selecionada
                          ? "border-emerald-400/45 bg-emerald-500/10"
                          : "border-white/10 bg-white/5",
                        !compativel && "opacity-70"
                      )}
                    >
                      <p className="truncate text-xs font-bold">{item.instancia.name}</p>
                      <p className="mt-0.5 flex items-center gap-1 text-[11px] text-white/45">
                        <Gamepad2 size={10} />
                        {labelLoader(item.instancia)} {item.instancia.version}
                      </p>
                      {!compativel && (
                        <p className="mt-1 text-[11px] text-orange-200">
                          {item.motivoIncompatibilidade}
                        </p>
                      )}
                    </button>
                  );
                })}
                {compatibilidades.length === 0 && (
                  <p className="text-xs text-white/45">Nenhuma instância disponível no launcher.</p>
                )}
                {compatibilidades.length > 0 && compatibilidadesOrdenadas.length === 0 && (
                  <p className="text-xs text-white/45">
                    Nenhuma instância encontrada para “{pesquisaInstancia.trim()}”.
                  </p>
                )}
              </div>

              {erro && <p className="text-xs text-red-300">{erro}</p>}
            </aside>
          )}
        </div>
      </section>
    </div>
  );
}
