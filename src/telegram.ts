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
 * @param chatId - The chat ID to send to
 * @param text - Message text
 * @param options - Additional SendMessageOptions
 * @param threadId - Optional message_thread_id for forum topics (threadId > 1 routes to specific topic)
 */
export async function sendTelegramMessage(
  chatId: number | string,
  text: string,
  options?: TelegramBot.SendMessageOptions,
  threadId?: number
): Promise<TelegramBot.Message | null> {
  const telegramBot = getTelegramBot();
  if (!telegramBot) return null;

  try {
    const sendOptions: TelegramBot.SendMessageOptions = {
      parse_mode: 'Markdown',
      ...options,
    };

    // Add thread ID for forum topics (threadId > 1 means specific topic)
    if (threadId !== undefined && threadId > 1) {
      sendOptions.message_thread_id = threadId;
    }

    return await telegramBot.sendMessage(chatId, text, sendOptions);
  } catch (error) {
    console.error('Failed to send Telegram message:', error);
    return null;
  }
}

/**
 * Send a document to a Telegram chat
 * @param chatId - The chat ID to send to
 * @param document - Document buffer or URL
 * @param filename - File name
 * @param caption - Optional caption
 * @param threadId - Optional message_thread_id for forum topics (threadId > 1 routes to specific topic)
 */
export async function sendTelegramDocument(
  chatId: number | string,
  document: Buffer | string,
  filename: string,
  caption?: string,
  threadId?: number
): Promise<TelegramBot.Message | null> {
  const telegramBot = getTelegramBot();
  if (!telegramBot) return null;

  try {
    const options: TelegramBot.SendDocumentOptions = { caption };
    if (threadId !== undefined && threadId > 1) {
      options.message_thread_id = threadId;
    }
    return await telegramBot.sendDocument(chatId, document, options, {
      filename,
    });
  } catch (error) {
    console.error('Failed to send Telegram document:', error);
    return null;
  }
}

/**
 * Send a photo to a Telegram chat
 * @param chatId - The chat ID to send to
 * @param photo - Photo buffer or URL
 * @param caption - Optional caption
 * @param threadId - Optional message_thread_id for forum topics (threadId > 1 routes to specific topic)
 */
export async function sendTelegramPhoto(
  chatId: number | string,
  photo: Buffer | string,
  caption?: string,
  threadId?: number
): Promise<TelegramBot.Message | null> {
  const telegramBot = getTelegramBot();
  if (!telegramBot) return null;

  try {
    const options: TelegramBot.SendPhotoOptions = { caption };
    if (threadId !== undefined && threadId > 1) {
      options.message_thread_id = threadId;
    }
    return await telegramBot.sendPhoto(chatId, photo, options);
  } catch (error) {
    console.error('Failed to send Telegram photo:', error);
    return null;
  }
}

/**
 * Send an inline keyboard with buttons
 * @param chatId - The chat ID to send to
 * @param text - Message text
 * @param buttons - Array of button rows
 * @param threadId - Optional message_thread_id for forum topics (threadId > 1 routes to specific topic)
 */
export async function sendTelegramButtons(
  chatId: number | string,
  text: string,
  buttons: Array<{ text: string; callback_data: string }[]>,
  threadId?: number
): Promise<TelegramBot.Message | null> {
  const telegramBot = getTelegramBot();
  if (!telegramBot) return null;

  try {
    const options: TelegramBot.SendMessageOptions = {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: buttons,
      },
    };

    // Add thread ID for forum topics (threadId > 1 means specific topic)
    if (threadId !== undefined && threadId > 1) {
      options.message_thread_id = threadId;
    }

    return await telegramBot.sendMessage(chatId, text, options);
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

/**
 * Send expanded agent menu with all options
 */
export async function sendTelegramAgentMenu(
  chatId: number,
  agent: {
    id: string;
    name: string;
    emoji: string;
    status: string;
    statusDetails?: string;
    workspace?: string;
    modelMode?: string;
    telegramChatId?: number;
  }
): Promise<void> {
  const statusEmoji: Record<string, string> = {
    idle: '⚪',
    processing: '🔵',
    error: '🔴',
    'ralph-loop': '🔄',
    'ralph-paused': '⏸️',
  };

  const status = statusEmoji[agent.status] || '⚪';
  const workspaceText = agent.workspace || 'Sem workspace';
  const modelModeText = agent.modelMode === 'selection' ? 'Seleção' :
    agent.modelMode === 'haiku' ? 'Haiku fixo' :
    agent.modelMode === 'sonnet' ? 'Sonnet fixo' :
    agent.modelMode === 'opus' ? 'Opus fixo' : 'Seleção';

  const text = `${agent.emoji} *${agent.name}*\n\n` +
    `📂 ${workspaceText}\n` +
    `🧠 ${modelModeText}\n` +
    `${status} ${agent.statusDetails || agent.status}`;

  const buttons: Array<{ text: string; callback_data: string }[]> = [
    [
      { text: '📜 Histórico', callback_data: `history_${agent.id}` },
      { text: '🔄 Reset sessão', callback_data: `reset_${agent.id}` },
    ],
    [
      { text: '⚙️ Configurações', callback_data: `config_${agent.id}` },
      { text: '🗑️ Deletar', callback_data: `delete_${agent.id}` },
    ],
  ];

  // Add "Go to group" button if linked
  if (agent.telegramChatId) {
    buttons.push([
      { text: '🔗 Ir para grupo', callback_data: `gotogroup_${agent.id}` },
    ]);
  }

  await sendTelegramButtons(chatId, text, buttons);
}

/**
 * Send agent configuration submenu
 */
export async function sendTelegramAgentConfigMenu(
  chatId: number,
  agent: { id: string; name: string; emoji: string }
): Promise<void> {
  const text = `⚙️ *Configurações de ${agent.emoji} ${agent.name}*`;

  const buttons: Array<{ text: string; callback_data: string }[]> = [
    [
      { text: '✏️ Editar emoji', callback_data: `editemoji_${agent.id}` },
      { text: '📝 Editar nome', callback_data: `editname_${agent.id}` },
    ],
    [
      { text: '⬅️ Voltar', callback_data: `agent_${agent.id}` },
    ],
  ];

  await sendTelegramButtons(chatId, text, buttons);
}

/**
 * Send agent history (last 5 outputs)
 */
export async function sendTelegramAgentHistory(
  chatId: number,
  agentName: string,
  outputs: Array<{
    id: string;
    summary: string;
    prompt: string;
    status: string;
    model: string;
    timestamp: Date;
  }>
): Promise<void> {
  if (outputs.length === 0) {
    await sendTelegramMessage(chatId, `📜 *Histórico de ${agentName}*\n\nNenhuma interação ainda.`);
    return;
  }

  const statusEmoji: Record<string, string> = {
    success: '✅',
    warning: '⚠️',
    error: '❌',
  };

  let text = `📜 *Histórico de ${agentName}*\n\n`;

  for (const output of outputs.slice(-5).reverse()) {
    const status = statusEmoji[output.status] || '•';
    const promptPreview = output.prompt.length > 40
      ? output.prompt.slice(0, 40) + '...'
      : output.prompt;
    text += `${status} *${output.summary}*\n`;
    text += `   _${promptPreview}_\n`;
    text += `   ${output.model.toUpperCase()}\n\n`;
  }

  await sendTelegramMessage(chatId, text);
}

/**
 * Send delete confirmation with group options
 */
export async function sendTelegramDeleteConfirmation(
  chatId: number,
  agent: { id: string; name: string; emoji: string; telegramChatId?: number }
): Promise<void> {
  const text = `⚠️ *Deletar ${agent.emoji} ${agent.name}?*\n\n` +
    (agent.telegramChatId
      ? 'O que fazer com o grupo Telegram?'
      : 'Esta ação não pode ser desfeita.');

  const buttons: Array<{ text: string; callback_data: string }[]> = [];

  if (agent.telegramChatId) {
    buttons.push([
      { text: '📁 Manter grupo', callback_data: `confirmdelete_keep_${agent.id}` },
    ]);
    buttons.push([
      { text: '🗑️ Deletar grupo', callback_data: `confirmdelete_leave_${agent.id}` },
    ]);
  } else {
    buttons.push([
      { text: '✅ Confirmar', callback_data: `confirmdelete_keep_${agent.id}` },
    ]);
  }

  buttons.push([
    { text: '❌ Cancelar', callback_data: 'canceldelete' },
  ]);

  await sendTelegramButtons(chatId, text, buttons);
}

/**
 * Send orphaned group warning message
 */
export async function sendTelegramOrphanedGroupWarning(
  chatId: number,
  groupChatId: number
): Promise<void> {
  const text = '⚠️ *Grupo inativo*\n\n' +
    'O agente vinculado a este grupo foi deletado.\n\n' +
    'O que deseja fazer?';

  const buttons: Array<{ text: string; callback_data: string }[]> = [
    [
      { text: '🔄 Recriar agente', callback_data: `orphan_recreate_${groupChatId}` },
      { text: '🗑️ Deletar grupo', callback_data: `orphan_leave_${groupChatId}` },
    ],
  ];

  await sendTelegramButtons(chatId, text, buttons);
}

/**
 * Send status overview for all agents
 */
export async function sendTelegramStatusOverview(
  chatId: number,
  agents: Array<{
    name: string;
    emoji: string;
    status: string;
    statusDetails?: string;
  }>
): Promise<void> {
  if (agents.length === 0) {
    await sendTelegramMessage(chatId, '*Status dos Agentes*\n\nNenhum agente criado ainda.');
    return;
  }

  const statusEmoji: Record<string, string> = {
    idle: '⚪',
    processing: '🔵',
    error: '🔴',
    'ralph-loop': '🔄',
    'ralph-paused': '⏸️',
  };

  let text = '*Status dos Agentes*\n\n';

  for (const agent of agents) {
    const status = statusEmoji[agent.status] || '⚪';
    text += `${agent.emoji} *${agent.name}* ${status}\n`;
    if (agent.statusDetails) {
      text += `   ${agent.statusDetails}\n`;
    }
  }

  await sendTelegramMessage(chatId, text);
}

/**
 * Send name edit prompt
 */
export async function sendTelegramEditNamePrompt(
  chatId: number,
  agentName: string
): Promise<void> {
  await sendTelegramMessage(chatId,
    `📝 *Editar nome*\n\n` +
    `Nome atual: *${agentName}*\n\n` +
    `Envie o novo nome do agente:\n` +
    `_(máximo 50 caracteres)_`
  );
}

// ============================================
// Telegram Group Management API
// ============================================

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

// ============================================
// Ralph Loop UI Components
// ============================================

/**
 * Send Ralph loop confirmation with task preview
 */
export async function sendTelegramRalphConfirmation(
  chatId: number,
  agentName: string,
  task: string,
  maxIterations: number = 10
): Promise<void> {
  const taskPreview = task.length > 200 ? task.slice(0, 200) + '...' : task;

  await sendTelegramButtons(chatId,
    `🔄 *Ralph Loop*\n\n` +
    `*Agente:* ${agentName}\n` +
    `*Iterações:* ${maxIterations}\n\n` +
    `*Tarefa:*\n${taskPreview}`,
    [
      [
        { text: '▶️ Iniciar', callback_data: 'ralph_start' },
        { text: '⚙️ Configurar', callback_data: 'ralph_config' },
      ],
      [
        { text: '❌ Cancelar', callback_data: 'ralph_cancel' },
      ],
    ]
  );
}

/**
 * Send Ralph loop max iterations configuration prompt
 */
export async function sendTelegramRalphIterationsConfig(chatId: number): Promise<void> {
  await sendTelegramButtons(chatId,
    '⚙️ *Configurar iterações*\n\n' +
    'Quantas iterações máximas?\n' +
    '_(1-100, padrão: 10)_',
    [
      [
        { text: '5', callback_data: 'ralph_iter_5' },
        { text: '10', callback_data: 'ralph_iter_10' },
        { text: '20', callback_data: 'ralph_iter_20' },
      ],
      [
        { text: '50', callback_data: 'ralph_iter_50' },
        { text: '100', callback_data: 'ralph_iter_100' },
        { text: '✏️ Custom', callback_data: 'ralph_iter_custom' },
      ],
    ]
  );
}

/**
 * Generate a progress bar string
 */
function generateProgressBar(current: number, max: number, length: number = 10): string {
  const filled = Math.round((current / max) * length);
  const empty = length - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

/**
 * Send Ralph loop progress update
 */
export async function sendTelegramRalphProgress(
  chatId: number,
  loopId: string,
  iteration: number,
  maxIterations: number,
  action: string,
  elapsedSeconds?: number,
  threadId?: number
): Promise<void> {
  const percentage = Math.round((iteration / maxIterations) * 100);
  const progressBar = generateProgressBar(iteration, maxIterations);
  const timeText = elapsedSeconds ? ` (${Math.floor(elapsedSeconds / 60)}m ${elapsedSeconds % 60}s)` : '';

  await sendTelegramButtons(chatId,
    `🔄 *Ralph Loop em execução*${timeText}\n\n` +
    `*Iteração ${iteration}/${maxIterations}*\n` +
    `${progressBar} ${percentage}%\n\n` +
    `*Ação:* ${action}`,
    [
      [
        { text: '⏸️ Pausar', callback_data: `ralph_pause_${loopId}` },
        { text: '❌ Cancelar', callback_data: `ralph_stop_${loopId}` },
      ],
    ],
    threadId
  );
}

/**
 * Send Ralph loop paused message with resume option
 */
export async function sendTelegramRalphPaused(
  chatId: number,
  loopId: string,
  iteration: number,
  maxIterations: number
): Promise<void> {
  await sendTelegramButtons(chatId,
    `⏸️ *Ralph Loop pausado*\n\n` +
    `Iteração ${iteration}/${maxIterations}\n\n` +
    `O que deseja fazer?`,
    [
      [
        { text: '▶️ Retomar', callback_data: `ralph_resume_${loopId}` },
        { text: '❌ Cancelar', callback_data: `ralph_stop_${loopId}` },
      ],
    ]
  );
}

/**
 * Send Ralph loop completion summary
 */
export async function sendTelegramRalphComplete(
  chatId: number,
  loopId: string,
  iterations: number,
  durationSeconds: number,
  status: 'completed' | 'cancelled' | 'blocked' | 'failed',
  errorMessage?: string,
  threadId?: number
): Promise<void> {
  const statusEmoji: Record<string, string> = {
    completed: '✅',
    cancelled: '🛑',
    blocked: '⚠️',
    failed: '❌',
  };

  const statusText: Record<string, string> = {
    completed: 'Concluído com sucesso',
    cancelled: 'Cancelado pelo usuário',
    blocked: 'Bloqueado (máximo de iterações)',
    failed: 'Falhou com erro',
  };

  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;
  const timeText = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

  let text = `${statusEmoji[status]} *Ralph Loop ${statusText[status]}*\n\n` +
    `*Iterações:* ${iterations}\n` +
    `*Tempo:* ${timeText}`;

  if (errorMessage) {
    text += `\n\n*Erro:* ${errorMessage}`;
  }

  await sendTelegramMessage(chatId, text, undefined, threadId);
}

// ============================================
// Media Handling UI Components
// ============================================

/**
 * Send image received confirmation with action options (when no caption)
 */
export async function sendTelegramImageOptions(
  chatId: number,
  imageFileId: string
): Promise<void> {
  await sendTelegramButtons(chatId,
    '📷 *Imagem recebida*\n\n' +
    'O que você quer saber sobre esta imagem?',
    [
      [
        { text: '🔍 Analisar', callback_data: `img_analyze_${imageFileId}` },
        { text: '📝 Descrever', callback_data: `img_describe_${imageFileId}` },
      ],
      [
        { text: '🐛 Encontrar bugs', callback_data: `img_bugs_${imageFileId}` },
      ],
    ]
  );
}

/**
 * Send document received confirmation with action options
 */
export async function sendTelegramDocumentOptions(
  chatId: number,
  documentFileId: string,
  filename: string
): Promise<void> {
  await sendTelegramButtons(chatId,
    `📄 *Arquivo recebido:* ${filename}\n\n` +
    'O que deseja fazer?',
    [
      [
        { text: '📖 Ler conteúdo', callback_data: `doc_read_${documentFileId}` },
        { text: '🔍 Analisar', callback_data: `doc_analyze_${documentFileId}` },
      ],
      [
        { text: '✏️ Editar', callback_data: `doc_edit_${documentFileId}` },
      ],
    ]
  );
}

/**
 * Send image processing confirmation
 */
export async function sendTelegramImageProcessing(chatId: number): Promise<void> {
  await sendTelegramMessage(chatId, '📷 Imagem recebida. Analisando...');
}

/**
 * Send document processing confirmation
 */
export async function sendTelegramDocumentProcessing(chatId: number, filename: string): Promise<void> {
  await sendTelegramMessage(chatId, `📄 Processando *${filename}*...`);
}

// ============================================
// Telegram File Download API
// ============================================

/**
 * Get file path from Telegram servers
 * Returns the file_path that can be used to download the file
 */
export async function getTelegramFilePath(fileId: string): Promise<string | null> {
  const telegramBot = getTelegramBot();
  if (!telegramBot) return null;

  try {
    const file = await telegramBot.getFile(fileId);
    return file.file_path || null;
  } catch (error) {
    console.error('Failed to get Telegram file path:', error);
    return null;
  }
}

/**
 * Download file from Telegram servers
 * Returns the file content as a Buffer
 */
export async function downloadTelegramFile(fileId: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const telegramBot = getTelegramBot();
  if (!telegramBot || !TELEGRAM_BOT_TOKEN) return null;

  try {
    const file = await telegramBot.getFile(fileId);
    if (!file.file_path) {
      console.error('No file_path in Telegram file response');
      return null;
    }

    // Construct download URL
    const downloadUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${file.file_path}`;

    // Download the file
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Infer MIME type from file path
    const mimeType = inferMimeType(file.file_path);

    console.log(`[telegram] Downloaded file: ${file.file_path} (${buffer.length} bytes, ${mimeType})`);

    return { buffer, mimeType };
  } catch (error) {
    console.error('Failed to download Telegram file:', error);
    return null;
  }
}

/**
 * Infer MIME type from file path/extension
 */
function inferMimeType(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const mimeTypes: Record<string, string> = {
    // Images
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'gif': 'image/gif',
    'webp': 'image/webp',
    // Documents
    'pdf': 'application/pdf',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls': 'application/vnd.ms-excel',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'txt': 'text/plain',
    'json': 'application/json',
    'csv': 'text/csv',
    // Code
    'js': 'text/javascript',
    'ts': 'text/typescript',
    'py': 'text/x-python',
    'html': 'text/html',
    'css': 'text/css',
    'md': 'text/markdown',
  };

  return mimeTypes[ext] || 'application/octet-stream';
}

/**
 * Edit an existing message (for updating progress)
 */
export async function editTelegramMessage(
  chatId: number | string,
  messageId: number,
  text: string,
  buttons?: Array<{ text: string; callback_data: string }[]>
): Promise<boolean> {
  const telegramBot = getTelegramBot();
  if (!telegramBot) return false;

  try {
    const options: TelegramBot.EditMessageTextOptions = {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
    };

    if (buttons) {
      options.reply_markup = {
        inline_keyboard: buttons,
      };
    }

    await telegramBot.editMessageText(text, options);
    return true;
  } catch (error) {
    console.error('Failed to edit Telegram message:', error);
    return false;
  }
}

// ============================================
// Typing Indicator
// ============================================

/**
 * Send a chat action (typing indicator) to a Telegram chat
 * The typing indicator lasts approximately 5 seconds
 * @param chatId - The chat ID
 * @param threadId - Optional message_thread_id for forum topics (threadId > 1 routes to specific topic)
 */
export async function sendTypingAction(chatId: number, threadId?: number): Promise<boolean> {
  const telegramBot = getTelegramBot();
  if (!telegramBot) return false;

  try {
    const options: { message_thread_id?: number } = {};
    if (threadId !== undefined && threadId > 1) {
      options.message_thread_id = threadId;
    }
    await telegramBot.sendChatAction(chatId, 'typing', options);
    return true;
  } catch (error) {
    console.error('Failed to send typing action:', error);
    return false;
  }
}

/**
 * Start a typing indicator that auto-renews every 4 seconds
 * Returns a stop function to clear the interval
 *
 * Usage:
 * ```typescript
 * const stopTyping = startTypingIndicator(chatId);
 * try {
 *   // Process prompt...
 * } finally {
 *   stopTyping();
 * }
 * ```
 * @param chatId - The chat ID
 * @param threadId - Optional message_thread_id for forum topics (threadId > 1 routes to specific topic)
 */
export function startTypingIndicator(chatId: number, threadId?: number): () => void {
  // Send initial typing action
  sendTypingAction(chatId, threadId);

  // Auto-renew every 4 seconds (indicator lasts ~5 seconds)
  const intervalId = setInterval(() => {
    sendTypingAction(chatId, threadId);
  }, 4000);

  // Return stop function
  return () => {
    clearInterval(intervalId);
  };
}

// ============================================
// Forum Topic Management API
// ============================================

/**
 * Topic colors for Telegram forums (icon_color parameter)
 * These are the only 6 colors available in Telegram's API
 */
export const TOPIC_COLORS = {
  BLUE: 0x6FB9F0,      // Light blue - used for Session topics
  YELLOW: 0xFFD67E,    // Yellow/orange - used for Ralph topics
  PURPLE: 0xCB86DB,    // Purple - used for Worktree topics
  GREEN: 0x8EEE98,     // Green
  PINK: 0xFF93B2,      // Pink
  RED: 0xFB6F5F,       // Red
} as const;

/**
 * Response from createForumTopic API call
 */
export interface ForumTopicCreated {
  message_thread_id: number;
  name: string;
  icon_color?: number;
  icon_custom_emoji_id?: string;
}

/**
 * Create a forum topic in a supergroup
 * Requires the bot to have can_manage_topics permission
 *
 * @param chatId - The supergroup chat ID
 * @param name - Topic name (1-128 characters)
 * @param iconColor - Optional color from TOPIC_COLORS
 * @param iconCustomEmojiId - Optional custom emoji ID for the topic icon
 * @returns The created topic info or null on failure
 */
export async function createForumTopic(
  chatId: number,
  name: string,
  iconColor?: number,
  iconCustomEmojiId?: string
): Promise<ForumTopicCreated | null> {
  const telegramBot = getTelegramBot();
  if (!telegramBot) return null;

  // Validate name length (Telegram API limit)
  if (name.length < 1 || name.length > 128) {
    console.error('Topic name must be between 1 and 128 characters');
    return null;
  }

  try {
    // node-telegram-bot-api doesn't have built-in createForumTopic, use raw API call
    const params: Record<string, unknown> = {
      chat_id: chatId,
      name,
    };

    if (iconColor !== undefined) {
      params.icon_color = iconColor;
    }

    if (iconCustomEmojiId) {
      params.icon_custom_emoji_id = iconCustomEmojiId;
    }

    // Use the underlying request method to call the API
    const result = await (telegramBot as unknown as {
      _request: (method: string, params: Record<string, unknown>) => Promise<ForumTopicCreated>
    })._request('createForumTopic', params);

    console.log(`[telegram] Created forum topic "${name}" in chat ${chatId}, thread_id: ${result.message_thread_id}`);
    return result;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Check for common errors
    if (errorMessage.includes('CHAT_NOT_FORUM')) {
      console.error(`[telegram] Chat ${chatId} is not a forum (topics not enabled)`);
    } else if (errorMessage.includes('CHAT_ADMIN_REQUIRED') || errorMessage.includes('not enough rights')) {
      console.error(`[telegram] Bot lacks manage_topics permission in chat ${chatId}`);
    } else {
      console.error('Failed to create forum topic:', error);
    }
    return null;
  }
}

/**
 * Close a forum topic
 * Requires the bot to have can_manage_topics permission
 *
 * @param chatId - The supergroup chat ID
 * @param messageThreadId - The topic's message_thread_id
 * @returns true on success, false on failure
 */
export async function closeForumTopic(
  chatId: number,
  messageThreadId: number
): Promise<boolean> {
  const telegramBot = getTelegramBot();
  if (!telegramBot) return false;

  try {
    await (telegramBot as unknown as {
      _request: (method: string, params: Record<string, unknown>) => Promise<boolean>
    })._request('closeForumTopic', {
      chat_id: chatId,
      message_thread_id: messageThreadId,
    });

    console.log(`[telegram] Closed topic ${messageThreadId} in chat ${chatId}`);
    return true;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes('TOPIC_NOT_MODIFIED')) {
      // Topic already closed - not an error
      console.log(`[telegram] Topic ${messageThreadId} was already closed`);
      return true;
    }

    if (errorMessage.includes('CHAT_ADMIN_REQUIRED') || errorMessage.includes('not enough rights')) {
      console.warn(`[telegram] Bot lacks manage_topics permission in chat ${chatId}`);
    } else {
      console.error('Failed to close forum topic:', error);
    }
    return false;
  }
}

/**
 * Reopen a closed forum topic
 * Requires the bot to have can_manage_topics permission
 *
 * @param chatId - The supergroup chat ID
 * @param messageThreadId - The topic's message_thread_id
 * @returns true on success, false on failure
 */
export async function reopenForumTopic(
  chatId: number,
  messageThreadId: number
): Promise<boolean> {
  const telegramBot = getTelegramBot();
  if (!telegramBot) return false;

  try {
    await (telegramBot as unknown as {
      _request: (method: string, params: Record<string, unknown>) => Promise<boolean>
    })._request('reopenForumTopic', {
      chat_id: chatId,
      message_thread_id: messageThreadId,
    });

    console.log(`[telegram] Reopened topic ${messageThreadId} in chat ${chatId}`);
    return true;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes('TOPIC_NOT_MODIFIED')) {
      // Topic already open - not an error
      console.log(`[telegram] Topic ${messageThreadId} was already open`);
      return true;
    }

    if (errorMessage.includes('CHAT_ADMIN_REQUIRED') || errorMessage.includes('not enough rights')) {
      console.warn(`[telegram] Bot lacks manage_topics permission in chat ${chatId}`);
    } else {
      console.error('Failed to reopen forum topic:', error);
    }
    return false;
  }
}

/**
 * Edit a forum topic name and/or icon
 * Requires the bot to have can_manage_topics permission
 *
 * @param chatId - The supergroup chat ID
 * @param messageThreadId - The topic's message_thread_id
 * @param name - New topic name (optional, 1-128 characters)
 * @param iconCustomEmojiId - New custom emoji ID (optional, empty string to remove)
 * @returns true on success, false on failure
 */
export async function editForumTopic(
  chatId: number,
  messageThreadId: number,
  name?: string,
  iconCustomEmojiId?: string
): Promise<boolean> {
  const telegramBot = getTelegramBot();
  if (!telegramBot) return false;

  // Validate name length if provided
  if (name !== undefined && (name.length < 1 || name.length > 128)) {
    console.error('Topic name must be between 1 and 128 characters');
    return false;
  }

  try {
    const params: Record<string, unknown> = {
      chat_id: chatId,
      message_thread_id: messageThreadId,
    };

    if (name !== undefined) {
      params.name = name;
    }

    if (iconCustomEmojiId !== undefined) {
      params.icon_custom_emoji_id = iconCustomEmojiId;
    }

    await (telegramBot as unknown as {
      _request: (method: string, params: Record<string, unknown>) => Promise<boolean>
    })._request('editForumTopic', params);

    console.log(`[telegram] Edited topic ${messageThreadId} in chat ${chatId}`);
    return true;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes('CHAT_ADMIN_REQUIRED') || errorMessage.includes('not enough rights')) {
      console.warn(`[telegram] Bot lacks manage_topics permission in chat ${chatId}`);
    } else {
      console.error('Failed to edit forum topic:', error);
    }
    return false;
  }
}

/**
 * Delete a forum topic and all its messages
 * Requires the bot to have can_delete_messages permission
 * WARNING: This permanently deletes all messages in the topic
 *
 * @param chatId - The supergroup chat ID
 * @param messageThreadId - The topic's message_thread_id
 * @returns true on success, false on failure
 */
export async function deleteForumTopic(
  chatId: number,
  messageThreadId: number
): Promise<boolean> {
  const telegramBot = getTelegramBot();
  if (!telegramBot) return false;

  try {
    await (telegramBot as unknown as {
      _request: (method: string, params: Record<string, unknown>) => Promise<boolean>
    })._request('deleteForumTopic', {
      chat_id: chatId,
      message_thread_id: messageThreadId,
    });

    console.log(`[telegram] Deleted topic ${messageThreadId} from chat ${chatId}`);
    return true;
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes('CHAT_ADMIN_REQUIRED') || errorMessage.includes('not enough rights')) {
      console.warn(`[telegram] Bot lacks delete permission in chat ${chatId}`);
    } else {
      console.error('Failed to delete forum topic:', error);
    }
    return false;
  }
}

/**
 * Extended chat information including forum status
 */
export interface ExtendedChat {
  id: number;
  type: string;
  title?: string;
  username?: string;
  is_forum?: boolean;
  permissions?: {
    can_send_messages?: boolean;
    can_manage_topics?: boolean;
  };
}

/**
 * Get extended chat information including forum status
 * Uses the existing getTelegramChat function
 *
 * @param chatId - The chat ID to get info for
 * @returns Extended chat info or null on failure
 */
export async function getExtendedChat(chatId: number): Promise<ExtendedChat | null> {
  const chat = await getTelegramChat(chatId);
  if (!chat) return null;

  return {
    id: chat.id,
    type: chat.type,
    title: chat.title,
    username: chat.username,
    is_forum: (chat as unknown as { is_forum?: boolean }).is_forum,
    permissions: (chat as unknown as { permissions?: ExtendedChat['permissions'] }).permissions,
  };
}

/**
 * Check if a chat is a forum (has topics enabled)
 *
 * @param chatId - The chat ID to check
 * @returns true if forum, false otherwise or on error
 */
export async function isChatForum(chatId: number): Promise<boolean> {
  const chat = await getExtendedChat(chatId);
  return chat?.is_forum === true;
}

// ============================================
// Queue Feedback UI
// ============================================

/**
 * Send queue position feedback with cancel button
 */
export async function sendTelegramQueuePosition(
  chatId: number,
  position: number,
  taskId: string
): Promise<TelegramBot.Message | null> {
  return sendTelegramButtons(chatId,
    `⏳ *Prompt adicionado à fila*\nPosição: ${position}`,
    [
      [
        { text: '❌ Cancelar', callback_data: `queue_cancel_${taskId}` },
      ],
    ]
  );
}

/**
 * Send task cancelled confirmation
 */
export async function sendTelegramTaskCancelled(chatId: number): Promise<void> {
  await sendTelegramMessage(chatId, '✅ Tarefa cancelada.');
}

// ============================================
// Standardized Error Messages
// ============================================

/**
 * Error message constants for consistent UX
 */
export const TELEGRAM_ERRORS = {
  UNLINKED_GROUP: '⚠️ Este grupo não está vinculado a nenhum agente.\n\nUse o chat privado do bot para criar um agente e vincular a este grupo.',
  AGENT_LIMIT_REACHED: '⚠️ Limite de agentes atingido (50).\nDelete um agente para criar outro.',
  TOKEN_EXPIRED: '⚠️ Token de vinculação expirado.\nUm novo link foi gerado abaixo.',
  WORKSPACE_NOT_FOUND: (path: string) => `⚠️ Workspace não encontrado: \`${path}\`\n\nEscolha uma alternativa:`,
  GROUP_LINKING_FAILED: '⚠️ Falha ao vincular grupo.\nTente adicionar o bot ao grupo novamente.',
  API_TIMEOUT: '⚠️ Tempo limite excedido.\nTente novamente em alguns segundos.',
  PROCESSING_ERROR: (agentName: string, error: string) => `❌ Erro no agente *${agentName}*:\n${error}`,
  // Topic routing errors
  TOPIC_NOT_FOUND: (topicId: number) => `⚠️ *Tópico não encontrado*\n\nO tópico #${topicId} não existe ou foi deletado.\n\nUse o tópico General ou crie um novo tópico com /topic.`,
  TOPIC_CLOSED: (topicName: string) => `⚠️ *Tópico fechado*\n\nO tópico "${topicName}" está fechado.\n\nReabra com /reopen ou use outro tópico.`,
  TOPIC_RALPH_ACTIVE: (topicName: string) => `⏳ *Ralph em execução*\n\nO tópico "${topicName}" está executando um loop Ralph.\n\nSua mensagem foi adicionada à fila e será processada após a conclusão.`,
} as const;

/**
 * Send unlinked group error message
 */
export async function sendTelegramUnlinkedGroupError(chatId: number): Promise<void> {
  await sendTelegramMessage(chatId, TELEGRAM_ERRORS.UNLINKED_GROUP);
}

/**
 * Send agent limit reached error
 */
export async function sendTelegramAgentLimitError(chatId: number): Promise<void> {
  await sendTelegramMessage(chatId, TELEGRAM_ERRORS.AGENT_LIMIT_REACHED);
}

/**
 * Send workspace not found error with suggestions
 */
export async function sendTelegramWorkspaceNotFound(
  chatId: number,
  requestedPath: string,
  suggestions: string[]
): Promise<void> {
  const buttons: Array<{ text: string; callback_data: string }[]> = [];

  for (const suggestion of suggestions.slice(0, 3)) {
    buttons.push([
      { text: `📁 ${suggestion}`, callback_data: `workspace_${suggestion}` },
    ]);
  }

  buttons.push([
    { text: '🧪 Usar Sandbox', callback_data: 'workspace_sandbox' },
  ]);

  await sendTelegramButtons(chatId, TELEGRAM_ERRORS.WORKSPACE_NOT_FOUND(requestedPath), buttons);
}

/**
 * Send processing error with retry option
 */
export async function sendTelegramProcessingError(
  chatId: number,
  agentName: string,
  error: string,
  taskId?: string
): Promise<void> {
  const truncatedError = error.length > 100 ? error.slice(0, 100) + '...' : error;
  const text = TELEGRAM_ERRORS.PROCESSING_ERROR(agentName, truncatedError);

  if (taskId) {
    await sendTelegramButtons(chatId, text, [
      [
        { text: '🔄 Tentar novamente', callback_data: `retry_${taskId}` },
        { text: '❌ Ignorar', callback_data: 'error_dismiss' },
      ],
    ]);
  } else {
    await sendTelegramMessage(chatId, text);
  }
}

/**
 * Delete a message (useful for removing queue position messages after processing)
 */
export async function deleteTelegramMessage(
  chatId: number | string,
  messageId: number
): Promise<boolean> {
  const telegramBot = getTelegramBot();
  if (!telegramBot) return false;

  try {
    await telegramBot.deleteMessage(chatId, messageId);
    return true;
  } catch (error) {
    console.error('Failed to delete Telegram message:', error);
    return false;
  }
}

// ============================================
// Message Pin Management
// ============================================

/**
 * Pin a message in a Telegram chat
 * Note: Bot must be an admin with pin_messages permission in groups
 * Returns false on permission errors without throwing
 */
export async function pinTelegramMessage(
  chatId: number | string,
  messageId: number,
  disableNotification: boolean = true
): Promise<boolean> {
  const telegramBot = getTelegramBot();
  if (!telegramBot) return false;

  try {
    await telegramBot.pinChatMessage(chatId, messageId, {
      disable_notification: disableNotification,
    });
    return true;
  } catch (error: unknown) {
    // Graceful degradation for permission errors
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('not enough rights') ||
        errorMessage.includes('CHAT_ADMIN_REQUIRED') ||
        errorMessage.includes('can\'t pin')) {
      console.warn(`[telegram] Cannot pin message in chat ${chatId}: insufficient permissions`);
    } else {
      console.error('Failed to pin Telegram message:', error);
    }
    return false;
  }
}

/**
 * Unpin a message in a Telegram chat
 * Note: Bot must be an admin with pin_messages permission in groups
 * Returns false on permission errors without throwing
 */
export async function unpinTelegramMessage(
  chatId: number | string,
  messageId: number
): Promise<boolean> {
  const telegramBot = getTelegramBot();
  if (!telegramBot) return false;

  try {
    await telegramBot.unpinChatMessage(chatId, { message_id: messageId });
    return true;
  } catch (error: unknown) {
    // Graceful degradation for permission errors
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('not enough rights') ||
        errorMessage.includes('CHAT_ADMIN_REQUIRED') ||
        errorMessage.includes('can\'t unpin')) {
      console.warn(`[telegram] Cannot unpin message in chat ${chatId}: insufficient permissions`);
    } else {
      console.error('Failed to unpin Telegram message:', error);
    }
    return false;
  }
}

// ============================================
// Group Onboarding UI Components
// ============================================

/**
 * Send agent name prompt for group onboarding flow
 */
export async function sendGroupAgentNamePrompt(chatId: number): Promise<void> {
  await sendTelegramMessage(chatId,
    '*Qual o nome do agente?*\n\n' +
    'Envie o nome do agente (máximo 50 caracteres).\n' +
    'Exemplo: Backend API, Data Analysis'
  );
}

/**
 * Send emoji selector for group onboarding flow
 * Uses grp_emoji_ prefix to distinguish from personal flow
 */
export async function sendGroupEmojiSelector(chatId: number): Promise<void> {
  await sendTelegramButtons(chatId,
    '*Escolha um emoji*',
    [
      [
        { text: '🤖', callback_data: 'grp_emoji_🤖' },
        { text: '⚡', callback_data: 'grp_emoji_⚡' },
        { text: '🔧', callback_data: 'grp_emoji_🔧' },
        { text: '🎯', callback_data: 'grp_emoji_🎯' },
      ],
      [
        { text: '🧠', callback_data: 'grp_emoji_🧠' },
        { text: '✨', callback_data: 'grp_emoji_✨' },
        { text: '📊', callback_data: 'grp_emoji_📊' },
        { text: '💡', callback_data: 'grp_emoji_💡' },
      ],
      [
        { text: '🚀', callback_data: 'grp_emoji_🚀' },
        { text: '🔍', callback_data: 'grp_emoji_🔍' },
        { text: '💻', callback_data: 'grp_emoji_💻' },
        { text: '📁', callback_data: 'grp_emoji_📁' },
      ],
    ]
  );
}

/**
 * Send workspace selector for group onboarding flow
 * Uses grp_workspace_ prefix to distinguish from personal flow
 */
export async function sendGroupWorkspaceSelector(chatId: number): Promise<void> {
  const home = process.env.HOME || '/home/user';
  await sendTelegramButtons(chatId,
    '*Workspace do agente*\n\n' +
    'Onde o agente vai trabalhar?',
    [
      [
        { text: '🧪 Sandbox', callback_data: 'grp_workspace_sandbox' },
        { text: '🏠 Home', callback_data: `grp_workspace_${home}` },
      ],
      [
        { text: '📂 Desktop', callback_data: `grp_workspace_${home}/Desktop` },
        { text: '✏️ Caminho personalizado', callback_data: 'grp_workspace_custom' },
      ],
    ]
  );
}

/**
 * Send model mode selector for group onboarding flow
 * Uses grp_modelmode_ prefix to distinguish from personal flow
 * Layout: [Opus] on row 1, [Haiku][Sonnet][Selecao] on row 2
 */
export async function sendGroupModelModeSelector(chatId: number): Promise<void> {
  await sendTelegramButtons(chatId,
    '*Modelo padrão*\n\n' +
    '*Seleção*: Pergunta qual modelo usar\n' +
    '*Fixo*: Sempre usa o mesmo modelo',
    [
      [
        { text: 'Opus', callback_data: 'grp_modelmode_opus' },
      ],
      [
        { text: 'Haiku', callback_data: 'grp_modelmode_haiku' },
        { text: 'Sonnet', callback_data: 'grp_modelmode_sonnet' },
        { text: 'Seleção', callback_data: 'grp_modelmode_selection' },
      ],
    ]
  );
}

/**
 * Send custom workspace prompt for group onboarding flow
 */
export async function sendGroupCustomWorkspacePrompt(chatId: number): Promise<void> {
  await sendTelegramMessage(chatId,
    '*Caminho personalizado*\n\n' +
    'Envie o caminho completo do diretório:\n' +
    'Exemplo: `/Users/lucas/projects/myapp`'
  );
}

/**
 * Validate agent name for group onboarding
 * Returns error message if invalid, null if valid
 */
export function validateGroupAgentName(name: string): string | null {
  if (!name || typeof name !== 'string') {
    return 'Nome é obrigatório';
  }

  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return 'Nome não pode ser vazio';
  }

  if (trimmed.length > 50) {
    return 'Nome excede o limite de 50 caracteres';
  }

  // Check for dangerous characters
  const dangerousPattern = /[<>{}|\\^`]/;
  if (dangerousPattern.test(trimmed)) {
    return 'Nome contém caracteres inválidos';
  }

  return null;
}

// ============================================
// Topic Management UI
// ============================================

/**
 * Topic error messages
 */
export const TOPIC_ERRORS = {
  TOPICS_NOT_ENABLED: '⚠️ *Tópicos não habilitados*\n\nEste grupo não tem tópicos habilitados. Para usar /ralph, /worktree e /sessao, habilite tópicos nas configurações do grupo Telegram.',
  NO_LINKED_AGENT: '⚠️ *Agente não vinculado*\n\nEste grupo não está vinculado a nenhum agente. Use /criar no chat privado para criar um agente.',
  TOPIC_NAME_TOO_LONG: 'Nome do tópico excede o limite de 100 caracteres.',
  TOPIC_NAME_INVALID: 'Nome do tópico contém caracteres inválidos.',
} as const;

/**
 * Send prompt to enter task for Ralph topic
 */
export async function sendTopicRalphTaskPrompt(chatId: number): Promise<void> {
  await sendTelegramMessage(chatId,
    '🔄 *Novo tópico Ralph*\n\n' +
    'Qual tarefa o Ralph deve executar?\n\n' +
    '_Descreva a tarefa em detalhes._'
  );
}

/**
 * Send iteration selection for Ralph topic
 */
export async function sendTopicRalphIterationsPrompt(chatId: number, task: string): Promise<void> {
  const truncatedTask = task.length > 100 ? task.slice(0, 97) + '...' : task;
  await sendTelegramButtons(chatId,
    `🔄 *Novo tópico Ralph*\n\n` +
    `*Tarefa:* ${truncatedTask}\n\n` +
    `Quantas iterações máximas?`,
    [
      [
        { text: '5', callback_data: 'topic_ralph_iter_5' },
        { text: '10', callback_data: 'topic_ralph_iter_10' },
      ],
      [
        { text: '20', callback_data: 'topic_ralph_iter_20' },
        { text: '50', callback_data: 'topic_ralph_iter_50' },
      ],
      [
        { text: '✏️ Personalizado', callback_data: 'topic_ralph_iter_custom' },
      ],
    ]
  );
}

/**
 * Send custom iterations prompt for Ralph topic
 */
export async function sendTopicRalphCustomIterationsPrompt(chatId: number): Promise<void> {
  await sendTelegramMessage(chatId,
    '*Iterações personalizadas*\n\n' +
    'Digite o número de iterações (1-100):'
  );
}

/**
 * Send prompt to enter topic name for worktree/sessao
 */
export async function sendTopicNamePrompt(chatId: number, type: 'worktree' | 'sessao'): Promise<void> {
  const emoji = type === 'worktree' ? '🌿' : '💬';
  const typeName = type === 'worktree' ? 'Worktree' : 'Sessão';

  await sendTelegramMessage(chatId,
    `${emoji} *Novo tópico ${typeName}*\n\n` +
    'Digite um nome para o tópico:\n\n' +
    '_Máximo 100 caracteres._'
  );
}

/**
 * Send topic created confirmation (General topic)
 */
export async function sendTopicCreatedInGeneral(
  chatId: number,
  topicName: string,
  topicType: 'ralph' | 'worktree' | 'session',
  threadId: number
): Promise<void> {
  const emoji = topicType === 'ralph' ? '🔄' : topicType === 'worktree' ? '🌿' : '💬';
  const typeName = topicType === 'ralph' ? 'Ralph' : topicType === 'worktree' ? 'Worktree' : 'Sessão';

  await sendTelegramMessage(chatId,
    `✅ *Tópico ${typeName} criado*\n\n` +
    `${emoji} *${topicName}*\n\n` +
    `_Acesse o tópico para interagir._`
  );
}

/**
 * Send welcome message in newly created topic
 */
export async function sendTopicWelcome(
  chatId: number,
  threadId: number,
  topicName: string,
  topicType: 'ralph' | 'worktree' | 'session',
  task?: string
): Promise<void> {
  const emoji = topicType === 'ralph' ? '🔄' : topicType === 'worktree' ? '🌿' : '💬';

  if (topicType === 'ralph' && task) {
    const truncatedTask = task.length > 200 ? task.slice(0, 197) + '...' : task;
    await sendTelegramMessage(chatId,
      `${emoji} *${topicName}*\n\n` +
      `*Tarefa:* ${truncatedTask}\n\n` +
      `_Loop Ralph iniciando..._`,
      undefined,
      threadId
    );
  } else {
    const description = topicType === 'worktree'
      ? 'Tópico isolado para experimentos e features.'
      : 'Tópico com sessão de conversa isolada.';

    await sendTelegramMessage(chatId,
      `${emoji} *${topicName}*\n\n` +
      `${description}\n\n` +
      `_Envie uma mensagem para começar._`,
      undefined,
      threadId
    );
  }
}

/**
 * Format topic for display in /topicos list
 */
export function formatTopicListItem(topic: {
  emoji: string;
  name: string;
  type: 'general' | 'ralph' | 'worktree' | 'session';
  status: 'active' | 'closed';
  loopId?: string;
  lastActivity: Date;
  currentIteration?: number;
  maxIterations?: number;
}): string {
  const statusIcon = topic.status === 'active' ? '🟢' : '🔴';
  const typeLabel = topic.type === 'ralph' ? 'Ralph'
    : topic.type === 'worktree' ? 'Worktree'
    : topic.type === 'session' ? 'Sessão'
    : 'General';

  let line = `${statusIcon} ${topic.emoji} *${topic.name}*\n`;
  line += `   Tipo: ${typeLabel}`;

  // Add progress for Ralph topics
  if (topic.type === 'ralph' && topic.loopId && topic.currentIteration !== undefined && topic.maxIterations !== undefined) {
    line += ` | Progresso: ${topic.currentIteration}/${topic.maxIterations}`;
  }

  // Add last activity (relative time)
  const now = new Date();
  const diff = now.getTime() - topic.lastActivity.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  let timeAgo: string;
  if (days > 0) {
    timeAgo = `${days}d atrás`;
  } else if (hours > 0) {
    timeAgo = `${hours}h atrás`;
  } else if (minutes > 0) {
    timeAgo = `${minutes}m atrás`;
  } else {
    timeAgo = 'agora';
  }

  line += `\n   Última atividade: ${timeAgo}`;

  return line;
}

/**
 * Send topics list with action buttons
 */
export async function sendTopicsList(
  chatId: number,
  topics: Array<{
    id: string;
    emoji: string;
    name: string;
    type: 'general' | 'ralph' | 'worktree' | 'session';
    status: 'active' | 'closed';
    loopId?: string;
    lastActivity: Date;
    currentIteration?: number;
    maxIterations?: number;
  }>
): Promise<void> {
  if (topics.length === 0) {
    await sendTelegramMessage(chatId,
      '📋 *Nenhum tópico encontrado*\n\n' +
      'Use /ralph, /worktree ou /sessao para criar tópicos.'
    );
    return;
  }

  // Format topic list
  const topicLines = topics.map(formatTopicListItem);
  const text = `📋 *Tópicos do agente*\n\n${topicLines.join('\n\n')}`;

  // Build action buttons for each non-general topic (max 3 rows due to Telegram limits)
  const actionableTopics = topics.filter(t => t.type !== 'general').slice(0, 3);
  const buttons: TelegramBot.InlineKeyboardButton[][] = actionableTopics.map(topic => {
    const actionBtn = topic.status === 'active'
      ? { text: `🔴 Fechar ${topic.name}`, callback_data: `topic_close_${topic.id}` }
      : { text: `🟢 Reabrir ${topic.name}`, callback_data: `topic_reopen_${topic.id}` };

    return [
      actionBtn,
      { text: `🗑️ Deletar`, callback_data: `topic_delete_${topic.id}` },
    ];
  });

  if (buttons.length > 0) {
    await sendTelegramButtons(chatId, text, buttons);
  } else {
    await sendTelegramMessage(chatId, text);
  }
}

/**
 * Send topics not enabled error
 */
export async function sendTopicsNotEnabledError(chatId: number): Promise<void> {
  await sendTelegramMessage(chatId, TOPIC_ERRORS.TOPICS_NOT_ENABLED);
}

/**
 * Send no linked agent error for topic commands
 */
export async function sendTopicNoAgentError(chatId: number): Promise<void> {
  await sendTelegramMessage(chatId, TOPIC_ERRORS.NO_LINKED_AGENT);
}

// ============================================
// Ralph Topic Integration UI
// ============================================

/**
 * Send message queued feedback for active Ralph topic
 */
export async function sendRalphMessageQueued(
  chatId: number,
  threadId: number,
  queuePosition: number
): Promise<TelegramBot.Message | null> {
  const positionText = queuePosition === 1 ? '' : ` (posição ${queuePosition} na fila)`;
  return sendTelegramMessage(
    chatId,
    `📥 *Mensagem enfileirada*${positionText}\n\n_Será processada quando o loop pausar ou terminar._`,
    undefined,
    threadId
  );
}

/**
 * Send Ralph loop completion summary with topic action buttons
 */
export async function sendRalphTopicComplete(
  chatId: number,
  threadId: number,
  loopId: string,
  topicId: string,
  iterations: number,
  durationSeconds: number,
  status: 'completed' | 'cancelled' | 'blocked' | 'failed',
  hasQueuedMessages: boolean = false
): Promise<void> {
  const statusEmoji: Record<string, string> = {
    completed: '✅',
    cancelled: '🛑',
    blocked: '⚠️',
    failed: '❌',
  };

  const statusText: Record<string, string> = {
    completed: 'Concluído com sucesso',
    cancelled: 'Cancelado',
    blocked: 'Bloqueado (máximo de iterações)',
    failed: 'Falhou',
  };

  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;
  const timeText = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;

  let text = `${statusEmoji[status]} *Ralph Loop ${statusText[status]}*\n\n` +
    `*Iterações:* ${iterations}\n` +
    `*Tempo:* ${timeText}`;

  if (hasQueuedMessages) {
    text += `\n\n_Processando mensagens enfileiradas..._`;
  }

  // Show topic action buttons
  await sendTelegramButtons(
    chatId,
    text,
    [
      [
        { text: '📁 Manter aberto', callback_data: `ralph_topic_keep_${topicId}` },
        { text: '🗑️ Fechar tópico', callback_data: `ralph_topic_close_${topicId}` },
      ],
    ],
    threadId
  );
}

/**
 * Send Ralph loop paused message with control buttons (for topic)
 */
export async function sendRalphTopicPaused(
  chatId: number,
  threadId: number,
  loopId: string,
  iteration: number,
  maxIterations: number,
  queueSize: number = 0
): Promise<void> {
  let text = `⏸️ *Ralph Loop pausado*\n\n` +
    `Iteração ${iteration}/${maxIterations}`;

  if (queueSize > 0) {
    text += `\n\n📥 ${queueSize} mensagem(s) na fila`;
  }

  await sendTelegramButtons(
    chatId,
    text,
    [
      [
        { text: '▶️ Retomar', callback_data: `ralph_resume_${loopId}` },
        { text: '❌ Cancelar', callback_data: `ralph_stop_${loopId}` },
      ],
    ],
    threadId
  );
}

/**
 * Send Ralph control command response
 */
export async function sendRalphControlResponse(
  chatId: number,
  threadId: number,
  action: 'paused' | 'resumed' | 'cancelled',
  loopId?: string
): Promise<void> {
  const messages: Record<string, string> = {
    paused: '⏸️ Loop pausado.',
    resumed: '▶️ Loop retomado.',
    cancelled: '🛑 Loop cancelado.',
  };

  await sendTelegramMessage(chatId, messages[action], undefined, threadId);
}

/**
 * Send error for Ralph control command
 */
export async function sendRalphControlError(
  chatId: number,
  threadId: number,
  error: string
): Promise<void> {
  await sendTelegramMessage(chatId, `⚠️ ${error}`, undefined, threadId);
}

// ============================================
// Enhanced Topic Management UI
// ============================================

/**
 * Topic status with display info
 */
export type TopicDisplayStatus = 'running' | 'paused' | 'completed' | 'inactive' | 'closed';

/**
 * Get status emoji and label for a topic
 */
export function getTopicStatusDisplay(
  topicType: 'general' | 'ralph' | 'worktree' | 'session',
  topicStatus: 'active' | 'closed',
  ralphStatus?: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'blocked'
): { emoji: string; label: string; displayStatus: TopicDisplayStatus } {
  if (topicStatus === 'closed') {
    return { emoji: '🔒', label: 'Fechado', displayStatus: 'closed' };
  }

  if (topicType === 'ralph') {
    switch (ralphStatus) {
      case 'running':
        return { emoji: '▶️', label: 'Executando', displayStatus: 'running' };
      case 'paused':
        return { emoji: '⏸️', label: 'Pausado', displayStatus: 'paused' };
      case 'completed':
        return { emoji: '✅', label: 'Completo', displayStatus: 'completed' };
      case 'failed':
      case 'cancelled':
      case 'interrupted':
      case 'blocked':
        return { emoji: '✅', label: 'Completo', displayStatus: 'completed' };
      default:
        return { emoji: '💤', label: 'Inativo', displayStatus: 'inactive' };
    }
  }

  // Worktree, Session, General - always active if not closed
  return { emoji: '💬', label: 'Ativo', displayStatus: 'inactive' };
}

/**
 * Format relative time in Portuguese
 */
export function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) {
    return `há ${diffDays}d`;
  }
  if (diffHours > 0) {
    return `há ${diffHours}h`;
  }
  if (diffMinutes > 0) {
    return `há ${diffMinutes}m`;
  }
  return 'agora';
}

/**
 * Topic data for display in /topicos listing
 */
export interface TopicListItem {
  id: string;
  telegramTopicId: number;
  emoji: string;
  name: string;
  type: 'general' | 'ralph' | 'worktree' | 'session';
  status: 'active' | 'closed';
  loopId?: string;
  lastActivity: Date;
  // Ralph-specific
  currentIteration?: number;
  maxIterations?: number;
  ralphStatus?: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'blocked';
  // Session-specific
  messageCount?: number;
}

/**
 * Format a single topic line for compact listing
 */
export function formatTopicCompactLine(topic: TopicListItem): string {
  const { emoji: statusEmoji, label: statusLabel } = getTopicStatusDisplay(
    topic.type,
    topic.status,
    topic.ralphStatus
  );

  const timeAgo = formatRelativeTime(topic.lastActivity);

  // Build progress indicator
  let progress = '';
  if (topic.type === 'ralph' && topic.currentIteration !== undefined && topic.maxIterations !== undefined) {
    progress = ` │ ${topic.currentIteration}/${topic.maxIterations}`;
  } else if (topic.messageCount !== undefined) {
    progress = ` │ ${topic.messageCount} msgs`;
  }

  // Format: ▶️ Executando │ 🔄 Auth JWT │ 5/10 │ há 2h
  return `${statusEmoji} ${statusLabel} │ ${topic.emoji} ${topic.name}${progress} │ ${timeAgo}`;
}

/**
 * Send enhanced topic listing with compact view
 * Shows all topics with status, progress, and relative time
 * Clicking a topic expands to show full details and actions
 */
export async function sendEnhancedTopicsList(
  chatId: number,
  topics: TopicListItem[],
  agentName: string
): Promise<void> {
  if (topics.length === 0) {
    await sendTelegramButtons(chatId,
      `📋 *Tópicos de ${agentName}*\n\n` +
      `Nenhum tópico encontrado.\n` +
      `Crie um novo tópico para organizar conversas.`,
      [
        [
          { text: '+ Ralph', callback_data: 'topic_create_ralph' },
          { text: '+ Worktree', callback_data: 'topic_create_worktree' },
          { text: '+ Sessão', callback_data: 'topic_create_session' },
        ],
      ]
    );
    return;
  }

  // Sort: active first, then by lastActivity descending
  const sortedTopics = [...topics].sort((a, b) => {
    if (a.status !== b.status) {
      return a.status === 'active' ? -1 : 1;
    }
    return b.lastActivity.getTime() - a.lastActivity.getTime();
  });

  // Build compact listing
  const lines = sortedTopics.map(formatTopicCompactLine);
  const text = `📋 *Tópicos de ${agentName}*\n\n` +
    `\`\`\`\n${lines.join('\n')}\n\`\`\`\n\n` +
    `_Toque em um tópico para ver detalhes._`;

  // Build topic selection buttons (max 8 to fit Telegram limits)
  const topicButtons: Array<{ text: string; callback_data: string }[]> = [];
  const displayTopics = sortedTopics.slice(0, 8);

  for (let i = 0; i < displayTopics.length; i += 2) {
    const row: { text: string; callback_data: string }[] = [];
    row.push({
      text: `${displayTopics[i].emoji} ${displayTopics[i].name.slice(0, 15)}`,
      callback_data: `topic_detail_${displayTopics[i].id}`,
    });
    if (i + 1 < displayTopics.length) {
      row.push({
        text: `${displayTopics[i + 1].emoji} ${displayTopics[i + 1].name.slice(0, 15)}`,
        callback_data: `topic_detail_${displayTopics[i + 1].id}`,
      });
    }
    topicButtons.push(row);
  }

  // Add creation footer
  topicButtons.push([
    { text: '+ Ralph', callback_data: 'topic_create_ralph' },
    { text: '+ Worktree', callback_data: 'topic_create_worktree' },
    { text: '+ Sessão', callback_data: 'topic_create_session' },
  ]);

  await sendTelegramButtons(chatId, text, topicButtons);
}

/**
 * Send expanded topic detail view with context-aware buttons
 */
export async function sendTopicDetailView(
  chatId: number,
  topic: TopicListItem,
  agentChatId: number
): Promise<void> {
  const { emoji: statusEmoji, label: statusLabel, displayStatus } = getTopicStatusDisplay(
    topic.type,
    topic.status,
    topic.ralphStatus
  );

  const timeAgo = formatRelativeTime(topic.lastActivity);
  const typeName = topic.type === 'ralph' ? 'Ralph Loop'
    : topic.type === 'worktree' ? 'Worktree'
    : topic.type === 'session' ? 'Sessão'
    : 'General';

  // Build detail text
  let text = `${topic.emoji} *${topic.name}*\n\n` +
    `*Tipo:* ${typeName}\n` +
    `*Status:* ${statusEmoji} ${statusLabel}\n` +
    `*Última atividade:* ${timeAgo}`;

  // Add progress for Ralph topics
  if (topic.type === 'ralph' && topic.currentIteration !== undefined && topic.maxIterations !== undefined) {
    const percentage = Math.round((topic.currentIteration / topic.maxIterations) * 100);
    text += `\n*Progresso:* ${topic.currentIteration}/${topic.maxIterations} (${percentage}%)`;
  }

  // Add message count if available
  if (topic.messageCount !== undefined) {
    text += `\n*Mensagens:* ${topic.messageCount}`;
  }

  // Build context-aware buttons
  const buttons: Array<{ text: string; callback_data: string }[]> = [];

  if (topic.type === 'general') {
    // General topic: only reset session
    buttons.push([
      { text: '🔄 Reset sessão', callback_data: `topic_confirm_reset_${topic.id}` },
    ]);
  } else if (topic.status === 'closed') {
    // Closed topic: reopen option
    buttons.push([
      { text: '🔓 Reabrir', callback_data: `topic_reopen_${topic.id}` },
      { text: '🗑️ Deletar', callback_data: `topic_confirm_delete_${topic.id}` },
    ]);
  } else if (topic.type === 'ralph') {
    // Ralph topic: depends on ralph status
    if (displayStatus === 'running') {
      buttons.push([
        { text: '⏸️ Pausar', callback_data: `ralph_pause_${topic.loopId}` },
        { text: '❌ Cancelar', callback_data: `ralph_stop_${topic.loopId}` },
      ]);
    } else if (displayStatus === 'paused') {
      buttons.push([
        { text: '▶️ Retomar', callback_data: `ralph_resume_${topic.loopId}` },
        { text: '❌ Cancelar', callback_data: `ralph_stop_${topic.loopId}` },
      ]);
    } else {
      // Completed or inactive Ralph
      buttons.push([
        { text: '💬 Ir para', callback_data: `topic_goto_${topic.id}` },
        { text: '🗑️ Fechar', callback_data: `topic_confirm_close_${topic.id}` },
      ]);
    }
  } else {
    // Worktree or Session: navigate and close options
    buttons.push([
      { text: '💬 Ir para', callback_data: `topic_goto_${topic.id}` },
      { text: '🗑️ Fechar', callback_data: `topic_confirm_close_${topic.id}` },
    ]);
  }

  // Add back button
  buttons.push([
    { text: '⬅️ Voltar', callback_data: 'topic_list_back' },
  ]);

  await sendTelegramButtons(chatId, text, buttons);
}

/**
 * Generate Telegram deep link for a topic
 * Format: https://t.me/c/{chatId}/{threadId}
 * Note: chatId must be without the -100 prefix for supergroups
 */
export function generateTopicDeepLink(chatId: number, threadId: number): string {
  // Remove -100 prefix from supergroup chat IDs
  const cleanChatId = chatId < 0 ? Math.abs(chatId) - 1000000000000 : chatId;
  return `https://t.me/c/${cleanChatId}/${threadId}`;
}

/**
 * Send "Ir para" navigation response with deep link
 */
export async function sendTopicNavigationLink(
  chatId: number,
  topicName: string,
  topicEmoji: string,
  topicChatId: number,
  threadId: number
): Promise<void> {
  const deepLink = generateTopicDeepLink(topicChatId, threadId);

  await sendTelegramButtons(chatId,
    `${topicEmoji} *${topicName}*\n\n` +
    `Clique no link abaixo para ir ao tópico:\n` +
    `[Abrir tópico](${deepLink})`,
    [
      [
        { text: '🔗 Abrir tópico', url: deepLink },
      ],
      [
        { text: '⬅️ Voltar', callback_data: 'topic_list_back' },
      ],
    ]
  );
}

/**
 * Send fallback notification when deep link doesn't work
 */
export async function sendTopicNavigationFallback(
  chatId: number,
  threadId: number,
  topicName: string
): Promise<void> {
  await sendTelegramMessage(
    chatId,
    `📍 *Navegação para tópico*\n\n` +
    `Vá até o grupo e procure pelo tópico:\n` +
    `*${topicName}*\n\n` +
    `_Se você está no grupo, procure pelo tópico na lista de tópicos._`,
    undefined,
    threadId
  );
}

// ============================================
// Confirmation Modals
// ============================================

/**
 * Send confirmation modal for closing a topic
 */
export async function sendTopicCloseConfirmation(
  chatId: number,
  topic: TopicListItem
): Promise<void> {
  const typeName = topic.type === 'ralph' ? 'Ralph Loop'
    : topic.type === 'worktree' ? 'Worktree'
    : 'Sessão';

  await sendTelegramButtons(chatId,
    `⚠️ *Fechar tópico?*\n\n` +
    `${topic.emoji} *${topic.name}*\n` +
    `Tipo: ${typeName}\n\n` +
    `O tópico será fechado e não receberá mais mensagens.\n` +
    `Você pode reabrir depois se necessário.`,
    [
      [
        { text: '✅ Sim, fechar', callback_data: `topic_close_confirmed_${topic.id}` },
        { text: '❌ Cancelar', callback_data: `topic_detail_${topic.id}` },
      ],
    ]
  );
}

/**
 * Send confirmation modal for deleting a topic
 */
export async function sendTopicDeleteConfirmation(
  chatId: number,
  topic: TopicListItem
): Promise<void> {
  const typeName = topic.type === 'ralph' ? 'Ralph Loop'
    : topic.type === 'worktree' ? 'Worktree'
    : 'Sessão';

  await sendTelegramButtons(chatId,
    `🗑️ *Deletar tópico?*\n\n` +
    `${topic.emoji} *${topic.name}*\n` +
    `Tipo: ${typeName}\n\n` +
    `⚠️ *ATENÇÃO:* Todas as mensagens do tópico serão perdidas.\n` +
    `Esta ação não pode ser desfeita.`,
    [
      [
        { text: '✅ Sim, deletar', callback_data: `topic_delete_confirmed_${topic.id}` },
        { text: '❌ Cancelar', callback_data: `topic_detail_${topic.id}` },
      ],
    ]
  );
}

/**
 * Send confirmation modal for resetting session
 */
export async function sendSessionResetConfirmation(
  chatId: number,
  topic: TopicListItem
): Promise<void> {
  await sendTelegramButtons(chatId,
    `🔄 *Reset de sessão?*\n\n` +
    `${topic.emoji} *${topic.name}*\n\n` +
    `O histórico de conversa será apagado.\n` +
    `O agente começará uma nova sessão do zero.`,
    [
      [
        { text: '✅ Sim, resetar', callback_data: `topic_reset_confirmed_${topic.id}` },
        { text: '❌ Cancelar', callback_data: `topic_detail_${topic.id}` },
      ],
    ]
  );
}

// ============================================
// Action Feedback Messages
// ============================================

/**
 * Send feedback for topic action in General topic
 */
export async function sendTopicActionFeedbackGeneral(
  chatId: number,
  action: 'created' | 'closed' | 'reopened' | 'deleted' | 'reset',
  topicName: string,
  topicEmoji: string,
  topicType: 'ralph' | 'worktree' | 'session',
  threadId?: number
): Promise<void> {
  const actionMessages: Record<string, string> = {
    created: `✅ Tópico criado: ${topicEmoji} *${topicName}*`,
    closed: `🔒 Tópico fechado: ${topicEmoji} *${topicName}*`,
    reopened: `🔓 Tópico reaberto: ${topicEmoji} *${topicName}*`,
    deleted: `🗑️ Tópico deletado: ${topicEmoji} *${topicName}*`,
    reset: `🔄 Sessão resetada: ${topicEmoji} *${topicName}*`,
  };

  await sendTelegramMessage(chatId, actionMessages[action], undefined, threadId);
}

/**
 * Send welcome message in newly created topic (dual feedback)
 */
export async function sendTopicWelcomeMessage(
  chatId: number,
  threadId: number,
  topicName: string,
  topicEmoji: string,
  topicType: 'ralph' | 'worktree' | 'session',
  task?: string
): Promise<void> {
  const typeName = topicType === 'ralph' ? 'Ralph Loop'
    : topicType === 'worktree' ? 'Worktree'
    : 'Sessão';

  let text = `${topicEmoji} *Bem-vindo ao ${typeName}*\n\n` +
    `*${topicName}*\n\n`;

  if (topicType === 'ralph' && task) {
    const truncatedTask = task.length > 150 ? task.slice(0, 147) + '...' : task;
    text += `*Tarefa:* ${truncatedTask}\n\n` +
      `_O loop Ralph está iniciando..._`;
  } else if (topicType === 'worktree') {
    text += `Tópico isolado para experimentos e features.\n` +
      `O contexto é separado do tópico General.\n\n` +
      `_Envie uma mensagem para começar._`;
  } else {
    text += `Sessão de conversa isolada.\n` +
      `O contexto é separado do tópico General.\n\n` +
      `_Envie uma mensagem para começar._`;
  }

  await sendTelegramMessage(chatId, text, undefined, threadId);
}

/**
 * Send action feedback for pause operation
 */
export async function sendPauseFeedback(
  chatId: number,
  threadId: number,
  topicName: string
): Promise<void> {
  await sendTelegramMessage(
    chatId,
    `⏸️ *Loop pausado*\n\n` +
    `O Ralph Loop em *${topicName}* foi pausado.\n` +
    `Use ▶️ Retomar para continuar.`,
    undefined,
    threadId
  );
}

/**
 * Send action feedback for resume operation
 */
export async function sendResumeFeedback(
  chatId: number,
  threadId: number,
  topicName: string
): Promise<void> {
  await sendTelegramMessage(
    chatId,
    `▶️ *Loop retomado*\n\n` +
    `O Ralph Loop em *${topicName}* foi retomado.\n` +
    `Continuando de onde parou...`,
    undefined,
    threadId
  );
}

/**
 * Send action feedback for close operation
 */
export async function sendCloseFeedback(
  chatId: number,
  threadId: number,
  topicName: string
): Promise<void> {
  await sendTelegramMessage(
    chatId,
    `🔒 *Tópico fechado*\n\n` +
    `O tópico *${topicName}* foi fechado.\n` +
    `Você pode reabri-lo em /topicos se necessário.`,
    undefined,
    threadId
  );
}

/**
 * Send action feedback for reopen operation
 */
export async function sendReopenFeedback(
  chatId: number,
  threadId: number,
  topicName: string
): Promise<void> {
  await sendTelegramMessage(
    chatId,
    `🔓 *Tópico reaberto*\n\n` +
    `O tópico *${topicName}* foi reaberto.\n` +
    `Você pode enviar mensagens novamente.`,
    undefined,
    threadId
  );
}

/**
 * Send action feedback for reset operation
 */
export async function sendResetFeedback(
  chatId: number,
  threadId: number,
  topicName: string
): Promise<void> {
  await sendTelegramMessage(
    chatId,
    `🔄 *Sessão resetada*\n\n` +
    `A sessão de *${topicName}* foi resetada.\n` +
    `O agente começou uma nova conversa do zero.`,
    undefined,
    threadId
  );
}

/**
 * Send action feedback for cancel operation
 */
export async function sendCancelFeedback(
  chatId: number,
  threadId: number,
  topicName: string
): Promise<void> {
  await sendTelegramMessage(
    chatId,
    `🛑 *Loop cancelado*\n\n` +
    `O Ralph Loop em *${topicName}* foi cancelado.\n` +
    `O tópico permanece aberto para novas interações.`,
    undefined,
    threadId
  );
}
