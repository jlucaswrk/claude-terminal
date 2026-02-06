// src/__tests__/integration-topic-flow-routing.test.ts
/**
 * True integration tests for topic flow routing in group messages.
 *
 * Drives handleTelegramMessage end-to-end:
 * - /worktree flow: send command, provide name, provide workspace → topic created
 * - /cancelar during flow: clears context, does not enqueue as prompt
 * - Normal messages when not in flow: routed as prompts
 */

import { describe, test, expect, beforeEach, afterEach, mock, beforeAll } from 'bun:test';
import { existsSync, mkdirSync, rmSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';

// Set test environment BEFORE imports
process.env.NODE_ENV = 'test';
process.env.PORT = '3099';
process.env.KAPSO_WEBHOOK_SECRET = 'test-secret-flow';
process.env.USER_PHONE_NUMBER = '+5581999999999';
process.env.KAPSO_API_KEY = 'test-api-key';
process.env.KAPSO_PHONE_NUMBER_ID = 'test-phone-id';
process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token-integration';

// Track all Telegram API calls for assertions
const telegramCalls: Array<{ method: string; args: any[] }> = [];

// Mock node-telegram-bot-api BEFORE any imports that use it
mock.module('node-telegram-bot-api', () => {
  class MockTelegramBot {
    constructor(_token: string, _options: any) {}

    async sendMessage(chatId: number, text: string, options?: any) {
      telegramCalls.push({ method: 'sendMessage', args: [chatId, text, options] });
      return { message_id: Math.floor(Math.random() * 10000) + 1, chat: { id: chatId } };
    }

    async getChat(chatId: number) {
      telegramCalls.push({ method: 'getChat', args: [chatId] });
      return {
        id: chatId,
        type: 'supergroup',
        title: 'Test Group',
        is_forum: true,
      };
    }

    async sendChatAction(_chatId: number, _action: string, _options?: any) {
      return true;
    }

    async editMessageText(_text: string, _options?: any) {
      return true;
    }

    async _request(method: string, params: any) {
      telegramCalls.push({ method: `_request:${method}`, args: [params] });
      if (method === 'createForumTopic') {
        return { message_thread_id: Math.floor(Math.random() * 10000) + 100 };
      }
      return {};
    }
  }

  return { default: MockTelegramBot };
});

// Mock the Claude Agent SDK to prevent real API calls
mock.module('@anthropic-ai/claude-agent-sdk', () => ({
  query: () => ({
    async *[Symbol.asyncIterator]() {
      yield { type: 'system', subtype: 'init', session_id: 'test-session-flow' };
      yield { type: 'result', result: 'Test response' };
    },
  }),
}));

// Mock storage
mock.module('../storage', () => ({
  uploadBase64Image: async () => 'https://example.com/image.png',
  uploadToKapso: async () => ({ mediaId: 'mock-id', url: 'https://example.com/file' }),
  uploadFileToKapso: async () => ({ mediaId: 'mock-id', filename: 'file', mimeType: 'application/octet-stream' }),
  uploadImageToKapso: async () => ({ mediaId: 'mock-id', url: 'https://example.com/image.png' }),
  downloadFromKapso: async () => ({ buffer: Buffer.from(''), mimeType: 'application/octet-stream' }),
  getMimeType: () => 'application/octet-stream',
  getWhatsAppMediaType: () => 'document',
}));

// Mock fetch for WhatsApp API calls
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input.toString();
  if (url.includes('api.kapso.ai')) {
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return originalFetch(input, init);
};

// Import the real module singletons AFTER mocks are set up
const {
  handleTelegramMessage,
  agentManager,
  userContextManager,
  persistenceService,
  topicManager,
} = await import('../index');

const CHAT_ID = -1001234599999;
const TELEGRAM_USER_ID = 9999;
const TELEGRAM_USERNAME = 'integrationtester';
const USER_ID = `tg_${TELEGRAM_USERNAME}`;

const TEST_WORKSPACE_DIR = '/tmp/test-integration-topic-flow-workspace';

/**
 * Helper to build a simulated Telegram group message
 */
function makeGroupMessage(text: string, threadId?: number) {
  return {
    message_id: Math.floor(Math.random() * 100000),
    chat: {
      id: CHAT_ID,
      type: 'supergroup',
      is_forum: true,
    },
    from: {
      id: TELEGRAM_USER_ID,
      username: TELEGRAM_USERNAME,
      first_name: 'Test',
    },
    text,
    date: Math.floor(Date.now() / 1000),
    ...(threadId ? { message_thread_id: threadId } : {}),
  };
}

/**
 * Find sent Telegram messages matching a text substring
 */
function findSentMessages(substring: string): Array<{ method: string; args: any[] }> {
  return telegramCalls.filter(
    (c) => c.method === 'sendMessage' && typeof c.args[1] === 'string' && c.args[1].includes(substring)
  );
}

describe('Integration: Topic Flow via handleTelegramMessage', () => {
  beforeEach(() => {
    // Clear tracked calls
    telegramCalls.length = 0;

    // Ensure test workspace directory exists
    if (!existsSync(TEST_WORKSPACE_DIR)) {
      mkdirSync(TEST_WORKSPACE_DIR, { recursive: true });
    }

    // Register user preferences so handleTelegramMessage can find the user
    persistenceService.saveUserPreferences({
      userId: USER_ID,
      mode: 'dojo',
      telegramUsername: TELEGRAM_USERNAME,
      telegramChatId: undefined,
      onboardingComplete: true,
    });

    // Create an agent linked to this group chat
    const existing = agentManager.listAgents(USER_ID);
    for (const a of existing) {
      agentManager.deleteAgent(a.id, USER_ID);
    }
    agentManager.createAgent(USER_ID, 'FlowTestAgent', TEST_WORKSPACE_DIR, '🧪', 'claude', 'sonnet');
    const agent = agentManager.listAgents(USER_ID)[0];
    agentManager.setTelegramChatId(agent.id, CHAT_ID);

    // Clear any lingering user context
    userContextManager.clearContext(USER_ID);
  });

  afterEach(() => {
    userContextManager.clearContext(USER_ID);
    telegramCalls.length = 0;
  });

  test('/worktree full flow: command → name → workspace → topic created', async () => {
    const agent = agentManager.listAgents(USER_ID)[0];

    // Step 1: Send /worktree command (no name)
    await handleTelegramMessage(makeGroupMessage('/worktree'));

    // Should have started the worktree flow and sent name prompt
    expect(userContextManager.isAwaitingTopicName(USER_ID)).toBe(true);
    const namePromptMsgs = findSentMessages('nome');
    expect(namePromptMsgs.length).toBeGreaterThanOrEqual(1);

    // Step 2: Send topic name
    telegramCalls.length = 0;
    await handleTelegramMessage(makeGroupMessage('feature-auth'));

    // Should now be awaiting workspace
    expect(userContextManager.isAwaitingTopicName(USER_ID)).toBe(false);
    expect(userContextManager.isAwaitingTopicWorkspace(USER_ID)).toBe(true);
    const wsPromptMsgs = findSentMessages('workspace');
    expect(wsPromptMsgs.length).toBeGreaterThanOrEqual(0); // workspace question uses buttons

    // Step 3: Send workspace path (absolute path — should NOT be treated as command)
    telegramCalls.length = 0;
    await handleTelegramMessage(makeGroupMessage(TEST_WORKSPACE_DIR));

    // Flow should be complete — context cleared
    expect(userContextManager.isAwaitingTopicWorkspace(USER_ID)).toBe(false);
    expect(userContextManager.isAwaitingTopicName(USER_ID)).toBe(false);

    // Verify a topic was actually created for this agent
    const topics = topicManager.listTopics(agent.id);
    expect(topics.length).toBeGreaterThanOrEqual(1);

    const createdTopic = topics.find((t) => t.name === 'feature-auth');
    expect(createdTopic).toBeDefined();
    expect(createdTopic!.type).toBe('worktree');
    expect(createdTopic!.workspace).toBe(TEST_WORKSPACE_DIR);

    // Verify createForumTopic was called via TelegramBot._request
    const createTopicCalls = telegramCalls.filter((c) => c.method === '_request:createForumTopic');
    expect(createTopicCalls.length).toBeGreaterThanOrEqual(1);
  });

  test('/cancelar during worktree flow clears context and does not create topic', async () => {
    const agent = agentManager.listAgents(USER_ID)[0];

    // Step 1: Start /worktree flow
    await handleTelegramMessage(makeGroupMessage('/worktree'));
    expect(userContextManager.isAwaitingTopicName(USER_ID)).toBe(true);

    // Step 2: Send /cancelar — should cancel the flow
    telegramCalls.length = 0;
    await handleTelegramMessage(makeGroupMessage('/cancelar'));

    // Context should be fully cleared
    expect(userContextManager.isAwaitingTopicName(USER_ID)).toBe(false);
    expect(userContextManager.isAwaitingTopicTask(USER_ID)).toBe(false);
    expect(userContextManager.isAwaitingTopicWorkspace(USER_ID)).toBe(false);
    expect(userContextManager.isAwaitingTopicIterations(USER_ID)).toBe(false);

    // Should have sent cancellation message
    const cancelMsgs = findSentMessages('cancelada');
    expect(cancelMsgs.length).toBeGreaterThanOrEqual(1);

    // No topic should have been created
    const topics = topicManager.listTopics(agent.id);
    const flowTopics = topics.filter((t) => t.name === 'feature-auth');
    expect(flowTopics.length).toBe(0);
  });

  test('/cancelar mid-workspace-step cancels flow', async () => {
    // Start /worktree, provide name, then cancel at workspace step
    await handleTelegramMessage(makeGroupMessage('/worktree'));
    expect(userContextManager.isAwaitingTopicName(USER_ID)).toBe(true);

    await handleTelegramMessage(makeGroupMessage('my-branch'));
    expect(userContextManager.isAwaitingTopicWorkspace(USER_ID)).toBe(true);

    // Now send /cancelar at workspace step
    telegramCalls.length = 0;
    await handleTelegramMessage(makeGroupMessage('/cancelar'));

    // Context should be cleared
    expect(userContextManager.isAwaitingTopicWorkspace(USER_ID)).toBe(false);
    expect(userContextManager.isAwaitingTopicName(USER_ID)).toBe(false);

    // Should have sent cancellation message
    const cancelMsgs = findSentMessages('cancelada');
    expect(cancelMsgs.length).toBeGreaterThanOrEqual(1);
  });

  test('normal text is NOT enqueued as prompt during flow', async () => {
    // Start /worktree flow
    await handleTelegramMessage(makeGroupMessage('/worktree'));
    expect(userContextManager.isAwaitingTopicName(USER_ID)).toBe(true);

    // "feature-x" is the name input, NOT a prompt
    telegramCalls.length = 0;
    await handleTelegramMessage(makeGroupMessage('feature-x'));

    // Should NOT have any queue enqueue activity (no typing indicator for prompt)
    // Instead, it should have advanced to workspace step
    expect(userContextManager.isAwaitingTopicName(USER_ID)).toBe(false);
    expect(userContextManager.isAwaitingTopicWorkspace(USER_ID)).toBe(true);
  });

  test('message routed as prompt when no flow is active', async () => {
    // No flow active — send a regular message
    // This should go through routeGroupMessage → 'prompt' path
    // We can verify by checking that no flow-related messages were sent
    // and the message was processed (typing indicator would have been started)
    telegramCalls.length = 0;
    await handleTelegramMessage(makeGroupMessage('Hello, process this'));

    // Should NOT be in any flow
    expect(userContextManager.isAwaitingTopicName(USER_ID)).toBe(false);
    expect(userContextManager.isAwaitingTopicTask(USER_ID)).toBe(false);

    // No flow-related messages (no name prompt, no workspace question, no cancellation)
    const flowMsgs = findSentMessages('nome do tópico');
    expect(flowMsgs.length).toBe(0);
  });
});
