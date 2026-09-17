import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Download, Loader2, Pencil, Trash2, Upload, X } from "../iconesPixelados";
import { invoke } from "@tauri-apps/api/core";
import { MinecraftAccount } from "../App";
import { cn } from "../lib/utils";
import { SkinPreviewRenderer } from "./SkinPreviewRenderer";
import { MiniaturaSkinMinecraft } from "./MiniaturaSkinMinecraft";
import { MiniaturaCapaMinecraft } from "./MiniaturaCapaMinecraft";
import { SKINS_PADRAO, type SkinPadrao } from "../assets/skinsPadrao";
import {
  CabecalhoMenuContextual,
  ItemMenuContextual,
  MenuContextual,
  SeparadorMenuContextual,
} from "./context-menu/MenuContextual";

interface SkinManagerProps {
  user: MinecraftAccount | null;
}

interface CapaMinecraft {
  id: string;
  state: string;
  url: string;
  alias: string;
}

interface CosmeticosSkin {
  variant: "classic" | "slim";
  skinUrl?: string | null;
  capes: CapaMinecraft[];
}

interface SkinAtualBaixada {
  variant: "classic" | "slim";
  bytes: number[];
}

interface SkinSalva {
  id: string;
  nome: string;
  variant: "classic" | "slim";
  bytes: number[];
  salvaEm: number;
}

const CHAVE_SKINS_SALVAS = "dome-skins-salvas";
const CHAVE_MODO_SEGURO_SKINS = "dome-skins-modo-seguro";

function carregarSkinsSalvas(): SkinSalva[] {
  try {
    const valor = localStorage.getItem(CHAVE_SKINS_SALVAS);
    const skins = valor ? (JSON.parse(valor) as SkinSalva[]) : [];
    return skins.map((skin) => ({
      ...skin,
      id: identificarSkin(skin.bytes, skin.variant),
    }));
  } catch {
    return [];
  }
}

function identificarSkin(bytes: number[], variante: "classic" | "slim"): string {
  let hash = 2166136261;
  bytes.forEach((byte) => {
    hash ^= byte;
    hash = Math.imul(hash, 16777619);
  });
  return `${(hash >>> 0).toString(16)}:${variante}`;
}

function bytesParaDataUrl(bytes: number[]): string {
  let binario = "";
  for (let indice = 0; indice < bytes.length; indice += 8192) {
    binario += String.fromCharCode(...bytes.slice(indice, indice + 8192));
  }
  return `data:image/png;base64,${btoa(binario)}`;
}

export function SkinManager({ user }: SkinManagerProps) {
  const [dragActive, setDragActive] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [modoEditor, setModoEditor] = useState<"skin" | "capa">("skin");
  const inputRef = useRef<HTMLInputElement>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading" | "success" | "error">(
    "idle"
  );
  const [variant, setVariant] = useState<"classic" | "slim">("classic");
  const [variantOriginal, setVariantOriginal] = useState<"classic" | "slim">("classic");
  const [aplicandoSkinPadrao, setAplicandoSkinPadrao] = useState<string | null>(null);
  const [mensagemStatus, setMensagemStatus] = useState<string | null>(null);
  const [erroStatus, setErroStatus] = useState<string | null>(null);
  const [cachePreview, setCachePreview] = useState(() => Date.now());
  const [skinAtualUrl, setSkinAtualUrl] = useState<string | null>(null);
  const [skinAtualDataUrl, setSkinAtualDataUrl] = useState<string | null>(null);
  const [previewArquivoUrl, setPreviewArquivoUrl] = useState<string | null>(null);
  const [capas, setCapas] = useState<CapaMinecraft[]>([]);
  const [capaSelecionadaId, setCapaSelecionadaId] = useState<string | null>(null);
  const [capaOriginalId, setCapaOriginalId] = useState<string | null>(null);
  const [skinsSalvas, setSkinsSalvas] = useState<SkinSalva[]>(carregarSkinsSalvas);
  const [nomeNovaSkin, setNomeNovaSkin] = useState("Minha skin");
  const [skinEditandoId, setSkinEditandoId] = useState<string | null>(null);
  const [skinAtualId, setSkinAtualId] = useState<string | null>(null);
  const [menuSkin, setMenuSkin] = useState<{ skin: SkinSalva; x: number; y: number } | null>(null);
  const [modoSeguro3d, setModoSeguro3d] = useState(
    () => localStorage.getItem(CHAVE_MODO_SEGURO_SKINS) === "true",
  );

  const ativarModoSeguro3d = useCallback(() => {
    localStorage.setItem(CHAVE_MODO_SEGURO_SKINS, "true");
    setModoSeguro3d(true);
  }, []);

  const previewSkinUrl = useMemo(() => {
    if (!user) return "";
    return skinAtualDataUrl || skinAtualUrl || SKINS_PADRAO[0].textureUrl;
  }, [cachePreview, skinAtualDataUrl, skinAtualUrl, user]);
  const previewEditorUrl = useMemo(
    () => previewArquivoUrl || previewSkinUrl,
    [previewArquivoUrl, previewSkinUrl]
  );

  useEffect(() => {
    if (!selectedFile) {
      setPreviewArquivoUrl(null);
      return;
    }
    let cancelado = false;
    const leitor = new FileReader();
    leitor.onload = () => {
      if (!cancelado && typeof leitor.result === "string") setPreviewArquivoUrl(leitor.result);
    };
    leitor.readAsDataURL(selectedFile);
    return () => {
      cancelado = true;
      leitor.abort();
    };
  }, [selectedFile]);

  const carregarCosmeticos = useCallback(async () => {
    if (!user) return;
    try {
      const [resultadoCosmeticos, resultadoSkin] = await Promise.allSettled([
        invoke<CosmeticosSkin>("obter_cosmeticos_skin", {
          accessToken: user.access_token,
        }),
        invoke<SkinAtualBaixada>("baixar_skin_atual", {
          accessToken: user.access_token,
        }),
      ]);
      if (resultadoCosmeticos.status === "fulfilled") {
        const cosmeticos = resultadoCosmeticos.value;
        setVariant(cosmeticos.variant);
        setVariantOriginal(cosmeticos.variant);
        setSkinAtualUrl(cosmeticos.skinUrl || null);
        setCapas(cosmeticos.capes || []);
        const capaAtiva = cosmeticos.capes.find((capa) => capa.state.toLowerCase() === "active");
        setCapaSelecionadaId(capaAtiva?.id || null);
        setCapaOriginalId(capaAtiva?.id || null);
      }
      if (resultadoSkin.status === "rejected") {
        setErroStatus("Não foi possível baixar sua skin. A prévia usa a textura disponível; tente reabrir a aba.");
        return;
      }
      const skinAtual = resultadoSkin.value;
      setVariant(skinAtual.variant);
      setVariantOriginal(skinAtual.variant);
      setSkinAtualDataUrl(bytesParaDataUrl(skinAtual.bytes));
      const idAtual = identificarSkin(skinAtual.bytes, skinAtual.variant);
      setSkinAtualId(idAtual);
      setSkinsSalvas((atuais) => {
        const existente = atuais.find((skin) => skin.id === idAtual);
        const atualizada: SkinSalva = existente || {
          id: idAtual,
          nome: `Skin de ${user.name}`,
          variant: skinAtual.variant,
          bytes: skinAtual.bytes,
          salvaEm: Date.now(),
        };
        const lista = [atualizada, ...atuais.filter((skin) => skin.id !== idAtual)].slice(0, 12);
        localStorage.setItem(CHAVE_SKINS_SALVAS, JSON.stringify(lista));
        return lista;
      });
    } catch (erro) {
      console.warn("Não foi possível carregar skins e capas:", erro);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;

    let ativo = true;
    void carregarCosmeticos().then(() => {
      if (!ativo) return;
    });

    return () => {
      ativo = false;
    };
  }, [cachePreview, carregarCosmeticos, user]);

  if (!user) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="max-w-lg rounded-2xl border border-white/10 bg-[#121214] p-8 text-center">
          <h2 className="text-2xl font-bold">Faça login para gerenciar skins</h2>
          <p className="mt-2 text-sm text-white/55">
            Entre com sua conta Microsoft para enviar e trocar skins.
          </p>
        </div>
      </div>
    );
  }

  const limparMensagens = () => {
    setMensagemStatus(null);
    setErroStatus(null);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      openUploadModal(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const arquivo = e.target.files[0];
      if (isUploadModalOpen && modoEditor === "skin") {
        setSelectedFile(arquivo);
        setUploadStatus("idle");
        if (!skinEditandoId && nomeNovaSkin === "Minha skin") {
          setNomeNovaSkin(arquivo.name.replace(/\.png$/i, "").trim() || "Minha skin");
        }
      } else {
        openUploadModal(arquivo);
      }
      e.target.value = "";
    }
  };

  const openUploadModal = (file: File) => {
    limparMensagens();
    setSelectedFile(file);
    setNomeNovaSkin(file.name.replace(/\.png$/i, "").trim() || "Minha skin");
    setSkinEditandoId(null);
    setModoEditor("skin");
    setIsUploadModalOpen(true);
    setUploadStatus("idle");
  };

  const abrirEditorSkin = () => {
    limparMensagens();
    setSelectedFile(null);
    setNomeNovaSkin("Minha skin");
    setSkinEditandoId(null);
    setModoEditor("skin");
    setIsUploadModalOpen(true);
    setUploadStatus("idle");
  };

  const abrirEditorCapa = () => {
    limparMensagens();
    setSelectedFile(null);
    setSkinEditandoId(null);
    setModoEditor("capa");
    setIsUploadModalOpen(true);
    setUploadStatus("idle");
  };

  const persistirSkinsSalvas = (criarLista: (atuais: SkinSalva[]) => SkinSalva[]) => {
    setSkinsSalvas((atuais) => {
      const limitadas = criarLista(atuais).slice(0, 12);
      localStorage.setItem(CHAVE_SKINS_SALVAS, JSON.stringify(limitadas));
      return limitadas;
    });
  };

  const salvarSkinNaBiblioteca = (
    bytes: number[],
    varianteSkin: "classic" | "slim",
    nome: string,
    idAnterior?: string | null,
  ) => {
    const id = identificarSkin(bytes, varianteSkin);
    persistirSkinsSalvas((atuais) => [
      {
        id,
        nome: nome.trim() || "Minha skin",
        variant: varianteSkin,
        bytes,
        salvaEm: Date.now(),
      },
      ...atuais.filter(
        (skin) => skin.id !== id && (skin.id !== idAnterior || skin.id === skinAtualId)
      ),
    ]);
  };

  const abrirEditorSkinSalva = (skin: SkinSalva) => {
    limparMensagens();
    const arquivo = new File(
      [new Uint8Array(skin.bytes)],
      `${skin.nome.trim() || "skin-salva"}.png`,
      { type: "image/png" },
    );
    setSelectedFile(arquivo);
    setNomeNovaSkin(skin.nome);
    setVariant(skin.variant);
    setSkinEditandoId(skin.id);
    setModoEditor("skin");
    setUploadStatus("idle");
    setIsUploadModalOpen(true);
  };

  const excluirSkinSalva = (skin: SkinSalva) => {
    if (!window.confirm(`Excluir "${skin.nome}" das skins salvas?`)) return;

    persistirSkinsSalvas((atuais) => atuais.filter((item) => item.id !== skin.id));
    if (skin.id === skinAtualId) setSkinAtualId(null);
  };

  const preservarSkinAtual = async () => {
    if (!user) return;
    try {
      const atual = await invoke<SkinAtualBaixada>("baixar_skin_atual", {
        accessToken: user.access_token,
      });
      const id = identificarSkin(atual.bytes, atual.variant);
      persistirSkinsSalvas((atuais) => {
        if (atuais.some((skin) => skin.id === id)) return atuais;
        return [
          {
            id,
            nome: `Skin de ${new Date().toLocaleDateString("pt-BR")}`,
            variant: atual.variant,
            bytes: atual.bytes,
            salvaEm: Date.now(),
          },
          ...atuais,
        ];
      });
    } catch (erro) {
      console.warn("Não foi possível preservar a skin anterior:", erro);
    }
  };

  const enviarSkin = async (
    bytes: number[],
    variante: "classic" | "slim",
    preservarAnterior = true
  ) => {
    if (preservarAnterior) await preservarSkinAtual();
    await invoke("upload_skin", {
      accessToken: user.access_token,
      variant: variante,
      skinBytes: bytes,
    });
    setCachePreview(Date.now());
    await carregarCosmeticos();
  };

  const aplicarSkinPadrao = async (skin: SkinPadrao) => {
    limparMensagens();
    setAplicandoSkinPadrao(skin.textureUrl);
    setVariant(skin.variant);
    try {
      const resposta = await fetch(skin.textureUrl);
      if (!resposta.ok) {
        throw new Error(`Falha ao baixar skin padrão (${resposta.status})`);
      }
      const bytesBuffer = await resposta.arrayBuffer();
      const bytes = Array.from(new Uint8Array(bytesBuffer));
      await enviarSkin(bytes, skin.variant);
      setMensagemStatus(`Skin ${skin.name} aplicada com sucesso.`);
    } catch (erro) {
      console.error("Erro ao aplicar skin padrão:", erro);
      setErroStatus(`Não foi possível aplicar a skin ${skin.name}.`);
    } finally {
      setAplicandoSkinPadrao(null);
    }
  };

  const aplicarSkinSalva = async (skin: SkinSalva) => {
    limparMensagens();
    setAplicandoSkinPadrao(skin.id);
    try {
      await enviarSkin(skin.bytes, skin.variant);
      setVariant(skin.variant);
      setMensagemStatus("Skin salva aplicada.");
    } catch (erro) {
      console.error("Erro ao aplicar skin salva:", erro);
      setErroStatus("Não foi possível aplicar a skin salva.");
    } finally {
      setAplicandoSkinPadrao(null);
    }
  };

  const baixarSkinSalva = (skin: SkinSalva) => {
    const blob = new Blob([new Uint8Array(skin.bytes)], { type: "image/png" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${skin.nome.trim() || "skin"}.png`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const salvarEditorAtual = async () => {
    setUploadStatus("uploading");
    limparMensagens();
    try {
      if (selectedFile) {
        const arrayBuffer = await selectedFile.arrayBuffer();
        const bytes = Array.from(new Uint8Array(arrayBuffer));
        if (!skinEditandoId) {
          await enviarSkin(bytes, variant);
        }
        salvarSkinNaBiblioteca(bytes, variant, nomeNovaSkin, skinEditandoId);
      } else if (variant !== variantOriginal) {
        const atual = await invoke<SkinAtualBaixada>("baixar_skin_atual", {
          accessToken: user.access_token,
        });
        await enviarSkin(atual.bytes, variant);
      }
      if (!skinEditandoId && capaSelecionadaId !== capaOriginalId) {
        await invoke("equipar_capa", {
          accessToken: user.access_token,
          capeId: capaSelecionadaId,
        });
      }
      if (!skinEditandoId) await carregarCosmeticos();
      setUploadStatus("success");
      setMensagemStatus(skinEditandoId ? "Skin salva atualizada." : "Visual atualizado.");
      setTimeout(() => {
        setIsUploadModalOpen(false);
        setSkinEditandoId(null);
      }, 700);
    } catch (erro) {
      console.error("Erro ao atualizar skin e capa:", erro);
      setUploadStatus("error");
      setErroStatus("Não foi possível atualizar a skin e a capa.");
    }
  };

  const capaAtualUrl = capas.find((capa) => capa.id === capaSelecionadaId)?.url;

  return (
    <div className="relative mx-auto grid w-full max-w-[900px] grid-cols-1 gap-8 overflow-hidden p-8 lg:grid-cols-[1fr_2.5fr]">
      <div className="flex h-full flex-col items-center justify-center">
        <div className="group relative z-10 flex w-full cursor-grab flex-col items-center active:cursor-grabbing">
          <span className="mb-4 rounded border border-white/5 bg-black/40 px-3 py-1 text-xs text-white/70">
            {user.name}
          </span>

          <div className="flex h-[400px] w-full items-center justify-center drop-shadow-2xl transition-transform duration-500 hover:scale-105">
            {modoSeguro3d ? (
              <MiniaturaSkinMinecraft
                skinUrl={previewSkinUrl}
                modelo={variant}
                className="h-[78%] w-auto [image-rendering:pixelated]"
              />
            ) : (
              <SkinPreviewRenderer
                skinUrl={previewSkinUrl}
                capeUrl={capaAtualUrl}
                model={variant}
                height={450}
                width={300}
                onFalhaWebgl={ativarModoSeguro3d}
              />
            )}
          </div>

          <span className="pointer-events-none mt-4 text-xs font-bold uppercase tracking-widest text-white/20 transition-colors group-hover:text-white/40">
            Arraste para girar
          </span>

          <button
            onClick={abrirEditorCapa}
            className="mt-6 flex items-center gap-2 rounded-lg border border-white/5 bg-[#1c1c1c] px-4 py-2 text-sm font-bold text-white/70 transition-all hover:bg-[#252525] hover:text-white"
          >
            Trocar capa
          </button>
        </div>
      </div>

      <div className="custom-scrollbar space-y-8 overflow-y-auto pr-4">
        {(mensagemStatus || erroStatus) && (
          <div
            className={cn(
              "rounded-xl border px-4 py-3 text-sm",
              erroStatus
                ? "border-red-400/30 bg-red-500/10 text-red-200"
                : "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
            )}
          >
            {erroStatus || mensagemStatus}
          </div>
        )}

        <section>
          <h2 className="mb-4 text-lg font-bold text-white/90">Skins salvas</h2>
          <div className="grid grid-cols-[repeat(auto-fill,84px)] justify-start gap-4">
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              accept=".png"
              onChange={handleFileChange}
            />
            <button
              type="button"
              onClick={abrirEditorSkin}
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              className={cn(
                "group grid min-w-0 aspect-[0.85] cursor-pointer place-items-center overflow-hidden rounded-xl border-2 border-dashed text-center transition-all",
                dragActive
                  ? "border-emerald-500 bg-emerald-500/10"
                  : "border-white/10 bg-[#121214] hover:border-white/20 hover:bg-[#18181b]"
              )}
            >
              <div className="flex min-w-0 max-w-full flex-col items-center justify-center gap-3 px-2">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/5 text-2xl font-light text-white/50 transition-transform group-hover:scale-110">
                  +
                </span>
                <span className="block max-w-full text-[clamp(9px,1.15vw,14px)] font-bold leading-[1.05] text-white/50 transition-colors group-hover:text-white">
                  <span className="block truncate">Adicionar</span>
                  <span className="block truncate">skin</span>
                </span>
              </div>
            </button>

            {skinsSalvas.map((skin) => {
              const carregando = aplicandoSkinPadrao === skin.id;
              const ativa = skin.id === skinAtualId;
              return (
                <div
                  key={skin.id}
                  title={skin.nome}
                  className={cn(
                    "group relative aspect-[0.85] overflow-hidden rounded-xl border-2 bg-[#121214] transition-colors",
                    ativa
                      ? "border-emerald-500/70 bg-emerald-500/[0.04]"
                      : "border-white/8 hover:border-white/20"
                  )}
                >
                  <button
                    type="button"
                    onClick={(evento) => setMenuSkin({ skin, x: evento.clientX, y: evento.clientY })}
                    onContextMenu={(evento) => {
                      evento.preventDefault();
                      setMenuSkin({ skin, x: evento.clientX, y: evento.clientY });
                    }}
                    disabled={Boolean(aplicandoSkinPadrao)}
                    aria-label={`Abrir ações de ${skin.nome}`}
                    className="absolute inset-0 flex items-center justify-center p-3 disabled:opacity-50"
                  >
                    <MiniaturaSkinMinecraft
                      skinUrl={bytesParaDataUrl(skin.bytes)}
                      modelo={skin.variant}
                      className="pointer-events-none h-[82%] w-auto max-w-full transition-transform group-hover:scale-105"
                    />
                  </button>
                  {carregando && (
                    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/65">
                      <Loader2 size={20} className="animate-spin text-emerald-400" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-lg font-bold text-white/90">Skins padrão</h2>
          <div className="grid grid-cols-[repeat(auto-fill,68px)] justify-start gap-4">
            {SKINS_PADRAO.map((skin) => {
              const carregando = aplicandoSkinPadrao === skin.textureUrl;
              return (
                <button
                  key={skin.name}
                  onClick={() => aplicarSkinPadrao(skin)}
                  disabled={Boolean(aplicandoSkinPadrao)}
                  className="group relative flex aspect-[0.85] cursor-pointer flex-col items-center justify-center overflow-hidden rounded-xl border border-white/5 bg-[#121214] p-4 text-left transition-all hover:border-white/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {carregando && (
                    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/65">
                      <Loader2 size={20} className="animate-spin text-emerald-400" />
                    </div>
                  )}
                  <MiniaturaSkinMinecraft
                    skinUrl={skin.textureUrl}
                    modelo={skin.variant}
                    className="h-[90%] w-auto [image-rendering:pixelated] grayscale transition-all duration-300 group-hover:scale-110 group-hover:grayscale-0"
                  />
                  <div className="absolute bottom-2 left-0 right-0 text-center opacity-0 transition-opacity group-hover:opacity-100">
                    <span className="rounded bg-black/50 px-2 py-1 text-[10px] font-bold uppercase tracking-widest">
                      {skin.name}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      </div>

      <MenuContextual
        aberto={menuSkin !== null}
        x={menuSkin?.x ?? 0}
        y={menuSkin?.y ?? 0}
        onFechar={() => setMenuSkin(null)}
        rotulo="Ações da skin salva"
      >
        {menuSkin && (
          <>
            <CabecalhoMenuContextual
              titulo={menuSkin.skin.nome}
              subtitulo={menuSkin.skin.variant === "slim" ? "Modelo slim" : "Modelo padrão"}
            />
            <ItemMenuContextual
              icone={<Check size={13} />}
              destaque
              disabled={menuSkin.skin.id === skinAtualId || Boolean(aplicandoSkinPadrao)}
              sufixo={menuSkin.skin.id === skinAtualId ? "Atual" : undefined}
              onClick={() => {
                const skin = menuSkin.skin;
                setMenuSkin(null);
                void aplicarSkinSalva(skin);
              }}
            >
              Aplicar
            </ItemMenuContextual>
            <ItemMenuContextual icone={<Download size={13} />} onClick={() => {
              baixarSkinSalva(menuSkin.skin);
              setMenuSkin(null);
            }}>
              Baixar PNG
            </ItemMenuContextual>
            <ItemMenuContextual icone={<Pencil size={13} />} onClick={() => {
              abrirEditorSkinSalva(menuSkin.skin);
              setMenuSkin(null);
            }}>
              Editar
            </ItemMenuContextual>
            <SeparadorMenuContextual />
            <ItemMenuContextual icone={<Trash2 size={13} />} perigo onClick={() => {
              const skin = menuSkin.skin;
              setMenuSkin(null);
              excluirSkinSalva(skin);
            }} disabled={menuSkin.skin.id === skinAtualId} sufixo={
              menuSkin.skin.id === skinAtualId ? "Em uso" : undefined
            }>
              Excluir da lista
            </ItemMenuContextual>
          </>
        )}
      </MenuContextual>

      <AnimatePresence>
        {isUploadModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.96, opacity: 0, y: 12 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.96, opacity: 0, y: 12 }}
              className="relative grid max-h-[88vh] w-full max-w-3xl grid-cols-1 overflow-hidden rounded-2xl border border-white/10 bg-[#111113] shadow-2xl md:grid-cols-[0.8fr_1.2fr]"
            >
              <button
                onClick={() => {
                  setIsUploadModalOpen(false);
                  setSkinEditandoId(null);
                }}
                className="absolute right-4 top-4 z-20 rounded-lg p-1.5 text-white/30 transition-colors hover:bg-white/8 hover:text-white"
              >
                <X size={20} />
              </button>

              <div className="relative min-h-72 border-b border-white/8 bg-[radial-gradient(circle_at_50%_42%,rgba(52,211,153,0.09),transparent_58%)] md:border-b-0 md:border-r">
                {modoSeguro3d ? (
                  <MiniaturaSkinMinecraft
                    skinUrl={previewEditorUrl}
                    modelo={variant}
                    className="mx-auto h-64 w-auto [image-rendering:pixelated]"
                  />
                ) : (
                  <SkinPreviewRenderer
                    skinUrl={previewEditorUrl}
                    capeUrl={capas.find((capa) => capa.id === capaSelecionadaId)?.url}
                    model={variant}
                    className="h-full min-h-72"
                    onFalhaWebgl={ativarModoSeguro3d}
                  />
                )}
                <div className="pointer-events-none absolute inset-x-0 bottom-4 text-center text-[9px] font-bold uppercase tracking-[0.18em] text-white/25">
                  Arraste para visualizar
                </div>
              </div>

              <div className="custom-scrollbar max-h-[88vh] overflow-y-auto p-6">
                <div className="mb-6 pr-8">
                  <p className="text-[9px] font-black uppercase tracking-[0.2em] text-emerald-400/75">
                    Aparência
                  </p>
                  <h3 className="mt-1 text-xl font-bold">
                    {modoEditor === "skin"
                      ? skinEditandoId
                        ? "Editar skin salva"
                        : "Editar skin"
                      : "Escolher capa"}
                  </h3>
                </div>

                <div className="space-y-5">
                  {modoEditor === "skin" && (
                    <>
                      <section>
                        <span className="mb-2 block text-xs font-bold text-white/65">
                          Nome da skin
                        </span>
                        <input
                          type="text"
                          value={nomeNovaSkin}
                          onChange={(evento) => setNomeNovaSkin(evento.target.value)}
                          maxLength={40}
                          className="w-full rounded-lg border border-white/8 bg-black/20 px-3 py-2 text-sm text-white/75 outline-none transition-colors focus:border-emerald-400/35"
                          placeholder="Minha skin"
                        />
                      </section>

                      <section>
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <span className="text-xs font-bold text-white/65">Textura</span>
                          <button
                            type="button"
                            onClick={() => inputRef.current?.click()}
                            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/4 px-2.5 py-1.5 text-[10px] font-bold text-white/60 transition-colors hover:bg-white/8 hover:text-white"
                          >
                            <Upload size={12} />
                            {selectedFile ? "Substituir" : "Escolher PNG"}
                          </button>
                        </div>
                        <div className="truncate rounded-lg border border-white/7 bg-black/20 px-3 py-2 text-[11px] text-white/40">
                          {selectedFile?.name || "Skin atual"}
                        </div>
                      </section>

                      <section>
                        <span className="mb-2 block text-xs font-bold text-white/65">Braços</span>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => setVariant("classic")}
                            className={cn(
                              "rounded-lg border px-3 py-2 text-xs font-bold transition-colors",
                              variant === "classic"
                                ? "border-emerald-400/30 bg-emerald-400/8 text-emerald-200"
                                : "border-white/8 bg-white/3 text-white/40 hover:bg-white/6"
                            )}
                          >
                            Normal
                          </button>
                          <button
                            type="button"
                            onClick={() => setVariant("slim")}
                            className={cn(
                              "rounded-lg border px-3 py-2 text-xs font-bold transition-colors",
                              variant === "slim"
                                ? "border-emerald-400/30 bg-emerald-400/8 text-emerald-200"
                                : "border-white/8 bg-white/3 text-white/40 hover:bg-white/6"
                            )}
                          >
                            Slim
                          </button>
                        </div>
                      </section>
                    </>
                  )}

                  {modoEditor === "capa" && <section>
                    <span className="mb-2 block text-xs font-bold text-white/65">Capa</span>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => setCapaSelecionadaId(null)}
                        className={cn(
                          "flex min-h-16 items-center justify-center rounded-lg border text-[10px] font-bold transition-colors",
                          capaSelecionadaId === null
                            ? "border-emerald-400/30 bg-emerald-400/8 text-emerald-200"
                            : "border-white/8 bg-white/3 text-white/35 hover:bg-white/6"
                        )}
                      >
                        Sem capa
                      </button>
                      {capas.map((capa) => (
                        <button
                          type="button"
                          key={capa.id}
                          onClick={() => setCapaSelecionadaId(capa.id)}
                          title={capa.alias || "Capa"}
                          className={cn(
                            "relative flex min-h-16 items-center justify-center overflow-hidden rounded-lg border p-2 transition-colors",
                            capaSelecionadaId === capa.id
                              ? "border-emerald-400/30 bg-emerald-400/8"
                              : "border-white/8 bg-white/3 hover:bg-white/6"
                          )}
                        >
                          <MiniaturaCapaMinecraft
                            capaUrl={capa.url}
                            className="h-14 w-auto [image-rendering:pixelated] drop-shadow-lg"
                          />
                          <span className="absolute inset-x-1 bottom-1 truncate text-center text-[8px] font-bold text-white/45">
                            {capa.alias || "Capa"}
                          </span>
                        </button>
                      ))}
                    </div>
                    {capas.length === 0 && (
                      <p className="mt-2 text-[10px] text-white/30">
                        Sua conta não possui capas disponíveis.
                      </p>
                    )}
                  </section>}

                  <button
                    type="button"
                    onClick={() => void salvarEditorAtual()}
                    disabled={uploadStatus === "uploading"}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 py-3 text-sm font-black text-black transition-colors hover:bg-emerald-400 disabled:opacity-50"
                  >
                    {uploadStatus === "uploading" && (
                      <Loader2 className="animate-spin" size={16} />
                    )}
                    {uploadStatus === "success"
                      ? "Atualizado"
                      : modoEditor === "skin"
                        ? skinEditandoId
                          ? "Salvar alterações"
                          : "Aplicar skin"
                        : "Aplicar capa"}
                  </button>
                  {uploadStatus === "error" && (
                    <p className="text-center text-[10px] text-red-300/80">
                      Não foi possível aplicar as alterações.
                    </p>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
