# Componentes da Instância

Este diretório contém os componentes adaptados do repositório `code-main` para gerenciamento de instâncias do launcher.

## Componentes Disponíveis

### Overview
Componente básico que exibe informações gerais da instância.

```tsx
import { Overview } from './pages/instance'

<Overview
  instance={gameInstance}
  options={contextMenuOptions}
  offline={false}
  playing={true}
  versions={[]}
  installed={true}
/>
```

### Mods
Componente para gerenciamento de mods da instância, incluindo instalação, atualização e remoção.

O gerenciador principal também oferece `Adicionar conteúdo` para mods, resource packs e shaders. A busca aplica a
versão do Minecraft e o loader da instância automaticamente e permite filtros adicionais. O botão `Instalar` baixa
o conteúdo imediatamente com suas dependências obrigatórias; clicar no cartão marca o item para uma fila revisável.
Na fila, as dependências aparecem na revisão e são instaladas antes do item principal.

```tsx
import { Mods } from './pages/instance'

<Mods
  instance={gameInstance}
  options={contextMenuOptions}
  offline={false}
  playing={false}
  versions={versions}
  installed={true}
/>
```

### Logs
Componente para visualização e gerenciamento de logs da instância.

```tsx
import { Logs } from './pages/instance'

<Logs
  instance={gameInstance}
  options={contextMenuOptions}
  offline={false}
  playing={true}
  versions={[]}
  installed={true}
/>
```

### Worlds
Componente para gerenciamento de mundos locais.

```tsx
import { Worlds } from './pages/instance'

<Worlds
  instance={gameInstance}
  options={contextMenuOptions}
  offline={false}
  playing={false}
  versions={[]}
  installed={true}
/>
```

### Servidores
Componente usado pela aba Servidores para listar, verificar, adicionar, remover e acessar os servidores salvos
na lista multiplayer de uma instância.

```tsx
import { Servidores } from './pages/instance'

<Servidores instanceId={instanceId} />
```

### ContextMenu
Menu de contexto reutilizável para ações nos componentes.

```tsx
import ContextMenu from './components/ui/ContextMenu'

<ContextMenu
  shown={showMenu}
  options={menuOptions}
  item={selectedItem}
  onMenuClosed={() => setShowMenu(false)}
  onOptionClicked={(data) => handleOptionClick(data)}
>
  {/* Conteúdo do menu */}
</ContextMenu>
```

## Interfaces

Todos os tipos estão definidos em `src/types.ts`. As principais interfaces incluem:

- `GameInstance`: Representa uma instância do jogo
- `ProjectListEntry`: Representa um mod/projeto na lista
- `World`: Representa um mundo ou servidor
- `LogEntry`: Representa uma entrada de log
- `MenuOption`: Opção do menu de contexto

## Notas de Adaptação

Estes componentes foram adaptados do Vue.js (do repositório code-main) para React/TypeScript. Algumas funcionalidades podem precisar de implementação adicional:

1. **Composables Vue**: Lógica de estado e hooks foram convertidos para hooks React
2. **Bibliotecas específicas**: Algumas bibliotecas específicas do Vue podem precisar de alternativas React
3. **APIs do Tauri**: Chamadas para APIs nativas podem precisar de ajustes
4. **Estilos**: Estilos SCSS foram convertidos para CSS inline ou podem ser extraídos

Para uso completo, pode ser necessário implementar:
- Hooks personalizados para gerenciamento de estado
- Serviços para comunicação com APIs
- Utilitários para processamento de dados
- Integração completa com o backend do launcher
