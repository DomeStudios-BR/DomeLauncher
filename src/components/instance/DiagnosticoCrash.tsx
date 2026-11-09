import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { EVENTO_DIAGNOSTICO_CRASH, type DiagnosticoCrash as ResultadoDiagnostico } from "../../lib/diagnosticoCrash";

export function DiagnosticoCrash({ instanceId }: { instanceId: string }) {
    const [resultado, setResultado] = useState<ResultadoDiagnostico | null>(null);
    const [erro, setErro] = useState<string | null>(null);
    const [consultando, setConsultando] = useState(true);

    useEffect(() => {
        let ativo = true;
        let revisao = 0;
        let cancelar: (() => void) | undefined;
        setResultado(null);
        setErro(null);
        setConsultando(true);

        void (async () => {
            try {
                const desinscrever = await listen<ResultadoDiagnostico>(EVENTO_DIAGNOSTICO_CRASH, ({ payload }) => {
                    if (!ativo || payload.instanceId !== instanceId) return;
                    revisao++;
                    setResultado(payload);
                    setErro(null);
                    setConsultando(false);
                });
                if (!ativo) { desinscrever(); return; }
                cancelar = desinscrever;
                const versao = revisao;
                const diagnostico = await invoke<ResultadoDiagnostico | null>("obter_diagnostico_crash", { instanceId });
                if (ativo && versao === revisao) setResultado(diagnostico);
            } catch {
                if (ativo && revisao === 0) setErro("Não foi possível consultar o diagnóstico do jogo.");
            } finally {
                if (ativo) setConsultando(false);
            }
        })();
        return () => { ativo = false; cancelar?.(); };
    }, [instanceId]);

    return (
        <section aria-label="Diagnóstico do Minecraft" className="max-h-[45%] shrink-0 overflow-auto
            border-b border-white/10 px-4 py-3 text-sm">
            <p role="status" className={resultado?.estado === "crash" ? "text-amber-300" : "text-white/60"}>
                {consultando ? "Consultando diagnóstico..." : erro ?? resultado?.resumo
                    ?? "Inicie o Minecraft pelo launcher para analisar o próximo encerramento."}
            </p>
            {resultado?.estado === "crash" && (
                <>
                    <p className="mt-1 text-xs text-white/40">
                        Crash detectado{resultado.codigoSaida === null ? "" : ` · Código ${resultado.codigoSaida}`}
                    </p>
                    <details className="mt-2 text-xs text-white/60">
                        <summary className="cursor-pointer hover:text-white">Ver evidências</summary>
                        {resultado.mods.map((mod) => (
                            <div key={`${mod.arquivo}:${mod.nome}`} className="mt-3">
                                <p>{mod.nome} · {mod.relacao === "alvoMixin" ? "Alvo do mixin"
                                    : mod.relacao === "chamada" ? "Na mesma cadeia da falha"
                                    : `Confiança ${mod.confianca}`}</p>
                                <p className="break-all text-white/40">{mod.arquivo}</p>
                                <pre className="mt-1 whitespace-pre-wrap break-all font-mono">
                                    {mod.evidencias.join("\n")}
                                </pre>
                            </div>
                        ))}
                        <p className="mt-2 break-all">Arquivos analisados: {resultado.arquivos.join(", ") || "nenhum"}</p>
                        {resultado.avisos.map((aviso, indice) => <p key={indice} className="mt-1">{aviso}</p>)}
                        <p className="mt-2 text-white/40">A análise dos logs indica uma causa provável e pode ser inconclusiva.</p>
                    </details>
                </>
            )}
        </section>
    );
}
