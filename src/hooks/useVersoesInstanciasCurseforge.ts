import { useEffect, useState } from "react";
import type { Instance } from "./useLauncher";

interface ConsultaVersoes<T> {
    versoes: T[];
    erro: string | null;
}

export function chaveCompatibilidadeInstancia(instancia: Instance, considerarLoader: boolean): string {
    const loader = (instancia.loader_type || instancia.mc_type || "vanilla").trim().toLowerCase();
    return JSON.stringify([instancia.version, considerarLoader ? loader : null]);
}

/** Consulta cada combinação uma vez por contexto, sem depender da instância selecionada. */
export function useVersoesInstanciasCurseforge<T>(
    contexto: string | null,
    instancias: Instance[],
    considerarLoader: boolean,
    consultar: (instancia: Instance) => Promise<T[]>,
) {
    const [resultado, setResultado] = useState<{
        contexto: string | null;
        assinatura: string;
        consultas: Record<string, ConsultaVersoes<T>>;
    }>({ contexto: null, assinatura: "", consultas: {} });
    const perfis = new Map(instancias.map((instancia) => [
        chaveCompatibilidadeInstancia(instancia, considerarLoader), instancia,
    ]));
    const assinatura = JSON.stringify([...perfis.keys()].sort());

    useEffect(() => {
        if (!contexto) return;
        let cancelado = false;
        const pendentes = [...perfis.entries()];
        setResultado({ contexto, assinatura, consultas: {} });

        const consultarProximo = async () => {
            while (!cancelado && pendentes.length > 0) {
                const [chave, instancia] = pendentes.shift()!;
                let consulta: ConsultaVersoes<T>;
                try {
                    consulta = { versoes: await consultar(instancia), erro: null };
                } catch {
                    consulta = { versoes: [], erro: "Não foi possível verificar a compatibilidade." };
                }
                if (cancelado) return;
                setResultado((atual) => ({
                    contexto,
                    assinatura,
                    consultas: { ...atual.consultas, [chave]: consulta },
                }));
            }
        };

        void Promise.all(Array.from({ length: Math.min(4, pendentes.length) }, consultarProximo));
        return () => { cancelado = true; };
    }, [contexto, assinatura]);

    return resultado.contexto === contexto && resultado.assinatura === assinatura ? resultado.consultas : {};
}
