import { useState, useEffect, useMemo } from "react";
import {
  Heart,
  Package,
  Image,
  Sparkles,
  Trash2,
  ExternalLink,
  Search,
  Filter,
  Copy,
} from "../iconesPixelados";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "../lib/utils";
import type { ProjetoConteudo } from "./ProjetoDetalheModal";
import { obterImagemProjeto } from "../lib/imagemProjeto";
import {
  CabecalhoMenuContextual,
  ItemMenuContextual,
  MenuContextual,
  SeparadorMenuContextual,
} from "./context-menu/MenuContextual";

export interface FavoriteItem {
  id: string;
  title: string;
  description: string;
  icon_url: string;
  author: string;
  type: "mod" | "modpack" | "resourcepack" | "shader";
  source: "modrinth" | "curseforge";
  slug: string;
  downloads?: number;
}

const STORAGE_KEY = "dome_favorites";

export function loadFavorites(): FavoriteItem[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function saveFavorites(favorites: FavoriteItem[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites));
}

export function addFavorite(item: FavoriteItem) {
  const favorites = loadFavorites();
  if (!favorites.find((f) => f.id === item.id)) {
    favorites.push(item);
    saveFavorites(favorites);
  }
}

export function removeFavorite(id: string) {
  const favorites = loadFavorites().filter((f) => f.id !== id);
  saveFavorites(favorites);
}

export function isFavorite(id: string): boolean {
  return loadFavorites().some((f) => f.id === id);
}

const TYPE_ICONS = {
  mod: Package,
  modpack: Package,
  resourcepack: Image,
  shader: Sparkles,
};

const TYPE_LABELS = {
  mod: "Mod",
  modpack: "Modpack",
  resourcepack: "Resource Pack",
  shader: "Shader",
};

// Opções de filtro por tipo
type FiltroTipo = "todos" | "mod" | "modpack" | "resourcepack" | "shader";
type FiltroFonte = "todos" | "modrinth" | "curseforge";

const FILTROS_TIPO: { id: FiltroTipo; label: string; icon: typeof Package }[] = [
  { id: "todos", label: "Todos", icon: Heart },
  { id: "modpack", label: "Modpacks", icon: Package },
  { id: "mod", label: "Mods", icon: Package },
  { id: "resourcepack", label: "Textures", icon: Image },
  { id: "shader", label: "Shaders", icon: Sparkles },
];

interface FavoritesProps {
  onAbrirProjeto: (projeto: ProjetoConteudo) => void;
}

export default function Favorites({ onAbrirProjeto }: FavoritesProps) {
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [busca, setBusca] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<FiltroTipo>("todos");
  const [filtroFonte, setFiltroFonte] = useState<FiltroFonte>("todos");
  const [menuContexto, setMenuContexto] = useState<{
    item: FavoriteItem;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    setFavorites(loadFavorites());
  }, []);

  // Aplicar filtros e busca
  const favoritosFiltrados = useMemo(() => {
    return favorites.filter((item) => {
      // Filtro por tipo
      if (filtroTipo !== "todos" && item.type !== filtroTipo) return false;
      // Filtro por fonte
      if (filtroFonte !== "todos" && item.source !== filtroFonte) return false;
      // Busca por texto
      if (busca.trim()) {
        const termo = busca.toLowerCase();
        return (
          item.title.toLowerCase().includes(termo) ||
          item.author.toLowerCase().includes(termo) ||
          item.description.toLowerCase().includes(termo)
        );
      }
      return true;
    });
  }, [favorites, filtroTipo, filtroFonte, busca]);

  // Contadores para badges dos filtros
  const contadores = useMemo(() => {
    const cont: Record<string, number> = { todos: favorites.length };
    favorites.forEach((item) => {
      cont[item.type] = (cont[item.type] || 0) + 1;
      cont[item.source] = (cont[item.source] || 0) + 1;
    });
    return cont;
  }, [favorites]);

  const handleRemove = (id: string) => {
    removeFavorite(id);
    setFavorites(loadFavorites());
  };

  const obterUrlProjeto = (item: FavoriteItem) =>
      item.source === "modrinth"
        ? `https://modrinth.com/${item.type}/${item.slug}`
        : item.type === "modpack"
          ? `https://www.curseforge.com/minecraft/modpacks/${item.slug}`
          : item.type === "resourcepack"
            ? `https://www.curseforge.com/minecraft/texture-packs/${item.slug}`
            : item.type === "shader"
              ? `https://www.curseforge.com/minecraft/shaders/${item.slug}`
              : `https://www.curseforge.com/minecraft/mc-mods/${item.slug}`;

  const openProject = (item: FavoriteItem) => {
    window.open(obterUrlProjeto(item), "_blank");
  };

  const abrirDetalhes = (item: FavoriteItem) => {
    onAbrirProjeto({
      id: item.id,
      title: item.title,
      description: item.description,
      icon_url: item.icon_url,
      author: item.author,
      source: item.source,
      slug: item.slug,
      project_type: item.type,
    });
  };

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex items-center gap-3 mb-2">
        <div className="p-3 bg-pink-500/10 rounded-2xl border border-pink-500/20">
          <Heart className="text-pink-500" size={24} />
        </div>
        <div className="flex-1">
          <p className="text-xs uppercase tracking-wider text-white/35 font-bold">
            Sua coleção
          </p>
          <p className="text-white/40 text-sm">
            {favorites.length} {favorites.length === 1 ? "favorito" : "favoritos"}
          </p>
        </div>
      </div>

      {/* Barra de busca e filtros */}
      <div className="flex flex-col gap-4">
        {/* Busca */}
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-white/20" size={18} />
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar nos favoritos..."
            className="w-full bg-white/5 border border-white/10 rounded-2xl py-3 pl-11 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500/40 transition-all"
          />
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-4">
          {/* Filtro por tipo */}
          <div className="flex bg-white/5 p-1 rounded-xl border border-white/10">
            {FILTROS_TIPO.map((filtro) => (
              <button
                key={filtro.id}
                onClick={() => setFiltroTipo(filtro.id)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5",
                  filtroTipo === filtro.id
                    ? "bg-pink-500 text-white"
                    : "text-white/40 hover:text-white"
                )}
              >
                <filtro.icon size={12} />
                {filtro.label}
                {contadores[filtro.id] ? (
                  <span className="ml-1 text-[9px] opacity-70">
                    ({contadores[filtro.id]})
                  </span>
                ) : null}
              </button>
            ))}
          </div>

          <div className="flex-1" />

          {/* Filtro por fonte */}
          <div className="flex bg-white/5 p-1 rounded-xl border border-white/10">
            <button
              onClick={() => setFiltroFonte("todos")}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
                filtroFonte === "todos"
                  ? "bg-white/15 text-white"
                  : "text-white/40 hover:text-white"
              )}
            >
              <Filter size={12} className="inline mr-1" />
              Todas
            </button>
            <button
              onClick={() => setFiltroFonte("modrinth")}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
                filtroFonte === "modrinth"
                  ? "bg-emerald-500 text-black"
                  : "text-white/40 hover:text-white"
              )}
            >
              Modrinth
              {contadores.modrinth ? (
                <span className="ml-1 text-[9px] opacity-70">
                  ({contadores.modrinth})
                </span>
              ) : null}
            </button>
            <button
              onClick={() => setFiltroFonte("curseforge")}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-bold transition-all border",
                filtroFonte === "curseforge"
                  ? "bg-[#f16436] text-white border-[#f16436]"
                  : "text-white/40 hover:text-white border-transparent"
              )}
            >
              CurseForge
              {contadores.curseforge ? (
                <span className="ml-1 text-[9px] opacity-70">
                  ({contadores.curseforge})
                </span>
              ) : null}
            </button>
          </div>
        </div>
      </div>

      {/* Lista de favoritos */}
      {favorites.length === 0 ? (
        <div className="text-center py-20 border-2 border-dashed border-white/5 rounded-3xl">
          <Heart size={48} className="mx-auto mb-4 text-white/10" />
          <p className="text-white/40 font-bold">Nenhum favorito ainda</p>
          <p className="text-white/30 text-sm mt-1">
            Explore mods e modpacks e adicione aos favoritos
          </p>
        </div>
      ) : favoritosFiltrados.length === 0 ? (
        <div className="text-center py-16 border-2 border-dashed border-white/5 rounded-3xl">
          <Search size={40} className="mx-auto mb-4 text-white/10" />
          <p className="text-white/40 font-bold">Nenhum resultado</p>
          <p className="text-white/30 text-sm mt-1">
            Tente ajustar os filtros ou a busca
          </p>
        </div>
      ) : (
        <AnimatePresence>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {favoritosFiltrados.map((item) => {
              const TypeIcon = TYPE_ICONS[item.type] || Package;
              return (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  onClick={() => abrirDetalhes(item)}
                  onContextMenu={(evento) => {
                    evento.preventDefault();
                    evento.stopPropagation();
                    setMenuContexto({ item, x: evento.clientX, y: evento.clientY });
                  }}
                  className="bg-white/3 border border-white/5 rounded-2xl p-4 group hover:border-white/10 transition-all cursor-pointer"
                >
                  <div className="flex gap-4">
                    <img
                      src={obterImagemProjeto(item.icon_url, item.type, item.id)}
                      alt={item.title}
                      className="w-14 h-14 rounded-xl bg-black/40 object-cover shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <h3 className="font-bold truncate group-hover:text-emerald-400 transition-colors">
                        {item.title}
                      </h3>
                      <p className="text-xs text-white/40">por {item.author}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="bg-white/5 px-2 py-0.5 rounded text-[10px] font-bold uppercase flex items-center gap-1">
                          <TypeIcon size={10} />
                          {TYPE_LABELS[item.type]}
                        </span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                            item.source === "modrinth"
                              ? "bg-emerald-500/10 text-emerald-400"
                              : "bg-orange-500/10 text-orange-400"
                          }`}
                        >
                          {item.source}
                        </span>
                      </div>
                    </div>
                  </div>

                  <p className="text-sm text-white/50 line-clamp-2 mt-3">
                    {item.description}
                  </p>

                  <div className="flex gap-2 mt-4">
                    <button
                      onClick={(evento) => {
                        evento.stopPropagation();
                        openProject(item);
                      }}
                      className="px-3 bg-white/5 hover:bg-white/10 rounded-xl py-2 text-sm font-bold flex items-center justify-center gap-2 transition-all"
                    >
                      <ExternalLink size={14} />
                    </button>
                    <button
                      onClick={(evento) => {
                        evento.stopPropagation();
                        handleRemove(item.id);
                      }}
                      className="p-2 bg-white/5 hover:bg-red-500/20 text-white/40 hover:text-red-400 rounded-xl transition-all"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </AnimatePresence>
      )}

      <MenuContextual
        aberto={menuContexto !== null}
        x={menuContexto?.x ?? 0}
        y={menuContexto?.y ?? 0}
        onFechar={() => setMenuContexto(null)}
        rotulo="Ações do favorito"
      >
        {menuContexto && (
          <>
            <CabecalhoMenuContextual
              titulo={menuContexto.item.title}
              subtitulo={`${TYPE_LABELS[menuContexto.item.type]} · ${menuContexto.item.source}`}
            />
            <ItemMenuContextual icone={<Package size={13} />} onClick={() => {
              abrirDetalhes(menuContexto.item);
              setMenuContexto(null);
            }}>
              Ver detalhes
            </ItemMenuContextual>
            <ItemMenuContextual icone={<ExternalLink size={13} />} onClick={() => {
              openProject(menuContexto.item);
              setMenuContexto(null);
            }}>
              Abrir página do projeto
            </ItemMenuContextual>
            <ItemMenuContextual icone={<Copy size={13} />} onClick={() => {
              void navigator.clipboard.writeText(obterUrlProjeto(menuContexto.item));
              setMenuContexto(null);
            }}>
              Copiar link
            </ItemMenuContextual>
            <SeparadorMenuContextual />
            <ItemMenuContextual icone={<Trash2 size={13} />} perigo onClick={() => {
              handleRemove(menuContexto.item.id);
              setMenuContexto(null);
            }}>
              Remover dos favoritos
            </ItemMenuContextual>
          </>
        )}
      </MenuContextual>
    </div>
  );
}
