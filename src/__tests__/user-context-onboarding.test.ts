// src/__tests__/user-context-onboarding.test.ts
import { describe, test, expect, beforeEach } from 'bun:test';
import { UserContextManager } from '../user-context-manager';

describe('UserContextManager - Onboarding Flow', () => {
  let manager: UserContextManager;

  beforeEach(() => {
    manager = new UserContextManager();
  });

  describe('startOnboardingFlow', () => {
    test('sets flow to onboarding and state to awaiting_mode_selection', () => {
      manager.startOnboardingFlow('user1');

      expect(manager.getCurrentFlow('user1')).toBe('onboarding');
      expect(manager.getCurrentFlowState('user1')).toBe('awaiting_mode_selection');
    });
  });

  describe('setUserMode', () => {
    test('stores selected mode in flow data', () => {
      manager.startOnboardingFlow('user1');
      manager.setUserMode('user1', 'dojo');

      const data = manager.getFlowData('user1');
      expect(data?.userMode).toBe('dojo');
    });

    test('advances to awaiting_telegram_username for dojo mode', () => {
      manager.startOnboardingFlow('user1');
      manager.setUserMode('user1', 'dojo');

      expect(manager.getCurrentFlowState('user1')).toBe('awaiting_telegram_username');
    });

    test('completes flow for ronin mode', () => {
      manager.startOnboardingFlow('user1');
      manager.setUserMode('user1', 'ronin');

      expect(manager.getCurrentFlow('user1')).toBeUndefined();
    });
  });

  describe('setTelegramUsername', () => {
    test('stores telegram username and completes flow', () => {
      manager.startOnboardingFlow('user1');
      manager.setUserMode('user1', 'dojo');
      manager.setTelegramUsername('user1', 'lucas');

      const data = manager.getFlowData('user1');
      expect(data?.telegramUsername).toBe('lucas');
    });
  });

  describe('isAwaitingModeSelection', () => {
    test('returns true when awaiting mode selection', () => {
      manager.startOnboardingFlow('user1');
      expect(manager.isAwaitingModeSelection('user1')).toBe(true);
    });

    test('returns false otherwise', () => {
      expect(manager.isAwaitingModeSelection('user1')).toBe(false);
    });
  });

  describe('isAwaitingTelegramUsername', () => {
    test('returns true when awaiting telegram username', () => {
      manager.startOnboardingFlow('user1');
      manager.setUserMode('user1', 'dojo');
      expect(manager.isAwaitingTelegramUsername('user1')).toBe(true);
    });
  });
});
