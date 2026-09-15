import { useEffect, useMemo, useState } from "react";
import {
  ChevronRight,
  Download,
  Gamepad2,
  Globe,
  Loader2,
  MoreHorizontal,
  Play,
  Star,
  Wifi,
  WifiOff,
} from "../iconesPixelados";
import { invoke } from "@tauri-apps/api/core";
import { motion } from "framer-motion";
import type { Instance } from "../hooks/useLauncher";
import type { MinecraftAccount } from "../App";
import { cn } from "../lib/utils";
import type { ProjetoConteudo, TipoProjetoConteudo } from "./ProjetoDetalheModal";
import { obterImagemProjeto } from "../lib/imagemProjeto";
import { NoticiasMinecraft } from "./NoticiasMinecraft";

interface ResultadoBuscaApi {
  project_id: string;
  title: string;
  description: string;
  icon_url: string | null;
  author: string;
  downloads: number;
  follows: number;
  project_type: TipoProjetoConteudo;
  slug: string;
}

interface ResultadoBusca {
  id: string;
  title: string;
  description: string;
  icon_url: string;
  author: string;
  downloads: number;
  follows: number;
  project_type: TipoProjetoConteudo;
  slug: string;
}

interface ServerInfo {
  name: string;
  address: string;
  port: number;
  icon?: string | null;
  motd?: string | null;
  player_count?: string | null;
  playerCount?: string | null;
  ping?: number | null;
}

interface MundoInfo {
  name: string;
  path: string;
  gameMode?: string;
  difficulty?: string;
  lastPlayed?: string;
  sizeOnDisk?: string;
}

interface ServidorDome {
  id: string;
  nome: string;
  endereco: string;
  porta?: number;
  icone?: string;
  aliases?: string[];
}

const SERVIDORES_DOME: ServidorDome[] = [
  {
    id: "emergence",
    nome: "Emergence",
    endereco: "emc.domestudios.com.br",
    porta: 25565,
    icone: "/dome.png",
    aliases: ["emc.domestudios.com"],
  },
];

const EXIBIR_SERVIDORES_DOME = false;

function validarData(data: string): Date | null {
  const dataConvertida = new Date(data);
  if (Number.isNaN(dataConvertida.getTime())) {
    return null;
  }
  return dataConvertida;
}

function formatarNumero(valor: number): string {
  if (valor >= 1_000_000) return `${(valor / 1_000_000).toFixed(1)}M`;
  if (valor >= 1_000) return `${(valor / 1_000).toFixed(1)}K`;
  return valor.toString();
}

function tempoRelativo(data: string): string {
  const dataBase = validarData(data);
  if (!dataBase) return "data indisponível";

  const agora = Date.now();
  const diff = agora - dataBase.getTime();
  const minutos = Math.floor(diff / 60000);
  if (minutos < 1) return "agora";
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas}h`;
  const dias = Math.floor(horas / 24);
  if (dias === 1) return "há 1 dia";
  if (dias < 7) return `há ${dias} dias`;
  const semanas = Math.floor(dias / 7);
  if (semanas === 1) return "há 1 semana";
  if (semanas < 5) return `há ${semanas} semanas`;
  return new Date(data).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
  });
}

function obterContagemJogadores(servidor: ServerInfo): string | undefined {
  return servidor.player_count ?? servidor.playerCount ?? undefined;
}

function normalizarEndereco(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, "");
}

function obterEnderecosDome(servidor: ServidorDome): string[] {
  return [servidor.endereco, ...(servidor.aliases ?? [])].map(normalizarEndereco);
}

async function pingServidorComTimeout(
  address: string,
  timeoutMs = 7000
): Promise<ServerInfo> {
  return new Promise((resolve, reject) => {
    const temporizador = window.setTimeout(() => {
      reject(new Error("Tempo esgotado ao verificar servidor"));
    }, timeoutMs);

    invoke<ServerInfo>("ping_server", { address })
      .then((resposta) => {
        window.clearTimeout(temporizador);
        resolve(resposta);
      })
      .catch((erro) => {
        window.clearTimeout(temporizador);
        reject(erro);
      });
  });
}

interface HomePageProps {
  user: MinecraftAccount | null;
  instances: Instance[];
  instanciaAtivaId: string | null;
  onSelectInstance: (instance: Instance) => void;
  onLaunch: (id: string) => void;
  onLaunchServer: (id: string, address: string) => void;
  onLogin: () => void;
  onExplore: () => void;
  onAbrirProjeto: (projeto: ProjetoConteudo) => void;
}

export default function HomePage({
  user,
  instances,
  instanciaAtivaId,
  onSelectInstance,
  onLaunch,
  onLaunchServer,
  onLogin,
  onExplore,
  onAbrirProjeto,
}: HomePageProps) {
  const [modpacks, setModpacks] = useState<ResultadoBusca[]>([]);
  const [mods, setMods] = useState<ResultadoBusca[]>([]);
  const [carregando, setCarregando] = useState(true);
  const instanciasRecentes = useMemo(
    () =>
      instances
        .filter((instancia) => instancia.last_played)
        .sort(
          (a, b) =>
            new Date(b.last_played!).getTime() -
            new Date(a.last_played!).getTime()
        )
        .slice(0, 6),
    [instances]
  );

  useEffect(() => {
    const buscar = async () => {
      setCarregando(true);
      try {
        const [respostaModpacks, respostaMods] = await Promise.all([
          fetch(
            'https://api.modrinth.com/v2/search?facets=[["project_type:modpack"]]&limit=6&index=follows'
          ),
          fetch(
            'https://api.modrinth.com/v2/search?facets=[["project_type:mod"]]&limit=6&index=follows'
          ),
        ]);

        const dadosModpacks = (await respostaModpacks.json()) as { hits: ResultadoBuscaApi[] };
        const dadosMods = (await respostaMods.json()) as { hits: ResultadoBuscaApi[] };

        const mapearResultados = (hits: ResultadoBuscaApi[]): ResultadoBusca[] =>
          hits.map((item) => ({
            id: item.project_id,
            title: item.title,
            description: item.description,
            icon_url: item.icon_url ?? "",
            author: item.author,
            downloads: item.downloads,
            follows: item.follows,
            project_type: item.project_type,
            slug: item.slug,
          }));

        setModpacks(mapearResultados(dadosModpacks.hits ?? []));
        setMods(mapearResultados(dadosMods.hits ?? []));
      } catch (erro) {
        console.error("Erro ao buscar conteúdo da Home:", erro);
      } finally {
        setCarregando(false);
      }
    };

    buscar();
  }, []);

  return (
    <div className="home-dome-figma space-y-8">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between gap-3"
      >
        <h1 className="font-['MinecraftTen','Sora',sans-serif] text-[30px] leading-[36px] tracking-[0.6px] text-white">
          {user ? `Bem vindo de volta, ${user.name}!` : "Bem vindo ao Dome Launcher!"}
        </h1>
      </motion.div>

      {instanciasRecentes.length > 0 && (
        <SecaoVolteAJogar
          instances={instanciasRecentes}
          instanciaAtivaId={instanciaAtivaId}
          onSelectInstance={onSelectInstance}
          onLaunch={onLaunch}
          onLaunchServer={onLaunchServer}
          onLogin={onLogin}
          user={user}
        />
      )}

      {EXIBIR_SERVIDORES_DOME && (
        <SecaoServidoresDome
          instances={instances}
          instanciaAtivaId={instanciaAtivaId}
          user={user}
          onLogin={onLogin}
          onLaunchServer={onLaunchServer}
          onSelectInstance={onSelectInstance}
        />
      )}

      <SecaoDestaque
        titulo="Conheça modpacks"
        itens={modpacks}
        carregando={carregando}
        delay={0.06}
        onVerMais={onExplore}
        onAbrirProjeto={(item) => onAbrirProjeto({ ...item, source: "modrinth" })}
      />

      <SecaoDestaque
        titulo="Descubra mods"
        itens={mods}
        carregando={carregando}
        delay={0.1}
        onVerMais={onExplore}
        onAbrirProjeto={(item) => onAbrirProjeto({ ...item, source: "modrinth" })}
      />

      <NoticiasMinecraft />
    </div>
  );
}

function CabecalhoSecao({
  titulo,
  onVerMais,
}: {
  titulo: string;
  onVerMais?: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="font-['MinecraftTen','Sora',sans-serif] text-[14px] uppercase tracking-[0.28px] text-white/80">
        {titulo}
      </h2>

      {onVerMais && (
        <button
          onClick={onVerMais}
          className="flex items-center gap-1 text-[13px] text-white/65 transition-colors hover:text-white/90"
        >
          Ver mais
          <ChevronRight size={12} />
        </button>
      )}
    </div>
  );
}

function SecaoServidoresDome({
  instances,
  instanciaAtivaId,
  user,
  onLogin,
  onLaunchServer,
  onSelectInstance,
}: {
  instances: Instance[];
  instanciaAtivaId: string | null;
  user: MinecraftAccount | null;
  onLogin: () => void;
  onLaunchServer: (id: string, address: string) => void;
  onSelectInstance: (instance: Instance) => void;
}) {
  const [idsServidoresOcultos, setIdsServidoresOcultos] = useState<string[]>([]);
  const [statusServidores, setStatusServidores] = useState<
    Record<
      string,
      {
        online: boolean;
        ping?: number;
        jogadores?: string;
        motd?: string;
        icon?: string | null;
      }
    >
  >({});

  const instanciaSelecionada =
    instances.find((instancia) => instancia.id === instanciaAtivaId) ?? instances[0] ?? null;

  const servidoresVisiveis = useMemo(() => {
    const ocultos = new Set(idsServidoresOcultos);
    return SERVIDORES_DOME.filter((servidor) => !ocultos.has(servidor.id));
  }, [idsServidoresOcultos]);

  useEffect(() => {
    let cancelado = false;

    const mapearServidoresJaSalvos = async () => {
      const idsEncontrados = new Set<string>();

      await Promise.all(
        instances.map(async (instancia) => {
          try {
            const servidores = await invoke<ServerInfo[]>("get_servers", {
              instanceId: instancia.id,
            });

            for (const servidorSalvo of servidores) {
              const enderecoSalvo = normalizarEndereco(servidorSalvo.address);
              for (const servidorDome of SERVIDORES_DOME) {
                if (obterEnderecosDome(servidorDome).includes(enderecoSalvo)) {
                  idsEncontrados.add(servidorDome.id);
                }
              }
            }
          } catch {
            // Ignora instâncias com erro de leitura.
          }
        })
      );

      if (!cancelado) {
        setIdsServidoresOcultos(Array.from(idsEncontrados));
      }
    };

    if (instances.length > 0) {
      mapearServidoresJaSalvos();
      return () => {
        cancelado = true;
      };
    }

    setIdsServidoresOcultos([]);
    return () => {
      cancelado = true;
    };
  }, [instances]);

  useEffect(() => {
    let cancelado = false;

    const verificarStatus = async () => {
      await Promise.all(
        servidoresVisiveis.map(async (servidor) => {
          const destino =
            servidor.porta && servidor.porta !== 25565
              ? `${servidor.endereco}:${servidor.porta}`
              : servidor.endereco;

          try {
            const resposta = await pingServidorComTimeout(destino);
            if (cancelado) return;

            setStatusServidores((anterior) => ({
              ...anterior,
              [servidor.id]: {
                online: true,
                ping: resposta.ping ?? undefined,
                jogadores: obterContagemJogadores(resposta),
                motd: resposta.motd ?? undefined,
                icon: resposta.icon ?? servidor.icone ?? null,
              },
            }));
          } catch {
            if (cancelado) return;

            setStatusServidores((anterior) => ({
              ...anterior,
              [servidor.id]: {
                online: false,
                icon: servidor.icone ?? null,
              },
            }));
          }
        })
      );
    };

    if (servidoresVisiveis.length === 0) return;

    verificarStatus();
    const intervalo = window.setInterval(verificarStatus, 30_000);

    return () => {
      cancelado = true;
      window.clearInterval(intervalo);
    };
  }, [servidoresVisiveis]);

  if (servidoresVisiveis.length === 0) {
    return null;
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.03 }}
      className="space-y-3"
    >
      <CabecalhoSecao titulo="Conheça a Dome Studios" />

      <div className="grid grid-cols-1 gap-3 xl:max-w-[680px]">
        {servidoresVisiveis.map((servidor) => {
          const status = statusServidores[servidor.id];
          const destino =
            servidor.porta && servidor.porta !== 25565
              ? `${servidor.endereco}:${servidor.porta}`
              : servidor.endereco;

          const statusOnline = status?.online ?? false;

          return (
            <article
              key={servidor.id}
              className="border border-white/10 bg-[rgba(255,255,255,0.03)] p-[13px]"
            >
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 overflow-hidden bg-black/30">
                  <img
                    src={status?.icon || servidor.icone || "/dome.svg"}
                    alt={servidor.nome}
                    className="h-full w-full object-cover"
                  />
                </div>

                <div className="min-w-0 flex-1">
                  <p className="font-['MinecraftTen','Sora',sans-serif] text-[14px] tracking-[0.28px] text-white">
                    {servidor.nome}
                  </p>
                  <p className="font-['MinecraftSeven','Sora',sans-serif] text-[12px] text-white/70">
                    {destino}
                  </p>
                </div>

                <button
                  onClick={() => {
                    if (!user) {
                      onLogin();
                      return;
                    }

                    if (!instanciaSelecionada) return;
                    onSelectInstance(instanciaSelecionada);
                    onLaunchServer(instanciaSelecionada.id, destino);
                  }}
                  disabled={Boolean(user) && !instanciaSelecionada}
                  className={cn(
                    "border px-3 py-1 font-['MinecraftTen','Sora',sans-serif] text-[12px] uppercase tracking-[0.3px] transition-colors",
                    !user || instanciaSelecionada
                      ? "border-white/20 bg-[#303030] text-[#c0c0c0] hover:bg-[#3a3a3a]"
                      : "cursor-not-allowed border-white/10 bg-[#232323] text-white/35"
                  )}
                >
                  {!user ? "login" : "jogar"}
                </button>
              </div>

              <div className="mt-[9px] border-t border-white/10 pt-[9px]">
                <div className="flex flex-wrap items-center gap-3 font-['MinecraftSeven','Sora',sans-serif] text-[11px] text-white/65">
                  <span className="flex items-center gap-1">
                    {status ? (
                      statusOnline ? (
                        <Wifi size={9} />
                      ) : (
                        <WifiOff size={9} />
                      )
                    ) : (
                      <Loader2 size={9} className="animate-spin" />
                    )}
                    {status?.jogadores ?? "--/--"}
                  </span>
                  <span className="h-[6px] w-[6px] rounded-full bg-emerald-400/80" />
                  <span>{status?.ping != null ? `${status.ping}ms` : "-- ms"}</span>
                  {instanciaSelecionada ? (
                    <span className="truncate">Instância: {instanciaSelecionada.name}</span>
                  ) : (
                    <span className="text-amber-200/80">Crie uma instância para jogar</span>
                  )}
                </div>

                {status?.motd && (
                  <p className="mt-1 truncate font-['MinecraftSeven','Sora',sans-serif] text-[11px] text-white/45">
                    {status.motd}
                  </p>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </motion.section>
  );
}

function SecaoVolteAJogar({
  instances,
  instanciaAtivaId,
  onSelectInstance,
  onLaunch,
  onLaunchServer,
  onLogin,
  user,
}: {
  instances: Instance[];
  instanciaAtivaId: string | null;
  onSelectInstance: (instance: Instance) => void;
  onLaunch: (id: string) => void;
  onLaunchServer: (id: string, address: string) => void;
  onLogin: () => void;
  user: MinecraftAccount | null;
}) {
  type ItemVolteAJogar =
    | { tipo: "instancia"; instancia: Instance }
    | { tipo: "mundo"; instancia: Instance; mundo: MundoInfo }
    | { tipo: "servidor"; instancia: Instance; servidor: ServerInfo };

  const [itensVolteAJogar, setItensVolteAJogar] = useState<ItemVolteAJogar[]>(
    []
  );
  const [statusServidores, setStatusServidores] = useState<
    Record<string, { online: boolean; erro?: string; ping?: number; icon?: string | null }>
  >({});

  const chaveServidor = (instanciaId: string, servidor: ServerInfo) =>
    `${instanciaId}:${servidor.address}:${servidor.port}`;

  useEffect(() => {
    let cancelado = false;

    const carregarItens = async () => {
      const gruposPorInstancia = await Promise.all(
        instances.map(async (instancia) => {
          let servidores: ServerInfo[] = [];
          let mundos: MundoInfo[] = [];

          try {
            servidores = await invoke<ServerInfo[]>("get_servers", {
              instanceId: instancia.id,
            });
          } catch {
            // Ignorar erro de leitura de servidores.
          }

          try {
            mundos = await invoke<MundoInfo[]>("get_worlds", {
              instanceId: instancia.id,
            });
          } catch {
            // Ignorar erro de leitura de mundos.
          }

          const itensDaInstancia: ItemVolteAJogar[] = [];

          if (servidores.length > 0) {
            itensDaInstancia.push({
              tipo: "servidor",
              instancia,
              servidor: servidores[0],
            });
          }

          if (mundos.length > 0) {
            itensDaInstancia.push({
              tipo: "mundo",
              instancia,
              mundo: mundos[0],
            });
          }

          if (itensDaInstancia.length === 0) {
            itensDaInstancia.push({ tipo: "instancia", instancia });
          }

          return itensDaInstancia;
        })
      );

      const itens = gruposPorInstancia.flat();
      const itensPrioritarios = itens.filter((item) => item.tipo !== "instancia");
      const itensFallback = itens.filter((item) => item.tipo === "instancia");
      const itensOrdenados = [...itensPrioritarios, ...itensFallback];

      if (!cancelado) {
        setItensVolteAJogar(itensOrdenados.slice(0, 6));
      }
    };

    carregarItens();

    return () => {
      cancelado = true;
    };
  }, [instances]);

  useEffect(() => {
    let cancelado = false;

    const verificarServidores = async () => {
      const itensServidor = itensVolteAJogar.filter(
        (item): item is Extract<ItemVolteAJogar, { tipo: "servidor" }> =>
          item.tipo === "servidor"
      );

      await Promise.all(
        itensServidor.map(async (item) => {
          const chave = chaveServidor(item.instancia.id, item.servidor);
          const destino =
            item.servidor.port && item.servidor.port !== 25565
              ? `${item.servidor.address}:${item.servidor.port}`
              : item.servidor.address;

          try {
            const ping = await pingServidorComTimeout(destino);
            if (cancelado) return;

            setStatusServidores((anterior) => ({
              ...anterior,
              [chave]: {
                online: true,
                ping: ping.ping ?? undefined,
                icon: ping.icon ?? item.servidor.icon ?? undefined,
              },
            }));
          } catch {
            if (cancelado) return;

            setStatusServidores((anterior) => ({
              ...anterior,
              [chave]: {
                online: false,
                erro: "Não foi possível se conectar ao servidor",
                icon: item.servidor.icon ?? undefined,
              },
            }));
          }
        })
      );
    };

    if (itensVolteAJogar.length > 0) {
      verificarServidores();
    }

    return () => {
      cancelado = true;
    };
  }, [itensVolteAJogar]);

  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.02 }}
      className="space-y-3"
    >
      <CabecalhoSecao titulo="Volte a jogar" />

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {itensVolteAJogar.map((item, indice) => {
          const instancia = item.instancia;
          const instanciaAtiva = instancia.id === instanciaAtivaId;
          const status =
            item.tipo === "servidor"
              ? statusServidores[chaveServidor(instancia.id, item.servidor)]
              : undefined;

          const chaveItem =
            item.tipo === "instancia"
              ? `instancia-${instancia.id}`
              : item.tipo === "mundo"
                ? `mundo-${instancia.id}-${item.mundo.path}`
                : `servidor-${instancia.id}-${item.servidor.address}-${item.servidor.port}`;

          return (
            <motion.article
              key={chaveItem}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.04 + indice * 0.03 }}
              onClick={() => onSelectInstance(instancia)}
              className={cn(
                "cursor-pointer border p-[13px] transition-colors",
                instanciaAtiva
                  ? "border-emerald-400/35 bg-emerald-500/8"
                  : "border-white/10 bg-[rgba(255,255,255,0.03)] hover:border-white/20"
              )}
            >
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 overflow-hidden bg-black/30">
                  <img
                    src={
                      item.tipo === "servidor"
                        ? status?.icon || item.servidor.icon || instancia.icon || "/dome.svg"
                        : instancia.icon || "/dome.svg"
                    }
                    alt={
                      item.tipo === "servidor"
                        ? item.servidor.name
                        : item.tipo === "mundo"
                          ? item.mundo.name
                          : instancia.name
                    }
                    className="h-full w-full object-cover"
                  />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="mb-[1px] flex items-center gap-2">
                    <p className="truncate font-['MinecraftTen','Sora',sans-serif] text-[14px] tracking-[0.28px] text-white">
                      {item.tipo === "instancia"
                        ? instancia.name
                        : item.tipo === "mundo"
                          ? item.mundo.name
                          : item.servidor.name}
                    </p>

                    {item.tipo === "mundo" && (
                      <span className="flex items-center gap-1 text-[11px] text-blue-300/95">
                        <Globe size={9} />
                        Mundo
                      </span>
                    )}

                    {item.tipo === "servidor" && (
                      <span
                        className={cn(
                          "flex items-center gap-1 text-[11px]",
                          status?.online ? "text-emerald-300/95" : "text-white/65"
                        )}
                      >
                        {status?.online ? <Wifi size={9} /> : <WifiOff size={9} />}
                        {status ? (status.online ? "Online" : "Offline") : "Verificando"}
                      </span>
                    )}
                  </div>

                  {item.tipo === "instancia" && (
                    <p className="truncate font-['MinecraftSeven','Sora',sans-serif] text-[12px] text-white/65">
                      {instancia.last_played
                        ? `Jogou ${tempoRelativo(instancia.last_played)}`
                        : "Instância local"}
                      {" • "}
                      {instancia.loader_type || instancia.mc_type} {instancia.version}
                    </p>
                  )}

                  {item.tipo === "mundo" && (
                    <p className="truncate font-['MinecraftSeven','Sora',sans-serif] text-[12px] text-white/65">
                      Mundo local na instância {instancia.name}
                      {instancia.last_played ? ` • ${tempoRelativo(instancia.last_played)}` : ""}
                    </p>
                  )}

                  {item.tipo === "servidor" && (
                    <p className="truncate font-['MinecraftSeven','Sora',sans-serif] text-[12px] text-white/65">
                      {item.servidor.address}
                      {item.servidor.port && item.servidor.port !== 25565
                        ? `:${item.servidor.port}`
                        : ""}
                      {" • "}
                      na instância {instancia.name}
                      {status?.ping != null ? ` • ${status.ping}ms` : ""}
                    </p>
                  )}
                </div>

                <button
                  onClick={(evento) => {
                    evento.stopPropagation();
                    if (!user) {
                      onLogin();
                      return;
                    }

                    if (item.tipo === "instancia" || item.tipo === "mundo") {
                      onLaunch(instancia.id);
                      return;
                    }

                    const destino =
                      item.servidor.port && item.servidor.port !== 25565
                        ? `${item.servidor.address}:${item.servidor.port}`
                        : item.servidor.address;
                    onLaunchServer(instancia.id, destino);
                  }}
                  className="border border-white/15 bg-[#2d2d2d] px-4 py-1.5 font-['MinecraftTen','Sora',sans-serif] text-[12px] tracking-[0.28px] text-white/85 transition-colors hover:bg-[#393939]"
                >
                  {item.tipo === "servidor" ? "Abrir" : "Jogar"}
                </button>

                <button
                  onClick={(evento) => {
                    evento.stopPropagation();
                    onSelectInstance(instancia);
                  }}
                  className="text-white/35 transition-colors hover:text-white/70"
                  title="Abrir detalhes da instância"
                >
                  <MoreHorizontal size={14} />
                </button>
              </div>

              {item.tipo === "servidor" && !status?.online && status?.erro && (
                <p className="mt-2 truncate font-['MinecraftSeven','Sora',sans-serif] text-[11px] text-red-300/70">
                  {status.erro}
                </p>
              )}
            </motion.article>
          );
        })}
      </div>
    </motion.section>
  );
}

function SecaoDestaque({
  titulo,
  itens,
  carregando,
  delay,
  onVerMais,
  onAbrirProjeto,
}: {
  titulo: string;
  itens: ResultadoBusca[];
  carregando: boolean;
  delay: number;
  onVerMais: () => void;
  onAbrirProjeto: (item: ResultadoBusca) => void;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="space-y-3"
    >
      <CabecalhoSecao titulo={titulo} onVerMais={onVerMais} />

      {carregando ? (
        <div className="flex items-center gap-2 py-5 text-white/65">
          <Loader2 size={14} className="animate-spin" />
          <span className="font-['MinecraftSeven','Sora',sans-serif] text-[12px]">
            Carregando...
          </span>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {itens.slice(0, 3).map((item) => (
            <article
              key={item.id}
              onClick={() => onAbrirProjeto(item)}
              className="cursor-pointer border border-white/10 bg-[rgba(255,255,255,0.03)] p-[13px] transition-colors hover:border-white/20"
            >
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 overflow-hidden bg-black/30">
                  <img
                    src={obterImagemProjeto(item.icon_url, item.project_type, item.id)}
                    alt={item.title}
                    className="h-full w-full object-cover"
                  />
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate font-['MinecraftTen','Sora',sans-serif] text-[14px] tracking-[0.28px] text-white">
                    {item.title}
                  </p>
                  <span className="flex items-center gap-1 font-['MinecraftSeven','Sora',sans-serif] text-[12px] text-white/70">
                    <Gamepad2 size={10} />
                    {item.author}
                  </span>
                </div>
              </div>

              <div className="mt-[9px] border-t border-white/10 pt-[9px]">
                <div className="flex items-center gap-3 font-['MinecraftSeven','Sora',sans-serif] text-[11px] text-white/65">
                  <span className="flex items-center gap-1">
                    <Download size={9} />
                    {formatarNumero(item.downloads)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Star size={9} />
                    {formatarNumero(item.follows)}
                  </span>
                  <span className="ml-auto flex items-center gap-1 text-white/70">
                    <Play size={9} fill="currentColor" />
                    Abrir
                  </span>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </motion.section>
  );
}
