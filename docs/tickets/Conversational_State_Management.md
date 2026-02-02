# Conversational State Management

## Objetivo

Implementar o sistema de gerenciamento de estado conversacional para rastrear fluxos multi-etapa (criação de agente, configuração, etc.).

## Escopo

**Incluído:**
- Implementar `UserContextManager` class
- Rastreamento de estado por usuário
- Suporte a fluxos multi-etapa:
  - Criar agente (nome → workspace → confirmação)
  - Configurar prioridade (selecionar agente → selecionar prioridade)
  - Configurar limite (selecionar opção)
  - Deletar agente (selecionar agente → confirmação)
- Helpers para cada fluxo
- Limpeza de contexto após conclusão
- Testes unitários

**Explicitamente fora:**
- Lógica de negócio de agentes (ticket #2)
- Processamento de prompts (ticket #3)
- Integração com WhatsApp (ticket #6)
- Webhook handler (ticket #7)

## Referências de Spec

- `spec:992ffa8c-a8e6-43f9-95c4-96cc3f5bba51/bf94b09a-8a61-478a-8a83-72cb99472ff0` - Seção 1.1 (Estado Conversacional), 3.4 (UserContextManager)
- `spec:992ffa8c-a8e6-43f9-95c4-96cc3f5bba51/683a856b-c651-489f-9bd2-18890c221456` - Fluxos 4, 6, 8, 9 (fluxos multi-etapa)

## Componentes

### UserContextManager Class

```typescript
class UserContextManager {
  // Core
  getContext(userId: string): UserContext | undefined
  setContext(userId: string, context: UserContext): void
  clearContext(userId: string): void
  
  // Helpers
  isInFlow(userId: string): boolean
  getCurrentFlow(userId: string): string | undefined
  getCurrentFlowState(userId: string): string | undefined
  
  // Fluxo: Criar Agente
  startCreateAgentFlow(userId: string): void
  setAgentName(userId: string, name: string): void
  setAgentWorkspace(userId: string, workspace: string): void
  
  // Fluxo: Configurar Prioridade
  startConfigurePriorityFlow(userId: string, agentId?: string): void
  
  // Fluxo: Configurar Limite
  startConfigureLimitFlow(userId: string): void
  
  // Fluxo: Deletar Agente
  startDeleteAgentFlow(userId: string, agentId: string): void
  
  // Pending Prompt
  setPendingPrompt(userId: string, text: string, messageId?: string): void
  getPendingPrompt(userId: string): { text: string; messageId?: string } | undefined
  clearPendingPrompt(userId: string): void
}
```

## Funcionalidades Principais

### 1. Armazenamento de Contexto

- Map em memória: `Map<userId, UserContext>`
- Não persiste (estado temporário)
- Limpa automaticamente após conclusão de fluxo

### 2. Fluxo: Criar Agente

Estados:
1. `awaiting_name`: aguardando nome do agente
2. `awaiting_workspace`: aguardando workspace (ou "pular")
3. `awaiting_confirmation`: aguardando confirmação (Enviar prompt agora / Depois)

Dados armazenados em `flowData`:
- `agentName`: string
- `workspace`: string | null

### 3. Fluxo: Configurar Prioridade

Estados:
1. `awaiting_selection`: aguardando seleção de agente (se não pré-selecionado)
2. `awaiting_priority`: aguardando seleção de prioridade

Dados armazenados em `flowData`:
- `agentId`: string

### 4. Fluxo: Configurar Limite

Estados:
1. `awaiting_limit`: aguardando seleção de limite

Dados armazenados em `flowData`:
- Nenhum (fluxo simples)

### 5. Fluxo: Deletar Agente

Estados:
1. `awaiting_confirmation`: aguardando confirmação de deleção

Dados armazenados em `flowData`:
- `agentId`: string

### 6. Pending Prompt

Armazenar prompt temporariamente enquanto usuário seleciona agente/modelo:
- `text`: string
- `messageId`: string (para reply no WhatsApp)

## Critérios de Aceitação

- [ ] UserContextManager armazena contexto por usuário
- [ ] Contexto é recuperado corretamente
- [ ] Contexto é limpo após conclusão de fluxo
- [ ] isInFlow retorna true quando usuário está em fluxo
- [ ] getCurrentFlow retorna fluxo atual corretamente
- [ ] Fluxo de criar agente rastreia estados corretamente
- [ ] Fluxo de configurar prioridade rastreia estados corretamente
- [ ] Fluxo de configurar limite rastreia estados corretamente
- [ ] Fluxo de deletar agente rastreia estados corretamente
- [ ] Pending prompt é armazenado e recuperado corretamente
- [ ] Testes unitários passando

## Dependências

- Ticket #1 (interfaces TypeScript)

## Notas de Implementação

- Usar Map nativo do JavaScript
- Helpers devem ser convenientes para uso no webhook handler
- Limpar contexto: chamar após conclusão bem-sucedida de fluxo
- Pending prompt: limpar após processar ou cancelar