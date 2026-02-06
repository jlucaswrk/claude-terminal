// src/__tests__/persistence-preferences.test.ts
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { PersistenceService } from '../persistence';
import { unlinkSync, existsSync } from 'fs';
import type { UserPreferences } from '../types';

const TEST_PREFS_FILE = './test-user-preferences.json';

describe('PersistenceService - User Preferences', () => {
  let service: PersistenceService;

  beforeEach(() => {
    service = new PersistenceService(undefined, undefined, TEST_PREFS_FILE);
  });

  afterEach(() => {
    if (existsSync(TEST_PREFS_FILE)) unlinkSync(TEST_PREFS_FILE);
    if (existsSync(TEST_PREFS_FILE + '.bak')) unlinkSync(TEST_PREFS_FILE + '.bak');
  });

  test('saves and loads user preferences', () => {
    const prefs: UserPreferences = {
      userId: 'user1',
      mode: 'dojo',
      telegramUsername: 'lucas',
      onboardingComplete: true,
    };

    service.saveUserPreferences(prefs);
    const loaded = service.loadUserPreferences('user1');

    expect(loaded).toEqual(prefs);
  });

  test('returns undefined for non-existent user', () => {
    const loaded = service.loadUserPreferences('nonexistent');
    expect(loaded).toBeUndefined();
  });

  test('updates existing preferences', () => {
    service.saveUserPreferences({
      userId: 'user1',
      mode: 'ronin',
      onboardingComplete: false,
    });

    service.saveUserPreferences({
      userId: 'user1',
      mode: 'dojo',
      telegramUsername: 'lucas',
      onboardingComplete: true,
    });

    const loaded = service.loadUserPreferences('user1');
    expect(loaded?.mode).toBe('dojo');
    expect(loaded?.telegramUsername).toBe('lucas');
  });

  test('handles multiple users', () => {
    service.saveUserPreferences({ userId: 'user1', mode: 'ronin', onboardingComplete: true });
    service.saveUserPreferences({ userId: 'user2', mode: 'dojo', telegramUsername: 'test', onboardingComplete: true });

    expect(service.loadUserPreferences('user1')?.mode).toBe('ronin');
    expect(service.loadUserPreferences('user2')?.mode).toBe('dojo');
  });
});
