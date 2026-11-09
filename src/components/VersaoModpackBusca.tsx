import { useEffect, useRef, useState } from "react";
import type { ProjetoConteudo } from "./ProjetoDetalheModal";

type VersaoPadrao = Awaited<ReturnType<typeof import("./ProjetoDetalheModal").obterVersaoPadraoModpack>>;
const consultas = new Map<string, { criadaEm: number; promessa: Promise<VersaoPadrao> }>();

function consultarVersao(projeto: ProjetoConteudo): Promise<VersaoPadrao> {
    const chave = `${projeto.source}:${projeto.id}`;
    const anterior = consultas.get(chave);
    if (anterior && Date.now() - anterior.criadaEm < 300_000) return anterior.promessa;
    const promessa = import("./ProjetoDetalheModal")
        .then(({ obterVersaoPadraoModpack }) => obterVersaoPadraoModpack(projeto))
        .catch((erro: unknown) => {
            if (consultas.get(chave)?.promessa === promessa) consultas.delete(chave);
            throw erro;
        });
    if (consultas.size >= 200) consultas.delete(consultas.keys().next().value!);
    consultas.set(chave, { criadaEm: Date.now(), promessa });
    return promessa;
}

export function VersaoModpackBusca({ projeto }: { projeto: ProjetoConteudo }) {
    const elemento = useRef<HTMLParagraphElement>(null);
    const [texto, setTexto] = useState("Consultando versão...");

    useEffect(() => {
        let cancelado = false;
        setTexto("Consultando versão...");
        const observador = new IntersectionObserver(([entrada]) => {
            if (!entrada.isIntersecting) return;
            observador.disconnect();
            void consultarVersao(projeto).then((versao) => {
                if (cancelado) return;
                setTexto(versao
                    ? `Versão ${versao.numero}${versao.minecraft ? ` · Minecraft ${versao.minecraft}` : ""}`
                    : "Nenhuma versão disponível");
            }).catch(() => {
                if (!cancelado) setTexto("Versão indisponível");
            });
        });
        if (elemento.current) observador.observe(elemento.current);
        return () => {
            cancelado = true;
            observador.disconnect();
        };
    }, [projeto.id, projeto.source]);

    return <p ref={elemento} className="text-xs text-white/60">{texto}</p>;
}
