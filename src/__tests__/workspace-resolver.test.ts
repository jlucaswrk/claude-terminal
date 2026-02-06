// src/__tests__/workspace-resolver.test.ts
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmdirSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { resolveWorkspace, type WorkspaceResolution } from '../workspace-resolver';
import type { Agent, AgentTopic } from '../types';

// Test directory for workspace validation
const TEST_DIR = join(tmpdir(), 'workspace-resolver-test');

function createMockAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-uuid-1234',
    userId: 'user-phone-123',
    name: 'Test Agent',
    type: 'claude',
    mode: 'conversational',
    emoji: '🤖',
    workspace: undefined,
    modelMode: 'selection',
    topics: [],
    title: 'Test Agent',
    status: 'idle',
    statusDetails: 'Awaiting prompt',
    priority: 'medium',
    lastActivity: new Date(),
    messageCount: 0,
    outputs: [],
    createdAt: new Date(),
    ...overrides,
  };
}

function createMockTopic(overrides: Partial<AgentTopic> = {}): AgentTopic {
  return {
    id: 'topic-uuid-1234',
    agentId: 'agent-uuid-1234',
    telegramTopicId: 12345,
    type: 'session',
    name: 'Test Topic',
    emoji: '💬',
    status: 'active',
    messageCount: 0,
    createdAt: new Date(),
    lastActivity: new Date(),
    ...overrides,
  };
}

describe('WorkspaceResolver', () => {
  beforeEach(() => {
    // Create test directory
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up test directory
    if (existsSync(TEST_DIR)) {
      try {
        rmdirSync(TEST_DIR, { recursive: true });
      } catch {
        // ignore cleanup errors
      }
    }
  });

  describe('resolveWorkspace', () => {
    test('returns topic workspace when topic has valid workspace', () => {
      const agent = createMockAgent({ workspace: '/some/agent/path' });
      const topic = createMockTopic({ workspace: TEST_DIR });

      const result = resolveWorkspace(agent, topic);

      expect(result.workspace).toBe(TEST_DIR);
      expect(result.source).toBe('topic');
      expect(result.error).toBeUndefined();
    });

    test('returns error when topic workspace does not exist', () => {
      const agent = createMockAgent({ workspace: '/some/agent/path' });
      const nonExistentPath = join(TEST_DIR, 'non-existent-subdir-12345');
      const topic = createMockTopic({ workspace: nonExistentPath });

      const result = resolveWorkspace(agent, topic);

      expect(result.workspace).toBeUndefined();
      expect(result.source).toBe('topic');
      expect(result.error).toBe('workspace_not_found');
    });

    test('returns agent workspace when topic has no workspace', () => {
      const agentWorkspace = '/some/agent/path';
      const agent = createMockAgent({ workspace: agentWorkspace });
      const topic = createMockTopic({ workspace: undefined });

      const result = resolveWorkspace(agent, topic);

      expect(result.workspace).toBe(agentWorkspace);
      expect(result.source).toBe('agent');
      expect(result.error).toBeUndefined();
    });

    test('returns agent workspace when no topic provided', () => {
      const agentWorkspace = '/some/agent/path';
      const agent = createMockAgent({ workspace: agentWorkspace });

      const result = resolveWorkspace(agent, undefined);

      expect(result.workspace).toBe(agentWorkspace);
      expect(result.source).toBe('agent');
      expect(result.error).toBeUndefined();
    });

    test('returns sandbox when neither topic nor agent have workspace', () => {
      const agent = createMockAgent({ workspace: undefined });
      const topic = createMockTopic({ workspace: undefined });

      const result = resolveWorkspace(agent, topic);

      expect(result.workspace).toBeUndefined();
      expect(result.source).toBe('sandbox');
      expect(result.error).toBeUndefined();
    });

    test('returns sandbox when no topic provided and agent has no workspace', () => {
      const agent = createMockAgent({ workspace: undefined });

      const result = resolveWorkspace(agent, undefined);

      expect(result.workspace).toBeUndefined();
      expect(result.source).toBe('sandbox');
      expect(result.error).toBeUndefined();
    });

    test('topic workspace takes priority over agent workspace', () => {
      const agent = createMockAgent({ workspace: '/agent/workspace' });
      const topic = createMockTopic({ workspace: TEST_DIR });

      const result = resolveWorkspace(agent, topic);

      expect(result.workspace).toBe(TEST_DIR);
      expect(result.source).toBe('topic');
    });

    test('returns error when topic workspace points to a file, not a directory', () => {
      const filePath = join(TEST_DIR, 'some-file.txt');
      writeFileSync(filePath, 'test content');

      const agent = createMockAgent({ workspace: '/some/agent/path' });
      const topic = createMockTopic({ workspace: filePath });

      const result = resolveWorkspace(agent, topic);

      expect(result.workspace).toBeUndefined();
      expect(result.source).toBe('topic');
      expect(result.error).toBe('workspace_not_found');
    });

    test('accepts only directories, not files, as valid topic workspace', () => {
      const subDir = join(TEST_DIR, 'valid-subdir');
      mkdirSync(subDir, { recursive: true });

      const agent = createMockAgent({ workspace: undefined });
      const topic = createMockTopic({ workspace: subDir });

      const result = resolveWorkspace(agent, topic);

      expect(result.workspace).toBe(subDir);
      expect(result.source).toBe('topic');
      expect(result.error).toBeUndefined();
    });

    test('sandbox sentinel bypasses agent workspace', () => {
      const agent = createMockAgent({ workspace: '/some/agent/path' });
      const topic = createMockTopic({ workspace: 'sandbox' });

      const result = resolveWorkspace(agent, topic);

      expect(result.workspace).toBeUndefined();
      expect(result.source).toBe('sandbox');
      expect(result.error).toBeUndefined();
    });

    test('handles topic with empty string workspace (treated as falsy, falls through)', () => {
      const agentWorkspace = '/some/agent/path';
      const agent = createMockAgent({ workspace: agentWorkspace });
      const topic = createMockTopic({ workspace: '' });

      const result = resolveWorkspace(agent, topic);

      // Empty string is falsy, so should fall through to agent workspace
      expect(result.workspace).toBe(agentWorkspace);
      expect(result.source).toBe('agent');
    });
  });
});
