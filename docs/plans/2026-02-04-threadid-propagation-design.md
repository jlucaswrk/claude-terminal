# Thread ID Propagation - Design

## Problema

Quando uma mensagem é enviada em um tópico do Telegram, o bot responde no #general ao invés de responder no próprio tópico.

**Causa raiz:** O `threadId` é capturado em `handleTelegramMessage` mas não é propagado através do sistema de fila (`QueueManager`).

## Solução

Adicionar `threadId` ao `QueueTask` e propagar através de todas as funções de envio.

## Arquivos Afetados

1. `src/types.ts` - Adicionar campo `threadId` ao `QueueTask`
2. `src/queue-manager.ts` - Atualizar tipos e propagar threadId
3. `src/index.ts` - Passar threadId no enqueue e wrappers

## Mudanças Detalhadas

### 1. types.ts

```typescript
export interface QueueTask {
  // ... campos existentes ...
  threadId?: number;  // Telegram topic thread ID
}
```

### 2. queue-manager.ts

**Tipos atualizados:**
```typescript
export type SendTelegramFn = (chatId: number, text: string, threadId?: number) => Promise<void>;
export type SendTelegramImageFn = (chatId: number, imageUrl: string, caption?: string, threadId?: number) => Promise<void>;
export type StartTypingIndicatorFn = (chatId: number, threadId?: number) => () => void;
```

**Funções atualizadas:**
- `processTask()` - extrair `threadId` do task e passar para typing indicator
- `processBashTask()` - extrair `threadId` do task e passar para typing indicator
- `sendResponse()` - aceitar e passar `threadId`
- `sendImageResponse()` - aceitar e passar `threadId`
- `sendMediaResponse()` - aceitar e passar `threadId`
- `notifyTaskStartPlatform()` - aceitar e passar `threadId`
- `notifyTaskErrorPlatform()` - aceitar e passar `threadId`

### 3. index.ts

**Wrappers atualizados:**
```typescript
async function sendTelegramDirectMessage(chatId: number, text: string, threadId?: number): Promise<void> {
  await sendTelegramMessage(chatId, text, undefined, threadId);
}

async function sendTelegramDirectImage(chatId: number, imageUrl: string, caption?: string, threadId?: number): Promise<void> {
  await sendTelegramPhoto(chatId, imageUrl, caption, threadId);
}
```

**Enqueue atualizado:**
```typescript
queueManager.enqueue({
  agentId: route.agentId,
  prompt: route.text,
  model: route.model!,
  userId,
  replyTo: chatId,
  threadId: route.threadId,  // NOVO
});
```

## Testes

Os testes existentes em `queue-manager-cancel.test.ts` precisarão ser atualizados para incluir o novo parâmetro `threadId` nos mocks.
