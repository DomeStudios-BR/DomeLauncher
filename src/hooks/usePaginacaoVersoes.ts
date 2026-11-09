import { useLayoutEffect, useState } from "react";

/** Mantém a página entre abas e limita a grade conforme o espaço disponível. */
export function usePaginacaoVersoes<T extends { id: string }>(
    itens: readonly T[],
    contexto: string,
    selecionadoId?: string | null,
    gradeFixa?: { colunas: 1 | 2 | 3; linhas: number },
) {
    const [elemento, definirElemento] = useState<HTMLDivElement | null>(null);
    const [colunasResponsivas, setColunas] = useState<1 | 2 | 3>(2);
    const colunasFixas = gradeFixa?.colunas;
    const colunas = colunasFixas ?? colunasResponsivas;
    const [posicao, setPosicao] = useState<{ contexto: string; primeiroIndice: number } | null>(null);

    useLayoutEffect(() => {
        if (!elemento || colunasFixas) return;
        const medir = () => {
            const largura = elemento.clientWidth;
            if (!largura) return;
            setColunas(largura >= 840 && window.innerHeight >= 900 ? 3 : largura >= 480 ? 2 : 1);
        };
        medir();
        const observador = new ResizeObserver(medir);
        observador.observe(elemento);
        window.addEventListener("resize", medir);
        return () => {
            observador.disconnect();
            window.removeEventListener("resize", medir);
        };
    }, [colunasFixas, elemento]);

    const porPagina = gradeFixa ? gradeFixa.colunas * gradeFixa.linhas : colunas === 3 ? 15 : colunas === 2 ? 8 : 4;
    const totalPaginas = Math.max(1, Math.ceil(itens.length / porPagina));
    const indiceSelecionado = itens.findIndex((item) => item.id === selecionadoId);
    const primeiro = posicao?.contexto === contexto ? posicao.primeiroIndice : Math.max(0, indiceSelecionado);
    const pagina = Math.min(totalPaginas, Math.floor(primeiro / porPagina) + 1);
    const indiceInicial = (pagina - 1) * porPagina;

    const irParaPagina = (destino: number) => {
        const proxima = Math.max(1, Math.min(totalPaginas, destino));
        setPosicao({ contexto, primeiroIndice: (proxima - 1) * porPagina });
    };

    return {
        definirElemento, colunas, pagina, totalPaginas, irParaPagina, indiceInicial,
        itensPagina: itens.slice(indiceInicial, indiceInicial + porPagina),
    };
}
