import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import RelatarProblemaModal from '../../src/components/RelatarProblemaModal';
import { NovidadesVersaoModal } from '../../src/components/NovidadesVersaoModal';
import notasVersao from '../../.github/releases/v0.4.2.md?raw';
import { iniciarDiagnosticoRelatos } from '../../src/lib/diagnosticoRelatos';
import '../../src/index.css';

Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {
    invoke: async (comando: string, argumentos: Record<string, unknown>) => {
        if (comando === 'plugin:dialog|open') {
            const opcoes = argumentos.options as { filters: Array<{ name: string }> };
            return opcoes.filters[0].name === 'Vídeo' ? 'C:\\clip.webm' : 'C:\\captura.png';
        }
        if (comando === 'enviar_anexo_relato') {
            if (document.documentElement.dataset.cenario === 'anexo-erro') throw new Error('Anexo grande demais.');
            const video = String(argumentos.caminhoArquivo).endsWith('.webm');
            return { id: argumentos.anexoId, tipo: video ? 'video/webm' : 'image/png',
                url: video ? '/video.webm' : 'data:image/png;base64,' +
                'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1WQAAAAASUVORK5CYII=' };
        }
        if (comando === 'excluir_anexo_relato') {
            document.documentElement.dataset.removido = JSON.stringify(argumentos.anexo);
            return null;
        }
        if (comando === 'preparar_relato_problema') {
            if (document.documentElement.dataset.cenario === 'sem-sessao') {
                throw new Error('Entre com a Microsoft para enviar um relato.');
            }
            return { ambiente: { versaoLauncher: '0.4.1', sistemaOperacional: 'Windows 11', arquitetura: 'x86_64' },
                perfilId: 'perfil-teste', nome: 'Jogador Dome', handle: 'jogador', minecraft: 'Steve' };
        }
        if (comando === 'enviar_relato_problema') {
            document.documentElement.dataset.envio = JSON.stringify(argumentos.dados);
            const chamadas = Number(document.documentElement.dataset.chamadas ?? 0) + 1;
            document.documentElement.dataset.chamadas = String(chamadas);
            await new Promise((resolver) => setTimeout(resolver, 300));
            if (document.documentElement.dataset.cenario === 'erro') throw new Error('O serviço está indisponível.');
            return { numero: 42, url: 'https://github.com/DomeStudios-BR/DomeLauncher/issues/42' };
        }
        if (comando === 'plugin:opener|open_url') document.documentElement.dataset.link = String(argumentos.url);
        return null;
    },
} });

iniciarDiagnosticoRelatos();
console.warn('Falha ao carregar instâncias.');
console.warn('access_token: segredo-nao-publicavel');
console.warn('Arquivo C:\\Users\\Pessoa\\dome\\arquivo');
console.warn({ erro: 'Falha detalhada', access_token: 'detalhe-nao-publicavel' });
console.warn('at invoke (http://localhost:1420/src/main.tsx:20:4)');

function VerificacaoRelatos() {
    const [aberto, setAberto] = useState(false);
    const [novidadesAbertas, setNovidadesAbertas] = useState(false);
    return <main className="p-6 text-white">
        <button type="button" onClick={() => setAberto(true)}>Reportar problema</button>
        <button type="button" onClick={() => setNovidadesAbertas(true)}>Ver novidades</button>
        {aberto && <RelatarProblemaModal onFechar={() => setAberto(false)} />}
        <NovidadesVersaoModal onClose={() => setNovidadesAbertas(false)}
            novidades={novidadesAbertas ? { versao: '0.4.2',
                conteudo: notasVersao.repeat(5) + '\n\nFim das novidades verificadas.' } : null} />
    </main>;
}

createRoot(document.getElementById('root')!).render(<VerificacaoRelatos />);
