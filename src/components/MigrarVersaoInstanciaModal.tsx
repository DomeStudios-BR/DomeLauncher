import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RefreshCw, X } from "../iconesPixelados";
import type { Instance } from "../hooks/useLauncher";
import {
  addCreatingInstance,
  completeCreatingInstance,
  errorCreatingInstance,
  updateCreatingInstance,
} from "../stores/creatingInstances";

interface ResultadoMigracao {
  versaoAnterior: string;
  versaoNova: string;
  modsMigrados: number;
  modsPreservadosBackup: string[];
  caminhoBackup: string;
}

interface MigrarVersaoInstanciaModalProps {
  instancia: Instance | null;
  onClose: () => void;
  onMigrada: () => Promise<void>;
}

const LOADERS = ["Vanilla", "Fabric", "Forge", "NeoForge"];

export default function MigrarVersaoInstanciaModal({
  instancia,
  onClose,
  onMigrada,
}: MigrarVersaoInstanciaModalProps) {
  const [versoes, setVersoes] = useState<Array<{ id: string; type: string }>>([]);
  const [versao, setVersao] = useState("");
  const [loader, setLoader] = useState("Vanilla");
  const [versoesLoader, setVersoesLoader] = useState<string[]>([]);
  const [versaoLoader, setVersaoLoader] = useState("");
  const [carregandoVersoesLoader, setCarregandoVersoesLoader] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!instancia) return;
    const loaderAtual = instancia.loader_type || instancia.mc_type || "Vanilla";
    const loaderNormalizado = LOADERS.find((item) => item.toLowerCase() === loaderAtual.toLowerCase()) || "Vanilla";
    setVersao(instancia.version);
    setLoader(loaderNormalizado);
    setErro(null);
    void invoke<{ versions: Array<{ id: string; type: string }> }>("get_minecraft_versions")
      .then((resposta) => setVersoes(resposta.versions.filter((item) => item.type === "release")))
      .catch((falha) => setErro(String(falha)));
  }, [instancia]);

  useEffect(() => {
    let cancelado = false;

    if (!instancia || loader.toLowerCase() === "vanilla" || !versao) {
      setVersoesLoader([]);
      setVersaoLoader("");
      setCarregandoVersoesLoader(false);
      return () => {
        cancelado = true;
      };
    }
    setCarregandoVersoesLoader(true);
    setVersoesLoader([]);
    setVersaoLoader("");
    setErro(null);
    void invoke<{ versions: Array<{ version: string }> }>("get_loader_versions", {
      loaderType: loader.toLowerCase(),
      minecraftVersion: versao,
    }).then((resposta) => {
      if (cancelado) return;
      const itens = resposta.versions.map((item) => item.version);
      setVersoesLoader(itens);
      setVersaoLoader(itens[0] || "");
    }).catch((falha) => {
      if (!cancelado) setErro(String(falha));
    }).finally(() => {
      if (!cancelado) setCarregandoVersoesLoader(false);
    });

    return () => {
      cancelado = true;
    };
  }, [instancia, loader, versao]);

  const podeMigrar = useMemo(() => Boolean(
    instancia
      && versao
      && !carregandoVersoesLoader
      && (loader.toLowerCase() === "vanilla" || versaoLoader)
  ), [carregandoVersoesLoader, instancia, loader, versao, versaoLoader]);

  if (!instancia) return null;

  const migrar = async () => {
    const idTarefa = `migracao-${instancia.id}-${Date.now()}`;
    const instanciaAlvo = instancia;
    const versaoAlvo = versao;
    const loaderAlvo = loader.toLowerCase();
    const versaoLoaderAlvo = versaoLoader;
    addCreatingInstance({
      id: idTarefa,
      name: instanciaAlvo.name,
      version: versaoAlvo,
      type: loader,
      status: "installing",
      progress: 15,
      progressoIndeterminado: true,
      message: "Migrando versão e conteúdos...",
      icon: instanciaAlvo.icon || "",
    });
    onClose();

    try {
      updateCreatingInstance(idTarefa, { message: "Preparando backup e arquivos..." });
      const resposta = await invoke<ResultadoMigracao>("migrar_versao_instancia", {
        instanceId: instanciaAlvo.id,
        version: versaoAlvo,
        loaderType: loaderAlvo,
        loaderVersion: loaderAlvo === "vanilla" ? null : versaoLoaderAlvo,
      });
      updateCreatingInstance(idTarefa, {
        message: `${resposta.modsMigrados} mods migrados; finalizando...`,
      });
      await onMigrada();
      completeCreatingInstance(idTarefa, `Migração para ${resposta.versaoNova} concluída`);
    } catch (falha) {
      errorCreatingInstance(
        idTarefa,
        falha instanceof Error ? falha.message : String(falha),
      );
    }
  };

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/75 p-4" onClick={onClose}>
      <div className="w-full max-w-xl border border-white/12 bg-[#151516] shadow-2xl" onClick={(evento) => evento.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-300/70">Migração segura</p>
            <h2 className="text-lg font-black text-white">Trocar versão de {instancia.name}</h2>
          </div>
          <button type="button" onClick={onClose} className="p-2 text-white/45 hover:text-white"><X size={18} /></button>
        </header>

        <div className="space-y-4 p-5">
          <label className="block text-xs font-bold text-white/65">
            Versão do Minecraft
            <select value={versao} onChange={(evento) => setVersao(evento.target.value)} className="mt-2 h-11 w-full border border-white/10 bg-[#0f0f10] px-3 text-sm text-white">
              {versoes.map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}
            </select>
          </label>
          <label className="block text-xs font-bold text-white/65">
            Loader
            <select value={loader} onChange={(evento) => setLoader(evento.target.value)} className="mt-2 h-11 w-full border border-white/10 bg-[#0f0f10] px-3 text-sm text-white">
              {LOADERS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          {loader.toLowerCase() !== "vanilla" && (
            <label className="block text-xs font-bold text-white/65">
              Versão do loader compatível com Minecraft {versao}
              <select disabled={carregandoVersoesLoader || versoesLoader.length === 0} value={versaoLoader} onChange={(evento) => setVersaoLoader(evento.target.value)} className="mt-2 h-11 w-full border border-white/10 bg-[#0f0f10] px-3 text-sm text-white disabled:opacity-50">
                {carregandoVersoesLoader && <option value="">Carregando versões...</option>}
                {!carregandoVersoesLoader && versoesLoader.length === 0 && <option value="">Nenhuma versão compatível</option>}
                {versoesLoader.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
              {loader.toLowerCase() === "fabric" && !carregandoVersoesLoader && versoesLoader.length > 0 && (
                <span className="mt-2 block font-normal leading-relaxed text-white/35">
                  O Fabric Loader é independente da versão do jogo, então a API pode indicar a mesma versão para
                  diferentes versões do Minecraft.
                </span>
              )}
            </label>
          )}
          <div className="border border-amber-300/15 bg-amber-300/5 p-3 text-xs leading-relaxed text-amber-100/65">
            Mundos, configurações, opções, texturas e shaders serão preservados. Mods reconhecidos pelo Modrinth ou
            CurseForge serão substituídos por versões compatíveis, incluindo dependências. Os demais ficarão no backup e
            não serão carregados automaticamente na nova versão.
          </div>
          {erro && <p className="border border-red-400/20 bg-red-400/5 p-3 text-xs text-red-200">{erro}</p>}
        </div>

        <footer className="flex justify-end gap-2 border-t border-white/10 px-5 py-4">
          <button type="button" onClick={onClose} className="px-4 py-2 text-xs font-bold text-white/50 hover:text-white">Cancelar</button>
          <button type="button" disabled={!podeMigrar} onClick={() => void migrar()} className="flex items-center gap-2 bg-emerald-400 px-4 py-2 text-xs font-black text-black disabled:opacity-40">
            <RefreshCw size={14} />
            Migrar versão
          </button>
        </footer>
      </div>
    </div>
  );
}
