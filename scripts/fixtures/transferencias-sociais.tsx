import React from 'react';
import { createRoot } from 'react-dom/client';
import { CompartilhamentosSociais } from '../../src/components/social/CompartilhamentosSociais';
import { TransferenciasSociais } from '../../src/components/social/TransferenciasSociais';
import '../../src/index.css';

const arquivo = { caminho: 'mods/exemplo.jar', tamanhoBytes: 1048576, configuracao: false,
    sha256: 'a'.repeat(64), sha512: 'b'.repeat(128) };
const configuracoes = Array.from({ length: 48 }, (_, indice) => ({
    ...arquivo,
    caminho: `config/opcao-${String(indice + 1).padStart(2, '0')}.json`,
    tamanhoBytes: 24,
    configuracao: true,
}));
const previa = { nome: 'Sobrevivência entre amigos', versaoMinecraft: '1.21.1', loader: 'Fabric', tamanhoBytes: 1048600,
    arquivos: [arquivo, ...configuracoes,
        { ...arquivo, caminho: 'defaultconfigs/comum.toml', tamanhoBytes: 24, configuracao: true },
        { ...arquivo, caminho: 'saves/Mundo/level.dat', tamanhoBytes: 128, configuracao: true }] };
const previaPublicada = { ...previa, arquivos: previa.arquivos.filter((item) => !item.caminho.startsWith('saves/')) };
const publicador = new URLSearchParams(location.search).has('dono');
const chamadas: Array<{ comando: string; argumentos: Record<string, unknown> }> = [];
Object.assign(window, {
    chamadasSociais: chamadas,
    __TAURI_INTERNALS__: {
        transformCallback: () => 1,
        unregisterCallback: () => undefined,
        invoke: async (comando: string, argumentos: Record<string, unknown> = {}) => {
            chamadas.push({ comando, argumentos });
            if (comando === 'plugin:deep-link|get_current') return null;
            if (comando === 'plugin:event|listen') return 1;
            if (comando === 'get_instances') return [{ id: 'local', name: previa.nome }];
            if (comando === 'obter_previa_pacote_social') return previa;
            if (comando === 'export_launcher_social_sync_package') {
                await new Promise((resolve) => setTimeout(resolve, 80));
                const selecionados = previa.arquivos.filter((item) =>
                    (argumentos.arquivosConfiguracao as string[] | undefined)?.includes(item.caminho));
                return { caminhoArquivo: 'pacote-teste.dome', previa: { ...previa, arquivos: selecionados } };
            }
            if (comando === 'upload_launcher_social_sync_package') {
                await new Promise((resolve) => setTimeout(resolve, 80));
                return {};
            }
            if (comando === 'revisar_atualizacao_compartilhada') return {
                instanciaId: 'local', versao: 1, adicionados: ['mods/novo.jar'], alterados: ['config/exemplo.json'],
                removidos: ['mods/antigo.jar'], conflitos: ['config/exemplo.json'],
            };
            if (comando === 'gerenciar_compartilhamentos_sociais') {
                if (argumentos.acao === 'listar') return { itens: [{ id: '1'.repeat(24), dono: 'dono', instanciaId: 'local',
                    nome: previa.nome, membros: ['amigo'], nomesMembros: { amigo: 'Alex' },
                    versao: { numero: 2, previa: previaPublicada }, convites: [] }] };
                if (argumentos.acao === 'receber') return { pedidoId: 'teste', tokenDownload: 'teste', versao: 2, previa };
                if (argumentos.acao === 'publicar') return { pedidoId: 'teste', tokenUpload: 'teste' };
                if (argumentos.acao === 'convidar') return { convite: `domelauncher://convite/${'1'.repeat(24)}.${'a'.repeat(48)}` };
            }
            return {};
        },
    },
});

createRoot(document.getElementById('root')!).render(<React.StrictMode>
    <main className="min-h-screen bg-[#101010] p-5 text-white">
        <CompartilhamentosSociais apiBaseUrl="https://api.example.com" perfilId={publicador ? 'dono' : 'amigo'}
            obterToken={async () => 'sessao-teste'} amigos={[{ friendProfileId: 'amigo', nome: 'Alex' }]} />
        <div className="w-80"><TransferenciasSociais pedidos={[{ pedidoId: 'exemplo', instanciaNome: previa.nome,
            status: 'pronto_download', tokenDownload: 'teste' }]} onCancelar={() => undefined} onRetomar={() => undefined} /></div>
    </main>
</React.StrictMode>);
