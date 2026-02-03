// src/telegram.ts
/**
 * Telegram Bot API integration for Dojo mode
 *
 * Handles:
 * - Bot initialization
 * - Message sending
 * - Webhook processing
 * - Group management (via Bot API - limited capabilities)
 *
 * Note: Telegram Bot API cannot create groups programmatically.
 * Only the Client API (MTProto) can create groups. We provide
 * guided onboarding for manual group creation instead.
 */

import TelegramBot from 'node-telegram-bot-api';
import { existsSync, mkdirSync, rmSync, readdirSync } from 'fs';
import { join } from 'path';

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
 * Send a photo to a Telegram chat
 */
export async function sendTelegramPhoto(
  chatId: number | string,
  photo: Buffer | string,
  caption?: string
): Promise<TelegramBot.Message | null> {
  const telegramBot = getTelegramBot();
  if (!telegramBot) return null;

  try {
    return await telegramBot.sendPhoto(chatId, photo, { caption });
  } catch (error) {
    console.error('Failed to send Telegram photo:', error);
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

/**
 * Set webhook URL for the bot
 */
export async function setTelegramWebhook(url: string): Promise<boolean> {
  const telegramBot = getTelegramBot();
  if (!telegramBot) return false;

  try {
    return await telegramBot.setWebHook(url);
  } catch (error) {
    console.error('Failed to set Telegram webhook:', error);
    return false;
  }
}

// ============================================
// UI Components for Dojo Mode
// ============================================

/**
 * Send mode selector (for onboarding via Telegram)
 */
export async function sendTelegramModeSelector(chatId: number): Promise<void> {
  await sendTelegramButtons(chatId,
    '*Como voce quer organizar seus agentes?*\n\n' +
    '*Modo Dojo* (recomendado)\n' +
    'Agentes organizados no Telegram.\n' +
    'Cada agente em seu proprio territorio.\n' +
    'WhatsApp so para consultas rapidas.\n\n' +
    '*Modo Ronin*\n' +
    'Voce e seus agentes, tudo no WhatsApp.\n' +
    'Simples, direto, sem estrutura.',
    [
      [
        { text: 'Dojo (recomendado)', callback_data: 'mode_dojo' },
        { text: 'Ronin', callback_data: 'mode_ronin' },
      ],
    ]
  );
}

/**
 * Send agent creation flow - name input
 */
export async function sendTelegramAgentNamePrompt(chatId: number): Promise<void> {
  await sendTelegramMessage(chatId,
    '*Criar novo agente*\n\n' +
    'Qual o nome do agente?\n' +
    'Exemplo: Backend API, Data Analysis'
  );
}

/**
 * Send agent type selector
 */
export async function sendTelegramAgentTypeSelector(chatId: number): Promise<void> {
  await sendTelegramButtons(chatId,
    '*Tipo de agente*',
    [
      [
        { text: 'Claude (AI)', callback_data: 'type_claude' },
        { text: 'Bash (Terminal)', callback_data: 'type_bash' },
      ],
    ]
  );
}

/**
 * Send agent mode selector (conversational/ralph)
 */
export async function sendTelegramAgentModeSelector(chatId: number): Promise<void> {
  await sendTelegramButtons(chatId,
    '*Modo de operacao*\n\n' +
    '*Conversacional*: Responde a cada mensagem\n' +
    '*Ralph*: Trabalha autonomamente em loops',
    [
      [
        { text: 'Conversacional', callback_data: 'agentmode_conversational' },
        { text: 'Ralph Loop', callback_data: 'agentmode_ralph' },
      ],
    ]
  );
}

/**
 * Send emoji selector
 */
export async function sendTelegramEmojiSelector(chatId: number): Promise<void> {
  await sendTelegramButtons(chatId,
    '*Escolha um emoji*',
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
    '*Workspace do agente*\n\n' +
    'Onde o agente vai trabalhar?',
    [
      [
        { text: '🏠 Home', callback_data: `workspace_${home}` },
        { text: '📂 Desktop', callback_data: `workspace_${home}/Desktop` },
      ],
      [
        { text: '📄 Documents', callback_data: `workspace_${home}/Documents` },
        { text: '🧪 Sandbox', callback_data: 'workspace_sandbox' },
      ],
      [
        { text: '✏️ Customizado', callback_data: 'workspace_custom' },
        { text: '⏭️ Pular', callback_data: 'workspace_skip' },
      ],
    ]
  );
}

/**
 * Send model mode selector
 */
export async function sendTelegramModelModeSelector(chatId: number): Promise<void> {
  await sendTelegramButtons(chatId,
    '*Modo de modelo*\n\n' +
    '*Selecao*: Pergunta qual modelo usar\n' +
    '*Fixo*: Sempre usa o mesmo modelo',
    [
      [
        { text: 'Selecao', callback_data: 'modelmode_selection' },
      ],
      [
        { text: 'Haiku', callback_data: 'modelmode_haiku' },
        { text: 'Sonnet', callback_data: 'modelmode_sonnet' },
        { text: 'Opus', callback_data: 'modelmode_opus' },
      ],
    ]
  );
}

/**
 * Send model selector for prompt
 */
export async function sendTelegramModelSelector(chatId: number, agentName: string): Promise<void> {
  await sendTelegramButtons(chatId,
    `*Modelo para ${agentName}*`,
    [
      [
        { text: 'Haiku', callback_data: 'model_haiku' },
        { text: 'Sonnet', callback_data: 'model_sonnet' },
        { text: 'Opus', callback_data: 'model_opus' },
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
  const workspaceText = workspace || 'Nenhum (flexivel)';
  await sendTelegramButtons(chatId,
    `*Confirmar criacao*\n\n` +
    `${emoji} *${name}*\n` +
    `Tipo: ${type}\n` +
    `Modo: ${mode}\n` +
    `Workspace: ${workspaceText}\n` +
    `Modelo: ${modelMode}`,
    [
      [
        { text: 'Criar', callback_data: 'confirm_create' },
        { text: 'Cancelar', callback_data: 'confirm_cancel' },
      ],
    ]
  );
}

/**
 * Send dojo activated message
 */
export async function sendTelegramDojoActivated(chatId: number, whatsAppRoninInfo: string): Promise<void> {
  await sendTelegramMessage(chatId,
    '*Dojo ativado!*\n\n' +
    '*WhatsApp*: consultas rapidas (read-only)\n' +
    '*Telegram*: seus agentes organizados\n\n' +
    'Use /criar para criar seu primeiro agente.\n\n' +
    `_${whatsAppRoninInfo}_`
  );
}

/**
 * Send command list
 */
export async function sendTelegramCommandList(chatId: number): Promise<void> {
  await sendTelegramMessage(chatId,
    '*Comandos do Dojo*\n\n' +
    '/criar - Criar novo agente\n' +
    '/agentes - Listar agentes\n' +
    '/status - Status de todos\n' +
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
      '*Seus agentes*\n\n' +
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

  let text = '*Seus agentes*\n\n';
  const buttons: Array<{ text: string; callback_data: string }[]> = [];

  for (const agent of agents) {
    const status = statusEmoji[agent.status] || '⚪';
    text += `${agent.emoji} *${agent.name}* ${status}\n`;
    if (agent.workspace) {
      text += `   ${agent.workspace}\n`;
    }
    buttons.push([{ text: `${agent.emoji} ${agent.name}`, callback_data: `agent_${agent.id}` }]);
  }

  await sendTelegramButtons(chatId, text, buttons);
}

// ============================================
// Telegram Group Management API
// ============================================

/**
 * Link result for group-agent association
 */
export interface GroupLinkResult {
  success: boolean;
  error?: string;
}

/**
 * Link a Telegram group to an agent
 * Called when bot detects it was added to a group via my_chat_member update
 *
 * Note: This function is for tracking/association only.
 * The actual linking is done through AgentManager.setTelegramChatId()
 */
export function linkTelegramGroupToAgent(chatId: number, agentId: string): GroupLinkResult {
  // This is a tracking function - actual linking is done through AgentManager
  // We just validate the inputs here
  if (!chatId || chatId === 0) {
    return { success: false, error: 'Invalid chat ID' };
  }
  if (!agentId || agentId.trim() === '') {
    return { success: false, error: 'Invalid agent ID' };
  }
  return { success: true };
}

/**
 * Bot leaves a Telegram group
 */
export async function leaveTelegramGroup(chatId: number): Promise<boolean> {
  const telegramBot = getTelegramBot();
  if (!telegramBot) return false;

  try {
    await telegramBot.leaveChat(chatId);
    return true;
  } catch (error) {
    console.error('Failed to leave Telegram group:', error);
    return false;
  }
}

/**
 * Update Telegram group title
 * Note: Bot must be an admin with change_info permission
 */
export async function updateTelegramGroupTitle(chatId: number, title: string): Promise<boolean> {
  const telegramBot = getTelegramBot();
  if (!telegramBot) return false;

  try {
    await telegramBot.setChatTitle(chatId, title);
    return true;
  } catch (error) {
    console.error('Failed to update Telegram group title:', error);
    return false;
  }
}

/**
 * Update Telegram group description
 * Note: Bot must be an admin with change_info permission
 */
export async function updateTelegramGroupDescription(chatId: number, description: string): Promise<boolean> {
  const telegramBot = getTelegramBot();
  if (!telegramBot) return false;

  try {
    await telegramBot.setChatDescription(chatId, description);
    return true;
  } catch (error) {
    console.error('Failed to update Telegram group description:', error);
    return false;
  }
}

/**
 * Send instructions for manual group creation
 * Telegram Bot API cannot create groups - only MTProto/Client API can
 * This guides users through manual group creation and bot addition
 */
export async function sendGroupCreationInstructions(
  chatId: number,
  agentName: string,
  agentEmoji: string
): Promise<void> {
  const botInfo = await getBotInfo();
  const botUsername = botInfo?.username || 'seu_bot';

  await sendTelegramMessage(chatId,
    `*Criar grupo para ${agentEmoji} ${agentName}*\n\n` +
    `O Telegram nao permite que bots criem grupos automaticamente. ` +
    `Siga estes passos:\n\n` +
    `1️⃣ Crie um novo grupo no Telegram\n` +
    `2️⃣ Nomeie o grupo: "${agentEmoji} ${agentName}"\n` +
    `3️⃣ Adicione @${botUsername} ao grupo\n` +
    `4️⃣ Promova o bot para admin (opcional, para editar nome/descricao)\n\n` +
    `Quando voce adicionar o bot ao grupo, ele sera vinculado automaticamente ao agente.\n\n` +
    `_Dica: Grupos separados por agente ajudam a organizar conversas e historico._`
  );
}

/**
 * Send confirmation that bot was added to a group
 */
export async function sendGroupLinkedConfirmation(
  chatId: number,
  agentName: string,
  agentEmoji: string
): Promise<void> {
  await sendTelegramMessage(chatId,
    `${agentEmoji} *Grupo vinculado!*\n\n` +
    `Este grupo agora esta conectado ao agente *${agentName}*.\n\n` +
    `Envie mensagens aqui para interagir diretamente com o agente.\n` +
    `Use /status para ver o estado do agente.`
  );
}

/**
 * Get chat information
 */
export async function getTelegramChat(chatId: number): Promise<TelegramBot.Chat | null> {
  const telegramBot = getTelegramBot();
  if (!telegramBot) return null;

  try {
    return await telegramBot.getChat(chatId);
  } catch (error) {
    console.error('Failed to get Telegram chat:', error);
    return null;
  }
}

// ============================================
// Workspace Sandbox Management
// ============================================

/**
 * Default sandbox directory path
 */
export const SANDBOX_DIR = join(process.env.HOME || '/tmp', 'temp', 'claude-terminal-sandbox');

/**
 * Ensure the sandbox directory exists
 * Creates ~/temp/claude-terminal-sandbox if it doesn't exist
 */
export function ensureSandboxDirectory(): string {
  const tempDir = join(process.env.HOME || '/tmp', 'temp');

  // Create parent temp directory if needed
  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true });
  }

  // Create sandbox directory if needed
  if (!existsSync(SANDBOX_DIR)) {
    mkdirSync(SANDBOX_DIR, { recursive: true });
  }

  return SANDBOX_DIR;
}

/**
 * Get or create an agent-specific sandbox directory
 */
export function getAgentSandboxPath(agentId: string): string {
  ensureSandboxDirectory();
  const agentPath = join(SANDBOX_DIR, agentId);

  if (!existsSync(agentPath)) {
    mkdirSync(agentPath, { recursive: true });
  }

  return agentPath;
}

/**
 * Clean up an agent's sandbox directory
 */
export function cleanupAgentSandbox(agentId: string): boolean {
  const agentPath = join(SANDBOX_DIR, agentId);

  if (!existsSync(agentPath)) {
    return true; // Already clean
  }

  try {
    rmSync(agentPath, { recursive: true, force: true });
    return true;
  } catch (error) {
    console.error(`Failed to cleanup sandbox for agent ${agentId}:`, error);
    return false;
  }
}

/**
 * Clean up all orphaned sandbox directories
 * Removes directories for agents that no longer exist
 */
export function cleanupOrphanedSandboxes(activeAgentIds: string[]): number {
  if (!existsSync(SANDBOX_DIR)) {
    return 0;
  }

  let cleaned = 0;
  const activeSet = new Set(activeAgentIds);

  try {
    const entries = readdirSync(SANDBOX_DIR, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() && !activeSet.has(entry.name)) {
        const orphanPath = join(SANDBOX_DIR, entry.name);
        try {
          rmSync(orphanPath, { recursive: true, force: true });
          cleaned++;
          console.log(`Cleaned orphaned sandbox: ${entry.name}`);
        } catch (error) {
          console.error(`Failed to clean orphaned sandbox ${entry.name}:`, error);
        }
      }
    }
  } catch (error) {
    console.error('Failed to list sandbox directory:', error);
  }

  return cleaned;
}

/**
 * Get sandbox statistics
 */
export function getSandboxStats(): { total: number; directories: string[] } {
  if (!existsSync(SANDBOX_DIR)) {
    return { total: 0, directories: [] };
  }

  try {
    const entries = readdirSync(SANDBOX_DIR, { withFileTypes: true });
    const directories = entries.filter(e => e.isDirectory()).map(e => e.name);
    return { total: directories.length, directories };
  } catch (error) {
    console.error('Failed to get sandbox stats:', error);
    return { total: 0, directories: [] };
  }
}
