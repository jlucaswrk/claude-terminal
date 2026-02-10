import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { QueueManager, type SendTelegramFn, type SendTelegramImageFn, type StartTypingIndicatorFn } from '../queue-manager';
import { Semaphore } from '../semaphore';
import { AgentManager } from '../agent-manager';
import { ClaudeTerminal } from '../terminal';
import { PersistenceService } from '../persistence';

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

describe('QueueManager - Task Cancellation and Position', () => {
  let semaphore: Semaphore;
  let agentManager: AgentManager;
  let terminal: MockClaudeTerminal;
  let mockSendTelegram: SendTelegramFn;
  let mockSendTelegramImage: SendTelegramImageFn;
  let mockStartTypingIndicator: StartTypingIndicatorFn;
  let queueManager: QueueManager;

  beforeEach(() => {
    semaphore = new Semaphore(1); // Use 1 permit to test queuing
    terminal = new MockClaudeTerminal();
    mockSendTelegram = async () => {};
    mockSendTelegramImage = async () => {};
    mockStartTypingIndicator = () => () => {};

    const persistenceService = new MockPersistenceService() as unknown as PersistenceService;
    agentManager = new AgentManager(persistenceService);

    queueManager = new QueueManager(
      semaphore,
      agentManager,
      terminal as unknown as ClaudeTerminal,
      mockSendTelegram,
      mockSendTelegramImage,
      mockStartTypingIndicator
    );
  });

  describe('cancelTask', () => {
    test('returns true when task is cancelled from queue', async () => {
      // Set up a blocking first task
      terminal.setDelay('blocker', 100);
      terminal.setDelay('to_cancel', 10);

      const agent = agentManager.createAgent('user1', 'TestAgent');

      // Enqueue blocking task first
      queueManager.enqueue({
        agentId: agent.id,
        prompt: 'blocker',
        model: 'haiku',
        userId: 'user1',
      });

      // Wait for blocker to start
      await new Promise((r) => setTimeout(r, 10));

      // Enqueue second task
      const task = queueManager.enqueue({
        agentId: agent.id,
        prompt: 'to_cancel',
        model: 'haiku',
        userId: 'user1',
      });

      // Cancel the queued task
      const result = queueManager.cancelTask(task.id);
      expect(result).toBe(true);

      // Verify task is no longer in queue
      const pending = queueManager.getPendingTasks();
      expect(pending.find(t => t.id === task.id)).toBeUndefined();
    });

    test('returns false when task does not exist', () => {
      const result = queueManager.cancelTask('non-existent-task-id');
      expect(result).toBe(false);
    });

    test('returns false when task is already processing', async () => {
      terminal.setDelay('processing', 100);

      const agent = agentManager.createAgent('user1', 'TestAgent');

      const task = queueManager.enqueue({
        agentId: agent.id,
        prompt: 'processing',
        model: 'haiku',
        userId: 'user1',
      });

      // Wait for task to start processing
      await new Promise((r) => setTimeout(r, 10));

      // Try to cancel - should fail since it's processing (not in queue)
      const result = queueManager.cancelTask(task.id);
      expect(result).toBe(false);
    });
  });

  describe('getTaskPosition', () => {
    test('returns correct position for queued task', async () => {
      terminal.setDelay('blocker', 200);
      terminal.setDelay('task1', 10);
      terminal.setDelay('task2', 10);
      terminal.setDelay('task3', 10);

      const agent = agentManager.createAgent('user1', 'TestAgent');

      // Enqueue blocking task first
      queueManager.enqueue({
        agentId: agent.id,
        prompt: 'blocker',
        model: 'haiku',
        userId: 'user1',
      });

      // Wait for blocker to start
      await new Promise((r) => setTimeout(r, 10));

      // Enqueue more tasks
      const task1 = queueManager.enqueue({
        agentId: agent.id,
        prompt: 'task1',
        model: 'haiku',
        userId: 'user1',
      });

      const task2 = queueManager.enqueue({
        agentId: agent.id,
        prompt: 'task2',
        model: 'haiku',
        userId: 'user1',
      });

      const task3 = queueManager.enqueue({
        agentId: agent.id,
        prompt: 'task3',
        model: 'haiku',
        userId: 'user1',
      });

      // Check positions (1-indexed)
      expect(queueManager.getTaskPosition(task1.id)).toBe(1);
      expect(queueManager.getTaskPosition(task2.id)).toBe(2);
      expect(queueManager.getTaskPosition(task3.id)).toBe(3);
    });

    test('returns undefined for non-existent task', () => {
      const position = queueManager.getTaskPosition('non-existent');
      expect(position).toBeUndefined();
    });

    test('returns undefined for task that is processing', async () => {
      terminal.setDelay('processing', 100);

      const agent = agentManager.createAgent('user1', 'TestAgent');

      const task = queueManager.enqueue({
        agentId: agent.id,
        prompt: 'processing',
        model: 'haiku',
        userId: 'user1',
      });

      // Wait for task to start processing
      await new Promise((r) => setTimeout(r, 10));

      // Position should be undefined since task left the queue
      const position = queueManager.getTaskPosition(task.id);
      expect(position).toBeUndefined();
    });
  });

  describe('isTaskActive', () => {
    test('returns true when task is processing', async () => {
      terminal.setDelay('processing', 100);

      const agent = agentManager.createAgent('user1', 'TestAgent');

      const task = queueManager.enqueue({
        agentId: agent.id,
        prompt: 'processing',
        model: 'haiku',
        userId: 'user1',
      });

      // Wait for task to start processing
      await new Promise((r) => setTimeout(r, 10));

      expect(queueManager.isTaskActive(task.id)).toBe(true);
    });

    test('returns false when task is in queue', async () => {
      terminal.setDelay('blocker', 200);
      terminal.setDelay('queued', 10);

      const agent = agentManager.createAgent('user1', 'TestAgent');

      queueManager.enqueue({
        agentId: agent.id,
        prompt: 'blocker',
        model: 'haiku',
        userId: 'user1',
      });

      await new Promise((r) => setTimeout(r, 10));

      const queuedTask = queueManager.enqueue({
        agentId: agent.id,
        prompt: 'queued',
        model: 'haiku',
        userId: 'user1',
      });

      expect(queueManager.isTaskActive(queuedTask.id)).toBe(false);
    });

    test('returns false after task completes', async () => {
      terminal.setDelay('quick', 10);

      const agent = agentManager.createAgent('user1', 'TestAgent');

      const task = queueManager.enqueue({
        agentId: agent.id,
        prompt: 'quick',
        model: 'haiku',
        userId: 'user1',
      });

      // Wait for task to complete
      await new Promise((r) => setTimeout(r, 50));

      expect(queueManager.isTaskActive(task.id)).toBe(false);
    });
  });
});

describe('QueueManager - Typing Indicator Integration', () => {
  let semaphore: Semaphore;
  let agentManager: AgentManager;
  let terminal: MockClaudeTerminal;
  let queueManager: QueueManager;
  let typingStarted: number[];
  let typingStopped: number;

  beforeEach(() => {
    semaphore = new Semaphore(1);
    terminal = new MockClaudeTerminal();
    typingStarted = [];
    typingStopped = 0;

    const mockStartTypingIndicator: StartTypingIndicatorFn = (chatId: number) => {
      typingStarted.push(chatId);
      return () => {
        typingStopped++;
      };
    };

    const persistenceService = new MockPersistenceService() as unknown as PersistenceService;
    agentManager = new AgentManager(persistenceService);

    queueManager = new QueueManager(
      semaphore,
      agentManager,
      terminal as unknown as ClaudeTerminal,
      async () => {},
      async () => {},
      mockStartTypingIndicator
    );
  });

  test('starts typing indicator for Telegram tasks', async () => {
    terminal.setDelay('test', 50);

    const agent = agentManager.createAgent('user1', 'TelegramAgent');

    queueManager.enqueue({
      agentId: agent.id,
      prompt: 'test',
      model: 'haiku',
      userId: 'user1',
      replyTo: 12345, // number indicates Telegram
    });

    // Wait for task to start
    await new Promise((r) => setTimeout(r, 20));

    expect(typingStarted).toContain(12345);
  });

  test('stops typing indicator after task completes', async () => {
    terminal.setDelay('test', 20);

    const agent = agentManager.createAgent('user1', 'TelegramAgent');

    queueManager.enqueue({
      agentId: agent.id,
      prompt: 'test',
      model: 'haiku',
      userId: 'user1',
      replyTo: 12345,
    });

    // Wait for task to complete
    await new Promise((r) => setTimeout(r, 80));

    expect(typingStopped).toBeGreaterThan(0);
  });

  test('does not use typing indicator for non-Telegram tasks', async () => {
    terminal.setDelay('test', 20);

    const agent = agentManager.createAgent('user1', 'NonTelegramAgent');

    queueManager.enqueue({
      agentId: agent.id,
      prompt: 'test',
      model: 'haiku',
      userId: 'user1',
      // No replyTo or non-number replyTo means no typing indicator
    });

    // Wait for task to complete
    await new Promise((r) => setTimeout(r, 80));

    expect(typingStarted.length).toBe(0);
  });

  test('stops typing indicator on error', async () => {
    // Make terminal throw error
    const errorTerminal = {
      send: async () => {
        throw new Error('Test error');
      },
      clearSession: () => {},
    };

    const errorStartTypingIndicator: StartTypingIndicatorFn = (chatId: number) => {
      typingStarted.push(chatId);
      return () => {
        typingStopped++;
      };
    };

    const persistenceService = new MockPersistenceService() as unknown as PersistenceService;
    const errorAgentManager = new AgentManager(persistenceService);

    const errorQueueManager = new QueueManager(
      new Semaphore(1),
      errorAgentManager,
      errorTerminal as unknown as ClaudeTerminal,
      async () => {},
      async () => {},
      errorStartTypingIndicator
    );

    const agent = errorAgentManager.createAgent('user1', 'ErrorAgent');

    errorQueueManager.enqueue({
      agentId: agent.id,
      prompt: 'will fail',
      model: 'haiku',
      userId: 'user1',
      replyTo: 12345,
    });

    // Wait for error to occur
    await new Promise((r) => setTimeout(r, 50));

    expect(typingStopped).toBeGreaterThan(0);
  });
});

describe('QueueManager - Queue Feedback', () => {
  test('enqueue returns task with id for position tracking', () => {
    const semaphore = new Semaphore(1);
    const terminal = new MockClaudeTerminal();
    const persistenceService = new MockPersistenceService() as unknown as PersistenceService;
    const agentManager = new AgentManager(persistenceService);

    terminal.setDelay('blocker', 100);

    const queueManager = new QueueManager(
      semaphore,
      agentManager,
      terminal as unknown as ClaudeTerminal,
      async () => {},
      async () => {},
      () => () => {}
    );

    const agent = agentManager.createAgent('user1', 'TestAgent');

    // Enqueue blocker
    queueManager.enqueue({
      agentId: agent.id,
      prompt: 'blocker',
      model: 'haiku',
      userId: 'user1',
    });

    // Enqueue second task
    const task = queueManager.enqueue({
      agentId: agent.id,
      prompt: 'second',
      model: 'haiku',
      userId: 'user1',
    });

    expect(task.id).toBeDefined();
    expect(typeof task.id).toBe('string');
    expect(task.id.length).toBeGreaterThan(0);
  });
});
