import { createRoot } from "react-dom/client";
import ProjetoDetalheModal, { type ProjetoConteudo } from "../../src/components/ProjetoDetalheModal";
import type { Instance } from "../../src/hooks/useLauncher";
import "../../src/index.css";

const parametros = new URLSearchParams(location.search);
const fonte = (parametros.get("fonte") || "modrinth") as ProjetoConteudo["source"];
const tipo = (parametros.get("tipo") || "modpack") as ProjetoConteudo["project_type"];
const versoes = ["2.0", "1.0", "0.9"].map((numero, indice) => ({
    id: `v${2 - indice}`, version_number: numero, game_versions: ["1.21.1"], loaders: ["fabric"],
    date_published: `2026-10-${19 - indice}T00:00:00Z`,
    files: [{ url: "https://example.com/pacote.zip", filename: `pacote-${numero}.zip`, primary: true }],
    ...(fonte === "dome" ? { changelog: indice === 2 ? "" : `# Notas ${numero}\n\nFinal ${numero}` } : {}),
}));
const chamadas: Array<{ comando: string; argumentos: Record<string, unknown> }> = [];
Object.assign(window, { chamadas });
Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {
    invoke: async (comando: string, argumentos: Record<string, unknown> = {}) => {
        chamadas.push({ comando, argumentos });
        if (comando === "listar_versoes_projeto_curseforge") return versoes;
        if (comando === "obter_changelog_versao_curseforge") {
            if (document.documentElement.dataset.falhar === "sim") throw new Error("Falha simulada");
            if (argumentos.fileId === "v0") return "";
            const numero = argumentos.fileId === "v2" ? "2.0" : "1.0";
            return `<h2>Notas ${numero}</h2><p><strong>Correção ${numero}</strong></p>`
                + '<script>window.injetado = true</script><img src="x" onerror="window.injetado=true">'
                + `<p>Final ${numero}</p>`;
        }
        if (comando === "buscar_detalhes_projeto_curseforge") return {
            title: "Conteúdo", body: "Descrição", categorias: [], galeria: [],
        };
        if (comando === "gerenciar_modpacks_dome") {
            return argumentos.acao === "versoes" ? versoes : { body: "Descrição" };
        }
        if (comando === "obter_conteudo_instalado_detalhado") return [];
        return null;
    },
} });
const instancia: Instance = {
    id: "teste", name: "Teste", version: "1.21.1", mc_type: "fabric", loader_type: "Fabric", path: "D:/teste",
};
const projeto: ProjetoConteudo = {
    id: "123", title: "Conteúdo", description: "Descrição", icon_url: "", author: "Autor", slug: "conteudo",
    source: fonte, project_type: tipo,
};
createRoot(document.getElementById("root")!).render(
    <main className="h-screen overflow-auto bg-[#0d0d0e] text-white">
        <ProjetoDetalheModal projeto={projeto} instancias={[instancia]} instanciaInicialId={instancia.id}
            onVoltar={() => {}} />
    </main>,
);
