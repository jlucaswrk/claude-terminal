# Modo Ronin/Dojo Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implementar dois modos de operação - Ronin (tudo no WhatsApp) e Dojo (agentes no Telegram, WhatsApp read-only).

**Architecture:** O sistema detecta o modo do usuário e roteia mensagens de acordo. No modo Dojo, WhatsApp mantém um agente Ronin fixo (Haiku, read-only), enquanto Telegram gerencia múltiplos agentes via grupos. Onboarding na primeira criação de agente.

**Tech Stack:** TypeScript, Bun, Hono, Telegram Bot API (node-telegram-bot-api)

---

## Fase 1: Tipos e Estrutura Base

### Task 1.1: Adicionar UserMode e atualizar tipos

**Files:**
- Modify: `src/types.ts`

**Step 1: Adicionar UserMode type**

```typescript
// Após line 18 (ModelMode)

/**
 * User operation mode
 * - ronin: All agents in WhatsApp (default, current behavior)
 * - dojo: Agents in Telegram, WhatsApp has read-only Ronin agent
 */
export type UserMode = 'ronin' | 'dojo';
```

**Step 2: Adicionar UserPreferences interface**

```typescript
// Após UserContext interface (line 124)

/**
 * User preferences (persisted)
 */
export interface UserPreferences {
  userId: string;
  mode: UserMode;
  telegramUsername?: string;       // Telegram username (without @)
  telegramChatId?: number;         // Telegram chat ID for direct messages
  onboardingComplete: boolean;     // Whether user completed mode selection
}

/**
 * Serialized user preferences for JSON storage
 */
export interface SerializedUserPreferences {
  userId: string;
  mode: UserMode;
  telegramUsername?: string;
  telegramChatId?: number;
  onboardingComplete: boolean;
}
```

**Step 3: Run tests**

Run: `bun test src/__tests__/types.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add UserMode and UserPreferences"
```

---

### Task 1.2: Adicionar flow de onboarding no UserContextManager

**Files:**
- Modify: `src/user-context-manager.ts`
- Create: `src/__tests__/user-context-onboarding.test.ts`

**Step 1: Escrever testes para onboarding flow**

```typescript
// src/__tests__/user-context-onboarding.test.ts
import { describe, test, expect, beforeEach } from 'bun:test';
import { UserContextManager } from '../user-context-manager';

describe('UserContextManager - Onboarding Flow', () => {
  let manager: UserContextManager;

  beforeEach(() => {
    manager = new UserContextManager();
  });

  describe('startOnboardingFlow', () => {
    test('sets flow to onboarding and state to awaiting_mode_selection', () => {
      manager.startOnboardingFlow('user1');

      expect(manager.getCurrentFlow('user1')).toBe('onboarding');
      expect(manager.getCurrentFlowState('user1')).toBe('awaiting_mode_selection');
    });
  });

  describe('setUserMode', () => {
    test('stores selected mode in flow data', () => {
      manager.startOnboardingFlow('user1');
      manager.setUserMode('user1', 'dojo');

      const data = manager.getFlowData('user1');
      expect(data?.userMode).toBe('dojo');
    });

    test('advances to awaiting_telegram_username for dojo mode', () => {
      manager.startOnboardingFlow('user1');
      manager.setUserMode('user1', 'dojo');

      expect(manager.getCurrentFlowState('user1')).toBe('awaiting_telegram_username');
    });

    test('completes flow for ronin mode', () => {
      manager.startOnboardingFlow('user1');
      manager.setUserMode('user1', 'ronin');

      expect(manager.getCurrentFlow('user1')).toBeUndefined();
    });
  });

  describe('setTelegramUsername', () => {
    test('stores telegram username and completes flow', () => {
      manager.startOnboardingFlow('user1');
      manager.setUserMode('user1', 'dojo');
      manager.setTelegramUsername('user1', 'lucas');

      const data = manager.getFlowData('user1');
      expect(data?.telegramUsername).toBe('lucas');
    });
  });

  describe('isAwaitingModeSelection', () => {
    test('returns true when awaiting mode selection', () => {
      manager.startOnboardingFlow('user1');
      expect(manager.isAwaitingModeSelection('user1')).toBe(true);
    });

    test('returns false otherwise', () => {
      expect(manager.isAwaitingModeSelection('user1')).toBe(false);
    });
  });

  describe('isAwaitingTelegramUsername', () => {
    test('returns true when awaiting telegram username', () => {
      manager.startOnboardingFlow('user1');
      manager.setUserMode('user1', 'dojo');
      expect(manager.isAwaitingTelegramUsername('user1')).toBe(true);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/user-context-onboarding.test.ts`
Expected: FAIL (methods don't exist)

**Step 3: Atualizar tipos do flow**

No `src/user-context-manager.ts`, atualizar imports e adicionar ao UserContext em types.ts:

```typescript
// Em src/types.ts, atualizar UserContext (line 94-124)
export interface UserContext {
  userId: string;
  currentFlow?: 'create_agent' | 'configure_priority' | 'configure_limit' | 'delete_agent' | 'edit_emoji' | 'configure_ralph' | 'onboarding';
  flowState?: 'awaiting_name' | 'awaiting_type' | 'awaiting_emoji' | 'awaiting_mode' | 'awaiting_workspace' | 'awaiting_workspace_choice' | 'awaiting_model_mode' | 'awaiting_confirmation' | 'awaiting_selection' | 'awaiting_emoji_text' | 'awaiting_ralph_task' | 'awaiting_ralph_max_iterations' | 'awaiting_mode_selection' | 'awaiting_telegram_username';
  flowData?: {
    agentName?: string;
    agentId?: string;
    agentType?: AgentType;
    emoji?: string;
    agentMode?: 'conversational' | 'ralph';
    workspace?: string;
    modelMode?: ModelMode;
    priority?: string;
    userMode?: UserMode;           // For onboarding flow
    telegramUsername?: string;     // For onboarding flow
    [key: string]: unknown;
  };
  // ... rest unchanged
}
```

**Step 4: Implementar métodos de onboarding no UserContextManager**

```typescript
// Em src/user-context-manager.ts, adicionar após linha ~200 (após outros flows)

  // ============================================
  // Onboarding Flow
  // States: awaiting_mode_selection → (awaiting_telegram_username for dojo) → complete
  // ============================================

  /**
   * Start the onboarding flow for mode selection
   */
  startOnboardingFlow(userId: string): void {
    this.contexts.set(userId, {
      userId,
      currentFlow: 'onboarding',
      flowState: 'awaiting_mode_selection',
      flowData: {},
    });
  }

  /**
   * Check if user is awaiting mode selection
   */
  isAwaitingModeSelection(userId: string): boolean {
    const context = this.contexts.get(userId);
    return context?.currentFlow === 'onboarding' && context?.flowState === 'awaiting_mode_selection';
  }

  /**
   * Set the user mode (ronin or dojo)
   */
  setUserMode(userId: string, mode: 'ronin' | 'dojo'): void {
    const context = this.contexts.get(userId);
    if (!context) return;

    context.flowData = { ...context.flowData, userMode: mode };

    if (mode === 'dojo') {
      context.flowState = 'awaiting_telegram_username';
    } else {
      // Ronin mode - complete onboarding
      this.contexts.delete(userId);
    }
  }

  /**
   * Check if user is awaiting telegram username
   */
  isAwaitingTelegramUsername(userId: string): boolean {
    const context = this.contexts.get(userId);
    return context?.currentFlow === 'onboarding' && context?.flowState === 'awaiting_telegram_username';
  }

  /**
   * Set telegram username (completes dojo onboarding)
   */
  setTelegramUsername(userId: string, username: string): void {
    const context = this.contexts.get(userId);
    if (!context) return;

    context.flowData = { ...context.flowData, telegramUsername: username };
    // Flow data is preserved for the caller to use, then they clear context
  }
```

**Step 5: Run tests**

Run: `bun test src/__tests__/user-context-onboarding.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/types.ts src/user-context-manager.ts src/__tests__/user-context-onboarding.test.ts
git commit -m "feat(user-context): add onboarding flow for mode selection"
```

---

### Task 1.3: Adicionar persistência de UserPreferences

**Files:**
- Modify: `src/persistence.ts`
- Create: `src/__tests__/persistence-preferences.test.ts`

**Step 1: Escrever testes**

```typescript
// src/__tests__/persistence-preferences.test.ts
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { PersistenceService } from '../persistence';
import { unlinkSync, existsSync } from 'fs';
import type { UserPreferences } from '../types';

const TEST_PREFS_FILE = './test-user-preferences.json';

describe('PersistenceService - User Preferences', () => {
  let service: PersistenceService;

  beforeEach(() => {
    service = new PersistenceService(undefined, TEST_PREFS_FILE);
  });

  afterEach(() => {
    if (existsSync(TEST_PREFS_FILE)) unlinkSync(TEST_PREFS_FILE);
    if (existsSync(TEST_PREFS_FILE + '.bak')) unlinkSync(TEST_PREFS_FILE + '.bak');
  });

  test('saves and loads user preferences', () => {
    const prefs: UserPreferences = {
      userId: 'user1',
      mode: 'dojo',
      telegramUsername: 'lucas',
      onboardingComplete: true,
    };

    service.saveUserPreferences(prefs);
    const loaded = service.loadUserPreferences('user1');

    expect(loaded).toEqual(prefs);
  });

  test('returns undefined for non-existent user', () => {
    const loaded = service.loadUserPreferences('nonexistent');
    expect(loaded).toBeUndefined();
  });

  test('updates existing preferences', () => {
    service.saveUserPreferences({
      userId: 'user1',
      mode: 'ronin',
      onboardingComplete: false,
    });

    service.saveUserPreferences({
      userId: 'user1',
      mode: 'dojo',
      telegramUsername: 'lucas',
      onboardingComplete: true,
    });

    const loaded = service.loadUserPreferences('user1');
    expect(loaded?.mode).toBe('dojo');
    expect(loaded?.telegramUsername).toBe('lucas');
  });

  test('handles multiple users', () => {
    service.saveUserPreferences({ userId: 'user1', mode: 'ronin', onboardingComplete: true });
    service.saveUserPreferences({ userId: 'user2', mode: 'dojo', telegramUsername: 'test', onboardingComplete: true });

    expect(service.loadUserPreferences('user1')?.mode).toBe('ronin');
    expect(service.loadUserPreferences('user2')?.mode).toBe('dojo');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/persistence-preferences.test.ts`
Expected: FAIL

**Step 3: Implementar persistência de preferências**

```typescript
// Em src/persistence.ts, adicionar imports
import type { UserPreferences, SerializedUserPreferences } from './types';

// Adicionar à classe PersistenceService:

  private preferencesFilePath: string;
  private preferences: Map<string, UserPreferences> = new Map();

  constructor(filePath?: string, preferencesFilePath?: string) {
    this.filePath = filePath || './agents-state.json';
    this.preferencesFilePath = preferencesFilePath || './user-preferences.json';
    this.loadPreferences();
  }

  // ============================================
  // User Preferences
  // ============================================

  private loadPreferences(): void {
    try {
      if (!existsSync(this.preferencesFilePath)) return;
      const content = readFileSync(this.preferencesFilePath, 'utf-8');
      const data = JSON.parse(content) as SerializedUserPreferences[];
      for (const prefs of data) {
        this.preferences.set(prefs.userId, prefs);
      }
    } catch (error) {
      console.error('Failed to load user preferences:', error);
    }
  }

  private savePreferencesToFile(): void {
    const data = Array.from(this.preferences.values());
    writeFileSync(this.preferencesFilePath, JSON.stringify(data, null, 2));
  }

  saveUserPreferences(prefs: UserPreferences): void {
    this.preferences.set(prefs.userId, prefs);
    this.savePreferencesToFile();
  }

  loadUserPreferences(userId: string): UserPreferences | undefined {
    return this.preferences.get(userId);
  }

  getAllUserPreferences(): UserPreferences[] {
    return Array.from(this.preferences.values());
  }
```

**Step 4: Run tests**

Run: `bun test src/__tests__/persistence-preferences.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/persistence.ts src/__tests__/persistence-preferences.test.ts
git commit -m "feat(persistence): add user preferences storage"
```

---

## Fase 2: Telegram Bot Integration

### Task 2.1: Instalar dependência e criar módulo base

**Files:**
- Modify: `package.json`
- Create: `src/telegram.ts`
- Create: `src/__tests__/telegram.test.ts`

**Step 1: Instalar node-telegram-bot-api**

```bash
bun add node-telegram-bot-api
bun add -d @types/node-telegram-bot-api
```

**Step 2: Criar módulo telegram.ts com estrutura base**

```typescript
// src/telegram.ts
/**
 * Telegram Bot API integration for Dojo mode
 *
 * Handles:
 * - Bot initialization
 * - Group creation/deletion
 * - Message sending
 * - Webhook processing
 */

import TelegramBot from 'node-telegram-bot-api';

// Configuration
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// Lazy initialization - bot is only created when needed
let bot: TelegramBot | null = null;

/**
 * Get or create the Telegram bot instance
 */
export function getTelegramBot(): TelegramBot | null {
  if (!TELEGRAM_BOT_TOKEN) {
    console.warn('TELEGRAM_BOT_TOKEN not set - Telegram features disabled');
    return null;
  }

  if (!bot) {
    bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: false });
  }

  return bot;
}

/**
 * Check if Telegram is configured
 */
export function isTelegramConfigured(): boolean {
  return !!TELEGRAM_BOT_TOKEN;
}

/**
 * Create a Telegram group for an agent
 * Returns the group chat ID
 */
export async function createTelegramGroup(
  name: string,
  description: string,
  userChatId: number
): Promise<number> {
  const telegramBot = getTelegramBot();
  if (!telegramBot) {
    throw new Error('Telegram not configured');
  }

  // Note: Telegram Bot API doesn't support creating groups directly.
  // The bot must be added to a group by the user, or we use supergroups.
  // For now, we'll use a workaround: send a message asking user to create group
  // and add the bot. In production, consider using Telegram's MTProto API.

  // Alternative approach: Create a "virtual" group using chat threads
  // For MVP, we'll track the chat ID when user starts conversation with /start <agentId>

  throw new Error('Group creation requires user interaction - use /newagent command in Telegram');
}

/**
 * Send a text message to a Telegram chat
 */
export async function sendTelegramMessage(
  chatId: number | string,
  text: string,
  options?: TelegramBot.SendMessageOptions
): Promise<TelegramBot.Message | null> {
  const telegramBot = getTelegramBot();
  if (!telegramBot) return null;

  try {
    return await telegramBot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      ...options,
    });
  } catch (error) {
    console.error('Failed to send Telegram message:', error);
    return null;
  }
}

/**
 * Send a document to a Telegram chat
 */
export async function sendTelegramDocument(
  chatId: number | string,
  document: Buffer | string,
  filename: string,
  caption?: string
): Promise<TelegramBot.Message | null> {
  const telegramBot = getTelegramBot();
  if (!telegramBot) return null;

  try {
    return await telegramBot.sendDocument(chatId, document, {
      caption,
    }, {
      filename,
    });
  } catch (error) {
    console.error('Failed to send Telegram document:', error);
    return null;
  }
}

/**
 * Send an inline keyboard with buttons
 */
export async function sendTelegramButtons(
  chatId: number | string,
  text: string,
  buttons: Array<{ text: string; callback_data: string }[]>
): Promise<TelegramBot.Message | null> {
  const telegramBot = getTelegramBot();
  if (!telegramBot) return null;

  try {
    return await telegramBot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: buttons,
      },
    });
  } catch (error) {
    console.error('Failed to send Telegram buttons:', error);
    return null;
  }
}

/**
 * Answer a callback query (button press)
 */
export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string
): Promise<boolean> {
  const telegramBot = getTelegramBot();
  if (!telegramBot) return false;

  try {
    return await telegramBot.answerCallbackQuery(callbackQueryId, { text });
  } catch (error) {
    console.error('Failed to answer callback query:', error);
    return false;
  }
}

/**
 * Get bot info
 */
export async function getBotInfo(): Promise<TelegramBot.User | null> {
  const telegramBot = getTelegramBot();
  if (!telegramBot) return null;

  try {
    return await telegramBot.getMe();
  } catch (error) {
    console.error('Failed to get bot info:', error);
    return null;
  }
}
```

**Step 3: Criar testes básicos**

```typescript
// src/__tests__/telegram.test.ts
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { isTelegramConfigured } from '../telegram';

describe('Telegram Module', () => {
  describe('isTelegramConfigured', () => {
    test('returns false when TELEGRAM_BOT_TOKEN not set', () => {
      // Token is not set in test environment
      const original = process.env.TELEGRAM_BOT_TOKEN;
      delete process.env.TELEGRAM_BOT_TOKEN;

      // Need to reimport to get fresh state
      expect(isTelegramConfigured()).toBe(false);

      if (original) process.env.TELEGRAM_BOT_TOKEN = original;
    });
  });
});
```

**Step 4: Run tests**

Run: `bun test src/__tests__/telegram.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add package.json bun.lockb src/telegram.ts src/__tests__/telegram.test.ts
git commit -m "feat(telegram): add Telegram bot module base"
```

---

### Task 2.2: Adicionar UI components do Telegram

**Files:**
- Modify: `src/telegram.ts`

**Step 1: Adicionar funções de UI**

```typescript
// Adicionar ao src/telegram.ts

/**
 * Send mode selector (for onboarding via Telegram)
 */
export async function sendTelegramModeSelector(chatId: number): Promise<void> {
  await sendTelegramButtons(chatId,
    '📋 *Como você quer organizar seus agentes?*\n\n' +
    '🏯 *Modo Dojo* (recomendado)\n' +
    'Agentes organizados no Telegram.\n' +
    'Cada agente em seu próprio território.\n' +
    'WhatsApp só para consultas rápidas.\n\n' +
    '🥷 *Modo Ronin*\n' +
    'Você e seus agentes, tudo no WhatsApp.\n' +
    'Simples, direto, sem estrutura.',
    [
      [
        { text: '🏯 Dojo (recomendado)', callback_data: 'mode_dojo' },
        { text: '🥷 Ronin', callback_data: 'mode_ronin' },
      ],
    ]
  );
}

/**
 * Send agent creation flow - name input
 */
export async function sendTelegramAgentNamePrompt(chatId: number): Promise<void> {
  await sendTelegramMessage(chatId,
    '➕ *Criar novo agente*\n\n' +
    'Qual o nome do agente?\n' +
    'Exemplo: Backend API, Data Analysis'
  );
}

/**
 * Send agent type selector
 */
export async function sendTelegramAgentTypeSelector(chatId: number): Promise<void> {
  await sendTelegramButtons(chatId,
    '🤖 *Tipo de agente*',
    [
      [
        { text: '🤖 Claude (AI)', callback_data: 'type_claude' },
        { text: '💻 Bash (Terminal)', callback_data: 'type_bash' },
      ],
    ]
  );
}

/**
 * Send agent mode selector (conversational/ralph)
 */
export async function sendTelegramAgentModeSelector(chatId: number): Promise<void> {
  await sendTelegramButtons(chatId,
    '💬 *Modo de operação*\n\n' +
    '*Conversacional*: Responde a cada mensagem\n' +
    '*Ralph*: Trabalha autonomamente em loops',
    [
      [
        { text: '💬 Conversacional', callback_data: 'agentmode_conversational' },
        { text: '🔄 Ralph Loop', callback_data: 'agentmode_ralph' },
      ],
    ]
  );
}

/**
 * Send emoji selector
 */
export async function sendTelegramEmojiSelector(chatId: number): Promise<void> {
  await sendTelegramButtons(chatId,
    '🎨 *Escolha um emoji*',
    [
      [
        { text: '🤖', callback_data: 'emoji_🤖' },
        { text: '🔧', callback_data: 'emoji_🔧' },
        { text: '📊', callback_data: 'emoji_📊' },
        { text: '💡', callback_data: 'emoji_💡' },
      ],
      [
        { text: '🎯', callback_data: 'emoji_🎯' },
        { text: '📝', callback_data: 'emoji_📝' },
        { text: '🚀', callback_data: 'emoji_🚀' },
        { text: '⚡', callback_data: 'emoji_⚡' },
      ],
      [
        { text: '🔍', callback_data: 'emoji_🔍' },
        { text: '💻', callback_data: 'emoji_💻' },
        { text: '🌐', callback_data: 'emoji_🌐' },
        { text: '📁', callback_data: 'emoji_📁' },
      ],
    ]
  );
}

/**
 * Send workspace selector
 */
export async function sendTelegramWorkspaceSelector(chatId: number): Promise<void> {
  const home = process.env.HOME || '/home/user';
  await sendTelegramButtons(chatId,
    '📁 *Workspace do agente*\n\n' +
    'Onde o agente vai trabalhar?',
    [
      [
        { text: '🏠 Home', callback_data: `workspace_${home}` },
        { text: '🖥️ Desktop', callback_data: `workspace_${home}/Desktop` },
      ],
      [
        { text: '📄 Documents', callback_data: `workspace_${home}/Documents` },
        { text: '⏭️ Pular', callback_data: 'workspace_skip' },
      ],
      [
        { text: '✏️ Customizado', callback_data: 'workspace_custom' },
      ],
    ]
  );
}

/**
 * Send model mode selector
 */
export async function sendTelegramModelModeSelector(chatId: number): Promise<void> {
  await sendTelegramButtons(chatId,
    '⚙️ *Modo de modelo*\n\n' +
    '*Seleção*: Pergunta qual modelo usar\n' +
    '*Fixo*: Sempre usa o mesmo modelo',
    [
      [
        { text: '🔄 Seleção', callback_data: 'modelmode_selection' },
      ],
      [
        { text: '⚡ Haiku', callback_data: 'modelmode_haiku' },
        { text: '🎭 Sonnet', callback_data: 'modelmode_sonnet' },
        { text: '🎼 Opus', callback_data: 'modelmode_opus' },
      ],
    ]
  );
}

/**
 * Send model selector for prompt
 */
export async function sendTelegramModelSelector(chatId: number, agentName: string): Promise<void> {
  await sendTelegramButtons(chatId,
    `🧠 *Modelo para ${agentName}*`,
    [
      [
        { text: '⚡ Haiku', callback_data: 'model_haiku' },
        { text: '🎭 Sonnet', callback_data: 'model_sonnet' },
        { text: '🎼 Opus', callback_data: 'model_opus' },
      ],
    ]
  );
}

/**
 * Send confirmation for agent creation
 */
export async function sendTelegramAgentConfirmation(
  chatId: number,
  name: string,
  emoji: string,
  type: string,
  mode: string,
  workspace: string | undefined,
  modelMode: string
): Promise<void> {
  const workspaceText = workspace || 'Nenhum (flexível)';
  await sendTelegramButtons(chatId,
    `✅ *Confirmar criação*\n\n` +
    `${emoji} *${name}*\n` +
    `📦 Tipo: ${type}\n` +
    `💬 Modo: ${mode}\n` +
    `📁 Workspace: ${workspaceText}\n` +
    `⚙️ Modelo: ${modelMode}`,
    [
      [
        { text: '✅ Criar', callback_data: 'confirm_create' },
        { text: '❌ Cancelar', callback_data: 'confirm_cancel' },
      ],
    ]
  );
}

/**
 * Send dojo activated message
 */
export async function sendTelegramDojoActivated(chatId: number, whatsAppRoninInfo: string): Promise<void> {
  await sendTelegramMessage(chatId,
    '🏯 *Dojo ativado!*\n\n' +
    '📱 *WhatsApp*: consultas rápidas (read-only)\n' +
    '💬 *Telegram*: seus agentes organizados\n\n' +
    'Use /criar para criar seu primeiro agente.\n\n' +
    `_${whatsAppRoninInfo}_`
  );
}

/**
 * Send command list
 */
export async function sendTelegramCommandList(chatId: number): Promise<void> {
  await sendTelegramMessage(chatId,
    '🏯 *Comandos do Dojo*\n\n' +
    '/criar - Criar novo agente\n' +
    '/agentes - Listar agentes\n' +
    '/status - Status de todos\n' +
    '/config - Configurações\n' +
    '/help - Esta ajuda'
  );
}

/**
 * Send agents list
 */
export async function sendTelegramAgentsList(
  chatId: number,
  agents: Array<{ id: string; name: string; emoji: string; status: string; workspace?: string }>
): Promise<void> {
  if (agents.length === 0) {
    await sendTelegramMessage(chatId,
      '📋 *Seus agentes*\n\n' +
      'Nenhum agente criado ainda.\n' +
      'Use /criar para criar um.'
    );
    return;
  }

  const statusEmoji: Record<string, string> = {
    idle: '⚪',
    processing: '🔵',
    error: '🔴',
    'ralph-loop': '🔄',
    'ralph-paused': '⏸️',
  };

  let text = '📋 *Seus agentes*\n\n';
  const buttons: Array<{ text: string; callback_data: string }[]> = [];

  for (const agent of agents) {
    const status = statusEmoji[agent.status] || '⚪';
    text += `${agent.emoji} *${agent.name}* ${status}\n`;
    if (agent.workspace) {
      text += `   📁 ${agent.workspace}\n`;
    }
    buttons.push([{ text: `${agent.emoji} ${agent.name}`, callback_data: `agent_${agent.id}` }]);
  }

  await sendTelegramButtons(chatId, text, buttons);
}
```

**Step 2: Commit**

```bash
git add src/telegram.ts
git commit -m "feat(telegram): add UI components for Dojo mode"
```

---

## Fase 3: Agente Ronin (Read-Only)

### Task 3.1: Criar RoninAgent com restrições

**Files:**
- Create: `src/ronin-agent.ts`
- Create: `src/__tests__/ronin-agent.test.ts`

**Step 1: Escrever testes**

```typescript
// src/__tests__/ronin-agent.test.ts
import { describe, test, expect } from 'bun:test';
import { RoninAgent, RONIN_SYSTEM_PROMPT, RONIN_ALLOWED_TOOLS } from '../ronin-agent';

describe('RoninAgent', () => {
  describe('RONIN_ALLOWED_TOOLS', () => {
    test('allows read-only tools', () => {
      expect(RONIN_ALLOWED_TOOLS).toContain('Read');
      expect(RONIN_ALLOWED_TOOLS).toContain('Glob');
      expect(RONIN_ALLOWED_TOOLS).toContain('Grep');
    });

    test('does not allow write tools', () => {
      expect(RONIN_ALLOWED_TOOLS).not.toContain('Write');
      expect(RONIN_ALLOWED_TOOLS).not.toContain('Edit');
      expect(RONIN_ALLOWED_TOOLS).not.toContain('Bash');
    });
  });

  describe('RONIN_SYSTEM_PROMPT', () => {
    test('includes read-only instruction', () => {
      expect(RONIN_SYSTEM_PROMPT).toContain('read-only');
    });

    test('includes concise instruction', () => {
      expect(RONIN_SYSTEM_PROMPT).toContain('concis');
    });
  });

  describe('isAllowedTool', () => {
    const ronin = new RoninAgent();

    test('returns true for allowed tools', () => {
      expect(ronin.isAllowedTool('Read')).toBe(true);
      expect(ronin.isAllowedTool('Glob')).toBe(true);
      expect(ronin.isAllowedTool('Grep')).toBe(true);
    });

    test('returns false for disallowed tools', () => {
      expect(ronin.isAllowedTool('Write')).toBe(false);
      expect(ronin.isAllowedTool('Edit')).toBe(false);
      expect(ronin.isAllowedTool('Bash')).toBe(false);
    });
  });

  describe('truncateResponse', () => {
    const ronin = new RoninAgent();

    test('keeps short responses unchanged', () => {
      const short = 'Hello world';
      expect(ronin.truncateResponse(short)).toBe(short);
    });

    test('truncates long responses', () => {
      const long = 'a'.repeat(1000);
      const truncated = ronin.truncateResponse(long, 100);
      expect(truncated.length).toBeLessThanOrEqual(103); // 100 + '...'
      expect(truncated).toContain('...');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/__tests__/ronin-agent.test.ts`
Expected: FAIL

**Step 3: Implementar RoninAgent**

```typescript
// src/ronin-agent.ts
/**
 * RoninAgent - Read-only agent for Dojo mode WhatsApp
 *
 * A lightweight, restricted agent that can only read and search.
 * Responds concisely (max 3 lines) and never modifies files.
 */

/**
 * Tools the Ronin agent is allowed to use
 */
export const RONIN_ALLOWED_TOOLS = [
  'Read',
  'Glob',
  'Grep',
  'LS',
  'WebSearch',
  'WebFetch',
] as const;

/**
 * System prompt for the Ronin agent
 */
export const RONIN_SYSTEM_PROMPT = `Você é o Ronin, um assistente read-only extremamente conciso.

REGRAS ABSOLUTAS:
1. Responda em NO MÁXIMO 3 linhas
2. Seja direto ao ponto - sem introduções ou conclusões
3. Você SÓ pode LER - nunca modifique arquivos
4. Se pedirem para modificar algo, diga: "Use o Dojo no Telegram para isso"
5. Prefira código inline a blocos de código
6. Sem emojis, sem formatação excessiva

Você tem acesso a: Read, Glob, Grep, LS, WebSearch, WebFetch.
Você NÃO tem acesso a: Write, Edit, Bash, NotebookEdit.

Exemplos de respostas boas:
- "A função está em src/utils.ts:42, recebe string e retorna number"
- "Erro na linha 15: falta fechar parênteses"
- "Use \`git status\` para ver mudanças pendentes"`;

/**
 * RoninAgent class for managing read-only interactions
 */
export class RoninAgent {
  private maxResponseLength: number;

  constructor(maxResponseLength = 500) {
    this.maxResponseLength = maxResponseLength;
  }

  /**
   * Check if a tool is allowed for Ronin
   */
  isAllowedTool(toolName: string): boolean {
    return RONIN_ALLOWED_TOOLS.includes(toolName as typeof RONIN_ALLOWED_TOOLS[number]);
  }

  /**
   * Get the system prompt
   */
  getSystemPrompt(): string {
    return RONIN_SYSTEM_PROMPT;
  }

  /**
   * Truncate response to max length
   */
  truncateResponse(response: string, maxLength?: number): string {
    const limit = maxLength || this.maxResponseLength;
    if (response.length <= limit) return response;
    return response.slice(0, limit) + '...';
  }

  /**
   * Filter tools from a response/event (for SDK integration)
   */
  filterDisallowedTools(tools: Array<{ name: string }>): Array<{ name: string; blocked: true; reason: string }> {
    return tools
      .filter(tool => !this.isAllowedTool(tool.name))
      .map(tool => ({
        name: tool.name,
        blocked: true,
        reason: 'Ronin é read-only. Use o Dojo no Telegram para modificações.',
      }));
  }
}

// Singleton instance
export const roninAgent = new RoninAgent();
```

**Step 4: Run tests**

Run: `bun test src/__tests__/ronin-agent.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/ronin-agent.ts src/__tests__/ronin-agent.test.ts
git commit -m "feat(ronin): add read-only Ronin agent for Dojo mode"
```

---

## Fase 4: WhatsApp UI para Onboarding

### Task 4.1: Adicionar componentes de onboarding no WhatsApp

**Files:**
- Modify: `src/whatsapp.ts`

**Step 1: Adicionar funções de UI para onboarding**

```typescript
// Adicionar ao src/whatsapp.ts

/**
 * Send mode selector for onboarding (Ronin vs Dojo)
 */
export async function sendUserModeSelector(to: string): Promise<void> {
  await sendButtons(to,
    '📋 Como você quer organizar seus agentes?\n\n' +
    '🏯 *Modo Dojo* (recomendado)\n' +
    'Agentes organizados no Telegram.\n' +
    'Cada agente em seu próprio território.\n' +
    'WhatsApp só para consultas rápidas.\n\n' +
    '🥷 *Modo Ronin*\n' +
    'Você e seus agentes, tudo no WhatsApp.\n' +
    'Simples, direto, sem estrutura.',
    [
      { id: 'usermode_dojo', title: '🏯 Dojo' },
      { id: 'usermode_ronin', title: '🥷 Ronin' },
    ]
  );
}

/**
 * Send telegram username prompt
 */
export async function sendTelegramUsernamePrompt(to: string): Promise<void> {
  await sendWhatsApp(to,
    '🏯 *Configurar Dojo*\n\n' +
    'Qual seu username do Telegram? (sem @)\n\n' +
    'Exemplo: se você é @lucas, digite apenas: lucas'
  );
}

/**
 * Send dojo activation confirmation
 */
export async function sendDojoActivated(to: string, telegramBotUsername: string): Promise<void> {
  await sendWhatsApp(to,
    '🏯 *Dojo ativado!*\n\n' +
    '📱 *WhatsApp*: consultas rápidas com o Ronin 🥷\n' +
    '💬 *Telegram*: seus agentes organizados\n\n' +
    `Abra o Telegram e inicie conversa com @${telegramBotUsername}\n\n` +
    '_Dica: O Ronin aqui é read-only e responde curto._'
  );
}

/**
 * Send ronin mode confirmation
 */
export async function sendRoninActivated(to: string): Promise<void> {
  await sendWhatsApp(to,
    '🥷 *Modo Ronin ativado!*\n\n' +
    'Todos os seus agentes ficam aqui no WhatsApp.\n' +
    'Use / para criar e gerenciar agentes.'
  );
}

/**
 * Send ronin response (concise, for Dojo mode WhatsApp)
 */
export async function sendRoninResponse(to: string, response: string): Promise<void> {
  // Ronin responses are always short and simple
  await sendWhatsApp(to, `🥷 ${response}`);
}

/**
 * Send ronin rejection (when user tries to do something Ronin can't)
 */
export async function sendRoninRejection(to: string, action: string): Promise<void> {
  await sendWhatsApp(to,
    `🥷 Não posso ${action} - sou read-only.\n` +
    'Use o Dojo no Telegram para isso.'
  );
}
```

**Step 2: Commit**

```bash
git add src/whatsapp.ts
git commit -m "feat(whatsapp): add onboarding UI components"
```

---

## Fase 5: Integração no Webhook

### Task 5.1: Adicionar lógica de modo no index.ts

**Files:**
- Modify: `src/index.ts`

**Step 1: Importar novos módulos**

```typescript
// Adicionar aos imports no src/index.ts
import {
  // ... existing imports ...
  sendUserModeSelector,
  sendTelegramUsernamePrompt,
  sendDojoActivated,
  sendRoninActivated,
  sendRoninResponse,
  sendRoninRejection,
} from './whatsapp';
import { roninAgent, RONIN_SYSTEM_PROMPT } from './ronin-agent';
import {
  isTelegramConfigured,
  sendTelegramMessage,
  sendTelegramDojoActivated,
  sendTelegramCommandList,
  getBotInfo,
} from './telegram';
import type { UserPreferences, UserMode } from './types';
```

**Step 2: Adicionar helper para verificar modo do usuário**

```typescript
// Adicionar após inicialização dos componentes

/**
 * Get user mode (ronin or dojo)
 */
function getUserMode(userId: string): UserMode {
  const prefs = persistenceService.loadUserPreferences(userId);
  return prefs?.mode || 'ronin'; // Default to ronin
}

/**
 * Check if user needs onboarding
 */
function needsOnboarding(userId: string): boolean {
  const prefs = persistenceService.loadUserPreferences(userId);
  return !prefs?.onboardingComplete;
}

/**
 * Check if user is in Dojo mode
 */
function isDojoMode(userId: string): boolean {
  return getUserMode(userId) === 'dojo';
}
```

**Step 3: Modificar handleTextMessage para suportar onboarding**

```typescript
// Modificar função handleTextMessage para verificar onboarding primeiro

async function handleTextMessage(from: string, text: string, messageId?: string, groupId?: string) {
  const start = Date.now();
  console.log(`> ${text}`);

  // Check if user needs onboarding (first time user trying to create agent)
  if (needsOnboarding(from) && !userContextManager.isInFlow(from)) {
    // If it's a command that would start agent creation, trigger onboarding
    if (text === '/' || text.toLowerCase() === '/criar' || text.toLowerCase() === '/new') {
      userContextManager.startOnboardingFlow(from);
      await sendUserModeSelector(from);
      console.log(`[timing] Total: ${Date.now() - start}ms`);
      return;
    }
  }

  // Handle onboarding flow
  if (userContextManager.getCurrentFlow(from) === 'onboarding') {
    await handleOnboardingFlow(from, text, messageId);
    console.log(`[timing] Total: ${Date.now() - start}ms`);
    return;
  }

  // If in Dojo mode, WhatsApp only accepts Ronin queries
  if (isDojoMode(from) && !groupId) {
    await handleRoninQuery(from, text, messageId);
    console.log(`[timing] Total: ${Date.now() - start}ms`);
    return;
  }

  // ... rest of existing handleTextMessage logic ...
}
```

**Step 4: Implementar handleOnboardingFlow**

```typescript
/**
 * Handle onboarding flow messages
 */
async function handleOnboardingFlow(from: string, text: string, messageId?: string) {
  const flowState = userContextManager.getCurrentFlowState(from);

  if (flowState === 'awaiting_telegram_username') {
    // User sent their Telegram username
    const username = text.trim().replace('@', '');
    userContextManager.setTelegramUsername(from, username);

    const flowData = userContextManager.getFlowData(from);

    // Save preferences
    const prefs: UserPreferences = {
      userId: from,
      mode: 'dojo',
      telegramUsername: username,
      onboardingComplete: true,
    };
    persistenceService.saveUserPreferences(prefs);

    // Clear flow
    userContextManager.clearContext(from);

    // Get bot username for message
    const botInfo = await getBotInfo();
    const botUsername = botInfo?.username || 'ClaudeTerminalBot';

    // Send confirmation
    await sendDojoActivated(from, botUsername);
  }
}
```

**Step 5: Implementar handleRoninQuery**

```typescript
/**
 * Handle Ronin (read-only) query in Dojo mode
 */
async function handleRoninQuery(from: string, text: string, messageId?: string) {
  // Commands that should redirect to Telegram
  if (text === '/' || text.startsWith('/criar') || text.startsWith('/new')) {
    await sendRoninRejection(from, 'criar agentes');
    return;
  }

  if (text === '/status') {
    await sendRoninRejection(from, 'ver status dos agentes');
    return;
  }

  if (text === '/modo') {
    // Allow changing mode
    await sendUserModeSelector(from);
    userContextManager.startOnboardingFlow(from);
    return;
  }

  if (text === '/help') {
    await sendWhatsApp(from,
      '🥷 *Ronin - Consultas Rápidas*\n\n' +
      'Pergunte qualquer coisa sobre código.\n' +
      'Sou read-only: só leio, não modifico.\n\n' +
      '/modo - Trocar para Ronin completo\n\n' +
      '_Para criar agentes, use o Dojo no Telegram._'
    );
    return;
  }

  // Process as Ronin query
  // Create or get Ronin agent
  let roninAgentData = agentManager.getAgentsByUserId(from).find(a => a.name === 'Ronin');

  if (!roninAgentData) {
    roninAgentData = agentManager.createAgent(from, 'Ronin', 'claude', '🥷');
    agentManager.setModelMode(roninAgentData.id, 'haiku'); // Fixed Haiku
  }

  // Send to Claude with Ronin system prompt
  try {
    agentManager.updateAgentStatus(roninAgentData.id, 'processing', 'Consultando...');

    const result = await terminal.send(
      roninAgentData.id,
      from,
      text,
      'haiku',
      undefined, // no workspace
      roninAgentData.sessionId,
      RONIN_SYSTEM_PROMPT // Custom system prompt
    );

    // Truncate response for conciseness
    const response = roninAgent.truncateResponse(result.response, 500);

    await sendRoninResponse(from, response);

    agentManager.updateAgentStatus(roninAgentData.id, 'idle', 'Pronto');

    if (result.sessionId) {
      agentManager.setSessionId(roninAgentData.id, result.sessionId);
    }
  } catch (error) {
    console.error('Ronin query error:', error);
    agentManager.updateAgentStatus(roninAgentData.id, 'error', 'Erro na consulta');
    await sendWhatsApp(from, '🥷 Erro ao consultar. Tente novamente.');
  }
}
```

**Step 6: Adicionar handler para botões de modo**

```typescript
// No handleInteractiveMessage, adicionar casos para usermode_

// Após outros cases de interactive
case 'usermode_dojo':
  if (userContextManager.isAwaitingModeSelection(from)) {
    if (!isTelegramConfigured()) {
      await sendWhatsApp(from, '❌ Telegram não configurado no servidor. Use modo Ronin.');
      userContextManager.clearContext(from);
      return;
    }
    userContextManager.setUserMode(from, 'dojo');
    await sendTelegramUsernamePrompt(from);
  }
  break;

case 'usermode_ronin':
  if (userContextManager.isAwaitingModeSelection(from)) {
    userContextManager.setUserMode(from, 'ronin');

    // Save preferences
    const prefs: UserPreferences = {
      userId: from,
      mode: 'ronin',
      onboardingComplete: true,
    };
    persistenceService.saveUserPreferences(prefs);

    await sendRoninActivated(from);
  }
  break;
```

**Step 7: Commit**

```bash
git add src/index.ts
git commit -m "feat(webhook): integrate onboarding and Ronin mode"
```

---

### Task 5.2: Adicionar webhook do Telegram

**Files:**
- Modify: `src/index.ts`

**Step 1: Adicionar endpoint do Telegram**

```typescript
// Adicionar após o webhook do WhatsApp

// =============================================================================
// Telegram Webhook
// =============================================================================

app.post('/telegram', async (c) => {
  try {
    const update = await c.req.json();
    await handleTelegramUpdate(update);
    return c.json({ ok: true });
  } catch (error) {
    console.error('Telegram webhook error:', error);
    return c.json({ ok: false }, 500);
  }
});

/**
 * Handle Telegram update
 */
async function handleTelegramUpdate(update: any) {
  // Handle callback queries (button presses)
  if (update.callback_query) {
    await handleTelegramCallback(update.callback_query);
    return;
  }

  // Handle messages
  if (update.message) {
    await handleTelegramMessage(update.message);
    return;
  }
}

/**
 * Handle Telegram message
 */
async function handleTelegramMessage(message: any) {
  const chatId = message.chat.id;
  const text = message.text || '';
  const from = message.from;

  console.log(`[telegram] ${from.username || from.id}: ${text}`);

  // Find user by telegram username
  const allPrefs = persistenceService.getAllUserPreferences();
  const userPrefs = allPrefs.find(p =>
    p.telegramUsername?.toLowerCase() === from.username?.toLowerCase()
  );

  if (!userPrefs) {
    await sendTelegramMessage(chatId,
      '❌ Usuário não encontrado.\n\n' +
      'Configure o Dojo primeiro pelo WhatsApp.'
    );
    return;
  }

  // Update telegram chat ID if not set
  if (!userPrefs.telegramChatId) {
    userPrefs.telegramChatId = chatId;
    persistenceService.saveUserPreferences(userPrefs);
  }

  const userId = userPrefs.userId;

  // Handle commands
  if (text.startsWith('/')) {
    await handleTelegramCommand(chatId, userId, text);
    return;
  }

  // Handle flow states
  if (userContextManager.isInFlow(userId)) {
    await handleTelegramFlow(chatId, userId, text);
    return;
  }

  // Check if message is from a group (agent chat)
  if (message.chat.type === 'group' || message.chat.type === 'supergroup') {
    await handleTelegramAgentMessage(chatId, userId, text, message);
    return;
  }

  // Default: show help
  await sendTelegramCommandList(chatId);
}

/**
 * Handle Telegram commands
 */
async function handleTelegramCommand(chatId: number, userId: string, text: string) {
  const command = text.split(' ')[0].toLowerCase();

  switch (command) {
    case '/start':
      await sendTelegramCommandList(chatId);
      break;

    case '/criar':
    case '/new':
      userContextManager.startCreateAgentFlow(userId);
      await sendTelegramAgentNamePrompt(chatId);
      break;

    case '/agentes':
    case '/list':
      const agents = agentManager.getAgentsByUserId(userId)
        .filter(a => a.name !== 'Ronin') // Exclude Ronin
        .map(a => ({
          id: a.id,
          name: a.name,
          emoji: a.emoji || '🤖',
          status: a.status,
          workspace: a.workspace,
        }));
      await sendTelegramAgentsList(chatId, agents);
      break;

    case '/status':
      await handleTelegramStatus(chatId, userId);
      break;

    case '/help':
      await sendTelegramCommandList(chatId);
      break;

    default:
      await sendTelegramMessage(chatId, '❓ Comando não reconhecido. Use /help.');
  }
}

/**
 * Handle Telegram flow (agent creation)
 */
async function handleTelegramFlow(chatId: number, userId: string, text: string) {
  const flow = userContextManager.getCurrentFlow(userId);
  const state = userContextManager.getCurrentFlowState(userId);

  if (flow === 'create_agent' && state === 'awaiting_name') {
    userContextManager.setAgentName(userId, text.trim());
    await sendTelegramAgentTypeSelector(chatId);
  }
  // Other states handled by callback queries
}

/**
 * Handle Telegram callback (button press)
 */
async function handleTelegramCallback(query: any) {
  const chatId = query.message.chat.id;
  const data = query.data;
  const from = query.from;

  await answerCallbackQuery(query.id);

  // Find user
  const allPrefs = persistenceService.getAllUserPreferences();
  const userPrefs = allPrefs.find(p =>
    p.telegramUsername?.toLowerCase() === from.username?.toLowerCase()
  );

  if (!userPrefs) return;
  const userId = userPrefs.userId;

  // Handle different callbacks
  if (data.startsWith('type_')) {
    const type = data.replace('type_', '') as 'claude' | 'bash';
    userContextManager.setAgentType(userId, type);
    await sendTelegramEmojiSelector(chatId);
  }
  else if (data.startsWith('emoji_')) {
    const emoji = data.replace('emoji_', '');
    userContextManager.setAgentEmoji(userId, emoji);
    await sendTelegramAgentModeSelector(chatId);
  }
  else if (data.startsWith('agentmode_')) {
    const mode = data.replace('agentmode_', '') as 'conversational' | 'ralph';
    userContextManager.setAgentMode(userId, mode);
    await sendTelegramWorkspaceSelector(chatId);
  }
  else if (data.startsWith('workspace_')) {
    const workspace = data.replace('workspace_', '');
    if (workspace !== 'skip' && workspace !== 'custom') {
      userContextManager.setAgentWorkspace(userId, workspace);
    }
    await sendTelegramModelModeSelector(chatId);
  }
  else if (data.startsWith('modelmode_')) {
    const modelMode = data.replace('modelmode_', '') as ModelMode;
    userContextManager.setAgentModelMode(userId, modelMode);

    // Show confirmation
    const flowData = userContextManager.getFlowData(userId);
    await sendTelegramAgentConfirmation(
      chatId,
      flowData?.agentName || 'Agent',
      flowData?.emoji || '🤖',
      flowData?.agentType || 'claude',
      flowData?.agentMode || 'conversational',
      flowData?.workspace,
      modelMode
    );
  }
  else if (data === 'confirm_create') {
    const flowData = userContextManager.getFlowData(userId);
    if (flowData?.agentName) {
      const agent = agentManager.createAgent(
        userId,
        flowData.agentName,
        flowData.agentType || 'claude',
        flowData.emoji,
        flowData.workspace,
        flowData.agentMode || 'conversational',
        flowData.modelMode || 'selection'
      );

      userContextManager.clearContext(userId);

      await sendTelegramMessage(chatId,
        `✅ Agente *${agent.name}* criado!\n\n` +
        `Crie um grupo no Telegram, adicione @ClaudeTerminalBot, e use /vincular ${agent.id}`
      );
    }
  }
  else if (data === 'confirm_cancel') {
    userContextManager.clearContext(userId);
    await sendTelegramMessage(chatId, '❌ Criação cancelada.');
  }
  else if (data.startsWith('agent_')) {
    const agentId = data.replace('agent_', '');
    await handleTelegramAgentMenu(chatId, userId, agentId);
  }
}

/**
 * Handle status command
 */
async function handleTelegramStatus(chatId: number, userId: string) {
  const agents = agentManager.getAgentsByUserId(userId).filter(a => a.name !== 'Ronin');

  if (agents.length === 0) {
    await sendTelegramMessage(chatId, '📊 Nenhum agente criado ainda.');
    return;
  }

  const statusEmoji: Record<string, string> = {
    idle: '⚪',
    processing: '🔵',
    error: '🔴',
    'ralph-loop': '🔄',
    'ralph-paused': '⏸️',
  };

  let text = '📊 *Status dos Agentes*\n\n';
  for (const agent of agents) {
    const status = statusEmoji[agent.status] || '⚪';
    text += `${agent.emoji || '🤖'} *${agent.name}* ${status}\n`;
    text += `   ${agent.statusDetails}\n`;
  }

  await sendTelegramMessage(chatId, text);
}

/**
 * Handle agent menu
 */
async function handleTelegramAgentMenu(chatId: number, userId: string, agentId: string) {
  const agent = agentManager.getAgent(agentId);
  if (!agent || agent.userId !== userId) {
    await sendTelegramMessage(chatId, '❌ Agente não encontrado.');
    return;
  }

  await sendTelegramButtons(chatId,
    `${agent.emoji || '🤖'} *${agent.name}*\n\n` +
    `📁 ${agent.workspace || 'Sem workspace'}\n` +
    `⚙️ Modelo: ${agent.modelMode}\n` +
    `📊 Status: ${agent.status}`,
    [
      [
        { text: '💬 Enviar prompt', callback_data: `prompt_${agentId}` },
        { text: '📜 Histórico', callback_data: `history_${agentId}` },
      ],
      [
        { text: '🔄 Reset', callback_data: `reset_${agentId}` },
        { text: '🗑️ Deletar', callback_data: `delete_${agentId}` },
      ],
    ]
  );
}

/**
 * Handle message in agent group
 */
async function handleTelegramAgentMessage(chatId: number, userId: string, text: string, message: any) {
  // Find agent linked to this group
  const agents = agentManager.getAgentsByUserId(userId);
  const agent = agents.find(a => a.groupId === String(chatId));

  if (!agent) {
    await sendTelegramMessage(chatId,
      '❓ Este grupo não está vinculado a nenhum agente.\n' +
      'Use /vincular <agent_id> para vincular.'
    );
    return;
  }

  // Process prompt with agent
  // ... implement similar to WhatsApp prompt handling
  await sendTelegramMessage(chatId, `🔄 Processando com ${agent.name}...`);

  // TODO: Implement full prompt processing
}
```

**Step 2: Importar funções do Telegram**

```typescript
// Atualizar imports do telegram.ts
import {
  isTelegramConfigured,
  sendTelegramMessage,
  sendTelegramButtons,
  sendTelegramDojoActivated,
  sendTelegramCommandList,
  sendTelegramAgentNamePrompt,
  sendTelegramAgentTypeSelector,
  sendTelegramEmojiSelector,
  sendTelegramAgentModeSelector,
  sendTelegramWorkspaceSelector,
  sendTelegramModelModeSelector,
  sendTelegramAgentConfirmation,
  sendTelegramAgentsList,
  answerCallbackQuery,
  getBotInfo,
} from './telegram';
```

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat(webhook): add Telegram webhook handler"
```

---

## Fase 6: Testes de Integração

### Task 6.1: Testes de integração do onboarding

**Files:**
- Create: `src/__tests__/integration-onboarding.test.ts`

**Step 1: Escrever testes de integração**

```typescript
// src/__tests__/integration-onboarding.test.ts
import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { UserContextManager } from '../user-context-manager';
import { PersistenceService } from '../persistence';

// Mock persistence to use in-memory
class MockPersistenceService {
  private prefs = new Map();

  saveUserPreferences(prefs: any) {
    this.prefs.set(prefs.userId, prefs);
  }

  loadUserPreferences(userId: string) {
    return this.prefs.get(userId);
  }

  getAllUserPreferences() {
    return Array.from(this.prefs.values());
  }
}

describe('Integration: Onboarding Flow', () => {
  let userContext: UserContextManager;
  let persistence: MockPersistenceService;

  beforeEach(() => {
    userContext = new UserContextManager();
    persistence = new MockPersistenceService();
  });

  describe('Ronin mode selection', () => {
    test('completes onboarding for ronin mode', () => {
      const userId = 'user1';

      // Start onboarding
      userContext.startOnboardingFlow(userId);
      expect(userContext.isAwaitingModeSelection(userId)).toBe(true);

      // Select ronin
      userContext.setUserMode(userId, 'ronin');

      // Flow should be complete
      expect(userContext.isInFlow(userId)).toBe(false);

      // Save preferences
      persistence.saveUserPreferences({
        userId,
        mode: 'ronin',
        onboardingComplete: true,
      });

      const prefs = persistence.loadUserPreferences(userId);
      expect(prefs?.mode).toBe('ronin');
      expect(prefs?.onboardingComplete).toBe(true);
    });
  });

  describe('Dojo mode selection', () => {
    test('requires telegram username for dojo mode', () => {
      const userId = 'user1';

      // Start onboarding
      userContext.startOnboardingFlow(userId);

      // Select dojo
      userContext.setUserMode(userId, 'dojo');

      // Should now await telegram username
      expect(userContext.isAwaitingTelegramUsername(userId)).toBe(true);
      expect(userContext.isInFlow(userId)).toBe(true);
    });

    test('completes onboarding after telegram username', () => {
      const userId = 'user1';

      // Start onboarding
      userContext.startOnboardingFlow(userId);
      userContext.setUserMode(userId, 'dojo');
      userContext.setTelegramUsername(userId, 'lucas');

      const flowData = userContext.getFlowData(userId);
      expect(flowData?.telegramUsername).toBe('lucas');
      expect(flowData?.userMode).toBe('dojo');

      // Save preferences
      persistence.saveUserPreferences({
        userId,
        mode: 'dojo',
        telegramUsername: 'lucas',
        onboardingComplete: true,
      });

      const prefs = persistence.loadUserPreferences(userId);
      expect(prefs?.mode).toBe('dojo');
      expect(prefs?.telegramUsername).toBe('lucas');
    });
  });

  describe('Mode switching', () => {
    test('can switch from ronin to dojo', () => {
      const userId = 'user1';

      // Initial ronin
      persistence.saveUserPreferences({
        userId,
        mode: 'ronin',
        onboardingComplete: true,
      });

      // Switch to dojo
      persistence.saveUserPreferences({
        userId,
        mode: 'dojo',
        telegramUsername: 'lucas',
        onboardingComplete: true,
      });

      const prefs = persistence.loadUserPreferences(userId);
      expect(prefs?.mode).toBe('dojo');
    });
  });
});
```

**Step 2: Run tests**

Run: `bun test src/__tests__/integration-onboarding.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add src/__tests__/integration-onboarding.test.ts
git commit -m "test: add onboarding integration tests"
```

---

### Task 6.2: Rodar todos os testes

**Step 1: Run all tests**

Run: `bun test`
Expected: All tests PASS

**Step 2: Fix any failing tests**

If tests fail, fix them before proceeding.

**Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve test failures"
```

---

## Fase 7: Documentação

### Task 7.1: Atualizar CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Adicionar seção sobre modos**

```markdown
## Modos de Operação

### Modo Ronin 🥷 (padrão)
Todos os agentes vivem no WhatsApp. Use / para criar e gerenciar agentes.

### Modo Dojo 🏯
- **WhatsApp**: Apenas o agente Ronin (read-only, Haiku, respostas curtas)
- **Telegram**: Agentes organizados em grupos separados

### Variáveis de Ambiente (Dojo)
```env
TELEGRAM_BOT_TOKEN=xxx    # Token do @BotFather
```

### Onboarding
Na primeira vez que o usuário tenta criar um agente, o sistema pergunta qual modo usar.
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add Ronin/Dojo modes documentation"
```

---

## Resumo das Fases

| Fase | Tasks | Descrição |
|------|-------|-----------|
| 1 | 1.1-1.3 | Tipos, UserContext, Persistência |
| 2 | 2.1-2.2 | Telegram bot e UI |
| 3 | 3.1 | Agente Ronin read-only |
| 4 | 4.1 | WhatsApp onboarding UI |
| 5 | 5.1-5.2 | Integração webhook |
| 6 | 6.1-6.2 | Testes de integração |
| 7 | 7.1 | Documentação |

**Total: 12 tasks**
