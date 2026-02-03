/**
 * TelegramTokenManager - Manages tokens for linking WhatsApp users to Telegram
 *
 * Generates unique tokens during Dojo onboarding that users use to connect
 * their WhatsApp account to Telegram via deep link: t.me/ClaudeTerminalBot?start=<token>
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const DEFAULT_TOKENS_FILE = './telegram-tokens.json';
const TOKEN_EXPIRATION_DAYS = 7;

/**
 * Token data stored in the JSON file
 */
export interface TelegramToken {
  token: string;
  userId: string;           // WhatsApp user phone number
  username: string;         // Telegram username (without @)
  createdAt: string;        // ISO date string
  expiresAt: string;        // ISO date string
}

/**
 * Result of token validation
 */
export interface TokenValidationResult {
  userId: string;
  username: string;
}

/**
 * TelegramTokenManager handles token generation and validation for
 * linking WhatsApp accounts to Telegram during Dojo onboarding.
 */
export class TelegramTokenManager {
  private readonly tokensFile: string;
  private tokens: Map<string, TelegramToken> = new Map();

  constructor(tokensFile: string = DEFAULT_TOKENS_FILE) {
    this.tokensFile = tokensFile;
    this.loadTokensFromFile();
  }

  /**
   * Generate a unique token for a user
   * Token expires after 7 days
   *
   * @param userId - WhatsApp user phone number
   * @param username - Telegram username (without @)
   * @returns The generated token (UUID)
   */
  generateToken(userId: string, username: string): string {
    // Clean up any existing tokens for this user
    for (const [token, data] of this.tokens) {
      if (data.userId === userId) {
        this.tokens.delete(token);
      }
    }

    const token = crypto.randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + TOKEN_EXPIRATION_DAYS * 24 * 60 * 60 * 1000);

    const tokenData: TelegramToken = {
      token,
      userId,
      username: username.replace('@', ''), // Remove @ if present
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    this.tokens.set(token, tokenData);
    this.saveTokensToFile();

    return token;
  }

  /**
   * Validate a token and return user info if valid
   *
   * @param token - The token to validate
   * @returns User info if token is valid and not expired, null otherwise
   */
  validateToken(token: string): TokenValidationResult | null {
    const tokenData = this.tokens.get(token);

    if (!tokenData) {
      return null;
    }

    // Check if expired
    const now = new Date();
    const expiresAt = new Date(tokenData.expiresAt);

    if (now > expiresAt) {
      // Token expired - delete it
      this.deleteToken(token);
      return null;
    }

    return {
      userId: tokenData.userId,
      username: tokenData.username,
    };
  }

  /**
   * Delete a token
   *
   * @param token - The token to delete
   */
  deleteToken(token: string): void {
    this.tokens.delete(token);
    this.saveTokensToFile();
  }

  /**
   * Clean up all expired tokens
   *
   * @returns Number of tokens deleted
   */
  cleanupExpiredTokens(): number {
    const now = new Date();
    let deletedCount = 0;

    for (const [token, data] of this.tokens) {
      const expiresAt = new Date(data.expiresAt);
      if (now > expiresAt) {
        this.tokens.delete(token);
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      this.saveTokensToFile();
    }

    return deletedCount;
  }

  /**
   * Get token data by userId
   * Useful to check if user already has a pending token
   *
   * @param userId - WhatsApp user phone number
   * @returns Token data if found, null otherwise
   */
  getTokenByUserId(userId: string): TelegramToken | null {
    for (const tokenData of this.tokens.values()) {
      if (tokenData.userId === userId) {
        // Check if not expired
        const now = new Date();
        const expiresAt = new Date(tokenData.expiresAt);
        if (now <= expiresAt) {
          return tokenData;
        }
      }
    }
    return null;
  }

  /**
   * Load tokens from file
   */
  private loadTokensFromFile(): void {
    try {
      if (!existsSync(this.tokensFile)) {
        return;
      }

      const content = readFileSync(this.tokensFile, 'utf-8');
      const data = JSON.parse(content) as TelegramToken[];

      for (const token of data) {
        this.tokens.set(token.token, token);
      }

      // Clean up expired tokens on load
      this.cleanupExpiredTokens();
    } catch (error) {
      console.error('Failed to load telegram tokens:', error);
    }
  }

  /**
   * Save tokens to file
   */
  private saveTokensToFile(): void {
    try {
      // Ensure directory exists
      const dir = dirname(this.tokensFile);
      if (dir && dir !== '.' && !existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const data = Array.from(this.tokens.values());
      writeFileSync(this.tokensFile, JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Failed to save telegram tokens:', error);
    }
  }

  /**
   * Get the path to the tokens file (for testing)
   */
  getTokensFilePath(): string {
    return this.tokensFile;
  }

  /**
   * Get total number of tokens (for debugging)
   */
  getTokenCount(): number {
    return this.tokens.size;
  }
}
