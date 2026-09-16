import { CompartilhamentosSociais } from './social/CompartilhamentosSociais';
import { listen } from '@tauri-apps/api/event';
import { RevisaoPacoteSocial, type TransferenciaSocial, type PreviaPacoteSocial } from './social/TransferenciasSociais';
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { io, type Socket } from 'socket.io-client';
import { CONFIGURACAO_SOCIAL } from '../lib/configuracaoSocial';
import {
  EVENTO_INSTANCIAS_ATUALIZADAS,
  EVENTO_INSTALAR_ATIVIDADE_SOCIAL,
  EVENTO_SOLICITAR_TRANSFERENCIA_SOCIAL,
  publicarProgressoTransferenciaSocial,
} from '../lib/eventosTransferenciaSocial';
import { cn } from '../lib/utils';
import { ChevronLeft, User } from '../iconesPixelados';
import { EsqueletoSocial } from './EsqueletoCarregamento';
import { ListaAmigosAgrupada } from './social/ListaAmigosAgrupada';
import { PainelChatSocial } from './social/PainelChatSocial';
import { PerfilSocialPainel } from './social/PerfilSocialPainel';
import { IndicadorStatusSocial } from './social/IndicadorStatusSocial';
import type { PedidoTransferenciaInstancia } from './social/tiposSocial';
import {
  addCreatingInstance,
  completeCreatingInstance,
  errorCreatingInstance,
  getCreatingInstances,
  updateCreatingInstance,
} from '../stores/creatingInstances';

interface ContaMinecraft {
  uuid: string;
  name: string;
  access_token: string;
  expires_at?: number;
}

interface ContaMinecraftSocial {
  uuid: string;
  nome: string;
  vinculadoEm: string;
  ultimoUsoEm?: string | null;
}

type StatusPresenca = 'online' | 'ausente' | 'offline';
type TipoAtividade = 'modpack_exato' | 'instancia_personalizada' | 'launcher';

interface AtividadeSocial {
  tipo: TipoAtividade;
  instanciaId?: string | null;
  instanciaNome?: string | null;
  servidor?: string | null;
  source?: 'modrinth' | 'curseforge' | null;
  projectId?: string | null;
  versionId?: string | null;
  fileId?: string | null;
  modpackNome?: string | null;
  iconeUrl?: string | null;
  versaoMinecraft?: string | null;
  loader?: string | null;
  compartilhamentoId?: string | null;
  publicaAmigos?: boolean;
  atualizadoEm: string;
}

interface EmblemaSocial {
  emblemaId: string;
  nome: string;
  descricao: string;
  imagemUrl: string;
  concedidoEm: string;
}

interface PerfilSocial {
  perfilId: string;
  discordId: string;
  discordUsername: string;
  discordGlobalName?: string | null;
  discordAvatar?: string | null;
  handle: string;
  nomeSocial: string;
  contasMinecraftVinculadas: ContaMinecraftSocial[];
  contaMinecraftPrincipalUuid?: string | null;
  online: boolean;
  status?: StatusPresenca;
  aparecerOffline?: boolean;
  emJogo?: boolean;
  atividadeAtual?: AtividadeSocial | null;
  ultimoSeenEm?: string | null;
  emblemas?: EmblemaSocial[];
  emblemasExibidos?: EmblemaSocial[];
  criadoEm: string;
  atualizadoEm: string;
}

interface SessaoSocial {
  accessToken: string;
  refreshToken: string;
  expiraEm: string;
  perfil: PerfilSocial;
}

interface AmigoSocial {
  amizadeId: string;
  friendProfileId: string;
  nome: string;
  handle?: string | null;
  avatarUrl?: string | null;
  online: boolean;
  status?: StatusPresenca;
  atividadeAtual?: AtividadeSocial | null;
  ultimoSeenEm?: string | null;
  emblemaDestaque?: {
    emblemaId: string;
    nome: string;
    descricao: string;
    imagemUrl: string;
    concedidoEm: string;
  } | null;
}

interface SolicitacaoRecebida {
  id: string;
  dePerfilId: string;
  deHandle?: string | null;
  deNome: string;
  criadoEm: string;
}

interface SolicitacaoEnviada {
  id: string;
  paraPerfilId: string;
  paraHandle?: string | null;
  paraNome: string;
  criadoEm: string;
}

interface RespostaAmigosApi {
  amigos: AmigoSocial[];
  pendentesRecebidas: SolicitacaoRecebida[];
  pendentesEnviadas: SolicitacaoEnviada[];
}

interface PerfilBuscaAmizade {
  perfilId: string;
  nome: string;
  handle: string;
  avatarUrl?: string | null;
  online: boolean;
  status?: StatusPresenca;
}

interface RespostaSolicitacaoAmizade {
  sucesso: boolean;
  id: string;
  destinatarioPerfilId: string;
}

interface MensagemChatApi {
  id: string;
  dePerfilId: string;
  paraPerfilId: string;
  conteudo: string;
  criadoEm: string;
}

interface RespostaChatApi {
  conversaId: string;
  mensagens: MensagemChatApi[];
}

interface RespostaSessaoRefresh {
  accessToken: string;
  expiraEm: string;
}

interface RespostaSalvarPerfilApi {
  sucesso?: boolean;
  perfil?: PerfilSocial;
}

interface RespostaStatusSocialApi {
  sucesso?: boolean;
  perfil?: PerfilSocial;
}

interface ResultadoExportacaoSyncSocial {
  caminhoArquivo: string;
  tamanhoBytes: number;
  previa: PreviaPacoteSocial;
}

interface ResultadoDownloadImportacaoSyncSocial {
  pedidoId: string;
  caminhoArquivo: string;
  instanciaId?: string | null;
  mensagem: string;
}

interface EventoSocketSyncPedido {
  pedidoId?: string;
  solicitantePerfilId?: string;
  instanciaId?: string | null;
  instanciaNome?: string | null;
  expiraEm?: string | null;
}

interface EventoSocketSyncStatus {
  friendProfileId?: string;
  direcao?: "envio" | "recebimento";
  pedidoId?: string;
  status?: string;
  tokenUpload?: string;
  tokenDownload?: string;
  // Propagados pela API para evitar busca no estado local
  instanciaId?: string | null;
  instanciaNome?: string | null;
}

interface DetalhesRecebimentoSocial {
  nome?: string | null;
  versao?: string | null;
  loader?: string | null;
  icone?: string | null;
}

interface AtividadeLocalLauncher {
  emJogo: boolean;
  atividadeAtual: AtividadeSocial | null;
}

interface VersaoModrinth {
  id: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
  files: Array<{
    filename: string;
    url: string;
    primary?: boolean;
  }>;
}

interface LoaderVersionsResponse {
  versions: Array<{ version: string; stable?: boolean }>;
}

interface InstanciaResumo {
  id: string;
  name: string;
}

interface SocialSidebarProps {
  usuarioMinecraft: ContaMinecraft | null;
  iconeAtividadeLocal?: string | null;
  className?: string;
  onFecharDrawer?: () => void;
  onAlterarChatAberto?: (aberto: boolean) => void;
  onAbrirAtividadeAmigo?: (amigo: AmigoSocial) => void;
  onAbrirPerfil?: (perfilId: string) => void;
  recuado?: boolean;
  onAlternarRecuo?: () => void;
}

const CHAVE_SESSAO_SOCIAL = 'dome:social:sessao';
const API_DOME_LAUNCHER_URL = CONFIGURACAO_SOCIAL.apiBaseUrl;
const DISCORD_CLIENT_ID = CONFIGURACAO_SOCIAL.discordClientId;
const DISCORD_REDIRECT_URI = CONFIGURACAO_SOCIAL.discordRedirectUri;
const DISCORD_SCOPES = CONFIGURACAO_SOCIAL.discordScopes;
const INTERVALO_HEARTBEAT_MS = 20_000;
const JANELA_MINIMA_CARREGAMENTO_AMIGOS_MS = 1_500;
const PREFIXO_RECEBIMENTO_SOCIAL = 'recebimento-social:';

type OpcoesCarregamentoAmigos = {
  forcar?: boolean;
};

function chaveNaoLidasSocial(perfilId: string): string {
  return `dome:social:nao-lidas:${perfilId}`;
}

function normalizarHandle(handle: string): string | null {
  const valor = handle.trim().toLowerCase().replace(/^@+/, '');
  if (!valor) return null;
  if (!/^[a-z0-9._]{3,24}$/.test(valor)) return null;
  return valor;
}

function normalizarUuid(uuid: string | null | undefined): string | null {
  if (!uuid) return null;
  const valor = uuid.trim().toLowerCase();
  return valor.length > 0 ? valor : null;
}

function mensagemErro(erro: unknown, padrao: string): string {
  if (typeof erro === "string" && erro.trim()) return erro;
  if (erro instanceof Error && erro.message.trim()) return erro.message;
  return padrao;
}

function pacoteSocialNaoEncontrado(mensagem: string): boolean {
  return /HTTP 404|PACOTE_INDISPONIVEL|ARQUIVO_NAO_ENCONTRADO|não encontrado no bucket/i.test(mensagem);
}

function idCardRecebimentoSocial(pedidoId: string): string {
  return `${PREFIXO_RECEBIMENTO_SOCIAL}${pedidoId}`;
}

function garantirCardRecebimentoSocial(
  pedidoId: string,
  detalhes: DetalhesRecebimentoSocial = {},
): string {
  const id = idCardRecebimentoSocial(pedidoId);
  const existente = getCreatingInstances().find((instancia) => instancia.id === id);
  const nome = detalhes.nome?.trim() || existente?.name || 'Instância compartilhada';

  if (existente) {
    updateCreatingInstance(id, {
      name: nome,
      version: detalhes.versao?.trim() || existente.version,
      type: detalhes.loader?.trim() || existente.type,
      icon: detalhes.icone?.trim() || existente.icon,
    });
    return id;
  }

  addCreatingInstance({
    id,
    name: nome,
    version: detalhes.versao?.trim() || '',
    type: detalhes.loader?.trim() || 'social',
    status: 'installing',
    progress: 0,
    progressoIndeterminado: true,
    message: 'O amigo está preparando o pacote...',
    icon: detalhes.icone?.trim() || '/dome.png',
  });
  return id;
}

function mensagemErroAmigos(erro: unknown): string {
  const mensagem = mensagemErro(erro, 'Nao foi possivel carregar amigos.');
  if (/\b429\b/.test(mensagem)) {
    console.error('[social] rate limit ao carregar amigos', erro);
    return 'Muitas atualizações seguidas. Aguarde alguns segundos e tente novamente.';
  }
  return mensagem;
}

async function lerSessaoLocal(): Promise<SessaoSocial | null> {
  try {
    const sessaoProtegida = await invoke<string | null>('carregar_sessao_social_local');
    if (sessaoProtegida) return JSON.parse(sessaoProtegida) as SessaoSocial;

    const sessaoLegada = localStorage.getItem(CHAVE_SESSAO_SOCIAL);
    if (!sessaoLegada) return null;

    const sessao = JSON.parse(sessaoLegada) as SessaoSocial;
    await invoke('salvar_sessao_social_local', { sessao: sessaoLegada });
    localStorage.removeItem(CHAVE_SESSAO_SOCIAL);
    return sessao;
  } catch {
    return null;
  }
}

function salvarSessaoLocal(sessao: SessaoSocial | null): void {
  localStorage.removeItem(CHAVE_SESSAO_SOCIAL);
  void invoke('salvar_sessao_social_local', {
    sessao: sessao ? JSON.stringify(sessao) : null,
  }).catch((erro) => console.error('[social] falha ao proteger sessão local', erro));
}

function expirada(expiraEm: string): boolean {
  const data = new Date(expiraEm).getTime();
  if (!Number.isFinite(data)) return true;
  return data <= Date.now() + 20_000;
}

function tempoRelativo(data: string | null | undefined): string {
  if (!data) return 'agora';
  const dataBase = new Date(data);
  if (Number.isNaN(dataBase.getTime())) return 'agora';
  const diff = Date.now() - dataBase.getTime();
  const minutos = Math.floor(diff / 60000);
  if (minutos < 1) return 'agora';
  if (minutos < 60) return `ha ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `ha ${horas}h`;
  const dias = Math.floor(horas / 24);
  return dias <= 1 ? 'ha 1 dia' : `ha ${dias} dias`;
}

function rotuloStatus(status?: StatusPresenca): string {
  if (status === 'ausente') return 'Ausente';
  if (status === 'offline') return 'Offline';
  return 'Online';
}

function statusEfetivo(status: StatusPresenca | undefined, online: boolean): StatusPresenca {
  if (status === 'online' || status === 'ausente' || status === 'offline') {
    return status;
  }
  return online ? 'online' : 'offline';
}

function escolherVersaoMinecraftIdeal(gameVersions: string[]): string | null {
  if (gameVersions.length === 0) return null;
  const releases = gameVersions.filter((item) => /^[0-9]+\.[0-9]+(\.[0-9]+)?$/.test(item));
  if (releases.length === 0) return gameVersions[0] || null;
  releases.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  return releases[0] || null;
}

function escolherVersaoLoaderIdeal(
  loader: string,
  versoes: Array<{ version: string; stable?: boolean }>,
  versaoMinecraft: string
): string | null {
  if (versoes.length === 0) return null;
  if (loader === 'forge' || loader === 'neoforge') {
    const compativel = versoes.find(
      (item) =>
        item.version.startsWith(`${versaoMinecraft}-`) || item.version.includes(versaoMinecraft)
    );
    return compativel?.version || versoes[0].version;
  }
  return versoes.find((item) => item.stable !== false)?.version || versoes[0].version;
}

function gerarNomeInstanciaDisponivel(nomeBase: string, nomesExistentes: string[]): string {
  const base = nomeBase.trim() || 'Instancia social';
  const nomes = new Set(nomesExistentes.map((item) => item.toLowerCase()));
  if (!nomes.has(base.toLowerCase())) return base;
  let sufixo = 2;
  while (nomes.has(`${base} ${sufixo}`.toLowerCase())) sufixo += 1;
  return `${base} ${sufixo}`;
}

function gerarIdInstancia(nomeInstancia: string): string {
  return encodeURIComponent(nomeInstancia.toLowerCase().replace(/\s+/g, '_'));
}

export default function SocialSidebar({
  usuarioMinecraft,
  iconeAtividadeLocal,
  className,
  onFecharDrawer,
  onAlterarChatAberto,
  onAbrirAtividadeAmigo,
  onAbrirPerfil,
  recuado = false,
  onAlternarRecuo,
}: SocialSidebarProps) {
  const [sessao, setSessao] = useState<SessaoSocial | null>(null);
  const [perfil, setPerfil] = useState<PerfilSocial | null>(null);
  const [carregandoSessao, setCarregandoSessao] = useState(true);
  const [carregandoPerfil, setCarregandoPerfil] = useState(false);
  const [salvandoPerfil, setSalvandoPerfil] = useState(false);
  const [editandoPerfil, setEditandoPerfil] = useState(false);
  const [erroPerfil, setErroPerfil] = useState<string | null>(null);
  const [mensagemPerfil, setMensagemPerfil] = useState<string | null>(null);
  const [nomeSocialEditavel, setNomeSocialEditavel] = useState('');
  const [handleEditavel, setHandleEditavel] = useState('');
  const [statusManual, setStatusManual] = useState<Exclude<StatusPresenca, 'offline'>>('online');
  const [aparecerOffline, setAparecerOffline] = useState(false);
  const [salvandoStatus, setSalvandoStatus] = useState(false);

  const [amigos, setAmigos] = useState<AmigoSocial[]>([]);
  const [pendentesRecebidas, setPendentesRecebidas] = useState<SolicitacaoRecebida[]>([]);
  const [pendentesEnviadas, setPendentesEnviadas] = useState<SolicitacaoEnviada[]>([]);
  const [carregandoAmigos, setCarregandoAmigos] = useState(false);
  const [erroAmigos, setErroAmigos] = useState<string | null>(null);
  const [filtroAmigos, setFiltroAmigos] = useState('');
  const [perfilEncontrado, setPerfilEncontrado] = useState<PerfilBuscaAmizade | null>(null);
  const [buscandoPerfil, setBuscandoPerfil] = useState(false);
  const [buscaPerfilConcluida, setBuscaPerfilConcluida] = useState(false);
  const [enviandoSolicitacao, setEnviandoSolicitacao] = useState(false);
  const [solicitacaoProcessandoId, setSolicitacaoProcessandoId] = useState<string | null>(null);
  const [mensagemSolicitacao, setMensagemSolicitacao] = useState<string | null>(null);
  const [pedidosTransferencia, setPedidosTransferencia] = useState<PedidoTransferenciaInstancia[]>([]);
  const [transferenciaProcessandoId, setTransferenciaProcessandoId] = useState<string | null>(null);
  const [mensagemTransferencia, setMensagemTransferencia] = useState<string | null>(null);
  const [naoLidasPorAmigo, setNaoLidasPorAmigo] = useState<Record<string, number>>({});

  const [amigoSelecionadoPerfilId, setAmigoSelecionadoPerfilId] = useState<string | null>(null);
  const [chatAberto, setChatAberto] = useState(false);
  const [mensagensChat, setMensagensChat] = useState<MensagemChatApi[]>([]);
  const [textoChat, setTextoChat] = useState('');
  const [carregandoChat, setCarregandoChat] = useState(false);
  const [enviandoChat, setEnviandoChat] = useState(false);
  const [erroChat, setErroChat] = useState<string | null>(null);
  const [atividadeLocal, setAtividadeLocal] = useState<AtividadeLocalLauncher>({
    emJogo: false,
    atividadeAtual: null,
  });
  const [mensagemSync, setMensagemSync] = useState<string | null>(null);
  const [processandoAtividade, setProcessandoAtividade] = useState(false);

  const sessaoRef = useRef<SessaoSocial | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const ultimoTokenSocketRef = useRef<string>('');
  const [operacoesSociais, setOperacoesSociais] = useState<TransferenciaSocial[]>([]);
  const [revisaoEnvio, setRevisaoEnvio] = useState<{ pedidoId: string; previa: PreviaPacoteSocial } | null>(null);
  const referenciasEnvioRef = useRef(new Map<string, PreviaPacoteSocial["arquivos"]>());
  const arquivosEnvioRef = useRef(new Map<string, string[]>());
  const canceladasRef = useRef(new Set<string>());
  const operacoesAtivasRef = useRef(new Set<string>());
  const detalhesRecebimentosRef = useRef(new Map<string, DetalhesRecebimentoSocial>());
  const atualizarOperacao = useCallback((pedido: Partial<TransferenciaSocial> & { pedidoId: string }) => {
    setOperacoesSociais((anteriores) => {
      const existente = anteriores.find((a) => a.pedidoId === pedido.pedidoId);
      return [{ status: 'pendente', ...existente, ...pedido },
        ...anteriores.filter((a) => a.pedidoId !== pedido.pedidoId)].slice(0, 100);
    });
  }, []);
  useEffect(() => {
    const escuta = listen<{ pedidoId: string; etapa: string; bytes: number; total?: number; bytesPorSegundo: number }>(
      'social-transferencia-bytes', ({ payload }) => {
        if (canceladasRef.current.has(payload.pedidoId) || !operacoesAtivasRef.current.has(payload.pedidoId)) return;
        const recebidos = (payload.bytes / 1024 / 1024).toFixed(1);
        const total = payload.total ? ` / ${(payload.total / 1024 / 1024).toFixed(1)} MiB` : ' MiB';
        atualizarOperacao({ pedidoId: payload.pedidoId, status: 'processando',
          mensagem: `${payload.etapa === 'enviando' ? 'Enviando' : 'Recebendo'} ${recebidos}${total} · ${(payload.bytesPorSegundo / 1024 / 1024).toFixed(1)} MiB/s` });

        if (payload.etapa !== 'recebendo') return;
        const idCard = garantirCardRecebimentoSocial(
          payload.pedidoId,
          detalhesRecebimentosRef.current.get(payload.pedidoId),
        );
        const downloadConcluido = payload.total != null && payload.bytes >= payload.total;
        updateCreatingInstance(idCard, {
          status: downloadConcluido ? 'installing' : 'downloading',
          progress: payload.total ? Math.min(100, (payload.bytes / payload.total) * 100) : 0,
          progressoIndeterminado: downloadConcluido || !payload.total,
          message: downloadConcluido
            ? 'Instalando na biblioteca...'
            : `Recebendo ${recebidos}${total} · ${(payload.bytesPorSegundo / 1024 / 1024).toFixed(1)} MiB/s`,
        });
      });
    return () => { void escuta.then((remover) => remover()); };
  }, [atualizarOperacao]);
  const pedidosSyncRecebidosRef = useRef<Map<string, EventoSocketSyncPedido>>(new Map());
  const pedidosSyncEnviadosRef = useRef<Map<string, string>>(new Map());
  const atividadeLocalRef = useRef<AtividadeLocalLauncher>(atividadeLocal);
  const amigosRef = useRef<AmigoSocial[]>(amigos);
  const perfilIdRef = useRef<string | null>(perfil?.perfilId ?? null);
  const amigoSelecionadoPerfilIdRef = useRef<string | null>(amigoSelecionadoPerfilId);
  const chatAbertoRef = useRef<boolean>(chatAberto);
  const requisicaoAmigosAtivaRef = useRef(false);
  const carregarAmigosPendenteRef = useRef(false);
  const ultimoCarregamentoAmigosMsRef = useRef(0);
  const tokenSocialAtualRef = useRef<string | null>(null);
  const temporizadorCargaAmigosRef = useRef<number | null>(null);
  const sequenciaBuscaPerfilRef = useRef(0);

  const nomeExibicaoAtual = useMemo(() => {
    if (editandoPerfil && nomeSocialEditavel.trim()) return nomeSocialEditavel.trim();
    if (perfil?.nomeSocial?.trim()) return perfil.nomeSocial.trim();
    if (perfil?.discordGlobalName?.trim()) return perfil.discordGlobalName.trim();
    if (perfil?.discordUsername?.trim()) return perfil.discordUsername.trim();
    return 'Sem nome';
  }, [editandoPerfil, nomeSocialEditavel, perfil?.discordGlobalName, perfil?.discordUsername, perfil?.nomeSocial]);

  const handleExibicaoAtual = useMemo(() => {
    const origem = editandoPerfil ? handleEditavel : perfil?.handle ?? '';
    return normalizarHandle(origem) ?? 'sem_handle';
  }, [editandoPerfil, handleEditavel, perfil?.handle]);

  const uuidAvatarMinecraft = useMemo(() => {
    if (!perfil) return null;

    const contaAtivaUuid = normalizarUuid(usuarioMinecraft?.uuid);
    if (
      contaAtivaUuid &&
      perfil.contasMinecraftVinculadas.some((conta) => normalizarUuid(conta.uuid) === contaAtivaUuid)
    ) {
      return contaAtivaUuid;
    }

    const contaPrincipalUuid = normalizarUuid(perfil.contaMinecraftPrincipalUuid);
    if (contaPrincipalUuid) {
      return contaPrincipalUuid;
    }

    return normalizarUuid(perfil.contasMinecraftVinculadas[0]?.uuid);
  }, [perfil, usuarioMinecraft?.uuid]);

  const amigoSelecionado = useMemo(
    () => (amigoSelecionadoPerfilId ? amigos.find((a) => a.friendProfileId === amigoSelecionadoPerfilId) ?? null : null),
    [amigoSelecionadoPerfilId, amigos]
  );

  const amigosFiltrados = useMemo(() => {
    const filtro = filtroAmigos.trim().toLowerCase();
    if (!filtro) return amigos;
    return amigos.filter((amigo) => {
      const nome = amigo.nome.toLowerCase();
      const handle = (amigo.handle ?? '').toLowerCase();
      return nome.includes(filtro) || handle.includes(filtro);
    });
  }, [amigos, filtroAmigos]);

  const amigosOnline = useMemo(
    () =>
      amigosFiltrados.filter((amigo) => {
        const status = statusEfetivo(amigo.status, amigo.online);
        return status === 'online' || status === 'ausente';
      }),
    [amigosFiltrados]
  );

  const amigosOffline = useMemo(
    () =>
      amigosFiltrados.filter((amigo) => {
        const status = statusEfetivo(amigo.status, amigo.online);
        return status === 'offline';
      }),
    [amigosFiltrados]
  );

  const chaveStorageNaoLidas = useMemo(
    () => (perfil?.perfilId ? chaveNaoLidasSocial(perfil.perfilId) : null),
    [perfil?.perfilId]
  );

  const atualizarSessao = useCallback((novaSessao: SessaoSocial | null) => {
    sessaoRef.current = novaSessao;
    setSessao(novaSessao);
    setPerfil(novaSessao?.perfil ?? null);
    salvarSessaoLocal(novaSessao);
    if (novaSessao?.perfil) {
      setStatusManual(
        novaSessao.perfil.status === 'ausente' ? 'ausente' : 'online'
      );
      setAparecerOffline(Boolean(novaSessao.perfil.aparecerOffline));
    }
  }, []);

  const persistirPerfilNaSessao = useCallback((perfilAtualizado: PerfilSocial) => {
    const sessaoAtual = sessaoRef.current;
    if (!sessaoAtual) return;

    const sessaoAtualizada = { ...sessaoAtual, perfil: perfilAtualizado };
    sessaoRef.current = sessaoAtualizada;
    salvarSessaoLocal(sessaoAtualizada);
  }, []);

  const obterTokenValido = useCallback(async (): Promise<string | null> => {
    const sessaoAtual = sessaoRef.current;
    if (!sessaoAtual) return null;

    if (!expirada(sessaoAtual.expiraEm)) {
      return sessaoAtual.accessToken;
    }

    try {
      const resposta = await invoke<RespostaSessaoRefresh>('refresh_launcher_social_session', {
        apiBaseUrl: API_DOME_LAUNCHER_URL,
        refreshToken: sessaoAtual.refreshToken,
      });

      const atualizada: SessaoSocial = {
        ...sessaoAtual,
        accessToken: resposta.accessToken,
        expiraEm: resposta.expiraEm,
      };

      atualizarSessao(atualizada);
      return atualizada.accessToken;
    } catch {
      atualizarSessao(null);
      return null;
    }
  }, [atualizarSessao]);

  useEffect(() => {
    const handle = normalizarHandle(filtroAmigos);
    const amigoExato = handle
      ? amigos.some((amigo) => normalizarHandle(amigo.handle ?? '') === handle)
      : false;
    const sequencia = ++sequenciaBuscaPerfilRef.current;

    setPerfilEncontrado(null);
    setBuscaPerfilConcluida(false);

    if (!sessao || !handle || amigoExato) {
      setBuscandoPerfil(false);
      return;
    }

    const temporizador = window.setTimeout(() => {
      setBuscandoPerfil(true);
      void obterTokenValido()
        .then(async (token) => {
          if (!token) return null;
          return invoke<PerfilBuscaAmizade | null>('search_launcher_friend_by_handle', {
            apiBaseUrl: API_DOME_LAUNCHER_URL,
            accessToken: token,
            handle,
          });
        })
        .then((resultado) => {
          if (sequencia !== sequenciaBuscaPerfilRef.current) return;
          setPerfilEncontrado(resultado);
          setBuscaPerfilConcluida(true);
        })
        .catch(() => {
          if (sequencia !== sequenciaBuscaPerfilRef.current) return;
          setPerfilEncontrado(null);
          setBuscaPerfilConcluida(true);
        })
        .finally(() => {
          if (sequencia === sequenciaBuscaPerfilRef.current) setBuscandoPerfil(false);
        });
    }, 450);

    return () => window.clearTimeout(temporizador);
  }, [amigos, filtroAmigos, obterTokenValido, sessao]);

  const carregarPerfilSocial = useCallback(async (token: string) => {
    setCarregandoPerfil(true);
    setErroPerfil(null);
    try {
      const perfilCarregado = await invoke<PerfilSocial>('get_launcher_social_profile', {
        apiBaseUrl: API_DOME_LAUNCHER_URL,
        accessToken: token,
      });
      setPerfil(perfilCarregado);
      setStatusManual(
        perfilCarregado.status === 'ausente' ? 'ausente' : 'online'
      );
      setAparecerOffline(Boolean(perfilCarregado.aparecerOffline));
      setNomeSocialEditavel(perfilCarregado.nomeSocial ?? '');
      setHandleEditavel(perfilCarregado.handle ?? '');

      persistirPerfilNaSessao(perfilCarregado);
    } catch (erro) {
      setErroPerfil(mensagemErro(erro, 'Nao foi possivel carregar perfil social.'));
    } finally {
      setCarregandoPerfil(false);
    }
  }, [persistirPerfilNaSessao]);

  const limparTemporizadorCargaAmigos = useCallback(() => {
    if (temporizadorCargaAmigosRef.current != null) {
      window.clearTimeout(temporizadorCargaAmigosRef.current);
      temporizadorCargaAmigosRef.current = null;
    }
  }, []);

  const carregarAmigos = useCallback(
    async (tokenForcado: string, opcoes?: OpcoesCarregamentoAmigos) => {
      tokenSocialAtualRef.current = tokenForcado;

      if (requisicaoAmigosAtivaRef.current) {
        carregarAmigosPendenteRef.current = true;
        return;
      }

      const diff = Date.now() - ultimoCarregamentoAmigosMsRef.current;
      if (!opcoes?.forcar && diff < JANELA_MINIMA_CARREGAMENTO_AMIGOS_MS) {
        carregarAmigosPendenteRef.current = true;

        if (temporizadorCargaAmigosRef.current == null) {
          const atraso = JANELA_MINIMA_CARREGAMENTO_AMIGOS_MS - diff;
          temporizadorCargaAmigosRef.current = window.setTimeout(() => {
            temporizadorCargaAmigosRef.current = null;
            if (!carregarAmigosPendenteRef.current || !tokenSocialAtualRef.current) return;
            carregarAmigosPendenteRef.current = false;
            void carregarAmigos(tokenSocialAtualRef.current, { forcar: true });
          }, Math.max(0, atraso));
        }

        return;
      }

      limparTemporizadorCargaAmigos();
      requisicaoAmigosAtivaRef.current = true;
      setCarregandoAmigos(true);
      setErroAmigos(null);

      try {
        const dados = await invoke<RespostaAmigosApi>('get_launcher_friends', {
          apiBaseUrl: API_DOME_LAUNCHER_URL,
          accessToken: tokenForcado,
        });

        setAmigos(dados.amigos ?? []);
        setPendentesRecebidas(dados.pendentesRecebidas ?? []);
        setPendentesEnviadas(dados.pendentesEnviadas ?? []);
        setNaoLidasPorAmigo((anterior) => {
          const permitidos = new Set((dados.amigos ?? []).map((item) => item.friendProfileId));
          const proximo: Record<string, number> = {};
          for (const [perfilId, qtd] of Object.entries(anterior)) {
            if (permitidos.has(perfilId) && qtd > 0) {
              proximo[perfilId] = qtd;
            }
          }
          return proximo;
        });
      } catch (erro) {
        setErroAmigos(mensagemErroAmigos(erro));
      } finally {
        requisicaoAmigosAtivaRef.current = false;
        setCarregandoAmigos(false);
        ultimoCarregamentoAmigosMsRef.current = Date.now();

        if (carregarAmigosPendenteRef.current && tokenSocialAtualRef.current) {
          carregarAmigosPendenteRef.current = false;
          void carregarAmigos(tokenSocialAtualRef.current, { forcar: true });
        }
      }
    },
    [limparTemporizadorCargaAmigos]
  );

  const carregarChat = useCallback(async () => {
    const token = await obterTokenValido();
    if (!token || !amigoSelecionadoPerfilIdRef.current) return;

    setCarregandoChat(true);
    setErroChat(null);
    try {
      const dados = await invoke<RespostaChatApi>('get_launcher_chat_messages', {
        apiBaseUrl: API_DOME_LAUNCHER_URL,
        accessToken: token,
        friendProfileId: amigoSelecionadoPerfilIdRef.current,
        limite: 80,
      });

      setMensagensChat(dados.mensagens ?? []);
      setNaoLidasPorAmigo((anterior) => {
        const selecionado = amigoSelecionadoPerfilIdRef.current;
        if (!selecionado) return anterior;
        return { ...anterior, [selecionado]: 0 };
      });
    } catch (erro) {
      setErroChat(mensagemErro(erro, 'Nao foi possivel carregar o chat.'));
    } finally {
      setCarregandoChat(false);
    }
  }, [obterTokenValido]);

  const atualizarStatusSocial = useCallback(async (
    proximoStatus: Exclude<StatusPresenca, 'offline'>,
    invisivel: boolean
  ) => {
    const token = await obterTokenValido();
    if (!token) return;

    setSalvandoStatus(true);
    try {
      const resposta = await invoke<RespostaStatusSocialApi>('set_launcher_social_status', {
        apiBaseUrl: API_DOME_LAUNCHER_URL,
        accessToken: token,
        payload: {
          statusManual: proximoStatus,
          aparecerOffline: invisivel,
        },
      });

      if (resposta.perfil) {
        setPerfil(resposta.perfil);
        setStatusManual(resposta.perfil.status === 'ausente' ? 'ausente' : 'online');
        setAparecerOffline(Boolean(resposta.perfil.aparecerOffline));
      }
    } catch (erro) {
      setMensagemPerfil(mensagemErro(erro, 'Nao foi possivel atualizar status social.'));
    } finally {
      setSalvandoStatus(false);
    }
  }, [obterTokenValido]);

  const fluxoUploadSync = useCallback(async (evento: EventoSocketSyncStatus) => {
    const pedidoId = evento.pedidoId?.trim();
    const tokenUpload = evento.tokenUpload?.trim();
    if (!pedidoId || !tokenUpload || canceladasRef.current.has(pedidoId)) return;

    if (operacoesAtivasRef.current.has(pedidoId)) return;
    const token = await obterTokenValido();
    if (!token) { atualizarOperacao({ pedidoId, status: 'erro', mensagem: 'Entre novamente para enviar.' }); return; }

    // Usa instanciaId direto do evento (propagado pela API) para não depender do estado local
    const instanciaId = evento.instanciaId?.trim()
      ?? pedidosSyncRecebidosRef.current.get(pedidoId)?.instanciaId?.trim();

    if (!instanciaId) {
      const mensagem = 'Não foi possível identificar a instância solicitada.';
      setMensagemSync('Sync sem instanciaId para upload.');
      setMensagemTransferencia(mensagem);
      // Avisa o solicitante para sair do estado "preparando..."
      socketRef.current?.emit('social:sync:falha', { pedidoId, mensagem });
      return;
    }

    try {
      operacoesAtivasRef.current.add(pedidoId);
      atualizarOperacao({ ...evento, pedidoId, status: 'processando', direcao: 'envio' });
      setMensagemTransferencia('Preparando a instância para envio...');
      console.log('[SocialSync] Iniciando exportação da instância para upload...', { instanciaId, pedidoId });
      const pacote = await invoke<ResultadoExportacaoSyncSocial>('export_launcher_social_sync_package', {
        instanceId: instanciaId,
        arquivosConfiguracao: arquivosEnvioRef.current.get(pedidoId) ?? [],
        arquivosReferencia: referenciasEnvioRef.current.get(pedidoId) ?? [],
      });
      if (canceladasRef.current.has(pedidoId)) { await invoke('descartar_pacote_social', { caminhoArquivo: pacote.caminhoArquivo }); return; }
      await invoke('upload_launcher_social_sync_package', {
        apiBaseUrl: API_DOME_LAUNCHER_URL,
        accessToken: token,
        payload: {
          pedidoId,
          tokenUpload,
          caminhoArquivo: pacote.caminhoArquivo,
        },
      });
      console.log('[SocialSync] Upload concluído com sucesso!');
      setMensagemSync('Pacote de sync enviado com sucesso.');
      setMensagemTransferencia('Instância enviada.');
      atualizarOperacao({ pedidoId, status: 'pronto_download', mensagem: 'Aguardando o amigo importar.' });
      pedidosSyncRecebidosRef.current.delete(pedidoId);
    } catch (erro) {
      console.error('[SocialSync] Erro no fluxo de upload:', erro);
      const mensagem = mensagemErro(erro, 'Falha ao enviar a instância.');
      setMensagemSync(mensagem);
      setMensagemTransferencia(mensagem);
      // Notifica o solicitante que a transferência falhou
      socketRef.current?.emit('social:sync:falha', { pedidoId, mensagem });
      atualizarOperacao({ pedidoId, status: canceladasRef.current.has(pedidoId) ? 'cancelado' : 'erro', mensagem });
    } finally { operacoesAtivasRef.current.delete(pedidoId); }
  }, [obterTokenValido, atualizarOperacao]);

  const fluxoDownloadSync = useCallback(async (evento: EventoSocketSyncStatus) => {
    const pedidoId = evento.pedidoId?.trim();
    const tokenDownload = evento.tokenDownload?.trim();
    if (!pedidoId || !tokenDownload || canceladasRef.current.has(pedidoId)) return;
    if (operacoesAtivasRef.current.has(pedidoId)) return;
    operacoesAtivasRef.current.add(pedidoId);

    const friendProfileId = evento.friendProfileId?.trim()
      ?? pedidosSyncEnviadosRef.current.get(pedidoId);
    const detalhes = {
      ...detalhesRecebimentosRef.current.get(pedidoId),
      nome: evento.instanciaNome ?? detalhesRecebimentosRef.current.get(pedidoId)?.nome,
    };
    detalhesRecebimentosRef.current.set(pedidoId, detalhes);
    const idCard = garantirCardRecebimentoSocial(pedidoId, detalhes);
    const token = await obterTokenValido();
    if (!token) {
      atualizarOperacao({ pedidoId, status: 'erro', mensagem: 'Entre novamente para receber a instância.' });
      errorCreatingInstance(idCard, 'Entre novamente para receber a instância.');
      operacoesAtivasRef.current.delete(pedidoId);
      return;
    }

    try {
      setMensagemSync('Recebendo e instalando a instância...');
      atualizarOperacao({ ...evento, pedidoId, status: 'processando', direcao: 'recebimento' });
      updateCreatingInstance(idCard, {
        status: 'downloading',
        progress: 0,
        progressoIndeterminado: true,
        message: 'Conectando para receber a instância...',
      });
      if (friendProfileId) {
        publicarProgressoTransferenciaSocial({
          estado: 'importando',
          mensagem: 'Recebendo e instalando a instância...',
          friendProfileId,
          pedidoId,
          instanciaId: evento.instanciaId,
        });
      }

      const resultado = await invoke<ResultadoDownloadImportacaoSyncSocial>(
        'download_import_launcher_social_sync_package',
        {
          apiBaseUrl: API_DOME_LAUNCHER_URL,
          pedidoId,
          tokenDownload,
        }
      );
      await invoke('gerenciar_transferencias_sociais', {
        apiBaseUrl: API_DOME_LAUNCHER_URL,
        accessToken: token,
        acao: 'confirmar',
        pedidoId,
      });

      setMensagemSync('Instância recebida e instalada na biblioteca.');
      completeCreatingInstance(idCard, 'Instância disponível na biblioteca.');
      atualizarOperacao({
        ...evento,
        pedidoId,
        status: 'concluido',
        instanciaId: resultado.instanciaId,
        mensagem: 'Instância instalada na biblioteca.',
      });
      if (friendProfileId) {
        publicarProgressoTransferenciaSocial({
          estado: 'concluido',
          mensagem: 'Instância instalada na biblioteca.',
          friendProfileId,
          pedidoId,
          instanciaId: resultado.instanciaId,
        });
      }
      pedidosSyncEnviadosRef.current.delete(pedidoId);
      detalhesRecebimentosRef.current.delete(pedidoId);
      window.dispatchEvent(new CustomEvent(EVENTO_INSTANCIAS_ATUALIZADAS, {
        detail: { instanciaId: resultado.instanciaId },
      }));
    } catch (erro) {
      const mensagem = mensagemErro(erro, 'Falha ao receber e instalar a instância.');
      setMensagemSync(mensagem);
      errorCreatingInstance(idCard, mensagem);
      atualizarOperacao({ ...evento, pedidoId, status: 'erro', mensagem });
      if (pacoteSocialNaoEncontrado(mensagem)) {
        await invoke('gerenciar_transferencias_sociais', {
          apiBaseUrl: API_DOME_LAUNCHER_URL,
          accessToken: token,
          acao: 'cancelar',
          pedidoId,
        }).catch(() => undefined);
        pedidosSyncEnviadosRef.current.delete(pedidoId);
        detalhesRecebimentosRef.current.delete(pedidoId);
      }
      if (friendProfileId) {
        publicarProgressoTransferenciaSocial({ estado: 'erro', mensagem, friendProfileId, pedidoId });
      }
    } finally {
      operacoesAtivasRef.current.delete(pedidoId);
    }
  }, [atualizarOperacao, obterTokenValido]);

  const conectarSocketRealtime = useCallback(async () => {
    const token = await obterTokenValido();
    if (!token) return;

    if (ultimoTokenSocketRef.current === token && socketRef.current?.connected) {
      return;
    }

    socketRef.current?.disconnect();
    const socket = io(API_DOME_LAUNCHER_URL, {
      auth: { accessToken: token },
      transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => {
      ultimoTokenSocketRef.current = token;
      socket.emit('social:presenca:heartbeat', atividadeLocalRef.current);
      void invoke<{ pedidos: TransferenciaSocial[] }>('gerenciar_transferencias_sociais', {
        apiBaseUrl: API_DOME_LAUNCHER_URL, accessToken: token, acao: 'listar',
      }).then(({ pedidos }) => {
        for (const pedido of pedidos) {
          if (pedido.direcao === 'recebimento' && pedido.friendProfileId) {
            pedidosSyncEnviadosRef.current.set(pedido.pedidoId, pedido.friendProfileId);
            detalhesRecebimentosRef.current.set(pedido.pedidoId, { nome: pedido.instanciaNome });
            if (pedido.status === 'aguardando_upload') {
              garantirCardRecebimentoSocial(pedido.pedidoId, { nome: pedido.instanciaNome });
            }
          }
          if (pedido.direcao === 'envio' && pedido.status === 'pendente') {
            pedidosSyncRecebidosRef.current.set(pedido.pedidoId, {
              pedidoId: pedido.pedidoId,
              solicitantePerfilId: pedido.friendProfileId,
              instanciaId: pedido.instanciaId,
              instanciaNome: pedido.instanciaNome,
              expiraEm: pedido.expiraEm,
            });
            setPedidosTransferencia((anteriores) => anteriores.some((item) => item.id === pedido.pedidoId)
              ? anteriores
              : [{
                  id: pedido.pedidoId,
                  solicitantePerfilId: pedido.friendProfileId ?? '',
                  instanciaId: pedido.instanciaId,
                  instanciaNome: pedido.instanciaNome,
                  expiraEm: pedido.expiraEm,
                }, ...anteriores]);
          }
          atualizarOperacao(pedido);
          if (pedido.status === 'aguardando_upload' && pedido.tokenUpload)
            atualizarOperacao({ ...pedido, status: 'erro', mensagem: 'Envio interrompido. Revise e tente novamente.' });
          if (pedido.status === 'pronto_download' && pedido.tokenDownload)
            void fluxoDownloadSync(pedido);
        }
      }).catch((erro) => setMensagemTransferencia(mensagemErro(erro, 'Falha ao recuperar transferências.')));

    });

    socket.on('social:amigos:atualizar', async () => {
      const tokenAtual = await obterTokenValido();
      if (!tokenAtual) return;
      await carregarAmigos(tokenAtual);
    });

    socket.on('social:chat:nova', (evento: { mensagem?: MensagemChatApi }) => {
      const mensagem = evento?.mensagem;
      if (!mensagem) return;

      const meuPerfilId = perfilIdRef.current;
      const outroPerfilId = meuPerfilId === mensagem.dePerfilId ? mensagem.paraPerfilId : mensagem.dePerfilId;

      setMensagensChat((anterior) => {
        if (anterior.some((item) => item.id === mensagem.id)) return anterior;
        const selecionadoAtual = amigoSelecionadoPerfilIdRef.current;
        const chatAbertoAtual = chatAbertoRef.current;
        if (!chatAbertoAtual || !selecionadoAtual || outroPerfilId !== selecionadoAtual) return anterior;
        return [...anterior, mensagem];
      });

      const selecionadoAtual = amigoSelecionadoPerfilIdRef.current;
      const chatAbertoAtual = chatAbertoRef.current;
      if (!chatAbertoAtual || !selecionadoAtual || outroPerfilId !== selecionadoAtual) {
        setNaoLidasPorAmigo((anterior) => ({
          ...anterior,
          [outroPerfilId]: (anterior[outroPerfilId] ?? 0) + 1,
        }));
      }
    });

    socket.on('social:compartilhamentos:atualizar', () => window.dispatchEvent(new Event('dome:compartilhamentos-atualizar')));

    socket.on('social:sync:pedido', (evento: EventoSocketSyncPedido) => {
      const pedidoId = evento.pedidoId?.trim();
      if (!pedidoId) return;
      pedidosSyncRecebidosRef.current.set(pedidoId, evento);
      setPedidosTransferencia((anteriores) => {
        if (anteriores.some((pedido) => pedido.id === pedidoId)) return anteriores;
        return [
          {
            id: pedidoId,
            solicitantePerfilId: evento.solicitantePerfilId?.trim() ?? '',
            instanciaId: evento.instanciaId ?? null,
            instanciaNome: evento.instanciaNome ?? null,
            expiraEm: evento.expiraEm ?? null,
          },
          ...anteriores,
        ];
      });
    });

    socket.on('social:sync:status', async (evento: EventoSocketSyncStatus) => {
      const id = evento.pedidoId?.trim();
      if (!id) return;
      atualizarOperacao({ ...evento, pedidoId: id, mensagem: undefined });
      if (['recusado', 'cancelado', 'expirado'].includes(evento.status ?? '')) {
        canceladasRef.current.add(id);
        void invoke('cancelar_transferencia_social_local', { pedidoId: id });
        const friendProfileId = evento.friendProfileId ?? pedidosSyncEnviadosRef.current.get(id);
        const mensagem = `Transferência ${evento.status === 'recusado' ? 'recusada' : evento.status === 'cancelado' ? 'cancelada' : 'expirada'}.`;
        const idCard = idCardRecebimentoSocial(id);
        if (getCreatingInstances().some((instancia) => instancia.id === idCard)) {
          errorCreatingInstance(idCard, mensagem);
        }
        if (friendProfileId) publicarProgressoTransferenciaSocial({ estado: 'erro', mensagem, friendProfileId, pedidoId: id });
        pedidosSyncEnviadosRef.current.delete(id);
        detalhesRecebimentosRef.current.delete(id);
        setPedidosTransferencia((anteriores) => anteriores.filter((a) => a.id !== id));
        return;
      }

      if (evento.status === 'aguardando_upload') {
        if (evento.tokenUpload) {
          await fluxoUploadSync(evento);
          return;
        }

        const pedidoId = evento.pedidoId?.trim();
        const friendProfileId = pedidoId ? pedidosSyncEnviadosRef.current.get(pedidoId) : null;
        if (pedidoId && friendProfileId) {
          const detalhes = detalhesRecebimentosRef.current.get(pedidoId);
          const idCard = garantirCardRecebimentoSocial(pedidoId, detalhes);
          updateCreatingInstance(idCard, {
            status: 'installing',
            progress: 0,
            progressoIndeterminado: true,
            message: 'O amigo está preparando o pacote...',
          });
          setMensagemSync('Solicitação aceita. O pacote está sendo preparado...');
          publicarProgressoTransferenciaSocial({
            estado: 'preparando',
            mensagem: 'Solicitação aceita. O pacote está sendo preparado...',
            friendProfileId,
            pedidoId,
          });
        }
        return;
      }
      if (evento.status === 'pronto_download' && evento.tokenDownload) {
        await fluxoDownloadSync({
          ...evento,
          pedidoId: id,
          friendProfileId: evento.friendProfileId ?? pedidosSyncEnviadosRef.current.get(id),
        });
      }
    });

    // Listener para quando o amigo falhar no upload — tira o solicitante do estado "preparando..."
    socket.on('social:sync:falha', (evento: { pedidoId?: string; mensagem?: string }) => {
      const pedidoId = evento.pedidoId?.trim();
      const friendProfileId = pedidoId ? pedidosSyncEnviadosRef.current.get(pedidoId) : null;
      if (!pedidoId || !friendProfileId) return;

      const mensagem = evento.mensagem?.trim() || 'Falha ao transferir instância.';
      setMensagemSync(mensagem);
      const idCard = idCardRecebimentoSocial(pedidoId);
      if (getCreatingInstances().some((instancia) => instancia.id === idCard)) {
        errorCreatingInstance(idCard, mensagem);
      }
      publicarProgressoTransferenciaSocial({ estado: 'erro', mensagem, friendProfileId, pedidoId });
      pedidosSyncEnviadosRef.current.delete(pedidoId);
    });

    socketRef.current = socket;
  }, [carregarAmigos, fluxoDownloadSync, fluxoUploadSync, obterTokenValido, atualizarOperacao]);

  const abrirChatComAmigo = useCallback((friendProfileId: string) => {
    setAmigoSelecionadoPerfilId(friendProfileId);
    setChatAberto(true);
    setErroChat(null);
    setMensagemSync(null);
  }, []);

  useEffect(() => {
    const aoAbrirChatExterno = (evento: Event) => {
      const perfilId = (evento as CustomEvent<{ friendProfileId?: string }>).detail?.friendProfileId;
      if (!perfilId) return;
      abrirChatComAmigo(perfilId);
    };
    window.addEventListener("dome:social-abrir-chat", aoAbrirChatExterno);
    return () => window.removeEventListener("dome:social-abrir-chat", aoAbrirChatExterno);
  }, [abrirChatComAmigo]);

  useEffect(() => {
    const aoPerfilAtualizado = (evento: Event) => {
      const perfilAtualizado = (evento as CustomEvent<{ perfil?: PerfilSocial }>).detail?.perfil;
      if (!perfilAtualizado) return;
      setPerfil(perfilAtualizado);
      persistirPerfilNaSessao(perfilAtualizado);
    };
    window.addEventListener("dome:social-perfil-atualizado", aoPerfilAtualizado);
    return () => window.removeEventListener("dome:social-perfil-atualizado", aoPerfilAtualizado);
  }, [persistirPerfilNaSessao]);

  useEffect(() => {
    atividadeLocalRef.current = atividadeLocal;
  }, [atividadeLocal]);

  useEffect(() => {
    amigosRef.current = amigos;
  }, [amigos]);

  useEffect(() => {
    if (pedidosTransferencia.length === 0) return;

    const removerExpirados = () => {
      const agora = Date.now();
      setPedidosTransferencia((anteriores) => anteriores.filter((pedido) => {
        if (!pedido.expiraEm) return true;
        const expirado = new Date(pedido.expiraEm).getTime() <= agora;
        if (expirado) pedidosSyncRecebidosRef.current.delete(pedido.id);
        return !expirado;
      }));
    };

    const intervalo = window.setInterval(removerExpirados, 5_000);
    return () => window.clearInterval(intervalo);
  }, [pedidosTransferencia.length]);

  useEffect(() => {
    perfilIdRef.current = perfil?.perfilId ?? null;
  }, [perfil?.perfilId]);

  useEffect(() => {
    amigoSelecionadoPerfilIdRef.current = amigoSelecionadoPerfilId;
  }, [amigoSelecionadoPerfilId]);

  useEffect(() => {
    chatAbertoRef.current = chatAberto;
    onAlterarChatAberto?.(chatAberto);
  }, [chatAberto, onAlterarChatAberto]);

  useEffect(() => {
    let ativo = true;
    void lerSessaoLocal().then((sessaoLocal) => {
      if (!ativo) return;
      atualizarSessao(sessaoLocal);
      setCarregandoSessao(false);
    });

    return () => {
      ativo = false;
    };
  }, [atualizarSessao]);

  useEffect(() => {
    if (!chaveStorageNaoLidas) {
      setNaoLidasPorAmigo({});
      return;
    }

    try {
      const bruto = localStorage.getItem(chaveStorageNaoLidas);
      if (!bruto) {
        setNaoLidasPorAmigo({});
        return;
      }

      const json = JSON.parse(bruto) as Record<string, unknown>;
      const normalizado: Record<string, number> = {};
      for (const [perfilId, valor] of Object.entries(json)) {
        const qtd = Number(valor);
        if (Number.isFinite(qtd) && qtd > 0) {
          normalizado[perfilId] = Math.floor(qtd);
        }
      }
      setNaoLidasPorAmigo(normalizado);
    } catch {
      setNaoLidasPorAmigo({});
    }
  }, [chaveStorageNaoLidas]);

  useEffect(() => {
    if (!chaveStorageNaoLidas) return;
    localStorage.setItem(chaveStorageNaoLidas, JSON.stringify(naoLidasPorAmigo));
  }, [chaveStorageNaoLidas, naoLidasPorAmigo]);

  useEffect(() => {
    const aoAtualizarAtividade = (evento: Event) => {
      const detalhe = (evento as CustomEvent<AtividadeLocalLauncher>).detail;
      if (!detalhe) return;
      setAtividadeLocal({
        emJogo: Boolean(detalhe.emJogo),
        atividadeAtual: detalhe.atividadeAtual ?? null,
      });
    };

    window.addEventListener('dome:social-atividade-atualizada', aoAtualizarAtividade);
    return () => {
      window.removeEventListener('dome:social-atividade-atualizada', aoAtualizarAtividade);
    };
  }, []);

  useEffect(() => {
    if (!sessao) return;

    let ativo = true;

    const carregar = async () => {
      let token = sessao.accessToken;

      if (expirada(sessao.expiraEm)) {
        try {
          const resposta = await invoke<RespostaSessaoRefresh>('refresh_launcher_social_session', {
            apiBaseUrl: API_DOME_LAUNCHER_URL,
            refreshToken: sessao.refreshToken,
          });

          const atualizada: SessaoSocial = {
            ...sessao,
            accessToken: resposta.accessToken,
            expiraEm: resposta.expiraEm,
          };

          atualizarSessao(atualizada);
          token = atualizada.accessToken;
        } catch {
          atualizarSessao(null);
          return;
        }
      }

      if (!ativo || !token) return;
      await Promise.all([carregarPerfilSocial(token), carregarAmigos(token, { forcar: true })]);
      await conectarSocketRealtime();
    };

    void carregar();
    return () => {
      ativo = false;
    };
  }, [atualizarSessao, carregarAmigos, carregarPerfilSocial, conectarSocketRealtime, sessao?.accessToken, sessao?.expiraEm, sessao?.refreshToken]);

  useEffect(() => {
    if (!sessao) return;
    void conectarSocketRealtime();
  }, [conectarSocketRealtime, sessao?.accessToken, sessao?.refreshToken]);

  useEffect(() => {
    if (!amigos.length) {
      setAmigoSelecionadoPerfilId(null);
      setChatAberto(false);
      return;
    }

    if (!amigoSelecionadoPerfilId || !amigos.some((a) => a.friendProfileId === amigoSelecionadoPerfilId)) {
      setAmigoSelecionadoPerfilId(amigos[0].friendProfileId);
    }
  }, [amigoSelecionadoPerfilId, amigos]);

  useEffect(() => {
    if (!chatAberto || !amigoSelecionadoPerfilId) return;
    void carregarChat();
  }, [amigoSelecionadoPerfilId, carregarChat, chatAberto]);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket?.connected) return;

    socket.emit('social:presenca:heartbeat', atividadeLocal);
  }, [atividadeLocal]);

  useEffect(() => {
    if (!sessao) return;
    const intervalo = window.setInterval(() => {
      const socket = socketRef.current;
      if (!socket?.connected) return;
      socket.emit('social:presenca:heartbeat', atividadeLocalRef.current);

    }, INTERVALO_HEARTBEAT_MS);

    return () => {
      window.clearInterval(intervalo);
    };
  }, [sessao?.perfil?.perfilId]);

  useEffect(() => {
    if (!chatAberto || !amigoSelecionadoPerfilId) return;
    setNaoLidasPorAmigo((anterior) => ({ ...anterior, [amigoSelecionadoPerfilId]: 0 }));
  }, [amigoSelecionadoPerfilId, chatAberto]);

  useEffect(() => {
    return () => {
      limparTemporizadorCargaAmigos();
      socketRef.current?.disconnect();
      socketRef.current = null;
      ultimoTokenSocketRef.current = '';
    };
  }, [limparTemporizadorCargaAmigos]);

  useEffect(() => {
    if (!sessao || !perfil || !usuarioMinecraft) return;

    const uuidAtual = normalizarUuid(usuarioMinecraft.uuid);
    if (!uuidAtual) return;

    const jaVinculada = perfil.contasMinecraftVinculadas.some((conta) => normalizarUuid(conta.uuid) === uuidAtual);

    let ativo = true;

    const sincronizarContaPrincipal = async (token: string) => {
      if (normalizarUuid(perfil.contaMinecraftPrincipalUuid) === uuidAtual) return;

      try {
        const dados = await invoke<RespostaSalvarPerfilApi>('save_launcher_social_profile', {
          apiBaseUrl: API_DOME_LAUNCHER_URL,
          accessToken: token,
          payload: {
            contaMinecraftPrincipalUuid: uuidAtual,
          },
        });

        if (!ativo || !dados?.perfil) return;
        setPerfil(dados.perfil);
        persistirPerfilNaSessao(dados.perfil);
      } catch {
        // Falha silenciosa para nao atrapalhar o social.
      }
    };

    const sincronizarVinculoDaContaAtiva = async () => {
      const token = await obterTokenValido();
      if (!token || !ativo) return;

      if (jaVinculada) {
        await sincronizarContaPrincipal(token);
        return;
      }

      try {
        const dados = await invoke<RespostaSalvarPerfilApi>('link_launcher_minecraft_account', {
          apiBaseUrl: API_DOME_LAUNCHER_URL,
          accessToken: token,
          payload: {
            uuid: usuarioMinecraft.uuid,
            nome: usuarioMinecraft.name,
            minecraftAccessToken: usuarioMinecraft.access_token,
          },
        });

        if (!ativo || !dados?.perfil) return;
        setPerfil(dados.perfil);
        persistirPerfilNaSessao(dados.perfil);
      } catch {
        // Vinculo automatico silencioso para nao poluir a UI.
      }
    };

    sincronizarVinculoDaContaAtiva();

    return () => {
      ativo = false;
    };
  }, [obterTokenValido, perfil, persistirPerfilNaSessao, sessao, usuarioMinecraft]);

  const iniciarLoginDiscord = async () => {
    setMensagemPerfil(null);
    setErroPerfil(null);

    if (!API_DOME_LAUNCHER_URL || !DISCORD_CLIENT_ID || !DISCORD_REDIRECT_URI) {
      setErroPerfil('Não foi possível iniciar login social. Verifique sua conexão e tente novamente.');
      return;
    }

    try {
      const novaSessao = await invoke<SessaoSocial>('login_discord_social', {
        apiBaseUrl: API_DOME_LAUNCHER_URL,
        clientId: DISCORD_CLIENT_ID,
        redirectUri: DISCORD_REDIRECT_URI,
        scope: DISCORD_SCOPES,
      });

      atualizarSessao(novaSessao);
      setNomeSocialEditavel(novaSessao.perfil.nomeSocial ?? '');
      setHandleEditavel(novaSessao.perfil.handle ?? '');
      await Promise.all([
        carregarPerfilSocial(novaSessao.accessToken),
        carregarAmigos(novaSessao.accessToken, { forcar: true }),
      ]);
      await conectarSocketRealtime();
    } catch (erro) {
      setErroPerfil(mensagemErro(erro, 'Nao foi possivel autenticar com Discord.'));
    }
  };

  const salvarPerfilSocial = async () => {
    const token = await obterTokenValido();
    if (!token) return;

    const handleNormalizado = normalizarHandle(handleEditavel);
    if (handleEditavel.trim() && !handleNormalizado) {
      setErroPerfil('Handle invalido. Use 3-24 caracteres: letras, numeros, ponto e _.');
      return;
    }

    setSalvandoPerfil(true);
    setErroPerfil(null);
    setMensagemPerfil(null);

    try {
      const dados = await invoke<RespostaSalvarPerfilApi>('save_launcher_social_profile', {
        apiBaseUrl: API_DOME_LAUNCHER_URL,
        accessToken: token,
        payload: {
          nomeSocial: nomeSocialEditavel.trim() || undefined,
          handle: handleNormalizado ?? undefined,
          contaMinecraftPrincipalUuid: perfil?.contaMinecraftPrincipalUuid ?? undefined,
        },
      });

      if (dados?.perfil) {
        setPerfil(dados.perfil);
        setNomeSocialEditavel(dados.perfil.nomeSocial ?? '');
        setHandleEditavel(dados.perfil.handle ?? '');
        persistirPerfilNaSessao(dados.perfil);
      }

      setMensagemPerfil('Perfil social atualizado.');
      setEditandoPerfil(false);
    } catch (erro) {
      const msg = mensagemErro(erro, 'Nao foi possivel salvar o perfil social.');
      setErroPerfil(msg.toLowerCase().includes('handle ja esta em uso') ? 'Handle ja esta em uso. Escolha outro.' : msg);
    } finally {
      setSalvandoPerfil(false);
    }
  };

  const enviarSolicitacaoPorHandle = async () => {
    const token = await obterTokenValido();
    if (!token) return;

    const handleNormalizado = normalizarHandle(perfilEncontrado?.handle ?? filtroAmigos);
    if (!handleNormalizado) {
      setMensagemSolicitacao('Handle inválido. Use entre 3 e 24 caracteres.');
      return;
    }

    setEnviandoSolicitacao(true);
    setMensagemSolicitacao(null);

    try {
      const resposta = await invoke<RespostaSolicitacaoAmizade>('send_launcher_friend_request_by_handle', {
        apiBaseUrl: API_DOME_LAUNCHER_URL,
        accessToken: token,
        payload: { handle: handleNormalizado },
      });

      setPendentesEnviadas((anteriores) => {
        if (anteriores.some((pendente) => pendente.paraPerfilId === resposta.destinatarioPerfilId)) {
          return anteriores;
        }

        return [
          {
            id: resposta.id,
            paraPerfilId: resposta.destinatarioPerfilId,
            paraHandle: perfilEncontrado?.handle ?? handleNormalizado,
            paraNome: perfilEncontrado?.nome ?? handleNormalizado,
            criadoEm: new Date().toISOString(),
          },
          ...anteriores,
        ];
      });
      setMensagemSolicitacao('Solicitação enviada.');
      await carregarAmigos(token, { forcar: true });
    } catch (erro) {
      setMensagemSolicitacao(mensagemErro(erro, 'Falha ao enviar solicitação.'));
    } finally {
      setEnviandoSolicitacao(false);
    }
  };

  const responderSolicitacao = async (requestId: string, acao: 'accept' | 'reject') => {
    const token = await obterTokenValido();
    if (!token) return;

    setSolicitacaoProcessandoId(requestId);
    setMensagemSolicitacao(null);
    try {
      await invoke('respond_launcher_friend_request', {
        apiBaseUrl: API_DOME_LAUNCHER_URL,
        accessToken: token,
        requestId,
        acao,
      });

      await carregarAmigos(token, { forcar: true });
      setMensagemSolicitacao(acao === 'accept' ? 'Solicitação aceita.' : 'Solicitação recusada.');
    } catch (erro) {
      setMensagemSolicitacao(mensagemErro(erro, 'Falha ao responder solicitação.'));
    } finally {
      setSolicitacaoProcessandoId(null);
    }
  };

  const responderTransferencia = useCallback((pedidoId: string, aceitar: boolean) => {
    const socket = socketRef.current;
    setMensagemTransferencia(null);

    if (!socket?.connected) {
      setMensagemTransferencia('Conexão social indisponível para responder.');
      return;
    }

    setTransferenciaProcessandoId(pedidoId);
    socket.timeout(15000).emit(
      'social:sync:responder',
      { pedidoId, aceitar },
      (erroAck: Error | null, resposta: { sucesso?: boolean; erro?: string }) => {
        setTransferenciaProcessandoId(null);

        if (erroAck || !resposta?.sucesso) {
          setMensagemTransferencia(resposta?.erro || 'Falha ao responder transferência.');
          return;
        }

        setPedidosTransferencia((anteriores) =>
          anteriores.filter((pedido) => pedido.id !== pedidoId)
        );

        if (!aceitar) {
          pedidosSyncRecebidosRef.current.delete(pedidoId);
          setMensagemTransferencia(null);
          return;
        }

        setMensagemTransferencia('Preparando a instância para envio...');
      }
    );
  }, []);

  const revisarEnvio = async (pedidoId: string) => {
    const pedido = pedidosSyncRecebidosRef.current.get(pedidoId)
      ?? operacoesSociais.find((p) => p.pedidoId === pedidoId);
    if (!pedido?.instanciaId) { setMensagemTransferencia('Instância solicitada indisponível.'); return; }
    setTransferenciaProcessandoId(pedidoId);
    setMensagemTransferencia(null);
    try {
      const previa = await invoke<PreviaPacoteSocial>('obter_previa_pacote_social', { instanceId: pedido.instanciaId });
      setRevisaoEnvio({ pedidoId, previa });
    } catch (erro) {
      setMensagemTransferencia(mensagemErro(erro, 'Falha ao revisar pacote.'));
    } finally {
      setTransferenciaProcessandoId(null);
    }
  };
  const removerAmigo = async (friendProfileId: string) => {
    const token = await obterTokenValido();
    if (!token) return;

    try {
      await invoke('remove_launcher_friend', {
        apiBaseUrl: API_DOME_LAUNCHER_URL,
        accessToken: token,
        friendProfileId,
      });
      await carregarAmigos(token, { forcar: true });
    } catch (erro) {
      setErroAmigos(mensagemErro(erro, 'Nao foi possivel remover amizade.'));
    }
  };

  const solicitarSyncInstancia = useCallback(async (
    friendProfileId: string,
    atividade?: AtividadeSocial | null
  ) => {
    setMensagemSync(null);
    publicarProgressoTransferenciaSocial({
      estado: 'solicitando',
      mensagem: 'Enviando solicitação de transferência...',
      friendProfileId,
    });
    const socket = socketRef.current;
    if (!socket?.connected) {
      const mensagem = 'Conexão social indisponível para solicitar a transferência.';
      setMensagemSync(mensagem);
      publicarProgressoTransferenciaSocial({ estado: 'erro', mensagem, friendProfileId });
      return;
    }

    await new Promise<void>((resolve) => {
      socket.timeout(15000).emit(
        'social:sync:solicitar',
        {
          alvoPerfilId: friendProfileId,
          instanciaId: atividade?.instanciaId ?? null,
          instanciaNome: atividade?.instanciaNome ?? null,
        },
        (erroAck: Error | null, resposta: { sucesso?: boolean; pedidoId?: string; erro?: string }) => {
          if (erroAck || !resposta?.sucesso) {
            const mensagem = resposta?.erro || 'Falha ao solicitar transferência.';
            setMensagemSync(mensagem);
            publicarProgressoTransferenciaSocial({ estado: 'erro', mensagem, friendProfileId });
          } else {
            const pedidoId = resposta.pedidoId?.trim();
            if (pedidoId) {
              pedidosSyncEnviadosRef.current.set(pedidoId, friendProfileId);
              detalhesRecebimentosRef.current.set(pedidoId, {
                nome: atividade?.instanciaNome,
                versao: atividade?.versaoMinecraft,
                loader: atividade?.loader,
                icone: atividade?.iconeUrl,
              });
              atualizarOperacao({
                pedidoId,
                friendProfileId,
                status: 'pendente',
                direcao: 'recebimento',
                instanciaNome: atividade?.instanciaNome,
              });
            }
            const mensagem = 'Aguardando o amigo aceitar a transferência...';
            setMensagemSync(mensagem);
            publicarProgressoTransferenciaSocial({
              estado: 'aguardando',
              mensagem,
              friendProfileId,
              pedidoId,
            });
          }
          resolve();
        }
      );
    });
  }, []);

  useEffect(() => {
    const aoSolicitarSync = (evento: Event) => {
      const detalhe = (evento as CustomEvent<{
        friendProfileId?: string;
        atividade?: AtividadeSocial | null;
      }>).detail;

      if (!detalhe?.friendProfileId) return;
      void solicitarSyncInstancia(detalhe.friendProfileId, detalhe.atividade ?? null);
    };

    window.addEventListener(EVENTO_SOLICITAR_TRANSFERENCIA_SOCIAL, aoSolicitarSync);
    return () => window.removeEventListener(EVENTO_SOLICITAR_TRANSFERENCIA_SOCIAL, aoSolicitarSync);
  }, [solicitarSyncInstancia]);

  const instalarMesmaInstanciaPorAtividade = async (
    friendProfileId: string,
    atividade?: AtividadeSocial | null
  ) => {
    setMensagemSync(null);
    if (!atividade) {
      setMensagemSync('Sem atividade valida para instalar.');
      return;
    }

    if (atividade.tipo === 'instancia_personalizada'
      && atividade.publicaAmigos
      && atividade.compartilhamentoId) {
      try {
        setMensagemSync('Baixando instância pública do amigo...');
        publicarProgressoTransferenciaSocial({
          estado: 'importando',
          mensagem: 'Baixando e preparando a instância pública...',
          friendProfileId,
          instanciaId: atividade.instanciaId,
        });
        const token = await obterTokenValido();
        if (!token) throw new Error('Entre novamente para baixar a instância.');
        const pedido = await invoke<TransferenciaSocial & {
          versao: number;
          previa: PreviaPacoteSocial;
        }>('gerenciar_compartilhamentos_sociais', {
          apiBaseUrl: API_DOME_LAUNCHER_URL,
          accessToken: token,
          acao: 'receber_publica',
          dados: { id: atividade.compartilhamentoId },
        });
        await invoke('download_import_launcher_social_sync_package', {
          apiBaseUrl: API_DOME_LAUNCHER_URL,
          pedidoId: pedido.pedidoId,
          tokenDownload: pedido.tokenDownload,
          vinculo: {
            apiBaseUrl: API_DOME_LAUNCHER_URL,
            compartilhamentoId: atividade.compartilhamentoId,
            versao: pedido.versao,
            arquivos: pedido.previa.arquivos,
            substituirAlteracoesLocais: false,
          },
        });
        await invoke('gerenciar_transferencias_sociais', {
          apiBaseUrl: API_DOME_LAUNCHER_URL,
          accessToken: token,
          acao: 'confirmar',
          pedidoId: pedido.pedidoId,
        });
        setMensagemSync('Instância do amigo disponível na biblioteca.');
        publicarProgressoTransferenciaSocial({
          estado: 'concluido',
          mensagem: 'Instância disponível na biblioteca.',
          friendProfileId,
          pedidoId: pedido.pedidoId,
          instanciaId: atividade.instanciaId,
        });
        window.dispatchEvent(new CustomEvent(EVENTO_INSTANCIAS_ATUALIZADAS));
      } catch (erro) {
        const mensagem = mensagemErro(erro, 'Falha ao baixar a instância do amigo.');
        setMensagemSync(mensagem);
        publicarProgressoTransferenciaSocial({
          estado: 'erro',
          mensagem,
          friendProfileId,
          instanciaId: atividade.instanciaId,
        });
      }
      return;
    }

    if (!atividade.projectId || !atividade.versionId || !atividade.source) {
      setMensagemSync('Metadado exato indisponivel. Use o fluxo de sync para clonar a instancia.');
      return;
    }

    try {
      setMensagemSync('Preparando instalacao exata do modpack...');
      let versao: VersaoModrinth;
      if (atividade.source === 'modrinth') {
        const resposta = await fetch(`https://api.modrinth.com/v2/version/${atividade.versionId}`);
        if (!resposta.ok) {
          throw new Error(`Falha ao buscar versao exata (HTTP ${resposta.status}).`);
        }
        versao = (await resposta.json()) as VersaoModrinth;
      } else {
        versao = await invoke<VersaoModrinth>('obter_versao_projeto_curseforge', {
          projectId: atividade.projectId,
          fileId: atividade.versionId,
          projectType: 'modpack',
        });
      }
      const arquivo =
        versao.files.find((item) => item.primary) ||
        versao.files.find((item) => item.filename.toLowerCase().endsWith('.mrpack')) ||
        versao.files[0];
      if (!arquivo?.url) {
        throw new Error('Arquivo da versao exata nao encontrado.');
      }

      const versaoMinecraft = atividade.versaoMinecraft || escolherVersaoMinecraftIdeal(versao.game_versions || []);
      if (!versaoMinecraft) {
        throw new Error('Nao foi possivel determinar versao Minecraft exata.');
      }

      const loaderCandidato = (atividade.loader || versao.loaders?.[0] || 'vanilla').toLowerCase();
      const loaderNormalizado =
        loaderCandidato === 'fabric' || loaderCandidato === 'forge' || loaderCandidato === 'neoforge'
          ? loaderCandidato
          : 'vanilla';

      const instancias = await invoke<InstanciaResumo[]>('get_instances');
      const nomeBase = atividade.modpackNome || atividade.instanciaNome || 'Instancia social';
      const nomeInstancia = gerarNomeInstanciaDisponivel(
        `${nomeBase} (social)`,
        (instancias ?? []).map((item) => item.name)
      );
      const idInstancia = gerarIdInstancia(nomeInstancia);

      let loaderVersion: string | undefined;
      if (loaderNormalizado !== 'vanilla') {
        const respostaLoader = await invoke<LoaderVersionsResponse>('get_loader_versions', {
          loaderType: loaderNormalizado,
          minecraftVersion: versaoMinecraft,
        });
        loaderVersion =
          escolherVersaoLoaderIdeal(loaderNormalizado, respostaLoader.versions || [], versaoMinecraft) || undefined;
        if (!loaderVersion) {
          throw new Error(`Nenhuma versao valida do loader ${loaderNormalizado} encontrada.`);
        }
      }

      const paramsCriacao: Record<string, unknown> = {
        name: nomeInstancia,
        version: versaoMinecraft,
        mcType: loaderNormalizado,
      };
      if (loaderNormalizado !== 'vanilla') {
        paramsCriacao.loaderType = loaderNormalizado;
        paramsCriacao.loaderVersion = loaderVersion;
      }

      await invoke('create_instance', paramsCriacao);
      await invoke('install_modpack_files', {
        instanceId: idInstancia,
        downloadUrl: arquivo.url,
        fileName: arquivo.filename || `${idInstancia}.mrpack`,
      });
      await invoke('save_modpack_info', {
        instanceId: idInstancia,
        modpackInfo: {
          projectId: atividade.projectId,
          versionId: atividade.versionId,
          fileId: atividade.fileId || null,
          name: nomeBase,
          author: 'Social',
          icon: null,
          slug: atividade.projectId,
          source: atividade.source,
          installedVersion: versao.version_number,
        },
      });

      setMensagemSync('Modpack exato instalado com sucesso.');
      window.dispatchEvent(new CustomEvent(EVENTO_INSTANCIAS_ATUALIZADAS, {
        detail: { instanciaId: idInstancia },
      }));
    } catch (erro) {
      setMensagemSync(mensagemErro(erro, 'Falha ao instalar mesma instancia.'));
    }
  };

  useEffect(() => {
    const aoInstalarAtividade = (evento: Event) => {
      const detalhe = (evento as CustomEvent<{
        friendProfileId?: string;
        atividade?: AtividadeSocial | null;
      }>).detail;
      if (!detalhe?.friendProfileId) return;
      void instalarMesmaInstanciaPorAtividade(detalhe.friendProfileId, detalhe.atividade ?? null);
    };
    window.addEventListener(EVENTO_INSTALAR_ATIVIDADE_SOCIAL, aoInstalarAtividade);
    return () => window.removeEventListener(EVENTO_INSTALAR_ATIVIDADE_SOCIAL, aoInstalarAtividade);
  });

  const enviarMensagemChat = async () => {
    const token = await obterTokenValido();
    const friendProfileId = amigoSelecionadoPerfilIdRef.current;
    if (!token || !friendProfileId || !textoChat.trim()) return;

    setEnviandoChat(true);
    setErroChat(null);
    try {
      const mensagem = await invoke<MensagemChatApi>('send_launcher_chat_message', {
        apiBaseUrl: API_DOME_LAUNCHER_URL,
        accessToken: token,
        payload: { paraPerfilId: friendProfileId, conteudo: textoChat.trim() },
      });

      setTextoChat('');
      setMensagensChat((anterior) => {
        if (anterior.some((item) => item.id === mensagem.id)) return anterior;
        return [...anterior, mensagem];
      });
    } catch (erro) {
      setErroChat(mensagemErro(erro, 'Nao foi possivel enviar mensagem.'));
    } finally {
      setEnviandoChat(false);
    }
  };

  const aoPressionarEnterMensagem = (evento: KeyboardEvent<HTMLInputElement>) => {
    if (evento.key !== 'Enter' || evento.shiftKey) return;
    evento.preventDefault();
    enviarMensagemChat();
  };

  if (carregandoSessao) {
    return (
      <aside className={cn('launcher-social w-[311px] shrink-0 overflow-y-auto', className)}>
        <EsqueletoSocial />
      </aside>
    );
  }

  if (recuado) {
    const statusPerfil: StatusPresenca = aparecerOffline ? 'offline' : statusManual;
    const urlAvatarPerfil = uuidAvatarMinecraft
      ? `https://mc-heads.net/head/${uuidAvatarMinecraft}/64`
      : perfil?.discordAvatar
        ? `https://cdn.discordapp.com/avatars/${perfil.discordId}/${perfil.discordAvatar}.png?size=64`
        : null;

    const renderizarAvatarAmigo = (amigo: AmigoSocial) => (
      <button
        key={amigo.friendProfileId}
        type="button"
        onClick={() => abrirChatComAmigo(amigo.friendProfileId)}
        title={`${amigo.nome} · ${rotuloStatus(statusEfetivo(amigo.status, amigo.online))}`}
        aria-label={`Abrir conversa com ${amigo.nome}`}
        aria-expanded={chatAberto && amigoSelecionadoPerfilId === amigo.friendProfileId}
        className="relative grid h-10 w-10 place-items-center border border-white/[0.07] bg-white/[0.02] transition-colors hover:border-white/20 hover:bg-white/[0.05]"
      >
        {amigo.avatarUrl ? (
          <img src={amigo.avatarUrl} alt="" className="h-8 w-8 object-contain" />
        ) : (
          <span className="text-[8px] font-black text-white/50">
            {amigo.nome.trim().slice(0, 2).toUpperCase()}
          </span>
        )}
        <span className="absolute -bottom-1 -right-1 grid h-3.5 w-3.5 place-items-center rounded-full bg-[#101010]">
          <IndicadorStatusSocial
            status={statusEfetivo(amigo.status, amigo.online)}
            className="h-2.5 w-2.5"
          />
        </span>
      </button>
    );

    return (
      <>
      <aside className={cn('launcher-social shrink-0 overflow-y-auto', className)}>
        <div className="flex w-full flex-col items-center gap-3">
          <button
            type="button"
            onClick={onAlternarRecuo}
            title="Abrir painel social"
            aria-label="Abrir painel social"
            className="grid h-10 w-10 place-items-center border border-white/10 bg-white/[0.025] text-white/45 transition-colors hover:border-white/20 hover:text-white"
          >
            <ChevronLeft size={13} />
          </button>

          <div
            title={sessao ? nomeExibicaoAtual : 'Entrar no social'}
            className="relative grid h-10 w-10 place-items-center border border-white/10 bg-[#151515]"
          >
            {urlAvatarPerfil ? (
              <img src={urlAvatarPerfil} alt="" className="h-8 w-8 object-cover" />
            ) : (
              <User size={17} className="text-white/45" />
            )}
            {sessao && (
              <span className="absolute -bottom-1 -right-1 grid h-4 w-4 place-items-center rounded-full bg-[#101010]">
                <IndicadorStatusSocial status={statusPerfil} className="h-3 w-3" />
              </span>
            )}
          </div>

          {sessao && amigosOnline.length > 0 && (
            <div className="flex w-full flex-col items-center gap-2 border-t border-white/[0.07] pt-3">
              <IndicadorStatusSocial status="online" className="h-3 w-3" titulo="Online" />
              {amigosOnline.slice(0, 4).map(renderizarAvatarAmigo)}
              {amigosOnline.length > 4 && (
                <span className="text-[8px] font-black text-white/30">+{amigosOnline.length - 4}</span>
              )}
            </div>
          )}

          {sessao && amigosOffline.length > 0 && (
            <div className="flex w-full flex-col items-center gap-2 border-t border-white/[0.07] pt-3">
              <IndicadorStatusSocial status="offline" className="h-3 w-3" />
              {amigosOffline.slice(0, 4).map(renderizarAvatarAmigo)}
              {amigosOffline.length > 4 && (
                <span className="text-[8px] font-black text-white/30">+{amigosOffline.length - 4}</span>
              )}
            </div>
          )}
        </div>
      </aside>
      <PainelChatSocial
        aberto={chatAberto}
        recuado
        amigoSelecionado={amigoSelecionado}
        perfilIdAtual={perfil?.perfilId}
        mensagens={mensagensChat}
        carregandoChat={carregandoChat}
        enviandoChat={enviandoChat}
        erroChat={erroChat}
        textoChat={textoChat}
        processandoAtividade={processandoAtividade}
        mensagemSync={mensagemSync}
        onFechar={() => setChatAberto(false)}
        onAlterarTexto={setTextoChat}
        onEnviarMensagem={enviarMensagemChat}
        onPressionarEnter={aoPressionarEnterMensagem}
        onRemoverAmigo={(friendProfileId) => void removerAmigo(friendProfileId)}
        onInstalarAtividade={async (friendProfileId, atividade) => {
          setProcessandoAtividade(true);
          try {
            await instalarMesmaInstanciaPorAtividade(friendProfileId, atividade ?? null);
          } finally {
            setProcessandoAtividade(false);
          }
        }}
        onSolicitarSync={async (friendProfileId, atividade) => {
          setProcessandoAtividade(true);
          try {
            await solicitarSyncInstancia(friendProfileId, atividade ?? null);
          } finally {
            setProcessandoAtividade(false);
          }
        }}
        formatarTempoRelativo={tempoRelativo}
        rotuloStatus={rotuloStatus}
      />
      </>
    );
  }

  return (
    <aside className={cn('launcher-social flex w-[311px] shrink-0 flex-col overflow-hidden', className)}>
      <div className="flex min-h-0 w-full flex-1 flex-col gap-3">
        <div className="shrink-0">
          <PerfilSocialPainel
          sessaoAtiva={Boolean(sessao)}
          perfil={perfil}
          onFecharDrawer={onFecharDrawer}
          onIniciarLoginDiscord={iniciarLoginDiscord}
          nomeExibicaoAtual={nomeExibicaoAtual}
          handleExibicaoAtual={handleExibicaoAtual}
          uuidAvatarMinecraft={uuidAvatarMinecraft}
          emJogo={atividadeLocal.emJogo}
          atividadeAtual={atividadeLocal.atividadeAtual}
          iconeAtividadeLocal={iconeAtividadeLocal}
          carregandoPerfil={carregandoPerfil}
          editandoPerfil={editandoPerfil}
          nomeSocialEditavel={nomeSocialEditavel}
          handleEditavel={handleEditavel}
          salvandoPerfil={salvandoPerfil}
          salvandoStatus={salvandoStatus}
          statusManual={statusManual}
          aparecerOffline={aparecerOffline}
          mensagemPerfil={mensagemPerfil}
          erroPerfil={erroPerfil}
          onAbrirEdicao={() => {
            if (!perfil) return;
            setMensagemPerfil(null);
            setErroPerfil(null);
            setNomeSocialEditavel(perfil.nomeSocial ?? '');
            setHandleEditavel(perfil.handle ?? '');
            setEditandoPerfil(true);
          }}
          onCancelarEdicao={() => setEditandoPerfil(false)}
          onSalvarPerfil={salvarPerfilSocial}
          onAlterarNome={setNomeSocialEditavel}
          onAlterarHandle={setHandleEditavel}
          onAtualizarStatus={atualizarStatusSocial}
          onRecuar={onAlternarRecuo}
          />
        </div>

        <ListaAmigosAgrupada
          className="min-h-0 flex-1"
          sessaoAtiva={Boolean(sessao)}
          filtroAmigos={filtroAmigos}
          onAlterarFiltro={setFiltroAmigos}
          onEnviarSolicitacao={enviarSolicitacaoPorHandle}
          enviandoSolicitacao={enviandoSolicitacao}
          perfilEncontrado={perfilEncontrado}
          buscandoPerfil={buscandoPerfil}
          buscaPerfilConcluida={buscaPerfilConcluida}
          pendentesRecebidas={pendentesRecebidas}
          pendentesEnviadas={pendentesEnviadas}
          pedidosTransferencia={pedidosTransferencia}
          onResponderSolicitacao={responderSolicitacao}
          onResponderTransferencia={(id, aceitar) => aceitar ? void revisarEnvio(id) : responderTransferencia(id, false)}
          solicitacaoProcessandoId={solicitacaoProcessandoId}
          transferenciaProcessandoId={transferenciaProcessandoId}
          mensagemSolicitacao={mensagemSolicitacao}
          mensagemTransferencia={mensagemTransferencia}
          carregandoAmigos={carregandoAmigos}
          erroAmigos={erroAmigos}
          amigosOnline={amigosOnline}
          amigosOffline={amigosOffline}
          naoLidasPorAmigo={naoLidasPorAmigo}
          amigoSelecionadoPerfilId={chatAberto ? amigoSelecionadoPerfilId : null}
          onAbrirChat={abrirChatComAmigo}
          onAbrirAtividade={onAbrirAtividadeAmigo}
          onAbrirPerfil={onAbrirPerfil}
          onRemoverAmigo={(friendProfileId) => void removerAmigo(friendProfileId)}
          formatarTempoRelativo={tempoRelativo}
          rotuloStatus={rotuloStatus}
        />
      </div>

      {perfil?.perfilId && <CompartilhamentosSociais
        apiBaseUrl={API_DOME_LAUNCHER_URL}
        perfilId={perfil.perfilId}
        amigos={amigos}
        obterToken={obterTokenValido}
      />}
      {revisaoEnvio && <RevisaoPacoteSocial key={revisaoEnvio.pedidoId} previa={revisaoEnvio.previa}
        onFechar={() => setRevisaoEnvio(null)} onConfirmar={(arquivos) => {
          arquivosEnvioRef.current.set(revisaoEnvio.pedidoId, arquivos);
          referenciasEnvioRef.current.set(revisaoEnvio.pedidoId, revisaoEnvio.previa.arquivos);
          const operacao = operacoesSociais.find((p) => p.pedidoId === revisaoEnvio.pedidoId);
          if (operacao?.tokenUpload) void fluxoUploadSync(operacao);
          else responderTransferencia(revisaoEnvio.pedidoId, true);
          setRevisaoEnvio(null);
        }} />}
      <PainelChatSocial
        aberto={chatAberto}
        compacto={Boolean(onFecharDrawer)}
        amigoSelecionado={amigoSelecionado}
        perfilIdAtual={perfil?.perfilId}
        mensagens={mensagensChat}
        carregandoChat={carregandoChat}
        enviandoChat={enviandoChat}
        erroChat={erroChat}
        textoChat={textoChat}
        processandoAtividade={processandoAtividade}
        mensagemSync={mensagemSync}
        onFechar={() => setChatAberto(false)}
        onAlterarTexto={setTextoChat}
        onEnviarMensagem={enviarMensagemChat}
        onPressionarEnter={aoPressionarEnterMensagem}
        onRemoverAmigo={(friendProfileId) => void removerAmigo(friendProfileId)}
        onInstalarAtividade={async (friendProfileId, atividade) => {
          setProcessandoAtividade(true);
          try {
            await instalarMesmaInstanciaPorAtividade(friendProfileId, atividade ?? null);
          } finally {
            setProcessandoAtividade(false);
          }
        }}
        onSolicitarSync={async (friendProfileId, atividade) => {
          setProcessandoAtividade(true);
          try {
            await solicitarSyncInstancia(friendProfileId, atividade ?? null);
          } finally {
            setProcessandoAtividade(false);
          }
        }}
        formatarTempoRelativo={tempoRelativo}
        rotuloStatus={rotuloStatus}
      />
    </aside>
  );
}
