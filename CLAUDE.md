# Claude Terminal

WhatsApp como interface para múltiplos agentes Claude Code. Cada agente é uma sessão independente com contexto próprio.

## Arquitetura

```
                                    ┌─────────────────────────────────────────┐
                                    │              Claude Terminal            │
                                    ├─────────────────────────────────────────┤
WhatsApp ──→ Kapso ──→ Tailscale ──→│  Webhook Handler (index.ts)             │
                                    │         │                               │
                                    │         ▼                               │
                                    │  UserContextManager ←→ AgentManager     │
                                    │  (multi-step flows)    (CRUD, state)    │
                                    │         │                               │
                                    │         ▼                               │
                                    │  QueueManager ←→ Semaphore              │
                                    │  (priority queue)  (concurrency)        │
                                    │         │                               │
                                    │         ▼                               │
                                    │  ClaudeTerminal (SDK sessions)          │
                                    └─────────────────────────────────────────┘
                                              │
WhatsApp ←── Kapso ←──────────────────────────┘
```

## Conceitos

### Agentes

Cada agente é uma sessão Claude independente:
- **Nome**: identificador do usuário (ex: "API Backend")
- **Workspace**: diretório de trabalho opcional
- **Sessão**: ID do Claude SDK, mantido entre mensagens
- **Prioridade**: high/medium/low para ordenação na fila
- **Status**: idle/processing/error
- **Outputs**: últimas 10 respostas (FIFO)

### Fila com Prioridade

Tasks são ordenadas por:
1. Prioridade (high=0, medium=1, low=2)
2. Timestamp (FIFO dentro da mesma prioridade)

### Controle de Concorrência

O `Semaphore` limita execuções simultâneas:
- **Modo limitado**: 1-N permits configuráveis
- **Modo ilimitado**: maxPermits=0 desabilita limite

### Fluxos Conversacionais

O `UserContextManager` rastreia estados multi-step:
- Criação de agente (nome → workspace → confirmação)
- Configuração de prioridade
- Configuração de limite de concorrência
- Deleção de agente

## Estrutura

```
src/
├── index.ts              # Servidor HTTP, webhook handler, orquestração
├── types.ts              # Tipos e interfaces do sistema
├── agent-manager.ts      # CRUD de agentes, persistência, estado
├── queue-manager.ts      # Fila prioritária, processamento de tasks
├── semaphore.ts          # Controle de concorrência (bounded/unbounded)
├── terminal.ts           # Wrapper do Claude SDK com sessões
├── user-context-manager.ts  # Estado conversacional multi-step
├── whatsapp.ts           # Cliente Kapso (menus interativos, botões)
├── persistence.ts        # Serialização/deserialização de estado
├── storage.ts            # S3 storage para arquivos
└── title-extractor.ts    # Extração de títulos de respostas
```

## Comandos WhatsApp

| Comando | Descrição |
|---------|-----------|
| `/criar` | Criar novo agente |
| `/agentes` | Listar agentes do usuário |
| `/selecionar` | Trocar agente ativo |
| `/deletar` | Remover agente |
| `/prioridade` | Configurar prioridade do agente |
| `/limite` | Configurar limite de concorrência |
| `/status` | Ver status da fila |
| `#opus` ou `#haiku` | Selecionar modelo (prefixo) |

## Modelos de Dados

```typescript
interface Agent {
  id: string;
  userId: string;           // Telefone do usuário
  name: string;
  workspace?: string;
  sessionId?: string;       // ID da sessão Claude SDK
  title: string;            // Título auto-gerado
  status: 'idle' | 'processing' | 'error';
  priority: 'high' | 'medium' | 'low';
  messageCount: number;
  outputs: Output[];        // Últimas 10 respostas
}

interface QueueTask {
  id: string;
  agentId: string;
  prompt: string;
  model: 'haiku' | 'opus';
  priority: number;         // 0=high, 1=medium, 2=low
  timestamp: Date;
  userId: string;
}
```

## Setup

```bash
# Instalar dependências
bun install

# Desenvolvimento (hot reload)
bun run dev

# Produção
bun run start

# Testes
bun test
```

### Variáveis de Ambiente

```env
KAPSO_API_KEY=xxx          # API key do Kapso
KAPSO_PHONE_ID=xxx         # ID do telefone no Kapso
AWS_ACCESS_KEY_ID=xxx      # Para S3 storage
AWS_SECRET_ACCESS_KEY=xxx
S3_BUCKET=xxx
```

### Expor Servidor

```bash
tailscale funnel 3000
```

Configurar URL do funnel como webhook no Kapso.

## Fluxo de Mensagem

```
1. Webhook recebe mensagem
2. UserContextManager verifica se há fluxo em andamento
   - Se sim: processa step do fluxo
   - Se não: interpreta como prompt ou comando
3. Se for prompt:
   - AgentManager resolve agente ativo
   - QueueManager enfileira task com prioridade
   - Semaphore controla concorrência
   - ClaudeTerminal executa via SDK
   - Resposta enviada via WhatsApp
4. AgentManager persiste estado
```

## Testes

263 testes cobrindo:
- `agent-manager.test.ts`: CRUD, persistência, outputs
- `queue-manager.test.ts`: prioridade, processamento, erros
- `semaphore.test.ts`: permits, blocking, unbounded mode
- `terminal.test.ts`: sessões, modelos, workspaces
- `user-context-manager.test.ts`: fluxos multi-step
- `whatsapp.test.ts`: menus interativos, formatação
