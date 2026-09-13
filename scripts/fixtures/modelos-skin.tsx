import React from "react";
import { createRoot } from "react-dom/client";
import { ReactSkinview3d } from "react-skinview3d";
import { SkinPreviewRenderer } from "../../src/components/SkinPreviewRenderer";

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
                />
            </section>
        ))}
        <section id="miniatura" style={{ width: 120, height: 160 }}>
            <ReactSkinview3d
                skinUrl={skinUrl}
                width={88}
                height={122}
                options={{ model: "default", zoom: 0.68 }}
                onReady={({ viewer }) => {
                    const distancia = viewer.camera.position.length();
                    viewer.camera.position.set(distancia * 0.52, 0, distancia * 0.85);
                    viewer.camera.lookAt(0, 0, 0);
                    viewer.controls.enableRotate = false;
                    viewer.controls.enableZoom = false;
                    viewer.controls.enablePan = false;
                    viewer.controls.update();
                    document.getElementById("miniatura")!.setAttribute("data-pronto", "true");
                }}
            />
        </section>
    </div>,
);
