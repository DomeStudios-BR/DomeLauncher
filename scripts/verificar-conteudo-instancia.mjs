import { build } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';

const temporario = await mkdtemp(join(tmpdir(), 'dome-instancia-'));
let servidor;
let navegador;
try {
    await build({ configFile: false, root: process.cwd(), plugins: [react(), tailwind()],
        define: { 'process.env.NODE_ENV': JSON.stringify('production'),
            __DOME_CONFIGURACAO_SOCIAL__: JSON.stringify({ apiBaseUrl: 'http://localhost' }) },
        build: { outDir: temporario, lib: { entry: resolve('scripts/fixtures/instancia-verificacao.tsx'),
            name: 'VerificacaoInstancia', formats: ['iife'], fileName: () => 'instancia.js' } } });
    const estilo = (await readdir(temporario)).find((arquivo) => arquivo.endsWith('.css'));
    servidor = createServer(async (req, res) => {
        const arquivo = req.url === '/instancia.js' ? 'instancia.js' : req.url === '/estilo.css' ? estilo : null;
        if (arquivo) {
            res.setHeader('Content-Type', arquivo.endsWith('.css') ? 'text/css' : 'text/javascript');
            res.end(await readFile(join(temporario, arquivo)));
            return;
        }
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end('<!doctype html><html><head><link rel="stylesheet" href="/estilo.css"></head>' +
            '<body><div id="root"></div><script src="/instancia.js"></script></body></html>');
    });
    await new Promise((resolver) => servidor.listen(0, '127.0.0.1', resolver));
    const urlBase = `http://127.0.0.1:${servidor.address().port}/`;
    navegador = await chromium.launch({ channel: 'msedge', headless: true, timeout: 15000 });
    const pagina = await navegador.newPage({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1.5 });
    pagina.setDefaultTimeout(10000);
    pagina.setDefaultNavigationTimeout(30000);
    const erros = [];
    pagina.on('pageerror', (erro) => erros.push(erro.message));
    await pagina.route('https://api.modrinth.com/v2/project/*/version?*', (rota) => rota.fulfill({
        json: [{ id: 'ultima', version_number: '4.0', game_versions: ['1.21.1'], loaders: [],
            files: [{ url: 'https://example.com/pacote.jar', filename: 'pacote.jar' }] }],
    }));
    await pagina.goto(urlBase, { waitUntil: 'domcontentloaded' });
    await pagina.getByRole('button', { name: 'Alfa', exact: true }).waitFor();
    const nomes = () => pagina.locator('#lista-conteudo-instancia .group > .min-w-0 > button').allTextContents();
    assert.deepEqual(await nomes(), ['Alfa', 'Beta']);
    await pagina.getByRole('button', { name: /Ordenar por Nome/ }).click();
    assert.deepEqual(await nomes(), ['Beta', 'Alfa']);
    await pagina.evaluate(() => {
        const lista = document.getElementById('lista-conteudo-instancia');
        const botao = lista.querySelector('button[aria-label^="Ordenar por Versão"]');
        const linhas = [...lista.querySelectorAll('.group')];
        const chamadasAntes = window.chamadas.length;
        const amostras = [];
        let observando = true;
        const observar = () => {
            const textos = document.createTreeWalker(botao, NodeFilter.SHOW_TEXT);
            let texto;
            while ((texto = textos.nextNode()) && !texto.textContent.startsWith('Versão')) {}
            const intervalo = document.createRange();
            intervalo.setStart(texto, 0);
            intervalo.setEnd(texto, 6);
            const rotulo = intervalo.getBoundingClientRect();
            const cabecalho = botao.parentElement.getBoundingClientRect();
            amostras.push({ x: rotulo.x, y: rotulo.y, altura: cabecalho.height,
                topoLista: lista.getBoundingClientRect().top, scrollTop: lista.scrollTop,
                montados: lista.isConnected && botao.isConnected && linhas.every((linha) => linha.isConnected) });
            if (observando) requestAnimationFrame(observar);
        };
        observar();
        window.concluirAmostrasOrdenacao = () => {
            observando = false;
            return { amostras, consultas: window.chamadas.slice(chamadasAntes).filter((chamada) =>
                ['get_instance_details', 'obter_conteudo_instalado_detalhado'].includes(chamada.comando)) };
        };
    });
    await pagina.getByRole('button', { name: /Ordenar por Versão/ }).click();
    assert.deepEqual(await nomes(), ['Alfa', 'Beta']);
    await pagina.getByRole('button', { name: /Ordenar por Versão/ }).click();
    assert.deepEqual(await nomes(), ['Beta', 'Alfa']);
    await pagina.getByRole('button', { name: /Ordenar por Versão/ }).click();
    const ordenacaoAtualizacoes = pagina.getByRole('button', {
        name: 'Ordenar por Versão: atualizações primeiro', exact: true,
    });
    await ordenacaoAtualizacoes.waitFor();
    assert.equal((await ordenacaoAtualizacoes.textContent()).trim(), 'Versão');
    assert.equal(await ordenacaoAtualizacoes.locator('svg').count(), 1);
    assert.deepEqual(await nomes(), ['Beta', 'Alfa']);
    await pagina.getByRole('button', { name: /Ordenar por Versão/ }).click();
    assert.deepEqual(await nomes(), ['Alfa', 'Beta']);

    const transicao = await pagina.evaluate(() => window.concluirAmostrasOrdenacao());
    assert.deepEqual(transicao.consultas, [], 'Ordenar não deve consultar novamente a instância ou o conteúdo.');
    assert(transicao.amostras.length > 3, 'A transição precisa de amostras durante os três estados.');
    const referencia = transicao.amostras[0];
    for (const amostra of transicao.amostras) {
        assert(amostra.montados, 'A ordenação desmontou elementos da lista.');
        for (const campo of ['x', 'y', 'altura', 'topoLista', 'scrollTop']) {
            assert(Math.abs(amostra[campo] - referencia[campo]) < 0.5,
                `A ordenação deslocou ${campo}: ${referencia[campo]} → ${amostra[campo]}.`);
        }
    }

    const botaoVersao = pagina.getByRole('button', { name: /Trocar versão de Beta/ });
    const botaoSemAtualizacao = pagina.getByRole('button', { name: /Trocar versão de Alfa/ });
    assert.equal(await pagina.getByRole('button', { name: 'Atualizar', exact: true }).count(), 0);
    const corInicial = await botaoVersao.evaluate((botao) => getComputedStyle(botao).backgroundColor);
    const corNeutra = await botaoSemAtualizacao.evaluate((botao) => getComputedStyle(botao).backgroundColor);
    await pagina.evaluate(() => window.aplicarCorTeste('#EC4899'));
    await pagina.waitForFunction((corAnterior) => {
        const botao = document.querySelector('button[aria-label^="Trocar versão de Beta"]');
        return botao && getComputedStyle(botao).backgroundColor !== corAnterior;
    }, corInicial);
    const corPersonalizada = await botaoVersao.evaluate((botao) => getComputedStyle(botao).backgroundColor);
    assert.notEqual(corInicial, corPersonalizada);
    assert.notEqual(corPersonalizada, corNeutra);
    assert.equal(await botaoSemAtualizacao.evaluate((botao) => getComputedStyle(botao).backgroundColor), corNeutra);
    await botaoVersao.click();
    await pagina.getByRole('dialog', { name: 'Trocar versão de Beta', exact: true }).waitFor();
    await pagina.getByText('4.0', { exact: true }).waitFor();
    await pagina.getByRole('button', { name: 'Fechar', exact: true }).click();
    await pagina.getByRole('button', { name: /Ordenar por Ativo/ }).click();
    assert.deepEqual(await nomes(), ['Beta', 'Alfa']);
    await pagina.getByRole('button', { name: /Ordenar por Ativo/ }).click();
    assert.deepEqual(await nomes(), ['Alfa', 'Beta']);
    await pagina.getByRole('button', { name: 'Alfa', exact: true }).click();
    assert.equal(await pagina.locator('html').getAttribute('data-projeto'), 'Alfa');
    await pagina.getByRole('button', { name: 'Abrir página de Beta', exact: true }).click();
    assert.equal(await pagina.locator('html').getAttribute('data-projeto'), 'Beta');

    for (const [rotulo, tipo] of [['Mods', 'mods'], ['Resource Packs', 'resourcepacks'], ['Shaders', 'shaders']]) {
        await pagina.getByRole('button', { name: rotulo, exact: true }).click();
        assert.equal(await pagina.getByRole('button', { name: 'Atualizar', exact: true }).count(), 0);
        if (tipo !== 'mods') {
            const versao = pagina.getByRole('button', { name: /Trocar versão de (Textura|Shader)/ });
            assert.match(await versao.getAttribute('aria-label'), /Atualização disponível/);
            await versao.click();
            await pagina.getByText('4.0', { exact: true }).waitFor();
            await pagina.getByRole('button', { name: 'Fechar', exact: true }).click();
        }
        await pagina.evaluate(() => {
            const area = document.querySelector('#lista-conteudo-instancia').getBoundingClientRect();
            const position = { x: (area.left + 80) * devicePixelRatio, y: (area.top + 50) * devicePixelRatio };
            window.emitirArraste('drag-enter', { paths: ['D:/Downloads/pacote.zip'], position });
        });
        await pagina.getByText(/Solte arquivos/).waitFor();
        await pagina.evaluate(() => {
            const area = document.querySelector('#lista-conteudo-instancia').getBoundingClientRect();
            window.emitirArraste('drag-drop', { paths: ['D:/Downloads/pacote.zip'], position: {
                x: (area.left + 80) * devicePixelRatio, y: (area.top + 50) * devicePixelRatio,
            } });
        });
        await pagina.getByRole('button', { name: `Externo ${tipo}`, exact: true }).waitFor();
        const chamada = await pagina.evaluate(() => window.chamadas.filter((item) =>
            item.comando === 'importar_conteudo_local').at(-1));
        assert.equal(chamada.argumentos.contentType, tipo);
        assert.equal(chamada.argumentos.instanceId, 'teste');
    }
    await pagina.getByRole('button', { name: 'Adicionar conteúdo', exact: true }).click();
    const instalacoesAntes = await pagina.evaluate(() => window.chamadas.filter((item) =>
        ['install_mod', 'install_project_file', 'planejar_instalacao_conteudo'].includes(item.comando)).length);
    for (const [rotulo, tipo] of [['Mods', 'mod'], ['Resource Packs', 'resourcepack'], ['Shaders', 'shader']]) {
        await pagina.getByRole('button', { name: rotulo, exact: true }).click();
        for (const fonte of ['modrinth', 'curseforge']) {
            const nome = `Catálogo ${tipo} ${fonte}`;
            const titulo = pagina.getByRole('button', { name: nome, exact: true });
            await titulo.click();
            assert.equal(await pagina.locator('html').getAttribute('data-projeto'), `catalogo-${tipo}-${fonte}`);
            assert.equal(await pagina.locator('html').getAttribute('data-fonte'), fonte);
            assert.equal(await titulo.evaluate((botao) => getComputedStyle(botao).cursor), 'pointer');
            const selecao = pagina.getByRole('button', { name: `Marcar ${nome} para instalar depois`, exact: true });
            assert.equal(await selecao.getAttribute('aria-pressed'), 'false');
            for (const tecla of ['Enter', 'Space']) {
                await pagina.evaluate(() => { delete document.documentElement.dataset.projeto; });
                await titulo.focus();
                await pagina.keyboard.press(tecla);
                assert.equal(await pagina.locator('html').getAttribute('data-projeto'), `catalogo-${tipo}-${fonte}`);
                assert.equal(await selecao.getAttribute('aria-pressed'), 'false');
            }
            const cartao = titulo.locator('xpath=ancestor::div[.//button[@aria-pressed]][1]');
            const descricao = cartao.getByText('Descrição do conteúdo no catálogo', { exact: true });
            await descricao.scrollIntoViewIfNeeded();
            const areaDescricao = await descricao.boundingBox();
            assert(areaDescricao);
            await pagina.mouse.click(areaDescricao.x + 10, areaDescricao.y + areaDescricao.height / 2);
            const desmarcar = pagina.getByRole('button', {
                name: `Desmarcar ${nome} para instalar depois`, exact: true,
            });
            assert.equal(await desmarcar.getAttribute('aria-pressed'), 'true');
            await titulo.click();
            assert.equal(await desmarcar.getAttribute('aria-pressed'), 'true');
            await pagina.getByRole('button', { name: 'Limpar', exact: true }).click();
        }
    }
    assert.equal(await pagina.evaluate(() => window.chamadas.filter((item) =>
        ['install_mod', 'install_project_file', 'planejar_instalacao_conteudo'].includes(item.comando)).length),
    instalacoesAntes, 'Abrir um projeto pelo nome não deve iniciar uma instalação.');
    await pagina.getByRole('button', { name: 'Configuração', exact: true }).click();
    const quantidadeAntes = await pagina.evaluate(() => window.chamadas.filter((item) =>
        item.comando === 'importar_conteudo_local').length);
    await pagina.evaluate(() => window.emitirArraste('drag-drop', {
        paths: ['D:/Downloads/indevido.zip'], position: { x: 400, y: 400 },
    }));
    assert.equal(await pagina.evaluate(() => window.chamadas.filter((item) =>
        item.comando === 'importar_conteudo_local').length), quantidadeAntes);
    const desempenho = pagina.getByRole('button', { name: 'Desempenho', exact: true });
    const opcoesMinecraft = pagina.getByRole('button', { name: 'Opções do Minecraft', exact: true });
    assert.equal(await desempenho.getAttribute('aria-expanded'), 'false');
    assert.equal(await opcoesMinecraft.getAttribute('aria-expanded'), 'false');
    assert.equal(await pagina.getByLabel('Campo de visão', { exact: true }).isVisible(), false);
    await desempenho.focus();
    await pagina.keyboard.press('Enter');
    await pagina.getByLabel('Alocação própria', { exact: true }).waitFor();
    assert.equal(await desempenho.getAttribute('aria-expanded'), 'true');
    assert.equal(await opcoesMinecraft.getAttribute('aria-expanded'), 'false');
    await desempenho.focus();
    await pagina.keyboard.press('Space');
    assert.equal(await desempenho.getAttribute('aria-expanded'), 'false');
    await opcoesMinecraft.click();
    const rolarOpcao = async (nome, delta, valorEsperado) => {
        await pagina.getByLabel(nome, { exact: true }).hover();
        await pagina.mouse.wheel(0, delta);
        await pagina.waitForFunction(({ nome, valorEsperado }) => {
            const campo = [...document.querySelectorAll('[data-opcao-numerica]')]
                .find((elemento) => elemento.getAttribute('aria-label') === nome);
            return campo?.value === valorEsperado;
        }, { nome, valorEsperado });
    };
    for (const [nome, minimo, maximo] of [
        ['Distância de renderização', 2, 64], ['Limite de FPS', 0, 260],
    ]) {
        const seletor = pagina.getByRole('combobox', { name: nome, exact: true });
        const valoresEsperados = ['', ...Array.from({ length: maximo - minimo + 1 },
            (_, indice) => String(minimo + indice))];
        assert.deepEqual(await seletor.locator('option').evaluateAll((opcoes) =>
            opcoes.map((opcao) => opcao.value)), valoresEsperados);
        await seletor.selectOption(String(minimo));
        assert.equal(await seletor.inputValue(), String(minimo));
        await rolarOpcao(nome, 100, '');
        await rolarOpcao(nome, -100, String(minimo));
        await seletor.selectOption(String(maximo));
        assert.equal(await seletor.inputValue(), String(maximo));
    }
    assert.equal(await pagina.getByRole('combobox', { name: 'Limite de FPS', exact: true })
        .locator('option:checked').textContent(), 'Ilimitado');
    for (const nome of ['Brilho', 'Volume geral', 'Música']) {
        const campo = pagina.getByLabel(nome, { exact: true });
        await campo.fill('');
        await rolarOpcao(nome, -100, '0');
        await rolarOpcao(nome, 100, '');
        await rolarOpcao(nome, -100, '0');
        await campo.fill('99');
        await rolarOpcao(nome, -100, '100');
        await pagina.mouse.wheel(0, -100);
        await pagina.waitForTimeout(80);
        assert.equal(await campo.inputValue(), '100');
        await rolarOpcao(nome, 100, '99');
        await campo.fill('');
    }
    await pagina.getByLabel('Campo de visão', { exact: true }).fill('90');
    await pagina.getByLabel('Brilho', { exact: true }).fill('75');
    const leiturasAntes = await pagina.evaluate(() => window.chamadas.filter((item) =>
        item.comando === 'obter_configuracoes_jogo').length);
    await opcoesMinecraft.click();
    assert.equal(await pagina.getByLabel('Campo de visão', { exact: true }).isVisible(), false);
    await opcoesMinecraft.click();
    assert.equal(await pagina.getByLabel('Campo de visão', { exact: true }).inputValue(), '90');
    assert.equal(await pagina.getByLabel('Brilho', { exact: true }).inputValue(), '75');
    assert.equal(await pagina.evaluate(() => window.chamadas.filter((item) =>
        item.comando === 'obter_configuracoes_jogo').length), leiturasAntes);
    await pagina.getByRole('button', { name: 'Salvar opções', exact: true }).click();
    await pagina.getByText('Opções salvas.', { exact: true }).waitFor();
    const salvamento = await pagina.evaluate(() => window.chamadas.filter((item) =>
        item.comando === 'salvar_configuracoes_jogo').at(-1));
    assert.deepEqual(salvamento.argumentos.alteracoes, {
        renderDistance: '64', maxFps: '260', fov: '0.5', gamma: '0.75',
    });
    await pagina.getByRole('button', { name: 'Conteúdo', exact: true }).click();
    await pagina.getByRole('button', { name: 'Configuração', exact: true }).click();
    await opcoesMinecraft.click();
    assert.equal(await pagina.getByLabel('Campo de visão', { exact: true }).inputValue(), '90');
    await pagina.getByLabel('Brilho', { exact: true }).fill('0');
    await rolarOpcao('Brilho', 100, '');
    await pagina.getByRole('button', { name: 'Salvar opções', exact: true }).click();
    await pagina.getByText('Opções salvas.', { exact: true }).waitFor();
    assert.deepEqual(await pagina.evaluate(() => window.chamadas.filter((item) =>
        item.comando === 'salvar_configuracoes_jogo').at(-1).argumentos.alteracoes), { gamma: '' });
    await pagina.getByRole('button', { name: 'Conteúdo', exact: true }).click();
    await pagina.getByRole('button', { name: 'Configuração', exact: true }).click();
    await opcoesMinecraft.click();
    assert.equal(await pagina.getByLabel('Brilho', { exact: true }).inputValue(), '');
    await pagina.evaluate(() => { document.documentElement.dataset.rejeitar = 'sim'; });
    await pagina.getByLabel('Brilho', { exact: true }).fill('80');
    await pagina.getByRole('button', { name: 'Salvar opções', exact: true }).click();
    await pagina.getByText('Feche o Minecraft desta instância.', { exact: false }).waitFor();
    await pagina.goto(urlBase + '?vanilla', { waitUntil: 'domcontentloaded' });
    await pagina.getByRole('button', { name: 'Configuração', exact: true }).click();
    await opcoesMinecraft.click();
    await pagina.getByLabel('Campo de visão', { exact: true }).waitFor();

    await pagina.goto(urlBase + '?navegacao', { waitUntil: 'domcontentloaded' });
    const voltar = pagina.getByRole('button', { name: 'Voltar histórico', exact: true });
    const avancar = pagina.getByRole('button', { name: 'Avançar histórico', exact: true });
    const adicionar = pagina.getByRole('button', { name: 'Adicionar conteúdo', exact: true });
    await adicionar.click();
    await pagina.getByRole('button', { name: 'Resource Packs', exact: true }).click();
    const buscaCatalogo = pagina.getByPlaceholder(/^Buscar no /);
    await buscaCatalogo.fill('Catálogo');
    await pagina.getByRole('button', { name: 'Filtros', exact: true }).click();
    await pagina.getByRole('button', { name: 'Todas as fontes', exact: true }).click();
    await pagina.getByRole('option', { name: 'Modrinth', exact: true }).click();
    await pagina.getByRole('button', { name: 'Modrinth', exact: true }).click();
    await pagina.getByRole('combobox', { name: 'Ordenar por', exact: true }).selectOption('downloads');
    await pagina.getByRole('button', { name: 'Todas as categorias', exact: true }).click();
    await pagina.getByRole('button', { name: 'Incluir Aventura', exact: true }).click();
    await pagina.getByRole('button', { name: 'Negar Desempenho', exact: true }).click();
    const resumoCategorias = pagina.getByRole('button', { name: '1 incluídas • 1 negadas', exact: true });
    await resumoCategorias.click();
    const tituloCatalogo = pagina.getByRole('button', { name: 'Catálogo resourcepack modrinth6', exact: true });
    await tituloCatalogo.waitFor();
    await pagina.waitForFunction(() => window.chamadas.some((item) => item.comando === 'search_mods_online'
        && item.argumentos.query === 'Catálogo' && item.argumentos.filtros.sort === 'downloads'
        && item.argumentos.filtros.categoriasNegadasModrinth.includes('optimization')));
    const marcar = pagina.getByRole('button', {
        name: 'Marcar Catálogo resourcepack modrinth para instalar depois', exact: true,
    });
    await marcar.focus();
    await pagina.keyboard.press('Space');
    await tituloCatalogo.scrollIntoViewIfNeeded();
    const rolagemEsperada = await pagina.locator('#lista-conteudo-instancia').evaluate((lista) => lista.scrollTop);
    assert(rolagemEsperada > 0, 'O teste precisa abrir um projeto após rolar o catálogo.');
    const consultasCatalogo = () => pagina.evaluate(() => window.chamadas.filter((item) =>
        item.comando === 'search_mods_online').length);
    const consultasAntes = await consultasCatalogo();
    const conferirCatalogo = async () => {
        await buscaCatalogo.waitFor();
        assert.equal(await buscaCatalogo.inputValue(), 'Catálogo');
        await pagina.getByRole('button', { name: 'Instância teste', exact: true }).waitFor();
        assert.equal(await pagina.getByRole('combobox', { name: 'Ordenar por', exact: true }).inputValue(), 'downloads');
        assert.equal(await pagina.getByRole('button', { name: 'Modrinth', exact: true }).count(), 1);
        assert.equal(await resumoCategorias.count(), 1);
        assert.equal(await pagina.getByRole('button', {
            name: 'Desmarcar Catálogo resourcepack modrinth para instalar depois', exact: true,
        }).getAttribute('aria-pressed'), 'true');
        await pagina.waitForFunction((esperada) => {
            const lista = document.getElementById('lista-conteudo-instancia');
            return lista && Math.abs(lista.scrollTop - esperada) < 1;
        }, rolagemEsperada);
    };
    await tituloCatalogo.click();
    await pagina.getByRole('heading', { name: 'Catálogo resourcepack modrinth6', exact: true }).waitFor();
    for (let repeticao = 0; repeticao < 2; repeticao++) {
        await voltar.click();
        await conferirCatalogo();
        await avancar.click();
        await pagina.getByRole('heading', { name: 'Catálogo resourcepack modrinth6', exact: true }).waitFor();
    }
    await voltar.click();
    await conferirCatalogo();
    assert.equal(await consultasCatalogo(), consultasAntes, 'Voltar do projeto não deve refazer a busca.');
    await voltar.click();
    await adicionar.waitFor();
    await avancar.click();
    await conferirCatalogo();
    await pagina.getByRole('button', { name: 'Início de teste', exact: true }).click();
    await voltar.click();
    await conferirCatalogo();
    await pagina.getByRole('button', { name: 'Abrir segunda instância', exact: true }).click();
    await pagina.getByRole('button', { name: 'Instância segunda', exact: true }).waitFor();
    await adicionar.click();
    await pagina.getByRole('button', { name: 'Shaders', exact: true }).click();
    await buscaCatalogo.fill('Outro filtro');
    await pagina.getByRole('button', { name: 'Catálogo shader modrinth', exact: true }).waitFor();
    await voltar.click();
    await adicionar.waitFor();
    await voltar.click();
    await conferirCatalogo();
    await avancar.click();
    await pagina.getByRole('button', { name: 'Instância segunda', exact: true }).waitFor();
    await adicionar.waitFor();
    await avancar.click();
    await buscaCatalogo.waitFor();
    assert.equal(await buscaCatalogo.inputValue(), 'Outro filtro');
    await pagina.getByRole('button', { name: 'Catálogo shader modrinth', exact: true }).waitFor();
    await voltar.click();
    await voltar.click();
    await conferirCatalogo();
    await pagina.getByRole('button', { name: 'Início de teste', exact: true }).click();
    assert.equal(await avancar.isEnabled(), false, 'Uma nova navegação deve limpar o histórico de avanço.');
    assert.deepEqual(erros, []);
    console.log('Interface validada em 960×640 e escala 150%: ordenação, versão, catálogo por clique/teclado nas duas fontes/três tipos, seleção, importação, opções, Vanilla e histórico com busca, filtros e rolagem entre projetos, telas e instâncias. IPC simulado.');
} finally {
    await navegador?.close();
    if (servidor) await new Promise((resolver) => servidor.close(resolver));
    if (!resolve(temporario).startsWith(resolve(tmpdir()) + sep)) throw new Error('Diretório temporário inválido.');
    await rm(temporario, { recursive: true, force: true });
}
