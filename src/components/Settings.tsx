import { useState, useEffect, useCallback, useRef } from "react";
import {
  Cpu,
  Monitor,
  Coffee,
  Download,
  Check,
  AlertCircle,
  Loader2,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Rocket,
  HardDrive,
  Terminal,
  Sparkles,
  Shield,
  FolderOpen,
  X,
} from "../iconesPixelados";
import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { motion, AnimatePresence } from "framer-motion";
import { EsqueletoAba } from "./EsqueletoCarregamento";
import { ehCorHexValida, normalizarCorDestaque } from "../lib/corDestaque";
import { SeletorCorDestaque } from "./settings/SeletorCorDestaque";
import { EVENTO_INSTANCIAS_ATUALIZADAS } from "../lib/eventosTransferenciaSocial";

// Tipos
interface GlobalSettings {
  ram_mb: number;
  java_path: string | null;
  java_args: string;
  width: number;
  height: number;
  auto_java: boolean;
  close_on_launch: boolean;
  show_snapshots: boolean;
  discord_rpc_ativo: boolean;
  cor_destaque: string;
  instances_path: string;
  sincronizacao_instancias: ConfiguracaoSincronizacao;
}

interface ConfiguracaoSincronizacao {
  instancia_origem_id: string | null;
  configuracoes: boolean;
  opcoes: boolean;
  texturas: boolean;
  shaders: boolean;
  servidores: boolean;
}

interface InstanciaSincronizavel {
  id: string;
  name: string;
  version: string;
}

interface JavaInfo {
  path: string;
  version: string;
  major: number;
  vendor: string;
  arch: string;
  is_managed: boolean;
}

// Resoluções predefinidas
const RESOLUTIONS = [
  { label: "854 × 480", w: 854, h: 480 },
  { label: "1280 × 720 (HD)", w: 1280, h: 720 },
  { label: "1366 × 768", w: 1366, h: 768 },
  { label: "1600 × 900", w: 1600, h: 900 },
  { label: "1920 × 1080 (FHD)", w: 1920, h: 1080 },
  { label: "2560 × 1440 (QHD)", w: 2560, h: 1440 },
];

// Presets de JVM args
const JVM_PRESETS = [
  {
    nome: "Padrão",
    desc: "Configuração balanceada",
    args: "-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200",
  },
  {
    nome: "Performance",
    desc: "Otimizado para FPS alto",
    args: "-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200 -XX:+UnlockExperimentalVMOptions -XX:+DisableExplicitGC -XX:G1NewSizePercent=30 -XX:G1MaxNewSizePercent=40 -XX:G1HeapRegionSize=8M -XX:G1ReservePercent=20 -XX:G1HeapWastePercent=5 -XX:G1MixedGCCountTarget=4",
  },
  {
    nome: "Mínimo",
    desc: "Sem argumentos extras",
    args: "",
  },
];

export default function Settings() {
  const [settings, setSettings] = useState<GlobalSettings>({
    ram_mb: 4096,
    java_path: null,
    java_args: "-XX:+UseG1GC -XX:+ParallelRefProcEnabled -XX:MaxGCPauseMillis=200",
    width: 854,
    height: 480,
    auto_java: true,
    close_on_launch: false,
    show_snapshots: false,
    discord_rpc_ativo: true,
    cor_destaque: "#10B981",
    instances_path: "",
    sincronizacao_instancias: {
      instancia_origem_id: null,
      configuracoes: false,
      opcoes: false,
      texturas: false,
      shaders: false,
      servidores: false,
    },
  });

  const [javas, setJavas] = useState<JavaInfo[]>([]);
  const [systemRam, setSystemRam] = useState(16384);
  const [carregando, setCarregando] = useState(true);
  const [detectandoJava, setDetectandoJava] = useState(false);
  const [instalandoJava, setInstalandoJava] = useState<number | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [jvmAberto, setJvmAberto] = useState(false);
  const [javaAberto, setJavaAberto] = useState(true);
  const [codigoCor, setCodigoCor] = useState("#10B981");
  const [selecionandoPasta, setSelecionandoPasta] = useState(false);
  const [instancias, setInstancias] = useState<InstanciaSincronizavel[]>([]);
  const [sincronizando, setSincronizando] = useState(false);
  const [mensagemSync, setMensagemSync] = useState<string | null>(null);
  const ignorarPrimeiraPersistencia = useRef(true);
  const configuracoesAtuais = useRef(settings);
  const alteracoesPendentes = useRef(false);
  const caminhoInstanciasPersistido = useRef("");

  // Carregar configurações e dados
  useEffect(() => {
    carregarDados();
  }, []);

  const carregarDados = async () => {
    setCarregando(true);
    try {
      const [cfg, ram, instanciasDisponiveis] = await Promise.all([
        invoke<GlobalSettings>("get_settings"),
        invoke<number>("get_system_ram"),
        invoke<InstanciaSincronizavel[]>("get_instances"),
      ]);
      const configuracoesCarregadas = {
        ...cfg,
        cor_destaque: normalizarCorDestaque(cfg?.cor_destaque),
      };
      caminhoInstanciasPersistido.current = configuracoesCarregadas.instances_path;
      configuracoesAtuais.current = configuracoesCarregadas;
      setSettings(configuracoesCarregadas);
      setCodigoCor(configuracoesCarregadas.cor_destaque);
      setSystemRam(ram);
      setInstancias(instanciasDisponiveis);
      detectarJavas();
    } catch (e) {
      console.error("Erro ao carregar configurações:", e);
    } finally {
      setCarregando(false);
    }
  };

  const detectarJavas = useCallback(async () => {
    setDetectandoJava(true);
    try {
      const result = await invoke<JavaInfo[]>("detect_java_installations");
      setJavas(result);
    } catch (e) {
      console.error("Erro ao detectar Java:", e);
    } finally {
      setDetectandoJava(false);
    }
  }, []);

  const instalarJava = async (major: number) => {
    setInstalandoJava(major);
    setErro(null);
    try {
      await invoke<JavaInfo>("install_java", { major });
      await detectarJavas();
    } catch (e: unknown) {
      setErro(`Erro ao instalar Java ${major}: ${e}`);
    } finally {
      setInstalandoJava(null);
    }
  };

  const atualizarConfig = <K extends keyof GlobalSettings>(
    chave: K,
    valor: GlobalSettings[K]
  ) => {
    setSettings((prev) => {
      const proximasConfiguracoes = { ...prev, [chave]: valor };
      configuracoesAtuais.current = proximasConfiguracoes;
      alteracoesPendentes.current = true;
      return proximasConfiguracoes;
    });
    setErro(null);
  };

  const persistirConfiguracoes = useCallback(async (
    configuracoes: GlobalSettings,
    mostrarErro: boolean
  ) => {
    try {
      await invoke("save_settings", { settings: configuracoes });
      if (configuracoes.instances_path !== caminhoInstanciasPersistido.current) {
        caminhoInstanciasPersistido.current = configuracoes.instances_path;
        window.dispatchEvent(new CustomEvent(EVENTO_INSTANCIAS_ATUALIZADAS));
      }
      if (configuracoesAtuais.current === configuracoes) {
        alteracoesPendentes.current = false;
      }
      window.dispatchEvent(
        new CustomEvent("dome:cor-destaque-atualizada", {
          detail: { cor: configuracoes.cor_destaque },
        })
      );
      return true;
    } catch (e: unknown) {
      if (mostrarErro) setErro(`Erro ao salvar: ${e}`);
      return false;
    }
  }, []);

  useEffect(() => {
    if (carregando) return;
    if (ignorarPrimeiraPersistencia.current) {
      ignorarPrimeiraPersistencia.current = false;
      return;
    }

    const temporizador = window.setTimeout(() => {
      void persistirConfiguracoes(settings, true);
    }, 450);

    return () => window.clearTimeout(temporizador);
  }, [carregando, persistirConfiguracoes, settings]);

  useEffect(() => {
    return () => {
      if (alteracoesPendentes.current) {
        void persistirConfiguracoes(configuracoesAtuais.current, false);
      }
    };
  }, [persistirConfiguracoes]);

  // Calcular o label da resolução selecionada
  const resolucaoAtual = RESOLUTIONS.find(
    (r) => r.w === settings.width && r.h === settings.height
  );
  const selecionarPastaInstancias = async () => {
    setSelecionandoPasta(true);
    try {
      const caminho = await openDialog({
        directory: true,
        multiple: false,
        defaultPath: settings.instances_path || undefined,
        title: "Escolher pasta de instâncias do Minecraft",
      });
      if (typeof caminho === "string") {
        atualizarConfig("instances_path", caminho);
      }
    } catch (e: unknown) {
      setErro(`Não foi possível selecionar a pasta: ${e}`);
    } finally {
      setSelecionandoPasta(false);
    }
  };

  const atualizarCodigoCor = (valor: string) => {
    const codigo = valor.trim().toUpperCase();
    setCodigoCor(codigo);
    if (ehCorHexValida(codigo)) {
      atualizarConfig("cor_destaque", codigo);
    }
  };

  const atualizarSync = <K extends keyof ConfiguracaoSincronizacao>(
    chave: K,
    valor: ConfiguracaoSincronizacao[K],
  ) => {
    atualizarConfig("sincronizacao_instancias", {
      ...configuracoesAtuais.current.sincronizacao_instancias,
      [chave]: valor,
    });
    setMensagemSync(null);
  };

  const aplicarSyncAgora = async () => {
    setSincronizando(true);
    setMensagemSync(null);
    try {
      await persistirConfiguracoes(configuracoesAtuais.current, true);
      const quantidade = await invoke<number>("aplicar_sincronizacao_instancias");
      setMensagemSync(`Sincronização aplicada em ${quantidade} instância${quantidade === 1 ? "" : "s"}.`);
    } catch (e: unknown) {
      setErro(`Não foi possível sincronizar: ${e}`);
    } finally {
      setSincronizando(false);
    }
  };

  if (carregando) {
    return <EsqueletoAba />;
  }

  return (
    <div className="max-w-3xl space-y-6 pb-32">
      {/* Alerta de erro */}
      <AnimatePresence>
        {erro && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex items-center gap-3 bg-red-500/10 border border-red-500/20 rounded-2xl p-4 text-red-400 text-sm"
          >
            <AlertCircle size={18} />
            <span className="flex-1">{erro}</span>
            <button onClick={() => setErro(null)}>
              <X size={16} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex flex-col gap-6">

      {/* ===== LAUNCHER ===== */}
      <Secao
        icone={<Rocket className="text-purple-400" size={20} />}
        titulo="Launcher"
        descricao="Comportamento do launcher"
      >
        <div className="space-y-2">
          <p className="text-sm font-medium">Pasta de instâncias</p>
          <p className="text-xs text-white/30">
            O launcher detectará e criará instâncias diretamente nesta pasta. Arquivos existentes não serão movidos.
          </p>
          <div className="flex items-stretch gap-2">
            <div className="flex min-w-0 flex-1 items-center gap-2 border border-white/10 bg-black/20 px-3">
              <FolderOpen size={15} className="shrink-0 text-emerald-300/70" />
              <span className="truncate font-mono text-[11px] text-white/60" title={settings.instances_path}>
                {settings.instances_path}
              </span>
            </div>
            <button
              type="button"
              onClick={selecionarPastaInstancias}
              disabled={selecionandoPasta}
              className="flex items-center gap-2 border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-bold text-white/70 transition-colors hover:border-emerald-400/30 hover:text-emerald-200 disabled:cursor-wait disabled:opacity-50"
            >
              {selecionandoPasta ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
              Escolher pasta
            </button>
          </div>
        </div>

        <ToggleItem
          titulo="Discord Rich Presence"
          descricao="Mostra no Discord quando você está no launcher e no Minecraft"
          ativo={settings.discord_rpc_ativo}
          onChange={(v) => atualizarConfig("discord_rpc_ativo", v)}
        />

        <ToggleItem
          titulo="Fechar ao Iniciar"
          descricao="Minimiza o launcher quando o Minecraft iniciar"
          ativo={settings.close_on_launch}
          onChange={(v) => atualizarConfig("close_on_launch", v)}
        />

        <ToggleItem
          titulo="Mostrar Snapshots"
          descricao="Exibir versões snapshot na lista de versões"
          ativo={settings.show_snapshots}
          onChange={(v) => atualizarConfig("show_snapshots", v)}
        />

        <SeletorCorDestaque
          cor={settings.cor_destaque}
          codigo={codigoCor}
          onAlterar={atualizarCodigoCor}
          onRestaurar={() => setCodigoCor(normalizarCorDestaque(settings.cor_destaque))}
        />
      </Secao>

      {/* ===== DESEMPENHO ===== */}
      <Secao
        icone={<Cpu className="text-emerald-400" size={20} />}
        titulo="Desempenho"
        descricao="Memória padrão dos modpacks e configurações da JVM"
      >
        {/* RAM Slider */}
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <label className="text-sm font-medium text-white/60 flex items-center gap-2">
              <HardDrive size={14} />
              Memória RAM padrão dos modpacks
            </label>
            <div className="flex items-center gap-2">
              <span className="text-emerald-400 font-bold text-lg tabular-nums">
                {(settings.ram_mb / 1024).toFixed(1)} GB
              </span>
              <span className="text-[10px] text-white/20 font-medium">
                / {(systemRam / 1024).toFixed(0)} GB
              </span>
            </div>
          </div>

          <p className="text-[11px] leading-relaxed text-white/35">
            Este valor é usado por todos os modpacks que estiverem com a alocação própria desativada.
          </p>

          {/* Barra visual personalizada */}
          <div className="relative">
            <div className="h-2 bg-white/5 rounded-full overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{
                  backgroundColor: settings.ram_mb / systemRam > 0.75 ? "#f59e0b" : "#34d399",
                }}
                animate={{ width: `${(settings.ram_mb / systemRam) * 100}%` }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
              />
            </div>
            <input
              type="range"
              min={512}
              max={Math.min(systemRam, 32768)}
              step={512}
              value={settings.ram_mb}
              onChange={(e) => atualizarConfig("ram_mb", parseInt(e.target.value))}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
          </div>

          <div className="flex justify-between text-[10px] text-white/20 font-bold">
            <span>512 MB</span>
            <div className="flex gap-3">
              {[2, 4, 8, 16].map(
                (gb) =>
                  gb * 1024 <= systemRam && (
                    <button
                      key={gb}
                      onClick={() => atualizarConfig("ram_mb", gb * 1024)}
                      className={`px-2 py-0.5 rounded transition-all ${
                        settings.ram_mb === gb * 1024
                          ? "bg-emerald-500/20 text-emerald-400"
                          : "hover:text-white/40"
                      }`}
                    >
                      {gb}GB
                    </button>
                  )
              )}
            </div>
            <span>{(Math.min(systemRam, 32768) / 1024).toFixed(0)} GB</span>
          </div>

          {settings.ram_mb / systemRam > 0.75 && (
            <div className="flex items-center gap-2 text-amber-400/60 text-xs">
              <AlertCircle size={12} />
              Alocar mais de 75% da RAM pode causar instabilidade no sistema
            </div>
          )}
        </div>

        {/* JVM Args */}
        <div className="space-y-3 mt-4 pt-4 border-t border-white/5">
          <button
            onClick={() => setJvmAberto(!jvmAberto)}
            className="flex items-center justify-between w-full text-sm font-medium text-white/60 hover:text-white/80 transition-colors"
          >
            <span className="flex items-center gap-2">
              <Terminal size={14} />
              Argumentos JVM
            </span>
            {jvmAberto ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          <AnimatePresence>
            {jvmAberto && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden space-y-3"
              >
                {/* Presets */}
                <div className="flex gap-2">
                  {JVM_PRESETS.map((preset) => (
                    <button
                      key={preset.nome}
                      onClick={() => atualizarConfig("java_args", preset.args)}
                      className={`flex-1 px-3 py-2 rounded-xl text-xs font-medium transition-all border ${
                        settings.java_args === preset.args
                          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                          : "bg-white/3 border-white/5 text-white/40 hover:bg-white/5 hover:text-white/60"
                      }`}
                    >
                      <div className="font-bold">{preset.nome}</div>
                      <div className="text-[10px] opacity-60 mt-0.5">{preset.desc}</div>
                    </button>
                  ))}
                </div>

                <textarea
                  value={settings.java_args}
                  onChange={(e) => atualizarConfig("java_args", e.target.value)}
                  placeholder="-XX:+UseG1GC ..."
                  rows={3}
                  className="w-full bg-white/3 border border-white/5 rounded-xl p-3 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-emerald-500/50 text-white/70 resize-none"
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </Secao>

      {/* ===== JAVA ===== */}
      <Secao
        icone={<Coffee className="text-amber-400" size={20} />}
        titulo="Java Runtime"
        descricao="Detecção e instalação automática de Java"
      >
        {/* Toggle Auto Java */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium flex items-center gap-2">
              <Sparkles size={14} className="text-amber-400" />
              Gerenciamento Automático
            </p>
            <p className="text-xs text-white/30 mt-0.5">
              Detecta e instala a versão correta de Java automaticamente
            </p>
          </div>
          <Toggle
            ativo={settings.auto_java}
            onChange={(v) => atualizarConfig("auto_java", v)}
          />
        </div>

        {/* Java detectados */}
        <div className="mt-4 pt-4 border-t border-white/5 space-y-3">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setJavaAberto(!javaAberto)}
              className="flex items-center gap-2 text-sm font-medium text-white/60 hover:text-white/80 transition-colors"
            >
              <Shield size={14} />
              Instalações Detectadas ({javas.length})
              {javaAberto ? (
                <ChevronUp size={12} />
              ) : (
                <ChevronDown size={12} />
              )}
            </button>
            <button
              onClick={detectarJavas}
              disabled={detectandoJava}
              className="flex items-center gap-1.5 text-xs text-white/30 hover:text-emerald-400 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={12} className={detectandoJava ? "animate-spin" : ""} />
              Re-detectar
            </button>
          </div>

          <AnimatePresence>
            {javaAberto && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden space-y-2"
              >
                {detectandoJava ? (
                  <div className="flex items-center justify-center gap-2 py-6 text-white/30 text-sm">
                    <Loader2 className="animate-spin" size={16} />
                    Detectando instalações Java...
                  </div>
                ) : javas.length === 0 ? (
                  <div className="text-center py-6 text-white/20 text-sm">
                    <Coffee size={24} className="mx-auto mb-2 opacity-30" />
                    Nenhuma instalação de Java encontrada
                  </div>
                ) : (
                  javas.map((java, i) => (
                    <motion.div
                      key={`${java.path}-${i}`}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.05 }}
                      onClick={() => {
                        if (!settings.auto_java) {
                          atualizarConfig("java_path", java.path);
                        }
                      }}
                      className={`flex items-center gap-3 p-3 rounded-xl border transition-all cursor-pointer group ${
                        !settings.auto_java && settings.java_path === java.path
                          ? "bg-emerald-500/10 border-emerald-500/20"
                          : "bg-white/2 border-white/5 hover:bg-white/5"
                      }`}
                    >
                      {/* Ícone do vendor */}
                      <div
                        className={`w-10 h-10 rounded-lg flex items-center justify-center text-xs font-black ${
                          java.is_managed
                            ? "bg-emerald-500/10 text-emerald-400"
                            : "bg-white/5 text-white/30"
                        }`}
                      >
                        {java.major}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium truncate">
                            {java.vendor}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/5 text-white/30 font-mono">
                            {java.version}
                          </span>
                          {java.is_managed && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-medium">
                              Dome
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-white/20 font-mono truncate mt-0.5">
                          {java.path}
                        </p>
                      </div>

                      {/* Indicador de seleção (modo manual) */}
                      {!settings.auto_java && (
                        <div
                          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                            settings.java_path === java.path
                              ? "border-emerald-500 bg-emerald-500"
                              : "border-white/10 group-hover:border-white/20"
                          }`}
                        >
                          {settings.java_path === java.path && (
                            <Check size={12} className="text-black" />
                          )}
                        </div>
                      )}
                    </motion.div>
                  ))
                )}

                {/* Botões para instalar Java */}
                <div className="flex gap-2 mt-3">
                  {[8, 17, 21].map((v) => {
                    const jaExiste = javas.some((j) => j.major === v && j.is_managed);
                    return (
                      <button
                        key={v}
                        onClick={() => !jaExiste && instalarJava(v)}
                        disabled={!!instalandoJava || jaExiste}
                        className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium transition-all border ${
                          jaExiste
                            ? "bg-emerald-500/5 border-emerald-500/10 text-emerald-400/40 cursor-default"
                            : "bg-white/3 border-white/5 text-white/40 hover:bg-emerald-500/10 hover:border-emerald-500/20 hover:text-emerald-400"
                        }`}
                      >
                        {instalandoJava === v ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : jaExiste ? (
                          <Check size={14} />
                        ) : (
                          <Download size={14} />
                        )}
                        Java {v}
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </Secao>

      {/* ===== JANELA ===== */}
      <Secao
        icone={<Monitor className="text-cyan-400" size={20} />}
        titulo="Janela do Jogo"
        descricao="Resolução e modo de exibição"
      >
        {/* Resoluções predefinidas */}
        <div className="space-y-3">
          <label className="text-sm font-medium text-white/60">
            Resolução Inicial
          </label>
          <div className="grid grid-cols-3 gap-2">
            {RESOLUTIONS.map((res) => (
              <button
                key={res.label}
                onClick={() => {
                  atualizarConfig("width", res.w);
                  atualizarConfig("height", res.h);
                }}
                className={`px-3 py-2.5 rounded-xl text-xs font-medium transition-all border ${
                  settings.width === res.w && settings.height === res.h
                    ? "bg-cyan-500/10 border-cyan-500/20 text-cyan-400"
                    : "bg-white/3 border-white/5 text-white/40 hover:bg-white/5 hover:text-white/60"
                }`}
              >
                {res.label}
              </button>
            ))}
          </div>

          {/* Resolução customizada */}
          {!resolucaoAtual && (
            <div className="flex gap-2 items-center">
              <input
                type="number"
                value={settings.width}
                onChange={(e) => atualizarConfig("width", parseInt(e.target.value) || 854)}
                className="w-24 bg-white/3 border border-white/5 rounded-xl p-2.5 text-sm text-center focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
              />
              <X size={14} className="text-white/20" />
              <input
                type="number"
                value={settings.height}
                onChange={(e) => atualizarConfig("height", parseInt(e.target.value) || 480)}
                className="w-24 bg-white/3 border border-white/5 rounded-xl p-2.5 text-sm text-center focus:outline-none focus:ring-1 focus:ring-cyan-500/50"
              />
            </div>
          )}
        </div>
      </Secao>

        <Secao
          icone={<RefreshCw className="text-emerald-400" size={20} />}
          titulo="Sincronização entre instâncias"
          descricao="Use uma instância como base para as demais"
        >
          <div className="space-y-2">
            <label className="text-sm font-medium text-white/70">Instância de origem</label>
            <select
              value={settings.sincronizacao_instancias.instancia_origem_id ?? ""}
              onChange={(e) => atualizarSync("instancia_origem_id", e.target.value || null)}
              className="h-11 w-full border border-white/10 bg-[#101011] px-3 text-sm text-white"
            >
              <option value="">Selecione uma instância</option>
              {instancias.map((instancia) => (
                <option key={instancia.id} value={instancia.id}>
                  {instancia.name} — {instancia.version}
                </option>
              ))}
            </select>
            <p className="text-xs leading-relaxed text-white/35">
              Os itens escolhidos serão copiados desta instância para as atuais e para todas as novas instâncias.
            </p>
          </div>

          <div className="space-y-2 border-t border-white/5 pt-4">
            {([
              ["configuracoes", "Configurações de mods", "Pasta config"],
              ["opcoes", "Opções do Minecraft", "Keybinds, sensibilidade e outras opções do arquivo options.txt"],
              ["texturas", "Pacotes de textura", "Pasta resourcepacks"],
              ["shaders", "Shaders", "Pasta shaderpacks"],
              ["servidores", "Servidores", "Arquivo servers.dat"],
            ] as const).map(([chave, titulo, descricao]) => (
              <ToggleItem
                key={chave}
                titulo={titulo}
                descricao={descricao}
                ativo={settings.sincronizacao_instancias[chave]}
                onChange={(valor) => atualizarSync(chave, valor)}
              />
            ))}
          </div>

          {mensagemSync && <p className="text-xs font-medium text-emerald-300">{mensagemSync}</p>}
          <button
            type="button"
            disabled={sincronizando || !settings.sincronizacao_instancias.instancia_origem_id}
            onClick={() => void aplicarSyncAgora()}
            className="flex items-center gap-2 bg-emerald-400 px-4 py-3 text-xs font-black text-black disabled:opacity-40"
          >
            <RefreshCw size={14} className={sincronizando ? "animate-spin" : ""} />
            {sincronizando ? "Aplicando..." : "Aplicar em todas agora"}
          </button>
        </Secao>
      </div>
    </div>
  );
}

// ===== COMPONENTES AUXILIARES =====

function Secao({
  icone,
  titulo,
  descricao,
  children,
}: {
  icone: React.ReactNode;
  titulo: string;
  descricao: string;
  children: React.ReactNode;
}) {
  const [aberta, setAberta] = useState(false);

  return (
    <section className="overflow-hidden rounded-2xl border border-white/5 bg-white/[0.02]">
      <button
        type="button"
        onClick={() => setAberta((valor) => !valor)}
        aria-expanded={aberta}
        className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-white/[0.025]"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.04]">
          {icone}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-bold">{titulo}</h3>
          <p className="truncate text-[11px] text-white/25">{descricao}</p>
        </div>
        <motion.span
          animate={{ rotate: aberta ? 180 : 0 }}
          transition={{ duration: 0.2 }}
          className="text-white/30"
        >
          <ChevronDown size={17} />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {aberta && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div className="space-y-4 border-t border-white/5 p-5">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

function Toggle({
  ativo,
  onChange,
}: {
  ativo: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      onClick={() => onChange(!ativo)}
      className={`w-11 h-6 rounded-full transition-all relative ${
        ativo ? "bg-emerald-500" : "bg-white/10"
      }`}
    >
      <motion.div
        className="absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm"
        animate={{ left: ativo ? 24 : 4 }}
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
      />
    </button>
  );
}

function ToggleItem({
  titulo,
  descricao,
  ativo,
  onChange,
}: {
  titulo: string;
  descricao: string;
  ativo: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm font-medium">{titulo}</p>
        <p className="text-xs text-white/30 mt-0.5">{descricao}</p>
      </div>
      <Toggle ativo={ativo} onChange={onChange} />
    </div>
  );
}
