import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright";

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporario = await mkdtemp(join(tmpdir(), "dome-modelos-skin-"));
const configuracao = JSON.parse(await readFile(join(raiz, "src-tauri/tauri.conf.json"), "utf8"));
const politicaAtual: string = configuracao.app.security.csp;
const politicaAnterior = politicaAtual.replace(/connect-src[^;]+/, (diretiva) =>
    diretiva.replace(/\sdata:/g, ""),
);

try {
    await build({
        configFile: false,
        root: raiz,
        plugins: [react()],
        define: { "process.env.NODE_ENV": JSON.stringify("production") },
        build: {
            outDir: temporario,
            lib: {
                entry: join(raiz, "scripts/fixtures/modelos-skin.tsx"),
                name: "VerificacaoModelos",
                formats: ["iife"],
                fileName: () => "modelos.js",
            },
        },
    });
    const codigo = await readFile(join(temporario, "modelos.js"));
    const servidor = createServer((requisicao, resposta) => {
        if (requisicao.url === "/modelos.js") {
            resposta.writeHead(200, { "Content-Type": "text/javascript" });
            resposta.end(codigo);
            return;
        }
        resposta.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Content-Security-Policy": requisicao.url === "/anterior" ? politicaAnterior : politicaAtual,
        });
        resposta.end(
            '<!doctype html><html><body style="background:#171717"><div id="root"></div>' +
            '<script src="/modelos.js"></script></body></html>',
        );
    });
    await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
    const endereco = servidor.address();
    if (!endereco || typeof endereco === "string") throw new Error("Servidor de teste indisponível.");
    const url = `http://127.0.0.1:${endereco.port}/`;
    try {
        const navegador = await chromium.launch({
            channel: process.platform === "win32" ? "msedge" : undefined,
            headless: true,
            timeout: 15000,
        });
        try {
            const pagina = await navegador.newPage();
            await pagina.addInitScript(() => {
                document.addEventListener("securitypolicyviolation", (evento) => {
                    if (evento.effectiveDirective === "connect-src" && evento.blockedURI === "data") {
                        document.documentElement.dataset.bloqueioDados = "true";
                    }
                });
            });
            await pagina.goto(`${url}anterior`);
            await pagina.waitForFunction(() =>
                document.documentElement.dataset.bloqueioDados === "true" &&
                document.body.textContent?.includes("Não foi possível carregar o modelo 3D."),
            );
            console.log("Reproduzido: CSP anterior bloqueia os buffers embutidos e impede o modelo 3D.");

            const erros: string[] = [];
            pagina.on("pageerror", (erro) => erros.push(erro.message));
            await pagina.goto(`${url}atual`);
            await pagina.waitForFunction(() =>
                document.querySelectorAll('[data-pronto="true"]').length === 2,
            );
            await pagina.waitForTimeout(300);
            if (await pagina.locator("html").getAttribute("data-bloqueio-dados")) {
                throw new Error("A política atual ainda bloqueia os modelos.");
            }
            if (erros.length || await pagina.getByText("Não foi possível carregar o modelo 3D.").count()) {
                throw new Error(`Falha na renderização: ${erros.join("; ")}`);
            }
            await pagina.locator("#classic canvas").dispatchEvent("webglcontextlost");
            await pagina.waitForFunction(() => document.documentElement.dataset.modoSeguro === "true");
            const destinoImagem = process.env.DOME_CAPTURA_SKINS;
            if (destinoImagem) await pagina.screenshot({ path: destinoImagem });
            console.log("Validado: modelos clássico e slim carregados com bundle minificado e CSP de produção.");
        } finally {
            await navegador.close();
        }
    } finally {
        servidor.closeAllConnections();
        await new Promise<void>((resolve) => servidor.close(() => resolve()));
    }
} finally {
    if (dirname(resolve(temporario)) !== resolve(tmpdir()) || !basename(temporario).startsWith("dome-modelos-skin-")) {
        throw new Error("Diretório temporário fora da área de verificação.");
    }
    await rm(temporario, { recursive: true, force: true });
}
