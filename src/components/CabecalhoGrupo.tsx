import type { MouseEvent, RefObject } from 'react';
import { ChevronDown, ChevronRight, FolderOpen, GripVertical, Pencil, Trash2 } from '../iconesPixelados';
import { cn } from '../lib/utils';

interface CabecalhoGrupoProps {
    nome: string;
    quantidade: number;
    recolhido: boolean;
    editando: boolean;
    nomeEditado: string;
    inputRef?: RefObject<HTMLInputElement | null>;
    podeExcluir: boolean;
    onAlternar: () => void;
    onRenomear: () => void;
    onNomeChange: (nome: string) => void;
    onNomeSalvar: () => void;
    onExcluir: () => void;
    onIniciarArrasto: (evento: MouseEvent) => void;
    onMenuContexto: (evento: MouseEvent) => void;
}

export default function CabecalhoGrupo({
    nome, quantidade, recolhido, editando, nomeEditado, inputRef, podeExcluir,
    onAlternar, onRenomear, onNomeChange, onNomeSalvar, onExcluir, onIniciarArrasto, onMenuContexto,
}: CabecalhoGrupoProps) {
    return <div className="flex items-center gap-2 py-1.5 px-1 group/header" onContextMenu={onMenuContexto}>
        <div onMouseDown={onIniciarArrasto}
            className="cursor-grab text-white/15 transition-colors hover:text-white/45 active:cursor-grabbing"
            title="Arrastar grupo"><GripVertical size={12} /></div>
        <button onClick={onAlternar} aria-label={`${recolhido ? 'Expandir' : 'Recolher'} ${nome}`}
            aria-expanded={!recolhido} className="p-1 text-white/25 hover:text-white/50 transition-colors">
            {recolhido ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        </button>
        {editando ? <div className="flex items-center gap-1.5 flex-1">
            <input ref={inputRef} value={nomeEditado} aria-label="Nome do grupo" maxLength={80}
                onChange={(evento) => onNomeChange(evento.target.value)}
                onKeyDown={(evento) => {
                    if (evento.key === 'Enter' || evento.key === 'Escape') onNomeSalvar();
                }} onBlur={onNomeSalvar} autoFocus className={cn(
                    'rounded-lg border border-white/10 bg-white/5 px-2 py-0.5 text-sm font-bold',
                    'focus:outline-none focus:ring-1 focus:ring-emerald-500/30',
                )} />
        </div> : <div onMouseDown={onIniciarArrasto} title="Arrastar grupo"
            className="flex flex-1 cursor-grab items-center gap-2 active:cursor-grabbing">
            <FolderOpen size={13} className="text-white/20" />
            <span className="text-xs font-bold text-white/40 uppercase tracking-wider">{nome}</span>
            <span className="text-[10px] text-white/15 font-medium">{quantidade}</span>
        </div>}
        <div className="flex items-center gap-0.5">
            <button onClick={onRenomear} aria-label={`Renomear grupo ${nome}`} title="Renomear grupo"
                className="p-1 text-white/20 hover:text-white/40 transition-colors"><Pencil size={11} /></button>
            {podeExcluir && <button onClick={onExcluir} aria-label={`Excluir grupo ${nome}`} title="Excluir grupo"
                className="p-1 text-white/25 hover:text-red-400 transition-colors"><Trash2 size={11} /></button>}
        </div>
    </div>;
}
