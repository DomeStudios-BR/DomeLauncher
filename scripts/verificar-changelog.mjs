import { createServer } from 'vite';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const servidor = await createServer({ server: { port: 0, open: false }, plugins: [{
    name: 'verificacao-changelog',
    configureServer(vite) {
        vite.middlewares.use('/verificacao-changelog', (_req, res) => {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end('<!doctype html><html><head><script type="module">' +
                'import RefreshRuntime from "/@react-refresh"; RefreshRuntime.injectIntoGlobalHook(window);' +
                'window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type;' +
                'window.__vite_plugin_react_preamble_installed__=true;</script></head><body><div id="root"></div>' +
                '<script type="module" src="/scripts/fixtures/changelog-verificacao.tsx"></script></body></html>');
        });
    },
}] });
let navegador;
try {
    await servidor.listen();
    navegador = await chromium.launch({ channel: 'msedge', headless: true, timeout: 15000 });
    const pagina = await navegador.newPage({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1.5 });
    pagina.setDefaultTimeout(15000);
    const erros = [];
    pagina.on('pageerror', (erro) => erros.push(erro.message));
    let falhar = false;
    await pagina.route('https://api.modrinth.com/v2/**', async (rota) => {
        const url = rota.request().url();
        if (url.includes('/project/123/version')) return rota.fulfill({ json:
            ['2.0', '1.0', '0.9'].map((numero, indice) => ({
                id: `v${2 - indice}`, version_number: numero, game_versions: ['1.21.1'], loaders: ['fabric'],
                files: [{ url: 'https://example.com/pacote.zip', filename: `pacote-${numero}.zip` }],
            })),
        });
        if (url.includes('/version/')) {
            if (falhar) return rota.fulfill({ status: 503, body: '{}' });
            const numero = url.endsWith('v2') ? '2.0' : '1.0';
            return rota.fulfill({ json: { changelog: url.endsWith('v0') ? '' :
                `# Notas ${numero}\n\n**Correção ${numero}**\n\n`
                + Array.from({ length: 70 }, (_, i) => `- Mudança ${i}`).join('\n')
                + `\n\nFinal ${numero}`, } });
        }
        return rota.fulfill({ json: { body: 'Descrição', members: [] } });
    });
    const base = servidor.resolvedUrls.local[0] + 'verificacao-changelog';
    const abaVersoes = () => pagina.getByRole('button', { name: 'Versões', exact: true }).click();
    const abrirNotas = () => pagina.getByRole('button', { name: 'Changelog', exact: true }).click();
    const selecionar = (numero) => pagina.getByRole('button', {
        name: `Selecionar versão ${numero}`, exact: true,
    }).click();
    for (const fonte of ['modrinth', 'curseforge', 'dome']) {
        for (const tipo of fonte === 'dome' ? ['modpack'] : ['modpack', 'mod', 'resourcepack', 'shader']) {
            await pagina.goto(`${base}?fonte=${fonte}&tipo=${tipo}`, { waitUntil: 'domcontentloaded' });
            assert.equal(await pagina.getByRole('button', { name: 'Changelog', exact: true }).isEnabled(), true);
            if (tipo === 'modpack') {
                assert.equal(await pagina.getByRole('button', { name: 'Mods', exact: true }).isEnabled(), true);
            } else {
                assert.equal(await pagina.getByRole('button', { name: 'Mods', exact: true }).count(), 0);
                assert.equal(await pagina.getByRole('button', { name: 'Dependências', exact: true }).count(), 1);
            }
            await abaVersoes();
            const selecao = pagina.getByRole('button', { name: 'Selecionar versão 2.0', exact: true });
            await selecao.waitFor();
            assert.equal(await pagina.getByRole('group', { name: 'Versão 1.0', exact: true })
                .getByRole('button').count(), 1, 'O cartão contém somente a seleção de versão.');
            assert.equal(await selecao.getAttribute('aria-pressed'), 'true');
            await abrirNotas();
            await pagina.getByText('Final 2.0', { exact: true }).waitFor();
            await abaVersoes();
            await selecionar('1.0');
            await abrirNotas();
            const notas = pagina.getByRole('region', { name: 'Changelog da versão 1.0', exact: true });
            await notas.getByText('Final 1.0', { exact: true }).waitFor();
            assert.equal(await notas.locator('script, [onerror]').count(), 0);
            assert.equal(await pagina.evaluate(() => window.injetado), undefined);
            await abaVersoes();
            assert.equal(await pagina.getByRole('button', { name: 'Selecionar versão 1.0', exact: true })
                .getAttribute('aria-pressed'), 'true', 'Consultar notas não altera a seleção.');
            await selecionar('0.9');
            await abrirNotas();
            await pagina.getByText('O autor não publicou um changelog para esta versão.', { exact: true }).waitFor();
            if (fonte !== 'dome') {
                await abaVersoes();
                await selecionar('2.0');
                falhar = true;
                await pagina.evaluate(() => { document.documentElement.dataset.falhar = 'sim'; });
                await abrirNotas();
                await pagina.getByRole('alert').waitFor();
                falhar = false;
                await pagina.evaluate(() => { delete document.documentElement.dataset.falhar; });
                await pagina.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
                await pagina.getByText('Final 2.0', { exact: true }).waitFor();
            }
            const instalacoes = await pagina.evaluate(() => window.chamadas.filter((item) =>
                /^(install_|instalar_|create_instance)/.test(item.comando)));
            assert.deepEqual(instalacoes, []);
            console.log(`${fonte}/${tipo}: versão exata, notas completas, seleção preservada, vazio e falha conferidos.`);
        }
    }
    assert.deepEqual(erros, []);
} finally {
    await navegador?.close();
    await servidor.close();
}
