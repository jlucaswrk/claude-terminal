# Design: Identificação Visual de Agentes com Emoji

**Data:** 2026-02-01
**Status:** Aprovado

## Objetivo

Permitir que cada agente tenha um emoji personalizado para identificação visual nas mensagens do WhatsApp.

## Decisões de Design

| Decisão | Escolha |
|---------|---------|
| Identificador visual | Apenas emoji (sem cor) |
| Seleção na criação | Lista com 10 emojis populares |
| Edição posterior | Texto livre via teclado |
| Marcador na resposta | Apenas header (sem footer) |
| Reply inteligente | Fora do escopo |

## Modelo de Dados

Adicionar campo opcional à interface `Agent`:

```typescript
// src/types.ts
interface Agent {
  // ... campos existentes
  emoji?: string;  // Emoji escolhido pelo usuário (ex: "🤖")
}
```

**Default:** Agentes sem emoji usam `🤖` como fallback.

## Fluxo de Criação de Agente

**Fluxo atual:** Nome → Workspace → Confirmação

**Novo fluxo:** Nome → Emoji → Workspace → Confirmação

### Step: Seleção de Emoji

Lista interativa com emojis populares:
- 🤖 🔧 📊 💡 🎯 📝 🚀 ⚡ 🔍 💻

Incluir nota: "Você pode alterar depois nas configurações do agente"

**Exceção:** Agente "General" criado no onboarding usa emoji default 🤖 sem perguntar.

### Step: Seleção de Workspace (simplificado)

Lista com opções pré-definidas:

1. 🏠 Home (`/Users/lucas`)
2. 🖥️ Mesa (`/Users/lucas/Desktop`)
3. 📄 Documentos (`/Users/lucas/Documents`)
4. ✏️ Inserir caminho customizado
5. ⏭️ Pular (sem workspace)

## Header nas Mensagens

Todas as respostas de agentes incluem identificador no início:

```
🤖 General
───
[conteúdo da resposta do Claude]
```

Implementar em `QueueManager.processTask()` antes de enviar via WhatsApp.

## Edição de Emoji

Novo item no menu do agente: "🎨 Alterar emoji"

**Fluxo:**
1. Usuário seleciona "Alterar emoji"
2. Sistema pede: "Envie o novo emoji para o agente *X*:"
3. Usuário digita emoji via teclado
4. Sistema valida e atualiza
5. Confirma: "✅ Emoji do agente *X* atualizado para 🦊"

**Validação:** Aceitar apenas 1 emoji válido (não texto normal).

## Arquivos a Modificar

| Arquivo | Mudanças |
|---------|----------|
| `src/types.ts` | Adicionar `emoji?: string` em Agent e SerializedAgent |
| `src/agent-manager.ts` | `updateEmoji()`, incluir emoji no `createAgent()` |
| `src/user-context-manager.ts` | Estados `awaiting_emoji`, `awaiting_workspace_choice` |
| `src/whatsapp.ts` | `sendEmojiSelector()`, `sendWorkspaceSelector()`, item no menu |
| `src/queue-manager.ts` | Adicionar header nas respostas |
| `src/index.ts` | Handlers dos novos steps e ações |

## Fora do Escopo

- Reply inteligente com detecção de agente via messageId
- Campo de cor para agentes
- WhatsApp Flows (formulários nativos)

## Testes

Atualizar testes existentes para cobrir:
- Criação de agente com emoji
- Seleção de workspace via lista
- Edição de emoji
- Header nas respostas
