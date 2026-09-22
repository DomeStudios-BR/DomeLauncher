import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { gerarIconeAleatorio } from "../components/editor-icone/EditorIconeModal";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { EVENTO_INSTANCIAS_ATUALIZADAS } from "../lib/eventosTransferenciaSocial";

export interface Instance {
  id: string;
  name: string;
  version: string;
  mc_type: string;
  loader_type?: string;
  icon?: string;
  last_played?: string;
  tempo_total_jogado_segundos?: number;
  sessao_iniciada_em?: string;
  path: string;
}

export interface MinecraftAccount {
  uuid: string;
  name: string;
  access_token: string;
}

interface ConfiguracoesGlobais {
  close_on_launch?: boolean;
}

const migracoesIconesEmAndamento = new Set<string>();

function usaGeradorAntigo(icone: string | null | undefined): boolean {
  return Boolean(icone?.toLowerCase().includes("api.dicebear.com"));
}

function normalizarIconeLegado(icone: string | null | undefined): string | undefined {
  if (icone === "/dome.png" || icone === "/dome.svg") {
    return "/dome-launcher.ico";
  }
  return icone ?? undefined;
}

async function migrarIconesDoGeradorAntigo(instancias: Instance[]): Promise<Instance[]> {
  return Promise.all(instancias.map(async (instancia) => {
    if (!usaGeradorAntigo(instancia.icon) || migracoesIconesEmAndamento.has(instancia.id)) {
      return instancia;
    }

    migracoesIconesEmAndamento.add(instancia.id);
    try {
      const icon = await gerarIconeAleatorio();
      await invoke("update_instance_icon", { instanceId: instancia.id, icon });
      return { ...instancia, icon };
    } catch (erro) {
      console.error(`Falha ao migrar o ícone antigo da instância ${instancia.id}:`, erro);
      return instancia;
    } finally {
      migracoesIconesEmAndamento.delete(instancia.id);
    }
  }));
}

export function useLauncher() {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [account, setAccount] = useState<MinecraftAccount | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchInstances = useCallback(async () => {
    try {
      const data = await invoke<Instance[]>("get_instances");
      const normalizadas = (data as any[]).map((inst) => ({
        ...inst,
        icon: normalizarIconeLegado(inst.icon),
        mc_type: inst.mc_type ?? inst.mcType,
        loader_type: inst.loader_type ?? inst.loaderType,
        last_played: inst.last_played ?? inst.lastPlayed,
        tempo_total_jogado_segundos:
          inst.tempo_total_jogado_segundos ??
          inst.tempoTotalJogadoSegundos ??
          inst.total_playtime_seconds ??
          inst.totalPlaytimeSeconds,
        sessao_iniciada_em:
          inst.sessao_iniciada_em ??
          inst.sessaoIniciadaEm ??
          inst.session_started_at ??
          inst.sessionStartedAt,
      })) as Instance[];
      setInstances(await migrarIconesDoGeradorAntigo(normalizadas));
    } catch (error) {
      console.error("Erro ao buscar instâncias:", error);
    }
  }, []);

  const refreshAccount = useCallback(async () => {
    try {
      const acc = await invoke<MinecraftAccount | null>("check_auth_status");
      setAccount(acc);
    } catch (error) {
      console.error("Erro ao verificar conta:", error);
    }
  }, []);

  const aplicarComportamentoLauncherAoIniciar = useCallback(async () => {
    try {
      const configuracoes = await invoke<ConfiguracoesGlobais>("get_settings");
      if (configuracoes?.close_on_launch) {
        await getCurrentWindow().minimize();
      }
    } catch (erro) {
      console.warn("Falha ao aplicar close_on_launch:", erro);
    }
  }, []);

  const launch = useCallback(async (id: string) => {
    try {
      await invoke("launch_instance", { id });
      await aplicarComportamentoLauncherAoIniciar();
      await fetchInstances();
    } catch (error) {
      console.error("Erro ao iniciar Minecraft:", error);
      alert(error);
    }
  }, [aplicarComportamentoLauncherAoIniciar, fetchInstances]);

  const launchServer = useCallback(async (id: string, address: string) => {
    try {
      await invoke("launch_instance_to_server", { id, address });
      await aplicarComportamentoLauncherAoIniciar();
      await fetchInstances();
    } catch (error) {
      console.error("Erro ao iniciar servidor via quick play:", error);
      alert(error);
    }
  }, [aplicarComportamentoLauncherAoIniciar, fetchInstances]);

  const remove = useCallback(async (id: string) => {
    try {
      await invoke("delete_instance", { id });
      await fetchInstances();
    } catch (error) {
      console.error("Erro ao deletar instância:", error);
      throw error;
    }
  }, [fetchInstances]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      await Promise.all([fetchInstances(), refreshAccount()]);
      setLoading(false);
    };
    init();
  }, [fetchInstances, refreshAccount]);

  useEffect(() => {
    const atualizarInstancias = () => {
      void fetchInstances();
    };

    window.addEventListener(EVENTO_INSTANCIAS_ATUALIZADAS, atualizarInstancias);
    return () => window.removeEventListener(EVENTO_INSTANCIAS_ATUALIZADAS, atualizarInstancias);
  }, [fetchInstances]);

  return {
    instances,
    account,
    loading,
    fetchInstances,
    refreshAccount,
    launch,
    launchServer,
    remove,
  };
}
