import { lazy, startTransition, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Avatar,
  Heart,
  Home,
  Loader2,
  LogIn,
  Play,
  Plus,
  Search,
  Settings,
  Users,
  User,
} from "./iconesPixelados";
import { AnimatePresence, motion } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { cn } from "./lib/utils";
import { LoginModal } from "./components/LoginModal";
import CreateInstanceModal from "./components/CreateInstanceModal";
import CreatingInstancesOverlay from "./components/CreatingInstancesOverlay";
import { useLauncher, type Instance } from "./hooks/useLauncher";
import { useBreakpointXl } from "./hooks/useBreakpointXl";
import type { AbaOrigemProjeto, ProjetoConteudo } from "./components/ProjetoDetalheModal";
import Explore from "./components/Explore";
import Favorites from "./components/Favorites";
import LibraryPage from "./components/LibraryPage";
import HomePage from "./components/HomePage";
import SettingsPage from "./components/Settings";
import InstanceManager from "./components/InstanceManager";
import SocialSidebar from "./components/SocialSidebar";
import { EsqueletoAba } from "./components/EsqueletoCarregamento";
import VisualizacaoInstanciaSocial from "./components/VisualizacaoInstanciaSocial";
import { NovidadesVersaoModal, type NovidadesVersao } from "./components/NovidadesVersaoModal";
import type { AmigoSocial } from "./components/social/tiposSocial";
import { aplicarCorDestaque, normalizarCorDestaque } from "./lib/corDestaque";
import {
  EVENTO_INSTANCIAS_PUBLICAS_SOCIAIS,
  type PublicacaoInstanciaSocial,
} from "./lib/eventosTransferenciaSocial";

const carregarSkinManager = () =>
  import("./components/SkinManager").then((modulo) => ({ default: modulo.SkinManager }));
const carregarProjetoDetalheModal = () => import("./components/ProjetoDetalheModal");
const SkinManager = lazy(carregarSkinManager);
const ProjetoDetalheModal = lazy(carregarProjetoDetalheModal);

export interface MinecraftAccount {
  uuid: string;
  name: string;
  access_token: string;
  expires_at?: number;
}

interface ModpackInstancia {
  projectId: string;
  versionId: string;
  fileId?: string | null;
  source: "modrinth" | "curseforge";
  name: string;
  icon?: string | null;
  modificado?: boolean;
}

async function normalizarImagemAtividade(valor: string | null | undefined): Promise<string | null> {
  const imagem = valor?.trim();
  if (!imagem) return null;

  if (/^https?:\/\//i.test(imagem)) {
    if (imagem.length > 2048) return null;
    try {
      const url = new URL(imagem);
      return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
    } catch {
      return null;
    }
  }

  if (
    imagem.length > 5_000_000 ||
    !/^data:image\/(?:png|jpe?g|webp);base64,/i.test(imagem)
  ) {
    return null;
  }

  return new Promise((resolver) => {
    const elemento = new Image();
    elemento.onload = () => {
      const escala = Math.min(1, 96 / Math.max(elemento.naturalWidth, elemento.naturalHeight));
      const largura = Math.max(1, Math.round(elemento.naturalWidth * escala));
      const altura = Math.max(1, Math.round(elemento.naturalHeight * escala));
      const canvas = document.createElement("canvas");
      canvas.width = largura;
      canvas.height = altura;
      const contexto = canvas.getContext("2d");
      if (!contexto) {
        resolver(null);
        return;
      }

      contexto.imageSmoothingEnabled = true;
      contexto.imageSmoothingQuality = "high";
      contexto.drawImage(elemento, 0, 0, largura, altura);
      const resultado = canvas.toDataURL("image/webp", 0.82);
      resolver(resultado.length <= 180_000 ? resultado : null);
    };
    elemento.onerror = () => resolver(null);
    elemento.src = imagem;
  });
}

function normalizarTextoComparacao(valor: string | null | undefined): string {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

async function encontrarInstanciaDaAtividade(
  instancias: Instance[],
  atividade: AmigoSocial["atividadeAtual"]
): Promise<Instance | null> {
  if (!atividade || atividade.tipo === "launcher") return null;

  if (atividade.tipo === "modpack_exato" && atividade.projectId && atividade.versionId) {
    const resultados = await Promise.all(instancias.map(async (instancia) => {
      try {
        const modpack = await invoke<ModpackInstancia | null>("get_modpack_info", {
          instanceId: instancia.id,
        });
        const corresponde = Boolean(modpack) && !modpack?.modificado && modpack?.source === atividade.source &&
          String(modpack?.projectId) === String(atividade.projectId) &&
          String(modpack?.versionId) === String(atividade.versionId);
        return corresponde ? instancia : null;
      } catch {
        return null;
      }
    }));
    return resultados.find((instancia): instancia is Instance => instancia !== null) ?? null;
  }

  const instanciaPorId = atividade.instanciaId
    ? instancias.find((instancia) => normalizarTextoComparacao(instancia.id) ===
      normalizarTextoComparacao(atividade.instanciaId))
    : null;
  if (instanciaPorId) return instanciaPorId;

  const nomeAtividade = normalizarTextoComparacao(atividade.instanciaNome || atividade.modpackNome);
  if (!nomeAtividade) return null;

  return instancias.find((instancia) => {
    if (normalizarTextoComparacao(instancia.name) !== nomeAtividade) return false;

    const mesmaVersao = !atividade.versaoMinecraft ||
      normalizarTextoComparacao(instancia.version) === normalizarTextoComparacao(atividade.versaoMinecraft);
    const loaderInstancia = instancia.loader_type || instancia.mc_type;
    const mesmoLoader = !atividade.loader ||
      normalizarTextoComparacao(loaderInstancia) === normalizarTextoComparacao(atividade.loader);

    return mesmaVersao && mesmoLoader;
  }) ?? null;
}

const CHAVE_ULTIMA_INSTANCIA = "dome:ultima-instancia-iniciada";
const CHAVE_NOVIDADES_PENDENTES = "dome:novidades-pendentes";
const CHAVE_ULTIMA_NOVIDADE_EXIBIDA = "dome:ultima-novidade-exibida";
const INTERVALO_VERIFICACAO_INSTANCIAS_MS = 20 * 1000;
const LIMITE_HISTORICO_NAVEGACAO = 50;
type TipoExplorePresence = "modpack" | "mod" | "resourcepack" | "shader";
type FonteExplorePresence = "modrinth" | "curseforge" | "ambas";
const TITULOS_ABA: Record<string, string> = {
  home: "Início",
  instances: "Biblioteca",
  explore: "Explorar",
  favorites: "Favoritos",
  skins: "Skins",
  settings: "Configurações",
  "instance-manager": "Instância",
  "project-detail": "Projeto",
};

export default function App() {
  const { instances, launch, launchServer, remove, fetchInstances } = useLauncher();
  const [activeTab, setActiveTab] = useState("home");
  const [historicoNavegacao, setHistoricoNavegacao] = useState<{
    anteriores: string[];
    proximas: string[];
  }>({ anteriores: [], proximas: [] });
  const [selectedInstance, setSelectedInstance] = useState<Instance | null>(null);
  const [isLoginOpen, setIsLoginOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [managedInstanceId, setManagedInstanceId] = useState<string>("");
  const [user, setUser] = useState<MinecraftAccount | null>(null);
  const [mapaExecucao, setMapaExecucao] = useState<Record<string, boolean>>({});
  const [instanciaSendoEncerrada, setInstanciaSendoEncerrada] = useState<string | null>(null);
  const [servidorPorInstancia, setServidorPorInstancia] = useState<Record<string, string>>({});
  const [publicacoesPorInstancia, setPublicacoesPorInstancia] = useState<Record<string, string>>({});
  const [contextoExplore, setContextoExplore] = useState<{
    tipo: TipoExplorePresence;
    fonte: FonteExplorePresence;
    titulo?: string;
  } | null>(null);
  const [ultimaInstanciaIniciada, setUltimaInstanciaIniciada] = useState<string | null>(() =>
    localStorage.getItem(CHAVE_ULTIMA_INSTANCIA)
  );
  const [atualizacaoDisponivel, setAtualizacaoDisponivel] = useState<Update | null>(null);
  const [novidadesVersao, setNovidadesVersao] = useState<NovidadesVersao | null>(null);
  const [instalandoAtualizacao, setInstalandoAtualizacao] = useState(false);
  const [erroAtualizacao, setErroAtualizacao] = useState<string | null>(null);
  const [progressoAtualizacao, setProgressoAtualizacao] = useState<{
    baixados: number;
    total?: number;
  } | null>(null);
  const [projetoDetalhe, setProjetoDetalhe] = useState<ProjetoConteudo | null>(null);
  const [atividadeSocialDetalhe, setAtividadeSocialDetalhe] = useState<AmigoSocial | null>(null);
  const [abaOrigemProjeto, setAbaOrigemProjeto] = useState<AbaOrigemProjeto>("home");
  const [corDestaque, setCorDestaque] = useState("#10B981");
  const [contasMinecraft, setContasMinecraft] = useState<MinecraftAccount[]>([]);
  const [carregandoContasMinecraft, setCarregandoContasMinecraft] = useState(false);
  const [menuContaAberto, setMenuContaAberto] = useState(false);
  const [socialDrawerAberto, setSocialDrawerAberto] = useState(false);
  const [chatSocialAberto, setChatSocialAberto] = useState(false);
  const [painelSocialRecuado, setPainelSocialRecuado] = useState(true);
  const ehTelaXl = useBreakpointXl();
  const ultimaAssinaturaPresence = useRef<string>("");
  const menuContaRef = useRef<HTMLDivElement | null>(null);
  const alterarAba = useCallback((aba: string) => {
    startTransition(() => setActiveTab(aba));
  }, []);

  const navegarParaAba = useCallback((aba: string) => {
    if (aba === activeTab) return;

    setHistoricoNavegacao((historico) => ({
      anteriores: [...historico.anteriores, activeTab].slice(-LIMITE_HISTORICO_NAVEGACAO),
      proximas: [],
    }));
    alterarAba(aba);
  }, [activeTab, alterarAba]);

  const voltarNavegacao = useCallback(() => {
    const destino = historicoNavegacao.anteriores[
      historicoNavegacao.anteriores.length - 1
    ];
    if (!destino) return;

    setHistoricoNavegacao((historico) => ({
      anteriores: historico.anteriores.slice(0, -1),
      proximas: [activeTab, ...historico.proximas].slice(0, LIMITE_HISTORICO_NAVEGACAO),
    }));
    alterarAba(destino);
  }, [activeTab, alterarAba, historicoNavegacao.anteriores]);

  const avancarNavegacao = useCallback(() => {
    const [destino] = historicoNavegacao.proximas;
    if (!destino) return;

    setHistoricoNavegacao((historico) => ({
      anteriores: [...historico.anteriores, activeTab].slice(-LIMITE_HISTORICO_NAVEGACAO),
      proximas: historico.proximas.slice(1),
    }));
    alterarAba(destino);
  }, [activeTab, alterarAba, historicoNavegacao.proximas]);

  useEffect(() => {
    const atualizarPublicacoes = (evento: Event) => {
      const publicacoes = (evento as CustomEvent<PublicacaoInstanciaSocial[]>).detail ?? [];
      setPublicacoesPorInstancia(Object.fromEntries(
        publicacoes.map((publicacao) => [publicacao.instanciaId, publicacao.compartilhamentoId])
      ));
    };
    window.addEventListener(EVENTO_INSTANCIAS_PUBLICAS_SOCIAIS, atualizarPublicacoes);
    return () => window.removeEventListener(EVENTO_INSTANCIAS_PUBLICAS_SOCIAIS, atualizarPublicacoes);
  }, []);

  useEffect(() => {
    const navegarPeloTeclado = (evento: KeyboardEvent) => {
      if (!evento.altKey || evento.ctrlKey || evento.metaKey || evento.shiftKey) return;

      if (evento.key === "ArrowLeft" && historicoNavegacao.anteriores.length > 0) {
        evento.preventDefault();
        voltarNavegacao();
      }

      if (evento.key === "ArrowRight" && historicoNavegacao.proximas.length > 0) {
        evento.preventDefault();
        avancarNavegacao();
      }
    };

    window.addEventListener("keydown", navegarPeloTeclado);
    return () => window.removeEventListener("keydown", navegarPeloTeclado);
  }, [avancarNavegacao, historicoNavegacao, voltarNavegacao]);

  useEffect(() => {
    if (activeTab === "home" || activeTab === "instances") {
      void fetchInstances();
    }
  }, [activeTab, fetchInstances]);

  const carregarContasMinecraft = useCallback(async () => {
    setCarregandoContasMinecraft(true);
    try {
      const contas = await invoke<MinecraftAccount[]>("list_minecraft_accounts");
      setContasMinecraft(contas ?? []);
    } catch (erro) {
      console.error("Falha ao carregar contas salvas", erro);
      setContasMinecraft([]);
    } finally {
      setCarregandoContasMinecraft(false);
    }
  }, []);

  const carregarContaMinecraftAtiva = useCallback(async () => {
    try {
      const account = await invoke<MinecraftAccount | null>("check_auth_status");
      if (!account) {
        setUser(null);
        return;
      }

      const agora = Math.floor(Date.now() / 1000);
      const expiracao = account.expires_at;
      if (expiracao && agora >= expiracao) {
        try {
          const refreshed = await invoke<MinecraftAccount>("refresh_token");
          setUser(refreshed);
          return;
        } catch {
          setUser(account);
          return;
        }
      }

      setUser(account);
    } catch (e) {
      console.error("Falha ao verificar auth", e);
      setUser(null);
    }
  }, []);

  const atualizarSessaoMinecraft = useCallback(async () => {
    await Promise.all([carregarContaMinecraftAtiva(), carregarContasMinecraft()]);
  }, [carregarContaMinecraftAtiva, carregarContasMinecraft]);

  const deslogarContaMinecraft = useCallback(async () => {
    try {
      await invoke("logout");
    } catch (erro) {
      console.error("Falha ao deslogar conta", erro);
    } finally {
      setUser(null);
      await carregarContasMinecraft();
    }
  }, [carregarContasMinecraft]);

  const trocarContaMinecraft = useCallback(
    async (uuid: string) => {
      try {
        const conta = await invoke<MinecraftAccount>("switch_minecraft_account", { uuid });
        setUser(conta);
      } catch (erro) {
        console.error("Falha ao trocar conta", erro);
      } finally {
        await carregarContasMinecraft();
      }
    },
    [carregarContasMinecraft]
  );

  const removerContaMinecraft = useCallback(
    async (uuid: string) => {
      try {
        await invoke("remove_minecraft_account", { uuid });
        if (user?.uuid === uuid) {
          setUser(null);
        }
      } catch (erro) {
        console.error("Falha ao remover conta", erro);
      } finally {
        await atualizarSessaoMinecraft();
      }
    },
    [atualizarSessaoMinecraft, user?.uuid]
  );

  useEffect(() => {
    atualizarSessaoMinecraft();
  }, [atualizarSessaoMinecraft]);

  useEffect(() => {
    const carregarCorDestaque = async () => {
      try {
        const configuracoes = await invoke<{ cor_destaque?: string }>("get_settings");
        setCorDestaque(normalizarCorDestaque(configuracoes?.cor_destaque));
      } catch {
        setCorDestaque("#10B981");
      }
    };

    const aoAtualizarCor = (evento: Event) => {
      const detalhe = (evento as CustomEvent<{ cor?: string }>).detail;
      setCorDestaque(normalizarCorDestaque(detalhe?.cor));
    };

    carregarCorDestaque();
    window.addEventListener("dome:cor-destaque-atualizada", aoAtualizarCor);
    return () => {
      window.removeEventListener("dome:cor-destaque-atualizada", aoAtualizarCor);
    };
  }, []);

  useEffect(() => {
    aplicarCorDestaque(corDestaque);
  }, [corDestaque]);

  useEffect(() => {
    if (!menuContaAberto) {
      return;
    }

    const fecharAoClicarFora = (evento: MouseEvent) => {
      if (
        menuContaRef.current &&
        !menuContaRef.current.contains(evento.target as Node)
      ) {
        setMenuContaAberto(false);
      }
    };

    const fecharAoPressionarEscape = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") {
        setMenuContaAberto(false);
      }
    };

    document.addEventListener("mousedown", fecharAoClicarFora);
    window.addEventListener("keydown", fecharAoPressionarEscape);

    return () => {
      document.removeEventListener("mousedown", fecharAoClicarFora);
      window.removeEventListener("keydown", fecharAoPressionarEscape);
    };
  }, [menuContaAberto]);

  useEffect(() => {
    if (selectedInstance && !instances.some((instancia) => instancia.id === selectedInstance.id)) {
      setSelectedInstance(null);
    }
  }, [instances, selectedInstance]);

  useEffect(() => {
    setMenuContaAberto(false);
    setSocialDrawerAberto(false);
  }, [activeTab]);

  useEffect(() => {
    if (ehTelaXl && socialDrawerAberto) {
      setSocialDrawerAberto(false);
    }
  }, [ehTelaXl, socialDrawerAberto]);

  useEffect(() => {
    if (ultimaInstanciaIniciada) {
      localStorage.setItem(CHAVE_ULTIMA_INSTANCIA, ultimaInstanciaIniciada);
    } else {
      localStorage.removeItem(CHAVE_ULTIMA_INSTANCIA);
    }
  }, [ultimaInstanciaIniciada]);

  useEffect(() => {
    const carregarNovidadesPendentes = async () => {
      const valorPendente = localStorage.getItem(CHAVE_NOVIDADES_PENDENTES);
      if (!valorPendente) return;

      try {
        const pendente = JSON.parse(valorPendente) as Partial<NovidadesVersao>;
        if (typeof pendente.versao !== "string" || typeof pendente.conteudo !== "string") {
          localStorage.removeItem(CHAVE_NOVIDADES_PENDENTES);
          return;
        }

        const versaoAtual = (await getVersion()).replace(/^v/i, "");
        const versaoPendente = pendente.versao.replace(/^v/i, "");
        const ultimaExibida = localStorage.getItem(CHAVE_ULTIMA_NOVIDADE_EXIBIDA);
        if (versaoAtual === versaoPendente && ultimaExibida !== versaoAtual) {
          setNovidadesVersao({ versao: versaoAtual, conteudo: pendente.conteudo });
        }
      } catch {
        localStorage.removeItem(CHAVE_NOVIDADES_PENDENTES);
      }
    };

    void carregarNovidadesPendentes();
  }, []);

  const fecharNovidadesVersao = useCallback(() => {
    if (novidadesVersao) {
      localStorage.setItem(CHAVE_ULTIMA_NOVIDADE_EXIBIDA, novidadesVersao.versao);
      localStorage.removeItem(CHAVE_NOVIDADES_PENDENTES);
    }
    setNovidadesVersao(null);
  }, [novidadesVersao]);

  const verificarAtualizacoes = useCallback(async () => {
    if (import.meta.env.DEV) {
      return;
    }

    try {
      const atualizacao = await check();
      if (atualizacao) {
        setAtualizacaoDisponivel(atualizacao);
      }
    } catch (erro) {
      console.warn("Falha ao verificar atualização do launcher:", erro);
    }
  }, []);

  const instalarAtualizacao = useCallback(async () => {
    if (!atualizacaoDisponivel || instalandoAtualizacao) {
      return;
    }

    setErroAtualizacao(null);
    setInstalandoAtualizacao(true);
    setProgressoAtualizacao(null);

    const novidadesPendentes: NovidadesVersao = {
      versao: atualizacaoDisponivel.version.replace(/^v/i, ""),
      conteudo: atualizacaoDisponivel.body?.trim() ||
        "Melhorias gerais e correções para deixar sua experiência mais estável.",
    };
    localStorage.setItem(CHAVE_NOVIDADES_PENDENTES, JSON.stringify(novidadesPendentes));
    let atualizacaoInstalada = false;

    try {
      await atualizacaoDisponivel.downloadAndInstall((evento) => {
        if (evento.event === "Started") {
          setProgressoAtualizacao({
            baixados: 0,
            total: evento.data.contentLength,
          });
          return;
        }

        if (evento.event === "Progress") {
          setProgressoAtualizacao((anterior) => ({
            baixados: (anterior?.baixados ?? 0) + evento.data.chunkLength,
            total: anterior?.total,
          }));
        }
      });

      atualizacaoInstalada = true;
      await invoke("reiniciar_aplicativo");
    } catch (erro) {
      if (!atualizacaoInstalada) {
        localStorage.removeItem(CHAVE_NOVIDADES_PENDENTES);
      }
      setErroAtualizacao(
        erro instanceof Error
          ? erro.message
          : "Não foi possível instalar a atualização agora."
      );
    } finally {
      setInstalandoAtualizacao(false);
    }
  }, [atualizacaoDisponivel, instalandoAtualizacao]);

  useEffect(() => {
    verificarAtualizacoes();
    const intervalo = window.setInterval(verificarAtualizacoes, 15 * 60 * 1000);
    return () => window.clearInterval(intervalo);
  }, [verificarAtualizacoes]);

  const verificarInstanciasEmExecucao = useCallback(async () => {
    if (instances.length === 0) {
      setMapaExecucao({});
      return;
    }

    const idsInstancias = instances.map((instancia) => instancia.id);

    try {
      const mapa = await invoke<Record<string, boolean>>("get_running_instances", {
        instanceIds: idsInstancias,
      });
      const mapaNormalizado = Object.fromEntries(
        idsInstancias.map((id) => [id, Boolean(mapa?.[id])])
      );
      setMapaExecucao((anterior) => {
        const houveEncerramento = idsInstancias.some(
          (id) => Boolean(anterior[id]) && !Boolean(mapaNormalizado[id])
        );
        if (houveEncerramento) {
          void fetchInstances();
        }
        return mapaNormalizado;
      });
    } catch (erro) {
      console.warn("Falha ao verificar instâncias em execução", erro);
      setMapaExecucao((anterior) =>
        Object.fromEntries(idsInstancias.map((id) => [id, Boolean(anterior[id])]))
      );
    }
  }, [instances, fetchInstances]);

  const atualizarPresenceDiscord = useCallback(
    async (payload: {
      detalhes: string;
      estado?: string;
    }) => {
      const assinatura = JSON.stringify(payload);
      if (assinatura === ultimaAssinaturaPresence.current) {
        return;
      }

      try {
        await invoke("atualizar_discord_presence", { payload });
        ultimaAssinaturaPresence.current = assinatura;
      } catch (erro) {
        console.warn("Falha ao atualizar Discord Rich Presence:", erro);
      }
    },
    []
  );

  useEffect(() => {
    verificarInstanciasEmExecucao();
    const intervalo = window.setInterval(
      verificarInstanciasEmExecucao,
      INTERVALO_VERIFICACAO_INSTANCIAS_MS
    );
    const aoVoltarParaJanela = () => {
      verificarInstanciasEmExecucao();
    };
    const aoMudarVisibilidade = () => {
      if (document.visibilityState === "visible") {
        verificarInstanciasEmExecucao();
      }
    };

    window.addEventListener("focus", aoVoltarParaJanela);
    document.addEventListener("visibilitychange", aoMudarVisibilidade);

    return () => {
      window.clearInterval(intervalo);
      window.removeEventListener("focus", aoVoltarParaJanela);
      document.removeEventListener("visibilitychange", aoMudarVisibilidade);
    };
  }, [verificarInstanciasEmExecucao]);

  const instanciaAtiva = useMemo(() => {
    if (instances.length === 0) return null;

    if (
      ultimaInstanciaIniciada &&
      mapaExecucao[ultimaInstanciaIniciada] &&
      instances.some((instancia) => instancia.id === ultimaInstanciaIniciada)
    ) {
      return instances.find((instancia) => instancia.id === ultimaInstanciaIniciada) ?? null;
    }

    if (selectedInstance && mapaExecucao[selectedInstance.id]) {
      return selectedInstance;
    }

    return instances.find((instancia) => mapaExecucao[instancia.id]) ?? null;
  }, [instances, mapaExecucao, selectedInstance, ultimaInstanciaIniciada]);
  const instanciaBarra = instanciaAtiva ?? selectedInstance;
  const instanciaBarraEmExecucao = Boolean(instanciaAtiva && instanciaBarra?.id === instanciaAtiva.id);

  const instanciaGerenciada = useMemo(
    () => instances.find((instancia) => instancia.id === managedInstanceId) ?? null,
    [instances, managedInstanceId]
  );
  const contasAlternativas = useMemo(() => {
    if (!user) {
      return contasMinecraft;
    }
    return contasMinecraft.filter((conta) => conta.uuid !== user.uuid);
  }, [contasMinecraft, user]);

  const textoProgressoAtualizacao = useMemo(() => {
    if (!progressoAtualizacao) {
      return null;
    }

    const baixarEmMb = (valor: number) => (valor / 1024 / 1024).toFixed(1);
    if (progressoAtualizacao.total && progressoAtualizacao.total > 0) {
      const percentual = Math.min(
        100,
        Math.round((progressoAtualizacao.baixados / progressoAtualizacao.total) * 100)
      );
      return `${percentual}% (${baixarEmMb(progressoAtualizacao.baixados)}MB de ${baixarEmMb(progressoAtualizacao.total)}MB)`;
    }

    return `${baixarEmMb(progressoAtualizacao.baixados)}MB baixados`;
  }, [progressoAtualizacao]);

  const montarPresenceLauncher = useCallback(() => {
    if (activeTab === "settings") {
      return { detalhes: "Nas Configurações", estado: "Ajustando o launcher" };
    }

    if (activeTab === "explore") {
      if (contextoExplore?.titulo) {
        const prefixoTipo =
          contextoExplore.tipo === "modpack"
            ? "modpack"
            : contextoExplore.tipo === "mod"
              ? "mod"
              : contextoExplore.tipo === "resourcepack"
                ? "resource pack"
                : "shader";
        return {
          detalhes: `Vendo ${prefixoTipo} ${contextoExplore.titulo}`,
          estado: contextoExplore.fonte === "ambas"
            ? "Fontes: Modrinth e CurseForge"
            : `Fonte: ${contextoExplore.fonte === "curseforge" ? "CurseForge" : "Modrinth"}`,
        };
      }
      return { detalhes: "Explorando conteúdo", estado: "Mods, modpacks e shaders" };
    }

    if (activeTab === "project-detail") {
      if (projetoDetalhe) {
        return {
          detalhes: `Vendo ${projetoDetalhe.title}`,
          estado: `Projeto ${projetoDetalhe.project_type}`,
        };
      }
      return { detalhes: "Vendo projeto", estado: "Analisando detalhes" };
    }

    if (activeTab === "instance-manager") {
      if (instanciaGerenciada) {
        return {
          detalhes: `Gerenciando ${instanciaGerenciada.name}`,
          estado: `${instanciaGerenciada.loader_type || instanciaGerenciada.mc_type} ${instanciaGerenciada.version}`,
        };
      }
      return { detalhes: "Gerenciando instância", estado: "Ajustando arquivos e conteúdo" };
    }

    if (activeTab === "instances") {
      return { detalhes: "Na Biblioteca", estado: `${instances.length} instância(s)` };
    }

    if (activeTab === "favorites") {
      return { detalhes: "Nos Favoritos", estado: "Organizando biblioteca" };
    }

    if (activeTab === "skins") {
      return { detalhes: "No Gerenciador de Skins", estado: "Visualizando..." };
    }

    return { detalhes: "Na tela inicial", estado: "Escolhendo o que jogar" };
  }, [activeTab, contextoExplore, instanciaGerenciada, instances.length, projetoDetalhe]);

  const iniciarInstancia = useCallback(
    async (id: string) => {
      setUltimaInstanciaIniciada(id);
      setServidorPorInstancia((anterior) => {
        const proximo = { ...anterior };
        delete proximo[id];
        return proximo;
      });
      await launch(id);
      const instancia = instances.find((item) => item.id === id);
      await atualizarPresenceDiscord({
        detalhes: instancia ? `Jogando ${instancia.name}` : "Jogando Minecraft",
        estado: instancia
          ? `${instancia.loader_type || instancia.mc_type} ${instancia.version}`
          : "Iniciando sessão",
      });
      setTimeout(() => {
        verificarInstanciasEmExecucao();
      }, 1300);
    },
    [launch, instances, atualizarPresenceDiscord, verificarInstanciasEmExecucao]
  );

  const encerrarInstancia = useCallback(async (id: string) => {
    if (instanciaSendoEncerrada) return;

    setInstanciaSendoEncerrada(id);
    try {
      await invoke("kill_instance", { instanceId: id });
      setMapaExecucao((anterior) => ({ ...anterior, [id]: false }));
      await fetchInstances();
      await verificarInstanciasEmExecucao();
    } catch (erro) {
      console.error("Falha ao encerrar a instância:", erro);
      alert(`Não foi possível encerrar o Minecraft: ${erro}`);
      await verificarInstanciasEmExecucao();
    } finally {
      setInstanciaSendoEncerrada(null);
    }
  }, [fetchInstances, instanciaSendoEncerrada, verificarInstanciasEmExecucao]);

  const iniciarInstanciaServidor = useCallback(
    async (id: string, address: string) => {
      setUltimaInstanciaIniciada(id);
      setServidorPorInstancia((anterior) => ({ ...anterior, [id]: address }));
      await launchServer(id, address);
      const instancia = instances.find((item) => item.id === id);
      await atualizarPresenceDiscord({
        detalhes: `Jogando no servidor ${address}`,
        estado: instancia
          ? `${instancia.loader_type || instancia.mc_type} ${instancia.version}`
          : "Conectando ao servidor",
      });
      setTimeout(() => {
        verificarInstanciasEmExecucao();
      }, 1300);
    },
    [launchServer, instances, atualizarPresenceDiscord, verificarInstanciasEmExecucao]
  );

  useEffect(() => {
    if (instanciaAtiva) {
      const enderecoServidor = servidorPorInstancia[instanciaAtiva.id];
      atualizarPresenceDiscord({
        detalhes: enderecoServidor
          ? `Jogando no servidor ${enderecoServidor}`
          : `Jogando ${instanciaAtiva.name}`,
        estado: `${instanciaAtiva.loader_type || instanciaAtiva.mc_type} ${instanciaAtiva.version}`,
      });
      return;
    }

    atualizarPresenceDiscord(montarPresenceLauncher());
  }, [instanciaAtiva, montarPresenceLauncher, servidorPorInstancia, atualizarPresenceDiscord]);

  useEffect(() => {
    let ativo = true;

    const publicarAtividadeSocial = async () => {
      if (!instanciaAtiva) {
        window.dispatchEvent(new CustomEvent("dome:social-atividade-atualizada", {
          detail: {
            emJogo: false,
            atividadeAtual: {
              tipo: "launcher",
              atualizadoEm: new Date().toISOString(),
            },
          },
        }));
        return;
      }

      const servidor = servidorPorInstancia[instanciaAtiva.id] ?? null;
      let modpack: ModpackInstancia | null = null;
      try {
        modpack = await invoke<ModpackInstancia | null>("get_modpack_info", {
          instanceId: instanciaAtiva.id,
        });
      } catch {
        modpack = null;
      }
      if (!ativo) return;

      const iconeUrl = await normalizarImagemAtividade(modpack?.icon || instanciaAtiva.icon);
      if (!ativo) return;
      const compartilhamentoId = publicacoesPorInstancia[instanciaAtiva.id] ?? null;

      const atividadeAtual = modpack?.projectId && modpack?.versionId && !modpack.modificado && !compartilhamentoId
        ? {
            tipo: "modpack_exato",
            instanciaId: instanciaAtiva.id,
            instanciaNome: instanciaAtiva.name,
            servidor,
            source: modpack.source,
            projectId: modpack.projectId,
            versionId: modpack.versionId,
            fileId: modpack.fileId ?? null,
            modpackNome: modpack.name,
            iconeUrl,
            versaoMinecraft: instanciaAtiva.version,
            loader: (instanciaAtiva.loader_type || instanciaAtiva.mc_type || "vanilla").toLowerCase(),
            compartilhamentoId: null,
            publicaAmigos: false,
            atualizadoEm: new Date().toISOString(),
          }
        : {
            tipo: "instancia_personalizada",
            instanciaId: instanciaAtiva.id,
            instanciaNome: instanciaAtiva.name,
            servidor,
            source: null,
            projectId: null,
            versionId: null,
            fileId: null,
            modpackNome: null,
            iconeUrl,
            versaoMinecraft: instanciaAtiva.version,
            loader: (instanciaAtiva.loader_type || instanciaAtiva.mc_type || "vanilla").toLowerCase(),
            compartilhamentoId,
            publicaAmigos: Boolean(compartilhamentoId),
            atualizadoEm: new Date().toISOString(),
          };

      window.dispatchEvent(new CustomEvent("dome:social-atividade-atualizada", {
        detail: {
          emJogo: true,
          atividadeAtual,
        },
      }));
    };

    publicarAtividadeSocial();
    return () => {
      ativo = false;
    };
  }, [instanciaAtiva, publicacoesPorInstancia, servidorPorInstancia]);

  useEffect(() => {
    return () => {
      invoke("encerrar_discord_presence").catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    const temporizador = window.setTimeout(() => {
      void Promise.allSettled([carregarSkinManager(), carregarProjetoDetalheModal()]);
    }, 400);

    return () => window.clearTimeout(temporizador);
  }, []);

  const handleProfileClick = () => {
    setMenuContaAberto((atual) => !atual);
  };

  const abrirProjeto = useCallback((origem: AbaOrigemProjeto, projeto: ProjetoConteudo) => {
    setAbaOrigemProjeto(origem);
    setAtividadeSocialDetalhe(null);
    setProjetoDetalhe(projeto);
    navegarParaAba("project-detail");
  }, [navegarParaAba]);

  const abrirTrocaVersaoModpack = useCallback((instancia: Instance, projeto: ProjetoConteudo) => {
    setAbaOrigemProjeto("home");
    setAtividadeSocialDetalhe(null);
    setManagedInstanceId(instancia.id);
    setProjetoDetalhe(projeto);
    navegarParaAba("project-detail");
  }, [navegarParaAba]);

  const abrirGerenciadorInstancia = useCallback((instancia: Instance) => {
    setProjetoDetalhe(null);
    setAtividadeSocialDetalhe(null);
    setManagedInstanceId(instancia.id);
    navegarParaAba("instance-manager");
  }, [navegarParaAba]);

  const abrirAtividadeAmigo = useCallback(async (amigo: AmigoSocial) => {
    const atividade = amigo.atividadeAtual;
    if (!atividade || atividade.tipo === "launcher") return;

    setAbaOrigemProjeto("instances");
    const instanciaInstalada = await encontrarInstanciaDaAtividade(instances, atividade);
    if (instanciaInstalada) {
      setProjetoDetalhe(null);
      setAtividadeSocialDetalhe(null);
      setManagedInstanceId(instanciaInstalada.id);
      navegarParaAba("instance-manager");
      return;
    }

    setManagedInstanceId("");

    if (atividade.tipo === "instancia_personalizada") {
      setProjetoDetalhe(null);
      setAtividadeSocialDetalhe(amigo);
      navegarParaAba("instance-manager");
      return;
    }

    if (!atividade.source || !atividade.projectId) return;
    setAtividadeSocialDetalhe(null);
    setProjetoDetalhe({
      id: atividade.projectId,
      title: atividade.modpackNome || atividade.instanciaNome || "Modpack compartilhado",
      description: `${amigo.nome} está jogando este modpack agora.`,
      icon_url: atividade.iconeUrl || "",
      author: amigo.nome,
      slug: atividade.projectId,
      source: atividade.source,
      project_type: "modpack",
      versaoInicialId: atividade.versionId || undefined,
    });
    navegarParaAba("instance-manager");
  }, [instances, navegarParaAba]);

  const menuItems = [
    { id: "home", icon: Home, label: "Início" },
    { id: "explore", icon: Search, label: "Explorar" },
    { id: "favorites", icon: Heart, label: "Favoritos" },
    { id: "skins", icon: Avatar, label: "Skins" },
  ];
  const ocultarTopbar = activeTab === "instance-manager";

  return (
    <div className="app-shell launcher-shell relative flex h-screen w-full overflow-hidden text-white">
      <aside className="launcher-side-menu relative z-20 flex w-[81px] shrink-0 flex-col">
        <div className="absolute inset-x-0 top-0 flex h-[50px] items-center justify-center gap-1">
          <button
            type="button"
            onClick={voltarNavegacao}
            disabled={historicoNavegacao.anteriores.length === 0}
            aria-label="Voltar"
            title="Voltar (Alt + ←)"
            className={cn(
              "grid h-7 w-7 place-items-center text-white/55 transition-colors",
              "hover:bg-white/[0.05] hover:text-white",
              "disabled:cursor-default disabled:bg-transparent disabled:text-white/15"
            )}
          >
            <ArrowLeft size={15} />
          </button>
          <button
            type="button"
            onClick={avancarNavegacao}
            disabled={historicoNavegacao.proximas.length === 0}
            aria-label="Avançar"
            title="Avançar (Alt + →)"
            className={cn(
              "grid h-7 w-7 place-items-center text-white/55 transition-colors",
              "hover:bg-white/[0.05] hover:text-white",
              "disabled:cursor-default disabled:bg-transparent disabled:text-white/15"
            )}
          >
            <ArrowRight size={15} />
          </button>
        </div>

        <nav className="flex flex-1 flex-col items-center gap-2 px-2 pb-3 pt-[69px]">
          {menuItems.map((item) => (
            <button
              key={item.id}
              onClick={() => navegarParaAba(item.id)}
              className={cn(
                "group relative flex h-11 w-11 items-center justify-center border transition-colors duration-150",
                activeTab === item.id
                  ? "border-emerald-400/45 bg-emerald-500/12 text-emerald-300"
                  : "border-white/10 bg-[#171717] text-white/65 hover:border-white/25 hover:text-white"
              )}
              title={item.label}
            >
              <item.icon size={19} />
              {activeTab === item.id && (
                <motion.div
                  layoutId="indicador-menu-ativo"
                  className="absolute -left-[2px] inset-y-0 w-[3px] bg-emerald-400"
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                />
              )}
            </button>
          ))}
        </nav>

        <div className="flex flex-col items-center gap-2 border-t border-white/10 px-2 pb-[12px] pt-[13px]">
          <button
            onClick={() => navegarParaAba("settings")}
            className={cn(
              "flex h-11 w-11 items-center justify-center border transition-colors duration-150",
              activeTab === "settings"
                ? "border-emerald-400/45 bg-emerald-500/12 text-emerald-300"
                : "border-white/10 bg-[#171717] text-white/65 hover:border-white/25 hover:text-white"
            )}
            title="Configurações"
          >
            <Settings size={19} />
          </button>

          <div ref={menuContaRef} className="relative">
            <button
              onClick={handleProfileClick}
              className={cn(
                "flex h-11 w-11 items-center justify-center border transition-colors",
                user
                  ? "border-emerald-400/40 bg-[#171717]"
                  : "border-white/15 bg-[#171717] hover:border-white/30"
              )}
              title={user ? user.name : "Contas Minecraft"}
            >
              {user ? (
                <img
                  src={`https://mc-heads.net/head/${user.uuid}/128`}
                  className="h-7 w-7 object-cover"
                  alt={user.name}
                />
              ) : (
                <div
                  className={cn(
                    "flex items-center justify-center border border-white/10 bg-[#0f0f0f]",
                    "h-7 w-7"
                  )}
                >
                  <User size={18} className="text-white/70" />
                </div>
              )}
            </button>

            <AnimatePresence>
              {menuContaAberto && (
                <motion.div
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  className="absolute bottom-0 left-[calc(100%+8px)] z-50 w-72 rounded-2xl border border-white/15 bg-[#101010] p-2"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-[10px] font-black uppercase tracking-wide text-white/70">
                      Contas Minecraft
                    </p>
                    <button
                      onClick={() => {
                        setMenuContaAberto(false);
                        setIsLoginOpen(true);
                      }}
                      className="inline-flex items-center gap-1 border border-white/20 bg-[#1a1a1a] px-1.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white/80 hover:text-white"
                    >
                      <Plus size={10} />
                      Adicionar
                    </button>
                  </div>

                  {user ? (
                    <div className="mb-2 border border-emerald-400/30 bg-emerald-500/10 p-2">
                      <div className="flex items-center gap-2">
                        <img
                          src={`https://mc-heads.net/head/${user.uuid}/64`}
                          alt={user.name}
                          className="h-8 w-8"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-bold text-white">{user.name}</p>
                          <p className="text-[10px] text-emerald-300">Conta ativa</p>
                        </div>
                        <button
                          onClick={async () => {
                            await deslogarContaMinecraft();
                            setMenuContaAberto(false);
                          }}
                          className="border border-white/20 bg-[#1a1a1a] px-1.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white/80 hover:text-white"
                        >
                          Sair
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        setMenuContaAberto(false);
                        setIsLoginOpen(true);
                      }}
                      className="mb-2 flex w-full items-center justify-center gap-2 border border-white/20 bg-[#1a1a1a] px-2 py-2 text-xs font-black uppercase tracking-wide text-white hover:border-white/40"
                    >
                      <LogIn size={12} />
                      Entrar com Microsoft
                    </button>
                  )}

                  {carregandoContasMinecraft ? (
                    <div className="flex items-center justify-center gap-2 py-2 text-xs text-white/60">
                      <Loader2 size={12} className="animate-spin" />
                      Carregando contas...
                    </div>
                  ) : contasAlternativas.length === 0 ? (
                    <p className="py-2 text-xs text-white/45">
                      {user ? "Nenhuma outra conta salva." : "Nenhuma conta salva."}
                    </p>
                  ) : (
                    <div className="max-h-56 space-y-2 overflow-y-auto scrollbar-hide">
                      {contasAlternativas.map((conta) => {
                        return (
                          <div key={conta.uuid} className="border border-white/10 bg-[#161616] p-2">
                            <div className="flex items-center gap-2">
                              <img
                                src={`https://mc-heads.net/head/${conta.uuid}/64`}
                                alt={conta.name}
                                className="h-7 w-7"
                              />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-bold text-white/90">{conta.name}</p>
                                <p className="text-[10px] text-white/45">Disponível</p>
                              </div>
                              <button
                                onClick={async () => {
                                  await trocarContaMinecraft(conta.uuid);
                                  setMenuContaAberto(false);
                                }}
                                className="border border-white/20 bg-[#1c1c1c] px-1.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white/80 hover:text-white"
                              >
                                Usar
                              </button>
                              <button
                                onClick={async () => {
                                  const confirmar = confirm(
                                    `Remover a conta "${conta.name}" do launcher?`
                                  );
                                  if (!confirmar) return;
                                  await removerContaMinecraft(conta.uuid);
                                }}
                                className="border border-red-400/35 bg-red-500/10 px-1.5 py-1 text-[10px] font-bold uppercase tracking-wide text-red-200 hover:text-red-100"
                              >
                                Remover
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </aside>

      <div className="launcher-corpo flex min-w-0 flex-1 overflow-hidden">
        <main className="launcher-principal relative z-10 flex min-w-0 flex-1 flex-col overflow-hidden">
        <AnimatePresence>
          {atualizacaoDisponivel && (
            <motion.div
              initial={{ y: -16, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -16, opacity: 0 }}
              className="absolute left-6 right-6 top-4 z-40"
            >
              <div className="mx-auto max-w-3xl border border-emerald-300/40 bg-[#101010] p-4">
                <p className="text-xs font-black uppercase tracking-wide text-emerald-300">
                  Atualização disponível
                </p>
                <p className="mt-1 text-sm text-white">
                  A versão <span className="font-bold">{atualizacaoDisponivel.version}</span> do launcher já está pronta.
                </p>

                {erroAtualizacao && (
                  <p className="mt-2 text-xs text-red-300">{erroAtualizacao}</p>
                )}

                {instalandoAtualizacao && (
                  <p className="mt-2 text-xs text-white/70">
                    Baixando atualização... {textoProgressoAtualizacao ?? ""}
                  </p>
                )}

                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => {
                      setAtualizacaoDisponivel(null);
                      setErroAtualizacao(null);
                      setProgressoAtualizacao(null);
                    }}
                    className="border border-white/20 bg-[#171717] px-3 py-1.5 text-xs font-bold uppercase tracking-wide text-white/80 hover:text-white"
                  >
                    Depois
                  </button>
                  <button
                    onClick={instalarAtualizacao}
                    disabled={instalandoAtualizacao}
                    className={cn(
                      "border px-3 py-1.5 text-xs font-bold uppercase tracking-wide transition-colors",
                      instalandoAtualizacao
                        ? "cursor-not-allowed border-white/20 bg-[#171717] text-white/40"
                        : "border-emerald-400 bg-emerald-500 text-[#07120a] hover:bg-emerald-400"
                    )}
                  >
                    {instalandoAtualizacao ? "Atualizando..." : "Atualizar e reiniciar"}
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {!ocultarTopbar && (
          <header className="launcher-topbar glass-topbar flex h-[68px] items-center justify-between px-6">
            <div className="flex items-center gap-4">
              <h2 className="font-['MinecraftTen','Sora',sans-serif] text-[20px] tracking-[0.4px] text-white">
                {TITULOS_ABA[activeTab] ?? ""}
              </h2>
              {activeTab === "skins" && (
                <span className="border border-emerald-400/25 bg-emerald-400/[0.08] px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.16em] text-emerald-300">
                  Beta
                </span>
              )}

            </div>

            <div className="flex items-center gap-2">
              {activeTab !== "instance-manager" && (
                <button
                  onClick={() => setSocialDrawerAberto(true)}
                  className="inline-flex items-center gap-1 border border-white/20 bg-[#171717] px-2 py-1 text-[11px] font-bold uppercase tracking-wide text-white/80 hover:text-white xl:hidden"
                >
                  <Users size={12} />
                  Social
                </button>
              )}
            </div>
          </header>
        )}

        <div
          className={cn(
            "flex-1 overflow-y-auto scrollbar-hide",
            !ocultarTopbar && "launcher-painel-conteudo",
            activeTab === "instance-manager" ? "" : "px-6 pb-24 pt-6"
          )}
        >
          <Suspense fallback={<EsqueletoAba />}>
            <AnimatePresence mode="popLayout">
            {activeTab === "home" && (
              <motion.div
                key="home"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="h-full"
              >
                <HomePage
                  user={user}
                  instances={instances}
                  instanciaAtivaId={instanciaAtiva?.id ?? null}
                  onSelectInstance={(instance) => {
                    setSelectedInstance(instance);
                    abrirGerenciadorInstancia(instance);
                  }}
                  onLaunch={(id) => {
                    if (!user) {
                      setIsLoginOpen(true);
                      return;
                    }
                    iniciarInstancia(id);
                  }}
                  onLaunchServer={(id, address) => {
                    if (!user) {
                      setIsLoginOpen(true);
                      return;
                    }
                    iniciarInstanciaServidor(id, address);
                  }}
                  onLogin={() => setIsLoginOpen(true)}
                  biblioteca={(
                    <LibraryPage
                      instances={instances}
                      instanciaAtivaId={instanciaAtiva?.id ?? null}
                      onSelectInstance={(instance) => {
                        setSelectedInstance(instance);
                      }}
                      onDesselecionarInstancia={() => {
                        setSelectedInstance(null);
                      }}
                      onAbrirGerenciadorInstancia={abrirGerenciadorInstancia}
                      onLaunch={(id) => iniciarInstancia(id)}
                      onDelete={(id) => remove(id)}
                      onCreateNew={() => setIsCreateOpen(true)}
                      onAtualizarInstancias={fetchInstances}
                      onTrocarVersaoModpack={abrirTrocaVersaoModpack}
                      publicacoesSociais={publicacoesPorInstancia}
                      user={user}
                      onLogin={() => setIsLoginOpen(true)}
                    />
                  )}
                />
              </motion.div>
            )}

            {activeTab === "instances" && (
              <motion.div
                key="instances"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
              >
                <LibraryPage
                  instances={instances}
                  instanciaAtivaId={instanciaAtiva?.id ?? null}
                  onSelectInstance={(instance) => {
                    setSelectedInstance(instance);
                  }}
                  onDesselecionarInstancia={() => {
                    setSelectedInstance(null);
                  }}
                  onAbrirGerenciadorInstancia={(instance) => {
                    abrirGerenciadorInstancia(instance);
                  }}
                  onLaunch={(id) => iniciarInstancia(id)}
                  onDelete={(id) => remove(id)}
                  onCreateNew={() => setIsCreateOpen(true)}
                  onAtualizarInstancias={fetchInstances}
                  onTrocarVersaoModpack={abrirTrocaVersaoModpack}
                  publicacoesSociais={publicacoesPorInstancia}
                  user={user}
                  onLogin={() => setIsLoginOpen(true)}
                />
              </motion.div>
            )}

            {activeTab === "explore" && (
              <motion.div
                key="explore"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
              >
                <Explore
                  onAtualizarPresencaExplore={setContextoExplore}
                  onAbrirProjeto={(projeto) => abrirProjeto("explore", projeto)}
                />
              </motion.div>
            )}

            {activeTab === "favorites" && (
              <motion.div
                key="favorites"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
              >
                <Favorites
                  onAbrirProjeto={(projeto) => abrirProjeto("favorites", projeto)}
                />
              </motion.div>
            )}

            {activeTab === "project-detail" && projetoDetalhe && (
              <motion.div
                key={`project-detail-${projetoDetalhe.id}`}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
              >
                <ProjetoDetalheModal
                  projeto={projetoDetalhe}
                  instancias={instances}
                  instanciaInicialId={
                    abaOrigemProjeto === "home" ||
                    abaOrigemProjeto === "instance-manager" ||
                    abaOrigemProjeto === "instances"
                      ? managedInstanceId
                      : undefined
                  }
                  usuarioLogado={Boolean(user)}
                  onSolicitarLogin={() => setIsLoginOpen(true)}
                  onInstanciaCriada={() => void fetchInstances()}
                  rotuloAcao={
                    abaOrigemProjeto === "home" || abaOrigemProjeto === "instances"
                      ? "Baixar"
                      : "Instalar"
                  }
                  onVoltar={() => {
                    navegarParaAba(abaOrigemProjeto);
                    setProjetoDetalhe(null);
                  }}
                />
              </motion.div>
            )}

            {activeTab === "settings" && (
              <motion.div
                key="settings"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
              >
                <SettingsPage />
              </motion.div>
            )}

            {activeTab === "skins" && (
              <motion.div
                key="skins"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
              >
                <SkinManager user={user} />
              </motion.div>
            )}

            {activeTab === "instance-manager" && projetoDetalhe && abaOrigemProjeto === "instances" && (
              <motion.div
                key={`instance-manager-social-${projetoDetalhe.id}`}
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="h-full overflow-y-auto px-6 py-6 scrollbar-hide"
              >
                <ProjetoDetalheModal
                  projeto={projetoDetalhe}
                  instancias={instances}
                  usuarioLogado={Boolean(user)}
                  onSolicitarLogin={() => setIsLoginOpen(true)}
                  onInstanciaCriada={() => void fetchInstances()}
                  rotuloAcao="Baixar"
                  onVoltar={() => {
                    setProjetoDetalhe(null);
                    navegarParaAba("home");
                  }}
                />
              </motion.div>
            )}

            {activeTab === "instance-manager" && atividadeSocialDetalhe && (
              <motion.div
                key={`instance-manager-custom-social-${atividadeSocialDetalhe.friendProfileId}`}
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="h-full"
              >
                <VisualizacaoInstanciaSocial
                  amigo={atividadeSocialDetalhe}
                  onAbrirBiblioteca={() => {
                    setAtividadeSocialDetalhe(null);
                    void fetchInstances();
                    navegarParaAba("home");
                  }}
                />
              </motion.div>
            )}

            {activeTab === "instance-manager" &&
              managedInstanceId &&
              !atividadeSocialDetalhe &&
              !(projetoDetalhe && abaOrigemProjeto === "instances") && (
              <motion.div
                key="instance-manager"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                className="h-full"
              >
                <InstanceManager
                  instanceId={managedInstanceId}
                  onBack={() => navegarParaAba("home")}
                  onAbrirSocial={() => setSocialDrawerAberto(true)}
                  onAbrirProjeto={(projeto) => abrirProjeto("instance-manager", projeto)}
                  onInstanceUpdate={(novoId) => {
                    if (novoId) setManagedInstanceId(novoId);
                    void fetchInstances();
                  }}
                />
              </motion.div>
            )}
            </AnimatePresence>
          </Suspense>
        </div>

        <AnimatePresence>
          {instanciaBarra &&
            activeTab !== "instance-manager" &&
            activeTab !== "project-detail" && (
            <motion.footer
              initial={{ y: 80, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 80, opacity: 0 }}
              className={cn(
                "absolute bottom-0 left-0 right-0 p-6 transition-[padding]",
                activeTab === "instances" || activeTab === "home"
                  ? "pointer-events-auto"
                  : "pointer-events-none",
                ehTelaXl && chatSocialAberto && "pr-[384px]"
              )}
            >
              <div className="pointer-events-auto mx-auto max-w-xl">
                <div className="flex items-center gap-3 border border-white/15 bg-[#101010] p-2">
                  <div className="ml-1 h-10 w-10 shrink-0 overflow-hidden border border-white/10">
                    <img src={instanciaBarra.icon} alt="" className="h-full w-full object-cover" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">{instanciaBarra.name}</p>
                    <p className="text-[10px] text-white/40">
                      {instanciaBarra.loader_type || instanciaBarra.mc_type} •{" "}
                      {instanciaBarra.version}
                    </p>
                  </div>

                  <div className="h-8 w-px bg-white/15" />

                  <button
                    onClick={() => {
                      if (instanciaBarraEmExecucao) {
                        void encerrarInstancia(instanciaBarra.id);
                        return;
                      }
                      if (!user) {
                        setIsLoginOpen(true);
                        return;
                      }
                      iniciarInstancia(instanciaBarra.id);
                    }}
                    disabled={instanciaSendoEncerrada === instanciaBarra.id}
                    title={instanciaBarraEmExecucao ? "Encerrar o Minecraft" : undefined}
                    className={cn(
                      "group flex items-center gap-3 border px-5 py-2.5 text-sm font-black transition-colors disabled:cursor-wait disabled:opacity-60",
                      instanciaBarraEmExecucao
                        ? "cursor-pointer border-emerald-400/25 bg-emerald-400/10 text-emerald-300 hover:border-red-400/40 hover:bg-red-400/10 hover:text-red-300"
                        : user
                        ? "border-emerald-400 bg-emerald-500 text-[#07120a] hover:bg-emerald-400"
                        : "border-white/15 bg-[#1b1b1b] text-white hover:bg-[#252525]"
                    )}
                  >
                    {instanciaSendoEncerrada === instanciaBarra.id ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : instanciaBarraEmExecucao ? (
                      <span className="h-2 w-2 bg-emerald-400" />
                    ) : !user ? (
                      <LogIn size={18} />
                    ) : (
                      <Play
                        fill="currentColor"
                        size={18}
                        className="transition-transform group-hover:translate-x-0.5"
                      />
                    )}
                    <span>
                      {instanciaSendoEncerrada === instanciaBarra.id
                        ? "ENCERRANDO"
                        : instanciaBarraEmExecucao
                          ? "ENCERRAR"
                          : !user
                            ? "LOGIN"
                            : "JOGAR"}
                    </span>
                  </button>
                </div>
              </div>
            </motion.footer>
          )}
        </AnimatePresence>
      </main>

        <div
          className={cn(
            ehTelaXl
              ? cn(
                  "relative flex shrink-0 transition-[width] duration-200",
                  painelSocialRecuado ? "w-[72px]" : "w-[340px]"
                )
              : cn(
                  "fixed inset-0 z-[80] transition-colors duration-200 xl:hidden",
                  socialDrawerAberto
                    ? "visible bg-black/70"
                    : "invisible pointer-events-none bg-black/0"
                )
          )}
          onClick={() => {
            if (!ehTelaXl) setSocialDrawerAberto(false);
          }}
        >
          <div
            className={cn(
              ehTelaXl
                ? "flex h-full w-full"
                : cn(
                    "absolute right-0 top-0 h-full transition-transform duration-200",
                    socialDrawerAberto ? "translate-x-0" : "translate-x-full"
                  )
            )}
            onClick={(evento) => evento.stopPropagation()}
          >
            <SocialSidebar
              usuarioMinecraft={user}
              iconeAtividadeLocal={instanciaAtiva?.icon}
              className={cn(
                "h-full min-h-0 shrink-0",
                ehTelaXl && (painelSocialRecuado ? "w-[72px]" : "w-[340px]"),
                !ehTelaXl && "w-[340px]",
                !ehTelaXl && "max-w-[92vw]"
              )}
              onFecharDrawer={
                ehTelaXl ? undefined : () => setSocialDrawerAberto(false)
              }
              onAlterarChatAberto={setChatSocialAberto}
              onAbrirAtividadeAmigo={abrirAtividadeAmigo}
              recuado={ehTelaXl && painelSocialRecuado}
              onAlternarRecuo={
                ehTelaXl ? () => setPainelSocialRecuado((anterior) => !anterior) : undefined
              }
            />
          </div>
        </div>
      </div>

      <LoginModal
        isOpen={isLoginOpen}
        onClose={() => {
          setIsLoginOpen(false);
        }}
        onLoginConcluido={(conta) => {
          setUser(conta);
          atualizarSessaoMinecraft();
        }}
      />
      <CreateInstanceModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreated={() => void fetchInstances()}
      />
      <CreatingInstancesOverlay />
      <NovidadesVersaoModal novidades={novidadesVersao} onClose={fecharNovidadesVersao} />
      </div>
  );
}
