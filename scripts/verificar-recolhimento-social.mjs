import { createServer } from 'vite';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const servidor = await createServer({
    server: { port: 0, open: false, warmup: { clientFiles: [] } },
    plugins: [{
        name: 'verificacao-recolhimento-social',
        enforce: 'pre',
        resolveId(id) {
            if (id === 'socket.io-client') return '\0socket-social-simulado';
        },
        load(id) {
            if (id !== '\0socket-social-simulado') return;
            return `export function io() {
                window.conexoesSociais = (window.conexoesSociais || 0) + 1;
                const socket = { connected: true, on(evento, callback) {
                    if (evento === 'connect') queueMicrotask(callback);
                    return socket;
                }, emit() {}, disconnect() { socket.connected = false; } };
                return socket;
            }`;
        },
        configureServer(vite) {
            vite.middlewares.use('/verificacao-social', (_req, res) => {
                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                res.end('<!doctype html><html><head><script type="module">' +
                    'import RefreshRuntime from "/@react-refresh"; RefreshRuntime.injectIntoGlobalHook(window);' +
                    'window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type;' +
                    'window.__vite_plugin_react_preamble_installed__=true;</script></head>' +
                    '<body><div id="root"></div><script type="module" ' +
                    'src="/scripts/fixtures/social-sidebar-verificacao.tsx"></script></body></html>');
            });
        },
    }],
});
let navegador;
try {
    await servidor.listen();
    navegador = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
    const pagina = await navegador.newPage({ viewport: { width: 1440, height: 900 } });
    pagina.setDefaultTimeout(15000);
    const erros = [];
    pagina.on('pageerror', erro => { erros.push(erro.message); console.error(erro.message); });
    await pagina.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, rota => rota.abort());
    const url = servidor.resolvedUrls.local[0] + 'verificacao-social';
    const fotografarCargas = () => pagina.evaluate(() => ({
        comandos: window.chamadasSociais.filter(comando => [
            'carregar_sessao_social_local', 'get_launcher_social_profile', 'get_launcher_friends',
            'gerenciar_compartilhamentos_sociais',
        ].includes(comando)),
        conexoes: window.conexoesSociais,
    }));
    await pagina.goto(url);
    await pagina.getByRole('button', { name: 'Abrir conversa com Alex', exact: true }).waitFor();
    const botao = await pagina.getByRole('button', { name: 'Abrir painel social', exact: true }).elementHandle();
    let posicaoInicial = await botao.boundingBox();
    const conferirPosicao = async () => {
        const posicaoAtual = await botao.boundingBox();
        assert(posicaoInicial && posicaoAtual, 'O botão precisa permanecer visível.');
        for (const medida of ['x', 'y', 'width', 'height']) {
            assert(Math.abs(posicaoInicial[medida] - posicaoAtual[medida]) < 0.1,
                `O botão deve permanecer no canto ao alternar o painel (${medida}).`);
        }
    };
    const alternarDuranteAnimacao = async (interromper = false) => {
        const amostras = await botao.evaluate(async (elemento, interromper) => {
            const inicio = performance.now();
            const posicoes = [];
            let interrompido = false;
            elemento.click();
            while (performance.now() - inicio < 450) {
                await new Promise(resolve => requestAnimationFrame(resolve));
                const { x, y, width, height } = elemento.getBoundingClientRect();
                posicoes.push({ x, y, width, height });
                if (interromper && !interrompido && performance.now() - inicio >= 80) {
                    elemento.click();
                    interrompido = true;
                }
            }
            return posicoes;
        }, interromper);
        assert(amostras.length > 2, 'A verificação precisa observar a animação.');
        for (const posicao of amostras) {
            for (const medida of ['x', 'y', 'width', 'height']) {
                assert(Math.abs(posicaoInicial[medida] - posicao[medida]) < 0.1,
                    `O botão saiu do canto durante a animação (${medida}: ` +
                    `${posicaoInicial[medida]} → ${posicao[medida]}).`);
            }
        }
    };
    await alternarDuranteAnimacao();
    await conferirPosicao();
    const icone = await botao.$('svg');
    assert(icone, 'O ícone precisa estar carregado antes da alternância.');
    await pagina.getByRole('button', { name: /Pedidos/ }).click();
    await pagina.getByText('Nenhum pedido.', { exact: false }).waitFor();
    const cargas = await fotografarCargas();
    for (let ciclo = 0; ciclo < 4; ciclo += 1) {
        await alternarDuranteAnimacao();
        assert(await botao.evaluate(elemento => elemento.isConnected));
        await conferirPosicao();
        await alternarDuranteAnimacao();
        await conferirPosicao();
        assert(await icone.evaluate(elemento => elemento.isConnected), 'O ícone não deve ser recriado.');
        await pagina.getByText('Nenhum pedido.', { exact: false }).waitFor();
    }
    await alternarDuranteAnimacao(true);
    await pagina.setViewportSize({ width: 1280, height: 640 });
    posicaoInicial = await botao.boundingBox();
    await alternarDuranteAnimacao();
    await alternarDuranteAnimacao();
    await alternarDuranteAnimacao(true);
    assert.deepEqual(await fotografarCargas(), cargas, 'Alternar não deve repetir cargas nem conexões.');
    await pagina.getByRole('button', { name: /Amigos/ }).click();
    await pagina.getByText('Alex', { exact: true }).click();
    const chat = pagina.getByRole('complementary', { name: 'Conversa com Alex' });
    await chat.waitFor();
    const elementoChat = await chat.elementHandle();
    await pagina.getByRole('button', { name: 'Recolher painel social', exact: true }).click();
    assert(await elementoChat.evaluate(elemento => elemento.isConnected), 'A conversa deve permanecer montada.');
    assert(await chat.evaluate(elemento => elemento.classList.contains('right-[72px]')));
    await pagina.getByRole('button', { name: 'Abrir painel social', exact: true }).click();
    assert(await chat.evaluate(elemento => elemento.classList.contains('right-[340px]')));
    await pagina.screenshot({ path: join(tmpdir(), 'dome-social-aberto.png') });
    await pagina.setViewportSize({ width: 960, height: 640 });
    await pagina.goto(url + '?compacto');
    await pagina.getByRole('button', { name: 'Social', exact: true }).click();
    await pagina.getByRole('button', { name: /Pedidos/ }).click();
    await pagina.getByText('Nenhum pedido.', { exact: false }).waitFor();
    const cargasDrawer = await fotografarCargas();
    await pagina.getByRole('button', { name: 'Fechar', exact: true }).click();
    await pagina.getByRole('button', { name: 'Social', exact: true }).click();
    await pagina.getByText('Nenhum pedido.', { exact: false }).waitFor();
    assert.deepEqual(await fotografarCargas(), cargasDrawer);
    await pagina.goto(url + '?visitante');
    await pagina.getByRole('button', { name: 'Abrir painel social', exact: true }).click();
    await pagina.getByRole('button', { name: 'Iniciar login', exact: true }).waitFor();
    await pagina.getByRole('button', { name: 'Recolher painel social', exact: true }).click();
    await pagina.getByRole('button', { name: 'Abrir painel social', exact: true }).click();
    await pagina.getByRole('button', { name: 'Iniciar login', exact: true }).waitFor();
    assert.deepEqual(erros, []);
    console.log('Social: botão parado durante a animação e cliques rápidos em duas resoluções; ' +
        'ícone, aba, chat, drawer e visitante passaram.');
} finally {
    await navegador?.close();
    await servidor.close();
}
