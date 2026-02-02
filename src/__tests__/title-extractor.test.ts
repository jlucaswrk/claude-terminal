import { describe, test, expect } from 'bun:test';
import { TitleExtractor } from '../title-extractor';

describe('TitleExtractor', () => {
  const extractor = new TitleExtractor();

  describe('extract', () => {
    describe('with title marker in response', () => {
      test('extracts title from [TITLE: ...] format', () => {
        const response = `
          I've completed the task.

          [TITLE: Working on API endpoints]
        `;
        const prompt = 'create some API endpoints';

        const title = extractor.extract(response, prompt);
        expect(title).toBe('Working on API endpoints');
      });

      test('extracts title case-insensitively', () => {
        const response = 'Done! [title: Building user auth]';
        const title = extractor.extract(response, 'implement auth');
        expect(title).toBe('Building user auth');
      });

      test('handles extra whitespace in marker', () => {
        const response = 'Done! [TITLE:   Refactoring database  ]';
        const title = extractor.extract(response, 'refactor db');
        expect(title).toBe('Refactoring database');
      });

      test('capitalizes first letter', () => {
        const response = 'Done! [TITLE: fixing login bug]';
        const title = extractor.extract(response, 'fix bug');
        expect(title).toBe('Fixing login bug');
      });

      test('truncates long titles', () => {
        const longTitle = 'A'.repeat(60);
        const response = `Done! [TITLE: ${longTitle}]`;
        const title = extractor.extract(response, 'do something');

        expect(title.length).toBeLessThanOrEqual(50);
        expect(title.endsWith('...')).toBe(true);
      });
    });

    describe('fallback to prompt', () => {
      test('uses first 5 words of prompt when no title marker', () => {
        const response = 'I completed the task successfully.';
        const prompt = 'Create a new user authentication system';

        const title = extractor.extract(response, prompt);
        expect(title).toBe('Create a new user authentication...');
      });

      test('uses all words if prompt has fewer than 5', () => {
        const response = 'Done.';
        const prompt = 'Fix the bug';

        const title = extractor.extract(response, prompt);
        expect(title).toBe('Fix the bug');
      });

      test('normalizes whitespace in prompt', () => {
        const response = 'Done.';
        const prompt = '  Create   a    new   feature  ';

        const title = extractor.extract(response, prompt);
        expect(title).toBe('Create a new feature');
      });

      test('returns default for empty prompt', () => {
        const response = 'Done.';
        const prompt = '';

        const title = extractor.extract(response, prompt);
        expect(title).toBe('New conversation');
      });

      test('returns default for whitespace-only prompt', () => {
        const response = 'Done.';
        const prompt = '   ';

        const title = extractor.extract(response, prompt);
        expect(title).toBe('New conversation');
      });
    });

    describe('edge cases', () => {
      test('handles empty response', () => {
        const title = extractor.extract('', 'my prompt here');
        expect(title).toBe('My prompt here');
      });

      test('handles both empty', () => {
        const title = extractor.extract('', '');
        expect(title).toBe('New conversation');
      });

      test('prefers title marker over prompt fallback', () => {
        const response = 'Done! [TITLE: Specific Title]';
        const prompt = 'This is a much longer prompt';

        const title = extractor.extract(response, prompt);
        expect(title).toBe('Specific Title');
      });

      test('handles multiple title markers (uses first)', () => {
        const response = `
          [TITLE: First Title]
          Some content
          [TITLE: Second Title]
        `;
        const title = extractor.extract(response, 'prompt');
        expect(title).toBe('First Title');
      });

      test('handles malformed title marker', () => {
        const response = 'Done! [TITLE: incomplete';
        const prompt = 'fallback prompt here';

        const title = extractor.extract(response, prompt);
        // Should fallback since marker is malformed
        expect(title).toBe('Fallback prompt here');
      });
    });
  });

  describe('hasTitle', () => {
    test('returns true when response has title marker', () => {
      const response = 'Done! [TITLE: My Title]';
      expect(extractor.hasTitle(response)).toBe(true);
    });

    test('returns false when response has no title marker', () => {
      const response = 'Just a regular response.';
      expect(extractor.hasTitle(response)).toBe(false);
    });

    test('returns false for malformed marker', () => {
      const response = 'Done! [TITLE: incomplete';
      expect(extractor.hasTitle(response)).toBe(false);
    });

    test('is case-insensitive', () => {
      expect(extractor.hasTitle('[title: test]')).toBe(true);
      expect(extractor.hasTitle('[Title: test]')).toBe(true);
      expect(extractor.hasTitle('[TITLE: test]')).toBe(true);
    });
  });
});
