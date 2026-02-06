import { Hono } from 'hono';
import { serve } from 'bun';
import { ClaudeTerminal } from './terminal';
import {
  isTelegramConfigured,
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
  sendTelegramModelSelector,
  answerCallbackQuery,
  leaveTelegramGroup,
  sendGroupLinkedConfirmation,
  sendTelegramAgentMenu,
  sendTelegramAgentConfigMenu,
  sendTelegramAgentHistory,
  sendTelegramDeleteConfirmation,
  sendTelegramStatusOverview,
  sendTelegramEditNamePrompt,
  updateTelegramGroupTitle,
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
  TELEGRAM_ERRORS,
  startTypingIndicator,
  // Topic management UI
  TOPIC_ERRORS,
  sendTopicSetupButtons,
  sendTopicRalphTaskPrompt,
  sendTopicRalphIterationsPrompt,
  sendTopicRalphCustomIterationsPrompt,
  sendTopicNamePrompt,
  sendTopicCreatedInGeneral,
  sendTopicWelcome,
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
  type TopicListItem,
  sendWorkspaceNotFoundOptions,
  sendTopicWorkspaceReconfig,
  sendTopicWorkspaceQuestion,
} from './telegram';
import { GroupOnboardingManager } from './group-onboarding-manager';
import { TelegramCommandHandler } from './telegram-command-handler';
import { topicManager } from './topic-manager';
import { PersistenceService } from './persistence';
import { AgentManager } from './agent-manager';
import { QueueManager } from './queue-manager';
import { UserContextManager } from './user-context-manager';
import { Semaphore } from './semaphore';
import { RalphLoopManager } from './ralph-loop-manager';
import { DEFAULTS } from './types';
import type { Agent, AgentType, ModelMode, UserPreferences } from './types';
import { executeCommand, formatBashResult, getFullOutputFilename } from './bash-executor';

// =============================================================================
// Configuration
// =============================================================================

const config = {
  port: parseInt(process.env.PORT || '3000'),
  allowedUsernames: new Set(
    (process.env.ALLOWED_TELEGRAM_USERNAMES || '')
      .split(',')
      .map(u => u.trim().toLowerCase())
      .filter(Boolean)
  ),
};

function isAuthorizedUser(username?: string): boolean {
  if (!username) return false;
  if (config.allowedUsernames.size === 0) return true;
  return config.allowedUsernames.has(username.toLowerCase());
}

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

// Direct Telegram send functions for QueueManager
async function sendTelegramDirectMessage(chatId: number, text: string, threadId?: number): Promise<{ message_id: number } | null> {
  const msg = await sendTelegramMessage(chatId, text, undefined, threadId);
  return msg ? { message_id: msg.message_id } : null;
}

async function sendTelegramDirectImage(chatId: number, imageUrl: string, caption?: string, threadId?: number): Promise<void> {
  await sendTelegramPhoto(chatId, imageUrl, caption, threadId);
}

async function editTelegramDirectMessage(chatId: number | string, messageId: number, text: string): Promise<boolean> {
  return await editTelegramMessage(chatId, messageId, text) ?? false;
}

/**
 * Queue an introduction prompt so the agent presents itself in the group
 */
function sendAgentIntroduction(agent: Agent, chatId: number): void {
  const workspaceInfo = agent.workspace ? `Seu workspace é: ${agent.workspace}` : 'Você não tem workspace definido';
  const introPrompt = `Você acabou de ser vinculado a este grupo do Telegram. Apresente-se brevemente (2-3 frases). ${workspaceInfo}. Diga o que pode fazer e que o usuário pode enviar mensagens diretamente aqui.`;

  queueManager.enqueue({
    agentId: agent.id,
    prompt: introPrompt,
    model: agent.modelMode === 'selection' ? 'sonnet' : agent.modelMode as 'haiku' | 'sonnet' | 'opus',
    userId: agent.userId,
    replyTo: chatId,
  });
}

// Queue manager
const queueManager = new QueueManager(
  semaphore,
  agentManager,
  terminal,
  sendTelegramDirectMessage,
  sendTelegramDirectImage,
  startTypingIndicator,
  editTelegramDirectMessage,
  topicManager
);

// Telegram command handler (stateless router)
const telegramCommandHandler = new TelegramCommandHandler(agentManager, groupOnboardingManager, topicManager);

// Ralph loop manager (for autonomous Ralph mode execution)
const ralphLoopManager = new RalphLoopManager(semaphore, agentManager, persistenceService, terminal);

// User context manager (in-memory, not persisted)
const userContextManager = new UserContextManager();

// Track pending agent creation for /link command (userId -> agentId)
const pendingAgentLink = new Map<string, string>();

// Map to store selected agents for prompt sending (agentId awaiting model selection)
const pendingAgentSelection = new Map<string, string>();

// Note: lastErrors is now managed by QueueManager for proper error recovery (Flow 11)

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
  if (!isAuthorizedUser(telegramUsername)) {
    console.log(`[telegram] Unauthorized group add from @${telegramUsername || 'unknown'} (chat ${chatId})`);
    return;
  }

  // Auto-register if needed
  const userId = `telegram:${telegramUsername}`;
  let userPrefs = persistenceService.loadUserPreferences(userId);
  if (!userPrefs) {
    userPrefs = {
      userId,
      telegramUsername,
      telegramChatId: chatId,
    };
    persistenceService.saveUserPreferences(userPrefs);
  }

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
 * Handle Telegram message
 */
async function handleTelegramMessage(message: any): Promise<void> {
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
  const hasVoice = !!message.voice || !!message.audio;
  const msgType = hasPhoto ? '[photo]' : hasDocument ? '[document]' : hasVoice ? '[voice]' : text.slice(0, 50);
  const threadInfo = threadId ? ` [thread:${threadId}]` : '';
  console.log(`[telegram] ${from.username || from.id} (${chatType}${threadInfo}): ${msgType}`);
  console.log(`[telegram] DEBUG: chatId=${chatId}, chatType=${chatType}, threadId=${threadId}, from.username=${from.username}, from.id=${from.id}`);

  // Ignore empty messages (system notifications like bot join/leave, topic creation, etc.)
  if (!text && !hasPhoto && !hasDocument && !hasVoice && !caption) {
    return;
  }

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
  // Whitelist check
  // =============================================================================
  if (!isAuthorizedUser(from.username)) {
    console.log(`[telegram] Unauthorized access from @${from.username || 'unknown'} (chat ${chatId})`);
    return;
  }

  // Auto-register user preferences if not exists
  const userId = `telegram:${from.username}`;
  let userPrefs = persistenceService.loadUserPreferences(userId);
  if (!userPrefs) {
    userPrefs = {
      userId,
      telegramUsername: from.username,
      telegramChatId: chatId,
    };
    persistenceService.saveUserPreferences(userPrefs);
    console.log(`[telegram] Auto-registered user @${from.username}`);
  }

  // Update telegram chat ID for private chats
  if (chatType === 'private' && !userPrefs.telegramChatId) {
    userPrefs.telegramChatId = chatId;
    persistenceService.saveUserPreferences(userPrefs);
  }

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
    // Check if chat is a forum (has topics enabled)
    // Note: is_forum is available in the chat object for supergroups
    const isForum = message.chat.is_forum === true;

    // Check if user is in a flow (e.g. /criar awaiting name) - intercept non-command text
    if (!text.startsWith('/') && userContextManager.isInFlow(userId)) {
      await handleTelegramFlowInput(chatId, userId, text);
      return;
    }

    // Group message routing with topic support
    const route = telegramCommandHandler.routeGroupMessage(chatId, userId, text, from.id, threadId, isForum);

    switch (route.action) {
      case 'command':
        // Handle /cancelar specially as it needs telegram user ID for lock validation
        if (route.command === '/cancelar') {
          await handleGroupCancelarCommand(chatId, userId, from.id);
          return;
        }
        await handleTelegramCommand(chatId, userId, `${route.command} ${route.args}`.trim(), route.threadId);
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

      case 'ralph_control':
        // Handle /pausar, /retomar, /cancelar commands in Ralph topics
        await handleRalphControlCommand(
          chatId,
          route.threadId,
          route.loopId,
          route.command
        );
        return;

      case 'topic_workspace': {
        const { chatId: wsChatId, userId: wsUserId, threadId: wsThreadId, agentId: wsAgentId, path } = route;
        if (path) {
          // Direct path provided: /workspace /some/path
          const topic = wsThreadId ? topicManager.getTopicByThreadId(wsAgentId, wsThreadId) : undefined;
          if (topic) {
            topicManager.updateTopicWorkspace(wsAgentId, topic.id, path);
            persistenceService.addRecentWorkspace(wsUserId, path);
            await sendTelegramMessage(wsChatId, `✅ Workspace atualizado: \`${path}\``, undefined, wsThreadId);
          } else {
            await sendTelegramMessage(wsChatId, '❌ Tópico não encontrado.', undefined, wsThreadId);
          }
        } else {
          // No path: show workspace selector
          const topic = wsThreadId ? topicManager.getTopicByThreadId(wsAgentId, wsThreadId) : undefined;
          if (topic) {
            await sendTopicWorkspaceReconfig(wsChatId, topic.id, wsThreadId);
          } else {
            await sendTelegramMessage(wsChatId, '❌ Tópico não encontrado.', undefined, wsThreadId);
          }
        }
        return;
      }

      case 'topic_workspace_general':
        await sendTelegramMessage(route.chatId, '💡 O comando /workspace só funciona dentro de um tópico específico.\n\nAbra um tópico e use /workspace lá.');
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
          'Cadastro nao localizado.'
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
      if (originalCallback) {
        ralphLoopManager.setProgressCallback(originalCallback);
      }
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
      if (originalCallback) {
        ralphLoopManager.setProgressCallback(originalCallback);
      }
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
    await sendTelegramMessage(chatId, `📤 Processando mensagem enfileirada...`, undefined, threadId);

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
 * Create a topic and send notifications to both General and the new topic
 */
async function createTopicAndNotify(
  chatId: number,
  userId: string,
  agentId: string,
  name: string,
  type: 'worktree' | 'session'
): Promise<void> {
  try {
    // Create the topic via TopicManager
    const result = await topicManager.createTopic({
      agentId,
      chatId,
      name,
      type,
    });

    if (!result.success || !result.topic) {
      await sendTelegramMessage(chatId, `❌ Erro ao criar tópico: ${result.error || 'Falha desconhecida'}`);
      userContextManager.clearContext(userId);
      return;
    }

    const topic = result.topic;

    // Send notification to General topic
    await sendTopicCreatedInGeneral(chatId, name, type, topic.telegramTopicId);

    // Send welcome message in the new topic
    await sendTopicWelcome(chatId, topic.telegramTopicId, name, type);

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
  maxIterations: number
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
    await sendTopicWelcome(chatId, topic.telegramTopicId, topicName, 'ralph', task);

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
      if (originalCallback) {
        ralphLoopManager.setProgressCallback(originalCallback);
      }
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
async function handleTelegramCommand(chatId: number, userId: string, text: string, threadId?: number): Promise<void> {
  const parts = text.split(' ');
  const command = parts[0].toLowerCase();
  const args = parts.slice(1).join(' ').trim();

  switch (command) {
    case '/start':
      await sendTelegramCommandList(chatId, threadId);
      break;

    case '/criar':
    case '/new':
      userContextManager.startCreateAgentFlow(userId);
      await sendTelegramAgentNamePrompt(chatId, threadId);
      break;

    case '/agentes':
    case '/list':
      const agents = agentManager.listAgents(userId)
        .map(a => ({
          id: a.id,
          name: a.name,
          emoji: a.emoji || '🤖',
          status: a.status,
          workspace: a.workspace,
        }));
      await sendTelegramAgentsList(chatId, agents, threadId);
      break;

    case '/status':
      await handleTelegramStatus(chatId, userId, threadId);
      break;

    case '/help':
      await sendTelegramCommandList(chatId, threadId);
      break;

    case '/link':
      await handleTelegramLinkCommand(chatId, userId);
      break;

    default:
      await sendTelegramMessage(chatId, 'Comando nao reconhecido. Use /help.', undefined, threadId);
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

    const flowData = userContextManager.getTopicRalphData(userId);
    if (flowData?.agentId && flowData?.topicTask) {
      await createRalphTopicAndStart(chatId, userId, flowData.agentId, flowData.topicTask, iterations);
    }
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
    const flowData = userContextManager.getTopicCreationData(userId);

    if (flowData?.agentId && flowData?.flowType) {
      const topicType = flowData.flowType === 'topic_worktree' ? 'worktree' : 'session';
      await createTopicAndNotify(chatId, userId, flowData.agentId, name, topicType);
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

  // Whitelist check
  if (!isAuthorizedUser(from.username)) {
    console.log(`[telegram] Unauthorized callback from @${from.username || 'unknown'} (chat ${chatId})`);
    return;
  }

  // Auto-register user preferences if not exists
  const userId = `telegram:${from.username}`;
  let userPrefs = persistenceService.loadUserPreferences(userId);
  if (!userPrefs) {
    userPrefs = {
      userId,
      telegramUsername: from.username,
      telegramChatId: chatId,
    };
    persistenceService.saveUserPreferences(userPrefs);
  }

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

        // Send agent introduction
        sendAgentIntroduction(agent, pendingGroupLink);
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
      let leftGroup = false;
      if (telegramChatId) {
        leftGroup = await leaveTelegramGroup(telegramChatId);
        if (!leftGroup) {
          console.error(`[delete] Failed to leave group ${telegramChatId} for agent ${name}`);
        }
      }

      agentManager.deleteAgent(agentId);
      if (telegramChatId && !leftGroup) {
        await sendTelegramMessage(chatId, `✅ Agente *${name}* deletado.\n\n⚠️ Não foi possível sair do grupo. Remova o bot manualmente.`);
      } else {
        await sendTelegramMessage(chatId, `✅ Agente *${name}* e grupo deletados.`);
      }
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
      .filter(a => !a.telegramChatId);

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

    // Send agent introduction
    sendAgentIntroduction(agent, chatId);
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

      // Send agent introduction
      sendAgentIntroduction(agent, chatId);

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
      const flowData = userContextManager.getTopicRalphData(userId);

      if (flowData?.agentId && flowData?.topicTask) {
        userContextManager.setTopicMaxIterations(userId, iterations);
        await createRalphTopicAndStart(chatId, userId, flowData.agentId, flowData.topicTask, iterations);
      }
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
  // =============================================================================
  // Workspace Callbacks
  // =============================================================================
  // Workspace not found: use agent workspace
  else if (data.startsWith('ws_notfound_agent_')) {
    const topicId = data.replace('ws_notfound_agent_', '');
    const agent = agentManager.getAgentByTelegramChatId(chatId);
    if (agent) {
      topicManager.updateTopicWorkspace(agent.id, topicId, undefined); // Clear topic workspace, fall back to agent
      await sendTelegramMessage(chatId, '✅ Usando workspace do agente.');
    }
  }
  // Workspace not found: use sandbox
  else if (data.startsWith('ws_notfound_sandbox_')) {
    const topicId = data.replace('ws_notfound_sandbox_', '');
    const agent = agentManager.getAgentByTelegramChatId(chatId);
    if (agent) {
      topicManager.updateTopicWorkspace(agent.id, topicId, 'sandbox');
      await sendTelegramMessage(chatId, '✅ Usando sandbox.');
    }
  }
  // Workspace not found: reconfigure
  else if (data.startsWith('ws_notfound_reconfig_')) {
    const topicId = data.replace('ws_notfound_reconfig_', '');
    await sendTopicWorkspaceReconfig(chatId, topicId);
  }
  // Workspace not found: cancel
  else if (data.startsWith('ws_notfound_cancel_')) {
    await sendTelegramMessage(chatId, '❌ Operação cancelada.');
  }
  // Workspace reconfig: path selected
  else if (data.startsWith('ws_reconfig_')) {
    const rest = data.replace('ws_reconfig_', '');
    // Format: {topicId}_path_{path} or {topicId}_sandbox or {topicId}_custom
    const firstUnderscore = rest.indexOf('_');
    const topicId = rest.substring(0, firstUnderscore);
    const action = rest.substring(firstUnderscore + 1);

    const agent = agentManager.getAgentByTelegramChatId(chatId);
    if (!agent) return;

    if (action === 'sandbox') {
      topicManager.updateTopicWorkspace(agent.id, topicId, 'sandbox');
      await sendTelegramMessage(chatId, '✅ Workspace configurado: sandbox');
    } else if (action === 'custom') {
      await sendTelegramMessage(chatId, '✏️ Digite o caminho completo do workspace:');
      // Store state for next message
      userContextManager.setContext(userId, {
        userId,
        currentFlow: 'workspace_not_found',
        flowData: { topicId, agentId: agent.id },
      });
    } else if (action.startsWith('path_')) {
      const path = action.replace('path_', '');
      topicManager.updateTopicWorkspace(agent.id, topicId, path);
      persistenceService.addRecentWorkspace(userId, path);
      await sendTelegramMessage(chatId, `✅ Workspace configurado: \`${path}\``);
    }
  }
  // Topic workspace button from welcome message
  else if (data.startsWith('topic_workspace:')) {
    const topicId = data.replace('topic_workspace:', '');
    await sendTopicWorkspaceReconfig(chatId, topicId);
  }
  // Topic creation: configure workspace
  else if (data === 'topic_create_ws_yes') {
    // User wants to configure workspace during topic creation
    const agent = agentManager.getAgentByTelegramChatId(chatId);
    if (agent) {
      userContextManager.setAwaitingTopicWorkspace(userId);
      await sendTopicWorkspaceReconfig(chatId, 'new');
    }
  }
  else if (data === 'topic_create_ws_skip') {
    // Skip workspace configuration - continue with topic creation
    // The topic creation flow should continue from where it was
    await sendTelegramMessage(chatId, '⏭️ Usando workspace do agente.');
  }
}

/**
 * Handle Telegram status command
 */
async function handleTelegramStatus(chatId: number, userId: string, threadId?: number): Promise<void> {
  const agents = agentManager.listAgents(userId);

  await sendTelegramStatusOverview(chatId, agents.map(a => ({
    name: a.name,
    emoji: a.emoji || '🤖',
    status: a.status,
    statusDetails: a.statusDetails,
  })), threadId);
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
    .filter(a => !a.telegramChatId)
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

    // Send agent introduction
    sendAgentIntroduction(targetAgent, chatId);
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
  groupOnboardingManager,
  handleTelegramCallback,
  handleTelegramMessage,
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
