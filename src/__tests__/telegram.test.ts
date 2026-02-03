// src/__tests__/telegram.test.ts
import { describe, test, expect } from 'bun:test';
import { isTelegramConfigured, getTelegramBot } from '../telegram';

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
});
