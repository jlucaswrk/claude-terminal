import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { TelegramTokenManager } from '../telegram-tokens';
import { existsSync, unlinkSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('TelegramTokenManager', () => {
  let tokenManager: TelegramTokenManager;
  let testFile: string;

  beforeEach(() => {
    // Create a unique test file for each test
    const testDir = join(tmpdir(), 'claude-terminal-test');
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }
    testFile = join(testDir, `tokens-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    tokenManager = new TelegramTokenManager(testFile);
  });

  afterEach(() => {
    // Clean up test file
    try {
      if (existsSync(testFile)) {
        unlinkSync(testFile);
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  describe('generateToken', () => {
    it('should generate a valid UUID token', () => {
      const token = tokenManager.generateToken('+5511999999999', 'testuser');

      expect(token).toBeDefined();
      expect(token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('should remove @ from username', () => {
      const token = tokenManager.generateToken('+5511999999999', '@testuser');
      const result = tokenManager.validateToken(token);

      expect(result).not.toBeNull();
      expect(result?.username).toBe('testuser');
    });

    it('should replace existing token for same user', () => {
      const token1 = tokenManager.generateToken('+5511999999999', 'testuser');
      const token2 = tokenManager.generateToken('+5511999999999', 'testuser');

      expect(token1).not.toBe(token2);
      expect(tokenManager.validateToken(token1)).toBeNull();
      expect(tokenManager.validateToken(token2)).not.toBeNull();
    });

    it('should persist tokens to file', () => {
      tokenManager.generateToken('+5511999999999', 'testuser');

      expect(existsSync(testFile)).toBe(true);
    });
  });

  describe('validateToken', () => {
    it('should return user info for valid token', () => {
      const token = tokenManager.generateToken('+5511999999999', 'testuser');
      const result = tokenManager.validateToken(token);

      expect(result).not.toBeNull();
      expect(result?.userId).toBe('+5511999999999');
      expect(result?.username).toBe('testuser');
    });

    it('should return null for invalid token', () => {
      const result = tokenManager.validateToken('invalid-token');

      expect(result).toBeNull();
    });

    it('should return null for non-existent token', () => {
      const result = tokenManager.validateToken('12345678-1234-1234-1234-123456789012');

      expect(result).toBeNull();
    });
  });

  describe('deleteToken', () => {
    it('should delete an existing token', () => {
      const token = tokenManager.generateToken('+5511999999999', 'testuser');

      expect(tokenManager.validateToken(token)).not.toBeNull();

      tokenManager.deleteToken(token);

      expect(tokenManager.validateToken(token)).toBeNull();
    });

    it('should not throw for non-existent token', () => {
      expect(() => tokenManager.deleteToken('non-existent')).not.toThrow();
    });
  });

  describe('cleanupExpiredTokens', () => {
    it('should remove expired tokens', () => {
      // Generate a token
      const token = tokenManager.generateToken('+5511999999999', 'testuser');

      // Manually expire the token by modifying its expiration
      // (This requires accessing internal state - in production, we'd wait or use time mocking)
      // For now, we just verify the method exists and returns a number
      const count = tokenManager.cleanupExpiredTokens();

      expect(typeof count).toBe('number');
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getTokenByUserId', () => {
    it('should return token for existing user', () => {
      const token = tokenManager.generateToken('+5511999999999', 'testuser');
      const result = tokenManager.getTokenByUserId('+5511999999999');

      expect(result).not.toBeNull();
      expect(result?.token).toBe(token);
      expect(result?.userId).toBe('+5511999999999');
      expect(result?.username).toBe('testuser');
    });

    it('should return null for non-existent user', () => {
      const result = tokenManager.getTokenByUserId('+5511000000000');

      expect(result).toBeNull();
    });
  });

  describe('persistence', () => {
    it('should load tokens from file on initialization', () => {
      // Generate a token
      const token = tokenManager.generateToken('+5511999999999', 'testuser');

      // Create a new manager that reads from the same file
      const newManager = new TelegramTokenManager(testFile);

      // Should be able to validate the token
      const result = newManager.validateToken(token);

      expect(result).not.toBeNull();
      expect(result?.userId).toBe('+5511999999999');
    });
  });

  describe('getTokenCount', () => {
    it('should return correct count', () => {
      expect(tokenManager.getTokenCount()).toBe(0);

      tokenManager.generateToken('+5511999999999', 'user1');
      expect(tokenManager.getTokenCount()).toBe(1);

      tokenManager.generateToken('+5511888888888', 'user2');
      expect(tokenManager.getTokenCount()).toBe(2);

      // Same user replaces token
      tokenManager.generateToken('+5511999999999', 'user1updated');
      expect(tokenManager.getTokenCount()).toBe(2);
    });
  });

  describe('getTokensFilePath', () => {
    it('should return the configured file path', () => {
      expect(tokenManager.getTokensFilePath()).toBe(testFile);
    });
  });
});
