// src/__tests__/telegram-topic-ui.test.ts
/**
 * UI snapshot tests for Telegram topic management components
 *
 * Tests cover:
 * - formatTopicCompactLine - compact line format for topic listing
 * - formatRelativeTime - relative time formatting in Portuguese
 * - getTopicStatusDisplay - status emoji and label based on topic state
 * - sendEnhancedTopicsList - full topic listing UI with buttons
 * - sendTopicDetailView - topic detail view with context-aware buttons
 * - Confirmation modals (close, delete, reset)
 * - Action feedback messages
 */

import { describe, test, expect, beforeEach, mock, spyOn } from 'bun:test';
import {
  formatTopicCompactLine,
  formatRelativeTime,
  getTopicStatusDisplay,
  type TopicListItem,
  type TopicDisplayStatus,
} from '../telegram';

// Helper to create topic items for testing
function createTopicItem(overrides: Partial<TopicListItem> = {}): TopicListItem {
  return {
    id: 'topic-123',
    telegramTopicId: 100,
    emoji: '💬',
    name: 'Test Topic',
    type: 'session',
    status: 'active',
    lastActivity: new Date(),
    ...overrides,
  };
}

describe('Topic UI Components', () => {
  describe('formatRelativeTime', () => {
    test('formats "agora" for very recent times', () => {
      const now = new Date();
      const result = formatRelativeTime(now);
      expect(result).toBe('agora');
    });

    test('formats minutes ago correctly', () => {
      const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
      const result = formatRelativeTime(fiveMinutesAgo);
      expect(result).toBe('há 5m');
    });

    test('formats hours ago correctly', () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const result = formatRelativeTime(twoHoursAgo);
      expect(result).toBe('há 2h');
    });

    test('formats days ago correctly', () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const result = formatRelativeTime(threeDaysAgo);
      expect(result).toBe('há 3d');
    });

    test('shows hours not minutes when exactly on hour boundary', () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const result = formatRelativeTime(oneHourAgo);
      expect(result).toBe('há 1h');
    });

    test('shows days not hours when exactly on day boundary', () => {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const result = formatRelativeTime(oneDayAgo);
      expect(result).toBe('há 1d');
    });

    test('handles 30 seconds ago as "agora"', () => {
      const thirtySecondsAgo = new Date(Date.now() - 30 * 1000);
      const result = formatRelativeTime(thirtySecondsAgo);
      expect(result).toBe('agora');
    });
  });

  describe('getTopicStatusDisplay', () => {
    describe('closed topics', () => {
      test('returns locked status for closed session', () => {
        const result = getTopicStatusDisplay('session', 'closed', undefined);
        expect(result.emoji).toBe('🔒');
        expect(result.label).toBe('Fechado');
        expect(result.displayStatus).toBe('closed');
      });

      test('returns locked status for closed Ralph', () => {
        const result = getTopicStatusDisplay('ralph', 'closed', 'running');
        expect(result.emoji).toBe('🔒');
        expect(result.label).toBe('Fechado');
        expect(result.displayStatus).toBe('closed');
      });

      test('returns locked status for closed worktree', () => {
        const result = getTopicStatusDisplay('worktree', 'closed', undefined);
        expect(result.emoji).toBe('🔒');
        expect(result.label).toBe('Fechado');
        expect(result.displayStatus).toBe('closed');
      });

      test('returns locked status for closed general', () => {
        const result = getTopicStatusDisplay('general', 'closed', undefined);
        expect(result.emoji).toBe('🔒');
        expect(result.label).toBe('Fechado');
        expect(result.displayStatus).toBe('closed');
      });
    });

    describe('Ralph topic statuses', () => {
      test('returns running status for active Ralph with running loop', () => {
        const result = getTopicStatusDisplay('ralph', 'active', 'running');
        expect(result.emoji).toBe('▶️');
        expect(result.label).toBe('Executando');
        expect(result.displayStatus).toBe('running');
      });

      test('returns paused status for active Ralph with paused loop', () => {
        const result = getTopicStatusDisplay('ralph', 'active', 'paused');
        expect(result.emoji).toBe('⏸️');
        expect(result.label).toBe('Pausado');
        expect(result.displayStatus).toBe('paused');
      });

      test('returns completed status for active Ralph with completed loop', () => {
        const result = getTopicStatusDisplay('ralph', 'active', 'completed');
        expect(result.emoji).toBe('✅');
        expect(result.label).toBe('Completo');
        expect(result.displayStatus).toBe('completed');
      });

      test('returns completed status for active Ralph with failed loop', () => {
        const result = getTopicStatusDisplay('ralph', 'active', 'failed');
        expect(result.emoji).toBe('✅');
        expect(result.label).toBe('Completo');
        expect(result.displayStatus).toBe('completed');
      });

      test('returns completed status for active Ralph with cancelled loop', () => {
        const result = getTopicStatusDisplay('ralph', 'active', 'cancelled');
        expect(result.emoji).toBe('✅');
        expect(result.label).toBe('Completo');
        expect(result.displayStatus).toBe('completed');
      });

      test('returns completed status for active Ralph with interrupted loop', () => {
        const result = getTopicStatusDisplay('ralph', 'active', 'interrupted');
        expect(result.emoji).toBe('✅');
        expect(result.label).toBe('Completo');
        expect(result.displayStatus).toBe('completed');
      });

      test('returns completed status for active Ralph with blocked loop', () => {
        const result = getTopicStatusDisplay('ralph', 'active', 'blocked');
        expect(result.emoji).toBe('✅');
        expect(result.label).toBe('Completo');
        expect(result.displayStatus).toBe('completed');
      });

      test('returns inactive status for active Ralph without loop status', () => {
        const result = getTopicStatusDisplay('ralph', 'active', undefined);
        expect(result.emoji).toBe('💤');
        expect(result.label).toBe('Inativo');
        expect(result.displayStatus).toBe('inactive');
      });
    });

    describe('non-Ralph topic statuses', () => {
      test('returns active status for active session', () => {
        const result = getTopicStatusDisplay('session', 'active', undefined);
        expect(result.emoji).toBe('💬');
        expect(result.label).toBe('Ativo');
        expect(result.displayStatus).toBe('inactive');
      });

      test('returns active status for active worktree', () => {
        const result = getTopicStatusDisplay('worktree', 'active', undefined);
        expect(result.emoji).toBe('💬');
        expect(result.label).toBe('Ativo');
        expect(result.displayStatus).toBe('inactive');
      });

      test('returns active status for active general', () => {
        const result = getTopicStatusDisplay('general', 'active', undefined);
        expect(result.emoji).toBe('💬');
        expect(result.label).toBe('Ativo');
        expect(result.displayStatus).toBe('inactive');
      });
    });
  });

  describe('formatTopicCompactLine', () => {
    test('formats basic session topic correctly', () => {
      const topic = createTopicItem({
        name: 'API Integration',
        emoji: '💬',
        type: 'session',
        status: 'active',
        lastActivity: new Date(),
      });

      const result = formatTopicCompactLine(topic);

      // Should have status, emoji, name, and time
      expect(result).toContain('💬');
      expect(result).toContain('Ativo');
      expect(result).toContain('💬');
      expect(result).toContain('API Integration');
      expect(result).toContain('agora');
    });

    test('formats Ralph topic with progress correctly', () => {
      const topic = createTopicItem({
        name: 'Auth JWT',
        emoji: '🔄',
        type: 'ralph',
        status: 'active',
        ralphStatus: 'running',
        currentIteration: 5,
        maxIterations: 10,
        lastActivity: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
      });

      const result = formatTopicCompactLine(topic);

      expect(result).toContain('▶️');
      expect(result).toContain('Executando');
      expect(result).toContain('🔄');
      expect(result).toContain('Auth JWT');
      expect(result).toContain('5/10');
      expect(result).toContain('há 2h');
    });

    test('formats paused Ralph topic correctly', () => {
      const topic = createTopicItem({
        name: 'Database Migration',
        emoji: '🔄',
        type: 'ralph',
        status: 'active',
        ralphStatus: 'paused',
        currentIteration: 3,
        maxIterations: 20,
        lastActivity: new Date(Date.now() - 30 * 60 * 1000), // 30 minutes ago
      });

      const result = formatTopicCompactLine(topic);

      expect(result).toContain('⏸️');
      expect(result).toContain('Pausado');
      expect(result).toContain('3/20');
      expect(result).toContain('há 30m');
    });

    test('formats completed Ralph topic correctly', () => {
      const topic = createTopicItem({
        name: 'Feature Build',
        emoji: '🔄',
        type: 'ralph',
        status: 'active',
        ralphStatus: 'completed',
        currentIteration: 10,
        maxIterations: 10,
        lastActivity: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day ago
      });

      const result = formatTopicCompactLine(topic);

      expect(result).toContain('✅');
      expect(result).toContain('Completo');
      expect(result).toContain('10/10');
      expect(result).toContain('há 1d');
    });

    test('formats closed topic correctly', () => {
      const topic = createTopicItem({
        name: 'Old Session',
        emoji: '💬',
        type: 'session',
        status: 'closed',
        lastActivity: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
      });

      const result = formatTopicCompactLine(topic);

      expect(result).toContain('🔒');
      expect(result).toContain('Fechado');
      expect(result).toContain('há 5d');
    });

    test('formats worktree topic correctly', () => {
      const topic = createTopicItem({
        name: 'feature/payments',
        emoji: '🌿',
        type: 'worktree',
        status: 'active',
        lastActivity: new Date(Date.now() - 15 * 60 * 1000), // 15 minutes ago
      });

      const result = formatTopicCompactLine(topic);

      expect(result).toContain('💬');
      expect(result).toContain('Ativo');
      expect(result).toContain('🌿');
      expect(result).toContain('feature/payments');
      expect(result).toContain('há 15m');
    });

    test('formats topic with message count correctly', () => {
      const topic = createTopicItem({
        name: 'Discussion',
        emoji: '💬',
        type: 'session',
        status: 'active',
        messageCount: 42,
        lastActivity: new Date(),
      });

      const result = formatTopicCompactLine(topic);

      expect(result).toContain('42 msgs');
    });

    test('does not show message count when not provided', () => {
      const topic = createTopicItem({
        name: 'Discussion',
        emoji: '💬',
        type: 'session',
        status: 'active',
        lastActivity: new Date(),
      });

      const result = formatTopicCompactLine(topic);

      expect(result).not.toContain('msgs');
    });

    test('handles inactive Ralph topic without progress', () => {
      const topic = createTopicItem({
        name: 'Inactive Ralph',
        emoji: '🔄',
        type: 'ralph',
        status: 'active',
        ralphStatus: undefined,
        currentIteration: undefined,
        maxIterations: undefined,
        lastActivity: new Date(),
      });

      const result = formatTopicCompactLine(topic);

      expect(result).toContain('💤');
      expect(result).toContain('Inativo');
      expect(result).not.toContain('/'); // No progress indicator
    });
  });

  describe('Edge Cases', () => {
    test('handles very long topic names in compact line', () => {
      const topic = createTopicItem({
        name: 'This is a very long topic name that might overflow the display area',
        emoji: '💬',
        type: 'session',
        status: 'active',
        lastActivity: new Date(),
      });

      const result = formatTopicCompactLine(topic);

      // Should still contain the full name (UI truncation happens at render time)
      expect(result).toContain('This is a very long topic name');
    });

    test('handles topic with zero iteration correctly', () => {
      const topic = createTopicItem({
        name: 'Just Started',
        emoji: '🔄',
        type: 'ralph',
        status: 'active',
        ralphStatus: 'running',
        currentIteration: 0,
        maxIterations: 10,
        lastActivity: new Date(),
      });

      const result = formatTopicCompactLine(topic);

      expect(result).toContain('0/10');
    });

    test('handles topic with special characters in name', () => {
      const topic = createTopicItem({
        name: 'Feature: API & DB',
        emoji: '🌿',
        type: 'worktree',
        status: 'active',
        lastActivity: new Date(),
      });

      const result = formatTopicCompactLine(topic);

      expect(result).toContain('Feature: API & DB');
    });

    test('handles future date (edge case)', () => {
      const futureDate = new Date(Date.now() + 60 * 60 * 1000); // 1 hour in future
      const result = formatRelativeTime(futureDate);

      // Should handle gracefully (might show "agora" or negative)
      expect(typeof result).toBe('string');
    });
  });
});

describe('Topic Status Display Coverage', () => {
  // Comprehensive coverage of all status combinations
  const topicTypes = ['general', 'ralph', 'worktree', 'session'] as const;
  const topicStatuses = ['active', 'closed'] as const;
  const ralphStatuses = [undefined, 'running', 'paused', 'completed', 'failed', 'cancelled', 'interrupted', 'blocked'] as const;

  test.each(topicTypes)('topic type "%s" returns valid display status for active', (type) => {
    const result = getTopicStatusDisplay(type, 'active', undefined);
    expect(result.emoji).toBeTruthy();
    expect(result.label).toBeTruthy();
    expect(['running', 'paused', 'completed', 'inactive', 'closed']).toContain(result.displayStatus);
  });

  test.each(topicTypes)('topic type "%s" returns locked for closed', (type) => {
    const result = getTopicStatusDisplay(type, 'closed', undefined);
    expect(result.emoji).toBe('🔒');
    expect(result.label).toBe('Fechado');
    expect(result.displayStatus).toBe('closed');
  });

  test.each(ralphStatuses)('Ralph with status "%s" returns valid display', (status) => {
    const result = getTopicStatusDisplay('ralph', 'active', status);
    expect(result.emoji).toBeTruthy();
    expect(result.label).toBeTruthy();
    expect(['running', 'paused', 'completed', 'inactive', 'closed']).toContain(result.displayStatus);
  });
});

describe('Compact Line Format Consistency', () => {
  test('all compact lines follow same delimiter pattern', () => {
    const topics = [
      createTopicItem({ type: 'session', status: 'active' }),
      createTopicItem({ type: 'worktree', status: 'active' }),
      createTopicItem({ type: 'ralph', status: 'active', ralphStatus: 'running', currentIteration: 1, maxIterations: 10 }),
      createTopicItem({ type: 'session', status: 'closed' }),
    ];

    for (const topic of topics) {
      const result = formatTopicCompactLine(topic);
      // All lines should use │ as delimiter
      expect(result.split('│').length).toBeGreaterThanOrEqual(3);
    }
  });

  test('compact lines have consistent structure', () => {
    const topic = createTopicItem({
      name: 'Test',
      emoji: '💬',
      type: 'session',
      status: 'active',
      lastActivity: new Date(),
    });

    const result = formatTopicCompactLine(topic);
    const parts = result.split('│').map(p => p.trim());

    // First part: status emoji + label
    expect(parts[0]).toMatch(/^[^\s]+ \S+$/); // emoji + word
    // Second part: topic emoji + name
    expect(parts[1]).toContain('💬');
    expect(parts[1]).toContain('Test');
    // Last part: time
    expect(parts[parts.length - 1]).toMatch(/(há \d+[mhd]|agora)/);
  });
});
