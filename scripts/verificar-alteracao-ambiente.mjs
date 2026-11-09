import { createServer } from 'vite';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const servidor = await createServer({ cacheDir: 'node_modules/.vite-alteracao-ambiente',
    server: { port: 0, strictPort: false, open: false }, plugins: [{
        name: 'verificacao-alteracao-ambiente',
        configureServer(vite) {
            vite.middlewares.use('/verificacao', (_req, res) => {
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                res.end('<!doctype html><html><head><script type="module">'
                    + 'import RefreshRuntime from "/@react-refresh"; RefreshRuntime.injectIntoGlobalHook(window);'
                    + 'window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type;'
                    + 'window.__vite_plugin_react_preamble_installed__=true;</script></head><body><div id="root"></div>'
                    + '<script type="module" src="/scripts/fixtures/instancia-verificacao.tsx"></script></body></html>');
            });
        },
    }] });
let navegador;
try {
    await servidor.listen();
    navegador = await chromium.launch({ channel: 'msedge', headless: true });
    const pagina = await navegador.newPage({ viewport: { width: 960, height: 640 } });
    pagina.setDefaultTimeout(15000);
    pagina.setDefaultNavigationTimeout(45000);
    const erros = [];
    pagina.on('pageerror', (erro) => erros.push(erro.message));
    const base = servidor.resolvedUrls.local[0];
    const abrir = async (fonte = '', snapshots = false) => {
        const parametros = new URLSearchParams();
        if (fonte) parametros.set('modpack', fonte);
        if (snapshots) parametros.set('snapshots', 'sim');
        await pagina.goto(`${base}verificacao?${parametros}`, { waitUntil: 'domcontentloaded' });
        await pagina.getByRole('button', { name: 'Configuração', exact: true }).click();
        for (const titulo of ['Versão e Loader', 'Desempenho', 'Opções do Minecraft']) {
            assert.equal(await pagina.getByRole('button', { name: titulo, exact: true })
                .getAttribute('aria-expanded'), 'false');
        }
        assert.equal(await pagina.evaluate(() => window.chamadas.filter((item) =>
            ['get_minecraft_versions', 'get_loader_versions'].includes(item.comando)).length), 0,
        'A seção fechada não deve consultar versões.');
        await pagina.getByRole('button', { name: 'Versão e Loader', exact: true }).click();
        await pagina.waitForFunction(() => document.querySelector('[aria-label="Versão do Loader"]').value === '0.16.10');
    };
    const ultimaMigracao = () => pagina.evaluate(() => window.chamadas
        .filter((item) => item.comando === 'migrar_versao_instancia').at(-1)?.argumentos);
    const conferirFormulario = async (formulario) => {
        assert.equal(await formulario.evaluate((elemento) => {
            const retangulo = elemento.getBoundingClientRect();
            return retangulo.left >= 0 && retangulo.right <= innerWidth
                && elemento.scrollWidth <= elemento.clientWidth;
        }), true, 'A seção não pode criar rolagem horizontal na janela mínima.');
        assert.equal(await formulario.getByRole('combobox').count(), 3);
        assert.equal(await formulario.getByRole('button', { name: 'Alterar', exact: true }).count(), 1);
        assert.equal(await pagina.getByRole('dialog').count(), 0, 'Os campos ficam dentro da seção.');
        assert.equal(await pagina.getByText(/Mundos e configurações serão preservados/).count(), 0);
    };
    await mkdir('output/verificacao-ambiente', { recursive: true });
    for (const fonte of ['', 'modrinth', 'curseforge', 'dome']) {
        for (const modo of ['minecraft', 'loader', 'versao-loader']) {
            await abrir(fonte);
            const formulario = pagina.getByRole('form', { name: 'Alterar versão e loader' });
            await conferirFormulario(formulario);
            assert.equal(await formulario.getByRole('button', { name: 'Alterar', exact: true }).isDisabled(), true);
            if (modo === 'minecraft') {
                await formulario.getByLabel('Versão do Minecraft', { exact: true }).selectOption('1.20.1');
                await pagina.waitForFunction(() => document.querySelector('[aria-label="Versão do Loader"]').value === '0.17.0');
            } else if (modo === 'loader') {
                await formulario.getByLabel('Loader', { exact: true }).selectOption('Forge');
                await pagina.waitForFunction(() => document.querySelector('[aria-label="Versão do Loader"]').value === '47.4.10');
            } else {
                await formulario.getByLabel('Versão do Loader', { exact: true }).selectOption('0.17.0');
            }
            const consultas = await pagina.evaluate(() => window.chamadas.filter((item) =>
                ['get_minecraft_versions', 'get_loader_versions'].includes(item.comando)).length);
            const versaoEscolhida = await formulario.getByLabel('Versão do Loader', { exact: true }).inputValue();
            const titulo = pagina.getByRole('button', { name: 'Versão e Loader', exact: true });
            await titulo.click();
            await titulo.focus();
            await pagina.keyboard.press('Enter');
            assert.equal(await formulario.getByLabel('Versão do Loader', { exact: true }).inputValue(), versaoEscolhida);
            assert.equal(await pagina.evaluate(() => window.chamadas.filter((item) =>
                ['get_minecraft_versions', 'get_loader_versions'].includes(item.comando)).length), consultas);
            await formulario.getByRole('button', { name: 'Alterar', exact: true }).click();
            await pagina.waitForFunction(() => window.tarefasCriacao().some((tarefa) => tarefa.status === 'complete'));
            const argumentos = await ultimaMigracao();
            assert.equal(argumentos.instanceId, 'teste');
            assert.equal(argumentos.version, modo === 'minecraft' ? '1.20.1' : '1.21.1');
            assert.equal(argumentos.loaderType, modo === 'loader' ? 'forge' : 'fabric');
            assert.equal(argumentos.loaderVersion, modo === 'loader' ? '47.4.10' : '0.17.0');
            assert.match(await pagina.evaluate(() => window.tarefasCriacao()[0].message), /1 mods atualizados; 1 desativados/);
            await pagina.getByRole('button', { name: 'Conteúdo', exact: true }).click();
            await pagina.getByText('Atualizado', { exact: true }).waitFor();
            await pagina.getByText('Incompatível', { exact: true }).waitFor();
            console.log(`${fonte || 'personalizada'}/${modo}: troca isolada, conteúdo relido e resultado informado.`);
        }
    }
    await abrir();
    await pagina.evaluate(() => { document.documentElement.dataset.falharLoader = 'sim'; });
    await pagina.getByLabel('Loader', { exact: true }).selectOption('Forge');
    await pagina.getByText('Falha ao consultar loader', { exact: true }).waitFor();
    assert.equal(await pagina.getByRole('button', { name: 'Alterar', exact: true }).isDisabled(), true);
    assert.equal(await ultimaMigracao(), undefined);
    await pagina.evaluate(() => {
        delete document.documentElement.dataset.falharLoader;
        document.documentElement.dataset.falharMigracao = 'sim';
    });
    await pagina.getByLabel('Loader', { exact: true }).selectOption('NeoForge');
    await pagina.getByRole('button', { name: 'Alterar', exact: true }).click();
    await pagina.waitForFunction(() => window.tarefasCriacao().some((tarefa) => tarefa.status === 'error'));
    await pagina.getByRole('button', { name: 'Conteúdo', exact: true }).click();
    await pagina.getByText('Beta', { exact: true }).waitFor();
    assert.equal(await pagina.getByText('Atualizado', { exact: true }).count(), 0);
    await abrir();
    await pagina.getByLabel('Loader', { exact: true }).selectOption('Vanilla');
    assert.equal(await pagina.getByLabel('Versão do Loader', { exact: true }).isDisabled(), true);
    await pagina.screenshot({ path: 'output/verificacao-ambiente/secao-versao-loader-960.png' });
    await pagina.getByRole('button', { name: 'Alterar', exact: true }).click();
    await pagina.waitForFunction(() => window.tarefasCriacao().some((tarefa) => tarefa.status === 'complete'));
    assert.equal((await ultimaMigracao()).loaderVersion, null);
    for (const snapshots of [false, true]) {
        await abrir('', snapshots);
        const minecraft = pagina.getByLabel('Versão do Minecraft', { exact: true });
        const versoes = await minecraft.locator('option').evaluateAll((itens) => itens.map((item) => item.value));
        assert.equal(versoes.includes('1.21.1'), true);
        assert.equal(versoes.includes('1.20.1'), true);
        assert.equal(versoes.includes('26w01a'), snapshots, 'A alteração deve respeitar Mostrar Snapshots do launcher.');
        if (snapshots) {
            await minecraft.selectOption('26w01a');
            await pagina.getByLabel('Loader', { exact: true }).selectOption('Vanilla');
            await pagina.getByRole('button', { name: 'Alterar', exact: true }).click();
            await pagina.waitForFunction(() => window.tarefasCriacao().some((tarefa) => tarefa.status === 'complete'));
            assert.equal((await ultimaMigracao()).version, '26w01a');
        }
    }
    assert.deepEqual(erros, []);
    console.log('Falhas de consulta e migração preservam o conteúdo; Vanilla não exige versão de loader.');
    console.log('Mostrar Snapshots: releases mantidos nos dois estados e snapshot enviada corretamente na alteração.');
} finally {
    await navegador?.close();
    await servidor.close();
}
