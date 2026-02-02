# Queue & Concurrency Control

## Objetivo

Implementar o sistema de fila global com prioridade e controle de concorrência para gerenciar execução paralela de prompts.

## Escopo

**Incluído:**
- Implementar `QueueManager` class
- Fila global com prioridade (PriorityQueue)
- Integração com `Semaphore` para limite de concorrência
- Processamento de tarefas em ordem de prioridade + FIFO
- Notificação ao usuário quando tarefa inicia
- Tratamento de erros durante processamento
- Testes unitários

**Explicitamente fora:**
- Lógica de AgentManager (ticket #2)
- Integração com ClaudeTerminal (ticket #5)
- UI WhatsApp (ticket #6)
- Webhook handler (ticket #7)

## Referências de Spec

- `spec:992ffa8c-a8e6-43f9-95c4-96cc3f5bba51/bf94b09a-8a61-478a-8a83-72cb99472ff0` - Seção 1.2 (Fila), 3.2 (QueueManager)
- `spec:992ffa8c-a8e6-43f9-95c4-96cc3f5bba51/683a856b-c651-489f-9bd2-18890c221456` - Fluxo 3 (prompt durante processamento)

## Componentes

### QueueManager Class

```typescript
class QueueManager {
  constructor(
    semaphore: Semaphore,
    agentManager: AgentManager,
    terminal: ClaudeTerminal,
    sendWhatsApp: Function
  )
  
  enqueue(task: QueueTask): void
  processNext(): Promise<void>
  getQueueStatus(): { active: number; queued: number }
  
  private async processTask(task: QueueTask): Promise<void>
}
```

## Funcionalidades Principais

### 1. Fila com Prioridade

Implementar PriorityQueue:
- Ordenação: `priority` (0-2) → `timestamp` (FIFO)
- Estrutura: Min-heap ou array ordenado
- Operações: `enqueue(task)`, `dequeue()`, `peek()`, `size()`

**Mapeamento de prioridade:**
- `high` → 0
- `medium` → 1
- `low` → 2

### 2. Enfileiramento

Ao enfileirar tarefa:
1. Gerar UUID para task
2. Derivar `priority` do agente (via AgentManager)
3. Adicionar à fila
4. Chamar `processNext()` para tentar processar

### 3. Processamento

Ao processar tarefa:
1. Tentar adquirir permit do Semaphore
2. Se adquirido:
   - Atualizar status do agente: "processando - [prompt]..."
   - Notificar usuário: "Processando com [modelo]..."
   - Chamar `ClaudeTerminal.send()`
   - Adicionar output ao agente
   - Atualizar título (se necessário)
   - Atualizar status: "idle"
   - Liberar permit
   - Chamar `processNext()` recursivamente
3. Se não adquirido: tarefa fica na fila

### 4. Tratamento de Erros

Se erro durante processamento:
- Capturar exceção
- Atualizar status do agente: "error - [descrição]"
- Enviar mensagem ao usuário com opções de recuperação
- Liberar permit (importante!)
- Chamar `processNext()` para processar próximo

### 5. Notificações

Quando tarefa inicia (após aguardar na fila):
- Enviar: "🔔 Agente [Nome] iniciou seu prompt: '[primeiras palavras]...'"

## Critérios de Aceitação

- [ ] Fila ordena tarefas por prioridade + timestamp
- [ ] Tarefas de alta prioridade processam antes de média/baixa
- [ ] Dentro da mesma prioridade, FIFO é respeitado
- [ ] Semaphore limita execuções paralelas corretamente
- [ ] Quando permit liberado, próxima tarefa processa automaticamente
- [ ] Status do agente é atualizado durante processamento
- [ ] Usuário é notificado quando tarefa inicia
- [ ] Erros são capturados e tratados corretamente
- [ ] Permit é liberado mesmo em caso de erro
- [ ] getQueueStatus retorna contadores corretos
- [ ] Testes unitários passando (fila, prioridade, concorrência)

## Dependências

- Ticket #1 (Semaphore, interfaces)
- Ticket #2 (AgentManager)

## Notas de Implementação

- PriorityQueue: usar biblioteca ou implementar min-heap simples
- Processamento recursivo: `processNext()` chama a si mesmo após liberar permit
- Notificação: truncar prompt em 30 caracteres para mensagem
- Erro: incluir stack trace em log, mas não enviar ao usuário