import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { MessageRouter } from '../message-router';
import { AgentManager } from '../agent-manager';
import { PersistenceService } from '../persistence';
import { unlinkSync, existsSync } from 'fs';

const TEST_STATE_FILE = './.test-router-state.json';

describe('MessageRouter', () => {
  let persistenceService: PersistenceService;
  let agentManager: AgentManager;
  let router: MessageRouter;

  beforeEach(() => {
    if (existsSync(TEST_STATE_FILE)) unlinkSync(TEST_STATE_FILE);
    persistenceService = new PersistenceService(TEST_STATE_FILE);
    agentManager = new AgentManager(persistenceService);
    router = new MessageRouter(agentManager, '5581999999999');
  });

  afterEach(() => {
    if (existsSync(TEST_STATE_FILE)) unlinkSync(TEST_STATE_FILE);
    // Also clean up backup file
    const backupFile = TEST_STATE_FILE + '.bak';
    if (existsSync(backupFile)) unlinkSync(backupFile);
  });

  describe('Main number (command center)', () => {
    it('should route / command to menu', () => {
      const result = router.route('5581999999999', undefined, '/');
      expect(result.action).toBe('menu');
    });

    it('should route /status to status', () => {
      const result = router.route('5581999999999', undefined, '/status');
      expect(result.action).toBe('status');
    });

    it('should route /reset all to reset_all', () => {
      const result = router.route('5581999999999', undefined, '/reset all');
      expect(result.action).toBe('reset_all');
    });

    it('should route $ command to bash', () => {
      const result = router.route('5581999999999', undefined, '$ ls -la');
      expect(result.action).toBe('bash');
      expect(result.command).toBe('ls -la');
    });

    it('should route > command to bash', () => {
      const result = router.route('5581999999999', undefined, '> pwd');
      expect(result.action).toBe('bash');
      expect(result.command).toBe('pwd');
    });

    it('should reject prompts on main number', () => {
      const result = router.route('5581999999999', undefined, 'Hello, help me with code');
      expect(result.action).toBe('reject_prompt');
    });
  });

  describe('Group messages', () => {
    it('should route group message to linked agent', () => {
      const agent = agentManager.createAgent('5581999999999', 'Test');
      agentManager.setGroupId(agent.id, '120363123456789012@g.us');

      const result = router.route('5581999999999', '120363123456789012@g.us', 'Hello');
      expect(result.action).toBe('prompt');
      expect(result.agentId).toBe(agent.id);
    });

    it('should reject message from unlinked group', () => {
      const result = router.route('5581999999999', '120363999999999999@g.us', 'Hello');
      expect(result.action).toBe('reject_unlinked_group');
    });

    it('should handle !haiku prefix in group', () => {
      const agent = agentManager.createAgent('5581999999999', 'Test');
      agentManager.setGroupId(agent.id, '120363123456789012@g.us');

      const result = router.route('5581999999999', '120363123456789012@g.us', '!haiku Quick question');
      expect(result.action).toBe('prompt');
      expect(result.model).toBe('haiku');
      expect(result.text).toBe('Quick question');
    });

    it('should handle !sonnet prefix in group', () => {
      const agent = agentManager.createAgent('5581999999999', 'Test');
      agentManager.setGroupId(agent.id, '120363123456789012@g.us');

      const result = router.route('5581999999999', '120363123456789012@g.us', '!sonnet Code this');
      expect(result.model).toBe('sonnet');
      expect(result.text).toBe('Code this');
    });

    it('should handle !opus prefix in group', () => {
      const agent = agentManager.createAgent('5581999999999', 'Test');
      agentManager.setGroupId(agent.id, '120363123456789012@g.us');

      const result = router.route('5581999999999', '120363123456789012@g.us', '!opus Complex task');
      expect(result.model).toBe('opus');
      expect(result.text).toBe('Complex task');
    });

    it('should use agent fixed model when no prefix', () => {
      const agent = agentManager.createAgent('5581999999999', 'Test', undefined, undefined, 'claude', 'opus');
      agentManager.setGroupId(agent.id, '120363123456789012@g.us');

      const result = router.route('5581999999999', '120363123456789012@g.us', 'Hello');
      expect(result.model).toBe('opus');
    });

    it('should return undefined model when agent uses selection mode', () => {
      const agent = agentManager.createAgent('5581999999999', 'Test');
      agentManager.setGroupId(agent.id, '120363123456789012@g.us');

      const result = router.route('5581999999999', '120363123456789012@g.us', 'Hello');
      expect(result.model).toBeUndefined();
    });
  });
});
