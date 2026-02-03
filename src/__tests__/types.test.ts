import { describe, it, expect } from 'bun:test';
import type { ModelMode } from '../types';

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
