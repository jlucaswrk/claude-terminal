import { existsSync, copyFileSync, readFileSync, readdirSync, mkdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import type {
  Agent,
  Output,
  SystemConfig,
  AgentsState,
  SerializedAgentsState,
  SerializedAgent,
  SerializedOutput,
  RalphLoopState,
  RalphIteration,
  SerializedRalphLoopState,
  SerializedRalphIteration,
} from './types';
import { DEFAULTS } from './types';

const STATE_FILE = './agents-state.json';
const BACKUP_FILE = './agents-state.json.bak';
const LOOPS_DIR = join(homedir(), '.claude-terminal', 'loops');

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
  private readonly loopsDir: string;

  constructor(stateFile: string = STATE_FILE, loopsDir: string = LOOPS_DIR) {
    this.stateFile = stateFile;
    this.backupFile = stateFile + '.bak';
    this.loopsDir = loopsDir;
    this.ensureLoopsDir();
  }

  /**
   * Ensure the loops directory exists
   */
  private ensureLoopsDir(): void {
    if (!existsSync(this.loopsDir)) {
      mkdirSync(this.loopsDir, { recursive: true });
    }
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
    if (!['idle', 'processing', 'error', 'ralph-loop', 'ralph-paused'].includes(a.status!)) {
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
        mode: agent.mode,
        emoji: agent.emoji,
        workspace: agent.workspace,
        groupId: agent.groupId,
        modelMode: agent.modelMode,
        sessionId: agent.sessionId,
        currentLoopId: agent.currentLoopId,
        title: agent.title,
        status: agent.status,
        statusDetails: agent.statusDetails,
        priority: agent.priority,
        lastActivity: agent.lastActivity.toISOString(),
        messageCount: agent.messageCount,
        outputs: agent.outputs.map((output): SerializedOutput => ({
          id: output.id,
          type: output.type,
          summary: output.summary,
          prompt: output.prompt,
          response: output.response,
          model: output.model,
          status: output.status,
          timestamp: output.timestamp.toISOString(),
          loopId: output.loopId,
          iterationCount: output.iterationCount,
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
        // Backward compatibility: default to 'conversational' for old agents without mode
        mode: agent.mode || 'conversational',
        emoji: agent.emoji,
        workspace: agent.workspace,
        groupId: agent.groupId,
        // Backward compatibility: default to 'selection' for old agents without modelMode
        modelMode: agent.modelMode || 'selection',
        sessionId: agent.sessionId,
        currentLoopId: agent.currentLoopId,
        title: agent.title,
        status: agent.status,
        statusDetails: agent.statusDetails,
        priority: agent.priority,
        lastActivity: new Date(agent.lastActivity),
        messageCount: agent.messageCount,
        outputs: agent.outputs.map((output): Output => ({
          id: output.id,
          // Backward compatibility: default to 'standard' for legacy outputs without type
          type: output.type || 'standard',
          summary: output.summary,
          prompt: output.prompt,
          response: output.response,
          model: output.model,
          status: output.status,
          timestamp: new Date(output.timestamp),
          loopId: output.loopId,
          iterationCount: output.iterationCount,
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

  /**
   * Get the path to the loops directory
   */
  getLoopsDir(): string {
    return this.loopsDir;
  }

  /**
   * Get the file path for a specific loop
   */
  private getLoopFilePath(loopId: string): string {
    return join(this.loopsDir, `${loopId}.json`);
  }

  /**
   * Save a loop state to disk
   */
  saveLoop(loopState: RalphLoopState): void {
    this.ensureLoopsDir();
    const serialized = this.serializeLoop(loopState);
    const json = JSON.stringify(serialized, null, 2);
    const filePath = this.getLoopFilePath(loopState.id);
    Bun.write(filePath, json);
  }

  /**
   * Load a loop state from disk
   * Returns null if file doesn't exist or is invalid
   */
  loadLoop(loopId: string): RalphLoopState | null {
    const filePath = this.getLoopFilePath(loopId);

    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content) as SerializedRalphLoopState;

      if (!this.validateLoopSchema(data)) {
        console.error(`Invalid loop schema in ${filePath}`);
        return null;
      }

      return this.deserializeLoop(data);
    } catch (err) {
      console.error(`Failed to load loop ${loopId}:`, err);
      return null;
    }
  }

  /**
   * Delete a loop file
   */
  deleteLoop(loopId: string): boolean {
    const filePath = this.getLoopFilePath(loopId);

    if (!existsSync(filePath)) {
      return false;
    }

    try {
      unlinkSync(filePath);
      return true;
    } catch (err) {
      console.error(`Failed to delete loop ${loopId}:`, err);
      return false;
    }
  }

  /**
   * List all loop IDs in the loops directory
   */
  listLoops(): string[] {
    if (!existsSync(this.loopsDir)) {
      return [];
    }

    try {
      const files = readdirSync(this.loopsDir);
      return files
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', ''));
    } catch (err) {
      console.error('Failed to list loops:', err);
      return [];
    }
  }

  /**
   * Load all loops from disk
   */
  loadAllLoops(): RalphLoopState[] {
    const loopIds = this.listLoops();
    const loops: RalphLoopState[] = [];

    for (const loopId of loopIds) {
      const loop = this.loadLoop(loopId);
      if (loop) {
        loops.push(loop);
      }
    }

    return loops;
  }

  /**
   * Detect and mark interrupted loops (status "running" when process starts)
   * Returns the number of loops marked as interrupted
   */
  recoverInterruptedLoops(): number {
    const loops = this.loadAllLoops();
    let interruptedCount = 0;

    for (const loop of loops) {
      if (loop.status === 'running') {
        // Mark as interrupted and save
        const interruptedLoop: RalphLoopState = {
          ...loop,
          status: 'interrupted',
        };
        this.saveLoop(interruptedLoop);
        interruptedCount++;
        console.log(`Marked loop ${loop.id} as interrupted (was running)`);
      }
    }

    return interruptedCount;
  }

  /**
   * Clean up orphaned loop files (loops whose agent no longer exists)
   * Returns the number of loops deleted
   */
  cleanupOrphanedLoops(existingAgentIds: string[]): number {
    const loops = this.loadAllLoops();
    let deletedCount = 0;
    const agentIdSet = new Set(existingAgentIds);

    for (const loop of loops) {
      // Only clean up completed/failed/cancelled/blocked loops with non-existent agents
      const isTerminalState = ['completed', 'failed', 'cancelled', 'blocked'].includes(loop.status);
      const agentExists = agentIdSet.has(loop.agentId);

      if (!agentExists && isTerminalState) {
        if (this.deleteLoop(loop.id)) {
          deletedCount++;
          console.log(`Deleted orphaned loop ${loop.id} (agent ${loop.agentId} no longer exists)`);
        }
      }
    }

    return deletedCount;
  }

  /**
   * Get loops for a specific agent
   */
  getLoopsForAgent(agentId: string): RalphLoopState[] {
    return this.loadAllLoops().filter(loop => loop.agentId === agentId);
  }

  /**
   * Get active loops (running or paused)
   */
  getActiveLoops(): RalphLoopState[] {
    return this.loadAllLoops().filter(loop =>
      loop.status === 'running' || loop.status === 'paused'
    );
  }

  /**
   * Validate loop state schema
   */
  private validateLoopSchema(data: unknown): data is SerializedRalphLoopState {
    if (!data || typeof data !== 'object') {
      return false;
    }

    const loop = data as Partial<SerializedRalphLoopState>;

    // Required string fields
    const requiredStrings = ['id', 'agentId', 'userId', 'status', 'task', 'currentModel', 'startTime'];
    for (const field of requiredStrings) {
      if (typeof (loop as Record<string, unknown>)[field] !== 'string') {
        return false;
      }
    }

    // Required number fields
    if (typeof loop.currentIteration !== 'number' || typeof loop.maxIterations !== 'number') {
      return false;
    }

    // Status must be valid
    const validStatuses = ['running', 'paused', 'completed', 'failed', 'cancelled', 'interrupted', 'blocked'];
    if (!validStatuses.includes(loop.status!)) {
      return false;
    }

    // Model must be valid
    const validModels = ['haiku', 'sonnet', 'opus'];
    if (!validModels.includes(loop.currentModel!)) {
      return false;
    }

    // Iterations must be array
    if (!Array.isArray(loop.iterations)) {
      return false;
    }

    // Validate each iteration
    for (const iteration of loop.iterations) {
      if (!this.validateIterationSchema(iteration)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Validate a single iteration object
   */
  private validateIterationSchema(iteration: unknown): iteration is SerializedRalphIteration {
    if (!iteration || typeof iteration !== 'object') {
      return false;
    }

    const iter = iteration as Partial<SerializedRalphIteration>;

    // Required number fields
    if (typeof iter.number !== 'number' || typeof iter.duration !== 'number') {
      return false;
    }

    // Required string fields
    const requiredStrings = ['model', 'action', 'prompt', 'response', 'timestamp'];
    for (const field of requiredStrings) {
      if (typeof (iter as Record<string, unknown>)[field] !== 'string') {
        return false;
      }
    }

    // Boolean field
    if (typeof iter.completionPromiseFound !== 'boolean') {
      return false;
    }

    // Model must be valid
    const validModels = ['haiku', 'sonnet', 'opus'];
    if (!validModels.includes(iter.model!)) {
      return false;
    }

    return true;
  }

  /**
   * Serialize loop state for JSON storage (convert Dates to ISO strings)
   */
  private serializeLoop(loop: RalphLoopState): SerializedRalphLoopState {
    return {
      id: loop.id,
      agentId: loop.agentId,
      userId: loop.userId,
      status: loop.status as SerializedRalphLoopState['status'],
      task: loop.task,
      currentIteration: loop.currentIteration,
      maxIterations: loop.maxIterations,
      currentModel: loop.currentModel,
      startTime: loop.startTime.toISOString(),
      iterations: loop.iterations.map((iter): SerializedRalphIteration => ({
        number: iter.number,
        model: iter.model,
        action: iter.action,
        prompt: iter.prompt,
        response: iter.response,
        completionPromiseFound: iter.completionPromiseFound,
        timestamp: iter.timestamp.toISOString(),
        duration: iter.duration,
      })),
    };
  }

  /**
   * Deserialize loop state from JSON (convert ISO strings to Dates)
   */
  private deserializeLoop(data: SerializedRalphLoopState): RalphLoopState {
    return {
      id: data.id,
      agentId: data.agentId,
      userId: data.userId,
      status: data.status,
      task: data.task,
      currentIteration: data.currentIteration,
      maxIterations: data.maxIterations,
      currentModel: data.currentModel,
      startTime: new Date(data.startTime),
      iterations: data.iterations.map((iter): RalphIteration => ({
        number: iter.number,
        model: iter.model,
        action: iter.action,
        prompt: iter.prompt,
        response: iter.response,
        completionPromiseFound: iter.completionPromiseFound,
        timestamp: new Date(iter.timestamp),
        duration: iter.duration,
      })),
    };
  }
}
