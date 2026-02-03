import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { TelegramCommandHandler, type TelegramRouteResult } from './telegram-command-handler';
import { AgentManager } from './agent-manager';
import { GroupOnboardingManager } from './group-onboarding-manager';
import { PersistenceService } from './persistence';
import { existsSync, unlinkSync } from 'fs';
import type { Agent } from './types';

const TEST_STATE_FILE = '/tmp/telegram-handler-test-state.json';

describe('TelegramCommandHandler', () => {
  let handler: TelegramCommandHandler;
  let agentManager: AgentManager;
  let persistenceService: PersistenceService;
  let testAgent: Agent;

  beforeEach(() => {
    // Clean up any existing test file
    if (existsSync(TEST_STATE_FILE)) {
      unlinkSync(TEST_STATE_FILE);
    }
    if (existsSync(TEST_STATE_FILE + '.bak')) {
      unlinkSync(TEST_STATE_FILE + '.bak');
    }

    persistenceService = new PersistenceService(TEST_STATE_FILE);
    agentManager = new AgentManager(persistenceService);

    // Create a test agent
    testAgent = agentManager.createAgent('user123', 'TestAgent', undefined, '🤖', 'claude', 'selection');
    agentManager.setTelegramChatId(testAgent.id, 12345);

    handler = new TelegramCommandHandler(agentManager);
  });

  afterEach(() => {
    // Clean up test files
    if (existsSync(TEST_STATE_FILE)) {
      unlinkSync(TEST_STATE_FILE);
    }
    if (existsSync(TEST_STATE_FILE + '.bak')) {
      unlinkSync(TEST_STATE_FILE + '.bak');
    }
  });

  describe('parseModelPrefix', () => {
    test('should extract !haiku prefix', () => {
      const result = handler.parseModelPrefix('!haiku write a poem');
      expect(result.model).toBe('haiku');
      expect(result.text).toBe('write a poem');
    });

    test('should extract !sonnet prefix', () => {
      const result = handler.parseModelPrefix('!sonnet analyze this code');
      expect(result.model).toBe('sonnet');
      expect(result.text).toBe('analyze this code');
    });

    test('should extract !opus prefix', () => {
      const result = handler.parseModelPrefix('!opus solve this complex problem');
      expect(result.model).toBe('opus');
      expect(result.text).toBe('solve this complex problem');
    });

    test('should handle prefix without text', () => {
      const result = handler.parseModelPrefix('!haiku');
      expect(result.model).toBe('haiku');
      expect(result.text).toBe('');
    });

    test('should not extract prefix when not at start', () => {
      const result = handler.parseModelPrefix('please use !haiku for this');
      expect(result.model).toBeUndefined();
      expect(result.text).toBe('please use !haiku for this');
    });

    test('should be case insensitive', () => {
      const result = handler.parseModelPrefix('!HAIKU test');
      expect(result.model).toBe('haiku');
      expect(result.text).toBe('test');
    });

    test('should not match partial prefix', () => {
      const result = handler.parseModelPrefix('!haikuextra text');
      expect(result.model).toBeUndefined();
      expect(result.text).toBe('!haikuextra text');
    });

    test('should handle text without prefix', () => {
      const result = handler.parseModelPrefix('regular message');
      expect(result.model).toBeUndefined();
      expect(result.text).toBe('regular message');
    });
  });

  describe('detectChatType', () => {
    test('should detect private chat', () => {
      expect(handler.detectChatType('private')).toBe('private');
    });

    test('should detect group chat', () => {
      expect(handler.detectChatType('group')).toBe('group');
    });

    test('should detect supergroup chat', () => {
      expect(handler.detectChatType('supergroup')).toBe('supergroup');
    });

    test('should detect channel', () => {
      expect(handler.detectChatType('channel')).toBe('channel');
    });

    test('should default to private for unknown type', () => {
      expect(handler.detectChatType('unknown')).toBe('private');
    });
  });

  describe('isGroupChat', () => {
    test('should return true for group', () => {
      expect(handler.isGroupChat('group')).toBe(true);
    });

    test('should return true for supergroup', () => {
      expect(handler.isGroupChat('supergroup')).toBe(true);
    });

    test('should return false for private', () => {
      expect(handler.isGroupChat('private')).toBe(false);
    });

    test('should return false for channel', () => {
      expect(handler.isGroupChat('channel')).toBe(false);
    });
  });

  describe('isOrphanedGroup', () => {
    test('should return false for group with linked agent', () => {
      expect(handler.isOrphanedGroup(12345, 'user123')).toBe(false);
    });

    test('should return true for group without linked agent', () => {
      expect(handler.isOrphanedGroup(99999, 'user123')).toBe(true);
    });

    test('should return true for group with agent from different user', () => {
      expect(handler.isOrphanedGroup(12345, 'otherUser')).toBe(true);
    });
  });

  describe('getLinkedAgent', () => {
    test('should return agent for linked chat', () => {
      const agent = handler.getLinkedAgent(12345);
      expect(agent).toBeDefined();
      expect(agent?.name).toBe('TestAgent');
    });

    test('should return undefined for unlinked chat', () => {
      const agent = handler.getLinkedAgent(99999);
      expect(agent).toBeUndefined();
    });
  });

  describe('routeGroupMessage', () => {
    test('should route command to command action', () => {
      const result = handler.routeGroupMessage(12345, 'user123', '/status');
      expect(result.action).toBe('command');
      if (result.action === 'command') {
        expect(result.command).toBe('/status');
        expect(result.args).toBe('');
      }
    });

    test('should route command with args', () => {
      const result = handler.routeGroupMessage(12345, 'user123', '/help foo bar');
      expect(result.action).toBe('command');
      if (result.action === 'command') {
        expect(result.command).toBe('/help');
        expect(result.args).toBe('foo bar');
      }
    });

    test('should detect orphaned group', () => {
      const result = handler.routeGroupMessage(99999, 'user123', 'hello');
      expect(result.action).toBe('orphaned_group');
    });

    test('should ignore messages from wrong user', () => {
      const result = handler.routeGroupMessage(12345, 'otherUser', 'hello');
      expect(result.action).toBe('ignore');
    });

    test('should show model selector for selection mode agent', () => {
      const result = handler.routeGroupMessage(12345, 'user123', 'hello');
      expect(result.action).toBe('show_model_selector');
      if (result.action === 'show_model_selector') {
        expect(result.text).toBe('hello');
        expect(result.agentId).toBe(testAgent.id);
      }
    });

    test('should route directly with model prefix', () => {
      const result = handler.routeGroupMessage(12345, 'user123', '!haiku write a poem');
      expect(result.action).toBe('prompt');
      if (result.action === 'prompt') {
        expect(result.model).toBe('haiku');
        expect(result.text).toBe('write a poem');
        expect(result.agentId).toBe(testAgent.id);
      }
    });

    test('should use fixed model for fixed-mode agent', () => {
      // Create agent with fixed model
      const fixedAgent = agentManager.createAgent('user123', 'FixedAgent', undefined, '⚡', 'claude', 'sonnet');
      agentManager.setTelegramChatId(fixedAgent.id, 54321);

      const result = handler.routeGroupMessage(54321, 'user123', 'hello');
      expect(result.action).toBe('prompt');
      if (result.action === 'prompt') {
        expect(result.model).toBe('sonnet');
        expect(result.text).toBe('hello');
      }
    });
  });

  describe('routeGroupMessage with onboarding locks', () => {
    let groupOnboardingManager: GroupOnboardingManager;
    let handlerWithOnboarding: TelegramCommandHandler;

    beforeEach(() => {
      groupOnboardingManager = new GroupOnboardingManager();
      handlerWithOnboarding = new TelegramCommandHandler(agentManager, groupOnboardingManager);
    });

    test('should return flow_input when same user has onboarding lock', () => {
      const chatId = 99999;
      const telegramUserId = 67890;

      // Start onboarding - this user has the lock
      groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_emoji');

      const result = handlerWithOnboarding.routeGroupMessage(chatId, 'user123', 'some text', telegramUserId);

      expect(result.action).toBe('flow_input');
      if (result.action === 'flow_input') {
        expect(result.text).toBe('some text');
        expect(result.chatId).toBe(chatId);
        expect(result.userId).toBe('user123');
      }
    });

    test('should return group_onboarding_locked when different user sends message', () => {
      const chatId = 99999;
      const lockOwnerUserId = 11111;
      const otherUserId = 22222;

      // Start onboarding with user 11111
      groupOnboardingManager.startOnboarding(chatId, lockOwnerUserId, 'awaiting_emoji');

      // Different user tries to send message
      const result = handlerWithOnboarding.routeGroupMessage(chatId, 'user123', 'some text', otherUserId);

      expect(result.action).toBe('group_onboarding_locked');
      if (result.action === 'group_onboarding_locked') {
        expect(result.chatId).toBe(chatId);
        expect(result.userId).toBe('user123');
        expect(result.lockedByUserId).toBe(lockOwnerUserId);
      }
    });

    test('should route normally when no active onboarding', () => {
      // No onboarding started - should route to orphaned_group for unlinked group
      const result = handlerWithOnboarding.routeGroupMessage(99999, 'user123', 'hello', 67890);
      expect(result.action).toBe('orphaned_group');
    });

    test('should route normally when no telegramUserId provided', () => {
      const chatId = 99999;

      // Start onboarding
      groupOnboardingManager.startOnboarding(chatId, 67890, 'awaiting_emoji');

      // Call without telegramUserId - should use original behavior
      const result = handlerWithOnboarding.routeGroupMessage(chatId, 'user123', 'hello');
      expect(result.action).toBe('orphaned_group');
    });

    test('should route normally without GroupOnboardingManager', () => {
      // Handler without GroupOnboardingManager should use original behavior
      const result = handler.routeGroupMessage(99999, 'user123', 'hello', 67890);
      expect(result.action).toBe('orphaned_group');
    });

    test('should check onboarding lock for linked groups too', () => {
      const chatId = 12345; // Already linked to testAgent in beforeEach
      const telegramUserId = 67890;

      // Start onboarding even though agent is linked
      groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_model_mode');

      // Same user - should return flow_input (not prompt)
      const result = handlerWithOnboarding.routeGroupMessage(chatId, 'user123', 'hello', telegramUserId);
      expect(result.action).toBe('flow_input');
    });

    test('should return group_onboarding_locked for linked group with different user', () => {
      const chatId = 12345; // Already linked to testAgent
      const lockOwnerUserId = 11111;
      const otherUserId = 22222;

      // Start onboarding with user 11111
      groupOnboardingManager.startOnboarding(chatId, lockOwnerUserId, 'awaiting_model_mode');

      // Different user tries to send message
      const result = handlerWithOnboarding.routeGroupMessage(chatId, 'user123', 'hello', otherUserId);
      expect(result.action).toBe('group_onboarding_locked');
    });

    test('should allow commands during onboarding from same user', () => {
      const chatId = 12345;
      const telegramUserId = 67890;

      groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_emoji');

      // Commands should still be detected - but since onboarding check happens first,
      // it returns flow_input for all text from same user during onboarding
      const result = handlerWithOnboarding.routeGroupMessage(chatId, 'user123', '/status', telegramUserId);

      // Even commands return flow_input during onboarding for the lock owner
      expect(result.action).toBe('flow_input');
      if (result.action === 'flow_input') {
        expect(result.text).toBe('/status');
      }
    });

    test('should block commands from different user during onboarding', () => {
      const chatId = 12345;
      const lockOwnerUserId = 11111;
      const otherUserId = 22222;

      groupOnboardingManager.startOnboarding(chatId, lockOwnerUserId, 'awaiting_emoji');

      // Different user tries to send a command
      const result = handlerWithOnboarding.routeGroupMessage(chatId, 'user123', '/status', otherUserId);
      expect(result.action).toBe('group_onboarding_locked');
    });
  });

  describe('routePrivateMessage', () => {
    test('should route command to command action', () => {
      const result = handler.routePrivateMessage(12345, 'user123', '/criar', false);
      expect(result.action).toBe('command');
      if (result.action === 'command') {
        expect(result.command).toBe('/criar');
      }
    });

    test('should route flow input when in flow', () => {
      const result = handler.routePrivateMessage(12345, 'user123', 'Agent Name', true);
      expect(result.action).toBe('flow_input');
      if (result.action === 'flow_input') {
        expect(result.text).toBe('Agent Name');
      }
    });

    test('should reject prompts when not in flow', () => {
      const result = handler.routePrivateMessage(12345, 'user123', 'hello world', false);
      expect(result.action).toBe('reject_private_prompt');
    });
  });

  describe('getUserAgents', () => {
    test('should return agents for user', () => {
      const agents = handler.getUserAgents('user123');
      expect(agents.length).toBe(1);
      expect(agents[0].name).toBe('TestAgent');
    });

    test('should return empty array for user without agents', () => {
      const agents = handler.getUserAgents('unknownUser');
      expect(agents.length).toBe(0);
    });
  });
});
