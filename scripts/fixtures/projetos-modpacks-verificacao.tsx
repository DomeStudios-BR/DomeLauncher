import { useState } from "react";
import { createRoot } from "react-dom/client";
import InstanceManager from "../../src/components/InstanceManager";
import ProjetoDetalheModal, { type ProjetoConteudo } from "../../src/components/ProjetoDetalheModal";
import "../../src/index.css";

const parametros = new URLSearchParams(location.search);
const fonte = (parametros.get("fonte") || "modrinth") as ProjetoConteudo["source"];
const tipo = (parametros.get("tipo") || (parametros.has("mod") ? "mod" : "modpack")) as ProjetoConteudo["project_type"];
const projeto: ProjetoConteudo = {
    id: "123", title: "Pacote de aventura", description: "Descrição do pacote", body: "Descrição completa",
    icon_url: "", author: "Autor", slug: "aventura", source: fonte, project_type: tipo,
};
const instancia = {
    id: "instancia", name: "Minha aventura", version: "1.21.1", mc_type: "fabric", mcType: "fabric",
    loader_type: "Fabric", loaderType: "Fabric", path: "D:/teste/instancia",
};
const versoes = parametros.has("paginacao") ? Array.from({ length: 37 }, (_, indice) => ({
    id: `pagina-${indice}`, version_number: `${37 - indice}.0`, game_versions: ["1.21.1"], loaders: ["fabric"],
    date_published: new Date(Date.UTC(2026, 9, 25) - indice * 86_400_000).toISOString(),
    changelog: `Notas da versão ${37 - indice}.0`,
    files: [{ url: "https://example.com/pacote.zip", filename: `pacote-${indice}.zip` }],
})) : ["2.0", "1.0", "0.9"].map((numero, indice) => ({
    id: `v${2 - indice}`, version_number: numero, game_versions: [indice === 0 || tipo !== "modpack" ? "1.21.1" : "1.20.1"],
    loaders: [indice === 0 || tipo !== "modpack" ? "fabric" : "forge"], date_published: `2026-10-${19 - indice}T00:00:00Z`,
    changelog: `Notas completas ${numero}`, files: [{ url: "https://example.com/pacote.zip", filename: "pacote.zip" }],
}));
let versaoInstalada = "v2";
let tentativaLista = 0;
const chamadas: Array<{ comando: string; argumentos: Record<string, unknown> }> = [];
Object.assign(window, { chamadas });
let callback = 0;
Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback: () => ++callback,
    invoke: async (comando: string, argumentos: Record<string, unknown> = {}) => {
        chamadas.push({ comando, argumentos });
        if (comando === "plugin:event|listen") return ++callback;
        if (comando === "get_instance_details") return instancia;
        if (comando === "get_modpack_info") return parametros.has("semVinculo") ? null : {
            projectId: "123", name: projeto.title, author: projeto.author, slug: "aventura", source: fonte,
            versionId: versaoInstalada, installedVersion: versaoInstalada === "v2" ? "2.0" : "1.0",
        };
        if (comando === "get_settings") return { ram_mb: 4096, java_args: "" };
        if (comando === "listar_versoes_projeto_curseforge") return versoes;
        if (comando === "buscar_detalhes_projeto_curseforge" && argumentos.projectId === "456") return {
            title: "Mod da versão v1", body: "Descrição do mod", author: "Autor do mod", categorias: [], galeria: [],
        };
        if (comando === "buscar_detalhes_projeto_curseforge") return {
            ...projeto, body: "Descrição completa", categorias: [], galeria: [],
        };
        if (comando === "gerenciar_modpacks_dome") return argumentos.acao === "versoes" ? versoes : projeto;
        if (comando === "obter_changelog_versao_curseforge") return "Notas completas 1.0";
        if (comando === "obter_conteudo_instalado_detalhado") return [];
        if (comando === "get_servers") return [
            { name: "Servidor de teste", address: "teste.local", port: 25565 },
            { name: "Servidor offline", address: "offline.local", port: 25565 },
        ];
        if (comando === "ping_server") {
            if (argumentos.address === "offline.local") throw new Error("Servidor indisponível");
            if (document.documentElement.dataset.pausarPing === "sim") {
                await new Promise<void>((resolver) => Object.assign(window, { liberarPing: resolver }));
            }
            return { name: "Servidor de teste", address: "teste.local", port: 25565,
                motd: "Servidor disponível", playerCount: "3/20", ping: 42 };
        }
        if (comando === "listar_conteudos_versao_projeto") {
            if (parametros.has("falhar") && tentativaLista++ === 0) throw "Falha ao consultar conteúdo";
            if (parametros.has("vazio")) return [];
            const versao = argumentos.versaoId;
            if (parametros.has("grade") && tipo === "modpack") return [
                "Sodium", "Iris Shaders", "Fabric API", "JourneyMap", "Architectury API",
                "YetAnotherConfigLib com um nome de mod suficientemente longo para ocupar mais de uma linha",
                "ModernFix",
            ].map((nome, indice) => ({ nome, tipo: "mod", versao: indice === 5 ? "1.0.0+" + "build".repeat(14) : "3.2.1",
                arquivo: `mods/${indice === 5 ? "arquivo-com-nome-extenso-".repeat(8) : nome.toLowerCase()}-1.21.1.jar`,
                ...(indice === 0 ? { icone: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40'%3E%3Cpath fill='%2359b574' d='M0 0h40v40H0z'/%3E%3C/svg%3E" } : {}),
            }));
            if (versao === "v1") await new Promise((resolver) => setTimeout(resolver, 250));
            return [{ nome: tipo !== "modpack" ? "Biblioteca obrigatória" : `Mod da versão ${versao}`,
                arquivo: `mods/exemplo-${versao}.jar`, versao: "3.2", tipo: "mod", obrigatoria: true,
                ...(parametros.has("navegacaoMod") ? { projetoId: "456", fonte: fonte === "dome" ? "modrinth" : fonte } : {}) },
                ...(parametros.has("navegacaoMod") ? [{ nome: "Arquivo local sem identificação",
                    arquivo: "mods/local.jar", versao: "1.0", tipo: "mod" }] : []),
                ...(tipo === "modpack" ? [] : [
                    { nome: "Textura complementar", arquivo: "textura.zip", versao: "2.0", tipo: "resourcepack", obrigatoria: false },
                    { nome: "Shader complementar", arquivo: "shader.zip", versao: "1.0", tipo: "shader", obrigatoria: false },
                ])];
        }
        if (comando === "trocar_versao_modpack_publico" || comando === "instalar_modpack_dome") {
            if (parametros.has("erroTroca")) throw "Falha no download; instância preservada";
            versaoInstalada = String(argumentos.versaoId);
            return "instancia";
        }
        return null;
    },
} });
function Verificacao() {
    const [, atualizar] = useState(0);
    const [aberta, setAberta] = useState(true);
    const [projetoAberto, setProjetoAberto] = useState<ProjetoConteudo | null>(null);
    return parametros.has("instalado") ? <>
        {parametros.has("ciclo") && <button onClick={() => setAberta((atual) => !atual)}>
            {aberta ? "Fechar instância" : "Reabrir instância"}
        </button>}
        <div className={projetoAberto ? "hidden" : "min-h-0 flex-1"}>
            {aberta && <InstanceManager instanceId="instancia" onBack={() => setAberta(false)}
                navegacaoAtiva={!projetoAberto} onAbrirProjeto={(destino) => {
                    Object.assign(window, { destinoProjeto: destino });
                    setProjetoAberto(destino);
                }} onInstanceUpdate={() => atualizar((valor) => valor + 1)} />}
        </div>
        {projetoAberto && <ProjetoDetalheModal projeto={projetoAberto} instancias={[instancia]}
            instanciaInicialId="instancia" usuarioLogado onVoltar={() => setProjetoAberto(null)} />}
    </> : <ProjetoDetalheModal projeto={projeto} instancias={parametros.has("semInstancia") ? []
        : parametros.has("muitasInstancias") ? Array.from({ length: 20 }, (_, indice) => ({
            ...instancia, id: `instancia-${indice}`, name: `Aventura ${indice + 1}`,
        })) : [instancia]}
            usuarioLogado onVoltar={() => {}} />;
}
createRoot(document.getElementById("root")!).render(
    <main className="flex h-screen flex-col overflow-auto bg-[#0d0d0e] text-white"><Verificacao /></main>,
);
