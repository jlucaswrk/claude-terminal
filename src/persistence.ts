import { existsSync, copyFileSync, readFileSync, readdirSync, mkdirSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';
import type {
  Agent,
  AgentTopic,
  Output,
  SystemConfig,
  AgentsState,
  SerializedAgentsState,
  SerializedAgent,
  SerializedAgentTopic,
  SerializedOutput,
  RalphLoopState,
  RalphIteration,
  SerializedRalphLoopState,
  SerializedRalphIteration,
  UserPreferences,
  SerializedUserPreferences,
  AgentTopicsFile,
  SerializedAgentTopicsFile,
  TopicType,
  TopicStatus,
} from './types';
import { DEFAULTS } from './types';

const STATE_FILE = './agents-state.json';
const BACKUP_FILE = './agents-state.json.bak';
const LOOPS_DIR = join(homedir(), '.claude-terminal', 'loops');
const LEGACY_LOOPS_DIR = './data/loops';
const TOPICS_DIR = './data/topics';
const USER_PREFS_FILE = './user-preferences.json';

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
  private readonly legacyLoopsDir: string;
  private readonly topicsDir: string;
  private readonly preferencesFile: string;
  private preferences: Map<string, UserPreferences> = new Map();

  constructor(
    stateFile: string = STATE_FILE,
    loopsDir: string = LOOPS_DIR,
    preferencesFile: string = USER_PREFS_FILE,
    topicsDir: string = TOPICS_DIR,
    legacyLoopsDir: string = LEGACY_LOOPS_DIR
  ) {
    this.stateFile = stateFile;
    this.backupFile = stateFile + '.bak';
    this.loopsDir = loopsDir;
    this.legacyLoopsDir = legacyLoopsDir;
    this.topicsDir = topicsDir;
    this.preferencesFile = preferencesFile;
    this.ensureLoopsDir();
    this.ensureTopicsDir();
    this.loadPreferencesFromFile();
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
   * Ensure the topics directory exists
   */
  private ensureTopicsDir(): void {
    if (!existsSync(this.topicsDir)) {
      mkdirSync(this.topicsDir, { recursive: true });
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
  load(): { config: SystemConfig; agents: Agent[]; migratedAgents: string[] } | null {
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
      this.save({ config: backupResult.config, agents: backupResult.agents });
      return backupResult;
    }

    console.warn('No valid state file found');
    return null;
  }

  /**
   * Load and parse a specific file
   */
  private loadFile(filePath: string): { config: SystemConfig; agents: Agent[]; migratedAgents: string[] } | null {
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

    // Optional telegramChatId must be number if present
    if (a.telegramChatId !== undefined && typeof a.telegramChatId !== 'number') {
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
   * Serialize a topic for JSON storage (convert Dates to ISO strings)
   */
  serializeTopic(topic: AgentTopic): SerializedAgentTopic {
    return {
      id: topic.id,
      agentId: topic.agentId,
      telegramTopicId: topic.telegramTopicId,
      type: topic.type,
      name: topic.name,
      emoji: topic.emoji,
      sessionId: topic.sessionId,
      loopId: topic.loopId,
      workspace: topic.workspace,
      status: topic.status,
      messageCount: topic.messageCount ?? 0,
      createdAt: topic.createdAt.toISOString(),
      lastActivity: topic.lastActivity.toISOString(),
    };
  }

  /**
   * Deserialize a topic from JSON (convert ISO strings to Dates)
   */
  deserializeTopic(data: SerializedAgentTopic): AgentTopic {
    return {
      id: data.id,
      agentId: data.agentId,
      telegramTopicId: data.telegramTopicId,
      type: data.type,
      name: data.name,
      emoji: data.emoji,
      sessionId: data.sessionId,
      loopId: data.loopId,
      workspace: data.workspace,
      status: data.status,
      messageCount: data.messageCount ?? 0,
      createdAt: new Date(data.createdAt),
      lastActivity: new Date(data.lastActivity),
    };
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
        telegramChatId: agent.telegramChatId,
        mainSessionId: agent.mainSessionId,
        topics: agent.topics.map(topic => this.serializeTopic(topic)),
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
   * Handles migration from sessionId to mainSessionId
   */
  private deserialize(data: SerializedAgentsState): { config: SystemConfig; agents: Agent[]; migratedAgents: string[] } {
    const migratedAgents: string[] = [];

    return {
      config: data.config,
      agents: data.agents.map((agent): Agent => {
        // Migration: sessionId → mainSessionId
        let mainSessionId = agent.mainSessionId;
        if (!mainSessionId && agent.sessionId) {
          // Agent has old sessionId field but no mainSessionId
          // Mark for migration (session will be recreated at runtime)
          migratedAgents.push(agent.id);
          console.log(`[Migration] Agent ${agent.id} (${agent.name}): sessionId → mainSessionId migration needed`);
        }

        return {
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
          telegramChatId: agent.telegramChatId,
          mainSessionId,
          // Backward compatibility: default to empty array for old agents without topics
          topics: (agent.topics || []).map(topic => this.deserializeTopic(topic)),
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
        };
      }),
      migratedAgents,
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
   * Migration result from sessionId to mainSessionId
   */
  migrateAgentsToMainSession(agents: Agent[]): { migratedCount: number; agents: Agent[] } {
    let migratedCount = 0;

    console.log('[Migration] Checking agents for sessionId → mainSessionId migration...');

    const migratedAgents = agents.map(agent => {
      // Check if agent needs migration (this is detected during deserialization)
      // The agent will need a fresh session at runtime
      if (!agent.mainSessionId && agent.topics.length === 0) {
        // Agent was using old sessionId-based system
        // Initialize empty topics array (already done in deserialize)
        // mainSessionId will be created fresh when agent is first used
        console.log(`[Migration] Agent "${agent.name}" (${agent.id}): ready for fresh mainSessionId`);
        migratedCount++;
      }

      return agent;
    });

    if (migratedCount > 0) {
      console.log(`[Migration] ${migratedCount} agent(s) need fresh sessions (mainSessionId will be created on first use)`);
    } else {
      console.log('[Migration] No agents need migration');
    }

    return { migratedCount, agents: migratedAgents };
  }

  /**
   * Perform full migration at startup
   * - Loads state
   * - Migrates sessionId → mainSessionId
   * - Saves migrated state
   * Returns the loaded and migrated state, or null if no state file exists
   */
  loadAndMigrate(): { config: SystemConfig; agents: Agent[] } | null {
    const loaded = this.load();

    if (!loaded) {
      return null;
    }

    const { config, agents, migratedAgents } = loaded;

    if (migratedAgents.length > 0) {
      console.log(`[Migration] Found ${migratedAgents.length} agent(s) with old sessionId format`);
      console.log('[Migration] Old sessions will be replaced with fresh mainSessionId on first use');

      // Save the migrated state (without old sessionId references)
      this.save({ config, agents });
      console.log('[Migration] Saved migrated state');
    }

    return { config, agents };
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
   * Get the path to the legacy loops directory (data/loops)
   */
  getLegacyLoopsDir(): string {
    return this.legacyLoopsDir;
  }

  /**
   * Get the file path for a specific loop
   */
  private getLoopFilePath(loopId: string): string {
    return join(this.loopsDir, `${loopId}.json`);
  }

  /**
   * Get the file path for a legacy loop
   */
  private getLegacyLoopFilePath(loopId: string): string {
    return join(this.legacyLoopsDir, `${loopId}.json`);
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
   * List all loop IDs in the legacy loops directory (data/loops)
   */
  listLegacyLoops(): string[] {
    if (!existsSync(this.legacyLoopsDir)) {
      return [];
    }

    try {
      const files = readdirSync(this.legacyLoopsDir);
      return files
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', ''));
    } catch (err) {
      console.error('Failed to list legacy loops:', err);
      return [];
    }
  }

  /**
   * Load a legacy loop state from disk (data/loops directory)
   * Returns null if file doesn't exist or is invalid
   */
  loadLegacyLoop(loopId: string): RalphLoopState | null {
    const filePath = this.getLegacyLoopFilePath(loopId);

    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content) as SerializedRalphLoopState;

      if (!this.validateLoopSchema(data)) {
        console.error(`Invalid legacy loop schema in ${filePath}`);
        return null;
      }

      return this.deserializeLoop(data);
    } catch (err) {
      console.error(`Failed to load legacy loop ${loopId}:`, err);
      return null;
    }
  }

  /**
   * Load all legacy loops from data/loops directory
   */
  loadAllLegacyLoops(): RalphLoopState[] {
    const loopIds = this.listLegacyLoops();
    const loops: RalphLoopState[] = [];

    for (const loopId of loopIds) {
      const loop = this.loadLegacyLoop(loopId);
      if (loop) {
        loops.push(loop);
      }
    }

    return loops;
  }

  /**
   * Migrate legacy loops from data/loops to the new loops directory (~/.claude-terminal/loops)
   * Associates loops with topics via threadId.
   * Marks loops as 'interrupted' if their topic is missing/closed.
   *
   * @param getTopicByThreadId - Function to lookup topic by agentId and threadId
   * @returns Object with migrated count and interrupted count
   */
  migrateLegacyLoops(
    getTopicByThreadId: (agentId: string, threadId: number) => { status: string } | undefined
  ): { migratedCount: number; interruptedCount: number } {
    const legacyLoops = this.loadAllLegacyLoops();

    if (legacyLoops.length === 0) {
      return { migratedCount: 0, interruptedCount: 0 };
    }

    console.log(`[migration] Encontrados ${legacyLoops.length} loops legados em ${this.legacyLoopsDir}`);

    let migratedCount = 0;
    let interruptedCount = 0;
    const existingLoopIds = new Set(this.listLoops());

    for (const loop of legacyLoops) {
      // Skip if already migrated (exists in new directory)
      if (existingLoopIds.has(loop.id)) {
        console.log(`[migration] Loop ${loop.id} já migrado, pulando`);
        continue;
      }

      // Check if loop needs to be marked as interrupted
      let shouldInterrupt = false;

      // Only check topic for loops with threadId
      if (loop.threadId) {
        const topic = getTopicByThreadId(loop.agentId, loop.threadId);

        if (!topic) {
          // Topic not found - mark as interrupted
          shouldInterrupt = true;
          console.log(`[migration] Loop ${loop.id}: tópico não encontrado, marcando como interrompido`);
        } else if (topic.status === 'closed') {
          // Topic closed - mark as interrupted
          shouldInterrupt = true;
          console.log(`[migration] Loop ${loop.id}: tópico fechado, marcando como interrompido`);
        }
      }

      // For loops that were running/paused, check if they should be interrupted
      if (shouldInterrupt && ['running', 'paused'].includes(loop.status)) {
        loop.status = 'interrupted';
        interruptedCount++;
      }

      // Save to new directory
      this.saveLoop(loop);
      migratedCount++;
      console.log(`[migration] Loop ${loop.id} migrado com status: ${loop.status}`);
    }

    if (migratedCount > 0) {
      console.log(`[migration] ✅ Migrados ${migratedCount} agentes`);
    }

    return { migratedCount, interruptedCount };
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
      threadId: loop.threadId,
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
      threadId: data.threadId,
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

  // ============================================
  // User Preferences
  // ============================================

  /**
   * Load user preferences from file into memory
   */
  private loadPreferencesFromFile(): void {
    try {
      if (!existsSync(this.preferencesFile)) return;
      const content = readFileSync(this.preferencesFile, 'utf-8');
      const data = JSON.parse(content) as SerializedUserPreferences[];
      for (const prefs of data) {
        this.preferences.set(prefs.userId, prefs);
      }
    } catch (error) {
      console.error('Failed to load user preferences:', error);
    }
  }

  /**
   * Save all user preferences to file
   */
  private savePreferencesToFile(): void {
    const data = Array.from(this.preferences.values());
    Bun.write(this.preferencesFile, JSON.stringify(data, null, 2));
  }

  /**
   * Save user preferences
   */
  saveUserPreferences(prefs: UserPreferences): void {
    this.preferences.set(prefs.userId, prefs);
    this.savePreferencesToFile();
  }

  /**
   * Load user preferences for a specific user
   */
  loadUserPreferences(userId: string): UserPreferences | undefined {
    return this.preferences.get(userId);
  }

  /**
   * Get all user preferences
   */
  getAllUserPreferences(): UserPreferences[] {
    return Array.from(this.preferences.values());
  }

  /**
   * Get the path to the preferences file
   */
  getPreferencesFilePath(): string {
    return this.preferencesFile;
  }

  /**
   * Add a workspace to the user's recent workspaces list.
   * Deduplicates and keeps only the last 5 entries (most recent first).
   */
  addRecentWorkspace(userId: string, workspace: string): void {
    const prefs = this.loadUserPreferences(userId);
    if (!prefs) return;

    let recent = prefs.recentWorkspaces || [];

    // Remove duplicates
    recent = recent.filter(w => w !== workspace);

    // Add to front
    recent.unshift(workspace);

    // Keep only last 5
    recent = recent.slice(0, 5);

    prefs.recentWorkspaces = recent;
    this.saveUserPreferences(prefs);
  }

  /**
   * Get recent workspaces for a user
   */
  getRecentWorkspaces(userId: string): string[] {
    const prefs = this.loadUserPreferences(userId);
    return prefs?.recentWorkspaces || [];
  }

  // ============================================
  // Agent Topics Persistence
  // ============================================

  /**
   * Get the file path for a specific agent's topics
   */
  private getTopicsFilePath(agentId: string): string {
    return join(this.topicsDir, `${agentId}.json`);
  }

  /**
   * Get the path to the topics directory
   */
  getTopicsDir(): string {
    return this.topicsDir;
  }

  /**
   * Save topics for an agent to disk
   */
  saveTopics(agentId: string, mainSessionId: string | undefined, topics: AgentTopic[]): void {
    this.ensureTopicsDir();
    const serialized: SerializedAgentTopicsFile = {
      agentId,
      mainSessionId,
      topics: topics.map(topic => this.serializeTopic(topic)),
    };
    const json = JSON.stringify(serialized, null, 2);
    const filePath = this.getTopicsFilePath(agentId);
    Bun.write(filePath, json);
  }

  /**
   * Load topics for an agent from disk
   * Returns null if file doesn't exist or is invalid
   */
  loadTopics(agentId: string): AgentTopicsFile | null {
    const filePath = this.getTopicsFilePath(agentId);

    if (!existsSync(filePath)) {
      return null;
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      const data = JSON.parse(content) as SerializedAgentTopicsFile;

      if (!this.validateTopicsFileSchema(data)) {
        console.error(`Invalid topics schema in ${filePath}`);
        return null;
      }

      return {
        agentId: data.agentId,
        mainSessionId: data.mainSessionId,
        topics: data.topics.map(topic => this.deserializeTopic(topic)),
      };
    } catch (err) {
      console.error(`Failed to load topics for agent ${agentId}:`, err);
      return null;
    }
  }

  /**
   * Delete topics file for an agent
   */
  deleteTopicsFile(agentId: string): boolean {
    const filePath = this.getTopicsFilePath(agentId);

    if (!existsSync(filePath)) {
      return false;
    }

    try {
      unlinkSync(filePath);
      return true;
    } catch (err) {
      console.error(`Failed to delete topics file for agent ${agentId}:`, err);
      return false;
    }
  }

  /**
   * List all agent IDs with topics files
   */
  listTopicsFiles(): string[] {
    if (!existsSync(this.topicsDir)) {
      return [];
    }

    try {
      const files = readdirSync(this.topicsDir);
      return files
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', ''));
    } catch (err) {
      console.error('Failed to list topics files:', err);
      return [];
    }
  }

  /**
   * Load all topics files from disk
   */
  loadAllTopics(): AgentTopicsFile[] {
    const agentIds = this.listTopicsFiles();
    const topicsFiles: AgentTopicsFile[] = [];

    for (const agentId of agentIds) {
      const topics = this.loadTopics(agentId);
      if (topics) {
        topicsFiles.push(topics);
      }
    }

    return topicsFiles;
  }

  /**
   * Clean up orphaned topics files (agents that no longer exist)
   * Returns the number of files deleted
   */
  cleanupOrphanedTopics(existingAgentIds: string[]): number {
    const topicsFiles = this.listTopicsFiles();
    let deletedCount = 0;
    const agentIdSet = new Set(existingAgentIds);

    for (const agentId of topicsFiles) {
      if (!agentIdSet.has(agentId)) {
        if (this.deleteTopicsFile(agentId)) {
          deletedCount++;
          console.log(`Deleted orphaned topics file for agent ${agentId}`);
        }
      }
    }

    return deletedCount;
  }

  /**
   * Validate topics file schema
   */
  private validateTopicsFileSchema(data: unknown): data is SerializedAgentTopicsFile {
    if (!data || typeof data !== 'object') {
      return false;
    }

    const file = data as Partial<SerializedAgentTopicsFile>;

    // Required agentId
    if (typeof file.agentId !== 'string') {
      return false;
    }

    // Optional mainSessionId must be string if present
    if (file.mainSessionId !== undefined && typeof file.mainSessionId !== 'string') {
      return false;
    }

    // Topics must be array
    if (!Array.isArray(file.topics)) {
      return false;
    }

    // Validate each topic
    for (const topic of file.topics) {
      if (!this.validateTopicSchema(topic)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Validate a single topic object
   */
  private validateTopicSchema(topic: unknown): topic is SerializedAgentTopic {
    if (!topic || typeof topic !== 'object') {
      return false;
    }

    const t = topic as Partial<SerializedAgentTopic>;

    // Required string fields
    const requiredStrings = ['id', 'agentId', 'name', 'emoji', 'status', 'createdAt', 'lastActivity'];
    for (const field of requiredStrings) {
      if (typeof (t as Record<string, unknown>)[field] !== 'string') {
        return false;
      }
    }

    // Required number field
    if (typeof t.telegramTopicId !== 'number') {
      return false;
    }

    // Type must be valid
    const validTypes: TopicType[] = ['general', 'ralph', 'worktree', 'session'];
    if (!validTypes.includes(t.type as TopicType)) {
      return false;
    }

    // Status must be valid
    const validStatuses: TopicStatus[] = ['active', 'closed'];
    if (!validStatuses.includes(t.status as TopicStatus)) {
      return false;
    }

    return true;
  }

  /**
   * Get topics for a specific agent by loading from disk
   */
  getTopicsForAgent(agentId: string): AgentTopic[] {
    const topicsFile = this.loadTopics(agentId);
    return topicsFile?.topics || [];
  }

  /**
   * Get active topics (not closed) for an agent
   */
  getActiveTopicsForAgent(agentId: string): AgentTopic[] {
    return this.getTopicsForAgent(agentId).filter(topic => topic.status === 'active');
  }
}
