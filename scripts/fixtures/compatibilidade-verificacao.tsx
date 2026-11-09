import { createRoot } from "react-dom/client";
import { useState } from "react";
import ProjetoDetalheModal, { type ProjetoConteudo } from "../../src/components/ProjetoDetalheModal";
import type { Instance } from "../../src/hooks/useLauncher";
import "../../src/index.css";

const parametros = new URLSearchParams(location.search);
const tipo = (parametros.get("tipo") || "mod") as ProjetoConteudo["project_type"];
const fonte = (parametros.get("fonte") || "curseforge") as ProjetoConteudo["source"];
const chamadas: Array<{ comando: string; argumentos: Record<string, unknown> }> = [];
Object.assign(window, { chamadas });
const esperar = (tempo: number) => new Promise((resolver) => setTimeout(resolver, tempo));
Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {
    invoke: async (comando: string, argumentos: Record<string, unknown> = {}) => {
        chamadas.push({ comando, argumentos });
        if (comando === "listar_versoes_projeto_curseforge") {
            await esperar(parametros.has("lento") && argumentos.projectId === "123" ? 800 : 80);
            if (argumentos.projectId === "456") return [];
            if (argumentos.gameVersion === null) {
                if (parametros.has("falhaGeral")) throw new Error("Falha ao carregar todas as versões");
                return [
                    { id: "shine-fabric", version_number: "Shine teste", game_versions: ["26.2"], loaders: ["fabric"],
                        files: [{ url: "https://example.com/shine.jar", filename: "shine.jar" }] },
                    { id: "shine-antiga", version_number: "Shine antiga", game_versions: ["1.19.2"], loaders: ["forge"],
                        files: [{ url: "https://example.com/antiga.jar", filename: "antiga.jar" }] },
                    { id: "shine-sem-download", version_number: "Shine sem download", game_versions: ["1.18.2"],
                        loaders: ["quilt"], files: [] },
                ];
            }
            if (argumentos.gameVersion === "falha") throw new Error("Falha de rede simulada");
            if (argumentos.gameVersion !== "26.2" || argumentos.loader === "neoforge") return [];
            return [{
                id: "shine-fabric", version_number: "Shine teste", game_versions: ["26.2"], loaders: ["fabric"],
                files: parametros.has("semDownload") ? []
                    : [{ url: "https://example.com/shine.jar", filename: "shine.jar" }],
            }];
        }
        if (comando === "buscar_detalhes_projeto_curseforge") return { categorias: [], galeria: [] };
        if (comando === "obter_conteudo_instalado_detalhado") return [];
        if (comando === "obter_changelog_versao_curseforge") return `Notas ${argumentos.fileId}`;
        return null;
    },
} });
const instancias: Instance[] = [
    { id: "fabric", name: "Fabric atual", version: "26.2", mc_type: "fabric", loader_type: "Fabric", path: "D:/f" },
    { id: "copia", name: "Fabric cópia", version: "26.2", mc_type: "fabric", loader_type: "Fabric", path: "D:/c" },
    { id: "neo", name: "NeoForge atual", version: "26.2", mc_type: "neoforge", path: "D:/n" },
    { id: "antiga", name: "Fabric antiga", version: "1.20.1", mc_type: "fabric", path: "D:/a" },
    { id: "erro", name: "Consulta falhou", version: "falha", mc_type: "fabric", path: "D:/e" },
];

function Verificacao() {
    const [id, setId] = useState("123");
    const projeto: ProjetoConteudo = {
        id, title: "Shine: VFX", description: "", icon_url: "", author: "Autor", slug: "shine",
        source: fonte, project_type: tipo,
    };
    return <main className="h-screen overflow-auto bg-[#0d0d0e] text-white">
        <button onClick={() => setId("456")}>Trocar projeto</button>
        <ProjetoDetalheModal projeto={projeto} instancias={instancias} onVoltar={() => {}} />
    </main>;
}
createRoot(document.getElementById("root")!).render(<Verificacao />);
