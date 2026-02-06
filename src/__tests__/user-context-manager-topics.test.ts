// src/__tests__/user-context-manager-topics.test.ts
/**
 * Tests for UserContextManager topic flow methods
 *
 * Tests cover:
 * - Topic Ralph flow (task and iterations)
 * - Topic Worktree flow (name)
 * - Topic Sessao flow (name)
 * - Flow state transitions
 * - Workspace step during topic creation (awaiting_topic_workspace)
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { UserContextManager } from '../user-context-manager';

describe('UserContextManager - Topic Flows', () => {
  let manager: UserContextManager;

  beforeEach(() => {
    manager = new UserContextManager();
  });

  describe('Topic Ralph Flow', () => {
    test('startTopicRalphFlow without task sets awaiting_topic_task state', () => {
      manager.startTopicRalphFlow('user-123', 'agent-456', 12345);

      expect(manager.isInTopicRalphFlow('user-123')).toBe(true);
      expect(manager.isAwaitingTopicTask('user-123')).toBe(true);
      expect(manager.isAwaitingTopicIterations('user-123')).toBe(false);

      const data = manager.getTopicRalphData('user-123');
      expect(data?.agentId).toBe('agent-456');
      expect(data?.telegramChatId).toBe(12345);
      expect(data?.topicTask).toBeUndefined();
    });

    test('startTopicRalphFlow with task sets awaiting_topic_iterations state', () => {
      manager.startTopicRalphFlow('user-123', 'agent-456', 12345, 'Fix the bug');

      expect(manager.isInTopicRalphFlow('user-123')).toBe(true);
      expect(manager.isAwaitingTopicTask('user-123')).toBe(false);
      expect(manager.isAwaitingTopicIterations('user-123')).toBe(true);

      const data = manager.getTopicRalphData('user-123');
      expect(data?.topicTask).toBe('Fix the bug');
    });

    test('setTopicTask transitions to awaiting_topic_iterations', () => {
      manager.startTopicRalphFlow('user-123', 'agent-456', 12345);
      manager.setTopicTask('user-123', 'Build a new feature');

      expect(manager.isAwaitingTopicTask('user-123')).toBe(false);
      expect(manager.isAwaitingTopicIterations('user-123')).toBe(true);

      const data = manager.getTopicRalphData('user-123');
      expect(data?.topicTask).toBe('Build a new feature');
    });

    test('setTopicMaxIterations stores iterations', () => {
      manager.startTopicRalphFlow('user-123', 'agent-456', 12345, 'Task');
      manager.setTopicMaxIterations('user-123', 20);

      const data = manager.getTopicRalphData('user-123');
      expect(data?.topicMaxIterations).toBe(20);
    });

    test('setTopicTask throws when not in Ralph flow', () => {
      expect(() => manager.setTopicTask('user-123', 'Task')).toThrow('Not in topic Ralph flow');
    });

    test('setTopicMaxIterations throws when not in Ralph flow', () => {
      expect(() => manager.setTopicMaxIterations('user-123', 10)).toThrow('Not in topic Ralph flow');
    });

    test('getTopicRalphData returns undefined when not in Ralph flow', () => {
      const data = manager.getTopicRalphData('user-123');
      expect(data).toBeUndefined();
    });
  });

  describe('Topic Worktree Flow', () => {
    test('startTopicWorktreeFlow without name sets awaiting_topic_name state', () => {
      manager.startTopicWorktreeFlow('user-123', 'agent-456', 12345);

      expect(manager.isInTopicWorktreeFlow('user-123')).toBe(true);
      expect(manager.isAwaitingTopicName('user-123')).toBe(true);

      const data = manager.getTopicCreationData('user-123');
      expect(data?.agentId).toBe('agent-456');
      expect(data?.telegramChatId).toBe(12345);
      expect(data?.topicName).toBeUndefined();
      expect(data?.flowType).toBe('topic_worktree');
    });

    test('startTopicWorktreeFlow with name completes immediately', () => {
      manager.startTopicWorktreeFlow('user-123', 'agent-456', 12345, 'feature/auth');

      expect(manager.isInTopicWorktreeFlow('user-123')).toBe(true);
      expect(manager.isAwaitingTopicName('user-123')).toBe(false);

      const data = manager.getTopicCreationData('user-123');
      expect(data?.topicName).toBe('feature/auth');
    });

    test('setTopicName stores name and clears flowState', () => {
      manager.startTopicWorktreeFlow('user-123', 'agent-456', 12345);
      manager.setTopicName('user-123', 'feature/payments');

      expect(manager.isAwaitingTopicName('user-123')).toBe(false);

      const data = manager.getTopicCreationData('user-123');
      expect(data?.topicName).toBe('feature/payments');
    });
  });

  describe('Topic Sessao Flow', () => {
    test('startTopicSessaoFlow without name sets awaiting_topic_name state', () => {
      manager.startTopicSessaoFlow('user-123', 'agent-456', 12345);

      expect(manager.isInTopicSessaoFlow('user-123')).toBe(true);
      expect(manager.isAwaitingTopicName('user-123')).toBe(true);

      const data = manager.getTopicCreationData('user-123');
      expect(data?.flowType).toBe('topic_sessao');
    });

    test('startTopicSessaoFlow with name completes immediately', () => {
      manager.startTopicSessaoFlow('user-123', 'agent-456', 12345, 'Debug session');

      expect(manager.isInTopicSessaoFlow('user-123')).toBe(true);
      expect(manager.isAwaitingTopicName('user-123')).toBe(false);

      const data = manager.getTopicCreationData('user-123');
      expect(data?.topicName).toBe('Debug session');
    });
  });

  describe('isInTopicFlow helper', () => {
    test('returns true for Ralph flow', () => {
      manager.startTopicRalphFlow('user-123', 'agent-456', 12345);
      expect(manager.isInTopicFlow('user-123')).toBe(true);
    });

    test('returns true for Worktree flow', () => {
      manager.startTopicWorktreeFlow('user-123', 'agent-456', 12345);
      expect(manager.isInTopicFlow('user-123')).toBe(true);
    });

    test('returns true for Sessao flow', () => {
      manager.startTopicSessaoFlow('user-123', 'agent-456', 12345);
      expect(manager.isInTopicFlow('user-123')).toBe(true);
    });

    test('returns false when no flow active', () => {
      expect(manager.isInTopicFlow('user-123')).toBe(false);
    });
  });

  describe('setTopicName validation', () => {
    test('throws when not in worktree or sessao flow', () => {
      manager.startTopicRalphFlow('user-123', 'agent-456', 12345);
      expect(() => manager.setTopicName('user-123', 'Name')).toThrow('Not in topic creation flow');
    });

    test('works for worktree flow', () => {
      manager.startTopicWorktreeFlow('user-123', 'agent-456', 12345);
      expect(() => manager.setTopicName('user-123', 'feature/test')).not.toThrow();
    });

    test('works for sessao flow', () => {
      manager.startTopicSessaoFlow('user-123', 'agent-456', 12345);
      expect(() => manager.setTopicName('user-123', 'Debug')).not.toThrow();
    });
  });

  describe('Workspace Step during Topic Creation', () => {
    test('setAwaitingTopicWorkspace transitions Ralph flow to awaiting_topic_workspace', () => {
      manager.startTopicRalphFlow('user-123', 'agent-456', 12345, 'Task');
      manager.setTopicMaxIterations('user-123', 10);
      manager.setAwaitingTopicWorkspace('user-123');

      expect(manager.isAwaitingTopicWorkspace('user-123')).toBe(true);
      expect(manager.isAwaitingTopicIterations('user-123')).toBe(false);
    });

    test('setAwaitingTopicWorkspace transitions Worktree flow to awaiting_topic_workspace', () => {
      manager.startTopicWorktreeFlow('user-123', 'agent-456', 12345);
      manager.setTopicName('user-123', 'feature/auth');
      manager.setAwaitingTopicWorkspace('user-123');

      expect(manager.isAwaitingTopicWorkspace('user-123')).toBe(true);
      expect(manager.isAwaitingTopicName('user-123')).toBe(false);
    });

    test('setAwaitingTopicWorkspace transitions Sessao flow to awaiting_topic_workspace', () => {
      manager.startTopicSessaoFlow('user-123', 'agent-456', 12345);
      manager.setTopicName('user-123', 'Debug');
      manager.setAwaitingTopicWorkspace('user-123');

      expect(manager.isAwaitingTopicWorkspace('user-123')).toBe(true);
    });

    test('setAwaitingTopicWorkspace throws when not in topic flow', () => {
      expect(() => manager.setAwaitingTopicWorkspace('user-123')).toThrow('Not in topic creation flow');
    });

    test('isAwaitingTopicWorkspace returns false when not in any flow', () => {
      expect(manager.isAwaitingTopicWorkspace('user-123')).toBe(false);
    });

    test('isAwaitingTopicWorkspace returns false in different flow state', () => {
      manager.startTopicRalphFlow('user-123', 'agent-456', 12345);
      expect(manager.isAwaitingTopicWorkspace('user-123')).toBe(false);
    });

    test('setTopicWorkspace stores workspace path in flowData', () => {
      manager.startTopicWorktreeFlow('user-123', 'agent-456', 12345);
      manager.setTopicName('user-123', 'feature/test');
      manager.setAwaitingTopicWorkspace('user-123');
      manager.setTopicWorkspace('user-123', '/Users/lucas/project');

      const context = manager.getContext('user-123');
      expect(context?.flowData?.topicWorkspace).toBe('/Users/lucas/project');
    });

    test('setTopicWorkspace throws when not in topic flow', () => {
      expect(() => manager.setTopicWorkspace('user-123', '/some/path')).toThrow('Not in topic creation flow');
    });

    test('full Ralph flow with workspace: task → iterations → workspace', () => {
      manager.startTopicRalphFlow('user-123', 'agent-456', 12345);

      // Step 1: Set task
      manager.setTopicTask('user-123', 'Build auth');
      expect(manager.isAwaitingTopicIterations('user-123')).toBe(true);

      // Step 2: Set iterations
      manager.setTopicMaxIterations('user-123', 15);

      // Step 3: Transition to workspace
      manager.setAwaitingTopicWorkspace('user-123');
      expect(manager.isAwaitingTopicWorkspace('user-123')).toBe(true);

      // Step 4: Set workspace
      manager.setTopicWorkspace('user-123', '/Users/lucas/project');

      const data = manager.getTopicRalphData('user-123');
      expect(data?.topicTask).toBe('Build auth');
      expect(data?.topicMaxIterations).toBe(15);
      const context = manager.getContext('user-123');
      expect(context?.flowData?.topicWorkspace).toBe('/Users/lucas/project');
    });

    test('full Worktree flow with workspace: name → workspace', () => {
      manager.startTopicWorktreeFlow('user-123', 'agent-456', 12345);

      // Step 1: Set name
      manager.setTopicName('user-123', 'feature/payments');

      // Step 2: Transition to workspace
      manager.setAwaitingTopicWorkspace('user-123');
      expect(manager.isAwaitingTopicWorkspace('user-123')).toBe(true);

      // Step 3: Set workspace
      manager.setTopicWorkspace('user-123', '/Users/lucas/payments');

      const data = manager.getTopicCreationData('user-123');
      expect(data?.topicName).toBe('feature/payments');
      const context = manager.getContext('user-123');
      expect(context?.flowData?.topicWorkspace).toBe('/Users/lucas/payments');
    });
  });

  describe('clearContext clears topic flows', () => {
    test('clears Ralph flow', () => {
      manager.startTopicRalphFlow('user-123', 'agent-456', 12345, 'Task');
      manager.clearContext('user-123');

      expect(manager.isInTopicRalphFlow('user-123')).toBe(false);
      expect(manager.getTopicRalphData('user-123')).toBeUndefined();
    });

    test('clears Worktree flow', () => {
      manager.startTopicWorktreeFlow('user-123', 'agent-456', 12345, 'feature');
      manager.clearContext('user-123');

      expect(manager.isInTopicWorktreeFlow('user-123')).toBe(false);
      expect(manager.getTopicCreationData('user-123')).toBeUndefined();
    });
  });
});
