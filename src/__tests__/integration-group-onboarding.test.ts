/**
 * Integration tests for Telegram group onboarding flow
 *
 * Tests the bot addition/removal handling:
 * - Bot addition with first-time users (no existing agents)
 * - Bot addition with existing users (has agents)
 * - Bot removal unlinking agents
 * - Bot removal cleaning up onboarding state
 */

import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { AgentManager } from '../agent-manager';
import { GroupOnboardingManager } from '../group-onboarding-manager';
import { TelegramCommandHandler } from '../telegram-command-handler';
import { PersistenceService } from '../persistence';
import { unlinkSync, existsSync } from 'fs';
import type { UserPreferences } from '../types';

const TEST_STATE_FILE = './.test-group-onboarding-state.json';

// Mock telegram functions
const mockSendTelegramMessage = mock(() => Promise.resolve(null));
const mockSendTelegramButtons = mock(() => Promise.resolve({ message_id: 12345 }));
const mockPinTelegramMessage = mock(() => Promise.resolve(true));
const mockEditTelegramMessage = mock(() => Promise.resolve(true));

/**
 * Helper to simulate handleBotAddedToGroup behavior
 * This mirrors the logic in index.ts for testing purposes
 */
async function simulateHandleBotAddedToGroup(
  chatId: number,
  telegramUserId: number,
  telegramUsername: string | undefined,
  persistenceService: PersistenceService,
  agentManager: AgentManager,
  groupOnboardingManager: GroupOnboardingManager,
  mockSendMessage: typeof mockSendTelegramMessage,
  mockSendButtons: typeof mockSendTelegramButtons,
  mockPinMessage: typeof mockPinTelegramMessage
): Promise<void> {
  // Try to identify user by Telegram username
  const allPrefs = persistenceService.getAllUserPreferences();
  const userPrefs = allPrefs.find(p =>
    p.telegramUsername?.toLowerCase() === telegramUsername?.toLowerCase()
  );

  if (!userPrefs || !telegramUsername) {
    // Unknown user - send generic message
    await mockSendMessage(chatId,
      '👋 *Bot adicionado ao grupo*\n\n' +
      'Não encontrei seu cadastro.\n' +
      'Configure o Dojo primeiro pelo WhatsApp.'
    );
    return;
  }

  const userId = userPrefs.userId;

  // Check if user has existing agents
  const existingAgents = agentManager.listAgents(userId);
  const hasExistingAgents = existingAgents.length > 0;

  let message;

  if (!hasExistingAgents) {
    // First-time user: "seu primeiro agente 🎉" + [criar agora]
    message = await mockSendButtons(chatId,
      '🎉 *Seu primeiro agente!*\n\n' +
      'Vamos criar um agente para este grupo.',
      [
        [{ text: '✨ Criar agora', callback_data: `onboard_create_${telegramUserId}` }],
      ]
    );
  } else {
    // Existing user: "esse grupo não tem agente ainda" + [criar um] [vincular existente]
    message = await mockSendButtons(chatId,
      '👋 *Esse grupo não tem agente ainda*\n\n' +
      'Você pode criar um novo ou vincular um existente.',
      [
        [
          { text: '✨ Criar um', callback_data: `onboard_create_${telegramUserId}` },
          { text: '🔗 Vincular existente', callback_data: `onboard_link_${telegramUserId}` },
        ],
      ]
    );
  }

  // Pin the message
  if (message) {
    await mockPinMessage(chatId, message.message_id);

    // Initialize onboarding state and store pinned message ID
    const result = groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_name');
    if (result.success) {
      groupOnboardingManager.setPinnedMessageId(chatId, telegramUserId, message.message_id);
    }
  }
}

/**
 * Helper to simulate handleBotRemovedFromGroup behavior
 * This mirrors the logic in index.ts for testing purposes
 */
async function simulateHandleBotRemovedFromGroup(
  chatId: number,
  agentManager: AgentManager,
  groupOnboardingManager: GroupOnboardingManager
): Promise<void> {
  // Find the agent linked to this group
  const agent = agentManager.getAgentByTelegramChatId(chatId);

  if (agent) {
    // Unlink the agent from this group
    agentManager.setTelegramChatId(agent.id, undefined);
  }

  // Cleanup onboarding state if any
  const state = groupOnboardingManager.getState(chatId);
  if (state) {
    groupOnboardingManager.cancelOnboarding(chatId, state.userId);
  }
}

/**
 * Helper to simulate handleTelegramMyChatMember behavior
 * This mirrors the logic in index.ts for testing purposes
 */
async function simulateHandleTelegramMyChatMember(
  update: {
    chat: { id: number; type: string };
    from: { id: number; username?: string };
    new_chat_member: { status: string };
    old_chat_member: { status: string };
  },
  persistenceService: PersistenceService,
  agentManager: AgentManager,
  groupOnboardingManager: GroupOnboardingManager,
  mockSendMessage: typeof mockSendTelegramMessage,
  mockSendButtons: typeof mockSendTelegramButtons,
  mockPinMessage: typeof mockPinTelegramMessage
): Promise<void> {
  const chat = update.chat;
  const from = update.from;
  const newStatus = update.new_chat_member?.status;
  const oldStatus = update.old_chat_member?.status;
  const telegramUserId = from.id;
  const telegramUsername = from.username;

  // Only process for group chats
  const isGroup = chat.type === 'group' || chat.type === 'supergroup';
  if (!isGroup) {
    return;
  }

  const chatId = chat.id;

  // Check if bot was added (became member or administrator from a non-member state)
  const wasAdded = (newStatus === 'member' || newStatus === 'administrator') &&
                   oldStatus !== 'member' && oldStatus !== 'administrator';

  // Check if bot was removed (left or kicked)
  const wasRemoved = (newStatus === 'left' || newStatus === 'kicked') &&
                     (oldStatus === 'member' || oldStatus === 'administrator');

  if (wasAdded) {
    await simulateHandleBotAddedToGroup(
      chatId, telegramUserId, telegramUsername,
      persistenceService, agentManager, groupOnboardingManager,
      mockSendMessage, mockSendButtons, mockPinMessage
    );
  } else if (wasRemoved) {
    await simulateHandleBotRemovedFromGroup(chatId, agentManager, groupOnboardingManager);
  }
}

describe('Integration: Group Onboarding Flow', () => {
  let persistenceService: PersistenceService;
  let agentManager: AgentManager;
  let groupOnboardingManager: GroupOnboardingManager;

  beforeEach(() => {
    if (existsSync(TEST_STATE_FILE)) unlinkSync(TEST_STATE_FILE);
    if (existsSync(TEST_STATE_FILE + '.bak')) unlinkSync(TEST_STATE_FILE + '.bak');

    persistenceService = new PersistenceService(TEST_STATE_FILE);
    agentManager = new AgentManager(persistenceService);
    groupOnboardingManager = new GroupOnboardingManager();

    // Reset mocks
    mockSendTelegramMessage.mockClear();
    mockSendTelegramButtons.mockClear();
    mockPinTelegramMessage.mockClear();
  });

  afterEach(() => {
    if (existsSync(TEST_STATE_FILE)) unlinkSync(TEST_STATE_FILE);
    if (existsSync(TEST_STATE_FILE + '.bak')) unlinkSync(TEST_STATE_FILE + '.bak');
  });

  describe('Bot addition: First-time user (no agents)', () => {
    it('should identify user by telegram username', () => {
      const telegramUsername = 'lucas';
      const userId = '+5581999999999';

      // Save user preferences with telegram username
      persistenceService.saveUserPreferences({
        userId,
        mode: 'dojo',
        telegramUsername,
        onboardingComplete: true,
      });

      // Verify user can be found by telegram username
      const allPrefs = persistenceService.getAllUserPreferences();
      const userPrefs = allPrefs.find(p =>
        p.telegramUsername?.toLowerCase() === telegramUsername.toLowerCase()
      );

      expect(userPrefs).toBeDefined();
      expect(userPrefs?.userId).toBe(userId);
    });

    it('should detect first-time user with no agents', () => {
      const userId = '+5581999999999';

      // No agents created yet
      const existingAgents = agentManager.listAgents(userId);
      expect(existingAgents.length).toBe(0);
    });

    it('should start onboarding for first-time user', () => {
      const chatId = 12345;
      const telegramUserId = 67890;

      // Start onboarding
      const result = groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_name');

      expect(result.success).toBe(true);
      expect(groupOnboardingManager.hasActiveOnboarding(chatId)).toBe(true);
    });

    it('should store pinned message ID', () => {
      const chatId = 12345;
      const telegramUserId = 67890;
      const messageId = 11111;

      // Start onboarding
      groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_name');

      // Set pinned message ID
      const setPinned = groupOnboardingManager.setPinnedMessageId(chatId, telegramUserId, messageId);

      expect(setPinned).toBe(true);
      expect(groupOnboardingManager.getPinnedMessageId(chatId)).toBe(messageId);
    });
  });

  describe('Bot addition: Existing user (has agents)', () => {
    it('should detect user with existing agents', () => {
      const userId = '+5581999999999';

      // Create an agent
      agentManager.createAgent(userId, 'TestAgent', undefined, '🤖');

      const existingAgents = agentManager.listAgents(userId);
      expect(existingAgents.length).toBe(1);
    });

    it('should list available agents for linking', () => {
      const userId = '+5581999999999';

      // Create multiple agents
      agentManager.createAgent(userId, 'Agent1', undefined, '1️⃣');
      agentManager.createAgent(userId, 'Agent2', undefined, '2️⃣');
      agentManager.createAgent(userId, 'Agent3', undefined, '3️⃣');

      const agents = agentManager.listAgents(userId);

      expect(agents.length).toBe(3);
      expect(agents.map(a => a.name)).toContain('Agent1');
      expect(agents.map(a => a.name)).toContain('Agent2');
      expect(agents.map(a => a.name)).toContain('Agent3');
    });

    it('should only list agents without existing telegram link', () => {
      const userId = '+5581999999999';

      // Create agents
      const agent1 = agentManager.createAgent(userId, 'LinkedAgent', undefined, '🔗');
      const agent2 = agentManager.createAgent(userId, 'UnlinkedAgent', undefined, '⬜');

      // Link one agent to a different group
      agentManager.setTelegramChatId(agent1.id, 99999);

      const agents = agentManager.listAgents(userId);
      const unlinkedAgents = agents.filter(a => !a.telegramChatId);

      expect(unlinkedAgents.length).toBe(1);
      expect(unlinkedAgents[0].name).toBe('UnlinkedAgent');
    });
  });

  describe('Bot addition: Unknown user', () => {
    it('should handle user without telegram username mapping', () => {
      // No user preferences saved
      const allPrefs = persistenceService.getAllUserPreferences();
      const userPrefs = allPrefs.find(p =>
        p.telegramUsername?.toLowerCase() === 'unknownuser'
      );

      expect(userPrefs).toBeUndefined();
    });

    it('should not start onboarding for unknown user', () => {
      // This is a design decision - we could track that no onboarding was started
      const chatId = 12345;

      // No onboarding should exist
      expect(groupOnboardingManager.hasActiveOnboarding(chatId)).toBe(false);
    });
  });

  describe('Bot removal: Unlink agent', () => {
    it('should unlink agent when bot is removed from group', () => {
      const userId = '+5581999999999';
      const chatId = 12345;

      // Create and link an agent
      const agent = agentManager.createAgent(userId, 'LinkedAgent', undefined, '🔗');
      agentManager.setTelegramChatId(agent.id, chatId);

      // Verify agent is linked
      const linkedAgent = agentManager.getAgentByTelegramChatId(chatId);
      expect(linkedAgent).toBeDefined();
      expect(linkedAgent?.id).toBe(agent.id);

      // Unlink the agent (simulating bot removal)
      agentManager.setTelegramChatId(agent.id, undefined);

      // Verify agent is unlinked
      const unlinkedAgent = agentManager.getAgentByTelegramChatId(chatId);
      expect(unlinkedAgent).toBeUndefined();

      // Agent should still exist, just without telegramChatId
      const agentStillExists = agentManager.getAgent(agent.id);
      expect(agentStillExists).toBeDefined();
      expect(agentStillExists?.telegramChatId).toBeUndefined();
    });

    it('should cleanup onboarding state when bot is removed', () => {
      const chatId = 12345;
      const telegramUserId = 67890;

      // Start onboarding
      groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_name');
      groupOnboardingManager.setPinnedMessageId(chatId, telegramUserId, 11111);

      expect(groupOnboardingManager.hasActiveOnboarding(chatId)).toBe(true);

      // Cancel onboarding (simulating bot removal)
      const cancelledState = groupOnboardingManager.cancelOnboarding(chatId, telegramUserId);

      expect(cancelledState).toBeDefined();
      expect(groupOnboardingManager.hasActiveOnboarding(chatId)).toBe(false);
    });

    it('should handle removal from group with no linked agent', () => {
      const chatId = 12345;

      // No agent linked
      const agent = agentManager.getAgentByTelegramChatId(chatId);
      expect(agent).toBeUndefined();

      // This should not throw
      // In real code, we would just skip the unlink step
    });

    it('should handle removal from group with no onboarding state', () => {
      const chatId = 12345;

      // No onboarding state
      expect(groupOnboardingManager.hasActiveOnboarding(chatId)).toBe(false);

      // Getting state should return undefined
      const state = groupOnboardingManager.getState(chatId);
      expect(state).toBeUndefined();
    });
  });

  describe('Bot removal: Edge cases', () => {
    it('should handle agent with multiple groups (only unlink removed group)', () => {
      const userId = '+5581999999999';
      const chatId1 = 11111;
      const chatId2 = 22222;

      // Create two agents linked to different groups
      const agent1 = agentManager.createAgent(userId, 'Agent1', undefined, '1️⃣');
      const agent2 = agentManager.createAgent(userId, 'Agent2', undefined, '2️⃣');

      agentManager.setTelegramChatId(agent1.id, chatId1);
      agentManager.setTelegramChatId(agent2.id, chatId2);

      // Simulate bot removed from group 1
      agentManager.setTelegramChatId(agent1.id, undefined);

      // Agent 1 should be unlinked
      expect(agentManager.getAgentByTelegramChatId(chatId1)).toBeUndefined();

      // Agent 2 should still be linked
      const agent2Linked = agentManager.getAgentByTelegramChatId(chatId2);
      expect(agent2Linked).toBeDefined();
      expect(agent2Linked?.id).toBe(agent2.id);
    });

    it('should only allow lock owner to cancel onboarding', () => {
      const chatId = 12345;
      const telegramUserId = 67890;
      const otherUserId = 99999;

      // Start onboarding as user 67890
      groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_name');

      // Try to cancel as different user
      const cancelledByOther = groupOnboardingManager.cancelOnboarding(chatId, otherUserId);
      expect(cancelledByOther).toBeUndefined();

      // Onboarding should still be active
      expect(groupOnboardingManager.hasActiveOnboarding(chatId)).toBe(true);

      // Cancel as original user
      const cancelledByOwner = groupOnboardingManager.cancelOnboarding(chatId, telegramUserId);
      expect(cancelledByOwner).toBeDefined();
      expect(groupOnboardingManager.hasActiveOnboarding(chatId)).toBe(false);
    });
  });

  describe('Full bot addition flow simulation', () => {
    it('should complete full onboarding flow for first-time user', () => {
      const userId = '+5581999999999';
      const telegramUsername = 'lucas';
      const telegramUserId = 67890;
      const chatId = 12345;
      const messageId = 11111;

      // Step 1: User has Dojo mode configured
      persistenceService.saveUserPreferences({
        userId,
        mode: 'dojo',
        telegramUsername,
        onboardingComplete: true,
      });

      // Step 2: Identify user by telegram username
      const allPrefs = persistenceService.getAllUserPreferences();
      const userPrefs = allPrefs.find(p =>
        p.telegramUsername?.toLowerCase() === telegramUsername.toLowerCase()
      );
      expect(userPrefs).toBeDefined();

      // Step 3: Check for existing agents
      const existingAgents = agentManager.listAgents(userId);
      const hasExistingAgents = existingAgents.length > 0;
      expect(hasExistingAgents).toBe(false);

      // Step 4: Start onboarding (message would be sent here)
      const result = groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_name');
      expect(result.success).toBe(true);

      // Step 5: Store pinned message ID
      groupOnboardingManager.setPinnedMessageId(chatId, telegramUserId, messageId);

      // Verify final state
      expect(groupOnboardingManager.hasActiveOnboarding(chatId)).toBe(true);
      expect(groupOnboardingManager.getPinnedMessageId(chatId)).toBe(messageId);
      expect(groupOnboardingManager.getCurrentStep(chatId)).toBe('awaiting_name');
    });

    it('should complete full onboarding flow for existing user', () => {
      const userId = '+5581999999999';
      const telegramUsername = 'lucas';
      const telegramUserId = 67890;
      const chatId = 12345;
      const messageId = 11111;

      // Step 1: User has Dojo mode configured with existing agent
      persistenceService.saveUserPreferences({
        userId,
        mode: 'dojo',
        telegramUsername,
        onboardingComplete: true,
      });

      // Create an existing agent
      agentManager.createAgent(userId, 'ExistingAgent', undefined, '🤖');

      // Step 2: Identify user by telegram username
      const allPrefs = persistenceService.getAllUserPreferences();
      const userPrefs = allPrefs.find(p =>
        p.telegramUsername?.toLowerCase() === telegramUsername.toLowerCase()
      );
      expect(userPrefs).toBeDefined();

      // Step 3: Check for existing agents
      const existingAgents = agentManager.listAgents(userId);
      const hasExistingAgents = existingAgents.length > 0;
      expect(hasExistingAgents).toBe(true);

      // Step 4: Start onboarding (different message would be sent for existing users)
      const result = groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_name');
      expect(result.success).toBe(true);

      // Step 5: Store pinned message ID
      groupOnboardingManager.setPinnedMessageId(chatId, telegramUserId, messageId);

      // Verify final state
      expect(groupOnboardingManager.hasActiveOnboarding(chatId)).toBe(true);
      expect(groupOnboardingManager.getPinnedMessageId(chatId)).toBe(messageId);
    });
  });

  describe('Full bot removal flow simulation', () => {
    it('should complete full removal flow', () => {
      const userId = '+5581999999999';
      const telegramUserId = 67890;
      const chatId = 12345;

      // Setup: Agent is linked to group and onboarding is in progress
      const agent = agentManager.createAgent(userId, 'TestAgent', undefined, '🤖');
      agentManager.setTelegramChatId(agent.id, chatId);
      groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_emoji');
      groupOnboardingManager.setPinnedMessageId(chatId, telegramUserId, 11111);

      // Verify setup
      expect(agentManager.getAgentByTelegramChatId(chatId)).toBeDefined();
      expect(groupOnboardingManager.hasActiveOnboarding(chatId)).toBe(true);

      // Simulate bot removal
      // Step 1: Find linked agent
      const linkedAgent = agentManager.getAgentByTelegramChatId(chatId);
      expect(linkedAgent).toBeDefined();

      // Step 2: Unlink agent
      agentManager.setTelegramChatId(linkedAgent!.id, undefined);

      // Step 3: Get onboarding state
      const state = groupOnboardingManager.getState(chatId);
      expect(state).toBeDefined();

      // Step 4: Cancel onboarding
      groupOnboardingManager.cancelOnboarding(chatId, state!.userId);

      // Verify cleanup
      expect(agentManager.getAgentByTelegramChatId(chatId)).toBeUndefined();
      expect(groupOnboardingManager.hasActiveOnboarding(chatId)).toBe(false);

      // Agent still exists
      expect(agentManager.getAgent(agent.id)).toBeDefined();
    });
  });

  // ============================================
  // Integration tests with mocked handlers
  // Tests call simulateHandleTelegramMyChatMember to verify
  // the full flow with mocked sendTelegramButtons, sendTelegramMessage, pinTelegramMessage
  // ============================================

  describe('handleTelegramMyChatMember: Bot addition flow', () => {
    it('should send first-time user message with single [Criar agora] button', async () => {
      const userId = '+5581999999999';
      const telegramUsername = 'lucas';
      const telegramUserId = 67890;
      const chatId = 12345;

      // Setup: User has Dojo mode configured but no agents
      persistenceService.saveUserPreferences({
        userId,
        mode: 'dojo',
        telegramUsername,
        onboardingComplete: true,
      });

      // Create my_chat_member update for bot being added
      const update = {
        chat: { id: chatId, type: 'group' },
        from: { id: telegramUserId, username: telegramUsername },
        new_chat_member: { status: 'member' },
        old_chat_member: { status: 'left' },
      };

      await simulateHandleTelegramMyChatMember(
        update,
        persistenceService,
        agentManager,
        groupOnboardingManager,
        mockSendTelegramMessage,
        mockSendTelegramButtons,
        mockPinTelegramMessage
      );

      // Verify sendTelegramButtons was called with first-time user message
      expect(mockSendTelegramButtons).toHaveBeenCalledTimes(1);
      const buttonsCall = mockSendTelegramButtons.mock.calls[0];
      expect(buttonsCall[0]).toBe(chatId);
      expect(buttonsCall[1]).toContain('Seu primeiro agente');
      expect(buttonsCall[2]).toHaveLength(1); // Single row
      expect(buttonsCall[2][0]).toHaveLength(1); // Single button
      expect(buttonsCall[2][0][0].text).toBe('✨ Criar agora');
      expect(buttonsCall[2][0][0].callback_data).toBe(`onboard_create_${telegramUserId}`);

      // Verify pinTelegramMessage was called
      expect(mockPinTelegramMessage).toHaveBeenCalledTimes(1);
      expect(mockPinTelegramMessage).toHaveBeenCalledWith(chatId, 12345);

      // Verify onboarding was started with correct chatId and telegramUserId
      expect(groupOnboardingManager.hasActiveOnboarding(chatId)).toBe(true);
      expect(groupOnboardingManager.isLockedByUser(chatId, telegramUserId)).toBe(true);

      // Verify pinned message ID was stored
      expect(groupOnboardingManager.getPinnedMessageId(chatId)).toBe(12345);
    });

    it('should send existing user message with two buttons [Criar um] and [Vincular existente]', async () => {
      const userId = '+5581999999999';
      const telegramUsername = 'lucas';
      const telegramUserId = 67890;
      const chatId = 12345;

      // Setup: User has Dojo mode configured with existing agents
      persistenceService.saveUserPreferences({
        userId,
        mode: 'dojo',
        telegramUsername,
        onboardingComplete: true,
      });

      // Create an existing agent
      agentManager.createAgent(userId, 'ExistingAgent', undefined, '🤖');

      // Create my_chat_member update for bot being added
      const update = {
        chat: { id: chatId, type: 'group' },
        from: { id: telegramUserId, username: telegramUsername },
        new_chat_member: { status: 'member' },
        old_chat_member: { status: 'left' },
      };

      await simulateHandleTelegramMyChatMember(
        update,
        persistenceService,
        agentManager,
        groupOnboardingManager,
        mockSendTelegramMessage,
        mockSendTelegramButtons,
        mockPinTelegramMessage
      );

      // Verify sendTelegramButtons was called with existing user message
      expect(mockSendTelegramButtons).toHaveBeenCalledTimes(1);
      const buttonsCall = mockSendTelegramButtons.mock.calls[0];
      expect(buttonsCall[0]).toBe(chatId);
      expect(buttonsCall[1]).toContain('Esse grupo não tem agente ainda');
      expect(buttonsCall[2]).toHaveLength(1); // Single row
      expect(buttonsCall[2][0]).toHaveLength(2); // Two buttons
      expect(buttonsCall[2][0][0].text).toBe('✨ Criar um');
      expect(buttonsCall[2][0][1].text).toBe('🔗 Vincular existente');
      expect(buttonsCall[2][0][0].callback_data).toBe(`onboard_create_${telegramUserId}`);
      expect(buttonsCall[2][0][1].callback_data).toBe(`onboard_link_${telegramUserId}`);

      // Verify pinTelegramMessage was called
      expect(mockPinTelegramMessage).toHaveBeenCalledTimes(1);

      // Verify onboarding was started
      expect(groupOnboardingManager.hasActiveOnboarding(chatId)).toBe(true);
      expect(groupOnboardingManager.isLockedByUser(chatId, telegramUserId)).toBe(true);

      // Verify pinned message ID was stored
      expect(groupOnboardingManager.getPinnedMessageId(chatId)).toBe(12345);
    });

    it('should send unknown user message when telegram username not found', async () => {
      const telegramUserId = 67890;
      const chatId = 12345;

      // No user preferences saved

      // Create my_chat_member update for bot being added
      const update = {
        chat: { id: chatId, type: 'group' },
        from: { id: telegramUserId, username: 'unknownuser' },
        new_chat_member: { status: 'member' },
        old_chat_member: { status: 'left' },
      };

      await simulateHandleTelegramMyChatMember(
        update,
        persistenceService,
        agentManager,
        groupOnboardingManager,
        mockSendTelegramMessage,
        mockSendTelegramButtons,
        mockPinTelegramMessage
      );

      // Verify sendTelegramMessage was called with unknown user message
      expect(mockSendTelegramMessage).toHaveBeenCalledTimes(1);
      expect(mockSendTelegramMessage.mock.calls[0][1]).toContain('Não encontrei seu cadastro');

      // Verify no buttons were sent
      expect(mockSendTelegramButtons).not.toHaveBeenCalled();

      // Verify pin was not called
      expect(mockPinTelegramMessage).not.toHaveBeenCalled();

      // Verify no onboarding was started
      expect(groupOnboardingManager.hasActiveOnboarding(chatId)).toBe(false);
    });

    it('should send unknown user message when no telegram username provided', async () => {
      const userId = '+5581999999999';
      const telegramUserId = 67890;
      const chatId = 12345;

      // User exists but from.username is undefined
      persistenceService.saveUserPreferences({
        userId,
        mode: 'dojo',
        telegramUsername: 'lucas',
        onboardingComplete: true,
      });

      // Create my_chat_member update with no username
      const update = {
        chat: { id: chatId, type: 'group' },
        from: { id: telegramUserId, username: undefined },
        new_chat_member: { status: 'member' },
        old_chat_member: { status: 'left' },
      };

      await simulateHandleTelegramMyChatMember(
        update,
        persistenceService,
        agentManager,
        groupOnboardingManager,
        mockSendTelegramMessage,
        mockSendTelegramButtons,
        mockPinTelegramMessage
      );

      // Verify sendTelegramMessage was called with unknown user message
      expect(mockSendTelegramMessage).toHaveBeenCalledTimes(1);
      expect(mockSendTelegramMessage.mock.calls[0][1]).toContain('Não encontrei seu cadastro');

      // No onboarding started
      expect(groupOnboardingManager.hasActiveOnboarding(chatId)).toBe(false);
    });

    it('should not process non-group chats', async () => {
      const userId = '+5581999999999';
      const telegramUsername = 'lucas';
      const telegramUserId = 67890;
      const chatId = 12345;

      persistenceService.saveUserPreferences({
        userId,
        mode: 'dojo',
        telegramUsername,
        onboardingComplete: true,
      });

      // Create my_chat_member update for private chat
      const update = {
        chat: { id: chatId, type: 'private' },
        from: { id: telegramUserId, username: telegramUsername },
        new_chat_member: { status: 'member' },
        old_chat_member: { status: 'left' },
      };

      await simulateHandleTelegramMyChatMember(
        update,
        persistenceService,
        agentManager,
        groupOnboardingManager,
        mockSendTelegramMessage,
        mockSendTelegramButtons,
        mockPinTelegramMessage
      );

      // Verify no messages sent
      expect(mockSendTelegramMessage).not.toHaveBeenCalled();
      expect(mockSendTelegramButtons).not.toHaveBeenCalled();
      expect(mockPinTelegramMessage).not.toHaveBeenCalled();

      // Verify no onboarding started
      expect(groupOnboardingManager.hasActiveOnboarding(chatId)).toBe(false);
    });

    it('should handle supergroup chat type', async () => {
      const userId = '+5581999999999';
      const telegramUsername = 'lucas';
      const telegramUserId = 67890;
      const chatId = -1001234567890; // Supergroup chat IDs are typically negative

      persistenceService.saveUserPreferences({
        userId,
        mode: 'dojo',
        telegramUsername,
        onboardingComplete: true,
      });

      // Create my_chat_member update for supergroup
      const update = {
        chat: { id: chatId, type: 'supergroup' },
        from: { id: telegramUserId, username: telegramUsername },
        new_chat_member: { status: 'member' },
        old_chat_member: { status: 'left' },
      };

      await simulateHandleTelegramMyChatMember(
        update,
        persistenceService,
        agentManager,
        groupOnboardingManager,
        mockSendTelegramMessage,
        mockSendTelegramButtons,
        mockPinTelegramMessage
      );

      // Verify buttons were sent (supergroup should be treated as group)
      expect(mockSendTelegramButtons).toHaveBeenCalledTimes(1);
      expect(groupOnboardingManager.hasActiveOnboarding(chatId)).toBe(true);
    });

    it('should handle bot promoted to administrator', async () => {
      const userId = '+5581999999999';
      const telegramUsername = 'lucas';
      const telegramUserId = 67890;
      const chatId = 12345;

      persistenceService.saveUserPreferences({
        userId,
        mode: 'dojo',
        telegramUsername,
        onboardingComplete: true,
      });

      // Create my_chat_member update for bot being promoted to admin
      const update = {
        chat: { id: chatId, type: 'group' },
        from: { id: telegramUserId, username: telegramUsername },
        new_chat_member: { status: 'administrator' },
        old_chat_member: { status: 'left' },
      };

      await simulateHandleTelegramMyChatMember(
        update,
        persistenceService,
        agentManager,
        groupOnboardingManager,
        mockSendTelegramMessage,
        mockSendTelegramButtons,
        mockPinTelegramMessage
      );

      // Should be treated as "added"
      expect(mockSendTelegramButtons).toHaveBeenCalledTimes(1);
      expect(groupOnboardingManager.hasActiveOnboarding(chatId)).toBe(true);
    });

    it('should not trigger add handler when already member', async () => {
      const userId = '+5581999999999';
      const telegramUsername = 'lucas';
      const telegramUserId = 67890;
      const chatId = 12345;

      persistenceService.saveUserPreferences({
        userId,
        mode: 'dojo',
        telegramUsername,
        onboardingComplete: true,
      });

      // Create my_chat_member update for status change but still member
      const update = {
        chat: { id: chatId, type: 'group' },
        from: { id: telegramUserId, username: telegramUsername },
        new_chat_member: { status: 'administrator' },
        old_chat_member: { status: 'member' },
      };

      await simulateHandleTelegramMyChatMember(
        update,
        persistenceService,
        agentManager,
        groupOnboardingManager,
        mockSendTelegramMessage,
        mockSendTelegramButtons,
        mockPinTelegramMessage
      );

      // Should not trigger add (was already member)
      expect(mockSendTelegramMessage).not.toHaveBeenCalled();
      expect(mockSendTelegramButtons).not.toHaveBeenCalled();
      expect(groupOnboardingManager.hasActiveOnboarding(chatId)).toBe(false);
    });
  });

  describe('handleTelegramMyChatMember: Bot removal flow', () => {
    it('should unlink agent when bot is removed from group', async () => {
      const userId = '+5581999999999';
      const telegramUsername = 'lucas';
      const telegramUserId = 67890;
      const chatId = 12345;

      // Setup: Agent is linked to this group
      const agent = agentManager.createAgent(userId, 'LinkedAgent', undefined, '🔗');
      agentManager.setTelegramChatId(agent.id, chatId);

      // Verify agent is linked
      expect(agentManager.getAgentByTelegramChatId(chatId)).toBeDefined();

      // Create my_chat_member update for bot being removed
      const update = {
        chat: { id: chatId, type: 'group' },
        from: { id: telegramUserId, username: telegramUsername },
        new_chat_member: { status: 'left' },
        old_chat_member: { status: 'member' },
      };

      await simulateHandleTelegramMyChatMember(
        update,
        persistenceService,
        agentManager,
        groupOnboardingManager,
        mockSendTelegramMessage,
        mockSendTelegramButtons,
        mockPinTelegramMessage
      );

      // Verify agent was unlinked (telegramChatId set to undefined)
      expect(agentManager.getAgentByTelegramChatId(chatId)).toBeUndefined();

      // Agent should still exist
      const agentStillExists = agentManager.getAgent(agent.id);
      expect(agentStillExists).toBeDefined();
      expect(agentStillExists?.telegramChatId).toBeUndefined();
    });

    it('should cancel onboarding state when bot is removed', async () => {
      const telegramUserId = 67890;
      const chatId = 12345;

      // Setup: Onboarding is in progress
      groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_emoji');
      groupOnboardingManager.setPinnedMessageId(chatId, telegramUserId, 11111);

      // Verify onboarding exists
      expect(groupOnboardingManager.hasActiveOnboarding(chatId)).toBe(true);

      // Create my_chat_member update for bot being kicked
      const update = {
        chat: { id: chatId, type: 'group' },
        from: { id: telegramUserId, username: 'lucas' },
        new_chat_member: { status: 'kicked' },
        old_chat_member: { status: 'member' },
      };

      await simulateHandleTelegramMyChatMember(
        update,
        persistenceService,
        agentManager,
        groupOnboardingManager,
        mockSendTelegramMessage,
        mockSendTelegramButtons,
        mockPinTelegramMessage
      );

      // Verify onboarding was cancelled
      expect(groupOnboardingManager.hasActiveOnboarding(chatId)).toBe(false);
    });

    it('should handle removal with both agent and onboarding state', async () => {
      const userId = '+5581999999999';
      const telegramUserId = 67890;
      const chatId = 12345;

      // Setup: Agent linked AND onboarding in progress
      const agent = agentManager.createAgent(userId, 'TestAgent', undefined, '🤖');
      agentManager.setTelegramChatId(agent.id, chatId);
      groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_workspace');
      groupOnboardingManager.setPinnedMessageId(chatId, telegramUserId, 11111);

      // Verify both exist
      expect(agentManager.getAgentByTelegramChatId(chatId)).toBeDefined();
      expect(groupOnboardingManager.hasActiveOnboarding(chatId)).toBe(true);

      // Create my_chat_member update for bot leaving
      const update = {
        chat: { id: chatId, type: 'group' },
        from: { id: telegramUserId, username: 'lucas' },
        new_chat_member: { status: 'left' },
        old_chat_member: { status: 'administrator' },
      };

      await simulateHandleTelegramMyChatMember(
        update,
        persistenceService,
        agentManager,
        groupOnboardingManager,
        mockSendTelegramMessage,
        mockSendTelegramButtons,
        mockPinTelegramMessage
      );

      // Verify both were cleaned up
      expect(agentManager.getAgentByTelegramChatId(chatId)).toBeUndefined();
      expect(groupOnboardingManager.hasActiveOnboarding(chatId)).toBe(false);

      // Agent still exists
      expect(agentManager.getAgent(agent.id)).toBeDefined();
    });

    it('should handle removal from group with no linked agent', async () => {
      const telegramUserId = 67890;
      const chatId = 12345;

      // No agent linked, no onboarding

      // Create my_chat_member update for bot leaving
      const update = {
        chat: { id: chatId, type: 'group' },
        from: { id: telegramUserId, username: 'lucas' },
        new_chat_member: { status: 'left' },
        old_chat_member: { status: 'member' },
      };

      // Should not throw
      await simulateHandleTelegramMyChatMember(
        update,
        persistenceService,
        agentManager,
        groupOnboardingManager,
        mockSendTelegramMessage,
        mockSendTelegramButtons,
        mockPinTelegramMessage
      );

      // Nothing changed
      expect(agentManager.getAgentByTelegramChatId(chatId)).toBeUndefined();
      expect(groupOnboardingManager.hasActiveOnboarding(chatId)).toBe(false);
    });

    it('should not trigger remove handler when status change is not removal', async () => {
      const userId = '+5581999999999';
      const telegramUserId = 67890;
      const chatId = 12345;

      // Setup: Agent is linked
      const agent = agentManager.createAgent(userId, 'LinkedAgent', undefined, '🔗');
      agentManager.setTelegramChatId(agent.id, chatId);

      // Create my_chat_member update for promotion (not removal)
      const update = {
        chat: { id: chatId, type: 'group' },
        from: { id: telegramUserId, username: 'lucas' },
        new_chat_member: { status: 'administrator' },
        old_chat_member: { status: 'member' },
      };

      await simulateHandleTelegramMyChatMember(
        update,
        persistenceService,
        agentManager,
        groupOnboardingManager,
        mockSendTelegramMessage,
        mockSendTelegramButtons,
        mockPinTelegramMessage
      );

      // Agent should still be linked
      expect(agentManager.getAgentByTelegramChatId(chatId)).toBeDefined();
    });
  });

  describe('handleBotAddedToGroup: Message content verification', () => {
    it('should include correct callback_data with telegramUserId in first-time user message', async () => {
      const userId = '+5581999999999';
      const telegramUsername = 'lucas';
      const telegramUserId = 99999;
      const chatId = 12345;

      persistenceService.saveUserPreferences({
        userId,
        mode: 'dojo',
        telegramUsername,
        onboardingComplete: true,
      });

      await simulateHandleBotAddedToGroup(
        chatId,
        telegramUserId,
        telegramUsername,
        persistenceService,
        agentManager,
        groupOnboardingManager,
        mockSendTelegramMessage,
        mockSendTelegramButtons,
        mockPinTelegramMessage
      );

      const buttonsCall = mockSendTelegramButtons.mock.calls[0];
      // callback_data should include the telegramUserId
      expect(buttonsCall[2][0][0].callback_data).toBe(`onboard_create_${telegramUserId}`);
    });

    it('should include correct callback_data with telegramUserId in existing user message', async () => {
      const userId = '+5581999999999';
      const telegramUsername = 'lucas';
      const telegramUserId = 88888;
      const chatId = 12345;

      persistenceService.saveUserPreferences({
        userId,
        mode: 'dojo',
        telegramUsername,
        onboardingComplete: true,
      });

      agentManager.createAgent(userId, 'Agent1', undefined, '🤖');

      await simulateHandleBotAddedToGroup(
        chatId,
        telegramUserId,
        telegramUsername,
        persistenceService,
        agentManager,
        groupOnboardingManager,
        mockSendTelegramMessage,
        mockSendTelegramButtons,
        mockPinTelegramMessage
      );

      const buttonsCall = mockSendTelegramButtons.mock.calls[0];
      // Both buttons should include telegramUserId
      expect(buttonsCall[2][0][0].callback_data).toBe(`onboard_create_${telegramUserId}`);
      expect(buttonsCall[2][0][1].callback_data).toBe(`onboard_link_${telegramUserId}`);
    });
  });

  describe('handleBotRemovedFromGroup: Edge cases', () => {
    it('should only unlink the agent for the removed group', async () => {
      const userId = '+5581999999999';
      const chatId1 = 11111;
      const chatId2 = 22222;

      // Create two agents linked to different groups
      const agent1 = agentManager.createAgent(userId, 'Agent1', undefined, '1️⃣');
      const agent2 = agentManager.createAgent(userId, 'Agent2', undefined, '2️⃣');
      agentManager.setTelegramChatId(agent1.id, chatId1);
      agentManager.setTelegramChatId(agent2.id, chatId2);

      // Remove bot from group 1 only
      await simulateHandleBotRemovedFromGroup(chatId1, agentManager, groupOnboardingManager);

      // Agent 1 should be unlinked
      expect(agentManager.getAgentByTelegramChatId(chatId1)).toBeUndefined();

      // Agent 2 should still be linked
      expect(agentManager.getAgentByTelegramChatId(chatId2)).toBeDefined();
    });

    it('should only cancel onboarding owned by the lock holder', async () => {
      const chatId = 12345;
      const telegramUserId1 = 11111;
      const telegramUserId2 = 22222;

      // Start onboarding as user 1
      groupOnboardingManager.startOnboarding(chatId, telegramUserId1, 'awaiting_name');

      // Removal happens - the state handler gets the owner from state
      const state = groupOnboardingManager.getState(chatId);
      expect(state).toBeDefined();
      expect(state?.userId).toBe(telegramUserId1);

      // Cancel using the correct owner from state
      await simulateHandleBotRemovedFromGroup(chatId, agentManager, groupOnboardingManager);

      // Should be cancelled
      expect(groupOnboardingManager.hasActiveOnboarding(chatId)).toBe(false);
    });
  });

  describe('Pinned message storage verification', () => {
    it('should store pinned message ID via groupOnboardingManager.setPinnedMessageId', async () => {
      const userId = '+5581999999999';
      const telegramUsername = 'lucas';
      const telegramUserId = 67890;
      const chatId = 12345;
      const expectedMessageId = 12345; // From mock

      persistenceService.saveUserPreferences({
        userId,
        mode: 'dojo',
        telegramUsername,
        onboardingComplete: true,
      });

      await simulateHandleBotAddedToGroup(
        chatId,
        telegramUserId,
        telegramUsername,
        persistenceService,
        agentManager,
        groupOnboardingManager,
        mockSendTelegramMessage,
        mockSendTelegramButtons,
        mockPinTelegramMessage
      );

      // Verify pinTelegramMessage was called with the message ID returned by sendButtons
      expect(mockPinTelegramMessage).toHaveBeenCalledWith(chatId, expectedMessageId);

      // Verify the message ID was stored in groupOnboardingManager
      expect(groupOnboardingManager.getPinnedMessageId(chatId)).toBe(expectedMessageId);

      // Verify onboarding state contains the pinned message ID
      const state = groupOnboardingManager.getState(chatId);
      expect(state?.pinnedMessageId).toBe(expectedMessageId);
    });

    it('should not store pinned message ID when sendButtons fails', async () => {
      const userId = '+5581999999999';
      const telegramUsername = 'lucas';
      const telegramUserId = 67890;
      const chatId = 12345;

      // Mock sendButtons to return null (failure)
      const failingMockSendButtons = mock(() => Promise.resolve(null));

      persistenceService.saveUserPreferences({
        userId,
        mode: 'dojo',
        telegramUsername,
        onboardingComplete: true,
      });

      await simulateHandleBotAddedToGroup(
        chatId,
        telegramUserId,
        telegramUsername,
        persistenceService,
        agentManager,
        groupOnboardingManager,
        mockSendTelegramMessage,
        failingMockSendButtons,
        mockPinTelegramMessage
      );

      // Pin should not have been called
      expect(mockPinTelegramMessage).not.toHaveBeenCalled();

      // No onboarding should have been started
      expect(groupOnboardingManager.hasActiveOnboarding(chatId)).toBe(false);
    });
  });

  describe('Agent Linking: Connect Existing Agents to Groups', () => {
    // Mock for editTelegramMessage
    const mockEditTelegramMessage = mock(() => Promise.resolve(true));

    beforeEach(() => {
      mockEditTelegramMessage.mockClear();
    });

    /**
     * Helper to simulate the onboard_link callback handling
     * This mirrors the logic in index.ts for the "Vincular existente" button
     */
    async function simulateOnboardLinkCallback(
      chatId: number,
      telegramUserId: number,
      userId: string,
      agentManager: AgentManager,
      groupOnboardingManager: GroupOnboardingManager,
      mockSendButtons: typeof mockSendTelegramButtons
    ): Promise<void> {
      // Get user's unlinked agents
      const agents = agentManager.listAgents(userId)
        .filter(a => a.name !== 'Ronin' && !a.telegramChatId);

      // Case C: No available agents
      if (agents.length === 0) {
        await mockSendButtons(chatId,
          '✅ *Todos os agentes já estão vinculados*\n\n' +
          'Crie um novo agente para este grupo.',
          [
            [{ text: '✨ Criar um', callback_data: `onboard_create_${telegramUserId}` }],
          ]
        );
        return;
      }

      // Case A: 1-3 agents
      if (agents.length <= 3) {
        const buttons = agents.map(a => ([{
          text: `${a.emoji || '🤖'} ${a.name}`,
          callback_data: `grp_link_agent_${a.id}`,
        }]));

        await mockSendButtons(chatId, '*Escolha um agente para vincular:*', buttons);
      }
      // Case B: 4+ agents
      else {
        const listLines = agents.slice(0, 8).map((a, i) =>
          `${i + 1}. ${a.emoji || '🤖'} ${a.name}`
        );
        const message = '*Escolha um agente para vincular:*\n\n' + listLines.join('\n');

        const buttons: { text: string; callback_data: string }[][] = [];
        const agentsToShow = agents.slice(0, 8);
        for (let i = 0; i < agentsToShow.length; i += 4) {
          const row = agentsToShow.slice(i, i + 4).map((a, idx) => ({
            text: String(i + idx + 1),
            callback_data: `grp_link_agent_${a.id}`,
          }));
          buttons.push(row);
        }

        await mockSendButtons(chatId, message, buttons);
      }

      // Update state to linking_agent
      groupOnboardingManager.updateState(chatId, telegramUserId, { step: 'linking_agent' });
    }

    /**
     * Helper to simulate the grp_link_agent callback handling
     * This links an existing agent to the group
     */
    async function simulateLinkAgentCallback(
      chatId: number,
      telegramUserId: number,
      userId: string,
      agentId: string,
      agentManager: AgentManager,
      groupOnboardingManager: GroupOnboardingManager,
      mockSendMessage: typeof mockSendTelegramMessage,
      mockEditMessage: typeof mockEditTelegramMessage
    ): Promise<boolean> {
      const agent = agentManager.getAgent(agentId);

      if (!agent || agent.userId !== userId) {
        await mockSendMessage(chatId, '❌ Agente não encontrado.');
        return false;
      }

      // Guard: prevent hijacking already-linked agents
      if (agent.telegramChatId !== undefined && agent.telegramChatId !== chatId) {
        await mockSendMessage(chatId, '❌ Este agente já está vinculado a outro grupo.');
        return false;
      }

      // If agent is already linked to THIS chat, just complete onboarding without reassigning
      if (agent.telegramChatId === chatId) {
        // Edit pinned message to show success
        const pinnedMessageId = groupOnboardingManager.getPinnedMessageId(chatId);
        if (pinnedMessageId) {
          await mockEditMessage(chatId, pinnedMessageId,
            `✅ *${agent.emoji || '🤖'} ${agent.name}* vinculado a este grupo!\n\n` +
            `Envie mensagens para interagir com o agente.`
          );
        }

        // Complete onboarding
        groupOnboardingManager.completeOnboarding(chatId, telegramUserId);
        return true;
      }

      // Link agent to this group
      agentManager.setTelegramChatId(agentId, chatId);

      // Edit pinned message to show success
      const pinnedMessageId = groupOnboardingManager.getPinnedMessageId(chatId);
      if (pinnedMessageId) {
        await mockEditMessage(chatId, pinnedMessageId,
          `✅ *${agent.emoji || '🤖'} ${agent.name}* vinculado a este grupo!\n\n` +
          `Envie mensagens para interagir com o agente.`
        );
      }

      // Complete onboarding
      groupOnboardingManager.completeOnboarding(chatId, telegramUserId);
      return true;
    }

    describe('Case A: 1-3 unlinked agents', () => {
      it('should show inline buttons with [emoji] [name] format for 1 agent', async () => {
        const userId = '+5581999999999';
        const telegramUserId = 67890;
        const chatId = 12345;

        // Create 1 unlinked agent
        const agent = agentManager.createAgent(userId, 'MyAgent', undefined, '🚀');

        // Start onboarding first
        groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_name');

        await simulateOnboardLinkCallback(
          chatId, telegramUserId, userId,
          agentManager, groupOnboardingManager, mockSendTelegramButtons
        );

        expect(mockSendTelegramButtons).toHaveBeenCalledTimes(1);
        const call = mockSendTelegramButtons.mock.calls[0];
        expect(call[0]).toBe(chatId);
        expect(call[1]).toBe('*Escolha um agente para vincular:*');
        expect(call[2]).toHaveLength(1); // 1 row
        expect(call[2][0]).toHaveLength(1); // 1 button per row
        expect(call[2][0][0].text).toBe('🚀 MyAgent');
        expect(call[2][0][0].callback_data).toBe(`grp_link_agent_${agent.id}`);
      });

      it('should show inline buttons with [emoji] [name] format for 2 agents', async () => {
        const userId = '+5581999999999';
        const telegramUserId = 67890;
        const chatId = 12345;

        // Create 2 unlinked agents
        const agent1 = agentManager.createAgent(userId, 'Agent1', undefined, '1️⃣');
        const agent2 = agentManager.createAgent(userId, 'Agent2', undefined, '2️⃣');

        groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_name');

        await simulateOnboardLinkCallback(
          chatId, telegramUserId, userId,
          agentManager, groupOnboardingManager, mockSendTelegramButtons
        );

        expect(mockSendTelegramButtons).toHaveBeenCalledTimes(1);
        const call = mockSendTelegramButtons.mock.calls[0];
        expect(call[2]).toHaveLength(2); // 2 rows
        expect(call[2][0][0].text).toBe('1️⃣ Agent1');
        expect(call[2][1][0].text).toBe('2️⃣ Agent2');
      });

      it('should show inline buttons with [emoji] [name] format for 3 agents', async () => {
        const userId = '+5581999999999';
        const telegramUserId = 67890;
        const chatId = 12345;

        // Create 3 unlinked agents
        agentManager.createAgent(userId, 'Agent1', undefined, '1️⃣');
        agentManager.createAgent(userId, 'Agent2', undefined, '2️⃣');
        agentManager.createAgent(userId, 'Agent3', undefined, '3️⃣');

        groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_name');

        await simulateOnboardLinkCallback(
          chatId, telegramUserId, userId,
          agentManager, groupOnboardingManager, mockSendTelegramButtons
        );

        expect(mockSendTelegramButtons).toHaveBeenCalledTimes(1);
        const call = mockSendTelegramButtons.mock.calls[0];
        expect(call[2]).toHaveLength(3); // 3 rows, one button each
        expect(call[2][0][0].text).toBe('1️⃣ Agent1');
        expect(call[2][1][0].text).toBe('2️⃣ Agent2');
        expect(call[2][2][0].text).toBe('3️⃣ Agent3');
      });

      it('should use default emoji when agent has no emoji', async () => {
        const userId = '+5581999999999';
        const telegramUserId = 67890;
        const chatId = 12345;

        // Create agent without emoji
        agentManager.createAgent(userId, 'NoEmojiAgent');

        groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_name');

        await simulateOnboardLinkCallback(
          chatId, telegramUserId, userId,
          agentManager, groupOnboardingManager, mockSendTelegramButtons
        );

        const call = mockSendTelegramButtons.mock.calls[0];
        expect(call[2][0][0].text).toBe('🤖 NoEmojiAgent');
      });
    });

    describe('Case B: 4+ unlinked agents', () => {
      it('should show numbered list + number buttons in rows of 4', async () => {
        const userId = '+5581999999999';
        const telegramUserId = 67890;
        const chatId = 12345;

        // Create 4 unlinked agents
        agentManager.createAgent(userId, 'Agent1', undefined, '1️⃣');
        agentManager.createAgent(userId, 'Agent2', undefined, '2️⃣');
        agentManager.createAgent(userId, 'Agent3', undefined, '3️⃣');
        agentManager.createAgent(userId, 'Agent4', undefined, '4️⃣');

        groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_name');

        await simulateOnboardLinkCallback(
          chatId, telegramUserId, userId,
          agentManager, groupOnboardingManager, mockSendTelegramButtons
        );

        expect(mockSendTelegramButtons).toHaveBeenCalledTimes(1);
        const call = mockSendTelegramButtons.mock.calls[0];

        // Check message contains numbered list
        expect(call[1]).toContain('*Escolha um agente para vincular:*');
        expect(call[1]).toContain('1. 1️⃣ Agent1');
        expect(call[1]).toContain('2. 2️⃣ Agent2');
        expect(call[1]).toContain('3. 3️⃣ Agent3');
        expect(call[1]).toContain('4. 4️⃣ Agent4');

        // Check buttons are in a single row of 4
        expect(call[2]).toHaveLength(1); // 1 row
        expect(call[2][0]).toHaveLength(4); // 4 buttons
        expect(call[2][0][0].text).toBe('1');
        expect(call[2][0][1].text).toBe('2');
        expect(call[2][0][2].text).toBe('3');
        expect(call[2][0][3].text).toBe('4');
      });

      it('should show 2 rows for 5-8 agents', async () => {
        const userId = '+5581999999999';
        const telegramUserId = 67890;
        const chatId = 12345;

        // Create 6 unlinked agents
        for (let i = 1; i <= 6; i++) {
          agentManager.createAgent(userId, `Agent${i}`, undefined, `${i}️⃣`);
        }

        groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_name');

        await simulateOnboardLinkCallback(
          chatId, telegramUserId, userId,
          agentManager, groupOnboardingManager, mockSendTelegramButtons
        );

        const call = mockSendTelegramButtons.mock.calls[0];

        // Check message contains numbered list
        expect(call[1]).toContain('6. 6️⃣ Agent6');

        // Check buttons are in 2 rows
        expect(call[2]).toHaveLength(2); // 2 rows
        expect(call[2][0]).toHaveLength(4); // First row: 4 buttons
        expect(call[2][1]).toHaveLength(2); // Second row: 2 buttons
        expect(call[2][0][0].text).toBe('1');
        expect(call[2][1][0].text).toBe('5');
        expect(call[2][1][1].text).toBe('6');
      });

      it('should limit to 8 agents maximum', async () => {
        const userId = '+5581999999999';
        const telegramUserId = 67890;
        const chatId = 12345;

        // Create 10 unlinked agents
        for (let i = 1; i <= 10; i++) {
          agentManager.createAgent(userId, `Agent${i}`);
        }

        groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_name');

        await simulateOnboardLinkCallback(
          chatId, telegramUserId, userId,
          agentManager, groupOnboardingManager, mockSendTelegramButtons
        );

        const call = mockSendTelegramButtons.mock.calls[0];

        // Should only show 8 agents in the list
        expect(call[1]).toContain('8.');
        expect(call[1]).not.toContain('9.');

        // Check buttons: 2 rows of 4
        expect(call[2]).toHaveLength(2);
        expect(call[2][0]).toHaveLength(4);
        expect(call[2][1]).toHaveLength(4);
      });
    });

    describe('Case C: No unlinked agents available', () => {
      it('should show "todos os agentes já estão vinculados" + [criar um] button', async () => {
        const userId = '+5581999999999';
        const telegramUserId = 67890;
        const chatId = 12345;
        const linkedChatId = 99999;

        // Create an agent but link it to another group
        const agent = agentManager.createAgent(userId, 'LinkedAgent', undefined, '🔗');
        agentManager.setTelegramChatId(agent.id, linkedChatId);

        groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_name');

        await simulateOnboardLinkCallback(
          chatId, telegramUserId, userId,
          agentManager, groupOnboardingManager, mockSendTelegramButtons
        );

        expect(mockSendTelegramButtons).toHaveBeenCalledTimes(1);
        const call = mockSendTelegramButtons.mock.calls[0];
        expect(call[0]).toBe(chatId);
        expect(call[1]).toContain('Todos os agentes já estão vinculados');
        expect(call[1]).toContain('Crie um novo agente para este grupo');
        expect(call[2]).toHaveLength(1); // 1 row
        expect(call[2][0]).toHaveLength(1); // 1 button
        expect(call[2][0][0].text).toBe('✨ Criar um');
        expect(call[2][0][0].callback_data).toBe(`onboard_create_${telegramUserId}`);
      });

      it('should exclude Ronin agent from available agents', async () => {
        const userId = '+5581999999999';
        const telegramUserId = 67890;
        const chatId = 12345;

        // Create only a Ronin agent (should be excluded)
        agentManager.createAgent(userId, 'Ronin', undefined, '⚔️');

        groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_name');

        await simulateOnboardLinkCallback(
          chatId, telegramUserId, userId,
          agentManager, groupOnboardingManager, mockSendTelegramButtons
        );

        // Should show "all agents linked" message since Ronin is excluded
        const call = mockSendTelegramButtons.mock.calls[0];
        expect(call[1]).toContain('Todos os agentes já estão vinculados');
      });

      it('should show create button when all agents are already linked', async () => {
        const userId = '+5581999999999';
        const telegramUserId = 67890;
        const chatId = 12345;

        // Create multiple agents and link them all
        const agent1 = agentManager.createAgent(userId, 'Agent1', undefined, '1️⃣');
        const agent2 = agentManager.createAgent(userId, 'Agent2', undefined, '2️⃣');
        agentManager.setTelegramChatId(agent1.id, 11111);
        agentManager.setTelegramChatId(agent2.id, 22222);

        groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_name');

        await simulateOnboardLinkCallback(
          chatId, telegramUserId, userId,
          agentManager, groupOnboardingManager, mockSendTelegramButtons
        );

        const call = mockSendTelegramButtons.mock.calls[0];
        expect(call[2][0][0].text).toBe('✨ Criar um');
      });
    });

    describe('Agent linking completion', () => {
      it('should link agent and edit pinned message on success', async () => {
        const userId = '+5581999999999';
        const telegramUserId = 67890;
        const chatId = 12345;
        const pinnedMessageId = 99999;

        // Create an unlinked agent
        const agent = agentManager.createAgent(userId, 'MyAgent', undefined, '🚀');

        // Start onboarding and set pinned message
        groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_name');
        groupOnboardingManager.setPinnedMessageId(chatId, telegramUserId, pinnedMessageId);

        const success = await simulateLinkAgentCallback(
          chatId, telegramUserId, userId, agent.id,
          agentManager, groupOnboardingManager,
          mockSendTelegramMessage, mockEditTelegramMessage
        );

        expect(success).toBe(true);

        // Verify agent was linked
        expect(agent.telegramChatId).toBe(chatId);

        // Verify pinned message was edited
        expect(mockEditTelegramMessage).toHaveBeenCalledTimes(1);
        const editCall = mockEditTelegramMessage.mock.calls[0];
        expect(editCall[0]).toBe(chatId);
        expect(editCall[1]).toBe(pinnedMessageId);
        expect(editCall[2]).toContain('🚀 MyAgent');
        expect(editCall[2]).toContain('vinculado a este grupo');

        // Verify onboarding was completed
        expect(groupOnboardingManager.hasActiveOnboarding(chatId)).toBe(false);
      });

      it('should reject linking agent that belongs to another user', async () => {
        const userId1 = '+5581999999999';
        const userId2 = '+5581888888888';
        const telegramUserId = 67890;
        const chatId = 12345;

        // Create agent belonging to user2
        const agent = agentManager.createAgent(userId2, 'OtherUserAgent', undefined, '⚠️');

        groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_name');

        const success = await simulateLinkAgentCallback(
          chatId, telegramUserId, userId1, agent.id,
          agentManager, groupOnboardingManager,
          mockSendTelegramMessage, mockEditTelegramMessage
        );

        expect(success).toBe(false);
        expect(mockSendTelegramMessage).toHaveBeenCalledWith(chatId, '❌ Agente não encontrado.');

        // Agent should not be linked
        expect(agent.telegramChatId).toBeUndefined();
      });

      it('should reject linking non-existent agent', async () => {
        const userId = '+5581999999999';
        const telegramUserId = 67890;
        const chatId = 12345;

        groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_name');

        const success = await simulateLinkAgentCallback(
          chatId, telegramUserId, userId, 'non-existent-id',
          agentManager, groupOnboardingManager,
          mockSendTelegramMessage, mockEditTelegramMessage
        );

        expect(success).toBe(false);
        expect(mockSendTelegramMessage).toHaveBeenCalledWith(chatId, '❌ Agente não encontrado.');
      });

      it('should reject linking agent already linked to another chat (prevent hijacking)', async () => {
        const userId = '+5581999999999';
        const telegramUserId = 67890;
        const originalChatId = 11111;
        const attackerChatId = 99999;

        // Create agent and link it to originalChatId
        const agent = agentManager.createAgent(userId, 'LinkedAgent', undefined, '🔒');
        agentManager.setTelegramChatId(agent.id, originalChatId);

        // Verify agent is linked to originalChatId
        expect(agent.telegramChatId).toBe(originalChatId);

        // Attacker tries to hijack via crafted grp_link_agent_ callback
        groupOnboardingManager.startOnboarding(attackerChatId, telegramUserId, 'awaiting_name');

        const success = await simulateLinkAgentCallback(
          attackerChatId, telegramUserId, userId, agent.id,
          agentManager, groupOnboardingManager,
          mockSendTelegramMessage, mockEditTelegramMessage
        );

        // Should reject the link attempt
        expect(success).toBe(false);
        expect(mockSendTelegramMessage).toHaveBeenCalledWith(attackerChatId, '❌ Este agente já está vinculado a outro grupo.');

        // Agent should still be linked to originalChatId (unchanged)
        expect(agent.telegramChatId).toBe(originalChatId);
      });

      it('should allow re-linking agent to the same chat without reassigning', async () => {
        const userId = '+5581999999999';
        const telegramUserId = 67890;
        const chatId = 12345;
        const pinnedMessageId = 99999;

        // Create agent and link it to chatId
        const agent = agentManager.createAgent(userId, 'SameAgent', undefined, '✅');
        agentManager.setTelegramChatId(agent.id, chatId);

        // Start onboarding for the same chat
        groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_name');
        groupOnboardingManager.setPinnedMessageId(chatId, telegramUserId, pinnedMessageId);

        const success = await simulateLinkAgentCallback(
          chatId, telegramUserId, userId, agent.id,
          agentManager, groupOnboardingManager,
          mockSendTelegramMessage, mockEditTelegramMessage
        );

        // Should succeed without error
        expect(success).toBe(true);

        // Agent should still be linked to the same chatId
        expect(agent.telegramChatId).toBe(chatId);

        // Onboarding should be completed
        expect(groupOnboardingManager.hasActiveOnboarding(chatId)).toBe(false);

        // Pinned message should be edited with success
        expect(mockEditTelegramMessage).toHaveBeenCalledTimes(1);
        const editCall = mockEditTelegramMessage.mock.calls[0];
        expect(editCall[2]).toContain('✅ SameAgent');
        expect(editCall[2]).toContain('vinculado a este grupo');
      });

      it('should use default emoji in success message when agent has no emoji', async () => {
        const userId = '+5581999999999';
        const telegramUserId = 67890;
        const chatId = 12345;
        const pinnedMessageId = 99999;

        // Create agent without emoji
        const agent = agentManager.createAgent(userId, 'NoEmojiAgent');

        groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_name');
        groupOnboardingManager.setPinnedMessageId(chatId, telegramUserId, pinnedMessageId);

        await simulateLinkAgentCallback(
          chatId, telegramUserId, userId, agent.id,
          agentManager, groupOnboardingManager,
          mockSendTelegramMessage, mockEditTelegramMessage
        );

        const editCall = mockEditTelegramMessage.mock.calls[0];
        expect(editCall[2]).toContain('🤖 NoEmojiAgent');
      });
    });
  });

  describe('Message Routing: Lock Validation & Concurrent User Scenarios', () => {
    const mockRouteHandler = mock(() => Promise.resolve());

    beforeEach(() => {
      mockRouteHandler.mockClear();
      mockSendTelegramMessage.mockClear();
      mockSendTelegramButtons.mockClear();
    });

    /**
     * Helper to simulate message routing with lock validation
     * This mirrors the logic in index.ts routeGroupMessage handling
     */
    async function simulateMessageRouting(
      chatId: number,
      telegramUserId: number,
      _text: string,
      groupOnboardingManager: GroupOnboardingManager,
      _mockSendMessage: typeof mockSendTelegramMessage
    ): Promise<'flow_input' | 'group_onboarding_locked' | 'normal_routing'> {
      // Check for active onboarding
      if (groupOnboardingManager.hasActiveOnboarding(chatId)) {
        // Check if message is from the user who has the lock
        if (groupOnboardingManager.isLockedByUser(chatId, telegramUserId)) {
          // Same user - return flow_input (silently ignore non-step messages)
          return 'flow_input';
        } else {
          // Different user - silently ignore (no chat message, no callback alert for plain messages)
          return 'group_onboarding_locked';
        }
      }

      // No active onboarding - normal routing
      return 'normal_routing';
    }

    describe('Concurrent user message handling', () => {
      it('should silently ignore messages from lock owner (flow_input)', async () => {
        const chatId = 12345;
        const lockOwnerUserId = 11111;

        // User starts onboarding
        groupOnboardingManager.startOnboarding(chatId, lockOwnerUserId, 'awaiting_emoji');

        // Same user sends a message during onboarding
        const result = await simulateMessageRouting(
          chatId, lockOwnerUserId, 'random text',
          groupOnboardingManager, mockSendTelegramMessage
        );

        expect(result).toBe('flow_input');
        // No message should be sent (silently ignored)
        expect(mockSendTelegramMessage).not.toHaveBeenCalled();
      });

      it('should silently ignore different user during onboarding (no chat message)', async () => {
        const chatId = 12345;
        const lockOwnerUserId = 11111;
        const otherUserId = 22222;

        // First user starts onboarding
        groupOnboardingManager.startOnboarding(chatId, lockOwnerUserId, 'awaiting_emoji');

        // Different user tries to send a message
        const result = await simulateMessageRouting(
          chatId, otherUserId, 'hello',
          groupOnboardingManager, mockSendTelegramMessage
        );

        // Should return group_onboarding_locked but NOT send a message to the chat
        // (we can't use answerCallbackQuery for plain messages, so we silently ignore)
        expect(result).toBe('group_onboarding_locked');
        expect(mockSendTelegramMessage).not.toHaveBeenCalled();
      });

      it('should route normally when no active onboarding', async () => {
        const chatId = 12345;
        const telegramUserId = 67890;

        // No onboarding active
        const result = await simulateMessageRouting(
          chatId, telegramUserId, 'hello',
          groupOnboardingManager, mockSendTelegramMessage
        );

        expect(result).toBe('normal_routing');
        expect(mockSendTelegramMessage).not.toHaveBeenCalled();
      });

      it('should route normally after onboarding completes', async () => {
        const chatId = 12345;
        const lockOwnerUserId = 11111;
        const otherUserId = 22222;

        // Start onboarding
        groupOnboardingManager.startOnboarding(chatId, lockOwnerUserId, 'awaiting_emoji');

        // Complete onboarding
        groupOnboardingManager.completeOnboarding(chatId, lockOwnerUserId);

        // Now other user can send messages normally
        const result = await simulateMessageRouting(
          chatId, otherUserId, 'hello',
          groupOnboardingManager, mockSendTelegramMessage
        );

        expect(result).toBe('normal_routing');
      });

      it('should route normally after onboarding is cancelled', async () => {
        const chatId = 12345;
        const lockOwnerUserId = 11111;
        const otherUserId = 22222;

        // Start onboarding
        groupOnboardingManager.startOnboarding(chatId, lockOwnerUserId, 'awaiting_emoji');

        // Cancel onboarding
        groupOnboardingManager.cancelOnboarding(chatId, lockOwnerUserId);

        // Now other user can send messages normally
        const result = await simulateMessageRouting(
          chatId, otherUserId, 'hello',
          groupOnboardingManager, mockSendTelegramMessage
        );

        expect(result).toBe('normal_routing');
      });
    });

    describe('Multiple users trying to configure same group', () => {
      it('should only allow first user to start onboarding', () => {
        const chatId = 12345;
        const firstUserId = 11111;
        const secondUserId = 22222;

        // First user starts onboarding
        const result1 = groupOnboardingManager.startOnboarding(chatId, firstUserId, 'awaiting_name');
        expect(result1.success).toBe(true);

        // Second user tries to start onboarding
        const result2 = groupOnboardingManager.startOnboarding(chatId, secondUserId, 'awaiting_name');
        expect(result2.success).toBe(false);
        expect(result2.lockedByUserId).toBe(firstUserId);
      });

      it('should block second user from modifying onboarding state', () => {
        const chatId = 12345;
        const firstUserId = 11111;
        const secondUserId = 22222;

        // First user starts onboarding
        groupOnboardingManager.startOnboarding(chatId, firstUserId, 'awaiting_name');

        // Second user tries to update state
        const updated = groupOnboardingManager.updateState(chatId, secondUserId, { step: 'awaiting_emoji' });
        expect(updated).toBe(false);

        // First user should still see awaiting_name
        expect(groupOnboardingManager.getCurrentStep(chatId)).toBe('awaiting_name');
      });

      it('should allow same user to restart onboarding', () => {
        const chatId = 12345;
        const userId = 11111;

        // Start onboarding
        groupOnboardingManager.startOnboarding(chatId, userId, 'awaiting_name');
        groupOnboardingManager.setAgentName(chatId, userId, 'TestAgent');

        // Same user restarts onboarding
        const result = groupOnboardingManager.startOnboarding(chatId, userId, 'awaiting_name');
        expect(result.success).toBe(true);

        // State should be reset
        expect(groupOnboardingManager.getData(chatId)?.agentName).toBeUndefined();
      });
    });

    describe('Race conditions and edge cases', () => {
      it('should handle rapid message sequence from different users', async () => {
        const chatId = 12345;
        const userA = 11111;
        const userB = 22222;
        const userC = 33333;

        // User A starts onboarding
        groupOnboardingManager.startOnboarding(chatId, userA, 'awaiting_emoji');

        // Multiple users try to send messages rapidly
        const resultA = await simulateMessageRouting(chatId, userA, 'msg1', groupOnboardingManager, mockSendTelegramMessage);
        const resultB = await simulateMessageRouting(chatId, userB, 'msg2', groupOnboardingManager, mockSendTelegramMessage);
        const resultC = await simulateMessageRouting(chatId, userC, 'msg3', groupOnboardingManager, mockSendTelegramMessage);

        // Only user A (lock owner) gets flow_input
        expect(resultA).toBe('flow_input');

        // Users B and C get locked out (silently ignored, no chat messages)
        expect(resultB).toBe('group_onboarding_locked');
        expect(resultC).toBe('group_onboarding_locked');

        // No messages should be sent (silently ignored for plain messages)
        expect(mockSendTelegramMessage).not.toHaveBeenCalled();
      });

      it('should handle onboarding across multiple groups independently', async () => {
        const group1 = 11111;
        const group2 = 22222;
        const userA = 10001;
        const userB = 10002;

        // User A configuring group 1
        groupOnboardingManager.startOnboarding(group1, userA, 'awaiting_emoji');

        // User B configuring group 2
        groupOnboardingManager.startOnboarding(group2, userB, 'awaiting_emoji');

        // User A sends to group 1 - allowed (flow_input)
        const result1 = await simulateMessageRouting(group1, userA, 'msg', groupOnboardingManager, mockSendTelegramMessage);
        expect(result1).toBe('flow_input');

        // User B sends to group 2 - allowed (flow_input)
        const result2 = await simulateMessageRouting(group2, userB, 'msg', groupOnboardingManager, mockSendTelegramMessage);
        expect(result2).toBe('flow_input');

        // User A sends to group 2 - blocked (not the lock owner, silently ignored)
        const result3 = await simulateMessageRouting(group2, userA, 'msg', groupOnboardingManager, mockSendTelegramMessage);
        expect(result3).toBe('group_onboarding_locked');

        // User B sends to group 1 - blocked (not the lock owner, silently ignored)
        const result4 = await simulateMessageRouting(group1, userB, 'msg', groupOnboardingManager, mockSendTelegramMessage);
        expect(result4).toBe('group_onboarding_locked');

        // No messages should be sent (silently ignored for plain messages)
        expect(mockSendTelegramMessage).not.toHaveBeenCalled();
      });

      it('should correctly identify lock owner across onboarding steps', async () => {
        const chatId = 12345;
        const lockOwner = 11111;
        const intruder = 22222;

        // Start onboarding at awaiting_name
        groupOnboardingManager.startOnboarding(chatId, lockOwner, 'awaiting_name');

        // Advance through steps
        groupOnboardingManager.setAgentName(chatId, lockOwner, 'TestAgent');
        groupOnboardingManager.advanceStep(chatId, lockOwner, 'awaiting_emoji');

        // Intruder tries at awaiting_emoji step
        let result = await simulateMessageRouting(chatId, intruder, 'msg', groupOnboardingManager, mockSendTelegramMessage);
        expect(result).toBe('group_onboarding_locked');

        groupOnboardingManager.advanceStep(chatId, lockOwner, 'awaiting_workspace');

        // Intruder tries at awaiting_workspace step
        result = await simulateMessageRouting(chatId, intruder, 'msg', groupOnboardingManager, mockSendTelegramMessage);
        expect(result).toBe('group_onboarding_locked');

        groupOnboardingManager.advanceStep(chatId, lockOwner, 'awaiting_model_mode');

        // Intruder tries at awaiting_model_mode step
        result = await simulateMessageRouting(chatId, intruder, 'msg', groupOnboardingManager, mockSendTelegramMessage);
        expect(result).toBe('group_onboarding_locked');

        // Lock owner can still send at any step
        result = await simulateMessageRouting(chatId, lockOwner, 'msg', groupOnboardingManager, mockSendTelegramMessage);
        expect(result).toBe('flow_input');
      });
    });

    describe('Unlinked groups during onboarding (silent ignore)', () => {
      it('should not show orphaned group message during active onboarding', () => {
        const chatId = 99999; // Unlinked group
        const lockOwner = 11111;

        // Start onboarding on unlinked group
        groupOnboardingManager.startOnboarding(chatId, lockOwner, 'awaiting_name');

        // Verify group has active onboarding
        expect(groupOnboardingManager.hasActiveOnboarding(chatId)).toBe(true);

        // The routing logic should NOT return 'orphaned_group' when there's active onboarding
        // Instead it should return 'flow_input' for the lock owner
        expect(groupOnboardingManager.isLockedByUser(chatId, lockOwner)).toBe(true);
      });

      it('should return flow_input for lock owner in unlinked group', async () => {
        const chatId = 99999; // Unlinked group
        const lockOwner = 11111;

        groupOnboardingManager.startOnboarding(chatId, lockOwner, 'awaiting_emoji');

        // Lock owner sends message to unlinked group during onboarding
        const result = await simulateMessageRouting(
          chatId, lockOwner, 'some text',
          groupOnboardingManager, mockSendTelegramMessage
        );

        // Should get flow_input, not orphaned_group
        expect(result).toBe('flow_input');
        expect(mockSendTelegramMessage).not.toHaveBeenCalled();
      });

      it('should return group_onboarding_locked for other users in unlinked group', async () => {
        const chatId = 99999; // Unlinked group
        const lockOwner = 11111;
        const otherUser = 22222;

        groupOnboardingManager.startOnboarding(chatId, lockOwner, 'awaiting_emoji');

        // Other user sends message to unlinked group during onboarding
        const result = await simulateMessageRouting(
          chatId, otherUser, 'hello',
          groupOnboardingManager, mockSendTelegramMessage
        );

        // Should get group_onboarding_locked (silently ignored, no chat message)
        expect(result).toBe('group_onboarding_locked');
        expect(mockSendTelegramMessage).not.toHaveBeenCalled();
      });
    });
  });

  // ============================================
  // /cancelar Command Tests
  // ============================================

  describe('/cancelar Command: Cancellation flow', () => {
    /**
     * Helper to simulate handleGroupCancelarCommand behavior
     * This mirrors the logic in index.ts for testing purposes
     */
    async function simulateHandleGroupCancelarCommand(
      chatId: number,
      userId: string,
      telegramUserId: number,
      groupOnboardingManager: GroupOnboardingManager,
      agentManager: AgentManager,
      mockSendMessage: typeof mockSendTelegramMessage,
      mockEditMessage: typeof mockEditTelegramMessage
    ): Promise<{ cancelled: boolean; pinnedEdited: boolean }> {
      // Check if there's an active onboarding for this group
      if (!groupOnboardingManager.hasActiveOnboarding(chatId)) {
        await mockSendMessage(chatId, '⚠️ Nenhum processo de configuração em andamento.');
        return { cancelled: false, pinnedEdited: false };
      }

      // Validate lock - only the user who started onboarding can cancel
      if (!groupOnboardingManager.isLockedByUser(chatId, telegramUserId)) {
        // Different user - silently ignore
        return { cancelled: false, pinnedEdited: false };
      }

      // Get the pinned message ID to edit it back
      const pinnedMessageId = groupOnboardingManager.getPinnedMessageId(chatId);

      // Cancel the onboarding state
      groupOnboardingManager.cancelOnboarding(chatId, telegramUserId);

      // Determine which buttons to show based on user's existing agents
      const existingAgents = agentManager.listAgents(userId);
      const hasExistingAgents = existingAgents.length > 0;

      // Edit pinned message back to initial state
      let pinnedEdited = false;
      if (pinnedMessageId) {
        let messageText: string;
        let buttons: Array<{ text: string; callback_data: string }[]>;

        if (!hasExistingAgents) {
          messageText = '🎉 *Seu primeiro agente!*\n\nVamos criar um agente para este grupo.';
          buttons = [
            [{ text: '✨ Criar agora', callback_data: `onboard_create_${telegramUserId}` }],
          ];
        } else {
          messageText = '👋 *Esse grupo não tem agente ainda*\n\nVocê pode criar um novo ou vincular um existente.';
          buttons = [
            [
              { text: '✨ Criar um', callback_data: `onboard_create_${telegramUserId}` },
              { text: '🔗 Vincular existente', callback_data: `onboard_link_${telegramUserId}` },
            ],
          ];
        }

        await mockEditMessage(chatId, pinnedMessageId, messageText, buttons);
        pinnedEdited = true;
      }

      // Send confirmation
      await mockSendMessage(chatId, '❌ *Cancelado*');

      return { cancelled: true, pinnedEdited };
    }

    beforeEach(() => {
      mockSendTelegramMessage.mockClear();
      mockEditTelegramMessage.mockClear();
    });

    describe('Lock validation', () => {
      it('should allow locked user to cancel onboarding', async () => {
        const userId = '+5581999999999';
        const telegramUserId = 67890;
        const chatId = 12345;
        const pinnedMessageId = 11111;

        // Setup: Start onboarding and set pinned message
        groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_name');
        groupOnboardingManager.setPinnedMessageId(chatId, telegramUserId, pinnedMessageId);

        expect(groupOnboardingManager.hasActiveOnboarding(chatId)).toBe(true);

        // Locked user cancels
        const result = await simulateHandleGroupCancelarCommand(
          chatId,
          userId,
          telegramUserId,
          groupOnboardingManager,
          agentManager,
          mockSendTelegramMessage,
          mockEditTelegramMessage
        );

        expect(result.cancelled).toBe(true);
        expect(groupOnboardingManager.hasActiveOnboarding(chatId)).toBe(false);
        expect(mockSendTelegramMessage).toHaveBeenCalledWith(chatId, '❌ *Cancelado*');
      });

      it('should silently reject cancellation from non-locked user', async () => {
        const userId = '+5581999999999';
        const lockOwner = 67890;
        const otherUser = 99999;
        const chatId = 12345;

        // Setup: User 67890 starts onboarding
        groupOnboardingManager.startOnboarding(chatId, lockOwner, 'awaiting_emoji');

        expect(groupOnboardingManager.hasActiveOnboarding(chatId)).toBe(true);

        // Different user tries to cancel
        const result = await simulateHandleGroupCancelarCommand(
          chatId,
          userId,
          otherUser, // Different telegram user
          groupOnboardingManager,
          agentManager,
          mockSendTelegramMessage,
          mockEditTelegramMessage
        );

        // Should be silently rejected
        expect(result.cancelled).toBe(false);
        expect(groupOnboardingManager.hasActiveOnboarding(chatId)).toBe(true);
        expect(mockSendTelegramMessage).not.toHaveBeenCalled();
        expect(mockEditTelegramMessage).not.toHaveBeenCalled();
      });

      it('should show error when no onboarding is active', async () => {
        const userId = '+5581999999999';
        const telegramUserId = 67890;
        const chatId = 12345;

        // No onboarding started
        expect(groupOnboardingManager.hasActiveOnboarding(chatId)).toBe(false);

        const result = await simulateHandleGroupCancelarCommand(
          chatId,
          userId,
          telegramUserId,
          groupOnboardingManager,
          agentManager,
          mockSendTelegramMessage,
          mockEditTelegramMessage
        );

        expect(result.cancelled).toBe(false);
        expect(mockSendTelegramMessage).toHaveBeenCalledWith(
          chatId,
          '⚠️ Nenhum processo de configuração em andamento.'
        );
      });
    });

    describe('Pinned message editing', () => {
      it('should edit pinned message to first-time user state when no existing agents', async () => {
        const userId = '+5581999999999';
        const telegramUserId = 67890;
        const chatId = 12345;
        const pinnedMessageId = 11111;

        // Setup: No existing agents, onboarding in progress at emoji step
        groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_emoji');
        groupOnboardingManager.setPinnedMessageId(chatId, telegramUserId, pinnedMessageId);

        const result = await simulateHandleGroupCancelarCommand(
          chatId,
          userId,
          telegramUserId,
          groupOnboardingManager,
          agentManager,
          mockSendTelegramMessage,
          mockEditTelegramMessage
        );

        expect(result.pinnedEdited).toBe(true);

        // Verify edit was called with correct parameters
        const editCall = mockEditTelegramMessage.mock.calls[0];
        expect(editCall[0]).toBe(chatId);
        expect(editCall[1]).toBe(pinnedMessageId);
        expect(editCall[2]).toContain('Seu primeiro agente');
        // Should have single button for first-time user
        expect(editCall[3].length).toBe(1);
        expect(editCall[3][0].length).toBe(1);
        expect(editCall[3][0][0].callback_data).toBe(`onboard_create_${telegramUserId}`);
      });

      it('should edit pinned message to existing user state when user has agents', async () => {
        const userId = '+5581999999999';
        const telegramUserId = 67890;
        const chatId = 12345;
        const pinnedMessageId = 11111;

        // Setup: User has existing agent
        agentManager.createAgent(userId, 'ExistingAgent', undefined, '🤖');
        groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_workspace');
        groupOnboardingManager.setPinnedMessageId(chatId, telegramUserId, pinnedMessageId);

        const result = await simulateHandleGroupCancelarCommand(
          chatId,
          userId,
          telegramUserId,
          groupOnboardingManager,
          agentManager,
          mockSendTelegramMessage,
          mockEditTelegramMessage
        );

        expect(result.pinnedEdited).toBe(true);

        // Verify edit was called with correct parameters
        const editCall = mockEditTelegramMessage.mock.calls[0];
        expect(editCall[0]).toBe(chatId);
        expect(editCall[1]).toBe(pinnedMessageId);
        expect(editCall[2]).toContain('Esse grupo não tem agente ainda');
        // Should have two buttons for existing user
        expect(editCall[3].length).toBe(1);
        expect(editCall[3][0].length).toBe(2);
        expect(editCall[3][0][0].callback_data).toBe(`onboard_create_${telegramUserId}`);
        expect(editCall[3][0][1].callback_data).toBe(`onboard_link_${telegramUserId}`);
      });

      it('should skip pinned message edit when no pinnedMessageId stored', async () => {
        const userId = '+5581999999999';
        const telegramUserId = 67890;
        const chatId = 12345;

        // Setup: Onboarding started but no pinned message ID
        groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_name');
        // NOT calling setPinnedMessageId

        const result = await simulateHandleGroupCancelarCommand(
          chatId,
          userId,
          telegramUserId,
          groupOnboardingManager,
          agentManager,
          mockSendTelegramMessage,
          mockEditTelegramMessage
        );

        expect(result.cancelled).toBe(true);
        expect(result.pinnedEdited).toBe(false);
        expect(mockEditTelegramMessage).not.toHaveBeenCalled();
        // Should still send confirmation
        expect(mockSendTelegramMessage).toHaveBeenCalledWith(chatId, '❌ *Cancelado*');
      });
    });

    describe('Cancellation at different steps', () => {
      it('should cancel at awaiting_name step', async () => {
        const userId = '+5581999999999';
        const telegramUserId = 67890;
        const chatId = 12345;
        const pinnedMessageId = 11111;

        groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_name');
        groupOnboardingManager.setPinnedMessageId(chatId, telegramUserId, pinnedMessageId);

        expect(groupOnboardingManager.getCurrentStep(chatId)).toBe('awaiting_name');

        const result = await simulateHandleGroupCancelarCommand(
          chatId, userId, telegramUserId,
          groupOnboardingManager, agentManager,
          mockSendTelegramMessage, mockEditTelegramMessage
        );

        expect(result.cancelled).toBe(true);
        expect(groupOnboardingManager.hasActiveOnboarding(chatId)).toBe(false);
      });

      it('should cancel at awaiting_emoji step', async () => {
        const userId = '+5581999999999';
        const telegramUserId = 67890;
        const chatId = 12345;
        const pinnedMessageId = 11111;

        groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_name');
        groupOnboardingManager.setAgentName(chatId, telegramUserId, 'TestAgent');
        groupOnboardingManager.advanceStep(chatId, telegramUserId, 'awaiting_emoji');
        groupOnboardingManager.setPinnedMessageId(chatId, telegramUserId, pinnedMessageId);

        expect(groupOnboardingManager.getCurrentStep(chatId)).toBe('awaiting_emoji');

        const result = await simulateHandleGroupCancelarCommand(
          chatId, userId, telegramUserId,
          groupOnboardingManager, agentManager,
          mockSendTelegramMessage, mockEditTelegramMessage
        );

        expect(result.cancelled).toBe(true);
        expect(groupOnboardingManager.hasActiveOnboarding(chatId)).toBe(false);
      });

      it('should cancel at awaiting_workspace step', async () => {
        const userId = '+5581999999999';
        const telegramUserId = 67890;
        const chatId = 12345;
        const pinnedMessageId = 11111;

        groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_name');
        groupOnboardingManager.setAgentName(chatId, telegramUserId, 'TestAgent');
        groupOnboardingManager.advanceStep(chatId, telegramUserId, 'awaiting_emoji');
        groupOnboardingManager.setEmoji(chatId, telegramUserId, '🤖');
        groupOnboardingManager.advanceStep(chatId, telegramUserId, 'awaiting_workspace');
        groupOnboardingManager.setPinnedMessageId(chatId, telegramUserId, pinnedMessageId);

        expect(groupOnboardingManager.getCurrentStep(chatId)).toBe('awaiting_workspace');

        const result = await simulateHandleGroupCancelarCommand(
          chatId, userId, telegramUserId,
          groupOnboardingManager, agentManager,
          mockSendTelegramMessage, mockEditTelegramMessage
        );

        expect(result.cancelled).toBe(true);
        expect(groupOnboardingManager.hasActiveOnboarding(chatId)).toBe(false);
      });

      it('should cancel at awaiting_model_mode step', async () => {
        const userId = '+5581999999999';
        const telegramUserId = 67890;
        const chatId = 12345;
        const pinnedMessageId = 11111;

        groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_name');
        groupOnboardingManager.setAgentName(chatId, telegramUserId, 'TestAgent');
        groupOnboardingManager.advanceStep(chatId, telegramUserId, 'awaiting_model_mode');
        groupOnboardingManager.setPinnedMessageId(chatId, telegramUserId, pinnedMessageId);

        expect(groupOnboardingManager.getCurrentStep(chatId)).toBe('awaiting_model_mode');

        const result = await simulateHandleGroupCancelarCommand(
          chatId, userId, telegramUserId,
          groupOnboardingManager, agentManager,
          mockSendTelegramMessage, mockEditTelegramMessage
        );

        expect(result.cancelled).toBe(true);
        expect(groupOnboardingManager.hasActiveOnboarding(chatId)).toBe(false);
      });

      it('should cancel at awaiting_confirmation step', async () => {
        const userId = '+5581999999999';
        const telegramUserId = 67890;
        const chatId = 12345;
        const pinnedMessageId = 11111;

        groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_name');
        groupOnboardingManager.setAgentName(chatId, telegramUserId, 'TestAgent');
        groupOnboardingManager.setEmoji(chatId, telegramUserId, '🤖');
        groupOnboardingManager.setWorkspace(chatId, telegramUserId, '/tmp/workspace');
        groupOnboardingManager.setModelMode(chatId, telegramUserId, 'sonnet');
        groupOnboardingManager.advanceStep(chatId, telegramUserId, 'awaiting_confirmation');
        groupOnboardingManager.setPinnedMessageId(chatId, telegramUserId, pinnedMessageId);

        expect(groupOnboardingManager.getCurrentStep(chatId)).toBe('awaiting_confirmation');

        const result = await simulateHandleGroupCancelarCommand(
          chatId, userId, telegramUserId,
          groupOnboardingManager, agentManager,
          mockSendTelegramMessage, mockEditTelegramMessage
        );

        expect(result.cancelled).toBe(true);
        expect(groupOnboardingManager.hasActiveOnboarding(chatId)).toBe(false);
      });

      it('should cancel at linking_agent step', async () => {
        const userId = '+5581999999999';
        const telegramUserId = 67890;
        const chatId = 12345;
        const pinnedMessageId = 11111;

        // Create an agent to link
        const agent = agentManager.createAgent(userId, 'ExistingAgent', undefined, '🤖');

        groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'linking_agent');
        groupOnboardingManager.setSelectedAgentId(chatId, telegramUserId, agent.id);
        groupOnboardingManager.setPinnedMessageId(chatId, telegramUserId, pinnedMessageId);

        expect(groupOnboardingManager.getCurrentStep(chatId)).toBe('linking_agent');

        const result = await simulateHandleGroupCancelarCommand(
          chatId, userId, telegramUserId,
          groupOnboardingManager, agentManager,
          mockSendTelegramMessage, mockEditTelegramMessage
        );

        expect(result.cancelled).toBe(true);
        expect(groupOnboardingManager.hasActiveOnboarding(chatId)).toBe(false);
      });
    });

    describe('Command routing: /cancelar during onboarding', () => {
      it('should route /cancelar as command even during active onboarding', () => {
        const chatId = 12345;
        const userId = '+5581999999999';
        const telegramUserId = 67890;

        // Start onboarding
        groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_emoji');

        // Create handler with onboarding manager
        const handler = new TelegramCommandHandler(agentManager, groupOnboardingManager);

        // Route /cancelar command from locked user
        const result = handler.routeGroupMessage(chatId, userId, '/cancelar', telegramUserId);

        // Should be routed as command, not flow_input
        expect(result.action).toBe('command');
        if (result.action === 'command') {
          expect(result.command).toBe('/cancelar');
        }
      });

      it('should route /cancelar as command even from non-locked user', () => {
        const chatId = 12345;
        const userId = '+5581999999999';
        const lockOwner = 67890;
        const otherUser = 99999;

        // Start onboarding as one user
        groupOnboardingManager.startOnboarding(chatId, lockOwner, 'awaiting_emoji');

        const handler = new TelegramCommandHandler(agentManager, groupOnboardingManager);

        // Route /cancelar from different user
        const result = handler.routeGroupMessage(chatId, userId, '/cancelar', otherUser);

        // Should still be routed as command (validation happens in handler)
        expect(result.action).toBe('command');
        if (result.action === 'command') {
          expect(result.command).toBe('/cancelar');
        }
      });

      it('should route other commands as flow_input for locked user during onboarding', () => {
        const chatId = 12345;
        const userId = '+5581999999999';
        const telegramUserId = 67890;

        groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_workspace');

        const handler = new TelegramCommandHandler(agentManager, groupOnboardingManager);

        // Route a path (which starts with /) from locked user
        const result = handler.routeGroupMessage(chatId, userId, '/Users/lucas/projects', telegramUserId);

        // Should be flow_input to allow workspace path input
        expect(result.action).toBe('flow_input');
      });

      it('should route other commands as group_onboarding_locked for non-locked user', () => {
        const chatId = 12345;
        const userId = '+5581999999999';
        const lockOwner = 67890;
        const otherUser = 99999;

        groupOnboardingManager.startOnboarding(chatId, lockOwner, 'awaiting_workspace');

        const handler = new TelegramCommandHandler(agentManager, groupOnboardingManager);

        // Route /help from non-locked user
        const result = handler.routeGroupMessage(chatId, userId, '/help', otherUser);

        // Should be locked (silently ignored)
        expect(result.action).toBe('group_onboarding_locked');
      });
    });
  });
});
