import { describe, test, expect, beforeEach } from 'bun:test';
import { GroupOnboardingManager } from '../group-onboarding-manager';
import type { GroupOnboardingStep } from '../types';

describe('GroupOnboardingManager', () => {
  let manager: GroupOnboardingManager;

  beforeEach(() => {
    manager = new GroupOnboardingManager();
  });

  describe('Core Onboarding Operations', () => {
    describe('startOnboarding', () => {
      test('starts onboarding for new group', () => {
        const result = manager.startOnboarding(12345, 100);

        expect(result.success).toBe(true);
        expect(result.lockedByUserId).toBeUndefined();
        expect(manager.hasActiveOnboarding(12345)).toBe(true);
      });

      test('creates state with correct initial values', () => {
        manager.startOnboarding(12345, 100);

        const state = manager.getState(12345);
        expect(state).toBeDefined();
        expect(state!.chatId).toBe(12345);
        expect(state!.userId).toBe(100);
        expect(state!.step).toBe('awaiting_name');
        expect(state!.data).toEqual({});
        expect(state!.startedAt).toBeInstanceOf(Date);
      });

      test('allows custom initial step', () => {
        manager.startOnboarding(12345, 100, 'awaiting_emoji');

        const state = manager.getState(12345);
        expect(state!.step).toBe('awaiting_emoji');
      });

      test('same user can restart onboarding', () => {
        manager.startOnboarding(12345, 100);
        manager.updateState(12345, 100, { step: 'awaiting_emoji', data: { agentName: 'Test' } });

        const result = manager.startOnboarding(12345, 100);

        expect(result.success).toBe(true);
        const state = manager.getState(12345);
        expect(state!.step).toBe('awaiting_name'); // Reset to initial
        expect(state!.data).toEqual({}); // Data cleared
      });

      test('preserves pinned message when same user restarts', () => {
        manager.startOnboarding(12345, 100);
        manager.setPinnedMessageId(12345, 100, 999);

        manager.startOnboarding(12345, 100);

        expect(manager.getPinnedMessageId(12345)).toBe(999);
      });

      test('different user is blocked when onboarding active', () => {
        manager.startOnboarding(12345, 100);

        const result = manager.startOnboarding(12345, 200);

        expect(result.success).toBe(false);
        expect(result.lockedByUserId).toBe(100);
      });

      test('different user can start after completion', () => {
        manager.startOnboarding(12345, 100);
        manager.completeOnboarding(12345, 100);

        const result = manager.startOnboarding(12345, 200);

        expect(result.success).toBe(true);
        expect(manager.getState(12345)!.userId).toBe(200);
      });
    });

    describe('hasActiveOnboarding', () => {
      test('returns false for unknown group', () => {
        expect(manager.hasActiveOnboarding(99999)).toBe(false);
      });

      test('returns true for active onboarding', () => {
        manager.startOnboarding(12345, 100);
        expect(manager.hasActiveOnboarding(12345)).toBe(true);
      });

      test('returns false after completion', () => {
        manager.startOnboarding(12345, 100);
        manager.completeOnboarding(12345, 100);
        expect(manager.hasActiveOnboarding(12345)).toBe(false);
      });

      test('returns false after cancellation', () => {
        manager.startOnboarding(12345, 100);
        manager.cancelOnboarding(12345, 100);
        expect(manager.hasActiveOnboarding(12345)).toBe(false);
      });
    });

    describe('isLockedByUser', () => {
      test('returns false for unknown group', () => {
        expect(manager.isLockedByUser(99999, 100)).toBe(false);
      });

      test('returns true for the locking user', () => {
        manager.startOnboarding(12345, 100);
        expect(manager.isLockedByUser(12345, 100)).toBe(true);
      });

      test('returns false for different user', () => {
        manager.startOnboarding(12345, 100);
        expect(manager.isLockedByUser(12345, 200)).toBe(false);
      });
    });

    describe('getLockedByUserId', () => {
      test('returns undefined for unknown group', () => {
        expect(manager.getLockedByUserId(99999)).toBeUndefined();
      });

      test('returns the locking user ID', () => {
        manager.startOnboarding(12345, 100);
        expect(manager.getLockedByUserId(12345)).toBe(100);
      });
    });

    describe('getState', () => {
      test('returns undefined for unknown group', () => {
        expect(manager.getState(99999)).toBeUndefined();
      });

      test('returns the full state', () => {
        manager.startOnboarding(12345, 100);
        manager.updateState(12345, 100, {
          step: 'awaiting_workspace',
          data: { agentName: 'Test', emoji: '🚀' },
        });

        const state = manager.getState(12345);
        expect(state).toBeDefined();
        expect(state!.chatId).toBe(12345);
        expect(state!.userId).toBe(100);
        expect(state!.step).toBe('awaiting_workspace');
        expect(state!.data.agentName).toBe('Test');
        expect(state!.data.emoji).toBe('🚀');
      });
    });

    describe('updateState', () => {
      test('returns false for unknown group', () => {
        const result = manager.updateState(99999, 100, { step: 'awaiting_emoji' });
        expect(result).toBe(false);
      });

      test('returns false for unauthorized user', () => {
        manager.startOnboarding(12345, 100);

        const result = manager.updateState(12345, 200, { step: 'awaiting_emoji' });

        expect(result).toBe(false);
        expect(manager.getState(12345)!.step).toBe('awaiting_name'); // Unchanged
      });

      test('updates step for authorized user', () => {
        manager.startOnboarding(12345, 100);

        const result = manager.updateState(12345, 100, { step: 'awaiting_emoji' });

        expect(result).toBe(true);
        expect(manager.getState(12345)!.step).toBe('awaiting_emoji');
      });

      test('updates data for authorized user', () => {
        manager.startOnboarding(12345, 100);

        const result = manager.updateState(12345, 100, {
          data: { agentName: 'MyAgent', emoji: '🤖' },
        });

        expect(result).toBe(true);
        const state = manager.getState(12345);
        expect(state!.data.agentName).toBe('MyAgent');
        expect(state!.data.emoji).toBe('🤖');
      });

      test('merges data instead of replacing', () => {
        manager.startOnboarding(12345, 100);
        manager.updateState(12345, 100, { data: { agentName: 'Agent1' } });
        manager.updateState(12345, 100, { data: { emoji: '🎯' } });

        const state = manager.getState(12345);
        expect(state!.data.agentName).toBe('Agent1');
        expect(state!.data.emoji).toBe('🎯');
      });

      test('updates both step and data in single call', () => {
        manager.startOnboarding(12345, 100);

        manager.updateState(12345, 100, {
          step: 'awaiting_workspace',
          data: { agentName: 'Test', emoji: '✨' },
        });

        const state = manager.getState(12345);
        expect(state!.step).toBe('awaiting_workspace');
        expect(state!.data.agentName).toBe('Test');
        expect(state!.data.emoji).toBe('✨');
      });
    });

    describe('completeOnboarding', () => {
      test('returns undefined for unknown group', () => {
        expect(manager.completeOnboarding(99999, 100)).toBeUndefined();
      });

      test('returns final state and removes it', () => {
        manager.startOnboarding(12345, 100);
        manager.updateState(12345, 100, {
          step: 'awaiting_confirmation',
          data: { agentName: 'FinalAgent' },
        });

        const finalState = manager.completeOnboarding(12345, 100);

        expect(finalState).toBeDefined();
        expect(finalState!.data.agentName).toBe('FinalAgent');
        expect(manager.hasActiveOnboarding(12345)).toBe(false);
      });

      test('returns undefined and does not remove state for unauthorized user', () => {
        manager.startOnboarding(12345, 100);
        manager.updateState(12345, 100, {
          step: 'awaiting_confirmation',
          data: { agentName: 'FinalAgent' },
        });

        const result = manager.completeOnboarding(12345, 200);

        expect(result).toBeUndefined();
        expect(manager.hasActiveOnboarding(12345)).toBe(true);
        expect(manager.getState(12345)!.data.agentName).toBe('FinalAgent');
      });
    });

    describe('cancelOnboarding', () => {
      test('returns undefined for unknown group', () => {
        expect(manager.cancelOnboarding(99999, 100)).toBeUndefined();
      });

      test('returns cancelled state and removes it', () => {
        manager.startOnboarding(12345, 100);
        manager.updateState(12345, 100, { data: { agentName: 'Cancelled' } });

        const cancelledState = manager.cancelOnboarding(12345, 100);

        expect(cancelledState).toBeDefined();
        expect(cancelledState!.data.agentName).toBe('Cancelled');
        expect(manager.hasActiveOnboarding(12345)).toBe(false);
      });

      test('returns undefined and does not remove state for unauthorized user', () => {
        manager.startOnboarding(12345, 100);
        manager.updateState(12345, 100, { data: { agentName: 'Cancelled' } });

        const result = manager.cancelOnboarding(12345, 200);

        expect(result).toBeUndefined();
        expect(manager.hasActiveOnboarding(12345)).toBe(true);
        expect(manager.getState(12345)!.data.agentName).toBe('Cancelled');
      });
    });
  });

  describe('Lock Enforcement', () => {
    test('only one user can hold the lock', () => {
      manager.startOnboarding(12345, 100);

      // User 200 tries to start
      const result1 = manager.startOnboarding(12345, 200);
      expect(result1.success).toBe(false);
      expect(result1.lockedByUserId).toBe(100);

      // User 300 also tries
      const result2 = manager.startOnboarding(12345, 300);
      expect(result2.success).toBe(false);
      expect(result2.lockedByUserId).toBe(100);

      // Original user still has lock
      expect(manager.isLockedByUser(12345, 100)).toBe(true);
    });

    test('unauthorized user cannot update state', () => {
      manager.startOnboarding(12345, 100);

      // Try various updates from unauthorized user
      expect(manager.updateState(12345, 200, { step: 'awaiting_emoji' })).toBe(false);
      expect(manager.setAgentName(12345, 200, 'Hacked')).toBe(false);
      expect(manager.setEmoji(12345, 200, '💀')).toBe(false);
      expect(manager.setWorkspace(12345, 200, '/etc')).toBe(false);
      expect(manager.setModelMode(12345, 200, 'opus')).toBe(false);
      expect(manager.setSelectedAgentId(12345, 200, 'agent-123')).toBe(false);
      expect(manager.advanceStep(12345, 200, 'awaiting_emoji')).toBe(false);

      // State unchanged
      const state = manager.getState(12345);
      expect(state!.step).toBe('awaiting_name');
      expect(state!.data).toEqual({});
    });

    test('lock transfers after completion', () => {
      manager.startOnboarding(12345, 100);
      manager.completeOnboarding(12345, 100);

      const result = manager.startOnboarding(12345, 200);
      expect(result.success).toBe(true);
      expect(manager.isLockedByUser(12345, 200)).toBe(true);
    });

    test('lock transfers after cancellation', () => {
      manager.startOnboarding(12345, 100);
      manager.cancelOnboarding(12345, 100);

      const result = manager.startOnboarding(12345, 200);
      expect(result.success).toBe(true);
      expect(manager.isLockedByUser(12345, 200)).toBe(true);
    });

    test('different groups have independent locks', () => {
      manager.startOnboarding(11111, 100);
      manager.startOnboarding(22222, 200);

      // Both users have their own locks
      expect(manager.isLockedByUser(11111, 100)).toBe(true);
      expect(manager.isLockedByUser(22222, 200)).toBe(true);

      // Cross-access fails
      expect(manager.isLockedByUser(11111, 200)).toBe(false);
      expect(manager.isLockedByUser(22222, 100)).toBe(false);

      // Cross-update fails
      expect(manager.updateState(11111, 200, { step: 'awaiting_emoji' })).toBe(false);
      expect(manager.updateState(22222, 100, { step: 'awaiting_emoji' })).toBe(false);
    });

    test('getState returns cloned copy that cannot bypass lock via mutation', () => {
      manager.startOnboarding(12345, 100);
      manager.setAgentName(12345, 100, 'OriginalName');

      // Get state and try to mutate it
      const state = manager.getState(12345)!;
      state.userId = 200; // Try to change lock owner
      state.data.agentName = 'MutatedName';

      // Verify internal state is unchanged
      const internalState = manager.getState(12345)!;
      expect(internalState.userId).toBe(100); // Still locked by user 100
      expect(internalState.data.agentName).toBe('OriginalName'); // Data unchanged

      // Verify user 200 still cannot complete/cancel
      expect(manager.completeOnboarding(12345, 200)).toBeUndefined();
      expect(manager.hasActiveOnboarding(12345)).toBe(true);
    });

    test('getData returns cloned copy that cannot be mutated', () => {
      manager.startOnboarding(12345, 100);
      manager.setAgentName(12345, 100, 'OriginalName');

      // Get data and try to mutate it
      const data = manager.getData(12345)!;
      data.agentName = 'MutatedName';

      // Verify internal data is unchanged
      const internalData = manager.getData(12345)!;
      expect(internalData.agentName).toBe('OriginalName');
    });
  });

  describe('Pinned Message Management', () => {
    test('setPinnedMessageId returns false for unknown group', () => {
      expect(manager.setPinnedMessageId(99999, 100, 123)).toBe(false);
    });

    test('setPinnedMessageId sets the message ID', () => {
      manager.startOnboarding(12345, 100);

      const result = manager.setPinnedMessageId(12345, 100, 999);

      expect(result).toBe(true);
      expect(manager.getPinnedMessageId(12345)).toBe(999);
    });

    test('setPinnedMessageId returns false for unauthorized user', () => {
      manager.startOnboarding(12345, 100);

      const result = manager.setPinnedMessageId(12345, 200, 999);

      expect(result).toBe(false);
      expect(manager.getPinnedMessageId(12345)).toBeUndefined();
    });

    test('getPinnedMessageId returns undefined for unknown group', () => {
      expect(manager.getPinnedMessageId(99999)).toBeUndefined();
    });

    test('getPinnedMessageId returns undefined when not set', () => {
      manager.startOnboarding(12345, 100);
      expect(manager.getPinnedMessageId(12345)).toBeUndefined();
    });

    test('pinned message persists through updates', () => {
      manager.startOnboarding(12345, 100);
      manager.setPinnedMessageId(12345, 100, 777);
      manager.updateState(12345, 100, { step: 'awaiting_emoji', data: { agentName: 'Test' } });

      expect(manager.getPinnedMessageId(12345)).toBe(777);
    });
  });

  describe('Step Helpers', () => {
    test('getCurrentStep returns undefined for unknown group', () => {
      expect(manager.getCurrentStep(99999)).toBeUndefined();
    });

    test('getCurrentStep returns current step', () => {
      manager.startOnboarding(12345, 100);
      expect(manager.getCurrentStep(12345)).toBe('awaiting_name');

      manager.updateState(12345, 100, { step: 'awaiting_emoji' });
      expect(manager.getCurrentStep(12345)).toBe('awaiting_emoji');
    });

    test('isAtStep returns false for unknown group', () => {
      expect(manager.isAtStep(99999, 'awaiting_name')).toBe(false);
    });

    test('isAtStep returns correct boolean', () => {
      manager.startOnboarding(12345, 100);

      expect(manager.isAtStep(12345, 'awaiting_name')).toBe(true);
      expect(manager.isAtStep(12345, 'awaiting_emoji')).toBe(false);
    });

    test('advanceStep updates step for authorized user', () => {
      manager.startOnboarding(12345, 100);

      const result = manager.advanceStep(12345, 100, 'awaiting_emoji');

      expect(result).toBe(true);
      expect(manager.getCurrentStep(12345)).toBe('awaiting_emoji');
    });

    test('advanceStep fails for unauthorized user', () => {
      manager.startOnboarding(12345, 100);

      const result = manager.advanceStep(12345, 200, 'awaiting_emoji');

      expect(result).toBe(false);
      expect(manager.getCurrentStep(12345)).toBe('awaiting_name');
    });
  });

  describe('Data Helpers', () => {
    test('getData returns undefined for unknown group', () => {
      expect(manager.getData(99999)).toBeUndefined();
    });

    test('getData returns collected data', () => {
      manager.startOnboarding(12345, 100);
      manager.updateState(12345, 100, {
        data: { agentName: 'Test', emoji: '🎯', workspace: '/home/user' },
      });

      const data = manager.getData(12345);
      expect(data).toEqual({
        agentName: 'Test',
        emoji: '🎯',
        workspace: '/home/user',
      });
    });

    test('setAgentName sets the name', () => {
      manager.startOnboarding(12345, 100);

      expect(manager.setAgentName(12345, 100, 'MyAgent')).toBe(true);
      expect(manager.getData(12345)!.agentName).toBe('MyAgent');
    });

    test('setAgentName fails for unauthorized user', () => {
      manager.startOnboarding(12345, 100);

      expect(manager.setAgentName(12345, 200, 'Hacked')).toBe(false);
      expect(manager.getData(12345)!.agentName).toBeUndefined();
    });

    test('setEmoji sets the emoji', () => {
      manager.startOnboarding(12345, 100);

      expect(manager.setEmoji(12345, 100, '🚀')).toBe(true);
      expect(manager.getData(12345)!.emoji).toBe('🚀');
    });

    test('setWorkspace sets the workspace', () => {
      manager.startOnboarding(12345, 100);

      expect(manager.setWorkspace(12345, 100, '/projects/app')).toBe(true);
      expect(manager.getData(12345)!.workspace).toBe('/projects/app');
    });

    test('setModelMode sets the model mode', () => {
      manager.startOnboarding(12345, 100);

      expect(manager.setModelMode(12345, 100, 'sonnet')).toBe(true);
      expect(manager.getData(12345)!.modelMode).toBe('sonnet');
    });

    test('setSelectedAgentId sets the agent ID', () => {
      manager.startOnboarding(12345, 100);

      expect(manager.setSelectedAgentId(12345, 100, 'agent-abc-123')).toBe(true);
      expect(manager.getData(12345)!.selectedAgentId).toBe('agent-abc-123');
    });

    test('multiple data fields accumulate', () => {
      manager.startOnboarding(12345, 100);

      manager.setAgentName(12345, 100, 'Agent1');
      manager.setEmoji(12345, 100, '🤖');
      manager.setWorkspace(12345, 100, '/workspace');
      manager.setModelMode(12345, 100, 'opus');

      const data = manager.getData(12345);
      expect(data).toEqual({
        agentName: 'Agent1',
        emoji: '🤖',
        workspace: '/workspace',
        modelMode: 'opus',
      });
    });
  });

  describe('Concurrent Access Scenarios', () => {
    test('multiple groups can onboard simultaneously', () => {
      manager.startOnboarding(11111, 100);
      manager.startOnboarding(22222, 200);
      manager.startOnboarding(33333, 300);

      expect(manager.getActiveCount()).toBe(3);

      // Each user can update their own group
      expect(manager.setAgentName(11111, 100, 'Group1Agent')).toBe(true);
      expect(manager.setAgentName(22222, 200, 'Group2Agent')).toBe(true);
      expect(manager.setAgentName(33333, 300, 'Group3Agent')).toBe(true);

      // Verify isolation
      expect(manager.getData(11111)!.agentName).toBe('Group1Agent');
      expect(manager.getData(22222)!.agentName).toBe('Group2Agent');
      expect(manager.getData(33333)!.agentName).toBe('Group3Agent');
    });

    test('same user can onboard multiple groups', () => {
      manager.startOnboarding(11111, 100);
      manager.startOnboarding(22222, 100);

      expect(manager.isLockedByUser(11111, 100)).toBe(true);
      expect(manager.isLockedByUser(22222, 100)).toBe(true);

      // User can update both
      expect(manager.setAgentName(11111, 100, 'Agent1')).toBe(true);
      expect(manager.setAgentName(22222, 100, 'Agent2')).toBe(true);
    });

    test('completing one group does not affect others', () => {
      manager.startOnboarding(11111, 100);
      manager.startOnboarding(22222, 200);

      manager.completeOnboarding(11111, 100);

      expect(manager.hasActiveOnboarding(11111)).toBe(false);
      expect(manager.hasActiveOnboarding(22222)).toBe(true);
      expect(manager.getActiveCount()).toBe(1);
    });

    test('race condition: second user waits for first to complete', () => {
      // User 100 starts
      manager.startOnboarding(12345, 100);
      manager.setAgentName(12345, 100, 'FirstAgent');

      // User 200 tries - blocked
      const blocked = manager.startOnboarding(12345, 200);
      expect(blocked.success).toBe(false);
      expect(blocked.lockedByUserId).toBe(100);

      // User 100 completes
      const completed = manager.completeOnboarding(12345, 100);
      expect(completed!.data.agentName).toBe('FirstAgent');

      // User 200 can now start
      const started = manager.startOnboarding(12345, 200);
      expect(started.success).toBe(true);
      expect(manager.isLockedByUser(12345, 200)).toBe(true);
    });
  });

  describe('State Transitions', () => {
    test('full onboarding flow: awaiting_name → awaiting_emoji → awaiting_workspace → awaiting_model_mode → awaiting_confirmation → complete', () => {
      manager.startOnboarding(12345, 100);
      expect(manager.getCurrentStep(12345)).toBe('awaiting_name');

      manager.setAgentName(12345, 100, 'MyAgent');
      manager.advanceStep(12345, 100, 'awaiting_emoji');
      expect(manager.getCurrentStep(12345)).toBe('awaiting_emoji');

      manager.setEmoji(12345, 100, '🚀');
      manager.advanceStep(12345, 100, 'awaiting_workspace');
      expect(manager.getCurrentStep(12345)).toBe('awaiting_workspace');

      manager.setWorkspace(12345, 100, '/home/user/project');
      manager.advanceStep(12345, 100, 'awaiting_model_mode');
      expect(manager.getCurrentStep(12345)).toBe('awaiting_model_mode');

      manager.setModelMode(12345, 100, 'sonnet');
      manager.advanceStep(12345, 100, 'awaiting_confirmation');
      expect(manager.getCurrentStep(12345)).toBe('awaiting_confirmation');

      // Verify all data
      const data = manager.getData(12345);
      expect(data).toEqual({
        agentName: 'MyAgent',
        emoji: '🚀',
        workspace: '/home/user/project',
        modelMode: 'sonnet',
      });

      // Complete
      const finalState = manager.completeOnboarding(12345, 100);
      expect(finalState!.step).toBe('awaiting_confirmation');
      expect(manager.hasActiveOnboarding(12345)).toBe(false);
    });

    test('linking flow: awaiting_name → linking_agent → complete', () => {
      manager.startOnboarding(12345, 100, 'awaiting_name');
      expect(manager.getCurrentStep(12345)).toBe('awaiting_name');

      manager.setSelectedAgentId(12345, 100, 'existing-agent-id');
      manager.advanceStep(12345, 100, 'linking_agent');
      expect(manager.getCurrentStep(12345)).toBe('linking_agent');

      const finalState = manager.completeOnboarding(12345, 100);
      expect(finalState!.data.selectedAgentId).toBe('existing-agent-id');
    });

    test('cancellation at any step clears state', () => {
      const steps: GroupOnboardingStep[] = [
        'awaiting_name',
        'awaiting_emoji',
        'awaiting_workspace',
        'awaiting_model_mode',
        'awaiting_confirmation',
      ];

      for (const step of steps) {
        manager.startOnboarding(12345, 100, step);
        manager.setAgentName(12345, 100, 'TestAgent');

        const cancelled = manager.cancelOnboarding(12345, 100);
        expect(cancelled).toBeDefined();
        expect(cancelled!.step).toBe(step);
        expect(manager.hasActiveOnboarding(12345)).toBe(false);
      }
    });
  });

  describe('Utility Methods', () => {
    test('getAllStates returns copy of all states', () => {
      manager.startOnboarding(11111, 100);
      manager.startOnboarding(22222, 200);

      const allStates = manager.getAllStates();

      expect(allStates.size).toBe(2);
      expect(allStates.get(11111)!.userId).toBe(100);
      expect(allStates.get(22222)!.userId).toBe(200);

      // Modifying returned map doesn't affect internal state
      allStates.delete(11111);
      expect(manager.hasActiveOnboarding(11111)).toBe(true);
    });

    test('clearAll removes all states', () => {
      manager.startOnboarding(11111, 100);
      manager.startOnboarding(22222, 200);
      manager.startOnboarding(33333, 300);

      manager.clearAll();

      expect(manager.getActiveCount()).toBe(0);
      expect(manager.hasActiveOnboarding(11111)).toBe(false);
      expect(manager.hasActiveOnboarding(22222)).toBe(false);
      expect(manager.hasActiveOnboarding(33333)).toBe(false);
    });

    test('getActiveCount returns correct count', () => {
      expect(manager.getActiveCount()).toBe(0);

      manager.startOnboarding(11111, 100);
      expect(manager.getActiveCount()).toBe(1);

      manager.startOnboarding(22222, 200);
      expect(manager.getActiveCount()).toBe(2);

      manager.completeOnboarding(11111, 100);
      expect(manager.getActiveCount()).toBe(1);

      manager.cancelOnboarding(22222, 200);
      expect(manager.getActiveCount()).toBe(0);
    });
  });

  describe('Timeout Handling', () => {
    test('hasTimedOut returns false for unknown group', () => {
      expect(manager.hasTimedOut(99999)).toBe(false);
    });

    test('hasTimedOut returns false for fresh onboarding', () => {
      manager.startOnboarding(12345, 100);
      expect(manager.hasTimedOut(12345)).toBe(false);
    });

    test('hasTimedOut returns true when timeout exceeded', () => {
      // Use test helper to set an old startedAt
      manager.startOnboarding(12345, 100);
      manager._setStartedAtForTesting(12345, new Date(Date.now() - 60 * 60 * 1000)); // 1 hour ago

      expect(manager.hasTimedOut(12345, 30 * 60 * 1000)).toBe(true); // 30 min timeout
    });

    test('hasTimedOut respects custom timeout', () => {
      manager.startOnboarding(12345, 100);
      manager._setStartedAtForTesting(12345, new Date(Date.now() - 10 * 60 * 1000)); // 10 min ago

      expect(manager.hasTimedOut(12345, 5 * 60 * 1000)).toBe(true);   // 5 min - timed out
      expect(manager.hasTimedOut(12345, 15 * 60 * 1000)).toBe(false); // 15 min - not timed out
    });

    test('cleanupTimedOut removes old onboardings', () => {
      manager.startOnboarding(11111, 100);
      manager.startOnboarding(22222, 200);
      manager.startOnboarding(33333, 300);

      // Make 11111 and 33333 old using test helper
      manager._setStartedAtForTesting(11111, new Date(Date.now() - 60 * 60 * 1000));
      manager._setStartedAtForTesting(33333, new Date(Date.now() - 45 * 60 * 1000));
      // Keep 22222 fresh

      const cleaned = manager.cleanupTimedOut(30 * 60 * 1000);

      expect(cleaned).toContain(11111);
      expect(cleaned).toContain(33333);
      expect(cleaned).not.toContain(22222);

      expect(manager.hasActiveOnboarding(11111)).toBe(false);
      expect(manager.hasActiveOnboarding(22222)).toBe(true);
      expect(manager.hasActiveOnboarding(33333)).toBe(false);
      expect(manager.getActiveCount()).toBe(1);
    });

    test('cleanupTimedOut returns empty array when nothing to clean', () => {
      manager.startOnboarding(12345, 100);

      const cleaned = manager.cleanupTimedOut();

      expect(cleaned).toEqual([]);
      expect(manager.hasActiveOnboarding(12345)).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    test('handles negative chat IDs (supergroups)', () => {
      const chatId = -1001234567890;

      manager.startOnboarding(chatId, 100);
      expect(manager.hasActiveOnboarding(chatId)).toBe(true);

      manager.setAgentName(chatId, 100, 'SupergroupAgent');
      expect(manager.getData(chatId)!.agentName).toBe('SupergroupAgent');
    });

    test('handles empty string data values', () => {
      manager.startOnboarding(12345, 100);

      manager.setAgentName(12345, 100, '');
      manager.setWorkspace(12345, 100, '');

      const data = manager.getData(12345);
      expect(data!.agentName).toBe('');
      expect(data!.workspace).toBe('');
    });

    test('handles special characters in data', () => {
      manager.startOnboarding(12345, 100);

      manager.setAgentName(12345, 100, '🤖 Test Agent 日本語');
      manager.setWorkspace(12345, 100, '/path/with spaces/and-dashes_and_underscores');

      const data = manager.getData(12345);
      expect(data!.agentName).toBe('🤖 Test Agent 日本語');
      expect(data!.workspace).toBe('/path/with spaces/and-dashes_and_underscores');
    });

    test('user ID 0 is valid', () => {
      manager.startOnboarding(12345, 0);
      expect(manager.isLockedByUser(12345, 0)).toBe(true);
    });

    test('operations are idempotent for unknown groups', () => {
      // These should all be safe no-ops
      expect(manager.completeOnboarding(99999, 100)).toBeUndefined();
      expect(manager.cancelOnboarding(99999, 100)).toBeUndefined();
      expect(manager.getState(99999)).toBeUndefined();
      expect(manager.getData(99999)).toBeUndefined();
      expect(manager.getCurrentStep(99999)).toBeUndefined();
      expect(manager.getPinnedMessageId(99999)).toBeUndefined();
      expect(manager.getLockedByUserId(99999)).toBeUndefined();
    });
  });
});
