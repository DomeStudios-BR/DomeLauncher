import { lazy, Suspense, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  Globe,
  Loader2,
  MoreHorizontal,
  Trash2,
  Wifi,
  WifiOff,
} from "../iconesPixelados";
import { invoke } from "@tauri-apps/api/core";
import { motion } from "framer-motion";
import type { Instance } from "../hooks/useLauncher";
import type { MinecraftAccount } from "../App";
import { cn } from "../lib/utils";
import { MotdMinecraft } from "./MotdMinecraft";
import { reconciliarLista } from "../lib/reconciliarLista";

const NoticiasMinecraft = lazy(() =>
  import("./NoticiasMinecraft").then((modulo) => ({ default: modulo.NoticiasMinecraft }))
);

interface ServerInfo {
  name: string;
  address: string;
  port: number;
  icon?: string | null;
  motd?: string | null;
  motdComponentes?: unknown;
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

interface OcultacaoVolteAJogar {
    chave: string;
    ultimaPartida: string;
}

function carregarOcultacoesVolteAJogar(): OcultacaoVolteAJogar[] {
    try {
        const salvos: unknown = JSON.parse(localStorage.getItem("dome:volte-a-jogar:ocultos") || "[]");
        if (!Array.isArray(salvos)) return [];

        return salvos.filter((item: unknown): item is OcultacaoVolteAJogar =>
            typeof item === "object" && item !== null
            && "chave" in item && typeof item.chave === "string"
            && "ultimaPartida" in item && typeof item.ultimaPartida === "string");
    } catch {
        return [];
    }
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
    icone: "/dome-launcher.ico",
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

function descreverErroServidor(erro: unknown): string {
  if (typeof erro === "string" && erro.trim()) return erro;
  if (erro instanceof Error && erro.message.trim()) return erro.message;
  return "Não foi possível se conectar ao servidor";
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
  biblioteca: ReactNode;
}

export default function HomePage({
  user,
  instances,
  instanciaAtivaId,
  onSelectInstance,
  onLaunch,
  onLaunchServer,
  onLogin,
  biblioteca,
}: HomePageProps) {
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

  return (
    <div className="home-dome-figma space-y-8">
      <motion.div
        initial={false}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between gap-3"
      >
        <h1 className="font-['MinecraftTen','Sora',sans-serif] text-[30px] leading-[36px] tracking-[0.6px] text-white">
          {user ? `Bem vindo de volta, ${user.name}!` : "Bem vindo ao Dome Launcher!"}
        </h1>
      </motion.div>

      <Suspense fallback={
        <div className="space-y-3" aria-label="Carregando notícias">
          <div className="h-4 w-28 animate-pulse bg-white/[0.06]" />
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="h-36 animate-pulse border border-white/10 bg-white/[0.025]" />
            <div className="hidden h-36 animate-pulse border border-white/10 bg-white/[0.025] lg:block" />
          </div>
        </div>
      }>
        <NoticiasMinecraft />
      </Suspense>

      {instanciasRecentes.length > 0 && (
        <SecaoVolteAJogar
          instances={instanciasRecentes}
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

      <motion.section
        initial={false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="min-h-[calc(100vh-100px)] space-y-3"
      >
        <CabecalhoSecao titulo="Biblioteca" />
        {biblioteca}
      </motion.section>
    </div>
  );
}

function CabecalhoSecao({
  titulo,
}: {
  titulo: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="font-['MinecraftTen','Sora',sans-serif] text-[14px] uppercase tracking-[0.28px] text-white/80">
        {titulo}
      </h2>

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
          } catch (erro) {
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
                    src={status?.icon || servidor.icone || "/dome-launcher.ico"}
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
  onSelectInstance,
  onLaunch,
  onLaunchServer,
  onLogin,
  user,
}: {
  instances: Instance[];
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

  const chaveItemVolteAJogar = (item: ItemVolteAJogar) => item.tipo === "instancia"
    ? `instancia-${item.instancia.id}`
    : item.tipo === "mundo"
      ? `mundo-${item.instancia.id}-${item.mundo.path}`
      : `servidor-${item.instancia.id}-${item.servidor.address}-${item.servidor.port}`;

  const [itensDisponiveis, setItensDisponiveis] = useState<ItemVolteAJogar[]>(
    []
  );
  const itensAtuais = useRef<ItemVolteAJogar[]>([]);
  const [menuItemAberto, setMenuItemAberto] = useState<string | null>(null);
  const [itensOcultos, setItensOcultos] = useState<OcultacaoVolteAJogar[]>(carregarOcultacoesVolteAJogar);
  const [statusServidores, setStatusServidores] = useState<
    Record<
      string,
      {
        online: boolean;
        erro?: string;
        ping?: number;
        jogadores?: string;
        motd?: string;
        motdComponentes?: unknown;
        icon?: string | null;
      }
    >
  >({});

  const chaveServidor = (instanciaId: string, servidor: ServerInfo) =>
    `${instanciaId}:${servidor.address}:${servidor.port}`;

  const itensVolteAJogar = useMemo(() => itensDisponiveis.filter((item) => !itensOcultos.some((ocultacao) =>
    ocultacao.chave === chaveItemVolteAJogar(item)
      && ocultacao.ultimaPartida === item.instancia.last_played
  )).slice(0, 6), [itensDisponiveis, itensOcultos]);

  useEffect(() => {
    try {
      localStorage.setItem("dome:volte-a-jogar:ocultos", JSON.stringify(itensOcultos));
    } catch (erro) {
      console.warn("Não foi possível salvar os cartões removidos de Volte a jogar:", erro);
    }
  }, [itensOcultos]);

  useEffect(() => {
    let cancelado = false;
    let consultaAtual = 0;

    const carregarItens = async () => {
      const consulta = ++consultaAtual;
      const gruposPorInstancia = await Promise.all(
        instances.map(async (instancia) => {
          const anteriores = itensAtuais.current.filter((item) => item.instancia.id === instancia.id);
          const [leituraServidores, leituraMundos] = await Promise.allSettled([
            invoke<ServerInfo[]>("get_servers", { instanceId: instancia.id }),
            invoke<MundoInfo[]>("get_worlds", { instanceId: instancia.id }),
          ]);
          const servidores = leituraServidores.status === "fulfilled" ? leituraServidores.value
            : anteriores.flatMap((item) => item.tipo === "servidor" ? [item.servidor] : []);
          const mundos = leituraMundos.status === "fulfilled" ? leituraMundos.value
            : anteriores.flatMap((item) => item.tipo === "mundo" ? [item.mundo] : []);

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

      if (!cancelado && consulta === consultaAtual) {
        itensAtuais.current = reconciliarLista(itensAtuais.current, itensOrdenados, chaveItemVolteAJogar);
        setItensDisponiveis(itensAtuais.current);
      }
    };

    const atualizarAoRetornar = () => {
      if (document.visibilityState === "visible") void carregarItens();
    };

    void carregarItens();
    window.addEventListener("focus", atualizarAoRetornar);
    document.addEventListener("visibilitychange", atualizarAoRetornar);

    return () => {
      cancelado = true;
      window.removeEventListener("focus", atualizarAoRetornar);
      document.removeEventListener("visibilitychange", atualizarAoRetornar);
    };
  }, [instances]);

  const removerDeVolteAJogar = (item: ItemVolteAJogar) => {
    const chave = chaveItemVolteAJogar(item);
    setItensOcultos((anteriores) => [
      ...anteriores.filter((ocultacao) => ocultacao.chave !== chave),
      { chave, ultimaPartida: item.instancia.last_played ?? "" },
    ]);
    setMenuItemAberto(null);
  };

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
                jogadores: obterContagemJogadores(ping),
                motd: ping.motd ?? undefined,
                motdComponentes: ping.motdComponentes,
                icon: ping.icon ?? item.servidor.icon ?? undefined,
              },
            }));
          } catch (erro) {
            if (cancelado) return;

            setStatusServidores((anterior) => ({
              ...anterior,
              [chave]: {
                online: false,
                erro: descreverErroServidor(erro),
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

    const intervalo = window.setInterval(verificarServidores, 30_000);

    return () => {
      cancelado = true;
      window.clearInterval(intervalo);
    };
  }, [itensVolteAJogar]);

  return (
    <motion.section
      initial={false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.06 }}
      className="space-y-3"
    >
      <CabecalhoSecao titulo="Volte a jogar" />

      <div className="grid grid-cols-1 items-stretch gap-3 xl:grid-cols-2">
        {itensVolteAJogar.map((item, indice) => {
          const instancia = item.instancia;
          const status =
            item.tipo === "servidor"
              ? statusServidores[chaveServidor(instancia.id, item.servidor)]
              : undefined;

          const chaveItem = chaveItemVolteAJogar(item);

          return (
            <motion.article
              key={chaveItem}
              initial={false}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.04 + indice * 0.03 }}
              onClick={() => onSelectInstance(instancia)}
              className={cn(
                "flex cursor-pointer flex-col border border-white/10 p-[13px] transition-colors",
                "bg-[rgba(255,255,255,0.03)] hover:border-white/20 hover:bg-white/5"
              )}
            >
              <div className="flex w-full flex-1 items-center gap-3">
                <div className="h-10 w-10 shrink-0 overflow-hidden bg-black/30">
                  <img
                    src={
                      item.tipo === "servidor"
                        ? status?.icon || item.servidor.icon || instancia.icon || "/dome-launcher.ico"
                        : instancia.icon || "/dome-launcher.ico"
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
                    </p>
                  )}

                  {item.tipo === "mundo" && (
                    <p className="truncate font-['MinecraftSeven','Sora',sans-serif] text-[12px] text-white/65">
                      {instancia.last_played ? tempoRelativo(instancia.last_played) : "Mundo local"}
                    </p>
                  )}

                  {item.tipo === "servidor" && (
                    <div
                      className="min-w-0"
                      title={`${item.servidor.address}:${item.servidor.port || 25565} · ${instancia.name}`}
                    >
                      <MotdMinecraft
                        valor={status?.motdComponentes ?? status?.motd ?? item.servidor.motd ?? ""}
                        className={cn(
                          "line-clamp-2 font-['MinecraftSeven','Sora',sans-serif]",
                          "text-[11px] leading-4 text-white/80"
                        )}
                      />
                    </div>
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
                  className={cn(
                    "border border-white/15 bg-[#2d2d2d] px-4 py-1.5 text-white/85",
                    "transition-colors hover:bg-[#393939]"
                  )}
                >
                  <span className="font-['MinecraftTen','Sora',sans-serif] text-[14px] tracking-[0.28px]">
                    Jogar
                  </span>
                </button>

                <div className="relative">
                  <button
                    type="button"
                    onClick={(evento) => {
                      evento.stopPropagation();
                      setMenuItemAberto((atual) => atual === chaveItem ? null : chaveItem);
                    }}
                    className="p-1 text-white/35 transition-colors hover:bg-white/5 hover:text-white/70"
                    title="Mais opções"
                    aria-expanded={menuItemAberto === chaveItem}
                  >
                    <MoreHorizontal size={14} />
                  </button>
                  {menuItemAberto === chaveItem && (
                    <div
                      className="absolute right-0 top-full z-30 mt-2 w-52 border border-white/12 bg-[#171717] p-1 shadow-2xl"
                      onClick={(evento) => evento.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => removerDeVolteAJogar(item)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-white/70 transition-colors hover:bg-red-400/10 hover:text-red-300"
                      >
                        <Trash2 size={13} />
                        Remover de Volte a jogar
                      </button>
                    </div>
                  )}
                </div>
              </div>
              {(item.tipo !== "servidor" || status?.online) && (
                <div className={cn(
                  "mt-[9px] flex items-center gap-3 border-t border-white/10 pt-[9px]",
                  "font-['MinecraftSeven','Sora',sans-serif] text-[11px] text-white/65"
                )}>
                  {item.tipo === "servidor" ? (
                    <>
                      <span className="flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                        {status?.jogadores ?? "--/--"} jogadores
                      </span>
                      {status?.ping != null && <span className="text-white/40">{status.ping}ms</span>}
                    </>
                  ) : (
                    <>
                      <span className="min-w-0 truncate">
                        {item.tipo === "mundo"
                          ? `Instância ${instancia.name}`
                          : instancia.loader_type || instancia.mc_type}
                      </span>
                      <span className="shrink-0 text-white/40">{instancia.version}</span>
                    </>
                  )}
                </div>
              )}
              {item.tipo === "servidor" && status?.erro && (
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
