import { createRoot } from "react-dom/client";
import HomePage from "../../src/components/HomePage";
import "../../src/index.css";

const instancias = [{
    id: "vanilla", name: "Vanilla", version: "1.21.11", mc_type: "Vanilla",
    path: "instancias/vanilla", last_played: "2026-10-15T12:00:00Z",
}, {
    id: "fabric", name: "Fabric", version: "1.21.11", mc_type: "Fabric",
    path: "instancias/fabric", last_played: "2026-10-14T12:00:00Z",
}, {
    id: "wynncraft", name: "Wynncraft", version: "1.21.11", mc_type: "Fabric",
    path: "instancias/wynncraft", last_played: "2026-10-13T12:00:00Z",
}];

createRoot(document.getElementById("root")!).render(
    <main className="p-6 text-white">
        <HomePage
            user={null}
            instances={instancias}
            instanciaAtivaId="vanilla"
            onSelectInstance={(instancia) => { document.documentElement.dataset.instancia = instancia.id; }}
            onLaunch={() => { document.documentElement.dataset.acao = "jogar"; }}
            onLaunchServer={() => { document.documentElement.dataset.acao = "servidor"; }}
            onLogin={() => { document.documentElement.dataset.acao = "login"; }}
            biblioteca={null}
        />
    </main>
);
