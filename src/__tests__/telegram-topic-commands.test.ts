// src/__tests__/telegram-topic-commands.test.ts
/**
 * Integration tests for Telegram topic commands (/ralph, /worktree, /sessao, /topicos)
 *
 * Tests cover:
 * - Command routing and handling
 * - Interactive flows (collecting missing parameters)
 * - Topic creation via TopicManager
 * - Group validation (topics enabled, agent linked)
 * - Callback handling for iteration selection
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { TelegramCommandHandler } from '../telegram-command-handler';
import { UserContextManager } from '../user-context-manager';
import { AgentManager } from '../agent-manager';
import { TopicManager } from '../topic-manager';
import { PersistenceService } from '../persistence';
import type { AgentTopic, TopicType, TopicStatus } from '../types';
import { existsSync, unlinkSync, mkdirSync, rmdirSync, readdirSync } from 'fs';
import { join } from 'path';

const TEST_STATE_FILE = './test-topic-cmd-state.json';
const TEST_LOOPS_DIR = './test-topic-cmd-loops';
const TEST_PREFS_FILE = './test-topic-cmd-preferences.json';
const TEST_TOPICS_DIR = './test-topic-cmd-topics';
const TEST_WORKSPACE = './test-topic-cmd-workspace';

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

describe('Telegram Topic Commands Integration', () => {
  let handler: TelegramCommandHandler;
  let agentManager: AgentManager;
  let topicManager: TopicManager;
  let userContextManager: UserContextManager;
  let persistence: PersistenceService;

  const CHAT_ID = 12345;
  const USER_ID = 'user-phone-123';
  const TELEGRAM_USER_ID = 111;

  beforeEach(() => {
    cleanup();
    ensureWorkspace();
    persistence = new PersistenceService(TEST_STATE_FILE, TEST_LOOPS_DIR, TEST_PREFS_FILE, TEST_TOPICS_DIR);
    agentManager = new AgentManager(persistence);
    topicManager = new TopicManager(persistence);
    userContextManager = new UserContextManager();
    handler = new TelegramCommandHandler(agentManager, undefined, topicManager);
  });

  afterEach(() => {
    cleanup();
  });

  describe('/ralph Command Routing', () => {
    test('routes /ralph with task to topic_command in forum group', () => {
      agentManager.createAgent(USER_ID, 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const agent = agentManager.listAgents(USER_ID)[0];
      agentManager.setTelegramChatId(agent.id, CHAT_ID);

      const result = handler.routeGroupMessage(
        CHAT_ID,
        USER_ID,
        '/ralph Fix the authentication bug',
        TELEGRAM_USER_ID,
        1, // threadId
        true // isForum
      );

      expect(result.action).toBe('topic_command');
      if (result.action === 'topic_command') {
        expect(result.command).toBe('ralph');
        expect(result.args).toBe('Fix the authentication bug');
        expect(result.agentId).toBe(agent.id);
      }
    });

    test('routes /ralph without task to topic_command in forum group', () => {
      agentManager.createAgent(USER_ID, 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const agent = agentManager.listAgents(USER_ID)[0];
      agentManager.setTelegramChatId(agent.id, CHAT_ID);

      const result = handler.routeGroupMessage(
        CHAT_ID,
        USER_ID,
        '/ralph',
        TELEGRAM_USER_ID,
        1,
        true
      );

      expect(result.action).toBe('topic_command');
      if (result.action === 'topic_command') {
        expect(result.command).toBe('ralph');
        expect(result.args).toBe('');
      }
    });

    test('routes /ralph with task to ralph_loop in non-forum group', () => {
      agentManager.createAgent(USER_ID, 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const agent = agentManager.listAgents(USER_ID)[0];
      agentManager.setTelegramChatId(agent.id, CHAT_ID);

      const result = handler.routeGroupMessage(
        CHAT_ID,
        USER_ID,
        '/ralph Build a feature',
        TELEGRAM_USER_ID,
        undefined,
        false // NOT a forum
      );

      expect(result.action).toBe('ralph_loop');
      if (result.action === 'ralph_loop') {
        expect(result.task).toBe('Build a feature');
      }
    });
  });

  describe('/worktree Command Routing', () => {
    test('routes /worktree with name to topic_command', () => {
      agentManager.createAgent(USER_ID, 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const agent = agentManager.listAgents(USER_ID)[0];
      agentManager.setTelegramChatId(agent.id, CHAT_ID);

      const result = handler.routeGroupMessage(
        CHAT_ID,
        USER_ID,
        '/worktree feature/auth',
        TELEGRAM_USER_ID,
        1,
        true
      );

      expect(result.action).toBe('topic_command');
      if (result.action === 'topic_command') {
        expect(result.command).toBe('worktree');
        expect(result.args).toBe('feature/auth');
      }
    });

    test('routes /worktree without name to topic_command', () => {
      agentManager.createAgent(USER_ID, 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const agent = agentManager.listAgents(USER_ID)[0];
      agentManager.setTelegramChatId(agent.id, CHAT_ID);

      const result = handler.routeGroupMessage(
        CHAT_ID,
        USER_ID,
        '/worktree',
        TELEGRAM_USER_ID,
        1,
        true
      );

      expect(result.action).toBe('topic_command');
      if (result.action === 'topic_command') {
        expect(result.command).toBe('worktree');
        expect(result.args).toBe('');
      }
    });

    test('routes /worktree in non-forum group to topic_command for error handling', () => {
      agentManager.createAgent(USER_ID, 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const agent = agentManager.listAgents(USER_ID)[0];
      agentManager.setTelegramChatId(agent.id, CHAT_ID);

      const result = handler.routeGroupMessage(
        CHAT_ID,
        USER_ID,
        '/worktree feature/test',
        TELEGRAM_USER_ID,
        undefined,
        false
      );

      expect(result.action).toBe('topic_command');
      if (result.action === 'topic_command') {
        expect(result.command).toBe('worktree');
      }
    });
  });

  describe('/sessao Command Routing', () => {
    test('routes /sessao with name to topic_command', () => {
      agentManager.createAgent(USER_ID, 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const agent = agentManager.listAgents(USER_ID)[0];
      agentManager.setTelegramChatId(agent.id, CHAT_ID);

      const result = handler.routeGroupMessage(
        CHAT_ID,
        USER_ID,
        '/sessao Debug session',
        TELEGRAM_USER_ID,
        1,
        true
      );

      expect(result.action).toBe('topic_command');
      if (result.action === 'topic_command') {
        expect(result.command).toBe('sessao');
        expect(result.args).toBe('Debug session');
      }
    });

    test('routes /sessao without name to topic_command', () => {
      agentManager.createAgent(USER_ID, 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const agent = agentManager.listAgents(USER_ID)[0];
      agentManager.setTelegramChatId(agent.id, CHAT_ID);

      const result = handler.routeGroupMessage(
        CHAT_ID,
        USER_ID,
        '/sessao',
        TELEGRAM_USER_ID,
        1,
        true
      );

      expect(result.action).toBe('topic_command');
      if (result.action === 'topic_command') {
        expect(result.command).toBe('sessao');
        expect(result.args).toBe('');
      }
    });
  });

  describe('/topicos Command Routing', () => {
    test('routes /topicos to topic_command', () => {
      agentManager.createAgent(USER_ID, 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const agent = agentManager.listAgents(USER_ID)[0];
      agentManager.setTelegramChatId(agent.id, CHAT_ID);

      const result = handler.routeGroupMessage(
        CHAT_ID,
        USER_ID,
        '/topicos',
        TELEGRAM_USER_ID,
        1,
        true
      );

      expect(result.action).toBe('topic_command');
      if (result.action === 'topic_command') {
        expect(result.command).toBe('topicos');
        expect(result.agentId).toBe(agent.id);
      }
    });

    test('/topicos has undefined agentId when no agent linked', () => {
      const result = handler.routeGroupMessage(
        99999, // Unlinked group
        USER_ID,
        '/topicos',
        TELEGRAM_USER_ID,
        1,
        true
      );

      expect(result.action).toBe('topic_command');
      if (result.action === 'topic_command') {
        expect(result.command).toBe('topicos');
        expect(result.agentId).toBeUndefined();
      }
    });
  });

  describe('Interactive Flow - Topic Ralph', () => {
    test('startTopicRalphFlow without task starts awaiting_topic_task state', () => {
      userContextManager.startTopicRalphFlow(USER_ID, 'agent-123', CHAT_ID);

      expect(userContextManager.isInTopicRalphFlow(USER_ID)).toBe(true);
      expect(userContextManager.isAwaitingTopicTask(USER_ID)).toBe(true);
      expect(userContextManager.isAwaitingTopicIterations(USER_ID)).toBe(false);
    });

    test('startTopicRalphFlow with task skips to awaiting_topic_iterations', () => {
      userContextManager.startTopicRalphFlow(USER_ID, 'agent-123', CHAT_ID, 'Fix the bug');

      expect(userContextManager.isInTopicRalphFlow(USER_ID)).toBe(true);
      expect(userContextManager.isAwaitingTopicTask(USER_ID)).toBe(false);
      expect(userContextManager.isAwaitingTopicIterations(USER_ID)).toBe(true);

      const data = userContextManager.getTopicRalphData(USER_ID);
      expect(data?.topicTask).toBe('Fix the bug');
    });

    test('setTopicTask transitions to awaiting_topic_iterations', () => {
      userContextManager.startTopicRalphFlow(USER_ID, 'agent-123', CHAT_ID);
      userContextManager.setTopicTask(USER_ID, 'Build new feature');

      expect(userContextManager.isAwaitingTopicTask(USER_ID)).toBe(false);
      expect(userContextManager.isAwaitingTopicIterations(USER_ID)).toBe(true);
    });

    test('setTopicMaxIterations stores iterations', () => {
      userContextManager.startTopicRalphFlow(USER_ID, 'agent-123', CHAT_ID, 'Task');
      userContextManager.setTopicMaxIterations(USER_ID, 20);

      const data = userContextManager.getTopicRalphData(USER_ID);
      expect(data?.topicMaxIterations).toBe(20);
    });

    test('getTopicRalphData returns complete flow data', () => {
      userContextManager.startTopicRalphFlow(USER_ID, 'agent-123', CHAT_ID, 'Build it');
      userContextManager.setTopicMaxIterations(USER_ID, 30);

      const data = userContextManager.getTopicRalphData(USER_ID);
      expect(data).toEqual({
        agentId: 'agent-123',
        telegramChatId: CHAT_ID,
        topicTask: 'Build it',
        topicMaxIterations: 30,
      });
    });
  });

  describe('Interactive Flow - Topic Worktree', () => {
    test('startTopicWorktreeFlow without name starts awaiting_topic_name state', () => {
      userContextManager.startTopicWorktreeFlow(USER_ID, 'agent-123', CHAT_ID);

      expect(userContextManager.isInTopicWorktreeFlow(USER_ID)).toBe(true);
      expect(userContextManager.isAwaitingTopicName(USER_ID)).toBe(true);
    });

    test('startTopicWorktreeFlow with name completes immediately', () => {
      userContextManager.startTopicWorktreeFlow(USER_ID, 'agent-123', CHAT_ID, 'feature/auth');

      expect(userContextManager.isInTopicWorktreeFlow(USER_ID)).toBe(true);
      expect(userContextManager.isAwaitingTopicName(USER_ID)).toBe(false);

      const data = userContextManager.getTopicCreationData(USER_ID);
      expect(data?.topicName).toBe('feature/auth');
      expect(data?.flowType).toBe('topic_worktree');
    });

    test('setTopicName stores name and clears flowState', () => {
      userContextManager.startTopicWorktreeFlow(USER_ID, 'agent-123', CHAT_ID);
      userContextManager.setTopicName(USER_ID, 'feature/payments');

      expect(userContextManager.isAwaitingTopicName(USER_ID)).toBe(false);

      const data = userContextManager.getTopicCreationData(USER_ID);
      expect(data?.topicName).toBe('feature/payments');
    });
  });

  describe('Interactive Flow - Topic Sessao', () => {
    test('startTopicSessaoFlow without name starts awaiting_topic_name state', () => {
      userContextManager.startTopicSessaoFlow(USER_ID, 'agent-123', CHAT_ID);

      expect(userContextManager.isInTopicSessaoFlow(USER_ID)).toBe(true);
      expect(userContextManager.isAwaitingTopicName(USER_ID)).toBe(true);
    });

    test('startTopicSessaoFlow with name completes immediately', () => {
      userContextManager.startTopicSessaoFlow(USER_ID, 'agent-123', CHAT_ID, 'Debug session');

      expect(userContextManager.isInTopicSessaoFlow(USER_ID)).toBe(true);
      expect(userContextManager.isAwaitingTopicName(USER_ID)).toBe(false);

      const data = userContextManager.getTopicCreationData(USER_ID);
      expect(data?.topicName).toBe('Debug session');
      expect(data?.flowType).toBe('topic_sessao');
    });
  });

  describe('TopicManager - setTopicLoopId / clearTopicLoopId', () => {
    test('setTopicLoopId links Ralph loop to topic', () => {
      const topic = createMockTopic({
        id: 'topic-ralph',
        agentId: 'agent-123',
        type: 'ralph',
      });
      persistence.saveTopics('agent-123', undefined, [topic]);

      topicManager.setTopicLoopId('agent-123', 'topic-ralph', 'loop-abc-123');

      const updated = topicManager.getTopic('agent-123', 'topic-ralph');
      expect(updated?.loopId).toBe('loop-abc-123');
    });

    test('clearTopicLoopId removes Ralph loop from topic', () => {
      const topic = createMockTopic({
        id: 'topic-ralph-2',
        agentId: 'agent-123',
        type: 'ralph',
        loopId: 'loop-to-clear',
      });
      persistence.saveTopics('agent-123', undefined, [topic]);

      topicManager.clearTopicLoopId('agent-123', 'topic-ralph-2');

      const updated = topicManager.getTopic('agent-123', 'topic-ralph-2');
      expect(updated?.loopId).toBeUndefined();
    });

    test('setTopicLoopId updates lastActivity', () => {
      const oldDate = new Date('2020-01-01');
      const topic = createMockTopic({
        id: 'topic-activity',
        agentId: 'agent-123',
        lastActivity: oldDate,
      });
      persistence.saveTopics('agent-123', undefined, [topic]);

      topicManager.setTopicLoopId('agent-123', 'topic-activity', 'loop-123');

      const updated = topicManager.getTopic('agent-123', 'topic-activity');
      expect(updated?.lastActivity.getTime()).toBeGreaterThan(oldDate.getTime());
    });
  });

  describe('TopicManager - createTopic with options', () => {
    test('createTopic with valid options creates topic (skipTelegramCreation)', async () => {
      const result = await topicManager.createTopic({
        agentId: 'agent-create-test',
        chatId: CHAT_ID,
        name: 'Test Creation',
        type: 'worktree',
        skipTelegramCreation: true,
      });

      expect(result.success).toBe(true);
      expect(result.topic).toBeDefined();
      expect(result.topic?.name).toBe('Test Creation');
      expect(result.topic?.type).toBe('worktree');
      expect(result.topic?.emoji).toBe('🌿'); // Default worktree emoji
    });

    test('createTopic with custom emoji', async () => {
      const result = await topicManager.createTopic({
        agentId: 'agent-emoji-test',
        chatId: CHAT_ID,
        name: 'Custom Emoji',
        type: 'session',
        emoji: '🚀',
        skipTelegramCreation: true,
      });

      expect(result.success).toBe(true);
      expect(result.topic?.emoji).toBe('🚀');
    });

    test('createTopic fails with empty name', async () => {
      const result = await topicManager.createTopic({
        agentId: 'agent-fail-test',
        chatId: CHAT_ID,
        name: '',
        type: 'session',
        skipTelegramCreation: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      // Validates either "empty" or "required" error messages
      expect(result.error!.toLowerCase()).toMatch(/empty|required/);
    });

    test('createTopic fails with name exceeding 100 chars', async () => {
      const longName = 'a'.repeat(101);
      const result = await topicManager.createTopic({
        agentId: 'agent-long-test',
        chatId: CHAT_ID,
        name: longName,
        type: 'session',
        skipTelegramCreation: true,
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('100');
    });
  });

  describe('isInTopicFlow helper', () => {
    test('returns true for Ralph flow', () => {
      userContextManager.startTopicRalphFlow(USER_ID, 'agent-456', CHAT_ID);
      expect(userContextManager.isInTopicFlow(USER_ID)).toBe(true);
    });

    test('returns true for Worktree flow', () => {
      userContextManager.startTopicWorktreeFlow(USER_ID, 'agent-456', CHAT_ID);
      expect(userContextManager.isInTopicFlow(USER_ID)).toBe(true);
    });

    test('returns true for Sessao flow', () => {
      userContextManager.startTopicSessaoFlow(USER_ID, 'agent-456', CHAT_ID);
      expect(userContextManager.isInTopicFlow(USER_ID)).toBe(true);
    });

    test('returns false when no flow active', () => {
      expect(userContextManager.isInTopicFlow(USER_ID)).toBe(false);
    });
  });

  describe('Flow Clearing', () => {
    test('clearContext clears Ralph flow', () => {
      userContextManager.startTopicRalphFlow(USER_ID, 'agent-456', CHAT_ID, 'Task');
      userContextManager.clearContext(USER_ID);

      expect(userContextManager.isInTopicRalphFlow(USER_ID)).toBe(false);
      expect(userContextManager.getTopicRalphData(USER_ID)).toBeUndefined();
    });

    test('clearContext clears Worktree flow', () => {
      userContextManager.startTopicWorktreeFlow(USER_ID, 'agent-456', CHAT_ID, 'feature');
      userContextManager.clearContext(USER_ID);

      expect(userContextManager.isInTopicWorktreeFlow(USER_ID)).toBe(false);
      expect(userContextManager.getTopicCreationData(USER_ID)).toBeUndefined();
    });

    test('clearContext clears Sessao flow', () => {
      userContextManager.startTopicSessaoFlow(USER_ID, 'agent-456', CHAT_ID, 'session');
      userContextManager.clearContext(USER_ID);

      expect(userContextManager.isInTopicSessaoFlow(USER_ID)).toBe(false);
    });
  });

  describe('Topic Listing', () => {
    test('listTopics returns all topics for agent', async () => {
      await topicManager.createTopic({
        agentId: 'agent-list-test',
        chatId: CHAT_ID,
        name: 'Topic 1',
        type: 'worktree',
        skipTelegramCreation: true,
      });

      await topicManager.createTopic({
        agentId: 'agent-list-test',
        chatId: CHAT_ID,
        name: 'Topic 2',
        type: 'session',
        skipTelegramCreation: true,
      });

      const topics = topicManager.listTopics('agent-list-test');
      expect(topics.length).toBe(2);
      expect(topics.map(t => t.name)).toContain('Topic 1');
      expect(topics.map(t => t.name)).toContain('Topic 2');
    });

    test('listTopics with status filter', async () => {
      const result1 = await topicManager.createTopic({
        agentId: 'agent-filter-test',
        chatId: CHAT_ID,
        name: 'Active Topic',
        type: 'session',
        skipTelegramCreation: true,
      });

      if (result1.topic) {
        // Create closed topic by first creating then updating
        const closedTopic = createMockTopic({
          id: 'closed-topic-123',
          agentId: 'agent-filter-test',
          name: 'Closed Topic',
          status: 'closed',
        });

        const activeTopics = topicManager.listTopics('agent-filter-test');
        persistence.saveTopics('agent-filter-test', undefined, [...activeTopics, closedTopic]);
      }

      const activeTopics = topicManager.listTopics('agent-filter-test', { status: 'active' });
      const closedTopics = topicManager.listTopics('agent-filter-test', { status: 'closed' });

      expect(activeTopics.length).toBe(1);
      expect(activeTopics[0].name).toBe('Active Topic');
      expect(closedTopics.length).toBe(1);
      expect(closedTopics[0].name).toBe('Closed Topic');
    });
  });
});
