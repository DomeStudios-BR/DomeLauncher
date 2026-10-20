import { createRoot } from "react-dom/client";
import { useCallback, useRef, useState } from "react";
import InstanceManager, {
    type ControleNavegacaoInstancia, type EstadoNavegacaoInstancia, type RestauracaoNavegacaoInstancia,
} from "../../src/components/InstanceManager";
import type { ProjetoConteudo } from "../../src/components/ProjetoDetalheModal";
import { useHistoricoNavegacao } from "../../src/hooks/useHistoricoNavegacao";
import { solicitarNavegacaoInterna } from "../../src/lib/navegacaoInterna";
import { aplicarCorDestaque } from "../../src/lib/corDestaque";
import "../../src/index.css";

const callbacks = new Map<number, (evento: unknown) => void>();
const listeners = new Map<string, number>();
const chamadas: Array<{ comando: string; argumentos: Record<string, unknown> }> = [];
let proximoCallback = 0;
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
const cache = {};
for (const [filtro, itens] of Object.entries(listas)) {
    const tipo = filtro === "mods" ? "mod" : filtro === "shaders" ? "shader" : "resourcepack";
    for (const item of itens) cache[`teste::${tipo}::${item.fileName.toLowerCase()}`] = {
        name: item.name, author: item.author, projectId: item.name,
        source: filtro === "shaders" ? "curseforge" : "modrinth", projectType: tipo,
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
        if (comando === "plugin:event|listen") {
            listeners.set(String(argumentos.event), Number(argumentos.handler));
            return argumentos.handler;
        }
        if (comando === "plugin:event|unlisten") return;
        if (comando === "get_instance_details") return {
            id: argumentos.instanceId, name: `Instância ${argumentos.instanceId}`, version: "1.21.1", mcType: "fabric",
            loaderType: new URLSearchParams(location.search).has("vanilla") ? "Vanilla" : "Fabric",
            path: "D:/teste", created: "2026-10-19", memory: 4096,
        };
        if (comando === "obter_conteudo_instalado_detalhado") return [...listas[String(argumentos.contentType)]];
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
        if (comando === "listar_versoes_projeto_curseforge") return [{
            id: "ultima", version_number: "4.0", game_versions: ["1.21.1"], loaders: [],
            files: [{ url: "https://example.com/pacote.zip", filename: "pacote.zip" }],
        }];
        if (comando === "get_settings") return { ram_mb: 4096, java_args: "" };
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
