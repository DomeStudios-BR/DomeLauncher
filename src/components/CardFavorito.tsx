import type { MouseEvent } from 'react';
import { motion } from 'framer-motion';
import { Check, Download, Trash2 } from '../iconesPixelados';
import { cn } from '../lib/utils';
import { obterImagemProjeto } from '../lib/imagemProjeto';
import { useArrastoItem } from '../hooks/useArrastoItem';
import { chaveFavorito } from '../services/colecaoFavoritos';
import type { FavoriteItem } from './Favorites';

interface CardFavoritoProps {
    item: FavoriteItem;
    grupoId: string;
    instalando: boolean;
    instalado: boolean;
    verificandoInstalacao: boolean;
    arrastando: boolean;
    onAbrir: (item: FavoriteItem, instalarAgora?: boolean) => void;
    onRemover: (item: FavoriteItem) => void;
    onMenu: (evento: MouseEvent, item: FavoriteItem) => void;
    onIniciarArrasto: (id: string) => void;
    onMoverArrasto: (id: string, x: number, y: number) => void;
    onFinalizarArrasto: (id?: string, x?: number, y?: number) => void;
}
const TIPOS = { mod: 'Mods', modpack: 'Modpacks', resourcepack: 'Texturas', shader: 'Shaders' };

export default function CardFavorito({
    item, grupoId, instalando, instalado, verificandoInstalacao, arrastando, onAbrir, onRemover, onMenu,
    onIniciarArrasto, onMoverArrasto, onFinalizarArrasto,
}: CardFavoritoProps) {
    const arrasto = useArrastoItem({
        itemId: chaveFavorito(item), onIniciar: onIniciarArrasto,
        onMover: onMoverArrasto, onFinalizar: onFinalizarArrasto,
    });
    return <motion.div layout="position" initial={false}
        animate={{ opacity: arrastando ? 0.35 : 1 }}
        transition={{ layout: { duration: 0.18, ease: 'easeOut' }, opacity: { duration: 0.1 } }}
        onPointerDown={(evento) => {
            if ((evento.target as HTMLElement).closest('button, input, select, a')) return;
            arrasto.aoPressionar(evento);
        }} onClick={() => { if (!arrasto.consumirCliqueArrasto()) onAbrir(item); }}
        onContextMenu={(evento) => onMenu(evento, item)} data-favorito-id={chaveFavorito(item)}
        data-grupo-id={grupoId} data-modo-visualizacao="grid"
        className="group relative flex h-full cursor-grab flex-col rounded-xl border border-white/5 bg-white/3 p-4
            transition-colors hover:border-white/10 hover:bg-white/5 active:cursor-grabbing">
        <div className="flex gap-3">
            <img draggable={false} src={obterImagemProjeto(item.icon_url, item.type, item.id)} alt=""
                className="h-14 w-14 shrink-0 rounded-xl object-cover" />
            <div className="min-w-0">
                <h3 className="truncate font-bold">{item.title}</h3>
                <p className="text-xs text-white/40">{item.author}</p>
                <p className="mt-1 text-xs text-white/50">
                    {item.indisponivel ? 'Projeto indisponível' : TIPOS[item.type]} · {item.source}
                </p>
            </div>
        </div>
        <p className="mt-3 line-clamp-2 text-sm text-white/50">{item.description}</p>
        <div className="mt-auto flex justify-end gap-2 pt-3">
            <button type="button" aria-label={`Remover ${item.title} dos favoritos`} onClick={(evento) => {
                evento.stopPropagation(); onRemover(item);
            }} className="shrink-0 rounded-xl bg-white/5 p-2 text-white/40 transition-colors
                hover:text-red-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-400">
                <Trash2 size={16} />
            </button>
            <button type="button" disabled={instalado || instalando || verificandoInstalacao || item.indisponivel}
                onClick={(evento) => {
                evento.stopPropagation(); onAbrir(item, true);
            }} className={cn(
                'flex items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold text-black',
                'transition-all active:scale-95 disabled:cursor-default disabled:opacity-50',
                'disabled:active:scale-100 focus-visible:outline focus-visible:outline-2',
                'focus-visible:outline-emerald-400',
                instalado ? 'bg-amber-400' : 'bg-emerald-500 hover:bg-emerald-400',
            )}>
                {instalado ? <Check size={14} /> : <Download size={14} />}
                {instalado ? 'Instalado' : instalando ? 'Instalando...' : 'Instalar'}
            </button>
        </div>
    </motion.div>;
}
