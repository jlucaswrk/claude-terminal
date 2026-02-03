import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'bun:test';
import { unlinkSync, existsSync } from 'fs';

// Set test environment BEFORE importing modules
process.env.NODE_ENV = 'test';
process.env.PORT = '3001';
process.env.KAPSO_WEBHOOK_SECRET = 'test-secret';
process.env.USER_PHONE_NUMBER = '+5581999999999';
process.env.KAPSO_API_KEY = 'test-api-key';
process.env.KAPSO_PHONE_NUMBER_ID = 'test-phone-id';

// Track WhatsApp API calls
const whatsappCalls: Array<{ to: string; body: any }> = [];

// Mock fetch for WhatsApp API calls BEFORE any imports
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input.toString();

  // Intercept WhatsApp API calls
  if (url.includes('api.kapso.ai')) {
    const body = init?.body ? JSON.parse(init.body as string) : {};
    whatsappCalls.push({ to: body.to, body });

    // Handle group creation API calls
    if (url.includes('/groups') && init?.method === 'POST' && !url.includes('/participants')) {
      return new Response(JSON.stringify({ id: `mock-group-${Date.now()}@g.us` }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Handle group deletion
    if (url.includes('/groups') && init?.method === 'DELETE') {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Pass through other requests
  return originalFetch(input, init);
};

// Cleanup files
const TEST_STATE_FILE = './agents-state.json';
const TEST_STATE_BACKUP = './agents-state.json.bak';
const TEST_SESSIONS_FILE = './.claude-terminal-sessions.json';

// Helper to create webhook payloads
function createTextPayload(from: string, text: string, messageId = 'msg-1') {
  return {
    message: {
      type: 'text',
      text: { body: text },
      kapso: { content: text },
      id: messageId,
    },
    conversation: {
      phone_number: `+${from}`,
    },
  };
}

function createButtonPayload(from: string, buttonId: string) {
  return {
    message: {
      type: 'interactive',
      interactive: {
        type: 'button_reply',
        button_reply: { id: buttonId },
      },
    },
    conversation: {
      phone_number: `+${from}`,
    },
  };
}

function createListPayload(from: string, listId: string) {
  return {
    message: {
      type: 'interactive',
      interactive: {
        type: 'list_reply',
        list_reply: { id: listId },
      },
    },
    conversation: {
      phone_number: `+${from}`,
    },
  };
}

// Dynamic imports - loaded after env vars are set
let app: any;
let agentManager: any;
let userContextManager: any;
let pendingAgentSelection: any;

// Helper to make webhook requests
async function postWebhook(payload: unknown) {
  const response = await app.request('/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return {
    status: response.status,
    json: await response.json(),
  };
}

describe('Webhook Integration Tests', () => {
  const userId = '5581999999999';

  beforeAll(async () => {
    // Dynamically import AFTER env vars are set
    const mod = await import('../index');
    app = mod.app;
    agentManager = mod.agentManager;
    userContextManager = mod.userContextManager;
    pendingAgentSelection = mod.pendingAgentSelection;
  });

  beforeEach(() => {
    // Clear WhatsApp call tracking
    whatsappCalls.length = 0;

    // Clear user context
    userContextManager?.clearAll();

    // Clear pending selections
    pendingAgentSelection?.clear();

    // Delete all agents for test user
    const agents = agentManager?.listAgents(userId) || [];
    for (const agent of agents) {
      agentManager.deleteAgent(agent.id);
    }
  });

  afterEach(() => {
    // Cleanup test files
    try {
      if (existsSync(TEST_STATE_FILE)) unlinkSync(TEST_STATE_FILE);
      if (existsSync(TEST_STATE_BACKUP)) unlinkSync(TEST_STATE_BACKUP);
      if (existsSync(TEST_SESSIONS_FILE)) unlinkSync(TEST_SESSIONS_FILE);
    } catch {}
  });

  describe('Flow 1: Prompts from Main Number', () => {
    it('should reject prompts from main number (use groups instead)', async () => {
      const payload = createTextPayload(userId, 'Hello Claude');
      const result = await postWebhook(payload);

      // Main number now rejects prompts - use groups for prompts
      expect(result.json.status).toBe('rejected_prompt');

      // Should have sent rejection message
      expect(whatsappCalls.some(c =>
        c.body.text?.body?.includes('grupo') || c.body.text?.body?.includes('Prompts')
      )).toBe(true);
    });
  });

  describe('Flow 2: Prompts Rejected from Main Number', () => {
    it('should reject prompts from main number even when user has agents', async () => {
      // Setup: Create an agent first
      agentManager.createAgent(userId, 'Test Agent');

      // Send a prompt from main number
      const payload = createTextPayload(userId, 'What is 2+2?');
      const result = await postWebhook(payload);

      // Main number now rejects prompts - use groups for prompts
      expect(result.json.status).toBe('rejected_prompt');

      // Should have sent rejection message
      expect(whatsappCalls.some(c =>
        c.body.text?.body?.includes('grupo') || c.body.text?.body?.includes('Prompts')
      )).toBe(true);
    });
  });

  describe('Flow 5: Menu Command (/)', () => {
    it('should show agents list when user sends /', async () => {
      // Create an agent first
      agentManager.createAgent(userId, 'Test Agent');

      const payload = createTextPayload(userId, '/');
      const result = await postWebhook(payload);

      expect(result.json.status).toBe('menu_shown');

      // Should have sent agent list
      const listCall = whatsappCalls.find(c => c.body.interactive?.type === 'list');
      expect(listCall).toBeDefined();
    });
  });

  describe('Flow 7: Reset Command', () => {
    it('should show reset confirmation for /reset', async () => {
      // Create an agent first
      agentManager.createAgent(userId, 'Test Agent');

      const payload = createTextPayload(userId, '/reset');
      const result = await postWebhook(payload);

      expect(result.json.status).toBe('awaiting_reset_selection');

      // Should have sent reset selection list
      const listCall = whatsappCalls.find(c => c.body.interactive?.type === 'list');
      expect(listCall).toBeDefined();
      expect(listCall?.body.interactive.body.text).toContain('Resetar');
    });

    it('should show no agents message when no agents exist', async () => {
      const payload = createTextPayload(userId, '/reset');
      const result = await postWebhook(payload);

      expect(result.json.status).toBe('no_agents');

      // Should have sent message about no agents
      expect(whatsappCalls.some(c =>
        c.body.text?.body?.includes('Nenhum agente')
      )).toBe(true);
    });
  });

  describe('Flow 8: Configure Limit', () => {
    it('should show limit configuration menu', async () => {
      const payload = createListPayload(userId, 'action_configure_limit');
      const result = await postWebhook(payload);

      expect(result.json.status).toBe('awaiting_limit_selection');

      // Should have sent limit menu
      const listCall = whatsappCalls.find(c => c.body.interactive?.type === 'list');
      expect(listCall).toBeDefined();
      expect(listCall?.body.interactive.body.text).toContain('limite');
    });

    it('should update limit when selected', async () => {
      // First show menu
      await postWebhook(createListPayload(userId, 'action_configure_limit'));
      whatsappCalls.length = 0;

      // Select a limit
      const payload = createListPayload(userId, 'limit_5');
      const result = await postWebhook(payload);

      expect(result.json.status).toBe('limit_updated');

      // Should confirm the update
      expect(whatsappCalls.some(c =>
        c.body.text?.body?.includes('Limite atualizado')
      )).toBe(true);
    });
  });

  describe('Flow 9: Configure Priority', () => {
    it('should show priority menu for agent', async () => {
      // Create agent first
      const agent = agentManager.createAgent(userId, 'Test Agent');

      const payload = createListPayload(userId, `agentmenu_priority_${agent.id}`);
      const result = await postWebhook(payload);

      expect(result.json.status).toBe('awaiting_priority_selection');

      // Should have sent priority menu
      const listCall = whatsappCalls.find(c => c.body.interactive?.type === 'list');
      expect(listCall).toBeDefined();
      expect(listCall?.body.interactive.body.text).toContain('prioridade');
    });
  });

  describe('Flow 10: History', () => {
    it('should show history list for agent', async () => {
      // Create agent first
      const agent = agentManager.createAgent(userId, 'Test Agent');

      const payload = createListPayload(userId, `agentmenu_history_${agent.id}`);
      const result = await postWebhook(payload);

      expect(result.json.status).toBe('history_shown');

      // Should have sent history list
      const listCall = whatsappCalls.find(c => c.body.interactive?.type === 'list');
      expect(listCall).toBeDefined();
      expect(listCall?.body.interactive.body.text).toContain('Histórico');
    });
  });

  describe('Button Reply Handling', () => {
    it('should handle model selection when pending prompt exists', async () => {
      // Setup: Create agent and set pending state
      const agent = agentManager.createAgent(userId, 'Test Agent');
      userContextManager.setPendingPrompt(userId, 'Test prompt', 'msg-1');
      pendingAgentSelection.set(userId, agent.id);

      const payload = createButtonPayload(userId, 'model_haiku_123');
      const result = await postWebhook(payload);

      expect(result.json.status).toBe('task_enqueued');

      // Should have sent processing message
      expect(whatsappCalls.some(c =>
        c.body.text?.body?.includes('Processando')
      )).toBe(true);
    });

    it('should handle cancel confirmation', async () => {
      const payload = createButtonPayload(userId, 'confirm_cancel');
      const result = await postWebhook(payload);

      expect(result.json.status).toBe('cancelled');

      // Should have sent cancellation message
      expect(whatsappCalls.some(c =>
        c.body.text?.body?.includes('cancelada')
      )).toBe(true);
    });

    it('should report no pending prompt when selecting model without context', async () => {
      const payload = createButtonPayload(userId, 'model_opus_123');
      const result = await postWebhook(payload);

      expect(result.json.status).toBe('no_pending');
    });
  });

  describe('List Reply Handling', () => {
    it('should show agent menu when selecting agent without pending prompt', async () => {
      const agent = agentManager.createAgent(userId, 'Test Agent');

      const payload = createListPayload(userId, `agent_${agent.id}`);
      const result = await postWebhook(payload);

      expect(result.json.status).toBe('agent_menu_shown');

      // Should have sent agent menu
      const listCall = whatsappCalls.find(c => c.body.interactive?.type === 'list');
      expect(listCall).toBeDefined();
      expect(listCall?.body.interactive.body.text).toContain('Test Agent');
    });

    it('should show model selector when selecting agent with pending prompt', async () => {
      const agent = agentManager.createAgent(userId, 'Test Agent');
      userContextManager.setPendingPrompt(userId, 'Test prompt', 'msg-1');

      const payload = createListPayload(userId, `agent_${agent.id}`);
      const result = await postWebhook(payload);

      expect(result.json.status).toBe('awaiting_model_selection');

      // Should have sent model selector
      const buttonCall = whatsappCalls.find(c => c.body.interactive?.type === 'button');
      expect(buttonCall).toBeDefined();
    });

    it('should start create agent flow', async () => {
      const payload = createListPayload(userId, 'action_create_agent');
      const result = await postWebhook(payload);

      expect(result.json.status).toBe('awaiting_agent_name');

      // Should have asked for agent name
      expect(whatsappCalls.some(c =>
        c.body.text?.body?.includes('Nome')
      )).toBe(true);
    });

    it('should handle help command from list', async () => {
      const payload = createListPayload(userId, 'cmd_help');
      const result = await postWebhook(payload);

      expect(result.json.status).toBe('help_shown');

      // Should have sent help text
      expect(whatsappCalls.some(c =>
        c.body.text?.body?.includes('Ajuda')
      )).toBe(true);
    });
  });

  describe('Flow 4: Create New Agent', () => {
    it('should complete agent creation flow with new mode and model mode steps', async () => {
      // Start create flow
      await postWebhook(createListPayload(userId, 'action_create_agent'));
      whatsappCalls.length = 0;

      // Send agent name
      const nameResult = await postWebhook(createTextPayload(userId, 'My New Agent'));
      expect(nameResult.json.status).toBe('awaiting_type');

      // Select agent type (claude)
      whatsappCalls.length = 0;
      const typeResult = await postWebhook(createListPayload(userId, 'agenttype_claude'));
      expect(typeResult.json.status).toBe('awaiting_emoji');

      // Select emoji
      whatsappCalls.length = 0;
      const emojiResult = await postWebhook(createListPayload(userId, 'emoji_foguete'));
      // NEW: After emoji, now goes to mode selection (conversational vs ralph)
      expect(emojiResult.json.status).toBe('awaiting_mode_choice');

      // NEW STEP: Select mode (conversational)
      whatsappCalls.length = 0;
      const modeResult = await postWebhook(createButtonPayload(userId, 'mode_conversational'));
      expect(modeResult.json.status).toBe('workspace_selector_sent');

      // Skip workspace
      whatsappCalls.length = 0;
      const wsResult = await postWebhook(createListPayload(userId, 'workspace_skip'));
      // NEW: After workspace, now goes to model mode selection
      expect(wsResult.json.status).toBe('awaiting_model_mode_choice');

      // NEW STEP: Select model mode (selection)
      whatsappCalls.length = 0;
      const modelModeResult = await postWebhook(createListPayload(userId, 'model_mode_selection'));
      expect(modelModeResult.json.status).toBe('confirmation_sent');

      // Confirm creation
      whatsappCalls.length = 0;
      const confirmResult = await postWebhook(createButtonPayload(userId, 'confirm_create'));
      expect(confirmResult.json.status).toBe('created');

      // Should have created the agent with emoji and type
      const agents = agentManager.listAgents(userId);
      const newAgent = agents.find((a: any) => a.name === 'My New Agent');
      expect(newAgent).toBeDefined();
      expect(newAgent?.emoji).toBe('🚀');
      expect(newAgent?.type).toBe('claude');
      expect(newAgent?.modelMode).toBe('selection');

      // Should have sent confirmation
      expect(whatsappCalls.some(c =>
        c.body.text?.body?.includes('criado')
      )).toBe(true);
    });
  });

  describe('Agent Menu Actions', () => {
    it('should route prompt to selected agent when using Enviar prompt', async () => {
      // Create agent
      const agent = agentManager.createAgent(userId, 'Test Agent');

      // Click "Enviar prompt" from agent menu
      await postWebhook(createListPayload(userId, `agentmenu_prompt_${agent.id}`));
      whatsappCalls.length = 0;

      // Send prompt text
      const result = await postWebhook(createTextPayload(userId, 'My prompt'));
      expect(result.json.status).toBe('awaiting_model_selection');

      // Agent should be pre-selected
      expect(pendingAgentSelection.get(userId)).toBe(agent.id);

      // Should have sent model selector
      const buttonCall = whatsappCalls.find(c => c.body.interactive?.type === 'button');
      expect(buttonCall).toBeDefined();
    });

    it('should show delete confirmation', async () => {
      const agent = agentManager.createAgent(userId, 'Test Agent');

      const payload = createListPayload(userId, `agentmenu_delete_${agent.id}`);
      const result = await postWebhook(payload);

      expect(result.json.status).toBe('awaiting_delete_confirmation');

      // Should have sent confirmation buttons
      const buttonCall = whatsappCalls.find(c => c.body.interactive?.type === 'button');
      expect(buttonCall).toBeDefined();
      expect(buttonCall?.body.interactive.body.text).toContain('Deletar');
    });

    it('should delete agent on confirmation', async () => {
      const agent = agentManager.createAgent(userId, 'Test Agent');
      const agentId = agent.id;

      const payload = createButtonPayload(userId, `confirm_delete_${agentId}`);
      const result = await postWebhook(payload);

      expect(result.json.status).toBe('deleted');

      // Agent should be deleted
      expect(agentManager.getAgent(agentId)).toBeUndefined();
    });
  });

  describe('Error Recovery (Flow 11)', () => {
    it('should handle retry button when no previous error', async () => {
      const payload = createButtonPayload(userId, 'error_retry_123');
      const result = await postWebhook(payload);

      expect(result.json.status).toBe('no_error_to_retry');
    });

    it('should handle ignore button', async () => {
      const payload = createButtonPayload(userId, 'error_ignore_123');
      const result = await postWebhook(payload);

      expect(result.json.status).toBe('ignored');
    });
  });

  describe('Help Command', () => {
    it('should show help message', async () => {
      const payload = createTextPayload(userId, '/help');
      const result = await postWebhook(payload);

      expect(result.json.status).toBe('help_shown');

      // Should have sent help text with commands
      expect(whatsappCalls.some(c =>
        c.body.text?.body?.includes('/reset') &&
        c.body.text?.body?.includes('/compact')
      )).toBe(true);
    });
  });

  describe('Security', () => {
    it('should reject messages from unknown users', async () => {
      const payload = createTextPayload('1234567890', 'Hello');
      const result = await postWebhook(payload);

      expect(result.json.status).toBe('ignored');
      expect(whatsappCalls.length).toBe(0);
    });

    it('should ignore malformed payloads', async () => {
      const result = await postWebhook({});
      expect(result.json.status).toBe('ignored');

      const result2 = await postWebhook({ message: null });
      expect(result2.json.status).toBe('ignored');
    });
  });

  describe('Webhook Verification', () => {
    it('should verify webhook with correct token', async () => {
      const response = await app.request(
        '/webhook?hub.mode=subscribe&hub.verify_token=test-secret&hub.challenge=test-challenge'
      );

      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toBe('test-challenge');
    });

    it('should reject webhook with incorrect token', async () => {
      const response = await app.request(
        '/webhook?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=test-challenge'
      );

      expect(response.status).toBe(403);
    });
  });

  describe('Health Check', () => {
    it('should return ok status', async () => {
      const response = await app.request('/health');
      expect(response.status).toBe(200);

      const json = await response.json();
      expect(json.status).toBe('ok');
    });
  });
});

describe('Message Extraction', () => {
  let app: any;
  let agentManager: any;

  beforeAll(async () => {
    const mod = await import('../index');
    app = mod.app;
    agentManager = mod.agentManager;
  });

  beforeEach(() => {
    whatsappCalls.length = 0;
    // Delete all agents for test user
    const agents = agentManager?.listAgents('5581999999999') || [];
    for (const agent of agents) {
      agentManager.deleteAgent(agent.id);
    }
  });

  it('should handle Kapso v2 text format', async () => {
    const payload = {
      message: {
        type: 'text',
        text: { body: 'test message' },
        kapso: { content: 'test message via kapso' },
        id: 'msg-123',
      },
      conversation: {
        phone_number: '+5581999999999',
      },
    };

    const response = await app.request('/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json();

    // Main number now rejects prompts - use groups for prompts
    expect(result.status).toBe('rejected_prompt');
  });

  it('should handle Meta format (legacy)', async () => {
    const payload = {
      entry: [{
        changes: [{
          value: {
            messages: [{
              from: '5581999999999',
              type: 'text',
              text: { body: '/help' },
              id: 'msg-legacy',
            }],
          },
        }],
      }],
    };

    const response = await app.request('/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json();

    expect(result.status).toBe('help_shown');
  });
});
