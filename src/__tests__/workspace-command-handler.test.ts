// src/__tests__/workspace-command-handler.test.ts
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { TelegramCommandHandler, type TelegramRouteResult } from '../telegram-command-handler';
import { AgentManager } from '../agent-manager';
import { PersistenceService } from '../persistence';
import type { Agent, AgentTopic } from '../types';
import { existsSync, unlinkSync, mkdirSync, rmdirSync, readdirSync } from 'fs';
import { join } from 'path';

const TEST_STATE_FILE = './test-ws-cmd-state.json';
const TEST_LOOPS_DIR = './test-ws-cmd-loops';
const TEST_PREFS_FILE = './test-ws-cmd-prefs.json';
const TEST_TOPICS_DIR = './test-ws-cmd-topics';

function cleanup() {
  if (existsSync(TEST_STATE_FILE)) unlinkSync(TEST_STATE_FILE);
  if (existsSync(TEST_STATE_FILE + '.bak')) unlinkSync(TEST_STATE_FILE + '.bak');
  if (existsSync(TEST_PREFS_FILE)) unlinkSync(TEST_PREFS_FILE);

  for (const dir of [TEST_LOOPS_DIR, TEST_TOPICS_DIR]) {
    if (existsSync(dir)) {
      const files = readdirSync(dir);
      for (const file of files) {
        unlinkSync(join(dir, file));
      }
      rmdirSync(dir);
    }
  }
}

describe('TelegramCommandHandler - /workspace routing', () => {
  let persistence: PersistenceService;
  let agentManager: AgentManager;
  let handler: TelegramCommandHandler;
  let testAgentId: string;

  const chatId = -1001234567890;
  const userId = 'user-phone-123';
  const telegramUserId = 12345;

  beforeEach(() => {
    cleanup();
    persistence = new PersistenceService(
      TEST_STATE_FILE,
      TEST_LOOPS_DIR,
      TEST_PREFS_FILE,
      TEST_TOPICS_DIR
    );
    agentManager = new AgentManager(persistence);

    // Create a test agent and link to the chat
    const agent = agentManager.createAgent(userId, 'Test Agent', undefined, '🤖', 'claude', 'sonnet');
    testAgentId = agent.id;
    agentManager.setTelegramChatId(agent.id, chatId);

    handler = new TelegramCommandHandler(agentManager);
  });

  afterEach(() => {
    cleanup();
  });

  test('/workspace in General topic (threadId=1) returns topic_workspace_general', () => {
    const result = handler.routeGroupMessage(chatId, userId, '/workspace', telegramUserId, 1, true);
    expect(result.action).toBe('topic_workspace_general');
  });

  test('/workspace in General topic (no threadId) returns topic_workspace_general', () => {
    const result = handler.routeGroupMessage(chatId, userId, '/workspace', telegramUserId, undefined, true);
    expect(result.action).toBe('topic_workspace_general');
  });

  test('/workspace in specific topic returns topic_workspace with no path', () => {
    const result = handler.routeGroupMessage(chatId, userId, '/workspace', telegramUserId, 5, true);
    expect(result.action).toBe('topic_workspace');
    if (result.action === 'topic_workspace') {
      expect(result.threadId).toBe(5);
      expect(result.path).toBeUndefined();
      expect(result.agentId).toBe(testAgentId);
    }
  });

  test('/workspace /path/to/dir returns topic_workspace with path', () => {
    const result = handler.routeGroupMessage(chatId, userId, '/workspace /Users/lucas/project', telegramUserId, 5, true);
    expect(result.action).toBe('topic_workspace');
    if (result.action === 'topic_workspace') {
      expect(result.path).toBe('/Users/lucas/project');
      expect(result.threadId).toBe(5);
    }
  });

  test('/workspace with path containing spaces', () => {
    const result = handler.routeGroupMessage(chatId, userId, '/workspace /Users/lucas/my project', telegramUserId, 5, true);
    expect(result.action).toBe('topic_workspace');
    if (result.action === 'topic_workspace') {
      expect(result.path).toBe('/Users/lucas/my project');
    }
  });

  test('/workspace from non-owner user falls through to command', () => {
    const otherUserId = 'other-user-phone';
    const result = handler.routeGroupMessage(chatId, otherUserId, '/workspace', telegramUserId, 5, true);
    // Non-owner should get a generic command action since agent.userId !== userId
    expect(result.action).toBe('command');
  });

  test('/workspace in non-forum group (no threadId) returns topic_workspace_general', () => {
    const result = handler.routeGroupMessage(chatId, userId, '/workspace /path', telegramUserId, undefined, false);
    expect(result.action).toBe('topic_workspace_general');
  });
});
