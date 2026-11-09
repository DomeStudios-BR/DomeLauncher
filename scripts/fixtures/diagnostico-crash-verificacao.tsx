import { createRoot } from "react-dom/client";
import { useState } from "react";
import { DiagnosticoCrash } from "../../src/components/instance/DiagnosticoCrash";
import type { DiagnosticoCrash as Resultado } from "../../src/lib/diagnosticoCrash";
import "../../src/index.css";

const callbacks = new Map<number, (evento: unknown) => void>();
const ouvintes = new Set<number>();
let proximoCallback = 0;
let resolverConsulta: ((resultado: Resultado | null) => void) | undefined;
Object.defineProperty(window, "__TAURI_EVENT_PLUGIN_INTERNALS__", { value: {
    unregisterListener: (_evento: string, id: number) => ouvintes.delete(id),
} });
Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {
    transformCallback: (callback: (evento: unknown) => void) => {
        callbacks.set(++proximoCallback, callback);
        return proximoCallback;
    },
    invoke: async (comando: string, argumentos: Record<string, unknown> = {}) => {
        if (comando === "plugin:event|listen") {
            ouvintes.add(Number(argumentos.handler));
            return argumentos.handler;
        }
        if (comando === "plugin:event|unlisten") { ouvintes.delete(Number(argumentos.eventId)); return; }
        if (comando === "obter_diagnostico_crash") {
            if (String(argumentos.instanceId) === "erro") throw new Error("Falha simulada");
            if (String(argumentos.instanceId) === "lenta") {
                return new Promise<Resultado | null>((resolver) => { resolverConsulta = resolver; });
            }
            return null;
        }
        throw new Error(`Comando inesperado: ${comando}`);
    },
} });
function Verificacao() {
    const [instancia, setInstancia] = useState("teste");
    Object.assign(window, {
        selecionar: setInstancia,
        quantidadeOuvintes: () => ouvintes.size,
        resolverConsulta: () => resolverConsulta?.(null),
        consultaPendente: () => Boolean(resolverConsulta),
        emitir: (payload: Resultado) => {
            for (const id of ouvintes) callbacks.get(id)?.({ payload });
        },
    });
    return <main className="flex h-screen bg-[#111] text-white">
        <aside className="w-64 shrink-0 border-r border-white/10 p-4">Arquivos de Log</aside>
        <div className="flex min-w-0 flex-1 flex-col">
            <DiagnosticoCrash instanceId={instancia} />
            <div className="min-h-0 flex-1 overflow-auto p-4"><pre>Conteúdo do log</pre></div>
        </div>
    </main>;
}
createRoot(document.getElementById("root")!).render(<Verificacao />);
