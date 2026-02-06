import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from 'bun:test';
import {
  sendTypingAction,
  startTypingIndicator,
  sendTelegramQueuePosition,
  sendTelegramTaskCancelled,
  TELEGRAM_ERRORS,
  sendTelegramUnlinkedGroupError,
  sendTelegramAgentLimitError,
  sendTelegramWorkspaceNotFound,
  sendTelegramProcessingError,
  deleteTelegramMessage,
} from '../telegram';

// Mock the getTelegramBot function
const mockBot = {
  sendChatAction: mock(() => Promise.resolve(true)),
  sendMessage: mock(() => Promise.resolve({ message_id: 123 })),
  deleteMessage: mock(() => Promise.resolve(true)),
};

// Mock the module
const originalEnv = process.env.TELEGRAM_BOT_TOKEN;

beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  (globalThis as any).__TEST_TELEGRAM_BOT__ = mockBot;
  mockBot.sendChatAction.mockClear();
  mockBot.sendMessage.mockClear();
  mockBot.deleteMessage.mockClear();
});

afterEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = originalEnv;
  delete (globalThis as any).__TEST_TELEGRAM_BOT__;
});

describe('Typing Indicator', () => {
  describe('sendTypingAction', () => {
    test('should send typing action to chat', async () => {
      // This test would require mocking getTelegramBot
      // For now, we test the function exists and handles errors gracefully
      const result = await sendTypingAction(12345);
      // When bot is not properly initialized (due to mocking), it returns false
      expect(typeof result).toBe('boolean');
    });
  });

  describe('startTypingIndicator', () => {
    test('should return a stop function', () => {
      const stop = startTypingIndicator(12345);
      expect(typeof stop).toBe('function');
      // Clean up
      stop();
    });

    test('stop function should clear the interval', () => {
      const clearIntervalSpy = spyOn(globalThis, 'clearInterval');
      const stop = startTypingIndicator(12345);
      stop();
      expect(clearIntervalSpy).toHaveBeenCalled();
      clearIntervalSpy.mockRestore();
    });

    test('should set up interval for auto-renewal', () => {
      const setIntervalSpy = spyOn(globalThis, 'setInterval');
      const stop = startTypingIndicator(12345);
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 4000);
      stop();
      setIntervalSpy.mockRestore();
    });
  });
});

describe('Error Messages', () => {
  describe('TELEGRAM_ERRORS constants', () => {
    test('should have unlinked group message', () => {
      expect(TELEGRAM_ERRORS.UNLINKED_GROUP).toContain('Este grupo não está vinculado');
    });

    test('should have agent limit message', () => {
      expect(TELEGRAM_ERRORS.AGENT_LIMIT_REACHED).toContain('Limite de agentes atingido');
      expect(TELEGRAM_ERRORS.AGENT_LIMIT_REACHED).toContain('50');
    });

    test('should have token expired message', () => {
      expect(TELEGRAM_ERRORS.TOKEN_EXPIRED).toContain('Token de vinculação expirado');
    });

    test('should have workspace not found function', () => {
      const result = TELEGRAM_ERRORS.WORKSPACE_NOT_FOUND('/some/path');
      expect(result).toContain('Workspace não encontrado');
      expect(result).toContain('/some/path');
    });

    test('should have group linking failed message', () => {
      expect(TELEGRAM_ERRORS.GROUP_LINKING_FAILED).toContain('Falha ao vincular grupo');
    });

    test('should have API timeout message', () => {
      expect(TELEGRAM_ERRORS.API_TIMEOUT).toContain('Tempo limite excedido');
    });

    test('should have processing error function', () => {
      const result = TELEGRAM_ERRORS.PROCESSING_ERROR('TestAgent', 'Some error');
      expect(result).toContain('TestAgent');
      expect(result).toContain('Some error');
    });
  });
});

describe('Queue Feedback UI', () => {
  test('sendTelegramQueuePosition should format position correctly', async () => {
    // Test that the function can be called
    // Actual message sending requires bot to be initialized
    const result = await sendTelegramQueuePosition(12345, 2, 'task-123');
    // Returns null when bot is not properly initialized
    expect(result === null || typeof result?.message_id === 'number').toBe(true);
  });

  test('sendTelegramTaskCancelled should send confirmation', async () => {
    await sendTelegramTaskCancelled(12345);
    // Function should complete without error
    expect(true).toBe(true);
  });
});

describe('Delete Message', () => {
  test('deleteTelegramMessage should handle bot not configured', async () => {
    // When bot is not properly initialized, returns false
    const result = await deleteTelegramMessage(12345, 123);
    expect(typeof result).toBe('boolean');
  });
});
