import { existsSync, copyFileSync, readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import type {
  Agent,
  Output,
  SystemConfig,
  AgentsState,
  SerializedAgentsState,
  SerializedAgent,
  SerializedOutput,
} from './types';
import { DEFAULTS } from './types';

const STATE_FILE = './agents-state.json';
const BACKUP_FILE = './agents-state.json.bak';

/**
 * PersistenceService handles saving and loading the agents state to/from JSON
 *
 * Features:
 * - Creates backup before overwriting
 * - Validates schema on load
 * - Falls back to backup if main file is corrupted
 * - Handles migration from old session format
 */
export class PersistenceService {
  private readonly stateFile: string;
  private readonly backupFile: string;

  constructor(stateFile: string = STATE_FILE) {
    this.stateFile = stateFile;
    this.backupFile = stateFile + '.bak';
  }

  /**
   * Save the current state to JSON file
   * Creates a backup of the existing file before overwriting
   */
  save(state: { config: SystemConfig; agents: Agent[] }): void {
    // Create backup if file exists
    if (existsSync(this.stateFile)) {
      try {
        copyFileSync(this.stateFile, this.backupFile);
      } catch (err) {
        console.error('Failed to create backup:', err);
        // Continue with save even if backup fails
      }
    }

    const serialized = this.serialize(state);
    const json = JSON.stringify(serialized, null, 2);

    Bun.write(this.stateFile, json);
  }

  /**
   * Load state from JSON file
   * Returns null if file doesn't exist or is invalid (after trying backup)
   */
  load(): { config: SystemConfig; agents: Agent[] } | null {
    // Try main file first
    const mainResult = this.loadFile(this.stateFile);
    if (mainResult) {
      return mainResult;
    }

    // Try backup file
    console.warn('Main state file invalid or missing, trying backup...');
    const backupResult = this.loadFile(this.backupFile);
    if (backupResult) {
      console.log('Loaded state from backup');
      // Restore backup as main file
      this.save(backupResult);
      return backupResult;
    }

    console.warn('No valid state file found');
    return null;
  }

  /**
   * Load and parse a specific file
   */
  private loadFile(filePath: string): { config: SystemConfig; agents: Agent[] } | null {
    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content) as SerializedAgentsState;

      // Validate schema
      if (!this.validateSchema(data)) {
        console.error(`Invalid schema in ${filePath}`);
        return null;
      }

      return this.deserialize(data);
    } catch (err) {
      console.error(`Failed to load ${filePath}:`, err);
      return null;
    }
  }

  /**
   * Validate the JSON schema
   */
  private validateSchema(data: unknown): data is SerializedAgentsState {
    if (!data || typeof data !== 'object') {
      return false;
    }

    const state = data as Partial<SerializedAgentsState>;

    // Check version field
    if (typeof state.version !== 'string') {
      return false;
    }

    // Check config
    if (!state.config || typeof state.config !== 'object') {
      return false;
    }
    if (typeof state.config.maxConcurrent !== 'number') {
      return false;
    }
    if (typeof state.config.version !== 'string') {
      return false;
    }

    // Check agents array
    if (!Array.isArray(state.agents)) {
      return false;
    }

    // Validate each agent
    for (const agent of state.agents) {
      if (!this.validateAgent(agent)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Validate a single agent object
   */
  private validateAgent(agent: unknown): agent is SerializedAgent {
    if (!agent || typeof agent !== 'object') {
      return false;
    }

    const a = agent as Partial<SerializedAgent>;

    // Required string fields (userId is optional for backward compatibility)
    const requiredStrings = ['id', 'name', 'title', 'status', 'statusDetails', 'priority', 'lastActivity', 'createdAt'];
    for (const field of requiredStrings) {
      if (typeof (a as Record<string, unknown>)[field] !== 'string') {
        return false;
      }
    }

    // userId can be missing in old data (backward compatibility)
    if (a.userId !== undefined && typeof a.userId !== 'string') {
      return false;
    }

    // Required number fields
    if (typeof a.messageCount !== 'number') {
      return false;
    }

    // Status must be valid
    if (!['idle', 'processing', 'error'].includes(a.status!)) {
      return false;
    }

    // Priority must be valid
    if (!['high', 'medium', 'low'].includes(a.priority!)) {
      return false;
    }

    // Outputs must be array
    if (!Array.isArray(a.outputs)) {
      return false;
    }

    return true;
  }

  /**
   * Serialize state for JSON storage (convert Dates to ISO strings)
   */
  private serialize(state: { config: SystemConfig; agents: Agent[] }): SerializedAgentsState {
    return {
      version: DEFAULTS.SCHEMA_VERSION,
      config: state.config,
      agents: state.agents.map((agent): SerializedAgent => ({
        id: agent.id,
        userId: agent.userId,
        name: agent.name,
        type: agent.type,
        emoji: agent.emoji,
        workspace: agent.workspace,
        sessionId: agent.sessionId,
        title: agent.title,
        status: agent.status,
        statusDetails: agent.statusDetails,
        priority: agent.priority,
        lastActivity: agent.lastActivity.toISOString(),
        messageCount: agent.messageCount,
        outputs: agent.outputs.map((output): SerializedOutput => ({
          id: output.id,
          summary: output.summary,
          prompt: output.prompt,
          response: output.response,
          model: output.model,
          status: output.status,
          timestamp: output.timestamp.toISOString(),
        })),
        createdAt: agent.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Deserialize state from JSON (convert ISO strings to Dates)
   */
  private deserialize(data: SerializedAgentsState): { config: SystemConfig; agents: Agent[] } {
    return {
      config: data.config,
      agents: data.agents.map((agent): Agent => ({
        id: agent.id,
        // Backward compatibility: use 'default' for old agents without userId
        userId: agent.userId || 'default',
        name: agent.name,
        // Backward compatibility: default to 'claude' for old agents without type
        type: agent.type || 'claude',
        emoji: agent.emoji,
        workspace: agent.workspace,
        sessionId: agent.sessionId,
        title: agent.title,
        status: agent.status,
        statusDetails: agent.statusDetails,
        priority: agent.priority,
        lastActivity: new Date(agent.lastActivity),
        messageCount: agent.messageCount,
        outputs: agent.outputs.map((output): Output => ({
          id: output.id,
          summary: output.summary,
          prompt: output.prompt,
          response: output.response,
          model: output.model,
          status: output.status,
          timestamp: new Date(output.timestamp),
        })),
        createdAt: new Date(agent.createdAt),
      })),
    };
  }

  /**
   * Detect if there are old session files (pre-multi-agent format)
   * Old format used `${userId}_${model}` pattern
   */
  detectOldSessions(): boolean {
    // Check for .claude-sessions directory or similar patterns
    // This is a placeholder - actual implementation depends on where SDK stores sessions
    try {
      const sessionDir = join(process.cwd(), '.claude-sessions');
      if (existsSync(sessionDir)) {
        const files = readdirSync(sessionDir);
        // Look for files matching old pattern (userId_haiku, userId_opus)
        return files.some(f => f.includes('_haiku') || f.includes('_opus'));
      }
    } catch {
      // Directory doesn't exist or can't be read
    }
    return false;
  }

  /**
   * Migrate old sessions to new multi-agent format
   * Creates agents named "Haiku" and "Opus" with existing sessions
   */
  migrateOldSessions(): Agent[] {
    const migratedAgents: Agent[] = [];
    const now = new Date();

    // This is a placeholder implementation
    // Actual migration would read old session files and create corresponding agents
    console.log('Migrating old sessions to multi-agent format...');

    // For now, just return empty array if no actual migration needed
    // Real implementation would:
    // 1. Read old session files
    // 2. Create agents for each unique userId+model combination
    // 3. Associate session IDs with new agents

    return migratedAgents;
  }

  /**
   * Get the path to the state file
   */
  getStateFilePath(): string {
    return this.stateFile;
  }

  /**
   * Get the path to the backup file
   */
  getBackupFilePath(): string {
    return this.backupFile;
  }
}
