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
} from './whatsapp';
import { transcribeAudio } from './transcription';
import { PersistenceService } from './persistence';
import { AgentManager, AgentValidationError } from './agent-manager';
import { QueueManager } from './queue-manager';
import { UserContextManager } from './user-context-manager';
import { Semaphore } from './semaphore';
import { RalphLoopManager } from './ralph-loop-manager';
import { DEFAULTS } from './types';
import type { Agent, AgentType } from './types';
import { executeCommand, formatBashResult, getFullOutputFilename } from './bash-executor';
import { uploadToKapso, downloadFromKapso } from './storage';

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

// Claude terminal
const terminal = new ClaudeTerminal();

// Queue manager (with image, file, and error recovery support)
const queueManager = new QueueManager(semaphore, agentManager, terminal, sendWhatsApp, sendWhatsAppImage, sendErrorWithActions, sendWhatsAppMedia);

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
        return c.json(await handleTextMessage(userId, message.text!, message.messageId));

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
// Text Message Handler
// =============================================================================

async function handleTextMessage(
  userId: string,
  text: string,
  messageId?: string
): Promise<{ status: string }> {
  console.log(`> ${text}`);

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
        userContextManager.setAgentWorkspace(userId, workspace);
        const data = userContextManager.getCreateAgentData(userId);

        // Create the agent with type
        const agentType = data?.agentType || 'claude';
        const agent = agentManager.createAgent(userId, data!.agentName!, data?.workspace, data?.emoji, agentType);
        console.log(`Created ${agentType} agent '${agent.name}' for user ${userId}`);

        userContextManager.completeFlow(userId);

        const agentEmoji = agent.emoji || '🤖';
        await sendWhatsApp(userId, `✅ Agente ${agentEmoji} *${agent.name}* criado!`);
        await sendButtons(userId, 'Enviar prompt agora?', [
          { id: `newagent_prompt_${agent.id}`, title: 'Enviar prompt' },
          { id: 'newagent_later', title: 'Depois' },
        ]);

        return { status: 'agent_created' };
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

  // Mode selection (Conversational vs Ralph)
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

  // Check if agent is busy
  if (agent.status === 'processing') {
    await sendWhatsApp(
      userId,
      `⏳ Agente *${agent.name}* ocupado. Prompt enfileirado. Você será notificado quando iniciar.`
    );
  } else {
    await sendWhatsApp(userId, `Processando com ${model}...`);
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

  // Check if agent is busy
  if (agent.status === 'processing') {
    await sendWhatsApp(
      userId,
      `⏳ Agente *${agent.name}* ocupado. Prompt enfileirado. Você será notificado quando iniciar.`
    );
  } else {
    await sendWhatsApp(userId, `Processando com ${model}...`);
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
    const agentName = agent?.name || 'Unknown';

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

    await sendWhatsApp(userId, `🔄 Loop do agente *${agent.name}* iniciado!`);

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

  // Check if agent is busy
  if (agent.status === 'processing') {
    await sendWhatsApp(
      userId,
      `⏳ Agente *${agent.name}* ocupado. Prompt enfileirado. Você será notificado quando iniciar.`
    );
  } else {
    await sendWhatsApp(userId, `Processando com ${model}...`);
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
  await sendWorkspaceSelector(userId, messageId);
  return { status: 'awaiting_workspace_choice' };
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

  // Create the agent
  try {
    userContextManager.setAgentWorkspace(userId, workspace);
    const data = userContextManager.getCreateAgentData(userId);

    const agentType = data?.agentType || 'claude';
    const agent = agentManager.createAgent(userId, data!.agentName!, data?.workspace, data?.emoji, agentType);
    console.log(`Created ${agentType} agent '${agent.name}' for user ${userId}`);

    userContextManager.completeFlow(userId);

    const agentEmoji = agent.emoji || (agentType === 'bash' ? '🖥️' : '🤖');
    const typeLabel = agentType === 'bash' ? '(Bash)' : '';
    await sendWhatsApp(userId, `✅ Agente ${agentEmoji} *${agent.name}* ${typeLabel} criado!`);

    const promptLabel = agentType === 'bash' ? 'Enviar comando' : 'Enviar prompt';
    await sendButtons(userId, `${agentType === 'bash' ? 'Executar comando agora?' : 'Enviar prompt agora?'}`, [
      { id: `newagent_prompt_${agent.id}`, title: promptLabel },
      { id: 'newagent_later', title: 'Depois' },
    ]);

    return { status: 'agent_created' };
  } catch (error) {
    if (error instanceof AgentValidationError) {
      await sendWhatsApp(userId, `❌ ${error.message}`);
      userContextManager.completeFlow(userId);
      return { status: 'error' };
    }
    throw error;
  }
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

function extractMessage(payload: unknown): ExtractedMessage | null {
  try {
    const p = payload as Record<string, unknown>;

    // Kapso v2 format
    if (p?.message && p?.conversation) {
      const message = p.message as Record<string, unknown>;
      const conversation = p.conversation as Record<string, unknown>;
      const from = ((conversation.phone_number as string) || '').replace('+', '');

      // Button reply
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

      // List reply
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
