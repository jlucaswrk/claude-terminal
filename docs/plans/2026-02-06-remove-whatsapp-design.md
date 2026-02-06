# Design: Remoção completa do WhatsApp

**Branch:** `feature/remove-whatsapp`
**Data:** 2026-02-06

## Contexto

O WhatsApp (via Kapso API) era o canal original do bot. Hoje todo uso real é pelo Telegram. O WhatsApp serve apenas para onboarding legado e modo Ronin (não utilizado). A mensagem "Usuario nao encontrado, configure o dojo primeiro pelo WhatsApp" é legado e confusa.

## Decisões

- **Remover WhatsApp completamente** — sem fallback, sem Kapso
- **Remover conceito de modos** (Ronin/Dojo) e agente Ronin
- **Whitelist via env var** — `ALLOWED_TELEGRAM_USERNAMES=lucas,outro`
- **Acesso negado:** log silencioso, sem resposta ao usuário
- **Auto-register:** primeiro acesso de username autorizado cria UserPreferences automaticamente

## 1. Arquivos deletados inteiramente

| Arquivo | Motivo |
|---------|--------|
| `src/whatsapp.ts` | Toda UI/API WhatsApp/Kapso |
| `src/ronin-agent.ts` | Agente read-only modo Ronin |
| `src/message-router.ts` | Roteamento grupos WhatsApp |
| `src/__tests__/whatsapp.test.ts` | Testes WhatsApp |
| `src/__tests__/whatsapp-groups.test.ts` | Testes grupos WhatsApp |
| `src/__tests__/whatsapp-send-groups.test.ts` | Testes envio grupos |
| `src/__tests__/whatsapp-ui-groups.test.ts` | Testes UI grupos |

## 2. Mudanças no `index.ts`

**Deletar:**
- ~52 imports do `whatsapp.ts`
- Imports de `ronin-agent.ts` e `message-router.ts`
- Config Kapso (`kapsoWebhookSecret`, `userPhone`)
- Webhook GET/POST `/webhook` (Kapso)
- Wrappers de plataforma (`sendMessage`, `sendImage`, `sendMedia`, `sendErrorWithActionsWrapper`)
- `extractMessage()`, `handleTextMessage()`, `handleButtonReply()`, `handleListReply()`
- `handleImageMessage()`, `handleAudioMessage()` (WhatsApp-specific)
- `handleGroupPrompt()`, `handleOnboardingFlow()`
- Toda lógica Ronin/Dojo e seleção de modo

**Modificar:**
- QueueManager instanciação — remover parâmetros WhatsApp
- Guard de acesso — whitelist por env var com log silencioso
- Auto-register de UserPreferences na primeira interação

## 3. Mudanças nos arquivos de suporte

**`src/storage.ts`:**
- Deletar funções Kapso (`downloadFromKapso`, `uploadToKapso`, etc.)
- Manter `getMimeType()`
- Renomear `getWhatsAppMediaType()` → `getMediaType()`

**`src/queue-manager.ts`:**
- Deletar `detectPlatform()`, tipos `SendWhatsApp*`, `Platform`
- Simplificar construtor e roteamento para Telegram-only

**`src/types.ts`:**
- Deletar `Agent.groupId`
- Deletar/simplificar `mode` de `UserPreferences`
- Limpar `currentFlow` se `'onboarding'` era WhatsApp-only

**`src/agent-manager.ts`:**
- Deletar `getAgentByGroupId()` e lógica de `groupId`

**`src/bash-executor.ts`**, **`src/terminal.ts`:**
- Limpar comentários WhatsApp

## 4. Whitelist e guard de acesso

- Env var: `ALLOWED_TELEGRAM_USERNAMES=lucas,outro`
- Parseada em `Set<string>` no startup
- Checada em `handleTelegramMessage()` e `handleTelegramCallback()`
- Não-autorizados: log + return silencioso
- Auto-register: cria `UserPreferences` automaticamente no primeiro acesso autorizado

## 5. Testes

**Deletar:** 4 arquivos `whatsapp*.test.ts`, possivelmente `integration-onboarding.test.ts`
**Atualizar:** `queue-manager.test.ts`, `index.test.ts`, `integration-group-onboarding.test.ts`
**Manter:** testes de topic, workspace, persistence, Ralph loops

## Resultado esperado

- Bot Telegram-only, sem código morto
- ~6000+ linhas removidas
- Conceitos eliminados: Ronin, Dojo, modos, Kapso, grupos WhatsApp
- Env vars removidas: `KAPSO_API_KEY`, `KAPSO_PHONE_NUMBER_ID`, `KAPSO_WEBHOOK_SECRET`, `USER_PHONE_NUMBER`
