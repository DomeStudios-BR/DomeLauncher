import { createServer } from 'vite';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const servidor = await createServer({ cacheDir: 'node_modules/.vite-paginacao-versoes',
    server: { port: 0, strictPort: false, open: false }, plugins: [{
    name: 'verificacao-paginacao',
    configureServer(vite) {
        for (const [rota, arquivo] of [['/verificacao-projeto', 'projetos-modpacks'], ['/verificacao-modal', 'instancia']]) {
            vite.middlewares.use(rota, (_req, res) => {
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                res.end('<!doctype html><html><head><script type="module">'
                    + 'import RefreshRuntime from "/@react-refresh"; RefreshRuntime.injectIntoGlobalHook(window);'
                    + 'window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type;'
                    + 'window.__vite_plugin_react_preamble_installed__=true;</script></head><body><div id="root"></div>'
                    + `<script type="module" src="/scripts/fixtures/${arquivo}-verificacao.tsx"></script></body></html>`);
            });
        }
    },
}] });
let navegador;
try {
    await servidor.listen();
    navegador = await chromium.launch({ channel: 'msedge', headless: true });
    const pagina = await navegador.newPage({ viewport: { width: 1280, height: 1000 }, timezoneId: 'America/Sao_Paulo' });
    pagina.setDefaultTimeout(15000);
    pagina.setDefaultNavigationTimeout(45000);
    const erros = [];
    const consultasRemotas = [];
    pagina.on('pageerror', (erro) => erros.push(erro.message));
    await pagina.route('https://api.modrinth.com/v2/**', (rota) => {
        const url = new URL(rota.request().url());
        if (!url.pathname.endsWith('/version')) return rota.fulfill({ json: { body: 'Descrição completa', members: [] } });
        consultasRemotas.push(url.href);
        const modal = pagina.url().includes('verificacao-modal');
        return rota.fulfill({ json: Array.from({ length: 37 }, (_, indice) => ({
            id: `pagina-${indice}`, version_number: modal && indice === 25 ? '1.10' : `${37 - indice}.0`,
            game_versions: ['1.21.1'], loaders: ['fabric'], changelog: `Notas ${37 - indice}.0`,
            date_published: new Date(Date.UTC(2026, 9, 25) - indice * 86_400_000).toISOString(),
            files: [{ url: 'https://example.com/mod.jar', filename: modal && indice === 25 ? 'Beta.jar' : `mod-${indice}.jar` }],
        })) });
    });
    const base = servidor.resolvedUrls.local[0];
    await mkdir('output/verificacao-projetos', { recursive: true });
    const projetos = '[role="group"][aria-label^="Versão "]';
    const modal = 'label:has(input[name="versao-conteudo"])';
    const contarConsultas = async () => consultasRemotas.length + await pagina.evaluate(() =>
        window.chamadas.filter((item) => item.comando === 'listar_versoes_projeto_curseforge'
            || item.comando === 'gerenciar_modpacks_dome' && item.argumentos.acao === 'versoes').length);
    const primeiraPagina = async () => {
        const anterior = pagina.getByRole('button', { name: 'Página anterior', exact: true });
        while (await anterior.isEnabled()) await anterior.click();
    };
    const conferirGrade = async (seletor, colunas, quantidade) => {
        await pagina.waitForFunction(({ seletor, colunas, quantidade }) => {
            const itens = [...document.querySelectorAll(seletor)].filter((item) => item.getClientRects().length);
            if (itens.length !== quantidade) return false;
            const retangulos = itens.map((item) => item.getBoundingClientRect());
            return retangulos.filter((item) => item.top === retangulos[0].top).length === Math.min(colunas, quantidade);
        }, { seletor, colunas, quantidade });
        const geometria = await pagina.locator(seletor).first().evaluate((cartao) => {
            const textos = [...cartao.querySelectorAll('p, span')];
            const mc = textos.find((item) => item.textContent.trim().startsWith('MC:')).getBoundingClientRect();
            const loader = textos.find((item) => item.textContent.trim().startsWith('Loader:')).getBoundingClientRect();
            return { abaixo: loader.top >= mc.bottom, vazamento: cartao.scrollWidth > cartao.clientWidth };
        });
        assert.equal(geometria.abaixo, true, 'Loader deve ficar abaixo de MC.');
        assert.equal(geometria.vazamento, false, 'Os blocos não podem escapar do cartão.');
        if (seletor === modal) {
            assert.equal(await pagina.locator(seletor).last().evaluate((cartao) => {
                let area = cartao.parentElement;
                while (area && getComputedStyle(area).overflowY !== 'auto') area = area.parentElement;
                return area && cartao.getBoundingClientRect().bottom <= area.getBoundingClientRect().bottom + 1;
            }), true, 'Todas as linhas da página devem caber acima do rodapé do modal.');
        }
    };
    const conferirPainelLateral = async () => {
        const posicao = await pagina.locator('aside').evaluate((painel) => {
            const grade = document.querySelector('[role="group"][aria-label^="Versão "]').parentElement;
            const lateral = painel.getBoundingClientRect();
            const versoes = grade.getBoundingClientRect();
            return { aoLado: lateral.left >= versoes.right, dentroDaJanela: lateral.right <= innerWidth,
                semVazamento: painel.scrollWidth <= painel.clientWidth };
        });
        assert.equal(posicao.aoLado, true, 'O painel de instalação deve permanecer à direita das versões.');
        assert.equal(posicao.dentroDaJanela, true, 'O painel não pode escapar da janela.');
        assert.equal(posicao.semVazamento, true, 'O conteúdo não pode alargar o painel.');
    };
    for (const fonte of ['modrinth', 'curseforge', 'dome']) {
        for (const tipo of fonte === 'dome' ? ['modpack'] : ['modpack', 'mod', 'resourcepack', 'shader']) {
            await pagina.setViewportSize({ width: 1280, height: 1000 });
            await pagina.goto(`${base}verificacao-projeto?fonte=${fonte}&tipo=${tipo}&paginacao`, { waitUntil: 'domcontentloaded' });
            await pagina.getByRole('button', { name: 'Versões', exact: true }).click();
            await conferirGrade(projetos, 2, 8);
            const primeiraData = pagina.locator(projetos).first().locator('time');
            assert.equal(await primeiraData.getAttribute('datetime'), '2026-10-25T00:00:00.000Z');
            assert.equal(await primeiraData.textContent(), 'Lançou: 24/10/2026');
            assert.equal(await primeiraData.locator('svg').count(), 0);
            const consultas = await contarConsultas();
            await pagina.getByRole('button', { name: 'Próxima página', exact: true }).click();
            await conferirGrade(projetos, 2, 8);
            const proxima = pagina.getByRole('button', { name: 'Próxima página', exact: true });
            while (await proxima.isEnabled()) await proxima.click();
            await conferirGrade(projetos, 2, 5);
            assert.equal(await pagina.locator(projetos).last().locator('time').textContent(), 'Lançou: 18/09/2026');
            assert.equal(await pagina.getByRole('button', { name: 'Próxima página', exact: true }).isDisabled(), true);
            await pagina.getByRole('button', { name: 'Changelog', exact: true }).click();
            await pagina.getByRole('region', { name: 'Changelog da versão 37.0', exact: true }).waitFor();
            await pagina.getByRole('button', { name: 'Versões', exact: true }).click();
            await conferirGrade(projetos, 2, 5);
            for (const [largura, altura] of [[1280, 1000], [960, 640], [690, 640]]) {
                await pagina.setViewportSize({ width: largura, height: altura });
                await primeiraPagina();
                await conferirGrade(projetos, 2, 8);
                if (tipo !== 'modpack') await conferirPainelLateral();
            }
            assert.equal(await contarConsultas(), consultas, 'Paginar e redimensionar não devem consultar versões novamente.');
            console.log(`${fonte}/${tipo}: oito versões em 2×4, painel à direita e seleção preservada.`);
        }
    }
    await pagina.setViewportSize({ width: 960, height: 640 });
    await pagina.goto(`${base}verificacao-projeto?fonte=modrinth&tipo=mod&paginacao&muitasInstancias`,
        { waitUntil: 'domcontentloaded' });
    await pagina.getByRole('button', { name: 'Versões', exact: true }).click();
    await conferirGrade(projetos, 2, 8);
    await conferirPainelLateral();
    assert.equal(await pagina.locator('aside').evaluate((painel) =>
        painel.scrollHeight <= painel.clientHeight), true, 'A instalação não deve criar uma área de rolagem interna.');
    await pagina.locator('main').evaluate((area) => { area.scrollTop = area.scrollHeight; });
    assert.equal(await pagina.getByRole('button', { name: /Aventura 20/ }).evaluate((botao) => {
        const posicao = botao.getBoundingClientRect();
        return posicao.top >= 0 && posicao.bottom <= innerHeight;
    }), true, 'A rolagem da página deve alcançar a última instância.');
    await pagina.getByRole('button', { name: /Aventura 20/ }).click();
    await pagina.getByRole('button', { name: /Aventura 20/ }).getAttribute('aria-pressed').then((valor) =>
        assert.equal(valor, 'true', 'A última instância deve continuar acessível na rolagem da página.'));
    await pagina.screenshot({ path: 'output/verificacao-projetos/versoes-painel-lateral-960.png' });
    console.log('Painel lateral: sem rolagem interna e última de 20 instâncias acessível pela página.');
    for (const fonte of ['modrinth', 'curseforge']) {
        await pagina.setViewportSize({ width: 1280, height: 1000 });
        await pagina.goto(`${base}verificacao-modal?fonte=${fonte}&paginacao`, { waitUntil: 'domcontentloaded' });
        await pagina.getByRole('button', { name: /Trocar versão de Beta/ }).click();
        await conferirGrade(modal, 3, 6);
        assert.equal(await pagina.locator('input[name="versao-conteudo"]:checked').inputValue(), 'pagina-25',
            'A abertura deve mostrar a página que contém a versão instalada.');
        const consultas = await contarConsultas();
        await primeiraPagina();
        await pagina.locator('input[name="versao-conteudo"][value="pagina-0"]').check();
        await pagina.getByRole('button', { name: 'Próxima página', exact: true }).click();
        await pagina.getByRole('button', { name: 'Changelog', exact: true }).click();
        await pagina.getByRole('region', { name: 'Changelog da versão 37.0', exact: true })
            .getByRole('heading', { name: '37.0', exact: true }).waitFor();
        await pagina.getByRole('button', { name: 'Versões', exact: true }).click();
        await conferirGrade(modal, 3, 6);
        await pagina.screenshot({ path: `output/verificacao-projetos/modal-paginado-${fonte}-1280.png` });
        const proxima = pagina.getByRole('button', { name: 'Próxima página', exact: true });
        while (await proxima.isEnabled()) await proxima.click();
        await conferirGrade(modal, 3, 1);
        for (const [largura, altura] of [[960, 640], [900, 760]]) {
            await pagina.setViewportSize({ width: largura, height: altura });
            await primeiraPagina();
            await conferirGrade(modal, 3, 6);
            await pagina.screenshot({ path: `output/verificacao-projetos/modal-paginado-${fonte}-${largura}.png` });
        }
        assert.equal(await contarConsultas(), consultas);
        assert.equal(await pagina.evaluate(() => window.chamadas.filter((item) =>
            /^(install_|remove_project_file)/.test(item.comando)).length), 0);
        console.log(`${fonte}/modal: seis versões em 3×2, versão instalada localizada e Changelog acompanha seleção.`);
    }
    assert.deepEqual(erros, []);
} finally {
    await navegador?.close();
    await servidor.close();
}
