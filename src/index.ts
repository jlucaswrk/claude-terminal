import { Hono } from 'hono';
import { serve } from 'bun';
import { ClaudeTerminal, detectOldSessions, migrateOldSessions, type Model } from './terminal';
import {
  sendWhatsApp,
  sendWhatsAppImage,
  sendWhatsAppMedia,
  sendModelSelector,
  sendCommandsList,
  sendAgentsList,
  sendAgentSelector,
  sendModelSelectorList,
  sendContinueWithLastChoice,
  sendAgentMenu,
  sendHistoryList,
  sendErrorWithActions,
  sendConfigureLimitMenu,
  sendConfigurePriorityMenu,
  sendConfirmation,
  sendMigrationOptions,
  sendButtons,
  sendAgentSelectionForReset,
  sendAgentSelectionForDelete,
  sendOutputActions,
  sendEmojiSelector,
  sendWorkspaceSelector,
  sendAgentTypeSelector,
  sendBashModeStatus,
  sendTranscriptionError,
  sendModeSelector,
  sendRalphIterationsSelector,
  sendRalphConfigFlow,
  sendLoopProgress,
  sendLoopComplete,
  sendLoopBlocked,
  sendLoopError,
  sendLoopControls,
  sendRejectPrompt,
  sendUnlinkedGroupMessage,
  createWhatsAppGroup,
  deleteWhatsAppGroup,
  sendDeleteGroupChoice,
  sendAgentModeSelector,
  sendModelModeSelector,
  // Onboarding UI
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
  getTelegramBot,
  getBotInfo,
  sendTelegramMessage,
  sendTelegramPhoto,
  sendTelegramDocument,
  sendTelegramButtons,
  sendTelegramCommandList,
  sendTelegramAgentNamePrompt,
  sendTelegramAgentTypeSelector,
  sendTelegramEmojiSelector,
  sendTelegramAgentModeSelector,
  sendTelegramWorkspaceSelector,
  sendTelegramModelModeSelector,
  sendTelegramAgentConfirmation,
  sendTelegramAgentsList,
  sendTelegramDojoActivated,
  sendTelegramModelSelector,
  answerCallbackQuery,
  leaveTelegramGroup,
  sendGroupCreationInstructions,
  sendGroupLinkedConfirmation,
  sendTelegramAgentMenu,
  sendTelegramAgentConfigMenu,
  sendTelegramAgentHistory,
  sendTelegramDeleteConfirmation,
  sendTelegramStatusOverview,
  sendTelegramEditNamePrompt,
  updateTelegramGroupTitle,
  SANDBOX_DIR,
  ensureSandboxDirectory,
  // Ralph Loop UI
  sendTelegramRalphConfirmation,
  sendTelegramRalphIterationsConfig,
  sendTelegramRalphProgress,
  sendTelegramRalphPaused,
  sendTelegramRalphComplete,
  // Media handling UI
  sendTelegramImageOptions,
  sendTelegramDocumentOptions,
  sendTelegramImageProcessing,
  sendTelegramDocumentProcessing,
  // File download
  downloadTelegramFile,
  editTelegramMessage,
  pinTelegramMessage,
  // Group onboarding UI
  sendGroupAgentNamePrompt,
  sendGroupEmojiSelector,
  sendGroupWorkspaceSelector,
  sendGroupModelModeSelector,
  sendGroupCustomWorkspacePrompt,
  validateGroupAgentName,
  getAgentSandboxPath,
  // Topic routing
  isChatForum,
  TELEGRAM_ERRORS,
  startTypingIndicator,
  // Topic management UI
  TOPIC_ERRORS,
  sendTopicSetupButtons,
  sendTopicRalphTaskPrompt,
  sendTopicRalphIterationsPrompt,
  sendTopicRalphCustomIterationsPrompt,
  sendTopicNamePrompt,
  sendTopicWorkspaceQuestion,
  sendTopicCreatedInGeneral,
  sendTopicWelcome,
  sendTopicsList,
  sendTopicsNotEnabledError,
  sendTopicNoAgentError,
  // Ralph Topic Integration UI
  sendRalphMessageQueued,
  sendRalphTopicComplete,
  sendRalphTopicPaused,
  sendRalphControlResponse,
  sendRalphControlError,
  // Enhanced Topic Management UI
  sendEnhancedTopicsList,
  sendTopicDetailView,
  sendTopicCloseConfirmation,
  sendTopicDeleteConfirmation,
  sendSessionResetConfirmation,
  sendTopicNavigationLink,
  sendPauseFeedback,
  sendResumeFeedback,
  sendCloseFeedback,
  sendReopenFeedback,
  sendResetFeedback,
  sendCancelFeedback,
  sendTopicActionFeedbackGeneral,
  sendWorkspaceNotFoundOptions,
  type TopicListItem,
} from './telegram';
import { GroupOnboardingManager } from './group-onboarding-manager';
import { MessageRouter } from './message-router';
import { TelegramCommandHandler } from './telegram-command-handler';
import { topicManager } from './topic-manager';
import { transcribeAudio } from './transcription';
import { PersistenceService } from './persistence';
import { AgentManager, AgentValidationError } from './agent-manager';
import { QueueManager } from './queue-manager';
import { UserContextManager } from './user-context-manager';
import { Semaphore } from './semaphore';
import { RalphLoopManager } from './ralph-loop-manager';
import { DEFAULTS, PRIORITY_VALUES } from './types';
import type { Agent, AgentType, ModelMode, UserMode, UserPreferences } from './types';
import { executeCommand, formatBashResult, getFullOutputFilename } from './bash-executor';
import { uploadToKapso, downloadFromKapso } from './storage';
import { TelegramTokenManager } from './telegram-tokens';
import { existsSync, statSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { listDirectories, navigateUp, navigateInto } from './directory-navigator';

// =============================================================================
// Configuration
// =============================================================================

const config = {
  port: parseInt(process.env.PORT || '3000'),
  kapsoWebhookSecret: process.env.KAPSO_WEBHOOK_SECRET!,
  userPhone: process.env.USER_PHONE_NUMBER!,
};

// =============================================================================
// Component Initialization
// =============================================================================

// Persistence service
const persistenceService = new PersistenceService();

// Agent manager (loads state automatically)
const agentManager = new AgentManager(persistenceService);

// Semaphore for concurrency control (use config from loaded state)
// Use ?? instead of || to preserve 0 (unbounded mode)
const semaphore = new Semaphore(agentManager.getConfig().maxConcurrent ?? DEFAULTS.MAX_CONCURRENT);

// Group onboarding manager (manages Telegram group onboarding state)
const groupOnboardingManager = new GroupOnboardingManager();

// Claude terminal
const terminal = new ClaudeTerminal();

// Wrapper functions that detect telegram: prefix and route accordingly
async function sendMessage(to: string, text: string): Promise<void> {
  if (to.startsWith('telegram:')) {
    const chatId = parseInt(to.replace('telegram:', ''), 10);
    await sendTelegramMessage(chatId, text);
  } else {
    await sendWhatsApp(to, text);
  }
}

async function sendImage(to: string, imageUrl: string): Promise<void> {
  if (to.startsWith('telegram:')) {
    const chatId = parseInt(to.replace('telegram:', ''), 10);
    await sendTelegramPhoto(chatId, imageUrl);
  } else {
    await sendWhatsAppImage(to, imageUrl);
  }
}

async function sendErrorWithActionsWrapper(to: string, agentName: string, error: string): Promise<void> {
  if (to.startsWith('telegram:')) {
    const chatId = parseInt(to.replace('telegram:', ''), 10);
    await sendTelegramMessage(chatId, `❌ *${agentName}*: ${error}`);
  } else {
    await sendErrorWithActions(to, agentName, error);
  }
}

async function sendMedia(to: string, mediaId: string, mediaType: string, filename: string, caption?: string): Promise<void> {
  if (to.startsWith('telegram:')) {
    const chatId = parseInt(to.replace('telegram:', ''), 10);
    // For Telegram, we'd need to convert the mediaId to actual media
    // For now, just send a text message with the filename
    await sendTelegramMessage(chatId, `📎 *${filename}*${caption ? `\n${caption}` : ''}`);
  } else {
    await sendWhatsAppMedia(to, mediaId, mediaType as 'image' | 'video' | 'audio' | 'document', filename, caption);
  }
}

// Direct Telegram send functions for QueueManager
async function sendTelegramDirectMessage(chatId: number, text: string, threadId?: number): Promise<{ message_id: number } | null> {
  const msg = await sendTelegramMessage(chatId, text, undefined, threadId);
  return msg ? { message_id: msg.message_id } : null;
}

async function editTelegramDirect(chatId: number | string, messageId: number, text: string): Promise<boolean> {
  return editTelegramMessage(chatId, messageId, text);
}

async function sendTelegramDirectImage(chatId: number, imageUrl: string, caption?: string, threadId?: number): Promise<void> {
  await sendTelegramPhoto(chatId, imageUrl, caption, threadId);
}

// Queue manager (with image, file, error recovery, and Telegram support)
const queueManager = new QueueManager(
  semaphore,
  agentManager,
  terminal,
  sendMessage,
  sendImage,
  sendErrorWithActionsWrapper,
  sendMedia,
  sendTelegramDirectMessage,
  editTelegramDirect,
  sendTelegramDirectImage,
  startTypingIndicator,
  topicManager,
  async (params) => {
    // Store paused task data in UserContext
    userContextManager.setContext(params.userId, {
      userId: params.userId,
      activeAgentId: params.agentId,
      currentFlow: 'workspace_not_found',
      flowState: 'awaiting_workspace_choice',
      flowData: {
        agentId: params.agentId,
        pausedTaskId: params.taskId,
        pausedPrompt: params.prompt,
        pausedModel: params.model,
        pausedImages: params.images,
        missingWorkspacePath: params.missingPath,
        topicId: params.topicId,
        telegramChatId: params.chatId,
      },
    });

    // Send interactive buttons to the user
    await sendWorkspaceNotFoundOptions(
      params.chatId,
      params.threadId,
      params.topicId,
      params.missingPath
    );
  }
);

// Telegram command handler (stateless router)
const telegramCommandHandler = new TelegramCommandHandler(agentManager, groupOnboardingManager, topicManager);

// Ralph loop manager (for autonomous Ralph mode execution)
const ralphLoopManager = new RalphLoopManager(semaphore, agentManager, persistenceService, terminal);

// Set up Ralph loop progress callback
ralphLoopManager.setProgressCallback(async (loopId, iteration, maxIterations, action) => {
  const loop = ralphLoopManager.getLoop(loopId);
  if (loop) {
    const agent = agentManager.getAgent(loop.agentId);
    if (agent) {
      await sendLoopProgress(loop.userId, agent.name, iteration, maxIterations, action, loop.currentModel);
    }
  }
});

// User context manager (in-memory, not persisted)
const userContextManager = new UserContextManager();

// Message router for groups/main number routing
const messageRouter = new MessageRouter(agentManager, config.userPhone);

// Telegram token manager for Dojo onboarding
const telegramTokenManager = new TelegramTokenManager();

// Track pending agent creation for /link command (userId -> agentId)
const pendingAgentLink = new Map<string, string>();

// Status emojis for agent display
const STATUS_EMOJI: Record<string, string> = {
  idle: '⚪',
  processing: '🔵',
  error: '🔴',
  'ralph-loop': '🔄',
  'ralph-paused': '⏸️',
};

// Map to store selected agents for prompt sending (agentId awaiting model selection)
const pendingAgentSelection = new Map<string, string>();

// Note: lastErrors is now managed by QueueManager for proper error recovery (Flow 11)

// =============================================================================
// User Mode Helpers (Ronin/Dojo)
// =============================================================================

/**
 * Get user mode (ronin or dojo)
 */
function getUserMode(userId: string): UserMode {
  const prefs = persistenceService.loadUserPreferences(userId);
  return prefs?.mode || 'ronin'; // Default to ronin
}

/**
 * Check if user needs onboarding
 * Backwards compatible: users with existing agents skip onboarding
 */
function needsOnboarding(userId: string): boolean {
  const prefs = persistenceService.loadUserPreferences(userId);
  if (prefs?.onboardingComplete) return false;

  // Backwards compatibility: existing users with agents don't need onboarding
  const existingAgents = agentManager.listAgents(userId);
  if (existingAgents.length > 0) return false;

  return true;
}

/**
 * Check if user is in Dojo mode
 */
function isDojoMode(userId: string): boolean {
  return getUserMode(userId) === 'dojo';
}

// =============================================================================
// Startup
// =============================================================================

// Reset any agents that were in 'processing' status on startup (crash recovery)
for (const agent of agentManager.getAllAgents()) {
  if (agent.status === 'processing') {
    agentManager.updateAgentStatus(agent.id, 'idle', 'Aguardando prompt');
    console.log(`Reset agent ${agent.name} from 'processing' to 'idle' on startup`);
  }
}

console.log(`Loaded ${agentManager.getAllAgents().length} agents from state`);

/**
 * Startup sync: Validate topics and loops with 30s timeout
 * Runs asynchronously, logs errors but doesn't block startup
 */
async function performStartupSync(): Promise<void> {
  console.log('[startup] Iniciando sincronização de tópicos e loops...');

  // Abort flag for timeout cancellation
  let aborted = false;

  const syncPromise = (async () => {
    try {
      // Get all agents with Telegram chats
      const agents = agentManager.getAllAgents();
      const telegramAgents = agents.filter(a => a.telegramChatId);

      if (telegramAgents.length === 0) {
        console.log('[startup] Nenhum agente com Telegram configurado');
        return;
      }

      console.log(`[startup] Sincronizando ${telegramAgents.length} agentes com Telegram`);

      let totalTopics = 0;
      let totalActive = 0;
      let totalNewlyClosed = 0;

      // Sync topics for each agent
      for (const agent of telegramAgents) {
        // Check abort flag
        if (aborted) {
          console.log('[startup] Sincronização abortada por timeout');
          return;
        }

        if (!agent.telegramChatId) continue;

        console.log(`[startup] Sincronizando tópicos do agente "${agent.name}" (${agent.id})`);

        const syncResult = await topicManager.syncTopicsWithTelegram(
          agent.id,
          agent.telegramChatId
        );

        if (!syncResult.success) {
          console.error(`[startup] Erro ao sincronizar agente ${agent.name}:`, syncResult.errors);
        } else {
          totalTopics += syncResult.synced + syncResult.newlyClosed + syncResult.alreadyClosed;
          totalActive += syncResult.synced;
          totalNewlyClosed += syncResult.newlyClosed;
        }
      }

      const totalClosed = totalTopics - totalActive;
      console.log(`[startup] ✅ Sincronizados ${totalTopics} tópicos (${totalActive} ativos, ${totalClosed} fechados)`);

      // Check abort flag before loop migration
      if (aborted) {
        console.log('[startup] Sincronização abortada por timeout');
        return;
      }

      // Migrate legacy loops from data/loops to new directory
      console.log('[startup] Migrando loops legados...');
      const migrationResult = persistenceService.migrateLegacyLoops(
        (agentId, threadId) => topicManager.getTopicByThreadId(agentId, threadId)
      );

      if (migrationResult.migratedCount > 0) {
        console.log(`[startup] ✅ Migrados ${migrationResult.migratedCount} agentes`);
      }

      // Check abort flag before loop validation
      if (aborted) {
        console.log('[startup] Sincronização abortada por timeout');
        return;
      }

      // Validate Ralph loops against topics
      console.log('[startup] Validando loops Ralph contra tópicos...');
      const interruptedLoops = await ralphLoopManager.validateLoopsAgainstTopics(
        (agentId, threadId) => topicManager.getTopicByThreadId(agentId, threadId)
      );

      if (interruptedLoops > 0) {
        console.log(`[startup] ✅ Recuperados ${interruptedLoops} loops Ralph`);
      }

      console.log(`[startup] ✅ Sincronizados ${telegramAgents.length} agentes Telegram`);
      console.log('[startup] Sincronização concluída com sucesso');
    } catch (error) {
      console.error('[startup] Erro durante sincronização:', error);
    }
  })();

  // Apply 30s timeout
  const timeoutPromise = new Promise<void>((resolve) => {
    setTimeout(() => {
      aborted = true; // Signal sync to stop
      console.warn('[startup] Timeout de 30s atingido, continuando inicialização');
      resolve();
    }, 30000);
  });

  await Promise.race([syncPromise, timeoutPromise]);
}

// Trigger sync asynchronously if Telegram is configured (don't block startup)
const isTestEnv = process.env.NODE_ENV === 'test' || process.env.BUN_ENV === 'test';
if (!isTestEnv && isTelegramConfigured()) {
  performStartupSync().catch(err => {
    console.error('[startup] Erro fatal na sincronização:', err);
  });
}

// =============================================================================
// Hono App
// =============================================================================

const app = new Hono();

// Health check
app.get('/health', (c) => c.json({ status: 'ok' }));

// Kapso webhook verification
app.get('/webhook', (c) => {
  const mode = c.req.query('hub.mode');
  const token = c.req.query('hub.verify_token');
  const challenge = c.req.query('hub.challenge');

  if (mode === 'subscribe' && token === config.kapsoWebhookSecret) {
    console.log('Webhook verified');
    return c.text(challenge || '');
  }
  return c.text('Forbidden', 403);
});

// =============================================================================
// Main Webhook Handler
// =============================================================================

app.post('/webhook', async (c) => {
  const payload = await c.req.json();
  const message = extractMessage(payload);

  if (!message) {
    return c.json({ status: 'ignored' });
  }

  // Only accept messages from configured user
  const normalizedPhone = config.userPhone.replace('+', '');
  if (!message.from.endsWith(normalizedPhone)) {
    console.log(`Ignored message from ${message.from}`);
    return c.json({ status: 'ignored' });
  }

  const userId = message.from;
  const t0 = Date.now();

  try {
    // Route by message type
    switch (message.type) {
      case 'text':
        return c.json(await handleTextMessage(userId, message.text!, message.messageId, message.groupId));

      case 'button':
        return c.json(await handleButtonReply(userId, message.buttonId!));

      case 'list':
        return c.json(await handleListReply(userId, message.listId!, message.messageId));

      case 'image':
        return c.json(await handleImageMessage(userId, message.text || '', message.imageId!, message.imageMimeType!, message.messageId, message.imageUrl));

      case 'audio':
        return c.json(await handleAudioMessage(userId, message.audioId!, message.audioMimeType!, message.messageId, message.audioUrl));

      default:
        return c.json({ status: 'unsupported_type' });
    }
  } catch (error) {
    console.error('Webhook error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    await sendWhatsApp(userId, `❌ Erro interno: ${errorMessage}`);
    return c.json({ status: 'error', message: errorMessage });
  } finally {
    console.log(`[timing] Total: ${Date.now() - t0}ms`);
  }
});

// =============================================================================
// Telegram Webhook
// =============================================================================

app.post('/webhook/telegram', async (c) => {
  if (!isTelegramConfigured()) {
    return c.json({ ok: false, error: 'Telegram not configured' }, 500);
  }

  try {
    const update = await c.req.json();
    // Process asynchronously - respond immediately to avoid Telegram timeout
    handleTelegramUpdate(update).catch(err => {
      console.error('Telegram update processing error:', err);
    });
    return c.json({ ok: true });
  } catch (error) {
    console.error('Telegram webhook error:', error);
    return c.json({ ok: false }, 500);
  }
});

// Legacy endpoint for backwards compatibility
app.post('/telegram', async (c) => {
  if (!isTelegramConfigured()) {
    return c.json({ ok: false, error: 'Telegram not configured' }, 500);
  }

  try {
    const update = await c.req.json();
    // Process asynchronously - respond immediately to avoid Telegram timeout
    handleTelegramUpdate(update).catch(err => {
      console.error('Telegram update processing error:', err);
    });
    return c.json({ ok: true });
  } catch (error) {
    console.error('Telegram webhook error:', error);
    return c.json({ ok: false }, 500);
  }
});

// Deduplication cache for Telegram messages (prevents double processing)
const processedTelegramMessages = new Set<string>();
const TELEGRAM_DEDUP_TTL = 60000; // 1 minute

function getTelegramMessageKey(update: any): string | null {
  if (update.callback_query) {
    return `cb:${update.callback_query.id}`;
  }
  if (update.message) {
    return `msg:${update.message.chat.id}:${update.message.message_id}`;
  }
  return null;
}

/**
 * Handle Telegram update
 */
async function handleTelegramUpdate(update: any): Promise<void> {
  // Deduplicate - Telegram sometimes sends the same update twice
  const key = getTelegramMessageKey(update);
  if (key) {
    if (processedTelegramMessages.has(key)) {
      console.log(`[telegram] Skipping duplicate: ${key}`);
      return;
    }
    processedTelegramMessages.add(key);
    // Clean up after TTL
    setTimeout(() => processedTelegramMessages.delete(key), TELEGRAM_DEDUP_TTL);
  }

  // Handle callback queries (button presses)
  if (update.callback_query) {
    await handleTelegramCallback(update.callback_query);
    return;
  }

  // Handle my_chat_member updates (bot added/removed from groups)
  if (update.my_chat_member) {
    await handleTelegramMyChatMember(update.my_chat_member);
    return;
  }

  // Handle messages
  if (update.message) {
    await handleTelegramMessage(update.message);
    return;
  }
}

/**
 * Handle Telegram my_chat_member update (bot added/removed from groups)
 * This is triggered when the bot's status changes in a chat (added, removed, promoted, etc.)
 */
async function handleTelegramMyChatMember(update: any): Promise<void> {
  const chat = update.chat;
  const from = update.from; // User who made the change
  const newStatus = update.new_chat_member?.status;
  const oldStatus = update.old_chat_member?.status;
  const telegramUserId = from.id;
  const telegramUsername = from.username;

  console.log(`[telegram] my_chat_member: chat=${chat.id} (${chat.type}), from=${telegramUsername || telegramUserId}, status: ${oldStatus} -> ${newStatus}`);

  // Only process for group chats
  const isGroup = chat.type === 'group' || chat.type === 'supergroup';
  if (!isGroup) {
    return;
  }

  const chatId = chat.id;

  // Check if bot was added (became member or administrator from a non-member state)
  const wasAdded = (newStatus === 'member' || newStatus === 'administrator') &&
                   oldStatus !== 'member' && oldStatus !== 'administrator';

  // Check if bot was removed (left or kicked)
  const wasRemoved = (newStatus === 'left' || newStatus === 'kicked') &&
                     (oldStatus === 'member' || oldStatus === 'administrator');

  if (wasAdded) {
    await handleBotAddedToGroup(chatId, telegramUserId, telegramUsername);
  } else if (wasRemoved) {
    await handleBotRemovedFromGroup(chatId);
  }
}

/**
 * Handle bot being added to a Telegram group
 * Identifies user, checks for existing agents, sends onboarding message and pins it
 */
async function handleBotAddedToGroup(chatId: number, telegramUserId: number, telegramUsername?: string): Promise<void> {
  // Try to identify user by Telegram username
  const allPrefs = persistenceService.getAllUserPreferences();
  const userPrefs = allPrefs.find(p =>
    p.telegramUsername?.toLowerCase() === telegramUsername?.toLowerCase()
  );

  if (!userPrefs || !telegramUsername) {
    // Unknown user - send generic message
    await sendTelegramMessage(chatId,
      '👋 *Bot adicionado ao grupo*\n\n' +
      'Não encontrei seu cadastro.\n' +
      'Configure o Dojo primeiro pelo WhatsApp.'
    );
    return;
  }

  const userId = userPrefs.userId;

  // Check if user has existing agents
  const existingAgents = agentManager.listAgents(userId);
  const hasExistingAgents = existingAgents.length > 0;

  let message;

  if (!hasExistingAgents) {
    // First-time user: "seu primeiro agente 🎉" + [criar agora]
    message = await sendTelegramButtons(chatId,
      '🎉 *Seu primeiro agente!*\n\n' +
      'Vamos criar um agente para este grupo.',
      [
        [{ text: '✨ Criar agora', callback_data: `onboard_create_${telegramUserId}` }],
      ]
    );
  } else {
    // Existing user: "esse grupo não tem agente ainda" + [criar um] [vincular existente]
    message = await sendTelegramButtons(chatId,
      '👋 *Esse grupo não tem agente ainda*\n\n' +
      'Você pode criar um novo ou vincular um existente.',
      [
        [
          { text: '✨ Criar um', callback_data: `onboard_create_${telegramUserId}` },
          { text: '🔗 Vincular existente', callback_data: `onboard_link_${telegramUserId}` },
        ],
      ]
    );
  }

  // Pin the message
  if (message) {
    await pinTelegramMessage(chatId, message.message_id);

    // Initialize onboarding state and store pinned message ID
    const result = groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_name');
    if (result.success) {
      groupOnboardingManager.setPinnedMessageId(chatId, telegramUserId, message.message_id);
    }
  }
}

/**
 * Handle bot being removed from a Telegram group
 * Unlinks any associated agent and cleans up onboarding state
 */
async function handleBotRemovedFromGroup(chatId: number): Promise<void> {
  // Find the agent linked to this group
  const agent = agentManager.getAgentByTelegramChatId(chatId);

  if (agent) {
    // Unlink the agent from this group
    agentManager.setTelegramChatId(agent.id, undefined);
    console.log(`[telegram] Unlinked agent ${agent.name} (${agent.id}) from group ${chatId}`);
  }

  // Cleanup onboarding state if any
  const state = groupOnboardingManager.getState(chatId);
  if (state) {
    groupOnboardingManager.cancelOnboarding(chatId, state.userId);
    console.log(`[telegram] Cancelled onboarding for group ${chatId}`);
  }
}

/**
 * Telegram service message field names that should be silently ignored.
 * These are system-generated messages (topic edits, member changes, etc.)
 * that don't contain user content and would cause errors if processed.
 */
const TELEGRAM_SERVICE_MESSAGE_FIELDS = [
  'forum_topic_created',
  'forum_topic_edited',
  'forum_topic_closed',
  'forum_topic_reopened',
  'new_chat_members',
  'left_chat_member',
  'new_chat_title',
  'new_chat_photo',
] as const;

/**
 * Detect Telegram service messages that should be ignored.
 * Returns the service message type if detected, or null for normal messages.
 */
function isServiceMessage(message: any): string | null {
  for (const field of TELEGRAM_SERVICE_MESSAGE_FIELDS) {
    if (message[field] !== undefined) {
      return field;
    }
  }
  return null;
}

/**
 * Handle Telegram message
 */
async function handleTelegramMessage(message: any): Promise<void> {
  // Filter out service messages (topic edits, member changes, etc.)
  const serviceType = isServiceMessage(message);
  if (serviceType) {
    console.log(`[telegram] Ignoring service message: ${serviceType} (chat=${message.chat?.id})`);
    return;
  }

  const chatId = message.chat.id;
  const text = message.text || '';
  const caption = message.caption || '';
  const from = message.from;
  const chatType = message.chat.type || 'private';
  const threadId = message.message_thread_id as number | undefined;
  const isGroup = telegramCommandHandler.isGroupChat(chatType);

  // Log message type
  const hasPhoto = !!message.photo;
  const hasDocument = !!message.document;
  const msgType = hasPhoto ? '[photo]' : hasDocument ? '[document]' : text.slice(0, 50);
  const threadInfo = threadId ? ` [thread:${threadId}]` : '';
  console.log(`[telegram] ${from.username || from.id} (${chatType}${threadInfo}): ${msgType}`);
  console.log(`[telegram] DEBUG: chatId=${chatId}, chatType=${chatType}, threadId=${threadId}, from.username=${from.username}, from.id=${from.id}`);

  // =============================================================================
  // Group Onboarding (check BEFORE userPrefs - onboarding doesn't require prefs)
  // =============================================================================
  if (isGroup && text && groupOnboardingManager.hasActiveOnboarding(chatId)) {
    const state = groupOnboardingManager.getState(chatId);

    // Only process if this user has the lock
    if (state && groupOnboardingManager.isLockedByUser(chatId, from.id)) {
      // Handle awaiting_name step
      if (state.step === 'awaiting_name') {
        // Validate name
        const validationError = validateGroupAgentName(text);
        if (validationError) {
          await sendTelegramMessage(chatId, `⚠️ *Nome inválido*\n\n${validationError}`);
          return;
        }

        // Store name and advance to emoji step
        groupOnboardingManager.setAgentName(chatId, from.id, text.trim());
        groupOnboardingManager.advanceStep(chatId, from.id, 'awaiting_emoji');
        await sendGroupEmojiSelector(chatId);
        return;
      }

      // Handle custom workspace input
      if (state.step === 'awaiting_workspace' && state.data.workspace === '__awaiting_custom__') {
        const { existsSync } = await import('fs');
        const trimmedPath = text.trim();

        // Validate path exists
        if (!existsSync(trimmedPath)) {
          await sendTelegramButtons(chatId,
            `⚠️ *Caminho não encontrado*\n\n` +
            `\`${trimmedPath}\` não existe.\n\n` +
            `Escolha uma alternativa:`,
            [
              [
                { text: '🧪 Sandbox', callback_data: 'grp_workspace_sandbox' },
                { text: '✏️ Tentar outro', callback_data: 'grp_workspace_custom' },
              ],
            ]
          );
          return;
        }

        // Store workspace and advance to model mode step
        groupOnboardingManager.setWorkspace(chatId, from.id, trimmedPath);
        groupOnboardingManager.advanceStep(chatId, from.id, 'awaiting_model_mode');
        await sendGroupModelModeSelector(chatId);
        return;
      }
    }
  }

  // =============================================================================
  // User Preferences Check (required for all non-onboarding operations)
  // =============================================================================
  const allPrefs = persistenceService.getAllUserPreferences();
  const userPrefs = allPrefs.find(p =>
    p.telegramUsername?.toLowerCase() === from.username?.toLowerCase()
  );

  if (!userPrefs) {
    await sendTelegramMessage(chatId,
      'Usuario nao encontrado.\n\n' +
      'Configure o Dojo primeiro pelo WhatsApp.'
    );
    return;
  }

  // Update telegram chat ID for private chats
  if (chatType === 'private' && !userPrefs.telegramChatId) {
    userPrefs.telegramChatId = chatId;
    persistenceService.saveUserPreferences(userPrefs);
  }

  const userId = userPrefs.userId;

  // Handle photo messages in groups
  if (isGroup && message.photo) {
    await handleTelegramImageMessage(chatId, userId, message.photo, caption);
    return;
  }

  // Handle document messages in groups
  if (isGroup && message.document) {
    await handleTelegramDocumentMessage(chatId, userId, message.document, caption);
    return;
  }

  // =============================================================================
  // Route based on chat type using TelegramCommandHandler
  // =============================================================================
  if (isGroup) {
    // Check if user is in a topic creation flow awaiting text input
    // This must happen BEFORE routeGroupMessage to prevent flow inputs from being
    // routed as prompts (e.g. topic names, tasks, paths)
    if (text && (
      userContextManager.isAwaitingTopicTask(userId) ||
      userContextManager.isAwaitingTopicName(userId) ||
      userContextManager.isAwaitingTopicIterations(userId) ||
      userContextManager.isAwaitingTopicWorkspace(userId)
    )) {
      // /cancelar must NOT be consumed as flow input — clear context and respond
      if (text === '/cancelar' || text.startsWith('/cancel ') || text === '/cancel') {
        userContextManager.clearContext(userId);
        await sendTelegramMessage(chatId, '❌ Criação de tópico cancelada.');
        return;
      }
      await handleTelegramFlowInput(chatId, userId, text);
      return;
    }

    // Check if chat is a forum (has topics enabled)
    // Note: is_forum is available in the chat object for supergroups
    const isForum = message.chat.is_forum === true;

    // Group message routing with topic support
    const route = telegramCommandHandler.routeGroupMessage(chatId, userId, text, from.id, threadId, isForum);

    switch (route.action) {
      case 'command':
        // Handle /cancelar specially as it needs telegram user ID for lock validation
        if (route.command === '/cancelar') {
          await handleGroupCancelarCommand(chatId, userId, from.id);
          return;
        }
        await handleTelegramCommand(chatId, userId, `${route.command} ${route.args}`.trim());
        return;

      case 'prompt':
        // Set active agent for continuous conversation support
        userContextManager.setActiveAgent(userId, route.agentId);
        // Start typing indicator in the correct topic
        const stopTyping = startTypingIndicator(chatId, route.threadId);
        try {
          // Queue the prompt directly with the specified model
          queueManager.enqueue({
            agentId: route.agentId,
            prompt: route.text,
            model: route.model!,
            userId,
            replyTo: chatId,
            threadId: route.threadId,
          });
        } finally {
          stopTyping();
        }
        return;

      case 'show_model_selector':
        // Set active agent for continuous conversation support
        userContextManager.setActiveAgent(userId, route.agentId);
        // Store prompt and show model selector
        userContextManager.setPendingPrompt(userId, route.text, undefined);
        userContextManager.startPromptFlow(userId, route.agentId);
        await sendTelegramButtons(chatId, `*Modelo para ${agentManager.getAgent(route.agentId)?.name || 'Agent'}*`, [
          [
            { text: 'Haiku', callback_data: 'model_haiku' },
            { text: 'Sonnet', callback_data: 'model_sonnet' },
            { text: 'Opus', callback_data: 'model_opus' },
          ],
        ], route.threadId);
        return;

      case 'ralph_loop':
        // Handle /ralph <task> command - show confirmation UI
        await handleTelegramRalphCommand(chatId, userId, route.agentId, route.task);
        return;

      case 'bash_command':
        // Handle bash command for bash agents
        await handleTelegramBashCommand(chatId, userId, route.agentId, route.command);
        return;

      case 'group_onboarding_locked':
        // Another user is configuring this group - silently ignore
        // We cannot use answerCallbackQuery here since this is a plain message (no callback context)
        // Posting to chat would show warning to everyone; silent ignore is the best UX
        return;

      case 'flow_input':
        // Same user during onboarding but not at a text-input step
        // Silently ignore (they should use buttons)
        return;

      case 'orphaned_group':
        // Unlinked group - show create/link options
        await sendTelegramMessage(chatId,
          '⚠️ *Grupo sem agente vinculado*\n\n' +
          'Este grupo não está conectado a nenhum agente.\n' +
          'Crie um novo agente e vincule a este grupo, ou remova o bot.',
          undefined,
          threadId
        );
        await sendTelegramButtons(chatId,
          'O que deseja fazer?',
          [
            [
              { text: 'Criar agente', callback_data: `orphan_recreate_${chatId}` },
              { text: 'Remover bot', callback_data: `orphan_leave_${chatId}` },
            ],
          ],
          threadId
        );
        return;

      case 'topic_not_found':
        // Topic doesn't exist - send educational error
        await sendTelegramMessage(chatId, TELEGRAM_ERRORS.TOPIC_NOT_FOUND(route.threadId), undefined, route.threadId);
        return;

      case 'topic_unregistered':
        // Topic exists in Telegram but not registered locally - show setup buttons
        await sendTopicSetupButtons(chatId, route.threadId, route.agentId);
        return;

      case 'topic_closed':
        // Topic is closed - send educational error
        await sendTelegramMessage(chatId, TELEGRAM_ERRORS.TOPIC_CLOSED(route.topicName), undefined, route.threadId);
        return;

      case 'topic_ralph_active':
        // Topic has active Ralph loop - queue message for later
        const enqueued = ralphLoopManager.enqueueMessage(route.loopId, route.text, route.userId);
        if (enqueued) {
          const queuePosition = ralphLoopManager.getQueueSize(route.loopId);
          await sendRalphMessageQueued(chatId, route.threadId, queuePosition);
        } else {
          // Loop no longer exists or isn't running - send regular error
          await sendTelegramMessage(chatId, TELEGRAM_ERRORS.TOPIC_RALPH_ACTIVE(route.topicName), undefined, route.threadId);
        }
        return;

      case 'topic_command':
        // Handle topic management commands
        await handleTopicCommand(chatId, userId, route.command, route.args, route.agentId, isForum);
        return;

      case 'topic_workspace':
        // Handle /workspace command in a specific topic
        await handleTopicWorkspace(chatId, route.threadId!, userId, route.agentId, route.path);
        return;

      case 'topic_workspace_general':
        // /workspace used in General topic - show instruction
        await sendTelegramMessage(chatId,
          '⚠️ O comando /workspace só funciona em tópicos.\n\n' +
          'Use /ralph, /worktree ou /sessao para criar um tópico, ' +
          'depois use /workspace dentro dele.',
          undefined,
          threadId
        );
        return;

      case 'ralph_control':
        // Handle /pausar, /retomar, /cancelar commands in Ralph topics
        await handleRalphControlCommand(
          chatId,
          route.threadId,
          route.loopId,
          route.command
        );
        return;

      case 'ignore':
        return;
    }
  } else {
    // Private chat routing
    const isInFlow = userContextManager.isInFlow(userId) || userContextManager.hasPendingPromptFlow(userId);
    const route = telegramCommandHandler.routePrivateMessage(chatId, userId, text, isInFlow);

    switch (route.action) {
      case 'command':
        await handleTelegramCommand(chatId, userId, `${route.command} ${route.args}`.trim());
        return;

      case 'flow_input':
        // Handle flow states (agent creation)
        if (userContextManager.isInFlow(userId)) {
          await handleTelegramFlowInput(chatId, userId, text);
          return;
        }
        // Handle pending prompt flow (user selected agent, waiting for text)
        if (userContextManager.hasPendingPromptFlow(userId)) {
          const agentId = userContextManager.getPendingAgentId(userId) || userContextManager.getActiveAgent(userId);
          const agent = agentId ? agentManager.getAgent(agentId) : null;

          if (agent) {
            // Store the prompt and ask for model if agent uses selection mode
            if (agent.modelMode === 'selection') {
              userContextManager.setPendingPrompt(userId, text, undefined);
              await sendTelegramModelSelector(chatId, agent.name);
            } else {
              // Set active agent for continuous conversation support before clearing context
              userContextManager.setActiveAgent(userId, agent.id);
              // Fixed model - queue immediately
              userContextManager.clearContext(userId);
              queueManager.enqueue({
                agentId: agent.id,
                prompt: text,
                model: agent.modelMode as 'haiku' | 'sonnet' | 'opus',
                userId,
                replyTo: chatId, // Number type for Telegram
              });
            }
            return;
          }
        }
        return;

      case 'reject_private_prompt':
        // Send educational message and show agents list
        await sendTelegramMessage(chatId,
          '⚠️ *Prompts não são aceitos aqui*\n\n' +
          'No chat privado, use apenas comandos.\n' +
          'Para enviar prompts, use o grupo do agente.\n\n' +
          'Seus agentes:'
        );
        // Show agents list
        const agents = agentManager.listAgents(userId)
          .filter(a => a.name !== 'Ronin')
          .map(a => ({
            id: a.id,
            name: a.name,
            emoji: a.emoji || '🤖',
            status: a.status,
            workspace: a.workspace,
          }));
        await sendTelegramAgentsList(chatId, agents);
        return;

      case 'unknown_user':
        await sendTelegramMessage(chatId,
          'Usuario nao encontrado.\n\n' +
          'Configure o Dojo primeiro pelo WhatsApp.'
        );
        return;
    }
  }

  // Default: show help
  await sendTelegramCommandList(chatId);
}

// =============================================================================
// Telegram Ralph Loop Handlers
// =============================================================================

/**
 * Handle /ralph <task> command - show confirmation UI
 */
async function handleTelegramRalphCommand(
  chatId: number,
  userId: string,
  agentId: string,
  task: string
): Promise<void> {
  const agent = agentManager.getAgent(agentId);
  if (!agent) {
    await sendTelegramMessage(chatId, '❌ Agente não encontrado.');
    return;
  }

  // Store Ralph loop data in user context
  const context = userContextManager.getContext(userId) || { userId };
  context.currentFlow = 'ralph_loop';
  context.flowState = 'awaiting_confirmation';
  context.flowData = {
    ...context.flowData,
    agentId,
    ralphTask: task,
    ralphMaxIterations: 10, // Default
    telegramChatId: chatId,
  };
  userContextManager.updateContext(userId, context);

  // Show confirmation UI
  await sendTelegramRalphConfirmation(chatId, agent.name, task, 10);
}

/**
 * Handle Ralph loop start (after confirmation)
 */
async function handleTelegramRalphStart(
  chatId: number,
  userId: string
): Promise<void> {
  const context = userContextManager.getContext(userId);
  const flowData = context?.flowData;

  if (!flowData?.agentId || !flowData?.ralphTask) {
    await sendTelegramMessage(chatId, '❌ Dados do loop não encontrados.');
    return;
  }

  const agent = agentManager.getAgent(flowData.agentId);
  if (!agent) {
    await sendTelegramMessage(chatId, '❌ Agente não encontrado.');
    return;
  }

  const maxIterations = (flowData.ralphMaxIterations as number) || 10;

  try {
    // Create the loop
    const loopId = ralphLoopManager.start(
      flowData.agentId,
      flowData.ralphTask,
      maxIterations,
      'sonnet' // Default model for Ralph loops
    );

    // Store loop ID
    flowData.ralphLoopId = loopId;
    userContextManager.updateContext(userId, context!);

    // Send started message
    await sendTelegramMessage(chatId,
      `🔄 *Ralph Loop iniciado*\n\n` +
      `*Agente:* ${agent.name}\n` +
      `*Máx. iterações:* ${maxIterations}`
    );

    // Clear the flow state (loop is now running independently)
    userContextManager.clearContext(userId);

    // Execute the loop (async - will send progress updates)
    const startTime = Date.now();

    // Set up progress callback for this specific loop
    const originalCallback = ralphLoopManager['progressCallback'];
    ralphLoopManager.setProgressCallback(async (loopIdCallback, iteration, max, action) => {
      if (loopIdCallback === loopId) {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        await sendTelegramRalphProgress(chatId, loopId, iteration, max, action, elapsed);
      }
      // Call original callback too
      if (originalCallback) {
        originalCallback(loopIdCallback, iteration, max, action);
      }
    });

    try {
      // Execute and handle completion
      const result = await ralphLoopManager.execute(loopId);

      const durationSeconds = Math.floor((Date.now() - startTime) / 1000);

      // Send completion message
      await sendTelegramRalphComplete(
        chatId,
        loopId,
        result.iterations,
        durationSeconds,
        result.status as 'completed' | 'cancelled' | 'blocked' | 'failed',
        result.error
      );
    } finally {
      // Restore original callback even if execute() throws
      ralphLoopManager.setProgressCallback(originalCallback);
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await sendTelegramMessage(chatId, `❌ Erro ao iniciar loop: ${errorMessage}`);
    userContextManager.clearContext(userId);
  }
}

/**
 * Handle Ralph loop pause
 */
async function handleTelegramRalphPause(chatId: number, loopId: string): Promise<void> {
  try {
    const loop = ralphLoopManager.getLoop(loopId);
    if (!loop) {
      await sendTelegramMessage(chatId, '❌ Loop não encontrado.');
      return;
    }

    const threadId = loop.threadId;
    await ralphLoopManager.pause(loopId);

    // Use topic-aware UI if this is a topic-based loop
    if (threadId) {
      const queueSize = ralphLoopManager.getQueueSize(loopId);
      await sendRalphTopicPaused(chatId, threadId, loopId, loop.currentIteration, loop.maxIterations, queueSize);

      // Send pause feedback to topic thread
      const topic = topicManager.getTopicByThreadId(loop.agentId, threadId);
      const topicName = topic?.name || 'Ralph Loop';
      await sendPauseFeedback(chatId, threadId, topicName);
    } else {
      await sendTelegramRalphPaused(chatId, loopId, loop.currentIteration, loop.maxIterations);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await sendTelegramMessage(chatId, `❌ Erro ao pausar: ${errorMessage}`);
  }
}

/**
 * Handle Ralph loop resume
 */
async function handleTelegramRalphResume(chatId: number, loopId: string): Promise<void> {
  try {
    const loop = ralphLoopManager.getLoop(loopId);
    if (!loop) {
      await sendTelegramMessage(chatId, '❌ Loop não encontrado.');
      return;
    }

    const threadId = loop.threadId;

    // Use topic-aware handler for topic-based loops
    if (threadId) {
      // Send resume feedback to topic thread
      const topic = topicManager.getTopicByThreadId(loop.agentId, threadId);
      const topicName = topic?.name || 'Ralph Loop';
      await sendResumeFeedback(chatId, threadId, topicName);

      await handleTopicRalphResume(chatId, threadId, loopId);
      return;
    }

    // Standard non-topic resume
    await sendTelegramMessage(chatId, '▶️ Retomando loop...');

    const startTime = Date.now() - (loop.currentIteration * 30000); // Estimate previous time
    const result = await ralphLoopManager.resume(loopId);
    const durationSeconds = Math.floor((Date.now() - startTime) / 1000);

    await sendTelegramRalphComplete(
      chatId,
      loopId,
      result.iterations,
      durationSeconds,
      result.status as 'completed' | 'cancelled' | 'blocked' | 'failed',
      result.error
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await sendTelegramMessage(chatId, `❌ Erro ao retomar: ${errorMessage}`);
  }
}

/**
 * Handle Ralph loop cancel/stop
 */
async function handleTelegramRalphStop(chatId: number, loopId: string): Promise<void> {
  try {
    const loop = ralphLoopManager.getLoop(loopId);
    if (!loop) {
      await sendTelegramMessage(chatId, '❌ Loop não encontrado.');
      return;
    }

    const threadId = loop.threadId;
    const agentId = loop.agentId;

    await ralphLoopManager.cancel(loopId);

    // Clear loop ID from topic and send topic-scoped feedback
    if (threadId) {
      const topic = topicManager.getTopicByThreadId(agentId, threadId);
      const topicName = topic?.name || 'Ralph Loop';
      if (topic) {
        topicManager.clearTopicLoopId(agentId, topic.id);
      }
      await sendRalphControlResponse(chatId, threadId, 'cancelled', loopId);

      // Send cancel feedback to topic thread
      await sendCancelFeedback(chatId, threadId, topicName);
    } else {
      await sendTelegramMessage(chatId, '🛑 Loop cancelado.');
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await sendTelegramMessage(chatId, `❌ Erro ao cancelar: ${errorMessage}`);
  }
}

/**
 * Handle Ralph control commands (/pausar, /retomar, /cancelar) in topic context
 * Sends feedback to the specific thread
 */
async function handleRalphControlCommand(
  chatId: number,
  threadId: number,
  loopId: string,
  command: 'pausar' | 'retomar' | 'cancelar'
): Promise<void> {
  try {
    const loop = ralphLoopManager.getLoop(loopId);
    if (!loop) {
      await sendRalphControlError(chatId, threadId, 'Loop não encontrado.');
      return;
    }

    // Get topic name for feedback messages
    const topic = topicManager.getTopicByThreadId(loop.agentId, threadId);
    const topicName = topic?.name || 'Ralph Loop';

    switch (command) {
      case 'pausar':
        if (loop.status !== 'running') {
          await sendRalphControlError(chatId, threadId, `Loop não está em execução (status: ${loop.status}).`);
          return;
        }
        await ralphLoopManager.pause(loopId);
        await sendRalphControlResponse(chatId, threadId, 'paused', loopId);

        // Show paused UI with queue info
        const queueSize = ralphLoopManager.getQueueSize(loopId);
        await sendRalphTopicPaused(chatId, threadId, loopId, loop.currentIteration, loop.maxIterations, queueSize);

        // Send pause feedback to topic thread
        await sendPauseFeedback(chatId, threadId, topicName);
        break;

      case 'retomar':
        if (loop.status !== 'paused') {
          await sendRalphControlError(chatId, threadId, `Loop não está pausado (status: ${loop.status}).`);
          return;
        }
        await sendRalphControlResponse(chatId, threadId, 'resumed', loopId);

        // Send resume feedback to topic thread
        await sendResumeFeedback(chatId, threadId, topicName);

        // Resume loop execution asynchronously (will continue in topic context)
        handleTopicRalphResume(chatId, threadId, loopId).catch((error) => {
          console.error('[ralph] Error resuming loop from topic command:', error);
        });
        break;

      case 'cancelar':
        if (['completed', 'failed', 'cancelled', 'blocked'].includes(loop.status)) {
          await sendRalphControlError(chatId, threadId, `Loop já finalizado (status: ${loop.status}).`);
          return;
        }
        await ralphLoopManager.cancel(loopId);
        await sendRalphControlResponse(chatId, threadId, 'cancelled', loopId);

        // Send cancel feedback to topic thread
        await sendCancelFeedback(chatId, threadId, topicName);
        break;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await sendRalphControlError(chatId, threadId, errorMessage);
  }
}

/**
 * Handle Ralph loop resume in topic context
 */
async function handleTopicRalphResume(
  chatId: number,
  threadId: number,
  loopId: string
): Promise<void> {
  try {
    const loop = ralphLoopManager.getLoop(loopId);
    if (!loop) {
      await sendRalphControlError(chatId, threadId, 'Loop não encontrado.');
      return;
    }

    const startTime = Date.now() - (loop.currentIteration * 30000); // Estimate previous time

    // Set up progress callback for this specific loop
    const originalCallback = ralphLoopManager['progressCallback'];
    ralphLoopManager.setProgressCallback(async (loopIdCallback, iteration, max, action) => {
      if (loopIdCallback === loopId) {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        await sendTelegramRalphProgress(chatId, loopId, iteration, max, action, elapsed, threadId);
      }
      if (originalCallback) {
        originalCallback(loopIdCallback, iteration, max, action);
      }
    });

    try {
      const result = await ralphLoopManager.resume(loopId);
      const durationSeconds = Math.floor((Date.now() - startTime) / 1000);

      // Get topic info for the completion UI
      const topic = topicManager.getTopicByThreadId(loop.agentId, threadId);
      const hasQueuedMessages = ralphLoopManager.hasQueuedMessages(loopId);

      if (topic) {
        // Update topic status
        topicManager.clearTopicLoopId(loop.agentId, topic.id);

        // Send topic-aware completion UI
        await sendRalphTopicComplete(
          chatId,
          threadId,
          loopId,
          topic.id,
          result.iterations,
          durationSeconds,
          result.status as 'completed' | 'cancelled' | 'blocked' | 'failed',
          hasQueuedMessages
        );

        // Process queued messages after completion
        await processQueuedRalphMessages(chatId, threadId, loopId, loop.agentId);
      } else {
        // Fallback to standard completion message
        await sendTelegramRalphComplete(
          chatId,
          loopId,
          result.iterations,
          durationSeconds,
          result.status as 'completed' | 'cancelled' | 'blocked' | 'failed',
          result.error,
          threadId
        );
      }
    } finally {
      ralphLoopManager.setProgressCallback(originalCallback);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await sendRalphControlError(chatId, threadId, errorMessage);
  }
}

/**
 * Process queued messages after Ralph loop completion
 * Dequeues all messages and sends them through the normal prompt pipeline
 */
async function processQueuedRalphMessages(
  chatId: number,
  threadId: number,
  loopId: string,
  agentId: string
): Promise<void> {
  const queuedMessages = ralphLoopManager.dequeueMessages(loopId);
  if (queuedMessages.length === 0) {
    return;
  }

  console.log(`[ralph] Processing ${queuedMessages.length} queued messages for loop ${loopId}`);

  const agent = agentManager.getAgent(agentId);
  if (!agent) {
    console.error(`[ralph] Agent ${agentId} not found for processing queued messages`);
    return;
  }

  // Get the topic's session ID for routing
  const topic = topicManager.getTopicByThreadId(agentId, threadId);
  const sessionId = topic?.sessionId || agent.mainSessionId;

  // Process each queued message in FIFO order
  for (const message of queuedMessages) {
    // Queue the message through the normal pipeline
    queueManager.enqueue({
      agentId,
      prompt: message.text,
      model: 'sonnet', // Default model for queued messages
      userId: message.userId,
      replyTo: chatId,
      threadId,
    });
  }
}

// =============================================================================
// Telegram Topic Command Handler
// =============================================================================

/**
 * Handle topic management commands (/ralph, /worktree, /sessao, /topicos)
 */
async function handleTopicCommand(
  chatId: number,
  userId: string,
  command: 'ralph' | 'worktree' | 'sessao' | 'topicos',
  args: string,
  agentId: string | undefined,
  isForum: boolean
): Promise<void> {
  // Check if group has topics enabled
  if (!isForum) {
    await sendTopicsNotEnabledError(chatId);
    return;
  }

  // Check if agent is linked to this group
  if (!agentId) {
    await sendTopicNoAgentError(chatId);
    return;
  }

  const agent = agentManager.getAgent(agentId);
  if (!agent) {
    await sendTelegramMessage(chatId, '❌ Agente não encontrado.');
    return;
  }

  switch (command) {
    case 'ralph':
      await handleTopicRalphCommand(chatId, userId, agentId, args.trim());
      break;

    case 'worktree':
      await handleTopicWorktreeCommand(chatId, userId, agentId, args.trim());
      break;

    case 'sessao':
      await handleTopicSessaoCommand(chatId, userId, agentId, args.trim());
      break;

    case 'topicos':
      await handleTopicosCommand(chatId, agentId);
      break;
  }
}

/**
 * Handle /ralph command - start Ralph topic creation flow
 */
async function handleTopicRalphCommand(
  chatId: number,
  userId: string,
  agentId: string,
  task: string
): Promise<void> {
  if (task) {
    // Task provided inline - start with task, ask for iterations
    userContextManager.startTopicRalphFlow(userId, agentId, chatId, task);
    await sendTopicRalphIterationsPrompt(chatId, task);
  } else {
    // No task provided - ask for task first
    userContextManager.startTopicRalphFlow(userId, agentId, chatId);
    await sendTopicRalphTaskPrompt(chatId);
  }
}

/**
 * Handle /worktree command - start worktree topic creation flow
 */
async function handleTopicWorktreeCommand(
  chatId: number,
  userId: string,
  agentId: string,
  name: string
): Promise<void> {
  if (name) {
    // Name provided inline - validate and create
    const error = validateTopicName(name);
    if (error) {
      await sendTelegramMessage(chatId, `❌ ${error}`);
      return;
    }
    userContextManager.startTopicWorktreeFlow(userId, agentId, chatId, name);
    await createTopicAndNotify(chatId, userId, agentId, name, 'worktree');
  } else {
    // No name provided - ask for name
    userContextManager.startTopicWorktreeFlow(userId, agentId, chatId);
    await sendTopicNamePrompt(chatId, 'worktree');
  }
}

/**
 * Handle /sessao command - start session topic creation flow
 */
async function handleTopicSessaoCommand(
  chatId: number,
  userId: string,
  agentId: string,
  name: string
): Promise<void> {
  if (name) {
    // Name provided inline - validate and create
    const error = validateTopicName(name);
    if (error) {
      await sendTelegramMessage(chatId, `❌ ${error}`);
      return;
    }
    userContextManager.startTopicSessaoFlow(userId, agentId, chatId, name);
    await createTopicAndNotify(chatId, userId, agentId, name, 'session');
  } else {
    // No name provided - ask for name
    userContextManager.startTopicSessaoFlow(userId, agentId, chatId);
    await sendTopicNamePrompt(chatId, 'sessao');
  }
}

/**
 * Handle /topicos command - list all topics for the agent
 */
async function handleTopicosCommand(chatId: number, agentId: string): Promise<void> {
  const agent = agentManager.getAgent(agentId);
  const agentName = agent?.name || 'Agente';
  const topics = topicManager.listTopics(agentId);

  // Build enhanced topic list items with Ralph status and progress
  const topicItems: TopicListItem[] = topics.map(topic => {
    let currentIteration: number | undefined;
    let maxIterations: number | undefined;
    let ralphStatus: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'blocked' | undefined;

    if (topic.type === 'ralph' && topic.loopId) {
      const loop = ralphLoopManager.getLoop(topic.loopId);
      if (loop) {
        currentIteration = loop.currentIteration;
        maxIterations = loop.maxIterations;
        ralphStatus = loop.status;
      }
    }

    // For non-Ralph topics, use stored messageCount
    const messageCount = topic.type !== 'ralph' ? topic.messageCount : undefined;

    return {
      id: topic.id,
      telegramTopicId: topic.telegramTopicId,
      emoji: topic.emoji,
      name: topic.name,
      type: topic.type,
      status: topic.status,
      loopId: topic.loopId,
      lastActivity: topic.lastActivity,
      currentIteration,
      maxIterations,
      ralphStatus,
      messageCount,
    };
  });

  await sendEnhancedTopicsList(chatId, topicItems, agentName);
}

/**
 * Handle /workspace command in a specific topic
 */
async function handleTopicWorkspace(
  chatId: number,
  threadId: number,
  userId: string,
  agentId: string,
  path?: string
): Promise<void> {
  const agent = agentManager.getAgent(agentId);
  if (!agent) {
    await sendTelegramMessage(chatId, '❌ Agente não encontrado.', undefined, threadId);
    return;
  }

  const topic = topicManager.getTopicByThreadId(agentId, threadId);
  if (!topic) {
    await sendTelegramMessage(chatId, '❌ Tópico não encontrado.', undefined, threadId);
    return;
  }

  if (path) {
    // Validate existence and ensure it's a directory (not a file)
    let isDirectory = false;
    try {
      isDirectory = statSync(path).isDirectory();
    } catch {
      // path does not exist
    }
    if (!isDirectory) {
      // Flow 4: Workspace not found or not a directory - show options
      const buttons = [
        [{ text: '📁 Usar workspace do agente', callback_data: `ws_use_agent_${topic.id}_${threadId}` }],
        [{ text: '🔄 Tentar outro caminho', callback_data: `ws_retry_${topic.id}_${threadId}` }],
      ];

      if (agent.workspace) {
        await sendTelegramMessage(chatId,
          `❌ Caminho não encontrado: \`${path}\`\n\n` +
          `O workspace do agente é: \`${agent.workspace}\``,
          undefined,
          threadId
        );
      } else {
        await sendTelegramMessage(chatId,
          `❌ Caminho não encontrado: \`${path}\``,
          undefined,
          threadId
        );
      }

      await sendTelegramButtons(chatId, 'O que deseja fazer?', buttons, threadId);
      return;
    }

    // Update workspace
    topicManager.updateTopicWorkspace(agentId, topic.id, path);

    // Add to recent workspaces
    persistenceService.addRecentWorkspace(userId, path);

    await sendTelegramMessage(chatId,
      `✅ Workspace atualizado\n📁 \`${path}\``,
      undefined,
      threadId
    );

    // Check if there's a paused task waiting for workspace reconfiguration
    const wsContext = userContextManager.getContext(userId);
    if (wsContext?.currentFlow === 'workspace_not_found' && wsContext.flowData?.topicId === topic.id) {
      const { pausedPrompt, pausedModel, pausedImages } = wsContext.flowData;
      if (pausedPrompt && pausedModel) {
        await sendTelegramMessage(chatId, '🔄 Retomando processamento do prompt...', undefined, threadId);
        queueManager.enqueue({
          agentId,
          prompt: pausedPrompt as string,
          model: pausedModel as 'haiku' | 'sonnet' | 'opus',
          userId,
          replyTo: chatId,
          threadId,
          images: pausedImages as Array<{data: string; mimeType: string}> | undefined,
        });
      }
      userContextManager.clearContext(userId);
    }
  } else {
    // No argument: show interactive workspace selector
    await showWorkspaceSelector(chatId, threadId, userId, agentId, topic.id);
  }
}

/**
 * Show hybrid workspace selector with agent workspace, recents, sandbox, and custom options.
 * Uses short index-based callbacks (wsnav:*) with state stored in UserContext.
 */
async function showWorkspaceSelector(
  chatId: number,
  threadId: number | undefined,
  userId: string,
  agentId: string,
  topicId?: string
): Promise<void> {
  const agent = agentManager.getAgent(agentId);
  const topic = topicId ? topicManager.getTopic(agentId, topicId) : undefined;

  // Get current workspace info
  const currentWorkspace = topic?.workspace || agent?.workspace || '(sandbox padrão)';
  const source = topic?.workspace ? 'tópico' : agent?.workspace ? 'agente' : 'sandbox';

  // Get recent workspaces
  const recents = persistenceService.getRecentWorkspaces(userId).slice(0, 3);

  // Initialize navigation state (preserve creation context if already set)
  const baseOptions = recents.slice();
  const existingNav = userContextManager.getDirectoryNavigationState(userId);
  if (existingNav?.creationContext) {
    existingNav.baseOptions = baseOptions;
  } else {
    userContextManager.startDirectoryNavigation(userId, agentId, topicId || '', '', baseOptions);
  }

  const rows: Array<Array<{ text: string; callback_data: string }>> = [];

  // Agent workspace (if exists)
  if (agent?.workspace) {
    const shortPath = agent.workspace.length > 30
      ? '...' + agent.workspace.slice(-27)
      : agent.workspace;
    rows.push([
      { text: `🏠 Agente: ${shortPath}`, callback_data: 'wsnav:agent' },
    ]);
  }

  // Sandbox
  rows.push([
    { text: '🧪 Sandbox', callback_data: 'wsnav:sandbox' },
  ]);

  // Recent workspaces (up to 3)
  for (let i = 0; i < recents.length; i++) {
    const shortPath = recents[i].length > 30
      ? '...' + recents[i].slice(-27)
      : recents[i];
    rows.push([
      { text: `📂 ${shortPath}`, callback_data: `wsnav:rec:${i}` },
    ]);
  }

  // Custom path and cancel
  rows.push([
    { text: '✏️ Digitar caminho base', callback_data: 'wsnav:custom' },
  ]);
  rows.push([
    { text: '❌ Cancelar', callback_data: 'wsnav:cancel' },
  ]);

  const header = `📁 *Workspace atual:* \`${currentWorkspace}\` (${source})\n\n` +
    '*Selecione o workspace para este tópico:*';
  await sendTelegramButtons(chatId, header, rows, threadId);
}

/**
 * Show directory tree browser using index-based callbacks (wsnav:*).
 * State is maintained in UserContext.directoryNavigationState.
 */
async function showWorkspaceDirectoryBrowser(
  chatId: number,
  threadId: number | undefined,
  userId: string
): Promise<void> {
  const navState = userContextManager.getDirectoryNavigationState(userId);
  if (!navState) {
    await sendTelegramMessage(chatId,
      '❌ Estado de navegação perdido. Use /workspace para recomeçar.',
      undefined,
      threadId
    );
    return;
  }

  const listing = listDirectories(navState.currentPath, {
    filter: navState.filter,
    limit: 12,
  });

  // Store visible directories for index mapping
  userContextManager.updateVisibleDirectories(userId, listing.directories);

  const rows: Array<Array<{ text: string; callback_data: string }>> = [];

  // Up button (if not at root)
  if (listing.parentPath) {
    rows.push([
      { text: '⬆️ Subir', callback_data: 'wsnav:up' },
      { text: '✅ Selecionar esta pasta', callback_data: 'wsnav:select' },
    ]);
  } else {
    rows.push([
      { text: '✅ Selecionar esta pasta', callback_data: 'wsnav:select' },
    ]);
  }

  // Filter button
  if (navState.filter) {
    rows.push([
      { text: '🗑️ Limpar filtro', callback_data: 'wsnav:clearfilter' },
    ]);
  } else {
    rows.push([
      { text: '🔎 Filtrar por nome', callback_data: 'wsnav:filter' },
    ]);
  }

  // Subdirectory buttons (2 per row)
  for (let i = 0; i < listing.directories.length; i += 2) {
    const row: Array<{ text: string; callback_data: string }> = [
      { text: `📁 ${listing.directories[i]}`, callback_data: `wsnav:into:${i}` },
    ];
    if (listing.directories[i + 1]) {
      row.push({ text: `📁 ${listing.directories[i + 1]}`, callback_data: `wsnav:into:${i + 1}` });
    }
    rows.push(row);
  }

  // Cancel button
  rows.push([
    { text: '❌ Cancelar', callback_data: 'wsnav:cancel' },
  ]);

  // Build header
  let header = `📁 \`${navState.currentPath}\``;
  if (navState.filter) {
    header += `\n🔍 Filtro: "${navState.filter}"`;
  }
  if (listing.truncated) {
    header += `\n_(Mostrando 12 de ${listing.totalFound} pastas)_`;
  }
  if (listing.directories.length === 0) {
    header += '\n\n_Nenhuma subpasta encontrada._';
  }

  await sendTelegramButtons(chatId, header, rows, threadId);
}

/**
 * Validate topic name
 */
function validateTopicName(name: string): string | null {
  if (!name || name.trim().length === 0) {
    return 'Nome do tópico não pode ser vazio.';
  }
  if (name.length > 100) {
    return TOPIC_ERRORS.TOPIC_NAME_TOO_LONG;
  }
  // Check for dangerous characters
  const dangerousPattern = /[<>{}|\\^`]/;
  if (dangerousPattern.test(name)) {
    return TOPIC_ERRORS.TOPIC_NAME_INVALID;
  }
  return null;
}

/**
 * Finish topic creation after optional workspace selection.
 * Reads flow data from UserContext and delegates to the appropriate creation function.
 */
async function finishTopicCreation(chatId: number, userId: string): Promise<void> {
  const context = userContextManager.getContext(userId);
  if (!context?.flowData?.agentId) return;

  const agentId = context.flowData.agentId as string;
  const workspace = context.flowData.topicWorkspace as string | undefined;

  if (context.currentFlow === 'topic_ralph') {
    const task = context.flowData.topicTask as string;
    const maxIterations = context.flowData.topicMaxIterations as number;
    if (task && maxIterations) {
      await createRalphTopicAndStart(chatId, userId, agentId, task, maxIterations, workspace);
    }
  } else if (context.currentFlow === 'topic_worktree' || context.currentFlow === 'topic_sessao') {
    const name = context.flowData.topicName as string;
    const topicType = context.currentFlow === 'topic_worktree' ? 'worktree' : 'session';
    if (name) {
      await createTopicAndNotify(chatId, userId, agentId, name, topicType, workspace);
    }
  }
}

/**
 * Create a topic and send notifications to both General and the new topic
 */
async function createTopicAndNotify(
  chatId: number,
  userId: string,
  agentId: string,
  name: string,
  type: 'worktree' | 'session',
  workspace?: string
): Promise<void> {
  try {
    // Create the topic via TopicManager
    const result = await topicManager.createTopic({
      agentId,
      chatId,
      name,
      type,
      workspace,
    });

    if (!result.success || !result.topic) {
      await sendTelegramMessage(chatId, `❌ Erro ao criar tópico: ${result.error || 'Falha desconhecida'}`);
      userContextManager.clearContext(userId);
      return;
    }

    const topic = result.topic;

    // Send notification to General topic
    await sendTopicCreatedInGeneral(chatId, name, type, topic.telegramTopicId);

    // Send welcome message in the new topic (with workspace button)
    await sendTopicWelcome(chatId, topic.telegramTopicId, name, type, undefined, topic.id);

    // Clear the flow
    userContextManager.clearContext(userId);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await sendTelegramMessage(chatId, `❌ Erro ao criar tópico: ${errorMessage}`);
    userContextManager.clearContext(userId);
  }
}

/**
 * Create a Ralph topic and start the loop
 */
async function createRalphTopicAndStart(
  chatId: number,
  userId: string,
  agentId: string,
  task: string,
  maxIterations: number,
  workspace?: string
): Promise<void> {
  try {
    // Generate topic name from task (first 30 chars)
    const topicName = task.length > 30 ? task.slice(0, 27) + '...' : task;

    // Create the topic via TopicManager
    const result = await topicManager.createTopic({
      agentId,
      chatId,
      name: topicName,
      type: 'ralph',
      workspace,
    });

    if (!result.success || !result.topic) {
      await sendTelegramMessage(chatId, `❌ Erro ao criar tópico Ralph: ${result.error || 'Falha desconhecida'}`);
      userContextManager.clearContext(userId);
      return;
    }

    const topic = result.topic;

    // Create and start the Ralph loop
    const loopId = ralphLoopManager.start(agentId, task, maxIterations, 'sonnet');

    // Link loop to topic
    topicManager.setTopicLoopId(agentId, topic.id, loopId);

    // Send notification to General topic
    await sendTopicCreatedInGeneral(chatId, topicName, 'ralph', topic.telegramTopicId);

    // Send welcome message in the new topic with task
    await sendTopicWelcome(chatId, topic.telegramTopicId, topicName, 'ralph', task, topic.id);

    // Clear the flow
    userContextManager.clearContext(userId);

    // Execute the loop (async - will send progress updates to the topic)
    const startTime = Date.now();
    const threadId = topic.telegramTopicId;

    // Set up progress callback for this specific loop
    const originalCallback = ralphLoopManager['progressCallback'];
    ralphLoopManager.setProgressCallback(async (loopIdCallback, iteration, max, action) => {
      if (loopIdCallback === loopId) {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        await sendTelegramRalphProgress(chatId, loopId, iteration, max, action, elapsed, threadId);
      }
      // Call original callback too
      if (originalCallback) {
        originalCallback(loopIdCallback, iteration, max, action);
      }
    });

    try {
      // Execute and handle completion
      const execResult = await ralphLoopManager.execute(loopId);

      // Update topic status if loop completed (all terminal statuses)
      const terminalStatuses = ['completed', 'cancelled', 'failed', 'blocked', 'interrupted'];
      if (terminalStatuses.includes(execResult.status)) {
        topicManager.clearTopicLoopId(agentId, topic.id);
      }

      // Send completion message in the topic with action buttons
      const durationSeconds = Math.floor((Date.now() - startTime) / 1000);
      const hasQueuedMessages = ralphLoopManager.hasQueuedMessages(loopId);

      await sendRalphTopicComplete(
        chatId,
        threadId,
        loopId,
        topic.id,
        execResult.iterations,
        durationSeconds,
        execResult.status as 'completed' | 'cancelled' | 'blocked' | 'failed',
        hasQueuedMessages
      );

      // Process queued messages after completion
      await processQueuedRalphMessages(chatId, threadId, loopId, agentId);
    } finally {
      // Restore original callback even if execute() throws
      ralphLoopManager.setProgressCallback(originalCallback);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await sendTelegramMessage(chatId, `❌ Erro ao criar tópico Ralph: ${errorMessage}`);
    userContextManager.clearContext(userId);
  }
}

// =============================================================================
// Telegram Bash Command Handler
// =============================================================================

/**
 * Handle bash command for bash agents in Telegram groups
 */
async function handleTelegramBashCommand(
  chatId: number,
  userId: string,
  agentId: string,
  command: string
): Promise<void> {
  const agent = agentManager.getAgent(agentId);
  if (!agent) {
    await sendTelegramMessage(chatId, '❌ Agente não encontrado.');
    return;
  }

  await sendTelegramMessage(chatId, `🔧 Executando: \`${command.slice(0, 50)}${command.length > 50 ? '...' : ''}\``);

  try {
    // Execute the bash command
    const result = await executeCommand(command, {
      timeout: DEFAULTS.BASH_TIMEOUT,
      maxOutput: DEFAULTS.BASH_MAX_OUTPUT,
      cwd: agent.workspace,
    });

    // Format the result
    const formattedOutput = formatBashResult(result);

    // Check if output needs truncation
    if (formattedOutput.length > DEFAULTS.BASH_TRUNCATE_AT) {
      // Send truncated version
      const truncated = formattedOutput.slice(0, DEFAULTS.BASH_TRUNCATE_AT);
      await sendTelegramMessage(chatId,
        `\`\`\`\n${truncated}\n\`\`\`\n\n` +
        `⚠️ _Saída truncada. Arquivo completo enviado abaixo._`
      );

      // Send full output as document
      const fullOutputFilename = getFullOutputFilename(command);
      await sendTelegramDocument(
        chatId,
        Buffer.from(result.output, 'utf-8'),
        fullOutputFilename,
        `Saída completa de: ${command.slice(0, 30)}...`
      );
    } else {
      // Send normal output
      const statusIcon = result.exitCode === 0 ? '✅' : '❌';
      await sendTelegramMessage(chatId,
        `${statusIcon} \`exit ${result.exitCode}\`\n\n` +
        `\`\`\`\n${formattedOutput || '(sem saída)'}\n\`\`\``
      );
    }

    // Update agent status
    agentManager.updateAgentStatus(agentId, 'idle', `Executou: ${command.slice(0, 30)}...`);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await sendTelegramMessage(chatId, `❌ Erro: ${errorMessage}`);
    agentManager.updateAgentStatus(agentId, 'error', errorMessage);
  }
}

// =============================================================================
// Telegram Media Handlers
// =============================================================================

/**
 * Handle image message in Telegram group
 */
async function handleTelegramImageMessage(
  chatId: number,
  userId: string,
  photo: any[],
  caption?: string
): Promise<void> {
  // Get the largest photo (last in array)
  const largestPhoto = photo[photo.length - 1];
  const fileId = largestPhoto.file_id;

  // Find the agent linked to this group
  const agent = agentManager.getAgentByTelegramChatId(chatId);
  if (!agent) {
    await sendTelegramMessage(chatId, '⚠️ Grupo não vinculado a um agente.');
    return;
  }

  // If there's a caption, use it as the prompt
  if (caption && caption.trim()) {
    await processTelegramImageWithPrompt(chatId, userId, agent.id, fileId, caption.trim());
    return;
  }

  // No caption - show options
  await sendTelegramImageOptions(chatId, fileId);

  // Store the image file ID in user context for later
  const context = userContextManager.getContext(userId) || { userId };
  context.currentFlow = 'image_action';
  context.flowData = {
    ...context.flowData,
    pendingImageFileId: fileId,
    agentId: agent.id,
    telegramChatId: chatId,
  };
  userContextManager.updateContext(userId, context);
}

/**
 * Process image with a given prompt
 */
async function processTelegramImageWithPrompt(
  chatId: number,
  userId: string,
  agentId: string,
  fileId: string,
  prompt: string
): Promise<void> {
  await sendTelegramImageProcessing(chatId);

  try {
    // Download the image
    const fileData = await downloadTelegramFile(fileId);
    if (!fileData) {
      await sendTelegramMessage(chatId, '❌ Erro ao baixar imagem.');
      return;
    }

    // Convert to base64
    const base64Data = fileData.buffer.toString('base64');

    // Validate MIME type for Claude
    const validMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
    type ValidMimeType = (typeof validMimeTypes)[number];
    const validMimeType: ValidMimeType = validMimeTypes.includes(fileData.mimeType as ValidMimeType)
      ? (fileData.mimeType as ValidMimeType)
      : 'image/jpeg';

    const images = [{ data: base64Data, mimeType: validMimeType }];

    // Queue the prompt with image
    queueManager.enqueue({
      agentId,
      prompt,
      model: 'sonnet', // Default model for image analysis
      userId,
      replyTo: chatId,
      images,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await sendTelegramMessage(chatId, `❌ Erro: ${errorMessage}`);
  }
}

/**
 * Handle document message in Telegram group
 */
async function handleTelegramDocumentMessage(
  chatId: number,
  userId: string,
  document: any,
  caption?: string
): Promise<void> {
  const fileId = document.file_id;
  const filename = document.file_name || 'documento';

  // Find the agent linked to this group
  const agent = agentManager.getAgentByTelegramChatId(chatId);
  if (!agent) {
    await sendTelegramMessage(chatId, '⚠️ Grupo não vinculado a um agente.');
    return;
  }

  // If there's a caption, use it as the prompt
  if (caption && caption.trim()) {
    await processTelegramDocumentWithPrompt(chatId, userId, agent.id, fileId, filename, caption.trim());
    return;
  }

  // No caption - show options
  await sendTelegramDocumentOptions(chatId, fileId, filename);

  // Store the document info in user context for later
  const context = userContextManager.getContext(userId) || { userId };
  context.currentFlow = 'document_action';
  context.flowData = {
    ...context.flowData,
    pendingDocumentFileId: fileId,
    pendingDocumentFilename: filename,
    agentId: agent.id,
    telegramChatId: chatId,
  };
  userContextManager.updateContext(userId, context);
}

/**
 * Process document with a given prompt/action
 */
async function processTelegramDocumentWithPrompt(
  chatId: number,
  userId: string,
  agentId: string,
  fileId: string,
  filename: string,
  prompt: string
): Promise<void> {
  await sendTelegramDocumentProcessing(chatId, filename);

  try {
    // Download the document
    const fileData = await downloadTelegramFile(fileId);
    if (!fileData) {
      await sendTelegramMessage(chatId, '❌ Erro ao baixar documento.');
      return;
    }

    // Convert content to text (for text-based files)
    const textMimeTypes = [
      'text/plain', 'text/markdown', 'text/html', 'text/css',
      'text/javascript', 'text/typescript', 'text/x-python',
      'application/json', 'text/csv',
    ];

    let fileContent: string;
    if (textMimeTypes.includes(fileData.mimeType)) {
      fileContent = fileData.buffer.toString('utf-8');
    } else {
      // For binary files, include base64 reference
      fileContent = `[Arquivo binário: ${filename} (${fileData.buffer.length} bytes)]`;
    }

    // Build prompt with file content
    const fullPrompt = `Arquivo: ${filename}\n\nConteúdo:\n\`\`\`\n${fileContent.slice(0, 50000)}\n\`\`\`\n\nInstrução: ${prompt}`;

    // Queue the prompt
    queueManager.enqueue({
      agentId,
      prompt: fullPrompt,
      model: 'sonnet', // Default model for document analysis
      userId,
      replyTo: chatId,
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await sendTelegramMessage(chatId, `❌ Erro: ${errorMessage}`);
  }
}

/**
 * Handle /cancelar command in groups
 * Cancels the onboarding flow and resets the pinned message to initial state
 */
async function handleGroupCancelarCommand(chatId: number, userId: string, telegramUserId: number): Promise<void> {
  // Check if there's an active onboarding for this group
  if (!groupOnboardingManager.hasActiveOnboarding(chatId)) {
    await sendTelegramMessage(chatId, '⚠️ Nenhum processo de configuração em andamento.');
    return;
  }

  // Validate lock - only the user who started onboarding can cancel
  if (!groupOnboardingManager.isLockedByUser(chatId, telegramUserId)) {
    // Different user - silently ignore (don't show error to avoid confusion in group)
    return;
  }

  // Get the pinned message ID to edit it back
  const pinnedMessageId = groupOnboardingManager.getPinnedMessageId(chatId);

  // Cancel the onboarding state
  groupOnboardingManager.cancelOnboarding(chatId, telegramUserId);

  // Determine which buttons to show based on user's existing agents
  const existingAgents = agentManager.listAgents(userId);
  const hasExistingAgents = existingAgents.length > 0;

  // Edit pinned message back to initial state
  if (pinnedMessageId) {
    let messageText: string;
    let buttons: Array<{ text: string; callback_data: string }[]>;

    if (!hasExistingAgents) {
      // First-time user: single [Criar agora] button
      messageText = '🎉 *Seu primeiro agente!*\n\n' +
        'Vamos criar um agente para este grupo.';
      buttons = [
        [{ text: '✨ Criar agora', callback_data: `onboard_create_${telegramUserId}` }],
      ];
    } else {
      // Existing user: [Criar um] [Vincular existente] buttons
      messageText = '👋 *Esse grupo não tem agente ainda*\n\n' +
        'Você pode criar um novo ou vincular um existente.';
      buttons = [
        [
          { text: '✨ Criar um', callback_data: `onboard_create_${telegramUserId}` },
          { text: '🔗 Vincular existente', callback_data: `onboard_link_${telegramUserId}` },
        ],
      ];
    }

    await editTelegramMessage(chatId, pinnedMessageId, messageText, buttons);
  }

  // Send confirmation
  await sendTelegramMessage(chatId, '❌ *Cancelado*');
}

/**
 * Handle Telegram commands
 */
async function handleTelegramCommand(chatId: number, userId: string, text: string): Promise<void> {
  const parts = text.split(' ');
  const command = parts[0].toLowerCase();
  const args = parts.slice(1).join(' ').trim();

  switch (command) {
    case '/start':
      // Check if there's a token for account linking
      if (args) {
        const tokenResult = telegramTokenManager.validateToken(args);
        if (tokenResult) {
          // Valid token - link accounts
          const linkedUserId = tokenResult.userId;
          const linkedUsername = tokenResult.username;

          // Delete the used token
          telegramTokenManager.deleteToken(args);

          // Update user preferences with telegram chat ID and mark onboarding complete
          // Merge with existing preferences to preserve fields like sandboxAutoCleanup
          const existingPrefs = persistenceService.loadUserPreferences(linkedUserId);
          const prefs: UserPreferences = {
            ...existingPrefs,
            userId: linkedUserId,
            mode: 'dojo',
            telegramUsername: linkedUsername,
            telegramChatId: chatId,
            onboardingComplete: true,
          };
          persistenceService.saveUserPreferences(prefs);

          console.log(`Linked Telegram account: ${linkedUsername} (chat ${chatId}) to user ${linkedUserId}`);

          // Send welcome message
          await sendTelegramMessage(chatId,
            `*Conta vinculada com sucesso!* 🎉\n\n` +
            `Bem-vindo ao Dojo, @${linkedUsername}!\n\n` +
            `*Comandos:*\n` +
            `/criar - Criar novo agente\n` +
            `/agentes - Listar agentes\n` +
            `/status - Status de todos\n` +
            `/link - Vincular grupo a agente\n` +
            `/help - Ajuda\n\n` +
            `Use /criar para criar seu primeiro agente.`
          );
          return;
        } else {
          // Invalid or expired token
          await sendTelegramMessage(chatId,
            '❌ *Token inválido ou expirado*\n\n' +
            'Solicite um novo link no WhatsApp.'
          );
          return;
        }
      }
      // No token - show command list for existing users
      await sendTelegramCommandList(chatId);
      break;

    case '/criar':
    case '/new':
      userContextManager.startCreateAgentFlow(userId);
      await sendTelegramAgentNamePrompt(chatId);
      break;

    case '/agentes':
    case '/list':
      const agents = agentManager.listAgents(userId)
        .filter(a => a.name !== 'Ronin') // Exclude Ronin from Telegram list
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

    case '/link':
      await handleTelegramLinkCommand(chatId, userId);
      break;

    default:
      await sendTelegramMessage(chatId, 'Comando nao reconhecido. Use /help.');
  }
}

/**
 * Handle Telegram flow input (agent creation steps and edit flows)
 */
async function handleTelegramFlowInput(chatId: number, userId: string, text: string): Promise<void> {
  const flow = userContextManager.getCurrentFlow(userId);
  const state = userContextManager.getCurrentFlowState(userId);

  if (flow === 'create_agent' && state === 'awaiting_name') {
    userContextManager.setAgentName(userId, text.trim());
    await sendTelegramAgentTypeSelector(chatId);
  } else if (flow === 'create_agent' && state === 'awaiting_workspace') {
    // Custom workspace path input
    const { existsSync } = await import('fs');
    const workspacePath = text.trim();

    if (existsSync(workspacePath)) {
      userContextManager.setAgentWorkspace(userId, workspacePath);
      await sendTelegramModelModeSelector(chatId);
    } else {
      // Path doesn't exist - suggest alternatives
      await sendTelegramButtons(chatId,
        `⚠️ *Caminho não encontrado*\n\n` +
        `\`${workspacePath}\` não existe.\n\n` +
        `Escolha uma alternativa:`,
        [
          [
            { text: '🏠 Home', callback_data: `workspace_${process.env.HOME || '/home'}` },
            { text: '📂 Desktop', callback_data: `workspace_${process.env.HOME || '/home'}/Desktop` },
          ],
          [
            { text: '🧪 Sandbox', callback_data: 'workspace_sandbox' },
            { text: '⏭️ Pular', callback_data: 'workspace_skip' },
          ],
          [
            { text: '✏️ Tentar novamente', callback_data: 'workspace_custom' },
          ],
        ]
      );
    }
  }
  // Handle edit name flow
  else if (userContextManager.isAwaitingEditName(userId)) {
    const flowData = userContextManager.getEditNameData(userId);
    if (flowData?.agentId) {
      const agent = agentManager.getAgent(flowData.agentId);
      if (agent) {
        const newName = text.trim();

        // Validate name length
        if (newName.length > 50) {
          await sendTelegramMessage(chatId, '❌ Nome muito longo. Máximo 50 caracteres.');
          return;
        }

        if (newName.length === 0) {
          await sendTelegramMessage(chatId, '❌ Nome não pode ser vazio.');
          return;
        }

        try {
          agentManager.updateAgentName(flowData.agentId, newName);

          // Update Telegram group title if linked
          if (agent.telegramChatId) {
            const newTitle = `${agent.emoji || '🤖'} ${newName}`;
            await updateTelegramGroupTitle(agent.telegramChatId, newTitle);
          }

          userContextManager.clearContext(userId);
          await sendTelegramMessage(chatId, `✅ Nome atualizado para *${newName}*`);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          await sendTelegramMessage(chatId, `❌ Erro: ${errorMessage}`);
        }
      }
    }
  }
  // Handle custom iterations input for Ralph loop
  else if (flow === 'ralph_loop' && state === 'awaiting_custom_iterations') {
    const iterations = parseInt(text.trim(), 10);

    if (isNaN(iterations) || iterations < 1 || iterations > 100) {
      await sendTelegramMessage(chatId, '❌ Número inválido. Envie um valor entre 1 e 100.');
      return;
    }

    const context = userContextManager.getContext(userId);
    if (context?.flowData) {
      context.flowData.ralphMaxIterations = iterations;
      context.flowState = 'awaiting_confirmation';
      userContextManager.updateContext(userId, context);

      // Show updated confirmation
      const agent = agentManager.getAgent(context.flowData.agentId as string);
      if (agent && context.flowData.ralphTask) {
        await sendTelegramRalphConfirmation(
          chatId,
          agent.name,
          context.flowData.ralphTask as string,
          iterations
        );
      }
    }
  }
  // =============================================================================
  // Directory Navigation Text Input Handlers
  // =============================================================================
  else if (userContextManager.hasDirectoryNavigation(userId)) {
    const navState = userContextManager.getDirectoryNavigationState(userId)!;
    const agent = navState.targetAgentId ? agentManager.getAgent(navState.targetAgentId) : undefined;
    const topic = navState.targetTopicId && agent ? topicManager.getTopic(agent.id, navState.targetTopicId) : undefined;
    const navThreadId = topic?.telegramTopicId;

    if (navState.awaitingInput === 'custom_base_path') {
      const basePath = text.trim();
      let isDirectory = false;
      try {
        isDirectory = statSync(basePath).isDirectory();
      } catch {
        // not found
      }
      if (!isDirectory) {
        await sendTelegramMessage(chatId,
          `❌ Caminho não encontrado: \`${basePath}\`\n\nEnvie um caminho válido.`,
          undefined,
          navThreadId
        );
        return;
      }
      userContextManager.updateDirectoryPath(userId, basePath);
      userContextManager.setAwaitingDirectoryInput(userId, undefined as any);
      // Clear the awaitingInput manually
      const updatedState = userContextManager.getDirectoryNavigationState(userId);
      if (updatedState) {
        updatedState.awaitingInput = undefined;
      }
      await showWorkspaceDirectoryBrowser(chatId, navThreadId, userId);
      return;
    }
    else if (navState.awaitingInput === 'filter') {
      const filterText = text.trim();
      if (!filterText) {
        await sendTelegramMessage(chatId, '❌ O filtro não pode ser vazio.', undefined, navThreadId);
        return;
      }
      userContextManager.setDirectoryFilter(userId, filterText);
      await showWorkspaceDirectoryBrowser(chatId, navThreadId, userId);
      return;
    }
    // If not awaiting input, fall through to other handlers
  }
  // =============================================================================
  // Topic Flow Handlers
  // =============================================================================
  // Handle topic Ralph task input
  else if (userContextManager.isAwaitingTopicTask(userId)) {
    const task = text.trim();
    if (!task) {
      await sendTelegramMessage(chatId, '❌ A tarefa não pode ser vazia.');
      return;
    }

    userContextManager.setTopicTask(userId, task);
    await sendTopicRalphIterationsPrompt(chatId, task);
  }
  // Handle topic Ralph custom iterations input
  else if (userContextManager.isAwaitingTopicIterations(userId)) {
    const iterations = parseInt(text.trim(), 10);

    if (isNaN(iterations) || iterations < 1 || iterations > 100) {
      await sendTelegramMessage(chatId, '❌ Número inválido. Envie um valor entre 1 e 100.');
      return;
    }

    userContextManager.setTopicMaxIterations(userId, iterations);
    // Ask about workspace before creating
    userContextManager.setAwaitingTopicWorkspace(userId);
    await sendTopicWorkspaceQuestion(chatId);
  }
  // Handle topic name input for worktree/sessao
  else if (userContextManager.isAwaitingTopicName(userId)) {
    const name = text.trim();
    const error = validateTopicName(name);
    if (error) {
      await sendTelegramMessage(chatId, `❌ ${error}`);
      return;
    }

    userContextManager.setTopicName(userId, name);
    // Ask about workspace before creating
    userContextManager.setAwaitingTopicWorkspace(userId);
    await sendTopicWorkspaceQuestion(chatId);
  }
  // Handle custom workspace path during topic creation
  else if (userContextManager.isAwaitingTopicWorkspace(userId)) {
    const path = text.trim();
    let isDirectory = false;
    try {
      isDirectory = statSync(path).isDirectory();
    } catch {
      // path does not exist
    }

    if (!isDirectory) {
      await sendTelegramMessage(chatId,
        `❌ Caminho não encontrado: \`${path}\`\n\nEnvie um caminho válido ou use os botões abaixo.`
      );
      await sendTopicWorkspaceQuestion(chatId);
      return;
    }

    userContextManager.setTopicWorkspace(userId, path);
    persistenceService.addRecentWorkspace(userId, path);
    try {
      await finishTopicCreation(chatId, userId);
    } catch (error) {
      userContextManager.clearContext(userId);
      const errorMessage = error instanceof Error ? error.message : String(error);
      await sendTelegramMessage(chatId, `❌ Erro ao criar tópico: ${errorMessage}`);
    }
  }
  // Other states are handled by callback queries (button presses)
}

/**
 * Handle Telegram callback (button press)
 */
async function handleTelegramCallback(query: any): Promise<void> {
  const chatId = query.message.chat.id;
  const data = query.data;
  const from = query.from;

  await answerCallbackQuery(query.id);

  // Find user by telegram username
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
    const workspaceValue = data.replace('workspace_', '');

    if (workspaceValue === 'skip') {
      userContextManager.setAgentWorkspace(userId, null);
      await sendTelegramModelModeSelector(chatId);
    } else if (workspaceValue === 'custom') {
      // Ask for custom path
      userContextManager.setAwaitingCustomWorkspace(userId);
      await sendTelegramMessage(chatId,
        '*Workspace personalizado*\n\n' +
        'Envie o caminho completo do diretório:\n' +
        'Exemplo: `/Users/lucas/projects/myapp`'
      );
    } else if (workspaceValue === 'sandbox') {
      // Use sandbox directory
      const sandboxPath = ensureSandboxDirectory();
      userContextManager.setAgentWorkspace(userId, sandboxPath);
      await sendTelegramModelModeSelector(chatId);
    } else {
      // Validate that the path exists
      const { existsSync } = await import('fs');
      if (existsSync(workspaceValue)) {
        userContextManager.setAgentWorkspace(userId, workspaceValue);
        await sendTelegramModelModeSelector(chatId);
      } else {
        // Path doesn't exist - suggest alternatives
        await sendTelegramButtons(chatId,
          `⚠️ *Caminho não encontrado*\n\n` +
          `\`${workspaceValue}\` não existe.\n\n` +
          `Escolha uma alternativa:`,
          [
            [
              { text: '🏠 Home', callback_data: `workspace_${process.env.HOME || '/home'}` },
              { text: '📂 Desktop', callback_data: `workspace_${process.env.HOME || '/home'}/Desktop` },
            ],
            [
              { text: '🧪 Sandbox', callback_data: 'workspace_sandbox' },
              { text: '⏭️ Pular', callback_data: 'workspace_skip' },
            ],
          ]
        );
      }
    }
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
      flowData?.workspace as string | undefined,
      modelMode
    );
  }
  else if (data === 'confirm_create') {
    const flowData = userContextManager.getFlowData(userId);
    if (flowData?.agentName) {
      const agent = agentManager.createAgent(
        userId,
        flowData.agentName as string,
        flowData.workspace as string | undefined,
        flowData.emoji as string,
        (flowData.agentType || 'claude') as AgentType,
        (flowData.modelMode || 'selection') as ModelMode
      );

      // Set agent mode (conversational/ralph) separately
      if (flowData.agentMode) {
        agentManager.updateAgentMode(agent.id, flowData.agentMode as 'conversational' | 'ralph');
      }

      // Check if there's a pending group link (from orphaned group recreation)
      const pendingGroupLink = flowData.pendingGroupLink as number | undefined;
      if (pendingGroupLink) {
        // Link to the existing group
        agentManager.setTelegramChatId(agent.id, pendingGroupLink);

        // Update group title
        const newTitle = `${flowData.emoji || '🤖'} ${agent.name}`;
        await updateTelegramGroupTitle(pendingGroupLink, newTitle);

        userContextManager.clearContext(userId);

        // Send confirmation
        await sendTelegramMessage(chatId,
          `✅ *Agente criado e vinculado!*\n\n` +
          `${flowData.emoji || '🤖'} *${agent.name}*\n\n` +
          `O grupo existente foi vinculado ao novo agente.`
        );

        // Also notify the group
        await sendGroupLinkedConfirmation(pendingGroupLink, agent.name, agent.emoji || '🤖');
      } else {
        // Track this agent for /link command
        pendingAgentLink.set(userId, agent.id);

        userContextManager.clearContext(userId);

        // Send success message with group creation instructions
        await sendTelegramMessage(chatId,
          `✅ *Agente criado!*\n\n` +
          `${flowData.emoji || '🤖'} *${agent.name}*\n\n` +
          `📱 *Próximo passo: Criar grupo*\n\n` +
          `1️⃣ Crie um novo grupo no Telegram\n` +
          `2️⃣ Adicione @ClaudeTerminalBot ao grupo\n` +
          `3️⃣ Envie /link no grupo\n\n` +
          `_O grupo será vinculado ao agente ${agent.name}._`
        );
      }
    }
  }
  else if (data === 'confirm_cancel') {
    userContextManager.clearContext(userId);
    await sendTelegramMessage(chatId, 'Criacao cancelada.');
  }
  else if (data.startsWith('agent_')) {
    const agentId = data.replace('agent_', '');
    await handleTelegramAgentMenuCallback(chatId, userId, agentId);
  }
  else if (data.startsWith('prompt_')) {
    const agentId = data.replace('prompt_', '');
    const agent = agentManager.getAgent(agentId);
    if (agent && agent.userId === userId) {
      // Store agent selection and ask for prompt
      userContextManager.startPromptFlow(userId, agentId);
      await sendTelegramMessage(chatId,
        `*${agent.emoji || '🤖'} ${agent.name}*\n\n` +
        `Envie sua mensagem:`
      );
    }
  }
  else if (data.startsWith('history_')) {
    const agentId = data.replace('history_', '');
    const agent = agentManager.getAgent(agentId);
    if (agent && agent.userId === userId) {
      await handleTelegramHistoryCallback(chatId, agent);
    }
  }
  else if (data.startsWith('reset_')) {
    const agentId = data.replace('reset_', '');
    const agent = agentManager.getAgent(agentId);
    if (agent && agent.userId === userId) {
      terminal.clearSession(userId, agentId);
      await sendTelegramMessage(chatId, `✅ Sessão de *${agent.name}* resetada.`);
    }
  }
  else if (data.startsWith('delete_')) {
    const agentId = data.replace('delete_', '');
    const agent = agentManager.getAgent(agentId);
    if (agent && agent.userId === userId) {
      // Use enhanced delete confirmation with group options
      await sendTelegramDeleteConfirmation(chatId, {
        id: agent.id,
        name: agent.name,
        emoji: agent.emoji || '🤖',
        telegramChatId: agent.telegramChatId,
      });
    }
  }
  else if (data.startsWith('confirmdelete_keep_')) {
    // Delete agent but keep the group
    const agentId = data.replace('confirmdelete_keep_', '');
    const agent = agentManager.getAgent(agentId);
    if (agent && agent.userId === userId) {
      const name = agent.name;
      const telegramChatId = agent.telegramChatId;

      agentManager.deleteAgent(agentId);
      await sendTelegramMessage(chatId, `✅ Agente *${name}* deletado.${telegramChatId ? '\n\n_O grupo foi mantido._' : ''}`);
    }
  }
  else if (data.startsWith('confirmdelete_leave_')) {
    // Delete agent AND leave the group
    const agentId = data.replace('confirmdelete_leave_', '');
    const agent = agentManager.getAgent(agentId);
    if (agent && agent.userId === userId) {
      const name = agent.name;
      const telegramChatId = agent.telegramChatId;

      // Leave the group first
      if (telegramChatId) {
        await leaveTelegramGroup(telegramChatId);
      }

      agentManager.deleteAgent(agentId);
      await sendTelegramMessage(chatId, `✅ Agente *${name}* e grupo deletados.`);
    }
  }
  else if (data === 'canceldelete') {
    await sendTelegramMessage(chatId, 'Deleção cancelada.');
  }
  // Config menu callback
  else if (data.startsWith('config_')) {
    const agentId = data.replace('config_', '');
    const agent = agentManager.getAgent(agentId);
    if (agent && agent.userId === userId) {
      await sendTelegramAgentConfigMenu(chatId, {
        id: agent.id,
        name: agent.name,
        emoji: agent.emoji || '🤖',
      });
    }
  }
  // Edit emoji callback
  else if (data.startsWith('editemoji_')) {
    const agentId = data.replace('editemoji_', '');
    const agent = agentManager.getAgent(agentId);
    if (agent && agent.userId === userId) {
      userContextManager.startEditEmojiFlow(userId, agentId);
      await sendTelegramEmojiSelector(chatId);
    }
  }
  // Emoji selection during edit flow
  else if (data.startsWith('emoji_') && userContextManager.isAwaitingEmojiText(userId)) {
    const emoji = data.replace('emoji_', '');
    const flowData = userContextManager.getEditEmojiData(userId);
    if (flowData?.agentId) {
      const agent = agentManager.getAgent(flowData.agentId);
      if (agent) {
        agentManager.updateEmoji(flowData.agentId, emoji);

        // Update Telegram group title if linked
        if (agent.telegramChatId) {
          const newTitle = `${emoji} ${agent.name}`;
          await updateTelegramGroupTitle(agent.telegramChatId, newTitle);
        }

        userContextManager.clearContext(userId);
        await sendTelegramMessage(chatId, `✅ Emoji atualizado para ${emoji}`);
      }
    }
  }
  // Edit name callback
  else if (data.startsWith('editname_')) {
    const agentId = data.replace('editname_', '');
    const agent = agentManager.getAgent(agentId);
    if (agent && agent.userId === userId) {
      userContextManager.startEditNameFlow(userId, agentId);
      await sendTelegramEditNamePrompt(chatId, agent.name);
    }
  }
  // Go to group callback
  else if (data.startsWith('gotogroup_')) {
    const agentId = data.replace('gotogroup_', '');
    const agent = agentManager.getAgent(agentId);
    if (agent && agent.userId === userId && agent.telegramChatId) {
      // Send a link to the group (Telegram deep link format)
      await sendTelegramMessage(chatId,
        `🔗 *Ir para grupo de ${agent.emoji || '🤖'} ${agent.name}*\n\n` +
        `Toque para abrir: t.me/c/${String(agent.telegramChatId).replace('-100', '')}`
      );
    }
  }
  // Orphaned group recreate callback
  else if (data.startsWith('orphan_recreate_')) {
    const groupChatId = parseInt(data.replace('orphan_recreate_', ''), 10);

    // Start onboarding using GroupOnboardingManager (matches router expectations)
    const result = groupOnboardingManager.startOnboarding(groupChatId, from.id, 'awaiting_name');
    if (!result.success) {
      await sendTelegramMessage(chatId, '⚠️ Outro usuário está configurando este grupo.');
      return;
    }

    // Send name prompt to the group (same as regular group onboarding)
    await sendTelegramAgentNamePrompt(groupChatId);
  }
  else if (data.startsWith('model_')) {
    // Handle model selection for pending prompt
    const model = data.replace('model_', '') as 'haiku' | 'sonnet' | 'opus';
    const context = userContextManager.getContext(userId);
    const pendingPrompt = context?.pendingPrompt;
    const agentId = context?.flowData?.agentId || context?.activeAgentId;

    if (pendingPrompt && agentId) {
      const agent = agentManager.getAgent(agentId);
      if (agent) {
        // Set active agent for continuous conversation support before clearing context
        userContextManager.setActiveAgent(userId, agentId);
        userContextManager.clearContext(userId);

        // Queue the prompt with number type replyTo for Telegram
        queueManager.enqueue({
          agentId,
          prompt: pendingPrompt.text,
          model,
          userId,
          replyTo: chatId, // Number type for Telegram platform detection
        });
      }
    }
  }
  // Handle orphaned group callbacks
  else if (data.startsWith('orphan_leave_')) {
    const targetChatId = parseInt(data.replace('orphan_leave_', ''), 10);
    // Leave the group using the exported function
    const success = await leaveTelegramGroup(targetChatId);
    if (success) {
      await sendTelegramMessage(chatId, 'Bot removido do grupo.');
    } else {
      await sendTelegramMessage(chatId, 'Erro ao sair do grupo.');
    }
  }
  // =============================================================================
  // External Topic Setup Callbacks
  // =============================================================================
  else if (data.startsWith('setup_topic_')) {
    // Handle setup_topic_{type}:{agentId}:{threadId}
    const parts = data.replace('setup_topic_', '').split(':');
    if (parts.length === 3) {
      const [topicType, agentId, threadIdStr] = parts;
      const threadId = parseInt(threadIdStr, 10);

      // Validate agent ownership and chat before registering topic
      const agent = agentManager.getAgent(agentId);
      if (!agent) {
        await sendTelegramMessage(chatId, '❌ Agente não encontrado.');
        return;
      }
      if (agent.userId !== userId) {
        await sendTelegramMessage(chatId, '❌ Você não tem permissão para configurar este agente.');
        return;
      }
      if (agent.telegramChatId && agent.telegramChatId !== chatId) {
        await sendTelegramMessage(chatId, '❌ Este agente pertence a outro grupo.');
        return;
      }

      // Map callback type to TopicType
      const typeMap: Record<string, 'ralph' | 'worktree' | 'session'> = {
        'ralph': 'ralph',
        'worktree': 'worktree',
        'session': 'session',
      };

      const type = typeMap[topicType];
      if (type && !isNaN(threadId)) {
        // Register the external topic
        const topicName = `Tópico #${threadId}`;
        topicManager.registerExternalTopic(agentId, threadId, type, topicName);

        // Send confirmation message based on type
        const confirmations: Record<string, string> = {
          'ralph': `✅ Tópico configurado como *Ralph Loop*.\n\nEnvie a tarefa para iniciar o loop autônomo.`,
          'worktree': `✅ Tópico configurado como *Worktree*.\n\nEnvie sua mensagem para começar.`,
          'session': `✅ Tópico configurado como *Sessão*.\n\nEnvie sua mensagem para começar.`,
        };

        await sendTelegramMessage(chatId, confirmations[type], undefined, threadId);
      }
    }
  }
  // =============================================================================
  // Ralph Loop Callbacks
  // =============================================================================
  else if (data === 'ralph_start') {
    // Start the Ralph loop
    await handleTelegramRalphStart(chatId, userId);
  }
  else if (data === 'ralph_config') {
    // Show iterations configuration
    await sendTelegramRalphIterationsConfig(chatId);
  }
  else if (data === 'ralph_cancel') {
    // Cancel Ralph loop setup
    userContextManager.clearContext(userId);
    await sendTelegramMessage(chatId, 'Loop cancelado.');
  }
  else if (data.startsWith('ralph_iter_')) {
    // Handle iteration count selection
    const iterValue = data.replace('ralph_iter_', '');

    if (iterValue === 'custom') {
      // Ask for custom iteration count
      const context = userContextManager.getContext(userId);
      if (context) {
        context.flowState = 'awaiting_custom_iterations';
        userContextManager.updateContext(userId, context);
      }
      await sendTelegramMessage(chatId,
        '✏️ *Iterações personalizadas*\n\n' +
        'Envie um número entre 1 e 100:'
      );
    } else {
      const iterations = parseInt(iterValue, 10);
      const context = userContextManager.getContext(userId);
      if (context?.flowData) {
        context.flowData.ralphMaxIterations = iterations;
        userContextManager.updateContext(userId, context);

        // Show updated confirmation
        const agent = agentManager.getAgent(context.flowData.agentId as string);
        if (agent && context.flowData.ralphTask) {
          await sendTelegramRalphConfirmation(
            chatId,
            agent.name,
            context.flowData.ralphTask as string,
            iterations
          );
        }
      }
    }
  }
  else if (data.startsWith('ralph_pause_')) {
    const loopId = data.replace('ralph_pause_', '');
    await handleTelegramRalphPause(chatId, loopId);
  }
  else if (data.startsWith('ralph_resume_')) {
    const loopId = data.replace('ralph_resume_', '');
    await handleTelegramRalphResume(chatId, loopId);
  }
  else if (data.startsWith('ralph_stop_')) {
    const loopId = data.replace('ralph_stop_', '');
    await handleTelegramRalphStop(chatId, loopId);
  }
  // =============================================================================
  // Ralph Topic Completion Callbacks
  // =============================================================================
  else if (data.startsWith('ralph_topic_keep_')) {
    // Keep the topic open after Ralph completion
    const topicId = data.replace('ralph_topic_keep_', '');
    // No action needed - topic stays open by default
    await sendTelegramMessage(chatId, '✅ Tópico mantido aberto. Envie novas mensagens para continuar a conversa.');
  }
  else if (data.startsWith('ralph_topic_close_')) {
    // Close the topic after Ralph completion
    const topicId = data.replace('ralph_topic_close_', '');

    // Find the agent that owns this topic
    const agentsWithTopics = topicManager.listAgentsWithTopics();
    let closedSuccessfully = false;

    for (const agentId of agentsWithTopics) {
      const topic = topicManager.getTopic(agentId, topicId);
      if (topic) {
        await topicManager.closeTopic(agentId, topicId, chatId);
        closedSuccessfully = true;
        await sendTelegramMessage(chatId, `🔒 Tópico "${topic.name}" fechado.`);
        break;
      }
    }

    if (!closedSuccessfully) {
      await sendTelegramMessage(chatId, '⚠️ Tópico não encontrado.');
    }
  }
  // =============================================================================
  // Enhanced Topic Management Callbacks
  // =============================================================================
  else if (data.startsWith('topic_detail_')) {
    // Show detailed view for a specific topic
    const topicId = data.replace('topic_detail_', '');
    await handleTopicDetailCallback(chatId, userId, topicId);
  }
  else if (data.startsWith('topic_goto_')) {
    // Navigate to a topic using deep link
    const topicId = data.replace('topic_goto_', '');
    await handleTopicGotoCallback(chatId, userId, topicId);
  }
  else if (data.startsWith('topic_confirm_close_')) {
    // Show confirmation modal for closing a topic
    const topicId = data.replace('topic_confirm_close_', '');
    await handleTopicConfirmCloseCallback(chatId, userId, topicId);
  }
  else if (data.startsWith('topic_close_confirmed_')) {
    // Close the topic after confirmation
    const topicId = data.replace('topic_close_confirmed_', '');
    await handleTopicCloseConfirmedCallback(chatId, userId, topicId);
  }
  else if (data.startsWith('topic_confirm_delete_')) {
    // Show confirmation modal for deleting a topic
    const topicId = data.replace('topic_confirm_delete_', '');
    await handleTopicConfirmDeleteCallback(chatId, userId, topicId);
  }
  else if (data.startsWith('topic_delete_confirmed_')) {
    // Delete the topic after confirmation
    const topicId = data.replace('topic_delete_confirmed_', '');
    await handleTopicDeleteConfirmedCallback(chatId, userId, topicId);
  }
  else if (data.startsWith('topic_confirm_reset_')) {
    // Show confirmation modal for resetting session
    const topicId = data.replace('topic_confirm_reset_', '');
    await handleTopicConfirmResetCallback(chatId, userId, topicId);
  }
  else if (data.startsWith('topic_reset_confirmed_')) {
    // Reset session after confirmation
    const topicId = data.replace('topic_reset_confirmed_', '');
    await handleTopicResetConfirmedCallback(chatId, userId, topicId);
  }
  else if (data.startsWith('topic_reopen_')) {
    // Reopen a closed topic
    const topicId = data.replace('topic_reopen_', '');
    await handleTopicReopenCallback(chatId, userId, topicId);
  }
  else if (data === 'topic_list_back') {
    // Go back to topic list
    await handleTopicListBackCallback(chatId, userId);
  }
  else if (data === 'topic_create_ralph') {
    // Start Ralph topic creation flow from /topicos menu
    await handleTopicCreateCallback(chatId, userId, 'ralph');
  }
  else if (data === 'topic_create_worktree') {
    // Start Worktree topic creation flow from /topicos menu
    await handleTopicCreateCallback(chatId, userId, 'worktree');
  }
  else if (data === 'topic_create_session') {
    // Start Session topic creation flow from /topicos menu
    await handleTopicCreateCallback(chatId, userId, 'session');
  }
  // =============================================================================
  // Image Action Callbacks
  // =============================================================================
  else if (data.startsWith('img_analyze_') || data.startsWith('img_describe_') || data.startsWith('img_bugs_')) {
    const context = userContextManager.getContext(userId);
    const fileId = context?.flowData?.pendingImageFileId as string;
    const agentId = context?.flowData?.agentId as string;

    if (!fileId || !agentId) {
      await sendTelegramMessage(chatId, '❌ Imagem não encontrada. Envie novamente.');
      return;
    }

    // Determine prompt based on action
    let prompt: string;
    if (data.startsWith('img_analyze_')) {
      prompt = 'Analise esta imagem detalhadamente. O que você vê? Quais são os elementos principais?';
    } else if (data.startsWith('img_describe_')) {
      prompt = 'Descreva esta imagem de forma clara e objetiva.';
    } else {
      prompt = 'Analise esta imagem procurando por possíveis bugs, erros, problemas de UI/UX ou inconsistências. Liste os problemas encontrados.';
    }

    userContextManager.clearContext(userId);
    await processTelegramImageWithPrompt(chatId, userId, agentId, fileId, prompt);
  }
  // =============================================================================
  // Document Action Callbacks
  // =============================================================================
  else if (data.startsWith('doc_read_') || data.startsWith('doc_analyze_') || data.startsWith('doc_edit_')) {
    const context = userContextManager.getContext(userId);
    const fileId = context?.flowData?.pendingDocumentFileId as string;
    const filename = context?.flowData?.pendingDocumentFilename as string || 'documento';
    const agentId = context?.flowData?.agentId as string;

    if (!fileId || !agentId) {
      await sendTelegramMessage(chatId, '❌ Documento não encontrado. Envie novamente.');
      return;
    }

    // Determine prompt based on action
    let prompt: string;
    if (data.startsWith('doc_read_')) {
      prompt = 'Leia e resuma o conteúdo deste arquivo.';
    } else if (data.startsWith('doc_analyze_')) {
      prompt = 'Analise este arquivo detalhadamente. Explique sua estrutura, propósito e conteúdo principal.';
    } else {
      prompt = 'Analise este arquivo e sugira melhorias ou correções. Liste as alterações recomendadas.';
    }

    userContextManager.clearContext(userId);
    await processTelegramDocumentWithPrompt(chatId, userId, agentId, fileId, filename, prompt);
  }
  // =============================================================================
  // Group Onboarding Callbacks
  // =============================================================================
  else if (data.startsWith('onboard_create_')) {
    // User clicked "Criar agora" or "Criar um" button
    const targetTelegramUserId = parseInt(data.replace('onboard_create_', ''), 10);

    // Validate that the user clicking is the one the button was created for
    if (from.id !== targetTelegramUserId) {
      await sendTelegramMessage(chatId, '⚠️ Outro usuário está configurando este grupo.');
      return;
    }

    // Start or continue onboarding
    const result = groupOnboardingManager.startOnboarding(chatId, from.id, 'awaiting_name');
    if (!result.success) {
      await sendTelegramMessage(chatId, '⚠️ Outro usuário está configurando este grupo.');
      return;
    }

    // Send name prompt
    await sendGroupAgentNamePrompt(chatId);
  }
  else if (data.startsWith('onboard_link_')) {
    // User clicked "Vincular existente" button - show list of unlinked agents
    const targetTelegramUserId = parseInt(data.replace('onboard_link_', ''), 10);

    // Validate lock
    if (from.id !== targetTelegramUserId) {
      const lockOwner = groupOnboardingManager.getLockedByUserId(chatId);
      if (lockOwner && lockOwner !== from.id) {
        await sendTelegramMessage(chatId, '⚠️ Outro usuário está configurando este grupo.');
        return;
      }
    }

    // Get user's unlinked agents
    const agents = agentManager.listAgents(userId)
      .filter(a => a.name !== 'Ronin' && !a.telegramChatId);

    // Case C: No available agents - show message + [criar um] button
    if (agents.length === 0) {
      await sendTelegramButtons(chatId,
        '✅ *Todos os agentes já estão vinculados*\n\n' +
        'Crie um novo agente para este grupo.',
        [
          [{ text: '✨ Criar um', callback_data: `onboard_create_${from.id}` }],
        ]
      );
      return;
    }

    // Case A: 1-3 agents - show inline buttons with "[emoji] [name]" format
    if (agents.length <= 3) {
      const buttons = agents.map(a => ([{
        text: `${a.emoji || '🤖'} ${a.name}`,
        callback_data: `grp_link_agent_${a.id}`,
      }]));

      await sendTelegramButtons(chatId, '*Escolha um agente para vincular:*', buttons);
    }
    // Case B: 4+ agents - show numbered list + number buttons in rows of 4
    else {
      // Build numbered list message
      const listLines = agents.slice(0, 8).map((a, i) =>
        `${i + 1}. ${a.emoji || '🤖'} ${a.name}`
      );
      const message = '*Escolha um agente para vincular:*\n\n' + listLines.join('\n');

      // Build number buttons in rows of 4
      const buttons: { text: string; callback_data: string }[][] = [];
      const agentsToShow = agents.slice(0, 8);
      for (let i = 0; i < agentsToShow.length; i += 4) {
        const row = agentsToShow.slice(i, i + 4).map((a, idx) => ({
          text: String(i + idx + 1),
          callback_data: `grp_link_agent_${a.id}`,
        }));
        buttons.push(row);
      }

      await sendTelegramButtons(chatId, message, buttons);
    }

    // Update state to linking_agent
    groupOnboardingManager.updateState(chatId, from.id, { step: 'linking_agent' });
  }
  else if (data.startsWith('grp_link_agent_')) {
    // User selected an existing agent to link
    const agentId = data.replace('grp_link_agent_', '');
    const agent = agentManager.getAgent(agentId);

    if (!agent || agent.userId !== userId) {
      await sendTelegramMessage(chatId, '❌ Agente não encontrado.');
      return;
    }

    // Guard: prevent hijacking already-linked agents
    if (agent.telegramChatId !== undefined && agent.telegramChatId !== chatId) {
      await sendTelegramMessage(chatId, '❌ Este agente já está vinculado a outro grupo.');
      return;
    }

    // If agent is already linked to THIS chat, just complete onboarding without reassigning
    if (agent.telegramChatId === chatId) {
      // Edit pinned message to show success
      const pinnedMessageId = groupOnboardingManager.getPinnedMessageId(chatId);
      if (pinnedMessageId) {
        await editTelegramMessage(chatId, pinnedMessageId,
          `✅ *${agent.emoji || '🤖'} ${agent.name}* vinculado a este grupo!\n\n` +
          `Envie mensagens para interagir com o agente.`
        );
      }

      // Complete onboarding
      groupOnboardingManager.completeOnboarding(chatId, from.id);
      return;
    }

    // Link agent to this group
    agentManager.setTelegramChatId(agentId, chatId);

    // Update group title
    const newTitle = `${agent.emoji || '🤖'} ${agent.name}`;
    await updateTelegramGroupTitle(chatId, newTitle);

    // Edit pinned message to show success
    const pinnedMessageId = groupOnboardingManager.getPinnedMessageId(chatId);
    if (pinnedMessageId) {
      await editTelegramMessage(chatId, pinnedMessageId,
        `✅ *${agent.emoji || '🤖'} ${agent.name}* vinculado a este grupo!\n\n` +
        `Envie mensagens para interagir com o agente.`
      );
    }

    // Complete onboarding
    groupOnboardingManager.completeOnboarding(chatId, from.id);
  }
  else if (data.startsWith('grp_emoji_')) {
    // User selected emoji in group onboarding flow
    const emoji = data.replace('grp_emoji_', '');

    // Validate lock
    if (!groupOnboardingManager.isLockedByUser(chatId, from.id)) {
      await sendTelegramMessage(chatId, '⚠️ Você não está autorizado a configurar este grupo.');
      return;
    }

    // Store emoji
    groupOnboardingManager.setEmoji(chatId, from.id, emoji);

    // Advance to workspace step
    groupOnboardingManager.advanceStep(chatId, from.id, 'awaiting_workspace');

    // Show workspace selector
    await sendGroupWorkspaceSelector(chatId);
  }
  else if (data.startsWith('grp_workspace_')) {
    // User selected workspace in group onboarding flow
    const workspaceValue = data.replace('grp_workspace_', '');

    // Validate lock
    if (!groupOnboardingManager.isLockedByUser(chatId, from.id)) {
      await sendTelegramMessage(chatId, '⚠️ Você não está autorizado a configurar este grupo.');
      return;
    }

    if (workspaceValue === 'custom') {
      // Ask for custom path - stay in awaiting_workspace step but mark as custom
      groupOnboardingManager.setWorkspace(chatId, from.id, '__awaiting_custom__');
      await sendGroupCustomWorkspacePrompt(chatId);
    } else if (workspaceValue === 'sandbox') {
      // Use sandbox directory - will be created when agent is created
      groupOnboardingManager.setWorkspace(chatId, from.id, '__sandbox__');
      groupOnboardingManager.advanceStep(chatId, from.id, 'awaiting_model_mode');
      await sendGroupModelModeSelector(chatId);
    } else {
      // Validate that the path exists
      const { existsSync } = await import('fs');
      if (existsSync(workspaceValue)) {
        groupOnboardingManager.setWorkspace(chatId, from.id, workspaceValue);
        groupOnboardingManager.advanceStep(chatId, from.id, 'awaiting_model_mode');
        await sendGroupModelModeSelector(chatId);
      } else {
        // Path doesn't exist - show error and offer alternatives
        await sendTelegramButtons(chatId,
          `⚠️ *Caminho não encontrado*\n\n` +
          `\`${workspaceValue}\` não existe.\n\n` +
          `Escolha uma alternativa:`,
          [
            [
              { text: '🧪 Sandbox', callback_data: 'grp_workspace_sandbox' },
              { text: '✏️ Outro caminho', callback_data: 'grp_workspace_custom' },
            ],
          ]
        );
      }
    }
  }
  else if (data.startsWith('grp_modelmode_')) {
    // User selected model mode in group onboarding flow - finalize creation
    const modelMode = data.replace('grp_modelmode_', '') as ModelMode;

    // Validate lock
    if (!groupOnboardingManager.isLockedByUser(chatId, from.id)) {
      await sendTelegramMessage(chatId, '⚠️ Você não está autorizado a configurar este grupo.');
      return;
    }

    // Store model mode
    groupOnboardingManager.setModelMode(chatId, from.id, modelMode);

    // Get all collected data
    const state = groupOnboardingManager.getState(chatId);
    if (!state || !state.data.agentName || !state.data.emoji) {
      await sendTelegramMessage(chatId, '❌ Dados incompletos. Por favor, inicie novamente.');
      groupOnboardingManager.cancelOnboarding(chatId, from.id);
      return;
    }

    // Determine initial workspace (sandbox is set after creation when we have the agent ID)
    let finalWorkspace: string | undefined;
    const isSandbox = state.data.workspace === '__sandbox__';
    if (!isSandbox && state.data.workspace && state.data.workspace !== '__awaiting_custom__') {
      finalWorkspace = state.data.workspace;
    }

    try {
      // Create the agent (sandbox agents are created without workspace initially)
      const agent = agentManager.createAgent(
        userId,
        state.data.agentName,
        finalWorkspace,
        state.data.emoji,
        'claude', // Default to claude type
        modelMode
      );

      // If sandbox was selected, compute the sandbox path and set the workspace
      if (isSandbox) {
        const sandboxPath = getAgentSandboxPath(agent.id);
        agentManager.setWorkspace(agent.id, sandboxPath);
        finalWorkspace = sandboxPath;
      }

      // Link agent to this group
      agentManager.setTelegramChatId(agent.id, chatId);

      // Update group title
      const newTitle = `${state.data.emoji} ${agent.name}`;
      await updateTelegramGroupTitle(chatId, newTitle);

      // Edit pinned message to show success
      const pinnedMessageId = groupOnboardingManager.getPinnedMessageId(chatId);
      if (pinnedMessageId) {
        await editTelegramMessage(chatId, pinnedMessageId,
          `✅ *${state.data.emoji} ${agent.name}* criado e vinculado!\n\n` +
          `Modelo: ${modelMode === 'selection' ? 'Seleção' : modelMode}\n` +
          `${finalWorkspace ? `Workspace: \`${finalWorkspace}\`\n` : ''}` +
          `\nEnvie mensagens para interagir com o agente.`
        );
      }

      // Complete onboarding
      groupOnboardingManager.completeOnboarding(chatId, from.id);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      await sendTelegramMessage(chatId, `❌ Erro ao criar agente: ${errorMessage}`);
      groupOnboardingManager.cancelOnboarding(chatId, from.id);
    }
  }
  // =============================================================================
  // Topic Management Callbacks
  // =============================================================================
  else if (data.startsWith('topic_ralph_iter_')) {
    // Handle iteration count selection for Ralph topic
    const iterValue = data.replace('topic_ralph_iter_', '');

    if (iterValue === 'custom') {
      // Ask for custom iteration count
      const context = userContextManager.getContext(userId);
      if (context) {
        context.flowState = 'awaiting_topic_iterations';
        userContextManager.updateContext(userId, context);
      }
      await sendTopicRalphCustomIterationsPrompt(chatId);
    } else {
      const iterations = parseInt(iterValue, 10);
      userContextManager.setTopicMaxIterations(userId, iterations);
      // Ask about workspace before creating
      userContextManager.setAwaitingTopicWorkspace(userId);
      await sendTopicWorkspaceQuestion(chatId);
    }
  }
  else if (data.startsWith('topic_close_')) {
    // Handle topic close action
    const topicId = data.replace('topic_close_', '');
    const agent = agentManager.getAgentByTelegramChatId(chatId);

    if (agent && agent.userId === userId) {
      try {
        const topic = topicManager.getTopic(agent.id, topicId);
        const topicName = topic?.name || 'tópico';
        await topicManager.closeTopic(agent.id, topicId, chatId);
        await sendTelegramMessage(chatId, `🔴 Tópico "${topicName}" fechado.`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await sendTelegramMessage(chatId, `❌ Erro ao fechar tópico: ${errorMessage}`);
      }
    }
  }
  else if (data.startsWith('topic_reopen_')) {
    // Handle topic reopen action
    const topicId = data.replace('topic_reopen_', '');
    const agent = agentManager.getAgentByTelegramChatId(chatId);

    if (agent && agent.userId === userId) {
      try {
        const topic = topicManager.getTopic(agent.id, topicId);
        const topicName = topic?.name || 'tópico';
        await topicManager.reopenTopic(agent.id, topicId, chatId);
        await sendTelegramMessage(chatId, `🟢 Tópico "${topicName}" reaberto.`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await sendTelegramMessage(chatId, `❌ Erro ao reabrir tópico: ${errorMessage}`);
      }
    }
  }
  else if (data.startsWith('topic_delete_')) {
    // Handle topic delete action
    const topicId = data.replace('topic_delete_', '');
    const agent = agentManager.getAgentByTelegramChatId(chatId);

    if (agent && agent.userId === userId) {
      try {
        const topic = topicManager.getTopic(agent.id, topicId);
        const topicName = topic?.name || 'tópico';
        await topicManager.deleteTopic(agent.id, topicId, chatId);
        await sendTelegramMessage(chatId, `🗑️ Tópico "${topicName}" deletado.`);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await sendTelegramMessage(chatId, `❌ Erro ao deletar tópico: ${errorMessage}`);
      }
    }
  }
  // Topic workspace button from welcome message
  else if (data.startsWith('topic_workspace:')) {
    const topicId = data.replace('topic_workspace:', '');
    const agent = agentManager.getAgentByTelegramChatId(chatId);
    if (!agent || agent.userId !== userId) return;

    const topic = topicManager.getTopic(agent.id, topicId);
    if (!topic) return;

    await showWorkspaceSelector(chatId, topic.telegramTopicId, userId, agent.id, topicId);
  }
  // Topic creation workspace choice callbacks
  else if (data === 'topic_create_ws_yes') {
    // User wants to configure workspace during topic creation
    if (userContextManager.isAwaitingTopicWorkspace(userId)) {
      const context = userContextManager.getContext(userId);
      const agentId = context?.flowData?.agentId as string;

      if (!agentId) return;

      // Start navigation with creation context (preserves flow data for finishTopicCreation)
      userContextManager.startDirectoryNavigationWithCreation(userId, {
        targetAgentId: agentId,
        creationContext: {
          flow: context.currentFlow as 'topic_ralph' | 'topic_worktree' | 'topic_sessao',
          flowData: {
            agentId,
            topicName: context.flowData?.topicName as string | undefined,
            topicTask: context.flowData?.topicTask as string | undefined,
            topicMaxIterations: context.flowData?.topicMaxIterations as number | undefined,
          },
        },
      });

      await showWorkspaceSelector(chatId, undefined, userId, agentId, undefined);
    }
  }
  else if (data === 'topic_create_ws_skip') {
    // User wants to skip workspace config - create topic with inherited workspace
    if (userContextManager.isAwaitingTopicWorkspace(userId)) {
      try {
        await finishTopicCreation(chatId, userId);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await sendTelegramMessage(chatId, `❌ Erro ao criar tópico: ${errorMessage}`);
        userContextManager.clearContext(userId);
      }
    }
  }
  // Workspace management callbacks
  else if (data.startsWith('ws_use_agent_')) {
    // Use agent workspace for this topic
    // Format: ws_use_agent_<topicId>_<threadId> (UUID uses hyphens, so _ cleanly separates)
    const payload = data.replace('ws_use_agent_', '');
    const lastUnderscore = payload.lastIndexOf('_');
    const topicId = lastUnderscore !== -1 ? payload.substring(0, lastUnderscore) : payload;
    const callbackThreadId = lastUnderscore !== -1 ? parseInt(payload.substring(lastUnderscore + 1), 10) : undefined;
    const agent = agentManager.getAgentByTelegramChatId(chatId);

    if (agent && agent.userId === userId) {
      const topic = topicManager.getTopic(agent.id, topicId);
      const resolvedThreadId = topic?.telegramTopicId ?? callbackThreadId;

      // Clear topic workspace so it falls through to agent workspace
      topicManager.updateTopicWorkspace(agent.id, topicId, undefined);
      const agentWorkspace = agent.workspace || '(sandbox padrão)';
      await sendTelegramMessage(chatId,
        `✅ Workspace do tópico resetado.\n📁 Usando workspace do agente: \`${agentWorkspace}\``,
        undefined,
        resolvedThreadId
      );
    }
  }
  else if (data.startsWith('ws_retry_')) {
    // Prompt user to try another path
    // Format: ws_retry_<topicId>_<threadId>
    const payload = data.replace('ws_retry_', '');
    const lastUnderscore = payload.lastIndexOf('_');
    const topicId = lastUnderscore !== -1 ? payload.substring(0, lastUnderscore) : payload;
    const callbackThreadId = lastUnderscore !== -1 ? parseInt(payload.substring(lastUnderscore + 1), 10) : undefined;
    const agent = agentManager.getAgentByTelegramChatId(chatId);
    const topic = agent ? topicManager.getTopic(agent.id, topicId) : undefined;
    const resolvedThreadId = topic?.telegramTopicId ?? callbackThreadId;

    await sendTelegramMessage(chatId,
      '📁 Envie o novo caminho com /workspace:\n\n' +
      'Exemplo: `/workspace /Users/lucas/projeto-x`',
      undefined,
      resolvedThreadId
    );
  }
  // Workspace not found flow callbacks (Flow 4 - paused task)
  else if (data.startsWith('ws_notfound_agent_')) {
    // Use agent workspace for this topic and resume paused task
    const topicId = data.replace('ws_notfound_agent_', '');
    const context = userContextManager.getContext(userId);
    const agent = agentManager.getAgentByTelegramChatId(chatId);

    if (agent && agent.userId === userId && context?.currentFlow === 'workspace_not_found' && context.flowData) {
      const topic = topicManager.getTopic(agent.id, topicId);
      const resolvedThreadId = topic?.telegramTopicId;

      // Clear topic workspace so it inherits from agent
      topicManager.updateTopicWorkspace(agent.id, topicId, undefined);
      const agentWorkspace = agent.workspace || '(sandbox padrão)';
      await sendTelegramMessage(chatId,
        `✅ Usando workspace do agente: \`${agentWorkspace}\``,
        undefined,
        resolvedThreadId
      );

      // Resume paused task
      const { pausedPrompt, pausedModel, pausedImages } = context.flowData;
      if (pausedPrompt && pausedModel) {
        await sendTelegramMessage(chatId, '🔄 Retomando processamento do prompt...', undefined, resolvedThreadId);
        queueManager.enqueue({
          agentId: agent.id,
          prompt: pausedPrompt as string,
          model: pausedModel as 'haiku' | 'sonnet' | 'opus',
          userId,
          replyTo: chatId,
          threadId: resolvedThreadId,
          images: pausedImages as Array<{data: string; mimeType: string}> | undefined,
        });
      }

      userContextManager.clearContext(userId);
    }
  }
  else if (data.startsWith('ws_notfound_sandbox_')) {
    // Use sandbox (clear topic workspace) and resume paused task
    const topicId = data.replace('ws_notfound_sandbox_', '');
    const context = userContextManager.getContext(userId);
    const agent = agentManager.getAgentByTelegramChatId(chatId);

    if (agent && agent.userId === userId && context?.currentFlow === 'workspace_not_found' && context.flowData) {
      const topic = topicManager.getTopic(agent.id, topicId);
      const resolvedThreadId = topic?.telegramTopicId;

      // Set topic workspace to 'sandbox' sentinel - forces sandbox regardless of agent workspace
      topicManager.updateTopicWorkspace(agent.id, topicId, 'sandbox');
      await sendTelegramMessage(chatId,
        '✅ Usando sandbox',
        undefined,
        resolvedThreadId
      );

      // Resume paused task
      const { pausedPrompt, pausedModel, pausedImages } = context.flowData;
      if (pausedPrompt && pausedModel) {
        await sendTelegramMessage(chatId, '🔄 Retomando processamento do prompt...', undefined, resolvedThreadId);
        queueManager.enqueue({
          agentId: agent.id,
          prompt: pausedPrompt as string,
          model: pausedModel as 'haiku' | 'sonnet' | 'opus',
          userId,
          replyTo: chatId,
          threadId: resolvedThreadId,
          images: pausedImages as Array<{data: string; mimeType: string}> | undefined,
        });
      }

      userContextManager.clearContext(userId);
    }
  }
  else if (data.startsWith('ws_notfound_reconfig_')) {
    // Show workspace selector UI (keep paused task in context)
    const topicId = data.replace('ws_notfound_reconfig_', '');
    const context = userContextManager.getContext(userId);
    const agent = agentManager.getAgentByTelegramChatId(chatId);

    if (agent && agent.userId === userId && context?.currentFlow === 'workspace_not_found' && context.flowData) {
      const topic = topicManager.getTopic(agent.id, topicId);
      const resolvedThreadId = topic?.telegramTopicId;

      await showWorkspaceSelector(chatId, resolvedThreadId, userId, agent.id, topicId);
    }
  }
  else if (data.startsWith('ws_notfound_cancel_')) {
    // Cancel paused task
    const topicId = data.replace('ws_notfound_cancel_', '');
    const context = userContextManager.getContext(userId);
    const agent = agentManager.getAgentByTelegramChatId(chatId);

    if (agent && agent.userId === userId && context?.currentFlow === 'workspace_not_found') {
      const topic = topicManager.getTopic(agent.id, topicId);
      const resolvedThreadId = topic?.telegramTopicId;

      await sendTelegramMessage(chatId,
        '❌ Tarefa cancelada. O prompt não foi processado.',
        undefined,
        resolvedThreadId
      );

      userContextManager.clearContext(userId);
    }
  }
  else if (data.startsWith('ws_reconfig_')) {
    // Handle workspace reconfiguration selection (from ws_notfound_reconfig_ selector)
    const payload = data.replace('ws_reconfig_', '');
    const context = userContextManager.getContext(userId);
    const agent = agentManager.getAgentByTelegramChatId(chatId);

    if (agent && agent.userId === userId && context?.currentFlow === 'workspace_not_found' && context.flowData) {
      // Parse topicId and action from payload: <topicId>_path_<path>, <topicId>_sandbox, <topicId>_custom
      const sandboxSuffix = '_sandbox';
      const customSuffix = '_custom';
      const pathMarker = '_path_';

      if (payload.endsWith(sandboxSuffix)) {
        const topicId = payload.slice(0, -sandboxSuffix.length);
        const topic = topicManager.getTopic(agent.id, topicId);
        const resolvedThreadId = topic?.telegramTopicId;
        const sandboxPath = getAgentSandboxPath(agent.id);

        topicManager.updateTopicWorkspace(agent.id, topicId, sandboxPath);
        await sendTelegramMessage(chatId,
          `✅ Workspace atualizado\n📁 \`${sandboxPath}\``,
          undefined,
          resolvedThreadId
        );

        // Resume paused task
        const { pausedPrompt, pausedModel, pausedImages } = context.flowData;
        if (pausedPrompt && pausedModel) {
          await sendTelegramMessage(chatId, '🔄 Retomando processamento do prompt...', undefined, resolvedThreadId);
          queueManager.enqueue({
            agentId: agent.id,
            prompt: pausedPrompt as string,
            model: pausedModel as 'haiku' | 'sonnet' | 'opus',
            userId,
            replyTo: chatId,
            threadId: resolvedThreadId,
            images: pausedImages as Array<{data: string; mimeType: string}> | undefined,
          });
        }
        userContextManager.clearContext(userId);

      } else if (payload.endsWith(customSuffix)) {
        const topicId = payload.slice(0, -customSuffix.length);
        const topic = topicManager.getTopic(agent.id, topicId);
        const resolvedThreadId = topic?.telegramTopicId;

        await sendTelegramMessage(chatId,
          '📁 Envie o novo caminho com /workspace:\n\n' +
          'Exemplo: `/workspace /Users/lucas/projeto-x`',
          undefined,
          resolvedThreadId
        );

      } else if (payload.includes(pathMarker)) {
        const markerIdx = payload.indexOf(pathMarker);
        const topicId = payload.substring(0, markerIdx);
        const selectedPath = payload.substring(markerIdx + pathMarker.length);
        const topic = topicManager.getTopic(agent.id, topicId);
        const resolvedThreadId = topic?.telegramTopicId;

        // Validate path exists
        let isDirectory = false;
        try {
          isDirectory = statSync(selectedPath).isDirectory();
        } catch {
          // path does not exist
        }

        if (!isDirectory) {
          await sendTelegramMessage(chatId,
            `❌ Caminho não encontrado: \`${selectedPath}\`\n\n` +
            'Envie o caminho correto com /workspace:\n' +
            'Exemplo: `/workspace /Users/lucas/projeto-x`',
            undefined,
            resolvedThreadId
          );
          return;
        }

        topicManager.updateTopicWorkspace(agent.id, topicId, selectedPath);
        persistenceService.addRecentWorkspace(userId, selectedPath);
        await sendTelegramMessage(chatId,
          `✅ Workspace atualizado\n📁 \`${selectedPath}\``,
          undefined,
          resolvedThreadId
        );

        // Resume paused task
        const { pausedPrompt, pausedModel, pausedImages } = context.flowData;
        if (pausedPrompt && pausedModel) {
          await sendTelegramMessage(chatId, '🔄 Retomando processamento do prompt...', undefined, resolvedThreadId);
          queueManager.enqueue({
            agentId: agent.id,
            prompt: pausedPrompt as string,
            model: pausedModel as 'haiku' | 'sonnet' | 'opus',
            userId,
            replyTo: chatId,
            threadId: resolvedThreadId,
            images: pausedImages as Array<{data: string; mimeType: string}> | undefined,
          });
        }
        userContextManager.clearContext(userId);
      }
    }
  }
  // ===================================================================
  // New wsnav: callbacks (index-based, short, < 64 bytes)
  // ===================================================================
  else if (data.startsWith('wsnav:')) {
    const action = data.replace('wsnav:', '');
    const navState = userContextManager.getDirectoryNavigationState(userId);
    const agent = agentManager.getAgentByTelegramChatId(chatId);

    if (!agent || agent.userId !== userId) return;

    // Also handle wsnav: callbacks from workspace_not_found flow
    const context = userContextManager.getContext(userId);
    const isWorkspaceNotFound = context?.currentFlow === 'workspace_not_found' && !!context.flowData;

    // Get thread ID from navigation state or workspace_not_found context
    const getThreadId = (): number | undefined => {
      if (navState?.targetTopicId) {
        const topic = topicManager.getTopic(agent.id, navState.targetTopicId);
        return topic?.telegramTopicId;
      }
      if (isWorkspaceNotFound && context?.flowData?.topicId) {
        const topic = topicManager.getTopic(agent.id, context.flowData.topicId as string);
        return topic?.telegramTopicId;
      }
      return undefined;
    };

    if (action === 'agent') {
      // Use agent workspace as starting point for tree navigation
      if (agent.workspace && navState) {
        userContextManager.updateDirectoryPath(userId, agent.workspace);
        await showWorkspaceDirectoryBrowser(chatId, getThreadId(), userId);
      }
    }
    else if (action === 'sandbox') {
      const sandboxPath = getAgentSandboxPath(agent.id);

      // Topic creation flow: restore flowData and finish creation
      if (navState?.creationContext) {
        const { flow, flowData } = navState.creationContext;
        userContextManager.setContext(userId, {
          userId,
          currentFlow: flow,
          flowState: 'awaiting_topic_workspace',
          flowData: {
            ...flowData,
            topicWorkspace: sandboxPath,
          },
        });

        persistenceService.addRecentWorkspace(userId, sandboxPath);
        userContextManager.clearDirectoryNavigation(userId);
        await finishTopicCreation(chatId, userId);
        return;
      }

      // Existing topic workspace update flow
      const topicId = navState?.targetTopicId || (context?.flowData?.topicId as string);
      if (!topicId) return;

      topicManager.updateTopicWorkspace(agent.id, topicId, sandboxPath);
      persistenceService.addRecentWorkspace(userId, sandboxPath);
      const threadId = getThreadId();

      await sendTelegramMessage(chatId,
        `✅ Workspace atualizado\n📁 \`${sandboxPath}\``,
        undefined,
        threadId
      );

      // Resume paused task if workspace_not_found
      if (isWorkspaceNotFound && context?.flowData) {
        const { pausedPrompt, pausedModel, pausedImages } = context.flowData;
        if (pausedPrompt && pausedModel) {
          await sendTelegramMessage(chatId, '🔄 Retomando processamento do prompt...', undefined, threadId);
          queueManager.enqueue({
            agentId: agent.id,
            prompt: pausedPrompt as string,
            model: pausedModel as 'haiku' | 'sonnet' | 'opus',
            userId,
            replyTo: chatId,
            threadId,
            images: pausedImages as Array<{data: string; mimeType: string}> | undefined,
          });
        }
        userContextManager.clearContext(userId);
      }

      userContextManager.clearDirectoryNavigation(userId);
    }
    else if (action.startsWith('rec:')) {
      // Recent workspace - start tree navigation at that path
      const idx = parseInt(action.replace('rec:', ''), 10);
      const recents = navState?.baseOptions || persistenceService.getRecentWorkspaces(userId).slice(0, 3);
      const selectedPath = recents[idx];

      if (selectedPath && existsSync(selectedPath)) {
        userContextManager.updateDirectoryPath(userId, selectedPath);
        await showWorkspaceDirectoryBrowser(chatId, getThreadId(), userId);
      } else {
        await sendTelegramMessage(chatId,
          `❌ Caminho não encontrado: \`${selectedPath || '(inválido)'}\``,
          undefined,
          getThreadId()
        );
      }
    }
    else if (action === 'custom') {
      // Ask user to type a base path
      userContextManager.setAwaitingDirectoryInput(userId, 'custom_base_path');
      await sendTelegramMessage(chatId,
        '📁 Envie o caminho absoluto do diretório base:\n\n' +
        '_Exemplo: `/Users/lucas/projetos`_',
        undefined,
        getThreadId()
      );
    }
    else if (action === 'up') {
      // Navigate up
      if (navState) {
        const parentPath = navigateUp(navState.currentPath);
        userContextManager.updateDirectoryPath(userId, parentPath);
        await showWorkspaceDirectoryBrowser(chatId, getThreadId(), userId);
      }
    }
    else if (action.startsWith('into:')) {
      // Navigate into subdirectory by index
      const idx = parseInt(action.replace('into:', ''), 10);
      if (navState && navState.visibleDirectories[idx]) {
        const newPath = navigateInto(navState.currentPath, navState.visibleDirectories[idx]);
        userContextManager.updateDirectoryPath(userId, newPath);
        await showWorkspaceDirectoryBrowser(chatId, getThreadId(), userId);
      }
    }
    else if (action === 'select') {
      // Select current directory as workspace
      if (!navState) return;

      const selectedPath = navState.currentPath;

      // Validate path
      let isDirectory = false;
      try {
        isDirectory = statSync(selectedPath).isDirectory();
      } catch {
        // not found
      }

      if (!isDirectory) {
        await sendTelegramMessage(chatId,
          `❌ Caminho não encontrado: \`${selectedPath}\``,
          undefined,
          getThreadId()
        );
        return;
      }

      // Topic creation flow: restore flowData and finish creation
      if (navState.creationContext) {
        const { flow, flowData } = navState.creationContext;
        userContextManager.setContext(userId, {
          userId,
          currentFlow: flow,
          flowState: 'awaiting_topic_workspace',
          flowData: {
            ...flowData,
            topicWorkspace: selectedPath,
          },
        });

        persistenceService.addRecentWorkspace(userId, selectedPath);
        userContextManager.clearDirectoryNavigation(userId);
        await finishTopicCreation(chatId, userId);
        return;
      }

      // Existing topic workspace update flow
      const topicId = navState.targetTopicId || (context?.flowData?.topicId as string);
      if (!topicId) return;

      topicManager.updateTopicWorkspace(agent.id, topicId, selectedPath);
      persistenceService.addRecentWorkspace(userId, selectedPath);
      const threadId = getThreadId();

      await sendTelegramMessage(chatId,
        `✅ Workspace atualizado\n📁 \`${selectedPath}\``,
        undefined,
        threadId
      );

      // Resume paused task if workspace_not_found
      if (isWorkspaceNotFound && context?.flowData) {
        const { pausedPrompt, pausedModel, pausedImages } = context.flowData;
        if (pausedPrompt && pausedModel) {
          await sendTelegramMessage(chatId, '🔄 Retomando processamento do prompt...', undefined, threadId);
          queueManager.enqueue({
            agentId: agent.id,
            prompt: pausedPrompt as string,
            model: pausedModel as 'haiku' | 'sonnet' | 'opus',
            userId,
            replyTo: chatId,
            threadId,
            images: pausedImages as Array<{data: string; mimeType: string}> | undefined,
          });
        }
        userContextManager.clearContext(userId);
      }

      userContextManager.clearDirectoryNavigation(userId);
    }
    else if (action === 'filter') {
      // Ask user to type filter text
      userContextManager.setAwaitingDirectoryInput(userId, 'filter');
      await sendTelegramMessage(chatId,
        '🔎 Digite o texto do filtro:',
        undefined,
        getThreadId()
      );
    }
    else if (action === 'clearfilter') {
      // Clear active filter
      userContextManager.clearDirectoryFilter(userId);
      await showWorkspaceDirectoryBrowser(chatId, getThreadId(), userId);
    }
    else if (action === 'cancel') {
      // Topic creation flow: restore previous flowState and show workspace question again
      if (navState?.creationContext) {
        const { flow, flowData } = navState.creationContext;
        userContextManager.setContext(userId, {
          userId,
          currentFlow: flow,
          flowState: 'awaiting_topic_workspace',
          flowData,
        });

        userContextManager.clearDirectoryNavigation(userId);

        await sendTelegramMessage(chatId, '❌ Seleção cancelada. Use os botões para escolher workspace ou pular.');
        await sendTopicWorkspaceQuestion(chatId);
        return;
      }

      // Cancel navigation
      userContextManager.clearDirectoryNavigation(userId);

      // Also cancel workspace_not_found flow if active
      if (isWorkspaceNotFound) {
        userContextManager.clearContext(userId);
      }

      await sendTelegramMessage(chatId,
        '❌ Seleção de workspace cancelada.',
        undefined,
        getThreadId()
      );
    }
  }
}

/**
 * Handle Telegram status command
 */
async function handleTelegramStatus(chatId: number, userId: string): Promise<void> {
  const agents = agentManager.listAgents(userId).filter(a => a.name !== 'Ronin');

  await sendTelegramStatusOverview(chatId, agents.map(a => ({
    name: a.name,
    emoji: a.emoji || '🤖',
    status: a.status,
    statusDetails: a.statusDetails,
  })));
}

/**
 * Handle Telegram agent menu callback (uses enhanced UI)
 */
async function handleTelegramAgentMenuCallback(chatId: number, userId: string, agentId: string): Promise<void> {
  const agent = agentManager.getAgent(agentId);
  if (!agent || agent.userId !== userId) {
    await sendTelegramMessage(chatId, 'Agente não encontrado.');
    return;
  }

  await sendTelegramAgentMenu(chatId, {
    id: agent.id,
    name: agent.name,
    emoji: agent.emoji || '🤖',
    status: agent.status,
    statusDetails: agent.statusDetails,
    workspace: agent.workspace,
    modelMode: agent.modelMode,
    telegramChatId: agent.telegramChatId,
  });
}

/**
 * Handle Telegram history callback
 */
async function handleTelegramHistoryCallback(chatId: number, agent: Agent): Promise<void> {
  if (agent.outputs.length === 0) {
    await sendTelegramMessage(chatId, `📜 *Histórico de ${agent.name}*\n\nNenhuma interação ainda.`);
    return;
  }

  await sendTelegramAgentHistory(chatId, agent.name, agent.outputs.slice(-5).map(o => ({
    id: o.id,
    summary: o.summary,
    prompt: o.prompt,
    status: o.status,
    model: o.model,
    timestamp: o.timestamp,
  })));
}

/**
 * Handle /link command for linking a Telegram group to an agent
 * Must be called from within a group chat
 */
async function handleTelegramLinkCommand(chatId: number, userId: string): Promise<void> {
  // Verify this is a group chat (groups have negative IDs in Telegram)
  if (chatId > 0) {
    await sendTelegramMessage(chatId,
      '⚠️ *Comando inválido*\n\n' +
      'O comando /link só funciona em grupos.\n\n' +
      '*Para vincular um agente:*\n' +
      '1️⃣ Crie um grupo no Telegram\n' +
      '2️⃣ Adicione @ClaudeTerminalBot ao grupo\n' +
      '3️⃣ Envie /link no grupo'
    );
    return;
  }

  // Find user's most recently created agent without a telegram chat ID
  const agents = agentManager.listAgents(userId)
    .filter(a => a.name !== 'Ronin' && !a.telegramChatId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  // Also check if there's a pending agent link for this user
  const pendingAgentId = pendingAgentLink.get(userId);
  let targetAgent = pendingAgentId ? agentManager.getAgent(pendingAgentId) : null;

  // If no pending agent, use most recent unlinked agent
  if (!targetAgent || targetAgent.telegramChatId) {
    if (agents.length === 0) {
      await sendTelegramMessage(chatId,
        '❌ *Nenhum agente disponível para vincular*\n\n' +
        'Crie um agente primeiro com /criar no chat privado.'
      );
      return;
    }
    targetAgent = agents[0];
  }

  // Check if this group is already linked to an agent
  const existingAgent = agentManager.getAgentByTelegramChatId(chatId);
  if (existingAgent) {
    await sendTelegramMessage(chatId,
      `⚠️ *Grupo já vinculado*\n\n` +
      `Este grupo está conectado ao agente *${existingAgent.name}*.\n` +
      `Cada grupo só pode ter um agente.`
    );
    return;
  }

  // Link the group to the agent
  const success = agentManager.setTelegramChatId(targetAgent.id, chatId);

  if (success) {
    // Clear pending link if any
    pendingAgentLink.delete(userId);

    // Send confirmation in the group
    await sendGroupLinkedConfirmation(chatId, targetAgent.name, targetAgent.emoji || '🤖');

    // Also notify user's private chat if available
    const prefs = persistenceService.loadUserPreferences(userId);
    if (prefs?.telegramChatId && prefs.telegramChatId !== chatId) {
      await sendTelegramMessage(prefs.telegramChatId,
        `✅ *Grupo vinculado!*\n\n` +
        `Agente *${targetAgent.emoji || '🤖'} ${targetAgent.name}* agora está conectado ao grupo.`
      );
    }

    console.log(`Linked Telegram group ${chatId} to agent ${targetAgent.name} (${targetAgent.id})`);
  } else {
    // Rollback: delete the agent if linking failed and it was just created
    const wasJustCreated = pendingAgentLink.get(userId) === targetAgent.id;
    if (wasJustCreated) {
      agentManager.deleteAgent(targetAgent.id);
      pendingAgentLink.delete(userId);
      console.log(`Rolled back agent ${targetAgent.id} creation due to linking failure`);
    }

    await sendTelegramMessage(chatId,
      '❌ *Erro ao vincular grupo*\n\n' +
      'Tente novamente ou crie um novo agente.'
    );
  }
}

// =============================================================================
// Enhanced Topic Management Callback Handlers
// =============================================================================

/**
 * Helper to find topic and its agent
 */
function findTopicAndAgent(topicId: string): { topic: TopicListItem | undefined; agentId: string | undefined } {
  const agentsWithTopics = topicManager.listAgentsWithTopics();
  for (const agentId of agentsWithTopics) {
    const topic = topicManager.getTopic(agentId, topicId);
    if (topic) {
      // Get Ralph loop status if applicable
      let ralphStatus: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'blocked' | undefined;
      let currentIteration: number | undefined;
      let maxIterations: number | undefined;

      if (topic.type === 'ralph' && topic.loopId) {
        const loop = ralphLoopManager.getLoop(topic.loopId);
        if (loop) {
          ralphStatus = loop.status;
          currentIteration = loop.currentIteration;
          maxIterations = loop.maxIterations;
        }
      }

      const topicItem: TopicListItem = {
        id: topic.id,
        telegramTopicId: topic.telegramTopicId,
        emoji: topic.emoji,
        name: topic.name,
        type: topic.type,
        status: topic.status,
        loopId: topic.loopId,
        lastActivity: topic.lastActivity,
        currentIteration,
        maxIterations,
        ralphStatus,
      };
      return { topic: topicItem, agentId };
    }
  }
  return { topic: undefined, agentId: undefined };
}

/**
 * Handle topic detail view callback
 */
async function handleTopicDetailCallback(chatId: number, userId: string, topicId: string): Promise<void> {
  const { topic, agentId } = findTopicAndAgent(topicId);

  if (!topic || !agentId) {
    await sendTelegramMessage(chatId, '⚠️ Tópico não encontrado.');
    return;
  }

  const agent = agentManager.getAgent(agentId);
  if (!agent || agent.userId !== userId) {
    await sendTelegramMessage(chatId, '⚠️ Tópico não encontrado.');
    return;
  }

  await sendTopicDetailView(chatId, topic, agent.telegramChatId || chatId);
}

/**
 * Handle topic goto (navigate to) callback
 */
async function handleTopicGotoCallback(chatId: number, userId: string, topicId: string): Promise<void> {
  const { topic, agentId } = findTopicAndAgent(topicId);

  if (!topic || !agentId) {
    await sendTelegramMessage(chatId, '⚠️ Tópico não encontrado.');
    return;
  }

  const agent = agentManager.getAgent(agentId);
  if (!agent || agent.userId !== userId) {
    await sendTelegramMessage(chatId, '⚠️ Tópico não encontrado.');
    return;
  }

  const targetChatId = agent.telegramChatId || chatId;
  await sendTopicNavigationLink(chatId, topic.name, topic.emoji, targetChatId, topic.telegramTopicId);
}

/**
 * Handle confirm close topic callback (show confirmation modal)
 */
async function handleTopicConfirmCloseCallback(chatId: number, userId: string, topicId: string): Promise<void> {
  const { topic, agentId } = findTopicAndAgent(topicId);

  if (!topic || !agentId) {
    await sendTelegramMessage(chatId, '⚠️ Tópico não encontrado.');
    return;
  }

  const agent = agentManager.getAgent(agentId);
  if (!agent || agent.userId !== userId) {
    await sendTelegramMessage(chatId, '⚠️ Tópico não encontrado.');
    return;
  }

  await sendTopicCloseConfirmation(chatId, topic);
}

/**
 * Handle topic close confirmed callback
 */
async function handleTopicCloseConfirmedCallback(chatId: number, userId: string, topicId: string): Promise<void> {
  const { topic, agentId } = findTopicAndAgent(topicId);

  if (!topic || !agentId) {
    await sendTelegramMessage(chatId, '⚠️ Tópico não encontrado.');
    return;
  }

  const agent = agentManager.getAgent(agentId);
  if (!agent || agent.userId !== userId) {
    await sendTelegramMessage(chatId, '⚠️ Tópico não encontrado.');
    return;
  }

  const targetChatId = agent.telegramChatId || chatId;
  const success = await topicManager.closeTopic(agentId, topicId, targetChatId);

  if (success) {
    // Send feedback in the topic being closed
    await sendCloseFeedback(targetChatId, topic.telegramTopicId, topic.name);
    // Send feedback in General topic (chatId)
    await sendTopicActionFeedbackGeneral(chatId, 'closed', topic.name, topic.emoji, topic.type as 'ralph' | 'worktree' | 'session');
  } else {
    await sendTelegramMessage(chatId, '⚠️ Erro ao fechar tópico.');
  }
}

/**
 * Handle confirm delete topic callback (show confirmation modal)
 */
async function handleTopicConfirmDeleteCallback(chatId: number, userId: string, topicId: string): Promise<void> {
  const { topic, agentId } = findTopicAndAgent(topicId);

  if (!topic || !agentId) {
    await sendTelegramMessage(chatId, '⚠️ Tópico não encontrado.');
    return;
  }

  const agent = agentManager.getAgent(agentId);
  if (!agent || agent.userId !== userId) {
    await sendTelegramMessage(chatId, '⚠️ Tópico não encontrado.');
    return;
  }

  await sendTopicDeleteConfirmation(chatId, topic);
}

/**
 * Handle topic delete confirmed callback
 */
async function handleTopicDeleteConfirmedCallback(chatId: number, userId: string, topicId: string): Promise<void> {
  const { topic, agentId } = findTopicAndAgent(topicId);

  if (!topic || !agentId) {
    await sendTelegramMessage(chatId, '⚠️ Tópico não encontrado.');
    return;
  }

  const agent = agentManager.getAgent(agentId);
  if (!agent || agent.userId !== userId) {
    await sendTelegramMessage(chatId, '⚠️ Tópico não encontrado.');
    return;
  }

  const targetChatId = agent.telegramChatId || chatId;
  const topicName = topic.name;
  const topicEmoji = topic.emoji;
  const topicType = topic.type as 'ralph' | 'worktree' | 'session';

  const success = await topicManager.deleteTopic(agentId, topicId, targetChatId, true);

  if (success) {
    // Send feedback in General topic
    await sendTopicActionFeedbackGeneral(chatId, 'deleted', topicName, topicEmoji, topicType);
  } else {
    await sendTelegramMessage(chatId, '⚠️ Erro ao deletar tópico.');
  }
}

/**
 * Handle confirm reset session callback (show confirmation modal)
 */
async function handleTopicConfirmResetCallback(chatId: number, userId: string, topicId: string): Promise<void> {
  const { topic, agentId } = findTopicAndAgent(topicId);

  if (!topic || !agentId) {
    await sendTelegramMessage(chatId, '⚠️ Tópico não encontrado.');
    return;
  }

  const agent = agentManager.getAgent(agentId);
  if (!agent || agent.userId !== userId) {
    await sendTelegramMessage(chatId, '⚠️ Tópico não encontrado.');
    return;
  }

  await sendSessionResetConfirmation(chatId, topic);
}

/**
 * Handle session reset confirmed callback
 */
async function handleTopicResetConfirmedCallback(chatId: number, userId: string, topicId: string): Promise<void> {
  const { topic, agentId } = findTopicAndAgent(topicId);

  if (!topic || !agentId) {
    await sendTelegramMessage(chatId, '⚠️ Tópico não encontrado.');
    return;
  }

  const agent = agentManager.getAgent(agentId);
  if (!agent || agent.userId !== userId) {
    await sendTelegramMessage(chatId, '⚠️ Tópico não encontrado.');
    return;
  }

  // For general topic, clear the main session
  // For other topics, clear the topic's session
  if (topic.type === 'general') {
    terminal.clearSession(userId, agentId);
    topicManager.updateTopicSession(agentId, topicId, undefined);
  } else {
    // Clear topic-specific session by removing sessionId
    topicManager.updateTopicSession(agentId, topicId, undefined);
  }

  const targetChatId = agent.telegramChatId || chatId;
  await sendResetFeedback(targetChatId, topic.telegramTopicId, topic.name);
  await sendTopicActionFeedbackGeneral(chatId, 'reset', topic.name, topic.emoji, topic.type as 'ralph' | 'worktree' | 'session');
}

/**
 * Handle topic reopen callback
 */
async function handleTopicReopenCallback(chatId: number, userId: string, topicId: string): Promise<void> {
  const { topic, agentId } = findTopicAndAgent(topicId);

  if (!topic || !agentId) {
    await sendTelegramMessage(chatId, '⚠️ Tópico não encontrado.');
    return;
  }

  const agent = agentManager.getAgent(agentId);
  if (!agent || agent.userId !== userId) {
    await sendTelegramMessage(chatId, '⚠️ Tópico não encontrado.');
    return;
  }

  const targetChatId = agent.telegramChatId || chatId;
  const success = await topicManager.reopenTopic(agentId, topicId, targetChatId);

  if (success) {
    await sendReopenFeedback(targetChatId, topic.telegramTopicId, topic.name);
    await sendTopicActionFeedbackGeneral(chatId, 'reopened', topic.name, topic.emoji, topic.type as 'ralph' | 'worktree' | 'session');
  } else {
    await sendTelegramMessage(chatId, '⚠️ Erro ao reabrir tópico.');
  }
}

/**
 * Handle topic list back callback
 */
async function handleTopicListBackCallback(chatId: number, userId: string): Promise<void> {
  // Find agent linked to this chat
  const agent = agentManager.getAgentByTelegramChatId(chatId);
  if (!agent || agent.userId !== userId) {
    await sendTelegramMessage(chatId, '⚠️ Agente não encontrado.');
    return;
  }

  await handleTopicosCommand(chatId, agent.id);
}

/**
 * Handle topic creation button callbacks from /topicos menu
 */
async function handleTopicCreateCallback(chatId: number, userId: string, type: 'ralph' | 'worktree' | 'session'): Promise<void> {
  // Find agent linked to this chat
  const agent = agentManager.getAgentByTelegramChatId(chatId);
  if (!agent || agent.userId !== userId) {
    await sendTelegramMessage(chatId, '⚠️ Agente não encontrado.');
    return;
  }

  switch (type) {
    case 'ralph':
      userContextManager.startTopicRalphFlow(userId, agent.id, chatId);
      await sendTopicRalphTaskPrompt(chatId);
      break;
    case 'worktree':
      userContextManager.startTopicWorktreeFlow(userId, agent.id, chatId);
      await sendTopicNamePrompt(chatId, 'worktree');
      break;
    case 'session':
      userContextManager.startTopicSessaoFlow(userId, agent.id, chatId);
      await sendTopicNamePrompt(chatId, 'sessao');
      break;
  }
}

// =============================================================================
// Text Message Handler
// =============================================================================

async function handleTextMessage(
  userId: string,
  text: string,
  messageId?: string,
  groupId?: string
): Promise<{ status: string }> {
  console.log(`> ${text}${groupId ? ` [group: ${groupId}]` : ''}`);

  // Handle group messages via router
  if (groupId) {
    const route = messageRouter.route(userId, groupId, text);

    if (route.action === 'prompt') {
      return handleGroupPrompt(userId, groupId, route.agentId!, route.text!, route.model, messageId);
    }
    if (route.action === 'reject_unlinked_group') {
      await sendUnlinkedGroupMessage(groupId);
      return { status: 'rejected_unlinked_group' };
    }
    // For groups, we don't handle other actions - they must go through the main number
    return { status: 'group_action_not_supported' };
  }

  // Check if user needs onboarding (first time creating agent)
  if (needsOnboarding(userId) && !userContextManager.isInFlow(userId)) {
    const trimmed = text.trim().toLowerCase();
    // If it's a command that would start agent creation, trigger onboarding
    if (trimmed === '/' || trimmed === '/criar' || trimmed === '/new') {
      userContextManager.startOnboardingFlow(userId);
      await sendUserModeSelector(userId);
      return { status: 'onboarding_started' };
    }
  }

  // Handle onboarding flow
  if (userContextManager.getCurrentFlow(userId) === 'onboarding') {
    return handleOnboardingFlow(userId, text, messageId);
  }

  // If in Dojo mode, WhatsApp only accepts Ronin queries (except groups)
  if (isDojoMode(userId) && !groupId) {
    return handleRoninQuery(userId, text, messageId);
  }

  // Handle main number text that isn't a command
  // Check if router wants to reject it (when not in a flow)
  // Only check router when NOT in a flow and NOT pending agent selection
  if (!userContextManager.isInFlow(userId) && !pendingAgentSelection.has(userId)) {
    const route = messageRouter.route(userId, undefined, text);

    if (route.action === 'status') {
      return handleStatusCommand(userId);
    }
    if (route.action === 'reset_all') {
      return handleResetAllCommand(userId);
    }
    // Only reject prompts that are plain text (not commands or bash mode)
    // Commands starting with / or $ or > should fall through to existing handling
    if (route.action === 'reject_prompt') {
      const trimmed = text.trim();
      const isCommand = trimmed.startsWith('/') || trimmed.startsWith('$') || trimmed.startsWith('>');
      if (!isCommand && !userContextManager.isInBashMode(userId)) {
        await sendRejectPrompt(userId);
        return { status: 'rejected_prompt' };
      }
    }
    // menu and bash fall through to existing handling
  }

  // Check for session migration on first interaction
  if (detectOldSessions(userId)) {
    const agents = agentManager.listAgents(userId);
    if (agents.length === 0) {
      // Store the prompt and offer migration
      userContextManager.setPendingPrompt(userId, text, messageId);
      await sendWhatsApp(userId, '⚠️ Detectadas sessões antigas do formato anterior.');
      await sendMigrationOptions(userId);
      return { status: 'migration_offered' };
    }
  }

  // Check if user is in a flow
  if (userContextManager.isInFlow(userId)) {
    return handleFlowTextInput(userId, text, messageId);
  }

  // Handle commands
  if (text === '/') {
    return handleMenuCommand(userId);
  }

  if (text.toLowerCase() === '/reset') {
    return handleResetCommand(userId);
  }

  if (text.toLowerCase() === '/compact') {
    return handleCompactCommand(userId, messageId);
  }

  if (text.toLowerCase() === '/help') {
    return handleHelpCommand(userId);
  }

  // Handle /bash command - enable bash mode
  if (text.toLowerCase() === '/bash') {
    return handleBashModeEnable(userId);
  }

  // Handle /claude command - disable bash mode
  if (text.toLowerCase() === '/claude') {
    return handleBashModeDisable(userId);
  }

  // Check for bash prefix ($ or >) - execute immediately
  if (text.startsWith('$ ') || text.startsWith('> ')) {
    const command = text.slice(2).trim();
    return handleBashCommand(userId, command, messageId);
  }

  // Check if bash mode is enabled - execute all messages as bash
  if (userContextManager.isInBashMode(userId)) {
    return handleBashCommand(userId, text, messageId);
  }

  // Check if there's already a pending agent selection (from agent menu "Enviar prompt")
  const pendingAgent = pendingAgentSelection.get(userId);
  if (pendingAgent) {
    // Check if selected agent is bash type
    const agent = agentManager.getAgent(pendingAgent);
    if (agent?.type === 'bash') {
      // Execute as bash command directly
      pendingAgentSelection.delete(userId);
      return handleBashCommand(userId, text, messageId, agent.workspace);
    }
    // Agent already selected - store prompt and go straight to model selection
    userContextManager.setPendingPrompt(userId, text, messageId);
    await sendModelSelector(userId, messageId);
    return { status: 'awaiting_model_selection' };
  }

  // Regular prompt - check for onboarding
  const agents = agentManager.listAgents(userId);

  if (agents.length === 0) {
    // Flow 1: First Experience (Onboarding)
    return handleOnboarding(userId, text, messageId);
  }

  // Flow 2: Send Prompt (Normal)
  return handleSendPrompt(userId, text, messageId);
}

// =============================================================================
// Image Message Handler
// =============================================================================

async function handleImageMessage(
  userId: string,
  caption: string,
  imageId: string,
  imageMimeType: string,
  messageId?: string,
  imageUrl?: string
): Promise<{ status: string }> {
  console.log(`> [image] ${caption || '(no caption)'}`);

  // Download the image - prefer Kapso URL, fallback to API
  let buffer: Buffer;
  let mimeType: string;

  try {
    await sendWhatsApp(userId, '📷 Recebendo imagem...');

    if (imageUrl) {
      // Use direct Kapso URL
      console.log(`[image] Downloading from Kapso URL...`);
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
      mimeType = imageMimeType || response.headers.get('content-type') || 'image/jpeg';
    } else {
      // Fallback to API download
      console.log(`[image] Downloading via Kapso API...`);
      const imageData = await downloadFromKapso(imageId);
      buffer = imageData.buffer;
      mimeType = imageData.mimeType;
    }

    console.log(`[image] Downloaded ${buffer.length} bytes (${mimeType})`);
  } catch (error) {
    console.error('Failed to download image:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    await sendWhatsApp(userId, `❌ Erro ao baixar imagem: ${errorMessage}`);
    return { status: 'image_download_error' };
  }

  // Convert to base64
  const base64Data = buffer.toString('base64');

  // Validate MIME type for Claude
  const validMimeTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] as const;
  type ValidMimeType = (typeof validMimeTypes)[number];
  const validMimeType: ValidMimeType = validMimeTypes.includes(mimeType as ValidMimeType)
    ? (mimeType as ValidMimeType)
    : 'image/jpeg'; // Default to jpeg if unknown

  const images = [{ data: base64Data, mimeType: validMimeType }];

  // Use caption as prompt, or default text if no caption
  const text = caption || 'Descreva esta imagem.';

  // Check if there's already a pending agent selection (from agent menu "Enviar prompt")
  const pendingAgent = pendingAgentSelection.get(userId);
  if (pendingAgent) {
    // Agent already selected - store prompt with image and go straight to model selection
    userContextManager.setPendingPrompt(userId, text, messageId, images);
    await sendModelSelector(userId, messageId);
    return { status: 'awaiting_model_selection' };
  }

  // Regular prompt flow - check for onboarding
  const agents = agentManager.listAgents(userId);

  if (agents.length === 0) {
    // Flow 1: First Experience (Onboarding) with image
    await sendWhatsApp(userId, '👋 Criando agente "General" para você...');
    const agent = agentManager.createAgent(userId, 'General');
    console.log(`Created agent 'General' for user ${userId}`);

    // Store the prompt with image and agent selection
    userContextManager.setPendingPrompt(userId, text, messageId, images);
    pendingAgentSelection.set(userId, agent.id);

    // Show model selector
    await sendModelSelector(userId, messageId);
    return { status: 'onboarding_model_selection' };
  }

  // Flow 2: Send Prompt (Normal) with image
  // Store the prompt with image
  userContextManager.setPendingPrompt(userId, text, messageId, images);

  // Get sorted agents
  const sortedAgents = agentManager.listAgentsSorted(userId);

  // Show agent selection
  await sendAgentSelector(userId, sortedAgents, messageId);

  // Show "Continue with last choice" button if user has a previous selection
  const lastChoice = userContextManager.getLastChoice(userId);
  if (lastChoice) {
    const lastAgent = agentManager.getAgent(lastChoice.agentId);
    if (lastAgent) {
      await sendContinueWithLastChoice(userId, lastChoice.agentName, lastChoice.model, messageId);
    } else {
      userContextManager.clearLastChoice(userId);
    }
  }

  return { status: 'awaiting_agent_selection' };
}

// =============================================================================
// Audio Message Handler
// =============================================================================

async function handleAudioMessage(
  userId: string,
  audioId: string,
  audioMimeType: string,
  messageId?: string,
  audioUrl?: string
): Promise<{ status: string }> {
  console.log(`> [audio] Received audio message`);

  // Download the audio
  let buffer: Buffer;
  let mimeType: string;

  try {
    if (audioUrl) {
      // Use direct Kapso URL
      console.log(`[audio] Downloading from Kapso URL...`);
      const response = await fetch(audioUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch audio: ${response.status}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      buffer = Buffer.from(arrayBuffer);
      mimeType = audioMimeType || response.headers.get('content-type') || 'audio/ogg';
    } else {
      // Fallback to API download
      console.log(`[audio] Downloading via Kapso API...`);
      const audioData = await downloadFromKapso(audioId);
      buffer = audioData.buffer;
      mimeType = audioData.mimeType;
    }

    console.log(`[audio] Downloaded ${buffer.length} bytes (${mimeType})`);
  } catch (error) {
    console.error('Failed to download audio:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    await sendWhatsApp(userId, `❌ Erro ao baixar áudio: ${errorMessage}`);
    return { status: 'audio_download_error' };
  }

  // Transcribe using Whisper
  const result = await transcribeAudio(buffer, mimeType);

  if (!result.success || !result.text) {
    console.error('Transcription failed:', result.error);
    // Mark that user came from failed transcription for manual fallback
    userContextManager.setFailedTranscription(userId, true);
    await sendTranscriptionError(userId, messageId);
    return { status: 'transcription_failed' };
  }

  const transcribedText = result.text;
  console.log(`[audio] Transcribed: "${transcribedText}"`);

  // Show transcription preview (cropped to 100 chars)
  const preview = transcribedText.length > 100
    ? transcribedText.slice(0, 100) + '...'
    : transcribedText;
  await sendWhatsApp(userId, `🎤 _"${preview}"_`);

  // Now treat the transcribed text as a regular text message
  return handleTextMessage(userId, transcribedText, messageId);
}

// =============================================================================
// Group and Status Handlers
// =============================================================================

/**
 * Handle prompt from a group (linked to an agent)
 */
async function handleGroupPrompt(
  userId: string,
  groupId: string,
  agentId: string,
  text: string,
  model: 'haiku' | 'sonnet' | 'opus' | undefined,
  messageId?: string
): Promise<{ status: string }> {
  const agent = agentManager.getAgent(agentId);
  if (!agent) {
    await sendWhatsApp(groupId, '❌ Agente não encontrado.');
    return { status: 'agent_not_found' };
  }

  // If model not specified and agent uses selection mode, ask
  if (!model && agent.modelMode === 'selection') {
    userContextManager.setPendingPrompt(userId, text, messageId);
    pendingAgentSelection.set(userId, agentId);
    await sendModelSelector(groupId, messageId);
    return { status: 'awaiting_model' };
  }

  // Use specified model or agent's fixed model
  const finalModel = model || (agent.modelMode as 'haiku' | 'sonnet' | 'opus');

  // Only notify for queue case (when agent is busy)
  if (agent.status === 'processing') {
    await sendWhatsApp(
      groupId,
      `⏳ Agente *${agent.name}* ocupado. Prompt enfileirado. Você será notificado quando iniciar.`
    );
  }

  // Enqueue task - respond to the group
  const task = queueManager.enqueue({
    agentId: agent.id,
    prompt: text,
    model: finalModel,
    userId,
    replyTo: groupId, // Send response to group
  });

  console.log(`Task ${task.id} enqueued for agent ${agent.name} (group: ${groupId})`);
  return { status: 'queued' };
}

/**
 * Handle /status command
 */
async function handleStatusCommand(userId: string): Promise<{ status: string }> {
  const agents = agentManager.listAgents(userId);

  if (agents.length === 0) {
    await sendWhatsApp(userId, '📭 Nenhum agente criado.\n\nDigite / para criar um agente.');
    return { status: 'no_agents' };
  }

  const lines = agents.map((a) => {
    const emoji = a.emoji || '🤖';
    const status = STATUS_EMOJI[a.status] || '❓';
    const mode = a.modelMode === 'selection' ? '🔄' : `⚡${a.modelMode}`;
    return `${emoji} *${a.name}* ${status}\n   ${mode} | ${a.statusDetails}`;
  });

  await sendWhatsApp(userId, `📊 *Status dos agentes*\n\n${lines.join('\n\n')}`);
  return { status: 'status_sent' };
}

/**
 * Handle /reset all command
 */
async function handleResetAllCommand(userId: string): Promise<{ status: string }> {
  const agents = agentManager.listAgents(userId);
  let count = 0;

  for (const agent of agents) {
    if (agent.sessionId) {
      terminal.clearSession(userId, agent.id);
      agentManager.clearSessionId(agent.id);
      count++;
    }
  }

  await sendWhatsApp(userId, `✅ ${count} sessão(ões) resetada(s).`);
  return { status: 'reset_all' };
}

// =============================================================================
// Flow Handlers
// =============================================================================

/**
 * Flow 1: First Experience (Onboarding)
 */
async function handleOnboarding(
  userId: string,
  text: string,
  messageId?: string
): Promise<{ status: string }> {
  await sendWhatsApp(userId, '👋 Criando agente "General" para você...');

  // Create the default "General" agent
  const agent = agentManager.createAgent(userId, 'General');
  console.log(`Created agent 'General' for user ${userId}`);

  // Store the prompt and agent selection
  userContextManager.setPendingPrompt(userId, text, messageId);
  pendingAgentSelection.set(userId, agent.id);

  // Show model selector
  await sendModelSelector(userId, messageId);

  return { status: 'onboarding_model_selection' };
}

/**
 * Flow 2: Send Prompt (Normal)
 */
async function handleSendPrompt(
  userId: string,
  text: string,
  messageId?: string
): Promise<{ status: string }> {
  // Store the prompt
  userContextManager.setPendingPrompt(userId, text, messageId);

  // Get sorted agents
  const agents = agentManager.listAgentsSorted(userId);

  // Flow 3: Check if any agents are processing
  const activeAgents = agents.filter((a) => a.status === 'processing');
  if (activeAgents.length > 0) {
    const names = activeAgents.map((a) => `*${a.name}*`).join(', ');
    await sendWhatsApp(
      userId,
      `⚠️ Agentes em execução: ${names}. Seu prompt será enfileirado se selecionar agente ocupado.`
    );
  }

  // Show agent selection list (first step)
  await sendAgentSelector(userId, agents, messageId);

  // Show "Continue with last choice" button if user has a previous selection
  const lastChoice = userContextManager.getLastChoice(userId);
  if (lastChoice) {
    // Verify the agent still exists
    const lastAgent = agentManager.getAgent(lastChoice.agentId);
    if (lastAgent) {
      await sendContinueWithLastChoice(userId, lastChoice.agentName, lastChoice.model, messageId);
    } else {
      // Clear invalid last choice
      userContextManager.clearLastChoice(userId);
    }
  }

  return { status: 'awaiting_agent_selection' };
}

/**
 * Flow 4: Create New Agent
 */
async function handleCreateAgentFlow(userId: string): Promise<{ status: string }> {
  userContextManager.startCreateAgentFlow(userId);
  await sendWhatsApp(userId, 'Nome do agente?');
  return { status: 'awaiting_agent_name' };
}

/**
 * Flow 5: Menu Principal (/)
 */
async function handleMenuCommand(userId: string): Promise<{ status: string }> {
  const agents = agentManager.listAgentsSorted(userId);
  const bashModeEnabled = userContextManager.isInBashMode(userId);
  await sendAgentsList(userId, agents, undefined, bashModeEnabled);
  return { status: 'menu_shown' };
}

/**
 * Flow 7: Reset Agent(s)
 */
async function handleResetCommand(userId: string): Promise<{ status: string }> {
  const agents = agentManager.listAgents(userId);

  if (agents.length === 0) {
    await sendWhatsApp(userId, 'Nenhum agente para resetar.');
    return { status: 'no_agents' };
  }

  await sendAgentSelectionForReset(userId, agents);
  return { status: 'awaiting_reset_selection' };
}

/**
 * Delete agents from main menu
 */
async function handleDeleteAgentsCommand(userId: string): Promise<{ status: string }> {
  const agents = agentManager.listAgents(userId);

  if (agents.length === 0) {
    await sendWhatsApp(userId, 'Nenhum agente para remover.');
    return { status: 'no_agents' };
  }

  await sendAgentSelectionForDelete(userId, agents);
  return { status: 'awaiting_delete_selection' };
}

/**
 * Flow 8: Configure Limit
 */
async function handleConfigureLimitCommand(userId: string): Promise<{ status: string }> {
  userContextManager.startConfigureLimitFlow(userId);
  const currentLimit = semaphore.getMaxPermits();
  await sendConfigureLimitMenu(userId, currentLimit);
  return { status: 'awaiting_limit_selection' };
}

/**
 * Flow 9: Configure Priority
 */
async function handleConfigurePriorityCommand(
  userId: string,
  agentId?: string
): Promise<{ status: string }> {
  userContextManager.startConfigurePriorityFlow(userId, agentId);

  if (agentId) {
    const agent = agentManager.getAgent(agentId);
    if (agent) {
      await sendConfigurePriorityMenu(userId, agent.name, agent.priority);
      return { status: 'awaiting_priority_selection' };
    }
  }

  // Need to select agent first
  const agents = agentManager.listAgents(userId);
  await sendAgentsList(userId, agents);
  return { status: 'awaiting_agent_for_priority' };
}

/**
 * Compact command
 */
async function handleCompactCommand(
  userId: string,
  messageId?: string
): Promise<{ status: string }> {
  userContextManager.setPendingPrompt(userId, '/compact', messageId);

  const agents = agentManager.listAgents(userId);
  if (agents.length === 0) {
    await sendWhatsApp(userId, 'Nenhum agente para compactar.');
    return { status: 'no_agents' };
  }

  await sendAgentsList(userId, agents, messageId);
  return { status: 'awaiting_agent_for_compact' };
}

/**
 * Help command
 */
async function handleHelpCommand(userId: string): Promise<{ status: string }> {
  await sendWhatsApp(
    userId,
    '*Claude Terminal - Ajuda*\n\n' +
      '*Comandos:*\n' +
      '/ - Menu principal\n' +
      '/reset - Limpar sessão\n' +
      '/compact - Compactar contexto\n' +
      '/bash - Ativar modo bash\n' +
      '/claude - Voltar ao modo normal\n' +
      '/help - Esta mensagem\n\n' +
      '*Modo Bash:*\n' +
      'Use `$ comando` para executar bash direto.\n' +
      'Ou ative o modo bash com /bash.\n\n' +
      '*Agentes:*\n' +
      'Cada agente mantém seu próprio contexto de conversa.\n' +
      'Você pode criar agentes com workspaces específicos.\n' +
      'Agentes de alta prioridade são processados primeiro.\n\n' +
      '*Modelos:*\n' +
      'Haiku - Rápido e econômico\n' +
      'Sonnet - Equilibrado\n' +
      'Opus - Mais capaz e detalhado'
  );
  return { status: 'help_shown' };
}

/**
 * Enable bash mode
 */
async function handleBashModeEnable(userId: string): Promise<{ status: string }> {
  userContextManager.enableBashMode(userId);
  await sendWhatsApp(
    userId,
    '🖥️ *Modo Bash ativado*\n\n' +
      'Todas as mensagens serão executadas como comandos no terminal.\n\n' +
      'Use `/claude` para voltar ao modo normal.'
  );
  return { status: 'bash_mode_enabled' };
}

/**
 * Disable bash mode
 */
async function handleBashModeDisable(userId: string): Promise<{ status: string }> {
  userContextManager.disableBashMode(userId);
  await sendWhatsApp(
    userId,
    '🤖 *Modo Claude ativado*\n\n' +
      'Mensagens serão enviadas para agentes Claude.\n\n' +
      'Use `/bash` para modo terminal ou `$ comando` para execução rápida.'
  );
  return { status: 'bash_mode_disabled' };
}

/**
 * Execute bash command and send result
 */
async function handleBashCommand(
  userId: string,
  command: string,
  messageId?: string,
  workspace?: string
): Promise<{ status: string }> {
  // Use provided workspace, last bash workspace, or home directory
  const cwd = workspace || userContextManager.getLastBashWorkspace(userId) || process.env.HOME || '/tmp';

  // Update last bash workspace
  if (cwd !== process.env.HOME) {
    userContextManager.setLastBashWorkspace(userId, cwd);
  }

  const result = await executeCommand(command, { cwd });
  const formatted = formatBashResult(result);

  // Check if output was truncated - send file with full output
  if (result.truncated && result.output.length > DEFAULTS.BASH_TRUNCATE_AT) {
    // Send truncated message first
    await sendWhatsApp(userId, formatted);

    // Upload full output as file
    try {
      const filename = getFullOutputFilename(command);
      const fullOutput = `$ ${command}\n\n${result.output}\n\nExit code: ${result.exitCode}\nDuration: ${result.duration}ms`;
      const buffer = Buffer.from(fullOutput, 'utf-8');

      const mediaId = await uploadToKapso(buffer, filename, 'text/plain');
      if (mediaId) {
        await sendWhatsAppMedia(userId, mediaId, 'document', filename, 'Saída completa');
      }
    } catch (err) {
      console.error('Failed to upload bash output:', err);
    }
  } else {
    await sendWhatsApp(userId, formatted);
  }

  return { status: 'bash_executed' };
}

/**
 * Handle text input during a flow
 */
async function handleFlowTextInput(
  userId: string,
  text: string,
  messageId?: string
): Promise<{ status: string }> {
  const flow = userContextManager.getCurrentFlow(userId);

  // Create Agent Flow
  if (flow === 'create_agent') {
    if (userContextManager.isAwaitingAgentName(userId)) {
      // Validate and set name
      try {
        // Basic validation before setting
        if (!text.trim()) {
          await sendWhatsApp(userId, '❌ Nome não pode ser vazio. Tente novamente:');
          return { status: 'awaiting_agent_name' };
        }

        userContextManager.setAgentName(userId, text.trim());
        // Now ask for agent type
        await sendAgentTypeSelector(userId, messageId);
        return { status: 'awaiting_type' };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        await sendWhatsApp(userId, `❌ ${msg}. Tente novamente:`);
        return { status: 'awaiting_agent_name' };
      }
    }

    if (userContextManager.isAwaitingWorkspace(userId)) {
      const workspace = text.trim();

      try {
        // Just store workspace and go to model mode selector
        userContextManager.setAgentWorkspace(userId, workspace);
        await sendModelModeSelector(userId);
        return { status: 'awaiting_model_mode_choice' };
      } catch (error) {
        if (error instanceof AgentValidationError) {
          await sendWhatsApp(userId, `❌ ${error.message}. Tente novamente:`);
          return { status: 'awaiting_workspace' };
        }
        throw error;
      }
    }
  }

  // Edit Emoji Flow
  if (flow === 'edit_emoji') {
    if (userContextManager.isAwaitingEmojiText(userId)) {
      const data = userContextManager.getEditEmojiData(userId);
      if (!data?.agentId) {
        userContextManager.completeFlow(userId);
        await sendWhatsApp(userId, '❌ Erro: agente não encontrado.');
        return { status: 'error' };
      }

      const emoji = text.trim();

      // Basic emoji validation - check if it's a single emoji-like character
      // This is a simple check; emojis are complex in Unicode
      if (emoji.length === 0 || emoji.length > 10) {
        await sendWhatsApp(userId, '❌ Envie apenas um emoji. Tente novamente:');
        return { status: 'awaiting_emoji_text' };
      }

      try {
        agentManager.updateEmoji(data.agentId, emoji);
        const agent = agentManager.getAgent(data.agentId);
        userContextManager.completeFlow(userId);
        await sendWhatsApp(userId, `✅ Emoji do agente *${agent?.name}* atualizado para ${emoji}`);
        return { status: 'emoji_updated' };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        await sendWhatsApp(userId, `❌ ${msg}`);
        userContextManager.completeFlow(userId);
        return { status: 'error' };
      }
    }
  }

  // Configure Ralph Flow
  if (flow === 'configure_ralph') {
    if (userContextManager.isAwaitingRalphTask(userId)) {
      const task = text.trim();

      if (!task || task.length < 10) {
        await sendWhatsApp(userId, '❌ Descreva a tarefa de forma mais detalhada (mínimo 10 caracteres):');
        return { status: 'awaiting_ralph_task' };
      }

      try {
        userContextManager.setRalphTask(userId, task);
        await sendRalphConfigFlow(userId, task, messageId);
        return { status: 'awaiting_ralph_iterations' };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        await sendWhatsApp(userId, `❌ ${msg}`);
        return { status: 'error' };
      }
    }
  }

  // Not in a recognized flow state
  userContextManager.clearContext(userId);
  return handleTextMessage(userId, text, messageId);
}

// =============================================================================
// Button Reply Handler
// =============================================================================

async function handleButtonReply(
  userId: string,
  buttonId: string
): Promise<{ status: string }> {
  console.log(`> Button: ${buttonId}`);

  // Bash mode toggle
  if (buttonId === 'bashmode_enable') {
    return handleBashModeEnable(userId);
  }
  if (buttonId === 'bashmode_disable') {
    return handleBashModeDisable(userId);
  }

  // Continue with last choice
  if (buttonId.startsWith('continue_last_choice_')) {
    return handleContinueWithLastChoice(userId);
  }

  // Model selection
  if (buttonId.startsWith('model_')) {
    return handleModelSelection(userId, buttonId);
  }

  // Migration options
  if (buttonId.startsWith('migration_')) {
    return handleMigrationChoice(userId, buttonId);
  }

  // Error recovery
  if (buttonId.startsWith('error_')) {
    return handleErrorRecovery(userId, buttonId);
  }

  // Confirmation buttons
  if (buttonId.startsWith('confirm_')) {
    return handleConfirmation(userId, buttonId);
  }

  // New agent prompt
  if (buttonId.startsWith('newagent_')) {
    return handleNewAgentChoice(userId, buttonId);
  }

  // Transcription manual fallback
  if (buttonId.startsWith('transcription_manual_')) {
    return handleTranscriptionManualFallback(userId);
  }

  // Agent mode selection during agent creation (Conversational vs Ralph)
  if (buttonId === 'mode_conversational') {
    userContextManager.setAgentMode(userId, 'conversational');
    await sendWorkspaceSelector(userId);
    return { status: 'workspace_selector_sent' };
  }

  if (buttonId === 'mode_ralph') {
    userContextManager.setAgentMode(userId, 'ralph');
    await sendWorkspaceSelector(userId);
    return { status: 'workspace_selector_sent' };
  }

  // Mode selection (Conversational vs Ralph) - legacy with suffix
  if (buttonId.startsWith('mode_conversational_') || buttonId.startsWith('mode_ralph_')) {
    return handleModeSelection(userId, buttonId);
  }

  // Ralph iterations selection
  if (buttonId.startsWith('ralph_iterations_')) {
    return handleRalphIterationsSelection(userId, buttonId);
  }

  // Ralph loop controls
  if (buttonId.startsWith('ralph_pause_')) {
    return handleRalphPause(userId);
  }
  if (buttonId.startsWith('ralph_resume_')) {
    return handleRalphResume(userId);
  }
  if (buttonId.startsWith('ralph_cancel_')) {
    return handleRalphCancel(userId);
  }
  if (buttonId.startsWith('ralph_retry_')) {
    return handleRalphRetry(userId);
  }
  if (buttonId.startsWith('ralph_details_')) {
    return handleRalphDetails(userId);
  }
  if (buttonId.startsWith('ralph_restart_')) {
    return handleRalphRestart(userId);
  }
  if (buttonId.startsWith('ralph_dismiss_')) {
    // Just acknowledge - no action needed
    return { status: 'dismissed' };
  }

  // User mode selection (Ronin/Dojo onboarding)
  if (buttonId === 'usermode_dojo') {
    if (userContextManager.isAwaitingModeSelection(userId)) {
      if (!isTelegramConfigured()) {
        await sendWhatsApp(userId, 'Telegram nao configurado no servidor. Use modo Ronin.');
        userContextManager.clearContext(userId);
        return { status: 'telegram_not_configured' };
      }
      userContextManager.setUserMode(userId, 'dojo');
      await sendTelegramUsernamePrompt(userId);
      return { status: 'awaiting_telegram_username' };
    }
    return { status: 'not_in_onboarding' };
  }

  if (buttonId === 'usermode_ronin') {
    if (userContextManager.isAwaitingModeSelection(userId)) {
      userContextManager.setUserMode(userId, 'ronin');

      // Save preferences
      const prefs: UserPreferences = {
        userId,
        mode: 'ronin',
        onboardingComplete: true,
      };
      persistenceService.saveUserPreferences(prefs);

      await sendRoninActivated(userId);
      return { status: 'ronin_activated' };
    }
    return { status: 'not_in_onboarding' };
  }

  // Generic buttons (Yes/No)
  if (buttonId === 'yes' || buttonId === 'no') {
    return handleGenericConfirmation(userId, buttonId);
  }

  return { status: 'unknown_button' };
}

/**
 * Handle "Descrever manualmente" button after transcription failure
 */
async function handleTranscriptionManualFallback(userId: string): Promise<{ status: string }> {
  // Clear the failed transcription flag
  userContextManager.clearFailedTranscription(userId);

  await sendWhatsApp(userId, 'Ok! Digite o que você queria dizer:');
  return { status: 'awaiting_manual_input' };
}

/**
 * Handle "Continue with last choice" button
 */
async function handleContinueWithLastChoice(userId: string): Promise<{ status: string }> {
  const lastChoice = userContextManager.getLastChoice(userId);
  const pending = userContextManager.getPendingPrompt(userId);

  if (!lastChoice) {
    await sendWhatsApp(userId, 'Nenhuma escolha anterior encontrada.');
    return { status: 'no_last_choice' };
  }

  if (!pending) {
    await sendWhatsApp(userId, 'Nenhum prompt pendente. Envie uma mensagem primeiro.');
    return { status: 'no_pending' };
  }

  // Verify agent still exists
  const agent = agentManager.getAgent(lastChoice.agentId);
  if (!agent) {
    userContextManager.clearLastChoice(userId);
    await sendWhatsApp(userId, '❌ Agente anterior não encontrado. Selecione outro.');
    return { status: 'agent_not_found' };
  }

  // Use handleAgentModelSelection to process with the stored choice
  return handleAgentModelSelection(userId, lastChoice.agentId, lastChoice.model);
}

/**
 * Handle model selection (Haiku/Opus)
 */
async function handleModelSelection(
  userId: string,
  buttonId: string
): Promise<{ status: string }> {
  const model: Model = buttonId.startsWith('model_opus')
    ? 'opus'
    : buttonId.startsWith('model_sonnet')
      ? 'sonnet'
      : 'haiku';
  const pending = userContextManager.getPendingPrompt(userId);
  const agentId = pendingAgentSelection.get(userId);

  if (!pending || !agentId) {
    await sendWhatsApp(userId, 'Nenhum prompt pendente. Envie uma mensagem primeiro.');
    return { status: 'no_pending' };
  }

  // Clear pending state
  userContextManager.clearPendingPrompt(userId);
  pendingAgentSelection.delete(userId);

  const agent = agentManager.getAgent(agentId);
  if (!agent) {
    await sendWhatsApp(userId, '❌ Agente não encontrado.');
    return { status: 'agent_not_found' };
  }

  console.log(`> [${model}] Agent: ${agent.name}, Prompt: ${pending.text}`);

  // Store last choice for quick repeat
  userContextManager.setLastChoice(userId, agentId, agent.name, model);

  // Note: Error context is stored by QueueManager when errors occur (Flow 11)

  // Only notify for queue case (when agent is busy)
  if (agent.status === 'processing') {
    await sendWhatsApp(
      userId,
      `⏳ Agente *${agent.name}* ocupado. Prompt enfileirado. Você será notificado quando iniciar.`
    );
  }

  // Enqueue task
  const task = queueManager.enqueue({
    agentId,
    prompt: pending.text,
    model,
    userId,
    images: pending.images,
  });

  console.log(`Task ${task.id} enqueued for agent ${agent.name}`);

  return { status: 'task_enqueued' };
}

/**
 * Handle combined agent + model selection
 */
async function handleAgentModelSelection(
  userId: string,
  agentId: string,
  model: Model,
  messageId?: string
): Promise<{ status: string }> {
  const pending = userContextManager.getPendingPrompt(userId);

  if (!pending) {
    await sendWhatsApp(userId, 'Nenhum prompt pendente. Envie uma mensagem primeiro.');
    return { status: 'no_pending' };
  }

  // Clear pending state
  userContextManager.clearPendingPrompt(userId);
  pendingAgentSelection.delete(userId);

  const agent = agentManager.getAgent(agentId);
  if (!agent) {
    await sendWhatsApp(userId, '❌ Agente não encontrado.');
    return { status: 'agent_not_found' };
  }

  console.log(`> [${model}] Agent: ${agent.name}, Prompt: ${pending.text}`);

  // Store last choice for quick repeat
  userContextManager.setLastChoice(userId, agentId, agent.name, model);

  // Only notify for queue case (when agent is busy)
  if (agent.status === 'processing') {
    await sendWhatsApp(
      userId,
      `⏳ Agente *${agent.name}* ocupado. Prompt enfileirado. Você será notificado quando iniciar.`
    );
  }

  // Enqueue task
  const task = queueManager.enqueue({
    agentId,
    prompt: pending.text,
    model,
    userId,
    images: pending.images,
  });

  console.log(`Task ${task.id} enqueued for agent ${agent.name}`);

  return { status: 'task_enqueued' };
}

/**
 * Handle session migration choice
 */
async function handleMigrationChoice(
  userId: string,
  buttonId: string
): Promise<{ status: string }> {
  const choice = buttonId.replace('migration_', '');

  if (choice === 'migrate') {
    // Migrate old sessions
    const { haiku, opus } = migrateOldSessions(userId);

    if (haiku) {
      const agent = agentManager.createAgent(userId, 'Haiku (Migrado)');
      terminal.setSession(userId, agent.id, haiku);
      // Also persist sessionId on the agent for recovery after restart
      agentManager.updateSessionId(agent.id, haiku);
      console.log(`Migrated Haiku session to agent ${agent.id}`);
    }

    if (opus) {
      const agent = agentManager.createAgent(userId, 'Opus (Migrado)');
      terminal.setSession(userId, agent.id, opus);
      // Also persist sessionId on the agent for recovery after restart
      agentManager.updateSessionId(agent.id, opus);
      console.log(`Migrated Opus session to agent ${agent.id}`);
    }

    await sendWhatsApp(userId, '✅ Sessões migradas com sucesso!');

    // Process any pending prompt
    const pending = userContextManager.getPendingPrompt(userId);
    if (pending) {
      return handleSendPrompt(userId, pending.text, pending.messageId);
    }

    return { status: 'migrated' };
  }

  if (choice === 'clear') {
    // Clear old sessions without migrating
    migrateOldSessions(userId); // This removes them from the map
    await sendWhatsApp(userId, '✅ Sessões antigas removidas. Começando do zero.');

    // Process any pending prompt (will trigger onboarding)
    const pending = userContextManager.getPendingPrompt(userId);
    if (pending) {
      userContextManager.clearPendingPrompt(userId);
      return handleTextMessage(userId, pending.text, pending.messageId);
    }

    return { status: 'cleared' };
  }

  if (choice === 'cancel') {
    userContextManager.clearPendingPrompt(userId);
    await sendWhatsApp(userId, 'Operação cancelada.');
    return { status: 'cancelled' };
  }

  return { status: 'unknown_migration_choice' };
}

/**
 * Handle error recovery buttons
 */
async function handleErrorRecovery(
  userId: string,
  buttonId: string
): Promise<{ status: string }> {
  if (buttonId.startsWith('error_retry')) {
    const lastError = queueManager.getLastError(userId);
    if (!lastError) {
      await sendWhatsApp(userId, 'Nenhum erro anterior para retentar.');
      return { status: 'no_error_to_retry' };
    }

    const { agentId, prompt, model } = lastError;
    const agent = agentManager.getAgent(agentId);

    if (!agent) {
      await sendWhatsApp(userId, '❌ Agente não encontrado.');
      return { status: 'agent_not_found' };
    }

    // Clear the error before retrying
    queueManager.clearLastError(userId);

    await sendWhatsApp(userId, `Retentando com ${model}...`);

    queueManager.enqueue({
      agentId,
      prompt,
      model,
      userId,
    });

    return { status: 'retrying' };
  }

  if (buttonId.startsWith('error_log')) {
    // Show detailed error log
    await sendWhatsApp(userId, 'Log detalhado não disponível no momento.');
    return { status: 'log_shown' };
  }

  if (buttonId.startsWith('error_ignore')) {
    queueManager.clearLastError(userId);
    await sendWhatsApp(userId, 'Erro ignorado.');
    return { status: 'ignored' };
  }

  return { status: 'unknown_error_action' };
}

/**
 * Handle confirmation buttons
 */
async function handleConfirmation(
  userId: string,
  buttonId: string
): Promise<{ status: string }> {
  // Reset confirmation
  if (buttonId.startsWith('confirm_reset_')) {
    const agentId = buttonId.replace('confirm_reset_', '');

    if (agentId === 'all') {
      // Reset all agents
      const agents = agentManager.listAgents(userId);
      for (const agent of agents) {
        terminal.clearSession(userId, agent.id);
        agentManager.updateAgentStatus(agent.id, 'idle', 'Aguardando prompt');
      }
      await sendWhatsApp(userId, '✅ Todas as sessões limpas.');
      return { status: 'all_reset' };
    }

    terminal.clearSession(userId, agentId);
    const agent = agentManager.getAgent(agentId);
    if (agent) {
      agentManager.updateAgentStatus(agentId, 'idle', 'Aguardando prompt');
    }
    await sendWhatsApp(userId, '✅ Sessão limpa.');
    return { status: 'reset' };
  }

  // Delete confirmation
  if (buttonId.startsWith('confirm_delete_')) {
    const agentId = buttonId.replace('confirm_delete_', '');

    if (agentId === 'all') {
      // Delete all agents
      const agents = agentManager.listAgents(userId);
      for (const agent of agents) {
        terminal.clearSession(userId, agent.id);
        agentManager.deleteAgent(agent.id);
      }
      // Clear cached selections
      pendingAgentSelection.delete(userId);
      userContextManager.clearLastChoice(userId);
      await sendWhatsApp(userId, `✅ Todos os ${agents.length} agentes deletados.`);
      return { status: 'all_deleted' };
    }

    const agent = agentManager.getAgent(agentId);
    if (!agent) {
      await sendWhatsApp(userId, `❌ Falha ao deletar agente. Agente não encontrado.`);
      return { status: 'delete_failed' };
    }

    // If agent has a group, ask what to do with it
    if (agent.groupId) {
      userContextManager.startDeleteAgentFlow(userId, agentId);
      await sendDeleteGroupChoice(userId, agent.name);
      return { status: 'awaiting_group_choice' };
    }

    // No group, delete directly
    const agentName = agent.name;
    terminal.clearSession(userId, agentId);
    const deleted = agentManager.deleteAgent(agentId);

    if (!deleted) {
      await sendWhatsApp(userId, `❌ Falha ao deletar agente. Agente não encontrado.`);
      return { status: 'delete_failed' };
    }

    // Clear any cached selections that point to the deleted agent
    pendingAgentSelection.delete(userId);
    const lastChoice = userContextManager.getLastChoice(userId);
    if (lastChoice?.agentId === agentId) {
      userContextManager.clearLastChoice(userId);
    }

    await sendWhatsApp(userId, `✅ Agente *${agentName}* deletado.`);
    return { status: 'deleted' };
  }

  // Delete with group - user chose to delete both agent and group
  if (buttonId === 'delete_with_group') {
    const data = userContextManager.getDeleteAgentData(userId);
    if (data?.agentId) {
      const agent = agentManager.getAgent(data.agentId);
      const agentName = agent?.name || 'Unknown';
      if (agent?.groupId) {
        try {
          await deleteWhatsAppGroup(agent.groupId);
        } catch (e) {
          console.error('Failed to delete group:', e);
          // Continue with agent deletion even if group deletion fails
        }
      }
      terminal.clearSession(userId, data.agentId);
      agentManager.deleteAgent(data.agentId);

      // Clear any cached selections that point to the deleted agent
      pendingAgentSelection.delete(userId);
      const lastChoice = userContextManager.getLastChoice(userId);
      if (lastChoice?.agentId === data.agentId) {
        userContextManager.clearLastChoice(userId);
      }

      userContextManager.clearContext(userId);
      await sendWhatsApp(userId, `✅ Agente *${agentName}* e grupo deletados.`);
    }
    return { status: 'deleted_with_group' };
  }

  // Delete but keep group - user chose to keep the group
  if (buttonId === 'delete_keep_group') {
    const data = userContextManager.getDeleteAgentData(userId);
    if (data?.agentId) {
      const agent = agentManager.getAgent(data.agentId);
      const agentName = agent?.name || 'Unknown';
      terminal.clearSession(userId, data.agentId);
      agentManager.deleteAgent(data.agentId);

      // Clear any cached selections that point to the deleted agent
      pendingAgentSelection.delete(userId);
      const lastChoice = userContextManager.getLastChoice(userId);
      if (lastChoice?.agentId === data.agentId) {
        userContextManager.clearLastChoice(userId);
      }

      userContextManager.clearContext(userId);
      await sendWhatsApp(userId, `✅ Agente *${agentName}* deletado. Grupo mantido.`);
    }
    return { status: 'deleted_keep_group' };
  }

  // Cancel deletion
  if (buttonId === 'delete_cancel') {
    userContextManager.clearContext(userId);
    await sendWhatsApp(userId, '❌ Deleção cancelada.');
    return { status: 'cancelled' };
  }

  // Create agent confirmation
  if (buttonId === 'confirm_create') {
    const data = userContextManager.getCreateAgentData(userId);
    if (!data?.agentName) {
      userContextManager.clearContext(userId);
      await sendWhatsApp(userId, '❌ Erro no fluxo. Tente novamente.');
      return { status: 'error' };
    }

    try {
      // Create the agent
      const agent = agentManager.createAgent(
        userId,
        data.agentName,
        data.workspace,
        data.emoji,
        data.agentType || 'claude',
        data.modelMode || 'selection'
      );

      // Set the mode (conversational/ralph)
      if (data.agentMode) {
        agentManager.updateAgentMode(agent.id, data.agentMode);
      }

      // Create WhatsApp group
      const dateStr = new Date().toLocaleDateString('pt-BR');
      const modeText = data.agentMode === 'ralph'
        ? '🔄 Ralph: trabalha sozinho até completar'
        : '💬 Conversacional: responde a cada prompt';
      const description = `📁 ${data.workspace || '~'}\n📅 ${dateStr}\n${modeText}`;
      const groupName = `${data.emoji || '🤖'} ${data.agentName}`;

      const groupId = await createWhatsAppGroup(groupName, description, userId);
      agentManager.setGroupId(agent.id, groupId);

      userContextManager.clearContext(userId);

      // Send confirmation to main number
      const modelModeText = data.modelMode === 'selection'
        ? '🔄 Seleção (pergunta sempre)'
        : `⚡ ${data.modelMode} fixo`;

      await sendWhatsApp(userId, `✅ *Agente criado!*

${data.emoji || '🤖'} *${data.agentName}*
📁 ${data.workspace || 'Sem workspace'}
${modeText}
${modelModeText}

💬 Um grupo foi criado para este agente.
Envie mensagens no grupo para interagir.`);

      // Send welcome message to group
      await sendWhatsApp(groupId, `👋 *Olá! Sou ${data.agentName}.*

${modeText}

Envie uma mensagem para começar.`);

      return { status: 'created' };
    } catch (error) {
      console.error('Error creating agent:', error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      await sendWhatsApp(userId, `❌ Erro ao criar agente: ${errorMsg}`);
      userContextManager.clearContext(userId);
      return { status: 'error' };
    }
  }

  // Cancel create agent
  if (buttonId === 'cancel_create') {
    userContextManager.clearContext(userId);
    await sendWhatsApp(userId, 'Criação de agente cancelada.');
    return { status: 'cancelled' };
  }

  // Cancel confirmation
  if (buttonId === 'confirm_cancel') {
    await sendWhatsApp(userId, 'Operação cancelada.');
    return { status: 'cancelled' };
  }

  // Start Ralph loop confirmation
  if (buttonId.startsWith('confirm_start_ralph_')) {
    const agentId = buttonId.replace('confirm_start_ralph_', '');
    const agent = agentManager.getAgent(agentId);

    if (!agent) {
      await sendWhatsApp(userId, '❌ Agente não encontrado.');
      return { status: 'agent_not_found' };
    }

    // Get the loop ID from the agent
    if (!agent.currentLoopId) {
      await sendWhatsApp(userId, '❌ Nenhum loop configurado para este agente.');
      return { status: 'no_loop_configured' };
    }

    // Send loop started confirmation with action buttons
    await sendButtons(
      userId,
      `🔄 Loop do agente *${agent.name}* iniciado!\n\nO agente está executando a tarefa configurada.`,
      [
        { id: `agentmenu_pause_loop_${agent.id}`, title: '⏸️ Pausar Loop' },
        { id: `agent_${agent.id}`, title: '📊 Ver Detalhes' },
      ]
    );

    const loopId = agent.currentLoopId;

    // Execute the loop asynchronously (don't await - it runs in background)
    ralphLoopManager.execute(loopId).then(async (result) => {
      const loop = ralphLoopManager.getLoop(loopId);
      const maxIterations = loop?.maxIterations || result.iterations;
      const lastIteration = loop?.iterations[loop.iterations.length - 1];
      const summary = lastIteration?.response || 'Loop completado';

      if (result.status === 'completed') {
        await sendLoopComplete(userId, agent.name, result.iterations, maxIterations, summary);
      } else if (result.isBlocked) {
        await sendLoopBlocked(userId, agent.name, result.iterations, maxIterations, 'Máximo de iterações atingido sem conclusão');
      } else if (result.status === 'failed' && result.error) {
        await sendLoopError(userId, agent.name, result.iterations, maxIterations, result.error);
      } else if (result.status === 'paused') {
        await sendLoopControls(userId, agent.name, result.iterations, maxIterations, true);
      }
    }).catch(async (error) => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[ralph] Loop execution failed:`, error);
      const loop = ralphLoopManager.getLoop(loopId);
      await sendLoopError(userId, agent.name, loop?.currentIteration || 0, loop?.maxIterations || 0, errorMessage);
    });

    return { status: 'ralph_started' };
  }

  // Cancel Ralph loop confirmation
  if (buttonId.startsWith('confirm_cancel_loop_')) {
    const agentId = buttonId.replace('confirm_cancel_loop_', '');
    const agent = agentManager.getAgent(agentId);

    if (!agent) {
      await sendWhatsApp(userId, '❌ Agente não encontrado.');
      return { status: 'agent_not_found' };
    }

    if (!agent.currentLoopId) {
      // No loop ID but agent in ralph mode - just reset status
      agentManager.updateAgentMode(agentId, 'conversational');
      await sendWhatsApp(userId, `⏹️ Agente *${agent.name}* voltou ao modo conversacional.`);
      return { status: 'mode_reset' };
    }

    try {
      await ralphLoopManager.cancel(agent.currentLoopId);
      await sendWhatsApp(userId, `⏹️ Loop do agente *${agent.name}* cancelado.`);
      return { status: 'loop_cancelled' };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      await sendWhatsApp(userId, `❌ Erro ao cancelar: ${msg}`);
      return { status: 'error' };
    }
  }

  return { status: 'unknown_confirmation' };
}

/**
 * Handle new agent creation choice
 */
async function handleNewAgentChoice(
  userId: string,
  buttonId: string
): Promise<{ status: string }> {
  if (buttonId.startsWith('newagent_prompt_')) {
    const agentId = buttonId.replace('newagent_prompt_', '');
    pendingAgentSelection.set(userId, agentId);
    await sendWhatsApp(userId, 'Envie seu prompt:');
    return { status: 'awaiting_prompt' };
  }

  if (buttonId === 'newagent_later') {
    await sendWhatsApp(userId, 'Ok! Use / para ver o menu quando quiser.');
    return { status: 'later' };
  }

  return { status: 'unknown_newagent_choice' };
}

/**
 * Handle generic Yes/No confirmation
 */
async function handleGenericConfirmation(
  userId: string,
  buttonId: string
): Promise<{ status: string }> {
  if (buttonId === 'no') {
    userContextManager.cancelFlow(userId);
    await sendWhatsApp(userId, 'Operação cancelada.');
    return { status: 'cancelled' };
  }

  return { status: 'confirmation_pending' };
}

// =============================================================================
// Ralph Mode Handlers
// =============================================================================

/**
 * Handle mode selection (Conversational vs Ralph)
 */
async function handleModeSelection(
  userId: string,
  buttonId: string
): Promise<{ status: string }> {
  const isRalph = buttonId.startsWith('mode_ralph_');
  const agentId = pendingAgentSelection.get(userId);

  if (!agentId) {
    await sendWhatsApp(userId, '❌ Nenhum agente selecionado.');
    return { status: 'no_agent_selected' };
  }

  const agent = agentManager.getAgent(agentId);
  if (!agent) {
    await sendWhatsApp(userId, '❌ Agente não encontrado.');
    pendingAgentSelection.delete(userId);
    return { status: 'agent_not_found' };
  }

  if (isRalph) {
    // Start Ralph configuration flow
    userContextManager.startConfigureRalphFlow(userId, agentId);
    await sendWhatsApp(userId, `🔄 *Configurando Ralph Loop para ${agent.name}*\n\nQual tarefa o agente deve executar?\n\n_Descreva a tarefa de forma clara e completa._`);
    return { status: 'awaiting_ralph_task' };
  } else {
    // Set to conversational mode
    agentManager.updateAgentMode(agentId, 'conversational');
    pendingAgentSelection.delete(userId);
    await sendWhatsApp(userId, `💬 Agente *${agent.name}* configurado para modo Conversacional.`);
    return { status: 'mode_set_conversational' };
  }
}

/**
 * Handle Ralph iterations selection
 */
async function handleRalphIterationsSelection(
  userId: string,
  buttonId: string
): Promise<{ status: string }> {
  const iterations = parseInt(buttonId.replace('ralph_iterations_', ''), 10);

  if (!userContextManager.isInConfigureRalphFlow(userId)) {
    await sendWhatsApp(userId, '❌ Seleção de iterações inesperada.');
    return { status: 'unexpected_iterations_selection' };
  }

  try {
    userContextManager.setRalphMaxIterations(userId, iterations);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await sendWhatsApp(userId, `❌ ${msg}`);
    return { status: 'error' };
  }

  // Now ask for model selection
  const data = userContextManager.getRalphConfigData(userId);
  const agent = data?.agentId ? agentManager.getAgent(data.agentId) : null;
  const agentName = agent?.name || 'Agente';

  await sendModelSelectorList(userId, agentName);
  return { status: 'awaiting_ralph_model' };
}

/**
 * Handle Ralph pause
 */
async function handleRalphPause(userId: string): Promise<{ status: string }> {
  // Find the agent that's currently in ralph-loop for this user
  const agents = agentManager.listAgents(userId);
  const loopingAgent = agents.find((a) => a.status === 'ralph-loop');

  if (!loopingAgent) {
    await sendWhatsApp(userId, '❌ Nenhum loop ativo encontrado.');
    return { status: 'no_active_loop' };
  }

  if (!loopingAgent.currentLoopId) {
    await sendWhatsApp(userId, '❌ Loop não encontrado.');
    return { status: 'loop_not_found' };
  }

  try {
    await ralphLoopManager.pause(loopingAgent.currentLoopId);
    const loop = ralphLoopManager.getLoop(loopingAgent.currentLoopId);
    const currentIteration = loop?.currentIteration || 0;
    const maxIterations = loop?.maxIterations || 0;
    await sendLoopControls(userId, loopingAgent.name, currentIteration, maxIterations, true);
    return { status: 'loop_paused' };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await sendWhatsApp(userId, `❌ Erro ao pausar loop: ${msg}`);
    return { status: 'error' };
  }
}

/**
 * Handle Ralph resume
 */
async function handleRalphResume(userId: string): Promise<{ status: string }> {
  // Find the agent that's currently paused for this user
  const agents = agentManager.listAgents(userId);
  const pausedAgent = agents.find((a) => a.status === 'ralph-paused');

  if (!pausedAgent) {
    await sendWhatsApp(userId, '❌ Nenhum loop pausado encontrado.');
    return { status: 'no_paused_loop' };
  }

  if (!pausedAgent.currentLoopId) {
    await sendWhatsApp(userId, '❌ Loop não encontrado.');
    return { status: 'loop_not_found' };
  }

  await sendWhatsApp(userId, `▶️ Loop do agente *${pausedAgent.name}* retomado.`);

  const loopId = pausedAgent.currentLoopId;

  // Resume the loop asynchronously (don't await - it runs in background)
  ralphLoopManager.resume(loopId).then(async (result) => {
    const loop = ralphLoopManager.getLoop(loopId);
    const maxIterations = loop?.maxIterations || result.iterations;
    const lastIteration = loop?.iterations[loop.iterations.length - 1];
    const summary = lastIteration?.response || 'Loop completado';

    if (result.status === 'completed') {
      await sendLoopComplete(userId, pausedAgent.name, result.iterations, maxIterations, summary);
    } else if (result.isBlocked) {
      await sendLoopBlocked(userId, pausedAgent.name, result.iterations, maxIterations, 'Máximo de iterações atingido sem conclusão');
    } else if (result.status === 'failed' && result.error) {
      await sendLoopError(userId, pausedAgent.name, result.iterations, maxIterations, result.error);
    } else if (result.status === 'paused') {
      await sendLoopControls(userId, pausedAgent.name, result.iterations, maxIterations, true);
    }
  }).catch(async (error) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[ralph] Loop resume failed:`, error);
    const loop = ralphLoopManager.getLoop(loopId);
    await sendLoopError(userId, pausedAgent.name, loop?.currentIteration || 0, loop?.maxIterations || 0, errorMessage);
  });

  return { status: 'loop_resumed' };
}

/**
 * Handle Ralph cancel
 */
async function handleRalphCancel(userId: string): Promise<{ status: string }> {
  // Find the agent that's in ralph mode for this user
  const agents = agentManager.listAgents(userId);
  const ralphAgent = agents.find((a) => a.status === 'ralph-loop' || a.status === 'ralph-paused');

  if (!ralphAgent) {
    await sendWhatsApp(userId, '❌ Nenhum loop encontrado.');
    return { status: 'no_loop' };
  }

  if (!ralphAgent.currentLoopId) {
    // No loop ID but agent in ralph mode - just reset status
    agentManager.updateAgentMode(ralphAgent.id, 'conversational');
    await sendWhatsApp(userId, `⏹️ Agente *${ralphAgent.name}* voltou ao modo conversacional.`);
    return { status: 'mode_reset' };
  }

  try {
    await ralphLoopManager.cancel(ralphAgent.currentLoopId);
    await sendWhatsApp(userId, `⏹️ Loop do agente *${ralphAgent.name}* cancelado.`);
    return { status: 'loop_cancelled' };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await sendWhatsApp(userId, `❌ Erro ao cancelar loop: ${msg}`);
    return { status: 'error' };
  }
}

/**
 * Handle Ralph retry after error
 */
async function handleRalphRetry(userId: string): Promise<{ status: string }> {
  // Find the agent that had an error
  const agents = agentManager.listAgents(userId);
  const errorAgent = agents.find((a) => a.status === 'error' && a.mode === 'ralph');

  if (!errorAgent) {
    await sendWhatsApp(userId, '❌ Nenhum agente com erro encontrado.');
    return { status: 'no_error_agent' };
  }

  // Resume the loop
  agentManager.updateAgentStatus(errorAgent.id, 'ralph-loop', 'Retentando...');
  await sendWhatsApp(userId, `🔄 Retentando loop do agente *${errorAgent.name}*...`);
  return { status: 'loop_retrying' };
}

/**
 * Handle Ralph details request
 */
async function handleRalphDetails(userId: string): Promise<{ status: string }> {
  // Find the agent that completed a loop
  const agents = agentManager.listAgents(userId);
  const completedAgent = agents.find((a) => a.mode === 'ralph' && a.outputs.length > 0);

  if (!completedAgent) {
    await sendWhatsApp(userId, '❌ Nenhum histórico de loop encontrado.');
    return { status: 'no_loop_history' };
  }

  // Show the history
  await sendHistoryList(userId, completedAgent.name, completedAgent.outputs);
  return { status: 'details_shown' };
}

/**
 * Handle Ralph restart
 * Handles both completed loops (idle status) and blocked loops (error status)
 */
async function handleRalphRestart(userId: string): Promise<{ status: string }> {
  // Find the agent that completed or blocked a loop
  const agents = agentManager.listAgents(userId);
  // Check for both idle (completed) and error (blocked) status
  const targetAgent = agents.find((a) => a.mode === 'ralph' && (a.status === 'idle' || a.status === 'error'));

  if (!targetAgent) {
    await sendWhatsApp(userId, '❌ Nenhum agente encontrado para reiniciar.');
    return { status: 'no_agent_to_restart' };
  }

  // Reset agent status if it was in error state (from blocked loop)
  if (targetAgent.status === 'error') {
    agentManager.updateAgentStatus(targetAgent.id, 'idle', 'Aguardando nova configuração');
  }

  // Start Ralph configuration again
  pendingAgentSelection.set(userId, targetAgent.id);
  userContextManager.startConfigureRalphFlow(userId, targetAgent.id);
  await sendWhatsApp(userId, `🔄 *Reiniciando Ralph Loop para ${targetAgent.name}*\n\nQual tarefa o agente deve executar?`);
  return { status: 'awaiting_ralph_task' };
}

// =============================================================================
// List Reply Handler
// =============================================================================

async function handleListReply(
  userId: string,
  listId: string,
  messageId?: string
): Promise<{ status: string }> {
  console.log(`> List: ${listId}`);

  // Agent type selection for agent creation
  if (listId.startsWith('agenttype_')) {
    return handleAgentTypeSelection(userId, listId, messageId);
  }

  // Emoji selection for agent creation
  if (listId.startsWith('emoji_')) {
    return handleEmojiSelection(userId, listId, messageId);
  }

  // Workspace selection for agent creation
  if (listId.startsWith('workspace_')) {
    return handleWorkspaceSelection(userId, listId, messageId);
  }

  // Model mode selection during agent creation
  if (listId.startsWith('model_mode_')) {
    return handleModelModeSelection(userId, listId, messageId);
  }

  // Agent selection for prompt (step 1)
  if (listId.startsWith('selectagent_')) {
    const agentId = listId.replace('selectagent_', '');
    return handleAgentSelectionForPrompt(userId, agentId, messageId);
  }

  // Model selection for prompt (step 2)
  if (listId.startsWith('selectmodel_')) {
    const model = listId.replace('selectmodel_', '') as Model;
    return handleModelSelectionForPrompt(userId, model, messageId);
  }

  // Agent selection for prompt (legacy, used in other flows)
  if (listId.startsWith('agent_')) {
    const agentId = listId.replace('agent_', '');
    return handleAgentSelection(userId, agentId, messageId);
  }

  // Agent menu actions
  if (listId.startsWith('agentmenu_')) {
    return handleAgentMenuAction(userId, listId, messageId);
  }

  // History item selection
  if (listId.startsWith('history_')) {
    return handleHistorySelection(userId, listId);
  }

  // Output actions
  if (listId.startsWith('outputaction_')) {
    return handleOutputAction(userId, listId);
  }

  // Management actions
  if (listId === 'action_create_agent') {
    return handleCreateAgentFlow(userId);
  }

  if (listId === 'action_toggle_bash') {
    const isEnabled = userContextManager.isInBashMode(userId);
    await sendBashModeStatus(userId, isEnabled, messageId);
    return { status: 'bash_toggle_shown' };
  }

  if (listId === 'action_configure_limit') {
    return handleConfigureLimitCommand(userId);
  }

  if (listId === 'action_configure_priority') {
    return handleConfigurePriorityCommand(userId);
  }

  if (listId === 'action_delete_agents') {
    return handleDeleteAgentsCommand(userId);
  }

  // Delete selection
  if (listId.startsWith('delete_')) {
    return handleDeleteSelection(userId, listId);
  }

  // Reset selection
  if (listId.startsWith('reset_')) {
    return handleResetSelection(userId, listId);
  }

  // Limit selection
  if (listId.startsWith('limit_')) {
    return handleLimitSelection(userId, listId);
  }

  // Priority selection
  if (listId.startsWith('priority_')) {
    return handlePrioritySelection(userId, listId);
  }

  // Commands
  if (listId === 'cmd_reset') {
    return handleResetCommand(userId);
  }

  if (listId === 'cmd_compact') {
    return handleCompactCommand(userId, messageId);
  }

  if (listId === 'cmd_help') {
    return handleHelpCommand(userId);
  }

  return { status: 'unknown_list_selection' };
}

/**
 * Handle agent selection for sending prompt
 */
async function handleAgentSelection(
  userId: string,
  agentId: string,
  messageId?: string
): Promise<{ status: string }> {
  const pending = userContextManager.getPendingPrompt(userId);

  if (!pending) {
    // No pending prompt - show agent menu
    const agent = agentManager.getAgent(agentId);
    if (!agent) {
      await sendWhatsApp(userId, '❌ Agente não encontrado.');
      return { status: 'agent_not_found' };
    }

    await sendAgentMenu(userId, agent, messageId);
    return { status: 'agent_menu_shown' };
  }

  // Check if configuring priority
  if (userContextManager.isInConfigurePriorityFlow(userId)) {
    userContextManager.setConfigurePriorityAgent(userId, agentId);
    const agent = agentManager.getAgent(agentId);
    if (agent) {
      await sendConfigurePriorityMenu(userId, agent.name, agent.priority);
    }
    return { status: 'awaiting_priority_selection' };
  }

  // Store agent selection and show model selector
  pendingAgentSelection.set(userId, agentId);
  await sendModelSelector(userId, pending.messageId);

  return { status: 'awaiting_model_selection' };
}

/**
 * Handle agent selection for prompt (step 1 of 2)
 */
async function handleAgentSelectionForPrompt(
  userId: string,
  agentId: string,
  messageId?: string
): Promise<{ status: string }> {
  const pending = userContextManager.getPendingPrompt(userId);
  if (!pending) {
    await sendWhatsApp(userId, 'Nenhum prompt pendente. Envie uma mensagem primeiro.');
    return { status: 'no_pending' };
  }

  const agent = agentManager.getAgent(agentId);
  if (!agent) {
    await sendWhatsApp(userId, '❌ Agente não encontrado.');
    return { status: 'agent_not_found' };
  }

  // Store selected agent
  pendingAgentSelection.set(userId, agentId);

  // Send model selector (step 2)
  await sendModelSelectorList(userId, agent.name, messageId);

  return { status: 'awaiting_model_selection' };
}

/**
 * Handle model selection for prompt (step 2 of 2)
 */
async function handleModelSelectionForPrompt(
  userId: string,
  model: Model,
  messageId?: string
): Promise<{ status: string }> {
  // Check if this is for Ralph configuration
  if (userContextManager.isInConfigureRalphFlow(userId)) {
    return handleRalphModelSelection(userId, model, messageId);
  }

  const pending = userContextManager.getPendingPrompt(userId);
  const agentId = pendingAgentSelection.get(userId);

  if (!pending || !agentId) {
    await sendWhatsApp(userId, 'Nenhum prompt pendente. Envie uma mensagem primeiro.');
    return { status: 'no_pending' };
  }

  // Clear pending state
  userContextManager.clearPendingPrompt(userId);
  pendingAgentSelection.delete(userId);

  const agent = agentManager.getAgent(agentId);
  if (!agent) {
    await sendWhatsApp(userId, '❌ Agente não encontrado.');
    return { status: 'agent_not_found' };
  }

  console.log(`> [${model}] Agent: ${agent.name}, Prompt: ${pending.text}`);

  // Store last choice for quick repeat
  userContextManager.setLastChoice(userId, agentId, agent.name, model);

  // Only notify for queue case (when agent is busy)
  if (agent.status === 'processing') {
    await sendWhatsApp(
      userId,
      `⏳ Agente *${agent.name}* ocupado. Prompt enfileirado. Você será notificado quando iniciar.`
    );
  }

  // Enqueue task
  const task = queueManager.enqueue({
    agentId,
    prompt: pending.text,
    model,
    userId,
    images: pending.images,
  });

  console.log(`Task ${task.id} enqueued for agent ${agent.name}`);

  return { status: 'task_enqueued' };
}

/**
 * Handle model selection for Ralph loop configuration
 */
async function handleRalphModelSelection(
  userId: string,
  model: Model,
  messageId?: string
): Promise<{ status: string }> {
  const data = userContextManager.getRalphConfigData(userId);

  if (!data?.agentId || !data?.ralphTask || !data?.ralphMaxIterations) {
    await sendWhatsApp(userId, '❌ Configuração Ralph incompleta.');
    userContextManager.completeFlow(userId);
    return { status: 'incomplete_ralph_config' };
  }

  const agent = agentManager.getAgent(data.agentId);
  if (!agent) {
    await sendWhatsApp(userId, '❌ Agente não encontrado.');
    userContextManager.completeFlow(userId);
    pendingAgentSelection.delete(userId);
    return { status: 'agent_not_found' };
  }

  // Store the model selection
  userContextManager.setRalphModel(userId, model);

  // Complete the configuration
  userContextManager.completeFlow(userId);
  pendingAgentSelection.delete(userId);

  // Create the Ralph loop via RalphLoopManager
  try {
    const loopId = ralphLoopManager.start(data.agentId, data.ralphTask, data.ralphMaxIterations, model);
    console.log(`[ralph] Created loop ${loopId} for agent ${agent.name}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    await sendWhatsApp(userId, `❌ ${msg}`);
    return { status: 'error' };
  }

  // Show confirmation with start button
  await sendConfirmation(
    userId,
    `✅ *Ralph Loop configurado para ${agent.name}*\n\n` +
    `📝 *Tarefa:* ${data.ralphTask.length > 100 ? data.ralphTask.slice(0, 100) + '...' : data.ralphTask}\n\n` +
    `🔄 *Máx. iterações:* ${data.ralphMaxIterations}\n` +
    `🧠 *Modelo:* ${model.toUpperCase()}\n\n` +
    `Iniciar execução do loop?`,
    [
      { id: `confirm_start_ralph_${data.agentId}`, title: 'Iniciar Loop' },
      { id: 'confirm_cancel', title: 'Cancelar' },
    ],
    messageId
  );

  return { status: 'ralph_configured' };
}

/**
 * Handle agent type selection during agent creation
 */
async function handleAgentTypeSelection(
  userId: string,
  listId: string,
  messageId?: string
): Promise<{ status: string }> {
  if (!userContextManager.isAwaitingType(userId)) {
    await sendWhatsApp(userId, '❌ Seleção de tipo inesperada.');
    return { status: 'unexpected_type_selection' };
  }

  const type: AgentType = listId === 'agenttype_bash' ? 'bash' : 'claude';
  userContextManager.setAgentType(userId, type);

  // Now ask for emoji
  await sendEmojiSelector(userId, messageId);
  return { status: 'awaiting_emoji' };
}

/**
 * Handle emoji selection during agent creation
 */
// Emoji key to character mapping
const EMOJI_MAP: Record<string, string> = {
  robo: '🤖',
  ferramentas: '🔧',
  graficos: '📊',
  ideia: '💡',
  alvo: '🎯',
  notas: '📝',
  foguete: '🚀',
  raio: '⚡',
  busca: '🔍',
  computador: '💻',
};

async function handleEmojiSelection(
  userId: string,
  listId: string,
  messageId?: string
): Promise<{ status: string }> {
  if (!userContextManager.isAwaitingEmoji(userId)) {
    await sendWhatsApp(userId, '❌ Seleção de emoji inesperada.');
    return { status: 'unexpected_emoji_selection' };
  }

  // Extract key from listId (format: emoji_robo) and map to emoji
  const key = listId.replace('emoji_', '');
  const emoji = EMOJI_MAP[key] || '🤖';

  userContextManager.setAgentEmoji(userId, emoji);
  // Go to agent mode selector (conversational vs ralph)
  await sendAgentModeSelector(userId);
  return { status: 'awaiting_mode_choice' };
}

/**
 * Handle workspace selection during agent creation
 */
async function handleWorkspaceSelection(
  userId: string,
  listId: string,
  messageId?: string
): Promise<{ status: string }> {
  if (!userContextManager.isAwaitingWorkspaceChoice(userId)) {
    await sendWhatsApp(userId, '❌ Seleção de workspace inesperada.');
    return { status: 'unexpected_workspace_selection' };
  }

  const homeDir = process.env.HOME || '/Users/lucas';
  let workspace: string | null = null;

  switch (listId) {
    case 'workspace_home':
      workspace = homeDir;
      break;
    case 'workspace_desktop':
      workspace = `${homeDir}/Desktop`;
      break;
    case 'workspace_documents':
      workspace = `${homeDir}/Documents`;
      break;
    case 'workspace_custom':
      userContextManager.setAwaitingCustomWorkspace(userId);
      await sendWhatsApp(userId, 'Envie o caminho completo do workspace:');
      return { status: 'awaiting_custom_workspace' };
    case 'workspace_skip':
      workspace = null;
      break;
    default:
      await sendWhatsApp(userId, '❌ Opção inválida.');
      return { status: 'invalid_workspace_option' };
  }

  // Store workspace and go to model mode selector
  userContextManager.setAgentWorkspace(userId, workspace);
  await sendModelModeSelector(userId);
  return { status: 'awaiting_model_mode_choice' };
}

/**
 * Handle model mode selection during agent creation
 */
async function handleModelModeSelection(
  userId: string,
  listId: string,
  messageId?: string
): Promise<{ status: string }> {
  if (!userContextManager.isAwaitingModelMode(userId)) {
    await sendWhatsApp(userId, '❌ Seleção de modo de modelo inesperada.');
    return { status: 'unexpected_model_mode_selection' };
  }

  // Extract model mode from listId (format: model_mode_selection, model_mode_haiku, etc.)
  const mode = listId.replace('model_mode_', '') as ModelMode;
  userContextManager.setAgentModelMode(userId, mode);

  // Send confirmation
  const data = userContextManager.getCreateAgentData(userId);
  await sendConfirmation(
    userId,
    `Criar agente "${data?.agentName}"?`,
    [
      { id: 'confirm_create', title: '✅ Criar' },
      { id: 'cancel_create', title: '❌ Cancelar' },
    ]
  );
  return { status: 'confirmation_sent' };
}

/**
 * Handle agent menu actions
 */
async function handleAgentMenuAction(
  userId: string,
  listId: string,
  messageId?: string
): Promise<{ status: string }> {
  const parts = listId.split('_');
  const action = parts[1];
  const agentId = parts.slice(2).join('_');

  switch (action) {
    case 'prompt': {
      // Direct prompt to this agent
      pendingAgentSelection.set(userId, agentId);
      await sendWhatsApp(userId, 'Envie seu prompt:');
      return { status: 'awaiting_prompt' };
    }

    case 'history': {
      // Show history
      const agent = agentManager.getAgent(agentId);
      if (!agent) {
        await sendWhatsApp(userId, '❌ Agente não encontrado.');
        return { status: 'agent_not_found' };
      }

      await sendHistoryList(userId, agent.name, agent.outputs, messageId);
      return { status: 'history_shown' };
    }

    case 'emoji': {
      // Edit emoji
      const agent = agentManager.getAgent(agentId);
      if (!agent) {
        await sendWhatsApp(userId, '❌ Agente não encontrado.');
        return { status: 'agent_not_found' };
      }

      userContextManager.startEditEmojiFlow(userId, agentId);
      await sendWhatsApp(userId, `Envie o novo emoji para o agente *${agent.name}*:`);
      return { status: 'awaiting_emoji_text' };
    }

    case 'priority': {
      // Configure priority
      return handleConfigurePriorityCommand(userId, agentId);
    }

    case 'reset': {
      // Reset agent
      const agent = agentManager.getAgent(agentId);
      if (!agent) {
        await sendWhatsApp(userId, '❌ Agente não encontrado.');
        return { status: 'agent_not_found' };
      }

      await sendConfirmation(
        userId,
        `⚠️ Limpar sessão do agente *${agent.name}*?\n\nIsso apagará todo o contexto da conversa.`,
        [
          { id: `confirm_reset_${agentId}`, title: 'Confirmar' },
          { id: 'confirm_cancel', title: 'Cancelar' },
        ]
      );
      return { status: 'awaiting_reset_confirmation' };
    }

    case 'delete': {
      // Delete agent
      const agent = agentManager.getAgent(agentId);
      if (!agent) {
        await sendWhatsApp(userId, '❌ Agente não encontrado.');
        return { status: 'agent_not_found' };
      }

      await sendConfirmation(
        userId,
        `⚠️ Deletar agente *${agent.name}*?\n\nIsso é irreversível.`,
        [
          { id: `confirm_delete_${agentId}`, title: 'Confirmar' },
          { id: 'confirm_cancel', title: 'Cancelar' },
        ]
      );
      return { status: 'awaiting_delete_confirmation' };
    }

    case 'back': {
      // Back to main menu
      return handleMenuCommand(userId);
    }

    case 'mode': {
      // Change agent mode (Conversational vs Ralph)
      const agent = agentManager.getAgent(agentId);
      if (!agent) {
        await sendWhatsApp(userId, '❌ Agente não encontrado.');
        return { status: 'agent_not_found' };
      }

      // Store agent ID for mode selection
      pendingAgentSelection.set(userId, agentId);
      await sendModeSelector(userId, agent.name, messageId);
      return { status: 'awaiting_mode_selection' };
    }

    case 'pause_loop': {
      // Pause Ralph loop
      const agent = agentManager.getAgent(agentId);
      if (!agent) {
        await sendWhatsApp(userId, '❌ Agente não encontrado.');
        return { status: 'agent_not_found' };
      }

      if (agent.status !== 'ralph-loop') {
        await sendWhatsApp(userId, '❌ Agente não está em execução de loop.');
        return { status: 'not_in_loop' };
      }

      if (!agent.currentLoopId) {
        await sendWhatsApp(userId, '❌ Loop não encontrado.');
        return { status: 'loop_not_found' };
      }

      try {
        await ralphLoopManager.pause(agent.currentLoopId);
        await sendWhatsApp(userId, `⏸️ Loop do agente *${agent.name}* pausado.`);
        return { status: 'loop_paused' };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        await sendWhatsApp(userId, `❌ Erro ao pausar: ${msg}`);
        return { status: 'error' };
      }
    }

    case 'resume_loop': {
      // Resume Ralph loop
      const agent = agentManager.getAgent(agentId);
      if (!agent) {
        await sendWhatsApp(userId, '❌ Agente não encontrado.');
        return { status: 'agent_not_found' };
      }

      if (agent.status !== 'ralph-paused') {
        await sendWhatsApp(userId, '❌ Loop do agente não está pausado.');
        return { status: 'not_paused' };
      }

      if (!agent.currentLoopId) {
        await sendWhatsApp(userId, '❌ Loop não encontrado.');
        return { status: 'loop_not_found' };
      }

      await sendWhatsApp(userId, `▶️ Loop do agente *${agent.name}* retomado.`);

      const loopId = agent.currentLoopId;

      // Resume asynchronously
      ralphLoopManager.resume(loopId).then(async (result) => {
        const loop = ralphLoopManager.getLoop(loopId);
        const maxIterations = loop?.maxIterations || result.iterations;
        const lastIteration = loop?.iterations[loop.iterations.length - 1];
        const summary = lastIteration?.response || 'Loop completado';

        if (result.status === 'completed') {
          await sendLoopComplete(userId, agent.name, result.iterations, maxIterations, summary);
        } else if (result.isBlocked) {
          await sendLoopBlocked(userId, agent.name, result.iterations, maxIterations, 'Máximo de iterações atingido sem conclusão');
        } else if (result.status === 'failed' && result.error) {
          await sendLoopError(userId, agent.name, result.iterations, maxIterations, result.error);
        }
      }).catch(async (error) => {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const loop = ralphLoopManager.getLoop(loopId);
        await sendLoopError(userId, agent.name, loop?.currentIteration || 0, loop?.maxIterations || 0, errorMessage);
      });

      return { status: 'loop_resumed' };
    }

    case 'cancel_loop': {
      // Cancel Ralph loop
      const agent = agentManager.getAgent(agentId);
      if (!agent) {
        await sendWhatsApp(userId, '❌ Agente não encontrado.');
        return { status: 'agent_not_found' };
      }

      if (agent.status !== 'ralph-loop' && agent.status !== 'ralph-paused') {
        await sendWhatsApp(userId, '❌ Agente não está em modo loop.');
        return { status: 'not_in_loop' };
      }

      await sendConfirmation(
        userId,
        `⚠️ Cancelar loop do agente *${agent.name}*?\n\nO progresso atual será mantido no histórico.`,
        [
          { id: `confirm_cancel_loop_${agentId}`, title: 'Confirmar' },
          { id: 'confirm_cancel', title: 'Voltar' },
        ]
      );
      return { status: 'awaiting_cancel_loop_confirmation' };
    }

    default:
      return { status: 'unknown_agent_action' };
  }
}

/**
 * Handle history item selection
 */
async function handleHistorySelection(
  userId: string,
  listId: string
): Promise<{ status: string }> {
  const outputId = listId.replace('history_', '');

  if (outputId === 'empty') {
    await sendWhatsApp(userId, 'Nenhum histórico disponível.');
    return { status: 'no_history' };
  }

  // Find the output in any agent
  for (const agent of agentManager.getAllAgents()) {
    const output = agent.outputs.find((o) => o.id === outputId);
    if (output) {
      await sendOutputActions(userId, agent.id, output);
      return { status: 'output_actions_shown' };
    }
  }

  await sendWhatsApp(userId, '❌ Output não encontrado.');
  return { status: 'output_not_found' };
}

/**
 * Handle output action selection
 */
async function handleOutputAction(
  userId: string,
  listId: string
): Promise<{ status: string }> {
  const parts = listId.split('_');
  const action = parts[1];
  const agentId = parts[2];
  const outputId = parts.slice(3).join('_');

  // Find the output
  const agent = agentManager.getAgent(agentId);
  if (!agent) {
    await sendWhatsApp(userId, '❌ Agente não encontrado.');
    return { status: 'agent_not_found' };
  }

  const output = agent.outputs.find((o) => o.id === outputId);
  if (!output) {
    await sendWhatsApp(userId, '❌ Output não encontrado.');
    return { status: 'output_not_found' };
  }

  switch (action) {
    case 'details': {
      // Show full details
      const details =
        `*Prompt:*\n${output.prompt}\n\n` +
        `*Resposta:*\n${output.response}\n\n` +
        `*Modelo:* ${output.model.toUpperCase()}\n` +
        `*Status:* ${output.status}\n` +
        `*Data:* ${output.timestamp.toLocaleString('pt-BR')}`;

      await sendWhatsApp(userId, details);
      return { status: 'details_shown' };
    }

    case 'reexecute': {
      // Store for re-execution
      userContextManager.setPendingPrompt(userId, output.prompt);
      pendingAgentSelection.set(userId, agentId);
      await sendModelSelector(userId);
      return { status: 'awaiting_model_for_reexecute' };
    }

    case 'back': {
      // Back to history
      await sendHistoryList(userId, agent.name, agent.outputs);
      return { status: 'history_shown' };
    }

    default:
      return { status: 'unknown_output_action' };
  }
}

/**
 * Handle reset agent selection
 */
async function handleResetSelection(
  userId: string,
  listId: string
): Promise<{ status: string }> {
  const selection = listId.replace('reset_', '');

  if (selection === 'all') {
    await sendConfirmation(
      userId,
      '⚠️ Limpar TODAS as sessões?\n\nIsso apagará todo o contexto de todos os agentes.',
      [
        { id: 'confirm_reset_all', title: 'Confirmar' },
        { id: 'confirm_cancel', title: 'Cancelar' },
      ]
    );
    return { status: 'awaiting_reset_all_confirmation' };
  }

  const agent = agentManager.getAgent(selection);
  if (!agent) {
    await sendWhatsApp(userId, '❌ Agente não encontrado.');
    return { status: 'agent_not_found' };
  }

  await sendConfirmation(
    userId,
    `⚠️ Limpar sessão do agente *${agent.name}*?\n\nIsso apagará todo o contexto da conversa.`,
    [
      { id: `confirm_reset_${selection}`, title: 'Confirmar' },
      { id: 'confirm_cancel', title: 'Cancelar' },
    ]
  );
  return { status: 'awaiting_reset_confirmation' };
}

/**
 * Handle delete agent selection
 */
async function handleDeleteSelection(
  userId: string,
  listId: string
): Promise<{ status: string }> {
  const selection = listId.replace('delete_', '');

  if (selection === 'all') {
    await sendConfirmation(
      userId,
      '⚠️ Deletar TODOS os agentes?\n\nIsso é irreversível e removerá todos os agentes permanentemente.',
      [
        { id: 'confirm_delete_all', title: 'Confirmar' },
        { id: 'confirm_cancel', title: 'Cancelar' },
      ]
    );
    return { status: 'awaiting_delete_all_confirmation' };
  }

  const agent = agentManager.getAgent(selection);
  if (!agent) {
    await sendWhatsApp(userId, '❌ Agente não encontrado.');
    return { status: 'agent_not_found' };
  }

  await sendConfirmation(
    userId,
    `⚠️ Deletar agente *${agent.name}*?\n\nIsso é irreversível.`,
    [
      { id: `confirm_delete_${selection}`, title: 'Confirmar' },
      { id: 'confirm_cancel', title: 'Cancelar' },
    ]
  );
  return { status: 'awaiting_delete_confirmation' };
}

/**
 * Handle execution limit selection
 */
async function handleLimitSelection(
  userId: string,
  listId: string
): Promise<{ status: string }> {
  const newLimit = parseInt(listId.replace('limit_', ''), 10);

  // 0 means unbounded mode (no limit) - semaphore now supports this natively
  semaphore.setMaxPermits(newLimit);
  agentManager.updateConfig({ maxConcurrent: newLimit });

  userContextManager.completeFlow(userId);

  const limitText = newLimit === 0 ? 'Sem limite' : `${newLimit} agente${newLimit > 1 ? 's' : ''}`;
  await sendWhatsApp(userId, `✅ Limite atualizado para ${limitText} simultâneo${newLimit === 1 ? '' : 's'}.`);

  return { status: 'limit_updated' };
}

/**
 * Handle priority selection
 */
async function handlePrioritySelection(
  userId: string,
  listId: string
): Promise<{ status: string }> {
  const priority = listId.replace('priority_', '') as Agent['priority'];
  const data = userContextManager.getConfigurePriorityData(userId);

  if (!data?.agentId) {
    await sendWhatsApp(userId, '❌ Nenhum agente selecionado.');
    userContextManager.completeFlow(userId);
    return { status: 'no_agent_selected' };
  }

  const agent = agentManager.getAgent(data.agentId);
  if (!agent) {
    await sendWhatsApp(userId, '❌ Agente não encontrado.');
    userContextManager.completeFlow(userId);
    return { status: 'agent_not_found' };
  }

  agentManager.updatePriority(data.agentId, priority);
  userContextManager.completeFlow(userId);

  const priorityLabel = { high: 'Alta', medium: 'Média', low: 'Baixa' }[priority];
  await sendWhatsApp(userId, `✅ Prioridade do agente *${agent.name}* atualizada para ${priorityLabel}.`);

  return { status: 'priority_updated' };
}

// =============================================================================
// Message Extraction
// =============================================================================

type ExtractedMessage = {
  from: string;
  type: 'text' | 'button' | 'list' | 'image' | 'audio';
  groupId?: string; // WhatsApp group ID if from a group
  text?: string;
  buttonId?: string;
  listId?: string;
  messageId?: string;
  // Image-specific fields
  imageId?: string;
  imageMimeType?: string;
  imageUrl?: string; // Direct URL from Kapso
  // Audio-specific fields
  audioId?: string;
  audioMimeType?: string;
  audioUrl?: string; // Direct URL from Kapso
};

export function extractMessage(payload: unknown): ExtractedMessage | null {
  try {
    const p = payload as Record<string, unknown>;

    // Kapso v2 format
    if (p?.message && p?.conversation) {
      const message = p.message as Record<string, unknown>;
      const conversation = p.conversation as Record<string, unknown>;
      const from = ((conversation.phone_number as string) || '').replace('+', '');
      const groupId = conversation.group_id as string | undefined;

      // Button reply
      if (
        message.type === 'interactive' &&
        (message.interactive as Record<string, unknown>)?.type === 'button_reply'
      ) {
        return {
          from,
          groupId,
          type: 'button',
          buttonId:
            ((message.interactive as Record<string, unknown>)?.button_reply as Record<string, unknown>)?.id as string || '',
        };
      }

      // List reply
      if (
        message.type === 'interactive' &&
        (message.interactive as Record<string, unknown>)?.type === 'list_reply'
      ) {
        return {
          from,
          groupId,
          type: 'list',
          listId:
            ((message.interactive as Record<string, unknown>)?.list_reply as Record<string, unknown>)?.id as string || '',
        };
      }

      // Text message
      if (message.type === 'text') {
        return {
          from,
          groupId,
          type: 'text',
          text:
            ((message.kapso as Record<string, unknown>)?.content as string) ||
            ((message.text as Record<string, unknown>)?.body as string) ||
            '',
          messageId: message.id as string,
        };
      }

      // Image message (Kapso v2)
      if (message.type === 'image') {
        const image = message.image as Record<string, unknown>;
        const kapso = message.kapso as Record<string, unknown>;
        return {
          from,
          groupId,
          type: 'image',
          text: (image?.caption as string) || '',
          imageId: image?.id as string,
          imageMimeType: image?.mime_type as string,
          imageUrl: (kapso?.media_url as string) || (image?.link as string), // Kapso provides direct URL
          messageId: message.id as string,
        };
      }

      // Audio message (Kapso v2)
      if (message.type === 'audio') {
        const audio = message.audio as Record<string, unknown>;
        const kapso = message.kapso as Record<string, unknown>;
        return {
          from,
          groupId,
          type: 'audio',
          audioId: audio?.id as string,
          audioMimeType: audio?.mime_type as string,
          audioUrl: (kapso?.media_url as string) || (audio?.link as string),
          messageId: message.id as string,
        };
      }
    }

    // Fallback: Meta format (legacy)
    const entry = (p?.entry as unknown[])?.[0] as Record<string, unknown> | undefined;
    const changes = (entry?.changes as unknown[])?.[0] as Record<string, unknown> | undefined;
    const value = changes?.value as Record<string, unknown> | undefined;
    const message = (value?.messages as unknown[])?.[0] as Record<string, unknown> | undefined;

    if (!message) return null;

    const from = message.from as string;

    // Button reply (Meta format)
    if (
      message.type === 'interactive' &&
      (message.interactive as Record<string, unknown>)?.type === 'button_reply'
    ) {
      return {
        from,
        type: 'button',
        buttonId:
          ((message.interactive as Record<string, unknown>)?.button_reply as Record<string, unknown>)?.id as string || '',
      };
    }

    // List reply (Meta format)
    if (
      message.type === 'interactive' &&
      (message.interactive as Record<string, unknown>)?.type === 'list_reply'
    ) {
      return {
        from,
        type: 'list',
        listId:
          ((message.interactive as Record<string, unknown>)?.list_reply as Record<string, unknown>)?.id as string || '',
      };
    }

    // Text message
    if (message.type === 'text') {
      return {
        from,
        type: 'text',
        text: ((message.text as Record<string, unknown>)?.body as string) || '',
        messageId: message.id as string,
      };
    }

    // Image message
    if (message.type === 'image') {
      const image = message.image as Record<string, unknown>;
      return {
        from,
        type: 'image',
        text: (image?.caption as string) || '', // Caption becomes the text prompt
        imageId: image?.id as string,
        imageMimeType: image?.mime_type as string,
        messageId: message.id as string,
      };
    }

    // Audio message
    if (message.type === 'audio') {
      const audio = message.audio as Record<string, unknown>;
      return {
        from,
        type: 'audio',
        audioId: audio?.id as string,
        audioMimeType: audio?.mime_type as string,
        messageId: message.id as string,
      };
    }

    return null;
  } catch {
    return null;
  }
}

// =============================================================================
// Onboarding Flow Handlers (Ronin/Dojo Mode)
// =============================================================================

/**
 * Handle onboarding flow messages (telegram username input)
 */
async function handleOnboardingFlow(
  userId: string,
  text: string,
  messageId?: string
): Promise<{ status: string }> {
  const flowState = userContextManager.getCurrentFlowState(userId);

  if (flowState === 'awaiting_telegram_username') {
    // User sent their Telegram username
    const username = text.trim().replace('@', '');
    userContextManager.setTelegramUsername(userId, username);

    // Generate unique token for Telegram linking (7-day expiration)
    const token = telegramTokenManager.generateToken(userId, username);

    // Create Ronin agent automatically (read-only, Haiku-only, sandbox workspace)
    const sandboxPath = ensureSandboxDirectory();
    let roninAgent = agentManager.listAgents(userId).find(a => a.name === 'Ronin');
    if (!roninAgent) {
      roninAgent = agentManager.createAgent(
        userId,
        'Ronin',
        sandboxPath,
        '🥷',
        'claude',
        'haiku' // Fixed Haiku model
      );
      console.log(`Created Ronin agent for user ${userId} with sandbox workspace`);
    }

    // Save preferences (onboarding NOT complete until Telegram linked)
    const prefs: UserPreferences = {
      userId,
      mode: 'dojo',
      telegramUsername: username,
      onboardingComplete: false, // Will be completed when user links via Telegram
    };
    persistenceService.saveUserPreferences(prefs);

    // Clear flow
    userContextManager.clearContext(userId);

    // Get bot username for message
    const botInfo = await getBotInfo();
    const botUsername = botInfo?.username || 'ClaudeTerminalBot';

    // Send Telegram deep link with token
    const deepLink = `https://t.me/${botUsername}?start=${token}`;
    await sendWhatsApp(userId,
      `*Dojo configurado!* 🥋\n\n` +
      `*Passo final:* Conecte seu Telegram\n\n` +
      `1️⃣ Clique no link abaixo:\n${deepLink}\n\n` +
      `2️⃣ Aperte "Start" no Telegram\n\n` +
      `_Link válido por 7 dias._\n\n` +
      `Enquanto isso, o *Ronin 🥷* está disponível aqui para consultas rápidas (somente leitura).`
    );

    return { status: 'dojo_token_sent' };
  }

  // Unexpected state - clear and restart
  userContextManager.clearContext(userId);
  return { status: 'onboarding_error' };
}

/**
 * Handle Ronin (read-only) query in Dojo mode
 */
async function handleRoninQuery(
  userId: string,
  text: string,
  messageId?: string
): Promise<{ status: string }> {
  const trimmed = text.trim().toLowerCase();

  // Commands that should redirect to Telegram
  if (trimmed === '/' || trimmed.startsWith('/criar') || trimmed.startsWith('/new')) {
    await sendRoninRejection(userId, 'criar agentes');
    return { status: 'ronin_rejected_create' };
  }

  if (trimmed === '/status') {
    await sendRoninRejection(userId, 'ver status dos agentes');
    return { status: 'ronin_rejected_status' };
  }

  if (trimmed === '/modo') {
    // Allow changing mode
    await sendUserModeSelector(userId);
    userContextManager.startOnboardingFlow(userId);
    return { status: 'mode_change_started' };
  }

  if (trimmed === '/help') {
    await sendWhatsApp(userId,
      '*Ronin - Consultas Rapidas*\n\n' +
      'Pergunte qualquer coisa sobre codigo.\n' +
      'Sou read-only: so leio, nao modifico.\n\n' +
      '/modo - Trocar para Ronin completo\n\n' +
      '_Para criar agentes, use o Dojo no Telegram._'
    );
    return { status: 'ronin_help' };
  }

  // Process as Ronin query
  // Create or get Ronin agent
  let roninAgentData = agentManager.listAgents(userId).find(a => a.name === 'Ronin');

  if (!roninAgentData) {
    roninAgentData = agentManager.createAgent(userId, 'Ronin', undefined, '🥷', 'claude', 'haiku');
  }

  // Send to Claude (Ronin uses Haiku for fast, concise responses)
  try {
    agentManager.updateAgentStatus(roninAgentData.id, 'processing', 'Consultando...');

    // Prepend system instruction to make responses concise
    const roninPrompt = `[Responda em no maximo 3 linhas, seja direto ao ponto]\n\n${text}`;

    const result = await terminal.send(
      roninPrompt,
      'haiku',
      userId,
      roninAgentData.id,
      undefined // no workspace
    );

    // Truncate response for conciseness
    const response = roninAgent.truncateResponse(result.response, 500);

    await sendRoninResponse(userId, response);

    agentManager.updateAgentStatus(roninAgentData.id, 'idle', 'Pronto');

    if (result.sessionId) {
      agentManager.setSessionId(roninAgentData.id, result.sessionId);
    }

    return { status: 'ronin_query_success' };
  } catch (error) {
    console.error('Ronin query error:', error);
    agentManager.updateAgentStatus(roninAgentData.id, 'error', 'Erro na consulta');
    await sendWhatsApp(userId, 'Erro ao consultar. Tente novamente.');
    return { status: 'ronin_query_error' };
  }
}

// =============================================================================
// Export for testing
// =============================================================================

export {
  app,
  agentManager,
  userContextManager,
  queueManager,
  terminal,
  ralphLoopManager,
  pendingAgentSelection,
  messageRouter,
  groupOnboardingManager,
  handleTelegramCallback,
  handleTelegramMessage,
  isServiceMessage,
  persistenceService,
  topicManager,
};

// =============================================================================
// Start Server (only when not testing)
// =============================================================================

const isTest = process.env.NODE_ENV === 'test' || process.env.BUN_ENV === 'test';

if (!isTest) {
  console.log(`Claude Terminal starting on port ${config.port}...`);
  serve({ fetch: app.fetch, port: config.port });
  console.log(`Ready! Webhook: http://localhost:${config.port}/webhook`);
  console.log(`Use: tailscale funnel ${config.port}`);
}
