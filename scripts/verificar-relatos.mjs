import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { chromium } from 'playwright';

const temporario = await mkdtemp(join(tmpdir(), 'dome-relatos-'));
let servidor;
let navegador;
try {
    await build({ configFile: false, root: process.cwd(), plugins: [react(), tailwind()],
        define: { 'process.env.NODE_ENV': JSON.stringify('production'),
            '__DOME_CONFIGURACAO_SOCIAL__': JSON.stringify({ apiBaseUrl: 'http://localhost' }) },
        build: { outDir: temporario, lib: { entry: resolve('scripts/fixtures/relatos-verificacao.tsx'),
            name: 'VerificacaoRelatos', formats: ['iife'], fileName: () => 'relatos.js' } } });
    servidor = createServer(async (req, res) => {
        const arquivo = req.url === '/relatos.js' ? 'relatos.js' :
            req.url === '/estilo.css' ? 'dome-launcher.css' : null;
        if (arquivo) {
            res.setHeader('Content-Type', arquivo.endsWith('.css') ? 'text/css' : 'text/javascript');
            res.end(await readFile(join(temporario, arquivo)));
            return;
        }
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end('<!doctype html><html><head><link rel="stylesheet" href="/estilo.css"></head>' +
            '<body style="background:#141414"><div id="root"></div><script src="/relatos.js"></script></body></html>');
    });
    await new Promise((resolver) => servidor.listen(0, '127.0.0.1', resolver));
    navegador = await chromium.launch({ channel: 'msedge', headless: true, timeout: 15000 });
    const pagina = await navegador.newPage({ viewport: { width: 960, height: 640 } });
    pagina.setDefaultTimeout(10000);
    const erros = [];
    pagina.on('pageerror', (erro) => erros.push(erro.message));
    await pagina.goto(`http://127.0.0.1:${servidor.address().port}`, { waitUntil: 'domcontentloaded' });
    const abrir = () => pagina.getByRole('button', { name: 'Reportar problema', exact: true }).click();
    const preencher = async () => {
        await pagina.getByRole('textbox', { name: 'Título', exact: true }).fill('Falha ao abrir instância');
        await pagina.getByRole('textbox', { name: 'Descrição', exact: true })
            .fill('O launcher fecha ao clicar em jogar.');
    };
    const obterEnvio = () => pagina.evaluate(() => JSON.parse(document.documentElement.dataset.envio));
    await abrir();
    await pagina.getByText('Jogador Dome (jogador)', { exact: true }).waitFor();
    if (!await pagina.getByRole('button', { name: 'Enviar', exact: true }).isDisabled()) {
        throw new Error('Envio vazio foi permitido.');
    }
    await pagina.getByText('Conferir logs que serão enviados', { exact: true }).click();
    const logs = await pagina.locator('pre').innerText();
    if (logs.includes('segredo-nao-publicavel') || logs.includes('Pessoa') ||
        logs.includes('detalhe-nao-publicavel') || !logs.includes('Falha ao carregar') ||
        !logs.includes('http://localhost:1420/src/main.tsx:20:4') || !logs.includes('Falha detalhada')) {
        throw new Error('Prévia dos logs não foi sanitizada.');
    }
    await preencher();
    await pagina.getByRole('textbox', { name: 'Descrição', exact: true }).focus();
    await pagina.keyboard.press('Control+Home');
    for (let indice = 0; indice < 10; indice += 1) await pagina.keyboard.press('ArrowRight');
    await pagina.getByRole('button', { name: 'Anexar imagem', exact: true }).click();
    await pagina.getByRole('img', { name: 'captura.png', exact: true }).waitFor();
    const conteudoInline = await pagina.getByRole('textbox', { name: 'Descrição', exact: true }).innerHTML();
    if (conteudoInline.indexOf('O launcher') > conteudoInline.indexOf('<img') ||
        conteudoInline.indexOf('<img') > conteudoInline.indexOf('fecha ao clicar')) {
        throw new Error('Imagem não foi inserida na posição do cursor dentro da descrição: ' + conteudoInline);
    }
    await pagina.getByRole('button', { name: 'Anexar vídeo', exact: true }).click();
    await pagina.locator('video[aria-label="clip.webm"]').waitFor();
    await pagina.getByRole('button', { name: 'Remover anexo clip.webm', exact: true }).click();
    await pagina.locator('video').waitFor({ state: 'hidden' });
    await pagina.getByRole('textbox', { name: 'Descrição', exact: true }).focus();
    await pagina.keyboard.press('Control+z');
    await pagina.locator('video[aria-label="clip.webm"]').waitFor();
    await pagina.getByRole('button', { name: 'Remover anexo clip.webm', exact: true }).click();
    await pagina.locator('video').waitFor({ state: 'hidden' });
    await pagina.getByRole('button', { name: 'Anexar vídeo', exact: true }).click();
    await pagina.locator('video[aria-label="clip.webm"]').waitFor();
    if (await pagina.getByText('O relato, seu nome público', { exact: false }).count()) {
        throw new Error('Aviso removido ainda aparece.');
    }
    await pagina.getByRole('textbox', { name: 'Descrição', exact: true }).focus();
    await pagina.keyboard.press('Control+End');
    let focoAnexo = false;
    for (let indice = 0; indice < 6 && !focoAnexo; indice += 1) {
        await pagina.keyboard.press('Tab');
        focoAnexo = await pagina.getByRole('button', { name: 'Anexar imagem', exact: true })
            .evaluate((elemento) => elemento === document.activeElement);
    }
    if (!focoAnexo) {
        throw new Error('Navegação por teclado ignorou a descrição.');
    }
    await mkdir(resolve('../output'), { recursive: true });
    await pagina.locator('.overflow-y-auto').evaluateAll((elementos) => {
        for (const elemento of elementos) elemento.scrollTop = 0;
    });
    await pagina.screenshot({ path: resolve('../output/relato-problema-verificado.png'), fullPage: true });
    await pagina.getByRole('button', { name: 'Enviar', exact: true }).click();
    await pagina.getByRole('button', { name: 'Enviando...', exact: true }).waitFor();
    if (!await pagina.getByRole('button', { name: 'Fechar relato' }).isDisabled()) {
        throw new Error('Modal pode ser fechado durante envio.');
    }
    await pagina.getByText('Relato enviado.', { exact: true }).waitFor();
    if ((await obterEnvio()).logs !== logs) throw new Error('Logs enviados diferem da prévia.');
    const anexosEnviados = (await obterEnvio()).anexos;
    if (anexosEnviados.length !== 2 || anexosEnviados[0].tipo !== 'image/png' ||
        anexosEnviados[1].tipo !== 'video/webm' || 'url' in anexosEnviados[0]) {
        throw new Error('Anexos não foram vinculados ao relato corretamente.');
    }
    const descricaoEnviada = (await obterEnvio()).descricao;
    if (!descricaoEnviada.includes(`O launcher{{anexo:${anexosEnviados[0].id}}}`) ||
        descricaoEnviada.indexOf(`{{anexo:${anexosEnviados[0].id}}}`) > descricaoEnviada.indexOf('fecha ao clicar')) {
        throw new Error('Envio não preservou a posição da mídia entre os trechos do relato: ' + descricaoEnviada);
    }
    if (await pagina.getByRole('button', { name: /Ver issue/ }).count() ||
        await pagina.getByRole('status').getByRole('link').count()) {
        throw new Error('A confirmação do envio ainda exibe um link para a issue.');
    }
    await pagina.getByRole('button', { name: 'Fechar', exact: true }).click();

    await abrir();
    await preencher();
    await pagina.getByRole('checkbox', { name: 'Incluir logs' }).uncheck();
    await pagina.getByRole('button', { name: 'Enviar', exact: true }).click();
    await pagina.getByText('Relato enviado.', { exact: true }).waitFor();
    if ((await obterEnvio()).logs !== null) throw new Error('Logs foram enviados sem consentimento.');
    await pagina.getByRole('button', { name: 'Fechar', exact: true }).click();

    await pagina.evaluate(() => { document.documentElement.dataset.cenario = 'erro'; });
    await abrir();
    await preencher();
    await pagina.getByRole('button', { name: 'Enviar', exact: true }).click();
    await pagina.getByRole('alert').waitFor();
    const primeiro = await obterEnvio();
    if (await pagina.getByText('Relato enviado.', { exact: true }).count()) {
        throw new Error('Erro exibiu falso sucesso.');
    }
    await pagina.evaluate(() => { document.documentElement.dataset.cenario = ''; });
    await pagina.getByRole('button', { name: 'Tentar confirmar envio', exact: true }).click();
    await pagina.getByText('Relato enviado.', { exact: true }).waitFor();
    if (JSON.stringify(primeiro) !== JSON.stringify(await obterEnvio())) {
        throw new Error('Reenvio alterou a referência.');
    }
    await pagina.getByRole('button', { name: 'Fechar', exact: true }).click();

    await pagina.evaluate(() => { document.documentElement.dataset.cenario = 'sem-sessao'; });
    await abrir();
    await pagina.getByRole('alert').waitFor();
    if (!await pagina.getByRole('button', { name: 'Enviar', exact: true }).isDisabled()) {
        throw new Error('Usuário sem sessão pode enviar.');
    }
    await pagina.keyboard.press('Escape');
    await pagina.getByRole('dialog').waitFor({ state: 'hidden' });
    for (const tamanho of [{ width: 960, height: 640 }, { width: 1280, height: 800 }]) {
        await pagina.setViewportSize(tamanho);
        await pagina.getByRole('button', { name: 'Ver novidades', exact: true }).click();
        const modal = pagina.getByRole('dialog', { name: 'O que há de novo!' });
        const area = modal.locator('.overflow-y-auto');
        await modal.getByRole('scrollbar', { name: 'Novidades da versão' }).waitFor();
        const medidas = await area.evaluate((elemento) => ({
            altura: elemento.clientHeight, conteudo: elemento.scrollHeight,
            barra: getComputedStyle(elemento).scrollbarWidth,
        }));
        if (medidas.altura < 100 || medidas.conteudo <= medidas.altura || medidas.barra !== 'none') {
            throw new Error('Novidades não têm uma área limitada com barra personalizada.');
        }
        await area.hover();
        await pagina.mouse.wheel(0, 500);
        await pagina.waitForFunction(() => document.querySelector('[role="dialog"] .overflow-y-auto').scrollTop > 0);
        await modal.getByRole('scrollbar', { name: 'Novidades da versão' }).focus();
        await pagina.keyboard.press('End');
        await pagina.waitForFunction(() => {
            const area = document.querySelector('[role="dialog"] .overflow-y-auto');
            return area.scrollTop >= area.scrollHeight - area.clientHeight - 2;
        });
        const fim = await modal.getByText('Fim das novidades verificadas.', { exact: true }).boundingBox();
        const limitesArea = await area.boundingBox();
        if (!fim || !limitesArea || fim.y < limitesArea.y ||
            fim.y + fim.height > limitesArea.y + limitesArea.height + 1) {
            throw new Error('O fim das notas permanece inacessível.');
        }
        const trilho = modal.getByRole('scrollbar', { name: 'Novidades da versão' });
        const indicador = await trilho.locator('div').boundingBox();
        await pagina.mouse.move(indicador.x + indicador.width / 2, indicador.y + indicador.height / 2);
        await pagina.mouse.down();
        await pagina.mouse.move(indicador.x + indicador.width / 2, indicador.y - 50, { steps: 8 });
        await pagina.mouse.up();
        await pagina.waitForFunction(() => {
            const area = document.querySelector('[role="dialog"] .overflow-y-auto');
            return area.scrollTop < area.scrollHeight - area.clientHeight - 20;
        });
        await pagina.screenshot({ path: resolve(`../output/novidades-${tamanho.width}.png`), fullPage: true });
        await modal.getByRole('button', { name: 'Começar a jogar', exact: true }).click();
        await modal.waitFor({ state: 'hidden' });
    }
    if (erros.length) throw new Error(erros.join('; '));
    console.log('Modal validado: prévia, filtros, teclado, consentimento, sucesso, falha, ' +
        'reenvio, ausência de sessão e rolagem das novidades por mouse, teclado e arraste.');
} finally {
    await navegador?.close();
    if (servidor) await new Promise((resolver) => servidor.close(resolver));
    if (!resolve(temporario).startsWith(resolve(tmpdir()) + sep)) throw new Error('Diretório temporário inválido.');
    await rm(temporario, { recursive: true, force: true });
}
