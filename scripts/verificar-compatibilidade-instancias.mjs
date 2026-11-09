import { createServer } from 'vite';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const servidor = await createServer({ server: { port: 0, strictPort: false, open: false }, plugins: [{
    name: 'verificacao-compatibilidade',
    configureServer(vite) {
        vite.middlewares.use('/verificacao-compatibilidade', (_req, res) => {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end('<!doctype html><html><head><script type="module">' +
                'import RefreshRuntime from "/@react-refresh"; RefreshRuntime.injectIntoGlobalHook(window);' +
                'window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type;' +
                'window.__vite_plugin_react_preamble_installed__=true;</script></head><body><div id="root"></div>' +
                '<script type="module" src="/scripts/fixtures/compatibilidade-verificacao.tsx"></script></body></html>');
        });
    },
}] });
let navegador;
try {
    await servidor.listen();
    navegador = await chromium.launch({ channel: 'msedge', headless: true });
    const pagina = await navegador.newPage({ viewport: { width: 1280, height: 800 } });
    pagina.setDefaultTimeout(10000);
    const erros = [];
    pagina.on('pageerror', (erro) => erros.push(erro.message));
    await pagina.route('https://api.modrinth.com/v2/**', (rota) => rota.fulfill({ json:
        rota.request().url().endsWith('/version') ? [{
            id: 'shine-fabric', version_number: 'Shine teste', game_versions: ['26.2'], loaders: ['fabric'],
            files: [{ url: 'https://example.com/shine.jar', filename: 'shine.jar' }],
        }, {
            id: 'shine-antiga', version_number: 'Shine antiga', game_versions: ['1.19.2'], loaders: ['forge'],
            changelog: 'Notas shine-antiga', files: [{ url: 'https://example.com/antiga.jar', filename: 'antiga.jar' }],
        }, {
            id: 'shine-sem-download', version_number: 'Shine sem download', game_versions: ['1.18.2'],
            loaders: ['quilt'], files: [],
        }] : { body: '' },
    }));
    const base = servidor.resolvedUrls.local[0] + 'verificacao-compatibilidade';
    const cartao = (nome) => pagina.locator('aside button').filter({
        has: pagina.getByText(nome, { exact: true }),
    });
    const aguardarEstado = (nome, estado) => cartao(nome)
        .and(pagina.locator(`[data-compatibilidade="${estado}"]`)).waitFor();
    const consultas = () => pagina.evaluate(() => window.chamadas.filter((item) =>
        item.comando === 'listar_versoes_projeto_curseforge'));
    for (const tipo of ['mod', 'resourcepack', 'shader']) {
        await pagina.goto(`${base}?tipo=${tipo}`);
        await pagina.getByRole('button', { name: 'Versões', exact: true }).click();
        await aguardarEstado('Fabric atual', 'compativel');
        await aguardarEstado('Fabric cópia', 'compativel');
        await aguardarEstado('Fabric antiga', 'incompativel');
        await cartao('Consulta falhou').getByText('Não foi possível verificar a compatibilidade.').waitFor();
        if (tipo === 'mod') {
            await aguardarEstado('NeoForge atual', 'incompativel');
        } else {
            await aguardarEstado('NeoForge atual', 'compativel');
        }
        assert.doesNotMatch(await cartao('Fabric atual').innerText(), /Compatível|sem download/i);
        assert.doesNotMatch(await cartao('Fabric antiga').innerText(), /compatível|compatibilidade/i);
        const corCompativel = await cartao('Fabric atual').evaluate((el) => getComputedStyle(el).backgroundColor);
        const corIncompativel = await cartao('Fabric antiga').evaluate((el) => getComputedStyle(el).backgroundColor);
        assert.notEqual(corCompativel, corIncompativel, 'A instância selecionada deve ter o destaque anterior.');
        assert.equal(await cartao('Fabric cópia').evaluate((el) => getComputedStyle(el).backgroundColor),
            corIncompativel, 'Instâncias não selecionadas usam o fundo neutro anterior.');
        assert.equal((await consultas()).length, tipo === 'mod' ? 4 : 3);
        await cartao('Fabric antiga').click();
        assert.equal(await cartao('Fabric antiga').getAttribute('aria-pressed'), 'true');
        await pagina.waitForFunction((cor) => {
            const selecionada = document.querySelector('aside button[aria-pressed="true"]');
            return selecionada && getComputedStyle(selecionada).backgroundColor !== cor;
        }, corIncompativel);
        assert.notEqual(await cartao('Fabric antiga').evaluate((el) => getComputedStyle(el).backgroundColor),
            corIncompativel, 'A seleção deve usar o destaque anterior.');
        assert.equal(await pagina.getByRole('button', { name: 'Instalar', exact: true }).isDisabled(), true);
        await cartao('Fabric cópia').click();
        await pagina.getByRole('button', { name: 'Selecionar versão Shine teste', exact: true }).waitFor();
        assert.equal(await pagina.getByRole('button', { name: 'Instalar', exact: true }).isEnabled(), true);
        assert.equal((await consultas()).length, tipo === 'mod' ? 4 : 3, 'Trocar seleção reutiliza a consulta.');
        assert.equal(await cartao('Fabric cópia').getAttribute('aria-pressed'), 'true');
        console.log(`CurseForge/${tipo}: avaliação antes do clique, perfis agrupados e seleção conferidos.`);
    }
    await pagina.goto(`${base}?semDownload=sim`);
    await pagina.getByRole('button', { name: 'Versões', exact: true }).click();
    await aguardarEstado('Fabric atual', 'sem-download');
    assert.doesNotMatch(await cartao('Fabric atual').innerText(), /compatível|sem download/i);
    await pagina.getByText('Nenhuma versão disponível.', { exact: true }).waitFor();
    assert.equal(await pagina.getByRole('button', { name: 'Instalar', exact: true }).isDisabled(), true);
    await pagina.goto(`${base}?fonte=modrinth`);
    await pagina.getByRole('button', { name: 'Versões', exact: true }).click();
    await aguardarEstado('Fabric atual', 'compativel');
    await aguardarEstado('NeoForge atual', 'incompativel');
    assert.equal((await consultas()).length, 0);
    for (const fonte of ['modrinth', 'curseforge']) {
        for (const tipo of ['mod', 'resourcepack', 'shader']) {
            await pagina.goto(`${base}?fonte=${fonte}&tipo=${tipo}`);
            await pagina.getByRole('button', { name: 'Versões', exact: true }).click();
            await cartao('Fabric atual').click();
            const todas = pagina.getByRole('button', { name: 'Todas as Versões', exact: true });
            assert.equal(await pagina.locator('aside button').first().textContent().then((s) => s.trim()),
                'Todas as Versões');
            await todas.click();
            await pagina.getByRole('button', { name: 'Selecionar versão Shine antiga', exact: true }).waitFor();
            await pagina.getByRole('button', { name: 'Selecionar versão Shine sem download', exact: true }).waitFor();
            assert.equal(await todas.getAttribute('aria-pressed'), 'true');
            const instalar = pagina.getByRole('button', { name: 'Instalar', exact: true });
            assert.equal(await instalar.isDisabled(), true);
            await pagina.getByRole('button', { name: 'Selecionar versão Shine antiga', exact: true }).click();
            assert.equal(await instalar.isDisabled(), true);
            await instalar.evaluate((botao) => botao.click());
            await pagina.getByRole('button', { name: 'Changelog', exact: true }).click();
            await pagina.getByText('Notas shine-antiga', { exact: true }).waitFor();
            await pagina.getByRole('button', { name: 'Versões', exact: true }).click();
            await pagina.getByRole('searchbox', { name: 'Pesquisar instâncias instaladas', exact: true })
                .fill('nenhuma instância com esse nome');
            assert.equal(await todas.isVisible(), true, 'Todas as Versões permanece acima dos resultados da busca.');
            await pagina.getByRole('searchbox', { name: 'Pesquisar instâncias instaladas', exact: true }).fill('');
            await cartao('Fabric atual').click();
            await pagina.getByRole('button', { name: 'Selecionar versão Shine teste', exact: true }).waitFor();
            assert.equal(await pagina.getByRole('button', { name: 'Selecionar versão Shine antiga', exact: true }).count(), 0);
            assert.equal(await instalar.isEnabled(), true);
            await todas.click();
            await pagina.getByRole('button', { name: 'Selecionar versão Shine antiga', exact: true }).waitFor();
            if (fonte === 'curseforge') {
                const gerais = (await consultas()).filter((item) => item.argumentos.gameVersion === null);
                assert.equal(gerais.length, 1, 'A consulta geral é reaproveitada ao voltar para Todas as Versões.');
                assert.equal(gerais[0].argumentos.loader, null);
            }
            const instalacoes = await pagina.evaluate(() => window.chamadas.filter((item) =>
                /^(install_|instalar_|create_instance)/.test(item.comando)));
            assert.deepEqual(instalacoes, [], 'Consultar todas as versões não pode instalar conteúdo.');
            console.log(`${fonte}/${tipo}: Todas as Versões fixada, sem filtros, sem download e somente consulta.`);
        }
    }
    await pagina.goto(`${base}?falhaGeral=sim`);
    await pagina.getByRole('button', { name: 'Versões', exact: true }).click();
    await pagina.getByRole('button', { name: 'Todas as Versões', exact: true }).click();
    await pagina.getByText('Falha ao carregar todas as versões', { exact: true }).waitFor();
    assert.equal(await pagina.getByRole('button', { name: 'Instalar', exact: true }).isDisabled(), true);
    await pagina.goto(`${base}?lento=sim`);
    await pagina.getByRole('button', { name: 'Versões', exact: true }).click();
    await aguardarEstado('Fabric atual', 'verificando');
    await pagina.getByRole('button', { name: 'Trocar projeto', exact: true }).click();
    await pagina.getByRole('button', { name: 'Versões', exact: true }).click();
    await aguardarEstado('Fabric atual', 'incompativel');
    await pagina.waitForTimeout(900);
    assert.equal(await cartao('Fabric atual').getAttribute('data-compatibilidade'), 'incompativel');
    assert.deepEqual(erros, []);
    console.log('Modrinth preservado; respostas atrasadas de outro projeto ignoradas; falha distinta de incompatibilidade.');
} finally {
    await navegador?.close();
    await servidor.close();
}
