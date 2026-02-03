// src/__tests__/integration-groups.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { AgentManager } from '../agent-manager';
import { PersistenceService } from '../persistence';
import { MessageRouter } from '../message-router';
import { UserContextManager } from '../user-context-manager';
import { unlinkSync, existsSync } from 'fs';

const TEST_STATE_FILE = './.test-integration-state.json';

describe('Groups Integration', () => {
  let persistenceService: PersistenceService;
  let agentManager: AgentManager;
  let router: MessageRouter;
  let contextManager: UserContextManager;

  beforeEach(() => {
    if (existsSync(TEST_STATE_FILE)) unlinkSync(TEST_STATE_FILE);
    const backupFile = TEST_STATE_FILE + '.bak';
    if (existsSync(backupFile)) unlinkSync(backupFile);
    persistenceService = new PersistenceService(TEST_STATE_FILE);
    agentManager = new AgentManager(persistenceService);
    router = new MessageRouter(agentManager, '5581999999999');
    contextManager = new UserContextManager();
  });

  afterEach(() => {
    if (existsSync(TEST_STATE_FILE)) unlinkSync(TEST_STATE_FILE);
    const backupFile = TEST_STATE_FILE + '.bak';
    if (existsSync(backupFile)) unlinkSync(backupFile);
  });

  describe('Full agent creation flow', () => {
    it('should complete agent creation with all new steps', () => {
      const userId = '5581999999999';

      // Start flow
      contextManager.startCreateAgentFlow(userId);
      expect(contextManager.isAwaitingAgentName(userId)).toBe(true);

      // Set name
      contextManager.setAgentName(userId, 'Backend API');
      expect(contextManager.isAwaitingType(userId)).toBe(true);

      // Set type (claude)
      contextManager.setAgentType(userId, 'claude');
      expect(contextManager.isAwaitingEmoji(userId)).toBe(true);

      // Set emoji
      contextManager.setAgentEmoji(userId, '🚀');
      expect(contextManager.isAwaitingAgentMode(userId)).toBe(true);

      // Set mode
      contextManager.setAgentMode(userId, 'conversational');
      expect(contextManager.isAwaitingWorkspaceChoice(userId)).toBe(true);

      // Set workspace (null for no workspace)
      contextManager.setAgentWorkspace(userId, null);
      expect(contextManager.isAwaitingModelMode(userId)).toBe(true);

      // Set model mode
      contextManager.setAgentModelMode(userId, 'opus');
      expect(contextManager.isAwaitingCreateConfirmation(userId)).toBe(true);

      // Get data and create agent
      const data = contextManager.getCreateAgentData(userId);
      expect(data).toEqual({
        agentName: 'Backend API',
        agentType: 'claude',
        emoji: '🚀',
        agentMode: 'conversational',
        workspace: undefined,
        modelMode: 'opus',
      });

      // Create agent with all fields
      const agent = agentManager.createAgent(
        userId,
        data!.agentName!,
        data!.workspace,
        data!.emoji,
        'claude',
        data!.modelMode
      );
      agentManager.setGroupId(agent.id, '120363123456789012@g.us');

      // Verify agent
      expect(agent.name).toBe('Backend API');
      expect(agent.emoji).toBe('🚀');
      expect(agent.workspace).toBeUndefined();
      expect(agent.modelMode).toBe('opus');

      const updated = agentManager.getAgent(agent.id);
      expect(updated?.groupId).toBe('120363123456789012@g.us');
    });

    it('should complete agent creation with workspace', () => {
      const userId = '5581999999999';
      const testWorkspace = '/Users/lucas/Desktop/claude-terminal'; // Use actual existing path

      // Start flow
      contextManager.startCreateAgentFlow(userId);

      // Set name
      contextManager.setAgentName(userId, 'Project Agent');

      // Set type
      contextManager.setAgentType(userId, 'claude');

      // Set emoji
      contextManager.setAgentEmoji(userId, '📁');

      // Set mode
      contextManager.setAgentMode(userId, 'conversational');

      // Set workspace
      contextManager.setAgentWorkspace(userId, testWorkspace);

      // Set model mode
      contextManager.setAgentModelMode(userId, 'sonnet');

      // Get data
      const data = contextManager.getCreateAgentData(userId);
      expect(data?.workspace).toBe(testWorkspace);

      // Create agent
      const agent = agentManager.createAgent(
        userId,
        data!.agentName!,
        data!.workspace,
        data!.emoji,
        'claude',
        data!.modelMode
      );

      expect(agent.workspace).toBe(testWorkspace);
      expect(agent.modelMode).toBe('sonnet');
    });
  });

  describe('Message routing', () => {
    it('should reject prompts on main number', () => {
      const route = router.route('5581999999999', undefined, 'Hello!');
      expect(route.action).toBe('reject_prompt');
    });

    it('should accept / command on main number', () => {
      const route = router.route('5581999999999', undefined, '/');
      expect(route.action).toBe('menu');
    });

    it('should accept /status on main number', () => {
      const route = router.route('5581999999999', undefined, '/status');
      expect(route.action).toBe('status');
    });

    it('should accept /reset all on main number', () => {
      const route = router.route('5581999999999', undefined, '/reset all');
      expect(route.action).toBe('reset_all');
    });

    it('should accept $ bash commands on main number', () => {
      const route = router.route('5581999999999', undefined, '$ ls -la');
      expect(route.action).toBe('bash');
      expect(route.command).toBe('ls -la');
    });

    it('should route group message to linked agent', () => {
      const agent = agentManager.createAgent('5581999999999', 'Test');
      agentManager.setGroupId(agent.id, '120363123456789012@g.us');

      const route = router.route('5581999999999', '120363123456789012@g.us', 'Hello!');
      expect(route.action).toBe('prompt');
      expect(route.agentId).toBe(agent.id);
    });

    it('should reject message from unlinked group', () => {
      const route = router.route('5581999999999', '120363999999999999@g.us', 'Hello');
      expect(route.action).toBe('reject_unlinked_group');
    });
  });

  describe('Model prefix handling', () => {
    it('should parse !haiku prefix', () => {
      const agent = agentManager.createAgent('5581999999999', 'Test');
      agentManager.setGroupId(agent.id, '120363123456789012@g.us');

      const route = router.route('5581999999999', '120363123456789012@g.us', '!haiku Quick question');
      expect(route.model).toBe('haiku');
      expect(route.text).toBe('Quick question');
    });

    it('should parse !sonnet prefix', () => {
      const agent = agentManager.createAgent('5581999999999', 'Test');
      agentManager.setGroupId(agent.id, '120363123456789012@g.us');

      const route = router.route('5581999999999', '120363123456789012@g.us', '!sonnet Code this');
      expect(route.model).toBe('sonnet');
      expect(route.text).toBe('Code this');
    });

    it('should parse !opus prefix', () => {
      const agent = agentManager.createAgent('5581999999999', 'Test');
      agentManager.setGroupId(agent.id, '120363123456789012@g.us');

      const route = router.route('5581999999999', '120363123456789012@g.us', '!opus Complex task');
      expect(route.model).toBe('opus');
      expect(route.text).toBe('Complex task');
    });

    it('should use agent fixed model when no prefix', () => {
      const agent = agentManager.createAgent('5581999999999', 'Test', undefined, undefined, 'claude', 'opus');
      agentManager.setGroupId(agent.id, '120363123456789012@g.us');

      const route = router.route('5581999999999', '120363123456789012@g.us', 'Hello');
      expect(route.model).toBe('opus');
    });

    it('should return undefined model for selection mode', () => {
      const agent = agentManager.createAgent('5581999999999', 'Test');
      agentManager.setGroupId(agent.id, '120363123456789012@g.us');

      const route = router.route('5581999999999', '120363123456789012@g.us', 'Hello');
      expect(route.model).toBeUndefined();
    });

    it('should override fixed model with prefix', () => {
      // Agent has opus fixed, but user uses !haiku
      const agent = agentManager.createAgent('5581999999999', 'Test', undefined, undefined, 'claude', 'opus');
      agentManager.setGroupId(agent.id, '120363123456789012@g.us');

      const route = router.route('5581999999999', '120363123456789012@g.us', '!haiku Quick question');
      expect(route.model).toBe('haiku');
      expect(route.text).toBe('Quick question');
    });
  });

  describe('Agent persistence with groups', () => {
    it('should persist and load groupId and modelMode', () => {
      const agent = agentManager.createAgent('5581999999999', 'Test', undefined, '🚀', 'claude', 'sonnet');
      agentManager.setGroupId(agent.id, '120363123456789012@g.us');

      // Create new manager from same persistence
      const agentManager2 = new AgentManager(persistenceService);
      const loaded = agentManager2.getAgent(agent.id);

      expect(loaded?.groupId).toBe('120363123456789012@g.us');
      expect(loaded?.modelMode).toBe('sonnet');
      expect(loaded?.emoji).toBe('🚀');
    });

    it('should find agent by groupId after reload', () => {
      const agent = agentManager.createAgent('5581999999999', 'Test');
      agentManager.setGroupId(agent.id, '120363123456789012@g.us');

      const agentManager2 = new AgentManager(persistenceService);
      const found = agentManager2.getAgentByGroupId('120363123456789012@g.us');

      expect(found?.id).toBe(agent.id);
    });

    it('should persist all agent fields correctly', () => {
      const agent = agentManager.createAgent(
        '5581999999999',
        'Full Agent',
        '/Users/lucas/Desktop/claude-terminal',
        '🎯',
        'claude',
        'opus'
      );
      agentManager.setGroupId(agent.id, '120363123456789012@g.us');

      // Reload
      const agentManager2 = new AgentManager(persistenceService);
      const loaded = agentManager2.getAgent(agent.id);

      expect(loaded).toBeDefined();
      expect(loaded?.name).toBe('Full Agent');
      expect(loaded?.workspace).toBe('/Users/lucas/Desktop/claude-terminal');
      expect(loaded?.emoji).toBe('🎯');
      expect(loaded?.type).toBe('claude');
      expect(loaded?.modelMode).toBe('opus');
      expect(loaded?.groupId).toBe('120363123456789012@g.us');
    });
  });

  describe('End-to-end flow', () => {
    it('should create agent via flow and route messages through group', () => {
      const userId = '5581999999999';
      const groupId = '120363123456789012@g.us';

      // 1. Create agent via flow
      contextManager.startCreateAgentFlow(userId);
      contextManager.setAgentName(userId, 'E2E Agent');
      contextManager.setAgentType(userId, 'claude');
      contextManager.setAgentEmoji(userId, '🔥');
      contextManager.setAgentMode(userId, 'conversational');
      contextManager.setAgentWorkspace(userId, null);
      contextManager.setAgentModelMode(userId, 'sonnet');

      const data = contextManager.getCreateAgentData(userId);
      const agent = agentManager.createAgent(
        userId,
        data!.agentName!,
        data!.workspace,
        data!.emoji,
        'claude',
        data!.modelMode
      );

      // 2. Link to group
      agentManager.setGroupId(agent.id, groupId);

      // 3. Clear flow
      contextManager.completeFlow(userId);
      expect(contextManager.isInFlow(userId)).toBe(false);

      // 4. Route message from group
      const route = router.route(userId, groupId, 'Build me an API');
      expect(route.action).toBe('prompt');
      expect(route.agentId).toBe(agent.id);
      expect(route.model).toBe('sonnet'); // Fixed model from agent
      expect(route.text).toBe('Build me an API');

      // 5. Route message with model override
      const routeOverride = router.route(userId, groupId, '!opus Complex architecture');
      expect(routeOverride.model).toBe('opus');
      expect(routeOverride.text).toBe('Complex architecture');
    });

    it('should handle multiple agents with different groups', () => {
      const userId = '5581999999999';

      // Create two agents with different fixed models
      const agent1 = agentManager.createAgent(userId, 'Agent 1', undefined, '1️⃣', 'claude', 'haiku');
      const agent2 = agentManager.createAgent(userId, 'Agent 2', undefined, '2️⃣', 'claude', 'opus');

      // Link to different groups
      agentManager.setGroupId(agent1.id, '120363111111111111@g.us');
      agentManager.setGroupId(agent2.id, '120363222222222222@g.us');

      // Route to first group
      const route1 = router.route(userId, '120363111111111111@g.us', 'Hello');
      expect(route1.agentId).toBe(agent1.id);
      expect(route1.model).toBe('haiku');

      // Route to second group
      const route2 = router.route(userId, '120363222222222222@g.us', 'Hello');
      expect(route2.agentId).toBe(agent2.id);
      expect(route2.model).toBe('opus');

      // Third group not linked
      const route3 = router.route(userId, '120363333333333333@g.us', 'Hello');
      expect(route3.action).toBe('reject_unlinked_group');
    });
  });
});
