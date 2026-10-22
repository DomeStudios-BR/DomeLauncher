# Guia para agentes e contribuidores

## Escopo e início de trabalho

Estas instruções valem para todo o DomeLauncher, por referência no `AGENTS.md` da raiz.
Instruções explícitas da tarefa têm prioridade sobre este guia.

1. Confirme raiz, branch e alterações existentes com `git status --short` e `git branch --show-current`.
   Não confunda este checkout com cópias em outras pastas; preserve alterações de terceiros.
2. Leia este guia e, para integrações, [API.md](API.md).
3. Use `rg` e `rg --files` para localizar o fluxo real. Evite varrer dependências e builds.
4. Siga a chamada da interface até o comando Rust, persistência ou serviço externo antes de editar.
5. Faça a menor mudança coesa que resolve a tarefa. Evite refatorações e atualizações sem relação com o pedido.

## Produto e documentação

Launcher desktop de Minecraft com React 19, TypeScript e Vite na WebView, e Rust/Tauri 2 para operações nativas.
Windows e Linux são os alvos atuais de release.

- `README.md` é para jogadores: recursos, requisitos, downloads e suporte. Mantenha apenas um link curto
  para documentação técnica; não acrescente arquitetura e instruções internas ali.
- Mantenha em `docs/` somente `AGENTS.md` e `API.md`. Arquitetura, manutenção e release ficam neste guia;
  contratos e fluxos remotos ficam na `API.md`.
- Atualize os documentos junto das mudanças. Diferencie regra desejada, implementação e comportamento testado.
  Não registre disponibilidade de produção como fato permanente.

## Mapa do código

| Caminho | Responsabilidade |
| --- | --- |
| `src/App.tsx` | Composição, navegação e atualização do aplicativo |
| `src/hooks/useLauncher.ts` | Estado principal e integração via `invoke` |
| `src/types.ts` | Contratos compartilhados do frontend |
| `src/components/`, `src/pages/instance/` | Interface e telas da instância |
| `src/components/PerfilComunidade.tsx` | Perfil próprio, personalização, atividade, biblioteca e galeria local |
| `src/components/SocialSidebar.tsx` | Sessão social, amigos, chat, presença e transferências |
| `src/components/social/`, `src/lib/` | Componentes sociais, tipos e utilitários |
| `src/stores/` | Estado de criação/importação de instâncias |
| `src-tauri/src/main.rs`, `src-tauri/src/lib.rs` | Entrada e declaração dos módulos |
| `src-tauri/src/aplicacao/bootstrap.rs` | Inicialização Tauri e registro em `generate_handler!` |
| `src-tauri/src/aplicacao/` | Instâncias, conteúdo, importação/exportação, downloads e lançamento |
| `src-tauri/src/comandos/` | Comandos Tauri por domínio |
| `src-tauri/src/launcher.rs` | Modelos, estado, contas e persistência protegida |
| `src-tauri/src/auth.rs`, `src-tauri/src/auth_sisu.rs` | Autenticação Microsoft/Minecraft |
| `src-tauri/src/discord_social.rs` | OAuth Discord com PKCE |
| `src-tauri/src/comandos/social_launcher.rs` | HTTP da DomeAPI e transferência de pacotes |
| `src/components/modpacks/`, `src/services/modpacksDome.ts` | Projetos, publicações e versões da fonte Dome em beta |
| `src-tauri/src/comandos/modpacks_dome.rs` | HTTP, sessão protegida e instalação de pacotes públicos `.dome` |
| `src-tauri/tauri.conf.json`, `src-tauri/capabilities/` | Bundle, CSP, updater e permissões |
| `vite.config.ts` | Build e configuração social pública |
| `.github/workflows/` | Validação e publicação |

## Inicialização

`index.html` e `public/inicializacao.css` mostram um skeleton da tela inicial até React carregar as instâncias e a conta. A leitura das instâncias
usa uma tarefa bloqueante fora da thread da janela. `LauncherState::new()` carrega apenas os dados necessários para
o primeiro uso; a migração de pastas auxiliares e capas antigas do Modrinth é solicitada pela interface depois da
primeira carga e, ao terminar, atualiza a lista de instâncias. A verificação de jogos abertos também roda fora da
thread da janela e consulta comandos e diretórios só dos processos Java. Telas fechadas, notícias e editor de ícones
antigos são carregados sob demanda; o painel social é carregado após a primeira leitura. Preserve essa ordem para
não atrasar a janela.

No desenvolvimento, o Vite prepara os módulos da tela inicial antes da primeira navegação. Os dados dos ícones
pixelados usados pela interface ficam reunidos em `src/assets/dadosIconesPixelados.json`, evitando uma requisição por
ícone na WebView. O DevTools pode ser aberto manualmente quando necessário; ele não abre junto com a janela.

O Início usa `Activity` para preservar estado e DOM ao navegar, pausando efeitos e consultas enquanto está oculto.
Ao voltar, Novidades e Volte a jogar consultam os dados sem esvaziar os cartões, reiniciar o carregamento ou
repetir animações de entrada.
Listas iguais preservam as referências; falhas de uma fonte mantêm os últimos dados daquela fonte e respostas
anteriores à navegação são ignoradas. Resultados vazios bem-sucedidos removem itens que deixaram de existir.
Remover um cartão de Volte a jogar filtra o conteúdo já carregado, sem reler mundos e servidores.
A remoção guarda a última partida da instância junto da chave do cartão. O item permanece oculto nessa partida,
inclusive após reabrir o launcher, e volta a ficar elegível quando a instância for iniciada novamente.
Ocultações antigas que guardavam apenas a chave expiram na migração, pois não registravam a partida associada.
Com o Início aberto, recuperar o foco da janela ou voltar à visibilidade também relê mundos e servidores,
mesmo sem mudança na lista de instâncias. Isso permite incorporar servidores salvos durante uma partida.
Essa seleção ainda usa o primeiro servidor salvo por instância; não acompanha qual foi acessado dentro do jogo.
`bun run verificar:inicio` exercita a navegação real do App com IPC simulado no navegador; não substitui
conferir os serviços e os arquivos locais na janela nativa.

## Ambiente e comandos

Use Bun, nunca npm. Consulte `package.json` antes de inventar scripts. A CI usa Bun 1.3.5 e Rust 1.99.0
com `rustfmt` e `clippy`. No Windows, tenha WebView2 e ferramentas C++ necessárias ao Rust/Tauri. No Linux,
tenha os pacotes de desenvolvimento do WebKitGTK 4.1 (`libwebkit2gtk-4.1-dev`) além de `librsvg2-dev`,
`libgtk-3-dev` e `patchelf` para empacotar. Execute na raiz do launcher:

```powershell
bun install --frozen-lockfile
bun run dev
```

`bun run dev` abre o Tauri; `bun run vite` inicia somente o frontend e não valida IPC, disco ou login nativo.
`bun run tauri:build` gera o bundle. Variáveis públicas podem ficar em `.env.local`; veja a `API.md`.
Não coloque segredos em código, exemplos, logs ou no bundle.

A biblioteca Rust usa somente `rlib` porque os alvos atuais são desktop. `main.rs` gera o contexto Tauri e
o passa para `aplicacao::bootstrap::run`; mantenha a incorporação dos assets nessa entrada para evitar recompilar
o backend inteiro quando apenas a interface mudar. Uma futura implementação mobile deverá rever os tipos
de biblioteca e a entrada exigida pelo Tauri.

## Convenções de implementação

- Responda e escreva comentários em português do Brasil. Use nomes em português quando coerente, preservando
  identificadores públicos e contratos existentes.
- Ao criar pastas, use nomes convencionais reconhecidos por temas de ícones: `components`, `services`,
  `hooks`, `utils`, `assets`, `store` e `routes`. Não renomeie pastas existentes só para uniformizar.
- Prefira funções curtas, cláusulas de guarda, composição e módulos coesos. Evite duplicação, arquivos gigantes
  e abstrações especulativas. Não reformate arquivos sem relação com a tarefa.
- Use quatro espaços e linhas de até 120 caracteres no código novo quando compatível com o formatador.
  Preserve o resultado exigido por `cargo fmt`.
- Tipos devem representar o contrato real. Evite `any` e casts que escondam incompatibilidades.
  Diferencie campo ausente, `null` e lista vazia.
- Documente APIs públicas quando o uso não for evidente, explicando quando usá-las: rustdoc no Rust,
  JSDoc/TSDoc no TypeScript e KDoc se houver Kotlin. Evite comentários que apenas repitam o código.

## Interface

- Reaproveite componentes, fontes, ícones pixelados e assets existentes; preserve a identidade Minecraft.
- Evite cabeçalhos autoexplicativos, textos redundantes e controles com funções ambíguas.
- Diferencie carregamento, vazio, erro e sucesso, com mensagens úteis e sem dados sensíveis.
- Separe conteúdo rolável de cabeçalhos/rodapés opacos que não encolhem. Reutilize
  `AreaRolagemPersonalizada` quando apropriado; verifique sobreposição e a janela mínima em `tauri.conf.json`.
- Confira foco, teclado e feedback dos controles. Remova listeners, timers e conexões no cleanup dos efeitos.
- Preserve sanitização de HTML/Markdown externo e carregamento sob demanda de telas.
- Valide assets em produção: caminhos aceitos pelo Vite podem falhar no bundle ou na CSP.

O painel social mantém o botão de recolher/abrir, a lista, os compartilhamentos e o chat montados ao alternar
o recolhimento. O botão permanece no canto inferior direito, inclusive durante a animação.
A largura interna acompanha a largura animada do contêiner; não altere as duas larguras de forma independente.
Preserve a aba selecionada e não refaça consultas por essa alternância.
`bun run verificar:recolhimento-social` exercita esse comportamento com sessão, IPC e Socket.IO simulados,
incluindo amostras durante a animação, cliques rápidos, duas resoluções, visitante e drawer.
Não substitui conferir a janela nativa com uma sessão real.

## Tauri, segurança e dados locais

Ao alterar um comando:

1. Implemente no domínio correspondente com `#[tauri::command]`.
2. Registre em `src-tauri/src/aplicacao/bootstrap.rs`; o registro atual não fica em `lib.rs`.
3. Atualize `invoke` e tipos de entrada/saída. Confira camelCase no IPC e serialização `serde`.
4. Valide IDs, caminhos, URLs e limites no Rust, mesmo que a interface também valide.
5. Revise capabilities/CSP somente se necessário, concedendo o mínimo de acesso.

Resolva alvos a partir da raiz permitida antes de apagar, mover ou extrair. Rejeite travessia de diretórios
e escapes por links. Não confie em caminhos de arquivos compactados, metadados de modpacks ou parâmetros da WebView.
Preserve a proteção DPAPI de contas/sessões no Windows; não reintroduza tokens em `localStorage`.
Não registre tokens, códigos OAuth ou URLs com token de download. Mantenha HTTP autenticado no Rust,
ressalvado o Socket.IO social já existente no frontend.

Use `spawn_blocking` para ZIP e I/O síncrono pesado. Evite segurar mutexes durante rede ou trabalho demorado.
Propague erros de rede/disco; só confirme conclusão após finalizar a operação. Trate arquivos parciais
e limpeza temporária explicitamente.

## Downloads e instâncias

`create_instance` reserva uma pasta exclusiva com sufixo numérico quando o nome normalizado já existe,
inclusive em criações simultâneas, e retorna o ID efetivamente criado. Instalações subsequentes de modpacks
devem usar esse retorno. Editar o nome na interface altera apenas `instance.json`, preservando a pasta e o ID
para evitar renomeações de diretórios bloqueados pelo jogo ou por outros processos.

Pelo Explorar, modpacks podem ser instalados novamente, inclusive na mesma versão. Modrinth/CurseForge usam
`create_instance` com `copiaModpack: true`; a publicação local da fonte Dome usa a mesma reserva de nomes.
Cada cópia recebe nome e pasta no padrão `LostSMP`, `LostSMP (1)`, `LostSMP (2)`, considerando nomes exibidos
e pastas ocupadas, inclusive instalações parciais ou simultâneas. Caracteres inválidos para pastas são adaptados.
Trocar versão a partir de uma instância continua operando somente naquela instância.
Na página do projeto, o selo `Instalada` considera todas as instâncias do mesmo projeto e fonte, inclusive
cópias renomeadas. O selo não bloqueia novas cópias; em uma troca de versão, somente a versão já instalada
na instância escolhida bloqueia a ação. A indicação é consultada novamente após concluir uma instalação.

O nome exibido pode ser salvo pelo botão Salvar ou por Enter; Escape cancela a edição. Renomear a pasta não
altera esse nome. A leitura das instâncias atualiza o ID e o caminho quando uma pasta é renomeada externamente.
`bun run verificar:copias-modpacks` exercita Explorar e edição com IPC simulado nas três fontes; os testes Rust
conferem reserva simultânea, publicação de cópias e persistência após renomear pastas. Não substituem instalar
um pacote remoto e abrir o jogo na janela nativa.

A exclusão de instâncias exige confirmação e continua em segundo plano. O progresso percentual e erros aparecem
em um indicador compacto, inclusive após navegar para outra aba. Exclusões adicionais aguardam em fila.

Na lista de conteúdo instalado, o evento nativo de arraste copia arquivos `.jar` para `mods` ou `.zip` para
`resourcepacks`/`shaderpacks`, conforme a categoria aberta. A importação preserva a origem, recusa arquivos inválidos
e nomes já existentes (inclusive a variante desativada) e informa resultados parciais. A lista recarrega após a cópia;
respostas antigas de identificação e atualização não devem substituir uma carga mais recente. Nome, Ativo e Versão
alternam a direção da ordenação. Ícone e nome abrem a página interna quando há projeto e fonte identificados.
Em Versão, o terceiro estado coloca atualizações disponíveis primeiro, mantendo o texto Versão e usando o ícone
de recarregar no lugar da seta de ordenação. O botão de versão de cada item com
atualização usa a cor de destaque do usuário e abre a escolha de versão; não há botão individual Atualizar na linha.
Os indicadores dos cabeçalhos ocupam um espaço fixo; alternar a ordenação mantém a posição do texto e a altura
do cabeçalho, sem remontar a lista nem consultar novamente o conteúdo. A verificação amostra essa transição por quadro.

Em Adicionar conteúdo, clicar no nome abre a página interna do projeto, preservando a instância de origem.
O restante do cartão marca o conteúdo para instalar depois; abrir o projeto não altera essa seleção.
O histórico guarda a instância e o contexto da visita: modo, busca, fonte, categorias, ordenação, resultados,
seleção e rolagem. Voltar e avançar restauram esse contexto, inclusive após visitar outra instância ou tela.
Somente o gerenciador visível pode interceptar a navegação interna; o gerenciador oculto na página do projeto
não deve consumir o clique em Voltar. O fluxo de Adicionar conteúdo também ocupa uma entrada no histórico.

A aba Configuração também aparece em instâncias Vanilla.
As seções Desempenho e Opções do Minecraft começam recolhidas; seus títulos abrem e fecham os controles,
preservando os campos e as edições em andamento ao recolher.
Distância de renderização e Limite de FPS oferecem listas com todos os valores inteiros aceitos pelo backend;
o limite de 260 FPS aparece como Ilimitado.
A roda do mouse ajusta os campos numéricos, incluindo a passagem entre Padrão do jogo e o mínimo.
Salvar Padrão do jogo remove apenas a chave conhecida correspondente de `options.txt`.
`configuracoes_jogo.rs` lê as opções conhecidas de `options.txt` e salva somente os campos alterados,
preservando atalhos, opções de mods e chaves desconhecidas.
A gravação substitui o arquivo por uma cópia temporária e exige que o Minecraft da instância esteja fechado.
`bun run verificar:conteudo-instancia` exercita a interface em 960×640 e escala de 150%, com IPC e eventos Tauri
simulados; não substitui arrastar arquivos do Explorador para a janela nativa nem conferir as opções dentro do jogo.

`aplicacao/downloads_instancias.rs` prepara cliente, bibliotecas e assets com até 32 transferências simultâneas.
O cache fica em `pasta_dados_launcher()/cache/arquivos-minecraft` (`%APPDATA%\dome` no Windows,
`~/.local/share/dome` no Linux), com chave SHA-1 do manifesto ou URL sem hash.
Requisições simultâneas pelo mesmo conteúdo compartilham o download.

Preserve validação de tamanho/hash do cache, escrita temporária seguida de renomeação e cópias independentes
por instância. Não use hardlinks que propaguem alterações. Arquivos já instalados são conferidos por tamanho
quando disponível; isso não é uma auditoria completa de integridade.

O cache ocupa espaço adicional, não expira automaticamente e pode ser removido sem instalações em andamento.
Instâncias antigas não alimentam o cache retroativamente. Forge/NeoForge ainda dependem de instaladores externos.
O Forge 1.12 e 1.12.2 usa perfis com `minecraftArguments`: o launcher extrai o perfil e o JAR do instalador,
prepara as bibliotecas na criação e reaproveita o mesmo ajuste ao iniciar instâncias existentes. Nesses perfis,
algumas bibliotecas ficam no Maven do Forge e outras no repositório de bibliotecas do Minecraft.
Compare desempenho com mesma versão/conexão e cache vazio/preenchido; testes HTTP locais não comprovam velocidade real.

Na instalação de modpacks Modrinth e CurseForge, inclusive pelo painel social, leia o manifesto do arquivo
selecionado antes de criar a instância. Use as versões exatas do Minecraft e do loader, respeitando `primary`
no CurseForge. Não substitua a versão declarada pela mais recente. Manifestos inválidos ou loaders não suportados
interrompem a instalação. Antes de substituir conteúdo, o Rust confere novamente os requisitos do arquivo baixado
contra a instância. Se forem diferentes, preserve o conteúdo e oriente instalar uma nova cópia.
O arquivo do modpack é consultado para os requisitos e baixado novamente na instalação; não há cache entre essas etapas.
Os testes de requisitos e `bun run verificar:copias-modpacks` cobrem o Forge 47.4.10 em dados controlados,
sem comprovar a execução nativa do Gravitas² 0.9.4.

A instalação de mods compara os identificadores declarados nos metadados dos JARs, sem aliases de compatibilidade.
Versões anteriores do mesmo conjunto de mods, inclusive desativadas, são substituídas após o download completo.
Falhas na publicação restauram os arquivos preservados. Arquivos sem identidade reconhecida só são substituídos
quando o nome coincide. Essa comparação evita duplicação, mas não valida as restrições de versão de todos os mods locais.

## Protótipo de diagnóstico de crashes

`aplicacao/diagnostico_crash.rs` fotografa os logs antes de iniciar o Java e acompanha o código de saída durante
toda a execução. O lançamento redireciona stdout/stderr para `logs/dome-console.log`, recriado a cada partida;
esse arquivo permite investigar falhas anteriores à criação de `latest.log`, sem usar pipes que dependam do launcher.
São lidos apenas logs novos/alterados da sessão: console, latest/debug, até quatro relatórios recentes e `hs_err_pid*`.
Arquivos antigos intactos e trechos anteriores de logs apenas acrescidos são ignorados. A leitura usa os últimos
2 MiB de cada arquivo, com validação de caminhos dentro da instância.

`origem_crash.rs` examina blocos fatais e causas profundas, relacionando entrypoints, mixins, arquivos e classes aos
metadados locais de Fabric, Quilt, Forge/NeoForge e Forge legado. `indice_mods_crash.rs` inspeciona os JARs habilitados
sem executar código, incluindo bibliotecas embutidas até dois níveis, 16 MiB por JAR interno e 64 MiB por mod externo.
Empates permanecem como candidatos; a interface mostra causa provável, confiança e evidências. Memória, Java incompatível
e falhas nativas são categorias separadas, sem atribuição automática a um mod.

`relacoes_crash.rs` conserva os mods nas chamadas contíguas da causa profunda e o dono da classe alvo de um mixin
que falhou, conferindo a classe nos JARs locais. O campo opcional `mods[].relacao` distingue `chamada` e `alvoMixin`
da origem provável. A presença na mesma falha não prova responsabilidade individual nem incompatibilidade formal.
Anotações `pl:mixin:APP` em frames só enumeram transformações aplicadas; não são evidência de falha desses mixins.
O identificador depois de `from mod` termina no primeiro separador, sem absorver nomes da classe alvo.

Saída zero sem relatório fatal novo indica fechamento normal. Um relatório recuperado seguido de `Stopping!` também
respeita a saída zero. A exceção é um relatório novo de erro no carregamento dos mods: o Forge pode mostrar
`Error loading mods` e encerrar com código zero ao fechar essa tela, sem ter conseguido abrir o jogo.
Nesse caso, o relatório com `Description: Mod loading...` e `Failure message:` prevalece sobre `Stopping!`.
Parar pelo launcher registra intenção junto do encerramento do PID e não gera alerta de crash.
Falha ao consultar o processo fica indeterminada; saída anormal sem evidência causal informa
`A origem do crash não foi encontrada.`. Encerramento externo forçado pode ser indistinguível de um crash sem logs.

`obter_diagnostico_crash` consulta o último resultado em memória e `dome:diagnostico-crash` comunica início/encerramento.
A aba Logs exibe o resultado; o aviso global aparece somente em crash. Reiniciar o launcher perde o resultado e não
recupera o código de saída de jogos já abertos. O protótipo não promete identificar todos os crashes nem mede taxa de acerto.
`bun run verificar:crash` exercita a interface com IPC/eventos simulados; os testes Rust usam sessões e JARs sintéticos.
Essas verificações não substituem abrir/fechar e reproduzir crashes reais no Minecraft/WebView2.

Em 19–20/10/2026, foram conferidos na janela nativa Minecraft 26.2/Fabric 0.19.5 e Minecraft 1.20.1/Forge 47.4.23,
com ImmediatelyFast 1.5.4+1.20.4 incompatível e Antique Atlas 8.0.1 sem UnionLib. A rodada detectou e corrigiu o falso
negativo do Forge com saída zero; a repetição real identificou Antique Atlas. Os controles com Quit Game, inclusive
com os relatórios fml antigos presentes, e ENCERRAR pelo launcher não geraram alerta de crash.
O relatório local e os logs ficaram em `testing/crashes-reais/RELATORIO.md` (pasta ignorada pelo Git).
Esses casos cobrem inicialização e menu; não comprovam crashes em mundos/servidores nem execução real de NeoForge/Quilt.

Em 20/10/2026 também foram reproduzidas duas falhas silenciosas de inicialização no Fabric 26.2: Survive 10.2.0-beta
com UnionLib 13.3 (NPE na criação de armadura) e EMF Compat Core 1.1.2 com EMF 3.3.7/ETF 7.2.3 (método alvo de
mixin ausente). Os processos encerraram automaticamente antes do menu, sem tela explicativa do loader.
Os logs e JARs reais foram reanalisados depois da correção das relações. Após uma interrupção por acesso negado
na automação, as duas falhas foram repetidas e conferidas na interface nativa: autor/alvo do mixin e mods da mesma
chamada apareceram separados, com saída -1. EMF/ETF sem EMF Compat e Fabric API sozinho abriram o menu e fecharam
normalmente, mantendo os relatórios antigos. UnionLib sozinho abriu o menu, mas o watchdog interrompeu seu fechamento
com saída -8; o detector ficou inconclusivo, sem atribuir origem apenas pelo thread dump. Consulte
`testing/conflitos-mods/RELATORIO.md` para separar falha de inicialização, falha no encerramento e controles normais.
Para reanalisar um corpus local sem iniciar o jogo, `DOME_CORPUS_CRASH` aponta para um JSON com capturas
(`raiz`, `log`, `principais`, `relacionados`); execute `cargo test --manifest-path src-tauri/Cargo.toml
reanalisa_corpus_local_com_mods_reais -- --ignored --nocapture`. Esse teste é ignorado na CI por depender dos JARs locais.

## Validação e entrega

Para alterações de código, execute:

```powershell
bun run verificar
bun audit
git diff --check
```

`verificar` executa build TypeScript/Vite, `cargo fmt --check`, Clippy com warnings como erro e testes Rust.
Para mudanças exclusivamente documentais, confira conteúdo, caminhos, links e `git diff --check`, sem exigir build.
Adicione testes para comportamento/regressões relevantes, sem testes que apenas espelhem a implementação.
Mudanças em autenticação, Java, instâncias, importação e modpacks também precisam de validação no aplicativo.
Informe exatamente quando conta, serviço ou ambiente impedir um teste; não declare verificações não executadas.

Para skins, modelos ou CSP, execute `bun run verificar:skins`. No Windows, o script requer Edge e Node.js 22.18+
para comunicação do Playwright, mas continua sendo invocado por Bun. Em outros sistemas, instale o navegador
com `bunx playwright install chromium` se necessário. `DOME_CAPTURA_SKINS` aceita um caminho PNG.
O teste verifica os modelos clássico/slim no build de produção e a necessidade de `data:` em `connect-src`
para buffers GLTF lidos por `fetch`. Não substitui conferir o instalador no WebView2.

A aba de skins consulta o perfil uma vez por minuto por conta e compartilha consultas entre montagens da tela.
A última textura carregada fica salva por UUID para preservar a prévia durante falhas, incluindo HTTP 429.
Alterações de skin ou capa forçam nova consulta. A abertura não usa Steve como textura provisória.

Ao concluir, informe mudanças, validação e limitações reais. Forneça título de commit e descrição em português.
Não crie commit, push, tag ou release apenas por terminar uma edição.

## Release

Quando a tarefa incluir publicação, trabalhe por branch/PR, sem commit direto na `main`. Confira repositório
e branch de origem do PR, especialmente em forks. Integre o PR na `main`.

Antes da release: instalação congelada, auditoria, `bun run verificar` e `git diff --check`.
Mantenha versões iguais em `package.json`, `src-tauri/Cargo.toml` e `src-tauri/tauri.conf.json`, atualizando
o lockfile Rust quando necessário.

O commit de release (ex: `release: Dome Launcher v0.3.3`) integrado na `main` dispara a publicação após o sucesso
do workflow `validar-launcher` daquele commit. O push de tag `v*` e o disparo manual também acionam
`release-launcher.yml`. Nesses casos, a CI reaproveita somente a aprovação de um push na `main` com o mesmo SHA
e repositório; sem essa aprovação, executa Clippy e testes nas duas plataformas antes de empacotar.
A validação Windows de um push na `main` guarda `dist` no artefato `frontend-producao`. A release pode
reutilizá lo nas duas plataformas somente quando ele pertence à execução aprovada do mesmo SHA e não expirou.
`src-tauri/tauri.ci.conf.json` desativa o comando de frontend apenas nesse caso. Sem o artefato, o build Tauri
executa normalmente TypeScript e Vite. A interface atual não depende de variáveis de plataforma do Tauri;
se isso mudar, a reutilização entre plataformas deverá ser revista.

O workflow valida a sincronização das 3 versões, cria e envia a tag remota caso ainda não exista e compila
Windows e Linux em paralelo. Os instaladores NSIS, `.deb` e `.AppImage` e suas assinaturas são transferidos
como artefatos para uma etapa única de publicação. `scripts/gerar-manifesto-atualizacao.ts` exige os três
instaladores assinados e preserva as notas do commit no `latest.json`. Uma release nova permanece como rascunho
até todos os uploads terminarem. Chaves de assinatura pertencem aos secrets da CI.

`.github/actions/preparar-compilacao/action.yml` centraliza Bun, Rust e caches. Pacotes baixados ficam em um
cache separado dos resultados Cargo. Validação preserva somente `target/debug`; release preserva somente
`target/release`, excluindo bundles e arquivos incrementais. Isso reduz transferências e impede que uma
validação sem resultados de release substitua o cache usado para publicar. Sistema operacional, arquitetura,
versão Rust, perfil, manifestos e commit participam das chaves; o Cargo confere novamente os dados restaurados.

O `sccache` 0.18.0 guarda unidades compiladas no serviço de cache do GitHub e publica suas estatísticas nos logs.
Ele complementa o cache de diretórios quando o Cargo precisa recompilar dependências. Erros de comunicação
com o servidor permitem compilar sem esse reaproveitamento. Na CI, compilação incremental e informações
de depuração dos perfis `dev` e `test` ficam desativadas; as asserções e os testes continuam ativos.
Essas opções não alteram o perfil local nem reduzem a otimização do executável de release.

Caches de tags diferentes não são compartilhados pelo GitHub; a branch principal pode alimentar novas tags.
A primeira execução e mudanças de compilador ou dependências ainda podem exigir compilação completa.
Ao atualizar Rust ou sccache, revise versões e chaves na ação local. A release guarda o relatório Cargo no
artefato `tempos-compilacao` de cada plataforma. Compare execuções com estados de cache equivalentes.

No modelo atual, `frontendDist` é incorporado ao executável pelo Tauri. `tauri bundle` pode empacotar um binário
já compilado, mas não atualiza os arquivos da interface incorporados nele. Reutilizar esse executável entre
releases com interfaces diferentes exigiria servir a interface separadamente e rever instalação, CSP,
compatibilidade com os comandos Rust e atualização assinada. O cache de dependências é o reaproveitamento
adotado sem alterar essa arquitetura. Separar o contexto no executável permite reutilizar a biblioteca quando
seus inputs permanecem iguais, mas alterações de versão, configuração ou código Rust ainda podem invalidar
esse resultado. O ganho real deve ser medido em uma execução remota do novo workflow.

O smoke test deve cobrir instalação limpa no Windows sem ferramentas de desenvolvimento, login Microsoft,
Vanilla/Fabric/Forge/NeoForge, seleção/instalação de Java, Modrinth/CurseForge, mundo local, conexão a servidor,
importação/exportação/sync, login Discord, amigos, chat e encerramento de sessão. Valide atualização assinada
com uma versão de teste. No Linux, valide o `.deb`/`.AppImage` em instalação limpa e o lançamento nativo do jogo.
Só declare publicação após o workflow terminar e os assets remotos serem conferidos.
Detecção da atualização, interação para instalar e disponibilidade do pacote são verificações distintas.
No Windows, o NSIS instala para o usuário atual (`bundle.windows.nsis.installMode: currentUser`) e o updater
aplica atualizações silenciosamente (`plugins.updater.windows.installMode: quiet`). O plugin envia `/S` e `/R`
ao instalador: o aplicativo encerra durante a instalação e o NSIS solicita a abertura da versão nova ao concluir.
O reinício após `downloadAndInstall` atende o Linux; no Windows, essa chamada não retorna ao frontend.
Valide download, instalação silenciosa e reabertura com duas versões assinadas antes de confirmar o fluxo real.
A descrição publicada no `latest.json` é guardada antes da instalação e exibida uma única vez, em um modal de
novidades, quando a versão instalada for aberta pela primeira vez. Preserve esse vínculo com `releaseBody`.

As notas versionadas em `.github/releases/vX.Y.Z.md` têm prioridade sobre a mensagem do commit para o corpo da release e do manifesto. Isso preserva as novidades mesmo em merges que alteram a descrição do commit.
