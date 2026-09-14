import React from "react";
import { createRoot } from "react-dom/client";
import { SkinPreviewRenderer } from "../../src/components/SkinPreviewRenderer";
import { MiniaturaSkinMinecraft } from "../../src/components/MiniaturaSkinMinecraft";

const textura = document.createElement("canvas");
textura.width = 64;
textura.height = 64;
const contexto = textura.getContext("2d")!;
contexto.fillStyle = "#20c997";
contexto.fillRect(0, 0, 64, 64);
const skinUrl = textura.toDataURL();

createRoot(document.getElementById("root")!).render(
    <div style={{ display: "flex", gap: 32 }}>
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
