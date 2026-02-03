import { existsSync } from 'fs';
import { PersistenceService } from './persistence';
import type { Agent, AgentType, Output, OutputType, SystemConfig } from './types';
import { DEFAULTS, PRIORITY_VALUES } from './types';

/**
 * Validation error for agent operations
 */
export class AgentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentValidationError';
  }
}

/**
 * AgentManager handles CRUD operations and lifecycle management for agents
 *
 * Features:
 * - Create, delete, get, list agents
 * - Metadata management (status, title, priority)
 * - Output management with FIFO (max 10)
 * - Sorted listing by priority and activity
 * - Validation for names, workspaces, and limits
 * - Auto-persistence after critical operations
 */
export class AgentManager {
  private agents: Map<string, Agent> = new Map();
  private agentsByUser: Map<string, Set<string>> = new Map();
  private config: SystemConfig;
  private readonly persistenceService: PersistenceService;

  static readonly MAX_AGENTS_PER_USER = 50;
  static readonly MAX_NAME_LENGTH = 50;
  static readonly MAX_OUTPUTS = DEFAULTS.MAX_OUTPUTS_PER_AGENT;

  constructor(persistenceService: PersistenceService) {
    this.persistenceService = persistenceService;
    this.config = {
      maxConcurrent: DEFAULTS.MAX_CONCURRENT,
      version: DEFAULTS.SCHEMA_VERSION,
    };

    // Load existing state
    const state = persistenceService.load();
    if (state) {
      this.config = state.config;
      for (const agent of state.agents) {
        this.agents.set(agent.id, agent);
        // Rebuild agentsByUser from the persisted userId field
        this.trackAgentForUser(agent.userId, agent.id);
      }
    }
  }

  /**
   * Create a new agent
   * @throws AgentValidationError if validation fails
   */
  createAgent(userId: string, name: string, workspace?: string, emoji?: string, type: AgentType = 'claude'): Agent {
    // Validate name
    this.validateName(name);

    // Validate workspace if provided
    if (workspace) {
      this.validateWorkspace(workspace);
    }

    // Check user agent limit
    const userAgents = this.agentsByUser.get(userId) || new Set();
    if (userAgents.size >= AgentManager.MAX_AGENTS_PER_USER) {
      throw new AgentValidationError(
        `Maximum agents limit reached (${AgentManager.MAX_AGENTS_PER_USER})`
      );
    }

    const now = new Date();
    const agent: Agent = {
      id: crypto.randomUUID(),
      userId,
      name: name.trim(),
      type,
      mode: 'conversational',
      emoji,
      workspace,
      title: '',
      status: 'idle',
      statusDetails: type === 'bash' ? 'Terminal pronto' : 'Aguardando prompt',
      priority: 'medium',
      lastActivity: now,
      messageCount: 0,
      outputs: [],
      createdAt: now,
    };

    this.agents.set(agent.id, agent);
    this.trackAgentForUser(userId, agent.id);

    this.persist();
    return agent;
  }

  /**
   * Delete an agent
   * @throws AgentValidationError if agent has an active Ralph loop (must pause first)
   */
  deleteAgent(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return false;
    }

    // Prevent deleting agents with active Ralph loops (must pause/cancel first)
    if (agent.mode === 'ralph' && agent.currentLoopId) {
      if (agent.status === 'ralph-loop') {
        throw new AgentValidationError(
          `Cannot delete agent with active Ralph loop. Pause or cancel the loop first.`
        );
      }
    }

    // Remove from user tracking
    for (const [userId, agentIds] of this.agentsByUser) {
      if (agentIds.has(agentId)) {
        agentIds.delete(agentId);
        if (agentIds.size === 0) {
          this.agentsByUser.delete(userId);
        }
        break;
      }
    }

    this.agents.delete(agentId);
    this.persist();
    return true;
  }

  /**
   * Get an agent by ID
   */
  getAgent(agentId: string): Agent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * List all agents for a user (unsorted)
   */
  listAgents(userId: string): Agent[] {
    const agentIds = this.agentsByUser.get(userId);
    if (!agentIds) {
      return [];
    }

    return Array.from(agentIds)
      .map(id => this.agents.get(id))
      .filter((agent): agent is Agent => agent !== undefined);
  }

  /**
   * List all agents for a user, sorted by priority and last activity
   * Priority order: high (0) → medium (1) → low (2)
   * Within same priority: most recent activity first
   */
  listAgentsSorted(userId: string): Agent[] {
    const agents = this.listAgents(userId);
    return this.sortAgents(agents);
  }

  /**
   * Update agent status
   * Supports standard statuses: 'idle', 'processing', 'error'
   * Supports Ralph statuses: 'ralph-loop', 'ralph-paused'
   */
  updateAgentStatus(agentId: string, status: Agent['status'], details: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new AgentValidationError(`Agent not found: ${agentId}`);
    }

    // Validate Ralph statuses are only used for Ralph-mode agents
    if ((status === 'ralph-loop' || status === 'ralph-paused') && agent.mode !== 'ralph') {
      throw new AgentValidationError(
        `Cannot set status '${status}' on non-Ralph agent. Promote to Ralph mode first.`
      );
    }

    agent.status = status;
    agent.statusDetails = details;
    agent.lastActivity = new Date();
    this.persist();
  }

  /**
   * Promote an agent to Ralph mode
   * Sets mode='ralph', currentLoopId, and status='ralph-paused'
   * @throws AgentValidationError if agent not found or already in Ralph mode with active loop
   */
  promoteToRalph(agentId: string, loopId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new AgentValidationError(`Agent not found: ${agentId}`);
    }

    // Check if agent already has an active loop
    if (agent.mode === 'ralph' && agent.currentLoopId && agent.status === 'ralph-loop') {
      throw new AgentValidationError(
        `Agent already has an active Ralph loop. Pause or cancel it first.`
      );
    }

    agent.mode = 'ralph';
    agent.currentLoopId = loopId;
    agent.status = 'ralph-paused';
    agent.statusDetails = 'Loop criado, aguardando execução';
    agent.lastActivity = new Date();
    this.persist();
  }

  /**
   * Demote an agent from Ralph mode to conversational
   * Clears mode, currentLoopId, and resets status to 'idle'
   * @throws AgentValidationError if agent not found or has an actively running loop
   */
  demoteToConversational(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new AgentValidationError(`Agent not found: ${agentId}`);
    }

    // Prevent demotion if loop is actively running
    if (agent.status === 'ralph-loop') {
      throw new AgentValidationError(
        `Cannot demote agent with active Ralph loop. Pause or cancel the loop first.`
      );
    }

    agent.mode = 'conversational';
    agent.currentLoopId = undefined;
    agent.status = 'idle';
    agent.statusDetails = 'Aguardando prompt';
    agent.lastActivity = new Date();
    this.persist();
  }

  /**
   * Clear loop reference from agent (used when loop completes/fails/cancels)
   */
  clearLoopReference(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new AgentValidationError(`Agent not found: ${agentId}`);
    }

    agent.currentLoopId = undefined;
    agent.lastActivity = new Date();
    this.persist();
  }

  /**
   * Check if agent has an active Ralph loop
   */
  hasActiveLoop(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return false;
    }
    return agent.mode === 'ralph' &&
           agent.currentLoopId !== undefined &&
           (agent.status === 'ralph-loop' || agent.status === 'ralph-paused');
  }

  /**
   * Check if agent is in Ralph mode
   */
  isRalphMode(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    return agent?.mode === 'ralph';
  }

  /**
   * Update agent title
   */
  updateAgentTitle(agentId: string, title: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new AgentValidationError(`Agent not found: ${agentId}`);
    }

    agent.title = title;
    agent.lastActivity = new Date();
    this.persist();
  }

  /**
   * Update agent priority
   */
  updatePriority(agentId: string, priority: Agent['priority']): void {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new AgentValidationError(`Agent not found: ${agentId}`);
    }

    if (!['high', 'medium', 'low'].includes(priority)) {
      throw new AgentValidationError(`Invalid priority: ${priority}`);
    }

    agent.priority = priority;
    agent.lastActivity = new Date();
    this.persist();
  }

  /**
   * Update agent session ID (used during migration)
   */
  updateSessionId(agentId: string, sessionId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new AgentValidationError(`Agent not found: ${agentId}`);
    }

    agent.sessionId = sessionId;
    this.persist();
  }

  /**
   * Update agent emoji
   */
  updateEmoji(agentId: string, emoji: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new AgentValidationError(`Agent not found: ${agentId}`);
    }

    agent.emoji = emoji;
    agent.lastActivity = new Date();
    this.persist();
  }

  /**
   * Add an output to an agent (FIFO, max 10)
   * Supports standard outputs and Ralph loop summary outputs (type: 'ralph-loop')
   */
  addOutput(agentId: string, output: Output): void {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new AgentValidationError(`Agent not found: ${agentId}`);
    }

    // Set default type if not provided
    if (!output.type) {
      output.type = 'standard';
    }

    // Validate ralph-loop outputs have required fields
    if (output.type === 'ralph-loop') {
      if (!output.loopId) {
        throw new AgentValidationError('Ralph loop output must have loopId');
      }
      // Generate a more descriptive summary for Ralph loop outputs
      if (!output.summary && output.iterationCount !== undefined) {
        output.summary = `Loop completado em ${output.iterationCount} iterações`;
      }
    }

    // Generate summary if not provided
    if (!output.summary && output.response) {
      output.summary = this.generateSummary(output.response);
    }

    // Add output
    agent.outputs.push(output);

    // FIFO: keep only last MAX_OUTPUTS
    if (agent.outputs.length > AgentManager.MAX_OUTPUTS) {
      agent.outputs = agent.outputs.slice(-AgentManager.MAX_OUTPUTS);
    }

    agent.messageCount++;
    agent.lastActivity = new Date();
    this.persist();
  }

  /**
   * Get outputs for an agent
   */
  getOutputs(agentId: string): Output[] {
    const agent = this.agents.get(agentId);
    if (!agent) {
      return [];
    }
    return agent.outputs;
  }

  /**
   * Get all agents (for internal use/persistence)
   */
  getAllAgents(): Agent[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get config
   */
  getConfig(): SystemConfig {
    return this.config;
  }

  /**
   * Update config
   */
  updateConfig(config: Partial<SystemConfig>): void {
    this.config = { ...this.config, ...config };
    this.persist();
  }

  /**
   * Get user ID for an agent
   */
  getUserIdForAgent(agentId: string): string | undefined {
    for (const [userId, agentIds] of this.agentsByUser) {
      if (agentIds.has(agentId)) {
        return userId;
      }
    }
    return undefined;
  }

  /**
   * Validate agent name
   */
  private validateName(name: string): void {
    if (!name || typeof name !== 'string') {
      throw new AgentValidationError('Name is required');
    }

    const trimmed = name.trim();
    if (trimmed.length === 0) {
      throw new AgentValidationError('Name cannot be empty');
    }

    if (trimmed.length > AgentManager.MAX_NAME_LENGTH) {
      throw new AgentValidationError(
        `Name exceeds maximum length (${AgentManager.MAX_NAME_LENGTH} chars)`
      );
    }

    // Check for dangerous characters (basic security)
    const dangerousPattern = /[<>{}|\\^`]/;
    if (dangerousPattern.test(trimmed)) {
      throw new AgentValidationError('Name contains invalid characters');
    }
  }

  /**
   * Validate workspace path
   */
  private validateWorkspace(workspace: string): void {
    if (!workspace || typeof workspace !== 'string') {
      throw new AgentValidationError('Workspace path is required');
    }

    if (!existsSync(workspace)) {
      throw new AgentValidationError(`Workspace path does not exist: ${workspace}`);
    }
  }

  /**
   * Sort agents by priority and last activity
   */
  private sortAgents(agents: Agent[]): Agent[] {
    return agents.sort((a, b) => {
      // First sort by priority (lower value = higher priority)
      const priorityDiff = PRIORITY_VALUES[a.priority] - PRIORITY_VALUES[b.priority];
      if (priorityDiff !== 0) {
        return priorityDiff;
      }

      // Then by last activity (more recent first)
      return b.lastActivity.getTime() - a.lastActivity.getTime();
    });
  }

  /**
   * Generate summary from response text (first 50 chars)
   */
  private generateSummary(response: string): string {
    const maxLength = 50;
    if (response.length <= maxLength) {
      return response;
    }
    return response.substring(0, maxLength) + '...';
  }

  /**
   * Track agent for a user
   */
  private trackAgentForUser(userId: string, agentId: string): void {
    if (!this.agentsByUser.has(userId)) {
      this.agentsByUser.set(userId, new Set());
    }
    this.agentsByUser.get(userId)!.add(agentId);
  }

  /**
   * Persist current state
   */
  private persist(): void {
    this.persistenceService.save({
      config: this.config,
      agents: this.getAllAgents(),
    });
  }
}
