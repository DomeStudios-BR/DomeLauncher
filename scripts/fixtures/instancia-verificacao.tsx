import { createRoot } from "react-dom/client";
import { useCallback, useRef, useState } from "react";
import InstanceManager, {
    type ControleNavegacaoInstancia, type EstadoNavegacaoInstancia, type RestauracaoNavegacaoInstancia,
} from "../../src/components/InstanceManager";
import type { ProjetoConteudo } from "../../src/components/ProjetoDetalheModal";
import { useHistoricoNavegacao } from "../../src/hooks/useHistoricoNavegacao";
import { solicitarNavegacaoInterna } from "../../src/lib/navegacaoInterna";
import { aplicarCorDestaque } from "../../src/lib/corDestaque";
import { getCreatingInstances } from "../../src/stores/creatingInstances";
import "../../src/index.css";

const callbacks = new Map<number, (evento: unknown) => void>();
const listeners = new Map<string, number>();
const chamadas: Array<{ comando: string; argumentos: Record<string, unknown> }> = [];
const cargasPausadas = new Map<string, () => void>();
let proximoCallback = 0;
let versaoAmbiente = "1.21.1";
let loaderAmbiente = new URLSearchParams(location.search).has("vanilla") ? "Vanilla" : "Fabric";
let versaoLoaderAmbiente = "0.16.10";
let opcoes = { renderDistance: "12", fov: "0", gamma: "0.5", fullscreen: "false" };
const criarItem = (nome: string, versao: string, ativo: boolean, extensao: string) => ({
    name: nome, fileName: `${nome}.${extensao}${ativo ? "" : ".disabled"}`, version: versao,
    author: "Dome", enabled: ativo, identificadores: [], dependencias: [],
});
const listas = {
    mods: [criarItem("Beta", "1.10", true, "jar"), criarItem("Alfa", "1.2", false, "jar")],
    resourcepacks: [criarItem("Textura", "2.0", true, "zip")],
    shaders: [criarItem("Shader", "3.0", true, "zip")],
};
if (new URLSearchParams(location.search).has("externos")) {
    listas.mods = Array.from({ length: 12 }, (_, indice) => ({
        ...criarItem(`Externo ${indice}`, "1.0", indice % 2 === 0, "jar"),
        fileName: `renomeado-${indice}.jar${indice % 2 ? ".disabled" : ""}`,
    }));
}
const cache = {};
for (const [filtro, itens] of Object.entries(listas)) {
    const tipo = filtro === "mods" ? "mod" : filtro === "shaders" ? "shader" : "resourcepack";
    for (const item of itens.filter(() => filtro !== "mods" || !new URLSearchParams(location.search).has("externos"))) cache[`teste::${tipo}::${item.fileName.toLowerCase()}`] = {
        name: item.name, author: item.author, projectId: item.name, versionId: filtro === "mods" ? item.name : undefined,
        source: new URLSearchParams(location.search).get("fonte")
            || (filtro === "shaders" ? "curseforge" : "modrinth"), projectType: tipo,
        atualizadoEm: Date.now(), atualizacaoVerificadaEm: Date.now(),
        updateAvailable: item.name !== "Alfa", latestVersion: "4.0",
    };
}
localStorage.clear();
localStorage.setItem("dome:cache-conteudo-instalado:v2", JSON.stringify(cache));
Object.defineProperty(globalThis, "isTauri", { value: true });
Object.defineProperty(window, "__TAURI_EVENT_PLUGIN_INTERNALS__", { value: {
    unregisterListener: (evento: string) => listeners.delete(evento),
} });
Object.defineProperty(window, "__TAURI_INTERNALS__", { value: {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback: (callback: (evento: unknown) => void) => {
        callbacks.set(++proximoCallback, callback);
        return proximoCallback;
    },
    invoke: async (comando: string, argumentos: Record<string, unknown> = {}) => {
        chamadas.push({ comando, argumentos });
        if (comando === "get_worlds") return [{
            name: "Mundo real", path: "D:/teste/saves/mundo", sizeOnDisk: "4,02 KiB", sizeBytes: 4113,
            gameMode: "Survival", difficulty: "Normal", lastPlayed: "Recentemente",
        }];
        if (comando === "install_mod" || comando === "install_project_file") {
            if (document.documentElement.dataset.falharArquivo
                && argumentos.fileName === document.documentElement.dataset.falharArquivo) {
                throw new Error("Falha simulada no download deste arquivo");
            }
            if (document.documentElement.dataset.falharInstalacao === "sim") throw new Error("Falha simulada no download");
            const progresso = argumentos.progresso as { onmessage?: (dados: object) => void } | undefined;
            progresso?.onmessage?.({ porcentagem: 34, etapa: "Baixando conteúdo" });
            if (document.documentElement.dataset.pausarInstalacao === "sim") {
                await new Promise<void>((resolver) => Object.assign(window, { liberarInstalacao: resolver }));
            }
            progresso?.onmessage?.({ porcentagem: 100, etapa: "Conteúdo instalado" });
            const mod = argumentos.modInfo as { file_name?: string; name?: string; version?: string } | undefined;
            const instalado = listas.mods.find((item) => item.name === mod?.name);
            if (instalado && mod?.file_name) {
                instalado.fileName = mod.file_name;
                instalado.version = mod.version ?? instalado.version;
            }
            return mod?.file_name || String(argumentos.fileName || "pacote.jar");
        }
        if (comando === "plugin:event|listen") {
            listeners.set(String(argumentos.event), Number(argumentos.handler));
            return argumentos.handler;
        }
        if (comando === "plugin:event|unlisten") return;
        if (comando === "get_instance_details") return {
            id: argumentos.instanceId, name: `Instância ${argumentos.instanceId}`, version: versaoAmbiente,
            mcType: loaderAmbiente === "Vanilla" ? "Vanilla" : "Modded",
            loaderType: loaderAmbiente, loaderVersion: versaoLoaderAmbiente,
            path: "D:/teste", created: "2026-10-19", memory: 4096,
        };
        if (comando === "get_modpack_info" && new URLSearchParams(location.search).has("modpack")) return {
            projectId: "123", source: new URLSearchParams(location.search).get("modpack"),
            name: "Pacote de teste", author: "Autor", versionId: "v1", installedVersion: "1.0",
        };
        if (comando === "get_minecraft_versions") return { versions: [
            { id: "1.21.1", type: "release" }, { id: "1.20.1", type: "release" },
            { id: "26w01a", type: "snapshot" },
        ] };
        if (comando === "get_loader_versions") {
            if (document.documentElement.dataset.falharLoader === "sim") throw "Falha ao consultar loader";
            return { versions: argumentos.loaderType === "fabric" ? [
                { version: "99.0-beta", stable: false }, { version: "0.17.0", stable: true },
                ...(argumentos.minecraftVersion === "1.21.1" ? [{ version: "0.16.10", stable: true }] : []),
            ] : [{ version: "47.4.10", stable: true }] };
        }
        if (comando === "migrar_versao_instancia") {
            if (document.documentElement.dataset.falharMigracao === "sim") throw "Falha de rede; instância preservada";
            versaoAmbiente = String(argumentos.version);
            loaderAmbiente = String(argumentos.loaderType);
            versaoLoaderAmbiente = String(argumentos.loaderVersion || "");
            listas.mods = [criarItem("Atualizado", "2.0", true, "jar"), criarItem("Incompatível", "1.0", false, "jar")];
            return { versaoAnterior: "1.21.1", versaoNova: versaoAmbiente, modsMigrados: 1,
                modsDesativados: ["Incompatível.jar.disabled"], caminhoBackup: "D:/teste/backup" };
        }
        if (comando === "obter_conteudo_instalado_detalhado") {
            const tipo = String(argumentos.contentType);
            if (document.documentElement.dataset.pausarConteudo === tipo) {
                await new Promise<void>((resolver) => cargasPausadas.set(tipo, resolver));
            }
            const salvas = JSON.parse(sessionStorage.getItem("identificacoes-mods") || "{}");
            return listas[tipo].map((item) => ({ ...item,
                identificacao: tipo === "mods" && !new URLSearchParams(location.search).has("cacheInvalido")
                    ? salvas[item.fileName] || (!new URLSearchParams(location.search).has("externos") ? {
                        projectId: item.name, source: new URLSearchParams(location.search).get("fonte") || "modrinth",
                        versionId: item.version === "4.0" ? "ultima" : item.name,
                    } : undefined) : undefined,
            }));
        }
        if (comando === "identificar_mods_instalados") {
            if (new URLSearchParams(location.search).has("cacheInvalido")) {
                return { itens: [], falhas: ["Arquivo alterado e identificação indisponível."] };
            }
            if (new URLSearchParams(location.search).has("restaurar")) {
                throw new Error("Identificação remota indisponível");
            }
            const itens = listas.mods.map((item) => ({ fileName: item.fileName,
                projectId: new URLSearchParams(location.search).has("externos") ? `projeto-${item.name.split(" ").at(-1)}` : item.name,
                source: new URLSearchParams(location.search).has("externos") && Number(item.name.split(" ").at(-1)) >= 6
                    ? "curseforge" : new URLSearchParams(location.search).get("fonte") || "modrinth",
                versionId: new URLSearchParams(location.search).has("externos")
                    ? `instalada-${item.name.split(" ").at(-1)}`
                    : new URLSearchParams(location.search).has("paginacao") && item.name === "Beta"
                        ? "pagina-25" : item.version === "4.0" ? "ultima" : item.name,
                version: null }));
            if (document.documentElement.dataset.pausarIdentificacao === "sim") {
                await new Promise<void>((resolver) => Object.assign(window, { liberarIdentificacao: resolver }));
            }
            if (document.documentElement.dataset.falharIdentificacao === "sim") {
                return { itens: [], falhas: ["Falha ao identificar mods no CurseForge."] };
            }
            if (new URLSearchParams(location.search).has("externos")) {
                sessionStorage.setItem("identificacoes-mods", JSON.stringify(
                    Object.fromEntries(itens.map((item) => [item.fileName, item]))));
            }
            return { itens, falhas: [] };
        }
        if (comando === "planejar_instalacao_conteudo") {
            const itens = argumentos.itens as Array<{ id: string; nome: string; plataforma: string }>;
            const bloqueados = itens.filter((item) => item.id === "1347822");
            return {
                itens: itens.filter((item) => item.id !== "1347822").map((item) => ({
                    chave: `${item.plataforma}:project:${item.id}`, projectId: item.id, nome: item.nome,
                    nomeArquivo: `${item.id}.jar`, downloadUrl: `https://example.com/${item.id}.jar`,
                    plataforma: item.plataforma, tipoProjeto: "mod", versao: "1", tipoVersao: "release",
                    selecionado: true, requeridoPor: [], selecoes: [`${item.plataforma}:project:${item.id}`],
                })),
                falhas: bloqueados.map((item) => ({
                    chave: `${item.plataforma}:project:${item.id}`, nome: item.nome,
                    motivo: `${item.nome}: O CurseForge não disponibiliza download para terceiros. `
                        + "Baixe este mod no próprio CurseForge e importe para a instância.",
                })),
            };
        }
        if (comando === "search_mods_online" && new URLSearchParams(location.search).has("fila")) {
            return argumentos.platform !== "curseforge" ? [] : [
                ["1347822", "The Fenestra Tapes"], ["a", "Mod A"], ["b", "Mod B"], ["c", "Mod C"],
            ].map(([id, title]) => ({
                id, title, slug: id, author: "Autor", description: "", platform: "curseforge", project_type: "mod",
            }));
        }
        if (comando === "search_mods_online") return Array.from({
            length: new URLSearchParams(location.search).has("navegacao") ? 12 : 1,
        }, (_, indice) => ({
            id: `catalogo-${argumentos.contentType}-${argumentos.platform}${indice || ""}`,
            title: `Catálogo ${argumentos.contentType} ${argumentos.platform}${indice || ""}`,
            slug: `catalogo-${argumentos.contentType}-${argumentos.platform}${indice || ""}`,
            author: `Autor ${argumentos.platform}`, description: "Descrição do conteúdo no catálogo",
            platform: argumentos.platform, project_type: argumentos.contentType,
        }));
        if (comando === "listar_categorias_busca_online") {
            return new URLSearchParams(location.search).has("navegacao") ? [
                { id: "aventura", nome: "Aventura", modrinth: "adventure", curseforge: 447 },
                { id: "desempenho", nome: "Desempenho", modrinth: "optimization", curseforge: 6814 },
            ] : [];
        }
        if (comando === "get_project_versions") return [];
        if (comando === "obter_changelog_versao_curseforge") return `<h2>Notas ${argumentos.fileId}</h2><p>Final das notas</p>`;
        if (comando === "listar_versoes_projeto_curseforge" && new URLSearchParams(location.search).has("paginacao")) {
            return Array.from({ length: 37 }, (_, indice) => ({
                id: `pagina-${indice}`, version_number: indice === 25 ? "1.10" : `${37 - indice}.0`,
                game_versions: ["1.21.1"], loaders: ["fabric"],
                files: [{ url: "https://example.com/mod.jar", filename: indice === 25 ? "Beta.jar" : `mod-${indice}.jar` }],
            }));
        }
        if (comando === "listar_versoes_projeto_curseforge" && new URLSearchParams(location.search).has("externos")) {
            return [{ id: `instalada-${String(argumentos.projectId).split("-").at(-1)}`,
                version_number: "Rotulo remoto", game_versions: ["1.21.1"], loaders: ["fabric"],
                files: argumentos.projectId === "projeto-10" ? [] : [
                    { url: "https://example.com/original.jar", filename: "original.jar" },
                ] }];
        }
        if (comando === "listar_versoes_projeto_curseforge") return [{
            id: "ultima", version_number: "4.0", game_versions: ["1.21.1"], loaders: [],
            files: [{ url: "https://example.com/pacote.zip", filename: "pacote.zip" }],
        }, {
            id: "instalada", version_number: "3.0", game_versions: ["1.21.1"], loaders: [],
            files: [{ url: "https://example.com/Shader.zip", filename: "Shader.zip" }],
        }, {
            id: "mc-incompativel", version_number: "Outro Minecraft", game_versions: ["1.20.1"], loaders: ["fabric"],
            files: [{ url: "https://example.com/antigo.zip", filename: "antigo.zip" }],
        }];
        if (comando === "get_settings") return { ram_mb: 4096, java_args: "",
            show_snapshots: new URLSearchParams(location.search).has("snapshots") };
        if (comando === "get_system_ram") return 16384;
        if (comando === "obter_configuracoes_jogo") return opcoes;
        if (comando === "salvar_configuracoes_jogo") {
            if (document.documentElement.dataset.rejeitar === "sim") throw new Error("Feche o Minecraft desta instância.");
            opcoes = { ...opcoes, ...argumentos.alteracoes as object };
            for (const chave of Object.keys(opcoes)) {
                if (opcoes[chave] === "") delete opcoes[chave];
            }
            return opcoes;
        }
        if (comando === "importar_conteudo_local") {
            const tipo = String(argumentos.contentType);
            listas[tipo].push(criarItem(`Externo ${tipo}`, "1.0", true, tipo === "mods" ? "jar" : "zip"));
            return { adicionados: [`Externo ${tipo}`], erros: [] };
        }
        return null;
    },
} });
Object.assign(window, {
    chamadas,
    tarefasCriacao: getCreatingInstances,
    liberarConteudo: (tipo: string) => {
        delete document.documentElement.dataset.pausarConteudo;
        cargasPausadas.get(tipo)?.();
        cargasPausadas.delete(tipo);
    },
    aplicarCorTeste: aplicarCorDestaque,
    emitirArraste: (evento: string, payload: unknown) => {
        const callback = callbacks.get(listeners.get(`tauri://${evento}`)!);
        if (!callback) throw new Error(`Listener ausente: ${evento}`);
        callback({ event: `tauri://${evento}`, payload });
    },
});
interface DestinoVerificacao {
    aba: "instancia" | "projeto" | "inicio";
    instanciaId: string;
    projeto: ProjetoConteudo | null;
    estado: EstadoNavegacaoInstancia | null;
}

function VerificacaoNavegacao() {
    const [aba, setAba] = useState<DestinoVerificacao["aba"]>("instancia");
    const [instanciaId, setInstanciaId] = useState("teste");
    const [projeto, setProjeto] = useState<ProjetoConteudo | null>(null);
    const [restauracao, setRestauracao] = useState<RestauracaoNavegacaoInstancia | null>(null);
    const controle = useRef<ControleNavegacaoInstancia | null>(null);
    const capturar = useCallback(() => {
        const estado = controle.current?.capturar() ?? null;
        return { aba, instanciaId, projeto, estado };
    }, [aba, instanciaId, projeto]);
    const restaurar = useCallback((destino: DestinoVerificacao) => {
        setAba(destino.aba);
        setInstanciaId(destino.instanciaId);
        setProjeto(destino.projeto);
        setRestauracao(destino.estado ? { instanciaId: destino.instanciaId, estado: destino.estado } : null);
    }, []);
    const { historico, registrarSaida, voltar, avancar } = useHistoricoNavegacao(capturar, restaurar);
    return <>
        <nav>
            <button disabled={!historico.anteriores.length} onClick={() => {
                if (!solicitarNavegacaoInterna(-1)) voltar();
            }}>Voltar histórico</button>
            <button disabled={!historico.proximas.length} onClick={() => {
                if (!solicitarNavegacaoInterna(1)) avancar();
            }}>Avançar histórico</button>
            <button onClick={() => { registrarSaida(); setAba("inicio"); }}>Início de teste</button>
            <button onClick={() => {
                registrarSaida(); setInstanciaId("segunda"); setRestauracao(null); setAba("instancia");
            }}>Abrir segunda instância</button>
        </nav>
        {aba !== "inicio" && <div className={aba === "projeto" ? "hidden" : "min-h-0 flex-1"}>
            <InstanceManager key={instanciaId} ref={controle} instanceId={instanciaId}
                navegacaoAtiva={aba === "instancia"} navegacaoRestaurada={restauracao}
                onRegistrarNavegacao={registrarSaida} onBack={() => {}}
                onAbrirProjeto={(item) => { registrarSaida(); setProjeto(item); setAba("projeto"); }} />
        </div>}
        {aba === "projeto" && <h1>{projeto?.title}</h1>}
    </>;
}

createRoot(document.getElementById("root")!).render(
    <main className="flex h-screen flex-col bg-[#0d0d0e] text-white">
        {new URLSearchParams(location.search).has("navegacao") ? <VerificacaoNavegacao />
        : <InstanceManager instanceId="teste" onBack={() => {}}
            onAbrirProjeto={(projeto) => {
                document.documentElement.dataset.projeto = projeto.id;
                document.documentElement.dataset.fonte = projeto.source;
            }} />}
    </main>,
);
