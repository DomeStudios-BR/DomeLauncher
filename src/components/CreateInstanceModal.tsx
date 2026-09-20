import { useState, useEffect, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, ChevronDown, Pencil, Search } from "../iconesPixelados";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "../lib/utils";
import EditorIconeModal, { gerarIconeAleatorio } from "./editor-icone/EditorIconeModal";
import {
  addCreatingInstance,
  updateCreatingInstance,
  completeCreatingInstance,
  errorCreatingInstance,
  type CreatingInstance,
} from "../stores/creatingInstances";

interface CreateInstanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: () => void;
}

const LOADERS = [
  { id: "forge", name: "Forge" },
  { id: "fabric", name: "Fabric" },
  { id: "neoforge", name: "NeoForge" },
  { id: "vanilla", name: "Vanilla" },
];

export default function CreateInstanceModal({
  isOpen,
  onClose,
  onCreated,
}: CreateInstanceModalProps) {
  const [name, setName] = useState("");
  const [version, setVersion] = useState("");
  const [loader, setLoader] = useState("forge");
  const [loaderVersion, setLoaderVersion] = useState("");
  const [loaderVersions, setLoaderVersions] = useState<string[]>([]);
  const [versions, setVersions] = useState<{ id: string; type: string }[]>([]);
  const [mostrarSnapshots, setMostrarSnapshots] = useState(false);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [loadingLoaderVersions, setLoadingLoaderVersions] = useState(false);
  const [isVersionOpen, setIsVersionOpen] = useState(false);
  const [isLoaderVersionOpen, setIsLoaderVersionOpen] = useState(false);
  const [versionSearch, setVersionSearch] = useState("");
  const [versionSearchChanged, setVersionSearchChanged] = useState(false);
  const [customIcon, setCustomIcon] = useState<string | null>(null);
  const [editorIconeAberto, setEditorIconeAberto] = useState(false);
  const versionInputRef = useRef<HTMLInputElement>(null);

  // Carregar versões do Minecraft
  useEffect(() => {
    if (isOpen) {
      const fetchVersions = async () => {
        setLoadingVersions(true);
        try {
          const [res, settings] = await Promise.all([
            invoke<any>("get_minecraft_versions"),
            invoke<any>("get_settings").catch(() => ({ show_snapshots: false })),
          ]);

          const snapshotsAtivados = Boolean(settings?.show_snapshots);
          setMostrarSnapshots(snapshotsAtivados);

          const filtradas = res.versions.filter(
            (v: any) => v.type === "release" || (snapshotsAtivados && v.type === "snapshot")
          );
          setVersions(filtradas);
          if (filtradas.length > 0) {
            setVersion(filtradas[0].id);
            setVersionSearch(filtradas[0].id);
          }
        } catch (error) {
          console.error("Erro ao carregar versões:", error);
        } finally {
          setLoadingVersions(false);
        }
      };
      fetchVersions();
    }
  }, [isOpen]);

  // Carregar versões do loader
  useEffect(() => {
    let cancelado = false;

    if (loader !== "vanilla" && version) {
      const fetchLoaderVersions = async () => {
        setLoadingLoaderVersions(true);
        setLoaderVersions([]);
        setLoaderVersion("");
        setIsLoaderVersionOpen(false);
        try {
          const res: any = await invoke("get_loader_versions", {
            loaderType: loader,
            minecraftVersion: version,
          });
          const vers = res.versions.map((v: any) => v.version);
          if (cancelado) return;
          setLoaderVersions(vers);
          if (vers.length > 0) setLoaderVersion(vers[0]);
        } catch (error) {
          if (cancelado) return;
          console.error("Erro ao carregar versões do loader:", error);
          setLoaderVersions([]);
        } finally {
          if (!cancelado) setLoadingLoaderVersions(false);
        }
      };
      void fetchLoaderVersions();
    } else {
      setLoaderVersions([]);
      setLoaderVersion("");
      setLoadingLoaderVersions(false);
    }

    return () => {
      cancelado = true;
    };
  }, [loader, version]);

  // Reset ao abrir
  useEffect(() => {
    if (isOpen) {
      setName("");
      setLoader("forge");
      setIsVersionOpen(false);
      setVersionSearchChanged(false);
      setCustomIcon(null);
      void gerarIconeAleatorio().then(setCustomIcon).catch((erro) => {
        console.error("Erro ao gerar ícone inicial:", erro);
      });
    }
  }, [isOpen]);

  const filteredVersions = useMemo(() => {
    if (!versionSearchChanged) return versions;

    const query = versionSearch.trim().toLocaleLowerCase("pt-BR");
    if (!query) return versions;

    return versions.filter((item) => item.id.toLocaleLowerCase("pt-BR").includes(query));
  }, [versionSearch, versionSearchChanged, versions]);
  const isVersionSelectionValid = !versionSearchChanged
    || versionSearch.trim().toLocaleLowerCase("pt-BR") === version.toLocaleLowerCase("pt-BR");

  const selectVersion = (selectedVersion: string) => {
    setVersion(selectedVersion);
    setVersionSearch(selectedVersion);
    setVersionSearchChanged(false);
    setIsVersionOpen(false);
  };

  const openVersionSearch = () => {
    setVersionSearch("");
    setVersionSearchChanged(true);
    setIsVersionOpen(true);
  };

  const closeVersionSearch = () => {
    setVersionSearch(version);
    setVersionSearchChanged(false);
    setIsVersionOpen(false);
  };

  const handleVersionSearchChange = (value: string) => {
    setVersionSearch(value);
    setVersionSearchChanged(true);
    setIsVersionOpen(true);

    const exactVersion = versions.find(
      (item) => item.id.toLocaleLowerCase("pt-BR") === value.trim().toLocaleLowerCase("pt-BR")
    );
    if (exactVersion) setVersion(exactVersion.id);
  };

  const handleVersionSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      closeVersionSearch();
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setIsVersionOpen(true);
      return;
    }

    if (event.key === "Enter" && isVersionOpen && filteredVersions.length > 0) {
      event.preventDefault();
      selectVersion(filteredVersions[0].id);
    }
  };

  if (!isOpen) return null;

  const handleCreate = async () => {
    if (!name.trim() || !version || !isVersionSelectionValid) return;

    const instanceId = name.toLowerCase().replace(/\s+/g, "_");

    // Adicionar ao estado de criação
    const creatingInstance: CreatingInstance = {
      id: instanceId,
      name,
      version,
      type: loader,
      status: "downloading",
      progress: 0,
      message: "Iniciando download...",
      icon: customIcon || "/dome-launcher.ico",
    };
    addCreatingInstance(creatingInstance);

    // Fechar modal
    onClose();

    // Criar em background
    try {
      const params: any = { name, version, mcType: loader, icon: customIcon || "/dome-launcher.ico" };
      if (loader !== "vanilla") {
        params.loaderType = loader;
        params.loaderVersion = loaderVersion;
      }

      updateCreatingInstance(instanceId, {
        status: "downloading",
        progress: 30,
        progressoIndeterminado: true,
        message: "Preparando arquivos da instância...",
      });

      await invoke("create_instance", params);
      completeCreatingInstance(instanceId);
      onCreated?.();
    } catch (error) {
      console.error("Erro ao criar instância:", error);
      errorCreatingInstance(instanceId, `Falha: ${error}`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
      />

      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative bg-[#1a1a1c] border border-white/10 rounded-2xl w-full max-w-md overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/5">
          <h2 className="text-lg font-bold">Criar Instância</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
          >
            <X size={18} className="text-white/60" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-5">
          {/* Icon + Name */}
          <div className="flex gap-4">
            <div className="relative group">
              <div className="w-16 h-16 rounded-xl bg-linear-to-br from-emerald-500/20 to-orange-500/20 border border-white/10 overflow-hidden">
                <img
                  src={customIcon || "/dome-launcher.ico"}
                  alt=""
                  className="w-full h-full object-cover"
                />
              </div>
              <button
                type="button"
                onClick={() => setEditorIconeAberto(true)}
                aria-label="Abrir editor de ícone"
                title="Criar ícone"
                className="absolute -bottom-1 -right-1 w-6 h-6 bg-white/10 rounded-full flex items-center justify-center hover:bg-white/20 transition-colors"
              >
                <Pencil size={12} className="text-white/60" />
              </button>
            </div>

            <div className="flex-1">
              <label className="text-sm text-white/60 mb-1.5 block">Nome</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Meu Modpack"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
              />
            </div>
          </div>

          {/* Minecraft Version */}
          <div>
            <label className="text-sm font-bold text-white mb-2 block">
              Versão do Minecraft
              {mostrarSnapshots && (
                <span className="ml-2 text-[10px] font-bold uppercase tracking-wide text-amber-300">
                  snapshots habilitados
                </span>
              )}
            </label>
            <div className="relative">
              <div className="flex items-center rounded-lg border border-white/10 bg-white/5 transition-colors hover:bg-white/10 focus-within:border-[color:var(--cor-acento-500)]">
                <Search size={15} className="ml-3 shrink-0 text-white/35" />
                <input
                  ref={versionInputRef}
                  type="text"
                  role="combobox"
                  aria-label="Pesquisar versão do Minecraft"
                  aria-expanded={isVersionOpen}
                  aria-controls="minecraft-version-options"
                  aria-autocomplete="list"
                  autoComplete="off"
                  disabled={loadingVersions}
                  value={loadingVersions ? "Carregando..." : versionSearch}
                  onFocus={openVersionSearch}
                  onClick={() => {
                    if (!isVersionOpen) openVersionSearch();
                  }}
                  onChange={(event) => handleVersionSearchChange(event.target.value)}
                  onKeyDown={handleVersionSearchKeyDown}
                  onBlur={closeVersionSearch}
                  className="min-w-0 flex-1 bg-transparent px-2 py-2.5 text-sm outline-none disabled:cursor-wait"
                  placeholder="Pesquisar versão..."
                />
                <button
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    if (isVersionOpen) {
                      closeVersionSearch();
                      return;
                    }
                    versionInputRef.current?.focus();
                    openVersionSearch();
                  }}
                  disabled={loadingVersions}
                  aria-label={isVersionOpen ? "Fechar lista de versões" : "Abrir lista de versões"}
                  className="self-stretch px-3 text-white/40 transition-colors hover:text-white/70 disabled:cursor-wait"
                >
                  <ChevronDown
                    size={16}
                    className={cn("transition-transform", isVersionOpen && "rotate-180")}
                  />
                </button>
              </div>

              <AnimatePresence>
                {isVersionOpen && (
                  <motion.div
                    id="minecraft-version-options"
                    role="listbox"
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="absolute z-10 top-full left-0 right-0 mt-1 bg-[#222224] border border-white/10 rounded-lg max-h-48 overflow-y-auto"
                  >
                    {filteredVersions.map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        role="option"
                        aria-selected={version === v.id}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => selectVersion(v.id)}
                        className={cn(
                          "w-full px-3 py-2 text-sm text-left hover:bg-white/10 transition-colors",
                          version === v.id && "bg-emerald-500/20 text-emerald-400"
                        )}
                      >
                        {v.id}
                      </button>
                    ))}
                    {filteredVersions.length === 0 && (
                      <p className="px-3 py-4 text-center text-xs text-white/40">
                        Nenhuma versão encontrada para “{versionSearch.trim()}”.
                      </p>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          {/* Modloader */}
          <div>
            <label className="text-sm font-bold text-white mb-2 flex items-center gap-1">
              Modloader
              <span className="w-4 h-4 rounded-full border border-white/20 text-[10px] flex items-center justify-center text-white/40">?</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {LOADERS.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setLoader(l.id)}
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-full text-sm transition-all",
                    loader === l.id
                      ? "bg-green-400 text-black font-medium"
                      : "bg-white/5 text-white/60 hover:bg-white/10"
                  )}
                >
                  <div
                    className={cn(
                      "w-3 h-3 rounded-full border-2",
                      loader === l.id ? "border-black bg-black" : "border-white/30"
                    )}
                  >
                    {loader === l.id && (
                      <div className="w-full h-full rounded-full bg-green-500 scale-50" />
                    )}
                  </div>
                  {l.name}
                </button>
              ))}
            </div>
          </div>

          {/* Modloader Version */}
          {loader !== "vanilla" && (
            <div>
              <label className="text-sm font-bold text-white mb-2 block">Versão do Loader</label>
              <div className="relative">
                <button
                  onClick={() => setIsLoaderVersionOpen(!isLoaderVersionOpen)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-left flex items-center justify-between hover:bg-white/10 transition-colors"
                >
                  <span>{loadingLoaderVersions ? "Carregando..." : loaderVersion || "Selecione..."}</span>
                  <ChevronDown size={16} className={cn("text-white/40 transition-transform", isLoaderVersionOpen && "rotate-180")} />
                </button>

                <AnimatePresence>
                  {isLoaderVersionOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="absolute z-10 top-full left-0 right-0 mt-1 bg-[#222224] border border-white/10 rounded-lg max-h-48 overflow-y-auto"
                    >
                      {loaderVersions.map((v) => (
                        <button
                          key={v}
                          onClick={() => {
                            setLoaderVersion(v);
                            setIsLoaderVersionOpen(false);
                          }}
                          className={cn(
                            "w-full px-3 py-2 text-sm text-left hover:bg-white/10 transition-colors",
                            loaderVersion === v && "bg-emerald-500/20 text-emerald-400"
                          )}
                        >
                          {loader}-{v}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-5 border-t border-white/5">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-lg text-sm font-medium hover:bg-white/10 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={
              !name.trim() ||
              !version ||
              !isVersionSelectionValid ||
              loadingLoaderVersions ||
              (loader !== "vanilla" && !loaderVersion)
            }
            className="px-5 py-2 rounded-lg text-sm font-bold bg-emerald-500 hover:bg-emerald-400 text-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Create
          </button>
        </div>
      </motion.div>
      <EditorIconeModal
        aberto={editorIconeAberto}
        iconeAtual={customIcon}
        aoFechar={() => setEditorIconeAberto(false)}
        aoSalvar={setCustomIcon}
      />
    </div>
  );
}
