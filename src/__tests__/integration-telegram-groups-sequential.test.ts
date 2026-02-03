/**
 * Integration tests for sequential Telegram group prompts
 *
 * These tests verify that:
 * 1. Groups can be linked to agents via telegramChatId
 * 2. Sequential prompts are routed to the same agent without triggering menus
 * 3. userContextManager.activeAgentId persists across consecutive clearContext() calls
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { AgentManager } from '../agent-manager';
import { TelegramCommandHandler } from '../telegram-command-handler';
import { UserContextManager } from '../user-context-manager';
import { PersistenceService } from '../persistence';
import { unlinkSync, existsSync } from 'fs';

const TEST_STATE_FILE = './.test-telegram-seq-state.json';

describe('Telegram Group Sequential Prompts Integration', () => {
  let persistenceService: PersistenceService;
  let agentManager: AgentManager;
  let telegramHandler: TelegramCommandHandler;
  let userContextManager: UserContextManager;

  beforeEach(() => {
    if (existsSync(TEST_STATE_FILE)) unlinkSync(TEST_STATE_FILE);
    if (existsSync(TEST_STATE_FILE + '.bak')) unlinkSync(TEST_STATE_FILE + '.bak');

    persistenceService = new PersistenceService(TEST_STATE_FILE);
    agentManager = new AgentManager(persistenceService);
    telegramHandler = new TelegramCommandHandler(agentManager);
    userContextManager = new UserContextManager();
  });

  afterEach(() => {
    if (existsSync(TEST_STATE_FILE)) unlinkSync(TEST_STATE_FILE);
    if (existsSync(TEST_STATE_FILE + '.bak')) unlinkSync(TEST_STATE_FILE + '.bak');
  });

  describe('Sequential prompts with fixed model agent', () => {
    it('should route three sequential prompts to the same agent without triggering menu', () => {
      const userId = '5581999999999';
      const chatId = 12345;

      // Create agent with fixed model (no model selection needed)
      const agent = agentManager.createAgent(userId, 'SequentialAgent', undefined, '🔄', 'claude', 'sonnet');
      agentManager.setTelegramChatId(agent.id, chatId);

      // First prompt - simulate handleTelegramMessage behavior
      const route1 = telegramHandler.routeGroupMessage(chatId, userId, 'First prompt: explain recursion');
      expect(route1.action).toBe('prompt');
      expect(route1.agentId).toBe(agent.id);
      if (route1.action === 'prompt') {
        expect(route1.model).toBe('sonnet');
        expect(route1.text).toBe('First prompt: explain recursion');
      }

      // Set active agent (what handleTelegramMessage does after routing)
      userContextManager.setActiveAgent(userId, route1.agentId);
      expect(userContextManager.getActiveAgent(userId)).toBe(agent.id);

      // Simulate prompt completion - clearContext preserves activeAgentId
      userContextManager.clearContext(userId);
      expect(userContextManager.getActiveAgent(userId)).toBe(agent.id);

      // Second prompt - should route to same agent
      const route2 = telegramHandler.routeGroupMessage(chatId, userId, 'Second prompt: show me an example');
      expect(route2.action).toBe('prompt');
      expect(route2.agentId).toBe(agent.id);
      if (route2.action === 'prompt') {
        expect(route2.model).toBe('sonnet');
        expect(route2.text).toBe('Second prompt: show me an example');
      }

      // Active agent still persisted
      expect(userContextManager.getActiveAgent(userId)).toBe(agent.id);

      // Clear context again
      userContextManager.clearContext(userId);
      expect(userContextManager.getActiveAgent(userId)).toBe(agent.id);

      // Third prompt - should still route to same agent
      const route3 = telegramHandler.routeGroupMessage(chatId, userId, 'Third prompt: optimize the code');
      expect(route3.action).toBe('prompt');
      expect(route3.agentId).toBe(agent.id);
      if (route3.action === 'prompt') {
        expect(route3.model).toBe('sonnet');
        expect(route3.text).toBe('Third prompt: optimize the code');
      }

      // Active agent persists through all three prompts
      expect(userContextManager.getActiveAgent(userId)).toBe(agent.id);

      // Final clearContext still preserves activeAgentId
      userContextManager.clearContext(userId);
      expect(userContextManager.getActiveAgent(userId)).toBe(agent.id);
    });

    it('should handle model prefix override in sequential prompts', () => {
      const userId = '5581999999999';
      const chatId = 54321;

      // Create agent with opus fixed model
      const agent = agentManager.createAgent(userId, 'OpusAgent', undefined, '🧠', 'claude', 'opus');
      agentManager.setTelegramChatId(agent.id, chatId);

      // First prompt - uses fixed model
      const route1 = telegramHandler.routeGroupMessage(chatId, userId, 'Complex architecture question');
      expect(route1.action).toBe('prompt');
      if (route1.action === 'prompt') {
        expect(route1.model).toBe('opus');
        expect(route1.agentId).toBe(agent.id);
      }

      userContextManager.setActiveAgent(userId, agent.id);
      userContextManager.clearContext(userId);

      // Second prompt - override with !haiku
      const route2 = telegramHandler.routeGroupMessage(chatId, userId, '!haiku Quick clarification');
      expect(route2.action).toBe('prompt');
      if (route2.action === 'prompt') {
        expect(route2.model).toBe('haiku'); // Override wins
        expect(route2.text).toBe('Quick clarification');
        expect(route2.agentId).toBe(agent.id); // Same agent
      }

      userContextManager.clearContext(userId);

      // Third prompt - back to fixed model
      const route3 = telegramHandler.routeGroupMessage(chatId, userId, 'Another complex question');
      expect(route3.action).toBe('prompt');
      if (route3.action === 'prompt') {
        expect(route3.model).toBe('opus'); // Back to fixed
        expect(route3.agentId).toBe(agent.id);
      }

      // Active agent persists throughout
      expect(userContextManager.getActiveAgent(userId)).toBe(agent.id);
    });
  });

  describe('Sequential prompts with selection mode agent', () => {
    it('should show model selector for first prompt but allow prefix bypass on subsequent prompts', () => {
      const userId = '5581999999999';
      const chatId = 11111;

      // Create agent with selection mode
      const agent = agentManager.createAgent(userId, 'SelectionAgent', undefined, '🎯', 'claude', 'selection');
      agentManager.setTelegramChatId(agent.id, chatId);

      // First prompt without prefix - shows model selector
      const route1 = telegramHandler.routeGroupMessage(chatId, userId, 'First prompt');
      expect(route1.action).toBe('show_model_selector');
      if (route1.action === 'show_model_selector') {
        expect(route1.agentId).toBe(agent.id);
        expect(route1.text).toBe('First prompt');
      }

      userContextManager.setActiveAgent(userId, agent.id);
      userContextManager.clearContext(userId);

      // Second prompt with prefix - bypasses selector
      const route2 = telegramHandler.routeGroupMessage(chatId, userId, '!sonnet Second prompt with model');
      expect(route2.action).toBe('prompt');
      if (route2.action === 'prompt') {
        expect(route2.model).toBe('sonnet');
        expect(route2.text).toBe('Second prompt with model');
        expect(route2.agentId).toBe(agent.id);
      }

      userContextManager.clearContext(userId);

      // Third prompt with different prefix
      const route3 = telegramHandler.routeGroupMessage(chatId, userId, '!opus Third prompt heavy lifting');
      expect(route3.action).toBe('prompt');
      if (route3.action === 'prompt') {
        expect(route3.model).toBe('opus');
        expect(route3.agentId).toBe(agent.id);
      }

      // Active agent persists
      expect(userContextManager.getActiveAgent(userId)).toBe(agent.id);
    });
  });

  describe('clearContext activeAgentId preservation', () => {
    it('should preserve activeAgentId across multiple consecutive clearContext calls', () => {
      const userId = '5581999999999';
      const chatId = 22222;

      const agent = agentManager.createAgent(userId, 'PersistenceTest', undefined, '💾', 'claude', 'haiku');
      agentManager.setTelegramChatId(agent.id, chatId);

      // Set active agent
      userContextManager.setActiveAgent(userId, agent.id);
      expect(userContextManager.getActiveAgent(userId)).toBe(agent.id);

      // First clearContext
      userContextManager.clearContext(userId);
      expect(userContextManager.getActiveAgent(userId)).toBe(agent.id);

      // Second clearContext
      userContextManager.clearContext(userId);
      expect(userContextManager.getActiveAgent(userId)).toBe(agent.id);

      // Third clearContext
      userContextManager.clearContext(userId);
      expect(userContextManager.getActiveAgent(userId)).toBe(agent.id);

      // Fourth clearContext
      userContextManager.clearContext(userId);
      expect(userContextManager.getActiveAgent(userId)).toBe(agent.id);

      // Fifth clearContext
      userContextManager.clearContext(userId);
      expect(userContextManager.getActiveAgent(userId)).toBe(agent.id);
    });

    it('should only clear activeAgentId when clearActiveAgent is explicitly called', () => {
      const userId = '5581999999999';
      const chatId = 33333;

      const agent = agentManager.createAgent(userId, 'ExplicitClearTest', undefined, '🔓', 'claude', 'sonnet');
      agentManager.setTelegramChatId(agent.id, chatId);

      // Set up and process a few prompts
      userContextManager.setActiveAgent(userId, agent.id);

      // Process multiple prompts with clearContext
      for (let i = 0; i < 3; i++) {
        const route = telegramHandler.routeGroupMessage(chatId, userId, `Prompt ${i + 1}`);
        expect(route.agentId).toBe(agent.id);
        userContextManager.clearContext(userId);
        expect(userContextManager.getActiveAgent(userId)).toBe(agent.id);
      }

      // Now explicitly clear the active agent
      userContextManager.clearActiveAgent(userId);
      expect(userContextManager.getActiveAgent(userId)).toBeUndefined();
    });
  });

  describe('Multiple groups with sequential prompts', () => {
    it('should maintain separate activeAgentId per group while routing correctly', () => {
      const userId = '5581999999999';
      const chatId1 = 44444;
      const chatId2 = 55555;

      // Create two agents linked to different groups
      const agent1 = agentManager.createAgent(userId, 'Group1Agent', undefined, '1️⃣', 'claude', 'haiku');
      const agent2 = agentManager.createAgent(userId, 'Group2Agent', undefined, '2️⃣', 'claude', 'opus');
      agentManager.setTelegramChatId(agent1.id, chatId1);
      agentManager.setTelegramChatId(agent2.id, chatId2);

      // Send three prompts to group 1
      const routes1 = [
        telegramHandler.routeGroupMessage(chatId1, userId, 'Group1 Prompt 1'),
        telegramHandler.routeGroupMessage(chatId1, userId, 'Group1 Prompt 2'),
        telegramHandler.routeGroupMessage(chatId1, userId, 'Group1 Prompt 3'),
      ];

      for (const route of routes1) {
        expect(route.action).toBe('prompt');
        expect(route.agentId).toBe(agent1.id);
        if (route.action === 'prompt') {
          expect(route.model).toBe('haiku');
        }
      }

      // Send three prompts to group 2
      const routes2 = [
        telegramHandler.routeGroupMessage(chatId2, userId, 'Group2 Prompt 1'),
        telegramHandler.routeGroupMessage(chatId2, userId, 'Group2 Prompt 2'),
        telegramHandler.routeGroupMessage(chatId2, userId, 'Group2 Prompt 3'),
      ];

      for (const route of routes2) {
        expect(route.action).toBe('prompt');
        expect(route.agentId).toBe(agent2.id);
        if (route.action === 'prompt') {
          expect(route.model).toBe('opus');
        }
      }
    });

    it('should handle interleaved prompts across groups correctly', () => {
      const userId = '5581999999999';
      const chatIdA = 66666;
      const chatIdB = 77777;

      const agentA = agentManager.createAgent(userId, 'AgentA', undefined, 'A', 'claude', 'sonnet');
      const agentB = agentManager.createAgent(userId, 'AgentB', undefined, 'B', 'claude', 'haiku');
      agentManager.setTelegramChatId(agentA.id, chatIdA);
      agentManager.setTelegramChatId(agentB.id, chatIdB);

      // Interleave prompts: A, B, A, B, A
      const routeA1 = telegramHandler.routeGroupMessage(chatIdA, userId, 'A1');
      expect(routeA1.agentId).toBe(agentA.id);
      userContextManager.setActiveAgent(userId, agentA.id);
      userContextManager.clearContext(userId);

      const routeB1 = telegramHandler.routeGroupMessage(chatIdB, userId, 'B1');
      expect(routeB1.agentId).toBe(agentB.id);
      userContextManager.setActiveAgent(userId, agentB.id); // Switches context
      userContextManager.clearContext(userId);

      const routeA2 = telegramHandler.routeGroupMessage(chatIdA, userId, 'A2');
      expect(routeA2.agentId).toBe(agentA.id);
      userContextManager.setActiveAgent(userId, agentA.id); // Switches back
      userContextManager.clearContext(userId);

      const routeB2 = telegramHandler.routeGroupMessage(chatIdB, userId, 'B2');
      expect(routeB2.agentId).toBe(agentB.id);
      userContextManager.setActiveAgent(userId, agentB.id);
      userContextManager.clearContext(userId);

      const routeA3 = telegramHandler.routeGroupMessage(chatIdA, userId, 'A3');
      expect(routeA3.agentId).toBe(agentA.id);
    });
  });

  describe('Edge cases', () => {
    it('should reject prompts from unlinked groups', () => {
      const userId = '5581999999999';
      const linkedChatId = 88888;
      const unlinkedChatId = 99999;

      const agent = agentManager.createAgent(userId, 'LinkedAgent', undefined, '✅', 'claude', 'sonnet');
      agentManager.setTelegramChatId(agent.id, linkedChatId);

      // Linked group works
      const linkedRoute = telegramHandler.routeGroupMessage(linkedChatId, userId, 'Works');
      expect(linkedRoute.action).toBe('prompt');

      // Unlinked group is orphaned
      const unlinkedRoute = telegramHandler.routeGroupMessage(unlinkedChatId, userId, 'Fails');
      expect(unlinkedRoute.action).toBe('orphaned_group');
    });

    it('should ignore prompts from wrong user even after sequential prompts', () => {
      const userId1 = '5581111111111';
      const userId2 = '5582222222222';
      const chatId = 10101;

      // User 1 creates and links agent
      const agent = agentManager.createAgent(userId1, 'User1Agent', undefined, '🔒', 'claude', 'sonnet');
      agentManager.setTelegramChatId(agent.id, chatId);

      // User 1 sends three prompts successfully
      for (let i = 1; i <= 3; i++) {
        const route = telegramHandler.routeGroupMessage(chatId, userId1, `User1 Prompt ${i}`);
        expect(route.action).toBe('prompt');
        expect(route.agentId).toBe(agent.id);
      }

      // User 2 tries to send prompt - should be ignored
      const route = telegramHandler.routeGroupMessage(chatId, userId2, 'User2 trying to hijack');
      expect(route.action).toBe('ignore');
    });

    it('should handle commands interspersed with prompts', () => {
      const userId = '5581999999999';
      const chatId = 20202;

      const agent = agentManager.createAgent(userId, 'CommandAgent', undefined, '⌨️', 'claude', 'sonnet');
      agentManager.setTelegramChatId(agent.id, chatId);

      // Prompt 1
      const route1 = telegramHandler.routeGroupMessage(chatId, userId, 'First prompt');
      expect(route1.action).toBe('prompt');
      expect(route1.agentId).toBe(agent.id);

      userContextManager.setActiveAgent(userId, agent.id);
      userContextManager.clearContext(userId);

      // Command (not a prompt)
      const cmdRoute = telegramHandler.routeGroupMessage(chatId, userId, '/status');
      expect(cmdRoute.action).toBe('command');
      if (cmdRoute.action === 'command') {
        expect(cmdRoute.command).toBe('/status');
      }

      // Active agent should still be set
      expect(userContextManager.getActiveAgent(userId)).toBe(agent.id);

      // Prompt 2 - should still work
      const route2 = telegramHandler.routeGroupMessage(chatId, userId, 'Second prompt after command');
      expect(route2.action).toBe('prompt');
      expect(route2.agentId).toBe(agent.id);

      userContextManager.clearContext(userId);

      // Prompt 3
      const route3 = telegramHandler.routeGroupMessage(chatId, userId, 'Third prompt');
      expect(route3.action).toBe('prompt');
      expect(route3.agentId).toBe(agent.id);
    });
  });

  describe('Full conversation simulation', () => {
    it('should simulate a realistic group conversation flow', () => {
      const userId = '5581999999999';
      const chatId = 30303;

      // Create agent with sonnet fixed model
      const agent = agentManager.createAgent(userId, 'ConversationAgent', undefined, '💬', 'claude', 'sonnet');
      agentManager.setTelegramChatId(agent.id, chatId);

      // Simulate realistic conversation with various message types
      const conversation = [
        { text: 'Hey, can you help me with a React component?', expectModel: 'sonnet' },
        { text: 'It should have a loading state', expectModel: 'sonnet' },
        { text: '!haiku just show me the useState syntax', expectModel: 'haiku' },
        { text: 'Now add error handling', expectModel: 'sonnet' },
        { text: '!opus review the whole component for best practices', expectModel: 'opus' },
        { text: 'Thanks, one more small fix', expectModel: 'sonnet' },
      ];

      for (let i = 0; i < conversation.length; i++) {
        const { text, expectModel } = conversation[i];
        const route = telegramHandler.routeGroupMessage(chatId, userId, text);

        expect(route.action).toBe('prompt');
        expect(route.agentId).toBe(agent.id);
        if (route.action === 'prompt') {
          expect(route.model).toBe(expectModel);
        }

        // Simulate handleTelegramMessage flow
        userContextManager.setActiveAgent(userId, agent.id);

        // Simulate prompt processing completion
        userContextManager.clearContext(userId);

        // Verify activeAgentId persists
        expect(userContextManager.getActiveAgent(userId)).toBe(agent.id);
      }

      // After all messages, agent should still be active
      expect(userContextManager.getActiveAgent(userId)).toBe(agent.id);
      expect(userContextManager.hasActiveAgent(userId)).toBe(true);
    });
  });
});
