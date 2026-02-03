// src/__tests__/ronin-agent.test.ts
import { describe, test, expect } from 'bun:test';
import { RoninAgent, RONIN_SYSTEM_PROMPT, RONIN_ALLOWED_TOOLS } from '../ronin-agent';

describe('RoninAgent', () => {
  describe('RONIN_ALLOWED_TOOLS', () => {
    test('allows read-only tools', () => {
      expect(RONIN_ALLOWED_TOOLS).toContain('Read');
      expect(RONIN_ALLOWED_TOOLS).toContain('Glob');
      expect(RONIN_ALLOWED_TOOLS).toContain('Grep');
    });

    test('does not allow write tools', () => {
      expect(RONIN_ALLOWED_TOOLS).not.toContain('Write');
      expect(RONIN_ALLOWED_TOOLS).not.toContain('Edit');
      expect(RONIN_ALLOWED_TOOLS).not.toContain('Bash');
    });
  });

  describe('RONIN_SYSTEM_PROMPT', () => {
    test('includes read-only instruction', () => {
      expect(RONIN_SYSTEM_PROMPT).toContain('read-only');
    });

    test('includes concise instruction', () => {
      expect(RONIN_SYSTEM_PROMPT).toContain('concis');
    });
  });

  describe('isAllowedTool', () => {
    const ronin = new RoninAgent();

    test('returns true for allowed tools', () => {
      expect(ronin.isAllowedTool('Read')).toBe(true);
      expect(ronin.isAllowedTool('Glob')).toBe(true);
      expect(ronin.isAllowedTool('Grep')).toBe(true);
    });

    test('returns false for disallowed tools', () => {
      expect(ronin.isAllowedTool('Write')).toBe(false);
      expect(ronin.isAllowedTool('Edit')).toBe(false);
      expect(ronin.isAllowedTool('Bash')).toBe(false);
    });
  });

  describe('truncateResponse', () => {
    const ronin = new RoninAgent();

    test('keeps short responses unchanged', () => {
      const short = 'Hello world';
      expect(ronin.truncateResponse(short)).toBe(short);
    });

    test('truncates long responses', () => {
      const long = 'a'.repeat(1000);
      const truncated = ronin.truncateResponse(long, 100);
      expect(truncated.length).toBeLessThanOrEqual(103); // 100 + '...'
      expect(truncated).toContain('...');
    });
  });
});
