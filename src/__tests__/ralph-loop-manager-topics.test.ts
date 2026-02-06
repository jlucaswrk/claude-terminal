// src/__tests__/ralph-loop-manager-topics.test.ts
import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { existsSync, unlinkSync, mkdirSync, rmdirSync, readdirSync } from 'fs';
import { join } from 'path';
import { RalphLoopManager, type LoopProgressCallback, type LoopCompletionCallback, type QueuedRalphMessage } from '../ralph-loop-manager';
import { Semaphore } from '../semaphore';
import { AgentManager } from '../agent-manager';
import { PersistenceService } from '../persistence';
import { ClaudeTerminal } from '../terminal';
import type { Agent, RalphLoopState } from '../types';

// Test file paths
const TEST_STATE_FILE = './test-ralph-topics-state.json';
const TEST_LOOPS_DIR = './test-ralph-topics-loops';
const TEST_PREFS_FILE = './test-ralph-topics-preferences.json';
const TEST_TOPICS_DIR = './test-ralph-topics-topics';

function cleanup() {
  if (existsSync(TEST_STATE_FILE)) unlinkSync(TEST_STATE_FILE);
  if (existsSync(TEST_STATE_FILE + '.bak')) unlinkSync(TEST_STATE_FILE + '.bak');
  if (existsSync(TEST_PREFS_FILE)) unlinkSync(TEST_PREFS_FILE);

  if (existsSync(TEST_LOOPS_DIR)) {
    const files = readdirSync(TEST_LOOPS_DIR);
    for (const file of files) {
      unlinkSync(join(TEST_LOOPS_DIR, file));
    }
    rmdirSync(TEST_LOOPS_DIR);
  }

  if (existsSync(TEST_TOPICS_DIR)) {
    const files = readdirSync(TEST_TOPICS_DIR);
    for (const file of files) {
      unlinkSync(join(TEST_TOPICS_DIR, file));
    }
    rmdirSync(TEST_TOPICS_DIR);
  }
}

function createMockAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'agent-123',
    userId: 'user-456',
    name: 'Test Agent',
    type: 'claude',
    mode: 'ralph',
    emoji: '🤖',
    modelMode: 'sonnet',
    title: 'Test Agent',
    status: 'idle',
    statusDetails: 'Ready',
    priority: 'medium',
    lastActivity: new Date(),
    messageCount: 0,
    outputs: [],
    topics: [],
    createdAt: new Date(),
    ...overrides,
  };
}

describe('RalphLoopManager - Topic Support', () => {
  let semaphore: Semaphore;
  let agentManager: AgentManager;
  let persistence: PersistenceService;
  let loopManager: RalphLoopManager;
  let mockTerminal: ClaudeTerminal;

  beforeEach(() => {
    cleanup();

    semaphore = new Semaphore(2);
    persistence = new PersistenceService(TEST_STATE_FILE, TEST_LOOPS_DIR, TEST_PREFS_FILE, TEST_TOPICS_DIR);
    agentManager = new AgentManager(persistence);

    // Create a mock terminal
    mockTerminal = {
      send: mock(() => Promise.resolve({ text: 'Mock response', sessionId: 'session-123' })),
    } as unknown as ClaudeTerminal;

    loopManager = new RalphLoopManager(semaphore, agentManager, persistence, mockTerminal);
  });

  afterEach(() => {
    cleanup();
  });

  describe('start() with threadId', () => {
    test('creates loop with threadId when provided', () => {
      // Create agent first
      const agent = agentManager.createAgent('user-456', 'Test Agent', undefined, '🤖', 'claude', 'sonnet');

      const loopId = loopManager.start(agent.id, 'Test task', 10, 'sonnet', 12345);

      const loop = loopManager.getLoop(loopId);
      expect(loop).not.toBeNull();
      expect(loop!.threadId).toBe(12345);
    });

    test('creates loop without threadId for backward compatibility', () => {
      const agent = agentManager.createAgent('user-456', 'Test Agent', undefined, '🤖', 'claude', 'sonnet');

      const loopId = loopManager.start(agent.id, 'Test task', 10, 'sonnet');

      const loop = loopManager.getLoop(loopId);
      expect(loop).not.toBeNull();
      expect(loop!.threadId).toBeUndefined();
    });

    test('persists threadId in loop state', () => {
      const agent = agentManager.createAgent('user-456', 'Test Agent', undefined, '🤖', 'claude', 'sonnet');
      const loopId = loopManager.start(agent.id, 'Test task', 10, 'sonnet', 99999);

      // Create new manager to verify persistence
      const newLoopManager = new RalphLoopManager(semaphore, agentManager, persistence, mockTerminal);
      const loop = newLoopManager.getLoop(loopId);

      expect(loop!.threadId).toBe(99999);
    });
  });

  describe('progress callback with threadId', () => {
    test('includes threadId in progress callback', async () => {
      const agent = agentManager.createAgent('user-456', 'Test Agent', undefined, '🤖', 'claude', 'sonnet');

      // Mock terminal to return completion on first iteration
      mockTerminal.send = mock(() => Promise.resolve({
        text: 'Done <promise>COMPLETE</promise>',
        sessionId: 'session-123'
      }));

      const progressCalls: { loopId: string; iteration: number; threadId?: number }[] = [];

      loopManager.setProgressCallback((loopId, iteration, maxIterations, action, threadId) => {
        progressCalls.push({ loopId, iteration, threadId });
      });

      const loopId = loopManager.start(agent.id, 'Test task', 10, 'sonnet', 54321);
      await loopManager.execute(loopId);

      expect(progressCalls.length).toBeGreaterThan(0);
      expect(progressCalls[0].threadId).toBe(54321);
    });

    test('includes undefined threadId when not set', async () => {
      const agent = agentManager.createAgent('user-456', 'Test Agent', undefined, '🤖', 'claude', 'sonnet');

      mockTerminal.send = mock(() => Promise.resolve({
        text: 'Done <promise>COMPLETE</promise>',
        sessionId: 'session-123'
      }));

      const progressCalls: { loopId: string; iteration: number; threadId?: number }[] = [];

      loopManager.setProgressCallback((loopId, iteration, maxIterations, action, threadId) => {
        progressCalls.push({ loopId, iteration, threadId });
      });

      const loopId = loopManager.start(agent.id, 'Test task', 10, 'sonnet');
      await loopManager.execute(loopId);

      expect(progressCalls.length).toBeGreaterThan(0);
      expect(progressCalls[0].threadId).toBeUndefined();
    });
  });

  describe('completion callback', () => {
    test('calls completion callback on successful completion', async () => {
      const agent = agentManager.createAgent('user-456', 'Test Agent', undefined, '🤖', 'claude', 'sonnet');

      mockTerminal.send = mock(() => Promise.resolve({
        text: 'Done <promise>COMPLETE</promise>',
        sessionId: 'session-123'
      }));

      const completionCalls: { loopId: string; status: string; iterations: number; threadId?: number }[] = [];

      loopManager.setCompletionCallback((loopId, status, iterations, threadId) => {
        completionCalls.push({ loopId, status, iterations, threadId });
      });

      const loopId = loopManager.start(agent.id, 'Test task', 10, 'sonnet', 11111);
      await loopManager.execute(loopId);

      expect(completionCalls.length).toBe(1);
      expect(completionCalls[0].status).toBe('completed');
      expect(completionCalls[0].iterations).toBe(1);
      expect(completionCalls[0].threadId).toBe(11111);
    });

    test('calls completion callback on cancel', async () => {
      const agent = agentManager.createAgent('user-456', 'Test Agent', undefined, '🤖', 'claude', 'sonnet');

      const completionCalls: { loopId: string; status: string; iterations: number; threadId?: number }[] = [];

      loopManager.setCompletionCallback((loopId, status, iterations, threadId) => {
        completionCalls.push({ loopId, status, iterations, threadId });
      });

      const loopId = loopManager.start(agent.id, 'Test task', 10, 'sonnet', 22222);
      await loopManager.cancel(loopId);

      expect(completionCalls.length).toBe(1);
      expect(completionCalls[0].status).toBe('cancelled');
      expect(completionCalls[0].threadId).toBe(22222);
    });
  });

  describe('message queueing', () => {
    test('enqueues message for running loop', () => {
      const agent = agentManager.createAgent('user-456', 'Test Agent', undefined, '🤖', 'claude', 'sonnet');
      const loopId = loopManager.start(agent.id, 'Test task', 10, 'sonnet', 33333);

      const result = loopManager.enqueueMessage(loopId, 'Test message', 'user-456');

      expect(result).toBe(true);
      expect(loopManager.getQueueSize(loopId)).toBe(1);
    });

    test('enqueues multiple messages in order', () => {
      const agent = agentManager.createAgent('user-456', 'Test Agent', undefined, '🤖', 'claude', 'sonnet');
      const loopId = loopManager.start(agent.id, 'Test task', 10, 'sonnet');

      loopManager.enqueueMessage(loopId, 'First message', 'user-456');
      loopManager.enqueueMessage(loopId, 'Second message', 'user-456');
      loopManager.enqueueMessage(loopId, 'Third message', 'user-456');

      const messages = loopManager.getQueuedMessages(loopId);

      expect(messages.length).toBe(3);
      expect(messages[0].text).toBe('First message');
      expect(messages[1].text).toBe('Second message');
      expect(messages[2].text).toBe('Third message');
    });

    test('returns false for non-existent loop', () => {
      const result = loopManager.enqueueMessage('non-existent', 'Test message', 'user-456');
      expect(result).toBe(false);
    });

    test('returns false for terminated loop', async () => {
      const agent = agentManager.createAgent('user-456', 'Test Agent', undefined, '🤖', 'claude', 'sonnet');
      const loopId = loopManager.start(agent.id, 'Test task', 10, 'sonnet');

      await loopManager.cancel(loopId);

      const result = loopManager.enqueueMessage(loopId, 'Test message', 'user-456');
      expect(result).toBe(false);
    });

    test('dequeues all messages and clears queue', () => {
      const agent = agentManager.createAgent('user-456', 'Test Agent', undefined, '🤖', 'claude', 'sonnet');
      const loopId = loopManager.start(agent.id, 'Test task', 10, 'sonnet');

      loopManager.enqueueMessage(loopId, 'Message 1', 'user-456');
      loopManager.enqueueMessage(loopId, 'Message 2', 'user-456');

      const messages = loopManager.dequeueMessages(loopId);

      expect(messages.length).toBe(2);
      expect(loopManager.getQueueSize(loopId)).toBe(0);
      expect(loopManager.hasQueuedMessages(loopId)).toBe(false);
    });

    test('hasQueuedMessages returns correct value', () => {
      const agent = agentManager.createAgent('user-456', 'Test Agent', undefined, '🤖', 'claude', 'sonnet');
      const loopId = loopManager.start(agent.id, 'Test task', 10, 'sonnet');

      expect(loopManager.hasQueuedMessages(loopId)).toBe(false);

      loopManager.enqueueMessage(loopId, 'Test message', 'user-456');

      expect(loopManager.hasQueuedMessages(loopId)).toBe(true);
    });
  });

  describe('getLoopByThreadId', () => {
    test('finds loop by thread ID', () => {
      const agent = agentManager.createAgent('user-456', 'Test Agent', undefined, '🤖', 'claude', 'sonnet');
      const loopId = loopManager.start(agent.id, 'Test task', 10, 'sonnet', 44444);

      const foundLoop = loopManager.getLoopByThreadId(agent.id, 44444);

      expect(foundLoop).not.toBeNull();
      expect(foundLoop!.id).toBe(loopId);
      expect(foundLoop!.threadId).toBe(44444);
    });

    test('returns null for non-existent thread ID', () => {
      const agent = agentManager.createAgent('user-456', 'Test Agent', undefined, '🤖', 'claude', 'sonnet');
      loopManager.start(agent.id, 'Test task', 10, 'sonnet', 44444);

      const foundLoop = loopManager.getLoopByThreadId(agent.id, 99999);

      expect(foundLoop).toBeNull();
    });

    test('only finds running or paused loops', async () => {
      const agent = agentManager.createAgent('user-456', 'Test Agent', undefined, '🤖', 'claude', 'sonnet');
      const loopId = loopManager.start(agent.id, 'Test task', 10, 'sonnet', 55555);

      await loopManager.cancel(loopId);

      const foundLoop = loopManager.getLoopByThreadId(agent.id, 55555);

      expect(foundLoop).toBeNull();
    });
  });

  describe('getActiveLoopForAgent', () => {
    test('finds active loop for agent', () => {
      const agent = agentManager.createAgent('user-456', 'Test Agent', undefined, '🤖', 'claude', 'sonnet');
      const loopId = loopManager.start(agent.id, 'Test task', 10, 'sonnet');

      const foundLoop = loopManager.getActiveLoopForAgent(agent.id);

      expect(foundLoop).not.toBeNull();
      expect(foundLoop!.id).toBe(loopId);
    });

    test('returns null when no active loop', async () => {
      const agent = agentManager.createAgent('user-456', 'Test Agent', undefined, '🤖', 'claude', 'sonnet');
      const loopId = loopManager.start(agent.id, 'Test task', 10, 'sonnet');

      await loopManager.cancel(loopId);

      const foundLoop = loopManager.getActiveLoopForAgent(agent.id);

      expect(foundLoop).toBeNull();
    });
  });
});

describe('RalphLoopManager - Backward Compatibility', () => {
  let semaphore: Semaphore;
  let agentManager: AgentManager;
  let persistence: PersistenceService;
  let loopManager: RalphLoopManager;
  let mockTerminal: ClaudeTerminal;

  beforeEach(() => {
    cleanup();

    semaphore = new Semaphore(2);
    persistence = new PersistenceService(TEST_STATE_FILE, TEST_LOOPS_DIR, TEST_PREFS_FILE, TEST_TOPICS_DIR);
    agentManager = new AgentManager(persistence);

    mockTerminal = {
      send: mock(() => Promise.resolve({ text: 'Mock response', sessionId: 'session-123' })),
    } as unknown as ClaudeTerminal;

    loopManager = new RalphLoopManager(semaphore, agentManager, persistence, mockTerminal);
  });

  afterEach(() => {
    cleanup();
  });

  test('works without threadId parameter', () => {
    const agent = agentManager.createAgent('user-456', 'Test Agent', undefined, '🤖', 'claude', 'sonnet');

    // This should work without threadId
    const loopId = loopManager.start(agent.id, 'Test task', 10, 'sonnet');

    const loop = loopManager.getLoop(loopId);
    expect(loop).not.toBeNull();
    expect(loop!.task).toBe('Test task');
    expect(loop!.threadId).toBeUndefined();
  });

  test('works without completion callback', async () => {
    const agent = agentManager.createAgent('user-456', 'Test Agent', undefined, '🤖', 'claude', 'sonnet');

    mockTerminal.send = mock(() => Promise.resolve({
      text: 'Done <promise>COMPLETE</promise>',
      sessionId: 'session-123'
    }));

    const loopId = loopManager.start(agent.id, 'Test task', 10, 'sonnet');

    // Should not throw without completion callback set
    const result = await loopManager.execute(loopId);

    expect(result.status).toBe('completed');
  });

  test('works without progress callback', async () => {
    const agent = agentManager.createAgent('user-456', 'Test Agent', undefined, '🤖', 'claude', 'sonnet');

    mockTerminal.send = mock(() => Promise.resolve({
      text: 'Done <promise>COMPLETE</promise>',
      sessionId: 'session-123'
    }));

    const loopId = loopManager.start(agent.id, 'Test task', 10, 'sonnet');

    // Should not throw without progress callback set
    const result = await loopManager.execute(loopId);

    expect(result.status).toBe('completed');
  });
});
