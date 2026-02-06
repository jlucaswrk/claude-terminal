import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, unlinkSync, readFileSync, mkdirSync, rmdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { PersistenceService } from '../persistence';
import type { Agent, AgentTopic, SystemConfig, TopicType, TopicStatus } from '../types';
import { DEFAULTS } from '../types';

const TEST_STATE_FILE = './test-topics-agents-state.json';
const TEST_LOOPS_DIR = './test-topics-loops';
const TEST_PREFS_FILE = './test-topics-preferences.json';
const TEST_TOPICS_DIR = './test-data-topics';

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

function createMockAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-uuid-1234',
    userId: 'user-123',
    name: 'Test Agent',
    type: 'claude',
    mode: 'conversational',
    emoji: '🤖',
    workspace: '/test/workspace',
    modelMode: 'selection',
    mainSessionId: 'main-session-123',
    topics: [],
    title: 'Test conversation',
    status: 'idle',
    statusDetails: 'Ready',
    priority: 'medium',
    lastActivity: new Date('2024-01-15T10:00:00.000Z'),
    messageCount: 5,
    outputs: [],
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function createMockConfig(): SystemConfig {
  return {
    maxConcurrent: 3,
    version: DEFAULTS.SCHEMA_VERSION,
  };
}

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

describe('PersistenceService - Topics', () => {
  let service: PersistenceService;

  beforeEach(() => {
    cleanup();
    service = new PersistenceService(TEST_STATE_FILE, TEST_LOOPS_DIR, TEST_PREFS_FILE, TEST_TOPICS_DIR);
  });

  afterEach(() => {
    cleanup();
  });

  describe('Topic Serialization', () => {
    test('serializes topic with all fields', () => {
      const topic = createMockTopic();
      const serialized = service.serializeTopic(topic);

      expect(serialized.id).toBe('topic-uuid-1234');
      expect(serialized.agentId).toBe('agent-uuid-1234');
      expect(serialized.telegramTopicId).toBe(123456);
      expect(serialized.type).toBe('session');
      expect(serialized.name).toBe('Test Topic');
      expect(serialized.emoji).toBe('💬');
      expect(serialized.sessionId).toBe('session-isolated-123');
      expect(serialized.status).toBe('active');
      expect(serialized.createdAt).toBe('2024-01-15T10:00:00.000Z');
      expect(serialized.lastActivity).toBe('2024-01-15T12:00:00.000Z');
    });

    test('serializes topic without optional sessionId', () => {
      const topic = createMockTopic({ sessionId: undefined, type: 'general' });
      const serialized = service.serializeTopic(topic);

      expect(serialized.sessionId).toBeUndefined();
      expect(serialized.type).toBe('general');
    });

    test('serializes ralph topic with loopId', () => {
      const topic = createMockTopic({
        type: 'ralph',
        emoji: '🔄',
        loopId: 'loop-123',
      });
      const serialized = service.serializeTopic(topic);

      expect(serialized.type).toBe('ralph');
      expect(serialized.loopId).toBe('loop-123');
    });
  });

  describe('Topic Deserialization', () => {
    test('deserializes topic with all fields', () => {
      const serialized = {
        id: 'topic-uuid-1234',
        agentId: 'agent-uuid-1234',
        telegramTopicId: 123456,
        type: 'session' as TopicType,
        name: 'Test Topic',
        emoji: '💬',
        sessionId: 'session-isolated-123',
        status: 'active' as TopicStatus,
        createdAt: '2024-01-15T10:00:00.000Z',
        lastActivity: '2024-01-15T12:00:00.000Z',
      };

      const topic = service.deserializeTopic(serialized);

      expect(topic.id).toBe('topic-uuid-1234');
      expect(topic.telegramTopicId).toBe(123456);
      expect(topic.createdAt).toBeInstanceOf(Date);
      expect(topic.lastActivity).toBeInstanceOf(Date);
      expect(topic.createdAt.toISOString()).toBe('2024-01-15T10:00:00.000Z');
    });

    test('deserializes worktree topic', () => {
      const serialized = {
        id: 'worktree-uuid',
        agentId: 'agent-uuid',
        telegramTopicId: 789,
        type: 'worktree' as TopicType,
        name: 'feature/payments',
        emoji: '🌿',
        sessionId: 'worktree-session',
        status: 'active' as TopicStatus,
        createdAt: '2024-02-01T00:00:00.000Z',
        lastActivity: '2024-02-01T00:00:00.000Z',
      };

      const topic = service.deserializeTopic(serialized);

      expect(topic.type).toBe('worktree');
      expect(topic.name).toBe('feature/payments');
      expect(topic.emoji).toBe('🌿');
    });
  });

  describe('saveTopics and loadTopics', () => {
    test('saves and loads topics for agent', () => {
      const agentId = 'test-agent-123';
      const mainSessionId = 'main-session-456';
      const topics = [
        createMockTopic({ id: 'topic-1', agentId }),
        createMockTopic({ id: 'topic-2', agentId, type: 'ralph', emoji: '🔄' }),
      ];

      service.saveTopics(agentId, mainSessionId, topics);

      const loaded = service.loadTopics(agentId);

      expect(loaded).not.toBeNull();
      expect(loaded!.agentId).toBe(agentId);
      expect(loaded!.mainSessionId).toBe(mainSessionId);
      expect(loaded!.topics).toHaveLength(2);
      expect(loaded!.topics[0].id).toBe('topic-1');
      expect(loaded!.topics[1].id).toBe('topic-2');
      expect(loaded!.topics[1].type).toBe('ralph');
    });

    test('saves topics without mainSessionId', () => {
      const agentId = 'test-agent-no-session';
      const topics = [createMockTopic({ agentId })];

      service.saveTopics(agentId, undefined, topics);

      const loaded = service.loadTopics(agentId);

      expect(loaded).not.toBeNull();
      expect(loaded!.mainSessionId).toBeUndefined();
    });

    test('returns null for non-existent agent', () => {
      const loaded = service.loadTopics('non-existent-agent');
      expect(loaded).toBeNull();
    });

    test('creates topics directory if it does not exist', () => {
      // Remove directory first
      if (existsSync(TEST_TOPICS_DIR)) {
        rmdirSync(TEST_TOPICS_DIR);
      }

      const agentId = 'test-agent';
      service.saveTopics(agentId, 'session-123', []);

      expect(existsSync(TEST_TOPICS_DIR)).toBe(true);
    });
  });

  describe('deleteTopicsFile', () => {
    test('deletes existing topics file', () => {
      const agentId = 'agent-to-delete';
      service.saveTopics(agentId, 'session', [createMockTopic({ agentId })]);

      const filePath = join(TEST_TOPICS_DIR, `${agentId}.json`);
      expect(existsSync(filePath)).toBe(true);

      const result = service.deleteTopicsFile(agentId);

      expect(result).toBe(true);
      expect(existsSync(filePath)).toBe(false);
    });

    test('returns false for non-existent file', () => {
      const result = service.deleteTopicsFile('non-existent');
      expect(result).toBe(false);
    });
  });

  describe('listTopicsFiles', () => {
    test('lists all agent IDs with topics files', () => {
      service.saveTopics('agent-1', 'session-1', []);
      service.saveTopics('agent-2', 'session-2', []);
      service.saveTopics('agent-3', 'session-3', []);

      const agentIds = service.listTopicsFiles();

      expect(agentIds).toHaveLength(3);
      expect(agentIds).toContain('agent-1');
      expect(agentIds).toContain('agent-2');
      expect(agentIds).toContain('agent-3');
    });

    test('returns empty array when no topics files exist', () => {
      const agentIds = service.listTopicsFiles();
      expect(agentIds).toHaveLength(0);
    });
  });

  describe('loadAllTopics', () => {
    test('loads all topics files', () => {
      const topic1 = createMockTopic({ id: 'topic-1', agentId: 'agent-1' });
      const topic2 = createMockTopic({ id: 'topic-2', agentId: 'agent-2' });

      service.saveTopics('agent-1', 'session-1', [topic1]);
      service.saveTopics('agent-2', 'session-2', [topic2]);

      const allTopics = service.loadAllTopics();

      expect(allTopics).toHaveLength(2);
    });
  });

  describe('cleanupOrphanedTopics', () => {
    test('deletes topics files for non-existent agents', () => {
      service.saveTopics('existing-agent', 'session', []);
      service.saveTopics('orphaned-agent', 'session', []);

      const deletedCount = service.cleanupOrphanedTopics(['existing-agent']);

      expect(deletedCount).toBe(1);
      expect(service.loadTopics('existing-agent')).not.toBeNull();
      expect(service.loadTopics('orphaned-agent')).toBeNull();
    });

    test('returns 0 when no orphaned files', () => {
      service.saveTopics('agent-1', 'session', []);
      service.saveTopics('agent-2', 'session', []);

      const deletedCount = service.cleanupOrphanedTopics(['agent-1', 'agent-2']);

      expect(deletedCount).toBe(0);
    });
  });

  describe('getTopicsForAgent', () => {
    test('returns topics for agent', () => {
      const agentId = 'test-agent';
      const topics = [
        createMockTopic({ id: 'topic-1', agentId }),
        createMockTopic({ id: 'topic-2', agentId }),
      ];

      service.saveTopics(agentId, 'session', topics);

      const result = service.getTopicsForAgent(agentId);

      expect(result).toHaveLength(2);
    });

    test('returns empty array for agent without topics', () => {
      const result = service.getTopicsForAgent('non-existent');
      expect(result).toHaveLength(0);
    });
  });

  describe('getActiveTopicsForAgent', () => {
    test('returns only active topics', () => {
      const agentId = 'test-agent';
      const topics = [
        createMockTopic({ id: 'topic-1', agentId, status: 'active' }),
        createMockTopic({ id: 'topic-2', agentId, status: 'closed' }),
        createMockTopic({ id: 'topic-3', agentId, status: 'active' }),
      ];

      service.saveTopics(agentId, 'session', topics);

      const result = service.getActiveTopicsForAgent(agentId);

      expect(result).toHaveLength(2);
      expect(result.every(t => t.status === 'active')).toBe(true);
    });
  });

  describe('Topics schema validation', () => {
    test('rejects topics file with invalid type', () => {
      const agentId = 'invalid-type-agent';
      const filePath = join(TEST_TOPICS_DIR, `${agentId}.json`);

      mkdirSync(TEST_TOPICS_DIR, { recursive: true });
      Bun.write(filePath, JSON.stringify({
        agentId,
        mainSessionId: 'session',
        topics: [{
          id: 'topic-1',
          agentId,
          telegramTopicId: 123,
          type: 'invalid_type',  // Invalid
          name: 'Test',
          emoji: '💬',
          status: 'active',
          createdAt: '2024-01-01T00:00:00.000Z',
          lastActivity: '2024-01-01T00:00:00.000Z',
        }],
      }));

      const loaded = service.loadTopics(agentId);
      expect(loaded).toBeNull();
    });

    test('rejects topics file with invalid status', () => {
      const agentId = 'invalid-status-agent';
      const filePath = join(TEST_TOPICS_DIR, `${agentId}.json`);

      mkdirSync(TEST_TOPICS_DIR, { recursive: true });
      Bun.write(filePath, JSON.stringify({
        agentId,
        mainSessionId: 'session',
        topics: [{
          id: 'topic-1',
          agentId,
          telegramTopicId: 123,
          type: 'session',
          name: 'Test',
          emoji: '💬',
          status: 'invalid_status',  // Invalid
          createdAt: '2024-01-01T00:00:00.000Z',
          lastActivity: '2024-01-01T00:00:00.000Z',
        }],
      }));

      const loaded = service.loadTopics(agentId);
      expect(loaded).toBeNull();
    });

    test('rejects topics file with missing required fields', () => {
      const agentId = 'missing-fields-agent';
      const filePath = join(TEST_TOPICS_DIR, `${agentId}.json`);

      mkdirSync(TEST_TOPICS_DIR, { recursive: true });
      Bun.write(filePath, JSON.stringify({
        agentId,
        topics: [{
          id: 'topic-1',
          // Missing required fields
        }],
      }));

      const loaded = service.loadTopics(agentId);
      expect(loaded).toBeNull();
    });

    test('accepts valid topics file with all topic types', () => {
      const agentId = 'valid-all-types';
      const topicTypes: TopicType[] = ['general', 'ralph', 'worktree', 'session'];

      const topics = topicTypes.map((type, i) => createMockTopic({
        id: `topic-${i}`,
        agentId,
        type,
      }));

      service.saveTopics(agentId, 'session', topics);
      const loaded = service.loadTopics(agentId);

      expect(loaded).not.toBeNull();
      expect(loaded!.topics).toHaveLength(4);
    });
  });

  describe('getTopicsDir', () => {
    test('returns correct topics directory path', () => {
      expect(service.getTopicsDir()).toBe(TEST_TOPICS_DIR);
    });
  });
});

describe('PersistenceService - Agent with Topics', () => {
  let service: PersistenceService;

  beforeEach(() => {
    cleanup();
    service = new PersistenceService(TEST_STATE_FILE, TEST_LOOPS_DIR, TEST_PREFS_FILE, TEST_TOPICS_DIR);
  });

  afterEach(() => {
    cleanup();
  });

  describe('Agent serialization with topics', () => {
    test('saves and loads agent with topics', () => {
      const config = createMockConfig();
      const topic = createMockTopic();
      const agent = createMockAgent({
        topics: [topic],
      });

      service.save({ config, agents: [agent] });

      const loaded = service.load();

      expect(loaded).not.toBeNull();
      expect(loaded!.agents).toHaveLength(1);
      expect(loaded!.agents[0].topics).toHaveLength(1);
      expect(loaded!.agents[0].topics[0].id).toBe('topic-uuid-1234');
      expect(loaded!.agents[0].topics[0].createdAt).toBeInstanceOf(Date);
    });

    test('saves and loads agent with mainSessionId', () => {
      const config = createMockConfig();
      const agent = createMockAgent({
        mainSessionId: 'main-session-xyz',
      });

      service.save({ config, agents: [agent] });

      const loaded = service.load();

      expect(loaded).not.toBeNull();
      expect(loaded!.agents[0].mainSessionId).toBe('main-session-xyz');
    });

    test('handles agent without mainSessionId (migration case)', () => {
      const config = createMockConfig();
      const agent = createMockAgent({
        mainSessionId: undefined,
      });

      service.save({ config, agents: [agent] });

      const loaded = service.load();

      expect(loaded).not.toBeNull();
      expect(loaded!.agents[0].mainSessionId).toBeUndefined();
    });
  });

  describe('Migration from sessionId to mainSessionId', () => {
    test('detects agents needing migration', () => {
      // Simulate old format with sessionId
      const oldFormatState = {
        version: DEFAULTS.SCHEMA_VERSION,
        config: createMockConfig(),
        agents: [{
          id: 'old-agent',
          userId: 'user-123',
          name: 'Old Agent',
          type: 'claude',
          mode: 'conversational',
          modelMode: 'selection',
          sessionId: 'old-session-123',  // Old format
          // No mainSessionId
          // No topics
          title: 'Old conversation',
          status: 'idle',
          statusDetails: 'Ready',
          priority: 'medium',
          lastActivity: '2024-01-01T00:00:00.000Z',
          messageCount: 0,
          outputs: [],
          createdAt: '2024-01-01T00:00:00.000Z',
        }],
      };

      Bun.write(TEST_STATE_FILE, JSON.stringify(oldFormatState, null, 2));

      const loaded = service.load();

      expect(loaded).not.toBeNull();
      expect(loaded!.migratedAgents).toHaveLength(1);
      expect(loaded!.migratedAgents[0]).toBe('old-agent');
      expect(loaded!.agents[0].topics).toHaveLength(0);  // Empty topics array
    });

    test('does not flag agents with mainSessionId as needing migration', () => {
      const config = createMockConfig();
      const agent = createMockAgent({
        mainSessionId: 'existing-main-session',
      });

      service.save({ config, agents: [agent] });

      const loaded = service.load();

      expect(loaded).not.toBeNull();
      expect(loaded!.migratedAgents).toHaveLength(0);
    });

    test('loadAndMigrate saves migrated state', () => {
      // Create old format state
      const oldFormatState = {
        version: DEFAULTS.SCHEMA_VERSION,
        config: createMockConfig(),
        agents: [{
          id: 'migrate-me',
          userId: 'user-123',
          name: 'Migrate Me',
          type: 'claude',
          mode: 'conversational',
          modelMode: 'selection',
          sessionId: 'old-session',  // Old format
          title: 'Test',
          status: 'idle',
          statusDetails: 'Ready',
          priority: 'medium',
          lastActivity: '2024-01-01T00:00:00.000Z',
          messageCount: 0,
          outputs: [],
          createdAt: '2024-01-01T00:00:00.000Z',
        }],
      };

      Bun.write(TEST_STATE_FILE, JSON.stringify(oldFormatState, null, 2));

      const result = service.loadAndMigrate();

      expect(result).not.toBeNull();
      expect(result!.agents[0].topics).toHaveLength(0);

      // Verify state was saved
      const reloaded = service.load();
      expect(reloaded).not.toBeNull();
      expect(reloaded!.agents[0].topics).toHaveLength(0);
    });
  });
});

describe('PersistenceService - RalphLoopState with threadId', () => {
  let service: PersistenceService;

  beforeEach(() => {
    cleanup();
    service = new PersistenceService(TEST_STATE_FILE, TEST_LOOPS_DIR, TEST_PREFS_FILE, TEST_TOPICS_DIR);
  });

  afterEach(() => {
    cleanup();
  });

  test('saves and loads loop with threadId', () => {
    const loop = {
      id: 'loop-123',
      agentId: 'agent-123',
      userId: 'user-123',
      status: 'running' as const,
      task: 'Test task',
      currentIteration: 1,
      maxIterations: 10,
      iterations: [],
      currentModel: 'sonnet' as const,
      startTime: new Date('2024-01-15T10:00:00.000Z'),
      threadId: 456789,  // Telegram topic thread ID
    };

    service.saveLoop(loop);

    const loaded = service.loadLoop('loop-123');

    expect(loaded).not.toBeNull();
    expect(loaded!.threadId).toBe(456789);
  });

  test('saves and loads loop without threadId', () => {
    const loop = {
      id: 'loop-no-thread',
      agentId: 'agent-123',
      userId: 'user-123',
      status: 'running' as const,
      task: 'Test task',
      currentIteration: 1,
      maxIterations: 10,
      iterations: [],
      currentModel: 'sonnet' as const,
      startTime: new Date('2024-01-15T10:00:00.000Z'),
      // No threadId
    };

    service.saveLoop(loop);

    const loaded = service.loadLoop('loop-no-thread');

    expect(loaded).not.toBeNull();
    expect(loaded!.threadId).toBeUndefined();
  });
});
