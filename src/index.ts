import { Hono } from 'hono';
import { serve } from 'bun';
import { ClaudeTerminal, detectOldSessions, migrateOldSessions, type Model } from './terminal';
import {
  sendWhatsApp,
  sendWhatsAppImage,
  sendModelSelector,
  sendCommandsList,
  sendAgentsList,
  sendAgentMenu,
  sendHistoryList,
  sendErrorWithActions,
  sendConfigureLimitMenu,
  sendConfigurePriorityMenu,
  sendConfirmation,
  sendMigrationOptions,
  sendButtons,
  sendAgentSelectionForReset,
  sendOutputActions,
} from './whatsapp';
import { PersistenceService } from './persistence';
import { AgentManager, AgentValidationError } from './agent-manager';
import { QueueManager } from './queue-manager';
import { UserContextManager } from './user-context-manager';
import { Semaphore } from './semaphore';
import { DEFAULTS } from './types';
import type { Agent } from './types';

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
const semaphore = new Semaphore(agentManager.getConfig().maxConcurrent || DEFAULTS.MAX_CONCURRENT);

// Claude terminal
const terminal = new ClaudeTerminal();

// Queue manager (with image and error recovery support)
const queueManager = new QueueManager(semaphore, agentManager, terminal, sendWhatsApp, sendWhatsAppImage, sendErrorWithActions);

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

  // Check if there's already a pending agent selection (from agent menu "Enviar prompt")
  const pendingAgent = pendingAgentSelection.get(userId);
  if (pendingAgent) {
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
    const names = activeAgents.map((a) => a.name).join(', ');
    await sendWhatsApp(
      userId,
      `⚠️ Agentes em execução: ${names}. Seu prompt será enfileirado se selecionar agente ocupado.`
    );
  }

  // Show agent selection list
  await sendAgentsList(userId, agents, messageId);

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
  await sendAgentsList(userId, agents);
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
      '/help - Esta mensagem\n\n' +
      '*Agentes:*\n' +
      'Cada agente mantém seu próprio contexto de conversa.\n' +
      'Você pode criar agentes com workspaces específicos.\n' +
      'Agentes de alta prioridade são processados primeiro.\n\n' +
      '*Modelos:*\n' +
      'Haiku - Rápido e econômico\n' +
      'Opus - Mais capaz e detalhado'
  );
  return { status: 'help_shown' };
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
        await sendWhatsApp(userId, 'Workspace (opcional)? Envie o caminho completo ou "pular"');
        return { status: 'awaiting_workspace' };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        await sendWhatsApp(userId, `❌ ${msg}. Tente novamente:`);
        return { status: 'awaiting_agent_name' };
      }
    }

    if (userContextManager.isAwaitingWorkspace(userId)) {
      const workspace = text.toLowerCase() === 'pular' ? null : text.trim();

      try {
        userContextManager.setAgentWorkspace(userId, workspace);
        const data = userContextManager.getCreateAgentData(userId);

        // Create the agent
        const agent = agentManager.createAgent(userId, data!.agentName!, data?.workspace);
        console.log(`Created agent '${agent.name}' for user ${userId}`);

        userContextManager.completeFlow(userId);

        await sendWhatsApp(userId, `✅ Agente '${agent.name}' criado!`);
        await sendButtons(userId, 'Enviar prompt agora?', [
          { id: `newagent_prompt_${agent.id}`, title: 'Enviar prompt' },
          { id: 'newagent_later', title: 'Depois' },
        ]);

        return { status: 'agent_created' };
      } catch (error) {
        if (error instanceof AgentValidationError) {
          await sendWhatsApp(userId, `❌ ${error.message}. Tente novamente ou envie "pular":`);
          return { status: 'awaiting_workspace' };
        }
        throw error;
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

  // Generic buttons (Yes/No)
  if (buttonId === 'yes' || buttonId === 'no') {
    return handleGenericConfirmation(userId, buttonId);
  }

  return { status: 'unknown_button' };
}

/**
 * Handle model selection (Haiku/Opus)
 */
async function handleModelSelection(
  userId: string,
  buttonId: string
): Promise<{ status: string }> {
  const model: Model = buttonId.startsWith('model_opus') ? 'opus' : 'haiku';
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

  // Note: Error context is stored by QueueManager when errors occur (Flow 11)

  // Check if agent is busy
  if (agent.status === 'processing') {
    await sendWhatsApp(
      userId,
      `⏳ Agente ${agent.name} ocupado. Prompt enfileirado. Você será notificado quando iniciar.`
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
    const agent = agentManager.getAgent(agentId);
    const agentName = agent?.name || 'Unknown';

    terminal.clearSession(userId, agentId);
    agentManager.deleteAgent(agentId);

    await sendWhatsApp(userId, `✅ Agente '${agentName}' deletado.`);
    return { status: 'deleted' };
  }

  // Cancel confirmation
  if (buttonId === 'confirm_cancel') {
    await sendWhatsApp(userId, 'Operação cancelada.');
    return { status: 'cancelled' };
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
// List Reply Handler
// =============================================================================

async function handleListReply(
  userId: string,
  listId: string,
  messageId?: string
): Promise<{ status: string }> {
  console.log(`> List: ${listId}`);

  // Agent selection for prompt
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

  if (listId === 'action_configure_limit') {
    return handleConfigureLimitCommand(userId);
  }

  if (listId === 'action_configure_priority') {
    return handleConfigurePriorityCommand(userId);
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
        `⚠️ Limpar sessão do agente '${agent.name}'?\n\nIsso apagará todo o contexto da conversa.`,
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
        `⚠️ Deletar agente '${agent.name}'?\n\nIsso é irreversível.`,
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
    `⚠️ Limpar sessão do agente '${agent.name}'?\n\nIsso apagará todo o contexto da conversa.`,
    [
      { id: `confirm_reset_${selection}`, title: 'Confirmar' },
      { id: 'confirm_cancel', title: 'Cancelar' },
    ]
  );
  return { status: 'awaiting_reset_confirmation' };
}

/**
 * Handle execution limit selection
 */
async function handleLimitSelection(
  userId: string,
  listId: string
): Promise<{ status: string }> {
  const newLimit = parseInt(listId.replace('limit_', ''), 10);

  // 0 means "no limit" - use a high number
  const effectiveLimit = newLimit === 0 ? 100 : newLimit;

  semaphore.setMaxPermits(effectiveLimit);
  agentManager.updateConfig({ maxConcurrent: effectiveLimit });

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
  await sendWhatsApp(userId, `✅ Prioridade do agente '${agent.name}' atualizada para ${priorityLabel}.`);

  return { status: 'priority_updated' };
}

// =============================================================================
// Message Extraction
// =============================================================================

type ExtractedMessage = {
  from: string;
  type: 'text' | 'button' | 'list';
  text?: string;
  buttonId?: string;
  listId?: string;
  messageId?: string;
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
