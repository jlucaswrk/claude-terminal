// src/__tests__/startup-sync.test.ts
/**
 * Tests for startup recovery and synchronization logic
 *
 * Covers:
 * - Topic sync with mocked Telegram API
 * - Ralph loop validation against topics
 * - Exponential backoff retry logic
 * - Error handling and timeout behavior
 */
import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { existsSync, unlinkSync, mkdirSync, rmdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { TopicManager, type CreateTopicOptions } from '../topic-manager';
import { RalphLoopManager } from '../ralph-loop-manager';
import { AgentManager } from '../agent-manager';
import { PersistenceService } from '../persistence';
import { Semaphore } from '../semaphore';
import { ClaudeTerminal } from '../terminal';
import * as telegram from '../telegram';
import type { AgentTopic, TopicType, TopicStatus } from '../types';

// Test file paths
const TEST_STATE_FILE = './test-startup-sync-state.json';
const TEST_LOOPS_DIR = './test-startup-sync-loops';
const TEST_PREFS_FILE = './test-startup-sync-preferences.json';
const TEST_TOPICS_DIR = './test-startup-sync-topics';

function cleanup() {
  // Clean up test files
  if (existsSync(TEST_STATE_FILE)) unlinkSync(TEST_STATE_FILE);
  if (existsSync(TEST_STATE_FILE + '.bak')) unlinkSync(TEST_STATE_FILE + '.bak');
  if (existsSync(TEST_PREFS_FILE)) unlinkSync(TEST_PREFS_FILE);

  // Clean up test directories
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
}

function createMockTopic(overrides: Partial<AgentTopic> = {}): AgentTopic {
  return {
    id: `topic-${crypto.randomUUID().slice(0, 8)}`,
    agentId: 'agent-123',
    telegramTopicId: 12345,
    type: 'session' as TopicType,
    name: 'Test Topic',
    emoji: '💬',
    sessionId: 'session-123',
    status: 'active' as TopicStatus,
    messageCount: 0,
    createdAt: new Date(),
    lastActivity: new Date(),
    ...overrides,
  };
}

describe('Startup Sync - Retry Logic', () => {
  describe('withRetry', () => {
    test('returns result on first success', async () => {
      const fn = mock(() => Promise.resolve('success'));

      const result = await telegram.withRetry(fn, 'test operation');

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    test('retries on rate limit error (429)', async () => {
      let attempts = 0;
      const fn = mock(async () => {
        attempts++;
        if (attempts < 2) {
          throw new Error('429 Too Many Requests');
        }
        return 'success';
      });

      const result = await telegram.withRetry(fn, 'test operation', 3, 10); // Use 10ms delay for tests

      expect(result).toBe('success');
      expect(attempts).toBe(2);
    });

    test('returns null after max retries exhausted', async () => {
      const fn = mock(() => Promise.reject(new Error('429 Too Many Requests')));

      const result = await telegram.withRetry(fn, 'test operation', 2, 10);

      expect(result).toBeNull();
      expect(fn).toHaveBeenCalledTimes(2);
    });

    test('throws immediately on non-retryable error', async () => {
      const fn = mock(() => Promise.reject(new Error('TOPIC_DELETED')));

      await expect(telegram.withRetry(fn, 'test operation')).rejects.toThrow('TOPIC_DELETED');
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('sleep', () => {
    test('resolves after specified delay', async () => {
      const start = Date.now();
      await telegram.sleep(50);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(45); // Allow some tolerance
      expect(elapsed).toBeLessThan(150);
    });
  });
});

describe('Startup Sync - Topic Validation', () => {
  let manager: TopicManager;
  let persistence: PersistenceService;

  beforeEach(() => {
    cleanup();
    persistence = new PersistenceService(TEST_STATE_FILE, TEST_LOOPS_DIR, TEST_PREFS_FILE, TEST_TOPICS_DIR);
    manager = new TopicManager(persistence);
  });

  afterEach(() => {
    cleanup();
  });

  describe('syncTopicsWithTelegram', () => {
    test('returns error when chat is not a forum', async () => {
      // Mock getExtendedChat to return a non-forum chat
      const mockGetExtendedChat = spyOn(telegram, 'getExtendedChat').mockResolvedValue({
        id: 12345,
        is_forum: false,
        type: 'supergroup',
      } as telegram.ExtendedChat);

      // Create a topic first
      const topic = createMockTopic({ agentId: 'agent-123', telegramTopicId: 999 });
      persistence.saveTopics('agent-123', undefined, [topic]);

      const result = await manager.syncTopicsWithTelegram('agent-123', 12345);

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Chat 12345 não é um fórum');

      mockGetExtendedChat.mockRestore();
    });

    test('returns error when chat info unavailable', async () => {
      const mockGetExtendedChat = spyOn(telegram, 'getExtendedChat').mockResolvedValue(null);

      const result = await manager.syncTopicsWithTelegram('agent-123', 12345);

      expect(result.success).toBe(false);
      expect(result.errors[0]).toContain('Falha ao obter informações do chat');

      mockGetExtendedChat.mockRestore();
    });

    test('marks deleted topic as closed', async () => {
      // Mock chat as forum
      const mockGetExtendedChat = spyOn(telegram, 'getExtendedChat').mockResolvedValue({
        id: 12345,
        is_forum: true,
        type: 'supergroup',
      } as telegram.ExtendedChat);

      // Mock withRetry to call through to validateForumTopicExists
      const mockWithRetry = spyOn(telegram, 'withRetry').mockImplementation(async (fn) => await fn());

      // Mock validateForumTopicExists to return false (topic deleted)
      const mockValidate = spyOn(telegram, 'validateForumTopicExists').mockResolvedValue(false);

      // Create an active topic
      const topic = createMockTopic({
        agentId: 'agent-123',
        telegramTopicId: 999,
        status: 'active',
        type: 'session',
      });
      persistence.saveTopics('agent-123', undefined, [topic]);

      const result = await manager.syncTopicsWithTelegram('agent-123', 12345);

      // Verify topic was marked as closed
      const updatedTopics = manager.listTopics('agent-123');
      expect(updatedTopics[0].status).toBe('closed');
      expect(result.newlyClosed).toBe(1);
      expect(result.synced).toBe(0);

      mockGetExtendedChat.mockRestore();
      mockValidate.mockRestore();
      mockWithRetry.mockRestore();
    });

    test('keeps active topic status when validation succeeds', async () => {
      const mockGetExtendedChat = spyOn(telegram, 'getExtendedChat').mockResolvedValue({
        id: 12345,
        is_forum: true,
        type: 'supergroup',
      } as telegram.ExtendedChat);

      // Mock withRetry to call through to validateForumTopicExists
      const mockWithRetry = spyOn(telegram, 'withRetry').mockImplementation(async (fn) => await fn());

      const mockValidate = spyOn(telegram, 'validateForumTopicExists').mockResolvedValue(true);

      const topic = createMockTopic({
        agentId: 'agent-active',
        telegramTopicId: 888,
        status: 'active',
        type: 'session',
      });
      persistence.saveTopics('agent-active', undefined, [topic]);

      const result = await manager.syncTopicsWithTelegram('agent-active', 12345);

      const updatedTopics = manager.listTopics('agent-active');
      expect(updatedTopics[0].status).toBe('active');
      expect(result.synced).toBe(1);

      mockGetExtendedChat.mockRestore();
      mockValidate.mockRestore();
      mockWithRetry.mockRestore();
    });

    test('skips general topics during validation', async () => {
      const mockGetExtendedChat = spyOn(telegram, 'getExtendedChat').mockResolvedValue({
        id: 12345,
        is_forum: true,
        type: 'supergroup',
      } as telegram.ExtendedChat);

      const mockValidate = spyOn(telegram, 'validateForumTopicExists');

      // Create a general topic (should be skipped)
      const topic = createMockTopic({
        agentId: 'agent-general',
        telegramTopicId: 1, // General topic ID
        type: 'general',
        status: 'active',
      });
      persistence.saveTopics('agent-general', undefined, [topic]);

      await manager.syncTopicsWithTelegram('agent-general', 12345);

      // validateForumTopicExists should not be called for general topics
      expect(mockValidate).not.toHaveBeenCalled();

      mockGetExtendedChat.mockRestore();
      mockValidate.mockRestore();
    });

    test('skips already closed topics', async () => {
      const mockGetExtendedChat = spyOn(telegram, 'getExtendedChat').mockResolvedValue({
        id: 12345,
        is_forum: true,
        type: 'supergroup',
      } as telegram.ExtendedChat);

      const mockValidate = spyOn(telegram, 'validateForumTopicExists');

      const topic = createMockTopic({
        agentId: 'agent-closed',
        telegramTopicId: 777,
        status: 'closed',
        type: 'session',
      });
      persistence.saveTopics('agent-closed', undefined, [topic]);

      const result = await manager.syncTopicsWithTelegram('agent-closed', 12345);

      // validateForumTopicExists should not be called for closed topics
      expect(mockValidate).not.toHaveBeenCalled();
      expect(result.alreadyClosed).toBe(1);
      expect(result.newlyClosed).toBe(0);

      mockGetExtendedChat.mockRestore();
      mockValidate.mockRestore();
    });

    test('aborts sync after consecutive rate limit errors', async () => {
      const mockGetExtendedChat = spyOn(telegram, 'getExtendedChat').mockResolvedValue({
        id: 12345,
        is_forum: true,
        type: 'supergroup',
      } as telegram.ExtendedChat);

      // Mock withRetry to return null immediately (simulating exhausted retries without actual delays)
      const mockWithRetry = spyOn(telegram, 'withRetry').mockResolvedValue(null);

      // Mock sleep to be instant
      const mockSleep = spyOn(telegram, 'sleep').mockResolvedValue(undefined);

      // Create multiple active topics
      const topics = [
        createMockTopic({ agentId: 'agent-ratelimit', telegramTopicId: 111, name: 'Topic 1' }),
        createMockTopic({ agentId: 'agent-ratelimit', telegramTopicId: 222, name: 'Topic 2' }),
        createMockTopic({ agentId: 'agent-ratelimit', telegramTopicId: 333, name: 'Topic 3' }),
        createMockTopic({ agentId: 'agent-ratelimit', telegramTopicId: 444, name: 'Topic 4' }),
        createMockTopic({ agentId: 'agent-ratelimit', telegramTopicId: 555, name: 'Topic 5' }),
      ];
      persistence.saveTopics('agent-ratelimit', undefined, topics);

      const result = await manager.syncTopicsWithTelegram('agent-ratelimit', 12345);

      // Should have aborted after 3 consecutive failures (withRetry returning null counts as failure)
      expect(result.errors).toContain('Sincronização abortada: muitos erros de rate limit');
      // withRetry should have been called exactly 3 times before aborting
      expect(mockWithRetry).toHaveBeenCalledTimes(3);

      mockGetExtendedChat.mockRestore();
      mockWithRetry.mockRestore();
      mockSleep.mockRestore();
    });
  });
});

describe('Startup Sync - Ralph Loop Recovery', () => {
  let semaphore: Semaphore;
  let agentManager: AgentManager;
  let persistence: PersistenceService;
  let loopManager: RalphLoopManager;
  let topicManager: TopicManager;
  let mockTerminal: ClaudeTerminal;

  beforeEach(() => {
    cleanup();

    semaphore = new Semaphore(2);
    persistence = new PersistenceService(TEST_STATE_FILE, TEST_LOOPS_DIR, TEST_PREFS_FILE, TEST_TOPICS_DIR);
    agentManager = new AgentManager(persistence);
    topicManager = new TopicManager(persistence);

    mockTerminal = {
      send: mock(() => Promise.resolve({ text: 'Mock response', sessionId: 'session-123' })),
    } as unknown as ClaudeTerminal;

    loopManager = new RalphLoopManager(semaphore, agentManager, persistence, mockTerminal);
  });

  afterEach(() => {
    cleanup();
  });

  describe('validateLoopsAgainstTopics', () => {
    test('marks loop as interrupted when topic not found', async () => {
      // Create agent
      const agent = agentManager.createAgent('user-123', 'Test Agent', undefined, '🤖', 'claude', 'sonnet');

      // Start a loop with a threadId
      const loopId = loopManager.start(agent.id, 'Test task', 10, 'sonnet', 12345);

      // Validate loops - topic doesn't exist
      const interruptedCount = await loopManager.validateLoopsAgainstTopics(
        (agentId, threadId) => undefined // Topic not found
      );

      expect(interruptedCount).toBe(1);

      const loop = loopManager.getLoop(loopId);
      expect(loop?.status).toBe('interrupted');
    });

    test('marks loop as interrupted when topic is closed', async () => {
      const agent = agentManager.createAgent('user-123', 'Test Agent', undefined, '🤖', 'claude', 'sonnet');
      const loopId = loopManager.start(agent.id, 'Test task', 10, 'sonnet', 12345);

      // Validate loops - topic exists but is closed
      const interruptedCount = await loopManager.validateLoopsAgainstTopics(
        (agentId, threadId) => ({ status: 'closed' })
      );

      expect(interruptedCount).toBe(1);

      const loop = loopManager.getLoop(loopId);
      expect(loop?.status).toBe('interrupted');
    });

    test('keeps loop active when topic is active', async () => {
      const agent = agentManager.createAgent('user-123', 'Test Agent', undefined, '🤖', 'claude', 'sonnet');
      const loopId = loopManager.start(agent.id, 'Test task', 10, 'sonnet', 12345);

      // Validate loops - topic exists and is active
      const interruptedCount = await loopManager.validateLoopsAgainstTopics(
        (agentId, threadId) => ({ status: 'active' })
      );

      expect(interruptedCount).toBe(0);

      const loop = loopManager.getLoop(loopId);
      expect(loop?.status).toBe('paused'); // Initial status
    });

    test('skips loops without threadId', async () => {
      const agent = agentManager.createAgent('user-123', 'Test Agent', undefined, '🤖', 'claude', 'sonnet');

      // Start a loop WITHOUT threadId
      const loopId = loopManager.start(agent.id, 'Test task', 10, 'sonnet');

      // Validate loops
      const interruptedCount = await loopManager.validateLoopsAgainstTopics(
        (agentId, threadId) => undefined
      );

      expect(interruptedCount).toBe(0);

      const loop = loopManager.getLoop(loopId);
      expect(loop?.status).toBe('paused');
    });

    test('marks loop as interrupted when agent not found', async () => {
      // Create agent and start loop
      const agent = agentManager.createAgent('user-123', 'Test Agent', undefined, '🤖', 'claude', 'sonnet');
      const loopId = loopManager.start(agent.id, 'Test task', 10, 'sonnet', 12345);

      // Manually save loop with a different agentId to simulate orphaned loop
      const loop = loopManager.getLoop(loopId)!;
      const orphanedLoop = { ...loop, agentId: 'non-existent-agent-id' };
      persistence.saveLoop(orphanedLoop);

      // Create new loop manager to load the orphaned loop
      const newLoopManager = new RalphLoopManager(semaphore, agentManager, persistence, mockTerminal);

      // Validate loops - agent doesn't exist
      const interruptedCount = await newLoopManager.validateLoopsAgainstTopics(
        (agentId, threadId) => ({ status: 'active' })
      );

      expect(interruptedCount).toBe(1);

      const reloadedLoop = persistence.loadLoop(loopId);
      expect(reloadedLoop?.status).toBe('interrupted');
    });
  });
});

describe('Startup Sync - Integration', () => {
  let persistence: PersistenceService;
  let agentManager: AgentManager;
  let topicManager: TopicManager;
  let loopManager: RalphLoopManager;
  let semaphore: Semaphore;
  let mockTerminal: ClaudeTerminal;

  beforeEach(() => {
    cleanup();

    persistence = new PersistenceService(TEST_STATE_FILE, TEST_LOOPS_DIR, TEST_PREFS_FILE, TEST_TOPICS_DIR);
    agentManager = new AgentManager(persistence);
    topicManager = new TopicManager(persistence);
    semaphore = new Semaphore(2);

    mockTerminal = {
      send: mock(() => Promise.resolve({ text: 'Mock response', sessionId: 'session-123' })),
    } as unknown as ClaudeTerminal;

    loopManager = new RalphLoopManager(semaphore, agentManager, persistence, mockTerminal);
  });

  afterEach(() => {
    cleanup();
  });

  test('full sync flow: topic deleted marks loop interrupted', async () => {
    // 1. Create agent with telegramChatId
    const agent = agentManager.createAgent('user-123', 'Full Sync Agent', undefined, '🤖', 'claude', 'sonnet');
    agentManager.setTelegramChatId(agent.id, 12345);

    // 2. Create a topic
    const topic = createMockTopic({
      agentId: agent.id,
      telegramTopicId: 99999,
      status: 'active',
      type: 'ralph',
    });
    persistence.saveTopics(agent.id, undefined, [topic]);

    // 3. Start a loop referencing the topic
    const loopId = loopManager.start(agent.id, 'Full sync test', 10, 'sonnet', 99999);

    // 4. Mock Telegram API - topic deleted
    const mockGetExtendedChat = spyOn(telegram, 'getExtendedChat').mockResolvedValue({
      id: 12345,
      is_forum: true,
      type: 'supergroup',
    } as telegram.ExtendedChat);

    // Mock both validateForumTopicExists AND withRetry since the code uses withRetry
    const mockValidate = spyOn(telegram, 'validateForumTopicExists').mockResolvedValue(false);
    const mockWithRetry = spyOn(telegram, 'withRetry').mockImplementation(async (fn) => {
      // Actually call the function to get the real result
      return await fn();
    });

    // 5. Run topic sync
    await topicManager.syncTopicsWithTelegram(agent.id, 12345);

    // 6. Verify topic is closed
    const topics = topicManager.listTopics(agent.id);
    expect(topics[0].status).toBe('closed');

    // 7. Run loop validation
    const interruptedCount = await loopManager.validateLoopsAgainstTopics(
      (agentId, threadId) => topicManager.getTopicByThreadId(agentId, threadId)
    );

    // 8. Verify loop is interrupted
    expect(interruptedCount).toBe(1);
    const loop = loopManager.getLoop(loopId);
    expect(loop?.status).toBe('interrupted');

    mockGetExtendedChat.mockRestore();
    mockValidate.mockRestore();
    mockWithRetry.mockRestore();
  });
});
