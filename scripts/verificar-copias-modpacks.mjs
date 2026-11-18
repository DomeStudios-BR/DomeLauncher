import { createServer } from 'vite';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const servidor = await createServer({
    optimizeDeps: { entries: ['scripts/fixtures/modpacks-verificacao.tsx'] },
    server: { port: 0, strictPort: false, open: false }, plugins: [{
    name: 'verificacao-copias-modpacks',
    configureServer(vite) {
        vite.middlewares.use('/verificacao-modpacks', (_req, res) => {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end('<!doctype html><html><head><script type="module">' +
                'import RefreshRuntime from "/@react-refresh"; RefreshRuntime.injectIntoGlobalHook(window);' +
                'window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type;' +
                'window.__vite_plugin_react_preamble_installed__=true;</script></head><body><div id="root"></div>' +
                '<script type="module" src="/scripts/fixtures/modpacks-verificacao.tsx"></script></body></html>');
        });
    },
}] });
let navegador;
try {
    await servidor.listen();
    navegador = await chromium.launch({ channel: 'msedge', headless: true, timeout: 15000 });
    const pagina = await navegador.newPage({ viewport: { width: 1280, height: 800 }, timezoneId: 'America/Sao_Paulo' });
    pagina.on('dialog', (dialogo) => dialogo.accept());
    pagina.setDefaultTimeout(15000);
    pagina.setDefaultNavigationTimeout(60000);
    const erros = [];
    pagina.on('pageerror', (erro) => erros.push(erro.message));
    await pagina.route('https://api.modrinth.com/v2/project/pack**', (rota) => rota.fulfill({
        json: rota.request().url().includes('/version') ? ['2.0', '1.0'].map((versao, indice) => ({
            id: `v${2 - indice}`, version_number: versao, game_versions: ['1.21.1'], loaders: ['fabric'],
            files: [{ url: 'https://example.com/pack.zip', filename: 'pack.zip' }],
        })) : { id: 'pack', title: 'LostSMP', slug: 'lostsmp', project_type: 'modpack' },
    }));
    const base = servidor.resolvedUrls.local[0] + 'verificacao-modpacks';
    await pagina.goto(`${base}?configuracoes=1`);
    const abas = pagina.getByRole('tablist', { name: 'Configurações' });
    const abaLauncher = abas.getByRole('tab', { name: 'Launcher', exact: true });
    const painelLauncher = pagina.getByRole('tabpanel', { name: 'Launcher' });
    await painelLauncher.waitFor();
    assert.equal(await abas.getByRole('tab').count(), 6);
    assert.ok((await abas.boundingBox()).x < (await painelLauncher.boundingBox()).x);
    await abaLauncher.press('ArrowDown');
    const abaDesempenho = abas.getByRole('tab', { name: 'Desempenho' });
    assert.equal(await abaDesempenho.getAttribute('aria-selected'), 'true');
    assert.equal(await pagina.getByRole('tabpanel').count(), 1);
    await abas.getByRole('tab', { name: 'Janela do jogo' }).click();
    await pagina.getByRole('tabpanel', { name: 'Janela do jogo' })
        .getByRole('button', { name: '1280 × 720 (HD)' }).waitFor();

    await pagina.goto(`${base}?importarZip=1`);
    await pagina.getByRole('button', { name: 'Importar', exact: true }).click();
    await pagina.getByRole('button', { name: /^Importar de outro launcher/ }).click();
    const importacaoExterna = pagina.getByRole('dialog', { name: 'Importar de outro launcher' });
    const perfil = importacaoExterna.getByRole('button', { name: /^UltimaChance/ });
    await perfil.waitFor();
    assert.equal(await perfil.getAttribute('aria-pressed'), 'true');
    await perfil.click();
    assert.equal(await perfil.getAttribute('aria-pressed'), 'false');
    assert.equal(await importacaoExterna.getByRole('button', { name: 'Importar selecionadas' }).isDisabled(), true);
    for (const invalido of [false, true]) {
        await pagina.goto(`${base}?importarZip=1${invalido ? '&zipInvalido=1' : ''}`);
        await pagina.getByRole('button', { name: 'Importar', exact: true }).click();
        const menu = pagina.getByRole('dialog', { name: 'Importar', exact: true });
        assert.equal(await menu.getByRole('button', { name: /^Importar / }).count(), 2);
        const importar = menu.getByRole('button', { name: /^Importar arquivo/ });
        await importar.click();
        if (invalido) {
            await pagina.getByRole('alert').filter({ hasText: 'manifest.json na raiz' }).waitFor();
            assert.equal(await importar.isEnabled(), true);
        } else {
            await importar.waitFor({ state: 'hidden' });
            await pagina.getByText('UltimaChance', { exact: true }).waitFor();
        }
        const chamadas = await pagina.evaluate(() => window.chamadas);
        const seletor = chamadas.find((chamada) => chamada.comando === 'plugin:dialog|open');
        assert.deepEqual(seletor.argumentos.options.filters[0].extensions, ['dome', 'zip']);
        const importacao = chamadas.find((chamada) => chamada.comando === 'importar_arquivo_biblioteca');
        assert.equal(importacao.argumentos.caminhoArquivo, 'D:/Downloads/UltimaChance-1.4.zip');
    }
    const cartaoVersao = (numero) => pagina.getByRole('group', { name: `Versão ${numero}`, exact: true });
    const conferirDataProjeto = async (dia) => {
        const data = pagina.locator(`time[datetime="2026-10-${dia + 1}T00:00:00Z"]`);
        await data.waitFor();
        assert.equal(await data.textContent(), `${dia}/10/2026`);
    };
    for (const fonte of ['modrinth', 'curseforge', 'dome']) {
        await pagina.goto(`${base}?fonte=${fonte}`);
        await conferirDataProjeto(15);
        await pagina.getByText('Versão 2.0 · Minecraft 1.21.1', { exact: true }).waitFor();
        if (fonte !== 'dome') {
            for (const [categoria, dia] of [['Mods', 16], ['Textures', 17], ['Shaders', 18], ['Modpacks', 15]]) {
                await pagina.getByRole('button', { name: categoria, exact: true }).click();
                await conferirDataProjeto(dia);
            }
        }
        await pagina.getByRole('heading', { name: 'LostSMP', exact: true }).click();
        await pagina.getByRole('button', { name: 'Versões', exact: true }).click();
        await cartaoVersao('2.0').getByText('INSTALADA', { exact: true }).waitFor();
        assert.equal(await cartaoVersao('1.0').getByText('INSTALADA', { exact: true }).count(), 0);
        assert.equal(await pagina.getByRole('button', { name: 'Instalar', exact: true }).isEnabled(), true);
        assert.equal((await pagina.evaluate(() => window.chamadas.filter((item) =>
            item.comando === 'create_instance' || item.comando === 'instalar_modpack_dome'))).length, 0);
        await pagina.goto(`${base}?fonte=${fonte}`);
        const instalar = pagina.getByRole('button', { name: 'Instalar', exact: true });
        await instalar.click();
        await pagina.waitForFunction(() => document.documentElement.dataset.concluidas === '1');
        const chamadas = await pagina.evaluate(() => window.chamadas);
        if (fonte === 'dome') {
            assert.equal(chamadas.find((item) => item.comando === 'instalar_modpack_dome').argumentos.instanciaId, null);
        } else {
            const criacao = chamadas.find((item) => item.comando === 'create_instance');
            assert.equal(criacao.argumentos.copiaModpack, true);
            assert.equal(criacao.argumentos.name, 'LostSMP');
            assert.equal(criacao.argumentos.version, '1.20.1');
            assert.equal(criacao.argumentos.loaderType, 'forge');
            assert.equal(criacao.argumentos.loaderVersion, '47.4.10');
            assert.equal(chamadas.some((item) => item.comando === 'get_loader_versions'), false);
            assert.ok(chamadas.findIndex((item) => item.comando === 'obter_requisitos_modpack') <
                chamadas.findIndex((item) => item.comando === 'create_instance'));
            for (const comando of ['install_modpack_files', 'save_modpack_info']) {
                assert.equal(chamadas.find((item) => item.comando === comando).argumentos.instanceId, 'LostSMP (1)');
            }
        }
        await pagina.getByRole('button', { name: 'Instalar', exact: true }).click();
        await pagina.waitForFunction(() => document.documentElement.dataset.concluidas === '2');
        await pagina.getByRole('button', { name: 'Versões', exact: true }).click();
        await pagina.getByRole('button', { name: 'Selecionar versão 1.0', exact: true }).click();
        await pagina.getByRole('button', { name: 'Instalar', exact: true }).click();
        await pagina.waitForFunction(() => document.documentElement.dataset.concluidas === '3');
        await cartaoVersao('1.0').getByText('INSTALADA', { exact: true }).waitFor();
        await cartaoVersao('2.0').getByText('INSTALADA', { exact: true }).waitFor();
        assert.equal(await pagina.getByRole('button', { name: 'Instalar', exact: true }).isEnabled(), true);
        const ultima = await pagina.evaluate(() => window.chamadas.filter((item) =>
            item.comando === 'instalar_modpack_dome' || item.comando === 'save_modpack_info').at(-1));
        assert.equal(fonte === 'dome' ? ultima.argumentos.versaoId : ultima.argumentos.modpackInfo.versionId, 'v1');
        console.log(`${fonte}: versões instaladas reconhecidas, sem misturar fontes/projetos; cópias continuam livres.`);
    }
    await pagina.goto(`${base}?fonte=curseforge&manifestoInvalido=1`);
    await pagina.getByRole('button', { name: 'Instalar', exact: true }).click();
    await pagina.getByText('O manifesto do modpack não informa a versão do loader.', { exact: true }).first().waitFor();
    assert.equal(await pagina.evaluate(() => window.chamadas.some((item) =>
        item.comando === 'create_instance' || item.comando === 'install_modpack_files')), false);
    await pagina.goto(`${base}?fonte=dome&atualizar=1&outraCopia=1`);
    await pagina.getByRole('heading', { name: 'LostSMP', exact: true }).click();
    const instalado = pagina.getByRole('button', { name: 'Instalado', exact: true });
    await instalado.waitFor();
    assert.equal(await instalado.isDisabled(), true);
    await pagina.getByRole('button', { name: 'Versões', exact: true }).click();
    await cartaoVersao('1.0').getByText('INSTALADA', { exact: true }).waitFor();
    await pagina.getByRole('button', { name: 'Selecionar versão 1.0', exact: true }).click();
    await pagina.getByRole('button', { name: 'Trocar versão', exact: true }).click();
    await pagina.waitForFunction(() => document.documentElement.dataset.concluidas === '1');
    const troca = await pagina.evaluate(() => window.chamadas.find((item) => item.comando === 'instalar_modpack_dome'));
    assert.equal(troca.argumentos.instanciaId, 'pasta_original');
    assert.equal(troca.argumentos.versaoId, 'v1');
    await pagina.getByRole('button', { name: 'Instalado', exact: true }).waitFor();
    assert.equal(await pagina.getByRole('button', { name: 'Instalado', exact: true }).isDisabled(), true);
    assert.equal(await cartaoVersao('2.0').getByText('INSTALADA', { exact: true }).count(), 0);
    await pagina.goto(`${base}?editar=1`);
    await pagina.getByTitle('Editar nome', { exact: true }).click();
    const nome = pagina.getByRole('textbox', { name: 'Nome da instância', exact: true });
    await nome.fill('Minha aventura');
    await nome.press('Enter');
    await pagina.getByRole('dialog', { name: 'Editar inst\u00e2ncia', exact: true }).waitFor({ state: 'hidden' });
    const edicao = await pagina.evaluate(() => window.chamadas.filter((item) => item.comando === 'update_instance_name'));
    assert.deepEqual(edicao[0].argumentos, { instanceId: 'pasta_original', newName: 'Minha aventura' });
    await pagina.getByTitle('Editar nome', { exact: true }).click();
    assert.equal(await nome.inputValue(), 'Minha aventura');
    await nome.fill('Descartar');
    await nome.press('Escape');
    await pagina.getByRole('dialog', { name: 'Editar inst\u00e2ncia', exact: true }).waitFor({ state: 'hidden' });
    assert.equal((await pagina.evaluate(() => window.chamadas.filter((item) => item.comando === 'update_instance_name'))).length, 1);
    assert.deepEqual(erros, []);
    console.log('Renomeação salva com Enter, preserva ID e cancela com Escape. Sem erros na interface.');
} finally {
    await navegador?.close();
    await servidor.close();
}
