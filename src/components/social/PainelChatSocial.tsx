import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { MoreVertical, Play, Trash2, X } from '../../iconesPixelados';
import { cn } from '../../lib/utils';
import type { AmigoSocial, MensagemChatApi, StatusPresenca } from './tiposSocial';
import { ImagemAtividade } from './ImagemAtividade';
import { IndicadorStatusSocial } from './IndicadorStatusSocial';

interface PainelChatSocialProps {
  aberto: boolean;
  compacto?: boolean;
  recuado?: boolean;
  amigoSelecionado: AmigoSocial | null;
  perfilIdAtual?: string;
  mensagens: MensagemChatApi[];
  carregandoChat: boolean;
  enviandoChat: boolean;
  erroChat: string | null;
  textoChat: string;
  processandoAtividade: boolean;
  mensagemSync: string | null;
  onFechar: () => void;
  onAlterarTexto: (valor: string) => void;
  onEnviarMensagem: () => void;
  onPressionarEnter: (evento: KeyboardEvent<HTMLInputElement>) => void;
  onRemoverAmigo: (friendProfileId: string) => void;
  onInstalarAtividade: (
    friendProfileId: string,
    atividade?: AmigoSocial['atividadeAtual']
  ) => Promise<void>;
  onSolicitarSync: (
    friendProfileId: string,
    atividade?: AmigoSocial['atividadeAtual']
  ) => Promise<void>;
  formatarTempoRelativo: (data: string | null | undefined) => string;
  rotuloStatus: (status?: StatusPresenca) => string;
}

export function PainelChatSocial({
  aberto,
  compacto = false,
  recuado = false,
  amigoSelecionado,
  perfilIdAtual,
  mensagens,
  carregandoChat,
  enviandoChat,
  erroChat,
  textoChat,
  processandoAtividade,
  mensagemSync,
  onFechar,
  onAlterarTexto,
  onEnviarMensagem,
  onPressionarEnter,
  onRemoverAmigo,
  onInstalarAtividade,
  onSolicitarSync,
  formatarTempoRelativo,
  rotuloStatus,
}: PainelChatSocialProps) {
  const conversaRef = useRef<HTMLDivElement | null>(null);
  const [menuAberto, setMenuAberto] = useState(false);
  const [confirmandoRemocao, setConfirmandoRemocao] = useState(false);
  const atividadePersonalizada = amigoSelecionado?.atividadeAtual?.tipo === 'instancia_personalizada';
  const atividadePublica = atividadePersonalizada && Boolean(
    amigoSelecionado?.atividadeAtual?.publicaAmigos && amigoSelecionado.atividadeAtual.compartilhamentoId
  );

  useEffect(() => {
    if (!aberto) {
      setMenuAberto(false);
      setConfirmandoRemocao(false);
      return;
    }

    const aoPressionarTecla = (evento: globalThis.KeyboardEvent) => {
      if (evento.key === 'Escape') onFechar();
    };

    window.addEventListener('keydown', aoPressionarTecla);
    return () => window.removeEventListener('keydown', aoPressionarTecla);
  }, [aberto, onFechar]);

  useEffect(() => {
    const conversa = conversaRef.current;
    if (!conversa || carregandoChat) return;
    conversa.scrollTop = conversa.scrollHeight;
  }, [carregandoChat, mensagens]);

  useEffect(() => {
    setMenuAberto(false);
    setConfirmandoRemocao(false);
  }, [amigoSelecionado?.friendProfileId]);

  return (
    <AnimatePresence>
      {aberto && amigoSelecionado && (
        <motion.aside
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 24 }}
          transition={{ type: 'tween', duration: 0.16 }}
          aria-label={`Conversa com ${amigoSelecionado.nome}`}
          className={cn(
            'fixed bottom-0 z-[70] flex h-[clamp(380px,70vh,600px)] max-h-full',
            'w-[360px] max-w-full flex-col border-x border-t border-white/10',
            'bg-[#101011] shadow-[-18px_0_45px_rgba(0,0,0,0.38)]',
            compacto ? 'right-0' : recuado ? 'right-[72px]' : 'right-[340px]'
          )}
        >
          <header className="relative flex h-14 shrink-0 items-center gap-2.5 border-b border-white/8 px-3">
            <div className="relative grid h-8 w-8 shrink-0 place-items-center text-[10px] font-black text-white/55">
              {amigoSelecionado.avatarUrl ? (
                <img
                  src={amigoSelecionado.avatarUrl}
                  alt={amigoSelecionado.nome}
                  className="h-full w-full object-contain"
                  onError={(evento) => {
                    evento.currentTarget.style.display = 'none';
                  }}
                />
              ) : (
                amigoSelecionado.nome.slice(0, 2).toUpperCase()
              )}
              <span className="absolute -bottom-1 -right-1 grid h-3.5 w-3.5 place-items-center rounded-full bg-[#101011]">
                <IndicadorStatusSocial
                  status={amigoSelecionado.status ?? 'offline'}
                  className="h-2.5 w-2.5"
                />
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-bold text-white/90">{amigoSelecionado.nome}</p>
              <p className="mt-0.5 truncate text-[9px] text-white/35">
                {rotuloStatus(amigoSelecionado.status)}
                {amigoSelecionado.handle ? ` · @${amigoSelecionado.handle}` : ''}
              </p>
            </div>

            <button
              onClick={() => setMenuAberto((abertoAtual) => !abertoAtual)}
              className={cn(
                'grid h-7 w-7 place-items-center text-white/35 transition-colors',
                'hover:bg-white/6 hover:text-white/70'
              )}
              aria-label="Opções da conversa"
            >
              <MoreVertical size={13} />
            </button>
            <button
              onClick={onFechar}
              className={cn(
                'grid h-7 w-7 place-items-center text-white/35 transition-colors',
                'hover:bg-white/6 hover:text-white/70'
              )}
              aria-label="Fechar conversa"
            >
              <X size={12} />
            </button>

            <AnimatePresence>
              {menuAberto && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="absolute right-10 top-11 z-10 w-44 border border-white/12 bg-[#19191a] p-1 shadow-xl"
                >
                  <button
                    onClick={() => {
                      if (!confirmandoRemocao) {
                        setConfirmandoRemocao(true);
                        return;
                      }
                      onRemoverAmigo(amigoSelecionado.friendProfileId);
                      onFechar();
                    }}
                    className={cn(
                      'flex w-full items-center gap-2 px-2.5 py-2 text-left text-[10px] transition-colors',
                      confirmandoRemocao
                        ? 'bg-red-500/10 text-red-200'
                        : 'text-white/55 hover:bg-white/6 hover:text-red-200'
                    )}
                  >
                    <Trash2 size={11} />
                    {confirmandoRemocao ? 'Confirmar remoção' : 'Remover amizade'}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </header>

          {amigoSelecionado.atividadeAtual && amigoSelecionado.atividadeAtual.tipo !== 'launcher' && (
            <div className="flex shrink-0 items-center gap-2 border-b border-white/7 px-3 py-2">
              <ImagemAtividade atividade={amigoSelecionado.atividadeAtual} className="h-7 w-7" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[10px] font-semibold text-white/65">
                  {amigoSelecionado.atividadeAtual.modpackNome ||
                    amigoSelecionado.atividadeAtual.instanciaNome ||
                    'Instância em andamento'}
                </p>
                <p className="mt-0.5 truncate text-[9px] uppercase tracking-wide text-white/25">
                  {amigoSelecionado.atividadeAtual.versaoMinecraft
                    ? `Minecraft ${amigoSelecionado.atividadeAtual.versaoMinecraft}`
                    : 'Minecraft'}
                  {amigoSelecionado.atividadeAtual.loader
                    ? ` · ${amigoSelecionado.atividadeAtual.loader}`
                    : ''}
                </p>
              </div>
              <button
                onClick={() =>
                  void (atividadePersonalizada && !atividadePublica ? onSolicitarSync : onInstalarAtividade)(
                      amigoSelecionado.friendProfileId,
                      amigoSelecionado.atividadeAtual
                    )
                }
                disabled={processandoAtividade}
                className={cn(
                  'px-1.5 py-1 text-[9px] font-bold text-emerald-300/75 transition-colors',
                  'hover:bg-emerald-400/8 hover:text-emerald-200 disabled:opacity-30'
                )}
              >
                {atividadePublica ? 'Baixar' : atividadePersonalizada ? 'Solicitar' : 'Instalar'}
              </button>
            </div>
          )}

          {mensagemSync && (
            <p className="border-b border-emerald-300/10 bg-emerald-300/4 px-3 py-2 text-[9px] text-emerald-100/60">
              {mensagemSync}
            </p>
          )}

          <div
            ref={conversaRef}
            className="flex-1 space-y-1.5 overflow-y-auto bg-[#0d0d0e] px-3 py-4 scrollbar-hide"
          >
            {carregandoChat && (
              <p className="py-8 text-center text-[10px] text-white/25">Carregando conversa...</p>
            )}
            {!carregandoChat && mensagens.length === 0 && (
              <p className="py-8 text-center text-[10px] text-white/25">Nenhuma mensagem ainda.</p>
            )}

            {!carregandoChat &&
              mensagens.map((mensagem) => {
                const ehMinha = mensagem.dePerfilId === perfilIdAtual;
                return (
                  <div
                    key={mensagem.id}
                    className={cn(
                      'w-fit max-w-[78%] px-2.5 py-2 text-[11px] leading-relaxed',
                      ehMinha
                        ? 'ml-auto border border-emerald-300/12 bg-emerald-300/7 text-emerald-50/90'
                        : 'border border-white/7 bg-white/4 text-white/75'
                    )}
                  >
                    <p className="break-words">{mensagem.conteudo}</p>
                    <p className="mt-0.5 text-right text-[8px] text-white/25">
                      {formatarTempoRelativo(mensagem.criadoEm)}
                    </p>
                  </div>
                );
              })}
          </div>

          <div className="shrink-0 border-t border-white/8 bg-[#111112] p-2.5">
            <div className="flex items-center gap-1.5 border border-white/10 bg-black/20 p-1">
              <input
                value={textoChat}
                onChange={(evento) => onAlterarTexto(evento.target.value)}
                onKeyDown={onPressionarEnter}
                placeholder={`Mensagem para ${amigoSelecionado.nome}`}
                maxLength={1000}
                autoFocus
                className={cn(
                  'h-8 min-w-0 flex-1 bg-transparent px-2 text-[11px] text-white outline-none',
                  'placeholder:text-white/20'
                )}
              />
              <button
                onClick={onEnviarMensagem}
                disabled={enviandoChat || !textoChat.trim()}
                className={cn(
                  'grid h-8 w-8 shrink-0 place-items-center transition-colors',
                  enviandoChat || !textoChat.trim()
                    ? 'cursor-not-allowed text-white/15'
                    : 'bg-emerald-400/12 text-emerald-300 hover:bg-emerald-400/20'
                )}
                aria-label="Enviar mensagem"
              >
                <Play size={12} fill="currentColor" />
              </button>
            </div>
            {erroChat && <p className="mt-1.5 px-1 text-[9px] text-red-200/70">{erroChat}</p>}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
