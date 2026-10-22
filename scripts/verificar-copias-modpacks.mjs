import { createServer } from 'vite';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const servidor = await createServer({
    optimizeDeps: { entries: ['scripts/fixtures/modpacks-verificacao.tsx'] },
    server: { port: 0, open: false }, plugins: [{
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
    const pagina = await navegador.newPage({ viewport: { width: 1280, height: 800 } });
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
    const cartaoVersao = (numero) => pagina.getByRole('button').filter({
        has: pagina.getByText(numero, { exact: true }),
    });
    for (const fonte of ['modrinth', 'curseforge', 'dome']) {
        await pagina.goto(`${base}?fonte=${fonte}`);
        await pagina.getByRole('heading', { name: 'LostSMP', exact: true }).click();
        await pagina.getByRole('button', { name: 'Versões', exact: true }).click();
        await cartaoVersao('2.0').getByText('Instalada', { exact: true }).waitFor();
        assert.equal(await cartaoVersao('1.0').getByText('Instalada', { exact: true }).count(), 0);
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
        await pagina.getByRole('button').filter({ has: pagina.getByText('1.0', { exact: true }) }).click();
        await pagina.getByRole('button', { name: 'Instalar', exact: true }).click();
        await pagina.waitForFunction(() => document.documentElement.dataset.concluidas === '3');
        await cartaoVersao('1.0').getByText('Instalada', { exact: true }).waitFor();
        await cartaoVersao('2.0').getByText('Instalada', { exact: true }).waitFor();
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
    await cartaoVersao('1.0').getByText('Instalada', { exact: true }).waitFor();
    await pagina.getByRole('button').filter({ has: pagina.getByText('1.0', { exact: true }) }).click();
    await pagina.getByRole('button', { name: 'Trocar versão', exact: true }).click();
    await pagina.waitForFunction(() => document.documentElement.dataset.concluidas === '1');
    const troca = await pagina.evaluate(() => window.chamadas.find((item) => item.comando === 'instalar_modpack_dome'));
    assert.equal(troca.argumentos.instanciaId, 'pasta_original');
    assert.equal(troca.argumentos.versaoId, 'v1');
    await pagina.getByRole('button', { name: 'Instalado', exact: true }).waitFor();
    assert.equal(await pagina.getByRole('button', { name: 'Instalado', exact: true }).isDisabled(), true);
    assert.equal(await cartaoVersao('2.0').getByText('Instalada', { exact: true }).count(), 0);
    await pagina.goto(`${base}?editar=1`);
    await pagina.getByTitle('Editar nome', { exact: true }).click();
    const nome = pagina.getByRole('textbox', { name: 'Nome da instância', exact: true });
    await nome.fill('Minha aventura');
    await nome.press('Enter');
    await pagina.getByRole('heading', { name: 'Minha aventura', exact: true }).waitFor();
    const edicao = await pagina.evaluate(() => window.chamadas.filter((item) => item.comando === 'update_instance_name'));
    assert.deepEqual(edicao[0].argumentos, { instanceId: 'pasta_original', newName: 'Minha aventura' });
    await pagina.getByTitle('Editar nome', { exact: true }).click();
    await nome.fill('Descartar');
    await nome.press('Escape');
    await pagina.getByRole('heading', { name: 'Minha aventura', exact: true }).waitFor();
    assert.equal((await pagina.evaluate(() => window.chamadas.filter((item) => item.comando === 'update_instance_name'))).length, 1);
    assert.deepEqual(erros, []);
    console.log('Renomeação salva com Enter, preserva ID e cancela com Escape. Sem erros na interface.');
} finally {
    await navegador?.close();
    await servidor.close();
}
