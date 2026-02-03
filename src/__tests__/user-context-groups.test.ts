import { describe, it, expect, beforeEach } from 'bun:test';
import { UserContextManager } from '../user-context-manager';

describe('UserContextManager - Groups flow', () => {
  let manager: UserContextManager;

  beforeEach(() => {
    manager = new UserContextManager();
  });

  describe('Create agent flow with mode and modelMode selection', () => {
    it('should advance through all steps: name → type → emoji → mode → workspace → modelMode → confirmation', () => {
      manager.startCreateAgentFlow('user1');
      expect(manager.isAwaitingAgentName('user1')).toBe(true);

      manager.setAgentName('user1', 'Backend API');
      expect(manager.isAwaitingType('user1')).toBe(true);

      manager.setAgentType('user1', 'claude');
      expect(manager.isAwaitingEmoji('user1')).toBe(true);

      manager.setAgentEmoji('user1', '🚀');
      expect(manager.isAwaitingAgentMode('user1')).toBe(true);

      manager.setAgentMode('user1', 'conversational');
      expect(manager.isAwaitingWorkspaceChoice('user1')).toBe(true);

      manager.setAgentWorkspace('user1', '/Users/test');
      expect(manager.isAwaitingModelMode('user1')).toBe(true);

      manager.setAgentModelMode('user1', 'opus');
      expect(manager.isAwaitingCreateConfirmation('user1')).toBe(true);
    });

    it('should support setAgentMode for conversational/ralph', () => {
      manager.startCreateAgentFlow('user1');
      manager.setAgentName('user1', 'Test');
      manager.setAgentType('user1', 'claude');
      manager.setAgentEmoji('user1', '🚀');

      // Now we should be able to set mode
      expect(manager.isAwaitingAgentMode('user1')).toBe(true);

      manager.setAgentMode('user1', 'conversational');
      expect(manager.isAwaitingWorkspaceChoice('user1')).toBe(true);
    });

    it('should support ralph mode', () => {
      manager.startCreateAgentFlow('user1');
      manager.setAgentName('user1', 'Test');
      manager.setAgentType('user1', 'claude');
      manager.setAgentEmoji('user1', '🤖');

      manager.setAgentMode('user1', 'ralph');
      expect(manager.isAwaitingWorkspaceChoice('user1')).toBe(true);

      const data = manager.getCreateAgentData('user1');
      expect(data?.agentMode).toBe('ralph');
    });

    it('should support setAgentModelMode', () => {
      manager.startCreateAgentFlow('user1');
      manager.setAgentName('user1', 'Test');
      manager.setAgentType('user1', 'claude');
      manager.setAgentEmoji('user1', '🚀');
      manager.setAgentMode('user1', 'conversational');
      manager.setAgentWorkspace('user1', '/Users/test');

      expect(manager.isAwaitingModelMode('user1')).toBe(true);

      manager.setAgentModelMode('user1', 'opus');
      expect(manager.isAwaitingCreateConfirmation('user1')).toBe(true);
    });

    it('should support all model mode options', () => {
      const modelModes = ['selection', 'haiku', 'sonnet', 'opus'] as const;

      for (const modelMode of modelModes) {
        manager.clearAll();
        manager.startCreateAgentFlow('user1');
        manager.setAgentName('user1', 'Test');
        manager.setAgentType('user1', 'claude');
        manager.setAgentEmoji('user1', '🚀');
        manager.setAgentMode('user1', 'conversational');
        manager.setAgentWorkspace('user1', '/Users/test');

        manager.setAgentModelMode('user1', modelMode);

        const data = manager.getCreateAgentData('user1');
        expect(data?.modelMode).toBe(modelMode);
      }
    });

    it('should include agentMode and modelMode in getCreateAgentData', () => {
      manager.startCreateAgentFlow('user1');
      manager.setAgentName('user1', 'Backend API');
      manager.setAgentType('user1', 'claude');
      manager.setAgentEmoji('user1', '🚀');
      manager.setAgentMode('user1', 'ralph');
      manager.setAgentWorkspace('user1', '/Users/test/api');
      manager.setAgentModelMode('user1', 'sonnet');

      const data = manager.getCreateAgentData('user1');
      expect(data?.agentName).toBe('Backend API');
      expect(data?.agentType).toBe('claude');
      expect(data?.emoji).toBe('🚀');
      expect(data?.agentMode).toBe('ralph');
      expect(data?.workspace).toBe('/Users/test/api');
      expect(data?.modelMode).toBe('sonnet');
    });

    it('should throw if setAgentMode called when not in create agent flow', () => {
      expect(() => manager.setAgentMode('user1', 'conversational')).toThrow('Not in create agent flow');
    });

    it('should throw if setAgentModelMode called when not in create agent flow', () => {
      expect(() => manager.setAgentModelMode('user1', 'opus')).toThrow('Not in create agent flow');
    });

    it('should return false for isAwaitingAgentMode when not in that state', () => {
      expect(manager.isAwaitingAgentMode('user1')).toBe(false);

      manager.startCreateAgentFlow('user1');
      expect(manager.isAwaitingAgentMode('user1')).toBe(false);

      manager.setAgentName('user1', 'Test');
      expect(manager.isAwaitingAgentMode('user1')).toBe(false);

      manager.setAgentType('user1', 'claude');
      expect(manager.isAwaitingAgentMode('user1')).toBe(false);
    });

    it('should return false for isAwaitingModelMode when not in that state', () => {
      expect(manager.isAwaitingModelMode('user1')).toBe(false);

      manager.startCreateAgentFlow('user1');
      expect(manager.isAwaitingModelMode('user1')).toBe(false);

      manager.setAgentName('user1', 'Test');
      expect(manager.isAwaitingModelMode('user1')).toBe(false);
    });

    it('should work with null workspace (skip workspace)', () => {
      manager.startCreateAgentFlow('user1');
      manager.setAgentName('user1', 'Test');
      manager.setAgentType('user1', 'claude');
      manager.setAgentEmoji('user1', '🚀');
      manager.setAgentMode('user1', 'conversational');
      manager.setAgentWorkspace('user1', null);

      expect(manager.isAwaitingModelMode('user1')).toBe(true);

      const data = manager.getCreateAgentData('user1');
      expect(data?.workspace).toBeUndefined();
    });
  });
});
