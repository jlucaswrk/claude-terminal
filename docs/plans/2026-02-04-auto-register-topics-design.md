# Auto-Register External Topics - Design

## Problema

Quando o usuário cria um tópico manualmente no Telegram (não via comandos do bot) e envia uma mensagem, o bot responde com erro "tópico não encontrado" e menciona `/topic` que não existe.

**Causa raiz:** O sistema só conhece tópicos criados via comandos do bot. Tópicos criados manualmente pelo Telegram não estão registrados no `TopicManager`.

## Solução

Detectar tópicos desconhecidos e perguntar ao usuário qual tipo deseja configurar via botões inline.

## Fluxo

1. Bot recebe mensagem com `threadId` desconhecido
2. `resolveSessionForTopic` retorna novo action: `topic_unregistered`
3. Bot envia mensagem com botões inline:
   ```
   📋 Novo tópico detectado!

   Escolha o tipo para este tópico:

   [🔄 Ralph] [🌿 Worktree] [💬 Sessão]
   ```
4. Usuário clica no botão
5. Sistema registra o tópico com tipo escolhido e nome "Tópico #{threadId}"
6. Envia confirmação
7. Usuário reenvia a mensagem original

## Arquivos Afetados

### 1. telegram-command-handler.ts

Adicionar novo action type:
```typescript
| { action: 'topic_unregistered'; chatId: number; userId: string; threadId: number; agentId: string }
```

Modificar `resolveSessionForTopic`: retornar `topic_unregistered` em vez de `topic_not_found`.

### 2. telegram.ts

Adicionar mensagem:
```typescript
TOPIC_UNREGISTERED: '📋 *Novo tópico detectado!*\n\nEscolha o tipo para este tópico:'
```

Adicionar função para enviar botões de setup.

### 3. index.ts

- Handler para `topic_unregistered` no switch de rotas
- Handler de callback `setup_topic_*` para processar escolha

### 4. topic-manager.ts

Adicionar método:
```typescript
registerExternalTopic(
  agentId: string,
  threadId: number,
  type: TopicType,
  name: string
): AgentTopic
```

## Detalhes de Implementação

### Callback Data Format

- `setup_topic_ralph:{agentId}:{threadId}`
- `setup_topic_worktree:{agentId}:{threadId}`
- `setup_topic_session:{agentId}:{threadId}`

### Nome do Tópico

Usar nome genérico: "Tópico #{threadId}" (ex: "Tópico #42")

### Mensagens de Confirmação

- **Ralph:** `✅ Tópico configurado como *Ralph Loop*.\n\nEnvie a tarefa para iniciar o loop autônomo.`
- **Worktree:** `✅ Tópico configurado como *Worktree*.\n\nEnvie sua mensagem para começar.`
- **Sessão:** `✅ Tópico configurado como *Sessão*.\n\nEnvie sua mensagem para começar.`

### Método registerExternalTopic

```typescript
registerExternalTopic(
  agentId: string,
  threadId: number,
  type: TopicType,
  name: string
): AgentTopic {
  const emoji = type === 'ralph' ? '🔄' : type === 'worktree' ? '🌿' : '💬';

  const topic: AgentTopic = {
    id: uuidv4(),
    agentId,
    telegramTopicId: threadId,
    type,
    name,
    emoji,
    status: 'active',
    messageCount: 0,
    createdAt: new Date(),
    lastActivity: new Date(),
  };

  // sessionId será criado na primeira mensagem
  if (type !== 'general') {
    topic.sessionId = undefined;
  }

  this.saveTopicToFile(agentId, topic);
  return topic;
}
```

## Testes

### telegram-command-handler.ts
- Mensagem em threadId desconhecido retorna `topic_unregistered`
- `topic_unregistered` inclui `agentId` e `threadId` corretos

### topic-manager.ts
- `registerExternalTopic` cria tópico com tipo correto
- `registerExternalTopic` usa emoji correto por tipo
- `registerExternalTopic` persiste no arquivo
- Após registro, `getTopicByThreadId` retorna o tópico

### index.ts (integração)
- Callback `setup_topic_ralph` registra tópico tipo ralph
- Callback `setup_topic_session` registra tópico tipo session
- Callback `setup_topic_worktree` registra tópico tipo worktree
- Após registro, mensagens no tópico são roteadas corretamente

### Atualizar testes existentes
- Teste que esperava `topic_not_found` deve ser atualizado para `topic_unregistered`
