import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { chromium } from "playwright";

const temporario = await mkdtemp(join(tmpdir(), "dome-motd-"));
let servidor;
let navegador;

try {
    await build({
        configFile: false,
        root: process.cwd(),
        plugins: [react(), tailwind()],
        define: {
            "process.env.NODE_ENV": JSON.stringify("production"),
            "__DOME_CONFIGURACAO_SOCIAL__": JSON.stringify({ apiBaseUrl: "http://localhost" }),
        },
        build: {
            outDir: temporario,
            lib: {
                entry: resolve("scripts/fixtures/motd-verificacao.tsx"),
                name: "VerificacaoMotd", formats: ["iife"], fileName: () => "motd.js",
            },
        },
    });
    servidor = createServer(async (requisicao, resposta) => {
        if (requisicao.url === "/dome-launcher.ico") {
            resposta.setHeader("Content-Type", "image/x-icon");
            resposta.end(await readFile(resolve("public/dome-launcher.ico")));
            return;
        }
        const arquivo = requisicao.url === "/motd.js" ? "motd.js"
            : requisicao.url === "/estilo.css" ? "dome-launcher.css" : null;
        if (arquivo) {
            resposta.setHeader("Content-Type", arquivo.endsWith(".css") ? "text/css" : "text/javascript");
            resposta.end(await readFile(join(temporario, arquivo)));
            return;
        }
        if (requisicao.url !== "/") {
            resposta.writeHead(404).end();
            return;
        }
        resposta.setHeader("Content-Type", "text/html; charset=utf-8");
        resposta.end('<!doctype html><html><head><link rel="stylesheet" href="/estilo.css"></head>'
            + '<body style="background:#161616"><div id="root"></div><script src="/motd.js"></script></body></html>');
    });
    await new Promise((resolver) => servidor.listen(0, "127.0.0.1", resolver));
    navegador = await chromium.launch({ channel: "msedge", headless: true });
    const pagina = await navegador.newPage({ viewport: { width: 1350, height: 720 } });
    pagina.setDefaultTimeout(10000);
    pagina.setDefaultNavigationTimeout(15000);
    const erros = [];
    pagina.on("pageerror", (erro) => erros.push(erro.message));
    await pagina.addInitScript(() => {
        window.__TAURI_INTERNALS__ = {
            invoke: async (comando, argumentos) => {
                if (comando === "get_servers") return argumentos.instanceId === "vanilla"
                    ? [{ name: "Servidor de teste", address: "teste.local", port: 25565 }] : [];
                if (comando === "get_worlds") return argumentos.instanceId === "vanilla"
                    ? [{ name: "Meu mundo", path: "saves/mundo" }] : [];
                if (comando === "ping_server") return {
                    motd: "Texto sem cores que não deve substituir o componente",
                    motdComponentes: { text: "Servidor colorido", color: "green", extra: [
                        { text: "\nSegunda linha RGB", color: "#12abcd", bold: true },
                    ] },
                    playerCount: "12/100", ping: 42,
                };
                return [];
            },
        };
    });
    await pagina.goto(`http://127.0.0.1:${servidor.address().port}`, { waitUntil: "networkidle" });
    const secao = pagina.locator("section").filter({ has: pagina.getByText("Volte a jogar", { exact: true }) });
    await secao.getByText("Servidor colorido", { exact: true }).waitFor();
    await pagina.evaluate(() => document.fonts.ready);
    const estilos = await secao.getByText("Servidor colorido", { exact: true }).evaluate((elemento) => ({
        cor: getComputedStyle(elemento).color,
        espacos: getComputedStyle(elemento).whiteSpace,
    }));
    assert.equal(estilos.cor, "rgb(85, 255, 85)");
    assert.equal(estilos.espacos, "pre-wrap");
    const segundaLinha = await secao.getByText("Segunda linha RGB", { exact: true }).evaluate((elemento) => ({
        cor: getComputedStyle(elemento).color, peso: getComputedStyle(elemento).fontWeight,
    }));
    assert.deepEqual(segundaLinha, { cor: "rgb(18, 171, 205)", peso: "700" });
    const posicoes = await secao.locator("article").evaluateAll((cartoes) => cartoes.map((cartao) => {
        const { x, y, width, height } = cartao.getBoundingClientRect();
        return { x, y, width, height };
    }));
    assert.equal(posicoes.length, 4);
    assert.equal(posicoes[0].height, posicoes[1].height);
    assert.equal(posicoes[2].height, posicoes[3].height);
    const centralizado = await secao.locator("article").nth(1).evaluate((cartao) => {
        const caixa = cartao.getBoundingClientRect();
        const conteudo = cartao.firstElementChild;
        const icone = conteudo.firstElementChild.getBoundingClientRect();
        const corpo = conteudo.getBoundingClientRect();
        const rodape = cartao.lastElementChild.getBoundingClientRect();
        return Math.abs(corpo.y + corpo.height / 2 - icone.y - icone.height / 2) < 1
            && rodape.bottom < caixa.bottom && rodape.top >= corpo.bottom;
    });
    assert(centralizado, "O conteúdo do mundo deve ficar centralizado acima do rodapé.");
    const contextos = await secao.locator("article").evaluateAll((cartoes) => cartoes.map((cartao) => {
        const rodape = cartao.lastElementChild;
        return { texto: rodape.textContent, y: rodape.getBoundingClientRect().y };
    }));
    assert(contextos[1].texto.includes("Instância Vanilla"));
    assert(contextos[1].texto.includes("1.21.11"));
    assert(contextos[2].texto.includes("Fabric"));
    assert(contextos[2].texto.includes("1.21.11"));
    assert.equal(contextos[0].y, contextos[1].y);
    assert.equal(contextos[2].y, contextos[3].y);
    assert.equal(posicoes[0].y, posicoes[1].y);
    assert(posicoes[1].x > posicoes[0].x);
    assert.equal(posicoes[0].x, posicoes[2].x);
    assert.equal(posicoes[1].x, posicoes[3].x);
    assert.equal(posicoes[2].y, posicoes[3].y);
    assert(posicoes[2].y > posicoes[0].y + posicoes[0].height);
    assert.equal(await secao.getByText("12/100 jogadores", { exact: true }).count(), 1);
    const rodape = await secao.getByText("12/100 jogadores", { exact: true }).evaluate((elemento) => {
        const faixa = elemento.parentElement;
        const linha = faixa.previousElementSibling;
        return {
            borda: getComputedStyle(faixa).borderTopWidth,
            separado: faixa.getBoundingClientRect().top >= linha.getBoundingClientRect().bottom,
            ping: faixa.textContent.includes("42ms"),
        };
    });
    assert.deepEqual(rodape, { borda: "1px", separado: true, ping: true });
    assert.equal(await secao.getByRole("button", { name: "Jogar", exact: true }).count(), 4);
    const fonteTitulo = await secao.getByText("Servidor de teste", { exact: true }).evaluate((elemento) =>
        getComputedStyle(elemento).fontFamily);
    const fontesBotoes = await secao.getByRole("button", { name: "Jogar", exact: true }).evaluateAll((botoes) =>
        botoes.map((botao) => getComputedStyle(botao.firstElementChild).fontFamily));
    assert(fonteTitulo.includes("MinecraftTen"));
    assert(fontesBotoes.every((fonte) => fonte === fonteTitulo));
    assert.equal(await secao.getByRole("button", { name: "Abrir", exact: true }).count(), 0);
    await secao.getByRole("button", { name: "Jogar", exact: true }).first().click();
    assert.equal(await pagina.locator("html").getAttribute("data-acao"), "login");
    await secao.getByText("Meu mundo", { exact: true }).click();
    assert.equal(await pagina.locator("html").getAttribute("data-instancia"), "vanilla");
    await secao.screenshot({ path: resolve("../output/motd-cartoes-verificados.png") });
    await pagina.setViewportSize({ width: 360, height: 800 });
    assert(await pagina.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    const colunasMobile = await secao.locator("article").evaluateAll((cartoes) =>
        new Set(cartoes.map((cartao) => cartao.getBoundingClientRect().x)).size);
    assert.equal(colunasMobile, 1);
    assert.deepEqual(erros, []);
    console.log("MOTD validado: cores, alturas iguais por linha, conteúdo centralizado, rodapé e botões Jogar.");
} finally {
    await navegador?.close();
    if (servidor) await new Promise((resolver) => servidor.close(resolver));
    await rm(temporario, { recursive: true, force: true });
}
