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
