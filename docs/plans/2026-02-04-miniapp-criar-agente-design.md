# Mini App: Criar Agente

## Resumo

Telegram Mini App em Preact que substitui o fluxo atual de 7 passos de botões inline por um formulário único para criar agentes.

## Contexto

O fluxo atual de criação de agentes usa botões inline do Telegram:
```
nome → tipo → emoji → modo → workspace → model-mode → confirmação
```

Problemas:
- 7 mensagens separadas para uma única operação
- Callback data limitado a 64 bytes
- Mistura confusa de botões + input de texto
- Emoji limitado a 12 opções fixas
- Workspace limitado a presets ou texto livre sem navegação

## Solução

Mini App com formulário único, todos os campos visíveis, validação inline.

## Arquitetura

```
┌─────────────────────────────────────────┐
│           Telegram Mini App             │
│  (Preact + Vite, servido em /miniapp)   │
└─────────────────┬───────────────────────┘
                  │ HTTP requests
                  │ (validação via initData)
                  ▼
┌─────────────────────────────────────────┐
│          Backend Atual (Bun)            │
│  - POST /api/miniapp/agents (criar)     │
│  - GET /api/miniapp/workspaces (listar) │
└─────────────────┬───────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────┐
│     AgentManager + StateManager         │
│        (lógica existente)               │
└─────────────────────────────────────────┘
```

### Autenticação

Cada request inclui o `initData` do Telegram no header `X-Telegram-Init-Data`. Backend valida a assinatura HMAC usando o bot token. Se válido, extrai `user.id` e `chat.id`.

### Onde Abre

- No chat privado via `/criar`
- No grupo durante onboarding (quando bot é adicionado)

## Interface

### Formulário Principal

```
┌─────────────────────────────────────┐
│  Criar Agente                       │
├─────────────────────────────────────┤
│                                     │
│  Nome                               │
│  ┌─────────────────────────────┐   │
│  │ backend api                 │   │
│  └─────────────────────────────┘   │
│                                     │
│  Emoji                              │
│  [🤖] [⚡] [🔧] [🎯] [🧠] [✨]      │
│  [📊] [🚀] [💻] [🔍] [📁] [outro]  │
│                                     │
│  Tipo                               │
│  ● Claude    ○ Bash                 │
│                                     │
│  Modo                               │
│  ● Conversacional    ○ Ralph        │
│                                     │
│  Workspace                          │
│  ┌─────────────────────────────┐   │
│  │ 🏠 Home             [📂]    │   │
│  └─────────────────────────────┘   │
│  Atalhos: [Sandbox] [Desktop]       │
│                                     │
│  Modelo                             │
│  ○ Escolher por prompt              │
│  ○ Sempre Haiku                     │
│  ○ Sempre Sonnet                    │
│  ○ Sempre Opus                      │
│                                     │
│  ┌─────────────────────────────┐   │
│  │         Criar               │   │
│  └─────────────────────────────┘   │
│                                     │
└─────────────────────────────────────┘
```

### Interações

- **Nome**: Input de texto, validação inline (não vazio)
- **Emoji**: Grid clicável. "Outro" abre emoji picker nativo
- **Tipo/Modo/Modelo**: Radio buttons
- **Workspace**: Campo mostra path atual + botão [📂] abre file browser modal. Atalhos são chips clicáveis

### Cores

Usa variáveis CSS do Telegram para integrar com tema do usuário:
- `var(--tg-theme-bg-color)`
- `var(--tg-theme-text-color)`
- `var(--tg-theme-button-color)`
- `var(--tg-theme-button-text-color)`

## File Browser Modal

```
┌─────────────────────────────────────┐
│  ← Selecionar Pasta                 │
├─────────────────────────────────────┤
│  📍 /Users/lucas/Desktop            │
├─────────────────────────────────────┤
│  📁 ..                              │
│  📁 claude-terminal                 │
│  📁 projects                        │
│  📁 sandbox                         │
│  📄 notes.txt              (dimmed) │
│  📄 todo.md                (dimmed) │
├─────────────────────────────────────┤
│  ┌─────────────────────────────┐   │
│  │     Selecionar esta pasta   │   │
│  └─────────────────────────────┘   │
└─────────────────────────────────────┘
```

### Comportamento

- Mostra diretórios clicáveis (navegação)
- Arquivos aparecem dimmed (não clicáveis, só contexto)
- `..` volta pro diretório pai
- Breadcrumb no topo mostra path atual
- "Selecionar esta pasta" confirma o diretório atual
- ← fecha modal sem alterar
- Sem restrições de navegação

## API Endpoints

### POST /api/miniapp/agents

Criar agente.

Request:
```json
{
  "name": "backend api",
  "emoji": "⚡",
  "type": "claude",
  "mode": "conversational",
  "workspace": "/Users/lucas/Desktop/claude-terminal",
  "modelMode": "selection"
}
```

Response:
```json
{
  "success": true,
  "agent": { "id": "abc123", "name": "backend api", "emoji": "⚡" }
}
```

### GET /api/miniapp/browse?path=/Users/lucas

Listar diretório.

Response:
```json
{
  "current": "/Users/lucas",
  "parent": "/Users",
  "directories": ["Desktop", "Documents", "Downloads"],
  "files": ["notes.txt", ".zshrc"]
}
```

### GET /api/miniapp/presets

Atalhos de workspace.

Response:
```json
{
  "presets": [
    { "label": "Home", "path": "/Users/lucas", "emoji": "🏠" },
    { "label": "Desktop", "path": "/Users/lucas/Desktop", "emoji": "🖥️" },
    { "label": "Sandbox", "path": "/Users/lucas/.claude-sandbox", "emoji": "🧪" }
  ]
}
```

## Tela de Sucesso

```
┌─────────────────────────────────────┐
│                                     │
│              ✓                      │
│                                     │
│     ⚡ backend api criado           │
│                                     │
│     workspace:                      │
│     ~/Desktop/claude-terminal       │
│                                     │
│     modelo: escolher por prompt     │
│                                     │
│  ┌─────────────────────────────┐   │
│  │          Fechar             │   │
│  └─────────────────────────────┘   │
│                                     │
└─────────────────────────────────────┘
```

Ao clicar "Fechar": `Telegram.WebApp.close()`, volta pro chat.

## Integração com Bot

### Mensagem após criar

**Se criou do grupo**:
```
✅ ⚡ backend api criado e vinculado

!haiku, !sonnet ou !opus antes do prompt
qual a primeira tarefa?
```

**Se criou do privado**:
```
✅ ⚡ backend api criado

/link num grupo pra vincular
ou manda um prompt aqui
```

### Como abre o Mini App

Substitui botões inline por botão de Mini App:

```typescript
await sendTelegramMessage(chatId, "criar agente:", {
  reply_markup: {
    inline_keyboard: [[
      { text: "Abrir formulário", web_app: { url: "https://seudominio.com/miniapp/" } }
    ]]
  }
});
```

## Estrutura de Arquivos

```
claude-terminal/
├── src/
│   ├── index.ts              # adiciona rotas /api/miniapp/*
│   ├── miniapp/
│   │   ├── routes.ts         # handlers das rotas da API
│   │   ├── auth.ts           # validação do initData
│   │   └── browse.ts         # lógica do file browser
│   └── ...
├── miniapp/                   # código do Mini App (Preact)
│   ├── index.html
│   ├── src/
│   │   ├── main.tsx          # entry point
│   │   ├── App.tsx           # componente principal
│   │   ├── components/
│   │   │   ├── NameInput.tsx
│   │   │   ├── EmojiPicker.tsx
│   │   │   ├── RadioGroup.tsx
│   │   │   ├── WorkspaceField.tsx
│   │   │   ├── FileBrowser.tsx
│   │   │   └── SuccessScreen.tsx
│   │   ├── api.ts            # chamadas HTTP
│   │   └── telegram.ts       # wrapper do Telegram.WebApp
│   ├── vite.config.ts
│   └── package.json          # dependências separadas
└── dist/
    └── miniapp/              # build estático (servido pelo Bun)
```

## Mudanças no Código Existente

### Adicionar

- `src/miniapp/routes.ts`: handlers dos endpoints
- `src/miniapp/auth.ts`: validação initData do Telegram
- `src/miniapp/browse.ts`: listagem de diretórios
- `miniapp/`: projeto Preact completo

### Modificar

- `index.ts`: adicionar rotas `/api/miniapp/*` e servir arquivos estáticos de `dist/miniapp/`
- `telegram.ts`: função `sendTelegramMiniAppButton()` para enviar botão de Mini App

### Remover (opcional, depois de validar)

- Estados de fluxo de criação no `UserContextManager` (não mais necessários)
- Funções `sendTelegramAgentNamePrompt`, `sendTelegramEmojiSelector`, etc.

## Dependências

```json
// miniapp/package.json
{
  "dependencies": {
    "preact": "^10.x"
  },
  "devDependencies": {
    "vite": "^5.x",
    "@preact/preset-vite": "^2.x",
    "typescript": "^5.x"
  }
}
```

## Requisitos de Deploy

- HTTPS obrigatório (Telegram exige para Mini Apps)
- Domínio configurado no BotFather como Mini App
- Build do Preact antes de deploy: `cd miniapp && bun run build`
