/** Reutiliza registros JSON com chave estável para atualizar listas sem recriar os itens que não mudaram. */
export function reconciliarLista<T>(
    anteriores: T[],
    recebidos: T[],
    obterChave: (item: T) => string,
): T[] {
    const anterioresPorChave = new Map(anteriores.map((item) => [obterChave(item), item]));
    const atualizados = recebidos.map((item) => {
        const anterior = anterioresPorChave.get(obterChave(item));
        return anterior !== undefined && JSON.stringify(anterior) === JSON.stringify(item) ? anterior : item;
    });

    return anteriores.length === atualizados.length && atualizados.every((item, indice) => item === anteriores[indice])
        ? anteriores
        : atualizados;
}
