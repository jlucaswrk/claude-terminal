// src/workspace-resolver.ts
/**
 * WorkspaceResolver - Resolves workspace for task execution
 *
 * Hierarchy:
 * 1. Topic workspace (if set and exists)
 * 2. Agent workspace (if set)
 * 3. Sandbox fallback (undefined - lets SDK use default)
 */

import { statSync } from 'fs';
import type { Agent, AgentTopic } from './types';

/**
 * Check if a path exists and is a directory.
 */
function isExistingDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Result of workspace resolution
 */
export interface WorkspaceResolution {
  /** Resolved workspace path, or undefined for sandbox/default */
  workspace: string | undefined;
  /** Where the workspace came from */
  source: 'topic' | 'agent' | 'sandbox';
  /** Error if workspace was configured but not found */
  error?: 'workspace_not_found';
}

/**
 * Resolve the workspace for a given agent and optional topic.
 *
 * Resolution hierarchy:
 * 1. Topic has workspace set → validate it exists → use it
 * 2. Topic has workspace set but it doesn't exist → return error
 * 3. Agent has workspace set → use it (no validation, agent workspace is immutable/trusted)
 * 4. Neither has workspace → return sandbox (undefined)
 *
 * @param agent - The agent
 * @param topic - Optional topic (if message came from a specific topic)
 * @returns WorkspaceResolution with workspace path, source, and optional error
 */
export function resolveWorkspace(
  agent: Agent,
  topic?: AgentTopic
): WorkspaceResolution {
  // 1. Topic has workspace configured?
  if (topic?.workspace) {
    if (isExistingDirectory(topic.workspace)) {
      return { workspace: topic.workspace, source: 'topic' };
    } else {
      return {
        workspace: undefined,
        source: 'topic',
        error: 'workspace_not_found',
      };
    }
  }

  // 2. Agent has workspace?
  if (agent.workspace) {
    return { workspace: agent.workspace, source: 'agent' };
  }

  // 3. Fallback to sandbox (undefined = SDK default)
  return { workspace: undefined, source: 'sandbox' };
}
