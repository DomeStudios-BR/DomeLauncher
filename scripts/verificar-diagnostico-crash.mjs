import { createServer } from 'vite';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const servidor = await createServer({ server: { port: 0, open: false, warmup: { clientFiles: [] } }, plugins: [{
    name: 'verificacao-crash',
    configureServer(vite) {
        vite.middlewares.use('/verificacao-crash', (_req, res) => {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end('<!doctype html><html><head><script type="module">' +
                'import RefreshRuntime from "/@react-refresh"; RefreshRuntime.injectIntoGlobalHook(window);' +
                'window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type;' +
                'window.__vite_plugin_react_preamble_installed__=true;</script></head><body><div id="root"></div>' +
                '<script type="module" src="/scripts/fixtures/diagnostico-crash-verificacao.tsx"></script></body></html>');
        });
    },
}] });
let navegador;
try {
    await servidor.listen();
    navegador = await chromium.launch({ channel: 'msedge', headless: true, timeout: 15000 });
    const pagina = await navegador.newPage({ viewport: { width: 960, height: 640 }, deviceScaleFactor: 1.5 });
    pagina.setDefaultTimeout(30000);
    const erros = [];
    pagina.on('pageerror', (erro) => erros.push(erro.message));
    await pagina.goto(servidor.resolvedUrls.local[0] + 'verificacao-crash', { waitUntil: 'domcontentloaded' });
    await pagina.getByText('Inicie o Minecraft pelo launcher para analisar o próximo encerramento.').waitFor();
    const diagnostico = {
        instanceId: 'teste', estado: 'normal', codigoSaida: 0, resumo: 'Minecraft encerrado normalmente.',
        origem: null, mods: [], arquivos: [], avisos: [],
    };
    const emitir = (resultado) => pagina.evaluate((resultado) => window.emitir(resultado), resultado);
    await emitir(diagnostico);
    await pagina.getByText(diagnostico.resumo, { exact: true }).waitFor();
    assert.equal(await pagina.getByText('Ver evidências', { exact: true }).count(), 0);
    await emitir({ ...diagnostico, estado: 'crash', codigoSaida: 1,
        resumo: 'A origem do crash não foi encontrada.' });
    await pagina.getByText('A origem do crash não foi encontrada.', { exact: true }).waitFor();
    await pagina.getByText('Ver evidências', { exact: true }).click();
    await pagina.getByText('Arquivos analisados: nenhum', { exact: true }).waitFor();
    const crash = { ...diagnostico, estado: 'crash', codigoSaida: -1, origem: 'Biblioteca Teste',
        resumo: 'Origem provável do crash: Biblioteca Teste.', arquivos: ['crash-reports/crash-client.txt'],
        mods: [{ nome: 'Biblioteca Teste', arquivo: 'mod-pai.jar', confianca: 'alta',
            evidencias: ['Caused by: InjectionError: teste.mixins.json:Classe', 'at teste.Classe.erro(Classe.java:42)'] }],
    };
    await emitir(crash);
    await pagina.getByText('Biblioteca Teste · Confiança alta', { exact: true }).waitFor();
    await pagina.getByText('mod-pai.jar', { exact: true }).waitFor();
    await emitir({ ...crash, mods: [...crash.mods,
        { nome: 'Mod chamador', arquivo: 'chamador.jar', confianca: 'média', relacao: 'chamada',
            evidencias: ['at chamador.Entrada.iniciar(Entrada.java:1)'] },
        { nome: 'Mod alvo', arquivo: 'alvo.jar', confianca: 'média', relacao: 'alvoMixin',
            evidencias: ['Mixin transformation of alvo.Modelo failed'] },
    ] });
    await pagina.getByText('Mod chamador · Na mesma cadeia da falha', { exact: true }).waitFor();
    await pagina.getByText('Mod alvo · Alvo do mixin', { exact: true }).waitFor();
    await emitir(crash);
    await pagina.getByText('Biblioteca Teste · Confiança alta', { exact: true }).waitFor();
    const regiao = pagina.getByRole('region', { name: 'Diagnóstico do Minecraft' });
    const limites = await regiao.boundingBox();
    assert(limites && limites.x >= 256 && limites.x + limites.width <= 961);
    assert(limites.height < 640 * 0.46, 'O diagnóstico deve deixar espaço para o log');
    await emitir({ ...diagnostico, instanceId: 'outra' });
    await pagina.getByText(crash.resumo, { exact: true }).waitFor();
    await emitir({ ...diagnostico, estado: 'emExecucao', codigoSaida: null, resumo: 'Minecraft em execução.' });
    await pagina.getByText('Minecraft em execução.', { exact: true }).waitFor();
    assert.equal(await pagina.getByText(crash.resumo, { exact: true }).count(), 0);
    await pagina.evaluate(() => window.selecionar('lenta'));
    await pagina.waitForFunction(() => window.quantidadeOuvintes() === 1 && window.consultaPendente());
    await emitir({ ...crash, instanceId: 'lenta' });
    await pagina.getByText(crash.resumo, { exact: true }).waitFor();
    await pagina.evaluate(() => window.resolverConsulta());
    await pagina.getByText(crash.resumo, { exact: true }).waitFor();
    await pagina.evaluate(() => window.selecionar('erro'));
    await pagina.getByText('Não foi possível consultar o diagnóstico do jogo.', { exact: true }).waitFor();
    assert.equal(await pagina.evaluate(() => window.quantidadeOuvintes()), 1);
    assert.deepEqual(erros, []);
    console.log('Diagnóstico: estados, evidências, troca de instância, eventos e consulta concorrente verificados em 960×640/150%.');
} finally {
    await navegador?.close();
    await servidor.close();
}
