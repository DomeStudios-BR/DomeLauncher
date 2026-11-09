import { createServer } from 'vite';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';

const servidor = await createServer({ server: { port: 0, open: false }, plugins: [{
    name: 'verificacao-projetos-modpacks',
    configureServer(vite) {
        vite.middlewares.use('/verificacao-projetos', (_req, res) => {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end('<!doctype html><html><head><script type="module">'
                + 'import RefreshRuntime from "/@react-refresh"; RefreshRuntime.injectIntoGlobalHook(window);'
                + 'window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type;'
                + 'window.__vite_plugin_react_preamble_installed__=true;</script></head><body><div id="root"></div>'
                + '<script type="module" src="/scripts/fixtures/projetos-modpacks-verificacao.tsx"></script></body></html>');
        });
    },
}] });
let navegador;
try {
    await servidor.listen();
    navegador = await chromium.launch({ channel: 'msedge', headless: true });
    const pagina = await navegador.newPage({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1.5 });
    const erros = [];
    let aceitar = true;
    pagina.on('pageerror', (erro) => erros.push(erro.message));
    pagina.on('dialog', (dialogo) => aceitar ? dialogo.accept() : dialogo.dismiss());
    await pagina.route('https://api.modrinth.com/v2/**', (rota) => rota.fulfill({ json:
        rota.request().url().endsWith('/version') ? ['2.0', '1.0'].map((numero, indice) => ({
            id: `v${2 - indice}`, version_number: numero, game_versions: [indice ? '1.20.1' : '1.21.1'],
            loaders: [indice ? 'forge' : 'fabric'], changelog: `Notas completas ${numero}`,
            files: [{ url: 'https://example.com/pacote.zip', filename: 'pacote.zip' }],
        })) : { body: 'Descrição completa', members: [] },
    }));
    const base = servidor.resolvedUrls.local[0] + 'verificacao-projetos';
    const consultar = (comando) => pagina.evaluate((nome) => window.chamadas.filter((c) => c.comando === nome), comando);
    await mkdir('output/verificacao-projetos', { recursive: true });
    for (const [fonte, rotulo] of [['modrinth', 'Modrinth'], ['curseforge', 'Curseforge'], ['dome', 'Dome']]) {
        await pagina.goto(`${base}?fonte=${fonte}&instalado`);
        const abas = pagina.getByRole('button', { name: /^(Conteúdo|Curseforge|Modrinth|Dome|Mundos)$/ });
        assert.deepEqual(await abas.allTextContents(), ['Conteúdo', rotulo, 'Mundos']);
        await pagina.getByRole('button', { name: rotulo, exact: true }).click();
        await pagina.getByText('Descrição completa', { exact: true }).waitFor();
        await pagina.getByRole('button', { name: 'Versão', exact: true }).click();
        await pagina.getByRole('button', { name: 'Selecionar versão 1.0', exact: true }).waitFor();
        const instalada = pagina.getByRole('button', { name: 'Instalada', exact: true });
        assert.equal(await instalada.isDisabled(), true);
        for (const largura of [960, 1280]) {
            await pagina.setViewportSize({ width: largura, height: 640 });
            const posicao = await instalada.evaluate((botao) => {
                const acao = botao.getBoundingClientRect();
                const cabecalho = botao.parentElement.getBoundingClientRect();
                const abas = botao.parentElement.firstElementChild.getBoundingClientRect();
                return {
                    diferenca: Math.abs(acao.left + acao.width / 2 - cabecalho.left - cabecalho.width / 2),
                    sobreposto: acao.left < abas.right && acao.right > abas.left
                        && acao.top < abas.bottom && acao.bottom > abas.top,
                };
            });
            assert.equal(posicao.sobreposto, false, 'A ação não pode sobrepor as abas.');
        }
        await pagina.setViewportSize({ width: 960, height: 640 });
        await pagina.getByRole('button', { name: 'Selecionar versão 1.0', exact: true }).click();
        await pagina.getByRole('button', { name: 'Mods', exact: true }).click();
        await pagina.getByText('Mod da versão v1', { exact: true }).waitFor();
        const consultasMods = (await consultar('listar_conteudos_versao_projeto')).length;
        await pagina.getByText('Mod da versão v1', { exact: true }).evaluate((elemento) => {
            window.modRetido = elemento;
        });
        await pagina.getByRole('button', { name: 'Descrição', exact: true }).click();
        await pagina.getByRole('button', { name: 'Mods', exact: true }).click();
        assert.equal((await consultar('listar_conteudos_versao_projeto')).length, consultasMods);
        assert.equal(await pagina.getByText('Mod da versão v1', { exact: true })
            .evaluate((elemento) => elemento === window.modRetido), true, 'A aba deve manter o mod renderizado.');
        await pagina.getByRole('button', { name: 'Conteúdo', exact: true }).click();
        await pagina.getByRole('button', { name: rotulo, exact: true }).click();
        await pagina.getByText('Mod da versão v1', { exact: true }).waitFor();
        assert.equal((await consultar('listar_conteudos_versao_projeto')).length, consultasMods);
        assert.equal(await pagina.getByText('Mod da versão v1', { exact: true })
            .evaluate((elemento) => elemento === window.modRetido), true, 'Sair da origem não deve desmontar os mods.');
        await pagina.getByRole('button', { name: 'Versão', exact: true }).click();
        await pagina.getByRole('button', { name: 'Selecionar versão 2.0', exact: true }).click();
        await pagina.getByRole('button', { name: 'Mods', exact: true }).click();
        await pagina.getByText('Mod da versão v2', { exact: true }).waitFor();
        await pagina.getByRole('button', { name: 'Versão', exact: true }).click();
        await pagina.getByRole('button', { name: 'Selecionar versão 1.0', exact: true }).click();
        await pagina.getByRole('button', { name: 'Mods', exact: true }).click();
        await pagina.getByText('Mod da versão v1', { exact: true }).waitFor();
        assert.equal((await consultar('listar_conteudos_versao_projeto')).length, consultasMods + 1,
            'Cada versão deve ser consultada uma vez durante a visita à instância.');
        await pagina.getByRole('button', { name: 'Versão', exact: true }).click();
        const selecao = pagina.getByRole('button', { name: 'Selecionar versão 1.0', exact: true });
        assert.equal(await selecao.getAttribute('aria-pressed'), 'true');
        await pagina.getByRole('button', { name: 'Changelog', exact: true }).click();
        await pagina.getByText('Notas completas 1.0', { exact: true }).waitFor();
        await pagina.getByRole('button', { name: 'Versão', exact: true }).click();
        assert.equal(await selecao.getAttribute('aria-pressed'), 'true');
        await pagina.getByRole('button', { name: 'Selecionar versão 1.0', exact: true }).click();
        aceitar = false;
        await pagina.getByRole('button', { name: 'Trocar versão', exact: true }).click();
        const comando = fonte === 'dome' ? 'instalar_modpack_dome' : 'trocar_versao_modpack_publico';
        assert.equal((await consultar(comando)).length, 0);
        aceitar = true;
        await pagina.getByRole('button', { name: 'Trocar versão', exact: true }).click();
        await pagina.getByRole('button', { name: 'Instalada', exact: true }).waitFor();
        const chamada = (await consultar(comando)).at(-1);
        assert.equal(chamada.argumentos.versaoId, 'v1');
        assert.equal(chamada.argumentos[fonte === 'dome' ? 'instanciaId' : 'instanceId'], 'instancia');
        assert.equal((await consultar('create_instance')).length, 0);
        await pagina.getByRole('button', { name: 'Conteúdo', exact: true }).click();
        await pagina.waitForFunction(() => window.chamadas.filter((item) =>
            item.comando === 'obter_conteudo_instalado_detalhado').length === 2);
        await pagina.getByRole('button', { name: rotulo, exact: true }).click();
        await pagina.getByRole('button', { name: 'Versão', exact: true }).click();
        await pagina.screenshot({ path: `output/verificacao-projetos/${fonte}.png` });
        console.log(`${fonte}: aba da origem, versões de outro Minecraft/loader, consulta sem mudar seleção e troca na mesma instância.`);
    }
    await pagina.goto(`${base}?instalado&semVinculo`);
    assert.equal(await pagina.getByRole('button', { name: 'Modrinth', exact: true }).count(), 0);
    for (const [fonte, rotulo] of [['modrinth', 'Modrinth'], ['curseforge', 'Curseforge'], ['dome', 'Dome']]) {
        await pagina.goto(`${base}?fonte=${fonte}&instalado&navegacaoMod`, { waitUntil: 'domcontentloaded' });
        await pagina.getByRole('button', { name: rotulo, exact: true }).click();
        await pagina.getByRole('button', { name: 'Versão', exact: true }).click();
        await pagina.getByRole('button', { name: 'Selecionar versão 1.0', exact: true }).click();
        await pagina.getByRole('button', { name: 'Mods', exact: true }).click();
        const nomeMod = pagina.getByRole('button', { name: 'Abrir página de Mod da versão v1', exact: true });
        await nomeMod.waitFor();
        await nomeMod.hover();
        assert.equal(await nomeMod.evaluate((elemento) => getComputedStyle(elemento).textDecorationLine), 'none',
            'O nome do mod não deve ficar sublinhado ao passar o cursor.');
        await nomeMod.evaluate((elemento) => { window.nomeModRetido = elemento; });
        assert.equal(await pagina.getByRole('button', { name: 'Abrir página de Arquivo local sem identificação',
            exact: true }).count(), 0, 'Um arquivo sem projeto não deve abrir uma página inventada.');
        await pagina.getByText('mods/exemplo-v1.jar', { exact: true }).click();
        assert.equal(await pagina.evaluate(() => window.destinoProjeto), undefined,
            'Somente o nome deve abrir a página do mod.');
        await nomeMod.focus();
        await pagina.keyboard.press('Enter');
        await pagina.getByRole('heading', { name: 'Mod da versão v1', exact: true }).waitFor();
        const destino = await pagina.evaluate(() => window.destinoProjeto);
        assert.equal(destino.id, '456');
        assert.equal(destino.source, fonte === 'dome' ? 'modrinth' : fonte);
        assert.equal(destino.project_type, 'mod');
        await pagina.keyboard.press('Escape');
        await nomeMod.waitFor();
        assert.equal(await nomeMod.evaluate((elemento) => elemento === window.nomeModRetido), true);
        assert.equal((await consultar('listar_conteudos_versao_projeto')).length, 1,
            'Voltar do projeto deve manter a lista da versão consultada.');
        await pagina.getByRole('button', { name: 'Versão', exact: true }).click();
        assert.equal(await pagina.getByRole('button', { name: 'Selecionar versão 1.0', exact: true })
            .getAttribute('aria-pressed'), 'true');
        assert.equal((await pagina.evaluate(() => window.chamadas.filter((item) =>
            /^(install_|instalar_|create_instance|trocar_versao)/.test(item.comando)))).length, 0,
            'Abrir a página do mod não deve instalar nem trocar a versão.');
        console.log(`${fonte}: nome abre a página do mod por teclado e preserva a lista ao voltar.`);
    }
    for (const [fonte, rotulo] of [['modrinth', 'Modrinth'], ['curseforge', 'Curseforge'], ['dome', 'Dome']]) {
        await pagina.goto(`${base}?fonte=${fonte}&instalado&ciclo`, { waitUntil: 'domcontentloaded' });
        await pagina.getByRole('button', { name: rotulo, exact: true }).click();
        await pagina.getByRole('button', { name: 'Versão', exact: true }).click();
        await pagina.getByRole('button', { name: 'Selecionar versão 1.0', exact: true }).click();
        await pagina.getByRole('button', { name: 'Mods', exact: true }).click();
        await pagina.getByRole('region', { name: 'Mods do modpack', exact: true }).getByRole('status').waitFor();
        await pagina.getByRole('button', { name: 'Servidores', exact: true }).click();
        const online = pagina.getByRole('article').filter({ has: pagina.getByText('Servidor de teste', { exact: true }) });
        const offline = pagina.getByRole('article').filter({ has: pagina.getByText('Servidor offline', { exact: true }) });
        await online.getByText('Status não verificado', { exact: true }).waitFor();
        await pagina.evaluate(() => { document.documentElement.dataset.pausarPing = 'sim'; });
        await online.getByTitle('Verificar status', { exact: true }).click();
        await online.getByText('Verificando', { exact: true }).waitFor();
        await pagina.getByRole('button', { name: rotulo, exact: true }).click();
        await pagina.getByText('Mod da versão v1', { exact: true }).waitFor();
        assert.equal((await consultar('listar_conteudos_versao_projeto')).length, 1,
            'Uma consulta de mods em andamento não pode ser repetida ao trocar de aba.');
        await pagina.evaluate(() => { delete document.documentElement.dataset.pausarPing; window.liberarPing(); });
        await pagina.getByRole('button', { name: 'Servidores', exact: true }).click();
        await online.getByText('Online', { exact: true }).waitFor();
        await online.getByText('42 ms', { exact: true }).waitFor();
        await online.getByText('3/20', { exact: true }).waitFor();
        await offline.getByTitle('Verificar status', { exact: true }).click();
        await offline.getByText('Offline', { exact: true }).waitFor();
        await online.evaluate((elemento) => { window.servidorRetido = elemento; });
        await pagina.getByRole('button', { name: 'Conteúdo', exact: true }).click();
        await pagina.getByRole('button', { name: 'Servidores', exact: true }).click();
        await pagina.keyboard.press('Escape');
        await online.getByText('Online', { exact: true }).waitFor();
        await offline.getByText('Offline', { exact: true }).waitFor();
        assert.equal(await online.evaluate((elemento) => elemento === window.servidorRetido), true);
        assert.equal((await consultar('get_servers')).length, 1, 'Voltar a Servidores não deve reler a lista.');
        assert.equal((await consultar('ping_server')).length, 2, 'Voltar a Servidores não deve verificar novamente.');
        await online.getByTitle('Verificar status', { exact: true }).click();
        await online.getByText('Online', { exact: true }).waitFor();
        assert.equal((await consultar('ping_server')).length, 3, 'A verificação manual deve continuar disponível.');
        await pagina.getByRole('button', { name: 'Fechar instância', exact: true }).click();
        await pagina.getByRole('button', { name: 'Reabrir instância', exact: true }).click();
        await pagina.getByRole('button', { name: 'Servidores', exact: true }).click();
        await online.getByText('Status não verificado', { exact: true }).waitFor();
        await offline.getByText('Status não verificado', { exact: true }).waitFor();
        assert.equal((await consultar('get_servers')).length, 2);
        await pagina.getByRole('button', { name: rotulo, exact: true }).click();
        await pagina.getByRole('button', { name: 'Versão', exact: true }).click();
        await pagina.getByRole('button', { name: 'Selecionar versão 1.0', exact: true }).click();
        await pagina.getByRole('button', { name: 'Mods', exact: true }).click();
        await pagina.getByText('Mod da versão v1', { exact: true }).waitFor();
        assert.equal((await consultar('listar_conteudos_versao_projeto')).length, 2,
            'Reabrir a instância deve consultar os mods novamente.');
        console.log(`${fonte}: mods e servidores preservados, consulta pendente reutilizada e reabertura renovada.`);
    }
    for (const fonte of ['modrinth', 'curseforge', 'dome']) {
        await pagina.goto(`${base}?fonte=${fonte}&falhar`);
        assert.equal(await pagina.getByRole('button', { name: 'Mods', exact: true }).isEnabled(), true);
        await pagina.getByRole('button', { name: 'Versões', exact: true }).click();
        await pagina.getByRole('button', { name: 'Selecionar versão 1.0', exact: true }).click();
        await pagina.getByRole('button', { name: 'Mods', exact: true }).click();
        await pagina.getByRole('alert').waitFor();
        await pagina.getByRole('button', { name: 'Tentar novamente', exact: true }).click();
        await pagina.getByText('Mod da versão v1', { exact: true }).waitFor();
        assert.equal((await consultar('trocar_versao_modpack_publico')).length, 0);
    }
    for (const fonte of ['modrinth', 'curseforge']) {
        await pagina.goto(`${base}?fonte=${fonte}&mod&semInstancia`);
        await pagina.getByRole('button', { name: 'Dependências', exact: true }).click();
        await pagina.getByText('Biblioteca obrigatória', { exact: true }).waitFor();
        assert.equal((await consultar('listar_conteudos_versao_projeto')).at(-1).argumentos.tipoProjeto, 'mod');
        await pagina.goto(`${base}?fonte=${fonte}&mod&vazio`);
        await pagina.getByRole('button', { name: 'Dependências', exact: true }).click();
        await pagina.getByText('Nenhuma dependência declarada nesta versão.', { exact: true }).waitFor();
        for (const tipo of ['mod', 'resourcepack', 'shader']) {
            await pagina.goto(`${base}?fonte=${fonte}&tipo=${tipo}`, { waitUntil: 'domcontentloaded' });
            assert.equal(await pagina.getByRole('button', { name: 'Changelog', exact: true }).isEnabled(), true);
            await pagina.getByRole('button', { name: 'Versões', exact: true }).click();
            await pagina.getByRole('button', { name: 'Selecionar versão 2.0', exact: true }).click();
            await pagina.getByRole('button', { name: 'Dependências', exact: true }).click();
            await pagina.getByText('Biblioteca obrigatória', { exact: true }).waitFor();
            await pagina.getByText('Textura complementar', { exact: true }).waitFor();
            await pagina.getByText('Shader complementar', { exact: true }).waitFor();
            assert.equal((await consultar('listar_conteudos_versao_projeto')).at(-1).argumentos.tipoProjeto, tipo);
        }
    }
    await pagina.goto(`${base}?instalado&erroTroca`);
    await pagina.getByRole('button', { name: 'Modrinth', exact: true }).click();
    await pagina.getByRole('button', { name: 'Versão', exact: true }).click();
    await pagina.getByRole('button', { name: 'Selecionar versão 1.0', exact: true }).click();
    await pagina.getByRole('button', { name: 'Trocar versão', exact: true }).click();
    await pagina.getByRole('alert').getByText('Falha no download; instância preservada', { exact: true }).waitFor();
    for (const fonte of ['modrinth', 'curseforge', 'dome']) {
        await pagina.goto(`${base}?fonte=${fonte}&grade`, { waitUntil: 'domcontentloaded' });
        await pagina.getByRole('button', { name: 'Mods', exact: true }).click();
        const mods = pagina.getByRole('region', { name: 'Mods do modpack', exact: true });
        await mods.getByText('Sodium', { exact: true }).waitFor();
        for (const [largura, colunas] of [[1280, 3], [900, 2], [560, 1]]) {
            await pagina.setViewportSize({ width: largura, height: 800 });
            const grade = await mods.locator('ul').evaluate((lista) => {
                const cartoes = [...lista.children].map((item) => item.getBoundingClientRect());
                return { colunas: cartoes.filter((item) => item.top === cartoes[0].top).length,
                    vazamento: lista.scrollWidth > lista.clientWidth,
                    alinhado: cartoes.every((item) => Math.abs(item.width - cartoes[0].width) < 1) };
            });
            assert.equal(grade.colunas, colunas, `Grade de ${colunas} colunas em ${largura}px (${fonte}).`);
            assert.equal(grade.vazamento, false, 'Metadados longos não podem alargar a grade.');
            assert.equal(grade.alinhado, true, 'Os cartões devem ter larguras iguais.');
            await pagina.screenshot({ path: `output/verificacao-projetos/mods-${fonte}-${largura}.png` });
        }
    }
    assert.deepEqual(erros, []);
    console.log('Consultas sob demanda, falha com nova tentativa, vazio, dependências sem instância e erro de troca conferidos.');
} finally {
    await navegador?.close();
    await servidor.close();
}
