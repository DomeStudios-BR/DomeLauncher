import { Pencil } from '../../iconesPixelados';
import { cn } from '../../lib/utils';
import type { AtividadeSocial, PerfilSocial } from './tiposSocial';
import { ImagemAtividade } from './ImagemAtividade';
import { MenuStatusSocial } from './MenuStatusSocial';
import type { StatusPresenca } from './tiposSocial';

interface PerfilSocialPainelProps {
  sessaoAtiva: boolean;
  perfil: PerfilSocial | null;
  onEntrarMicrosoft: () => void;
  entrandoMicrosoft: boolean;
  onFecharDrawer?: () => void;
  nomeExibicaoAtual: string;
  handleExibicaoAtual: string;
  uuidAvatarMinecraft: string | null;
  emJogo: boolean;
  atividadeAtual: AtividadeSocial | null;
  iconeAtividadeLocal?: string | null;
  carregandoPerfil: boolean;
  editandoPerfil: boolean;
  nomeSocialEditavel: string;
  handleEditavel: string;
  salvandoPerfil: boolean;
  salvandoStatus: boolean;
  statusManual: Exclude<StatusPresenca, 'offline'>;
  aparecerOffline: boolean;
  mensagemPerfil: string | null;
  erroPerfil: string | null;
  onAbrirEdicao: () => void;
  onCancelarEdicao: () => void;
  onSalvarPerfil: () => void;
  onAlterarNome: (valor: string) => void;
  onAlterarHandle: (valor: string) => void;
  onAtualizarStatus: (status: Exclude<StatusPresenca, 'offline'>, invisivel: boolean) => void;
}

function iniciaisNome(nome: string): string {
  const limpo = nome.trim();
  if (!limpo) return '?';
  const partes = limpo.split(/\s+/).slice(0, 2);
  return partes.map((parte) => parte[0]?.toUpperCase() ?? '').join('') || '?';
}

export function PerfilSocialPainel({
  sessaoAtiva,
  perfil,
  onEntrarMicrosoft,
  entrandoMicrosoft,
  onFecharDrawer,
  nomeExibicaoAtual,
  handleExibicaoAtual,
  uuidAvatarMinecraft,
  emJogo,
  atividadeAtual,
  iconeAtividadeLocal,
  carregandoPerfil,
  editandoPerfil,
  nomeSocialEditavel,
  handleEditavel,
  salvandoPerfil,
  salvandoStatus,
  statusManual,
  aparecerOffline,
  mensagemPerfil,
  erroPerfil,
  onAbrirEdicao,
  onCancelarEdicao,
  onSalvarPerfil,
  onAlterarNome,
  onAlterarHandle,
  onAtualizarStatus,
}: PerfilSocialPainelProps) {
  const nomeAtividade = atividadeAtual?.modpackNome || atividadeAtual?.instanciaNome || 'Minecraft';
  const emblemaDestaque = (perfil?.emblemasExibidos ?? perfil?.emblemas)?.[0] ?? null;
  const detalhesAtividade = [
    atividadeAtual?.servidor ? `Servidor ${atividadeAtual.servidor}` : null,
    atividadeAtual?.loader,
    atividadeAtual?.versaoMinecraft,
  ].filter(Boolean).join(' · ');

  return (
    <section className="relative overflow-visible border border-white/10 bg-[#151515] p-3">
      {onFecharDrawer && (
        <div className="mb-2 flex justify-end">
          <button
            onClick={onFecharDrawer}
            className="border border-white/10 bg-white/[0.03] px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-white/45 hover:text-white xl:hidden"
          >
            Fechar
          </button>
        </div>
      )}

      {!sessaoAtiva && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={onEntrarMicrosoft}
            disabled={entrandoMicrosoft}
            className="flex w-full items-center justify-center gap-2.5 rounded-xl border border-white/10 bg-white px-3 py-3 text-[10px] font-black uppercase tracking-[0.08em] text-[#101010] shadow-lg shadow-black/20 transition-colors hover:bg-emerald-300 disabled:cursor-wait disabled:bg-white/70"
          >
            <img
              src="https://upload.wikimedia.org/wikipedia/commons/4/44/Microsoft_logo.svg"
              className="h-4 w-4"
              alt=""
            />
            {entrandoMicrosoft ? 'Autenticando...' : 'Iniciar login'}
          </button>
          <p className="text-[12px] leading-relaxed text-white/55">
            Entre com a Microsoft para ativar seu perfil e os recursos sociais.
          </p>
          {erroPerfil && <p className="text-[11px] text-red-300/90">{erroPerfil}</p>}
          {!erroPerfil && mensagemPerfil && <p className="text-[11px] text-emerald-300/90">{mensagemPerfil}</p>}
        </div>
      )}

      {sessaoAtiva && perfil && (
        <div className="space-y-3">
          <div className="group flex items-center gap-3">
            {perfil.avatarPerfilUrl ? (
              <img
                src={perfil.avatarPerfilUrl}
                alt={nomeExibicaoAtual}
                className="h-12 w-12 border border-white/15 bg-[#0d1013] object-cover shadow-[5px_5px_0_rgba(0,0,0,0.2)]"
              />
            ) : uuidAvatarMinecraft ? (
              <img
                src={`https://mc-heads.net/head/${uuidAvatarMinecraft}/64`}
                alt={nomeExibicaoAtual}
                className="h-12 w-12 object-cover"
              />
            ) : perfil.discordAvatar ? (
              <img
                src={`https://cdn.discordapp.com/avatars/${perfil.discordId}/${perfil.discordAvatar}.png?size=64`}
                alt={nomeExibicaoAtual}
                className="h-12 w-12 border border-white/15 bg-[#0d1013] object-cover shadow-[5px_5px_0_rgba(0,0,0,0.2)]"
              />
            ) : (
              <div className="flex h-12 w-12 items-center justify-center border border-white/15 bg-[#0d1013] text-xs font-black text-white/70 shadow-[5px_5px_0_rgba(0,0,0,0.2)]">
                {iniciaisNome(nomeExibicaoAtual)}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <MenuStatusSocial
                nome={nomeExibicaoAtual}
                statusManual={statusManual}
                aparecerOffline={aparecerOffline}
                salvando={salvandoStatus}
                onAtualizar={onAtualizarStatus}
                emblemaDestaque={emblemaDestaque}
              />
              <p className="mt-1 truncate text-[10px] text-white/40">@{handleExibicaoAtual}</p>
            </div>
            <div className="flex shrink-0 gap-1">
              <button
                onClick={onAbrirEdicao}
                disabled={carregandoPerfil}
                aria-label="Editar perfil social"
                className={cn(
                  'grid h-8 w-8 place-items-center border border-white/10 bg-white/[0.025] transition-colors',
                  carregandoPerfil ? 'cursor-not-allowed text-white/20' : 'text-white/40 hover:border-white/20 hover:text-white/75'
                )}
              >
                <Pencil size={12} />
              </button>
            </div>
          </div>

          {emJogo && atividadeAtual && atividadeAtual.tipo !== 'launcher' && (
            <div className="flex min-w-0 items-center gap-2 text-left">
              <ImagemAtividade
                atividade={atividadeAtual}
                iconeUrlAlternativo={iconeAtividadeLocal}
                className="h-7 w-7"
              />
              <div className="min-w-0">
                <p className="text-[8px] font-black uppercase tracking-[0.16em] text-emerald-400/75">
                  Jogando agora
                </p>
                <p className="truncate text-[11px] font-bold text-white/85">{nomeAtividade}</p>
                {detalhesAtividade && (
                  <p className="truncate text-[9px] text-white/35">{detalhesAtividade}</p>
                )}
              </div>
            </div>
          )}

          {editandoPerfil && (
            <div className="space-y-2 border border-white/10 bg-[#121212] p-2">
              <input
                value={nomeSocialEditavel}
                onChange={(evento) => onAlterarNome(evento.target.value)}
                placeholder="Nome social"
                className="w-full border border-white/15 bg-[#0f0f0f] px-2 py-1.5 text-xs text-white outline-none focus:border-emerald-400/45"
              />
              <input
                value={handleEditavel}
                onChange={(evento) => onAlterarHandle(evento.target.value)}
                placeholder="handle (sem @)"
                className="w-full border border-white/15 bg-[#0f0f0f] px-2 py-1.5 text-xs text-white outline-none focus:border-emerald-400/45"
              />
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={onCancelarEdicao}
                  disabled={salvandoPerfil}
                  className="border border-white/20 bg-[#171717] px-2 py-1.5 text-[11px] font-semibold text-white/80 hover:text-white disabled:cursor-not-allowed disabled:text-white/45"
                >
                  Cancelar
                </button>
                <button
                  onClick={onSalvarPerfil}
                  disabled={salvandoPerfil || carregandoPerfil}
                  className="border border-emerald-400/30 bg-emerald-500/10 px-2 py-1.5 text-[11px] font-semibold text-emerald-200 disabled:cursor-not-allowed disabled:text-emerald-300/45"
                >
                  {salvandoPerfil ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </div>
          )}

          {erroPerfil && <p className="text-[11px] text-red-300/90">{erroPerfil}</p>}
          {!erroPerfil && mensagemPerfil && <p className="text-[11px] text-emerald-300/90">{mensagemPerfil}</p>}
        </div>
      )}
    </section>
  );
}
