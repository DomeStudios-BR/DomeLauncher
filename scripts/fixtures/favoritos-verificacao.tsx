import { createRoot } from 'react-dom/client';
import Favorites from '../../src/components/Favorites';
import '../../src/index.css';

const itens = [
    { id: 'sodium', title: 'Sodium', type: 'mod', source: 'modrinth', author: 'CaffeineMC' },
    { id: 'iris', title: 'Iris Shaders', type: 'shader', source: 'modrinth', author: 'Iris' },
    { id: 'pack', title: 'Meu Modpack', type: 'modpack', source: 'dome', author: 'Dome' },
].map((item) => ({ ...item, description: 'Conteúdo salvo para instalar depois.', icon_url: '', slug: item.id }));
localStorage.clear();
localStorage.setItem('dome_favorites', JSON.stringify(itens));
localStorage.setItem('dome_grupos_favoritos', JSON.stringify([
    { id: 'sem_grupo', nome: 'Favoritos', recolhido: false, favoritos: ['modrinth:sodium', 'modrinth:iris'] },
    { id: 'packs', nome: 'Modpacks', recolhido: false, favoritos: ['dome:pack'] },
    { id: 'vazio', nome: 'Para testar', recolhido: false, favoritos: [] },
]));
createRoot(document.getElementById('root')!).render(<main className="p-6 text-white">
    <Favorites onAbrirProjeto={(projeto, instalarAgora) => {
        document.documentElement.dataset.acao = `${projeto.id}:${instalarAgora ? 'instalar' : 'detalhes'}`;
    }} />
</main>);
