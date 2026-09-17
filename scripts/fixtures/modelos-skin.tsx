import React from "react";
import { createRoot } from "react-dom/client";
import { SkinPreviewRenderer } from "../../src/components/SkinPreviewRenderer";
import { MiniaturaSkinMinecraft } from "../../src/components/MiniaturaSkinMinecraft";
import { SkinManager } from "../../src/components/SkinManager";

const textura = document.createElement("canvas");
textura.width = 64;
textura.height = 64;
const contexto = textura.getContext("2d")!;
contexto.fillStyle = "#20c997";
contexto.fillRect(0, 0, 64, 64);
const skinUrl = textura.toDataURL();
const bytes = Array.from(atob(skinUrl.split(",")[1]), (letra) => letra.charCodeAt(0));
localStorage.setItem("dome-skins-salvas", JSON.stringify([
    { id: "teste", nome: "Skin teste", variant: "classic", bytes, salvaEm: Date.now() },
]));
Object.assign(window, {
    isTauri: true,
    __TAURI_INTERNALS__: {
        invoke: async (comando: string) => {
            if (comando === "obter_cosmeticos_skin") return {
                variant: "slim", skinUrl: "http://textures.minecraft.net/texture/teste",
                capes: [{ id: "teste", state: "ACTIVE", alias: "Capa teste",
                    url: "http://textures.minecraft.net/texture/capa" }],
            };
            if (comando === "baixar_skin_atual") throw new Error("Falha parcial simulada");
            if (comando === "baixar_textura_minecraft") return bytes;
            throw new Error(`Comando inesperado: ${comando}`);
        },
    },
});

createRoot(document.getElementById("root")!).render(
    location.pathname === "/gerenciador" ? <SkinManager user={{
        uuid: "teste", name: "Jogador teste", access_token: "teste",
    }} /> : <div style={{ display: "flex", gap: 32 }}>
        {(["classic", "slim"] as const).map((modelo) => (
            <section key={modelo} id={modelo} style={{ width: 300, height: 400 }}>
                <SkinPreviewRenderer
                    model={modelo}
                    skinUrl={skinUrl}
                    onReady={() => document.getElementById(modelo)!.setAttribute("data-pronto", "true")}
                    onFalhaWebgl={modelo === "classic"
                        ? () => { document.documentElement.dataset.modoSeguro = "true"; }
                        : undefined}
                />
            </section>
        ))}
        <section id="miniatura" style={{ width: 120, height: 160 }}>
            <MiniaturaSkinMinecraft
                skinUrl={skinUrl}
                modelo="classic"
                className="h-full w-auto"
            />
        </section>
    </div>,
);
