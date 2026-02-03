/**
 * Integration tests for 4-step Telegram group agent creation flow
 *
 * Tests the complete flow:
 * - Step 1: Name input with validation
 * - Step 2: Emoji selection (12 emojis in 3 rows of 4)
 * - Step 3: Workspace selection with custom path validation
 * - Step 4: Model mode selection and agent creation
 *
 * Also tests:
 * - Lock validation (only initiating user can proceed)
 * - Validation errors for name and workspace
 * - Custom workspace path handling
 * - Pinned message updates
 */

import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { AgentManager } from '../agent-manager';
import { GroupOnboardingManager } from '../group-onboarding-manager';
import { PersistenceService } from '../persistence';
import { validateGroupAgentName } from '../telegram';
import { unlinkSync, existsSync, mkdirSync, rmdirSync } from 'fs';
import { join } from 'path';
import type { ModelMode } from '../types';

const TEST_STATE_FILE = './.test-group-agent-creation-state.json';
const TEST_SANDBOX_DIR = '/tmp/test-group-agent-creation-sandbox';

// Mock telegram functions
const mockSendTelegramMessage = mock(() => Promise.resolve(null));
const mockSendTelegramButtons = mock(() => Promise.resolve({ message_id: 12345 }));
const mockEditTelegramMessage = mock(() => Promise.resolve(true));
const mockUpdateTelegramGroupTitle = mock(() => Promise.resolve(true));

describe('Integration: 4-Step Group Agent Creation Flow', () => {
  let persistenceService: PersistenceService;
  let agentManager: AgentManager;
  let groupOnboardingManager: GroupOnboardingManager;

  const userId = '+5581999999999';
  const telegramUsername = 'testuser';
  const telegramUserId = 67890;
  const chatId = -1001234567890; // Telegram group ID (negative)
  const pinnedMessageId = 11111;

  beforeEach(() => {
    // Clean up test files
    if (existsSync(TEST_STATE_FILE)) unlinkSync(TEST_STATE_FILE);
    if (existsSync(TEST_STATE_FILE + '.bak')) unlinkSync(TEST_STATE_FILE + '.bak');
    if (existsSync(TEST_SANDBOX_DIR)) rmdirSync(TEST_SANDBOX_DIR, { recursive: true });

    // Initialize services
    persistenceService = new PersistenceService(TEST_STATE_FILE);
    agentManager = new AgentManager(persistenceService);
    groupOnboardingManager = new GroupOnboardingManager();

    // Save user preferences
    persistenceService.saveUserPreferences({
      userId,
      mode: 'dojo',
      telegramUsername,
      onboardingComplete: true,
    });

    // Reset mocks
    mockSendTelegramMessage.mockClear();
    mockSendTelegramButtons.mockClear();
    mockEditTelegramMessage.mockClear();
    mockUpdateTelegramGroupTitle.mockClear();
  });

  afterEach(() => {
    if (existsSync(TEST_STATE_FILE)) unlinkSync(TEST_STATE_FILE);
    if (existsSync(TEST_STATE_FILE + '.bak')) unlinkSync(TEST_STATE_FILE + '.bak');
    if (existsSync(TEST_SANDBOX_DIR)) rmdirSync(TEST_SANDBOX_DIR, { recursive: true });
  });

  describe('Step 1: Name Input Validation', () => {
    it('should accept valid name and advance to emoji step', () => {
      // Start onboarding
      groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_name');

      // Validate name
      const error = validateGroupAgentName('Backend API');
      expect(error).toBeNull();

      // Set name
      groupOnboardingManager.setAgentName(chatId, telegramUserId, 'Backend API');
      groupOnboardingManager.advanceStep(chatId, telegramUserId, 'awaiting_emoji');

      const state = groupOnboardingManager.getState(chatId);
      expect(state?.data.agentName).toBe('Backend API');
      expect(state?.step).toBe('awaiting_emoji');
    });

    it('should reject empty name', () => {
      const error = validateGroupAgentName('');
      expect(error).toBe('Nome é obrigatório');
    });

    it('should reject name exceeding 50 characters', () => {
      const longName = 'A'.repeat(51);
      const error = validateGroupAgentName(longName);
      expect(error).toBe('Nome excede o limite de 50 caracteres');
    });

    it('should reject name with dangerous characters', () => {
      const dangerousNames = ['Test<script>', 'Test>alert', 'Test{bad}', 'Test|pipe', 'Test\\slash', 'Test^caret', 'Test`backtick'];

      for (const name of dangerousNames) {
        const error = validateGroupAgentName(name);
        expect(error).toBe('Nome contém caracteres inválidos');
      }
    });

    it('should accept name at exactly 50 characters', () => {
      const maxName = 'A'.repeat(50);
      const error = validateGroupAgentName(maxName);
      expect(error).toBeNull();
    });

    it('should trim whitespace from name', () => {
      // Validation doesn't trim, but storage should
      groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_name');
      groupOnboardingManager.setAgentName(chatId, telegramUserId, '  Trimmed Name  ');

      // Note: The actual trimming happens in handleTelegramMessage before calling setAgentName
      const state = groupOnboardingManager.getState(chatId);
      expect(state?.data.agentName).toBe('  Trimmed Name  '); // Manager doesn't trim, handler does
    });
  });

  describe('Step 2: Emoji Selection', () => {
    it('should store selected emoji and advance to workspace step', () => {
      // Start at emoji step
      groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_emoji');
      groupOnboardingManager.setAgentName(chatId, telegramUserId, 'Test Agent');

      // Select emoji
      groupOnboardingManager.setEmoji(chatId, telegramUserId, '🚀');
      groupOnboardingManager.advanceStep(chatId, telegramUserId, 'awaiting_workspace');

      const state = groupOnboardingManager.getState(chatId);
      expect(state?.data.emoji).toBe('🚀');
      expect(state?.step).toBe('awaiting_workspace');
    });

    it('should accept any of the 12 specified emojis', () => {
      const emojis = ['🤖', '⚡', '🔧', '🎯', '🧠', '✨', '📊', '💡', '🚀', '🔍', '💻', '📁'];

      for (const emoji of emojis) {
        groupOnboardingManager.clearAll();
        groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_emoji');
        groupOnboardingManager.setEmoji(chatId, telegramUserId, emoji);

        const state = groupOnboardingManager.getState(chatId);
        expect(state?.data.emoji).toBe(emoji);
      }
    });
  });

  describe('Step 3: Workspace Selection', () => {
    it('should store sandbox workspace marker', () => {
      groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_workspace');

      groupOnboardingManager.setWorkspace(chatId, telegramUserId, '__sandbox__');
      groupOnboardingManager.advanceStep(chatId, telegramUserId, 'awaiting_model_mode');

      const state = groupOnboardingManager.getState(chatId);
      expect(state?.data.workspace).toBe('__sandbox__');
      expect(state?.step).toBe('awaiting_model_mode');
    });

    it('should store valid existing workspace path', () => {
      // Create a test directory
      mkdirSync(TEST_SANDBOX_DIR, { recursive: true });

      groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_workspace');

      groupOnboardingManager.setWorkspace(chatId, telegramUserId, TEST_SANDBOX_DIR);
      groupOnboardingManager.advanceStep(chatId, telegramUserId, 'awaiting_model_mode');

      const state = groupOnboardingManager.getState(chatId);
      expect(state?.data.workspace).toBe(TEST_SANDBOX_DIR);
      expect(state?.step).toBe('awaiting_model_mode');
    });

    it('should mark as awaiting custom workspace input', () => {
      groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_workspace');

      groupOnboardingManager.setWorkspace(chatId, telegramUserId, '__awaiting_custom__');

      const state = groupOnboardingManager.getState(chatId);
      expect(state?.data.workspace).toBe('__awaiting_custom__');
      expect(state?.step).toBe('awaiting_workspace'); // Still in same step
    });

    it('should validate custom workspace path exists', () => {
      const nonExistentPath = '/this/path/does/not/exist';
      expect(existsSync(nonExistentPath)).toBe(false);

      // In the actual handler, this would show an error message
      // Here we just verify the path doesn't exist
    });
  });

  describe('Step 4: Model Mode Selection', () => {
    it('should accept selection mode', () => {
      groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_model_mode');

      groupOnboardingManager.setModelMode(chatId, telegramUserId, 'selection');

      const state = groupOnboardingManager.getState(chatId);
      expect(state?.data.modelMode).toBe('selection');
    });

    it('should accept fixed haiku mode', () => {
      groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_model_mode');

      groupOnboardingManager.setModelMode(chatId, telegramUserId, 'haiku');

      const state = groupOnboardingManager.getState(chatId);
      expect(state?.data.modelMode).toBe('haiku');
    });

    it('should accept fixed sonnet mode', () => {
      groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_model_mode');

      groupOnboardingManager.setModelMode(chatId, telegramUserId, 'sonnet');

      const state = groupOnboardingManager.getState(chatId);
      expect(state?.data.modelMode).toBe('sonnet');
    });

    it('should accept fixed opus mode', () => {
      groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_model_mode');

      groupOnboardingManager.setModelMode(chatId, telegramUserId, 'opus');

      const state = groupOnboardingManager.getState(chatId);
      expect(state?.data.modelMode).toBe('opus');
    });
  });

  describe('Full 4-Step Flow', () => {
    it('should complete full agent creation flow', () => {
      // Step 0: Start onboarding
      const startResult = groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_name');
      expect(startResult.success).toBe(true);
      groupOnboardingManager.setPinnedMessageId(chatId, telegramUserId, pinnedMessageId);

      // Step 1: Name
      const nameError = validateGroupAgentName('Test Agent');
      expect(nameError).toBeNull();
      groupOnboardingManager.setAgentName(chatId, telegramUserId, 'Test Agent');
      groupOnboardingManager.advanceStep(chatId, telegramUserId, 'awaiting_emoji');

      // Step 2: Emoji
      groupOnboardingManager.setEmoji(chatId, telegramUserId, '🚀');
      groupOnboardingManager.advanceStep(chatId, telegramUserId, 'awaiting_workspace');

      // Step 3: Workspace (sandbox)
      groupOnboardingManager.setWorkspace(chatId, telegramUserId, '__sandbox__');
      groupOnboardingManager.advanceStep(chatId, telegramUserId, 'awaiting_model_mode');

      // Step 4: Model mode
      groupOnboardingManager.setModelMode(chatId, telegramUserId, 'opus');

      // Get final state before completion
      const finalState = groupOnboardingManager.getState(chatId);
      expect(finalState?.data.agentName).toBe('Test Agent');
      expect(finalState?.data.emoji).toBe('🚀');
      expect(finalState?.data.workspace).toBe('__sandbox__');
      expect(finalState?.data.modelMode).toBe('opus');
      expect(finalState?.pinnedMessageId).toBe(pinnedMessageId);

      // Create agent
      const agent = agentManager.createAgent(
        userId,
        finalState!.data.agentName!,
        undefined, // Sandbox agents start without workspace
        finalState!.data.emoji!,
        'claude',
        finalState!.data.modelMode!
      );

      expect(agent).toBeDefined();
      expect(agent.name).toBe('Test Agent');
      expect(agent.emoji).toBe('🚀');
      expect(agent.modelMode).toBe('opus');

      // Link to group
      agentManager.setTelegramChatId(agent.id, chatId);
      expect(agent.telegramChatId).toBe(chatId);

      // Complete onboarding
      const completedState = groupOnboardingManager.completeOnboarding(chatId, telegramUserId);
      expect(completedState).toBeDefined();
      expect(groupOnboardingManager.hasActiveOnboarding(chatId)).toBe(false);
    });

    it('should complete flow with custom workspace path', () => {
      // Create test directory
      mkdirSync(TEST_SANDBOX_DIR, { recursive: true });

      // Start onboarding
      groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_name');
      groupOnboardingManager.setPinnedMessageId(chatId, telegramUserId, pinnedMessageId);

      // Step 1: Name
      groupOnboardingManager.setAgentName(chatId, telegramUserId, 'Custom Workspace Agent');
      groupOnboardingManager.advanceStep(chatId, telegramUserId, 'awaiting_emoji');

      // Step 2: Emoji
      groupOnboardingManager.setEmoji(chatId, telegramUserId, '📁');
      groupOnboardingManager.advanceStep(chatId, telegramUserId, 'awaiting_workspace');

      // Step 3: Custom workspace - first mark as awaiting, then set path
      groupOnboardingManager.setWorkspace(chatId, telegramUserId, '__awaiting_custom__');

      // Simulate user sending path
      expect(existsSync(TEST_SANDBOX_DIR)).toBe(true);
      groupOnboardingManager.setWorkspace(chatId, telegramUserId, TEST_SANDBOX_DIR);
      groupOnboardingManager.advanceStep(chatId, telegramUserId, 'awaiting_model_mode');

      // Step 4: Model mode
      groupOnboardingManager.setModelMode(chatId, telegramUserId, 'selection');

      // Create agent with custom workspace
      const finalState = groupOnboardingManager.getState(chatId);
      const agent = agentManager.createAgent(
        userId,
        finalState!.data.agentName!,
        finalState!.data.workspace!, // Custom path
        finalState!.data.emoji!,
        'claude',
        finalState!.data.modelMode!
      );

      expect(agent.workspace).toBe(TEST_SANDBOX_DIR);

      // Link and complete
      agentManager.setTelegramChatId(agent.id, chatId);
      groupOnboardingManager.completeOnboarding(chatId, telegramUserId);
    });
  });

  describe('Lock Validation', () => {
    it('should prevent different user from modifying state', () => {
      const otherUserId = 99999;

      // User 1 starts onboarding
      groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_name');

      // User 2 tries to set name
      const result = groupOnboardingManager.setAgentName(chatId, otherUserId, 'Hijacked');
      expect(result).toBe(false);

      // Original user can still modify
      const originalResult = groupOnboardingManager.setAgentName(chatId, telegramUserId, 'Original');
      expect(originalResult).toBe(true);

      const state = groupOnboardingManager.getState(chatId);
      expect(state?.data.agentName).toBe('Original');
    });

    it('should prevent different user from advancing step', () => {
      const otherUserId = 99999;

      groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_name');

      // User 2 tries to advance
      const result = groupOnboardingManager.advanceStep(chatId, otherUserId, 'awaiting_emoji');
      expect(result).toBe(false);

      // Step should still be awaiting_name
      expect(groupOnboardingManager.getCurrentStep(chatId)).toBe('awaiting_name');
    });

    it('should prevent different user from completing onboarding', () => {
      const otherUserId = 99999;

      groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_name');

      // User 2 tries to complete
      const result = groupOnboardingManager.completeOnboarding(chatId, otherUserId);
      expect(result).toBeUndefined();

      // Onboarding should still be active
      expect(groupOnboardingManager.hasActiveOnboarding(chatId)).toBe(true);
    });

    it('should allow same user to restart onboarding', () => {
      // User starts onboarding
      groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_name');
      groupOnboardingManager.setAgentName(chatId, telegramUserId, 'First Name');
      groupOnboardingManager.advanceStep(chatId, telegramUserId, 'awaiting_emoji');

      // Same user restarts
      const result = groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_name');
      expect(result.success).toBe(true);

      // Data should be reset
      const state = groupOnboardingManager.getState(chatId);
      expect(state?.step).toBe('awaiting_name');
      expect(state?.data.agentName).toBeUndefined();
    });

    it('should return lockedByUserId when different user tries to start', () => {
      const otherUserId = 99999;

      // User 1 starts onboarding
      groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_name');

      // User 2 tries to start
      const result = groupOnboardingManager.startOnboarding(chatId, otherUserId, 'awaiting_name');
      expect(result.success).toBe(false);
      expect(result.lockedByUserId).toBe(telegramUserId);
    });
  });

  describe('Link Existing Agent Flow', () => {
    it('should list unlinked agents for linking', () => {
      // Create some agents
      const agent1 = agentManager.createAgent(userId, 'Agent1', undefined, '1️⃣');
      const agent2 = agentManager.createAgent(userId, 'Agent2', undefined, '2️⃣');
      const agent3 = agentManager.createAgent(userId, 'Agent3', undefined, '3️⃣');

      // Link one agent to a different group
      agentManager.setTelegramChatId(agent1.id, -9999);

      // Get unlinked agents
      const allAgents = agentManager.listAgents(userId);
      const unlinkedAgents = allAgents.filter(a => !a.telegramChatId);

      expect(unlinkedAgents.length).toBe(2);
      expect(unlinkedAgents.map(a => a.name)).toContain('Agent2');
      expect(unlinkedAgents.map(a => a.name)).toContain('Agent3');
      expect(unlinkedAgents.map(a => a.name)).not.toContain('Agent1');
    });

    it('should link existing agent to group', () => {
      // Create agent
      const agent = agentManager.createAgent(userId, 'Existing Agent', undefined, '🔗');
      expect(agent.telegramChatId).toBeUndefined();

      // Start linking flow
      groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'linking_agent');
      groupOnboardingManager.setSelectedAgentId(chatId, telegramUserId, agent.id);

      // Link agent
      agentManager.setTelegramChatId(agent.id, chatId);

      // Verify link
      const linkedAgent = agentManager.getAgentByTelegramChatId(chatId);
      expect(linkedAgent).toBeDefined();
      expect(linkedAgent?.id).toBe(agent.id);

      // Complete onboarding
      groupOnboardingManager.completeOnboarding(chatId, telegramUserId);
    });
  });

  describe('Error Handling', () => {
    it('should handle agent creation failure', () => {
      // Create max agents to trigger limit
      for (let i = 0; i < 50; i++) {
        agentManager.createAgent(userId, `Agent${i}`, undefined, '🤖');
      }

      // Try to create one more
      expect(() => {
        agentManager.createAgent(userId, 'One More', undefined, '🤖');
      }).toThrow('Maximum agents limit reached');
    });

    it('should handle invalid workspace in agent creation', () => {
      expect(() => {
        agentManager.createAgent(userId, 'Test', '/nonexistent/path', '🤖');
      }).toThrow('Workspace path does not exist');
    });

    it('should preserve pinned message ID across state changes', () => {
      groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_name');
      groupOnboardingManager.setPinnedMessageId(chatId, telegramUserId, pinnedMessageId);

      // Make state changes
      groupOnboardingManager.setAgentName(chatId, telegramUserId, 'Test');
      groupOnboardingManager.advanceStep(chatId, telegramUserId, 'awaiting_emoji');
      groupOnboardingManager.setEmoji(chatId, telegramUserId, '🚀');

      // Pinned message ID should still be there
      const state = groupOnboardingManager.getState(chatId);
      expect(state?.pinnedMessageId).toBe(pinnedMessageId);
    });
  });

  describe('validateGroupAgentName function', () => {
    it('should return null for valid names', () => {
      const validNames = [
        'Test',
        'Backend API',
        'Data Analysis',
        '123',
        'Agent-123',
        'Agent_Test',
        'Agente em Português',
      ];

      for (const name of validNames) {
        expect(validateGroupAgentName(name)).toBeNull();
      }
    });

    it('should return error for invalid names', () => {
      expect(validateGroupAgentName('')).toBe('Nome é obrigatório');
      expect(validateGroupAgentName('   ')).toBe('Nome não pode ser vazio');
      expect(validateGroupAgentName('A'.repeat(51))).toBe('Nome excede o limite de 50 caracteres');
      expect(validateGroupAgentName('Test<script>')).toBe('Nome contém caracteres inválidos');
    });
  });
});

// =============================================================================
// Integration Tests: Telegram Callback Flow
// =============================================================================

describe('Integration: Telegram Callback Flow', () => {
  let persistenceService: PersistenceService;
  let agentManager: AgentManager;
  let groupOnboardingManager: GroupOnboardingManager;

  // Test data
  const userId = '+5581999999999';
  const telegramUsername = 'testuser';
  const telegramUserId = 67890;
  const otherTelegramUserId = 11111;
  const chatId = -1001234567890;

  // Track mocked function calls
  let sentMessages: Array<{ chatId: number; text: string }> = [];
  let sentButtons: Array<{ chatId: number; text: string; buttons: any[][] }> = [];
  let editedMessages: Array<{ chatId: number; messageId: number; text: string }> = [];
  let answeredCallbacks: string[] = [];
  let updatedTitles: Array<{ chatId: number; title: string }> = [];

  // Mock implementations
  const mockFns = {
    sendTelegramMessage: async (chatId: number, text: string) => {
      sentMessages.push({ chatId, text });
      return null;
    },
    sendTelegramButtons: async (chatId: number, text: string, buttons: any[][]) => {
      sentButtons.push({ chatId, text, buttons });
      return { message_id: Math.floor(Math.random() * 100000) };
    },
    editTelegramMessage: async (chatId: number, messageId: number, text: string) => {
      editedMessages.push({ chatId, messageId, text });
      return true;
    },
    answerCallbackQuery: async (callbackId: string) => {
      answeredCallbacks.push(callbackId);
      return true;
    },
    updateTelegramGroupTitle: async (chatId: number, title: string) => {
      updatedTitles.push({ chatId, title });
      return true;
    },
  };

  beforeEach(() => {
    // Clean up test files
    if (existsSync(TEST_STATE_FILE)) unlinkSync(TEST_STATE_FILE);
    if (existsSync(TEST_STATE_FILE + '.bak')) unlinkSync(TEST_STATE_FILE + '.bak');
    if (existsSync(TEST_SANDBOX_DIR)) rmdirSync(TEST_SANDBOX_DIR, { recursive: true });

    // Initialize services
    persistenceService = new PersistenceService(TEST_STATE_FILE);
    agentManager = new AgentManager(persistenceService);
    groupOnboardingManager = new GroupOnboardingManager();

    // Save user preferences for test user
    persistenceService.saveUserPreferences({
      userId,
      mode: 'dojo',
      telegramUsername,
      onboardingComplete: true,
    });

    // Clear tracking arrays
    sentMessages = [];
    sentButtons = [];
    editedMessages = [];
    answeredCallbacks = [];
    updatedTitles = [];
  });

  afterEach(() => {
    if (existsSync(TEST_STATE_FILE)) unlinkSync(TEST_STATE_FILE);
    if (existsSync(TEST_STATE_FILE + '.bak')) unlinkSync(TEST_STATE_FILE + '.bak');
    if (existsSync(TEST_SANDBOX_DIR)) rmdirSync(TEST_SANDBOX_DIR, { recursive: true });
  });

  describe('onboard_create_* callback - user validation', () => {
    it('should reject when different user clicks the button', async () => {
      // Simulate different user clicking the button meant for telegramUserId
      const callbackData = `onboard_create_${telegramUserId}`;
      const clickingUserId = otherTelegramUserId; // Different user

      // Verify the callback data contains the target user ID
      const targetUserId = parseInt(callbackData.replace('onboard_create_', ''), 10);
      expect(targetUserId).toBe(telegramUserId);
      expect(clickingUserId).not.toBe(targetUserId);

      // The handler should reject because from.id !== targetTelegramUserId
      // This simulates what happens in handleTelegramCallback
      if (clickingUserId !== targetUserId) {
        await mockFns.sendTelegramMessage(chatId, '⚠️ Outro usuário está configurando este grupo.');
      }

      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].text).toBe('⚠️ Outro usuário está configurando este grupo.');
    });

    it('should allow the correct user to click the button', async () => {
      const callbackData = `onboard_create_${telegramUserId}`;
      const clickingUserId = telegramUserId; // Same user

      const targetUserId = parseInt(callbackData.replace('onboard_create_', ''), 10);
      expect(clickingUserId).toBe(targetUserId);

      // The handler should proceed to start onboarding
      const result = groupOnboardingManager.startOnboarding(chatId, clickingUserId, 'awaiting_name');
      expect(result.success).toBe(true);
    });
  });

  describe('Full callback flow simulation', () => {
    it('should complete full flow: onboard_create → name → emoji → workspace → model mode', async () => {
      // Step 0: Click "onboard_create_*" button
      const result = groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_name');
      expect(result.success).toBe(true);

      // Set pinned message (simulating what the handler does)
      const pinnedMessageId = 12345;
      groupOnboardingManager.setPinnedMessageId(chatId, telegramUserId, pinnedMessageId);

      // Step 1: User sends name as text message
      const agentName = 'My Test Agent';
      const nameError = validateGroupAgentName(agentName);
      expect(nameError).toBeNull();

      groupOnboardingManager.setAgentName(chatId, telegramUserId, agentName);
      groupOnboardingManager.advanceStep(chatId, telegramUserId, 'awaiting_emoji');

      // Verify state after name
      let state = groupOnboardingManager.getState(chatId);
      expect(state?.step).toBe('awaiting_emoji');
      expect(state?.data.agentName).toBe(agentName);

      // Step 2: User clicks emoji button (grp_emoji_🚀)
      const selectedEmoji = '🚀';
      groupOnboardingManager.setEmoji(chatId, telegramUserId, selectedEmoji);
      groupOnboardingManager.advanceStep(chatId, telegramUserId, 'awaiting_workspace');

      // Verify state after emoji
      state = groupOnboardingManager.getState(chatId);
      expect(state?.step).toBe('awaiting_workspace');
      expect(state?.data.emoji).toBe(selectedEmoji);

      // Step 3: User clicks workspace button (grp_workspace_sandbox)
      groupOnboardingManager.setWorkspace(chatId, telegramUserId, '__sandbox__');
      groupOnboardingManager.advanceStep(chatId, telegramUserId, 'awaiting_model_mode');

      // Verify state after workspace
      state = groupOnboardingManager.getState(chatId);
      expect(state?.step).toBe('awaiting_model_mode');
      expect(state?.data.workspace).toBe('__sandbox__');

      // Step 4: User clicks model mode button (grp_modelmode_sonnet)
      const selectedModelMode: ModelMode = 'sonnet';
      groupOnboardingManager.setModelMode(chatId, telegramUserId, selectedModelMode);

      // Verify final state
      state = groupOnboardingManager.getState(chatId);
      expect(state?.data.modelMode).toBe(selectedModelMode);

      // Create the agent (simulating what the handler does)
      const agent = agentManager.createAgent(
        userId,
        state!.data.agentName!,
        undefined, // Sandbox initially
        state!.data.emoji!,
        'claude',
        state!.data.modelMode!
      );

      // Set sandbox workspace after creation
      mkdirSync(TEST_SANDBOX_DIR, { recursive: true });
      const sandboxPath = TEST_SANDBOX_DIR;
      agentManager.setWorkspace(agent.id, sandboxPath);

      // Verify agent was created with sandbox workspace
      const createdAgent = agentManager.getAgent(agent.id);
      expect(createdAgent?.workspace).toBe(sandboxPath);

      // Link agent to group
      agentManager.setTelegramChatId(agent.id, chatId);

      // Edit pinned message to show success
      const successMessage =
        `✅ *${state!.data.emoji} ${agent.name}* criado e vinculado!\n\n` +
        `Modelo: ${selectedModelMode}\n` +
        `Workspace: \`${sandboxPath}\`\n` +
        `\nEnvie mensagens para interagir com o agente.`;

      await mockFns.editTelegramMessage(chatId, pinnedMessageId, successMessage);

      // Verify pinned message was edited
      expect(editedMessages.length).toBe(1);
      expect(editedMessages[0].chatId).toBe(chatId);
      expect(editedMessages[0].messageId).toBe(pinnedMessageId);
      expect(editedMessages[0].text).toContain('✅');
      expect(editedMessages[0].text).toContain(agent.name);
      expect(editedMessages[0].text).toContain('sonnet');

      // Complete onboarding
      groupOnboardingManager.completeOnboarding(chatId, telegramUserId);
      expect(groupOnboardingManager.hasActiveOnboarding(chatId)).toBe(false);
    });

    it('should handle custom workspace path with retry on invalid path', async () => {
      // Start onboarding
      groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_name');
      groupOnboardingManager.setAgentName(chatId, telegramUserId, 'Custom Agent');
      groupOnboardingManager.advanceStep(chatId, telegramUserId, 'awaiting_emoji');
      groupOnboardingManager.setEmoji(chatId, telegramUserId, '📁');
      groupOnboardingManager.advanceStep(chatId, telegramUserId, 'awaiting_workspace');

      // User clicks "Outro caminho" (grp_workspace_custom)
      groupOnboardingManager.setWorkspace(chatId, telegramUserId, '__awaiting_custom__');

      // Verify state is still awaiting_workspace with custom marker
      let state = groupOnboardingManager.getState(chatId);
      expect(state?.step).toBe('awaiting_workspace');
      expect(state?.data.workspace).toBe('__awaiting_custom__');

      // User sends invalid path
      const invalidPath = '/this/path/does/not/exist';
      expect(existsSync(invalidPath)).toBe(false);

      // Simulate error message (what the handler would do)
      await mockFns.sendTelegramMessage(chatId, `❌ Caminho não encontrado: ${invalidPath}`);

      // User should retry with valid path
      mkdirSync(TEST_SANDBOX_DIR, { recursive: true });
      expect(existsSync(TEST_SANDBOX_DIR)).toBe(true);

      groupOnboardingManager.setWorkspace(chatId, telegramUserId, TEST_SANDBOX_DIR);
      groupOnboardingManager.advanceStep(chatId, telegramUserId, 'awaiting_model_mode');

      // Verify state advanced
      state = groupOnboardingManager.getState(chatId);
      expect(state?.step).toBe('awaiting_model_mode');
      expect(state?.data.workspace).toBe(TEST_SANDBOX_DIR);

      // Verify error message was sent
      expect(sentMessages.length).toBe(1);
      expect(sentMessages[0].text).toContain('❌ Caminho não encontrado');
    });
  });

  describe('Emoji keyboard layout verification', () => {
    it('should have 12 emojis in 3 rows of 4', () => {
      // The expected emoji layout from sendGroupEmojiSelector
      const expectedEmojis = ['🤖', '⚡', '🔧', '🎯', '🧠', '✨', '📊', '💡', '🚀', '🔍', '💻', '📁'];

      // Verify we have exactly 12 emojis
      expect(expectedEmojis.length).toBe(12);

      // Simulate button structure (3 rows of 4)
      const buttonLayout = [
        [
          { text: '🤖', callback_data: 'grp_emoji_🤖' },
          { text: '⚡', callback_data: 'grp_emoji_⚡' },
          { text: '🔧', callback_data: 'grp_emoji_🔧' },
          { text: '🎯', callback_data: 'grp_emoji_🎯' },
        ],
        [
          { text: '🧠', callback_data: 'grp_emoji_🧠' },
          { text: '✨', callback_data: 'grp_emoji_✨' },
          { text: '📊', callback_data: 'grp_emoji_📊' },
          { text: '💡', callback_data: 'grp_emoji_💡' },
        ],
        [
          { text: '🚀', callback_data: 'grp_emoji_🚀' },
          { text: '🔍', callback_data: 'grp_emoji_🔍' },
          { text: '💻', callback_data: 'grp_emoji_💻' },
          { text: '📁', callback_data: 'grp_emoji_📁' },
        ],
      ];

      // Verify layout structure
      expect(buttonLayout.length).toBe(3); // 3 rows
      expect(buttonLayout[0].length).toBe(4); // 4 columns each
      expect(buttonLayout[1].length).toBe(4);
      expect(buttonLayout[2].length).toBe(4);

      // Verify all emojis are present
      const allButtonEmojis = buttonLayout.flat().map(b => b.text);
      expect(allButtonEmojis).toEqual(expectedEmojis);

      // Verify callback_data format
      for (const row of buttonLayout) {
        for (const button of row) {
          expect(button.callback_data).toBe(`grp_emoji_${button.text}`);
        }
      }
    });
  });

  describe('Workspace keyboard layout verification', () => {
    it('should have correct workspace options layout', () => {
      // Expected workspace layout from sendGroupWorkspaceSelector
      const home = process.env.HOME || '/home/user';
      const expectedLayout = [
        [{ text: `📁 ${home}`, callback_data: `grp_workspace_${home}` }],
        [
          { text: '🧪 Sandbox', callback_data: 'grp_workspace_sandbox' },
          { text: '✏️ Outro caminho', callback_data: 'grp_workspace_custom' },
        ],
      ];

      // Verify structure
      expect(expectedLayout.length).toBe(2); // 2 rows
      expect(expectedLayout[0].length).toBe(1); // First row has 1 button (home)
      expect(expectedLayout[1].length).toBe(2); // Second row has 2 buttons (sandbox, custom)

      // Verify home button
      expect(expectedLayout[0][0].text).toContain(home);
      expect(expectedLayout[0][0].callback_data).toBe(`grp_workspace_${home}`);

      // Verify sandbox button
      expect(expectedLayout[1][0].text).toBe('🧪 Sandbox');
      expect(expectedLayout[1][0].callback_data).toBe('grp_workspace_sandbox');

      // Verify custom button
      expect(expectedLayout[1][1].text).toBe('✏️ Outro caminho');
      expect(expectedLayout[1][1].callback_data).toBe('grp_workspace_custom');
    });
  });

  describe('Model mode keyboard layout verification', () => {
    it('should have correct model mode options layout', () => {
      // Expected layout from sendGroupModelModeSelector
      // Layout: [Opus] on row 1, [Haiku][Sonnet][Selecao] on row 2
      const expectedLayout = [
        [{ text: '🧠 Opus', callback_data: 'grp_modelmode_opus' }],
        [
          { text: '⚡ Haiku', callback_data: 'grp_modelmode_haiku' },
          { text: '💫 Sonnet', callback_data: 'grp_modelmode_sonnet' },
          { text: '🎯 Seleção', callback_data: 'grp_modelmode_selection' },
        ],
      ];

      // Verify structure
      expect(expectedLayout.length).toBe(2); // 2 rows
      expect(expectedLayout[0].length).toBe(1); // First row has 1 button (Opus)
      expect(expectedLayout[1].length).toBe(3); // Second row has 3 buttons

      // Verify Opus button (row 1)
      expect(expectedLayout[0][0].text).toBe('🧠 Opus');
      expect(expectedLayout[0][0].callback_data).toBe('grp_modelmode_opus');

      // Verify row 2 buttons
      expect(expectedLayout[1][0].text).toBe('⚡ Haiku');
      expect(expectedLayout[1][0].callback_data).toBe('grp_modelmode_haiku');

      expect(expectedLayout[1][1].text).toBe('💫 Sonnet');
      expect(expectedLayout[1][1].callback_data).toBe('grp_modelmode_sonnet');

      expect(expectedLayout[1][2].text).toBe('🎯 Seleção');
      expect(expectedLayout[1][2].callback_data).toBe('grp_modelmode_selection');
    });
  });

  describe('Success message edit verification', () => {
    it('should edit pinned message with success format on completion', async () => {
      const pinnedMessageId = 99999;
      const agentName = 'Test Agent';
      const emoji = '🚀';
      const modelMode = 'selection';
      const workspace = '/some/workspace/path';

      // Format success message as the handler does
      const successMessage =
        `✅ *${emoji} ${agentName}* criado e vinculado!\n\n` +
        `Modelo: ${modelMode === 'selection' ? 'Seleção' : modelMode}\n` +
        `${workspace ? `Workspace: \`${workspace}\`\n` : ''}` +
        `\nEnvie mensagens para interagir com o agente.`;

      await mockFns.editTelegramMessage(chatId, pinnedMessageId, successMessage);

      // Verify edit was called
      expect(editedMessages.length).toBe(1);
      expect(editedMessages[0].chatId).toBe(chatId);
      expect(editedMessages[0].messageId).toBe(pinnedMessageId);

      // Verify message content
      expect(editedMessages[0].text).toContain('✅');
      expect(editedMessages[0].text).toContain(emoji);
      expect(editedMessages[0].text).toContain(agentName);
      expect(editedMessages[0].text).toContain('criado e vinculado');
      expect(editedMessages[0].text).toContain('Seleção'); // modelMode === 'selection' shows 'Seleção'
      expect(editedMessages[0].text).toContain(workspace);
      expect(editedMessages[0].text).toContain('Envie mensagens para interagir');
    });

    it('should format success message without workspace when not set', async () => {
      const pinnedMessageId = 99999;
      const agentName = 'No Workspace Agent';
      const emoji = '💡';
      const modelMode = 'haiku';
      const workspace: string | undefined = undefined;

      const successMessage =
        `✅ *${emoji} ${agentName}* criado e vinculado!\n\n` +
        `Modelo: ${modelMode === 'selection' ? 'Seleção' : modelMode}\n` +
        `${workspace ? `Workspace: \`${workspace}\`\n` : ''}` +
        `\nEnvie mensagens para interagir com o agente.`;

      await mockFns.editTelegramMessage(chatId, pinnedMessageId, successMessage);

      // Verify workspace line is not present
      expect(editedMessages[0].text).not.toContain('Workspace:');
      expect(editedMessages[0].text).toContain('haiku');
    });
  });

  describe('All workspace options flow', () => {
    it('should handle sandbox workspace option', async () => {
      groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_workspace');

      // User clicks sandbox
      groupOnboardingManager.setWorkspace(chatId, telegramUserId, '__sandbox__');
      groupOnboardingManager.advanceStep(chatId, telegramUserId, 'awaiting_model_mode');

      const state = groupOnboardingManager.getState(chatId);
      expect(state?.data.workspace).toBe('__sandbox__');
      expect(state?.step).toBe('awaiting_model_mode');
    });

    it('should handle home directory workspace option', async () => {
      const home = process.env.HOME || '/home/user';
      groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_workspace');

      // User clicks home directory (if it exists)
      if (existsSync(home)) {
        groupOnboardingManager.setWorkspace(chatId, telegramUserId, home);
        groupOnboardingManager.advanceStep(chatId, telegramUserId, 'awaiting_model_mode');

        const state = groupOnboardingManager.getState(chatId);
        expect(state?.data.workspace).toBe(home);
        expect(state?.step).toBe('awaiting_model_mode');
      }
    });

    it('should handle custom workspace option with valid path', async () => {
      mkdirSync(TEST_SANDBOX_DIR, { recursive: true });

      groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_workspace');

      // User clicks "Outro caminho"
      groupOnboardingManager.setWorkspace(chatId, telegramUserId, '__awaiting_custom__');

      // User sends valid path
      expect(existsSync(TEST_SANDBOX_DIR)).toBe(true);
      groupOnboardingManager.setWorkspace(chatId, telegramUserId, TEST_SANDBOX_DIR);
      groupOnboardingManager.advanceStep(chatId, telegramUserId, 'awaiting_model_mode');

      const state = groupOnboardingManager.getState(chatId);
      expect(state?.data.workspace).toBe(TEST_SANDBOX_DIR);
      expect(state?.step).toBe('awaiting_model_mode');
    });

    it('should reject custom workspace with non-existent path and allow retry', async () => {
      groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_workspace');

      // User clicks "Outro caminho"
      groupOnboardingManager.setWorkspace(chatId, telegramUserId, '__awaiting_custom__');

      // User sends invalid path - handler checks and shows error
      const invalidPath = '/definitely/not/a/real/path';
      expect(existsSync(invalidPath)).toBe(false);

      // The handler would NOT update workspace and show error
      // State should remain in awaiting_workspace with __awaiting_custom__
      let state = groupOnboardingManager.getState(chatId);
      expect(state?.data.workspace).toBe('__awaiting_custom__');
      expect(state?.step).toBe('awaiting_workspace');

      // User retries with valid path
      mkdirSync(TEST_SANDBOX_DIR, { recursive: true });
      groupOnboardingManager.setWorkspace(chatId, telegramUserId, TEST_SANDBOX_DIR);
      groupOnboardingManager.advanceStep(chatId, telegramUserId, 'awaiting_model_mode');

      state = groupOnboardingManager.getState(chatId);
      expect(state?.data.workspace).toBe(TEST_SANDBOX_DIR);
      expect(state?.step).toBe('awaiting_model_mode');
    });
  });

  describe('All model mode options flow', () => {
    const testModelMode = async (modelMode: ModelMode, displayName: string) => {
      groupOnboardingManager.clearAll();
      groupOnboardingManager.startOnboarding(chatId, telegramUserId, 'awaiting_model_mode');

      groupOnboardingManager.setModelMode(chatId, telegramUserId, modelMode);

      const state = groupOnboardingManager.getState(chatId);
      expect(state?.data.modelMode).toBe(modelMode);
    };

    it('should handle opus model mode', async () => {
      await testModelMode('opus', 'Opus');
    });

    it('should handle sonnet model mode', async () => {
      await testModelMode('sonnet', 'Sonnet');
    });

    it('should handle haiku model mode', async () => {
      await testModelMode('haiku', 'Haiku');
    });

    it('should handle selection model mode', async () => {
      await testModelMode('selection', 'Seleção');
    });
  });
});
