import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { chromium } from 'playwright';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporario = await mkdtemp(join(tmpdir(), 'dome-teste-social-'));
try {
    await build({ configFile: false, root: raiz, plugins: [react(), tailwindcss()],
        define: { 'process.env.NODE_ENV': JSON.stringify('production') },
        build: { outDir: temporario, lib: { entry: join(raiz, 'scripts/fixtures/transferencias-sociais.tsx'),
            name: 'TesteSocial', formats: ['iife'], fileName: () => 'social.js' } },
    });
    const nomes = await readdir(temporario, { recursive: true, withFileTypes: true });
    const arquivos = new Map(await Promise.all(nomes.filter((entrada) => entrada.isFile()).map(async (entrada) => {
        const caminho = join(entrada.parentPath, entrada.name);
        return [caminho.slice(temporario.length + 1).replaceAll('\\', '/'), await readFile(caminho)] as const;
    })));
    const css = [...arquivos.keys()].find((nome) => nome.endsWith('.css'));
    const servidor = createServer((req, res) => {
        const nome = req.url?.slice(1) ?? '';
        if (arquivos.has(nome)) {
            res.setHeader('Content-Type', nome.endsWith('.css') ? 'text/css' : nome.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
            res.end(arquivos.get(nome)); return;
        }
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(`<!doctype html><html><head><link rel="stylesheet" href="/${css}"></head><body><div id="root"></div><script src="/social.js"></script></body></html>`);
    });
    await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve));
    try {
        const endereco = servidor.address();
        if (!endereco || typeof endereco === 'string') throw new Error('Servidor de teste indisponível.');
        const navegador = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
        try {
            const pagina = await navegador.newPage({ viewport: { width: 960, height: 640 } });
            const erros: string[] = [];
            pagina.on('pageerror', (erro) => erros.push(erro.message));
            await pagina.goto(`http://127.0.0.1:${endereco.port}/`);
            await pagina.getByRole('heading', { name: 'Instâncias compartilhadas' }).waitFor();
            await pagina.getByText('Vanilla', { exact: true }).waitFor();
            await pagina.getByText('62%', { exact: true }).waitFor();
            await pagina.getByRole('button', { name: 'Revisar instalação / atualização' }).click();
            const atualizar = pagina.getByRole('button', { name: 'Atualizar instância', exact: true });
            assert(await atualizar.isDisabled(), 'Conflito precisa de aceite explícito.');
            await pagina.getByRole('checkbox').check();
            assert(await atualizar.isEnabled());
            await pagina.screenshot({ path: join(tmpdir(), 'dome-social-revisao.png') });
            await atualizar.click();
            await pagina.getByRole('status').filter({ hasText: 'Instância disponível' }).waitFor();
            const resultado = await pagina.evaluate(() => (window as unknown as { chamadasSociais: Array<{ comando: string; argumentos: any }> }).chamadasSociais
                .find((c) => c.comando === 'download_import_launcher_social_sync_package'));
            assert.equal(resultado?.argumentos.vinculo.substituirAlteracoesLocais, true);
            await pagina.goto(`http://127.0.0.1:${endereco.port}/?dono`);
            await pagina.getByRole('heading', { name: 'Instâncias compartilhadas' }).waitFor();
            await pagina.getByRole('button', { name: 'Revisar e publicar' }).click();
            const pastaConfig = pagina.getByRole('checkbox', { name: 'Incluir pasta config', exact: true });
            assert(await pastaConfig.isChecked(), 'Republicação mantém a seleção anterior da pasta.');
            assert.equal(await pagina.getByText('opcao-01.json', { exact: true }).count(), 0,
                'Arquivos devem começar recolhidos dentro da pasta.');
            await pagina.getByRole('button', { name: 'Expandir pasta config', exact: true }).click();
            await pagina.getByText('opcao-01.json', { exact: true }).waitFor();
            const areaRolavel = pagina.getByText('opcao-01.json', { exact: true })
                .locator('xpath=ancestor::div[contains(@class, "overflow-y-auto")][1]');
            const dimensoesRolagem = await areaRolavel.evaluate((elemento) => ({
                altura: elemento.clientHeight,
                conteudo: elemento.scrollHeight,
            }));
            assert(dimensoesRolagem.conteudo > dimensoesRolagem.altura,
                `A árvore precisa ter overflow vertical (${JSON.stringify(dimensoesRolagem)}).`);
            const barraRolagem = pagina.getByRole('scrollbar', { name: 'Arquivos e pastas para incluir no pacote' });
            await barraRolagem.waitFor();
            assert(await barraRolagem.isVisible(), 'A árvore precisa exibir rolagem quando não couber no modal.');
            assert(await pagina.getByRole('button', { name: 'Publicar versão', exact: true }).isVisible(),
                'O rodapé deve permanecer visível durante a rolagem.');
            await pagina.screenshot({ path: join(tmpdir(), 'dome-social-selecao.png') });
            await pastaConfig.uncheck();
            await pagina.getByText('2 arquivos selecionados', { exact: true }).waitFor();
            const pastaMundos = pagina.getByRole('checkbox', { name: 'Incluir pasta saves', exact: true });
            assert(!(await pastaMundos.isChecked()), 'Mundos não devem ser enviados sem escolha explícita.');
            await pastaMundos.check();
            await pagina.getByText('3 arquivos selecionados', { exact: true }).waitFor();
            await pagina.getByRole('button', { name: 'Publicar versão', exact: true }).click();
            await pagina.getByRole('status').filter({ hasText: 'Preparando arquivos' }).waitFor();
            assert.equal(await pagina.getByText('Ainda não publicada', { exact: true }).count(), 0,
                'O estado vazio não deve aparecer durante a publicação.');
            assert.equal(await pagina.getByRole('button', { name: 'Revisar e publicar', exact: true }).count(), 0,
                'O andamento deve ocupar o lugar da ação de publicação.');
            await pagina.screenshot({ path: join(tmpdir(), 'dome-social-publicando.png') });
            await pagina.getByRole('status').filter({ hasText: 'Versão publicada' }).waitFor();
            const exportacao = await pagina.evaluate(() => (window as unknown as {
                chamadasSociais: Array<{ comando: string; argumentos: { arquivosConfiguracao?: string[] } }>;
            }).chamadasSociais.filter((chamada) => chamada.comando === 'export_launcher_social_sync_package').at(-1));
            assert(exportacao?.argumentos.arquivosConfiguracao?.includes('saves/Mundo/level.dat'),
                'O mundo selecionado precisa seguir para o empacotamento.');
            assert(!exportacao?.argumentos.arquivosConfiguracao?.includes('config/opcao-01.json'),
                'Desmarcar uma pasta precisa excluir todos os arquivos descendentes.');
            assert(await pagina.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
            await pagina.screenshot({ path: join(tmpdir(), 'dome-social-compartilhamentos.png') });
            await pagina.keyboard.press('Escape');
            assert.equal(await pagina.getByRole('dialog').count(), 0);
            assert.deepEqual(erros, []);
            console.log('Interface social: revisão, conflitos, publicação e janela mínima passaram.');
        } finally { await navegador.close(); }
    } finally { servidor.close(); }
} finally {
    const resolvido = resolve(temporario);
    if (!resolvido.startsWith(resolve(tmpdir())) || !resolvido.includes('dome-teste-social-')) throw new Error('Pasta temporária inválida.');
    await rm(resolvido, { recursive: true, force: true });
}
