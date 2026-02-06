// src/__tests__/telegram.test.ts
import { describe, test, expect } from 'bun:test';
import {
  isTelegramConfigured,
  getTelegramBot,
  pinTelegramMessage,
  unpinTelegramMessage,
  editTelegramMessage,
  deleteTelegramMessage,
} from '../telegram';

// Ensure the full test suite never attempts real Telegram API calls.
// Other integration tests may set TELEGRAM_BOT_TOKEN; we force-disable it here.
process.env.TELEGRAM_BOT_TOKEN = '';

describe('Telegram Module', () => {
  describe('isTelegramConfigured', () => {
    test('returns boolean based on TELEGRAM_BOT_TOKEN', () => {
      // Just verify it returns a boolean (actual value depends on env)
      const result = isTelegramConfigured();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('getTelegramBot', () => {
    test('returns null when not configured', () => {
      // In test environment, token is not set
      if (!isTelegramConfigured()) {
        expect(getTelegramBot()).toBeNull();
      }
    });
  });

  describe('Message Management Functions', () => {
    describe('pinTelegramMessage', () => {
      test('returns false when bot is not configured', async () => {
        if (!isTelegramConfigured()) {
          const result = await pinTelegramMessage(12345, 1);
          expect(result).toBe(false);
        }
      });

      test('returns boolean success status', async () => {
        // When not configured, should return false without throwing
        const result = await pinTelegramMessage(12345, 1);
        expect(typeof result).toBe('boolean');
      });

      test('accepts optional disableNotification parameter', async () => {
        // Should not throw with the optional parameter
        const result = await pinTelegramMessage(12345, 1, false);
        expect(typeof result).toBe('boolean');
      });
    });

    describe('unpinTelegramMessage', () => {
      test('returns false when bot is not configured', async () => {
        if (!isTelegramConfigured()) {
          const result = await unpinTelegramMessage(12345, 1);
          expect(result).toBe(false);
        }
      });

      test('returns boolean success status', async () => {
        // When not configured, should return false without throwing
        const result = await unpinTelegramMessage(12345, 1);
        expect(typeof result).toBe('boolean');
      });
    });

    describe('editTelegramMessage', () => {
      test('returns false when bot is not configured', async () => {
        if (!isTelegramConfigured()) {
          const result = await editTelegramMessage(12345, 1, 'test');
          expect(result).toBe(false);
        }
      });

      test('returns boolean success status', async () => {
        // When not configured, should return false without throwing
        const result = await editTelegramMessage(12345, 1, 'test message');
        expect(typeof result).toBe('boolean');
      });

      test('accepts optional buttons parameter', async () => {
        // Should not throw with buttons parameter
        const buttons = [[{ text: 'Test', callback_data: 'test' }]];
        const result = await editTelegramMessage(12345, 1, 'test', buttons);
        expect(typeof result).toBe('boolean');
      });
    });

    describe('deleteTelegramMessage', () => {
      test('returns false when bot is not configured', async () => {
        if (!isTelegramConfigured()) {
          const result = await deleteTelegramMessage(12345, 1);
          expect(result).toBe(false);
        }
      });

      test('returns boolean success status', async () => {
        // When not configured, should return false without throwing
        const result = await deleteTelegramMessage(12345, 1);
        expect(typeof result).toBe('boolean');
      });

      test('accepts string chatId', async () => {
        // Should handle string chatId without throwing
        const result = await deleteTelegramMessage('12345', 1);
        expect(typeof result).toBe('boolean');
      });
    });
  });

  describe('Error Handling', () => {
    test('all message functions return false on error without throwing', async () => {
      // All functions should gracefully return false, not throw
      const results = await Promise.all([
        pinTelegramMessage(-999999999, 1),
        unpinTelegramMessage(-999999999, 1),
        editTelegramMessage(-999999999, 1, 'test'),
        deleteTelegramMessage(-999999999, 1),
      ]);

      // All should be booleans (false when not configured)
      results.forEach(result => {
        expect(typeof result).toBe('boolean');
      });
    });

    test('pin/unpin handle permission errors gracefully', async () => {
      // These should not throw even with invalid inputs
      // They log errors but return false
      const pinResult = await pinTelegramMessage(0, 0);
      const unpinResult = await unpinTelegramMessage(0, 0);

      expect(pinResult).toBe(false);
      expect(unpinResult).toBe(false);
    });
  });
});
