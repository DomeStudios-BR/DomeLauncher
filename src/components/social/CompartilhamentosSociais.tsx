import { ModalSocial } from './ModalSocial';
import { Loader2 } from '../../iconesPixelados';
import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrent, onOpenUrl } from '@tauri-apps/plugin-deep-link';
import { RevisaoPacoteSocial, type PreviaPacoteSocial, type TransferenciaSocial } from './TransferenciasSociais';
import {
    EVENTO_INSTANCIAS_ATUALIZADAS,
    EVENTO_INSTANCIAS_PUBLICAS_SOCIAIS,
    EVENTO_PUBLICAR_INSTANCIA_SOCIAL,
    type PublicacaoInstanciaSocial,
} from '../../lib/eventosTransferenciaSocial';

interface Compartilhamento {
    id: string; nome: string; dono: string; instanciaId?: string;
    membros?: string[];
    convidados?: string[];
    nomesMembros?: Record<string, string>;
    convitePendente?: boolean;
    publicaAmigos?: boolean;
    convites?: Array<{ id: string; expiraEm: string; usos: number; limiteUsos: number }>;
    versao: { numero: number; previa: PreviaPacoteSocial } | null;
}
interface RevisaoAtualizacao {
    instanciaId?: string; versao: number; conflitos: string[];
    adicionados: string[]; removidos: string[]; alterados: string[];
}
interface EstadoPublicacao {
    itemId: string;
    etapa: string;
    pedidoId?: string;
}

export function CompartilhamentosSociais({ apiBaseUrl, perfilId, obterToken, amigos = [] }: {
    apiBaseUrl: string; perfilId: string; obterToken: () => Promise<string | null>;
    amigos?: Array<{ friendProfileId: string; nome: string }>;
}) {
    const [aberto, setAberto] = useState(false);
    const [itens, setItens] = useState<Compartilhamento[]>([]);
    const [convite, setConvite] = useState('');
    const [conviteGerado, setConviteGerado] = useState('');
    const [erro, setErro] = useState('');
    const [ocupado, setOcupado] = useState(false);
    const [mensagem, setMensagem] = useState('');
    const [estadoPublicacao, setEstadoPublicacao] = useState<EstadoPublicacao | null>(null);
    const [publicacao, setPublicacao] = useState<{
        item: Compartilhamento;
        previa: PreviaPacoteSocial;
        tornarPublicaAoPublicar?: boolean;
    } | null>(null);
    const [atualizacao, setAtualizacao] = useState<{ item: Compartilhamento; revisao: RevisaoAtualizacao } | null>(null);
    const [aceitaConflitos, setAceitaConflitos] = useState(false);
    useEffect(() => {
        const receberConvite = (urls: string[]) => {
            const convite = urls.find((url) => /^domelauncher:\/\/convite\/[a-f0-9]{24}\.[a-f0-9]{48}$/.test(url));
            if (convite) { setConvite(convite); setAberto(true); }
        };
        void getCurrent().then((urls) => { if (urls) receberConvite(urls); }).catch(() => undefined);
        const escuta = onOpenUrl(receberConvite);
        return () => { void escuta.then((remover) => remover()).catch(() => undefined); };
    }, []);

    const api = useCallback(async <T,>(acao: string, dados: object = {}): Promise<T> => {
        const token = await obterToken();
        if (!token) throw new Error('Entre novamente para gerenciar compartilhamentos.');
        return invoke<T>('gerenciar_compartilhamentos_sociais', { apiBaseUrl, accessToken: token, acao, dados });
    }, [apiBaseUrl, obterToken]);
    const carregar = useCallback(async () => {
        const resposta = await api<{ itens: Compartilhamento[] }>('listar');
        setItens(resposta.itens);
        const publicacoes = resposta.itens
            .filter((item) => item.dono === perfilId && item.publicaAmigos && item.instanciaId)
            .map((item) => ({
                instanciaId: item.instanciaId!,
                compartilhamentoId: item.id,
            } satisfies PublicacaoInstanciaSocial));
        window.dispatchEvent(new CustomEvent(EVENTO_INSTANCIAS_PUBLICAS_SOCIAIS, {
            detail: publicacoes,
        }));
    }, [api, perfilId]);
    const executar = async (acao: () => Promise<void>) => {
        if (ocupado) return;
        setOcupado(true); setErro(''); setMensagem('');
        try { await acao(); }
        catch (falha) { setErro(typeof falha === 'string' ? falha : falha instanceof Error ? falha.message : 'Falha na operação.'); }
        finally { setOcupado(false); }
    };
    useEffect(() => {
        void carregar().catch(() => undefined);
    }, [carregar]);
    useEffect(() => {
        if (!aberto) return;
        void carregar().catch((falha) => setErro(String(falha)));
    }, [aberto, carregar]);
    useEffect(() => {
        const aoPublicarInstancia = (evento: Event) => {
            const detalhe = (evento as CustomEvent<{
                instanciaId?: string;
                nome?: string;
                publicar?: boolean;
            }>).detail;
            if (!detalhe?.instanciaId || !detalhe.nome) return;
            const instanciaPublicadaId = detalhe.instanciaId;
            const nomeInstanciaPublicada = detalhe.nome;

            void executar(async () => {
                if (detalhe.publicar === false) {
                    const resposta = await api<{ itens: Compartilhamento[] }>('listar');
                    const item = resposta.itens.find((candidato) => candidato.instanciaId === instanciaPublicadaId);
                    if (!item) throw new Error('Publicação da instância não encontrada.');
                    await api('definir_publica', { id: item.id, publicaAmigos: false });
                    setMensagem('A instância voltou a exigir solicitação.');
                    await carregar();
                    return;
                }

                setEstadoPublicacao({ itemId: instanciaPublicadaId, etapa: 'Abrindo seletor…' });
                try {
                    const criado = await api<{ id: string }>('criar', {
                        instanciaId: instanciaPublicadaId,
                        nome: nomeInstanciaPublicada,
                    });
                    const resposta = await api<{ itens: Compartilhamento[] }>('listar');
                    const item = resposta.itens.find((candidato) => candidato.id === criado.id);
                    if (!item) throw new Error('Não foi possível preparar a publicação.');
                    setEstadoPublicacao({ itemId: item.id, etapa: 'Lendo arquivos…' });
                    const previa = await invoke<PreviaPacoteSocial>('obter_previa_pacote_social', {
                        instanceId: instanciaPublicadaId,
                    });
                    setPublicacao({ item, previa, tornarPublicaAoPublicar: true });
                } finally {
                    setEstadoPublicacao(null);
                }
            });
        };
        window.addEventListener(EVENTO_PUBLICAR_INSTANCIA_SOCIAL, aoPublicarInstancia);
        return () => window.removeEventListener(EVENTO_PUBLICAR_INSTANCIA_SOCIAL, aoPublicarInstancia);
    }, [api, carregar, ocupado]);
    useEffect(() => {
        const escuta = listen<{ pedidoId: string; bytes: number; total?: number; bytesPorSegundo: number }>(
            'social-transferencia-bytes', ({ payload }) => {
                setEstadoPublicacao((estado) => {
                    if (!estado?.pedidoId || estado.pedidoId !== payload.pedidoId) return estado;
                    const enviados = (payload.bytes / 1024 / 1024).toFixed(1);
                    const total = payload.total ? ` de ${(payload.total / 1024 / 1024).toFixed(1)} MiB` : ' MiB';
                    const velocidade = (payload.bytesPorSegundo / 1024 / 1024).toFixed(1);
                    return { ...estado, etapa: `Enviando ${enviados}${total} · ${velocidade} MiB/s` };
                });
            },
        );
        return () => { void escuta.then((remover) => remover()).catch(() => undefined); };
    }, []);
    useEffect(() => {
        const atualizar = () => {
            void carregar().catch((falha) => {
                if (aberto) setErro(String(falha));
            });
        };
        window.addEventListener('dome:compartilhamentos-atualizar', atualizar);
        return () => window.removeEventListener('dome:compartilhamentos-atualizar', atualizar);
    }, [aberto, carregar]);

    const publicar = async (arquivos: string[]) => {
        if (!publicacao) return;
        const { item, previa, tornarPublicaAoPublicar } = publicacao;
        setPublicacao(null);
        setEstadoPublicacao({ itemId: item.id, etapa: 'Preparando arquivos…' });
        await executar(async () => {
            const pacote = await invoke<{ caminhoArquivo: string; previa: PreviaPacoteSocial }>('export_launcher_social_sync_package', {
                instanceId: item.instanciaId, arquivosConfiguracao: arquivos, arquivosReferencia: previa.arquivos,
            });
            try {
                setEstadoPublicacao({ itemId: item.id, etapa: 'Criando publicação…' });
                const pedido = await api<TransferenciaSocial>('publicar', { id: item.id, previa: pacote.previa });
                const token = await obterToken();
                if (!token) throw new Error('Sessão expirada.');
                setEstadoPublicacao({ itemId: item.id, pedidoId: pedido.pedidoId, etapa: 'Enviando pacote…' });
                await invoke('upload_launcher_social_sync_package', { apiBaseUrl, accessToken: token,
                    payload: { pedidoId: pedido.pedidoId, tokenUpload: pedido.tokenUpload, caminhoArquivo: pacote.caminhoArquivo } });
                if (tornarPublicaAoPublicar) {
                    await api('definir_publica', { id: item.id, publicaAmigos: true });
                }
            } finally {
                await invoke('descartar_pacote_social', { caminhoArquivo: pacote.caminhoArquivo }).catch(() => undefined);
            }
            setMensagem(tornarPublicaAoPublicar
                ? 'Instância pública para amigos. Eles já podem baixar pela sua atividade.'
                : 'Versão publicada. Os participantes já podem atualizar.');
            await carregar();
        });
        setEstadoPublicacao(null);
    };
    const revisarPublicacao = async (item: Compartilhamento) => {
        setEstadoPublicacao({ itemId: item.id, etapa: 'Lendo arquivos…' });
        await executar(async () => {
            const previa = await invoke<PreviaPacoteSocial>('obter_previa_pacote_social', {
                instanceId: item.instanciaId,
            });
            setPublicacao({ item, previa });
        });
        setEstadoPublicacao(null);
    };
    const receber = async () => {
        if (!atualizacao?.item.versao) return;
        const { item } = atualizacao;
        setAtualizacao(null);
        await executar(async () => {
            const pedido = await api<TransferenciaSocial & { versao: number; previa: PreviaPacoteSocial }>('receber', { id: item.id });
            if (pedido.versao !== item.versao!.numero) throw new Error('Uma nova versão foi publicada. Revise novamente antes de atualizar.');
            setMensagem('Baixando e preparando a versão…');
            await invoke('download_import_launcher_social_sync_package', { apiBaseUrl,
                pedidoId: pedido.pedidoId, tokenDownload: pedido.tokenDownload,
                vinculo: { apiBaseUrl, compartilhamentoId: item.id, versao: pedido.versao, arquivos: pedido.previa.arquivos,
                    substituirAlteracoesLocais: aceitaConflitos },
            });
            const token = await obterToken();
            if (token) await invoke('gerenciar_transferencias_sociais', { apiBaseUrl, accessToken: token,
                acao: 'confirmar', pedidoId: pedido.pedidoId });
            window.dispatchEvent(new Event(EVENTO_INSTANCIAS_ATUALIZADAS));
            setMensagem('Instância disponível na biblioteca.');
            await carregar();
        });
    };

    return <>
        {estadoPublicacao && !aberto && !publicacao && <ModalSocial onFechar={() => undefined}>
            <section role="status" aria-live="polite"
                className="flex w-full max-w-sm items-center gap-3 rounded-xl border border-emerald-400/15 bg-[#17191c] p-5 text-emerald-300 shadow-2xl">
                <Loader2 size={18} className="shrink-0 animate-spin" />
                <div>
                    <p className="text-sm font-semibold">Preparando publicação</p>
                    <p className="mt-1 text-xs text-white/50">{estadoPublicacao.etapa}</p>
                </div>
            </section>
        </ModalSocial>}
        {aberto && <ModalSocial onFechar={() => { if (!ocupado) setAberto(false); }}>
            <section role="dialog" aria-modal="true" aria-labelledby="compartilhamentos-titulo"
                className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl border border-white/10 bg-[#17191c] p-5">
                <div className="flex items-center justify-between gap-3">
                    <h2 id="compartilhamentos-titulo" className="text-lg text-white">Instâncias compartilhadas</h2>
                    <button autoFocus disabled={ocupado} onClick={() => setAberto(false)} className="text-sm text-white/60">Fechar</button>
                </div>
                <div className="mt-4 flex gap-2">
                    <input aria-label="Convite de instância" placeholder="Cole um convite recebido" value={convite}
                        onChange={(e) => setConvite(e.target.value)} className="min-w-0 flex-1 rounded bg-black/30 p-2 text-sm text-white" />
                    <button disabled={ocupado || !convite.trim()} className="px-3 text-sm text-emerald-400 disabled:opacity-40"
                        onClick={() => void executar(async () => { await api('aceitar', { convite: convite.trim() }); setConvite(''); await carregar(); })}>Aceitar</button>
                </div>
                {erro && <p role="alert" className="mt-3 text-sm text-red-400">{erro}</p>}
                {mensagem && <p role="status" className="mt-3 text-sm text-white/60">{mensagem}</p>}
                {conviteGerado && <div className="mt-3 flex gap-2 rounded bg-black/30 p-2">
                    <input readOnly aria-label="Convite gerado" value={conviteGerado} className="min-w-0 flex-1 bg-transparent text-xs text-white" />
                    <button className="text-xs text-emerald-400" onClick={() => void executar(async () => {
                        await navigator.clipboard.writeText(conviteGerado); setMensagem('Convite copiado.');
                    })}>Copiar</button>
                </div>}
                <div className="mt-4 min-h-0 overflow-y-auto">
                    {!itens.length && <p className="py-8 text-center text-sm text-white/40">Compartilhe uma instância ou aceite um convite.</p>}
                    {itens.map((item) => {
                        const publicandoItem = estadoPublicacao?.itemId === item.id;
                        return <article key={item.id} className="border-t border-white/10 py-4">
                        <div className="flex justify-between gap-3 text-white"><span>{item.nome}</span>
                            {!publicandoItem && <span className="text-xs text-white/40">
                                {item.versao ? `Versão ${item.versao.numero}` : 'Ainda não publicada'}
                            </span>}</div>
                        <div className="mt-3 flex flex-wrap gap-4 text-xs">
                            {item.dono === perfilId ? <>
                                {publicandoItem ? <span role="status" aria-live="polite"
                                    className="inline-flex items-center gap-2 font-medium text-emerald-400">
                                    <Loader2 size={13} className="animate-spin" />{estadoPublicacao.etapa}
                                </span> : <button disabled={ocupado}
                                    className="rounded px-1 text-emerald-400 transition hover:bg-emerald-400/10 hover:text-emerald-300 active:scale-95"
                                    onClick={() => void revisarPublicacao(item)}>Revisar e publicar</button>}
                                <button disabled={ocupado || !item.versao} className="text-white/70 disabled:opacity-40" onClick={() => void executar(async () => {
                                    const resposta = await api<{ convite: string }>('convidar', { id: item.id });
                                    setConviteGerado(resposta.convite); await carregar();
                                })}>Gerar convite · 24h / 10 usos</button>
                                <button disabled={ocupado} className="text-white/40" onClick={() => void executar(async () => {
                                    await api('encerrar', { id: item.id }); await carregar();
                                })}>Encerrar compartilhamento</button>
                            </> : item.convitePendente ? <>
                                <button disabled={ocupado} className="text-emerald-400" onClick={() => void executar(async () => {
                                    await api('aceitar_amigo', { id: item.id }); await carregar();
                                })}>Aceitar convite do amigo</button>
                                <button disabled={ocupado} className="text-white/50" onClick={() => void executar(async () => {
                                    await api('sair', { id: item.id }); await carregar();
                                })}>Recusar</button>
                            </> : <>
                                <button disabled={ocupado || !item.versao} className="text-emerald-400" onClick={() => void executar(async () => {
                                    const revisao = await invoke<RevisaoAtualizacao>('revisar_atualizacao_compartilhada', {
                                        apiBaseUrl, compartilhamentoId: item.id, arquivos: item.versao!.previa.arquivos,
                                    });
                                    setAceitaConflitos(false); setAtualizacao({ item, revisao });
                                })}>Revisar instalação / atualização</button>
                                <button disabled={ocupado} className="text-white/50" onClick={() => void executar(async () => {
                                    await invoke('desvincular_instancia_compartilhada', { apiBaseUrl, compartilhamentoId: item.id });
                                    await api('sair', { id: item.id }); await carregar();
                                    setMensagem('Você saiu. A cópia local permanece independente.');
                                })}>Desvincular e sair</button>
                            </>}
                        </div>
                        {item.dono === perfilId && !!item.versao && <select aria-label={`Convidar amigo para ${item.nome}`}
                            value="" disabled={ocupado} className="mt-3 rounded bg-black/30 p-2 text-xs text-white/70"
                            onChange={(evento) => { const membro = evento.target.value; if (!membro) return;
                                void executar(async () => { await api('convidar_amigo', { id: item.id, membro }); await carregar(); }); }}>
                            <option value="">Convidar amigo…</option>
                            {amigos.filter((a) => !item.membros?.includes(a.friendProfileId) && !item.convidados?.includes(a.friendProfileId))
                                .map((a) => <option key={a.friendProfileId} value={a.friendProfileId}>{a.nome}</option>)}
                        </select>}
                        {item.convites?.map((c) => <div key={c.id} className="mt-2 flex justify-between text-xs text-white/40">
                            <span>Convite · {c.usos}/{c.limiteUsos} usos · até {new Date(c.expiraEm).toLocaleString('pt-BR')}</span>
                            <button disabled={ocupado} onClick={() => void executar(async () => {
                                await api('revogar', { id: item.id, convite: c.id }); await carregar();
                            })}>Revogar</button>
                        </div>)}
                        {[...(item.membros ?? []), ...(item.convidados ?? [])].map((membro) => <div key={membro} className="mt-2 flex justify-between text-xs text-white/40">
                            <span>{item.nomesMembros?.[membro] || amigos.find((a) => a.friendProfileId === membro)?.nome || 'Jogador'}
                                {item.convidados?.includes(membro) ? ' · Convite pendente' : ''}</span><button disabled={ocupado} onClick={() => void executar(async () => {
                                await api('remover', { id: item.id, membro }); await carregar();
                            })}>Remover</button>
                        </div>)}
                    </article>})}
                </div>
            </section>
        </ModalSocial>}
        {publicacao && <RevisaoPacoteSocial publicando arquivosAnteriores={publicacao.item.versao?.previa.arquivos} previa={publicacao.previa} onConfirmar={(a) => void publicar(a)} onFechar={() => setPublicacao(null)} />}
        {atualizacao && <ModalSocial onFechar={() => setAtualizacao(null)}>
            <section role="dialog" aria-modal="true" aria-label="Revisar atualização" className="max-h-[80vh] w-full max-w-xl overflow-y-auto rounded-xl bg-[#17191c] p-5 text-white">
                <h2 className="text-lg">{atualizacao.item.nome} · versão {atualizacao.item.versao?.numero}</h2>
                <p className="mt-2 text-sm text-white/50">{atualizacao.item.versao?.previa.versaoMinecraft} · {atualizacao.item.versao?.previa.loader || 'Vanilla'}</p>
                {(['adicionados', 'alterados', 'removidos'] as const).map((tipo) => <div key={tipo} className="mt-3 text-sm">
                    <p>{atualizacao.revisao[tipo].length} {atualizacao.revisao[tipo].length === 1 ? tipo.slice(0, -1) : tipo}</p>
                    <ul className="mt-1 text-xs text-white/50">{atualizacao.revisao[tipo].map((c) => <li key={c}>{c}</li>)}</ul>
                </div>)}
                {atualizacao.revisao.instanciaId && <p className="mt-3 text-xs text-white/50">Mundos e opções pessoais serão preservados. Uma cópia de segurança será mantida.</p>}
                {!!atualizacao.revisao.conflitos.length && <label className="mt-3 block text-sm text-amber-300">
                    <input type="checkbox" checked={aceitaConflitos} onChange={(e) => setAceitaConflitos(e.target.checked)} />
                    {' '}Substituir minhas alterações nestes arquivos: {atualizacao.revisao.conflitos.join(', ')}
                </label>}
                <div className="mt-5 flex justify-end gap-4 text-sm">
                    <button autoFocus onClick={() => setAtualizacao(null)}>Voltar</button>
                    <button disabled={!!atualizacao.revisao.conflitos.length && !aceitaConflitos} className="text-emerald-400 disabled:opacity-40"
                        onClick={() => void receber()}>{atualizacao.revisao.instanciaId ? 'Atualizar instância' : 'Instalar'}</button>
                </div>
            </section>
        </ModalSocial>}
    </>;
}
