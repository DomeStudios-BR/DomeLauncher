import { useState } from "react";
import { createRoot } from "react-dom/client";
import Explore from "../../src/components/Explore";
import InstanceManager from "../../src/components/InstanceManager";
import ProjetoDetalheModal, { type ProjetoConteudo } from "../../src/components/ProjetoDetalheModal";
import type { Instance } from "../../src/hooks/useLauncher";
import "../../src/index.css";

const fonte = new URLSearchParams(location.search).get("fonte") || "modrinth";
const projeto: ProjetoConteudo = {
    id: "pack", title: "LostSMP", author: "Dome", slug: "lostsmp", description: "Modpack de teste",
    icon_url: "", source: fonte as ProjetoConteudo["source"], project_type: "modpack",
};
const versoes = ["2.0", "1.0"].map((versao, indice) => ({
    id: `v${2 - indice}`, version_number: versao, game_versions: ["1.21.1"], loaders: ["fabric"],
    date_published: `2026-10-${19 - indice}T00:00:00Z`,
    files: [{ url: "https://example.com/pack.zip", filename: "pack.zip", primary: true }],
}));
const instancia: Instance = {
    id: "pasta_original", name: "LostSMP", version: "1.21.1", mc_type: "fabric",
    loader_type: "Fabric", path: "D:/teste/pasta_original",
};
const instanciasIniciais: Instance[] = [instancia,
    { ...instancia, id: "outro_projeto", name: "Outro projeto" },
    { ...instancia, id: "outra_fonte", name: "Outra fonte" },
];
const infoOriginal = {
    projectId: "pack", name: "LostSMP", versionId: "v2", installedVersion: "2.0", source: fonte,
};
const informacoesInstaladas = new Map<string, typeof infoOriginal>([
    [instancia.id, infoOriginal],
    ["outro_projeto", { ...infoOriginal, projectId: "outro", versionId: "v1", installedVersion: "1.0" }],
    ["outra_fonte", { ...infoOriginal, source: fonte === "dome" ? "curseforge" : "dome",
        versionId: "v1", installedVersion: "1.0" }],
]);
if (new URLSearchParams(location.search).has("outraCopia")) {
    instanciasIniciais.push({ ...instancia, id: "copia_antiga", name: "Minha cópia renomeada" });
    informacoesInstaladas.set("copia_antiga", { ...infoOriginal, versionId: "v1", installedVersion: "1.0" });
}
const instanciasCriadas: Instance[] = [];
function criarCopia(): string {
    const id = `LostSMP (${instanciasCriadas.length + 1})`;
    instanciasCriadas.push({ ...instancia, id, name: id });
    return id;
}
const chamadas: Array<{ comando: string; argumentos: Record<string, unknown> }> = [];
let proximoCallback = 0;
const callbacks = new Map<number, unknown>();
Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback: (callback: unknown) => { callbacks.set(++proximoCallback, callback); return proximoCallback; },
    invoke: async (comando: string, argumentos: Record<string, unknown> = {}) => {
        chamadas.push({ comando, argumentos });
        if (comando === "plugin:event|listen") return ++proximoCallback;
        if (comando === "get_instance_details") return { ...instancia, mcType: "fabric" };
        if (comando === "update_instance_name") { instancia.name = String(argumentos.newName); return; }
        if (comando === "get_modpack_info") return informacoesInstaladas.get(String(argumentos.instanceId)) ?? null;
        if (comando === "get_loader_versions") return { versions: [{ version: "0.16.0", stable: true }] };
        if (comando === "create_instance") return criarCopia();
        if (comando === "save_modpack_info") {
            informacoesInstaladas.set(String(argumentos.instanceId), argumentos.modpackInfo as typeof infoOriginal);
            return;
        }
        if (comando === "instalar_modpack_dome") {
            const id = argumentos.instanciaId ? String(argumentos.instanciaId) : criarCopia();
            const versao = versoes.find((item) => item.id === argumentos.versaoId)!;
            informacoesInstaladas.set(id, {
                ...infoOriginal, versionId: versao.id, installedVersion: versao.version_number,
            });
            return id;
        }
        if (comando === "get_minecraft_versions") return { versions: [{ id: "1.21.1", type: "release" }] };
        if (comando === "search_mods_online") return argumentos.platform === fonte ? [{
            ...projeto, source: fonte, downloads: 100,
        }] : [];
        if (comando === "gerenciar_modpacks_dome") {
            if (argumentos.acao === "buscar") return fonte === "dome" ? [projeto] : [];
            if (argumentos.acao === "versoes") return versoes;
            return projeto;
        }
        if (comando === "listar_versoes_projeto_curseforge") return versoes;
        if (comando === "buscar_detalhes_projeto_curseforge") return { ...projeto, categorias: [], galeria: [] };
        if (comando === "listar_categorias_busca_online" || comando === "obter_conteudo_instalado_detalhado") return [];
        if (comando === "get_settings") return { ram_mb: 4096, java_args: "" };
        return null;
    },
} });
Object.assign(window, { chamadas });

function Verificacao() {
    const [aberto, setAberto] = useState(false);
    const [instalar, setInstalar] = useState(false);
    const [instancias, setInstancias] = useState(instanciasIniciais);
    if (new URLSearchParams(location.search).has("editar")) return (
        <InstanceManager instanceId={instancia.id} onBack={() => {}} />
    );
    return aberto ? (
        <ProjetoDetalheModal projeto={projeto} instancias={instancias} usuarioLogado instalarAoAbrir={instalar}
            instanciaInicialId={new URLSearchParams(location.search).has("atualizar") ? instancia.id : undefined}
            onInstanciaCriada={() => {
                setInstancias([...instanciasIniciais, ...instanciasCriadas]);
                document.documentElement.dataset.concluidas =
                    String(Number(document.documentElement.dataset.concluidas || 0) + 1);
            }}
            onVoltar={() => setAberto(false)} />
    ) : (
        <Explore instancias={[instancia]} instalacoesEmAndamento={[]} onAbrirProjeto={(_projeto, direto) => {
            setInstalar(Boolean(direto)); setAberto(true);
        }} />
    );
}
createRoot(document.getElementById("root")!).render(
    <main className="flex h-screen flex-col bg-[#0d0d0e] text-white"><Verificacao /></main>,
);
