import { useEffect, useState } from 'react';
import {
    Check,
    ChevronDown,
    ChevronRight,
    Copy,
    Download,
    Gamepad2,
    Mail,
    Plus,
    Search,
    Trash2,
    Users,
    X,
} from '../../iconesPixelados';
import { cn } from '../../lib/utils';
import type {
    AmigoSocial,
    PedidoTransferenciaInstancia,
    PerfilBuscaAmizade,
    SolicitacaoEnviada,
    SolicitacaoRecebida,
    StatusPresenca,
} from './tiposSocial';
import { ImagemAtividade } from './ImagemAtividade';
import { IndicadorStatusSocial } from './IndicadorStatusSocial';
import {
    CabecalhoMenuContextual,
    ItemMenuContextual,
    MenuContextual,
    SeparadorMenuContextual,
} from '../context-menu/MenuContextual';

type AbaSocial = 'amigos' | 'pedidos';

interface ListaAmigosAgrupadaProps {
    className?: string;
    sessaoAtiva: boolean;
    filtroAmigos: string;
    onAlterarFiltro: (valor: string) => void;
    onEnviarSolicitacao: () => void;
    enviandoSolicitacao: boolean;
    perfilEncontrado: PerfilBuscaAmizade | null;
    buscandoPerfil: boolean;
    buscaPerfilConcluida: boolean;
    pendentesRecebidas: SolicitacaoRecebida[];
    pendentesEnviadas: SolicitacaoEnviada[];
    pedidosTransferencia: PedidoTransferenciaInstancia[];
    onResponderSolicitacao: (requestId: string, acao: 'accept' | 'reject') => void;
    onResponderTransferencia: (pedidoId: string, aceitar: boolean) => void;
    solicitacaoProcessandoId: string | null;
    transferenciaProcessandoId: string | null;
    mensagemSolicitacao: string | null;
    mensagemTransferencia: string | null;
    carregandoAmigos: boolean;
    erroAmigos: string | null;
    amigosOnline: AmigoSocial[];
    amigosOffline: AmigoSocial[];
    naoLidasPorAmigo: Record<string, number>;
    amigoSelecionadoPerfilId: string | null;
    onAbrirChat: (friendProfileId: string) => void;
    onAbrirAtividade?: (amigo: AmigoSocial) => void;
    onAbrirPerfil?: (friendProfileId: string) => void;
    onRemoverAmigo: (friendProfileId: string) => void;
    formatarTempoRelativo: (data: string | null | undefined) => string;
    rotuloStatus: (status?: StatusPresenca) => string;
}

function classeStatus(status?: StatusPresenca): string {
    if (status === 'ausente') return 'text-[#FFC04E]';
    if (status === 'offline') return 'text-white/35';
    return 'text-[#45A366]';
}

function iniciais(nome: string): string {
    const partes = nome.trim().split(/\s+/).slice(0, 2);
    return (partes.map((item) => item[0]?.toUpperCase() ?? '').join('') || '?').slice(0, 2);
}

function mensagemEhErro(mensagem: string): boolean {
    return /falha|erro|inv[aá]lid|n[aã]o foi|n[aã]o encontrado|uso/i.test(mensagem);
}

function LinhaAmigo({
    amigo,
    selecionado,
    naoLidas,
    onAbrirChat,
    onAbrirMenuContexto,
    onAbrirPerfil,
    formatarTempoRelativo,
    rotuloStatus,
}: {
    amigo: AmigoSocial;
    selecionado: boolean;
    naoLidas: number;
    onAbrirChat: (friendProfileId: string) => void;
    onAbrirMenuContexto: (evento: React.MouseEvent, amigo: AmigoSocial) => void;
    onAbrirPerfil?: (friendProfileId: string) => void;
    formatarTempoRelativo: (data: string | null | undefined) => string;
    rotuloStatus: (status?: StatusPresenca) => string;
}) {
    return (
        <button
            type="button"
            onClick={() => onAbrirChat(amigo.friendProfileId)}
            onContextMenu={(evento) => onAbrirMenuContexto(evento, amigo)}
            className={cn(
                'flex w-full items-center gap-3 border px-2.5 py-2 text-left transition-colors',
                selecionado
                    ? 'border-emerald-400/25 bg-emerald-400/[0.05]'
                    : 'border-white/[0.07] bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.04]'
            )}
        >
            <div
                className="relative h-8 w-8 shrink-0"
                onClick={(evento) => {
                    if (!onAbrirPerfil) return;
                    evento.stopPropagation();
                    onAbrirPerfil(amigo.friendProfileId);
                }}
                title={`Abrir perfil de ${amigo.nome}`}
            >
                {amigo.avatarUrl ? (
                    <img
                        src={amigo.avatarUrl}
                        alt={amigo.nome}
                        className="h-full w-full object-contain"
                        onError={(evento) => {
                            evento.currentTarget.style.display = 'none';
                        }}
                    />
                ) : (
                    <div className="flex h-full w-full items-center justify-center text-[9px] font-black text-white/55">
                        {iniciais(amigo.nome)}
                    </div>
                )}
                <span className="absolute -bottom-1 -right-1 grid h-3.5 w-3.5 place-items-center rounded-full bg-[#151515]">
                    <IndicadorStatusSocial status={amigo.status ?? 'offline'} className="h-2.5 w-2.5" />
                </span>
            </div>
            <div className="min-w-0 flex-1">
                <p className="flex min-w-0 items-center gap-1 text-[12px] font-semibold text-white/85">
                    <span className="truncate">{amigo.nome}</span>
                    {amigo.emblemaDestaque && (
                        <img
                            src={amigo.emblemaDestaque.imagemUrl}
                            alt={`Destaque: ${amigo.emblemaDestaque.nome}`}
                            title={`${amigo.emblemaDestaque.nome} — ${amigo.emblemaDestaque.descricao}`}
                            className="h-4 w-4 shrink-0 object-contain"
                        />
                    )}
                </p>
                <p className={cn('truncate text-[9px]', classeStatus(amigo.status))}>
                    {amigo.status === 'offline'
                        ? `Visto ${formatarTempoRelativo(amigo.ultimoSeenEm)}`
                        : `${rotuloStatus(amigo.status)}${amigo.handle ? ` · @${amigo.handle}` : ''}`}
                </p>
                {amigo.atividadeAtual?.modpackNome && (
                    <p className="mt-0.5 truncate text-[9px] text-white/35">{amigo.atividadeAtual.modpackNome}</p>
                )}
            </div>
            {naoLidas > 0 && (
                <span className="inline-flex min-w-4 items-center justify-center bg-emerald-400 px-1 text-[9px] font-black leading-4 text-[#07120d]">
                    {naoLidas > 99 ? '99+' : naoLidas}
                </span>
            )}
        </button>
    );
}

function LinhaAmigoJogando({
    amigo,
    selecionado,
    naoLidas,
    onAbrirAtividade,
    onAbrirChat,
    onAbrirMenuContexto,
    onAbrirPerfil,
}: {
    amigo: AmigoSocial;
    selecionado: boolean;
    naoLidas: number;
    onAbrirAtividade?: (amigo: AmigoSocial) => void;
    onAbrirChat: (friendProfileId: string) => void;
    onAbrirMenuContexto: (evento: React.MouseEvent, amigo: AmigoSocial) => void;
    onAbrirPerfil?: (friendProfileId: string) => void;
}) {
    const atividade = amigo.atividadeAtual;
    const podeAbrirAtividade = Boolean(atividade && atividade.tipo !== 'launcher' && onAbrirAtividade);
    const abrirChat = () => onAbrirChat(amigo.friendProfileId);
    const abrirAtividade = () => {
        if (podeAbrirAtividade && onAbrirAtividade) {
            onAbrirAtividade(amigo);
            return;
        }

        abrirChat();
    };

    return (
        <article
            onContextMenu={(evento) => onAbrirMenuContexto(evento, amigo)}
            className={cn(
                'grid w-full grid-cols-[1.75rem_2.5rem_minmax(0,1fr)_auto] items-center gap-2 border px-2 py-2',
                'text-left transition-colors',
                selecionado
                    ? 'border-emerald-400/20 bg-emerald-400/[0.045]'
                    : 'border-transparent hover:border-white/[0.07] hover:bg-white/[0.03]'
            )}
        >
            <button
                type="button"
                onClick={() => onAbrirPerfil?.(amigo.friendProfileId)}
                aria-label={`Abrir perfil de ${amigo.nome}`}
                title={`Abrir perfil de ${amigo.nome}`}
                className="relative h-7 w-7 shrink-0 transition-opacity hover:opacity-80"
            >
                {amigo.avatarUrl ? (
                    <img
                        src={amigo.avatarUrl}
                        alt={amigo.nome}
                        className="h-full w-full object-contain"
                        onError={(evento) => {
                            evento.currentTarget.style.display = 'none';
                        }}
                    />
                ) : (
                    <span className="grid h-full w-full place-items-center text-[8px] font-black text-white/50">
                        {iniciais(amigo.nome)}
                    </span>
                )}
                <span className="absolute -bottom-1 -right-1 grid h-3.5 w-3.5 place-items-center rounded-full bg-[#151515]">
                    <IndicadorStatusSocial status={amigo.status ?? 'online'} className="h-2.5 w-2.5" />
                </span>
            </button>

            <button
                type="button"
                onClick={abrirAtividade}
                aria-label={podeAbrirAtividade ? `Abrir ${atividade?.modpackNome}` : `Abrir conversa com ${amigo.nome}`}
                title={podeAbrirAtividade ? 'Ver instância' : `Conversar com ${amigo.nome}`}
                className="h-10 w-10 transition-transform hover:scale-[1.04]"
            >
                {atividade && <ImagemAtividade atividade={atividade} className="h-full w-full" />}
            </button>

            <div className="min-w-0 flex-1">
                <button
                    type="button"
                    onClick={abrirChat}
                    className="flex max-w-full items-center gap-1 text-[11px] font-bold text-white/80 hover:text-white"
                >
                    <span className="truncate">{amigo.nome}</span>
                    {amigo.emblemaDestaque && (
                        <img
                            src={amigo.emblemaDestaque.imagemUrl}
                            alt={`Destaque: ${amigo.emblemaDestaque.nome}`}
                            title={`${amigo.emblemaDestaque.nome} — ${amigo.emblemaDestaque.descricao}`}
                            className="h-4 w-4 shrink-0 object-contain"
                        />
                    )}
                </button>
                <button
                    type="button"
                    onClick={abrirAtividade}
                    className={cn(
                        'mt-0.5 block max-w-full truncate text-[10px] font-semibold text-emerald-300/80',
                        podeAbrirAtividade && 'hover:text-emerald-200 hover:underline'
                    )}
                >
                    {atividade?.modpackNome || atividade?.instanciaNome || 'Minecraft'}
                </button>
                {atividade?.versaoMinecraft && (
                    <p className="mt-0.5 truncate text-[8px] uppercase tracking-wide text-white/25">
                        Minecraft {atividade.versaoMinecraft}
                        {atividade.loader ? ` · ${atividade.loader}` : ''}
                    </p>
                )}
            </div>
            {naoLidas > 0 && (
                <button
                    type="button"
                    onClick={abrirChat}
                    aria-label={`${naoLidas} mensagens não lidas de ${amigo.nome}`}
                    className="inline-flex min-w-4 items-center justify-center bg-emerald-400 px-1 text-[9px] font-black leading-4 text-[#07120d]"
                >
                    {naoLidas > 99 ? '99+' : naoLidas}
                </button>
            )}
        </article>
    );
}

export function ListaAmigosAgrupada({
    className,
    sessaoAtiva,
    filtroAmigos,
    onAlterarFiltro,
    onEnviarSolicitacao,
    enviandoSolicitacao,
    perfilEncontrado,
    buscandoPerfil,
    buscaPerfilConcluida,
    pendentesRecebidas,
    pendentesEnviadas,
    pedidosTransferencia,
    onResponderSolicitacao,
    onResponderTransferencia,
    solicitacaoProcessandoId,
    transferenciaProcessandoId,
    mensagemSolicitacao,
    mensagemTransferencia,
    carregandoAmigos,
    erroAmigos,
    amigosOnline,
    amigosOffline,
    naoLidasPorAmigo,
    amigoSelecionadoPerfilId,
    onAbrirChat,
    onAbrirAtividade,
    onAbrirPerfil,
    onRemoverAmigo,
    formatarTempoRelativo,
    rotuloStatus,
}: ListaAmigosAgrupadaProps) {
    const [abaAtiva, setAbaAtiva] = useState<AbaSocial>('amigos');
    const [onlineRecolhidos, setOnlineRecolhidos] = useState(false);
    const [offlineRecolhidos, setOfflineRecolhidos] = useState(false);
    const [menuContexto, setMenuContexto] = useState<{
        amigo: AmigoSocial;
        x: number;
        y: number;
    } | null>(null);
    const totalAmigos = amigosOnline.length + amigosOffline.length;
    const amigosJogando = amigosOnline.filter(
        (amigo) => amigo.atividadeAtual && amigo.atividadeAtual.tipo !== 'launcher'
    );
    const amigosDisponiveis = amigosOnline.filter(
        (amigo) => !amigo.atividadeAtual || amigo.atividadeAtual.tipo === 'launcher'
    );
    const solicitacaoJaEnviada = perfilEncontrado
        ? pendentesEnviadas.some((pendente) => pendente.paraPerfilId === perfilEncontrado.perfilId)
        : false;

    const totalPedidos = pendentesRecebidas.length + pedidosTransferencia.length;
    const amigos = [...amigosOnline, ...amigosOffline];

    useEffect(() => {
        if (totalPedidos > 0) setAbaAtiva('pedidos');
    }, [totalPedidos]);

    const abrirMenuContexto = (evento: React.MouseEvent, amigo: AmigoSocial) => {
        evento.preventDefault();
        evento.stopPropagation();
        setMenuContexto({ amigo, x: evento.clientX, y: evento.clientY });
    };

    return (
        <section className={cn('flex min-h-0 flex-col overflow-hidden border border-white/10 bg-[#151515]', className)}>
            <div className="grid grid-cols-2 border-b border-white/[0.07] p-1">
                <button
                    type="button"
                    onClick={() => setAbaAtiva('amigos')}
                    className={cn(
                        'flex items-center justify-center gap-2 border px-2 py-2 text-[10px] font-black uppercase tracking-[0.12em]',
                        abaAtiva === 'amigos' ? 'border-white/12 bg-white/[0.05] text-white/85' : 'border-transparent text-white/35 hover:text-white/60'
                    )}
                >
                    <Users size={11} /> Amigos <span className="text-[9px] opacity-50">{totalAmigos}</span>
                </button>
                <button
                    type="button"
                    onClick={() => setAbaAtiva('pedidos')}
                    className={cn(
                        'flex items-center justify-center gap-2 border px-2 py-2 text-[10px] font-black uppercase tracking-[0.12em]',
                        abaAtiva === 'pedidos' ? 'border-white/12 bg-white/[0.05] text-white/85' : 'border-transparent text-white/35 hover:text-white/60'
                    )}
                >
                    <Mail size={11} /> Pedidos
                    {totalPedidos > 0 && (
                        <span className="inline-flex min-w-4 items-center justify-center bg-emerald-400 px-1 text-[9px] leading-4 text-[#07120d]">{totalPedidos}</span>
                    )}
                </button>
            </div>

            {!sessaoAtiva && <p className="px-4 py-6 text-center text-[10px] text-white/35">Entre com o Discord para usar o social.</p>}

            {sessaoAtiva && abaAtiva === 'amigos' && (
                <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
                    <div className="relative">
                        <Search size={11} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                        <input
                            value={filtroAmigos}
                            onChange={(evento) => onAlterarFiltro(evento.target.value)}
                            placeholder="Nome ou @handle"
                            className="h-9 w-full border border-white/10 bg-[#101010] pl-8 pr-3 text-[10px] text-white outline-none placeholder:text-white/25 focus:border-white/25"
                        />
                    </div>

                    {buscandoPerfil && <p className="text-center text-[9px] text-white/25">Buscando perfil...</p>}

                    {!buscandoPerfil && perfilEncontrado && (
                        <div className="flex items-center gap-2.5 border border-white/10 bg-white/[0.025] p-2.5">
                            {perfilEncontrado.avatarUrl ? (
                                <img
                                    src={perfilEncontrado.avatarUrl}
                                    alt={perfilEncontrado.nome}
                                    className="h-8 w-8 shrink-0 object-contain"
                                />
                            ) : (
                                <div className="grid h-8 w-8 shrink-0 place-items-center text-[9px] font-black text-white/55">
                                    {iniciais(perfilEncontrado.nome)}
                                </div>
                            )}
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-[11px] font-semibold text-white/80">{perfilEncontrado.nome}</p>
                                <p className="truncate text-[9px] text-white/35">@{perfilEncontrado.handle}</p>
                            </div>
                            <button
                                type="button"
                                onClick={onEnviarSolicitacao}
                                disabled={enviandoSolicitacao || solicitacaoJaEnviada}
                                className="flex items-center gap-1 border border-emerald-400/25 bg-emerald-400/[0.07] px-2 py-1.5 text-[9px] font-bold uppercase tracking-wider text-emerald-200 disabled:border-white/10 disabled:bg-transparent disabled:text-white/25"
                            >
                                <Plus size={9} /> {solicitacaoJaEnviada ? 'Enviado' : enviandoSolicitacao ? 'Enviando' : 'Adicionar'}
                            </button>
                        </div>
                    )}

                    {!buscandoPerfil && buscaPerfilConcluida && !perfilEncontrado && totalAmigos === 0 && (
                        <p className="text-center text-[9px] text-white/25">Nenhum usuário encontrado.</p>
                    )}

                    {mensagemSolicitacao && (
                        <p className={cn('text-[9px]', mensagemEhErro(mensagemSolicitacao) ? 'text-red-300/70' : 'text-emerald-300/70')}>
                            {mensagemSolicitacao}
                        </p>
                    )}

                    <div className="scrollbar-amigos min-h-0 flex-1 overflow-y-auto pr-1">
                        {carregandoAmigos && totalAmigos === 0 && <p className="py-3 text-center text-[10px] text-white/30">Carregando...</p>}
                        {!carregandoAmigos && erroAmigos && <p className="py-2 text-center text-[10px] text-red-300/70">{erroAmigos}</p>}
                        {!carregandoAmigos && !erroAmigos && totalAmigos === 0 && !perfilEncontrado && !buscandoPerfil && !filtroAmigos.trim() && (
                            <p className="py-3 text-center text-[10px] text-white/30">Nenhum amigo.</p>
                        )}

                        {!erroAmigos && totalAmigos > 0 && (
                            <div className="space-y-3">
                            {amigosJogando.length > 0 && (
                                <div className="space-y-1 border-b border-emerald-400/15 pb-3">
                                    <p className="px-1 text-[8px] font-black uppercase tracking-[0.16em] text-emerald-300/65">
                                        Em jogo
                                    </p>
                                    {amigosJogando.map((amigo) => (
                                        <LinhaAmigoJogando
                                            key={amigo.friendProfileId}
                                            amigo={amigo}
                                            selecionado={amigoSelecionadoPerfilId === amigo.friendProfileId}
                                            naoLidas={naoLidasPorAmigo[amigo.friendProfileId] ?? 0}
                                            onAbrirAtividade={onAbrirAtividade}
                                            onAbrirChat={onAbrirChat}
                                            onAbrirPerfil={onAbrirPerfil}
                                            onAbrirMenuContexto={abrirMenuContexto}
                                        />
                                    ))}
                                </div>
                            )}
                            {amigosDisponiveis.length > 0 && (
                                <div className="space-y-1.5">
                                    <button
                                        type="button"
                                        onClick={() => setOnlineRecolhidos((valor) => !valor)}
                                        aria-expanded={!onlineRecolhidos}
                                        className="group flex h-4 w-full items-center gap-1 px-1 text-left"
                                    >
                                        <span className="text-white/25 group-hover:text-white/50">
                                            {onlineRecolhidos ? <ChevronRight size={7} /> : <ChevronDown size={7} />}
                                        </span>
                                        <span className="text-[8px] font-black uppercase leading-none tracking-[0.16em] text-white/25 group-hover:text-white/50">
                                            Online
                                        </span>
                                    </button>
                                    {!onlineRecolhidos && amigosDisponiveis.map((amigo) => (
                                        <LinhaAmigo
                                            key={amigo.friendProfileId}
                                            amigo={amigo}
                                            selecionado={amigoSelecionadoPerfilId === amigo.friendProfileId}
                                            naoLidas={naoLidasPorAmigo[amigo.friendProfileId] ?? 0}
                                            onAbrirChat={onAbrirChat}
                                            onAbrirPerfil={onAbrirPerfil}
                                            onAbrirMenuContexto={abrirMenuContexto}
                                            formatarTempoRelativo={formatarTempoRelativo}
                                            rotuloStatus={rotuloStatus}
                                        />
                                    ))}
                                </div>
                            )}
                            {amigosOffline.length > 0 && (
                                <div className="space-y-1.5 border-t border-white/[0.06] pt-3">
                                    <button
                                        type="button"
                                        onClick={() => setOfflineRecolhidos((valor) => !valor)}
                                        aria-expanded={!offlineRecolhidos}
                                        className="group flex h-4 w-full items-center gap-1 text-left"
                                    >
                                        <span className="text-white/25 group-hover:text-white/50">
                                            {offlineRecolhidos ? <ChevronRight size={7} /> : <ChevronDown size={7} />}
                                        </span>
                                        <span className="text-[8px] font-black uppercase leading-none tracking-[0.16em] text-white/25 group-hover:text-white/50">
                                            Offline
                                        </span>
                                    </button>
                                    {!offlineRecolhidos && amigosOffline.map((amigo) => (
                                        <LinhaAmigo
                                            key={amigo.friendProfileId}
                                            amigo={amigo}
                                            selecionado={amigoSelecionadoPerfilId === amigo.friendProfileId}
                                            naoLidas={naoLidasPorAmigo[amigo.friendProfileId] ?? 0}
                                            onAbrirChat={onAbrirChat}
                                            onAbrirMenuContexto={abrirMenuContexto}
                                            formatarTempoRelativo={formatarTempoRelativo}
                                            rotuloStatus={rotuloStatus}
                                        />
                                    ))}
                                </div>
                            )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {sessaoAtiva && abaAtiva === 'pedidos' && (
                <div className="scrollbar-amigos min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                    {totalPedidos === 0 ? (
                        <p className="py-2 text-center text-[9px] text-white/25">Nenhum pedido.</p>
                    ) : pendentesRecebidas.map((pendente) => {
                        const processando = solicitacaoProcessandoId === pendente.id;
                        return (
                            <article key={pendente.id} className="border border-white/[0.08] p-2.5">
                                <p className="truncate text-[11px] font-semibold text-white/75">{pendente.deNome}</p>
                                <p className="truncate text-[9px] text-white/30">{pendente.deHandle ? `@${pendente.deHandle}` : ''} · {formatarTempoRelativo(pendente.criadoEm)}</p>
                                <div className="mt-2 grid grid-cols-2 gap-1.5">
                                    <button type="button" onClick={() => onResponderSolicitacao(pendente.id, 'reject')} disabled={processando} className="flex items-center justify-center gap-1 border border-white/10 py-1.5 text-[8px] uppercase tracking-wider text-white/35 hover:text-red-200 disabled:opacity-30">
                                        <X size={9} /> Recusar
                                    </button>
                                    <button type="button" onClick={() => onResponderSolicitacao(pendente.id, 'accept')} disabled={processando} className="flex items-center justify-center gap-1 border border-emerald-400/20 bg-emerald-400/[0.06] py-1.5 text-[8px] uppercase tracking-wider text-emerald-200 disabled:opacity-30">
                                        <Check size={9} /> Aceitar
                                    </button>
                                </div>
                            </article>
                        );
                    })}

                    {pedidosTransferencia.map((pedido) => {
                        const amigo = amigos.find(
                            (item) => item.friendProfileId === pedido.solicitantePerfilId
                        );
                        const processando = transferenciaProcessandoId === pedido.id;

                        return (
                            <article
                                key={pedido.id}
                                className="border border-emerald-400/15 bg-emerald-400/[0.025] p-2.5"
                            >
                                <div className="flex items-start gap-2.5">
                                    <div className="grid h-8 w-8 shrink-0 place-items-center">
                                        {amigo?.avatarUrl ? (
                                            <img
                                                src={amigo.avatarUrl}
                                                alt={amigo.nome}
                                                className="h-full w-full object-contain"
                                            />
                                        ) : (
                                            <Download size={14} className="text-emerald-300/70" />
                                        )}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-[11px] font-semibold text-white/80">
                                            {amigo?.nome ?? 'Amigo'}
                                        </p>
                                        <p className="mt-0.5 text-[8px] font-black uppercase tracking-[0.12em] text-emerald-300/55">
                                            Transferência de instância
                                        </p>
                                        <p className="mt-1 truncate text-[10px] text-white/45">
                                            {pedido.instanciaNome || pedido.instanciaId || 'Instância personalizada'}
                                        </p>
                                    </div>
                                </div>
                                <div className="mt-2 grid grid-cols-2 gap-1.5">
                                    <button
                                        type="button"
                                        onClick={() => onResponderTransferencia(pedido.id, false)}
                                        disabled={processando}
                                        className="flex items-center justify-center gap-1 border border-white/10 py-1.5 text-[8px] uppercase tracking-wider text-white/35 hover:text-red-200 disabled:opacity-30"
                                    >
                                        <X size={9} /> Recusar
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => onResponderTransferencia(pedido.id, true)}
                                        disabled={processando}
                                        className="flex items-center justify-center gap-1 border border-emerald-400/20 bg-emerald-400/[0.06] py-1.5 text-[8px] uppercase tracking-wider text-emerald-200 disabled:opacity-30"
                                    >
                                        <Check size={9} /> Revisar e aceitar
                                    </button>
                                </div>
                            </article>
                        );
                    })}

                    {mensagemTransferencia && (
                        <p className={cn(
                            'text-[9px]',
                            mensagemEhErro(mensagemTransferencia)
                                ? 'text-red-300/70'
                                : 'text-emerald-300/70'
                        )}>
                            {mensagemTransferencia}
                        </p>
                    )}
                </div>
            )}

            <MenuContextual
                aberto={menuContexto !== null}
                x={menuContexto?.x ?? 0}
                y={menuContexto?.y ?? 0}
                onFechar={() => setMenuContexto(null)}
                rotulo="Ações do amigo"
            >
                {menuContexto && (
                    <>
                        <CabecalhoMenuContextual
                            titulo={menuContexto.amigo.nome}
                            subtitulo={menuContexto.amigo.handle ? `@${menuContexto.amigo.handle}` : rotuloStatus(menuContexto.amigo.status)}
                        />
                        <ItemMenuContextual icone={<Mail size={12} />} onClick={() => {
                            onAbrirChat(menuContexto.amigo.friendProfileId);
                            setMenuContexto(null);
                        }}>
                            Conversar
                        </ItemMenuContextual>
                        <ItemMenuContextual icone={<Users size={12} />} onClick={() => {
                            onAbrirPerfil?.(menuContexto.amigo.friendProfileId);
                            setMenuContexto(null);
                        }}>
                            Abrir perfil
                        </ItemMenuContextual>
                        {menuContexto.amigo.atividadeAtual?.tipo !== 'launcher' &&
                            menuContexto.amigo.atividadeAtual && onAbrirAtividade && (
                            <ItemMenuContextual icone={<Gamepad2 size={12} />} destaque onClick={() => {
                                onAbrirAtividade(menuContexto.amigo);
                                setMenuContexto(null);
                            }}>
                                Ver instância em jogo
                            </ItemMenuContextual>
                        )}
                        <ItemMenuContextual
                            icone={<Copy size={12} />}
                            disabled={!menuContexto.amigo.handle}
                            onClick={() => {
                                if (menuContexto.amigo.handle) {
                                    void navigator.clipboard.writeText(`@${menuContexto.amigo.handle}`);
                                }
                                setMenuContexto(null);
                            }}
                        >
                            Copiar @handle
                        </ItemMenuContextual>
                        <SeparadorMenuContextual />
                        <ItemMenuContextual icone={<Trash2 size={12} />} perigo onClick={() => {
                            const amigo = menuContexto.amigo;
                            setMenuContexto(null);
                            if (confirm(`Remover ${amigo.nome} da sua lista de amigos?`)) {
                                onRemoverAmigo(amigo.friendProfileId);
                            }
                        }}>
                            Remover amizade
                        </ItemMenuContextual>
                    </>
                )}
            </MenuContextual>

        </section>
    );
}
