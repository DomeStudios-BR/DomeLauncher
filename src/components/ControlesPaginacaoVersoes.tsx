import { ChevronLeft, ChevronRight } from "../iconesPixelados";

interface Propriedades {
    pagina: number;
    totalPaginas: number;
    irParaPagina: (pagina: number) => void;
}

export function ControlesPaginacaoVersoes({ pagina, totalPaginas, irParaPagina }: Propriedades) {
    if (totalPaginas <= 1) return null;
    const classeBotao = "flex h-7 w-7 items-center justify-center rounded border border-white/10 "
        + "bg-white/5 text-white/70 enabled:hover:bg-white/10 disabled:opacity-25";
    return <nav aria-label="Paginação de versões"
        className="sticky top-0 z-10 mb-3 flex items-center justify-end gap-2 bg-[#151516] py-2">
        <button type="button" aria-label="Página anterior" disabled={pagina === 1}
            className={classeBotao} onClick={() => irParaPagina(pagina - 1)}><ChevronLeft size={14} /></button>
        <span aria-live="polite" aria-label={`Página ${pagina} de ${totalPaginas}`}
            className="min-w-10 text-center text-xs tabular-nums text-white/60">{pagina}/{totalPaginas}</span>
        <button type="button" aria-label="Próxima página" disabled={pagina === totalPaginas}
            className={classeBotao} onClick={() => irParaPagina(pagina + 1)}><ChevronRight size={14} /></button>
    </nav>;
}
