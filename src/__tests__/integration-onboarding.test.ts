// src/__tests__/integration-onboarding.test.ts
import { describe, test, expect, beforeEach } from 'bun:test';
import { UserContextManager } from '../user-context-manager';
import type { UserPreferences } from '../types';

// Mock persistence to use in-memory
class MockPersistenceService {
  private prefs = new Map<string, UserPreferences>();

  saveUserPreferences(prefs: UserPreferences): void {
    this.prefs.set(prefs.userId, prefs);
  }

  loadUserPreferences(userId: string): UserPreferences | undefined {
    return this.prefs.get(userId);
  }

  getAllUserPreferences(): UserPreferences[] {
    return Array.from(this.prefs.values());
  }
}

describe('Integration: Onboarding Flow', () => {
  let userContext: UserContextManager;
  let persistence: MockPersistenceService;

  beforeEach(() => {
    userContext = new UserContextManager();
    persistence = new MockPersistenceService();
  });

  describe('Ronin mode selection', () => {
    test('completes onboarding for ronin mode', () => {
      const userId = 'user1';

      // Start onboarding
      userContext.startOnboardingFlow(userId);
      expect(userContext.isAwaitingModeSelection(userId)).toBe(true);

      // Select ronin
      userContext.setUserMode(userId, 'ronin');

      // Flow should be complete
      expect(userContext.isInFlow(userId)).toBe(false);

      // Save preferences
      persistence.saveUserPreferences({
        userId,
        mode: 'ronin',
        onboardingComplete: true,
      });

      const prefs = persistence.loadUserPreferences(userId);
      expect(prefs?.mode).toBe('ronin');
      expect(prefs?.onboardingComplete).toBe(true);
    });
  });

  describe('Dojo mode selection', () => {
    test('requires telegram username for dojo mode', () => {
      const userId = 'user1';

      // Start onboarding
      userContext.startOnboardingFlow(userId);

      // Select dojo
      userContext.setUserMode(userId, 'dojo');

      // Should now await telegram username
      expect(userContext.isAwaitingTelegramUsername(userId)).toBe(true);
      expect(userContext.isInFlow(userId)).toBe(true);
    });

    test('completes onboarding after telegram username', () => {
      const userId = 'user1';

      // Start onboarding
      userContext.startOnboardingFlow(userId);
      userContext.setUserMode(userId, 'dojo');
      userContext.setTelegramUsername(userId, 'lucas');

      const flowData = userContext.getFlowData(userId);
      expect(flowData?.telegramUsername).toBe('lucas');
      expect(flowData?.userMode).toBe('dojo');

      // Save preferences
      persistence.saveUserPreferences({
        userId,
        mode: 'dojo',
        telegramUsername: 'lucas',
        onboardingComplete: true,
      });

      const prefs = persistence.loadUserPreferences(userId);
      expect(prefs?.mode).toBe('dojo');
      expect(prefs?.telegramUsername).toBe('lucas');
    });
  });

  describe('Mode switching', () => {
    test('can switch from ronin to dojo', () => {
      const userId = 'user1';

      // Initial ronin
      persistence.saveUserPreferences({
        userId,
        mode: 'ronin',
        onboardingComplete: true,
      });

      // Switch to dojo
      persistence.saveUserPreferences({
        userId,
        mode: 'dojo',
        telegramUsername: 'lucas',
        onboardingComplete: true,
      });

      const prefs = persistence.loadUserPreferences(userId);
      expect(prefs?.mode).toBe('dojo');
    });
  });

  describe('needsOnboarding helper', () => {
    test('returns true when no preferences exist', () => {
      const prefs = persistence.loadUserPreferences('new_user');
      const needsOnboarding = !prefs?.onboardingComplete;
      expect(needsOnboarding).toBe(true);
    });

    test('returns false when onboarding is complete', () => {
      persistence.saveUserPreferences({
        userId: 'user1',
        mode: 'ronin',
        onboardingComplete: true,
      });

      const prefs = persistence.loadUserPreferences('user1');
      const needsOnboarding = !prefs?.onboardingComplete;
      expect(needsOnboarding).toBe(false);
    });
  });
});
