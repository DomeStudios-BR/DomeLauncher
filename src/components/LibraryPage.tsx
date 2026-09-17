import { useState, useEffect, useRef, useCallback, useSyncExternalStore } from "react";
import {
  Play,
  Trash2,
  Gamepad2,
  Clock,
  LayoutGrid,
  List,
  Search,
  FolderPlus,
  ChevronDown,
  ChevronRight,
  ArrowUpDown,
  GripVertical,
  FolderOpen,
  X,
  Pencil,
  Plus,
  Box,
  Upload,
  Download,
  Loader2,
  Check,
  RefreshCw,
  Globe,
  Star,
} from "../iconesPixelados";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { Instance } from "../hooks/useLauncher";
import type { ProjetoConteudo } from "./ProjetoDetalheModal";
import { cn } from "../lib/utils";
import {
  CabecalhoMenuContextual,
  ItemMenuContextual,
  MenuContextual,
  RotuloMenuContextual,
  SeparadorMenuContextual,
} from "./context-menu/MenuContextual";
import {
  finalizarImportacoes,
  iniciarImportacoes,
  observarImportacoes,
  obterImportacoesEmAndamento,
} from "../stores/importacoesInstancias";
import {
  getCreatingInstances,
  subscribeToCreating,
} from "../stores/creatingInstances";
import {
  EVENTO_INSTANCIAS_PUBLICAS_SOCIAIS,
  EVENTO_PUBLICAR_INSTANCIA_SOCIAL,
  type PublicacaoInstanciaSocial,
} from "../lib/eventosTransferenciaSocial";
import ModalAnaliseModpack from "./social/ModalAnaliseModpack";

// Tipos
type ViewMode = "grid" | "list";
type SortKey = "manual" | "name" | "last_played" | "version" | "loader";
type SortDir = "asc" | "desc";

interface InstanceGroup {
  id: string;
  name: string;
  collapsed: boolean;
  instanceIds: string[];
}

interface LibraryState {
  groups: InstanceGroup[];
  viewMode: ViewMode;
  sortKey: SortKey;
  sortDir: SortDir;
}

interface InstanciaImportavelExterna {
  idExterno: string;
  launcher: string;
  nome: string;
  versaoMinecraft: string;
  loaderType?: string;
  loaderVersion?: string;
  icone?: string;
  caminhoOrigem: string;
  caminhoJogo: string;
}

interface ResultadoImportacaoInstancia {
  idExterno: string;
  launcher: string;
  nomeOrigem: string;
  sucesso: boolean;
  instanciaId?: string;
  mensagem: string;
}

interface ModpackInstalado {
  projectId: string;
  versionId: string;
  fileId?: string | null;
  name: string;
  author: string;
  icon?: string | null;
  slug: string;
  source: "modrinth" | "curseforge";
  installedVersion: string;
}

type MenuContextoBiblioteca = {
  tipo: "instancia";
  instancia: Instance;
  x: number;
  y: number;
} | {
  tipo: "grupo";
  grupo: InstanceGroup;
  x: number;
  y: number;
} | {
  tipo: "vazio";
  x: number;
  y: number;
};

function deduplicarIds(ids: string[]): string[] {
  return Array.from(new Set(ids));
}

// Chave de storage
const STORAGE_KEY = "dome-library-state";

// Estado padrão
const defaultState: LibraryState = {
  groups: [
    { id: "default", name: "Instâncias", collapsed: false, instanceIds: [] },
  ],
  viewMode: "grid",
  sortKey: "name",
  sortDir: "asc",
};

// Carregar estado salvo
function carregarEstado(): LibraryState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const estado = JSON.parse(raw) as LibraryState;
      return {
        ...estado,
        groups: (estado.groups || []).map((grupo) => ({
          ...grupo,
          instanceIds: deduplicarIds(grupo.instanceIds || []),
        })),
      };
    }
  } catch {}
  return defaultState;
}

// Salvar estado
function salvarEstado(state: LibraryState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function formatarTempoJogadoTotal(segundos: number | undefined): string {
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
}

function calcularTempoJogadoParaExibicao(
  instance: Instance,
  ativa: boolean,
  agoraSegundos: number
): number {
  const totalBase = Math.max(0, Math.floor(instance.tempo_total_jogado_segundos ?? 0));
  if (!ativa || !instance.sessao_iniciada_em) return totalBase;

  const inicioSessaoMs = new Date(instance.sessao_iniciada_em).getTime();
  if (Number.isNaN(inicioSessaoMs)) return totalBase;

  const acrescimo = Math.max(0, agoraSegundos - Math.floor(inicioSessaoMs / 1000));
  return totalBase + acrescimo;
}

// Props
interface LibraryPageProps {
  instances: Instance[];
  instanciaAtivaId: string | null;
  onSelectInstance: (instance: Instance) => void;
  onDesselecionarInstancia: () => void;
  onAbrirGerenciadorInstancia: (instance: Instance) => void;
  onLaunch: (id: string) => void;
  onDelete: (id: string) => void;
  onCreateNew: () => void;
  onAtualizarInstancias: () => Promise<void>;
  onTrocarVersaoModpack: (instancia: Instance, projeto: ProjetoConteudo) => void;
  publicacoesSociais?: Record<string, string>;
  user: any;
  onLogin: () => void;
}

export default function LibraryPage({
  instances,
  instanciaAtivaId,
  onSelectInstance,
  onDesselecionarInstancia,
  onAbrirGerenciadorInstancia,
  onLaunch,
  onDelete,
  onCreateNew,
  onAtualizarInstancias,
  onTrocarVersaoModpack,
  publicacoesSociais = {},
  user,
  onLogin,
}: LibraryPageProps) {
  const [state, setState] = useState<LibraryState>(carregarEstado);
  const [busca, setBusca] = useState("");
  const [editandoGrupo, setEditandoGrupo] = useState<string | null>(null);
  const [nomeGrupo, setNomeGrupo] = useState("");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  const [grupoArrastadoId, setGrupoArrastadoId] = useState<string | null>(null);
  const [menuAberto, setMenuAberto] = useState<string | null>(null);
  const [menuContexto, setMenuContexto] = useState<MenuContextoBiblioteca | null>(null);
  const [modoSelecaoMultipla, setModoSelecaoMultipla] = useState(false);
  const [idsSelecionados, setIdsSelecionados] = useState<Set<string>>(new Set());
  const [menuMoverSelecionadasAberto, setMenuMoverSelecionadasAberto] = useState(false);
  const [grupoExclusao, setGrupoExclusao] = useState<InstanceGroup | null>(null);
  const [modalEscolhaImportacaoAberto, setModalEscolhaImportacaoAberto] = useState(false);
  const [modalImportacaoAberto, setModalImportacaoAberto] = useState(false);
  const [instanciaSelecionadaId, setInstanciaSelecionadaId] = useState<string | null>(null);
  const [carregandoImportaveis, setCarregandoImportaveis] = useState(false);
  const [instanciasImportaveis, setInstanciasImportaveis] = useState<
    InstanciaImportavelExterna[]
  >([]);
  const instanciasEmImportacao = useSyncExternalStore(
    observarImportacoes,
    obterImportacoesEmAndamento,
    obterImportacoesEmAndamento
  );
  const [transferenciasSociaisEmAndamento, setTransferenciasSociaisEmAndamento] = useState(() =>
    getCreatingInstances().filter((instancia) => instancia.id.startsWith("recebimento-social:"))
  );
  useEffect(() => subscribeToCreating(() => {
    setTransferenciasSociaisEmAndamento(
      getCreatingInstances().filter((instancia) => instancia.id.startsWith("recebimento-social:"))
    );
  }), []);
  const importandoInstancias = instanciasEmImportacao.length > 0;
  const [pastasAdicionaisImportacao, setPastasAdicionaisImportacao] = useState<string[]>([]);
  const [idsSelecionadosImportacao, setIdsSelecionadosImportacao] = useState<Set<string>>(
    new Set()
  );
  const [resultadoImportacao, setResultadoImportacao] = useState<
    ResultadoImportacaoInstancia[]
  >([]);
  const [erroImportacao, setErroImportacao] = useState<string | null>(null);
  const [agoraSegundos, setAgoraSegundos] = useState(() =>
    Math.floor(Date.now() / 1000)
  );
  const [modpacksPorInstancia, setModpacksPorInstancia] = useState<Record<string, ModpackInstalado>>({});
  const [publicacoesPorInstancia, setPublicacoesPorInstancia] = useState<Record<string, string>>({});
  const [modalAnalise, setModalAnalise] = useState<{ instancia: Instance; modpack: ModpackInstalado } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Salvar estado ao mudar
  useEffect(() => {
    setPublicacoesPorInstancia(publicacoesSociais);
  }, [publicacoesSociais]);

  useEffect(() => {
    salvarEstado(state);
  }, [state]);

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
    const intervalo = window.setInterval(() => {
      setAgoraSegundos(Math.floor(Date.now() / 1000));
    }, 15_000);
    return () => window.clearInterval(intervalo);
  }, []);

  useEffect(() => {
    let cancelado = false;
    void Promise.all(instances.map(async (instancia) => {
      try {
        const modpack = await invoke<ModpackInstalado | null>("get_modpack_info", {
          instanceId: instancia.id,
        });
        return modpack ? [instancia.id, modpack] as const : null;
      } catch {
        return null;
      }
    })).then((resultados) => {
      if (cancelado) return;
      setModpacksPorInstancia(Object.fromEntries(resultados.filter((item) => item !== null)));
    });
    return () => {
      cancelado = true;
    };
  }, [instances]);

  useEffect(() => {
    if (instances.length === 0 || !instanciaSelecionadaId) {
      setInstanciaSelecionadaId(null);
      return;
    }

    if (!instances.some((instancia) => instancia.id === instanciaSelecionadaId)) {
      setInstanciaSelecionadaId(null);
    }
  }, [instances, instanciaSelecionadaId]);

  // Garantir que todas as instâncias estejam em algum grupo
  useEffect(() => {
    const idsUnicosInstancias = deduplicarIds(instances.map((i) => i.id));
    const idsNosGrupos = new Set(
      state.groups.flatMap((g) => deduplicarIds(g.instanceIds))
    );
    const orfaos = idsUnicosInstancias.filter((id) => !idsNosGrupos.has(id));

    if (orfaos.length > 0) {
      setState((prev) => {
        const grupos = [...prev.groups];
        // Adicionar ao grupo padrão
        const defaultIdx = grupos.findIndex((g) => g.id === "default");
        if (defaultIdx >= 0) {
          grupos[defaultIdx] = {
            ...grupos[defaultIdx],
            instanceIds: deduplicarIds([
              ...grupos[defaultIdx].instanceIds,
              ...orfaos,
            ]),
          };
        } else {
          grupos.unshift({
            id: "default",
            name: "Instâncias",
            collapsed: false,
            instanceIds: orfaos,
          });
        }
        return { ...prev, groups: grupos };
      });
    }

    // Limpar IDs de instâncias que não existem mais
    const idsExistentes = new Set(instances.map((i) => i.id));
    setState((prev) => ({
      ...prev,
      groups: prev.groups.map((g) => ({
        ...g,
        instanceIds: deduplicarIds(
          g.instanceIds.filter((id) => idsExistentes.has(id))
        ),
      })),
    }));
  }, [instances]);

  // Ordenar instâncias
  const ordenar = useCallback(
    (ids: string[]): Instance[] => {
      const map = new Map(instances.map((i) => [i.id, i]));
      const lista = deduplicarIds(ids)
        .map((id) => map.get(id))
        .filter(Boolean) as Instance[];

      if (state.sortKey === "manual") return lista;

      lista.sort((a, b) => {
        let cmp = 0;
        switch (state.sortKey) {
          case "manual":
            break;
          case "name":
            cmp = a.name.localeCompare(b.name);
            break;
          case "last_played":
            cmp =
              new Date(b.last_played || 0).getTime() -
              new Date(a.last_played || 0).getTime();
            break;
          case "version":
            cmp = a.version.localeCompare(b.version);
            break;
          case "loader":
            cmp = (a.loader_type || "Vanilla").localeCompare(
              b.loader_type || "Vanilla"
            );
            break;
        }
        return state.sortDir === "asc" ? cmp : -cmp;
      });

      return lista;
    },
    [instances, state.sortKey, state.sortDir]
  );

  // Filtrar por busca
  const filtrar = useCallback(
    (lista: Instance[]): Instance[] => {
      if (!busca.trim()) return lista;
      const q = busca.toLowerCase();
      return lista.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          i.version.includes(q) ||
          (i.loader_type || "").toLowerCase().includes(q)
      );
    },
    [busca]
  );

  // Criar novo grupo
  const criarGrupo = () => {
    const id = `group-${Date.now()}`;
    setState((prev) => ({
      ...prev,
      groups: [
        ...prev.groups,
        { id, name: "Novo Grupo", collapsed: false, instanceIds: [] },
      ],
    }));
    setEditandoGrupo(id);
    setNomeGrupo("Novo Grupo");
    setTimeout(() => inputRef.current?.select(), 50);
  };

  // Renomear grupo
  const salvarNomeGrupo = (groupId: string) => {
    if (!nomeGrupo.trim()) return;
    setState((prev) => ({
      ...prev,
      groups: prev.groups.map((g) =>
        g.id === groupId ? { ...g, name: nomeGrupo.trim() } : g
      ),
    }));
    setEditandoGrupo(null);
  };

  // Deletar grupo preservando as instâncias em outro grupo disponível
  const deletarGrupo = (groupId: string) => {
    setState((prev) => {
      if (prev.groups.length <= 1) return prev;

      const grupo = prev.groups.find((g) => g.id === groupId);
      const grupoDestino = prev.groups.find((g) => g.id !== groupId);
      if (!grupo || !grupoDestino) return prev;

      const promoverDestinoComoPadrao = groupId === "default";
      return {
        ...prev,
        groups: prev.groups
          .filter((g) => g.id !== groupId)
          .map((g) => {
            if (g.id === grupoDestino.id) {
              return {
                ...g,
                id: promoverDestinoComoPadrao ? "default" : g.id,
                instanceIds: deduplicarIds([
                  ...g.instanceIds,
                  ...grupo.instanceIds,
                ]),
              };
            }
            return g;
          }),
      };
    });
  };

  // Toggle colapsar grupo
  const toggleGrupo = (groupId: string) => {
    setState((prev) => ({
      ...prev,
      groups: prev.groups.map((g) =>
        g.id === groupId ? { ...g, collapsed: !g.collapsed } : g
      ),
    }));
  };

  const moverInstanciaParaGrupo = (idArrastado: string, targetGroupId: string) => {
    setState((prev) => {
      // Remover a instância de todos os grupos
      const gruposSemItem = prev.groups.map((g) => ({
        ...g,
        instanceIds: g.instanceIds.filter((id) => id !== idArrastado),
      }));

      // Adicionar no grupo alvo
      return {
        ...prev,
        sortKey: "manual",
        groups: gruposSemItem.map((g) =>
          g.id === targetGroupId
            ? {
                ...g,
                instanceIds: deduplicarIds([...g.instanceIds, idArrastado]),
              }
            : g
        ),
      };
    });
  };

  const moverInstanciaDuranteArrasto = (
    idArrastado: string,
    targetInstanceId: string,
    targetGroupId: string,
    posicao: "antes" | "depois"
  ) => {
    if (idArrastado === targetInstanceId) return;

    setState((prev) => {
      const gruposSemInstancia = prev.groups.map((grupo) => ({
        ...grupo,
        instanceIds: grupo.instanceIds.filter((id) => id !== idArrastado),
      }));

      const gruposAtualizados = gruposSemInstancia.map((grupo) => {
        if (grupo.id !== targetGroupId) return grupo;

        const ids = [...grupo.instanceIds];
        const indiceDestino = ids.indexOf(targetInstanceId);
        const indiceInsercao = indiceDestino < 0
          ? ids.length
          : indiceDestino + (posicao === "depois" ? 1 : 0);
        ids.splice(indiceInsercao, 0, idArrastado);
        return { ...grupo, instanceIds: deduplicarIds(ids) };
      });
      const ordemMudou = gruposAtualizados.some((grupo, indiceGrupo) => {
        const idsAnteriores = prev.groups[indiceGrupo]?.instanceIds ?? [];
        return grupo.instanceIds.length !== idsAnteriores.length
          || grupo.instanceIds.some((id, indice) => id !== idsAnteriores[indice]);
      });

      if (!ordemMudou && prev.sortKey === "manual") return prev;
      return { ...prev, sortKey: "manual", groups: gruposAtualizados };
    });
  };

  const iniciarArrastoInstancia = (instanceId: string) => {
    if (state.sortKey !== "manual") {
      const gruposOrdenados = state.groups.map((grupo) => ({
        ...grupo,
        instanceIds: ordenar(grupo.instanceIds).map((instancia) => instancia.id),
      }));
      setState((anterior) => ({ ...anterior, sortKey: "manual", groups: gruposOrdenados }));
    }
    setDraggedId(instanceId);
  };

  const posicionarInstanciaPeloPonteiro = (
    _instanceId: string,
    x: number,
    y: number
  ) => {
    document.querySelectorAll<HTMLElement>("[data-destino-arrasto]").forEach((card) => {
      delete card.dataset.destinoArrasto;
    });
    const elemento = document.elementFromPoint(x, y) as HTMLElement | null;
    const cardAlvo = elemento?.closest<HTMLElement>("[data-instancia-id][data-grupo-id]");

    if (cardAlvo) {
      const targetInstanceId = cardAlvo.dataset.instanciaId;
      const targetGroupId = cardAlvo.dataset.grupoId;
      if (!targetInstanceId || !targetGroupId) return;

      const limites = cardAlvo.getBoundingClientRect();
      const posicao = cardAlvo.dataset.modoVisualizacao === "grid"
        ? x < limites.left + limites.width / 2 ? "antes" : "depois"
        : y < limites.top + limites.height / 2 ? "antes" : "depois";
      setDragOverGroup(targetGroupId);
      cardAlvo.dataset.destinoArrasto = posicao;
      return;
    }

    const grupoAlvo = elemento?.closest<HTMLElement>("[data-grupo-biblioteca]");
    setDragOverGroup(grupoAlvo?.dataset.grupoId ?? null);
  };

  const finalizarArrastoInstancia = (
    instanceId?: string,
    x?: number,
    y?: number
  ) => {
    document.querySelectorAll<HTMLElement>("[data-destino-arrasto]").forEach((card) => {
      delete card.dataset.destinoArrasto;
    });
    if (instanceId && x !== undefined && y !== undefined) {
      const elemento = document.elementFromPoint(x, y) as HTMLElement | null;
      const cardAlvo = elemento?.closest<HTMLElement>("[data-instancia-id][data-grupo-id]");
      const grupoAlvo = elemento?.closest<HTMLElement>("[data-grupo-biblioteca]");
      const targetGroupId = grupoAlvo?.dataset.grupoId;
      const targetInstanceId = cardAlvo?.dataset.instanciaId;

      if (cardAlvo && targetInstanceId && targetGroupId) {
        const limites = cardAlvo.getBoundingClientRect();
        const posicao = cardAlvo.dataset.modoVisualizacao === "grid"
          ? x < limites.left + limites.width / 2 ? "antes" : "depois"
          : y < limites.top + limites.height / 2 ? "antes" : "depois";
        moverInstanciaDuranteArrasto(instanceId, targetInstanceId, targetGroupId, posicao);
      } else if (targetGroupId) {
        moverInstanciaParaGrupo(instanceId, targetGroupId);
      }
    }

    setDraggedId(null);
    setDragOverGroup(null);
  };

  useEffect(() => {
    if (!draggedId) return;
    const cursorAnterior = document.body.style.cursor;
    const selecaoAnterior = document.body.style.userSelect;
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = cursorAnterior;
      document.body.style.userSelect = selecaoAnterior;
    };
  }, [draggedId]);

  useEffect(() => {
    if (!menuContexto) return;
    const fecharAoPressionarEscape = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") setMenuContexto(null);
    };
    const fecharAoRolar = () => setMenuContexto(null);
    window.addEventListener("keydown", fecharAoPressionarEscape);
    window.addEventListener("scroll", fecharAoRolar, true);
    return () => {
      window.removeEventListener("keydown", fecharAoPressionarEscape);
      window.removeEventListener("scroll", fecharAoRolar, true);
    };
  }, [menuContexto]);

  const moverGrupoDuranteArrasto = (grupoDestino: string) => {
    if (!grupoArrastadoId || grupoArrastadoId === grupoDestino) return;

    setState((anterior) => {
      const grupos = [...anterior.groups];
      const indiceOrigem = grupos.findIndex((grupo) => grupo.id === grupoArrastadoId);
      const indiceDestino = grupos.findIndex((grupo) => grupo.id === grupoDestino);
      if (indiceOrigem < 0 || indiceDestino < 0 || indiceOrigem === indiceDestino) return anterior;

      const [grupoMovido] = grupos.splice(indiceOrigem, 1);
      grupos.splice(indiceDestino, 0, grupoMovido);
      return { ...anterior, groups: grupos };
    });
  };

  useEffect(() => {
    if (!grupoArrastadoId) return;

    const finalizarArrastoGrupo = () => {
      setGrupoArrastadoId(null);
    };
    const cursorAnterior = document.body.style.cursor;
    const userSelectAnterior = document.body.style.userSelect;
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
    window.addEventListener("mouseup", finalizarArrastoGrupo);

    return () => {
      window.removeEventListener("mouseup", finalizarArrastoGrupo);
      document.body.style.cursor = cursorAnterior;
      document.body.style.userSelect = userSelectAnterior;
    };
  }, [grupoArrastadoId]);

  // Alternar ordenação
  const alternarSort = (key: SortKey) => {
    setState((prev) => ({
      ...prev,
      sortKey: key,
      sortDir: prev.sortKey === key && prev.sortDir === "asc" ? "desc" : "asc",
    }));
  };

  // Labels de sort
  const sortLabels: Record<SortKey, string> = {
    manual: "Manual",
    name: "Nome",
    last_played: "Último jogado",
    version: "Versão",
    loader: "Loader",
  };

  const carregarInstanciasImportaveis = async (
    caminhosAdicionais = pastasAdicionaisImportacao
  ) => {
    setCarregandoImportaveis(true);
    setErroImportacao(null);
    try {
      const lista = await invoke<InstanciaImportavelExterna[]>(
        "listar_instancias_importaveis",
        { caminhosAdicionais }
      );
      setInstanciasImportaveis(lista || []);
      setIdsSelecionadosImportacao(new Set((lista || []).map((item) => item.idExterno)));
    } catch (erro) {
      setErroImportacao(
        erro instanceof Error
          ? erro.message
          : "Não foi possível listar instâncias para importação."
      );
      setInstanciasImportaveis([]);
      setIdsSelecionadosImportacao(new Set());
    } finally {
      setCarregandoImportaveis(false);
    }
  };

  const abrirModalImportacao = () => {
    if (importandoInstancias) return;
    setModalEscolhaImportacaoAberto(true);
  };

  const abrirModalImportacaoInstancias = async () => {
    setModalEscolhaImportacaoAberto(false);
    setModalImportacaoAberto(true);
    setResultadoImportacao([]);
    setErroImportacao(null);
    await carregarInstanciasImportaveis();
  };

  const apontarPastaInstancias = async () => {
    const pasta = await openDialog({
      directory: true,
      multiple: false,
      title: "Selecionar instalação do launcher",
    });
    if (typeof pasta !== "string") return;

    const proximasPastas = Array.from(new Set([...pastasAdicionaisImportacao, pasta]));
    setPastasAdicionaisImportacao(proximasPastas);
    await carregarInstanciasImportaveis(proximasPastas);
  };

  const removerPastaApontada = async (pasta: string) => {
    const proximasPastas = pastasAdicionaisImportacao.filter((item) => item !== pasta);
    setPastasAdicionaisImportacao(proximasPastas);
    await carregarInstanciasImportaveis(proximasPastas);
  };

  const alternarSelecaoImportacao = (idExterno: string) => {
    setIdsSelecionadosImportacao((anterior) => {
      const proximo = new Set(anterior);
      if (proximo.has(idExterno)) {
        proximo.delete(idExterno);
      } else {
        proximo.add(idExterno);
      }
      return proximo;
    });
  };

  const selecionarTodasImportaveis = () => {
    if (idsSelecionadosImportacao.size === instanciasImportaveis.length) {
      setIdsSelecionadosImportacao(new Set());
      return;
    }
    setIdsSelecionadosImportacao(
      new Set(instanciasImportaveis.map((instancia) => instancia.idExterno))
    );
  };

  const importarSelecionadas = async () => {
    const selecionadas = instanciasImportaveis.filter((instancia) =>
      idsSelecionadosImportacao.has(instancia.idExterno)
    );
    if (selecionadas.length === 0) return;

    iniciarImportacoes(selecionadas);
    setModalImportacaoAberto(false);
    setModalEscolhaImportacaoAberto(false);
    setErroImportacao(null);
    setResultadoImportacao([]);

    await new Promise<void>((resolver) => window.requestAnimationFrame(() => resolver()));

    try {
      const resultados = await invoke<ResultadoImportacaoInstancia[]>(
        "importar_instancias_externas",
        { instancias: selecionadas }
      );
      setResultadoImportacao(resultados || []);
      await onAtualizarInstancias();
      await new Promise<void>((resolver) => window.requestAnimationFrame(() => resolver()));
    } catch (erro) {
      setErroImportacao(
        erro instanceof Error
          ? erro.message
          : "Falha ao importar as instâncias selecionadas."
      );
      setResultadoImportacao([]);
    } finally {
      finalizarImportacoes();
    }
  };

  // ===== EXPORTAR / IMPORTAR POR ARQUIVO =====
  const [exportandoId, setExportandoId] = useState<string | null>(null);
  const [importandoArquivo, setImportandoArquivo] = useState(false);

  const exportarInstancia = async (instanceId: string) => {
    setExportandoId(instanceId);
    try {
      const resultado = await invoke<{
        sucesso: boolean;
        caminhoArquivo?: string;
        mensagem: string;
      }>("exportar_instancia", { instanceId, destino: null });
      if (resultado.sucesso) {
        alert(`✅ ${resultado.mensagem}\n\nSalvo em: ${resultado.caminhoArquivo}`);
      } else {
        alert(`❌ ${resultado.mensagem}`);
      }
    } catch (erro) {
      alert(`Erro ao exportar: ${erro instanceof Error ? erro.message : String(erro)}`);
    } finally {
      setExportandoId(null);
    }
  };

  const importarArquivoDome = async () => {
    try {
      // Usar dialog nativo do Tauri para selecionar arquivo
      const caminho = await openDialog({
        title: "Selecionar arquivo .dome",
        filters: [{ name: "Dome Instance", extensions: ["dome", "zip"] }],
        multiple: false,
        directory: false,
      });
      if (!caminho) return;

      setImportandoArquivo(true);
      const resultado = await invoke<{
        sucesso: boolean;
        instanciaId?: string;
        mensagem: string;
      }>("importar_instancia_arquivo", { caminhoArquivo: caminho });

      if (resultado.sucesso) {
        alert(`✅ ${resultado.mensagem}`);
        window.location.reload();
      } else {
        alert(`❌ ${resultado.mensagem}`);
      }
    } catch (erro) {
      alert(`Erro ao importar: ${erro instanceof Error ? erro.message : String(erro)}`);
    } finally {
      setImportandoArquivo(false);
    }
  };

  const exportarInstanciaSelecionada = async () => {
    if (!instanciaSelecionadaId) return;
    await exportarInstancia(instanciaSelecionadaId);
  };

  const selecionarInstancia = (instancia: Instance) => {
    if (modoSelecaoMultipla) {
      setIdsSelecionados((anteriores) => {
        const proximos = new Set(anteriores);
        if (proximos.has(instancia.id)) proximos.delete(instancia.id);
        else proximos.add(instancia.id);
        return proximos;
      });
      return;
    }
    setInstanciaSelecionadaId(instancia.id);
    onSelectInstance(instancia);
  };

  const desselecionarInstancia = (evento: React.MouseEvent) => {
    const alvo = evento.target as HTMLElement;
    if (alvo.closest("button, input, [data-contexto-biblioteca-item]")) return;

    setInstanciaSelecionadaId(null);
    onDesselecionarInstancia();
  };

  const iniciarSelecaoMultipla = (idsIniciais: string[] = []) => {
    setModoSelecaoMultipla(true);
    setIdsSelecionados(new Set(idsIniciais));
    setMenuContexto(null);
  };

  const encerrarSelecaoMultipla = () => {
    setModoSelecaoMultipla(false);
    setIdsSelecionados(new Set());
    setMenuMoverSelecionadasAberto(false);
  };

  const moverSelecionadasParaGrupo = (grupoId: string) => {
    idsSelecionados.forEach((id) => moverInstanciaParaGrupo(id, grupoId));
    encerrarSelecaoMultipla();
  };

  const exportarSelecionadas = async () => {
    for (const id of idsSelecionados) {
      await exportarInstancia(id);
    }
    encerrarSelecaoMultipla();
  };

  const excluirSelecionadas = () => {
    if (idsSelecionados.size === 0) return;
    if (!confirm(`Excluir ${idsSelecionados.size} instâncias selecionadas?`)) return;
    idsSelecionados.forEach((id) => onDelete(id));
    encerrarSelecaoMultipla();
  };

  const abrirMenuContexto = (evento: React.MouseEvent, instancia: Instance) => {
    evento.preventDefault();
    evento.stopPropagation();
    if (!modoSelecaoMultipla) {
      setInstanciaSelecionadaId(instancia.id);
      onSelectInstance(instancia);
    }
    setMenuContexto({
      tipo: "instancia",
      instancia,
      x: evento.clientX,
      y: evento.clientY,
    });
  };

  const abrirMenuContextoGrupo = (evento: React.MouseEvent, grupo: InstanceGroup) => {
    evento.preventDefault();
    evento.stopPropagation();
    setMenuContexto({ tipo: "grupo", grupo, x: evento.clientX, y: evento.clientY });
  };

  const abrirMenuContextoVazio = (evento: React.MouseEvent) => {
    const alvo = evento.target as HTMLElement;
    if (alvo.closest("button, input, [data-contexto-biblioteca-item]")) return;
    evento.preventDefault();
    setMenuContexto({ tipo: "vazio", x: evento.clientX, y: evento.clientY });
  };

  const jogarPeloMenu = (instancia: Instance) => {
    setMenuContexto(null);
    if (!user) {
      onLogin();
      return;
    }
    onLaunch(instancia.id);
  };

  const excluirPeloMenu = (instancia: Instance) => {
    setMenuContexto(null);
    if (confirm(`Deletar "${instancia.name}"?`)) {
      onDelete(instancia.id);
    }
  };

  const totalSucessosImportacao = resultadoImportacao.filter((item) => item.sucesso).length;
  const nomeLauncher = (launcher: string) =>
    launcher === "prism"
      ? "Prism Launcher"
      : launcher === "modrinth"
        ? "Modrinth"
        : launcher === "curseforge"
          ? "CurseForge"
          : launcher;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3">
        {/* Busca */}
        <div className="flex-1 relative">
          <Search
            size={14}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20"
          />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar instâncias..."
            className="w-full bg-white/3 border border-white/5 rounded-xl pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500/30 placeholder:text-white/15 transition-all"
          />
          {busca && (
            <button
              onClick={() => setBusca("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/20 hover:text-white/40"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Ordenação */}
        <div className="relative">
          <button
            onClick={() =>
              setMenuAberto(menuAberto === "sort" ? null : "sort")
            }
            className="flex items-center gap-1.5 px-3 py-2 bg-white/3 border border-white/5 rounded-xl text-xs text-white/40 hover:text-white/60 hover:bg-white/5 transition-all"
          >
            <ArrowUpDown size={13} />
            {sortLabels[state.sortKey]}
          </button>
          <AnimatePresence>
            {menuAberto === "sort" && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                className="absolute right-0 top-full mt-1 bg-[#1a1a1c] border border-white/10 rounded-xl p-1 z-50 min-w-[140px] shadow-xl"
              >
                {(Object.keys(sortLabels) as SortKey[]).map((key) => (
                  <button
                    key={key}
                    onClick={() => {
                      alternarSort(key);
                      setMenuAberto(null);
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-all ${
                      state.sortKey === key
                        ? "text-emerald-400 bg-emerald-500/10"
                        : "text-white/50 hover:bg-white/5 hover:text-white/70"
                    }`}
                  >
                    {sortLabels[key]}
                    {state.sortKey === key && key !== "manual" && (
                      <span className="ml-auto text-[10px] opacity-50">
                        {state.sortDir === "asc" ? "↑" : "↓"}
                      </span>
                    )}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Novo grupo */}
        <button
          onClick={criarGrupo}
          className="flex items-center gap-1.5 px-3 py-2 bg-white/3 border border-white/5 rounded-xl text-xs text-white/40 hover:text-white/60 hover:bg-white/5 transition-all"
          title="Criar grupo"
        >
          <FolderPlus size={13} />
        </button>

        {/* View mode */}
        <div className="flex bg-white/3 border border-white/5 rounded-xl overflow-hidden">
          <button
            onClick={() => setState((p) => ({ ...p, viewMode: "grid" }))}
            className={`p-2 transition-all ${
              state.viewMode === "grid"
                ? "text-emerald-400 bg-emerald-500/10"
                : "text-white/30 hover:text-white/50"
            }`}
          >
            <LayoutGrid size={14} />
          </button>
          <button
            onClick={() => setState((p) => ({ ...p, viewMode: "list" }))}
            className={`p-2 transition-all ${
              state.viewMode === "list"
                ? "text-emerald-400 bg-emerald-500/10"
                : "text-white/30 hover:text-white/50"
            }`}
          >
            <List size={14} />
          </button>
        </div>

        {/* Importar / Exportar */}
        <button
          onClick={abrirModalImportacao}
          disabled={importandoInstancias}
          className="flex items-center gap-1.5 px-3 py-2 bg-white/5 border border-white/15 rounded-xl text-xs text-white/70 hover:text-white hover:bg-white/10 transition-all font-bold disabled:opacity-40 disabled:cursor-wait"
        >
          {importandoInstancias ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Upload size={13} />
          )}
          {importandoInstancias ? `Importando ${instanciasEmImportacao.length}` : "Importar"}
        </button>

        <button
          onClick={exportarInstanciaSelecionada}
          disabled={!instanciaSelecionadaId || Boolean(exportandoId)}
          className="flex items-center gap-1.5 px-3 py-2 bg-white/5 border border-white/15 rounded-xl text-xs text-white/70 hover:text-white hover:bg-white/10 transition-all font-bold disabled:opacity-40"
          title="Exportar instância selecionada"
        >
          {exportandoId ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Download size={13} />
          )}
          Exportar
        </button>

        <button
          onClick={onCreateNew}
          className="flex items-center gap-1.5 px-3 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs text-emerald-400 hover:bg-emerald-500/20 transition-all font-bold"
        >
          <Plus size={13} />
          Nova
        </button>
      </div>

      <AnimatePresence>
        {!importandoInstancias && (resultadoImportacao.length > 0 || erroImportacao) && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            className={cn(
              "flex items-start justify-between gap-4 rounded-xl border px-4 py-3 text-xs",
              erroImportacao || totalSucessosImportacao < resultadoImportacao.length
                ? "border-amber-400/25 bg-amber-500/8 text-amber-100"
                : "border-emerald-400/25 bg-emerald-500/8 text-emerald-100"
            )}
          >
            <div>
              <p className="font-bold">
                {erroImportacao
                  ? "A importação não foi concluída."
                  : `${totalSucessosImportacao} de ${resultadoImportacao.length} instâncias importadas.`}
              </p>
              {(erroImportacao || resultadoImportacao.find((item) => !item.sucesso)?.mensagem) && (
                <p className="mt-1 opacity-70">
                  {erroImportacao || resultadoImportacao.find((item) => !item.sucesso)?.mensagem}
                </p>
              )}
            </div>
            <button
              onClick={() => {
                setErroImportacao(null);
                setResultadoImportacao([]);
              }}
              className="rounded-md p-1 opacity-60 transition-opacity hover:opacity-100"
              aria-label="Fechar resultado da importação"
            >
              <X size={13} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Grupos e instâncias */}
      {instances.length === 0
        && instanciasEmImportacao.length === 0
        && transferenciasSociaisEmAndamento.length === 0 ? (
        <div
          className="py-20 flex flex-col items-center justify-center text-white/20 border-2 border-dashed border-white/5 rounded-2xl"
          onContextMenu={abrirMenuContextoVazio}
        >
          <Box size={48} className="mb-4 opacity-20" />
          <p className="font-bold">Nenhuma instância encontrada</p>
          <p className="text-sm mt-1">
            Crie uma nova instância ou importe uma existente
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            <button
              onClick={onCreateNew}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-sm font-bold hover:bg-emerald-500/20 transition-all"
            >
              <Plus size={14} />
              Criar Instância
            </button>
            <button
              onClick={abrirModalImportacao}
              disabled={importandoInstancias}
              className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/15 rounded-xl text-white/70 text-sm font-bold hover:bg-white/10 hover:text-white transition-all disabled:opacity-40"
            >
              <Upload size={14} />
              Importar Instância
            </button>
          </div>
        </div>
      ) : (
        <div
          className="min-h-[calc(100dvh-220px)] space-y-2"
          onClick={desselecionarInstancia}
          onContextMenu={abrirMenuContextoVazio}
        >
          {instanciasEmImportacao.length > 0 && (
            <SecaoImportacoesEmAndamento
              instancias={instanciasEmImportacao}
              viewMode={state.viewMode}
            />
          )}
          {transferenciasSociaisEmAndamento.length > 0 && (
            <SecaoImportacoesEmAndamento
              instancias={transferenciasSociaisEmAndamento.map((instancia) => ({
                idExterno: instancia.id,
                launcher: "Dome Social",
                nome: instancia.name,
                versaoMinecraft: instancia.version,
                loaderType: instancia.type,
                caminhoOrigem: "",
                caminhoJogo: "",
              }))}
              viewMode={state.viewMode}
              mensagem="Recebendo arquivos..."
            />
          )}
          {state.groups.map((grupo) => {
            const instanciasOrdenadas = ordenar(grupo.instanceIds);
            const instanciasFiltradas = filtrar(instanciasOrdenadas);

            // Se filtrando e grupo vazio, ocultar
            if (busca && instanciasFiltradas.length === 0) return null;

            return (
              <GrupoWidget
                key={grupo.id}
                grupo={grupo}
                instances={instanciasFiltradas}
                viewMode={state.viewMode}
                editando={editandoGrupo === grupo.id}
                nomeEdit={nomeGrupo}
                dragOver={dragOverGroup === grupo.id}
                inputRef={
                  editandoGrupo === grupo.id ? inputRef : undefined
                }
                onToggle={() => toggleGrupo(grupo.id)}
                onRenomear={() => {
                  setEditandoGrupo(grupo.id);
                  setNomeGrupo(grupo.name);
                  setTimeout(() => inputRef.current?.select(), 50);
                }}
                onNomeChange={setNomeGrupo}
                onNomeSalvar={() => salvarNomeGrupo(grupo.id)}
                podeDeletar={state.groups.length > 1}
                onDeletar={() => setGrupoExclusao(grupo)}
                onSelect={selecionarInstancia}
                onAbrirGerenciador={onAbrirGerenciadorInstancia}
                onAbrirMenuContexto={abrirMenuContexto}
                onAbrirMenuContextoGrupo={(evento) => abrirMenuContextoGrupo(evento, grupo)}
                modoSelecaoMultipla={modoSelecaoMultipla}
                idsSelecionados={idsSelecionados}
                onIniciarArrasto={iniciarArrastoInstancia}
                onMoverArrasto={posicionarInstanciaPeloPonteiro}
                onFinalizarArrasto={finalizarArrastoInstancia}
                instanciaSendoArrastadaId={draggedId}
                onIniciarArrastoGrupo={(evento) => {
                  if (evento.button !== 0) return;
                  evento.preventDefault();
                  evento.stopPropagation();
                  setGrupoArrastadoId(grupo.id);
                }}
                onEntrarGrupoDestino={() => {
                  if (!grupoArrastadoId) return;
                  moverGrupoDuranteArrasto(grupo.id);
                }}
                grupoSendoArrastado={grupoArrastadoId === grupo.id}
                instanciaSelecionadaId={instanciaSelecionadaId}
                instanciaAtivaId={instanciaAtivaId}
                publicacoesPorInstancia={publicacoesPorInstancia}
                agoraSegundos={agoraSegundos}
              />
            );
          })}
        </div>
      )}

      <AnimatePresence>
        {modoSelecaoMultipla && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            className="sticky bottom-4 z-40 mx-auto flex w-fit max-w-full items-center gap-2 border border-emerald-400/20 bg-[#151516] p-2 shadow-2xl"
          >
            <span className="border-r border-white/10 px-2 text-xs font-bold text-white/70">
              {idsSelecionados.size} selecionada{idsSelecionados.size === 1 ? "" : "s"}
            </span>
            <button
              type="button"
              onClick={() => setIdsSelecionados(new Set(instances.map((instancia) => instancia.id)))}
              className="px-2 py-1.5 text-[10px] font-bold text-white/45 hover:text-white"
            >
              Selecionar todas
            </button>
            <div className="relative">
              <button
                type="button"
                disabled={idsSelecionados.size === 0}
                onClick={() => setMenuMoverSelecionadasAberto((aberto) => !aberto)}
                className="flex items-center gap-1.5 border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[10px] font-bold text-white/65 hover:text-white disabled:opacity-35"
              >
                <FolderOpen size={12} />
                Mover para
                <ChevronDown size={11} />
              </button>
              <AnimatePresence>
                {menuMoverSelecionadasAberto && (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 4 }}
                    className="absolute bottom-full left-0 mb-1 min-w-44 border border-white/12 bg-[#171719] p-1 shadow-xl"
                  >
                    {state.groups.map((grupo) => (
                      <button
                        type="button"
                        key={grupo.id}
                        onClick={() => moverSelecionadasParaGrupo(grupo.id)}
                        className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-[10px] font-bold text-white/60 hover:bg-white/7 hover:text-white"
                      >
                        <FolderOpen size={11} />
                        <span className="truncate">{grupo.name}</span>
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <button
              type="button"
              disabled={idsSelecionados.size === 0 || Boolean(exportandoId)}
              onClick={() => void exportarSelecionadas()}
              className="flex items-center gap-1.5 border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[10px] font-bold text-white/65 hover:text-white disabled:opacity-35"
            >
              <Download size={12} />
              Exportar
            </button>
            <button
              type="button"
              disabled={idsSelecionados.size === 0}
              onClick={excluirSelecionadas}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-bold text-red-300/70 hover:bg-red-500/10 hover:text-red-200 disabled:opacity-35"
            >
              <Trash2 size={12} />
              Excluir
            </button>
            <button
              type="button"
              onClick={encerrarSelecaoMultipla}
              className="p-1.5 text-white/35 hover:text-white"
              aria-label="Cancelar seleção múltipla"
            >
              <X size={13} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {grupoExclusao && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4"
            onClick={() => setGrupoExclusao(null)}
          >
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="titulo-excluir-grupo"
              className="w-full max-w-sm border border-white/12 bg-[#151516] shadow-2xl"
              onClick={(evento) => evento.stopPropagation()}
            >
              <div className="border-b border-white/8 px-4 py-3">
                <p
                  id="titulo-excluir-grupo"
                  className="text-xs font-black uppercase tracking-wide text-white/85"
                >
                  Excluir grupo
                </p>
              </div>
              <div className="px-4 py-4">
                <p className="text-xs leading-relaxed text-white/55">
                  O grupo <span className="font-bold text-white/85">{grupoExclusao.name}</span> será
                  excluído. As {grupoExclusao.instanceIds.length} instâncias serão movidas para outro
                  grupo e nenhum arquivo será apagado.
                </p>
              </div>
              <div className="flex justify-end gap-2 border-t border-white/8 px-4 py-3">
                <button
                  onClick={() => setGrupoExclusao(null)}
                  className="px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-white/45 hover:text-white/75"
                >
                  Cancelar
                </button>
                <button
                  onClick={() => {
                    deletarGrupo(grupoExclusao.id);
                    setGrupoExclusao(null);
                  }}
                  className="border border-red-400/25 bg-red-400/8 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-red-200 transition-colors hover:bg-red-400/14"
                >
                  Excluir grupo
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {menuContexto && (
          <MenuContextual
            aberto
            x={menuContexto.x}
            y={menuContexto.y}
            onFechar={() => setMenuContexto(null)}
          >
            {menuContexto.tipo === "instancia" && (() => {
              const instancia = menuContexto.instancia;
              const modpack = modpacksPorInstancia[instancia.id];
              const grupoAtual = state.groups.find((grupo) => grupo.instanceIds.includes(instancia.id));
              const estaSelecionada = idsSelecionados.has(instancia.id);
              return (
                <>
                  <CabecalhoMenuContextual
                    titulo={instancia.name}
                    subtitulo={`${instancia.loader_type || instancia.mc_type} ${instancia.version}`}
                  />
                  <ItemMenuContextual
                    icone={<Play size={13} fill="currentColor" />}
                    destaque
                    onClick={() => jogarPeloMenu(instancia)}
                  >
                    Jogar
                  </ItemMenuContextual>
                  <ItemMenuContextual icone={<Pencil size={13} />} onClick={() => {
                    setMenuContexto(null);
                    onAbrirGerenciadorInstancia(instancia);
                  }}>
                    Gerenciar instância
                  </ItemMenuContextual>
                  {modpack && (
                    <ItemMenuContextual icone={<RefreshCw size={13} />} onClick={() => {
                      setMenuContexto(null);
                      onTrocarVersaoModpack(instancia, {
                        id: modpack.projectId,
                        title: modpack.name,
                        description: "Escolha uma versão completa para substituir o modpack instalado.",
                        icon_url: modpack.icon || instancia.icon || "",
                        author: modpack.author,
                        slug: modpack.slug,
                        source: modpack.source,
                        project_type: "modpack",
                        versaoInicialId: modpack.versionId,
                      });
                    }}>
                      Trocar versão do modpack
                    </ItemMenuContextual>
                  )}
                  {modpack && (
                    <ItemMenuContextual icone={<Star size={13} />} onClick={() => {
                      setMenuContexto(null);
                      setModalAnalise({ instancia, modpack });
                    }}>
                      Escrever análise
                    </ItemMenuContextual>
                  )}
                  <ItemMenuContextual icone={<Check size={13} />} onClick={() => {
                    const selecionadas = Array.from(idsSelecionados);
                    iniciarSelecaoMultipla(
                      estaSelecionada
                        ? selecionadas.filter((id) => id !== instancia.id)
                        : [...selecionadas, instancia.id]
                    );
                  }}>
                    {estaSelecionada ? "Remover da seleção" : "Selecionar"}
                  </ItemMenuContextual>
                  <ItemMenuContextual icone={<FolderOpen size={13} />} onClick={() => {
                    setMenuContexto(null);
                    void invoke("abrir_pasta_instancia", { instanceId: instancia.id }).catch((erro) => {
                      console.error("Erro ao abrir local da instância:", erro);
                      alert("Não foi possível abrir o local da instância.");
                    });
                  }}>
                    Abrir pasta
                  </ItemMenuContextual>
                  <ItemMenuContextual icone={<Globe size={13} />} onClick={() => {
                    setMenuContexto(null);
                    window.dispatchEvent(new CustomEvent(EVENTO_PUBLICAR_INSTANCIA_SOCIAL, {
                      detail: {
                        instanciaId: instancia.id,
                        nome: instancia.name,
                        publicar: !publicacoesPorInstancia[instancia.id],
                      },
                    }));
                  }}>
                    {publicacoesPorInstancia[instancia.id] ? "Tornar privada" : "Tornar pública"}
                  </ItemMenuContextual>
                  <ItemMenuContextual
                    icone={exportandoId === instancia.id
                      ? <Loader2 size={13} className="animate-spin" />
                      : <Download size={13} />}
                    disabled={exportandoId === instancia.id}
                    onClick={() => {
                      setMenuContexto(null);
                      void exportarInstancia(instancia.id);
                    }}
                  >
                    Exportar
                  </ItemMenuContextual>
                  {state.groups.length > 1 && (
                    <>
                      <RotuloMenuContextual>Mover para grupo</RotuloMenuContextual>
                      {state.groups.map((grupo) => (
                        <ItemMenuContextual
                          key={grupo.id}
                          icone={<FolderOpen size={12} />}
                          disabled={grupo.id === grupoAtual?.id}
                          sufixo={grupo.id === grupoAtual?.id ? "Atual" : undefined}
                          onClick={() => {
                            moverInstanciaParaGrupo(instancia.id, grupo.id);
                            setMenuContexto(null);
                          }}
                        >
                          {grupo.name}
                        </ItemMenuContextual>
                      ))}
                    </>
                  )}
                  <SeparadorMenuContextual />
                  <ItemMenuContextual
                    icone={<Trash2 size={13} />}
                    perigo
                    onClick={() => excluirPeloMenu(instancia)}
                  >
                    Excluir instância
                  </ItemMenuContextual>
                </>
              );
            })()}

            {menuContexto.tipo === "grupo" && (
              <>
                <CabecalhoMenuContextual
                  titulo={menuContexto.grupo.name}
                  subtitulo={`${menuContexto.grupo.instanceIds.length} instâncias`}
                />
                <ItemMenuContextual icone={<Pencil size={13} />} onClick={() => {
                  setEditandoGrupo(menuContexto.grupo.id);
                  setNomeGrupo(menuContexto.grupo.name);
                  setMenuContexto(null);
                  setTimeout(() => inputRef.current?.select(), 50);
                }}>
                  Renomear grupo
                </ItemMenuContextual>
                <ItemMenuContextual
                  icone={<Check size={13} />}
                  disabled={menuContexto.grupo.instanceIds.length === 0}
                  onClick={() => iniciarSelecaoMultipla(menuContexto.grupo.instanceIds)}
                >
                  Selecionar instâncias
                </ItemMenuContextual>
                <ItemMenuContextual
                  icone={menuContexto.grupo.collapsed
                    ? <ChevronRight size={13} />
                    : <ChevronDown size={13} />}
                  onClick={() => {
                    toggleGrupo(menuContexto.grupo.id);
                    setMenuContexto(null);
                  }}
                >
                  {menuContexto.grupo.collapsed ? "Expandir grupo" : "Recolher grupo"}
                </ItemMenuContextual>
                {state.groups.length > 1 && (
                  <>
                    <SeparadorMenuContextual />
                    <ItemMenuContextual icone={<Trash2 size={13} />} perigo onClick={() => {
                      setGrupoExclusao(menuContexto.grupo);
                      setMenuContexto(null);
                    }}>
                      Excluir grupo
                    </ItemMenuContextual>
                  </>
                )}
              </>
            )}

            {menuContexto.tipo === "vazio" && (
              <>
                <CabecalhoMenuContextual titulo="Biblioteca" subtitulo="Ações rápidas" />
                <ItemMenuContextual icone={<Plus size={13} />} onClick={() => {
                  setMenuContexto(null);
                  onCreateNew();
                }}>
                  Criar instância
                </ItemMenuContextual>
                <ItemMenuContextual icone={<FolderPlus size={13} />} onClick={() => {
                  setMenuContexto(null);
                  criarGrupo();
                }}>
                  Criar grupo
                </ItemMenuContextual>
                <ItemMenuContextual icone={<Upload size={13} />} onClick={() => {
                  setMenuContexto(null);
                  abrirModalImportacao();
                }}>
                  Importar instância
                </ItemMenuContextual>
                <ItemMenuContextual icone={<Check size={13} />} onClick={() => iniciarSelecaoMultipla()}>
                  Selecionar várias
                </ItemMenuContextual>
                <SeparadorMenuContextual />
                <ItemMenuContextual icone={<RefreshCw size={13} />} onClick={() => {
                  setMenuContexto(null);
                  void onAtualizarInstancias();
                }}>
                  Atualizar biblioteca
                </ItemMenuContextual>
                <ItemMenuContextual
                  icone={state.viewMode === "grid" ? <List size={13} /> : <LayoutGrid size={13} />}
                  onClick={() => {
                    setState((estado) => ({
                      ...estado,
                      viewMode: estado.viewMode === "grid" ? "list" : "grid",
                    }));
                    setMenuContexto(null);
                  }}
                >
                  Exibir como {state.viewMode === "grid" ? "lista" : "grade"}
                </ItemMenuContextual>
              </>
            )}
          </MenuContextual>
        )}
      </AnimatePresence>

      {modalAnalise && (
        <ModalAnaliseModpack
          modpack={{
            projectId: modalAnalise.modpack.projectId,
            source: modalAnalise.modpack.source,
            name: modalAnalise.modpack.name,
            author: modalAnalise.modpack.author,
            icon: modalAnalise.modpack.icon,
            slug: modalAnalise.modpack.slug,
            versionId: modalAnalise.modpack.versionId,
            installedVersion: modalAnalise.modpack.installedVersion,
          }}
          instanciaId={modalAnalise.instancia.id}
          instanciaNome={modalAnalise.instancia.name}
          horasJogados={(modalAnalise.instancia.tempo_total_jogado_segundos ?? 0) / 3600}
          onFechar={() => setModalAnalise(null)}
          onPublicada={() => setModalAnalise(null)}
        />
      )}

      <AnimatePresence>
        {modalEscolhaImportacaoAberto && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-xs p-4 flex items-center justify-center"
            onClick={() => {
              if (importandoArquivo) return;
              setModalEscolhaImportacaoAberto(false);
            }}
          >
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              className="w-full max-w-xl bg-[#141416] border border-white/15 rounded-2xl overflow-hidden"
              onClick={(evento) => evento.stopPropagation()}
            >
              <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-black uppercase tracking-wide">Importar</h3>
                  <p className="text-xs text-white/50 mt-1">
                    Escolha como deseja importar para a biblioteca.
                  </p>
                </div>
                <button
                  onClick={() => setModalEscolhaImportacaoAberto(false)}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors"
                >
                  <X size={14} />
                </button>
              </div>

              <div className="p-5 space-y-3">
                <button
                  onClick={async () => {
                    setModalEscolhaImportacaoAberto(false);
                    await importarArquivoDome();
                  }}
                  disabled={importandoArquivo}
                  className="w-full text-left border border-white/10 bg-white/5 hover:bg-white/10 rounded-xl px-4 py-3 transition-all disabled:opacity-40"
                >
                  <p className="text-sm font-bold flex items-center gap-2">
                    {importandoArquivo ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Upload size={14} />
                    )}
                    Importar arquivo `.dome`
                  </p>
                  <p className="text-xs text-white/55 mt-1">
                    Também aceita `.dome.zip` para compatibilidade.
                  </p>
                </button>

                <button
                  onClick={abrirModalImportacaoInstancias}
                  className="w-full text-left border border-white/10 bg-white/5 hover:bg-white/10 rounded-xl px-4 py-3 transition-all"
                >
                  <p className="text-sm font-bold flex items-center gap-2">
                    <FolderOpen size={14} />
                    Importar de outro launcher
                  </p>
                  <p className="text-xs text-white/55 mt-1">
                    Detecta instâncias de Prism Launcher, Modrinth e CurseForge.
                  </p>
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}

        {modalImportacaoAberto && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-xs p-4 flex items-center justify-center"
            onClick={() => {
              if (importandoInstancias) return;
              setModalImportacaoAberto(false);
            }}
          >
            <motion.div
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              className="w-full max-w-3xl bg-[#141416] border border-white/15 rounded-2xl overflow-hidden"
              onClick={(evento) => evento.stopPropagation()}
            >
              <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-black uppercase tracking-wide">Importar Instâncias</h3>
                  <p className="text-xs text-white/50 mt-1">
                    Detectadas automaticamente ou nas instalações que você apontar.
                  </p>
                </div>
                <button
                  onClick={() => {
                    if (importandoInstancias) return;
                    setModalImportacaoAberto(false);
                    setModalEscolhaImportacaoAberto(false);
                  }}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-white/50 hover:text-white transition-colors"
                >
                  <X size={14} />
                </button>
              </div>

              <div className="px-5 py-4">
                <div className="mb-4 rounded-xl border border-white/10 bg-white/3 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-white/80">Instalação personalizada</p>
                      <p className="mt-0.5 text-[11px] text-white/40">
                        Aponte a pasta do Prism Launcher, Modrinth, CurseForge ou a pasta de perfis.
                      </p>
                    </div>
                    <button
                      onClick={() => void apontarPastaInstancias()}
                      disabled={carregandoImportaveis}
                      className="flex shrink-0 items-center gap-2 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-bold text-white/75 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
                    >
                      <FolderPlus size={13} />
                      Apontar pasta
                    </button>
                  </div>
                  {pastasAdicionaisImportacao.length > 0 && (
                    <div className="mt-3 space-y-1.5 border-t border-white/8 pt-3">
                      {pastasAdicionaisImportacao.map((pasta) => (
                        <div
                          key={pasta}
                          className="flex items-center gap-2 rounded-lg bg-black/20 px-2.5 py-2"
                        >
                          <FolderOpen size={12} className="shrink-0 text-emerald-400/70" />
                          <span className="min-w-0 flex-1 truncate text-[10px] text-white/45">
                            {pasta}
                          </span>
                          <button
                            onClick={() => void removerPastaApontada(pasta)}
                            disabled={carregandoImportaveis}
                            className="rounded p-1 text-white/30 transition-colors hover:bg-white/10 hover:text-white/70 disabled:opacity-30"
                            aria-label={`Remover pasta ${pasta}`}
                          >
                            <X size={11} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {erroImportacao && (
                  <div className="mb-3 border border-red-400/30 bg-red-500/10 text-red-200 text-xs px-3 py-2 rounded-lg">
                    {erroImportacao}
                  </div>
                )}

                {carregandoImportaveis ? (
                  <div className="py-12 flex items-center justify-center text-white/60 text-sm">
                    <Loader2 size={14} className="animate-spin mr-2" />
                    Buscando instâncias...
                  </div>
                ) : instanciasImportaveis.length === 0 ? (
                  <div className="py-12 text-center text-white/50 text-sm">
                    Nenhuma instância externa foi encontrada no computador.
                  </div>
                ) : (
                  <>
                    <div className="mb-3 flex items-center justify-between">
                      <button
                        onClick={selecionarTodasImportaveis}
                        className="text-xs text-white/70 hover:text-white transition-colors"
                      >
                        {idsSelecionadosImportacao.size === instanciasImportaveis.length
                          ? "Desmarcar todas"
                          : "Marcar todas"}
                      </button>
                      <span className="text-[11px] text-white/40">
                        {idsSelecionadosImportacao.size}/{instanciasImportaveis.length} selecionadas
                      </span>
                    </div>

                    <div className="max-h-[360px] overflow-y-auto space-y-2 pr-1">
                      {instanciasImportaveis.map((instancia) => {
                        const selecionada = idsSelecionadosImportacao.has(instancia.idExterno);
                        return (
                          <button
                            key={instancia.idExterno}
                            onClick={() => alternarSelecaoImportacao(instancia.idExterno)}
                            className={cn(
                              "w-full text-left border rounded-xl px-3 py-2 transition-all",
                              selecionada
                                ? "border-emerald-400/40 bg-emerald-500/10"
                                : "border-white/10 bg-white/3 hover:bg-white/6"
                            )}
                          >
                            <div className="flex items-start gap-3">
                              <input
                                type="checkbox"
                                checked={selecionada}
                                readOnly
                                className="mt-1 w-4 h-4"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-bold truncate">{instancia.nome}</p>
                                  <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-white/10 text-white/60">
                                    {nomeLauncher(instancia.launcher)}
                                  </span>
                                </div>
                                <p className="text-xs text-white/55 mt-0.5">
                                  MC {instancia.versaoMinecraft}
                                  {instancia.loaderType ? ` • ${instancia.loaderType}` : " • Vanilla"}
                                  {instancia.loaderVersion ? ` ${instancia.loaderVersion}` : ""}
                                </p>
                                <p className="text-[10px] text-white/35 mt-1 truncate">
                                  {instancia.caminhoOrigem}
                                </p>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}

              </div>

              <div className="px-5 py-4 border-t border-white/10 flex items-center justify-between gap-3">
                <button
                  onClick={() => void carregarInstanciasImportaveis()}
                  disabled={carregandoImportaveis || importandoInstancias}
                  className="text-xs text-white/65 hover:text-white disabled:opacity-40 transition-colors"
                >
                  Rebuscar
                </button>
                <div className="flex items-center gap-2">
                  <button
                    onClick={importarSelecionadas}
                    disabled={
                      importandoInstancias ||
                      carregandoImportaveis ||
                      idsSelecionadosImportacao.size === 0
                    }
                    className={cn(
                      "px-3 py-2 rounded-lg text-xs font-black uppercase tracking-wide transition-all flex items-center gap-2",
                      importandoInstancias ||
                        carregandoImportaveis ||
                        idsSelecionadosImportacao.size === 0
                        ? "bg-white/10 text-white/40 cursor-not-allowed"
                        : "bg-emerald-500 text-black hover:bg-emerald-400"
                    )}
                  >
                    {importandoInstancias ? (
                      <>
                        <Loader2 size={12} className="animate-spin" />
                        Importando...
                      </>
                    ) : (
                      <>
                        <Upload size={12} />
                        Importar selecionadas
                      </>
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}

function SecaoImportacoesEmAndamento({
  instancias,
  viewMode,
  mensagem = "Migrando arquivos...",
}: {
  instancias: InstanciaImportavelExterna[];
  viewMode: ViewMode;
  mensagem?: string;
}) {
  return (
    <section className="mb-5" aria-live="polite" aria-label="Importações em andamento">
      <div className="mb-2 flex items-center gap-2 px-1 text-[11px] font-black uppercase tracking-wide text-white/45">
        <Loader2 size={12} className="animate-spin text-emerald-400" />
        Importando
        <span className="font-normal text-white/25">{instancias.length}</span>
      </div>
      <div
        className={cn(
          viewMode === "grid"
            ? "grid grid-cols-[repeat(auto-fill,124px)] justify-start gap-2"
            : "space-y-2"
        )}
      >
        {instancias.map((instancia) => (
          <div
            key={instancia.idExterno}
            aria-disabled="true"
            className={cn(
              "pointer-events-none relative select-none overflow-hidden border border-white/8 bg-white/3 opacity-45",
              viewMode === "grid"
                ? "min-h-[150px] rounded-2xl p-4"
                : "flex min-h-16 items-center gap-3 rounded-xl px-4 py-3"
            )}
          >
            <div
              className={cn(
                "flex shrink-0 items-center justify-center rounded-xl border border-white/10 bg-black/25 text-white/35",
                viewMode === "grid" ? "h-14 w-14" : "h-10 w-10"
              )}
            >
              <Box size={viewMode === "grid" ? 24 : 18} />
            </div>
            <div className={cn("min-w-0", viewMode === "grid" ? "mt-3" : "flex-1")}>
              <p className="truncate text-sm font-bold text-white">{instancia.nome}</p>
              <p className="mt-1 truncate text-[11px] text-white/55">
                {instancia.loaderType || "Vanilla"} {instancia.versaoMinecraft}
              </p>
              <p className="mt-1 flex items-center gap-1.5 text-[10px] font-semibold text-emerald-300">
                <Loader2 size={10} className="animate-spin" />
                {mensagem}
              </p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ===== WIDGET DE GRUPO =====
function GrupoWidget({
  grupo,
  instances,
  viewMode,
  editando,
  nomeEdit,
  dragOver,
  inputRef,
  onToggle,
  onRenomear,
  onNomeChange,
  onNomeSalvar,
  podeDeletar,
  onDeletar,
  onSelect,
  onAbrirGerenciador,
  onAbrirMenuContexto,
  onAbrirMenuContextoGrupo,
  modoSelecaoMultipla,
  idsSelecionados,
  onIniciarArrasto,
  onMoverArrasto,
  onFinalizarArrasto,
  instanciaSendoArrastadaId,
  onIniciarArrastoGrupo,
  onEntrarGrupoDestino,
  grupoSendoArrastado,
  instanciaSelecionadaId,
  instanciaAtivaId,
  publicacoesPorInstancia,
  agoraSegundos,
}: {
  grupo: InstanceGroup;
  instances: Instance[];
  viewMode: ViewMode;
  editando: boolean;
  nomeEdit: string;
  dragOver: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  onToggle: () => void;
  onRenomear: () => void;
  onNomeChange: (v: string) => void;
  onNomeSalvar: () => void;
  podeDeletar: boolean;
  onDeletar: () => void;
  onSelect: (instance: Instance) => void;
  onAbrirGerenciador: (instance: Instance) => void;
  onAbrirMenuContexto: (evento: React.MouseEvent, instance: Instance) => void;
  onAbrirMenuContextoGrupo: (evento: React.MouseEvent) => void;
  modoSelecaoMultipla: boolean;
  idsSelecionados: Set<string>;
  onIniciarArrasto: (id: string) => void;
  onMoverArrasto: (id: string, x: number, y: number) => void;
  onFinalizarArrasto: (id?: string, x?: number, y?: number) => void;
  instanciaSendoArrastadaId: string | null;
  onIniciarArrastoGrupo: (evento: React.MouseEvent) => void;
  onEntrarGrupoDestino: () => void;
  grupoSendoArrastado: boolean;
  instanciaSelecionadaId: string | null;
  instanciaAtivaId: string | null;
  publicacoesPorInstancia: Record<string, string>;
  agoraSegundos: number;
}) {
  return (
    <motion.div
      layout="position"
      transition={{ layout: { duration: 0.16, ease: "easeOut" } }}
      onMouseEnter={onEntrarGrupoDestino}
      data-grupo-biblioteca
      data-grupo-id={grupo.id}
      className={`rounded-xl border transition-colors ${
        dragOver
          ? "border-emerald-500/30 bg-emerald-500/5"
          : "border-transparent"
      } ${grupoSendoArrastado ? "opacity-45" : "opacity-100"}`}
    >
      {/* Header do grupo */}
      <div
        className="flex items-center gap-2 py-1.5 px-1 group/header"
        onContextMenu={onAbrirMenuContextoGrupo}
      >
        <div
          onMouseDown={onIniciarArrastoGrupo}
          className={cn(
            "cursor-grab text-white/15 transition-colors hover:text-white/45",
            "active:cursor-grabbing"
          )}
          title="Arrastar grupo"
        >
          <GripVertical size={12} />
        </div>
        <button
          onClick={onToggle}
          className="p-1 text-white/25 hover:text-white/50 transition-colors"
        >
          {grupo.collapsed ? (
            <ChevronRight size={14} />
          ) : (
            <ChevronDown size={14} />
          )}
        </button>

        {editando ? (
          <div className="flex items-center gap-1.5 flex-1">
            <input
              ref={inputRef}
              value={nomeEdit}
              onChange={(e) => onNomeChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onNomeSalvar();
                if (e.key === "Escape") onNomeSalvar();
              }}
              onBlur={onNomeSalvar}
              className={cn(
                "rounded-lg border border-white/10 bg-white/5 px-2 py-0.5 text-sm font-bold",
                "focus:outline-none focus:ring-1 focus:ring-emerald-500/30"
              )}
              autoFocus
            />
          </div>
        ) : (
          <div
            onMouseDown={onIniciarArrastoGrupo}
            className={cn(
              "flex flex-1 cursor-grab items-center gap-2",
              "active:cursor-grabbing"
            )}
            title="Arrastar grupo"
          >
            <FolderOpen size={13} className="text-white/20" />
            <span className="text-xs font-bold text-white/40 uppercase tracking-wider">
              {grupo.name}
            </span>
            <span className="text-[10px] text-white/15 font-medium">
              {instances.length}
            </span>
          </div>
        )}

        {/* Ações do grupo */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={onRenomear}
            className="p-1 text-white/20 hover:text-white/40 transition-colors"
            title="Renomear grupo"
          >
            <Pencil size={11} />
          </button>
          {podeDeletar && (
            <button
              onClick={onDeletar}
              className="p-1 text-white/25 hover:text-red-400 transition-colors"
              title="Excluir grupo"
            >
              <Trash2 size={11} />
            </button>
          )}
        </div>
      </div>

      {/* Conteúdo */}
      <AnimatePresence>
        {!grupo.collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            {instances.length === 0 ? (
              <div
                className={cn(
                  "mx-1 mb-2 rounded-xl border border-dashed border-white/5 py-6",
                  "text-center text-xs text-white/10"
                )}
              >
                Arraste instâncias para este grupo
              </div>
            ) : viewMode === "grid" ? (
              <div
                className={cn(
                  "grid grid-cols-[repeat(auto-fill,124px)] justify-start gap-2 px-1 pb-2"
                )}
              >
                {instances.map((instance, i) => (
                  <CardGrid
                    key={instance.id}
                    instance={instance}
                    index={i}
                    onSelect={onSelect}
                    onAbrirGerenciador={onAbrirGerenciador}
                    onAbrirMenuContexto={onAbrirMenuContexto}
                    onIniciarArrasto={onIniciarArrasto}
                    onMoverArrasto={onMoverArrasto}
                    onFinalizarArrasto={onFinalizarArrasto}
                    grupoId={grupo.id}
                    sendoArrastada={instanciaSendoArrastadaId === instance.id}
                    selecionada={
                      modoSelecaoMultipla
                        ? idsSelecionados.has(instance.id)
                        : instance.id === instanciaSelecionadaId
                    }
                    modoSelecaoMultipla={modoSelecaoMultipla}
                    ativa={instance.id === instanciaAtivaId}
                    publica={Boolean(publicacoesPorInstancia[instance.id])}
                    agoraSegundos={agoraSegundos}
                  />
                ))}
              </div>
            ) : (
              <div className="space-y-1 px-1 pb-2">
                {instances.map((instance, i) => (
                  <CardList
                    key={instance.id}
                    instance={instance}
                    index={i}
                    onSelect={onSelect}
                    onAbrirGerenciador={onAbrirGerenciador}
                    onAbrirMenuContexto={onAbrirMenuContexto}
                    onIniciarArrasto={onIniciarArrasto}
                    onMoverArrasto={onMoverArrasto}
                    onFinalizarArrasto={onFinalizarArrasto}
                    grupoId={grupo.id}
                    sendoArrastada={instanciaSendoArrastadaId === instance.id}
                    selecionada={
                      modoSelecaoMultipla
                        ? idsSelecionados.has(instance.id)
                        : instance.id === instanciaSelecionadaId
                    }
                    modoSelecaoMultipla={modoSelecaoMultipla}
                    ativa={instance.id === instanciaAtivaId}
                    publica={Boolean(publicacoesPorInstancia[instance.id])}
                    agoraSegundos={agoraSegundos}
                  />
                ))}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function useArrastoInstancia({
  instanceId,
  onIniciar,
  onMover,
  onFinalizar,
}: {
  instanceId: string;
  onIniciar: (id: string) => void;
  onMover: (id: string, x: number, y: number) => void;
  onFinalizar: (id?: string, x?: number, y?: number) => void;
}) {
  const inicioRef = useRef<{
    ponteiroId: number;
    x: number;
    y: number;
    ativo: boolean;
  } | null>(null);
  const ignorarCliqueRef = useRef(false);
  const elementoRef = useRef<HTMLDivElement | null>(null);
  const callbacksRef = useRef({ onIniciar, onMover, onFinalizar });
  callbacksRef.current = { onIniciar, onMover, onFinalizar };

  useEffect(() => {
    let quadradoFlutuante: HTMLElement | null = null;
    let deslocamentoX = 0;
    let deslocamentoY = 0;
    const encerrar = (evento?: PointerEvent) => {
      const inicio = inicioRef.current;
      if (!inicio || (evento && evento.pointerId !== inicio.ponteiroId)) return;
      inicioRef.current = null;
      quadradoFlutuante?.remove();
      quadradoFlutuante = null;
      if (inicio.ativo) {
        callbacksRef.current.onFinalizar(
          evento ? instanceId : undefined,
          evento?.clientX,
          evento?.clientY
        );
      }
    };
    const mover = (evento: PointerEvent) => {
      const inicio = inicioRef.current;
      if (!inicio || evento.pointerId !== inicio.ponteiroId) return;
      if ((evento.buttons & 1) === 0) {
        encerrar();
        return;
      }
      if (!inicio.ativo) {
        if (Math.hypot(evento.clientX - inicio.x, evento.clientY - inicio.y) < 5) return;
        inicio.ativo = true;
        ignorarCliqueRef.current = true;
        const elemento = elementoRef.current;
        if (elemento) {
          const limites = elemento.getBoundingClientRect();
          deslocamentoX = inicio.x - limites.left;
          deslocamentoY = inicio.y - limites.top;
          quadradoFlutuante = elemento.cloneNode(true) as HTMLElement;
          quadradoFlutuante.removeAttribute("data-instancia-id");
          quadradoFlutuante.removeAttribute("data-grupo-id");
          quadradoFlutuante.removeAttribute("data-destino-arrasto");
          quadradoFlutuante.setAttribute("aria-hidden", "true");
          Object.assign(quadradoFlutuante.style, {
            position: "fixed",
            width: `${limites.width}px`,
            height: `${limites.height}px`,
            margin: "0",
            pointerEvents: "none",
            zIndex: "1000",
            opacity: "1",
            transform: "none",
            transition: "none",
            backgroundColor: "#202523",
            boxShadow: "0 12px 30px #0008",
          });
          document.body.appendChild(quadradoFlutuante);
        }
        callbacksRef.current.onIniciar(instanceId);
      }
      if (quadradoFlutuante) {
        quadradoFlutuante.style.left = `${evento.clientX - deslocamentoX}px`;
        quadradoFlutuante.style.top = `${evento.clientY - deslocamentoY}px`;
      }
      evento.preventDefault();
      callbacksRef.current.onMover(instanceId, evento.clientX, evento.clientY);
    };
    const cancelar = () => encerrar();
    const tecla = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") cancelar();
    };
    window.addEventListener("pointermove", mover, { passive: false });
    window.addEventListener("pointerup", encerrar, true);
    window.addEventListener("pointercancel", cancelar);
    window.addEventListener("blur", cancelar);
    window.addEventListener("keydown", tecla);
    return () => {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", encerrar, true);
      window.removeEventListener("pointercancel", cancelar);
      window.removeEventListener("blur", cancelar);
      window.removeEventListener("keydown", tecla);
      cancelar();
    };
  }, [instanceId]);

  const aoPressionar = (evento: React.PointerEvent<HTMLDivElement>) => {
    if (evento.button !== 0 || !evento.isPrimary) return;
    ignorarCliqueRef.current = false;
    elementoRef.current = evento.currentTarget;
    inicioRef.current = {
      ponteiroId: evento.pointerId,
      x: evento.clientX,
      y: evento.clientY,
      ativo: false,
    };
    evento.preventDefault();
  };

  const consumirCliqueArrasto = () => {
    if (!ignorarCliqueRef.current) return false;
    ignorarCliqueRef.current = false;
    return true;
  };

  return { aoPressionar, consumirCliqueArrasto };
}

// ===== CARD GRID (estilo PrismLauncher) =====
function CardGrid({
  instance,
  onSelect,
  onAbrirGerenciador,
  onAbrirMenuContexto,
  onIniciarArrasto,
  onMoverArrasto,
  onFinalizarArrasto,
  grupoId,
  sendoArrastada,
  selecionada,
  modoSelecaoMultipla,
  ativa,
  publica,
  agoraSegundos,
}: {
  instance: Instance;
  index: number;
  onSelect: (i: Instance) => void;
  onAbrirGerenciador: (i: Instance) => void;
  onAbrirMenuContexto: (evento: React.MouseEvent, instance: Instance) => void;
  onIniciarArrasto: (id: string) => void;
  onMoverArrasto: (id: string, x: number, y: number) => void;
  onFinalizarArrasto: (id?: string, x?: number, y?: number) => void;
  grupoId: string;
  sendoArrastada: boolean;
  selecionada: boolean;
  modoSelecaoMultipla: boolean;
  ativa: boolean;
  publica: boolean;
  agoraSegundos: number;
}) {
  const tempoExibicaoSegundos = calcularTempoJogadoParaExibicao(
    instance,
    ativa,
    agoraSegundos
  );
  const controleArrasto = useArrastoInstancia({
    instanceId: instance.id,
    onIniciar: onIniciarArrasto,
    onMover: onMoverArrasto,
    onFinalizar: onFinalizarArrasto,
  });

  return (
    <motion.div
      layout="position"
      onPointerDown={controleArrasto.aoPressionar}
      initial={false}
      animate={{ opacity: sendoArrastada ? 0.35 : 1, scale: 1 }}
      transition={{ layout: { duration: 0.18, ease: "easeOut" }, opacity: { duration: 0.1 } }}
      onClick={() => {
        if (!controleArrasto.consumirCliqueArrasto()) onSelect(instance);
      }}
      onDoubleClick={() => {
        if (!modoSelecaoMultipla) onAbrirGerenciador(instance);
      }}
      onContextMenu={(evento) => onAbrirMenuContexto(evento, instance)}
      data-contexto-biblioteca-item
      data-instancia-id={instance.id}
      data-grupo-id={grupoId}
      data-modo-visualizacao="grid"
      className={cn(
        "group relative flex cursor-grab flex-col items-center rounded-xl border p-3 text-center transition-colors",
        "active:cursor-grabbing",
        selecionada
          ? "bg-emerald-500/10 border-emerald-400/30 shadow-realce-selecao"
          : "bg-white/3 hover:bg-white/5 border-white/5 hover:border-white/10"
      )}
    >
      {modoSelecaoMultipla && (
        <span
          className={cn(
            "absolute right-2 top-2 grid h-5 w-5 place-items-center border",
            selecionada
              ? "border-emerald-300 bg-emerald-400 text-[#07120d]"
              : "border-white/20 bg-[#151516] text-transparent"
          )}
        >
          <Check size={12} />
        </span>
      )}
      {/* Ícone grande */}
      <div className="mb-2 h-16 w-16">
        <div className="w-full h-full rounded-xl bg-[#151516] border border-white/10 overflow-hidden">
          <img
            src={instance.icon}
            alt={instance.name}
            draggable={false}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
          />
        </div>

      </div>

      {/* Nome */}
      <div className="flex w-full items-center justify-center gap-1">
        <h3 className="min-w-0 truncate text-xs font-bold">{instance.name}</h3>
        {publica && <span title="Pública para amigos" className="shrink-0 text-emerald-300">
          <Globe size={10} />
        </span>}
      </div>

      {/* Info */}
      <div className="flex items-center gap-1 text-[10px] text-white/25 mt-0.5">
        <Gamepad2 size={9} />
        <span className="truncate">
          {instance.loader_type || instance.mc_type} {instance.version}
        </span>
      </div>
      <div className="flex items-center gap-1 text-[10px] text-white/25 mt-0.5">
        <Clock size={9} />
        <span>{formatarTempoJogadoTotal(tempoExibicaoSegundos)}</span>
      </div>
    </motion.div>
  );
}

// ===== CARD LISTA =====
function CardList({
  instance,
  onSelect,
  onAbrirGerenciador,
  onAbrirMenuContexto,
  onIniciarArrasto,
  onMoverArrasto,
  onFinalizarArrasto,
  grupoId,
  sendoArrastada,
  selecionada,
  modoSelecaoMultipla,
  ativa,
  publica,
  agoraSegundos,
}: {
  instance: Instance;
  index: number;
  onSelect: (i: Instance) => void;
  onAbrirGerenciador: (i: Instance) => void;
  onAbrirMenuContexto: (evento: React.MouseEvent, instance: Instance) => void;
  onIniciarArrasto: (id: string) => void;
  onMoverArrasto: (id: string, x: number, y: number) => void;
  onFinalizarArrasto: (id?: string, x?: number, y?: number) => void;
  grupoId: string;
  sendoArrastada: boolean;
  selecionada: boolean;
  modoSelecaoMultipla: boolean;
  ativa: boolean;
  publica: boolean;
  agoraSegundos: number;
}) {
  const tempoExibicaoSegundos = calcularTempoJogadoParaExibicao(
    instance,
    ativa,
    agoraSegundos
  );
  const controleArrasto = useArrastoInstancia({
    instanceId: instance.id,
    onIniciar: onIniciarArrasto,
    onMover: onMoverArrasto,
    onFinalizar: onFinalizarArrasto,
  });

  return (
    <motion.div
      layout="position"
      onPointerDown={controleArrasto.aoPressionar}
      initial={false}
      animate={{ opacity: sendoArrastada ? 0.35 : 1, x: 0 }}
      transition={{ layout: { duration: 0.18, ease: "easeOut" }, opacity: { duration: 0.1 } }}
      onClick={() => {
        if (!controleArrasto.consumirCliqueArrasto()) onSelect(instance);
      }}
      onDoubleClick={() => {
        if (!modoSelecaoMultipla) onAbrirGerenciador(instance);
      }}
      onContextMenu={(evento) => onAbrirMenuContexto(evento, instance)}
      data-contexto-biblioteca-item
      data-instancia-id={instance.id}
      data-grupo-id={grupoId}
      data-modo-visualizacao="list"
      className={cn(
        "group flex cursor-grab items-center gap-3 rounded-xl border px-3 py-2 transition-colors",
        "active:cursor-grabbing",
        selecionada
          ? "bg-emerald-500/10 border-emerald-400/30 shadow-realce-selecao"
          : "bg-white/2 hover:bg-white/4 border-white/3 hover:border-white/8"
      )}
    >
      {modoSelecaoMultipla && (
        <span
          className={cn(
            "grid h-5 w-5 shrink-0 place-items-center border",
            selecionada
              ? "border-emerald-300 bg-emerald-400 text-[#07120d]"
              : "border-white/20 bg-[#151516] text-transparent"
          )}
        >
          <Check size={12} />
        </span>
      )}
      {/* Ícone */}
      <div className="shrink-0">
        <div className="w-9 h-9 rounded-lg bg-[#151516] border border-white/10 overflow-hidden">
          <img
            src={instance.icon}
            alt={instance.name}
            draggable={false}
            className="w-full h-full object-cover"
          />
        </div>
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <h3 className="min-w-0 truncate text-sm font-bold">{instance.name}</h3>
          {publica && <span title="Pública para amigos" className="shrink-0 text-emerald-300">
            <Globe size={11} />
          </span>}
        </div>
      </div>

      {/* Tags */}
      <span className="text-[10px] px-2 py-0.5 rounded bg-white/5 text-white/30 font-mono shrink-0">
        {instance.version}
      </span>

      <span className="text-[10px] px-2 py-0.5 rounded bg-white/5 text-white/30 shrink-0">
        {instance.loader_type || "Vanilla"}
      </span>

      {/* Tempo jogado */}
      <div className="flex items-center gap-1 text-[10px] text-white/20 shrink-0 w-24 justify-end">
        <Clock size={9} />
        {formatarTempoJogadoTotal(tempoExibicaoSegundos)}
      </div>

    </motion.div>
  );
}
