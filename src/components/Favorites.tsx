import { useEffect, useMemo, useState, useRef, type MouseEvent } from 'react';
import { Heart, Search, Download, Trash2, FolderPlus, Pencil, FolderOpen, Image, Sparkles } from '../iconesPixelados';
import type { ProjetoConteudo } from './ProjetoDetalheModal';
import { motion, AnimatePresence } from 'framer-motion';
import CabecalhoGrupo from './CabecalhoGrupo';
import CardFavorito from './CardFavorito';
import { cn } from '../lib/utils';
import { EVENTO_FAVORITOS_ATUALIZADOS } from '../services/favoritosProjetos';
import {
    loadFavorites, saveFavorites, addFavorite, removeFavorite, isFavorite, chaveFavorito,
    carregarGruposFavoritos, salvarGruposFavoritos, sincronizarColecaoFavoritos,
    EVENTO_SINCRONIZACAO_FAVORITOS, obterEstadoSincronizacaoFavoritos, type GrupoFavoritos,
} from '../services/colecaoFavoritos';
import {
    CabecalhoMenuContextual, ItemMenuContextual, MenuContextual, SeparadorMenuContextual,
} from './context-menu/MenuContextual';
import { ExternalLink, Copy, Package } from '../iconesPixelados';

export { loadFavorites, saveFavorites, addFavorite, removeFavorite, isFavorite };
export interface FavoriteItem {
    id: string;
    title: string;
    description: string;
    icon_url: string;
    author: string;
    type: 'mod' | 'modpack' | 'resourcepack' | 'shader';
    source: 'modrinth' | 'curseforge' | 'dome';
    slug: string;
    downloads?: number;
    indisponivel?: boolean;
}
interface FavoritesProps {
    onAbrirProjeto: (projeto: ProjetoConteudo, instalarAgora?: boolean) => void;
    instalacoesEmAndamento?: string[];
}
const ABAS_TIPO = [
    { valor: 'todos', nome: 'Todos', Icone: Heart },
    { valor: 'mod', nome: 'Mods', Icone: Package },
    { valor: 'modpack', nome: 'Modpacks', Icone: Package },
    { valor: 'resourcepack', nome: 'Texturas', Icone: Image },
    { valor: 'shader', nome: 'Shaders', Icone: Sparkles },
];
const SEM_GRUPO = 'sem_grupo';

export default function Favorites({ onAbrirProjeto, instalacoesEmAndamento = [] }: FavoritesProps) {
    const [favoritos, setFavoritos] = useState(loadFavorites);
    const [grupos, setGrupos] = useState(carregarGruposFavoritos);
    const [busca, setBusca] = useState('');
    const [tipo, setTipo] = useState('todos');
    const [nomeGrupo, setNomeGrupo] = useState('');
    const [editandoGrupo, setEditandoGrupo] = useState<string | null>(null);
    const [grupoExclusao, setGrupoExclusao] = useState<GrupoFavoritos | null>(null);
    const [menuGrupo, setMenuGrupo] = useState<{ grupo: GrupoFavoritos; x: number; y: number } | null>(null);
    const [favoritoArrastado, setFavoritoArrastado] = useState<string | null>(null);
    const [grupoArrastado, setGrupoArrastado] = useState<string | null>(null);
    const [grupoDestino, setGrupoDestino] = useState<string | null>(null);
    const inputGrupo = useRef<HTMLInputElement>(null);
    const [sincronizacao, setSincronizacao] = useState(obterEstadoSincronizacaoFavoritos);
    const [menu, setMenu] = useState<{ item: FavoriteItem; x: number; y: number } | null>(null);

    useEffect(() => {
        const atualizar = () => { setFavoritos(loadFavorites()); setGrupos(carregarGruposFavoritos()); };
        const atualizarErro = () => setSincronizacao(obterEstadoSincronizacaoFavoritos());
        atualizar();
        window.addEventListener(EVENTO_FAVORITOS_ATUALIZADOS, atualizar);
        window.addEventListener(EVENTO_SINCRONIZACAO_FAVORITOS, atualizarErro);
        void sincronizarColecaoFavoritos().catch(() => undefined);
        return () => {
            window.removeEventListener(EVENTO_FAVORITOS_ATUALIZADOS, atualizar);
            window.removeEventListener(EVENTO_SINCRONIZACAO_FAVORITOS, atualizarErro);
        };
    }, []);

    const filtrados = useMemo(() => favoritos.filter((item) => {
        if (tipo !== 'todos' && item.type !== tipo) return false;
        return `${item.title} ${item.author} ${item.description}`.toLowerCase().includes(busca.trim().toLowerCase());
    }), [favoritos, tipo, busca]);
    const ordemSemGrupo = grupos.find((grupo) => grupo.id === SEM_GRUPO);
    const semGrupo = favoritos.filter((item) => !grupos.some((grupo) => grupo.id !== SEM_GRUPO
        && grupo.favoritos.includes(chaveFavorito(item)))).map(chaveFavorito);
    const grupoPadrao: GrupoFavoritos = {
        id: SEM_GRUPO, nome: ordemSemGrupo?.nome ?? 'Favoritos', recolhido: ordemSemGrupo?.recolhido ?? false,
        favoritos: [...(ordemSemGrupo?.favoritos ?? []).filter((chave) => semGrupo.includes(chave)),
            ...semGrupo.filter((chave) => !ordemSemGrupo?.favoritos.includes(chave))],
    };
    const exibidos = grupos.map((grupo) => grupo.id === SEM_GRUPO ? grupoPadrao : grupo);
    if (!ordemSemGrupo) exibidos.unshift(grupoPadrao);
    function moverFavorito(chave: string, grupoId: string, antesDe?: string, posicao: 'antes' | 'depois' = 'antes') {
        if (!favoritos.some((item) => chaveFavorito(item) === chave) || chave === antesDe) return;
        const novos = exibidos.map((grupo) => ({
            ...grupo, favoritos: grupo.favoritos.filter((item) => item !== chave),
        }));
        const destino = novos.find((grupo) => grupo.id === grupoId);
        if (destino) {
            const indice = antesDe ? destino.favoritos.indexOf(antesDe) : -1;
            const insercao = indice < 0 ? destino.favoritos.length : indice + Number(posicao === 'depois');
            destino.favoritos.splice(insercao, 0, chave);
        }
        salvarGruposFavoritos(novos);
    }
    function renomearGrupo(grupo: GrupoFavoritos) {
        setEditandoGrupo(grupo.id); setNomeGrupo(grupo.nome);
        window.setTimeout(() => inputGrupo.current?.select(), 50);
    }
    function criarGrupo() {
        if (exibidos.length >= 100) return;
        const grupo = { id: crypto.randomUUID().replace(/-/g, ''), nome: 'Novo Grupo',
            recolhido: false, favoritos: [] };
        salvarGruposFavoritos([...exibidos, grupo]);
        renomearGrupo(grupo);
    }
    function salvarNomeGrupo(id: string) {
        if (!nomeGrupo.trim()) return;
        salvarGruposFavoritos(exibidos.map((grupo) => grupo.id === id ? { ...grupo, nome: nomeGrupo.trim() } : grupo));
        setEditandoGrupo(null);
    }
    function excluirGrupo(grupo: GrupoFavoritos) {
        const destino = exibidos.find((item) => item.id !== grupo.id);
        if (!destino) return;
        salvarGruposFavoritos(exibidos.filter((item) => item.id !== grupo.id).map((item) => item.id === destino.id
            ? { ...item, id: grupo.id === SEM_GRUPO ? SEM_GRUPO : item.id,
                favoritos: [...new Set([...item.favoritos, ...grupo.favoritos])] } : item));
        setGrupoExclusao(null);
    }
    function limparDestinoArrasto() {
        document.querySelectorAll<HTMLElement>('[data-favorito-id][data-destino-arrasto]').forEach((card) => {
            delete card.dataset.destinoArrasto;
        });
    }
    function obterDestinoArrasto(x: number, y: number) {
        const elemento = document.elementFromPoint(x, y);
        const card = elemento?.closest<HTMLElement>('[data-favorito-id][data-grupo-id]');
        const grupo = elemento?.closest<HTMLElement>('[data-grupo-favoritos]');
        return { card, grupoId: grupo?.dataset.grupoId };
    }
    function moverArrasto(_id: string, x: number, y: number) {
        limparDestinoArrasto();
        const { card, grupoId } = obterDestinoArrasto(x, y);
        setGrupoDestino(grupoId ?? null);
        if (card) card.dataset.destinoArrasto = x < card.getBoundingClientRect().left
            + card.getBoundingClientRect().width / 2 ? 'antes' : 'depois';
    }
    function finalizarArrasto(id?: string, x?: number, y?: number) {
        if (id && x !== undefined && y !== undefined) {
            const { card, grupoId } = obterDestinoArrasto(x, y);
            if (grupoId) moverFavorito(id, grupoId, card?.dataset.favoritoId,
                card?.dataset.destinoArrasto === 'depois' ? 'depois' : 'antes');
        }
        limparDestinoArrasto(); setFavoritoArrastado(null); setGrupoDestino(null);
    }
    function iniciarArrastoGrupo(evento: MouseEvent, id: string) {
        if (evento.button !== 0) return;
        evento.preventDefault(); evento.stopPropagation(); setGrupoArrastado(id);
    }
    function entrarGrupoDestino(id: string) {
        if (!grupoArrastado || grupoArrastado === id) return;
        const novos = [...exibidos];
        const origem = novos.findIndex((grupo) => grupo.id === grupoArrastado);
        const destino = novos.findIndex((grupo) => grupo.id === id);
        if (origem < 0 || destino < 0) return;
        const [movido] = novos.splice(origem, 1);
        novos.splice(destino, 0, movido);
        salvarGruposFavoritos(novos);
    }
    useEffect(() => {
        if (!grupoArrastado && !favoritoArrastado) return;
        const cursor = document.body.style.cursor;
        const selecao = document.body.style.userSelect;
        document.body.style.cursor = 'grabbing'; document.body.style.userSelect = 'none';
        const encerrar = () => setGrupoArrastado(null);
        window.addEventListener('mouseup', encerrar);
        window.addEventListener('blur', encerrar);
        return () => {
            window.removeEventListener('mouseup', encerrar); window.removeEventListener('blur', encerrar);
            document.body.style.cursor = cursor; document.body.style.userSelect = selecao;
        };
    }, [grupoArrastado, favoritoArrastado]);
    function abrir(item: FavoriteItem, instalarAgora = false) {
        onAbrirProjeto({ ...item, project_type: item.type }, instalarAgora);
    }
    function obterUrl(item: FavoriteItem) {
        if (item.source === 'dome') return `https://domestudios.com.br/modpacks/${item.id}`;
        if (item.source === 'modrinth') return `https://modrinth.com/${item.type}/${item.slug}`;
        const categorias = { mod: 'mc-mods', modpack: 'modpacks', resourcepack: 'texture-packs', shader: 'shaders' };
        return `https://www.curseforge.com/minecraft/${categorias[item.type]}/${item.slug}`;
    }

    return <div className="space-y-5">
        <div className="flex items-center gap-3">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-2xl border
                border-pink-500/20 bg-pink-500/10">
                <Heart size={24} className="text-pink-500" />
            </div>
            <span className="text-sm text-white/50">{favoritos.length} favoritos</span>
        </div>
        {sincronizacao.erro && <div role="alert" className="text-sm text-amber-300">
            Não foi possível sincronizar. Suas alterações estão salvas neste computador.
            <button className="ml-3 underline" onClick={() => {
                void sincronizarColecaoFavoritos().catch(() => undefined);
            }}>Tentar novamente</button>
        </div>}
        <div className="relative">
            <Search className="absolute left-4 top-3 text-white/30" size={18} />
            <input aria-label="Buscar favoritos" placeholder="Buscar nos favoritos" value={busca}
                onChange={(evento) => setBusca(evento.target.value)}
                className="w-full rounded-xl border border-white/10 bg-white/5 py-3 pl-11 pr-4 text-sm" />
        </div>
        <div className="flex flex-wrap items-center gap-3 border-b border-white/10 pb-3">
            <div role="group" aria-label="Tipo de conteúdo" className="flex flex-wrap gap-1">
                {ABAS_TIPO.map(({ valor, nome, Icone }) => <button key={valor} type="button"
                    aria-pressed={tipo === valor} onClick={() => setTipo(valor)} className={cn(
                        'flex items-center gap-2 rounded-lg px-3 py-2 text-xs transition-colors',
                        tipo === valor ? 'bg-pink-500/10 text-pink-300' : 'text-white/50 hover:text-white',
                    )}><Icone size={15} aria-hidden="true" />{nome}</button>)}
            </div>
            <button onClick={criarGrupo} title="Criar grupo" aria-label="Criar grupo" className={cn(
                'ml-auto flex shrink-0 items-center gap-1.5 px-3 py-2 bg-white/3 border border-white/5 rounded-xl',
                'text-xs text-white/40 hover:text-white/60 hover:bg-white/5 transition-all',
            )}><FolderPlus size={13} /></button>
        </div>
        {!favoritos.length && <p role="status" className="py-12 text-center text-white/40">
            {sincronizacao.carregando ? 'Carregando favoritos' : 'Nenhum favorito ainda'}
        </p>}
        {favoritos.length > 0 && !filtrados.length && <p className="text-white/40">Nenhum resultado</p>}
        {exibidos.map((grupo) => {
            const itens = grupo.favoritos.map((chave) => filtrados.find((item) => chaveFavorito(item) === chave))
                .filter((item): item is FavoriteItem => Boolean(item));
            if ((busca || tipo !== 'todos') && !itens.length) return null;
            return <motion.div key={grupo.id} layout="position"
                transition={{ layout: { duration: 0.16, ease: 'easeOut' } }}
                onMouseEnter={() => entrarGrupoDestino(grupo.id)} data-grupo-favoritos data-grupo-id={grupo.id}
                className={cn('rounded-xl border transition-colors', grupoDestino === grupo.id
                    ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-transparent',
                    grupoArrastado === grupo.id ? 'opacity-45' : 'opacity-100')}>
                <CabecalhoGrupo nome={grupo.nome} quantidade={itens.length} recolhido={grupo.recolhido}
                    editando={editandoGrupo === grupo.id} nomeEditado={nomeGrupo} inputRef={inputGrupo}
                    podeExcluir={exibidos.length > 1} onAlternar={() => salvarGruposFavoritos(exibidos.map((item) =>
                        item.id === grupo.id ? { ...item, recolhido: !item.recolhido } : item))}
                    onRenomear={() => renomearGrupo(grupo)} onNomeChange={setNomeGrupo}
                    onNomeSalvar={() => salvarNomeGrupo(grupo.id)} onExcluir={() => setGrupoExclusao(grupo)}
                    onIniciarArrasto={(evento) => iniciarArrastoGrupo(evento, grupo.id)}
                    onMenuContexto={(evento) => {
                        evento.preventDefault(); setMenuGrupo({ grupo, x: evento.clientX, y: evento.clientY });
                    }} />
                <AnimatePresence>{!grupo.recolhido && <motion.div initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.15 }} className="overflow-hidden">
                    {!itens.length ? <div className={cn(
                        'mx-1 mb-2 rounded-xl border border-dashed border-white/5 py-6',
                        'text-center text-xs text-white/10',
                    )}>Arraste favoritos para este grupo</div>
                    : <div className="grid grid-cols-1 gap-4 px-1 pb-2 md:grid-cols-2 xl:grid-cols-3">
                        {itens.map((item) => <CardFavorito key={chaveFavorito(item)} item={item} grupoId={grupo.id}
                            instalando={instalacoesEmAndamento.includes(chaveFavorito(item))}
                            arrastando={favoritoArrastado === chaveFavorito(item)} onAbrir={abrir}
                            onRemover={(item) => removeFavorite(item.id, item.source)}
                            onMenu={(evento, item) => {
                                evento.preventDefault(); setMenu({ item, x: evento.clientX, y: evento.clientY });
                            }} onIniciarArrasto={setFavoritoArrastado} onMoverArrasto={moverArrasto}
                            onFinalizarArrasto={finalizarArrasto} />)}
                    </div>}
                </motion.div>}</AnimatePresence>
            </motion.div>;
        })}
        {grupoExclusao && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 p-4"
            onClick={() => setGrupoExclusao(null)}>
            <div role="alertdialog" aria-modal="true" aria-labelledby="titulo-excluir-grupo-favoritos"
                className="w-full max-w-sm border border-white/12 bg-[#151516] shadow-2xl"
                onClick={(evento) => evento.stopPropagation()}>
                <div className="border-b border-white/8 px-4 py-3">
                    <p id="titulo-excluir-grupo-favoritos"
                        className="text-xs font-black uppercase tracking-wide text-white/85">Excluir grupo</p>
                </div>
                <p className="px-4 py-4 text-xs leading-relaxed text-white/55">
                    O grupo <strong className="text-white/85">{grupoExclusao.nome}</strong> será excluído.
                    Os favoritos serão movidos para outro grupo.
                </p>
                <div className="flex justify-end gap-2 border-t border-white/8 px-4 py-3">
                    <button autoFocus onClick={() => setGrupoExclusao(null)} className={cn(
                        'px-3 py-2 text-[10px] font-bold uppercase tracking-wide',
                        'text-white/45 hover:text-white/75',
                    )}>Cancelar</button>
                    <button onClick={() => excluirGrupo(grupoExclusao)} className={cn(
                        'border border-red-400/25 bg-red-400/8 px-3 py-2 text-[10px] font-bold',
                        'uppercase tracking-wide text-red-200 hover:bg-red-400/14',
                    )}>Excluir grupo</button>
                </div>
            </div>
        </div>}
        <MenuContextual aberto={menuGrupo !== null} x={menuGrupo?.x ?? 0} y={menuGrupo?.y ?? 0}
            onFechar={() => setMenuGrupo(null)} rotulo="Ações do grupo">
            {menuGrupo && <>
                <CabecalhoMenuContextual titulo={menuGrupo.grupo.nome} />
                <ItemMenuContextual icone={<Pencil size={13} />} onClick={() => {
                    renomearGrupo(menuGrupo.grupo); setMenuGrupo(null);
                }}>Renomear grupo</ItemMenuContextual>
                <ItemMenuContextual icone={<Trash2 size={13} />} perigo disabled={exibidos.length <= 1}
                    onClick={() => { setGrupoExclusao(menuGrupo.grupo); setMenuGrupo(null); }}>Excluir grupo</ItemMenuContextual>
            </>}
        </MenuContextual>
        <MenuContextual aberto={menu !== null} x={menu?.x ?? 0} y={menu?.y ?? 0}
            onFechar={() => setMenu(null)} rotulo="Ações do favorito">
            {menu && <>
                <CabecalhoMenuContextual titulo={menu.item.title} subtitulo={menu.item.source} />
                <ItemMenuContextual icone={<Package size={13} />} onClick={() => {
                    abrir(menu.item); setMenu(null);
                }}>Ver detalhes</ItemMenuContextual>
                <ItemMenuContextual icone={<Download size={13} />} disabled={menu.item.indisponivel}
                    onClick={() => {
                    abrir(menu.item, true); setMenu(null);
                }}>Instalar</ItemMenuContextual>
                <ItemMenuContextual icone={<ExternalLink size={13} />} onClick={() => {
                    window.open(obterUrl(menu.item), '_blank'); setMenu(null);
                }}>Abrir página do projeto</ItemMenuContextual>
                <ItemMenuContextual icone={<Copy size={13} />} onClick={() => {
                    void navigator.clipboard.writeText(obterUrl(menu.item)); setMenu(null);
                }}>Copiar link</ItemMenuContextual>
                <SeparadorMenuContextual />
                {exibidos.map((grupo) => <ItemMenuContextual key={grupo.id} icone={<FolderOpen size={13} />}
                    disabled={grupo.favoritos.includes(chaveFavorito(menu.item))} onClick={() => {
                        moverFavorito(chaveFavorito(menu.item), grupo.id); setMenu(null);
                    }}>Mover para {grupo.nome}</ItemMenuContextual>)}
                <SeparadorMenuContextual />
                <ItemMenuContextual icone={<Trash2 size={13} />} perigo onClick={() => {
                    removeFavorite(menu.item.id, menu.item.source); setMenu(null);
                }}>Remover dos favoritos</ItemMenuContextual>
            </>}
        </MenuContextual>
    </div>;
}
