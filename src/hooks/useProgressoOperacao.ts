import { Channel } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";

export interface ProgressoOperacao {
    porcentagem: number;
    etapa: string;
}

export function criarCanalProgresso(aoReceber: (dados: ProgressoOperacao) => void) {
    const canal = new Channel<ProgressoOperacao>();
    canal.onmessage = aoReceber;
    return canal;
}

export function useProgressoOperacao() {
    const [porcentagem, setPorcentagem] = useState(0);
    const geracao = useRef(0);
    const ultimoValor = useRef(0);
    const montado = useRef(true);
    const aoAtualizar = useRef<((progresso: ProgressoOperacao) => void) | undefined>(undefined);
    useEffect(() => {
        montado.current = true;
        return () => { montado.current = false; };
    }, []);

    const iniciar = (callback?: (progresso: ProgressoOperacao) => void) => {
        geracao.current += 1;
        aoAtualizar.current = callback;
        setPorcentagem(0);
        ultimoValor.current = 0;
    };

    const canal = (inicio = 0, fim = 100) => {
        const atual = geracao.current;
        const progresso = new Channel<ProgressoOperacao>();
        progresso.onmessage = (dados) => {
            if (atual !== geracao.current || !Number.isFinite(dados.porcentagem)) return;
            const valor = Math.floor(inicio + (fim - inicio) * Math.max(0, Math.min(100, dados.porcentagem)) / 100);
            ultimoValor.current = Math.max(ultimoValor.current, valor);
            if (montado.current) setPorcentagem(ultimoValor.current);
            aoAtualizar.current?.({ ...dados, porcentagem: ultimoValor.current });
        };
        return progresso;
    };

    const concluir = () => { if (montado.current) setPorcentagem(100); geracao.current += 1; };
    return { porcentagem, iniciar, canal, concluir };
}
