// src/__tests__/topic-manager.test.ts
import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { existsSync, unlinkSync, mkdirSync, rmdirSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  TopicManager,
  validateTopicName,
  TopicValidationError,
  getTopicColorForType,
  getTopicEmojiForType,
  MAX_TOPIC_NAME_LENGTH,
  type CreateTopicOptions,
} from '../topic-manager';
import { PersistenceService } from '../persistence';
import { TOPIC_COLORS } from '../telegram';
import type { AgentTopic, TopicType, TopicStatus } from '../types';

const TEST_STATE_FILE = './test-topic-manager-state.json';
const TEST_LOOPS_DIR = './test-topic-manager-loops';
const TEST_PREFS_FILE = './test-topic-manager-preferences.json';
const TEST_TOPICS_DIR = './test-topic-manager-topics';

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
    id: 'topic-uuid-1234',
    agentId: 'agent-uuid-1234',
    telegramTopicId: 123456,
    type: 'session' as TopicType,
    name: 'Test Topic',
    emoji: '💬',
    sessionId: 'session-isolated-123',
    status: 'active' as TopicStatus,
    createdAt: new Date('2024-01-15T10:00:00.000Z'),
    lastActivity: new Date('2024-01-15T12:00:00.000Z'),
    ...overrides,
  };
}

describe('TopicManager - Validation', () => {
  describe('validateTopicName', () => {
    test('accepts valid topic names', () => {
      expect(() => validateTopicName('Valid Topic Name')).not.toThrow();
      expect(() => validateTopicName('a')).not.toThrow();
      expect(() => validateTopicName('x'.repeat(100))).not.toThrow();
      expect(() => validateTopicName('Feature: Auth JWT')).not.toThrow();
      expect(() => validateTopicName('🔄 Ralph Loop')).not.toThrow();
    });

    test('rejects empty names', () => {
      expect(() => validateTopicName('')).toThrow(TopicValidationError);
      expect(() => validateTopicName('   ')).toThrow(TopicValidationError);
    });

    test('rejects names exceeding max length', () => {
      const longName = 'x'.repeat(MAX_TOPIC_NAME_LENGTH + 1);
      expect(() => validateTopicName(longName)).toThrow(TopicValidationError);
      expect(() => validateTopicName(longName)).toThrow(`exceeds maximum length of ${MAX_TOPIC_NAME_LENGTH}`);
    });

    test('rejects names with control characters', () => {
      expect(() => validateTopicName('Test\x00Name')).toThrow(TopicValidationError);
      expect(() => validateTopicName('Test\nName')).toThrow(TopicValidationError);
      expect(() => validateTopicName('Test\x1FName')).toThrow(TopicValidationError);
    });

    test('rejects null and undefined', () => {
      expect(() => validateTopicName(null as unknown as string)).toThrow(TopicValidationError);
      expect(() => validateTopicName(undefined as unknown as string)).toThrow(TopicValidationError);
    });
  });

  describe('getTopicColorForType', () => {
    test('returns correct colors for each type', () => {
      expect(getTopicColorForType('ralph')).toBe(TOPIC_COLORS.YELLOW);
      expect(getTopicColorForType('worktree')).toBe(TOPIC_COLORS.PURPLE);
      expect(getTopicColorForType('session')).toBe(TOPIC_COLORS.BLUE);
      expect(getTopicColorForType('general')).toBe(TOPIC_COLORS.GREEN);
    });
  });

  describe('getTopicEmojiForType', () => {
    test('returns correct emojis for each type', () => {
      expect(getTopicEmojiForType('ralph')).toBe('🔄');
      expect(getTopicEmojiForType('worktree')).toBe('🌿');
      expect(getTopicEmojiForType('session')).toBe('💬');
      expect(getTopicEmojiForType('general')).toBe('📌');
    });
  });
});

describe('TopicManager - CRUD Operations', () => {
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

  describe('createTopic', () => {
    test('creates topic with skipTelegramCreation', async () => {
      const options: CreateTopicOptions = {
        agentId: 'agent-123',
        chatId: 12345,
        name: 'Test Topic',
        type: 'session',
        skipTelegramCreation: true,
      };

      const result = await manager.createTopic(options);

      expect(result.success).toBe(true);
      expect(result.topic).toBeDefined();
      expect(result.topic!.name).toBe('Test Topic');
      expect(result.topic!.type).toBe('session');
      expect(result.topic!.status).toBe('active');
      expect(result.topic!.emoji).toBe('💬'); // Default session emoji
    });

    test('creates topic with custom emoji', async () => {
      const options: CreateTopicOptions = {
        agentId: 'agent-123',
        chatId: 12345,
        name: 'Custom Emoji Topic',
        type: 'session',
        emoji: '🚀',
        skipTelegramCreation: true,
      };

      const result = await manager.createTopic(options);

      expect(result.success).toBe(true);
      expect(result.topic!.emoji).toBe('🚀');
    });

    test('creates topic with session ID', async () => {
      const options: CreateTopicOptions = {
        agentId: 'agent-123',
        chatId: 12345,
        name: 'Session Topic',
        type: 'session',
        sessionId: 'isolated-session-456',
        skipTelegramCreation: true,
      };

      const result = await manager.createTopic(options);

      expect(result.success).toBe(true);
      expect(result.topic!.sessionId).toBe('isolated-session-456');
    });

    test('creates ralph topic with loop ID', async () => {
      const options: CreateTopicOptions = {
        agentId: 'agent-123',
        chatId: 12345,
        name: 'Ralph Loop',
        type: 'ralph',
        loopId: 'loop-789',
        skipTelegramCreation: true,
      };

      const result = await manager.createTopic(options);

      expect(result.success).toBe(true);
      expect(result.topic!.type).toBe('ralph');
      expect(result.topic!.loopId).toBe('loop-789');
      expect(result.topic!.emoji).toBe('🔄'); // Default ralph emoji
    });

    test('fails with invalid topic name', async () => {
      const options: CreateTopicOptions = {
        agentId: 'agent-123',
        chatId: 12345,
        name: '',
        type: 'session',
        skipTelegramCreation: true,
      };

      const result = await manager.createTopic(options);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      // Error should be about empty/required name
      expect(result.error!.toLowerCase()).toMatch(/required|empty/);
    });

    test('fails with too long topic name', async () => {
      const options: CreateTopicOptions = {
        agentId: 'agent-123',
        chatId: 12345,
        name: 'x'.repeat(MAX_TOPIC_NAME_LENGTH + 1),
        type: 'session',
        skipTelegramCreation: true,
      };

      const result = await manager.createTopic(options);

      expect(result.success).toBe(false);
      expect(result.error).toContain('maximum length');
    });

    test('persists created topic', async () => {
      const options: CreateTopicOptions = {
        agentId: 'agent-persist-123',
        chatId: 12345,
        name: 'Persisted Topic',
        type: 'worktree',
        skipTelegramCreation: true,
      };

      await manager.createTopic(options);

      // Create new manager to verify persistence
      const newManager = new TopicManager(persistence);
      const topics = newManager.listTopics('agent-persist-123');

      expect(topics).toHaveLength(1);
      expect(topics[0].name).toBe('Persisted Topic');
      expect(topics[0].type).toBe('worktree');
    });
  });

  describe('getTopic', () => {
    test('returns topic by ID', async () => {
      await manager.createTopic({
        agentId: 'agent-123',
        chatId: 12345,
        name: 'Find Me',
        type: 'session',
        skipTelegramCreation: true,
      });

      const topics = manager.listTopics('agent-123');
      const topic = manager.getTopic('agent-123', topics[0].id);

      expect(topic).toBeDefined();
      expect(topic!.name).toBe('Find Me');
    });

    test('returns undefined for non-existent topic', () => {
      const topic = manager.getTopic('agent-123', 'non-existent-id');
      expect(topic).toBeUndefined();
    });

    test('returns undefined for non-existent agent', () => {
      const topic = manager.getTopic('non-existent-agent', 'topic-id');
      expect(topic).toBeUndefined();
    });
  });

  describe('getTopicByThreadId', () => {
    test('returns topic by Telegram thread ID', async () => {
      // First save topic with specific thread ID via persistence
      const mockTopic = createMockTopic({
        agentId: 'agent-thread-123',
        telegramTopicId: 999888,
        name: 'Thread Test',
      });
      persistence.saveTopics('agent-thread-123', undefined, [mockTopic]);

      const topic = manager.getTopicByThreadId('agent-thread-123', 999888);

      expect(topic).toBeDefined();
      expect(topic!.name).toBe('Thread Test');
      expect(topic!.telegramTopicId).toBe(999888);
    });

    test('returns undefined for non-existent thread ID', () => {
      const topic = manager.getTopicByThreadId('agent-123', 999999);
      expect(topic).toBeUndefined();
    });
  });

  describe('listTopics', () => {
    test('returns all topics for agent', async () => {
      await manager.createTopic({
        agentId: 'agent-list-123',
        chatId: 12345,
        name: 'Topic 1',
        type: 'session',
        skipTelegramCreation: true,
      });

      await manager.createTopic({
        agentId: 'agent-list-123',
        chatId: 12345,
        name: 'Topic 2',
        type: 'ralph',
        skipTelegramCreation: true,
      });

      const topics = manager.listTopics('agent-list-123');

      expect(topics).toHaveLength(2);
    });

    test('filters topics by status', async () => {
      // Create topics with different statuses
      const activeTopic = createMockTopic({
        id: 'active-1',
        agentId: 'agent-filter-123',
        status: 'active',
      });
      const closedTopic = createMockTopic({
        id: 'closed-1',
        agentId: 'agent-filter-123',
        status: 'closed',
      });

      persistence.saveTopics('agent-filter-123', undefined, [activeTopic, closedTopic]);

      const activeTopics = manager.listTopics('agent-filter-123', { status: 'active' });
      const closedTopics = manager.listTopics('agent-filter-123', { status: 'closed' });

      expect(activeTopics).toHaveLength(1);
      expect(activeTopics[0].status).toBe('active');
      expect(closedTopics).toHaveLength(1);
      expect(closedTopics[0].status).toBe('closed');
    });

    test('returns empty array for non-existent agent', () => {
      const topics = manager.listTopics('non-existent-agent');
      expect(topics).toHaveLength(0);
    });
  });

  describe('closeTopic', () => {
    test('closes an active topic', async () => {
      const mockTopic = createMockTopic({
        id: 'close-me',
        agentId: 'agent-close-123',
        telegramTopicId: 0, // Skip Telegram API call
        status: 'active',
      });
      persistence.saveTopics('agent-close-123', undefined, [mockTopic]);

      const result = await manager.closeTopic('agent-close-123', 'close-me', 12345);

      expect(result).toBe(true);

      const topic = manager.getTopic('agent-close-123', 'close-me');
      expect(topic!.status).toBe('closed');
    });

    test('returns true for already closed topic', async () => {
      const mockTopic = createMockTopic({
        id: 'already-closed',
        agentId: 'agent-close-123',
        status: 'closed',
      });
      persistence.saveTopics('agent-close-123', undefined, [mockTopic]);

      const result = await manager.closeTopic('agent-close-123', 'already-closed', 12345);

      expect(result).toBe(true);
    });

    test('returns false for non-existent topic', async () => {
      const result = await manager.closeTopic('agent-123', 'non-existent', 12345);
      expect(result).toBe(false);
    });
  });

  describe('reopenTopic', () => {
    test('reopens a closed topic', async () => {
      const mockTopic = createMockTopic({
        id: 'reopen-me',
        agentId: 'agent-reopen-123',
        telegramTopicId: 0, // Skip Telegram API call
        status: 'closed',
      });
      persistence.saveTopics('agent-reopen-123', undefined, [mockTopic]);

      const result = await manager.reopenTopic('agent-reopen-123', 'reopen-me', 12345);

      expect(result).toBe(true);

      const topic = manager.getTopic('agent-reopen-123', 'reopen-me');
      expect(topic!.status).toBe('active');
    });

    test('returns true for already active topic', async () => {
      const mockTopic = createMockTopic({
        id: 'already-active',
        agentId: 'agent-reopen-123',
        status: 'active',
      });
      persistence.saveTopics('agent-reopen-123', undefined, [mockTopic]);

      const result = await manager.reopenTopic('agent-reopen-123', 'already-active', 12345);

      expect(result).toBe(true);
    });
  });

  describe('deleteTopic', () => {
    test('deletes topic from local storage', async () => {
      const mockTopic = createMockTopic({
        id: 'delete-me',
        agentId: 'agent-delete-123',
        telegramTopicId: 0, // Skip Telegram API call
      });
      persistence.saveTopics('agent-delete-123', undefined, [mockTopic]);

      const result = await manager.deleteTopic('agent-delete-123', 'delete-me', 12345, false);

      expect(result).toBe(true);

      const topic = manager.getTopic('agent-delete-123', 'delete-me');
      expect(topic).toBeUndefined();

      const topics = manager.listTopics('agent-delete-123');
      expect(topics).toHaveLength(0);
    });

    test('returns false for non-existent topic', async () => {
      const result = await manager.deleteTopic('agent-123', 'non-existent', 12345, false);
      expect(result).toBe(false);
    });
  });

  describe('updateTopicActivity', () => {
    test('updates lastActivity timestamp', async () => {
      const oldDate = new Date('2020-01-01');
      const mockTopic = createMockTopic({
        id: 'update-activity',
        agentId: 'agent-activity-123',
        lastActivity: oldDate,
      });
      persistence.saveTopics('agent-activity-123', undefined, [mockTopic]);

      manager.updateTopicActivity('agent-activity-123', 'update-activity');

      const topic = manager.getTopic('agent-activity-123', 'update-activity');
      expect(topic!.lastActivity.getTime()).toBeGreaterThan(oldDate.getTime());
    });

    test('does nothing for non-existent topic', () => {
      // Should not throw
      manager.updateTopicActivity('agent-123', 'non-existent');
    });
  });

  describe('updateTopicSession', () => {
    test('updates session ID', async () => {
      const mockTopic = createMockTopic({
        id: 'update-session',
        agentId: 'agent-session-123',
        sessionId: 'old-session',
      });
      persistence.saveTopics('agent-session-123', undefined, [mockTopic]);

      manager.updateTopicSession('agent-session-123', 'update-session', 'new-session-456');

      const topic = manager.getTopic('agent-session-123', 'update-session');
      expect(topic!.sessionId).toBe('new-session-456');
    });

    test('clears session ID when undefined', async () => {
      const mockTopic = createMockTopic({
        id: 'clear-session',
        agentId: 'agent-session-123',
        sessionId: 'old-session',
      });
      persistence.saveTopics('agent-session-123', undefined, [mockTopic]);

      manager.updateTopicSession('agent-session-123', 'clear-session', undefined);

      const topic = manager.getTopic('agent-session-123', 'clear-session');
      expect(topic!.sessionId).toBeUndefined();
    });
  });
});

describe('TopicManager - Main Session ID', () => {
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

  test('gets main session ID', () => {
    persistence.saveTopics('agent-main-123', 'main-session-xyz', []);

    const mainSessionId = manager.getMainSessionId('agent-main-123');
    expect(mainSessionId).toBe('main-session-xyz');
  });

  test('returns undefined for non-existent agent', () => {
    const mainSessionId = manager.getMainSessionId('non-existent');
    expect(mainSessionId).toBeUndefined();
  });

  test('sets main session ID', () => {
    persistence.saveTopics('agent-main-123', undefined, []);

    manager.setMainSessionId('agent-main-123', 'new-main-session');

    const mainSessionId = manager.getMainSessionId('agent-main-123');
    expect(mainSessionId).toBe('new-main-session');
  });

  test('preserves topics when setting main session ID', () => {
    const mockTopic = createMockTopic({ agentId: 'agent-preserve-123' });
    persistence.saveTopics('agent-preserve-123', 'old-session', [mockTopic]);

    manager.setMainSessionId('agent-preserve-123', 'new-session');

    const topics = manager.listTopics('agent-preserve-123');
    expect(topics).toHaveLength(1);
    expect(topics[0].id).toBe(mockTopic.id);
  });
});

describe('TopicManager - Cleanup', () => {
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

  test('lists agents with topics', async () => {
    await manager.createTopic({
      agentId: 'agent-1',
      chatId: 12345,
      name: 'Topic 1',
      type: 'session',
      skipTelegramCreation: true,
    });

    await manager.createTopic({
      agentId: 'agent-2',
      chatId: 12345,
      name: 'Topic 2',
      type: 'session',
      skipTelegramCreation: true,
    });

    const agentIds = manager.listAgentsWithTopics();

    expect(agentIds).toContain('agent-1');
    expect(agentIds).toContain('agent-2');
  });

  test('cleans up orphaned topic files', async () => {
    // Create topics for multiple agents
    await manager.createTopic({
      agentId: 'existing-agent',
      chatId: 12345,
      name: 'Topic 1',
      type: 'session',
      skipTelegramCreation: true,
    });

    await manager.createTopic({
      agentId: 'orphaned-agent',
      chatId: 12345,
      name: 'Topic 2',
      type: 'session',
      skipTelegramCreation: true,
    });

    // Cleanup with only existing-agent in the list
    const deletedCount = manager.cleanupOrphanedTopics(['existing-agent']);

    expect(deletedCount).toBe(1);
    expect(manager.listTopics('existing-agent')).toHaveLength(1);
    expect(manager.listTopics('orphaned-agent')).toHaveLength(0);
  });
});

describe('TOPIC_COLORS', () => {
  test('has correct color values', () => {
    expect(TOPIC_COLORS.YELLOW).toBe(0xFFD67E);
    expect(TOPIC_COLORS.PURPLE).toBe(0xCB86DB);
    expect(TOPIC_COLORS.BLUE).toBe(0x6FB9F0);
    expect(TOPIC_COLORS.GREEN).toBe(0x8EEE98);
    expect(TOPIC_COLORS.PINK).toBe(0xFF93B2);
    expect(TOPIC_COLORS.RED).toBe(0xFB6F5F);
  });
});
