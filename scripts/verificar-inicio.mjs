import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium } from "playwright";

const servidor = await createServer({ server: { port: 0, open: false, warmup: { clientFiles: [] } } });
let navegador;
let pagina;
try {
    await servidor.listen();
    navegador = await chromium.launch({ channel: "msedge", headless: true, timeout: 15000 });
    pagina = await navegador.newPage({ viewport: { width: 1350, height: 850 } });
    pagina.setDefaultTimeout(30000);
    const erros = [];
    pagina.on("pageerror", (erro) => {
        erros.push(erro.message);
        console.error("Erro na interface durante a verificação:", erro.message);
    });
    await pagina.addInitScript(() => {
        const teste = window.verificacaoInicio = {
            dados: {
                get_minecraft_news: [{ titulo: "Notícia Minecraft", descricao: "Descrição", url: "https://example.org/1",
                    imagem_url: "/dome-launcher.ico", publicado_em: "2026-10-18T12:00:00Z" }],
                get_launcher_news: [{ id: "dome-1", titulo: "Notícia Dome", resumo: "Descrição", conteudo: "Artigo",
                    imagemUrl: "", categoria: "noticia", versao: "", publicadoEm: "2026-10-19T12:00:00Z" }],
                get_instances: [{ id: "teste", name: "Instância teste", version: "1.21.11", mc_type: "Vanilla",
                    path: "instancias/teste", last_played: "2026-10-18T12:00:00Z" }],
                get_servers: [{ name: "Servidor teste", address: "teste.local", port: 25565 }],
                get_worlds: [{ name: "Mundo teste", path: "saves/teste" }],
                ping_server: { motd: "Servidor online", playerCount: "3/20", ping: 42 },
            },
            consultas: [], bloqueados: [], pendentes: [],
            falhas: location.search.includes("falhaInicial") ? ["get_minecraft_news", "get_launcher_news"] : [],
            liberar() {
                this.bloqueados = [];
                this.pendentes.splice(0).forEach((resolver) => resolver());
            },
        };
        let callbackAtual = 0;
        window.__TAURI_INTERNALS__ = {
            metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
            transformCallback: () => ++callbackAtual,
            unregisterCallback: () => {},
            invoke: async (comando) => {
                teste.consultas.push(comando);
                const dados = structuredClone(teste.dados[comando]);
                const falhar = teste.falhas.includes(comando);
                if (teste.bloqueados.includes(comando)) {
                    await new Promise((resolver) => teste.pendentes.push(resolver));
                }
                if (falhar) throw new Error("Falha simulada");
                if (dados !== undefined) return dados;
                if (comando === "plugin:event|listen") return ++callbackAtual;
                if (comando === "plugin:app|version") return "0.4.4";
                if (comando === "get_running_instances" || comando === "get_settings") return {};
                if (comando === "list_minecraft_accounts") return [];
                if (comando === "gerenciar_transferencias_sociais") return { pedidos: [] };
                return null;
            },
        };
        window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    });
    await pagina.goto(servidor.resolvedUrls.local[0], { waitUntil: "domcontentloaded" });
    const inicio = pagina.locator(".home-dome-figma");
    const novidades = inicio.locator("section").filter({ has: pagina.getByText("Novidades", { exact: true }) });
    const recentes = inicio.locator("section").filter({ has: pagina.getByText("Volte a jogar", { exact: true }) });
    await novidades.getByText("Notícia Minecraft", { exact: true }).waitFor();
    await recentes.getByText("3/20 jogadores", { exact: true }).waitFor();
    await pagina.waitForFunction(() => window.verificacaoInicio.consultas.includes("concluir_migracoes_iniciais"));
    await pagina.waitForTimeout(300);
    await pagina.evaluate(() => {
        window.cartaoNoticia = document.querySelector(".home-dome-figma section button");
        window.cartaoServidor = document.querySelector(".home-dome-figma article");
    });
    const ocultar = async () => {
        await pagina.getByRole("button", { name: "Favoritos", exact: true }).click();
        await inicio.waitFor({ state: "hidden" });
    };
    const abrir = () => pagina.getByRole("button", { name: "Início", exact: true }).click();
    const comandosAtualizacao = ["get_minecraft_news", "get_launcher_news", "get_servers", "get_worlds", "ping_server"];
    const bloquear = () => pagina.evaluate((comandos) => {
        window.verificacaoInicio.bloqueados = comandos;
    }, comandosAtualizacao);
    const conferirPreservacao = async () => {
        assert(await pagina.evaluate(() => window.cartaoNoticia.isConnected && window.cartaoServidor.isConnected),
            "Trocar de aba deve preservar os cartões no DOM.");
        assert.equal(await novidades.locator(".animate-spin").count(), 0,
            "A atualização deve manter as novidades visíveis sem spinner.");
        await recentes.getByText("3/20 jogadores", { exact: true }).waitFor();
    };

    await ocultar();
    const consultasAntes = await pagina.evaluate((comandos) => window.verificacaoInicio.consultas
        .filter((comando) => comandos.includes(comando)).length, comandosAtualizacao);
    await pagina.evaluate(() => {
        window.dispatchEvent(new Event("focus"));
        document.dispatchEvent(new Event("visibilitychange"));
    });
    await pagina.clock.install();
    await pagina.clock.fastForward(31_000);
    assert.equal(await pagina.evaluate((comandos) => window.verificacaoInicio.consultas
        .filter((comando) => comandos.includes(comando)).length, comandosAtualizacao), consultasAntes,
    "A aba oculta deve pausar suas consultas e o ping periódico.");
    await pagina.clock.resume();
    await bloquear();
    await pagina.evaluate(() => {
        window.amostrasInicio = [];
        let quadros = 0;
        const amostrar = () => {
            const inicio = document.querySelector(".home-dome-figma");
            if (inicio.checkVisibility()) {
                const secoes = [...inicio.querySelectorAll("section")].filter((secao) =>
                    ["Novidades", "Volte a jogar"].includes(secao.querySelector("h2")?.textContent));
                const elementos = [inicio.parentElement, ...secoes,
                    ...secoes.flatMap((secao) => [...secao.querySelectorAll("article, button.group")])];
                window.amostrasInicio.push(Math.min(...elementos.map((elemento) =>
                    Number(getComputedStyle(elemento).opacity))));
            }
            if (++quadros < 60) requestAnimationFrame(amostrar);
        };
        requestAnimationFrame(amostrar);
    });
    await abrir();
    await pagina.waitForFunction(() => window.verificacaoInicio.pendentes.length >= 4);
    await conferirPreservacao();
    assert(await pagina.evaluate(() => window.amostrasInicio.length > 0
        && window.amostrasInicio.every((opacidade) => opacidade >= 0.99)),
    "Os cartões preservados não devem repetir a animação de entrada ao voltar.");
    await pagina.evaluate(() => window.verificacaoInicio.liberar());
    await pagina.waitForTimeout(300);
    await conferirPreservacao();
    assert(await pagina.evaluate(() => window.cartaoNoticia === document.querySelector(".home-dome-figma section button")));

    await ocultar();
    await pagina.evaluate(() => {
        const teste = window.verificacaoInicio;
        teste.dados.get_launcher_news[0].titulo = "Notícia Dome editada";
        teste.dados.get_launcher_news.push({ ...teste.dados.get_launcher_news[0], id: "dome-2",
            titulo: "Nova notícia", publicadoEm: "2026-10-20T12:00:00Z" });
        teste.dados.get_worlds[0].name = "Mundo renomeado";
        teste.dados.get_instances[0].name = "Instância renomeada";
    });
    await abrir();
    await novidades.getByText("Nova notícia", { exact: true }).waitFor();
    await novidades.getByText("Notícia Dome editada", { exact: true }).waitFor();
    await recentes.getByText("Mundo renomeado", { exact: true }).waitFor();
    await recentes.getByText("Instância Instância renomeada", { exact: true }).waitFor();
    await conferirPreservacao();
    assert.equal(await novidades.getByText("Notícia Minecraft", { exact: true }).count(), 1);

    await ocultar();
    await pagina.evaluate(() => {
        const teste = window.verificacaoInicio;
        teste.falhas = ["get_minecraft_news", "get_servers", "get_worlds"];
        teste.dados.get_launcher_news[0].titulo = "Dome atualizada com outra fonte indisponível";
    });
    await abrir();
    await novidades.getByText("Dome atualizada com outra fonte indisponível", { exact: true }).waitFor();
    await novidades.getByText("Notícia Minecraft", { exact: true }).waitFor();
    await recentes.getByText("Mundo renomeado", { exact: true }).waitFor();
    await conferirPreservacao();
    await ocultar();
    await pagina.evaluate(() => { window.verificacaoInicio.falhas.push("get_launcher_news"); });
    await abrir();
    await conferirPreservacao();

    await ocultar();
    await pagina.evaluate(() => {
        window.verificacaoInicio.falhas = [];
        window.verificacaoInicio.dados.get_launcher_news[0].titulo = "Resposta antiga";
    });
    await bloquear();
    await abrir();
    await pagina.waitForFunction(() => window.verificacaoInicio.pendentes.length >= 4);
    await ocultar();
    await pagina.evaluate(() => {
        window.respostasAntigas = window.verificacaoInicio.pendentes.splice(0);
        window.verificacaoInicio.bloqueados = [];
        window.verificacaoInicio.dados.get_launcher_news[0].titulo = "Resposta mais recente";
    });
    await abrir();
    await novidades.getByText("Resposta mais recente", { exact: true }).waitFor();
    await pagina.evaluate(() => window.respostasAntigas.forEach((resolver) => resolver()));
    await pagina.waitForTimeout(300);
    assert.equal(await novidades.getByText("Resposta antiga", { exact: true }).count(), 0);

    await pagina.evaluate(() => {
        const teste = window.verificacaoInicio;
        teste.servidoresAnteriores = structuredClone(teste.dados.get_servers);
        teste.dados.get_servers = [];
        teste.dados.get_worlds = [];
        window.dispatchEvent(new Event("focus"));
    });
    await recentes.getByText("Instância renomeada", { exact: true }).waitFor();
    const instanciasAntesDoFoco = await pagina.evaluate(() => window.verificacaoInicio.consultas
        .filter((comando) => comando === "get_instances").length);
    await pagina.evaluate(() => {
        const teste = window.verificacaoInicio;
        teste.dados.get_servers = teste.servidoresAnteriores;
        window.dispatchEvent(new Event("focus"));
    });
    await recentes.getByText("Servidor teste", { exact: true }).waitFor();
    assert.equal(await pagina.evaluate(() => window.verificacaoInicio.consultas
        .filter((comando) => comando === "get_instances").length), instanciasAntesDoFoco,
    "O servidor salvo no jogo deve aparecer ao recuperar o foco, mesmo sem reler as instâncias.");
    await pagina.evaluate(() => {
        window.verificacaoInicio.dados.get_servers[0].name = "Servidor alterado fora do launcher";
        document.dispatchEvent(new Event("visibilitychange"));
    });
    await recentes.getByText("Servidor alterado fora do launcher", { exact: true }).waitFor();
    await bloquear();
    await pagina.evaluate(() => {
        window.verificacaoInicio.dados.get_servers[0].name = "Servidor desatualizado";
        window.dispatchEvent(new Event("focus"));
    });
    await pagina.waitForFunction(() => window.verificacaoInicio.pendentes.length >= 2);
    await pagina.evaluate(() => {
        const teste = window.verificacaoInicio;
        window.respostasAntigas = teste.pendentes.splice(0);
        teste.bloqueados = [];
        teste.dados.get_servers[0].name = "Servidor teste";
        window.dispatchEvent(new Event("focus"));
    });
    await recentes.getByText("Servidor teste", { exact: true }).waitFor();
    await pagina.evaluate(() => window.respostasAntigas.forEach((resolver) => resolver()));
    await pagina.waitForTimeout(300);
    assert.equal(await recentes.getByText("Servidor desatualizado", { exact: true }).count(), 0);

    const leiturasAntesDeOcultar = await pagina.evaluate(() => window.verificacaoInicio.consultas
        .filter((comando) => comando === "get_servers" || comando === "get_worlds").length);
    await recentes.getByTitle("Mais opções").first().click();
    await recentes.getByRole("button", { name: "Remover de Volte a jogar" }).click();
    assert.equal(await recentes.getByText("Servidor teste", { exact: true }).count(), 0);
    assert.equal(await pagina.evaluate(() => window.verificacaoInicio.consultas
        .filter((comando) => comando === "get_servers" || comando === "get_worlds").length), leiturasAntesDeOcultar);
    await ocultar();
    await pagina.evaluate(() => {
        const teste = window.verificacaoInicio;
        teste.dados.get_worlds = [];
        teste.dados.get_servers = [];
        teste.dados.get_minecraft_news = [];
    });
    await abrir();
    await recentes.getByText("Instância renomeada", { exact: true }).waitFor();
    await pagina.waitForFunction(() => !document.querySelector(".home-dome-figma")
        .textContent.includes("Notícia Minecraft"));
    assert.equal(await recentes.getByText("Mundo renomeado", { exact: true }).count(), 0);
    assert.equal(await novidades.getByRole("button").count(), 2);
    await pagina.setViewportSize({ width: 960, height: 640 });
    await ocultar();
    await abrir();
    await novidades.getByText("Resposta mais recente", { exact: true }).waitFor();
    await pagina.goto(servidor.resolvedUrls.local[0] + "?falhaInicial", { waitUntil: "domcontentloaded" });
    const tentarNovamente = novidades.getByRole("button", { name: /Tentar novamente/ });
    await tentarNovamente.waitFor();
    await pagina.evaluate(() => { window.verificacaoInicio.falhas = []; });
    await tentarNovamente.click();
    await novidades.getByText("Notícia Minecraft", { exact: true }).waitFor();
    await novidades.getByText("Notícia Dome", { exact: true }).waitFor();
    await pagina.evaluate(() => localStorage.setItem("dome:volte-a-jogar:ocultos",
        JSON.stringify(["servidor-teste-teste.local-25565"])));
    await pagina.goto(servidor.resolvedUrls.local[0], { waitUntil: "domcontentloaded" });
    await recentes.getByText("Mundo teste", { exact: true }).waitFor();
    assert.equal(await recentes.getByText("Servidor teste", { exact: true }).count(), 1,
        "Uma ocultação antiga sem registro da partida não deve bloquear o servidor para sempre.");
    await recentes.getByTitle("Mais opções").first().click();
    await recentes.getByRole("button", { name: "Remover de Volte a jogar" }).click();
    assert.equal(await recentes.getByText("Servidor teste", { exact: true }).count(), 0);
    await pagina.reload({ waitUntil: "domcontentloaded" });
    await recentes.getByText("Mundo teste", { exact: true }).waitFor();
    assert.equal(await recentes.getByText("Servidor teste", { exact: true }).count(), 0,
        "Reabrir o launcher deve preservar a remoção enquanto não houver outra partida.");
    await pagina.evaluate(() => {
        window.verificacaoInicio.dados.get_instances[0].last_played = "2026-10-20T18:00:00Z";
        window.dispatchEvent(new CustomEvent("dome:instancias-atualizadas"));
    });
    await recentes.getByText("Servidor teste", { exact: true }).waitFor();
    assert.equal(await recentes.getByText("Mundo teste", { exact: true }).count(), 1);
    assert.deepEqual(erros, []);
    console.log("Início verificado no App: DOM preservado, atualização silenciosa, dados novos/editados/removidos, " +
        "retorno ao foco/visibilidade, falhas parciais/totais, respostas atrasadas, ocultação sem releitura " +
        "e até a próxima partida, migração de ocultações antigas e consultas pausadas fora da aba.");
} catch (erro) {
    console.error(erro);
    if (pagina && !pagina.isClosed()) console.error("Conteúdo exibido:", await pagina.locator("body").innerText());
    process.exitCode = 1;
} finally {
    await navegador?.close();
    await servidor.close();
}
