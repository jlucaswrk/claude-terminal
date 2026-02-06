// src/__tests__/topic-ui.test.ts
import { describe, test, expect } from 'bun:test';
import {
  getTopicStatusDisplay,
  formatRelativeTime,
  formatTopicCompactLine,
  generateTopicDeepLink,
  type TopicListItem,
  type TopicDisplayStatus,
} from '../telegram';

// Helper to create mock topic for tests
function createMockTopicListItem(overrides: Partial<TopicListItem> = {}): TopicListItem {
  return {
    id: 'topic-uuid-1234',
    telegramTopicId: 123456,
    emoji: '💬',
    name: 'Test Topic',
    type: 'session',
    status: 'active',
    lastActivity: new Date(),
    ...overrides,
  };
}

describe('Topic UI - Status Display', () => {
  describe('getTopicStatusDisplay', () => {
    test('returns closed status for closed topics', () => {
      const result = getTopicStatusDisplay('session', 'closed');
      expect(result.emoji).toBe('🔒');
      expect(result.label).toBe('Fechado');
      expect(result.displayStatus).toBe('closed');
    });

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

    test('returns completed status for Ralph with failed/cancelled/blocked loop', () => {
      const failedStatuses: Array<'failed' | 'cancelled' | 'interrupted' | 'blocked'> = [
        'failed', 'cancelled', 'interrupted', 'blocked'
      ];

      for (const status of failedStatuses) {
        const result = getTopicStatusDisplay('ralph', 'active', status);
        expect(result.emoji).toBe('✅');
        expect(result.displayStatus).toBe('completed');
      }
    });

    test('returns inactive status for Ralph without loop status', () => {
      const result = getTopicStatusDisplay('ralph', 'active');
      expect(result.emoji).toBe('💤');
      expect(result.label).toBe('Inativo');
      expect(result.displayStatus).toBe('inactive');
    });

    test('returns active status for session/worktree/general topics', () => {
      const types: Array<'session' | 'worktree' | 'general'> = ['session', 'worktree', 'general'];

      for (const type of types) {
        const result = getTopicStatusDisplay(type, 'active');
        expect(result.emoji).toBe('💬');
        expect(result.label).toBe('Ativo');
        expect(result.displayStatus).toBe('inactive');
      }
    });
  });
});

describe('Topic UI - Relative Time Formatting', () => {
  describe('formatRelativeTime', () => {
    test('returns "agora" for recent times (< 1 minute)', () => {
      const now = new Date();
      expect(formatRelativeTime(now)).toBe('agora');

      const thirtySecondsAgo = new Date(now.getTime() - 30000);
      expect(formatRelativeTime(thirtySecondsAgo)).toBe('agora');
    });

    test('returns minutes for times < 1 hour', () => {
      const now = new Date();

      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);
      expect(formatRelativeTime(fiveMinutesAgo)).toBe('há 5m');

      const fortyFiveMinutesAgo = new Date(now.getTime() - 45 * 60 * 1000);
      expect(formatRelativeTime(fortyFiveMinutesAgo)).toBe('há 45m');
    });

    test('returns hours for times < 1 day', () => {
      const now = new Date();

      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
      expect(formatRelativeTime(twoHoursAgo)).toBe('há 2h');

      const twentyThreeHoursAgo = new Date(now.getTime() - 23 * 60 * 60 * 1000);
      expect(formatRelativeTime(twentyThreeHoursAgo)).toBe('há 23h');
    });

    test('returns days for times >= 1 day', () => {
      const now = new Date();

      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      expect(formatRelativeTime(oneDayAgo)).toBe('há 1d');

      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      expect(formatRelativeTime(sevenDaysAgo)).toBe('há 7d');
    });
  });
});

describe('Topic UI - Compact Line Formatting', () => {
  describe('formatTopicCompactLine', () => {
    test('formats basic session topic', () => {
      const topic = createMockTopicListItem({
        name: 'Auth JWT',
        emoji: '💬',
        type: 'session',
        status: 'active',
        lastActivity: new Date(),
      });

      const line = formatTopicCompactLine(topic);

      expect(line).toContain('💬'); // Status emoji (Ativo)
      expect(line).toContain('Ativo');
      expect(line).toContain('💬'); // Topic emoji
      expect(line).toContain('Auth JWT');
      expect(line).toContain('agora');
    });

    test('formats Ralph topic with progress', () => {
      const topic = createMockTopicListItem({
        name: 'Build Feature',
        emoji: '🔄',
        type: 'ralph',
        status: 'active',
        ralphStatus: 'running',
        currentIteration: 5,
        maxIterations: 10,
        lastActivity: new Date(),
      });

      const line = formatTopicCompactLine(topic);

      expect(line).toContain('▶️'); // Running status
      expect(line).toContain('Executando');
      expect(line).toContain('🔄');
      expect(line).toContain('Build Feature');
      expect(line).toContain('5/10');
    });

    test('formats paused Ralph topic', () => {
      const topic = createMockTopicListItem({
        name: 'Paused Task',
        emoji: '🔄',
        type: 'ralph',
        status: 'active',
        ralphStatus: 'paused',
        currentIteration: 3,
        maxIterations: 20,
        lastActivity: new Date(),
      });

      const line = formatTopicCompactLine(topic);

      expect(line).toContain('⏸️');
      expect(line).toContain('Pausado');
      expect(line).toContain('3/20');
    });

    test('formats closed topic', () => {
      const now = new Date();
      const topic = createMockTopicListItem({
        name: 'Old Session',
        emoji: '💬',
        type: 'session',
        status: 'closed',
        lastActivity: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
      });

      const line = formatTopicCompactLine(topic);

      expect(line).toContain('🔒');
      expect(line).toContain('Fechado');
      expect(line).toContain('há 3d');
    });

    test('formats topic with message count', () => {
      const topic = createMockTopicListItem({
        name: 'Chat Session',
        emoji: '💬',
        type: 'session',
        status: 'active',
        messageCount: 42,
        lastActivity: new Date(),
      });

      const line = formatTopicCompactLine(topic);

      expect(line).toContain('42 msgs');
    });

    test('formats worktree topic', () => {
      const topic = createMockTopicListItem({
        name: 'feature/payments',
        emoji: '🌿',
        type: 'worktree',
        status: 'active',
        lastActivity: new Date(),
      });

      const line = formatTopicCompactLine(topic);

      expect(line).toContain('🌿');
      expect(line).toContain('feature/payments');
    });
  });
});

describe('Topic UI - Deep Link Generation', () => {
  describe('generateTopicDeepLink', () => {
    test('generates correct deep link for supergroup', () => {
      // Supergroup chat IDs are negative and start with -100
      const chatId = -1001234567890;
      const threadId = 123;

      const link = generateTopicDeepLink(chatId, threadId);

      expect(link).toBe('https://t.me/c/1234567890/123');
    });

    test('generates correct deep link for positive chat ID', () => {
      // Some chat IDs might be positive (though rare for groups)
      const chatId = 1234567890;
      const threadId = 456;

      const link = generateTopicDeepLink(chatId, threadId);

      expect(link).toBe('https://t.me/c/1234567890/456');
    });

    test('handles different thread IDs', () => {
      const chatId = -1001111111111;

      expect(generateTopicDeepLink(chatId, 1)).toBe('https://t.me/c/1111111111/1');
      expect(generateTopicDeepLink(chatId, 999)).toBe('https://t.me/c/1111111111/999');
      expect(generateTopicDeepLink(chatId, 123456)).toBe('https://t.me/c/1111111111/123456');
    });
  });
});

describe('Topic UI - TopicListItem Type', () => {
  test('accepts all required fields', () => {
    const topic: TopicListItem = {
      id: 'test-id',
      telegramTopicId: 123,
      emoji: '💬',
      name: 'Test',
      type: 'session',
      status: 'active',
      lastActivity: new Date(),
    };

    expect(topic.id).toBe('test-id');
    expect(topic.type).toBe('session');
  });

  test('accepts optional Ralph-specific fields', () => {
    const topic: TopicListItem = {
      id: 'ralph-id',
      telegramTopicId: 456,
      emoji: '🔄',
      name: 'Ralph Task',
      type: 'ralph',
      status: 'active',
      lastActivity: new Date(),
      loopId: 'loop-123',
      currentIteration: 5,
      maxIterations: 10,
      ralphStatus: 'running',
    };

    expect(topic.loopId).toBe('loop-123');
    expect(topic.currentIteration).toBe(5);
    expect(topic.maxIterations).toBe(10);
    expect(topic.ralphStatus).toBe('running');
  });

  test('accepts optional messageCount field', () => {
    const topic: TopicListItem = {
      id: 'session-id',
      telegramTopicId: 789,
      emoji: '💬',
      name: 'Chat',
      type: 'session',
      status: 'active',
      lastActivity: new Date(),
      messageCount: 100,
    };

    expect(topic.messageCount).toBe(100);
  });
});

describe('Topic UI - Status Display Edge Cases', () => {
  test('handles all topic types correctly', () => {
    const types: Array<'general' | 'ralph' | 'worktree' | 'session'> = [
      'general', 'ralph', 'worktree', 'session'
    ];

    for (const type of types) {
      const result = getTopicStatusDisplay(type, 'active');
      expect(result).toBeDefined();
      expect(result.emoji).toBeDefined();
      expect(result.label).toBeDefined();
      expect(result.displayStatus).toBeDefined();
    }
  });

  test('closed status takes precedence over ralph status', () => {
    // Even if Ralph has a running status, closed should win
    const result = getTopicStatusDisplay('ralph', 'closed', 'running');
    expect(result.displayStatus).toBe('closed');
    expect(result.emoji).toBe('🔒');
  });
});

describe('Topic UI - Snapshot Tests', () => {
  test('compact line format is stable', () => {
    // Use fixed date for deterministic output
    const fixedDate = new Date('2024-01-15T12:00:00.000Z');

    const topic = createMockTopicListItem({
      name: 'Stable Format Test',
      emoji: '💬',
      type: 'session',
      status: 'active',
      lastActivity: fixedDate,
    });

    const line = formatTopicCompactLine(topic);

    // Verify structure contains all expected parts separated by │
    const parts = line.split('│').map(p => p.trim());
    expect(parts.length).toBe(3);

    // Part 1: Status emoji + label
    expect(parts[0]).toContain('Ativo');

    // Part 2: Topic emoji + name
    expect(parts[1]).toContain('💬');
    expect(parts[1]).toContain('Stable Format Test');

    // Part 3: Time ago
    expect(parts[2]).toContain('há');
  });

  test('Ralph progress line format is stable', () => {
    const fixedDate = new Date('2024-01-15T12:00:00.000Z');

    const topic = createMockTopicListItem({
      name: 'Ralph Test',
      emoji: '🔄',
      type: 'ralph',
      status: 'active',
      ralphStatus: 'running',
      currentIteration: 7,
      maxIterations: 15,
      lastActivity: fixedDate,
    });

    const line = formatTopicCompactLine(topic);

    // Verify Ralph-specific format
    expect(line).toContain('▶️ Executando');
    expect(line).toContain('🔄 Ralph Test');
    expect(line).toContain('7/15');
  });

  test('deep link format is stable', () => {
    const link1 = generateTopicDeepLink(-1001234567890, 123);
    const link2 = generateTopicDeepLink(-1001234567890, 123);

    expect(link1).toBe(link2);
    expect(link1).toMatch(/^https:\/\/t\.me\/c\/\d+\/\d+$/);
  });
});
