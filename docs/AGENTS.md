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
Windows é o alvo atual de release.

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
| `src-tauri/tauri.conf.json`, `src-tauri/capabilities/` | Bundle, CSP, updater e permissões |
| `vite.config.ts` | Build e configuração social pública |
| `.github/workflows/` | Validação e publicação |

## Ambiente e comandos

Use Bun, nunca npm. Consulte `package.json` antes de inventar scripts. A CI usa Bun 1.3.5 e Rust estável
com `rustfmt` e `clippy`. No Windows, tenha WebView2 e ferramentas C++ necessárias ao Rust/Tauri.
Execute na raiz do launcher:

```powershell
bun install --frozen-lockfile
bun run dev
```

`bun run dev` abre o Tauri; `bun run vite` inicia somente o frontend e não valida IPC, disco ou login nativo.
`bun run tauri:build` gera o bundle. Variáveis públicas podem ficar em `.env.local`; veja a `API.md`.
Não coloque segredos em código, exemplos, logs ou no bundle.

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

`aplicacao/downloads_instancias.rs` prepara cliente, bibliotecas e assets com até 32 transferências simultâneas.
O cache fica em `%APPDATA%/dome/cache/arquivos-minecraft`, com chave SHA-1 do manifesto ou URL sem hash.
Requisições simultâneas pelo mesmo conteúdo compartilham o download.

Preserve validação de tamanho/hash do cache, escrita temporária seguida de renomeação e cópias independentes
por instância. Não use hardlinks que propaguem alterações. Arquivos já instalados são conferidos por tamanho
quando disponível; isso não é uma auditoria completa de integridade.

O cache ocupa espaço adicional, não expira automaticamente e pode ser removido sem instalações em andamento.
Instâncias antigas não alimentam o cache retroativamente. Forge/NeoForge ainda dependem de instaladores externos.
Compare desempenho com mesma versão/conexão e cache vazio/preenchido; testes HTTP locais não comprovam velocidade real.

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

Ao concluir, informe mudanças, validação e limitações reais. Forneça título de commit e descrição em português.
Não crie commit, push, tag ou release apenas por terminar uma edição.

## Release

Quando a tarefa incluir publicação, trabalhe por branch/PR, sem commit direto na `main`. Confira repositório
e branch de origem do PR, especialmente em forks. Integre o PR na `main` antes de criar a tag.

Antes da tag: instalação congelada, auditoria, `bun run verificar` e `git diff --check`.
Mantenha versões iguais em `package.json`, `src-tauri/Cargo.toml` e `src-tauri/tauri.conf.json`, atualizando
o lockfile Rust quando necessário. A tag `v*` dispara `release-launcher.yml`, que verifica versões, compila
e publica NSIS e `latest.json`. Chaves de assinatura pertencem aos secrets da CI.

O smoke test deve cobrir instalação limpa no Windows sem ferramentas de desenvolvimento, login Microsoft,
Vanilla/Fabric/Forge/NeoForge, seleção/instalação de Java, Modrinth/CurseForge, mundo local, conexão a servidor,
importação/exportação/sync, login Discord, amigos, chat e encerramento de sessão. Valide atualização assinada
com uma versão de teste. Só declare publicação após o workflow terminar e os assets remotos serem conferidos.
Detecção da atualização, interação para instalar e disponibilidade do pacote são verificações distintas.
A descrição publicada no `latest.json` é guardada antes da instalação e exibida uma única vez, em um modal de
novidades, quando a versão instalada for aberta pela primeira vez. Preserve esse vínculo com `releaseBody`.
