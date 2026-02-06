/**
 * DirectoryNavigator - Helper functions for filesystem directory navigation
 *
 * Provides directory listing, filtering, and navigation utilities
 * for the workspace selector UI.
 */

import { readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';

/**
 * Result of listing directories in a path
 */
export interface DirectoryListing {
  currentPath: string;
  parentPath?: string;
  directories: string[];       // Directory names (max limit items)
  totalFound: number;          // Total found before limit
  truncated: boolean;          // true if more than limit
  filter?: string;
}

/**
 * List directories in a given path
 */
export function listDirectories(
  path: string,
  options?: { filter?: string; limit?: number }
): DirectoryListing {
  const limit = options?.limit ?? 12;
  const filter = options?.filter;

  let directories: string[] = [];
  try {
    directories = readdirSync(path)
      .filter(name => !name.startsWith('.'))
      .filter(name => {
        try {
          return statSync(join(path, name)).isDirectory();
        } catch {
          return false;
        }
      })
      .sort();
  } catch {
    // directory not readable
  }

  // Apply filter if provided (case-insensitive substring match)
  if (filter) {
    const lowerFilter = filter.toLowerCase();
    directories = directories.filter(name =>
      name.toLowerCase().includes(lowerFilter)
    );
  }

  const totalFound = directories.length;
  const truncated = totalFound > limit;
  const limited = directories.slice(0, limit);

  const parentPath = dirname(path);

  return {
    currentPath: path,
    parentPath: parentPath !== path ? parentPath : undefined,
    directories: limited,
    totalFound,
    truncated,
    filter,
  };
}

/**
 * Navigate up one directory level
 */
export function navigateUp(currentPath: string): string {
  const parent = dirname(currentPath);
  return parent !== currentPath ? parent : currentPath;
}

/**
 * Navigate into a subdirectory
 */
export function navigateInto(currentPath: string, subdirName: string): string {
  return join(currentPath, subdirName);
}
