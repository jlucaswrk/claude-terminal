# Webhook Integration & Orchestration

## Objetivo

Refatorar o webhook handler em `file:src/index.ts` para integrar todos os componentes do sistema multi-agente e implementar handlers para todos os fluxos.

## Escopo

**Incluído:**
- Refatorar `file:src/index.ts` completamente
- Instanciar todos os componentes (AgentManager, QueueManager, UserContextManager, etc.)
- Implementar handlers para todos os fluxos:
  - Enviar prompt (normal e durante processamento)
  - Criar agente
  - Menu principal (/)
  - Sub-menu do agente
  - Resetar agente(s)
  - Configurar limite de execução
  - Configurar prioridade
  - Visualizar histórico
  - Tratamento de erros
  - Primeira experiência (onboarding)
  - Migração de sessões antigas
- Orquestração entre componentes
- Testes de integração end-to-end

**Explicitamente fora:**
- Implementação de componentes individuais (tickets #1-6)

## Referências de Spec

- `spec:992ffa8c-a8e6-43f9-95c4-96cc3f5bba51/683a856b-c651-489f-9bd2-18890c221456` - Todos os fluxos
- `spec:992ffa8c-a8e6-43f9-95c4-96cc3f5bba51/bf94b09a-8a61-478a-8a83-72cb99472ff0` - Seção 3.7 (Webhook Handler)

## Estrutura do Webhook Handler

### 1. Inicialização

```typescript
// Instanciar componentes
const persistenceService = new PersistenceService()
const agentManager = new AgentManager(persistenceService)
const semaphore = new Semaphore(3) // Padrão: 3
const terminal = new ClaudeTerminal()
const queueManager = new QueueManager(semaphore, agentManager, terminal, sendWhatsApp)
const userContextManager = new UserContextManager()
const titleExtractor = new TitleExtractor()

// Carregar estado
const state = persistenceService.load()
if (state) {
  agentManager.loadState(state)
  semaphore.setPermits(state.config.maxConcurrent)
}
```

### 2. Handlers por Tipo de Mensagem

**Text Message:**
- Verificar se está em fluxo (UserContextManager)
- Se sim: processar próximo passo do fluxo
- Se não: iniciar fluxo de enviar prompt

**Button Reply:**
- Identificar contexto (modelo, confirmação, etc.)
- Processar ação correspondente

**List Reply:**
- Identificar seleção (agente, comando, opção)
- Processar ação correspondente

### 3. Fluxos a Implementar

#### Fluxo 1: Primeira Experiência (Onboarding)

```typescript
if (agentManager.listAgents(userId).length === 0) {
  // Criar agente "General" automaticamente
  const agent = agentManager.createAgent(userId, 'General')
  await sendWhatsApp(to, '👋 Criando agente "General" para você...')
  // Continuar com seleção de modelo
}
```

#### Fluxo 2: Enviar Prompt (Normal)

```typescript
// 1. Salvar prompt em contexto
userContextManager.setPendingPrompt(userId, text, messageId)

// 2. Mostrar lista de agentes
const agents = agentManager.listAgentsSorted(userId)
await sendAgentsList(to, agents, messageId)

// 3. Aguardar seleção de agente (list reply)
// 4. Mostrar seletor de modelo (button)
// 5. Aguardar seleção de modelo (button reply)
// 6. Enfileirar tarefa
const task = { id, agentId, prompt, model, priority, timestamp, userId }
queueManager.enqueue(task)
```

#### Fluxo 3: Enviar Prompt Durante Processamento

```typescript
// Detectar agentes em execução
const activeAgents = agents.filter(a => a.status === 'processing')

if (activeAgents.length > 0) {
  // Mostrar aviso
  await sendWhatsApp(to, `⚠️ Agentes em execução: ${activeAgents.map(a => a.name).join(', ')}`)
}

// Continuar com fluxo normal (prompt será enfileirado se agente ocupado)
```

#### Fluxo 4: Criar Novo Agente

```typescript
// Estado 1: Aguardando nome
userContextManager.startCreateAgentFlow(userId)
await sendWhatsApp(to, 'Nome do agente?')

// Estado 2: Aguardando workspace
userContextManager.setAgentName(userId, name)
await sendWhatsApp(to, 'Workspace (opcional)? Envie o caminho ou "pular"')

// Estado 3: Criar agente
const agent = agentManager.createAgent(userId, name, workspace)
await sendWhatsApp(to, `✅ Agente '${name}' criado!`)

// Estado 4: Confirmação
await sendButtons(to, 'Enviar prompt agora?', [
  { id: 'send_prompt', title: 'Enviar prompt agora' },
  { id: 'later', title: 'Depois' }
])
```

#### Fluxo 5: Menu Principal (/)

```typescript
const agents = agentManager.listAgentsSorted(userId)
await sendAgentsList(to, agents)
```

#### Fluxo 6: Sub-menu do Agente

```typescript
const agent = agentManager.getAgent(agentId)
await sendAgentMenu(to, agent)
```

#### Fluxo 7: Resetar Agente(s)

```typescript
// Mostrar lista de agentes + opção "Todos"
await sendAgentsListWithAll(to, agents)

// Aguardar seleção
// Mostrar confirmação
await sendConfirmation(to, `⚠️ Limpar sessão do agente '${name}'?`)

// Se confirmado: limpar sessão
terminal.clearSession(userId, agentId)
agentManager.updateAgentStatus(agentId, 'idle', 'Aguardando prompt')
```

#### Fluxo 8: Configurar Limite de Execução

```typescript
const currentLimit = semaphore.availablePermits()
await sendConfigureLimitMenu(to, currentLimit)

// Aguardar seleção
// Atualizar semaphore
semaphore.setPermits(newLimit)
persistenceService.save({ config: { maxConcurrent: newLimit }, agents })
```

#### Fluxo 9: Configurar Prioridade

```typescript
// Mostrar lista de agentes
await sendAgentsList(to, agents)

// Aguardar seleção de agente
// Mostrar menu de prioridade
await sendConfigurePriorityMenu(to, agent.name, agent.priority)

// Aguardar seleção de prioridade
// Atualizar prioridade
agentManager.updatePriority(agentId, newPriority)
```

#### Fluxo 10: Visualizar Histórico

```typescript
const outputs = agentManager.getOutputs(agentId)
await sendHistoryList(to, agent.name, outputs)

// Aguardar seleção de output
// Mostrar opções de ação
await sendOutputActions(to, output)
```

#### Fluxo 11: Tratamento de Erros

```typescript
// Capturado em QueueManager
// Enviar mensagem com opções
await sendErrorWithActions(to, agent.name, error.message)

// Se "Tentar novamente": reprocessar
// Se "Ver log": enviar stack trace
// Se "Ignorar": manter status de erro
```

#### Fluxo 12: Migração de Sessões

```typescript
if (terminal.detectOldSessions(userId)) {
  await sendWhatsApp(to, '⚠️ Detectadas sessões antigas. Deseja migrar?')
  await sendButtons(to, 'Escolha uma opção:', [
    { id: 'migrate', title: 'Migrar' },
    { id: 'clear', title: 'Limpar tudo' },
    { id: 'cancel', title: 'Cancelar' }
  ])
  
  // Se migrar: criar agentes Haiku e Opus
  const { haiku, opus } = terminal.migrateOldSessions(userId)
  if (haiku) {
    const agent = agentManager.createAgent(userId, 'Haiku')
    agent.sessionId = haiku
  }
  if (opus) {
    const agent = agentManager.createAgent(userId, 'Opus')
    agent.sessionId = opus
  }
}
```

## Critérios de Aceitação

- [ ] Todos os componentes são instanciados corretamente
- [ ] Estado é carregado do JSON na inicialização
- [ ] Fluxo de onboarding funciona (cria agente "General")
- [ ] Fluxo de enviar prompt funciona (normal e durante processamento)
- [ ] Fluxo de criar agente funciona (nome → workspace → confirmação)
- [ ] Menu principal (/) funciona
- [ ] Sub-menu do agente funciona
- [ ] Resetar agente(s) funciona
- [ ] Configurar limite funciona
- [ ] Configurar prioridade funciona
- [ ] Visualizar histórico funciona
- [ ] Tratamento de erros funciona
- [ ] Migração de sessões antigas funciona
- [ ] Testes end-to-end passando para todos os fluxos

## Dependências

- Ticket #1 (Foundation)
- Ticket #2 (AgentManager)
- Ticket #3 (QueueManager)
- Ticket #4 (UserContextManager)
- Ticket #5 (ClaudeTerminal)
- Ticket #6 (WhatsApp UI)

## Notas de Implementação

- Usar switch/case para diferentes tipos de mensagem
- Usar UserContextManager para rastrear estado em todos os fluxos
- Sempre limpar contexto após conclusão de fluxo
- Sempre salvar estado após operações críticas
- Logs detalhados para debugging
- Tratamento de erros robusto em todos os handlers