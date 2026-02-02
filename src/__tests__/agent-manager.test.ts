import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, unlinkSync, mkdirSync, rmdirSync } from 'fs';
import { AgentManager, AgentValidationError } from '../agent-manager';
import { PersistenceService } from '../persistence';
import type { Agent, Output } from '../types';

const TEST_STATE_FILE = './test-agent-manager-state.json';
const TEST_BACKUP_FILE = './test-agent-manager-state.json.bak';
const TEST_WORKSPACE = './test-workspace-dir';

function cleanup() {
  if (existsSync(TEST_STATE_FILE)) unlinkSync(TEST_STATE_FILE);
  if (existsSync(TEST_BACKUP_FILE)) unlinkSync(TEST_BACKUP_FILE);
  if (existsSync(TEST_WORKSPACE)) rmdirSync(TEST_WORKSPACE);
}

function createTestOutput(overrides: Partial<Output> = {}): Output {
  return {
    id: crypto.randomUUID(),
    summary: 'Test summary',
    prompt: 'Test prompt',
    response: 'Test response',
    model: 'opus',
    status: 'success',
    timestamp: new Date(),
    ...overrides,
  };
}

describe('AgentManager', () => {
  let manager: AgentManager;
  let persistence: PersistenceService;

  beforeEach(() => {
    cleanup();
    persistence = new PersistenceService(TEST_STATE_FILE);
    manager = new AgentManager(persistence);
  });

  afterEach(() => {
    cleanup();
  });

  describe('createAgent', () => {
    test('creates agent with valid name', () => {
      const agent = manager.createAgent('user1', 'My Agent');

      expect(agent.id).toBeDefined();
      expect(agent.name).toBe('My Agent');
      expect(agent.type).toBe('claude'); // default type
      expect(agent.status).toBe('idle');
      expect(agent.statusDetails).toBe('Aguardando prompt');
      expect(agent.priority).toBe('medium');
      expect(agent.title).toBe('');
      expect(agent.outputs).toEqual([]);
      expect(agent.messageCount).toBe(0);
    });

    test('creates bash agent with correct status', () => {
      const agent = manager.createAgent('user1', 'Bash Agent', undefined, undefined, 'bash');

      expect(agent.type).toBe('bash');
      expect(agent.statusDetails).toBe('Terminal pronto');
    });

    test('creates agent with workspace', () => {
      mkdirSync(TEST_WORKSPACE);
      const agent = manager.createAgent('user1', 'Agent', TEST_WORKSPACE);

      expect(agent.workspace).toBe(TEST_WORKSPACE);
    });

    test('generates unique UUID for each agent', () => {
      const agent1 = manager.createAgent('user1', 'Agent 1');
      const agent2 = manager.createAgent('user1', 'Agent 2');

      expect(agent1.id).not.toBe(agent2.id);
    });

    test('trims agent name', () => {
      const agent = manager.createAgent('user1', '  Trimmed Name  ');
      expect(agent.name).toBe('Trimmed Name');
    });

    test('throws error for empty name', () => {
      expect(() => manager.createAgent('user1', '')).toThrow(AgentValidationError);
      expect(() => manager.createAgent('user1', '   ')).toThrow(AgentValidationError);
    });

    test('throws error for name exceeding max length', () => {
      const longName = 'a'.repeat(51);
      expect(() => manager.createAgent('user1', longName)).toThrow(AgentValidationError);
    });

    test('throws error for name with dangerous characters', () => {
      expect(() => manager.createAgent('user1', 'Agent<script>')).toThrow(AgentValidationError);
      expect(() => manager.createAgent('user1', 'Agent{test}')).toThrow(AgentValidationError);
      expect(() => manager.createAgent('user1', 'Agent|pipe')).toThrow(AgentValidationError);
    });

    test('throws error for non-existent workspace', () => {
      expect(() =>
        manager.createAgent('user1', 'Agent', '/non/existent/path')
      ).toThrow(AgentValidationError);
    });

    test('throws error when max agents reached', () => {
      // Create max agents
      for (let i = 0; i < AgentManager.MAX_AGENTS_PER_USER; i++) {
        manager.createAgent('user1', `Agent ${i}`);
      }

      // 51st should fail
      expect(() => manager.createAgent('user1', 'One more')).toThrow(AgentValidationError);
    });

    test('persists agent after creation', () => {
      manager.createAgent('user1', 'Persisted Agent');

      const newManager = new AgentManager(persistence);
      const agents = newManager.getAllAgents();

      expect(agents).toHaveLength(1);
      expect(agents[0].name).toBe('Persisted Agent');
    });
  });

  describe('deleteAgent', () => {
    test('deletes existing agent', () => {
      const agent = manager.createAgent('user1', 'To Delete');
      const result = manager.deleteAgent(agent.id);

      expect(result).toBe(true);
      expect(manager.getAgent(agent.id)).toBeUndefined();
    });

    test('returns false for non-existent agent', () => {
      const result = manager.deleteAgent('non-existent-id');
      expect(result).toBe(false);
    });

    test('persists deletion', () => {
      const agent = manager.createAgent('user1', 'To Delete');
      manager.deleteAgent(agent.id);

      const newManager = new AgentManager(persistence);
      expect(newManager.getAgent(agent.id)).toBeUndefined();
    });

    test('updates user agent count after deletion', () => {
      const agent = manager.createAgent('user1', 'Agent');
      expect(manager.listAgents('user1')).toHaveLength(1);

      manager.deleteAgent(agent.id);
      expect(manager.listAgents('user1')).toHaveLength(0);
    });
  });

  describe('getAgent', () => {
    test('returns agent by ID', () => {
      const created = manager.createAgent('user1', 'Test Agent');
      const retrieved = manager.getAgent(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved!.id).toBe(created.id);
      expect(retrieved!.name).toBe('Test Agent');
    });

    test('returns undefined for non-existent ID', () => {
      const result = manager.getAgent('non-existent');
      expect(result).toBeUndefined();
    });
  });

  describe('listAgents', () => {
    test('returns empty array for user with no agents', () => {
      const agents = manager.listAgents('unknown-user');
      expect(agents).toEqual([]);
    });

    test('returns all agents for user', () => {
      manager.createAgent('user1', 'Agent 1');
      manager.createAgent('user1', 'Agent 2');
      manager.createAgent('user2', 'Other User Agent');

      const user1Agents = manager.listAgents('user1');
      expect(user1Agents).toHaveLength(2);
      expect(user1Agents.map(a => a.name)).toContain('Agent 1');
      expect(user1Agents.map(a => a.name)).toContain('Agent 2');
    });

    test('isolates agents by user', () => {
      manager.createAgent('user1', 'User 1 Agent');
      manager.createAgent('user2', 'User 2 Agent');

      const user1Agents = manager.listAgents('user1');
      const user2Agents = manager.listAgents('user2');

      expect(user1Agents).toHaveLength(1);
      expect(user1Agents[0].name).toBe('User 1 Agent');
      expect(user2Agents).toHaveLength(1);
      expect(user2Agents[0].name).toBe('User 2 Agent');
    });
  });

  describe('listAgentsSorted', () => {
    test('sorts by priority (high first)', () => {
      const low = manager.createAgent('user1', 'Low');
      const high = manager.createAgent('user1', 'High');
      const medium = manager.createAgent('user1', 'Medium');

      manager.updatePriority(low.id, 'low');
      manager.updatePriority(high.id, 'high');
      manager.updatePriority(medium.id, 'medium');

      const sorted = manager.listAgentsSorted('user1');

      expect(sorted[0].name).toBe('High');
      expect(sorted[1].name).toBe('Medium');
      expect(sorted[2].name).toBe('Low');
    });

    test('sorts by activity within same priority', async () => {
      const agent1 = manager.createAgent('user1', 'First');
      await new Promise(resolve => setTimeout(resolve, 10));
      const agent2 = manager.createAgent('user1', 'Second');
      await new Promise(resolve => setTimeout(resolve, 10));
      const agent3 = manager.createAgent('user1', 'Third');

      // All have medium priority by default
      const sorted = manager.listAgentsSorted('user1');

      // Most recent first
      expect(sorted[0].name).toBe('Third');
      expect(sorted[1].name).toBe('Second');
      expect(sorted[2].name).toBe('First');
    });

    test('combines priority and activity sorting', async () => {
      const highOld = manager.createAgent('user1', 'High Old');
      manager.updatePriority(highOld.id, 'high');

      await new Promise(resolve => setTimeout(resolve, 10));

      const highNew = manager.createAgent('user1', 'High New');
      manager.updatePriority(highNew.id, 'high');

      const mediumNew = manager.createAgent('user1', 'Medium New');

      const sorted = manager.listAgentsSorted('user1');

      // High priority agents first (newest high first)
      expect(sorted[0].name).toBe('High New');
      expect(sorted[1].name).toBe('High Old');
      // Then medium
      expect(sorted[2].name).toBe('Medium New');
    });
  });

  describe('updateAgentStatus', () => {
    test('updates status and details', () => {
      const agent = manager.createAgent('user1', 'Agent');
      manager.updateAgentStatus(agent.id, 'processing', 'Creating files...');

      const updated = manager.getAgent(agent.id)!;
      expect(updated.status).toBe('processing');
      expect(updated.statusDetails).toBe('Creating files...');
    });

    test('updates lastActivity', () => {
      const agent = manager.createAgent('user1', 'Agent');
      const originalActivity = agent.lastActivity;

      // Wait a bit to ensure different timestamp
      const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
      return wait(10).then(() => {
        manager.updateAgentStatus(agent.id, 'error', 'Failed');
        const updated = manager.getAgent(agent.id)!;
        expect(updated.lastActivity.getTime()).toBeGreaterThan(originalActivity.getTime());
      });
    });

    test('throws for non-existent agent', () => {
      expect(() =>
        manager.updateAgentStatus('fake-id', 'idle', 'test')
      ).toThrow(AgentValidationError);
    });

    test('persists status change', () => {
      const agent = manager.createAgent('user1', 'Agent');
      manager.updateAgentStatus(agent.id, 'error', 'Error details');

      const newManager = new AgentManager(persistence);
      const loaded = newManager.getAgent(agent.id)!;

      expect(loaded.status).toBe('error');
      expect(loaded.statusDetails).toBe('Error details');
    });
  });

  describe('updateAgentTitle', () => {
    test('updates title', () => {
      const agent = manager.createAgent('user1', 'Agent');
      manager.updateAgentTitle(agent.id, 'New Title');

      const updated = manager.getAgent(agent.id)!;
      expect(updated.title).toBe('New Title');
    });

    test('throws for non-existent agent', () => {
      expect(() => manager.updateAgentTitle('fake-id', 'Title')).toThrow(AgentValidationError);
    });

    test('persists title change', () => {
      const agent = manager.createAgent('user1', 'Agent');
      manager.updateAgentTitle(agent.id, 'Persisted Title');

      const newManager = new AgentManager(persistence);
      const loaded = newManager.getAgent(agent.id)!;

      expect(loaded.title).toBe('Persisted Title');
    });
  });

  describe('updatePriority', () => {
    test('updates priority', () => {
      const agent = manager.createAgent('user1', 'Agent');
      manager.updatePriority(agent.id, 'high');

      const updated = manager.getAgent(agent.id)!;
      expect(updated.priority).toBe('high');
    });

    test('throws for invalid priority', () => {
      const agent = manager.createAgent('user1', 'Agent');
      expect(() =>
        manager.updatePriority(agent.id, 'invalid' as any)
      ).toThrow(AgentValidationError);
    });

    test('throws for non-existent agent', () => {
      expect(() => manager.updatePriority('fake-id', 'high')).toThrow(AgentValidationError);
    });

    test('persists priority change', () => {
      const agent = manager.createAgent('user1', 'Agent');
      manager.updatePriority(agent.id, 'low');

      const newManager = new AgentManager(persistence);
      const loaded = newManager.getAgent(agent.id)!;

      expect(loaded.priority).toBe('low');
    });
  });

  describe('addOutput', () => {
    test('adds output to agent', () => {
      const agent = manager.createAgent('user1', 'Agent');
      const output = createTestOutput();

      manager.addOutput(agent.id, output);

      const updated = manager.getAgent(agent.id)!;
      expect(updated.outputs).toHaveLength(1);
      expect(updated.outputs[0].prompt).toBe('Test prompt');
    });

    test('increments messageCount', () => {
      const agent = manager.createAgent('user1', 'Agent');

      manager.addOutput(agent.id, createTestOutput());
      manager.addOutput(agent.id, createTestOutput());

      const updated = manager.getAgent(agent.id)!;
      expect(updated.messageCount).toBe(2);
    });

    test('generates summary from response if not provided', () => {
      const agent = manager.createAgent('user1', 'Agent');
      const output = createTestOutput({
        summary: '',
        response: 'This is a long response that should be truncated to fifty characters...',
      });

      manager.addOutput(agent.id, output);

      const updated = manager.getAgent(agent.id)!;
      expect(updated.outputs[0].summary).toBe('This is a long response that should be truncated t...');
    });

    test('keeps only last 10 outputs (FIFO)', () => {
      const agent = manager.createAgent('user1', 'Agent');

      // Add 15 outputs
      for (let i = 0; i < 15; i++) {
        manager.addOutput(agent.id, createTestOutput({ prompt: `Prompt ${i}` }));
      }

      const updated = manager.getAgent(agent.id)!;
      expect(updated.outputs).toHaveLength(10);

      // First 5 should be removed, so first remaining should be Prompt 5
      expect(updated.outputs[0].prompt).toBe('Prompt 5');
      expect(updated.outputs[9].prompt).toBe('Prompt 14');
    });

    test('throws for non-existent agent', () => {
      expect(() => manager.addOutput('fake-id', createTestOutput())).toThrow(AgentValidationError);
    });

    test('persists outputs', () => {
      const agent = manager.createAgent('user1', 'Agent');
      manager.addOutput(agent.id, createTestOutput({ prompt: 'Persisted' }));

      const newManager = new AgentManager(persistence);
      const loaded = newManager.getAgent(agent.id)!;

      expect(loaded.outputs).toHaveLength(1);
      expect(loaded.outputs[0].prompt).toBe('Persisted');
    });
  });

  describe('getOutputs', () => {
    test('returns outputs for agent', () => {
      const agent = manager.createAgent('user1', 'Agent');
      manager.addOutput(agent.id, createTestOutput({ prompt: 'First' }));
      manager.addOutput(agent.id, createTestOutput({ prompt: 'Second' }));

      const outputs = manager.getOutputs(agent.id);

      expect(outputs).toHaveLength(2);
      expect(outputs[0].prompt).toBe('First');
      expect(outputs[1].prompt).toBe('Second');
    });

    test('returns empty array for non-existent agent', () => {
      const outputs = manager.getOutputs('fake-id');
      expect(outputs).toEqual([]);
    });
  });

  describe('getUserIdForAgent', () => {
    test('returns userId for agent', () => {
      const agent = manager.createAgent('user123', 'Agent');
      const userId = manager.getUserIdForAgent(agent.id);

      expect(userId).toBe('user123');
    });

    test('returns undefined for non-existent agent', () => {
      const userId = manager.getUserIdForAgent('fake-id');
      expect(userId).toBeUndefined();
    });
  });

  describe('config management', () => {
    test('has default config', () => {
      const config = manager.getConfig();

      expect(config.maxConcurrent).toBe(3);
      expect(config.version).toBe('1.0');
    });

    test('updates config', () => {
      manager.updateConfig({ maxConcurrent: 5 });

      const config = manager.getConfig();
      expect(config.maxConcurrent).toBe(5);
    });

    test('persists config changes', () => {
      manager.updateConfig({ maxConcurrent: 10 });

      const newManager = new AgentManager(persistence);
      expect(newManager.getConfig().maxConcurrent).toBe(10);
    });
  });

  describe('state loading', () => {
    test('loads existing agents on init', () => {
      // Create agents with first manager
      manager.createAgent('user1', 'Agent 1');
      manager.createAgent('user1', 'Agent 2');

      // Create new manager - should load existing agents
      const newManager = new AgentManager(persistence);
      const agents = newManager.getAllAgents();

      expect(agents).toHaveLength(2);
    });

    test('preserves agent data across restarts', () => {
      const agent = manager.createAgent('user1', 'Test');
      manager.updatePriority(agent.id, 'high');
      manager.updateAgentTitle(agent.id, 'Important Agent');
      manager.addOutput(agent.id, createTestOutput({ prompt: 'Test prompt' }));

      const newManager = new AgentManager(persistence);
      const loaded = newManager.getAgent(agent.id)!;

      expect(loaded.name).toBe('Test');
      expect(loaded.priority).toBe('high');
      expect(loaded.title).toBe('Important Agent');
      expect(loaded.outputs).toHaveLength(1);
      expect(loaded.outputs[0].prompt).toBe('Test prompt');
    });
  });
});
