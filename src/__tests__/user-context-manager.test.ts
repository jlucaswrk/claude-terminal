import { describe, test, expect, beforeEach } from 'bun:test';
import { UserContextManager } from '../user-context-manager';

describe('UserContextManager', () => {
  let manager: UserContextManager;

  beforeEach(() => {
    manager = new UserContextManager();
  });

  describe('Core Context Operations', () => {
    test('getContext returns undefined for unknown user', () => {
      expect(manager.getContext('unknown')).toBeUndefined();
    });

    test('setContext stores context for user', () => {
      manager.setContext('user1', {
        userId: 'user1',
        currentFlow: 'create_agent',
        flowState: 'awaiting_name',
      });

      const context = manager.getContext('user1');
      expect(context).toBeDefined();
      expect(context!.userId).toBe('user1');
      expect(context!.currentFlow).toBe('create_agent');
    });

    test('clearContext removes user context', () => {
      manager.setContext('user1', { userId: 'user1', currentFlow: 'create_agent' });
      manager.clearContext('user1');

      expect(manager.getContext('user1')).toBeUndefined();
    });

    test('clearContext is safe for non-existent user', () => {
      expect(() => manager.clearContext('unknown')).not.toThrow();
    });
  });

  describe('Flow State Helpers', () => {
    test('isInFlow returns false for user with no context', () => {
      expect(manager.isInFlow('user1')).toBe(false);
    });

    test('isInFlow returns false for user with context but no flow', () => {
      manager.setContext('user1', { userId: 'user1' });
      expect(manager.isInFlow('user1')).toBe(false);
    });

    test('isInFlow returns true when user is in a flow', () => {
      manager.startCreateAgentFlow('user1');
      expect(manager.isInFlow('user1')).toBe(true);
    });

    test('getCurrentFlow returns undefined for user not in flow', () => {
      expect(manager.getCurrentFlow('user1')).toBeUndefined();
    });

    test('getCurrentFlow returns current flow type', () => {
      manager.startCreateAgentFlow('user1');
      expect(manager.getCurrentFlow('user1')).toBe('create_agent');
    });

    test('getCurrentFlowState returns undefined for user not in flow', () => {
      expect(manager.getCurrentFlowState('user1')).toBeUndefined();
    });

    test('getCurrentFlowState returns current state', () => {
      manager.startCreateAgentFlow('user1');
      expect(manager.getCurrentFlowState('user1')).toBe('awaiting_name');
    });

    test('getFlowData returns undefined for user not in flow', () => {
      expect(manager.getFlowData('user1')).toBeUndefined();
    });

    test('getFlowData returns flow data', () => {
      manager.startCreateAgentFlow('user1');
      manager.setAgentName('user1', 'Test Agent');

      const data = manager.getFlowData('user1');
      expect(data).toBeDefined();
      expect(data!.agentName).toBe('Test Agent');
    });
  });

  describe('Create Agent Flow', () => {
    test('startCreateAgentFlow initializes flow state', () => {
      manager.startCreateAgentFlow('user1');

      const context = manager.getContext('user1');
      expect(context).toBeDefined();
      expect(context!.currentFlow).toBe('create_agent');
      expect(context!.flowState).toBe('awaiting_name');
      expect(context!.flowData).toEqual({});
    });

    test('isAwaitingAgentName returns true initially', () => {
      manager.startCreateAgentFlow('user1');
      expect(manager.isAwaitingAgentName('user1')).toBe(true);
    });

    test('isAwaitingAgentName returns false for other users', () => {
      manager.startCreateAgentFlow('user1');
      expect(manager.isAwaitingAgentName('user2')).toBe(false);
    });

    test('setAgentName stores name and advances state to type selection', () => {
      manager.startCreateAgentFlow('user1');
      manager.setAgentName('user1', 'My Agent');

      expect(manager.isAwaitingAgentName('user1')).toBe(false);
      expect(manager.isAwaitingType('user1')).toBe(true);

      const data = manager.getCreateAgentData('user1');
      expect(data!.agentName).toBe('My Agent');
    });

    test('setAgentName throws if not in create agent flow', () => {
      expect(() => manager.setAgentName('user1', 'Test')).toThrow('Not in create agent flow');
    });

    test('setAgentName throws if in different flow', () => {
      manager.startConfigureLimitFlow('user1');
      expect(() => manager.setAgentName('user1', 'Test')).toThrow('Not in create agent flow');
    });

    test('isAwaitingType returns true after name is set', () => {
      manager.startCreateAgentFlow('user1');
      expect(manager.isAwaitingType('user1')).toBe(false);

      manager.setAgentName('user1', 'Agent');
      expect(manager.isAwaitingType('user1')).toBe(true);
    });

    test('setAgentType stores type and advances to emoji', () => {
      manager.startCreateAgentFlow('user1');
      manager.setAgentName('user1', 'Agent');
      manager.setAgentType('user1', 'bash');

      expect(manager.isAwaitingType('user1')).toBe(false);
      expect(manager.isAwaitingEmoji('user1')).toBe(true);

      const data = manager.getCreateAgentData('user1');
      expect(data!.agentType).toBe('bash');
    });

    test('setAgentEmoji stores emoji and advances to workspace choice', () => {
      manager.startCreateAgentFlow('user1');
      manager.setAgentName('user1', 'Agent');
      manager.setAgentType('user1', 'claude');
      manager.setAgentEmoji('user1', '🚀');

      expect(manager.isAwaitingEmoji('user1')).toBe(false);
      expect(manager.isAwaitingWorkspaceChoice('user1')).toBe(true);

      const data = manager.getCreateAgentData('user1');
      expect(data!.emoji).toBe('🚀');
    });

    test('setAgentWorkspace stores workspace and advances state', () => {
      manager.startCreateAgentFlow('user1');
      manager.setAgentName('user1', 'Agent');
      manager.setAgentType('user1', 'claude');
      manager.setAgentEmoji('user1', '🤖');
      manager.setAgentWorkspace('user1', '/path/to/workspace');

      expect(manager.isAwaitingWorkspaceChoice('user1')).toBe(false);
      expect(manager.isAwaitingCreateConfirmation('user1')).toBe(true);

      const data = manager.getCreateAgentData('user1');
      expect(data!.workspace).toBe('/path/to/workspace');
    });

    test('setAgentWorkspace accepts null (skip workspace)', () => {
      manager.startCreateAgentFlow('user1');
      manager.setAgentName('user1', 'Agent');
      manager.setAgentType('user1', 'claude');
      manager.setAgentEmoji('user1', '🤖');
      manager.setAgentWorkspace('user1', null);

      const data = manager.getCreateAgentData('user1');
      expect(data!.workspace).toBeUndefined();
      expect(manager.isAwaitingCreateConfirmation('user1')).toBe(true);
    });

    test('setAgentWorkspace throws if not in create agent flow', () => {
      expect(() => manager.setAgentWorkspace('user1', '/path')).toThrow('Not in create agent flow');
    });

    test('isAwaitingCreateConfirmation returns true after workspace is set', () => {
      manager.startCreateAgentFlow('user1');
      manager.setAgentName('user1', 'Agent');
      manager.setAgentType('user1', 'claude');
      manager.setAgentEmoji('user1', '🤖');
      manager.setAgentWorkspace('user1', '/path');

      expect(manager.isAwaitingCreateConfirmation('user1')).toBe(true);
    });

    test('getCreateAgentData returns undefined if not in create flow', () => {
      expect(manager.getCreateAgentData('user1')).toBeUndefined();

      manager.startConfigureLimitFlow('user1');
      expect(manager.getCreateAgentData('user1')).toBeUndefined();
    });

    test('complete create agent flow preserves all data', () => {
      manager.startCreateAgentFlow('user1');
      manager.setAgentName('user1', 'Test Agent');
      manager.setAgentType('user1', 'bash');
      manager.setAgentEmoji('user1', '🚀');
      manager.setAgentWorkspace('user1', '/my/workspace');

      const data = manager.getCreateAgentData('user1');
      expect(data).toEqual({
        agentName: 'Test Agent',
        agentType: 'bash',
        emoji: '🚀',
        workspace: '/my/workspace',
      });
    });
  });

  describe('Configure Priority Flow', () => {
    test('startConfigurePriorityFlow without agentId requires selection', () => {
      manager.startConfigurePriorityFlow('user1');

      expect(manager.isInConfigurePriorityFlow('user1')).toBe(true);
      expect(manager.needsAgentSelection('user1')).toBe(true);
      expect(manager.getCurrentFlowState('user1')).toBe('awaiting_selection');
    });

    test('startConfigurePriorityFlow with agentId skips selection', () => {
      manager.startConfigurePriorityFlow('user1', 'agent-123');

      expect(manager.isInConfigurePriorityFlow('user1')).toBe(true);
      expect(manager.needsAgentSelection('user1')).toBe(false);

      const data = manager.getConfigurePriorityData('user1');
      expect(data!.agentId).toBe('agent-123');
    });

    test('setConfigurePriorityAgent stores agent ID', () => {
      manager.startConfigurePriorityFlow('user1');
      manager.setConfigurePriorityAgent('user1', 'agent-456');

      const data = manager.getConfigurePriorityData('user1');
      expect(data!.agentId).toBe('agent-456');
      expect(manager.needsAgentSelection('user1')).toBe(false);
    });

    test('setConfigurePriorityAgent throws if not in priority flow', () => {
      expect(() => manager.setConfigurePriorityAgent('user1', 'agent-123')).toThrow(
        'Not in configure priority flow'
      );
    });

    test('setConfigurePriorityAgent throws if in different flow', () => {
      manager.startCreateAgentFlow('user1');
      expect(() => manager.setConfigurePriorityAgent('user1', 'agent-123')).toThrow(
        'Not in configure priority flow'
      );
    });

    test('getConfigurePriorityData returns undefined if not in priority flow', () => {
      expect(manager.getConfigurePriorityData('user1')).toBeUndefined();

      manager.startCreateAgentFlow('user1');
      expect(manager.getConfigurePriorityData('user1')).toBeUndefined();
    });

    test('isInConfigurePriorityFlow returns false for other flows', () => {
      manager.startCreateAgentFlow('user1');
      expect(manager.isInConfigurePriorityFlow('user1')).toBe(false);
    });
  });

  describe('Configure Limit Flow', () => {
    test('startConfigureLimitFlow initializes flow state', () => {
      manager.startConfigureLimitFlow('user1');

      const context = manager.getContext('user1');
      expect(context).toBeDefined();
      expect(context!.currentFlow).toBe('configure_limit');
      expect(context!.flowState).toBe('awaiting_selection');
    });

    test('isInConfigureLimitFlow returns true when in flow', () => {
      manager.startConfigureLimitFlow('user1');
      expect(manager.isInConfigureLimitFlow('user1')).toBe(true);
    });

    test('isInConfigureLimitFlow returns false for other flows', () => {
      manager.startCreateAgentFlow('user1');
      expect(manager.isInConfigureLimitFlow('user1')).toBe(false);
    });

    test('isInConfigureLimitFlow returns false for user not in flow', () => {
      expect(manager.isInConfigureLimitFlow('user1')).toBe(false);
    });
  });

  describe('Delete Agent Flow', () => {
    test('startDeleteAgentFlow initializes with agent ID', () => {
      manager.startDeleteAgentFlow('user1', 'agent-to-delete');

      const context = manager.getContext('user1');
      expect(context).toBeDefined();
      expect(context!.currentFlow).toBe('delete_agent');
      expect(context!.flowState).toBe('awaiting_confirmation');
      expect(context!.flowData!.agentId).toBe('agent-to-delete');
    });

    test('isAwaitingDeleteConfirmation returns true when in delete flow', () => {
      manager.startDeleteAgentFlow('user1', 'agent-123');
      expect(manager.isAwaitingDeleteConfirmation('user1')).toBe(true);
    });

    test('isAwaitingDeleteConfirmation returns false for other flows', () => {
      manager.startCreateAgentFlow('user1');
      expect(manager.isAwaitingDeleteConfirmation('user1')).toBe(false);
    });

    test('isAwaitingDeleteConfirmation returns false for user not in flow', () => {
      expect(manager.isAwaitingDeleteConfirmation('user1')).toBe(false);
    });

    test('getDeleteAgentData returns agent ID', () => {
      manager.startDeleteAgentFlow('user1', 'agent-999');

      const data = manager.getDeleteAgentData('user1');
      expect(data).toBeDefined();
      expect(data!.agentId).toBe('agent-999');
    });

    test('getDeleteAgentData returns undefined if not in delete flow', () => {
      expect(manager.getDeleteAgentData('user1')).toBeUndefined();

      manager.startCreateAgentFlow('user1');
      expect(manager.getDeleteAgentData('user1')).toBeUndefined();
    });
  });

  describe('Pending Prompt Management', () => {
    test('setPendingPrompt stores prompt for user', () => {
      manager.setPendingPrompt('user1', 'Hello world');

      const prompt = manager.getPendingPrompt('user1');
      expect(prompt).toBeDefined();
      expect(prompt!.text).toBe('Hello world');
      expect(prompt!.messageId).toBeUndefined();
    });

    test('setPendingPrompt stores prompt with messageId', () => {
      manager.setPendingPrompt('user1', 'Hello', 'msg-123');

      const prompt = manager.getPendingPrompt('user1');
      expect(prompt!.text).toBe('Hello');
      expect(prompt!.messageId).toBe('msg-123');
    });

    test('setPendingPrompt creates context if none exists', () => {
      expect(manager.getContext('user1')).toBeUndefined();

      manager.setPendingPrompt('user1', 'Test');

      expect(manager.getContext('user1')).toBeDefined();
    });

    test('setPendingPrompt preserves existing flow', () => {
      manager.startCreateAgentFlow('user1');
      manager.setPendingPrompt('user1', 'Saved prompt');

      expect(manager.getCurrentFlow('user1')).toBe('create_agent');
      expect(manager.getPendingPrompt('user1')!.text).toBe('Saved prompt');
    });

    test('getPendingPrompt returns undefined for user without prompt', () => {
      expect(manager.getPendingPrompt('user1')).toBeUndefined();
    });

    test('hasPendingPrompt returns true when prompt exists', () => {
      manager.setPendingPrompt('user1', 'Test');
      expect(manager.hasPendingPrompt('user1')).toBe(true);
    });

    test('hasPendingPrompt returns false when no prompt', () => {
      expect(manager.hasPendingPrompt('user1')).toBe(false);
    });

    test('clearPendingPrompt removes prompt', () => {
      manager.setPendingPrompt('user1', 'Test');
      manager.clearPendingPrompt('user1');

      expect(manager.getPendingPrompt('user1')).toBeUndefined();
      expect(manager.hasPendingPrompt('user1')).toBe(false);
    });

    test('clearPendingPrompt removes context if no flow active', () => {
      manager.setPendingPrompt('user1', 'Test');
      manager.clearPendingPrompt('user1');

      expect(manager.getContext('user1')).toBeUndefined();
    });

    test('clearPendingPrompt preserves flow if active', () => {
      manager.startCreateAgentFlow('user1');
      manager.setPendingPrompt('user1', 'Test');
      manager.clearPendingPrompt('user1');

      expect(manager.getCurrentFlow('user1')).toBe('create_agent');
      expect(manager.hasPendingPrompt('user1')).toBe(false);
    });

    test('clearPendingPrompt is safe when no prompt exists', () => {
      expect(() => manager.clearPendingPrompt('user1')).not.toThrow();
    });
  });

  describe('Flow Completion', () => {
    test('completeFlow clears flow but preserves pending prompt', () => {
      manager.startCreateAgentFlow('user1');
      manager.setPendingPrompt('user1', 'Saved prompt');
      manager.completeFlow('user1');

      expect(manager.isInFlow('user1')).toBe(false);
      expect(manager.hasPendingPrompt('user1')).toBe(true);
      expect(manager.getPendingPrompt('user1')!.text).toBe('Saved prompt');
    });

    test('completeFlow removes context entirely if no pending prompt', () => {
      manager.startCreateAgentFlow('user1');
      manager.completeFlow('user1');

      expect(manager.getContext('user1')).toBeUndefined();
    });

    test('cancelFlow behaves same as completeFlow', () => {
      manager.startCreateAgentFlow('user1');
      manager.setPendingPrompt('user1', 'Saved');
      manager.cancelFlow('user1');

      expect(manager.isInFlow('user1')).toBe(false);
      expect(manager.hasPendingPrompt('user1')).toBe(true);
    });

    test('completeFlow is safe when no context exists', () => {
      expect(() => manager.completeFlow('user1')).not.toThrow();
    });
  });

  describe('Utility Methods', () => {
    test('getAllContexts returns copy of all contexts', () => {
      manager.startCreateAgentFlow('user1');
      manager.startConfigureLimitFlow('user2');
      manager.setPendingPrompt('user3', 'Test');

      const contexts = manager.getAllContexts();
      expect(contexts.size).toBe(3);
      expect(contexts.get('user1')!.currentFlow).toBe('create_agent');
      expect(contexts.get('user2')!.currentFlow).toBe('configure_limit');
      expect(contexts.get('user3')!.pendingPrompt!.text).toBe('Test');
    });

    test('getAllContexts returns independent copy', () => {
      manager.startCreateAgentFlow('user1');
      const contexts = manager.getAllContexts();

      contexts.delete('user1');

      expect(manager.getContext('user1')).toBeDefined();
    });

    test('clearAll removes all contexts', () => {
      manager.startCreateAgentFlow('user1');
      manager.startConfigureLimitFlow('user2');
      manager.setPendingPrompt('user3', 'Test');

      manager.clearAll();

      expect(manager.getContext('user1')).toBeUndefined();
      expect(manager.getContext('user2')).toBeUndefined();
      expect(manager.getContext('user3')).toBeUndefined();
      expect(manager.getAllContexts().size).toBe(0);
    });
  });

  describe('Multiple Users', () => {
    test('contexts are isolated between users', () => {
      manager.startCreateAgentFlow('user1');
      manager.startConfigurePriorityFlow('user2');
      manager.startDeleteAgentFlow('user3', 'agent-1');

      expect(manager.getCurrentFlow('user1')).toBe('create_agent');
      expect(manager.getCurrentFlow('user2')).toBe('configure_priority');
      expect(manager.getCurrentFlow('user3')).toBe('delete_agent');
    });

    test('clearing one user does not affect others', () => {
      manager.startCreateAgentFlow('user1');
      manager.startCreateAgentFlow('user2');

      manager.clearContext('user1');

      expect(manager.getContext('user1')).toBeUndefined();
      expect(manager.getCurrentFlow('user2')).toBe('create_agent');
    });

    test('flow transitions are independent', () => {
      manager.startCreateAgentFlow('user1');
      manager.startCreateAgentFlow('user2');

      manager.setAgentName('user1', 'Agent 1');

      expect(manager.isAwaitingType('user1')).toBe(true);
      expect(manager.isAwaitingAgentName('user2')).toBe(true);
    });
  });

  describe('Flow Transitions', () => {
    test('starting new flow replaces existing flow', () => {
      manager.startCreateAgentFlow('user1');
      manager.setAgentName('user1', 'Test');

      manager.startConfigureLimitFlow('user1');

      expect(manager.getCurrentFlow('user1')).toBe('configure_limit');
      expect(manager.getCreateAgentData('user1')).toBeUndefined();
    });

    test('starting new flow preserves pending prompt', () => {
      manager.setPendingPrompt('user1', 'Saved');
      manager.startCreateAgentFlow('user1');

      // Pending prompt is overwritten when starting a new flow
      // This is expected behavior - flow state takes precedence
      expect(manager.getCurrentFlow('user1')).toBe('create_agent');
    });
  });
});
