# Plano de Implementação: Onboarding de Agentes via Grupo

## Visão Geral

Refatorar o fluxo de entrada do bot em grupos para permitir criação e vinculação de agentes diretamente no grupo.

## Tarefas

### 1. Adicionar Suporte a Reply Keyboard

**Arquivo:** `src/telegram.ts`

- [ ] Criar função `sendTelegramReplyKeyboard(chatId, text, buttons, options)`
- [ ] Criar função `removeTelegramReplyKeyboard(chatId, text)`
- [ ] Opção `one_time_keyboard: true` para sumir após uso
- [ ] Opção `resize_keyboard: true` para botões menores

**Exemplo de uso:**
```typescript
await sendTelegramReplyKeyboard(chatId,
  'esse grupo não tem agente ainda',
  [['criar um', 'vincular existente']]
);
```

---

### 2. Adicionar Suporte a Pin/Unpin Message

**Arquivo:** `src/telegram.ts`

- [ ] Criar função `pinTelegramMessage(chatId, messageId)`
- [ ] Criar função `unpinTelegramMessage(chatId, messageId)`
- [ ] Criar função `deleteTelegramMessage(chatId, messageId)`
- [ ] Tratar erro de permissão (bot não é admin)

---

### 3. Armazenar Histórico de Grupo → Agente

**Arquivo:** `src/types.ts`

- [ ] Adicionar campo `previousTelegramChatId?: number` no Agent
- [ ] Ou criar mapeamento separado em UserPreferences

**Arquivo:** `src/agent-manager.ts`

- [ ] Criar método `getAgentByPreviousChatId(chatId): Agent | undefined`
- [ ] Atualizar `setTelegramChatId` para guardar histórico

---

### 4. Refatorar handleTelegramMyChatMember

**Arquivo:** `src/index.ts`

**Fluxo atual:**
```
bot adicionado → manda "use /link"
```

**Novo fluxo:**
```
bot adicionado
    ↓
busca agente pelo chatId anterior
    ↓
[encontrou] → reconecta + mensagem de confirmação
[não encontrou] → verifica se user tem agentes
    ↓
[tem agentes] → reply keyboard: criar/vincular + fixa mensagem
[não tem] → reply keyboard: criar/depois + fixa mensagem
```

- [ ] Buscar usuário pelo `from.username` do update
- [ ] Verificar agente anterior com `getAgentByPreviousChatId`
- [ ] Se encontrar, reconectar automaticamente
- [ ] Se não, mostrar opções apropriadas
- [ ] Fixar mensagem de onboarding
- [ ] Armazenar messageId fixado para depois deletar

---

### 5. Criar Handler para Reply Keyboard no Grupo

**Arquivo:** `src/index.ts`

O reply keyboard envia texto normal, não callback. Precisa detectar:

- [ ] "criar um" / "criar agora" → inicia fluxo de criação no grupo
- [ ] "vincular existente" → mostra lista de agentes (inline)
- [ ] "depois" → remove keyboard, fica quieto

**Arquivo:** `src/telegram-command-handler.ts`

- [ ] Adicionar detecção de respostas do reply keyboard em `routeGroupMessage`

---

### 6. Implementar Fluxo de Criação no Grupo

**Arquivo:** `src/index.ts` ou novo `src/group-onboarding.ts`

Estados do fluxo:
- [ ] `group_create_name` - aguardando nome
- [ ] `group_create_emoji` - aguardando emoji (inline buttons)
- [ ] `group_create_workspace` - aguardando workspace (reply keyboard)
- [ ] `group_create_model` - aguardando modelo (reply keyboard)

**Arquivo:** `src/user-context-manager.ts`

- [ ] Adicionar suporte a fluxos por grupo (não só por usuário)
- [ ] Ou usar `userId + chatId` como chave

---

### 7. Implementar Fluxo de Vincular no Grupo

**Arquivo:** `src/index.ts`

- [ ] Listar agentes sem `telegramChatId` do usuário
- [ ] Se 1-3: inline buttons com nome
- [ ] Se 4+: lista numerada + inline buttons
- [ ] Ao selecionar: vincular e confirmar

---

### 8. Atualizar Confirmação de Vinculação

**Arquivo:** `src/index.ts`

Após criar ou vincular:
- [ ] Desfixar mensagem de onboarding
- [ ] Deletar mensagem de onboarding
- [ ] Remover reply keyboard
- [ ] Enviar confirmação com dicas
- [ ] Perguntar primeira tarefa

---

### 9. Tratar Remoção do Bot

**Arquivo:** `src/index.ts` em `handleTelegramMyChatMember`

Quando bot é removido (`status: 'left'` ou `'kicked'`):
- [ ] Guardar `telegramChatId` como `previousTelegramChatId` no agente
- [ ] Limpar `telegramChatId` do agente
- [ ] Agente fica disponível para vincular em outro grupo

---

### 10. Limpar Código Legado

- [ ] Remover lógica de `orphanedTelegramGroups`
- [ ] Remover `pendingAgentLink` (substituído pelo novo fluxo)
- [ ] Remover mensagens antigas de "use /link no grupo"
- [ ] Atualizar `/link` para funcionar com novo fluxo (ou deprecar)

---

### 11. Atualizar Mensagens

Revisar todas as mensagens para o novo tom:
- [ ] Minúsculas no início
- [ ] Sem bordões genéricos
- [ ] Informal e direto

---

### 12. Testes

- [ ] Teste: bot adicionado a grupo novo (sem agentes)
- [ ] Teste: bot adicionado a grupo novo (com agentes)
- [ ] Teste: bot re-adicionado a grupo que já teve agente
- [ ] Teste: fluxo completo de criação no grupo
- [ ] Teste: fluxo de vincular existente
- [ ] Teste: usuário escolhe "depois"
- [ ] Teste: bot removido do grupo
- [ ] Teste: bot sem permissão de fixar mensagem

---

## Ordem de Implementação Sugerida

1. **Infraestrutura** (tarefas 1-3): reply keyboard, pin, histórico
2. **Fluxo principal** (tarefa 4): refatorar my_chat_member
3. **Handlers** (tarefas 5-7): reply keyboard, criação, vinculação
4. **Finalização** (tarefas 8-9): confirmação, remoção
5. **Limpeza** (tarefa 10): código legado
6. **Polish** (tarefas 11-12): mensagens, testes

---

## Arquivos Afetados

| Arquivo | Mudanças |
|---------|----------|
| `src/telegram.ts` | reply keyboard, pin/unpin/delete |
| `src/types.ts` | previousTelegramChatId |
| `src/agent-manager.ts` | getAgentByPreviousChatId |
| `src/index.ts` | handleTelegramMyChatMember, novos handlers |
| `src/telegram-command-handler.ts` | detectar reply keyboard |
| `src/user-context-manager.ts` | fluxos por grupo |
| `src/persistence.ts` | remover orphanedTelegramGroups |

---

## Riscos

1. **Permissões**: Bot precisa ser admin pra fixar. Fallback: funciona sem fixar.
2. **Reply keyboard em grupos**: Pode aparecer pra todos os membros. Mitigar com `selective: true`.
3. **Conflito de fluxos**: Usuário em criação no privado + no grupo. Tratar com contextos separados.
