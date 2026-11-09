import { useCallback, useState } from "react";

const LIMITE_HISTORICO = 50;

/** Guarda o contexto de cada visita para restaurar a tela ao usar voltar e avançar. */
export function useHistoricoNavegacao<T>(capturar: () => T, restaurar: (destino: T) => void) {
    const [historico, setHistorico] = useState<{ anteriores: T[]; proximas: T[] }>({
        anteriores: [], proximas: [],
    });

    const registrarSaida = useCallback(() => {
        const atual = capturar();
        setHistorico((anterior) => ({
            anteriores: [...anterior.anteriores, atual].slice(-LIMITE_HISTORICO),
            proximas: [],
        }));
    }, [capturar]);

    const voltar = useCallback(() => {
        const destino = historico.anteriores[historico.anteriores.length - 1];
        if (!destino) return;
        const atual = capturar();
        setHistorico((anterior) => ({
            anteriores: anterior.anteriores.slice(0, -1),
            proximas: [atual, ...anterior.proximas].slice(0, LIMITE_HISTORICO),
        }));
        restaurar(destino);
    }, [capturar, historico.anteriores, restaurar]);

    const avancar = useCallback(() => {
        const [destino] = historico.proximas;
        if (!destino) return;
        const atual = capturar();
        setHistorico((anterior) => ({
            anteriores: [...anterior.anteriores, atual].slice(-LIMITE_HISTORICO),
            proximas: anterior.proximas.slice(1),
        }));
        restaurar(destino);
    }, [capturar, historico.proximas, restaurar]);

    return { historico, registrarSaida, voltar, avancar };
}
