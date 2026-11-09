import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import SocialSidebar from '../../src/components/SocialSidebar';
import '../../src/index.css';

const perfil = {
    perfilId: 'perfil-teste', nomeSocial: 'Jogador', handle: 'jogador', online: true,
    contasMinecraftVinculadas: [], criadoEm: '', atualizadoEm: '',
};
const sessao = {
    accessToken: 'token-simulado', refreshToken: 'refresh-simulado',
    expiraEm: new Date(Date.now() + 3_600_000).toISOString(), perfil,
};
const chamadas: string[] = [];
Object.assign(window, {
    chamadasSociais: chamadas,
    __TAURI_INTERNALS__: {
        transformCallback: () => 1,
        unregisterCallback: () => undefined,
        invoke: async (comando: string) => {
            chamadas.push(comando);
            if (comando === 'carregar_sessao_social_local') {
                return location.search.includes('visitante') ? null : JSON.stringify(sessao);
            }
            if (comando === 'get_launcher_social_profile') return perfil;
            if (comando === 'get_launcher_friends') return {
                amigos: [{ amizadeId: 'amizade', friendProfileId: 'alex', nome: 'Alex', online: true }],
                pendentesRecebidas: [], pendentesEnviadas: [],
            };
            if (comando === 'get_launcher_chat_messages') return { conversaId: 'chat', mensagens: [] };
            if (comando === 'gerenciar_compartilhamentos_sociais') return { itens: [] };
            if (comando === 'gerenciar_transferencias_sociais') return { pedidos: [] };
            if (comando === 'gerenciar_favoritos_projetos') return { itens: [], grupos: [], favoritos: [] };
            if (comando === 'plugin:event|listen') return 1;
            return null;
        },
    },
});

function VerificacaoSocial() {
    const [recuado, setRecuado] = useState(true);
    const [drawerAberto, setDrawerAberto] = useState(false);
    const compacto = location.search.includes('compacto');
    const larguraPainel = recuado ? 'w-[72px]' : 'w-[340px]';
    return (
        <main className="flex h-screen justify-end bg-[#101010] text-white">
            {compacto && <button onClick={() => setDrawerAberto(true)}>Social</button>}
            <div className={compacto
                ? (drawerAberto ? 'h-full' : 'invisible pointer-events-none h-full')
                : `relative flex h-full shrink-0 transition-[width] duration-200 ${larguraPainel}`}>
                <div className="flex h-full w-full">
                    <SocialSidebar usuarioMinecraft={null} onEntrarMicrosoft={async () => undefined}
                        recuado={!compacto && recuado}
                        onAlternarRecuo={compacto ? undefined : () => setRecuado(anterior => !anterior)}
                        onFecharDrawer={compacto ? () => setDrawerAberto(false) : undefined}
                        className={`h-full ${compacto ? 'w-[340px]' : 'w-full'}`} />
                </div>
            </div>
        </main>
    );
}

createRoot(document.getElementById('root')!).render(<VerificacaoSocial />);
