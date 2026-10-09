import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { chromium } from 'playwright';

const temporario = await mkdtemp(join(tmpdir(), 'dome-favoritos-'));
let servidor;
let navegador;
try {
    await build({ configFile: false, root: process.cwd(), plugins: [react(), tailwind()],
        define: { 'process.env.NODE_ENV': JSON.stringify('production'),
            '__DOME_CONFIGURACAO_SOCIAL__': JSON.stringify({ apiBaseUrl: 'http://localhost' }) },
        build: { outDir: temporario, lib: { entry: resolve('scripts/fixtures/favoritos-verificacao.tsx'),
            name: 'VerificacaoFavoritos', formats: ['iife'], fileName: () => 'favoritos.js' } } });
    servidor = createServer(async (req, res) => {
        const caminho = req.url === '/favoritos.js' ? 'favoritos.js' : req.url === '/estilo.css' ? 'dome-launcher.css' : null;
        if (caminho) {
            res.setHeader('Content-Type', caminho.endsWith('.css') ? 'text/css' : 'text/javascript');
            res.end(await readFile(join(temporario, caminho))); return;
        }
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end('<!doctype html><html><head><link rel="stylesheet" href="/estilo.css"></head>' +
            '<body style="background:#141416"><div id="root"></div><script src="/favoritos.js"></script></body></html>');
    });
    await new Promise((resolver) => servidor.listen(0, '127.0.0.1', resolver));
    navegador = await chromium.launch({ channel: 'msedge', headless: true, timeout: 15000 });

    const pagina = await navegador.newPage({ viewport: { width: 960, height: 640 } });
    pagina.setDefaultTimeout(10000);
    const erros = [];
    pagina.on('pageerror', (erro) => erros.push(erro.message));
    await pagina.goto('http://127.0.0.1:' + servidor.address().port, { waitUntil: 'domcontentloaded' });
    await pagina.getByText('Sodium', { exact: true }).waitFor();
    await pagina.getByRole('group', { name: 'Tipo de conteúdo' }).getByRole('button', {
        name: 'Modpacks', exact: true,
    }).click();
    await pagina.locator('[data-favorito-id="dome:pack"]').waitFor();
    if (await pagina.locator('[data-favorito-id]').count() !== 1) throw new Error('Filtro por tipo falhou.');
    await pagina.getByRole('group', { name: 'Tipo de conteúdo' }).getByRole('button', {
        name: 'Todos', exact: true,
    }).click();
    await pagina.getByText('Sodium', { exact: true }).waitFor();
    if (await pagina.getByRole('group', { name: 'Fonte do projeto' }).count()) {
        throw new Error('Filtro de fonte ainda presente.');
    }
    if (await pagina.locator('[data-favorito-id] select').count()) throw new Error('Seletor presente no card.');
    const fundos = await pagina.locator('[data-grupo-favoritos]').evaluateAll((grupos) =>
        grupos.map((grupo) => getComputedStyle(grupo).backgroundColor));
    if (fundos.some((cor) => cor !== 'rgba(0, 0, 0, 0)')) throw new Error('Grupo com fundo permanente.');
    await pagina.getByRole('button', { name: 'Recolher Modpacks', exact: true }).click();
    await pagina.locator('[data-favorito-id="dome:pack"]').waitFor({ state: 'hidden' });
    await pagina.getByText('Arraste favoritos para este grupo', { exact: true }).click({ trial: true });
    const origem = await pagina.locator('[data-favorito-id="modrinth:sodium"] img').boundingBox();
    const destino = await pagina.getByText('Arraste favoritos para este grupo', { exact: true }).boundingBox();
    await pagina.mouse.move(origem.x + 20, origem.y + 20);
    await pagina.mouse.down();
    await pagina.mouse.move(destino.x + 50, destino.y + 20, { steps: 12 });
    await pagina.mouse.up();
    await pagina.waitForFunction(() => JSON.parse(localStorage.getItem('dome_grupos_favoritos'))
        .find((grupo) => grupo.id === 'vazio').favoritos.includes('modrinth:sodium'));
    const origemGrupo = await pagina.locator('[data-grupo-id="vazio"] [title="Arrastar grupo"]').first().boundingBox();
    const destinoGrupo = await pagina.locator('[data-grupo-id="sem_grupo"] [title="Arrastar grupo"]').first().boundingBox();
    await pagina.mouse.move(origemGrupo.x + 5, origemGrupo.y + 5);
    await pagina.mouse.down();
    await pagina.mouse.move(destinoGrupo.x + 5, destinoGrupo.y + 5, { steps: 12 });
    await pagina.mouse.up();
    await pagina.waitForFunction(() => JSON.parse(localStorage.getItem('dome_grupos_favoritos'))[0].id === 'vazio');
    await pagina.getByRole('button', { name: 'Criar grupo', exact: true }).click();
    await pagina.getByRole('textbox', { name: 'Nome do grupo', exact: true }).fill('Coleção nova');
    await pagina.getByRole('textbox', { name: 'Nome do grupo', exact: true }).press('Enter');
    await pagina.getByRole('button', { name: 'Renomear grupo Coleção nova', exact: true }).waitFor();
    await pagina.locator('[data-favorito-id="modrinth:sodium"]').getByRole('button', { name: 'Instalar' }).click();
    if (await pagina.locator('html').getAttribute('data-acao') !== 'sodium:instalar') throw new Error('Instalar falhou.');
    await pagina.locator('[data-favorito-id="modrinth:sodium"]').click({ button: 'right' });
    await pagina.getByRole('menuitem', { name: 'Mover para Modpacks', exact: true }).click();
    await pagina.waitForFunction(() => JSON.parse(localStorage.getItem('dome_grupos_favoritos'))
        .find((grupo) => grupo.id === 'packs').favoritos.includes('modrinth:sodium'));
    await pagina.getByRole('button', { name: 'Expandir Modpacks', exact: true }).click();
    await pagina.getByRole('button', { name: 'Recolher Modpacks', exact: true }).click();
    await pagina.getByRole('button', { name: 'Expandir Modpacks', exact: true }).click();
    await pagina.getByRole('button', { name: 'Excluir grupo Coleção nova', exact: true }).click();
    await pagina.getByRole('alertdialog').getByRole('button', { name: 'Excluir grupo', exact: true }).click();
    await pagina.screenshot({ path: resolve('../output/favoritos-verificados.png'), fullPage: true });
    if (erros.length) throw new Error(erros.join('; '));
    console.log('Interface validada em 960 por 640: grupos sem fundo, criação, arraste, menu, recolhimento e Instalar.');
} finally {
    await navegador?.close();
    if (servidor) await new Promise((resolver) => servidor.close(resolver));
    if (!resolve(temporario).startsWith(resolve(tmpdir()) + sep)) throw new Error('Diretório temporário inválido.');
    await rm(temporario, { recursive: true, force: true });
}
