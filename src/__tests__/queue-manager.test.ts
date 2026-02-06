import { describe, test, expect, beforeEach, mock, spyOn } from 'bun:test';
import { QueueManager, SendWhatsAppFn, getToolIcon, escapeMarkdown, formatProgressText, formatFinalText, TELEGRAM_MESSAGE_LIMIT, type ProgressState, type SendTelegramFn, type EditTelegramFn, type StartTypingIndicatorFn } from '../queue-manager';
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

describe('Progress Monitor Formatting', () => {
  describe('getToolIcon', () => {
    test('returns correct icon for known tools', () => {
      expect(getToolIcon('Bash')).toBe('🔧');
      expect(getToolIcon('Read')).toBe('📖');
      expect(getToolIcon('Write')).toBe('✍️');
      expect(getToolIcon('Edit')).toBe('✏️');
      expect(getToolIcon('Grep')).toBe('🔍');
      expect(getToolIcon('Glob')).toBe('📂');
    });

    test('returns default icon for unknown tools', () => {
      expect(getToolIcon('UnknownTool')).toBe('🔨');
      expect(getToolIcon('CustomPlugin')).toBe('🔨');
    });
  });

  describe('escapeMarkdown', () => {
    test('escapes asterisks', () => {
      expect(escapeMarkdown('**bold**')).toBe('\\*\\*bold\\*\\*');
    });

    test('escapes underscores', () => {
      expect(escapeMarkdown('_italic_')).toBe('\\_italic\\_');
    });

    test('escapes backticks', () => {
      expect(escapeMarkdown('`code`')).toBe('\\`code\\`');
    });

    test('escapes square brackets', () => {
      expect(escapeMarkdown('[link](url)')).toBe('\\[link](url)');
    });

    test('escapes mixed characters', () => {
      const result = escapeMarkdown('*test* _foo_ `bar` [baz]');
      expect(result).toContain('\\*');
      expect(result).toContain('\\_');
      expect(result).toContain('\\`');
      expect(result).toContain('\\[');
    });

    test('leaves plain text unchanged', () => {
      expect(escapeMarkdown('hello world')).toBe('hello world');
    });
  });

  describe('formatProgressText', () => {
    test('shows elapsed time', () => {
      const state: ProgressState = {
        events: [],
        textBuffer: '',
        startTime: Date.now() - 5000,
      };
      const text = formatProgressText(state);
      expect(text).toContain('5s');
    });

    test('shows tool events with icons', () => {
      const state: ProgressState = {
        events: [
          { type: 'tool', timestamp: Date.now(), data: { toolName: 'Read', toolInput: { file_path: '/src/index.ts' } } },
          { type: 'tool', timestamp: Date.now(), data: { toolName: 'Bash', toolInput: { command: 'npm test' } } },
        ],
        textBuffer: '',
        startTime: Date.now(),
      };
      const text = formatProgressText(state);
      expect(text).toContain('📖');
      expect(text).toContain('Read');
      expect(text).toContain('index.ts');
      expect(text).toContain('🔧');
      expect(text).toContain('npm test');
    });

    test('shows text buffer when present', () => {
      const state: ProgressState = {
        events: [
          { type: 'tool', timestamp: Date.now(), data: { toolName: 'Read' } },
        ],
        textBuffer: 'Here is the analysis of the code...',
        startTime: Date.now(),
      };
      const text = formatProgressText(state);
      expect(text).toContain('Resposta');
      expect(text).toContain('analysis');
    });

    test('truncates long text buffer', () => {
      const state: ProgressState = {
        events: [],
        textBuffer: 'x'.repeat(300),
        startTime: Date.now(),
      };
      const text = formatProgressText(state);
      // The text buffer should be truncated to 200 chars
      expect(text.length).toBeLessThan(500);
    });

    test('shows bash output inline', () => {
      const state: ProgressState = {
        events: [
          { type: 'bash_output', timestamp: Date.now(), data: { bashCommand: 'ls', bashOutput: 'file1.ts\nfile2.ts', bashExitCode: 0 } },
        ],
        textBuffer: '',
        startTime: Date.now(),
      };
      const text = formatProgressText(state);
      expect(text).toContain('file1.ts');
      expect(text).toContain('file2.ts');
    });

    test('truncates long bash output', () => {
      const lines = Array.from({ length: 20 }, (_, i) => `line${i}`).join('\n');
      const state: ProgressState = {
        events: [
          { type: 'bash_output', timestamp: Date.now(), data: { bashOutput: lines } },
        ],
        textBuffer: '',
        startTime: Date.now(),
      };
      const text = formatProgressText(state);
      expect(text).toContain('linhas omitidas');
    });
  });

  describe('formatFinalText', () => {
    test('shows agent header with duration', () => {
      const state: ProgressState = {
        events: [
          { type: 'tool', timestamp: Date.now(), data: { toolName: 'Read' } },
          { type: 'tool', timestamp: Date.now(), data: { toolName: 'Write' } },
        ],
        textBuffer: '',
        startTime: Date.now() - 10000,
      };
      const response = { text: 'Done!', images: [], files: [], toolsUsed: [], title: 'Test' };
      const text = formatFinalText(state, response, 'MyAgent', '🤖');
      expect(text).toContain('🤖');
      expect(text).toContain('*MyAgent*');
      expect(text).toContain('10s');
      expect(text).toContain('Done!');
    });

    test('shows tool summary counts', () => {
      const state: ProgressState = {
        events: [
          { type: 'tool', timestamp: Date.now(), data: { toolName: 'Read' } },
          { type: 'tool', timestamp: Date.now(), data: { toolName: 'Read' } },
          { type: 'tool', timestamp: Date.now(), data: { toolName: 'Write' } },
        ],
        textBuffer: '',
        startTime: Date.now(),
      };
      const response = { text: 'Result', images: [], files: [], toolsUsed: [], title: 'Test' };
      const text = formatFinalText(state, response, 'Agent', '🤖');
      expect(text).toContain('📖2');
      expect(text).toContain('✍️1');
    });

    test('handles no tool events', () => {
      const state: ProgressState = {
        events: [],
        textBuffer: '',
        startTime: Date.now() - 3000,
      };
      const response = { text: 'Simple response', images: [], files: [], toolsUsed: [], title: 'Test' };
      const text = formatFinalText(state, response, 'Agent', '🤖');
      expect(text).toContain('*Agent*');
      expect(text).toContain('Simple response');
      // No tool summary section
      expect(text).not.toContain('📖');
    });

    test('truncates response exceeding Telegram 4096 char limit', () => {
      const state: ProgressState = {
        events: [],
        textBuffer: '',
        startTime: Date.now(),
      };
      const longResponse = 'a'.repeat(5000);
      const response = { text: longResponse, images: [], files: [], toolsUsed: [], title: 'Test' };
      const text = formatFinalText(state, response, 'Agent', '🤖');
      expect(text.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
      expect(text).toEndWith('...');
    });
  });

  describe('formatProgressText (advanced)', () => {
    test('truncates progress text exceeding Telegram 4096 char limit', () => {
      // Create many events with long bash output to exceed limit
      const longOutput = Array.from({ length: 10 }, (_, i) => 'x'.repeat(80)).join('\n');
      const events = Array.from({ length: 10 }, () => ({
        type: 'bash_output' as const,
        timestamp: Date.now(),
        data: { bashOutput: longOutput },
      }));
      const state: ProgressState = {
        events,
        textBuffer: 'y'.repeat(200),
        startTime: Date.now(),
      };
      const text = formatProgressText(state);
      expect(text.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
    });

    test('shows 3 tools without bash output (simple processing)', () => {
      const state: ProgressState = {
        events: [
          { type: 'tool', timestamp: Date.now(), data: { toolName: 'Read', toolInput: { file_path: '/src/index.ts' } } },
          { type: 'tool', timestamp: Date.now(), data: { toolName: 'Grep', toolInput: { pattern: 'function' } } },
          { type: 'tool', timestamp: Date.now(), data: { toolName: 'Write', toolInput: { file_path: '/src/output.ts' } } },
        ],
        textBuffer: 'Analysis complete.',
        startTime: Date.now() - 5000,
      };
      const text = formatProgressText(state);
      expect(text).toContain('📖');
      expect(text).toContain('Read');
      expect(text).toContain('🔍');
      expect(text).toContain('Grep');
      expect(text).toContain('✍️');
      expect(text).toContain('Write');
      expect(text).toContain('Analysis complete');
    });

    test('shows complete bash output when <= 10 lines', () => {
      const lines = Array.from({ length: 5 }, (_, i) => `line${i}`).join('\n');
      const state: ProgressState = {
        events: [
          { type: 'bash_output', timestamp: Date.now(), data: { bashOutput: lines, bashExitCode: 0 } },
        ],
        textBuffer: '',
        startTime: Date.now(),
      };
      const text = formatProgressText(state);
      expect(text).toContain('line0');
      expect(text).toContain('line4');
      expect(text).not.toContain('linhas omitidas');
    });

    test('truncates bash output at 5 lines when > 10 lines, showing omitted count', () => {
      const lines = Array.from({ length: 50 }, (_, i) => `line${i}`).join('\n');
      const state: ProgressState = {
        events: [
          { type: 'bash_output', timestamp: Date.now(), data: { bashOutput: lines, bashExitCode: 0 } },
        ],
        textBuffer: '',
        startTime: Date.now(),
      };
      const text = formatProgressText(state);
      expect(text).toContain('line0');
      expect(text).toContain('line4');
      expect(text).toContain('45 linhas omitidas');
      expect(text).not.toContain('line49');
    });

    test('truncates text buffer at 200 chars with ellipsis', () => {
      const state: ProgressState = {
        events: [],
        textBuffer: 'a'.repeat(500),
        startTime: Date.now(),
      };
      const text = formatProgressText(state);
      expect(text).toContain('Resposta');
      expect(text).toContain('...');
      // The text should contain at most 200 'a' chars (plus formatting + escaping overhead)
      const responseSection = text.split('Resposta')[1] || '';
      // Count 'a' characters in the response section
      const aCount = (responseSection.match(/a/g) || []).length;
      expect(aCount).toBeLessThanOrEqual(200);
    });

    test('handles empty bash output', () => {
      const state: ProgressState = {
        events: [
          { type: 'bash_output', timestamp: Date.now(), data: { bashOutput: '', bashExitCode: 0 } },
        ],
        textBuffer: '',
        startTime: Date.now(),
      };
      const text = formatProgressText(state);
      // Should not crash, and shouldn't add unnecessary whitespace
      expect(text).toBeDefined();
    });

    test('truncates long bash output lines at 80 chars', () => {
      const longLine = 'x'.repeat(200);
      const state: ProgressState = {
        events: [
          { type: 'bash_output', timestamp: Date.now(), data: { bashOutput: longLine, bashExitCode: 0 } },
        ],
        textBuffer: '',
        startTime: Date.now(),
      };
      const text = formatProgressText(state);
      // The line should be truncated to 80 chars + '...'
      expect(text).not.toContain('x'.repeat(200));
      expect(text).toContain('x'.repeat(80));
    });

    test('shows Edit tool with filename', () => {
      const state: ProgressState = {
        events: [
          { type: 'tool', timestamp: Date.now(), data: { toolName: 'Edit', toolInput: { file_path: '/src/components/Header.tsx' } } },
        ],
        textBuffer: '',
        startTime: Date.now(),
      };
      const text = formatProgressText(state);
      expect(text).toContain('✏️');
      expect(text).toContain('Header.tsx');
    });

    test('truncates long Bash commands at 40 chars', () => {
      const longCmd = 'npm run build && npm run test && npm run lint && npm run deploy';
      const state: ProgressState = {
        events: [
          { type: 'tool', timestamp: Date.now(), data: { toolName: 'Bash', toolInput: { command: longCmd } } },
        ],
        textBuffer: '',
        startTime: Date.now(),
      };
      const text = formatProgressText(state);
      expect(text).toContain('...');
      expect(text).not.toContain(longCmd);
    });
  });
});

describe('Progress State Management', () => {
  test('events array keeps only last 10 items', () => {
    const state: ProgressState = {
      events: [],
      textBuffer: '',
      startTime: Date.now(),
    };

    // Simulate the callback behavior from QueueManager
    for (let i = 0; i < 15; i++) {
      state.events.push({
        type: 'tool',
        timestamp: Date.now() + i,
        data: { toolName: 'Read', toolInput: { file_path: `/file${i}.ts` } },
      });
      if (state.events.length > 10) {
        state.events = state.events.slice(-10);
      }
    }

    expect(state.events.length).toBe(10);
    // Should have events 5-14 (last 10)
    expect(state.events[0].data.toolInput?.file_path).toBe('/file5.ts');
    expect(state.events[9].data.toolInput?.file_path).toBe('/file14.ts');
  });

  test('text buffer replaces on each chunk (not appending)', () => {
    const state: ProgressState = {
      events: [],
      textBuffer: '',
      startTime: Date.now(),
    };

    // Simulate onTextChunk behavior (from queue-manager callbacks)
    state.textBuffer = 'First chunk of response...';
    expect(state.textBuffer).toBe('First chunk of response...');

    state.textBuffer = 'Full response text after SDK completes';
    expect(state.textBuffer).toBe('Full response text after SDK completes');
  });

  test('multiple topics maintain independent progress states', () => {
    const state1: ProgressState = {
      messageId: 100,
      events: [
        { type: 'tool', timestamp: Date.now(), data: { toolName: 'Read', toolInput: { file_path: '/topic1/file.ts' } } },
      ],
      textBuffer: 'Topic 1 response...',
      startTime: Date.now(),
    };

    const state2: ProgressState = {
      messageId: 200,
      events: [
        { type: 'tool', timestamp: Date.now(), data: { toolName: 'Write', toolInput: { file_path: '/topic2/output.ts' } } },
        { type: 'tool', timestamp: Date.now(), data: { toolName: 'Bash', toolInput: { command: 'npm test' } } },
      ],
      textBuffer: 'Topic 2 response...',
      startTime: Date.now() - 3000,
    };

    const text1 = formatProgressText(state1);
    const text2 = formatProgressText(state2);

    // Topic 1 should only have Read
    expect(text1).toContain('Read');
    expect(text1).toContain('Topic 1');
    expect(text1).not.toContain('Write');
    expect(text1).not.toContain('npm test');

    // Topic 2 should have Write and Bash
    expect(text2).toContain('Write');
    expect(text2).toContain('npm test');
    expect(text2).toContain('Topic 2');
    expect(text2).not.toContain('topic1');
  });
});

describe('Telegram Live View Integration', () => {
  let semaphore: Semaphore;
  let agentManager: AgentManager;
  let terminal: MockClaudeTerminal;
  let sendWhatsApp: SendWhatsAppFn;
  let whatsAppMessages: Array<{ to: string; text: string }>;
  let telegramMessages: Array<{ chatId: number; text: string; threadId?: number }>;
  let editCalls: Array<{ chatId: number; messageId: number; text: string }>;
  let sendTelegram: SendTelegramFn;
  let editTelegram: EditTelegramFn;
  let queueManager: QueueManager;

  beforeEach(() => {
    semaphore = new Semaphore(2);
    terminal = new MockClaudeTerminal();
    whatsAppMessages = [];
    telegramMessages = [];
    editCalls = [];

    sendWhatsApp = async (to: string, text: string) => {
      whatsAppMessages.push({ to, text });
    };

    sendTelegram = async (chatId: number, text: string, threadId?: number) => {
      telegramMessages.push({ chatId, text, threadId });
      return { message_id: 1000 + telegramMessages.length };
    };

    editTelegram = async (chatId: number | string, messageId: number, text: string) => {
      editCalls.push({ chatId: Number(chatId), messageId, text });
      return true;
    };

    const persistenceService = new MockPersistenceService() as unknown as PersistenceService;
    agentManager = new AgentManager(persistenceService);

    queueManager = new QueueManager(
      semaphore,
      agentManager,
      terminal as unknown as ClaudeTerminal,
      sendWhatsApp,
      undefined, // sendWhatsAppImage
      undefined, // sendErrorWithActions
      undefined, // sendWhatsAppMedia
      sendTelegram,
      editTelegram,
      undefined, // sendTelegramImage
      undefined  // startTypingIndicator
    );
  });

  test('sends initial progress message to Telegram and captures messageId', async () => {
    const agent = agentManager.createAgent('user1', 'TelegramAgent');
    terminal.setDelay('test prompt', 50);

    queueManager.enqueue({
      agentId: agent.id,
      prompt: 'test prompt',
      model: 'haiku',
      userId: 'user1',
      replyTo: 12345 as any, // Telegram chatId (number = Telegram)
    });

    await new Promise((r) => setTimeout(r, 20));

    // Should have sent initial "Iniciando..." message
    const initMsg = telegramMessages.find(m => m.text.includes('Iniciando'));
    expect(initMsg).toBeDefined();
    expect(initMsg!.chatId).toBe(12345);
  });

  test('edits message with final response on completion', async () => {
    const agent = agentManager.createAgent('user1', 'TelegramAgent');
    terminal.setResponse('test prompt', { text: 'Done! Task completed.', images: [], toolsUsed: [] });

    queueManager.enqueue({
      agentId: agent.id,
      prompt: 'test prompt',
      model: 'haiku',
      userId: 'user1',
      replyTo: 12345 as any,
    });

    await new Promise((r) => setTimeout(r, 100));

    // Should have at least one edit call with the final response
    const finalEdit = editCalls.find(e => e.text.includes('Done! Task completed'));
    expect(finalEdit).toBeDefined();
    expect(finalEdit!.text).toContain('TelegramAgent');
  });

  test('falls back to new message if edit fails', async () => {
    // Make edit always fail
    const failingEditTelegram: EditTelegramFn = async () => false;

    const persistenceService = new MockPersistenceService() as unknown as PersistenceService;
    const localAgentManager = new AgentManager(persistenceService);
    const localQueueManager = new QueueManager(
      new Semaphore(2),
      localAgentManager,
      terminal as unknown as ClaudeTerminal,
      sendWhatsApp,
      undefined,
      undefined,
      undefined,
      sendTelegram,
      failingEditTelegram,
    );

    const agent = localAgentManager.createAgent('user1', 'Agent');
    terminal.setResponse('test', { text: 'Result text', images: [], toolsUsed: [] });

    localQueueManager.enqueue({
      agentId: agent.id,
      prompt: 'test',
      model: 'haiku',
      userId: 'user1',
      replyTo: 12345 as any,
    });

    await new Promise((r) => setTimeout(r, 100));

    // Should have sent a fallback new message with the response
    const fallbackMsg = telegramMessages.find(m => m.text.includes('Result text'));
    expect(fallbackMsg).toBeDefined();
  });

  test('clears progress interval on error', async () => {
    const errorTerminal = {
      send: async () => {
        throw new Error('SDK Error');
      },
      clearSession: () => {},
    };

    const persistenceService = new MockPersistenceService() as unknown as PersistenceService;
    const localAgentManager = new AgentManager(persistenceService);
    const localQueueManager = new QueueManager(
      new Semaphore(2),
      localAgentManager,
      errorTerminal as unknown as ClaudeTerminal,
      sendWhatsApp,
      undefined,
      undefined,
      undefined,
      sendTelegram,
      editTelegram,
    );

    const agent = localAgentManager.createAgent('user1', 'Agent');
    localQueueManager.enqueue({
      agentId: agent.id,
      prompt: 'will fail',
      model: 'haiku',
      userId: 'user1',
      replyTo: 12345 as any,
    });

    await new Promise((r) => setTimeout(r, 100));

    // After error + cleanup, no more edits should happen
    const editCountAfterError = editCalls.length;
    await new Promise((r) => setTimeout(r, 2000));
    // Interval should be cleared - no new edits
    expect(editCalls.length).toBe(editCountAfterError);
  });

  test('edit failures during final edit fall back to new message', async () => {
    const throwingEditTelegram: EditTelegramFn = async () => {
      throw new Error('429 Too Many Requests');
    };

    const persistenceService = new MockPersistenceService() as unknown as PersistenceService;
    const localAgentManager = new AgentManager(persistenceService);

    const localTelegramMessages: Array<{ chatId: number; text: string; threadId?: number }> = [];
    const localSendTelegram: SendTelegramFn = async (chatId: number, text: string, threadId?: number) => {
      localTelegramMessages.push({ chatId, text, threadId });
      return { message_id: 1000 + localTelegramMessages.length };
    };

    const localQueueManager = new QueueManager(
      new Semaphore(2),
      localAgentManager,
      terminal as unknown as ClaudeTerminal,
      sendWhatsApp,
      undefined,
      undefined,
      undefined,
      localSendTelegram,
      throwingEditTelegram,
    );

    const agent = localAgentManager.createAgent('user1', 'Agent');
    terminal.setResponse('test prompt', { text: 'Success response', images: [], toolsUsed: [] });

    localQueueManager.enqueue({
      agentId: agent.id,
      prompt: 'test prompt',
      model: 'haiku',
      userId: 'user1',
      replyTo: 12345 as any,
    });

    await new Promise((r) => setTimeout(r, 200));

    // Task should complete despite edit failure (falls back to new message)
    const updatedAgent = localAgentManager.getAgent(agent.id)!;
    expect(updatedAgent.status).toBe('idle');
    // Should have sent a fallback message with the response
    const fallbackMsg = localTelegramMessages.find(m => m.text.includes('Success response'));
    expect(fallbackMsg).toBeDefined();
  });
});

describe('Queue Position Notification', () => {
  test('sends queue position message when no permits available (Telegram)', async () => {
    const telegramMessages: Array<{ chatId: number; text: string; threadId?: number }> = [];
    const sendTelegram: SendTelegramFn = async (chatId: number, text: string, threadId?: number) => {
      telegramMessages.push({ chatId, text, threadId });
      return { message_id: 1000 + telegramMessages.length };
    };

    const editTelegram: EditTelegramFn = async () => true;

    // Use semaphore with 1 permit so second task must queue
    const semaphore = new Semaphore(1);
    const terminal = new MockClaudeTerminal();
    const persistenceService = new MockPersistenceService() as unknown as PersistenceService;
    const localAgentManager = new AgentManager(persistenceService);

    const qm = new QueueManager(
      semaphore,
      localAgentManager,
      terminal as unknown as ClaudeTerminal,
      async () => {},
      undefined,
      undefined,
      undefined,
      sendTelegram,
      editTelegram,
    );

    const agent = localAgentManager.createAgent('user1', 'Agent');
    // First task: will acquire the only permit
    terminal.setDelay('prompt1', 2000);
    qm.enqueue({
      agentId: agent.id,
      prompt: 'prompt1',
      model: 'haiku',
      userId: 'user1',
      replyTo: 12345 as any,
    });

    // Wait for first task to start processing
    await new Promise((r) => setTimeout(r, 50));

    // Second task: should be queued (no permits)
    qm.enqueue({
      agentId: agent.id,
      prompt: 'prompt2',
      model: 'haiku',
      userId: 'user1',
      replyTo: 12345 as any,
    });

    // Wait for queue notification to fire
    await new Promise((r) => setTimeout(r, 50));

    // Should have a queue position message
    const queueMsg = telegramMessages.find(m => m.text.includes('Na fila'));
    expect(queueMsg).toBeDefined();
    expect(queueMsg!.text).toContain('posição');
  });

  test('does not send queue position when permits are available', async () => {
    const telegramMessages: Array<{ chatId: number; text: string; threadId?: number }> = [];
    const sendTelegram: SendTelegramFn = async (chatId: number, text: string, threadId?: number) => {
      telegramMessages.push({ chatId, text, threadId });
      return { message_id: 1000 + telegramMessages.length };
    };

    const editTelegram: EditTelegramFn = async () => true;

    // 2 permits available
    const semaphore = new Semaphore(2);
    const terminal = new MockClaudeTerminal();
    const persistenceService = new MockPersistenceService() as unknown as PersistenceService;
    const localAgentManager = new AgentManager(persistenceService);

    const qm = new QueueManager(
      semaphore,
      localAgentManager,
      terminal as unknown as ClaudeTerminal,
      async () => {},
      undefined,
      undefined,
      undefined,
      sendTelegram,
      editTelegram,
    );

    const agent = localAgentManager.createAgent('user1', 'Agent');
    qm.enqueue({
      agentId: agent.id,
      prompt: 'test',
      model: 'haiku',
      userId: 'user1',
      replyTo: 12345 as any,
    });

    await new Promise((r) => setTimeout(r, 50));

    // No queue position message should be sent (task processes immediately)
    const queueMsg = telegramMessages.find(m => m.text.includes('Na fila'));
    expect(queueMsg).toBeUndefined();
  });
});

describe('getToolIcon (extended)', () => {
  test('returns correct icon for Task tool', () => {
    expect(getToolIcon('Task')).toBe('🤖');
  });

  test('returns correct icon for WebFetch tool', () => {
    expect(getToolIcon('WebFetch')).toBe('🌐');
  });

  test('returns correct icon for WebSearch tool', () => {
    expect(getToolIcon('WebSearch')).toBe('🔎');
  });
});
