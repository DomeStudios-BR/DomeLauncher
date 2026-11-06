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
        json: [{ id: 'mc-incompativel', version_number: 'Outro Minecraft', game_versions: ['1.20.1'], loaders: ['fabric'],
            files: [{ url: 'https://example.com/antigo.jar', filename: 'antigo.jar' }] },
            { id: 'loader-incompativel', version_number: 'Outro loader', game_versions: ['1.21.1'], loaders: ['forge'],
                files: [{ url: 'https://example.com/forge.jar', filename: 'forge.jar' }] },
            { id: 'ultima', version_number: '4.0', game_versions: ['1.21.1'], loaders: ['fabric'],
            files: [{ url: 'https://example.com/pacote.jar', filename: 'pacote.jar' }] },
            ...[['Beta', '1.10'], ['Alfa', '1.2'], ['Textura', '2.0']].map(([nome, numero]) => ({
                id: nome, version_number: numero, game_versions: ['1.21.1'], loaders: [],
                files: [{ url: 'https://example.com/pacote.zip',
                    filename: `${nome}.${nome === 'Textura' ? 'zip' : 'jar'}` }],
                changelog: `# Notas ${nome}\n\nFinal das notas`,
            }))],
    }));
    await pagina.route('https://api.modrinth.com/v2/version/*', (rota) => rota.fulfill({
        json: { changelog: '# Notas da versão\n\nFinal das notas' },
    }));
    await pagina.goto(urlBase, { waitUntil: 'domcontentloaded' });
    await pagina.getByRole('button', { name: 'Alfa', exact: true }).waitFor();
    const nomes = () => pagina.locator('#lista-conteudo-instancia .group > .min-w-0 > button').allTextContents();
    assert.deepEqual(await nomes(), ['Alfa', 'Beta']);
    const leiturasConteudo = () => pagina.evaluate(() => window.chamadas.filter((item) =>
        item.comando === 'obter_conteudo_instalado_detalhado').map((item) => item.argumentos.contentType));
    await pagina.evaluate(() => { document.documentElement.dataset.pausarConteudo = 'resourcepacks'; });
    await pagina.getByRole('button', { name: 'Resource Packs', exact: true }).click();
    await pagina.waitForFunction(() => window.chamadas.some((item) =>
        item.comando === 'obter_conteudo_instalado_detalhado' && item.argumentos.contentType === 'resourcepacks'));
    await pagina.getByRole('button', { name: 'Mods', exact: true }).click();
    await pagina.getByRole('button', { name: 'Alfa', exact: true }).waitFor();
    await pagina.getByRole('button', { name: 'Resource Packs', exact: true }).click();
    assert.deepEqual(await leiturasConteudo(), ['mods', 'resourcepacks'], 'Reabrir não duplica a carga pendente.');
    await pagina.evaluate(() => window.liberarConteudo('resourcepacks'));
    await pagina.getByRole('button', { name: 'Textura', exact: true }).waitFor();
    await pagina.getByRole('button', { name: 'Shaders', exact: true }).click();
    await pagina.getByRole('button', { name: 'Shader', exact: true }).waitFor();
    for (const rotulo of ['Mods', 'Resource Packs', 'Shaders', 'Mods']) {
        await pagina.getByRole('button', { name: rotulo, exact: true }).click();
    }
    await pagina.getByRole('button', { name: 'Configuração', exact: true }).click();
    await pagina.getByRole('button', { name: 'Conteúdo', exact: true }).click();
    await pagina.getByRole('button', { name: 'Alfa', exact: true }).waitFor();
    assert.deepEqual(await leiturasConteudo(), ['mods', 'resourcepacks', 'shaders'],
        'Cada categoria é lida uma vez enquanto a instância está aberta.');
    let aberturas = 0;
    for (const [rotulo, categoria] of [['Mods', 'mods'], ['Resource Packs', 'resourcepacks'], ['Shaders', 'shaders']]) {
        const aba = pagina.getByRole('button', { name: rotulo, exact: true });
        await aba.click();
        assert.equal(await pagina.evaluate(() => window.chamadas.filter((item) =>
            item.comando === 'abrir_pasta_instancia').length), aberturas, 'Clique simples apenas seleciona a categoria.');
        await aba.dblclick();
        const chamadas = await pagina.evaluate(() => window.chamadas.filter((item) =>
            item.comando === 'abrir_pasta_instancia'));
        assert.equal(chamadas.length, ++aberturas, 'Cada duplo clique deve abrir uma pasta uma vez.');
        assert.deepEqual(chamadas.at(-1).argumentos, { instanceId: 'teste', tipoConteudo: categoria });
    }
    await pagina.getByRole('button', { name: 'Mods', exact: true }).click();
    assert.deepEqual(await leiturasConteudo(), ['mods', 'resourcepacks', 'shaders'],
        'O duplo clique não deve reler as categorias já carregadas.');
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
    for (const botao of [botaoVersao, botaoSemAtualizacao]) {
        const estilo = await botao.evaluate((elemento) => {
            const estilo = getComputedStyle(elemento);
            const versao = elemento.nextElementSibling;
            const icone = elemento.getBoundingClientRect();
            const numero = versao.getBoundingClientRect();
            return { borda: estilo.borderRightWidth,
                bordaVersao: getComputedStyle(versao).borderLeftWidth,
                espaco: numero.left - icone.right, alturaIcone: icone.height, alturaVersao: numero.height };
        });
        assert.equal(estilo.borda, '1px', 'O ícone deve ter moldura própria.');
        assert.equal(estilo.bordaVersao, '1px', 'A versão deve ter moldura própria.');
        assert.ok(estilo.espaco > 0, 'As molduras devem ficar separadas.');
        assert.equal(estilo.alturaIcone, estilo.alturaVersao, 'Os botões devem ter a mesma altura.');
    }
    const corInicial = await botaoVersao.evaluate((botao) => getComputedStyle(botao).color);
    const corNeutra = await botaoSemAtualizacao.evaluate((botao) => getComputedStyle(botao).color);
    await pagina.evaluate(() => window.aplicarCorTeste('#EC4899'));
    await pagina.waitForFunction((corAnterior) => {
        const botao = document.querySelector('button[aria-label^="Trocar versão de Beta"]');
        return botao && getComputedStyle(botao).color !== corAnterior;
    }, corInicial);
    const corPersonalizada = await botaoVersao.evaluate((botao) => getComputedStyle(botao).color);
    assert.notEqual(corInicial, corPersonalizada);
    assert.notEqual(corPersonalizada, corNeutra);
    assert.equal(await botaoSemAtualizacao.evaluate((botao) => getComputedStyle(botao).color), corNeutra);
    await botaoVersao.click();
    await pagina.getByRole('dialog', { name: 'Trocar versão de Beta', exact: true }).waitFor();
    await pagina.getByText('4.0', { exact: true }).waitFor();
    assert.equal(await pagina.getByText('Outro Minecraft', { exact: true }).count(), 0);
    assert.equal(await pagina.getByText('Outro loader', { exact: true }).count(), 0);
    const abaChangelog = pagina.getByRole('button', { name: 'Changelog', exact: true });
    assert.equal(await abaChangelog.isVisible(), true, 'Changelog deve estar disponível ao abrir a troca de versão.');
    assert.equal(await pagina.getByText('O arquivo atual só é removido após a nova versão ser instalada.',
        { exact: true }).count(), 0);
    assert.equal(await pagina.getByText(/Somente versões compatíveis com Minecraft/).count(), 0);
    await abaChangelog.click();
    await pagina.getByRole('region', { name: 'Changelog da versão 1.10', exact: true })
        .getByText('Final das notas', { exact: true }).waitFor();
    await pagina.getByRole('button', { name: 'Versões', exact: true }).click();
    await pagina.locator('input[name="versao-conteudo"][value="ultima"]').check();
    await abaChangelog.click();
    await pagina.getByRole('region', { name: 'Changelog da versão 4.0', exact: true })
        .getByText('Final das notas', { exact: true }).waitFor();
    await pagina.getByRole('button', { name: 'Versões', exact: true }).click();
    await pagina.locator('input[name="versao-conteudo"][value="Beta"]').check();
    const trocarMod = pagina.getByRole('button', { name: 'Trocar versão', exact: true });
    assert.ok(await trocarMod.evaluate((botao) => {
        const acao = botao.getBoundingClientRect();
        const dialogo = botao.closest('[role="dialog"]').getBoundingClientRect();
        return Math.abs(acao.left + acao.width / 2 - dialogo.left - dialogo.width / 2) < 1;
    }), 'O botão de trocar versão do conteúdo deve ficar no centro do modal.');
    const selecaoAntes = await pagina.locator('input[name="versao-conteudo"]:checked').inputValue();
    await pagina.getByRole('button', { name: 'Ver changelog da versão 4.0', exact: true }).click();
    await pagina.getByText('Final das notas', { exact: true }).waitFor();
    assert.equal(await pagina.getByRole('button', { name: 'Trocar versão', exact: true }).count(), 0);
    await pagina.getByRole('button', { name: 'Versões', exact: true }).click();
    assert.equal(await pagina.locator('input[name="versao-conteudo"]:checked').inputValue(), selecaoAntes);
    await abaChangelog.click();
    await pagina.getByRole('region', { name: 'Changelog da versão 1.10', exact: true })
        .getByText('Final das notas', { exact: true }).waitFor();
    await pagina.getByRole('button', { name: 'Versões', exact: true }).click();
    await pagina.locator('input[name="versao-conteudo"][value="ultima"]').check();
    await pagina.evaluate(() => { document.documentElement.dataset.falharInstalacao = 'sim'; });
    await trocarMod.click();
    await pagina.getByText('Falha simulada no download', { exact: true }).waitFor();
    assert.equal(await pagina.evaluate(() => window.chamadas.filter((c) => c.comando === 'remove_project_file').length), 0,
        'Falha na instalação não pode remover o arquivo anterior.');
    await pagina.evaluate(() => { delete document.documentElement.dataset.falharInstalacao; });
    await pagina.evaluate(() => { document.documentElement.dataset.pausarInstalacao = 'sim'; });
    await trocarMod.click();
    await pagina.getByRole('button', { name: 'Trocando versão… 30%', exact: true }).waitFor();
    assert.equal(await pagina.evaluate(() => window.chamadas.filter((c) => c.comando === 'remove_project_file').length), 0);
    await pagina.evaluate(() => { delete document.documentElement.dataset.pausarInstalacao; window.liberarInstalacao(); });
    await pagina.getByRole('dialog', { name: 'Trocar versão de Beta', exact: true }).waitFor({ state: 'hidden' });
    const remocao = await pagina.evaluate(() => window.chamadas.find((c) => c.comando === 'remove_project_file'));
    assert.equal(remocao.argumentos.fileName, 'Beta.jar');
    await pagina.getByRole('button', { name: 'Mundos', exact: true }).click();
    await pagina.getByText('4,02 KiB', { exact: true }).waitFor();
    assert.equal(await pagina.getByText('4,02 KiB', { exact: true }).getAttribute('title'), '4.113 bytes');
    await pagina.getByRole('button', { name: 'Conteúdo', exact: true }).click();
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
            await abaChangelog.click();
            await pagina.getByRole('region', {
                name: `Changelog da versão ${tipo === 'resourcepacks' ? '2.0' : '3.0'}`, exact: true,
            }).getByText('Final das notas', { exact: true }).waitFor();
            await pagina.getByRole('button', { name: 'Versões', exact: true }).click();
            await pagina.locator('input[name="versao-conteudo"][value="ultima"]').check();
            await abaChangelog.click();
            await pagina.getByRole('region', { name: 'Changelog da versão 4.0', exact: true })
                .getByText('Final das notas', { exact: true }).waitFor();
            await pagina.getByRole('button', { name: 'Fechar', exact: true }).click();
        }
        const nome = tipo === 'mods' ? 'Beta' : tipo === 'resourcepacks' ? 'Textura' : 'Shader';
        const leiturasAntesDaImportacao = (await leiturasConteudo()).filter((categoria) => categoria === tipo).length;
        await pagina.getByRole('button', { name: new RegExp(`^Changelog de ${nome}, versão`) }).click();
        const regiaoNotas = pagina.getByRole('region', { name: new RegExp('^Changelog da versão') });
        await regiaoNotas.getByText('Final das notas', { exact: true }).waitFor();
        const atual = tipo === 'mods' ? '4.0' : tipo === 'resourcepacks' ? '2.0' : '3.0';
        await regiaoNotas.getByRole('heading', { name: atual, exact: true }).waitFor();
        await pagina.getByRole('button', { name: 'Fechar', exact: true }).click();
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
        assert.equal((await leiturasConteudo()).filter((categoria) => categoria === tipo).length,
            leiturasAntesDaImportacao + 1, 'Importar atualiza a categoria mesmo quando já estava carregada.');
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
        ['Escala da interface', 0, 3],
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
    const escalaInterface = pagina.getByRole('combobox', { name: 'Escala da interface', exact: true });
    assert.equal(await escalaInterface.locator('option[value="0"]').textContent(), '0 — Automática');
    await rolarOpcao('Escala da interface', 100, '2');
    await rolarOpcao('Escala da interface', -100, '3');
    await pagina.mouse.wheel(0, -100);
    await pagina.waitForTimeout(80);
    assert.equal(await escalaInterface.inputValue(), '3');
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
        renderDistance: '64', maxFps: '260', guiScale: '3', fov: '0.5', gamma: '0.75',
    });
    await pagina.getByRole('button', { name: 'Conteúdo', exact: true }).click();
    await pagina.getByRole('button', { name: 'Configuração', exact: true }).click();
    await opcoesMinecraft.click();
    assert.equal(await pagina.getByLabel('Campo de visão', { exact: true }).inputValue(), '90');
    await pagina.getByLabel('Brilho', { exact: true }).fill('0');
    assert.equal(await escalaInterface.inputValue(), '3');
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
    await pagina.goto(`${urlBase}?fila`, { waitUntil: 'domcontentloaded' });
    await pagina.getByRole('button', { name: 'Adicionar conteúdo', exact: true }).click();
    await pagina.getByRole('button', { name: 'Mods', exact: true }).click();
    for (const nome of ['The Fenestra Tapes', 'Mod A', 'Mod B', 'Mod C']) {
        await pagina.getByRole('button', { name: `Marcar ${nome} para instalar depois`, exact: true }).click();
    }
    await pagina.getByRole('button', { name: 'Revisar e confirmar', exact: true }).click();
    const revisao = pagina.getByRole('dialog', { name: 'Revise e confirme' });
    await revisao.getByText('The Fenestra Tapes', { exact: true }).waitFor();
    const avisoFenestra = revisao.getByRole('region', { name: 'Conteúdos pendentes' }).locator('article').filter({
        has: pagina.getByText('The Fenestra Tapes', { exact: true }),
    });
    assert.equal(await avisoFenestra.locator('p').nth(1).textContent(),
        'O CurseForge não disponibiliza download para terceiros. '
        + 'Baixe este mod no próprio CurseForge e importe para a instância.',
        'O motivo não deve repetir o nome que já aparece no título.');
    assert.equal(await revisao.getByRole('button', { name: 'Baixar', exact: true }).isEnabled(), true,
        'Uma restrição de download não pode bloquear os outros projetos.');
    assert.equal(await revisao.evaluate((elemento) => elemento.scrollWidth <= elemento.clientWidth), true);
    await pagina.evaluate(() => { document.documentElement.dataset.falharArquivo = 'b.jar'; });
    await revisao.getByRole('button', { name: 'Baixar', exact: true }).click();
    await revisao.getByRole('region', { name: 'Conteúdos pendentes' }).getByText('Mod B', { exact: true }).waitFor();
    const instaladosNaFila = () => pagina.evaluate(() => window.chamadas.filter((chamada) =>
        chamada.comando === 'install_project_file').map((chamada) => chamada.argumentos.fileName));
    assert.deepEqual(await instaladosNaFila(), ['a.jar', 'b.jar', 'c.jar'],
        'A falha de B não impede o download de C.');
    await revisao.getByRole('button', { name: 'Voltar', exact: true }).click();
    for (const nome of ['Mod A', 'Mod C']) {
        assert.equal(await pagina.getByRole('button', {
            name: `Marcar ${nome} para instalar depois`, exact: true,
        }).count(), 1, 'Somente os projetos concluídos saem da fila.');
    }
    for (const nome of ['The Fenestra Tapes', 'Mod B']) {
        assert.equal(await pagina.getByRole('button', {
            name: `Desmarcar ${nome} para instalar depois`, exact: true,
        }).count(), 1, 'Os projetos com falha ficam selecionados para nova tentativa.');
    }
    await pagina.evaluate(() => { delete document.documentElement.dataset.falharArquivo; });
    await pagina.getByRole('button', { name: 'Revisar e confirmar', exact: true }).click();
    await revisao.getByRole('button', { name: 'Baixar', exact: true }).click();
    await revisao.getByRole('button', { name: 'Voltar', exact: true }).waitFor();
    await pagina.waitForFunction(() => window.chamadas.filter((chamada) =>
        chamada.comando === 'install_project_file').length === 4);
    await revisao.getByRole('button', { name: 'Voltar', exact: true }).click();
    await pagina.getByRole('button', { name: 'Revisar e confirmar', exact: true }).click();
    await revisao.getByText('The Fenestra Tapes', { exact: true }).waitFor();
    assert.equal(await revisao.getByRole('button', { name: 'Baixar', exact: true }).isEnabled(), false,
        'Quando só resta um projeto sem download, não existe instalação para iniciar.');
    assert.deepEqual(await instaladosNaFila(), ['a.jar', 'b.jar', 'c.jar', 'b.jar']);
    console.log('Fila validada: restrição na preparação, falha no download, continuação dos demais e nova tentativa apenas dos pendentes.');
    await pagina.goto(urlBase + '?externos', { waitUntil: 'domcontentloaded' });
    await pagina.getByRole('button', { name: 'Externo 11', exact: true }).waitFor();
    await pagina.getByText('Identificando mods…', { exact: true }).waitFor({ state: 'hidden' });
    for (let indice = 0; indice < 12; indice++) {
        assert.equal(await pagina.getByRole('button', {
            name: new RegExp(`^Trocar versão de Externo ${indice}([.]|$)`),
        }).isEnabled(), true, 'Todos os mods externos devem permitir consultar versões, inclusive os desativados.');
    }
    assert.equal(await pagina.evaluate(() => window.chamadas.filter((item) =>
        item.comando === 'search_mods_online').length), 0, 'Mods devem ser identificados pelo arquivo, sem busca pelo nome.');
    await pagina.getByRole('button', { name: 'Externo 11', exact: true }).click();
    assert.equal(await pagina.locator('html').getAttribute('data-fonte'), 'curseforge');
    assert.equal(await pagina.locator('html').getAttribute('data-projeto'), 'projeto-11');
    await pagina.getByRole('button', { name: /^Trocar versão de Externo 11([.]|$)/ }).click();
    await pagina.locator('input[name="versao-conteudo"][value="instalada-11"]:checked').waitFor();
    await pagina.getByText('Atual', { exact: true }).waitFor();
    await pagina.getByRole('button', { name: 'Fechar', exact: true }).click();
    await pagina.getByRole('button', { name: /^Trocar versão de Externo 10([.]|$)/ }).click();
    await pagina.getByText(/O CurseForge não disponibiliza download para terceiros/).waitFor();
    assert.equal(await pagina.getByRole('button', { name: 'Trocar versão', exact: true }).isEnabled(), false);
    await pagina.getByRole('button', { name: 'Fechar', exact: true }).click();
    const importarModExterno = () => pagina.evaluate(() => {
        const area = document.querySelector('#lista-conteudo-instancia').getBoundingClientRect();
        window.emitirArraste('drag-drop', { paths: ['D:/Downloads/externo.jar'], position: {
            x: (area.left + 80) * devicePixelRatio, y: (area.top + 50) * devicePixelRatio,
        } });
    });
    await pagina.evaluate(() => { document.documentElement.dataset.falharIdentificacao = 'sim'; });
    await importarModExterno();
    await pagina.getByText('Falha ao identificar mods no CurseForge.', { exact: true }).waitFor();
    assert.equal(await pagina.getByRole('button', { name: /^Trocar versão de Externo 11([.]|$)/ }).isEnabled(), true,
        'Falha de rede deve preservar as correspondências anteriores.');
    await pagina.evaluate(() => { delete document.documentElement.dataset.falharIdentificacao; });
    await pagina.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
    await pagina.getByText('Falha ao identificar mods no CurseForge.', { exact: true }).waitFor({ state: 'hidden' });
    await pagina.getByText('Identificando mods…', { exact: true }).waitFor({ state: 'hidden' });
    await pagina.evaluate(() => { document.documentElement.dataset.pausarIdentificacao = 'sim'; });
    await importarModExterno();
    await pagina.getByText('Identificando mods…', { exact: true }).waitFor();
    await pagina.waitForFunction(() => typeof window.liberarIdentificacao === 'function');
    await pagina.evaluate(() => { delete document.documentElement.dataset.pausarIdentificacao; });
    await importarModExterno();
    await pagina.getByText('Identificando mods…', { exact: true }).waitFor({ state: 'hidden' });
    const antesDaRespostaAntiga = await nomes();
    await pagina.evaluate(() => window.liberarIdentificacao());
    assert.deepEqual(await nomes(), antesDaRespostaAntiga, 'Identificação antiga não pode substituir uma importação nova.');
    console.log('Mods externos: 12 arquivos sem cache, desativados/renomeados, fonte correta, versão exata, bloqueio de download, nova tentativa e resposta antiga.');
    await pagina.goto(urlBase + '?externos&restaurar', { waitUntil: 'domcontentloaded' });
    await pagina.getByText(/Identificação remota indisponível/).waitFor();
    assert.equal(await pagina.getByRole('button', { name: /^Trocar versão de Externo 11([.]|$)/ }).isEnabled(), true,
        'Reabrir restaura o vínculo nativo mesmo sem cache da interface e sem rede.');
    await pagina.getByRole('button', { name: 'Externo 11', exact: true }).click();
    assert.equal(await pagina.locator('html').getAttribute('data-fonte'), 'curseforge');
    assert.equal(await pagina.locator('html').getAttribute('data-projeto'), 'projeto-11');
    await pagina.getByRole('button', { name: /^Trocar versão de Externo 11([.]|$)/ }).click();
    await pagina.locator('input[name="versao-conteudo"][value="instalada-11"]:checked').waitFor();
    console.log('Identificação restaurada na reabertura: projeto, fonte e versão independem do cache da interface.');
    assert.deepEqual(erros, []);
    console.log('Interface validada em 960×640 e escala 150%: reutilização das três categorias, carga pendente sem duplicação, atualização após importação, ordenação, versão, catálogo, seleção, opções, Vanilla e histórico entre projetos, telas e instâncias. IPC simulado.');
} finally {
    await navegador?.close();
    if (servidor) await new Promise((resolver) => servidor.close(resolver));
    if (!resolve(temporario).startsWith(resolve(tmpdir()) + sep)) throw new Error('Diretório temporário inválido.');
    await rm(temporario, { recursive: true, force: true });
}
