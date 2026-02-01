# Agent Management System

## Objetivo

Implementar o sistema completo de gerenciamento de agentes (CRUD, persistência, metadados, título, outputs, prioridade).

## Escopo

**Incluído:**
- Implementar `AgentManager` class completa
- CRUD de agentes (create, delete, get, list)
- Gerenciamento de metadados (título, status, outputs, prioridade)
- Integração com `PersistenceService` (salvar após operações críticas)
- Ordenação de agentes (prioridade + última atividade)
- Validações (nome, workspace, limite de agentes)
- Gerenciamento de outputs (últimos 10, FIFO)
- Testes unitários

**Explicitamente fora:**
- Processamento de prompts (ticket #3)
- Estado conversacional (ticket #4)
- Integração com ClaudeTerminal (ticket #5)
- UI WhatsApp (ticket #6)

## Referências de Spec

- `spec:992ffa8c-a8e6-43f9-95c4-96cc3f5bba51/bf94b09a-8a61-478a-8a83-72cb99472ff0` - Seção 3.1 (AgentManager)
- `spec:992ffa8c-a8e6-43f9-95c4-96cc3f5bba51/683a856b-c651-489f-9bd2-18890c221456` - Fluxos 4, 6, 9 (criar, gerenciar, configurar agentes)

## Componentes

### AgentManager Class

```typescript
class AgentManager {
  constructor(persistenceService: PersistenceService)
  
  // CRUD
  createAgent(userId: string, name: string, workspace?: string): Agent
  deleteAgent(agentId: string): void
  getAgent(agentId: string): Agent | undefined
  listAgents(userId: string): Agent[]
  
  // Metadados
  updateAgentStatus(agentId: string, status: Agent['status'], details: string): void
  updateAgentTitle(agentId: string, title: string): void
  updatePriority(agentId: string, priority: Agent['priority']): void
  
  // Outputs
  addOutput(agentId: string, output: Output): void
  getOutputs(agentId: string): Output[]
  
  // Ordenação
  listAgentsSorted(userId: string): Agent[]
}
```

## Funcionalidades Principais

### 1. Criação de Agente

- Gerar UUID para `id`
- Validar nome (não vazio, max 50 chars)
- Validar workspace (se fornecido, verificar se existe)
- Inicializar com valores padrão:
  - `status: 'idle'`
  - `statusDetails: 'Aguardando prompt'`
  - `priority: 'medium'`
  - `title: ''` (será gerado na primeira mensagem)
  - `outputs: []`
  - `messageCount: 0`
- Salvar via `PersistenceService`

### 2. Gerenciamento de Outputs

- Manter apenas últimos 10 outputs (FIFO)
- Ao adicionar 11º output, remover o mais antigo
- Gerar `summary` automaticamente (primeiras 50 chars do response)
- Salvar após adicionar output

### 3. Ordenação de Agentes

Implementar `listAgentsSorted`:
1. Ordenar por `priority`: high (0) → medium (1) → low (2)
2. Dentro da mesma prioridade, ordenar por `lastActivity` (mais recente primeiro)

### 4. Validações

- Nome: não vazio, max 50 chars, sem caracteres especiais perigosos
- Workspace: se fornecido, verificar se diretório existe
- Limite de agentes: max 50 agentes por usuário (prevenir abuso)

## Critérios de Aceitação

- [ ] AgentManager cria agentes com UUID único
- [ ] Validação de nome funciona (rejeita inválidos)
- [ ] Validação de workspace funciona (rejeita caminhos inexistentes)
- [ ] Agentes são salvos via PersistenceService após criação
- [ ] Deletar agente remove do estado e salva
- [ ] Status e statusDetails são atualizados corretamente
- [ ] Título é atualizado corretamente
- [ ] Prioridade é atualizada corretamente
- [ ] Outputs são adicionados (max 10, FIFO)
- [ ] listAgentsSorted retorna agentes ordenados corretamente
- [ ] Testes unitários passando

## Dependências

- Ticket #1 (PersistenceService, interfaces TypeScript)

## Notas de Implementação

- Usar `crypto.randomUUID()` para gerar IDs
- Validação de workspace: `Bun.file(workspace).exists()`
- Ordenação: usar `Array.sort()` com comparador customizado
- Summary de output: `response.substring(0, 50) + '...'`