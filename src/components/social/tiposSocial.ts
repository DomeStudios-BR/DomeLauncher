export interface ContaMinecraft {
  uuid: string;
  name: string;
  access_token: string;
  expires_at?: number;
}

export interface ContaMinecraftSocial {
  uuid: string;
  nome: string;
  vinculadoEm: string;
  ultimoUsoEm?: string | null;
}

export type StatusPresenca = 'online' | 'ausente' | 'offline';
export type TipoAtividade = 'modpack_exato' | 'instancia_personalizada' | 'launcher';

export interface AtividadeSocial {
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

export interface PerfilSocial {
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
  emblemas?: Array<{
    emblemaId: string;
    nome: string;
    descricao: string;
    imagemUrl: string;
    concedidoEm: string;
  }>;
  emblemasExibidos?: Array<{
    emblemaId: string;
    nome: string;
    descricao: string;
    imagemUrl: string;
    concedidoEm: string;
  }>;
  bannerPerfilUrl?: string | null;
  capturasFavoritas?: Array<{
    id: string;
    nome: string;
    instanciaNome: string;
    criadaEm?: string | null;
    imagemUrl: string;
  }>;
  bio?: string;
  instanciasRecentes?: InstanciaPublicaPerfil[];
  instanciasFavoritas?: InstanciaPublicaPerfil[];
  amigos?: AmigoSocial[];
  criadoEm: string;
  atualizadoEm: string;
}

export interface InstanciaPublicaPerfil {
  id: string;
  nome: string;
  versao: string;
  carregador: string;
  iconeUrl?: string | null;
  horasJogadas: number;
  ultimaVez?: string | null;
}

export interface SessaoSocial {
  accessToken: string;
  refreshToken: string;
  expiraEm: string;
  perfil: PerfilSocial;
}

export interface EmblemaSocial {
  emblemaId: string;
  nome: string;
  descricao: string;
  imagemUrl: string;
  concedidoEm: string;
}

export interface AmigoSocial {
  amizadeId: string;
  friendProfileId: string;
  nome: string;
  handle?: string | null;
  avatarUrl?: string | null;
  online: boolean;
  status?: StatusPresenca;
  atividadeAtual?: AtividadeSocial | null;
  ultimoSeenEm?: string | null;
  emblemaDestaque?: EmblemaSocial | null;
}

export interface SolicitacaoRecebida {
  id: string;
  dePerfilId: string;
  deHandle?: string | null;
  deNome: string;
  criadoEm: string;
}

export interface SolicitacaoEnviada {
  id: string;
  paraPerfilId: string;
  paraHandle?: string | null;
  paraNome: string;
  criadoEm: string;
}

export interface PedidoTransferenciaInstancia {
  id: string;
  solicitantePerfilId: string;
  instanciaId?: string | null;
  instanciaNome?: string | null;
  expiraEm?: string | null;
}

export interface RespostaAmigosApi {
  amigos: AmigoSocial[];
  pendentesRecebidas: SolicitacaoRecebida[];
  pendentesEnviadas: SolicitacaoEnviada[];
}

export interface PerfilBuscaAmizade {
  perfilId: string;
  nome: string;
  handle: string;
  avatarUrl?: string | null;
  online: boolean;
  status?: StatusPresenca;
}

export interface MensagemChatApi {
  id: string;
  dePerfilId: string;
  paraPerfilId: string;
  conteudo: string;
  criadoEm: string;
}

export interface RespostaChatApi {
  conversaId: string;
  mensagens: MensagemChatApi[];
}

export interface RespostaSessaoRefresh {
  accessToken: string;
  expiraEm: string;
}

export interface RespostaSalvarPerfilApi {
  sucesso?: boolean;
  perfil?: PerfilSocial;
}

export interface RespostaStatusSocialApi {
  sucesso?: boolean;
  perfil?: PerfilSocial;
}

export interface ResultadoExportacaoSyncSocial {
  caminhoArquivo: string;
  tamanhoBytes: number;
}

export interface EventoSocketSyncPedido {
  pedidoId?: string;
  solicitantePerfilId?: string;
  instanciaId?: string | null;
  instanciaNome?: string | null;
}

export interface EventoSocketSyncStatus {
  pedidoId?: string;
  status?: string;
  tokenUpload?: string;
  tokenDownload?: string;
}

export interface AtividadeLocalLauncher {
  emJogo: boolean;
  atividadeAtual: AtividadeSocial | null;
}

export interface VersaoModrinth {
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

export interface LoaderVersionsResponse {
  versions: Array<{ version: string; stable?: boolean }>;
}

export interface InstanciaResumo {
  id: string;
  name: string;
}

export interface AnaliseModpack {
  id: string;
  autorPerfilId: string;
  autorNome: string;
  autorHandle?: string | null;
  source: "modrinth" | "curseforge";
  projectId: string;
  projectNome: string;
  projectIcon?: string | null;
  projectAuthor?: string | null;
  slug?: string | null;
  versionId?: string | null;
  installedVersion?: string | null;
  instanciaNome?: string | null;
  horasRegistradas?: number | null;
  recomendado: boolean;
  conteudo: string;
  totalCurtidas: number;
  curtidoPorMim: boolean;
  criadoEm: string;
  atualizadoEm: string;
}

export interface SocialSidebarProps {
  usuarioMinecraft: ContaMinecraft | null;
  iconeAtividadeLocal?: string | null;
  className?: string;
  onFecharDrawer?: () => void;
}
