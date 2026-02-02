# WhatsApp UI Components

## Objetivo

Implementar novas funções de UI para WhatsApp (listas de agentes, menus, histórico, tratamento de erros) usando WhatsApp Interactive Lists e Buttons.

## Escopo

**Incluído:**
- Adicionar funções em `file:src/whatsapp.ts`
- `sendAgentsList`: Lista de agentes com metadados
- `sendAgentMenu`: Sub-menu de um agente
- `sendHistoryList`: Lista de outputs (últimos 10)
- `sendErrorWithActions`: Erro com botões de recuperação
- `sendConfigureLimitMenu`: Menu de configuração de limite
- `sendConfigurePriorityMenu`: Menu de configuração de prioridade
- Formatação de timestamps relativos (ex: "2min atrás")
- Testes de integração

**Explicitamente fora:**
- Lógica de negócio (tickets #2, #3, #4)
- Webhook handler (ticket #7)

## Referências de Spec

- `spec:992ffa8c-a8e6-43f9-95c4-96cc3f5bba51/683a856b-c651-489f-9bd2-18890c221456` - Todos os fluxos (UI)
- `spec:992ffa8c-a8e6-43f9-95c4-96cc3f5bba51/bf94b09a-8a61-478a-8a83-72cb99472ff0` - Seção 3.7 (WhatsApp)

## Funções a Implementar

### 1. sendAgentsList

```typescript
async function sendAgentsList(
  to: string,
  agents: Agent[],
  messageId?: string
): Promise<void>
```

**Formato:**
- Lista interativa do WhatsApp
- Seções:
  - "🤖 Agentes" (agentes ordenados)
  - "➕ Gerenciar" (criar, configurar)
  - "🔧 Comandos" (/reset, /compact, /help)
- Cada agente mostra:
  - Nome
  - Título da conversa
  - Status + detalhes
  - Timestamp relativo

**Exemplo:**
```
Agentes disponíveis:

🤖 Agentes:
1. General - "Working on API" - idle - 2min atrás
2. Frontend - "Building UI" - processando - agora

➕ Gerenciar:
3. Criar novo agente
4. Configurar execução
5. Configurar prioridade

🔧 Comandos:
6. /reset - Limpar sessão
7. /compact - Compactar contexto
8. /help - Ajuda
```

### 2. sendAgentMenu

```typescript
async function sendAgentMenu(
  to: string,
  agent: Agent,
  messageId?: string
): Promise<void>
```

**Formato:**
- Lista interativa
- Opções:
  - 💬 Enviar prompt
  - 📋 Ver histórico
  - ⚙️ Configurar prioridade
  - 🔄 Resetar agente
  - 🗑️ Deletar agente
  - ⬅️ Voltar

### 3. sendHistoryList

```typescript
async function sendHistoryList(
  to: string,
  agentName: string,
  outputs: Output[],
  messageId?: string
): Promise<void>
```

**Formato:**
- Lista interativa: "📋 Histórico - [Nome do Agente]"
- Últimos 10 outputs
- Cada item: "[emoji] [resumo] - [tempo]"
- Emojis: ✅ success, ⚠️ warning, ❌ erro

**Exemplo:**
```
📋 Histórico - Backend API

1. ✅ Criou 3 arquivos - 2min
2. ✅ Executou testes - 5min
3. ⚠️ Corrigiu bug - 10min
...
```

### 4. sendErrorWithActions

```typescript
async function sendErrorWithActions(
  to: string,
  agentName: string,
  error: string,
  messageId?: string
): Promise<void>
```

**Formato:**
- Mensagem de texto com erro
- Botões interativos:
  - [Tentar novamente]
  - [Ver log completo]
  - [Ignorar]

**Exemplo:**
```
❌ Erro no agente 'Backend API'

Falha ao executar comando: permission denied

[Tentar novamente] [Ver log completo] [Ignorar]
```

### 5. sendConfigureLimitMenu

```typescript
async function sendConfigureLimitMenu(
  to: string,
  currentLimit: number,
  messageId?: string
): Promise<void>
```

**Formato:**
- Lista interativa
- Mostra limite atual
- Opções: 1, 3, 5, 10, Sem limite

### 6. sendConfigurePriorityMenu

```typescript
async function sendConfigurePriorityMenu(
  to: string,
  agentName: string,
  currentPriority: string,
  messageId?: string
): Promise<void>
```

**Formato:**
- Lista interativa
- Mostra prioridade atual
- Opções: Alta, Média, Baixa

## Utilitários

### formatTimestamp

```typescript
function formatTimestamp(date: Date): string {
  // Retorna timestamp relativo
  // Ex: "agora", "2min", "1h", "ontem", "3d"
}
```

**Lógica:**
- < 1min: "agora"
- < 1h: "Xmin"
- < 24h: "Xh"
- < 7d: "Xd"
- >= 7d: data formatada

## Critérios de Aceitação

- [ ] sendAgentsList mostra agentes com metadados corretos
- [ ] sendAgentsList mostra seções (Agentes, Gerenciar, Comandos)
- [ ] sendAgentMenu mostra opções corretas
- [ ] sendHistoryList mostra últimos 10 outputs com emojis
- [ ] sendErrorWithActions mostra erro com botões
- [ ] sendConfigureLimitMenu mostra opções de limite
- [ ] sendConfigurePriorityMenu mostra opções de prioridade
- [ ] formatTimestamp retorna timestamps relativos corretos
- [ ] Todas as funções usam WhatsApp Interactive Lists/Buttons
- [ ] Testes de integração passando

## Dependências

- Ticket #2 (AgentManager, Agent interface)

## Notas de Implementação

- Usar formato de `sendCommandsList` e `sendModelSelector` como referência
- WhatsApp Interactive Lists: max 10 itens por seção
- Se mais de 10 agentes: paginar ou mostrar apenas top 10
- Timestamps: usar biblioteca como `date-fns` ou implementar manualmente
- Emojis: usar Unicode direto (✅ ⚠️ ❌ 🔵)