// src/__tests__/telegram-command-handler.test.ts
/**
 * Tests for TelegramCommandHandler - topic_unregistered action
 *
 * Verifies that messages in unknown threadId return topic_unregistered
 * with correct agentId and threadId
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { TelegramCommandHandler } from '../telegram-command-handler';
import { AgentManager } from '../agent-manager';
import { TopicManager } from '../topic-manager';
import { PersistenceService } from '../persistence';
import type { AgentTopic, TopicType, TopicStatus } from '../types';
import { existsSync, unlinkSync, mkdirSync, rmdirSync, readdirSync } from 'fs';
import { join } from 'path';

const TEST_STATE_FILE = './test-cmd-handler-state.json';
const TEST_LOOPS_DIR = './test-cmd-handler-loops';
const TEST_PREFS_FILE = './test-cmd-handler-preferences.json';
const TEST_TOPICS_DIR = './test-cmd-handler-topics';
const TEST_WORKSPACE = './test-cmd-handler-workspace';

function cleanup() {
  if (existsSync(TEST_STATE_FILE)) unlinkSync(TEST_STATE_FILE);
  if (existsSync(TEST_STATE_FILE + '.bak')) unlinkSync(TEST_STATE_FILE + '.bak');
  if (existsSync(TEST_PREFS_FILE)) unlinkSync(TEST_PREFS_FILE);

  if (existsSync(TEST_LOOPS_DIR)) {
    const files = readdirSync(TEST_LOOPS_DIR);
    for (const file of files) {
      unlinkSync(join(TEST_LOOPS_DIR, file));
    }
    rmdirSync(TEST_LOOPS_DIR);
  }

  if (existsSync(TEST_TOPICS_DIR)) {
    const files = readdirSync(TEST_TOPICS_DIR);
    for (const file of files) {
      unlinkSync(join(TEST_TOPICS_DIR, file));
    }
    rmdirSync(TEST_TOPICS_DIR);
  }

  if (existsSync(TEST_WORKSPACE)) {
    rmdirSync(TEST_WORKSPACE);
  }
}

function ensureWorkspace() {
  if (!existsSync(TEST_WORKSPACE)) {
    mkdirSync(TEST_WORKSPACE);
  }
}

function createMockTopic(overrides: Partial<AgentTopic> = {}): AgentTopic {
  return {
    id: 'topic-uuid-1234',
    agentId: 'agent-test-123',
    telegramTopicId: 100,
    type: 'session' as TopicType,
    name: 'Test Topic',
    emoji: '💬',
    sessionId: 'topic-session-xyz',
    status: 'active' as TopicStatus,
    createdAt: new Date(),
    lastActivity: new Date(),
    ...overrides,
  };
}

describe('TelegramCommandHandler - topic_unregistered action', () => {
  let handler: TelegramCommandHandler;
  let agentManager: AgentManager;
  let topicManager: TopicManager;
  let persistence: PersistenceService;

  beforeEach(() => {
    cleanup();
    ensureWorkspace();
    persistence = new PersistenceService(TEST_STATE_FILE, TEST_LOOPS_DIR, TEST_PREFS_FILE, TEST_TOPICS_DIR);
    agentManager = new AgentManager(persistence);
    topicManager = new TopicManager(persistence);
    handler = new TelegramCommandHandler(agentManager, undefined, topicManager);
  });

  afterEach(() => {
    cleanup();
  });

  describe('Unknown threadId returns topic_unregistered', () => {
    test('message in unknown threadId returns topic_unregistered', () => {
      // Create agent linked to chat
      agentManager.createAgent('user-phone-123', 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const createdAgent = agentManager.listAgents('user-phone-123')[0];
      agentManager.setTelegramChatId(createdAgent.id, 12345);

      // Send message to unknown threadId (no topics registered)
      const result = handler.routeGroupMessage(
        12345,
        'user-phone-123',
        'Hello from unknown topic',
        111,
        999, // Unknown threadId
        true // isForum
      );

      expect(result.action).toBe('topic_unregistered');
    });

    test('topic_unregistered includes correct agentId', () => {
      agentManager.createAgent('user-phone-123', 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const createdAgent = agentManager.listAgents('user-phone-123')[0];
      agentManager.setTelegramChatId(createdAgent.id, 12345);

      const result = handler.routeGroupMessage(
        12345,
        'user-phone-123',
        'Test message',
        111,
        888, // Unknown threadId
        true
      );

      expect(result.action).toBe('topic_unregistered');
      if (result.action === 'topic_unregistered') {
        expect(result.agentId).toBe(createdAgent.id);
      }
    });

    test('topic_unregistered includes correct threadId', () => {
      agentManager.createAgent('user-phone-123', 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const createdAgent = agentManager.listAgents('user-phone-123')[0];
      agentManager.setTelegramChatId(createdAgent.id, 12345);

      const unknownThreadId = 777;
      const result = handler.routeGroupMessage(
        12345,
        'user-phone-123',
        'Test message',
        111,
        unknownThreadId,
        true
      );

      expect(result.action).toBe('topic_unregistered');
      if (result.action === 'topic_unregistered') {
        expect(result.threadId).toBe(unknownThreadId);
      }
    });

    test('topic_unregistered includes correct chatId', () => {
      agentManager.createAgent('user-phone-123', 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const createdAgent = agentManager.listAgents('user-phone-123')[0];
      const chatId = 54321;
      agentManager.setTelegramChatId(createdAgent.id, chatId);

      const result = handler.routeGroupMessage(
        chatId,
        'user-phone-123',
        'Test message',
        111,
        666, // Unknown threadId
        true
      );

      expect(result.action).toBe('topic_unregistered');
      if (result.action === 'topic_unregistered') {
        expect(result.chatId).toBe(chatId);
      }
    });

    test('topic_unregistered includes correct userId', () => {
      const userId = 'user-phone-456';
      agentManager.createAgent(userId, 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const createdAgent = agentManager.listAgents(userId)[0];
      agentManager.setTelegramChatId(createdAgent.id, 12345);

      const result = handler.routeGroupMessage(
        12345,
        userId,
        'Test message',
        111,
        555, // Unknown threadId
        true
      );

      expect(result.action).toBe('topic_unregistered');
      if (result.action === 'topic_unregistered') {
        expect(result.userId).toBe(userId);
      }
    });

    test('known threadId routes to prompt (not topic_unregistered)', () => {
      agentManager.createAgent('user-phone-123', 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const createdAgent = agentManager.listAgents('user-phone-123')[0];
      agentManager.setTelegramChatId(createdAgent.id, 12345);
      agentManager.setMainSessionId(createdAgent.id, 'main-session-abc');

      // Register a topic
      const topic = createMockTopic({
        agentId: createdAgent.id,
        telegramTopicId: 100,
        sessionId: 'topic-session-xyz',
        status: 'active',
      });
      persistence.saveTopics(createdAgent.id, 'main-session-abc', [topic]);

      // Send message to known threadId
      const result = handler.routeGroupMessage(
        12345,
        'user-phone-123',
        'Hello from known topic',
        111,
        100, // Known threadId
        true
      );

      expect(result.action).toBe('prompt');
      if (result.action === 'prompt') {
        expect(result.sessionId).toBe('topic-session-xyz');
      }
    });

    test('General topic (threadId=1) routes to mainSessionId (not topic_unregistered)', () => {
      agentManager.createAgent('user-phone-123', 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const createdAgent = agentManager.listAgents('user-phone-123')[0];
      agentManager.setTelegramChatId(createdAgent.id, 12345);
      agentManager.setMainSessionId(createdAgent.id, 'main-session-abc');

      // Send message to General topic (threadId=1)
      const result = handler.routeGroupMessage(
        12345,
        'user-phone-123',
        'Hello from General',
        111,
        1, // General topic
        true
      );

      expect(result.action).toBe('prompt');
      if (result.action === 'prompt') {
        expect(result.sessionId).toBe('main-session-abc');
      }
    });

    test('undefined threadId routes to mainSessionId (not topic_unregistered)', () => {
      agentManager.createAgent('user-phone-123', 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const createdAgent = agentManager.listAgents('user-phone-123')[0];
      agentManager.setTelegramChatId(createdAgent.id, 12345);
      agentManager.setMainSessionId(createdAgent.id, 'main-session-abc');

      // Send message without threadId
      const result = handler.routeGroupMessage(
        12345,
        'user-phone-123',
        'Hello',
        111,
        undefined, // No threadId
        true
      );

      expect(result.action).toBe('prompt');
      if (result.action === 'prompt') {
        expect(result.sessionId).toBe('main-session-abc');
      }
    });

    test('non-forum group ignores threadId (not topic_unregistered)', () => {
      agentManager.createAgent('user-phone-123', 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const createdAgent = agentManager.listAgents('user-phone-123')[0];
      agentManager.setTelegramChatId(createdAgent.id, 12345);
      agentManager.setMainSessionId(createdAgent.id, 'main-session-abc');

      // Send message with unknown threadId but isForum=false
      const result = handler.routeGroupMessage(
        12345,
        'user-phone-123',
        'Hello',
        111,
        999, // Would be unknown, but should be ignored
        false // NOT a forum
      );

      expect(result.action).toBe('prompt');
      if (result.action === 'prompt') {
        expect(result.sessionId).toBe('main-session-abc');
      }
    });
  });

  describe('Multiple unknown threadIds return distinct results', () => {
    test('different unknown threadIds return different threadId values', () => {
      agentManager.createAgent('user-phone-123', 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const createdAgent = agentManager.listAgents('user-phone-123')[0];
      agentManager.setTelegramChatId(createdAgent.id, 12345);

      const result1 = handler.routeGroupMessage(12345, 'user-phone-123', 'Test 1', 111, 111, true);
      const result2 = handler.routeGroupMessage(12345, 'user-phone-123', 'Test 2', 111, 222, true);
      const result3 = handler.routeGroupMessage(12345, 'user-phone-123', 'Test 3', 111, 333, true);

      expect(result1.action).toBe('topic_unregistered');
      expect(result2.action).toBe('topic_unregistered');
      expect(result3.action).toBe('topic_unregistered');

      if (result1.action === 'topic_unregistered' &&
          result2.action === 'topic_unregistered' &&
          result3.action === 'topic_unregistered') {
        expect(result1.threadId).toBe(111);
        expect(result2.threadId).toBe(222);
        expect(result3.threadId).toBe(333);
        // All should have the same agentId
        expect(result1.agentId).toBe(createdAgent.id);
        expect(result2.agentId).toBe(createdAgent.id);
        expect(result3.agentId).toBe(createdAgent.id);
      }
    });
  });
});
