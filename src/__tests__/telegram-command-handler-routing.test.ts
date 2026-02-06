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

    test('returns topic_unregistered for non-existent threadId', () => {
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

      expect(result.action).toBe('topic_unregistered');
      if (result.action === 'topic_unregistered') {
        expect(result.threadId).toBe(999);
        expect(result.agentId).toBe(createdAgent.id);
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

    test('includes threadId in ralph_loop result (non-forum group)', () => {
      agentManager.createAgent('user-phone-123', 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const createdAgent = agentManager.listAgents('user-phone-123')[0];
      agentManager.setTelegramChatId(createdAgent.id, 12345);

      // Non-forum groups should still use ralph_loop for /ralph <task>
      const result = handler.routeGroupMessage(
        12345,
        'user-phone-123',
        '/ralph Build a new feature',
        111,
        85,
        false // isForum = false
      );

      expect(result.action).toBe('ralph_loop');
      if (result.action === 'ralph_loop') {
        expect(result.threadId).toBe(85);
        expect(result.task).toBe('Build a new feature');
      }
    });

    test('includes threadId in topic_command result (forum group)', () => {
      agentManager.createAgent('user-phone-123', 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const createdAgent = agentManager.listAgents('user-phone-123')[0];
      agentManager.setTelegramChatId(createdAgent.id, 12345);

      // Forum groups should use topic_command for /ralph <task>
      const result = handler.routeGroupMessage(
        12345,
        'user-phone-123',
        '/ralph Build a new feature',
        111,
        85,
        true // isForum = true
      );

      expect(result.action).toBe('topic_command');
      if (result.action === 'topic_command') {
        expect(result.threadId).toBe(85);
        expect(result.command).toBe('ralph');
        expect(result.args).toBe('Build a new feature');
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

  describe('Topic Command Routing', () => {
    test('/ralph command in forum group routes to topic_command', () => {
      agentManager.createAgent('user-phone-123', 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const createdAgent = agentManager.listAgents('user-phone-123')[0];
      agentManager.setTelegramChatId(createdAgent.id, 12345);

      const result = handler.routeGroupMessage(
        12345,
        'user-phone-123',
        '/ralph Fix the bug',
        111,
        1, // threadId
        true // isForum = true
      );

      expect(result.action).toBe('topic_command');
      if (result.action === 'topic_command') {
        expect(result.command).toBe('ralph');
        expect(result.args).toBe('Fix the bug');
        expect(result.agentId).toBe(createdAgent.id);
      }
    });

    test('/ralph command without task in forum group routes to topic_command', () => {
      agentManager.createAgent('user-phone-123', 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const createdAgent = agentManager.listAgents('user-phone-123')[0];
      agentManager.setTelegramChatId(createdAgent.id, 12345);

      const result = handler.routeGroupMessage(
        12345,
        'user-phone-123',
        '/ralph',
        111,
        1,
        true
      );

      expect(result.action).toBe('topic_command');
      if (result.action === 'topic_command') {
        expect(result.command).toBe('ralph');
        expect(result.args).toBe('');
      }
    });

    test('/worktree command in forum group routes to topic_command', () => {
      agentManager.createAgent('user-phone-123', 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const createdAgent = agentManager.listAgents('user-phone-123')[0];
      agentManager.setTelegramChatId(createdAgent.id, 12345);

      const result = handler.routeGroupMessage(
        12345,
        'user-phone-123',
        '/worktree feature/auth',
        111,
        1,
        true
      );

      expect(result.action).toBe('topic_command');
      if (result.action === 'topic_command') {
        expect(result.command).toBe('worktree');
        expect(result.args).toBe('feature/auth');
      }
    });

    test('/sessao command in forum group routes to topic_command', () => {
      agentManager.createAgent('user-phone-123', 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const createdAgent = agentManager.listAgents('user-phone-123')[0];
      agentManager.setTelegramChatId(createdAgent.id, 12345);

      const result = handler.routeGroupMessage(
        12345,
        'user-phone-123',
        '/sessao Debug session',
        111,
        1,
        true
      );

      expect(result.action).toBe('topic_command');
      if (result.action === 'topic_command') {
        expect(result.command).toBe('sessao');
        expect(result.args).toBe('Debug session');
      }
    });

    test('/topicos command routes to topic_command', () => {
      agentManager.createAgent('user-phone-123', 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const createdAgent = agentManager.listAgents('user-phone-123')[0];
      agentManager.setTelegramChatId(createdAgent.id, 12345);

      const result = handler.routeGroupMessage(
        12345,
        'user-phone-123',
        '/topicos',
        111,
        1,
        true
      );

      expect(result.action).toBe('topic_command');
      if (result.action === 'topic_command') {
        expect(result.command).toBe('topicos');
      }
    });

    test('/ralph in non-forum group with task routes to ralph_loop', () => {
      agentManager.createAgent('user-phone-123', 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const createdAgent = agentManager.listAgents('user-phone-123')[0];
      agentManager.setTelegramChatId(createdAgent.id, 12345);

      const result = handler.routeGroupMessage(
        12345,
        'user-phone-123',
        '/ralph Build feature',
        111,
        undefined,
        false // isForum = false
      );

      expect(result.action).toBe('ralph_loop');
      if (result.action === 'ralph_loop') {
        expect(result.task).toBe('Build feature');
      }
    });

    test('/worktree in non-forum group routes to topic_command for error handling', () => {
      agentManager.createAgent('user-phone-123', 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const createdAgent = agentManager.listAgents('user-phone-123')[0];
      agentManager.setTelegramChatId(createdAgent.id, 12345);

      const result = handler.routeGroupMessage(
        12345,
        'user-phone-123',
        '/worktree feature/auth',
        111,
        undefined,
        false
      );

      expect(result.action).toBe('topic_command');
      if (result.action === 'topic_command') {
        expect(result.command).toBe('worktree');
      }
    });

    test('topic_command includes agentId when agent is linked', () => {
      agentManager.createAgent('user-phone-123', 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const createdAgent = agentManager.listAgents('user-phone-123')[0];
      agentManager.setTelegramChatId(createdAgent.id, 12345);

      const result = handler.routeGroupMessage(
        12345,
        'user-phone-123',
        '/topicos',
        111,
        1,
        true
      );

      expect(result.action).toBe('topic_command');
      if (result.action === 'topic_command') {
        expect(result.agentId).toBe(createdAgent.id);
      }
    });

    test('topic_command has undefined agentId when no agent linked', () => {
      const result = handler.routeGroupMessage(
        99999, // Unlinked group
        'user-phone-123',
        '/topicos',
        111,
        1,
        true
      );

      expect(result.action).toBe('topic_command');
      if (result.action === 'topic_command') {
        expect(result.agentId).toBeUndefined();
      }
    });
  });

  describe('Ralph Control Commands', () => {
    test('/pausar routes to ralph_control in Ralph topic', () => {
      agentManager.createAgent('user-phone-123', 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const createdAgent = agentManager.listAgents('user-phone-123')[0];
      agentManager.setTelegramChatId(createdAgent.id, 12345);

      // Create a Ralph topic with active loop
      const topic = createMockTopic({
        agentId: createdAgent.id,
        telegramTopicId: 400,
        type: 'ralph',
        name: 'Active Ralph',
        loopId: 'loop-active-123',
        status: 'active',
      });
      persistence.saveTopics(createdAgent.id, undefined, [topic]);

      const result = handler.routeGroupMessage(
        12345,
        'user-phone-123',
        '/pausar',
        111,
        400, // Ralph topic threadId
        true // isForum
      );

      expect(result.action).toBe('ralph_control');
      if (result.action === 'ralph_control') {
        expect(result.command).toBe('pausar');
        expect(result.loopId).toBe('loop-active-123');
        expect(result.threadId).toBe(400);
        expect(result.agentId).toBe(createdAgent.id);
      }
    });

    test('/retomar routes to ralph_control in Ralph topic', () => {
      agentManager.createAgent('user-phone-123', 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const createdAgent = agentManager.listAgents('user-phone-123')[0];
      agentManager.setTelegramChatId(createdAgent.id, 12345);

      const topic = createMockTopic({
        agentId: createdAgent.id,
        telegramTopicId: 401,
        type: 'ralph',
        name: 'Paused Ralph',
        loopId: 'loop-paused-456',
        status: 'active',
      });
      persistence.saveTopics(createdAgent.id, undefined, [topic]);

      const result = handler.routeGroupMessage(
        12345,
        'user-phone-123',
        '/retomar',
        111,
        401,
        true
      );

      expect(result.action).toBe('ralph_control');
      if (result.action === 'ralph_control') {
        expect(result.command).toBe('retomar');
        expect(result.loopId).toBe('loop-paused-456');
      }
    });

    test('/cancelar routes to ralph_control in Ralph topic', () => {
      agentManager.createAgent('user-phone-123', 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const createdAgent = agentManager.listAgents('user-phone-123')[0];
      agentManager.setTelegramChatId(createdAgent.id, 12345);

      const topic = createMockTopic({
        agentId: createdAgent.id,
        telegramTopicId: 402,
        type: 'ralph',
        name: 'Running Ralph',
        loopId: 'loop-running-789',
        status: 'active',
      });
      persistence.saveTopics(createdAgent.id, undefined, [topic]);

      const result = handler.routeGroupMessage(
        12345,
        'user-phone-123',
        '/cancelar',
        111,
        402,
        true
      );

      // Note: /cancelar in Ralph topic routes to ralph_control
      expect(result.action).toBe('ralph_control');
      if (result.action === 'ralph_control') {
        expect(result.command).toBe('cancelar');
        expect(result.loopId).toBe('loop-running-789');
      }
    });

    test('Ralph control commands require forum and threadId > 1', () => {
      agentManager.createAgent('user-phone-123', 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const createdAgent = agentManager.listAgents('user-phone-123')[0];
      agentManager.setTelegramChatId(createdAgent.id, 12345);

      // /pausar in non-forum group routes to regular command
      const result1 = handler.routeGroupMessage(
        12345,
        'user-phone-123',
        '/pausar',
        111,
        undefined,
        false // Not a forum
      );

      expect(result1.action).toBe('command');
      if (result1.action === 'command') {
        expect(result1.command).toBe('/pausar');
      }

      // /pausar in General topic (threadId=1) routes to regular command
      const result2 = handler.routeGroupMessage(
        12345,
        'user-phone-123',
        '/pausar',
        111,
        1, // General topic
        true
      );

      expect(result2.action).toBe('command');
    });

    test('Ralph control commands require topic with active loopId', () => {
      agentManager.createAgent('user-phone-123', 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const createdAgent = agentManager.listAgents('user-phone-123')[0];
      agentManager.setTelegramChatId(createdAgent.id, 12345);

      // Create a Ralph topic WITHOUT active loop
      const topic = createMockTopic({
        agentId: createdAgent.id,
        telegramTopicId: 403,
        type: 'ralph',
        name: 'Completed Ralph',
        loopId: undefined, // No active loop
        status: 'active',
      });
      persistence.saveTopics(createdAgent.id, undefined, [topic]);

      const result = handler.routeGroupMessage(
        12345,
        'user-phone-123',
        '/pausar',
        111,
        403,
        true
      );

      // Without active loopId, routes to regular command
      expect(result.action).toBe('command');
    });

    test('Ralph control commands require ralph type topic', () => {
      agentManager.createAgent('user-phone-123', 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const createdAgent = agentManager.listAgents('user-phone-123')[0];
      agentManager.setTelegramChatId(createdAgent.id, 12345);

      // Create a session topic (not ralph)
      const topic = createMockTopic({
        agentId: createdAgent.id,
        telegramTopicId: 404,
        type: 'session', // Not ralph
        name: 'Session Topic',
        status: 'active',
      });
      persistence.saveTopics(createdAgent.id, undefined, [topic]);

      const result = handler.routeGroupMessage(
        12345,
        'user-phone-123',
        '/pausar',
        111,
        404,
        true
      );

      // Not a ralph topic, routes to regular command
      expect(result.action).toBe('command');
    });
  });

  describe('topic_ralph_active includes loopId', () => {
    test('topic_ralph_active result includes loopId', () => {
      agentManager.createAgent('user-phone-123', 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const createdAgent = agentManager.listAgents('user-phone-123')[0];
      agentManager.setTelegramChatId(createdAgent.id, 12345);

      const topic = createMockTopic({
        agentId: createdAgent.id,
        telegramTopicId: 500,
        type: 'ralph',
        name: 'Ralph with Loop',
        loopId: 'specific-loop-id-xyz',
        status: 'active',
      });
      persistence.saveTopics(createdAgent.id, undefined, [topic]);

      const result = handler.routeGroupMessage(
        12345,
        'user-phone-123',
        'Add this to the queue',
        111,
        500,
        true
      );

      expect(result.action).toBe('topic_ralph_active');
      if (result.action === 'topic_ralph_active') {
        expect(result.loopId).toBe('specific-loop-id-xyz');
        expect(result.text).toBe('Add this to the queue');
      }
    });
  });
});
