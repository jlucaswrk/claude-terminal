import { describe, it, expect } from 'bun:test';
import type { Agent, ModelMode } from '../types';

describe('ModelMode type', () => {
  it('should accept valid model mode values', () => {
    const modes: ModelMode[] = ['selection', 'haiku', 'sonnet', 'opus'];
    expect(modes).toHaveLength(4);
  });

  it('should be usable in type assertions', () => {
    const selection: ModelMode = 'selection';
    const haiku: ModelMode = 'haiku';
    const sonnet: ModelMode = 'sonnet';
    const opus: ModelMode = 'opus';

    expect(selection).toBe('selection');
    expect(haiku).toBe('haiku');
    expect(sonnet).toBe('sonnet');
    expect(opus).toBe('opus');
  });
});

describe('Agent with groupId and modelMode', () => {
  it('should have optional groupId field', () => {
    // Type assertion to verify groupId is a valid key of Agent
    const groupIdKey: keyof Agent = 'groupId';
    expect(groupIdKey).toBe('groupId');

    // Test value assignment
    const agent: Pick<Agent, 'id' | 'groupId'> = {
      id: 'test-id',
      groupId: '120363123456789012@g.us',
    };
    expect(agent.groupId).toBe('120363123456789012@g.us');
  });

  it('should have modelMode field with default selection', () => {
    // Type assertion to verify modelMode is a valid key of Agent
    const modelModeKey: keyof Agent = 'modelMode';
    expect(modelModeKey).toBe('modelMode');

    // Test value assignment
    const agent: Pick<Agent, 'id' | 'modelMode'> = {
      id: 'test-id',
      modelMode: 'selection',
    };
    expect(agent.modelMode).toBe('selection');
  });

  it('should allow fixed model modes', () => {
    const modes: ModelMode[] = ['haiku', 'sonnet', 'opus'];
    modes.forEach(mode => {
      const agent: Pick<Agent, 'modelMode'> = { modelMode: mode };
      expect(agent.modelMode).toBe(mode);
    });
  });
});
