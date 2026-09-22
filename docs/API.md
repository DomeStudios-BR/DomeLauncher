# Comunicação do DomeLauncher com a API

## Identidade Dome e onboarding

O login Microsoft é a entrada principal do launcher. Após validar a conta Minecraft, o comando nativo troca o token
Minecraft por uma sessão Dome em `POST /api/launcher/auth/minecraft/exchange`. A DomeAPI valida o token diretamente
no serviço oficial, localiza o perfil pelo UUID ou cria um novo perfil, sem exigir Discord. A sessão social continua
protegida no arquivo nativo `social-session.dat`.

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
Identidade, presença, contas vinculadas, lista e quantidade de amigos vêm da DomeAPI; instâncias, favoritos,
tempo jogado e último acesso vêm do armazenamento local do launcher. `listar_capturas_perfil` lê até 12 arquivos
PNG/JPEG recentes, de até 8 MB cada, somente das pastas `screenshots` das instâncias cadastradas. O avatar, o banner,
as capturas favoritas, a bio, os metadados públicos das instâncias recentes e favoritas e os emblemas exibidos
são salvos na DomeAPI. Perfis visitados também recebem a lista resumida de amizades aceitas do jogador. Caminhos
locais de instâncias nunca são enviados. Se a cota do armazenamento local acabar,
o cache de preferências descarta imagens incorporadas em base64 sem invalidar o salvamento remoto. Comentários,
emblemas e análises vêm da DomeAPI;
sem sessão ou dados remotos, a tela não injeta identidade, comentários ou emblemas demonstrativos.
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
`instancia_personalizada`; `source` usa `modrinth` ou `curseforge`.

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

## Outros serviços e validação

Microsoft/Xbox/Minecraft, skins, manifests Mojang, loaders e conteúdo Modrinth/CurseForge têm integrações
próprias, fora da DomeAPI. Consulte `auth*.rs`, `skin.rs` e módulos de `aplicacao/`.
Na aba Explorar, `listar_categorias_busca_online` consulta as taxonomias atuais das duas plataformas, mantendo
separadamente o slug do Modrinth e o ID numérico do CurseForge. A fonte é escolhida por botões de marcação para
`Modrinth` e `CurseForge`; sem nenhuma marcação, a busca não restringe a origem e consulta ambas as plataformas.
Resultados equivalentes exibem a soma dos downloads das fontes consultadas. Assim, uma única fonte marcada mostra
somente a contagem dessa plataforma, enquanto ambas marcadas ou nenhuma marcação somam Modrinth e CurseForge.
Quando as duas fontes são consultadas, cada página mantém 20 itens visíveis, mas usa até 50 respostas de cada
catálogo para reconhecer equivalências posicionadas de forma diferente; itens extras sem par não são exibidos.
A interface mantém o título único `Categorias` e permite incluir até 10 opções e negar até 10 opções quando
exatamente uma fonte está ativa. Uma mesma categoria não pode ocupar os dois grupos. Sem marcação ou com ambas as
fontes marcadas, o filtro de categoria fica desativado para não tratar taxonomias diferentes como equivalentes.
`search_mods_online` recebe as inclusões em `filtros.categoriasModrinth` e
`filtros.categoriasCurseforge`, e as negações em `filtros.categoriasNegadasModrinth` e
`filtros.categoriasNegadasCurseforge`, além de versão, loader, ordenação e paginação. O backend valida os slugs,
combina inclusão e negação nas facetas do Modrinth, envia somente as inclusões em `categoryIds` ao CurseForge e
remove localmente os resultados das categorias negadas. Se uma taxonomia estiver temporariamente indisponível,
a outra ainda pode preencher o seletor.
No Explorar, o botão `Instalar` de um modpack inicia a criação da instância usando sua versão publicada mais recente
compatível com os loaders aceitos pelo launcher e que tenha um arquivo instalável; abrir o cartão do projeto continua
mostrando os detalhes sem iniciar a instalação.
Em `Adicionar conteúdo`, a interface sempre envia a versão do Minecraft da instância e, para mods, o loader atual;
esses dois filtros de compatibilidade não são editáveis. Ordenação e categorias continuam opcionais. Antes de uma
instalação em lote, `planejar_instalacao_conteudo` resolve o arquivo compatível de cada seleção e expande as
dependências obrigatórias de mods, deduplicadas e posicionadas antes do conteúdo que as exige. Resource packs e
shaders usam o mesmo fluxo de fila e revisão, sem inventar dependências que os provedores não declaram.
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
