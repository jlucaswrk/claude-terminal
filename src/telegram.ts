// src/telegram.ts
/**
 * Telegram Bot API integration for Dojo mode
 *
 * Handles:
 * - Bot initialization
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
        { text: 'Home', callback_data: `workspace_${home}` },
        { text: 'Desktop', callback_data: `workspace_${home}/Desktop` },
      ],
      [
        { text: 'Documents', callback_data: `workspace_${home}/Documents` },
        { text: 'Pular', callback_data: 'workspace_skip' },
      ],
      [
        { text: 'Customizado', callback_data: 'workspace_custom' },
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
