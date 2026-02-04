// src/__tests__/integration-auto-register-topics.test.ts
/**
 * Integration tests for auto-register external topics feature
 *
 * Tests the complete flow:
 * 1. Message in unknown threadId triggers topic_unregistered
 * 2. setup_topic_* callbacks register the topic
 * 3. Subsequent messages are routed correctly to the registered topic
 */

import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { TelegramCommandHandler } from '../telegram-command-handler';
import { AgentManager } from '../agent-manager';
import { TopicManager, getTopicEmojiForType } from '../topic-manager';
import { PersistenceService } from '../persistence';
import type { AgentTopic, TopicType, TopicStatus } from '../types';
import { existsSync, unlinkSync, mkdirSync, rmdirSync, readdirSync } from 'fs';
import { join } from 'path';

const TEST_STATE_FILE = './test-integration-auto-reg-state.json';
const TEST_LOOPS_DIR = './test-integration-auto-reg-loops';
const TEST_PREFS_FILE = './test-integration-auto-reg-preferences.json';
const TEST_TOPICS_DIR = './test-integration-auto-reg-topics';
const TEST_WORKSPACE = './test-integration-auto-reg-workspace';

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

  if (existsSync(TEST_WORKSPACE)) {
    rmdirSync(TEST_WORKSPACE);
  }
}

function ensureWorkspace() {
  if (!existsSync(TEST_WORKSPACE)) {
    mkdirSync(TEST_WORKSPACE);
  }
}

/**
 * Simulates the callback handler logic from index.ts
 * This is a minimal version for testing the registration flow
 */
function simulateSetupTopicCallback(
  topicManager: TopicManager,
  agentManager: AgentManager,
  callbackData: string,
  userId: string
): { success: boolean; error?: string; topicType?: TopicType } {
  // Parse setup_topic_{type}:{agentId}:{threadId}
  const parts = callbackData.replace('setup_topic_', '').split(':');
  if (parts.length !== 3) {
    return { success: false, error: 'Invalid callback format' };
  }

  const [topicType, agentId, threadIdStr] = parts;
  const threadId = parseInt(threadIdStr, 10);

  // Validate agent ownership
  const agent = agentManager.getAgent(agentId);
  if (!agent) {
    return { success: false, error: 'Agent not found' };
  }
  if (agent.userId !== userId) {
    return { success: false, error: 'Permission denied' };
  }

  // Map callback type to TopicType
  const typeMap: Record<string, TopicType> = {
    'ralph': 'ralph',
    'worktree': 'worktree',
    'session': 'session',
  };

  const type = typeMap[topicType];
  if (!type || isNaN(threadId)) {
    return { success: false, error: 'Invalid topic type or thread ID' };
  }

  // Register the external topic
  const topicName = `Tópico #${threadId}`;
  topicManager.registerExternalTopic(agentId, threadId, type, topicName);

  return { success: true, topicType: type };
}

describe('Integration - Auto-register External Topics', () => {
  let handler: TelegramCommandHandler;
  let agentManager: AgentManager;
  let topicManager: TopicManager;
  let persistence: PersistenceService;

  beforeEach(() => {
    cleanup();
    ensureWorkspace();
    persistence = new PersistenceService(TEST_STATE_FILE, TEST_LOOPS_DIR, TEST_PREFS_FILE, TEST_TOPICS_DIR);
    agentManager = new AgentManager(persistence);
    topicManager = new TopicManager(persistence);
    handler = new TelegramCommandHandler(agentManager, undefined, topicManager);
  });

  afterEach(() => {
    cleanup();
  });

  describe('setup_topic_ralph callback', () => {
    test('registers topic as ralph type', () => {
      const userId = 'user-phone-123';
      agentManager.createAgent(userId, 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const agent = agentManager.listAgents(userId)[0];
      agentManager.setTelegramChatId(agent.id, 12345);

      const threadId = 999;
      const callbackData = `setup_topic_ralph:${agent.id}:${threadId}`;

      const result = simulateSetupTopicCallback(topicManager, agentManager, callbackData, userId);

      expect(result.success).toBe(true);
      expect(result.topicType).toBe('ralph');

      // Verify topic was registered
      const topic = topicManager.getTopicByThreadId(agent.id, threadId);
      expect(topic).toBeDefined();
      expect(topic!.type).toBe('ralph');
      expect(topic!.emoji).toBe('🔄');
    });

    test('subsequent messages route correctly after ralph registration', () => {
      const userId = 'user-phone-123';
      agentManager.createAgent(userId, 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const agent = agentManager.listAgents(userId)[0];
      agentManager.setTelegramChatId(agent.id, 12345);
      agentManager.setMainSessionId(agent.id, 'main-session-abc');

      const threadId = 888;
      const chatId = 12345;

      // First message - should return topic_unregistered
      const firstResult = handler.routeGroupMessage(chatId, userId, 'First message', 111, threadId, true);
      expect(firstResult.action).toBe('topic_unregistered');

      // Simulate callback to register topic as ralph
      simulateSetupTopicCallback(topicManager, agentManager, `setup_topic_ralph:${agent.id}:${threadId}`, userId);

      // Second message - should route correctly
      // Note: Ralph topics without loopId route to prompt, with loopId route to topic_ralph_active
      const secondResult = handler.routeGroupMessage(chatId, userId, 'Second message', 111, threadId, true);
      expect(secondResult.action).toBe('prompt');
      if (secondResult.action === 'prompt') {
        expect(secondResult.threadId).toBe(threadId);
      }
    });
  });

  describe('setup_topic_session callback', () => {
    test('registers topic as session type', () => {
      const userId = 'user-phone-123';
      agentManager.createAgent(userId, 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const agent = agentManager.listAgents(userId)[0];
      agentManager.setTelegramChatId(agent.id, 12345);

      const threadId = 777;
      const callbackData = `setup_topic_session:${agent.id}:${threadId}`;

      const result = simulateSetupTopicCallback(topicManager, agentManager, callbackData, userId);

      expect(result.success).toBe(true);
      expect(result.topicType).toBe('session');

      // Verify topic was registered
      const topic = topicManager.getTopicByThreadId(agent.id, threadId);
      expect(topic).toBeDefined();
      expect(topic!.type).toBe('session');
      expect(topic!.emoji).toBe('💬');
    });

    test('subsequent messages route correctly after session registration', () => {
      const userId = 'user-phone-123';
      agentManager.createAgent(userId, 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const agent = agentManager.listAgents(userId)[0];
      agentManager.setTelegramChatId(agent.id, 12345);
      agentManager.setMainSessionId(agent.id, 'main-session-abc');

      const threadId = 666;
      const chatId = 12345;

      // First message - should return topic_unregistered
      const firstResult = handler.routeGroupMessage(chatId, userId, 'First message', 111, threadId, true);
      expect(firstResult.action).toBe('topic_unregistered');

      // Simulate callback to register topic as session
      simulateSetupTopicCallback(topicManager, agentManager, `setup_topic_session:${agent.id}:${threadId}`, userId);

      // Second message - should route to prompt
      const secondResult = handler.routeGroupMessage(chatId, userId, 'Second message', 111, threadId, true);
      expect(secondResult.action).toBe('prompt');
      if (secondResult.action === 'prompt') {
        expect(secondResult.threadId).toBe(threadId);
      }
    });
  });

  describe('setup_topic_worktree callback', () => {
    test('registers topic as worktree type', () => {
      const userId = 'user-phone-123';
      agentManager.createAgent(userId, 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const agent = agentManager.listAgents(userId)[0];
      agentManager.setTelegramChatId(agent.id, 12345);

      const threadId = 555;
      const callbackData = `setup_topic_worktree:${agent.id}:${threadId}`;

      const result = simulateSetupTopicCallback(topicManager, agentManager, callbackData, userId);

      expect(result.success).toBe(true);
      expect(result.topicType).toBe('worktree');

      // Verify topic was registered
      const topic = topicManager.getTopicByThreadId(agent.id, threadId);
      expect(topic).toBeDefined();
      expect(topic!.type).toBe('worktree');
      expect(topic!.emoji).toBe('🌿');
    });

    test('subsequent messages route correctly after worktree registration', () => {
      const userId = 'user-phone-123';
      agentManager.createAgent(userId, 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const agent = agentManager.listAgents(userId)[0];
      agentManager.setTelegramChatId(agent.id, 12345);
      agentManager.setMainSessionId(agent.id, 'main-session-abc');

      const threadId = 444;
      const chatId = 12345;

      // First message - should return topic_unregistered
      const firstResult = handler.routeGroupMessage(chatId, userId, 'First message', 111, threadId, true);
      expect(firstResult.action).toBe('topic_unregistered');

      // Simulate callback to register topic as worktree
      simulateSetupTopicCallback(topicManager, agentManager, `setup_topic_worktree:${agent.id}:${threadId}`, userId);

      // Second message - should route to prompt
      const secondResult = handler.routeGroupMessage(chatId, userId, 'Second message', 111, threadId, true);
      expect(secondResult.action).toBe('prompt');
      if (secondResult.action === 'prompt') {
        expect(secondResult.threadId).toBe(threadId);
      }
    });
  });

  describe('Callback validation', () => {
    test('rejects callback for non-existent agent', () => {
      const userId = 'user-phone-123';
      const callbackData = 'setup_topic_session:non-existent-agent:999';

      const result = simulateSetupTopicCallback(topicManager, agentManager, callbackData, userId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Agent not found');
    });

    test('rejects callback for wrong user', () => {
      const ownerId = 'user-owner-123';
      const wrongUserId = 'user-wrong-456';

      agentManager.createAgent(ownerId, 'Owner Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const agent = agentManager.listAgents(ownerId)[0];

      const callbackData = `setup_topic_session:${agent.id}:999`;

      const result = simulateSetupTopicCallback(topicManager, agentManager, callbackData, wrongUserId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Permission denied');
    });

    test('rejects callback with invalid format', () => {
      const userId = 'user-phone-123';
      const invalidCallbackData = 'setup_topic_invalidformat';

      const result = simulateSetupTopicCallback(topicManager, agentManager, invalidCallbackData, userId);

      expect(result.success).toBe(false);
    });

    test('rejects callback with invalid topic type', () => {
      const userId = 'user-phone-123';
      agentManager.createAgent(userId, 'Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const agent = agentManager.listAgents(userId)[0];

      const callbackData = `setup_topic_invalid:${agent.id}:999`;

      const result = simulateSetupTopicCallback(topicManager, agentManager, callbackData, userId);

      expect(result.success).toBe(false);
    });
  });

  describe('Complete flow integration', () => {
    test('full flow: unknown topic -> topic_unregistered -> callback -> successful routing', () => {
      const userId = 'user-phone-123';
      const chatId = 12345;
      const threadId = 333;

      // Setup agent
      agentManager.createAgent(userId, 'Flow Test Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const agent = agentManager.listAgents(userId)[0];
      agentManager.setTelegramChatId(agent.id, chatId);
      agentManager.setMainSessionId(agent.id, 'main-session-flow');

      // Step 1: First message to unknown topic -> topic_unregistered
      const step1Result = handler.routeGroupMessage(chatId, userId, 'Hello unknown topic', 111, threadId, true);
      expect(step1Result.action).toBe('topic_unregistered');
      if (step1Result.action === 'topic_unregistered') {
        expect(step1Result.agentId).toBe(agent.id);
        expect(step1Result.threadId).toBe(threadId);
      }

      // Step 2: User clicks "Sessão" button -> callback
      const callbackData = `setup_topic_session:${agent.id}:${threadId}`;
      const step2Result = simulateSetupTopicCallback(topicManager, agentManager, callbackData, userId);
      expect(step2Result.success).toBe(true);

      // Step 3: Topic should now exist
      const topic = topicManager.getTopicByThreadId(agent.id, threadId);
      expect(topic).toBeDefined();
      expect(topic!.type).toBe('session');

      // Step 4: Subsequent messages route correctly
      const step4Result = handler.routeGroupMessage(chatId, userId, 'Hello registered topic', 111, threadId, true);
      expect(step4Result.action).toBe('prompt');
      if (step4Result.action === 'prompt') {
        expect(step4Result.threadId).toBe(threadId);
        expect(step4Result.agentId).toBe(agent.id);
      }
    });

    test('multiple topics can be registered independently', () => {
      const userId = 'user-phone-123';
      const chatId = 12345;

      agentManager.createAgent(userId, 'Multi Topic Agent', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const agent = agentManager.listAgents(userId)[0];
      agentManager.setTelegramChatId(agent.id, chatId);
      agentManager.setMainSessionId(agent.id, 'main-session-multi');

      // Register three different topics with different types
      const topics = [
        { threadId: 100, type: 'session' as TopicType },
        { threadId: 200, type: 'ralph' as TopicType },
        { threadId: 300, type: 'worktree' as TopicType },
      ];

      for (const { threadId, type } of topics) {
        // First message returns topic_unregistered
        const firstResult = handler.routeGroupMessage(chatId, userId, `Message to ${type}`, 111, threadId, true);
        expect(firstResult.action).toBe('topic_unregistered');

        // Register via callback
        simulateSetupTopicCallback(topicManager, agentManager, `setup_topic_${type}:${agent.id}:${threadId}`, userId);
      }

      // Verify all topics are registered with correct types
      for (const { threadId, type } of topics) {
        const topic = topicManager.getTopicByThreadId(agent.id, threadId);
        expect(topic).toBeDefined();
        expect(topic!.type).toBe(type);
        expect(topic!.emoji).toBe(getTopicEmojiForType(type));
      }

      // Verify all topics route correctly
      for (const { threadId } of topics) {
        const result = handler.routeGroupMessage(chatId, userId, 'Test message', 111, threadId, true);
        expect(result.action).toBe('prompt');
      }
    });
  });

  describe('Persistence across manager instances', () => {
    test('registered topics persist across TopicManager instances', () => {
      const userId = 'user-phone-123';
      const chatId = 12345;
      const threadId = 222;

      agentManager.createAgent(userId, 'Persist Test', TEST_WORKSPACE, '🤖', 'claude', 'sonnet');
      const agent = agentManager.listAgents(userId)[0];
      agentManager.setTelegramChatId(agent.id, chatId);

      // Register topic
      simulateSetupTopicCallback(topicManager, agentManager, `setup_topic_session:${agent.id}:${threadId}`, userId);

      // Create new PersistenceService and TopicManager instances to validate disk-backed persistence
      const newPersistence = new PersistenceService(TEST_STATE_FILE, TEST_LOOPS_DIR, TEST_PREFS_FILE, TEST_TOPICS_DIR);
      const newTopicManager = new TopicManager(newPersistence);
      const newHandler = new TelegramCommandHandler(agentManager, undefined, newTopicManager);

      // Topic should still be found
      const topic = newTopicManager.getTopicByThreadId(agent.id, threadId);
      expect(topic).toBeDefined();
      expect(topic!.type).toBe('session');

      // Messages should route correctly with new handler
      agentManager.setMainSessionId(agent.id, 'main-session-persist');
      const result = newHandler.routeGroupMessage(chatId, userId, 'Test', 111, threadId, true);
      expect(result.action).toBe('prompt');
    });
  });
});
