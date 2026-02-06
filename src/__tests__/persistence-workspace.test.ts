// src/__tests__/persistence-workspace.test.ts
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, unlinkSync, mkdirSync, rmdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { PersistenceService } from '../persistence';
import type { AgentTopic, UserPreferences } from '../types';

const TEST_STATE_FILE = './test-ws-persistence-state.json';
const TEST_LOOPS_DIR = './test-ws-persistence-loops';
const TEST_PREFS_FILE = './test-ws-persistence-preferences.json';
const TEST_TOPICS_DIR = './test-ws-persistence-topics';

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
}

describe('PersistenceService - Workspace Features', () => {
  let persistence: PersistenceService;

  beforeEach(() => {
    cleanup();
    persistence = new PersistenceService(
      TEST_STATE_FILE,
      TEST_LOOPS_DIR,
      TEST_PREFS_FILE,
      TEST_TOPICS_DIR
    );
  });

  afterEach(() => {
    cleanup();
  });

  describe('Recent Workspaces', () => {
    const userId = 'user-123';

    test('addRecentWorkspace adds workspace to empty list', () => {
      // Setup user preferences
      persistence.saveUserPreferences({
        userId,
        mode: 'dojo',
        onboardingComplete: true,
      });

      persistence.addRecentWorkspace(userId, '/path/to/project');

      const recent = persistence.getRecentWorkspaces(userId);
      expect(recent).toEqual(['/path/to/project']);
    });

    test('addRecentWorkspace puts most recent first', () => {
      persistence.saveUserPreferences({
        userId,
        mode: 'dojo',
        onboardingComplete: true,
      });

      persistence.addRecentWorkspace(userId, '/path/a');
      persistence.addRecentWorkspace(userId, '/path/b');
      persistence.addRecentWorkspace(userId, '/path/c');

      const recent = persistence.getRecentWorkspaces(userId);
      expect(recent).toEqual(['/path/c', '/path/b', '/path/a']);
    });

    test('addRecentWorkspace deduplicates entries', () => {
      persistence.saveUserPreferences({
        userId,
        mode: 'dojo',
        onboardingComplete: true,
      });

      persistence.addRecentWorkspace(userId, '/path/a');
      persistence.addRecentWorkspace(userId, '/path/b');
      persistence.addRecentWorkspace(userId, '/path/a'); // duplicate

      const recent = persistence.getRecentWorkspaces(userId);
      expect(recent).toEqual(['/path/a', '/path/b']);
    });

    test('addRecentWorkspace limits to 5 entries', () => {
      persistence.saveUserPreferences({
        userId,
        mode: 'dojo',
        onboardingComplete: true,
      });

      persistence.addRecentWorkspace(userId, '/path/1');
      persistence.addRecentWorkspace(userId, '/path/2');
      persistence.addRecentWorkspace(userId, '/path/3');
      persistence.addRecentWorkspace(userId, '/path/4');
      persistence.addRecentWorkspace(userId, '/path/5');
      persistence.addRecentWorkspace(userId, '/path/6');

      const recent = persistence.getRecentWorkspaces(userId);
      expect(recent).toHaveLength(5);
      expect(recent[0]).toBe('/path/6');
      expect(recent[4]).toBe('/path/2');
      // /path/1 should have been dropped
      expect(recent).not.toContain('/path/1');
    });

    test('getRecentWorkspaces returns empty array for unknown user', () => {
      const recent = persistence.getRecentWorkspaces('unknown-user');
      expect(recent).toEqual([]);
    });

    test('getRecentWorkspaces returns empty array when no recent workspaces', () => {
      persistence.saveUserPreferences({
        userId,
        mode: 'dojo',
        onboardingComplete: true,
      });

      const recent = persistence.getRecentWorkspaces(userId);
      expect(recent).toEqual([]);
    });

    test('recent workspaces survive reload', () => {
      persistence.saveUserPreferences({
        userId,
        mode: 'dojo',
        onboardingComplete: true,
      });

      persistence.addRecentWorkspace(userId, '/path/a');
      persistence.addRecentWorkspace(userId, '/path/b');

      // Create a new persistence instance (simulating restart)
      const persistence2 = new PersistenceService(
        TEST_STATE_FILE,
        TEST_LOOPS_DIR,
        TEST_PREFS_FILE,
        TEST_TOPICS_DIR
      );

      const recent = persistence2.getRecentWorkspaces(userId);
      expect(recent).toEqual(['/path/b', '/path/a']);
    });
  });

  describe('Topic Workspace Serialization', () => {
    test('serializeTopic preserves workspace field', () => {
      const topic: AgentTopic = {
        id: 'topic-1',
        agentId: 'agent-1',
        telegramTopicId: 123,
        type: 'session',
        name: 'Test',
        emoji: '💬',
        workspace: '/path/to/workspace',
        status: 'active',
        messageCount: 5,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        lastActivity: new Date('2024-01-01T12:00:00Z'),
      };

      const serialized = persistence.serializeTopic(topic);
      expect(serialized.workspace).toBe('/path/to/workspace');

      const deserialized = persistence.deserializeTopic(serialized);
      expect(deserialized.workspace).toBe('/path/to/workspace');
    });

    test('serializeTopic handles undefined workspace', () => {
      const topic: AgentTopic = {
        id: 'topic-1',
        agentId: 'agent-1',
        telegramTopicId: 123,
        type: 'session',
        name: 'Test',
        emoji: '💬',
        status: 'active',
        messageCount: 5,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        lastActivity: new Date('2024-01-01T12:00:00Z'),
      };

      const serialized = persistence.serializeTopic(topic);
      expect(serialized.workspace).toBeUndefined();

      const deserialized = persistence.deserializeTopic(serialized);
      expect(deserialized.workspace).toBeUndefined();
    });

    test('workspace is persisted and loaded from topics file', () => {
      const topic: AgentTopic = {
        id: 'topic-1',
        agentId: 'agent-ws-test',
        telegramTopicId: 123,
        type: 'worktree',
        name: 'Feature',
        emoji: '🌿',
        workspace: '/path/to/feature',
        status: 'active',
        messageCount: 0,
        createdAt: new Date('2024-01-01T00:00:00Z'),
        lastActivity: new Date('2024-01-01T00:00:00Z'),
      };

      persistence.saveTopics('agent-ws-test', undefined, [topic]);

      const loaded = persistence.loadTopics('agent-ws-test');
      expect(loaded).not.toBeNull();
      expect(loaded!.topics[0].workspace).toBe('/path/to/feature');
    });

    test('backward compatible - topics without workspace field load correctly', () => {
      // Simulate a topics file from before workspace field was added
      const topicsFileContent = JSON.stringify({
        agentId: 'agent-legacy',
        topics: [{
          id: 'topic-old',
          agentId: 'agent-legacy',
          telegramTopicId: 456,
          type: 'session',
          name: 'Old Topic',
          emoji: '💬',
          status: 'active',
          messageCount: 10,
          createdAt: '2024-01-01T00:00:00.000Z',
          lastActivity: '2024-01-01T12:00:00.000Z',
          // No workspace field
        }],
      });

      // Write the file manually
      const filePath = join(TEST_TOPICS_DIR, 'agent-legacy.json');
      Bun.write(filePath, topicsFileContent);

      const loaded = persistence.loadTopics('agent-legacy');
      expect(loaded).not.toBeNull();
      expect(loaded!.topics[0].workspace).toBeUndefined();
      expect(loaded!.topics[0].name).toBe('Old Topic');
    });
  });
});
