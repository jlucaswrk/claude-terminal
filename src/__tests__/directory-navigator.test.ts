// src/__tests__/directory-navigator.test.ts
/**
 * Tests for DirectoryNavigator helper functions
 *
 * Tests cover:
 * - listDirectories: listing, filtering, limiting
 * - navigateUp: parent path calculation
 * - navigateInto: subdirectory path calculation
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { listDirectories, navigateUp, navigateInto } from '../directory-navigator';
import { mkdirSync, rmdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('DirectoryNavigator', () => {
  const testDir = join(tmpdir(), 'directory-navigator-test-' + Date.now());

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('listDirectories', () => {
    test('returns empty for empty directory', () => {
      const result = listDirectories(testDir);
      expect(result.directories).toHaveLength(0);
      expect(result.totalFound).toBe(0);
      expect(result.truncated).toBe(false);
      expect(result.currentPath).toBe(testDir);
    });

    test('lists only directories, not files', () => {
      mkdirSync(join(testDir, 'subdir1'));
      mkdirSync(join(testDir, 'subdir2'));
      // Create a file (not a directory)
      Bun.write(join(testDir, 'file.txt'), 'content');

      const result = listDirectories(testDir);
      expect(result.directories).toEqual(['subdir1', 'subdir2']);
      expect(result.totalFound).toBe(2);
    });

    test('filters hidden directories (starting with .)', () => {
      mkdirSync(join(testDir, '.hidden'));
      mkdirSync(join(testDir, 'visible'));

      const result = listDirectories(testDir);
      expect(result.directories).toEqual(['visible']);
    });

    test('sorts alphabetically', () => {
      mkdirSync(join(testDir, 'charlie'));
      mkdirSync(join(testDir, 'alpha'));
      mkdirSync(join(testDir, 'bravo'));

      const result = listDirectories(testDir);
      expect(result.directories).toEqual(['alpha', 'bravo', 'charlie']);
    });

    test('limits to 12 by default', () => {
      for (let i = 0; i < 15; i++) {
        mkdirSync(join(testDir, `dir-${String(i).padStart(2, '0')}`));
      }

      const result = listDirectories(testDir);
      expect(result.directories).toHaveLength(12);
      expect(result.totalFound).toBe(15);
      expect(result.truncated).toBe(true);
    });

    test('respects custom limit', () => {
      for (let i = 0; i < 5; i++) {
        mkdirSync(join(testDir, `dir-${i}`));
      }

      const result = listDirectories(testDir, { limit: 3 });
      expect(result.directories).toHaveLength(3);
      expect(result.totalFound).toBe(5);
      expect(result.truncated).toBe(true);
    });

    test('filter works case-insensitive substring match', () => {
      mkdirSync(join(testDir, 'src'));
      mkdirSync(join(testDir, 'src-backup'));
      mkdirSync(join(testDir, 'dist'));
      mkdirSync(join(testDir, 'node_modules'));

      const result = listDirectories(testDir, { filter: 'SRC' });
      expect(result.directories).toEqual(['src', 'src-backup']);
      expect(result.totalFound).toBe(2);
      expect(result.filter).toBe('SRC');
    });

    test('returns parentPath for non-root directories', () => {
      const sub = join(testDir, 'sub');
      mkdirSync(sub);

      const result = listDirectories(sub);
      expect(result.parentPath).toBe(testDir);
    });

    test('returns undefined parentPath for root', () => {
      const result = listDirectories('/');
      expect(result.parentPath).toBeUndefined();
    });

    test('handles non-existent path gracefully', () => {
      const result = listDirectories('/nonexistent/path/xyz');
      expect(result.directories).toHaveLength(0);
      expect(result.totalFound).toBe(0);
    });
  });

  describe('navigateUp', () => {
    test('returns parent directory', () => {
      expect(navigateUp('/Users/lucas/Desktop')).toBe('/Users/lucas');
    });

    test('returns same path for root', () => {
      expect(navigateUp('/')).toBe('/');
    });
  });

  describe('navigateInto', () => {
    test('joins current path with subdirectory', () => {
      expect(navigateInto('/Users/lucas', 'Desktop')).toBe('/Users/lucas/Desktop');
    });

    test('handles nested paths', () => {
      expect(navigateInto('/Users/lucas/Desktop', 'project')).toBe('/Users/lucas/Desktop/project');
    });
  });
});
