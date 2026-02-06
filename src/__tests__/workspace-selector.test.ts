// src/__tests__/workspace-selector.test.ts
/**
 * Tests for workspace selector functionality
 *
 * Tests cover:
 * - UserContextManager directory navigation state
 * - Callback data format (< 64 bytes)
 * - Navigation state management
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { UserContextManager } from '../user-context-manager';

describe('Workspace Selector - Directory Navigation State', () => {
  let manager: UserContextManager;

  beforeEach(() => {
    manager = new UserContextManager();
  });

  describe('startDirectoryNavigation', () => {
    test('initializes navigation state', () => {
      manager.startDirectoryNavigation('user-1', 'agent-1', 'topic-1', '/Users/lucas', ['/recent1', '/recent2']);

      const state = manager.getDirectoryNavigationState('user-1');
      expect(state).toBeDefined();
      expect(state!.currentPath).toBe('/Users/lucas');
      expect(state!.targetAgentId).toBe('agent-1');
      expect(state!.targetTopicId).toBe('topic-1');
      expect(state!.baseOptions).toEqual(['/recent1', '/recent2']);
      expect(state!.visibleDirectories).toEqual([]);
      expect(state!.filter).toBeUndefined();
      expect(state!.awaitingInput).toBeUndefined();
    });

    test('preserves existing context when adding nav state', () => {
      manager.setActiveAgent('user-1', 'agent-99');
      manager.startDirectoryNavigation('user-1', 'agent-1', 'topic-1', '/path');

      expect(manager.getActiveAgent('user-1')).toBe('agent-99');
      expect(manager.getDirectoryNavigationState('user-1')).toBeDefined();
    });
  });

  describe('updateDirectoryPath', () => {
    test('updates current path and clears filter', () => {
      manager.startDirectoryNavigation('user-1', 'agent-1', 'topic-1', '/old');
      manager.setDirectoryFilter('user-1', 'test');
      manager.updateDirectoryPath('user-1', '/new');

      const state = manager.getDirectoryNavigationState('user-1');
      expect(state!.currentPath).toBe('/new');
      expect(state!.filter).toBeUndefined(); // Filter cleared on navigate
    });

    test('does nothing if no navigation state', () => {
      manager.updateDirectoryPath('user-1', '/new');
      expect(manager.getDirectoryNavigationState('user-1')).toBeUndefined();
    });
  });

  describe('updateVisibleDirectories', () => {
    test('stores directory snapshot for index mapping', () => {
      manager.startDirectoryNavigation('user-1', 'agent-1', 'topic-1', '/path');
      manager.updateVisibleDirectories('user-1', ['src', 'dist', 'docs']);

      const state = manager.getDirectoryNavigationState('user-1');
      expect(state!.visibleDirectories).toEqual(['src', 'dist', 'docs']);
    });
  });

  describe('setDirectoryFilter', () => {
    test('sets filter and clears awaitingInput', () => {
      manager.startDirectoryNavigation('user-1', 'agent-1', 'topic-1', '/path');
      manager.setAwaitingDirectoryInput('user-1', 'filter');
      manager.setDirectoryFilter('user-1', 'src');

      const state = manager.getDirectoryNavigationState('user-1');
      expect(state!.filter).toBe('src');
      expect(state!.awaitingInput).toBeUndefined();
    });
  });

  describe('clearDirectoryFilter', () => {
    test('removes active filter', () => {
      manager.startDirectoryNavigation('user-1', 'agent-1', 'topic-1', '/path');
      manager.setDirectoryFilter('user-1', 'test');
      manager.clearDirectoryFilter('user-1');

      const state = manager.getDirectoryNavigationState('user-1');
      expect(state!.filter).toBeUndefined();
    });
  });

  describe('setAwaitingDirectoryInput', () => {
    test('sets filter awaiting type', () => {
      manager.startDirectoryNavigation('user-1', 'agent-1', 'topic-1', '/path');
      manager.setAwaitingDirectoryInput('user-1', 'filter');

      const state = manager.getDirectoryNavigationState('user-1');
      expect(state!.awaitingInput).toBe('filter');
    });

    test('sets custom_base_path awaiting type', () => {
      manager.startDirectoryNavigation('user-1', 'agent-1', 'topic-1', '/path');
      manager.setAwaitingDirectoryInput('user-1', 'custom_base_path');

      const state = manager.getDirectoryNavigationState('user-1');
      expect(state!.awaitingInput).toBe('custom_base_path');
    });
  });

  describe('clearDirectoryNavigation', () => {
    test('removes navigation state', () => {
      manager.startDirectoryNavigation('user-1', 'agent-1', 'topic-1', '/path');
      manager.clearDirectoryNavigation('user-1');

      expect(manager.getDirectoryNavigationState('user-1')).toBeUndefined();
      expect(manager.hasDirectoryNavigation('user-1')).toBe(false);
    });
  });

  describe('hasDirectoryNavigation', () => {
    test('returns true when navigation active', () => {
      manager.startDirectoryNavigation('user-1', 'agent-1', 'topic-1', '/path');
      expect(manager.hasDirectoryNavigation('user-1')).toBe(true);
    });

    test('returns false when no navigation', () => {
      expect(manager.hasDirectoryNavigation('user-1')).toBe(false);
    });
  });
});

describe('Workspace Selector - Callback Data Format', () => {
  test('all wsnav: callbacks are under 64 bytes', () => {
    const callbacks = [
      'wsnav:agent',
      'wsnav:sandbox',
      'wsnav:rec:0',
      'wsnav:rec:1',
      'wsnav:rec:2',
      'wsnav:custom',
      'wsnav:up',
      'wsnav:into:0',
      'wsnav:into:1',
      'wsnav:into:11',
      'wsnav:select',
      'wsnav:filter',
      'wsnav:clearfilter',
      'wsnav:cancel',
    ];

    for (const cb of callbacks) {
      const bytes = Buffer.byteLength(cb, 'utf-8');
      expect(bytes).toBeLessThan(64);
    }
  });

  test('topic_workspace: callback with UUID is under 64 bytes', () => {
    const cb = 'topic_workspace:550e8400-e29b-41d4-a716-446655440000';
    expect(Buffer.byteLength(cb, 'utf-8')).toBeLessThan(64);
  });
});
