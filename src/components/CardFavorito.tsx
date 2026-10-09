import type { MouseEvent } from 'react';
import { motion } from 'framer-motion';
import { Download, Trash2 } from '../iconesPixelados';
import { obterImagemProjeto } from '../lib/imagemProjeto';
import { useArrastoItem } from '../hooks/useArrastoItem';
import { chaveFavorito } from '../services/colecaoFavoritos';
import type { FavoriteItem } from './Favorites';

interface CardFavoritoProps {
    item: FavoriteItem;
    grupoId: string;
    instalando: boolean;
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
    item, grupoId, instalando, arrastando, onAbrir, onRemover, onMenu,
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
        className="group relative cursor-grab rounded-xl border border-white/5 bg-white/3 p-4
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
        <div className="mt-3 flex gap-2">
            <button disabled={instalando || item.indisponivel} onClick={(evento) => {
                evento.stopPropagation(); onAbrir(item, true);
            }} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500
                px-3 py-2 text-sm font-bold text-black disabled:opacity-50">
                <Download size={14} />{instalando ? 'Instalando' : 'Instalar'}
            </button>
            <button aria-label={`Remover ${item.title} dos favoritos`} onClick={(evento) => {
                evento.stopPropagation(); onRemover(item);
            }} className="rounded-xl bg-white/5 p-2 text-white/40 hover:text-red-400"><Trash2 size={16} /></button>
        </div>
    </motion.div>;
}
