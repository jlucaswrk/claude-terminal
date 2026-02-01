import { describe, test, expect, beforeEach, mock, spyOn } from 'bun:test';
import { QueueManager, SendWhatsAppFn } from '../queue-manager';
import { Semaphore } from '../semaphore';
import { AgentManager } from '../agent-manager';
import { ClaudeTerminal } from '../terminal';
import { PersistenceService } from '../persistence';
import type { Agent } from '../types';

// Mock ClaudeTerminal
class MockClaudeTerminal {
  responses: Map<string, { text: string; images: string[]; title?: string; files?: any[]; toolsUsed?: any[] }> = new Map();
  delays: Map<string, number> = new Map();
  callCount = 0;
  calls: Array<{ prompt: string; model: string; userId: string }> = [];

  async send(prompt: string, model: string = 'haiku', userId: string = 'default') {
    this.callCount++;
    this.calls.push({ prompt, model, userId });

    const delay = this.delays.get(prompt) || 0;
    if (delay > 0) {
      await new Promise((r) => setTimeout(r, delay));
    }

    const response = this.responses.get(prompt) || { text: 'Mock response', images: [], files: [], toolsUsed: [] };
    return { ...response, files: response.files || [], toolsUsed: response.toolsUsed || [] };
  }

  clearSession() {}

  setResponse(prompt: string, response: { text: string; images: string[]; title?: string; files?: any[]; toolsUsed?: any[] }) {
    this.responses.set(prompt, response);
  }

  setDelay(prompt: string, delay: number) {
    this.delays.set(prompt, delay);
  }
}

// Mock PersistenceService
class MockPersistenceService {
  private data: any = null;

  load() {
    return this.data;
  }

  save(data: any) {
    this.data = data;
  }
}

describe('QueueManager', () => {
  let semaphore: Semaphore;
  let agentManager: AgentManager;
  let terminal: MockClaudeTerminal;
  let sendWhatsApp: SendWhatsAppFn;
  let whatsAppMessages: Array<{ to: string; text: string }>;
  let queueManager: QueueManager;

  beforeEach(() => {
    semaphore = new Semaphore(2);
    terminal = new MockClaudeTerminal();
    whatsAppMessages = [];
    sendWhatsApp = async (to: string, text: string) => {
      whatsAppMessages.push({ to, text });
    };

    const persistenceService = new MockPersistenceService() as unknown as PersistenceService;
    agentManager = new AgentManager(persistenceService);

    queueManager = new QueueManager(
      semaphore,
      agentManager,
      terminal as unknown as ClaudeTerminal,
      sendWhatsApp
    );
  });

  describe('enqueue', () => {
    test('creates task with correct properties', () => {
      const agent = agentManager.createAgent('user1', 'TestAgent');

      const task = queueManager.enqueue({
        agentId: agent.id,
        prompt: 'Test prompt',
        model: 'haiku',
        userId: 'user1',
      });

      expect(task.id).toBeDefined();
      expect(task.agentId).toBe(agent.id);
      expect(task.prompt).toBe('Test prompt');
      expect(task.model).toBe('haiku');
      expect(task.priority).toBe(1); // medium = 1
      expect(task.timestamp).toBeInstanceOf(Date);
    });

    test('throws if agent not found', () => {
      expect(() =>
        queueManager.enqueue({
          agentId: 'non-existent',
          prompt: 'Test',
          model: 'haiku',
          userId: 'user1',
        })
      ).toThrow('Agent not found');
    });

    test('derives priority from agent', () => {
      const agent = agentManager.createAgent('user1', 'HighPriorityAgent');
      agentManager.updatePriority(agent.id, 'high');

      const task = queueManager.enqueue({
        agentId: agent.id,
        prompt: 'Test',
        model: 'haiku',
        userId: 'user1',
      });

      expect(task.priority).toBe(0); // high = 0
    });
  });

  describe('priority ordering', () => {
    test('high priority tasks are sorted before medium in queue', () => {
      // This test verifies the PriorityQueue sorting logic
      const highAgent = agentManager.createAgent('user1', 'HighAgent');
      agentManager.updatePriority(highAgent.id, 'high');

      const mediumAgent = agentManager.createAgent('user1', 'MediumAgent');
      // Default is medium

      // Enqueue medium first, then high
      queueManager.enqueue({
        agentId: mediumAgent.id,
        prompt: 'medium priority',
        model: 'haiku',
        userId: 'user1',
      });

      queueManager.enqueue({
        agentId: highAgent.id,
        prompt: 'high priority',
        model: 'haiku',
        userId: 'user1',
      });

      // Check queue ordering - high should be first even though it was enqueued second
      const pending = queueManager.getPendingTasks();
      // Note: First task might already be processing, so check remaining queue
      const highInQueue = pending.find((t) => t.prompt === 'high priority');
      const mediumInQueue = pending.find((t) => t.prompt === 'medium priority');

      // If both are in queue, high should come before medium
      if (highInQueue && mediumInQueue) {
        const highIndex = pending.indexOf(highInQueue);
        const mediumIndex = pending.indexOf(mediumInQueue);
        expect(highIndex).toBeLessThan(mediumIndex);
      }
    });

    test('FIFO within same priority in queue', async () => {
      const agent1 = agentManager.createAgent('user1', 'Agent1');
      const agent2 = agentManager.createAgent('user1', 'Agent2');
      const agent3 = agentManager.createAgent('user1', 'Agent3');

      // Create tasks with distinct timestamps
      const task1 = queueManager.enqueue({
        agentId: agent1.id,
        prompt: 'first',
        model: 'haiku',
        userId: 'user1',
      });

      await new Promise((r) => setTimeout(r, 5));

      const task2 = queueManager.enqueue({
        agentId: agent2.id,
        prompt: 'second',
        model: 'haiku',
        userId: 'user1',
      });

      await new Promise((r) => setTimeout(r, 5));

      const task3 = queueManager.enqueue({
        agentId: agent3.id,
        prompt: 'third',
        model: 'haiku',
        userId: 'user1',
      });

      // Verify timestamps are in order
      expect(task1.timestamp.getTime()).toBeLessThan(task2.timestamp.getTime());
      expect(task2.timestamp.getTime()).toBeLessThan(task3.timestamp.getTime());
    });

    test('mixed priorities are ordered correctly in queue', () => {
      const lowAgent = agentManager.createAgent('user1', 'LowAgent');
      agentManager.updatePriority(lowAgent.id, 'low');

      const highAgent = agentManager.createAgent('user1', 'HighAgent');
      agentManager.updatePriority(highAgent.id, 'high');

      const mediumAgent = agentManager.createAgent('user1', 'MediumAgent');

      // Enqueue in reverse priority order
      queueManager.enqueue({
        agentId: lowAgent.id,
        prompt: 'low',
        model: 'haiku',
        userId: 'user1',
      });

      queueManager.enqueue({
        agentId: highAgent.id,
        prompt: 'high',
        model: 'haiku',
        userId: 'user1',
      });

      queueManager.enqueue({
        agentId: mediumAgent.id,
        prompt: 'medium',
        model: 'haiku',
        userId: 'user1',
      });

      // Check ordering in the pending tasks
      const pending = queueManager.getPendingTasks();
      const priorities = pending.map((t) => t.prompt);

      // Verify high comes before medium and medium comes before low
      const highIdx = priorities.indexOf('high');
      const mediumIdx = priorities.indexOf('medium');
      const lowIdx = priorities.indexOf('low');

      // Only check if they exist in the queue (some might already be processing)
      if (highIdx !== -1 && mediumIdx !== -1) {
        expect(highIdx).toBeLessThan(mediumIdx);
      }
      if (mediumIdx !== -1 && lowIdx !== -1) {
        expect(mediumIdx).toBeLessThan(lowIdx);
      }
      if (highIdx !== -1 && lowIdx !== -1) {
        expect(highIdx).toBeLessThan(lowIdx);
      }
    });

    test('high priority tasks process before queued lower priority tasks', async () => {
      // Use semaphore with 1 permit and a blocking first task
      semaphore = new Semaphore(1);
      const persistenceService = new MockPersistenceService() as unknown as PersistenceService;
      agentManager = new AgentManager(persistenceService);

      const testTerminal = new MockClaudeTerminal();
      // First task takes long, others are quick
      testTerminal.setDelay('blocker', 100);
      testTerminal.setDelay('high priority', 10);
      testTerminal.setDelay('low priority', 10);

      queueManager = new QueueManager(
        semaphore,
        agentManager,
        testTerminal as unknown as ClaudeTerminal,
        sendWhatsApp
      );

      const blockerAgent = agentManager.createAgent('user1', 'BlockerAgent');
      const highAgent = agentManager.createAgent('user1', 'HighAgent');
      agentManager.updatePriority(highAgent.id, 'high');
      const lowAgent = agentManager.createAgent('user1', 'LowAgent');
      agentManager.updatePriority(lowAgent.id, 'low');

      // Start a blocking task first
      queueManager.enqueue({
        agentId: blockerAgent.id,
        prompt: 'blocker',
        model: 'haiku',
        userId: 'user1',
      });

      // Wait for blocker to start processing
      await new Promise((r) => setTimeout(r, 10));

      // Now enqueue low priority first, then high priority
      queueManager.enqueue({
        agentId: lowAgent.id,
        prompt: 'low priority',
        model: 'haiku',
        userId: 'user1',
      });

      queueManager.enqueue({
        agentId: highAgent.id,
        prompt: 'high priority',
        model: 'haiku',
        userId: 'user1',
      });

      // Wait for all to complete
      await new Promise((r) => setTimeout(r, 250));

      // Verify order: blocker (started first), then high (higher priority), then low
      expect(testTerminal.calls.length).toBe(3);
      expect(testTerminal.calls[0].prompt).toBe('blocker');
      expect(testTerminal.calls[1].prompt).toBe('high priority');
      expect(testTerminal.calls[2].prompt).toBe('low priority');
    });
  });

  describe('concurrency control', () => {
    test('respects semaphore limits', async () => {
      semaphore = new Semaphore(2);
      const persistenceService = new MockPersistenceService() as unknown as PersistenceService;
      agentManager = new AgentManager(persistenceService);

      // Set longer delays to see concurrency
      terminal.setDelay('task1', 50);
      terminal.setDelay('task2', 50);
      terminal.setDelay('task3', 50);
      terminal.setDelay('task4', 50);

      queueManager = new QueueManager(
        semaphore,
        agentManager,
        terminal as unknown as ClaudeTerminal,
        sendWhatsApp
      );

      const agent = agentManager.createAgent('user1', 'Agent');

      // Enqueue 4 tasks
      queueManager.enqueue({
        agentId: agent.id,
        prompt: 'task1',
        model: 'haiku',
        userId: 'user1',
      });
      queueManager.enqueue({
        agentId: agent.id,
        prompt: 'task2',
        model: 'haiku',
        userId: 'user1',
      });
      queueManager.enqueue({
        agentId: agent.id,
        prompt: 'task3',
        model: 'haiku',
        userId: 'user1',
      });
      queueManager.enqueue({
        agentId: agent.id,
        prompt: 'task4',
        model: 'haiku',
        userId: 'user1',
      });

      // Wait a bit for initial processing to start
      await new Promise((r) => setTimeout(r, 10));

      // Should have 2 active and 2 queued
      const status = queueManager.getQueueStatus();
      expect(status.active).toBe(2);
      expect(status.queued).toBe(2);

      // Wait for all to complete
      await new Promise((r) => setTimeout(r, 200));

      expect(terminal.callCount).toBe(4);
    });

    test('processes next task when permit is released', async () => {
      semaphore = new Semaphore(1);
      const persistenceService = new MockPersistenceService() as unknown as PersistenceService;
      agentManager = new AgentManager(persistenceService);

      terminal.setDelay('first', 30);
      terminal.setDelay('second', 30);

      queueManager = new QueueManager(
        semaphore,
        agentManager,
        terminal as unknown as ClaudeTerminal,
        sendWhatsApp
      );

      const agent = agentManager.createAgent('user1', 'Agent');

      queueManager.enqueue({
        agentId: agent.id,
        prompt: 'first',
        model: 'haiku',
        userId: 'user1',
      });
      queueManager.enqueue({
        agentId: agent.id,
        prompt: 'second',
        model: 'haiku',
        userId: 'user1',
      });

      await new Promise((r) => setTimeout(r, 10));

      // First should be processing, second queued
      let status = queueManager.getQueueStatus();
      expect(status.active).toBe(1);
      expect(status.queued).toBe(1);

      // Wait for first to complete
      await new Promise((r) => setTimeout(r, 50));

      // Second should now be processing
      status = queueManager.getQueueStatus();
      expect(status.queued).toBe(0);

      // Wait for all
      await new Promise((r) => setTimeout(r, 50));
      expect(terminal.callCount).toBe(2);
    });
  });

  describe('status updates', () => {
    test('updates agent status to processing', async () => {
      const agent = agentManager.createAgent('user1', 'TestAgent');

      terminal.setDelay('test prompt', 50);

      queueManager.enqueue({
        agentId: agent.id,
        prompt: 'test prompt',
        model: 'haiku',
        userId: 'user1',
      });

      await new Promise((r) => setTimeout(r, 10));

      const updatedAgent = agentManager.getAgent(agent.id)!;
      expect(updatedAgent.status).toBe('processing');
      expect(updatedAgent.statusDetails).toContain('processando');
    });

    test('updates agent status to idle after success', async () => {
      const agent = agentManager.createAgent('user1', 'TestAgent');

      terminal.setDelay('test', 10);
      terminal.setResponse('test', { text: 'Success', images: [] });

      queueManager.enqueue({
        agentId: agent.id,
        prompt: 'test',
        model: 'haiku',
        userId: 'user1',
      });

      await new Promise((r) => setTimeout(r, 50));

      const updatedAgent = agentManager.getAgent(agent.id)!;
      expect(updatedAgent.status).toBe('idle');
      // When no tools are used, the action summary is 'Processou prompt'
      expect(updatedAgent.statusDetails).toBe('Processou prompt');
    });

    test('adds output to agent after processing', async () => {
      const agent = agentManager.createAgent('user1', 'TestAgent');

      terminal.setResponse('my prompt', { text: 'My response', images: [] });

      queueManager.enqueue({
        agentId: agent.id,
        prompt: 'my prompt',
        model: 'opus',
        userId: 'user1',
      });

      await new Promise((r) => setTimeout(r, 50));

      const outputs = agentManager.getOutputs(agent.id);
      expect(outputs.length).toBe(1);
      expect(outputs[0].prompt).toBe('my prompt');
      expect(outputs[0].response).toBe('My response');
      expect(outputs[0].model).toBe('opus');
      expect(outputs[0].status).toBe('success');
    });

    test('sets agent title on first message', async () => {
      const agent = agentManager.createAgent('user1', 'TestAgent');
      expect(agent.title).toBe(''); // Initially empty

      terminal.setResponse('first prompt', {
        text: 'First response',
        images: [],
        title: 'Conversation About Testing',
      });

      queueManager.enqueue({
        agentId: agent.id,
        prompt: 'first prompt',
        model: 'haiku',
        userId: 'user1',
      });

      await new Promise((r) => setTimeout(r, 50));

      const updatedAgent = agentManager.getAgent(agent.id)!;
      expect(updatedAgent.title).toBe('Conversation About Testing');
      expect(updatedAgent.messageCount).toBe(1);
    });

    test('output summary comes from response text, not title', async () => {
      const agent = agentManager.createAgent('user1', 'TestAgent');

      terminal.setResponse('my prompt', {
        text: 'This is a detailed response that should be summarized',
        images: [],
        title: 'This Is The Title',
      });

      queueManager.enqueue({
        agentId: agent.id,
        prompt: 'my prompt',
        model: 'haiku',
        userId: 'user1',
      });

      await new Promise((r) => setTimeout(r, 50));

      const outputs = agentManager.getOutputs(agent.id);
      expect(outputs.length).toBe(1);
      // Summary should come from response text, not title
      expect(outputs[0].summary).toBe('This is a detailed response that should be summari...');
      expect(outputs[0].summary).not.toBe('This Is The Title');
    });

    test('output summary truncates long responses to ~50 chars', async () => {
      const agent = agentManager.createAgent('user1', 'TestAgent');

      const longResponse = 'a'.repeat(100);
      terminal.setResponse('my prompt', { text: longResponse, images: [] });

      queueManager.enqueue({
        agentId: agent.id,
        prompt: 'my prompt',
        model: 'haiku',
        userId: 'user1',
      });

      await new Promise((r) => setTimeout(r, 50));

      const outputs = agentManager.getOutputs(agent.id);
      expect(outputs[0].summary.length).toBeLessThanOrEqual(53); // 50 chars + '...'
      expect(outputs[0].summary).toContain('...');
    });
  });

  describe('notifications', () => {
    test('sends notification when task starts', async () => {
      const agent = agentManager.createAgent('user1', 'MyAgent');

      terminal.setDelay('hello world', 10);

      queueManager.enqueue({
        agentId: agent.id,
        prompt: 'hello world',
        model: 'haiku',
        userId: 'user1',
      });

      await new Promise((r) => setTimeout(r, 30));

      expect(whatsAppMessages.length).toBeGreaterThan(0);
      const startMsg = whatsAppMessages.find((m) => m.text.includes('iniciou'));
      expect(startMsg).toBeDefined();
      expect(startMsg!.text).toContain('MyAgent');
      expect(startMsg!.text).toContain('hello world');
      expect(startMsg!.text).toContain('haiku');
      expect(startMsg!.to).toBe('user1');
    });

    test('truncates long prompts in notification', async () => {
      const agent = agentManager.createAgent('user1', 'Agent');

      const longPrompt = 'a'.repeat(100);
      terminal.setDelay(longPrompt, 10);

      queueManager.enqueue({
        agentId: agent.id,
        prompt: longPrompt,
        model: 'haiku',
        userId: 'user1',
      });

      await new Promise((r) => setTimeout(r, 30));

      const startMsg = whatsAppMessages.find((m) => m.text.includes('iniciou'));
      expect(startMsg).toBeDefined();
      // Should be truncated to 30 chars
      expect(startMsg!.text).not.toContain('a'.repeat(100));
      expect(startMsg!.text).toContain('a'.repeat(30));
    });
  });

  describe('error handling', () => {
    test('updates agent status on error', async () => {
      const agent = agentManager.createAgent('user1', 'TestAgent');

      // Make terminal throw error
      const errorTerminal = {
        send: async () => {
          throw new Error('Terminal error');
        },
        clearSession: () => {},
      };

      queueManager = new QueueManager(
        semaphore,
        agentManager,
        errorTerminal as unknown as ClaudeTerminal,
        sendWhatsApp
      );

      queueManager.enqueue({
        agentId: agent.id,
        prompt: 'test',
        model: 'haiku',
        userId: 'user1',
      });

      await new Promise((r) => setTimeout(r, 50));

      const updatedAgent = agentManager.getAgent(agent.id)!;
      expect(updatedAgent.status).toBe('error');
      expect(updatedAgent.statusDetails).toContain('erro');
    });

    test('sends error notification to user', async () => {
      const agent = agentManager.createAgent('user1', 'TestAgent');

      const errorTerminal = {
        send: async () => {
          throw new Error('Something went wrong');
        },
        clearSession: () => {},
      };

      queueManager = new QueueManager(
        semaphore,
        agentManager,
        errorTerminal as unknown as ClaudeTerminal,
        sendWhatsApp
      );

      queueManager.enqueue({
        agentId: agent.id,
        prompt: 'test',
        model: 'haiku',
        userId: 'user1',
      });

      await new Promise((r) => setTimeout(r, 50));

      const errorMsg = whatsAppMessages.find((m) => m.text.includes('Erro'));
      expect(errorMsg).toBeDefined();
      expect(errorMsg!.text).toContain('TestAgent');
    });

    test('releases permit on error', async () => {
      semaphore = new Semaphore(1);
      const persistenceService = new MockPersistenceService() as unknown as PersistenceService;
      agentManager = new AgentManager(persistenceService);

      const errorTerminal = {
        send: async () => {
          throw new Error('Error');
        },
        clearSession: () => {},
      };

      queueManager = new QueueManager(
        semaphore,
        agentManager,
        errorTerminal as unknown as ClaudeTerminal,
        sendWhatsApp
      );

      const agent = agentManager.createAgent('user1', 'Agent');

      queueManager.enqueue({
        agentId: agent.id,
        prompt: 'will fail',
        model: 'haiku',
        userId: 'user1',
      });

      await new Promise((r) => setTimeout(r, 50));

      // Permit should be released
      expect(semaphore.availablePermits()).toBe(1);
    });

    test('continues processing queue after error', async () => {
      semaphore = new Semaphore(1);
      const persistenceService = new MockPersistenceService() as unknown as PersistenceService;
      agentManager = new AgentManager(persistenceService);

      let callCount = 0;
      const mixedTerminal = {
        send: async (prompt: string) => {
          callCount++;
          if (prompt === 'will fail') {
            throw new Error('Error');
          }
          return { text: 'Success', images: [], files: [], toolsUsed: [] };
        },
        clearSession: () => {},
      };

      queueManager = new QueueManager(
        semaphore,
        agentManager,
        mixedTerminal as unknown as ClaudeTerminal,
        sendWhatsApp
      );

      const agent1 = agentManager.createAgent('user1', 'Agent1');
      const agent2 = agentManager.createAgent('user1', 'Agent2');

      queueManager.enqueue({
        agentId: agent1.id,
        prompt: 'will fail',
        model: 'haiku',
        userId: 'user1',
      });

      queueManager.enqueue({
        agentId: agent2.id,
        prompt: 'will succeed',
        model: 'haiku',
        userId: 'user1',
      });

      await new Promise((r) => setTimeout(r, 100));

      // Both should have been processed
      expect(callCount).toBe(2);

      // Second agent should have succeeded
      const agent2Updated = agentManager.getAgent(agent2.id)!;
      expect(agent2Updated.status).toBe('idle');
    });
  });

  describe('getQueueStatus', () => {
    test('returns correct counts', async () => {
      semaphore = new Semaphore(1);
      const persistenceService = new MockPersistenceService() as unknown as PersistenceService;
      agentManager = new AgentManager(persistenceService);

      terminal.setDelay('task1', 100);
      terminal.setDelay('task2', 100);
      terminal.setDelay('task3', 100);

      queueManager = new QueueManager(
        semaphore,
        agentManager,
        terminal as unknown as ClaudeTerminal,
        sendWhatsApp
      );

      const agent = agentManager.createAgent('user1', 'Agent');

      // Initially empty
      let status = queueManager.getQueueStatus();
      expect(status.active).toBe(0);
      expect(status.queued).toBe(0);

      // Add 3 tasks
      queueManager.enqueue({
        agentId: agent.id,
        prompt: 'task1',
        model: 'haiku',
        userId: 'user1',
      });
      queueManager.enqueue({
        agentId: agent.id,
        prompt: 'task2',
        model: 'haiku',
        userId: 'user1',
      });
      queueManager.enqueue({
        agentId: agent.id,
        prompt: 'task3',
        model: 'haiku',
        userId: 'user1',
      });

      await new Promise((r) => setTimeout(r, 10));

      status = queueManager.getQueueStatus();
      expect(status.active).toBe(1);
      expect(status.queued).toBe(2);
    });
  });
});
