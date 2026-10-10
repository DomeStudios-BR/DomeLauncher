# Comunicação do DomeLauncher com a API

## Relatos de problemas

O botão Reportar problema abre um modal com título, descrição e prévia dos dados públicos do perfil Dome,
nickname principal do Minecraft, versão do launcher, sistema operacional e arquitetura.
O jogador pode conferir e desmarcar os logs antes de enviar. A coleta mantém somente os últimos 200 registros
da interface na sessão atual, limitados a 24000 caracteres, em memória. Ela inclui console e erros JavaScript.
Não lê credenciais locais, arquivos pessoais, stdout do backend Rust ou logs das instâncias Minecraft.
Os filtros ocultam valores de credenciais, emails e o nome pessoal em pastas de usuário.
Preservam mensagens, URLs sem segredos, endereços de rede, arquivos e posições nas stack traces.
Objetos de erro são serializados com limite, mantendo detalhes úteis e ocultando campos de credenciais.

`preparar_relato_problema` retorna apenas dados públicos da sessão protegida e do sistema.
`enviar_relato_problema` valida o relato e a identidade conferida no modal, renova o acesso se necessário e envia
`POST /api/launcher/relatos` pela API autorizada. O corpo contém `envioId`, `titulo`, `descricao`, `ambiente`, `logs`
e `anexos`, com identificador e tipo de mídia. URLs de anexos são geradas pela API, não aceitas do cliente.
Logs desmarcados são enviados como `null`. A API resolve a identidade pelo perfil autenticado e reaplica os filtros.
O retorno confirmado é `{ numero, url }`, apontando para `https://github.com/DomeStudios-BR/DomeLauncher/issues/`.
A confirmação no modal mostra apenas o sucesso e o botão Fechar, sem link da issue.
O corpo publicado usa texto normal para a descrição, uma tabela de diagnóstico e logs recolhidos em detalhes.
A referência técnica do envio permanece em um comentário HTML para apoiar a deduplicação sem poluir a leitura.

O modal permite até quatro anexos. Imagens PNG, JPG, WebP e GIF podem ter até 16 MiB; vídeos MP4 e WebM, até 64 MiB.
O editor visual insere imagens e vídeos na posição do cursor dentro da descrição, com remoção e desfazer.
A descrição serializa a posição como `{{anexo:UUID}}`; a API substitui apenas referências aos anexos confirmados
do envio por mídias no corpo da issue. URLs recebidas do cliente não são usadas nessa substituição.
O seletor nativo fornece o arquivo para `enviar_anexo_relato`; o Rust valida tamanho e extensão e faz o upload
autenticado para `POST /api/launcher/relatos/anexos/:envioId/:anexoId`. A API confere a assinatura do arquivo e
usa o armazenamento S3 já configurado. A seleção mostra prévias dentro do texto. Mídias removidas continuam
disponíveis para desfazer até enviar ou cancelar; nesse momento o modal tenta excluir os uploads não usados.
Depois de iniciar a criação da issue, os anexos usados são mantidos para evitar quebrar referências
quando o resultado do GitHub ainda não estiver confirmado. Fechar o aplicativo ou perder a conexão pode deixar
um upload sem relato, pois a limpeza não é persistida em uma fila.
Imagens são incorporadas no Markdown da issue e vídeos recebem um link público com suporte a HTTP Range.
O conteúdo permanece no armazenamento da DomeAPI. Não é um upload para o armazenamento de anexos do GitHub.

A DomeAPI precisa de `DOME_GITHUB_RELATOS_TOKEN`, disponível somente no servidor, com permissão Issues de escrita
no repositório DomeStudios-BR/DomeLauncher. Sem essa variável, retorna HTTP 503. Cada perfil pode fazer até três
tentativas por hora. Envios com a mesma referência compartilham o resultado por 24 horas no processo da API.
A deduplicação e o limite são locais ao processo, não persistem após reinício e não coordenam múltiplas réplicas.
Não há repetição automática da criação no GitHub. Em falhas sem confirmação, o jogador deve conferir as issues
antes de abrir um novo relato. As tentativas de confirmação no mesmo modal conservam referência e conteúdo.

O código local não configura a credencial de produção e não comprova a implantação da rota.

## Identidade Dome e onboarding

O login Microsoft é a entrada principal do launcher. Após validar a conta Minecraft, o comando nativo troca o token
Minecraft por uma sessão Dome em `POST /api/launcher/auth/minecraft/exchange`. A DomeAPI valida o token diretamente
no serviço oficial, localiza o perfil pelo UUID ou cria um novo perfil, sem exigir Discord. A sessão social continua
protegida no arquivo nativo `social-session.dat`.

As requisições assinadas Xbox/SISU enviam exatamente os bytes usados na assinatura. Em caso de HTTP 403,
se a hora do cabeçalho `Date` diferir em mais de 30 segundos da assinatura, o launcher refaz a assinatura e tenta
mais uma vez com a hora do servidor. A autorização após OAuth usa a hora da resposta Microsoft recente,
tanto no login quanto na renovação. Falhas informam etapa, status e código Xbox quando presente, sem expor o corpo
remoto ou credenciais. Um 403 persistente continua sendo erro e orienta conferir relógio, conexão e perfil Xbox.

As etapas de token e perfil do Minecraft validam o status HTTP e repetem até três vezes somente falhas transitórias
de conexão, limite de requisições e erros 5xx. Uma resposta 404 do perfil indica que a conta Microsoft ainda não tem
um perfil Minecraft Java; ela não é tratada como falha genérica nem cria uma identidade Dome incompleta.
Contas Minecraft adicionais são vinculadas ao perfil Dome já autenticado por
`POST /api/launcher/social/minecraft/link`. Trocar a conta ativa usada para jogar não altera automaticamente
`contaMinecraftPrincipalUuid`, que representa apenas o avatar público escolhido para o perfil.

O Discord é uma integração opcional em Configurações. `POST /api/launcher/social/discord/link` exige uma sessão Dome
e OAuth PKCE; um Discord já associado a outro perfil não é transferido ou mesclado automaticamente.

As Configurações oferecem dois fluxos de teste: reexibir somente o onboarding e esquecer todas as credenciais locais.
O segundo encerra a presença social, remove `account.json`, `accounts.json` e `social-session.dat`, reinicia o
onboarding e preserva instâncias, mundos, Java e configurações gerais.

## Status de servidores Minecraft

O comando nativo `ping_server` consulta o protocolo de status do Minecraft Java, tenta resolver registros DNS SRV
por até 1,5 segundo quando o endereço não informa uma porta e então usa o host direto como fallback. O host digitado
pelo jogador é mantido no handshake. A Home usa a resposta para
mostrar ícone, MOTD, jogadores online/máximo e latência no card "Volte a jogar", com nova consulta a cada 30 segundos.
Se o servidor aceitar a conexão TCP mas não responder ao protocolo de status, ele pode aparecer online sem MOTD ou
contagem de jogadores.

## Texturas de skins e capas

As prévias 3D e miniaturas usam `baixar_textura_minecraft` para obter texturas de
`textures.minecraft.net/texture/` pelo processo nativo. O comando força HTTPS, recusa redirecionamentos,
limita a resposta a 1 MB e exige PNG, com timeout de 20 segundos. Texturas locais permanecem em Data URLs.
Falhas na consulta de cosméticos e no download da skin são tratadas separadamente; a prévia usa uma skin
padrão embutida enquanto não houver textura da conta disponível. O teste `verificar:skins` inclui a seleção
e os modais com IPC simulado, sem comprovar o carregamento na máquina de um usuário afetado.

## Escopo e fontes

Contrato conferido no código em 12/09/2026, incluindo as rotas do checkout local de
`DomeAPI/src/routes/social/`. Isso não comprova a revisão implantada em produção.
A pasta irmã DomeAPI não é necessária para compilar o launcher.

- [Configuração do build](../vite.config.ts) e [configuração social](../src/lib/configuracaoSocial.ts).
- [OAuth Discord](../src-tauri/src/discord_social.rs).
- [Cliente HTTP e contratos Rust](../src-tauri/src/comandos/social_launcher.rs).
- [Interface e Socket.IO](../src/components/SocialSidebar.tsx).
- [Tipos sociais](../src/components/social/tiposSocial.ts) e [persistência](../src-tauri/src/launcher.rs).
- [Registro de comandos](../src-tauri/src/aplicacao/bootstrap.rs).

HTTP segue `React → invoke Tauri → reqwest/Rust → DomeAPI → JSON → React`.
Presença e notificações seguem `React → socket.io-client → DomeAPI` diretamente.
Pacotes de instâncias passam por HTTP no Rust; Socket.IO transporta pedidos, estados e tokens.

A tela de perfil próprio reutiliza `GET /api/launcher/social/profile/me` e `GET /api/launcher/friends`.
O avatar Minecraft do perfil próprio e da barra lateral usa a conta ativa do launcher mesmo enquanto o vínculo social está sendo atualizado,
com fallback para a principal e para a primeira conta vinculada. Perfis visitados usam somente as contas
do jogador consultado. Remover o avatar personalizado mantém essa mesma seleção. O perfil usa uma renderização
de 256 px para exibir a cabeça ampliada com nitidez; a barra social e os comentários usam 64 px, com o mesmo UUID.
Identidade, presença, contas vinculadas, lista e quantidade de amigos vêm da DomeAPI; instâncias,
tempo jogado e último acesso vêm do armazenamento local do launcher. `listar_capturas_perfil` lê até 12 arquivos
PNG/JPEG recentes, de até 8 MB cada, somente das pastas `screenshots` das instâncias cadastradas. O avatar, o banner,
as capturas favoritas, a bio, os metadados públicos das instâncias recentes e favoritas e os emblemas exibidos
são salvos na DomeAPI. Perfis visitados também recebem a lista resumida de amizades aceitas do jogador. Caminhos
locais de instâncias nunca são enviados. Se a cota do armazenamento local acabar,
o cache de preferências descarta imagens incorporadas em base64 sem invalidar o salvamento remoto. Comentários,
emblemas e análises vêm da DomeAPI;
sem sessão ou dados remotos, a tela não injeta identidade, comentários ou emblemas demonstrativos.
O editor só fica disponível após carregar o perfil remoto. Ao salvar, favoritos já publicados mantêm suas URLs
e metadados, mesmo sem a captura carregada na galeria paginada ou a instância instalada neste computador.
Remoções dependem da seleção explícita; um favorito sem dados locais nem remotos interrompe o salvamento.
A apresentação mantém as atividades recentes publicadas, cuja sincronização ocorre separadamente.
Falhas ao recarregar análises preservam a lista exibida; navegar para outro perfil limpa a lista anterior.
Análises só existem para instâncias com `modpack.json` do Modrinth/CurseForge; instâncias personalizadas
não oferecem publicação, e a API rejeita qualquer `source` diferente desses dois.

`migrar_versao_instancia` atende somente instâncias personalizadas. O comando prepara uma cópia completa,
baixa a nova base e o loader e identifica mods pelo SHA-512 no Modrinth e pelo fingerprint no CurseForge. Mods
reconhecidos são substituídos por versões compatíveis e suas dependências obrigatórias; arquivos não reconhecidos,
incompatíveis ou desativados
permanecem no backup. Mundos, opções, configurações, resource packs e shaders são copiados sem alteração. A troca
das pastas só ocorre depois da preparação e tenta restaurar a instância anterior se a ativação falhar.
O modal fecha após iniciar a operação, que continua no indicador global da biblioteca sem bloquear a navegação.

## Sincronização local entre instâncias

As configurações globais podem definir uma instância de origem e sincronizar seletivamente `config/`, `options.txt`,
`resourcepacks/`, `shaderpacks/` e `servers.dat`. `aplicar_sincronizacao_instancias` replica os itens escolhidos para
as instâncias existentes. A mesma configuração é aplicada após criar uma instância e novamente antes de jogar, o que
também cobre instâncias importadas ou instaladas por outros fluxos. A instância de origem nunca é sobrescrita.

## Novidades

O modal de novidades usa a área de rolagem personalizada do launcher dentro de uma altura limitada.
Cabeçalho e rodapé permanecem fixos; notas extensas podem ser percorridas por mouse, teclado e arraste.

A Home combina duas fontes e ordena tudo pela data de publicação:

- `GET /api/launcher/novidades?limite=8`, consultado pelo comando nativo `get_launcher_news`, para notícias e
  atualizações publicadas no painel da Dome Studios. A leitura nativa evita depender de CORS na WebView.
  A API consulta a release mais recente de `levigarciia/DomeLauncher` no GitHub e a importa uma única vez
  como atualização publicada e editável; novas releases entram pelo mesmo fluxo;
- notícias oficiais do Minecraft, carregadas pelo comando nativo descrito abaixo.

O painel usa as rotas autenticadas `GET`, `POST`, `PUT` e `DELETE` em
`/api/admin/launcher/novidades`. Rascunhos nunca são devolvidos pela rota pública. Publicar uma notícia
exige título, resumo e conteúdo; imagem HTTPS, categoria e versão de atualização são metadados opcionais.
As edições feitas no painel não são sobrescritas pela sincronização da release já importada.

O editor também aceita anexos locais PNG, JPEG e WebP de até 5 MB por
`POST /api/admin/launcher/novidades/imagens`. A API valida assinatura e tipo do arquivo, guarda o objeto no
bucket e devolve uma URL pública em `/api/launcher/novidades/imagens/:arquivo`; essa URL deve ser salva na notícia.

### Notícias oficiais do Minecraft

A Home consulta pelo comando `get_minecraft_news` o sitemap oficial do `minecraft.net`, limita a resposta a dez itens
e mantém um cache local de 30 minutos na pasta de dados do launcher (`%APPDATA%\dome\cache` no Windows,
`~/.local/share/dome/cache` no Linux). Um espelho somente de leitura dos artigos oficiais
é usado como contingência caso o site esteja indisponível. Ao selecionar uma notícia,
`get_minecraft_article` aceita somente URLs HTTPS de artigos do domínio oficial e devolve uma estrutura com texto e
imagens, em vez de HTML executável. A interface renderiza essa estrutura em um modal próprio e não executa scripts,
estilos, links ou iframes recebidos do site.

O conteúdo depende da disponibilidade e da marcação atual do site oficial. Falhas de rede ou mudanças nessa marcação
devem aparecer como estado de erro recuperável, sem impedir o restante da Home de funcionar.

## Configuração pública

Base padrão: `https://api.domestudios.com.br`, sem `/api/launcher` e sem barra final.
Vite injeta `__DOME_CONFIGURACAO_SOCIAL__`, exportada como `CONFIGURACAO_SOCIAL`.
Esses valores são públicos; nunca acrescente client secret ao objeto.

| Campo | Variáveis em precedência, primeira não vazia | Padrão |
| --- | --- | --- |
| `apiBaseUrl` | `DOME_API_PUBLIC_URL`, `DOME_API_URL`, `VITE_DOME_API_PUBLIC_URL`, `VITE_DOME_API_URL`, `VITE_API_PUBLIC_URL` | `https://api.domestudios.com.br` |
| `discordClientId` | `DOME_CLIENT_ID`, `DOME_APP_ID`, `DOME_DISCORD_CLIENT_ID`, `VITE_DOME_CLIENT_ID`, `VITE_DOME_APP_ID`, `VITE_DOME_DISCORD_CLIENT_ID` | `1380421346605138041` |
| `discordRedirectUri` | `DOME_REDIRECT_URI`, `DOME_DISCORD_REDIRECT_URI`, `VITE_DOME_REDIRECT_URI`, `VITE_DOME_DISCORD_REDIRECT_URI` | `https://domestudios.com.br/domelauncher` |
| `discordScopes` | `DOME_DISCORD_SCOPES`, `VITE_DOME_DISCORD_SCOPES` | `identify` |

Exemplo em `.env.local`, para uma API local já em execução:

```dotenv
DOME_API_PUBLIC_URL=http://localhost:3000
```

Reinicie o Vite ou reconstrua o bundle após mudanças. Client ID e redirect URI devem corresponder
ao aplicativo Discord do servidor. A variável não altera a CSP: confira `connect-src` em
`src-tauri/tauri.conf.json`, incluindo WebSocket, sem liberar origens indiscriminadamente.

## Login e sessão

1. A UI chama `login_discord_social` com `apiBaseUrl`, `clientId`, `redirectUri` e `scope`.
2. Rust gera `state`, verifier aleatório e challenge PKCE S256 e abre uma WebView no OAuth Discord.
3. O fluxo espera até 180 segundos, extrai `code` e valida o `state` retornado.
4. Rust envia `POST /api/launcher/auth/discord/exchange` com `{ code, codeVerifier, redirectUri }`.
5. A API troca o código com Discord e retorna `{ accessToken, refreshToken, expiraEm, perfil }`.
   O segredo OAuth, quando configurado, fica no servidor. Token social não é token Discord nem Minecraft.

`obterTokenValido` considera a sessão vencida 20 segundos antes de `expiraEm`. A renovação usa
`refresh_launcher_social_session`, recebe `{ accessToken, expiraEm }` e preserva o refresh token.
Falha na renovação limpa a sessão local. Não presuma retry de toda requisição com 401 ou rotação de refresh token.

`salvar_sessao_social_local` grava `social-session.dat` na pasta de dados do launcher (`%APPDATA%\dome` no Windows,
`~/.local/share/dome` no Linux), protegido por DPAPI no Windows;
`carregar_sessao_social_local` recupera a sessão. A chave legada `dome:social:sessao` no `localStorage`
é migrada e removida. Tokens ainda existem na memória do frontend para IPC/socket.

`logout_launcher_social` está implementado e registrado, mas não é chamado pelo frontend atual.
A rota local da API marca o perfil offline, sem revogar JWTs emitidos. Desconectar socket, limpar sessão
local e invalidar credenciais no servidor são operações diferentes.

## HTTP e IPC

As rotas das tabelas são relativas a `/api/launcher`. JSON e argumentos de `invoke` usam camelCase,
mesmo quando parâmetros Rust usam snake_case. Rotas protegidas recebem `Authorization: Bearer <accessToken>`.
Exchange e refresh dispensam Bearer; download usa token próprio na query.

O cliente social comum tem timeout total de 12 segundos. Transferências têm timeout de conexão de 20 segundos,
sem timeout total fixo. O exchange OAuth usa outro cliente, sem o timeout comum de 12 segundos.
`social_launcher.rs` exige HTTPS, exceto HTTP em `localhost`, `127.0.0.1` e `::1`.
O normalizador de `discord_social.rs` é menos restritivo e aceita prefixo HTTP ou HTTPS.

### Autenticação e perfil

| Método e rota | Comando Tauri | Corpo / resposta consumida |
| --- | --- | --- |
| `POST /auth/discord/exchange` | `login_discord_social` | `{ code, codeVerifier, redirectUri }` → sessão completa |
| `POST /auth/refresh` | `refresh_launcher_social_session` | `{ refreshToken }` → `{ accessToken, expiraEm }` |
| `POST /auth/logout` | `logout_launcher_social` | Sem corpo; retorno IPC `void` após sucesso HTTP |
| `GET /social/profile/me` | `get_launcher_social_profile` | Perfil direto, sem envelope `perfil` |
| `PATCH /social/profile/me` | `save_launcher_social_profile` | `{ nomeSocial?, handle?, contaMinecraftPrincipalUuid? }` → `{ sucesso?, perfil? }` |
| `GET /social/profile/me/comments` | `get_launcher_profile_comments` | `{ comentarios }`, do mais recente ao mais antigo, com nome e avatar atuais do autor |
| `POST /social/profile/me/comments` | `post_launcher_profile_comment` | `{ conteudo }` → comentário criado com a identidade real do autor |
| `DELETE /social/profile/me/comments/:id` | `delete_launcher_profile_comment` | Exclusão autenticada pelo autor do comentário ou dono do perfil |
| `POST /social/analises` | `publicar_analise_modpack` | `{ source, projectId, projectNome, recomendado, conteudo, ... }` → análise criada/atualizada; só `modrinth`/`curseforge` |
| `GET /social/analises/projeto?source=&projectId=` | `listar_analises_projeto` | Análises do modpack com autor e curtidas |
| `GET /social/profile/me/analises` | `listar_analises_perfil` | Análises publicadas pelo perfil |
| `POST /social/analises/:id/curtir` | `curtir_analise_modpack` | Alterna curtida; não permite curtir a própria |
| `DELETE /social/analises/:id` | `excluir_analise_modpack` | Exclusão autenticada pelo autor |
| `PATCH /social/status/me` | `set_launcher_social_status` | `{ statusManual?, aparecerOffline? }` → `{ sucesso?, perfil? }` |
| `POST /social/minecraft/link` | `link_launcher_minecraft_account` | `{ uuid, nome, minecraftAccessToken }` → `{ sucesso?, perfil? }` |
| `DELETE /social/minecraft/:uuid` | `unlink_launcher_minecraft_account` | Sem corpo → `{ sucesso?, perfil? }` |

O token Minecraft comprova a conta perante o servidor; UUID/nome isolados não substituem essa prova.
Status de presença usados: `online`, `ausente`, `offline`. Atividade e `emJogo` vêm do heartbeat.
Se nenhum heartbeat chegar por mais de 45 segundos, a API apresenta o perfil como offline e oculta a atividade,
mesmo que o último estado persistido ainda diga que o usuário estava jogando.
A API local também tem `GET /auth/me`; o launcher usa `/social/profile/me`.

### Amigos e chat

| Método e rota | Comando Tauri | Corpo / resposta consumida |
| --- | --- | --- |
| `GET /friends` | `get_launcher_friends` | `{ amigos, pendentesRecebidas, pendentesEnviadas }` |
| `GET /friends/search-by-handle/:handle` | `search_launcher_friend_by_handle` | Perfil de busca; HTTP 404 vira `null` no IPC |
| `POST /friends/request-by-handle` | `send_launcher_friend_request_by_handle` | `{ handle }` → `{ sucesso, id, destinatarioPerfilId }` |
| `DELETE /friends/request/:id` | `cancel_launcher_friend_request` | Cancela pedido; retorno IPC `void` |
| `POST /friends/request/:id/accept` | `respond_launcher_friend_request` | IPC `acao: "accept"` ou `"aceitar"`; sem corpo HTTP; retorno `void` |
| `POST /friends/request/:id/reject` | `respond_launcher_friend_request` | IPC `acao: "reject"` ou `"recusar"`; sem corpo HTTP; retorno `void` |
| `DELETE /friends/:friendProfileId` | `remove_launcher_friend` | Remove amizade; retorno IPC `void` |
| `GET /chat/:friendProfileId?limite=N` | `get_launcher_chat_messages` | `{ conversaId, mensagens }`; padrão 60, entre 1 e 120 |
| `POST /chat/send` | `send_launcher_chat_message` | `{ paraPerfilId, conteudo }` → HTTP `{ mensagem, ... }`; Rust extrai mensagem |

Handle é normalizado para minúsculas e sem `@`; a UI aceita 3–24 caracteres em `[a-z0-9._]`.
O PATCH preserva o handle quando ele está ausente, `null` ou vazio; atualizar bio ou instâncias não remove a identidade.
O Rust omite campos opcionais não informados. A API recupera e persiste handles ausentes ou inválidos na inicialização
e na leitura autenticada do perfil, incluindo login Minecraft e renovação da sessão. Colisões recebem sufixo numérico;
handles válidos são preservados. O launcher guarda o perfil recuperado na sessão, sem exigir novo login.
Rust apara mensagens, rejeita conteúdo vazio e mais de 500 caracteres. Parâmetros de rota são codificados
para URL. Diferencie ID de pedido, ID de amizade, perfil social e UUID Minecraft.

Exemplo de leitura em um módulo dentro de `src/`, com sessão válida obtida pelo fluxo existente:

```ts
import { invoke } from '@tauri-apps/api/core';
import { CONFIGURACAO_SOCIAL } from './lib/configuracaoSocial';
import type { RespostaAmigosApi, SessaoSocial } from './components/social/tiposSocial';

async function buscarAmigos(sessao: SessaoSocial): Promise<RespostaAmigosApi> {
    return invoke<RespostaAmigosApi>('get_launcher_friends', {
        apiBaseUrl: CONFIGURACAO_SOCIAL.apiBaseUrl,
        accessToken: sessao.accessToken,
    });
}
```

Na integração existente, reutilize `obterTokenValido` antes de enviar requisições.

### Dados principais

| Tipo | Campos |
| --- | --- |
| Sessão | `accessToken`, `refreshToken`, `expiraEm`, `perfil` |
| Perfil | `perfilId`, `discordId`, `discordUsername`, `discordGlobalName?`, `discordAvatar?`, `handle`, `nomeSocial`, `contasMinecraftVinculadas`, `contaMinecraftPrincipalUuid?`, `online`, `status?`, `aparecerOffline?`, `emJogo?`, `atividadeAtual?`, `ultimoSeenEm?`, `criadoEm`, `atualizadoEm` |
| Emblema | `emblemaId`, `nome`, `descricao`, `imagemUrl`, `concedidoEm` |
| Conta vinculada | `uuid`, `nome`, `vinculadoEm`, `ultimoUsoEm?` |
| Amigo | `amizadeId`, `friendProfileId`, `nome`, `handle?`, `avatarUrl?`, `online`, `status?`, `atividadeAtual?`, `ultimoSeenEm?` |
| Pedido recebido | `id`, `dePerfilId`, `deHandle?`, `deNome`, `criadoEm` |
| Pedido enviado | `id`, `paraPerfilId`, `paraHandle?`, `paraNome`, `criadoEm` |
| Perfil de busca | `perfilId`, `nome`, `handle`, `avatarUrl?`, `online`, `status?` |
| Mensagem | `id`, `dePerfilId`, `paraPerfilId`, `conteudo`, `criadoEm` |
| Atividade | `tipo`, `instanciaId?`, `instanciaNome?`, `servidor?`, `source?`, `projectId?`, `versionId?`, `fileId?`, `modpackNome?`, `iconeUrl?`, `versaoMinecraft?`, `loader?`, `compartilhamentoId?`, `publicaAmigos?`, `atualizadoEm` |

Datas são strings interpretadas como datas pelo cliente. Campos opcionais podem admitir `null`; consulte
os tipos Rust/TypeScript antes de mudar serialização. Atividade usa `launcher`, `modpack_exato` ou
`instancia_personalizada`; `source` usa `modrinth`, `curseforge` ou `dome`.

O painel administra emblemas por `GET` e `POST /api/admin/launcher/emblemas` e distribui por
`POST /api/admin/launcher/emblemas/:id/distribuir`. Imagens PNG, JPEG ou WebP de até 2 MB são enviadas como corpo
binário para `POST /api/admin/launcher/emblemas/imagens` e servidas com cache imutável pela rota pública devolvida.

## Socket.IO

A conexão usa `io(base, { auth: { accessToken }, transports: ['websocket', 'polling'] })`.
Não é WebSocket puro: preserve Socket.IO e seu path padrão `/socket.io/` no proxy.
Ao trocar conexão/token, o cliente desconecta o socket anterior. Heartbeats ocorrem ao conectar,
quando a atividade muda e a cada 20 segundos.

| Direção | Evento | Payload e efeito |
| --- | --- | --- |
| Cliente → API | `social:presenca:heartbeat` | `{ emJogo, atividadeAtual }` |
| API → cliente | `social:amigos:atualizar` | Sinaliza recarregar amigos via HTTP |
| API → cliente | `social:chat:nova` | `{ mensagem }` atualiza conversa e não lidas |
| Cliente → API | `social:sync:solicitar` | `{ alvoPerfilId, instanciaId, instanciaNome }`; ack `{ sucesso, pedidoId?, erro? }` |
| API → cliente | `social:sync:pedido` | `pedidoId`, `solicitantePerfilId`, metadados da instância e `expiraEm` |
| Cliente → API | `social:sync:responder` | `{ pedidoId, aceitar }`; ack `{ sucesso, erro? }` |
| API → cliente | `social:sync:status` | `pedidoId`, `status` e token correspondente ao participante/etapa |
| Ambas | `social:sync:falha` | `{ pedidoId, mensagem }` comunica falha ao solicitante |

O cliente envia chat por HTTP, embora a API local também implemente `social:chat:enviar`.
Não envie simultaneamente pelos dois canais, pois isso pode duplicar mensagens.

## Transferências e instâncias compartilhadas

### Transferência pontual

A solicitação e o aceite continuam usando Socket.IO. O envio passa por revisão de conteúdo:
`obter_previa_pacote_social({ instanceId })` lista arquivos, tamanhos e hashes; o proprietário seleciona
os arquivos e as pastas da instância, e somente a confirmação do modal aceita o pedido.
`export_launcher_social_sync_package` recebe
`instanceId`, a seleção em `arquivosConfiguracao` por compatibilidade e `arquivosReferencia`.
`config`, `mods` e `resourcepacks` começam marcadas; mundos, opções pessoais e outros conteúdos só
acompanham o pacote quando selecionados. O `instance.json` original nunca é incluído.

O manifesto contém SHA-256 de cada arquivo. A prévia identifica conteúdo Modrinth por SHA-512;
para abrir o seletor sem bloquear na leitura e na rede, hashes e referências são resolvidos somente
depois da confirmação. A identificação consulta até quatro lotes Modrinth em paralelo, com timeout por lote.
Somente arquivos selecionados são lidos para hash e compactação. Quando disponível, o pacote referencia a
versão/URL oficial em vez de reenviar o binário.
Se a identificação estiver indisponível, o arquivo segue no ZIP. URLs de referências são restritas
a HTTPS em `cdn.modrinth.com`, sem redirecionamentos. O recebimento confere tamanho e hash.
Arquivos exclusivamente CurseForge ou locais continuam no pacote.

- Preparação do upload: `POST /social/sync/upload/:pedidoId/preparar`, Bearer social,
  `x-social-sync-token`, JSON `{ tamanhoBytes }` → `{ urlUpload, caminhoArquivo, tamanhoBytes }`.
- Envio: `PUT` direto para `urlUpload`, com corpo binário, `Content-Type: application/octet-stream`
  e o tamanho informado. Os bytes não atravessam a DomeAPI nem o proxy da Cloudflare.
- Confirmação: `POST /social/sync/upload/:pedidoId/concluir`, Bearer social,
  `x-social-sync-token`, JSON `{ caminhoArquivo }`. A API confere o objeto no bucket antes de liberar o download.
- Compatibilidade: `POST /social/sync/upload/:pedidoId` mantém o upload intermediado para launchers antigos,
  sujeito ao limite de corpo do proxy em produção.
- Download: `GET /social/sync/download/:pedidoId?token=...`, token próprio, sem Bearer.
- Recuperação: `GET /social/sync`, autenticado, até 100 pedidos recentes do participante.
- Cancelamento: `POST /social/sync/:pedidoId/cancelar`, autenticado para um participante.
- Confirmação: `POST /social/sync/:pedidoId/confirmar`, autenticado somente para o destinatário.

`gerenciar_transferencias_sociais({ apiBaseUrl, accessToken, acao, pedidoId? })` expõe
`listar`, `cancelar` e `confirmar`. Recusa, cancelamento e expiração encerram o estado de espera.
Acks do socket têm limite de 15 segundos. Ao reconectar, o cliente recupera os pedidos pela API;
solicitações pendentes voltam à lista do proprietário, envios interrompidos exigem nova revisão e
recebimentos prontos são baixados e instalados automaticamente pelo destinatário.
Depois do aceite, o destinatário pode navegar normalmente pelo launcher: um card global informa a preparação,
o percentual do download quando o tamanho é conhecido e a instalação, e a biblioteca é atualizada ao concluir.
Tokens não são persistidos no armazenamento web.

O limite do ZIP é **2 GiB** nos dois projetos. A extração admite até 8 GiB de conteúdo e 50 mil
entradas; rejeita caminhos inseguros/duplicados, links e divergências do manifesto. ZIPs novos
não podem carregar arquivos extras não declarados. Temporários usam UUID e limpeza por escopo.
O evento nativo `social-transferencia-bytes` informa `pedidoId`, `etapa`, `bytes`, `total` e
`bytesPorSegundo`. Preparação sem total mensurável permanece indeterminada.
`cancelar_transferencia_social_local({ pedidoId })` interrompe a operação nativa em andamento.

O prazo inicial é de dez minutos; depois do aceite vale o prazo de transferência de duas horas.
O servidor mantém o pacote após o download HTTP e só marca conclusão quando o destinatário
confirma a importação. A confirmação é idempotente e remove imediatamente do bucket o objeto de uma
transferência pontual. Se essa remoção falhar, a limpeza periódica tenta novamente após o prazo.
Objetos de instâncias publicadas são compartilhados entre recebimentos e não são removidos pela confirmação;
só saem quando a publicação correspondente é encerrada e limpa.

A instalação social é preparada em `%APPDATA%/dome/temp/social/preparation` no Windows ou no diretório de dados
equivalente do sistema. A instância só é disponibilizada após a preparação completa. O ícone do manifesto é aplicado à nova instância.
Para Vanilla e Fabric, o recebimento baixa apenas os manifestos e o loader necessários; cliente, bibliotecas
e assets do Minecraft são preparados pelo fluxo cacheado no primeiro lançamento. Forge e NeoForge continuam
preparando esses arquivos durante a importação porque seus instaladores dependem deles. Recibos locais evitam
reimportar o mesmo pedido se a confirmação remota falhar. Os recibos ficam em `social/receipts` e o cache
`cache/social` reutiliza conteúdo referenciado por hash com cópias independentes. Backups de migração de versão
ficam em `backups/instances`. Pastas auxiliares legadas dentro da raiz de instâncias são migradas na inicialização.

### Publicações, participantes e atualizações

`gerenciar_compartilhamentos_sociais({ apiBaseUrl, accessToken, acao, dados })` chama
`POST /social/compartilhamentos/:acao`. Todas as ações exigem sessão social.

| Ação | Dados principais | Comportamento |
| --- | --- | --- |
| `listar` | `{}` | Publicações próprias, recebidas e convites pendentes |
| `criar` | `instanciaId`, `nome` | Cria/reutiliza publicação do proprietário |
| `publicar` | `id`, `previa` | Reserva envio; a versão torna-se disponível após upload |
| `convidar_amigo` | `id`, `membro` | Exige amizade aceita; destinatário precisa aceitar |
| `aceitar_amigo` | `id` | Aceita convite direto pendente |
| `convidar` | `id`, `validadeHoras?`, `limiteUsos?` | Gera link; padrão 24h e dez usos |
| `aceitar` | `convite` | Aceita código/link válido |
| `revogar` | `id`, `convite` (identificador retornado na lista) | Revoga link |
| `remover` | `id`, `membro` | Remove participante ou convite pendente |
| `receber` | `id` | Emite pedido de recebimento da última versão |
| `receber_publica` | `id` | Emite recebimento direto somente para amizade aceita com o proprietário |
| `definir_publica` | `id`, `publicaAmigos` | Proprietário libera ou remove o download direto para amigos |
| `sair` | `id` | Remove participação/convite do usuário |
| `encerrar` | `id` | Encerra publicação; limpeza periódica remove seus objetos |

Limites atuais: 20 publicações por proprietário, 100 versões por publicação, 100 participantes/
convites diretos e dez links ativos. Os links têm no máximo 168 horas e 100 usos. Somente o hash
do segredo do convite fica no servidor. Remover acesso impede novos downloads, inclusive de
pedidos já emitidos. Cópias que o jogador já instalou permanecem locais.

Links `domelauncher://convite/<id>.<segredo>` usam os plugins Tauri deep-link/single-instance e
abrem a revisão no launcher, sem aceitar nem instalar automaticamente. A associação do protocolo
é feita pelo instalador; execução apenas pelo Vite não testa esse comportamento.

Uma instância marcada como pública continua restrita às amizades aceitas que recebem a atividade social.
O launcher anuncia `compartilhamentoId` na presença e oferece download direto, mas a API verifica a amizade
ao criar o recebimento e novamente ao servir o arquivo. Tornar a instância privada bloqueia downloads públicos
pendentes. Usuários que não são amigos continuam dependendo da solicitação e do aceite explícito do proprietário.

`revisar_atualizacao_compartilhada` compara versão anterior, conteúdo local e versão publicada.
`download_import_launcher_social_sync_package` recebe opcionalmente `vinculo` com
`apiBaseUrl`, `compartilhamentoId`, `versao`, `arquivos` e `substituirAlteracoesLocais`.
O conteúdo baixado é conferido contra a revisão. Atualizações preservam ID/nome local e conteúdo não
gerenciado; pastas como `saves` passam a fazer parte da versão quando o publicador as seleciona.
Conflitos exigem aceite explícito, também validado no Rust.
A atualização exige o jogo fechado e mantém a pasta anterior em `.social-backups`.
`desvincular_instancia_compartilhada` remove o vínculo local, preservando os arquivos da instância.
Backups e cache não têm expiração automática: devem ser incluídos no planejamento de espaço em disco.

O evento `social:compartilhamentos:atualizar` sinaliza convites e versões novas. Alterações concorrentes
no servidor usam advisory locks PostgreSQL, mantendo as consultas na conexão protegida.
Os dados ficam nas coleções `social_sync_instancias` e `instancias_compartilhadas` do armazenamento
JSONB existente; não é necessário criar tabelas específicas.

### Compatibilidade e validação

Implante a DomeAPI atualizada antes de distribuir este launcher. Clientes antigos continuam
transferindo pacotes, mas não confirmam importação; seus objetos pontuais expiram normalmente.
O launcher novo precisa das rotas adicionais para recuperação, confirmação e compartilhamento.
Não há retomada por faixa de bytes: uma tentativa de ZIP interrompida reinicia o download; o cache
reaproveita arquivos Modrinth concluídos.

`bun run verificar:social` testa os componentes compilados, revisão/conflitos, publicação e janela
mínima no Edge, com IPC simulado. Testes Rust cobrem pacotes e atualização local; `bun test tests`
na DomeAPI exercita HTTP com banco/armazenamento isolados. Esses testes não comprovam OAuth,
S3/PostgreSQL de produção, protocolo registrado pelo instalador nem transferência entre duas contas reais.

## Erros e diagnóstico

Rust verifica status antes de desserializar. O extrator comum procura `erro.mensagem`, `message`, `erro`
textual e `error` textual, nessa ordem. Caso contrário, inclui até 200 caracteres do corpo; sem corpo,
mantém o status. A API local responde erros como `{ erro: { codigo, mensagem } }`.

- **401:** confira tipo de token, expiração e renovação; token Microsoft não autentica rotas sociais.
- **403:** confira participante e permissão; não contorne autorização no cliente.
- **404:** busca por handle vira ausência; em sync pode indicar pacote indisponível.
  Quando o objeto pontual não existe mais no bucket, a API encerra o pedido e o launcher também tenta cancelá-lo,
  impedindo novas tentativas a cada inicialização. A limpeza de inicialização cobre registros órfãos antigos.
- **429:** confira recarregamentos em cascata e limitador do servidor; evite retries imediatos.
- **Conexão:** separe base do build, CSP da WebView, proxy Socket.IO e rede do Rust.

Rejeições de `invoke` podem ser strings. O helper `mensagemErro` preserva strings de rejeição nativa e mensagens de `Error`. Não presuma que o usuário viu o status HTTP.
Não existe uma camada global de retry para essas chamadas.

## Modpacks da Dome em beta

A fonte `dome` participa do Explorar somente para modpacks, com busca, paginação, filtros de Minecraft/loader
e ordenação por data ou downloads. Em Relevância, os projetos Dome aparecem antes dos resultados Modrinth/CurseForge,
inclusive após carregar novas páginas, respeitando as fontes e os filtros selecionados.
Projetos da Dome não são mesclados com projetos externos pelo nome.
A publicação separa o projeto (nome, resumo, descrição Markdown e foto PNG) das versões imutáveis
(número, notas e canal estável/beta/alpha). Projetos sem versão ficam fora da busca.
A criação já exige uma instância da biblioteca ou um arquivo `.dome` e publica a primeira versão no mesmo fluxo.
`Meus modpacks` no Explorar navega para uma página do launcher com lista de projetos, criação em cinco etapas
(conteúdo, informações, descrição, versão e revisão) e abas de gestão (informações, descrição, versões e configurações).
`Publicar modpack` no menu da biblioteca é a única entrada que abre o editor em modal, com instância e nome preenchidos.
Ambas as apresentações reutilizam os mesmos campos e operações; a permissão beta também é verificada na página.
A lista de instâncias omite qualquer instalação com `modpack.json` reconhecido por `get_modpack_info`.
Ao selecionar uma instância própria, nome e ícone são reutilizados nas informações. O ícone é normalizado em PNG
para publicação, e a foto pode ser substituída pelo criador de ícones (geração ou importação PNG/JPEG/WebP). A importação não limita o tamanho do arquivo e normaliza a imagem em PNG de 256 × 256. O menu da biblioteca também omite a publicação de modpacks instalados.
Se o envio falhar após criar o projeto, o editor mantém esse projeto selecionado para tentar a versão novamente.
Publicações sociais antigas para amigos continuam podendo ser tornadas privadas; novas publicações usam a fonte Dome.

O painel do site usa `GET /api/admin/launcher/modpacks/publicadores` e
`PUT /api/admin/launcher/modpacks/publicadores/:perfilId`, com JSON `{ permitido }` e a sessão admin existente.
A liberação fica em `publicadorModpacks` no perfil; padrão ausente significa negado. Revogar bloqueia
novos projetos, edições, retiradas, exclusões e versões, preservando as publicações existentes.
A API revalida a permissão sob a mesma trava da alteração e da revogação.

As rotas ficam em `/api/launcher/modpacks`:

- `GET /`: busca pública; `busca`, `minecraft`, `loader`, `sort`, `offset` e `limit`.
- `GET /permissao` e `GET /meus`: sessão Dome para ler liberação e projetos próprios.
- `POST /` e `PATCH /:id`: sessão Dome, liberação beta e autoria; foto opcional em Data URL PNG preparado pelo criador de ícones, sem limite específico de 1 MiB (o corpo JSON mantém seu limite global de 2 MiB).
- `POST /:id/versoes`: sessão Dome, liberação e autoria; publica um `.dome` validado, sem substituir versões existentes.
- `GET /:id`, `GET /:id/versoes` e `GET /:id/versoes/:versaoId/arquivo`: leitura/download públicos.
- `DELETE /:id`: retira o projeto do Explorar e bloqueia novos downloads; instalações locais permanecem.
- `GET /:id/minhas-versoes`: sessão Dome e autoria; lista versões próprias, inclusive de projetos retirados.
- `DELETE /:id/versoes/:versaoId`: sessão Dome, liberação e autoria; exclui somente a versão escolhida.
  A última versão excluída deixa o projeto como rascunho, disponível para publicar uma nova versão.
- `DELETE /:id/definitivo`: sessão Dome, liberação e autoria; exclui o projeto e todas as suas versões.

A lista de projetos e a aba Configurações oferecem exclusão do projeto; cada versão tem sua própria ação Excluir.
As exclusões exigem confirmação com o nome do projeto ou o número da versão, e atualizam o Explorar e Meus modpacks.
Instalações locais permanecem. O estado excluído e os arquivos pendentes são persistidos antes da limpeza do S3.
Se o armazenamento falhar, os downloads continuam bloqueados e a limpeza é repetida ao consultar Meus modpacks.
Projetos excluídos ficam invisíveis e não podem ser editados ou receber versões durante essa limpeza.
Pacotes e ícone do projeto são removidos; mídias da descrição mantêm seu ciclo de vida independente.

O upload da versão usa corpo binário: quatro bytes big-endian com o tamanho do JSON de metadados,
JSON UTF-8 e os bytes do `.dome`. O limite beta é 64 MiB para o ZIP e 256 KiB para os metadados;
o conteúdo completo admite 8 GiB e 10 mil entradas. Há limites de 20 projetos por publicador e 100 versões
por projeto. Fotos e pacotes ficam no S3, projetos na tabela `launcher.modpacks` registrada como `modpacks_dome`.
O contador de downloads registra requisições GET aceitas, incluindo tentativas repetidas.

O formato continua sendo ZIP com `dome_manifest.json`, compatível com a exportação Dome existente.
Na publicação, o Rust normaliza `mcType` e `loaderType` para minúsculas. Quando `mcType` é `modded`, usa o carregador conhecido de `loaderType` e recusa pacotes sem Fabric, Forge ou NeoForge válido. Também converte `exportadoEm` de RFC3339
para UTC com sufixo `Z`. A API também aceita datas RFC3339 com fuso e nomes como `Fabric`, `Forge` e `NeoForge`
em pacotes já exportados, mantendo a validação de loaders conhecidos, compatibilidade e versão do carregador.
A publicação a partir de uma instância reutiliza a exportação social com referências oficiais Modrinth,
SHA-256 e arquivos locais quando não reconhecidos. Reutiliza a árvore de seleção das transferências sociais para o autor escolher pastas e arquivos,
sem selecionar conteúdo automaticamente. Mostra toda a prévia da instância; conteúdo fora das pastas permitidas e arquivos de opções/servidores fica visível,
com seleção desabilitada. A publicação mantém as regras da API para pacotes públicos. Ao enviar um arquivo exportado, o Rust remove `instance.json` e metadados privados do manifesto.
A API recusa mundos, credenciais, caminhos inseguros, arquivos fora das pastas permitidas e referências externas
fora de `cdn.modrinth.com`.

`gerenciar_modpacks_dome`, `publicar_versao_modpack_dome` e `instalar_modpack_dome` mantêm o HTTP no Rust.
Publicações leem a sessão protegida nativa; a origem permitida é `DOME_API_PUBLIC_URL` definida na compilação
Rust ou `https://api.domestudios.com.br`, com localhost adicional apenas em builds de desenvolvimento.
Não passe tokens pela interface para esses comandos.

A instalação confere SHA-512 do pacote, valida o ZIP e restaura referências com hashes na preparação temporária.
Na atualização, a compatibilidade consulta todas as versões de Minecraft e loaders declarados pela API.
Os nomes dos loaders são comparados sem distinguir maiúsculas de minúsculas, aceitando os rótulos locais
`Fabric`, `Forge` e `NeoForge`. Mods locais adicionais não participam dessa verificação de compatibilidade.
O vínculo público usa `modpack-dome.json`, separado de `compartilhamento.json`, e os metadados usam
`modpack.json` com `source: dome`. A troca de versão exige jogo fechado, mesmo Minecraft/loader, aceite
explícito para arquivos locais conflitantes e backup em `.social-backups`. Mundos, opções, lista de servidores
e conteúdo pessoal não gerenciado são preservados. Análises sociais da Dome ainda não estão habilitadas.

Implante DomeAPI e domesite antes de distribuir o launcher. Os testes HTTP usam banco e armazenamento isolados;
a conferência visual usa IPC simulado e os testes Rust cobrem normalização, origens e atualização local.
Isso não comprova login, upload S3 ou instalação de um pacote publicado entre contas reais em produção.

## Outros serviços e validação

Microsoft/Xbox/Minecraft, skins, manifests Mojang, loaders e conteúdo Modrinth/CurseForge têm integrações
próprias, fora da DomeAPI. Consulte `auth*.rs`, `skin.rs` e módulos de `aplicacao/`.
Versões exatas de arquivos CurseForge são resolvidas pelo comando
`obter_versao_projeto_curseforge`; isso permite selecionar inclusive uma versão social que já saiu da primeira
página da listagem. Instâncias de modpacks públicos são identificadas pelo `modpack.json`, com fonte, projeto,
versão e uma assinatura dos arquivos gerenciados. Alterações posteriores em mods, configurações, resource packs,
shaders ou scripts fazem a presença tratá-la como instância personalizada; instalações legadas sem assinatura
continuam usando os metadados exatos até a próxima instalação ou troca de versão. A ausência do `modpack.json`
mantém a instância como personalizada, sem inferência pelo nome.
Ao trocar a versão de um modpack público, o launcher limita as opções à mesma versão do Minecraft e ao mesmo loader,
substitui o conteúdo gerenciado do pacote e preserva dados da instância como mundos e opções do jogador.
Discord Rich Presence em `comandos/presenca_discord.rs` também é distinto do social da DomeAPI.
O updater usa GitHub, conforme `tauri.conf.json`, e não `/api/launcher`.

Ao mudar contratos, atualize comando Rust, registro, tipos/UI e este documento. Se o servidor precisar mudar,
considere compatibilidade entre versões; alterar um checkout não implanta a API. Valide, conforme o escopo,
login/renovação, perfil, amizade, chat entre duas contas, reconexão, presença e transferências aceitas,
recusadas e com falha. Build/testes locais não comprovam OAuth ou disponibilidade em produção.

### Mídias na descrição dos modpacks

A descrição usa um editor visual único com formatação e anexos no cursor, armazenado como Markdown.
Imagens e vídeos são nós inline com remoção individual e desfazer/refazer. A renderização pública reconhece
os anexos de vídeo nas imagens Markdown e também nos links de mídia legados. Tabelas e listas de tarefas
existentes são preservadas na edição. Imagens selecionadas permitem largura em pixels (32–1600),
redimensionamento por ponteiro mantendo a proporção, alinhamento e link HTTPS. Parágrafos e títulos
também aceitam esquerda/centro/direita. Esses atributos são gravados como HTML seguro dentro do Markdown
(`width`, `align` e links), preservados ao reabrir o editor e reconhecidos na descrição pública após sanitização.
Parágrafos e títulos com mídia são serializados como um bloco HTML, mantendo texto e anexos juntos.
A descrição dos projetos Dome compartilha os estilos de conteúdo do editor e preserva mídia em linha,
largura e alinhamento, sem centralização ou moldura automática. Projetos externos mantêm sua apresentação existente.

O comando nativo `enviar_midia_modpack_dome` envia o arquivo selecionado, sem expor o token ao WebView,
à rota autenticada beta `POST /api/launcher/modpacks/midias` como `application/octet-stream`.
A API identifica assinaturas PNG/JPEG/WebP/GIF/MP4/WebM e armazena objetos com UUID.
Imagens da descrição aceitam até 16 MiB; vídeos, até 64 MiB. Estes limites não se aplicam à importação
da foto pelo criador de ícones. A resposta contém `url` e `tipo`.
`GET /api/launcher/modpacks/midias/:arquivo` transmite a mídia pública com Content-Type fixo,
nosniff, cache imutável e suporte a Range/206 para reprodução de vídeo. O CSP permite mídia da API Dome.


## Favoritos de projetos e instalação pelo Explorar

A lista de favoritos continua no armazenamento local. O launcher também registra o estado por conta na
DomeAPI: `PUT /api/launcher/social/favoritos`, com Bearer e `{ source, projectId, favoritado }`.
`source` aceita `modrinth`, `curseforge` e `dome`. Repetir o mesmo estado não cria votos adicionais;
a chave do banco é conta + fonte + projeto. Desfavoritar remove apenas o registro da conta autenticada.

`POST /api/launcher/social/favoritos/contagens` recebe `{ projetos: [{ source, projectId }] }`, com até
150 projetos, e retorna a contagem Dome e `favoritadoPorMim`. A consulta pública não exige sessão;
com Bearer, o último campo reflete a conta autenticada. O HTTP passa pelo comando Rust
`gerenciar_favoritos_projetos`, que restringe a origem antes de ler a sessão protegida.
Os contadores do Explorar e dos detalhes somam os seguidores do Modrinth aos favoritos Dome.
Alterações offline ficam pendentes para nova tentativa, e os favoritos locais existentes são registrados
na primeira consulta. A sincronização depende de uma sessão social válida; não transfere a lista entre dispositivos.

O Explorar lê `get_modpack_info` para reconhecer projetos já instalados, incluindo variantes de outras fontes.
O botão de modpack instalado fica desabilitado. Instalar inicia o fluxo em segundo plano sem navegar para os detalhes;
mods, texturas e shaders usam um seletor compacto da instância de destino. O card continua abrindo os detalhes.
A validação automatizada usa banco e IPC isolados, sem comprovar publicação da API nem download em produção.

## Ativação local de pacotes

A preparação de modpacks Dome e instâncias compartilhadas fica em `.social-staging` dentro da pasta de instâncias
configurada, para que a ativação e o backup usem a mesma unidade. Se uma preparação externa estiver em outra unidade,
a publicação copia o conteúdo para uma pasta temporária no destino e só então renomeia para ativá-lo. Falhas na cópia
preservam a origem, limpam o destino parcial e restauram a instância anterior quando houver backup. Links simbólicos
e arquivos especiais são rejeitados nessa cópia.

## Coleção de favoritos

Os favoritos de projetos são vinculados ao perfil Dome da sessão protegida. O launcher carrega a coleção
no login e tenta sincronizar alterações ao editar, ao recuperar a conexão e a cada minuto. O cache e as filas
pendentes são separados por perfil. Encerrar a sessão deixa de exibir o cache daquela conta.
Favoritos locais sem conta são importados para a próxima conta autenticada e retirados do armazenamento de visitante.

* GET /api/launcher/social/favoritos: exige autenticação e retorna favoritos com source, projectId e dados,
  além da lista de grupos.
* PUT /api/launcher/social/favoritos: mantém o contrato source, projectId e favoritado, aceitando dados opcionais
  com id, source, title, description, icon_url, author, slug e type. Remover um favorito elimina somente o voto
  daquele perfil. Metadados ausentes em clientes antigos preservam os dados já salvos.
* PUT /api/launcher/social/favoritos/grupos: salva grupos ordenados com id, nome, recolhido e favoritos.
  Cada referência usa a chave source:projectId. Uma referência só pode pertencer a um grupo.

O comando gerenciar_favoritos_projetos aceita listar e grupos, além de salvar e contagens. Operações da coleção
incluem perfilId para que o Rust rejeite uma troca de sessão antes de enviar a requisição. Tokens permanecem
na sessão nativa. Erros mantêm as alterações pendentes e permitem nova tentativa pela tela de favoritos.
Alterações simultâneas de grupos em computadores diferentes seguem o último salvamento recebido pela API.

A estrutura relacional adiciona dados à tabela launcher.favoritos e cria launcher.grupos_favoritos de forma
idempotente na inicialização da API. Favoritos antigos sem metadados são recuperados nas fontes originais.
Projetos indisponíveis continuam visíveis pelo identificador, com a instalação desabilitada.
O botão Instalar reutiliza o fluxo existente, incluindo escolha de destino e versão compatível.
Estas mudanças precisam ser implantadas na DomeAPI junto da versão correspondente do launcher.

A verificação bun run verificar:favoritos compila a tela com os componentes compartilhados da biblioteca e testa
criação, renomeação, recolhimento, exclusão e reordenação de grupos, arraste de favoritos, menu contextual e
acionamento de Instalar em 960 por 640. Os testes de sincronização usam IPC simulado; os testes HTTP da API usam
persistência isolada. Eles não comprovam login real, migração no banco implantado ou download no aplicativo nativo.
