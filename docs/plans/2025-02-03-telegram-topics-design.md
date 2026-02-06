# Telegram Topics - Design Document

Data: 2025-02-03
Status: Aprovado para implementação

## Resumo

Usar tópicos do Telegram (Forum Topics) como unidades de trabalho isoladas dentro de um grupo de agente. Cada tópico pode ser uma sessão independente, um Ralph loop, ou uma "worktree" para experimentos.

## Decisões de Design

| Aspecto | Decisão |
|---------|---------|
| Modelo de sessões | Híbrido: General compartilha sessão, tópicos especiais têm sessão isolada |
| Tipos de tópico | 📌 General, 🔄 Ralph, 🌿 Worktree, 💬 Sessão |
| Comandos | `/ralph`, `/worktree`, `/sessao`, `/topicos` |
| Workspace | Sempre herda do agente pai |
| Conclusão | Pergunta antes de fechar tópico |
| Visualização | `/topicos` no grupo + seção no menu do agente |
| Limites | Sem limites artificiais (Telegram é o limite) |

## Analogia com Git Worktrees

| Git Worktree | Tópico Telegram |
|--------------|-----------------|
| Branch isolada | Sessão Claude isolada |
| Diretório separado | `message_thread_id` separado |
| Mesmo repo, contexto diferente | Mesmo agente, conversa diferente |
| Pode trabalhar em paralelo | Pode ter múltiplos Ralph loops |
| Merge quando pronto | Pode "arquivar" tópico |

## Modelo de Dados

```typescript
// Tipo de tópico
type TopicType = 'general' | 'ralph' | 'worktree' | 'session';

// Estado de um tópico
interface AgentTopic {
  id: string;                    // UUID
  agentId: string;               // Agente pai
  telegramTopicId: number;       // message_thread_id do Telegram
  type: TopicType;
  name: string;                  // "Auth JWT", "feature/payments"
  emoji: string;                 // 🔄, 🌿, 💬, 📌
  sessionId?: string;            // Sessão Claude (isolada)
  loopId?: string;               // ID do Ralph loop (se type='ralph')
  status: 'active' | 'closed';
  createdAt: Date;
  lastActivity: Date;
}

// Agent ganha novos campos
interface Agent {
  // ... campos existentes ...
  topics: AgentTopic[];          // Tópicos do agente
  mainSessionId?: string;        // Sessão do General (compartilhada)
}
```

## Tipos de Tópico

| Tipo | Prefixo | Sessão | Uso |
|------|---------|--------|-----|
| **General** | 📌 | Compartilhada (mainSessionId) | Conversa principal, contexto acumulado |
| **Ralph** | 🔄 | Isolada | Loop autônomo com tarefa específica |
| **Worktree** | 🌿 | Isolada | Feature/experimento isolado |
| **Sessão** | 💬 | Isolada | Conversa pontual, descartável |

## Comandos

| Comando | Cria | Exemplo |
|---------|------|---------|
| `/ralph <tarefa>` | Tópico 🔄 + inicia loop | `/ralph Implementar auth JWT` |
| `/worktree <nome>` | Tópico 🌿 + sessão limpa | `/worktree feature/payments` |
| `/sessao <nome>` | Tópico 💬 + sessão limpa | `/sessao Debug API lenta` |
| `/topicos` | Lista tópicos com status | - |

## Fluxos

### Criação de Tópico Ralph

```
Usuário: /ralph Implementar auth JWT
              │
              ▼
Bot: createForumTopic(chatId, "🔄 Auth JWT", { icon_color: amarelo })
              │
              ▼
Bot: Cria sessão Claude isolada
              │
              ▼
Bot: Inicia RalphLoop com sessionId isolado
              │
              ▼
Updates de progresso vão para o tópico (message_thread_id)
              │
              ▼
Quando completa: pergunta se fecha tópico
```

### Roteamento de Mensagens

```
Mensagem chega no grupo
         │
         ▼
┌─ Tem message_thread_id? ─┐
│                          │
▼ Não                      ▼ Sim
│                          │
General                    Busca tópico pelo ID
(mainSessionId)            (topic.sessionId)
```

### Conclusão de Ralph

```
Loop completa com <promise>COMPLETE</promise>
         │
         ▼
Bot envia resumo no tópico:
  ✅ Tarefa concluída!
  Iterações: 7/20
  Tempo: 12m 34s
         │
         ▼
   [📁 Manter] [🗑️ Fechar]
         │
         ▼
Se fechar → closeForumTopic()
Se manter → tópico continua disponível
```

## Integração Telegram API

### Métodos Necessários

```typescript
// Criar tópico
bot.createForumTopic(chatId, name, {
  icon_color: 0x6FB9F0,
  icon_custom_emoji_id: '...'
});

// Fechar tópico (arquivar)
bot.closeForumTopic(chatId, messageThreadId);

// Reabrir tópico
bot.reopenForumTopic(chatId, messageThreadId);

// Editar nome/ícone
bot.editForumTopic(chatId, messageThreadId, { name, icon_custom_emoji_id });

// Enviar mensagem em tópico específico
bot.sendMessage(chatId, text, {
  message_thread_id: topicId,
  parse_mode: 'Markdown'
});
```

### Cores de Ícone

```
0x6FB9F0 (azul)    - 💬 Sessão
0xFFD67E (amarelo) - 🔄 Ralph
0xCB86DB (roxo)    - 🌿 Worktree
0x8EEE98 (verde)   - ✅ Concluído
```

### Requisitos

- Grupo precisa ser **supergrupo com tópicos habilitados**
- Bot precisa ser **admin** com permissão `can_manage_topics`

## Roteamento de Mensagens

```typescript
async function routeMessage(update: TelegramUpdate) {
  const chatId = update.message.chat.id;
  const threadId = update.message.message_thread_id;

  const agent = agentManager.getAgentByTelegramChatId(chatId);
  if (!agent) return;

  let sessionId: string;
  let topic: AgentTopic | undefined;

  if (!threadId) {
    // General - usa sessão principal
    sessionId = agent.mainSessionId;
  } else {
    topic = agent.topics.find(t => t.telegramTopicId === threadId);

    if (!topic) {
      return sendMessage(chatId, 'Tópico não gerenciado.', threadId);
    }

    if (topic.type === 'ralph' && topic.status === 'active') {
      return sendMessage(chatId, '🔄 Ralph em execução. Use /pausar para interagir.', threadId);
    }

    sessionId = topic.sessionId;
  }

  await processPrompt(agent, sessionId, update.message.text, threadId);
}
```

## Persistência

### Estrutura de Arquivos

```
data/
├── agents.json           # Adiciona mainSessionId aos agentes
├── user-preferences.json
├── loops/                # Ralph loops (existente)
└── topics/               # Novo
    └── {agentId}.json    # Tópicos por agente
```

### Formato topics/{agentId}.json

```json
{
  "agentId": "abc-123",
  "mainSessionId": "session-main",
  "topics": [
    {
      "id": "topic-1",
      "telegramTopicId": 456,
      "type": "ralph",
      "name": "Auth JWT",
      "emoji": "🔄",
      "sessionId": "session-isolated-1",
      "loopId": "loop-789",
      "status": "active",
      "createdAt": "2025-02-03T10:00:00Z",
      "lastActivity": "2025-02-03T10:15:00Z"
    }
  ]
}
```

### Recovery no Startup

- Carrega tópicos ativos
- Verifica se tópicos ainda existem no Telegram (via `getChat`)
- Marca como `closed` se tópico foi deletado manualmente

## UI

### /topicos no Grupo

```
📋 *Tópicos de 🤖 Backend API*

📌 General (sessão principal)
   └─ 47 mensagens

🔄 Auth JWT (ralph)
   └─ ▶️ Executando • 5/20 iterações

🌿 feature/payments (worktree)
   └─ 💤 Inativo há 2h

💬 Debug API (sessão)
   └─ 💤 Inativo há 1d

┌──────────────────────────────┐
│ + Ralph │ + Worktree │ + Sessão │
└──────────────────────────────┘
```

### Menu do Agente

```
🤖 *Backend API*

📂 ~/projects/backend
🧠 Sonnet fixo
⚪ Idle

📋 *Tópicos ativos: 3*
   🔄 Auth JWT (executando)
   🌿 feature/payments
   💬 Debug API

┌─────────────────────────────────┐
│ 📜 Histórico │ 🔄 Reset │ ⚙️ Config │
└─────────────────────────────────┘
```

## Componentes a Implementar

1. **TopicManager** - CRUD de tópicos, integração Telegram API
2. **Novos comandos** em `telegram-command-handler.ts`
3. **Roteamento** por `message_thread_id` no webhook
4. **Persistência** em `data/topics/`
5. **Integração** com `RalphLoopManager` para tópicos Ralph
6. **UI** de listagem e ações

## Fontes

- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Forums - Telegram API](https://core.telegram.org/api/forum)
- [node-telegram-bot-api docs](https://github.com/yagop/node-telegram-bot-api/blob/master/doc/api.md)
