// src/__tests__/telegram-command-handler-routing.test.ts
/**
 * Tests for TelegramCommandHandler topic routing
 *
 * Tests cover:
 * - General topic routing (threadId=1 or undefined → mainSessionId)
 * - Specific topic routing (threadId>1 → topic.sessionId)
 * - Groups without topics (hybrid mode → mainSessionId)
 * - Non-existent topic errors
 * - Closed topic errors
 * - Active Ralph topic queueing
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { TelegramCommandHandler } from '../telegram-command-handler';
import { AgentManager } from '../agent-manager';
import { TopicManager } from '../topic-manager';
import { PersistenceService } from '../persistence';
import type { Agent, AgentTopic, TopicType, TopicStatus } from '../types';
import { existsSync, unlinkSync, mkdirSync, rmdirSync, readdirSync } from 'fs';
import { join } from 'path';

const TEST_STATE_FILE = './test-routing-state.json';
const TEST_LOOPS_DIR = './test-routing-loops';
const TEST_PREFS_FILE = './test-routing-preferences.json';
const TEST_TOPICS_DIR = './test-routing-topics';
const TEST_WORKSPACE = './test-routing-workspace';

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

describe('TelegramCommandHandler - Topic Routing', () => {
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

  describe('General Topic Routing (threadId=1 or undefined)', () => {
    test('routes undefined threadId to mainSessionId', () => {
      // createAgent(userId, name, workspace?, emoji?, type, modelMode)
      agentManager.createAgent('user-phone-123', 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const createdAgent = agentManager.listAgents('user-phone-123')[0];
      agentManager.setTelegramChatId(createdAgent.id, 12345);
      agentManager.setMainSessionId(createdAgent.id, 'main-session-abc');

      const result = handler.routeGroupMessage(
        12345,
        'user-phone-123',
        'Hello world',
        111,
        undefined, // No threadId
        true // isForum
      );

      expect(result.action).toBe('prompt');
      if (result.action === 'prompt') {
        expect(result.sessionId).toBe('main-session-abc');
        expect(result.threadId).toBeUndefined();
      }
    });

    test('routes threadId=1 to mainSessionId (General topic)', () => {
      agentManager.createAgent('user-phone-123', 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const createdAgent = agentManager.listAgents('user-phone-123')[0];
      agentManager.setTelegramChatId(createdAgent.id, 12345);
      agentManager.setMainSessionId(createdAgent.id, 'main-session-abc');

      const result = handler.routeGroupMessage(
        12345,
        'user-phone-123',
        'Hello from General',
        111,
        1, // General topic threadId
        true // isForum
      );

      expect(result.action).toBe('prompt');
      if (result.action === 'prompt') {
        expect(result.sessionId).toBe('main-session-abc');
        expect(result.threadId).toBe(1);
      }
    });
  });

  describe('Specific Topic Routing (threadId > 1)', () => {
    test('routes threadId>1 to topic sessionId', () => {
      agentManager.createAgent('user-phone-123', 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const createdAgent = agentManager.listAgents('user-phone-123')[0];
      agentManager.setTelegramChatId(createdAgent.id, 12345);
      agentManager.setMainSessionId(createdAgent.id, 'main-session-abc');

      // Create a topic with specific threadId
      const topic = createMockTopic({
        agentId: createdAgent.id,
        telegramTopicId: 100,
        sessionId: 'topic-session-xyz',
        status: 'active',
      });
      persistence.saveTopics(createdAgent.id, 'main-session-abc', [topic]);

      const result = handler.routeGroupMessage(
        12345,
        'user-phone-123',
        'Hello from specific topic',
        111,
        100, // Specific topic threadId
        true // isForum
      );

      expect(result.action).toBe('prompt');
      if (result.action === 'prompt') {
        expect(result.sessionId).toBe('topic-session-xyz');
        expect(result.threadId).toBe(100);
      }
    });

    test('returns topic_not_found for non-existent threadId', () => {
      agentManager.createAgent('user-phone-123', 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const createdAgent = agentManager.listAgents('user-phone-123')[0];
      agentManager.setTelegramChatId(createdAgent.id, 12345);

      const result = handler.routeGroupMessage(
        12345,
        'user-phone-123',
        'Hello',
        111,
        999, // Non-existent threadId
        true // isForum
      );

      expect(result.action).toBe('topic_not_found');
      if (result.action === 'topic_not_found') {
        expect(result.threadId).toBe(999);
      }
    });
  });

  describe('Closed Topic Errors', () => {
    test('returns topic_closed for closed topics', () => {
      agentManager.createAgent('user-phone-123', 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const createdAgent = agentManager.listAgents('user-phone-123')[0];
      agentManager.setTelegramChatId(createdAgent.id, 12345);

      // Create a closed topic
      const topic = createMockTopic({
        agentId: createdAgent.id,
        telegramTopicId: 200,
        name: 'Closed Feature',
        status: 'closed',
      });
      persistence.saveTopics(createdAgent.id, undefined, [topic]);

      const result = handler.routeGroupMessage(
        12345,
        'user-phone-123',
        'Hello',
        111,
        200, // Closed topic threadId
        true // isForum
      );

      expect(result.action).toBe('topic_closed');
      if (result.action === 'topic_closed') {
        expect(result.topicName).toBe('Closed Feature');
        expect(result.threadId).toBe(200);
      }
    });
  });

  describe('Active Ralph Topic', () => {
    test('returns topic_ralph_active for topics with active Ralph loop', () => {
      agentManager.createAgent('user-phone-123', 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const createdAgent = agentManager.listAgents('user-phone-123')[0];
      agentManager.setTelegramChatId(createdAgent.id, 12345);

      // Create a Ralph topic with active loop
      const topic = createMockTopic({
        agentId: createdAgent.id,
        telegramTopicId: 300,
        type: 'ralph',
        name: 'Ralph Loop Task',
        loopId: 'active-loop-123',
        status: 'active',
      });
      persistence.saveTopics(createdAgent.id, undefined, [topic]);

      const result = handler.routeGroupMessage(
        12345,
        'user-phone-123',
        'Additional task',
        111,
        300, // Ralph topic threadId
        true // isForum
      );

      expect(result.action).toBe('topic_ralph_active');
      if (result.action === 'topic_ralph_active') {
        expect(result.topicName).toBe('Ralph Loop Task');
        expect(result.threadId).toBe(300);
        expect(result.text).toBe('Additional task');
      }
    });
  });

  describe('Hybrid Mode (Groups Without Topics)', () => {
    test('routes all messages to mainSessionId when isForum=false', () => {
      agentManager.createAgent('user-phone-123', 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const createdAgent = agentManager.listAgents('user-phone-123')[0];
      agentManager.setTelegramChatId(createdAgent.id, 12345);
      agentManager.setMainSessionId(createdAgent.id, 'main-session-abc');

      const result = handler.routeGroupMessage(
        12345,
        'user-phone-123',
        'Hello from regular group',
        111,
        undefined,
        false // NOT a forum - hybrid mode
      );

      expect(result.action).toBe('prompt');
      if (result.action === 'prompt') {
        expect(result.sessionId).toBe('main-session-abc');
      }
    });

    test('ignores threadId when isForum=false', () => {
      agentManager.createAgent('user-phone-123', 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const createdAgent = agentManager.listAgents('user-phone-123')[0];
      agentManager.setTelegramChatId(createdAgent.id, 12345);
      agentManager.setMainSessionId(createdAgent.id, 'main-session-abc');

      // Even with a threadId, should use mainSessionId if not a forum
      const result = handler.routeGroupMessage(
        12345,
        'user-phone-123',
        'Hello',
        111,
        100, // This threadId should be ignored
        false // NOT a forum
      );

      expect(result.action).toBe('prompt');
      if (result.action === 'prompt') {
        expect(result.sessionId).toBe('main-session-abc');
      }
    });
  });

  describe('ThreadId in Route Results', () => {
    test('includes threadId in prompt result for General topic', () => {
      agentManager.createAgent('user-phone-123', 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const createdAgent = agentManager.listAgents('user-phone-123')[0];
      agentManager.setTelegramChatId(createdAgent.id, 12345);
      agentManager.setMainSessionId(createdAgent.id, 'main-session-abc');

      const result = handler.routeGroupMessage(
        12345,
        'user-phone-123',
        'Hello',
        111,
        1, // General topic
        true
      );

      expect(result.action).toBe('prompt');
      if (result.action === 'prompt') {
        expect(result.threadId).toBe(1);
      }
    });

    test('includes threadId in command result', () => {
      agentManager.createAgent('user-phone-123', 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const createdAgent = agentManager.listAgents('user-phone-123')[0];
      agentManager.setTelegramChatId(createdAgent.id, 12345);

      const result = handler.routeGroupMessage(
        12345,
        'user-phone-123',
        '/status',
        111,
        75,
        true
      );

      expect(result.action).toBe('command');
      if (result.action === 'command') {
        expect(result.threadId).toBe(75);
      }
    });

    test('includes threadId in ralph_loop result', () => {
      agentManager.createAgent('user-phone-123', 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const createdAgent = agentManager.listAgents('user-phone-123')[0];
      agentManager.setTelegramChatId(createdAgent.id, 12345);

      const result = handler.routeGroupMessage(
        12345,
        'user-phone-123',
        '/ralph Build a new feature',
        111,
        85,
        true
      );

      expect(result.action).toBe('ralph_loop');
      if (result.action === 'ralph_loop') {
        expect(result.threadId).toBe(85);
        expect(result.task).toBe('Build a new feature');
      }
    });

    test('includes threadId in bash_command result', () => {
      // createAgent(userId, name, workspace?, emoji?, type, modelMode)
      agentManager.createAgent('user-phone-123', 'Bash Agent', TEST_WORKSPACE, '⚡', 'bash', 'sonnet');
      const createdAgent = agentManager.listAgents('user-phone-123')[0];
      agentManager.setTelegramChatId(createdAgent.id, 12345);

      const result = handler.routeGroupMessage(
        12345,
        'user-phone-123',
        'ls -la',
        111,
        95,
        true
      );

      expect(result.action).toBe('bash_command');
      if (result.action === 'bash_command') {
        expect(result.threadId).toBe(95);
        expect(result.command).toBe('ls -la');
      }
    });
  });

  describe('Model Selection with Topics', () => {
    test('shows model selector with threadId for selection mode', () => {
      agentManager.createAgent('user-phone-123', 'Selection Agent', TEST_WORKSPACE, '🤖', 'claude', 'selection');
      const createdAgent = agentManager.listAgents('user-phone-123')[0];
      agentManager.setTelegramChatId(createdAgent.id, 12345);
      agentManager.setMainSessionId(createdAgent.id, 'main-session-abc');

      const result = handler.routeGroupMessage(
        12345,
        'user-phone-123',
        'Hello without model prefix',
        111,
        1, // General topic
        true
      );

      expect(result.action).toBe('show_model_selector');
      if (result.action === 'show_model_selector') {
        expect(result.threadId).toBe(1);
        expect(result.sessionId).toBe('main-session-abc');
      }
    });

    test('routes with model prefix to correct topic', () => {
      agentManager.createAgent('user-phone-123', 'Model Agent', TEST_WORKSPACE, '🤖', 'claude', 'selection');
      const createdAgent = agentManager.listAgents('user-phone-123')[0];
      agentManager.setTelegramChatId(createdAgent.id, 12345);
      agentManager.setMainSessionId(createdAgent.id, 'main-session-abc');

      const result = handler.routeGroupMessage(
        12345,
        'user-phone-123',
        '!opus Write a poem',
        111,
        1, // General topic
        true
      );

      expect(result.action).toBe('prompt');
      if (result.action === 'prompt') {
        expect(result.model).toBe('opus');
        expect(result.text).toBe('Write a poem');
        expect(result.sessionId).toBe('main-session-abc');
        expect(result.threadId).toBe(1);
      }
    });
  });

  describe('getTopicByThreadId helper', () => {
    test('returns topic for valid threadId', () => {
      agentManager.createAgent('user-phone-123', 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const createdAgent = agentManager.listAgents('user-phone-123')[0];

      const topic = createMockTopic({
        agentId: createdAgent.id,
        telegramTopicId: 555,
        name: 'Helper Test Topic',
      });
      persistence.saveTopics(createdAgent.id, undefined, [topic]);

      const result = handler.getTopicByThreadId(createdAgent.id, 555);

      expect(result).toBeDefined();
      expect(result!.name).toBe('Helper Test Topic');
    });

    test('returns undefined for non-existent threadId', () => {
      const result = handler.getTopicByThreadId('agent-123', 999);
      expect(result).toBeUndefined();
    });
  });
});
