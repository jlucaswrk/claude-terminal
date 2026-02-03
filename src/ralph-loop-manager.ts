import { Semaphore } from './semaphore';
import { AgentManager } from './agent-manager';
import { PersistenceService } from './persistence';
import { ClaudeTerminal, type Model, type ProgressCallback } from './terminal';
import type { RalphLoopState, RalphIteration, Agent } from './types';

/**
 * Completion promise tag regex
 * Matches <promise>COMPLETE</promise> (case-insensitive, allows whitespace)
 */
const COMPLETION_REGEX = /<promise>\s*COMPLETE\s*<\/promise>/i;

/**
 * Result of a single loop iteration
 */
export interface IterationResult {
  iteration: RalphIteration;
  isComplete: boolean;
}

/**
 * Result of loop execution
 */
export interface LoopExecutionResult {
  loopId: string;
  status: RalphLoopState['status'];
  iterations: number;
  isComplete: boolean;
  isBlocked: boolean;
  error?: string;
}

/**
 * Callback for loop progress updates
 */
export type LoopProgressCallback = (
  loopId: string,
  iteration: number,
  maxIterations: number,
  action: string
) => void;

/**
 * RalphLoopManager handles autonomous loop execution for Ralph-mode agents
 *
 * Features:
 * - Create and manage autonomous task loops
 * - Semaphore integration for concurrency control
 * - Completion detection via <promise>COMPLETE</promise> tag
 * - Pause/resume functionality with semaphore slot management
 * - Iteration tracking and persistence
 * - Max iteration blocking (marks as "blocked" when exhausted)
 * - Integration with AgentManager for status updates
 */
export class RalphLoopManager {
  private readonly semaphore: Semaphore;
  private readonly agentManager: AgentManager;
  private readonly persistenceService: PersistenceService;
  private readonly terminal: ClaudeTerminal;

  // Active loops (loopId -> RalphLoopState)
  private activeLoops: Map<string, RalphLoopState> = new Map();

  // Track which loops currently hold a semaphore permit
  private loopsWithPermit: Set<string> = new Set();

  // Progress callback
  private progressCallback?: LoopProgressCallback;

  constructor(
    semaphore: Semaphore,
    agentManager: AgentManager,
    persistenceService: PersistenceService,
    terminal: ClaudeTerminal
  ) {
    this.semaphore = semaphore;
    this.agentManager = agentManager;
    this.persistenceService = persistenceService;
    this.terminal = terminal;

    // Load any existing active loops from persistence
    this.loadActiveLoops();
  }

  /**
   * Set the progress callback for loop updates
   */
  setProgressCallback(callback: LoopProgressCallback): void {
    this.progressCallback = callback;
  }

  /**
   * Start a new autonomous loop
   * Creates loop state and returns loopId (does not execute)
   */
  start(
    agentId: string,
    task: string,
    maxIterations: number,
    model: Model = 'sonnet'
  ): string {
    const agent = this.agentManager.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
    }

    if (agent.mode !== 'ralph') {
      throw new Error(`Agent ${agentId} is not in ralph mode`);
    }

    // Check if agent already has an active loop
    if (agent.currentLoopId) {
      const existingLoop = this.getLoop(agent.currentLoopId);
      if (existingLoop && ['running', 'paused'].includes(existingLoop.status)) {
        throw new Error(`Agent ${agentId} already has an active loop: ${agent.currentLoopId}`);
      }
    }

    const loopId = crypto.randomUUID();
    const now = new Date();

    const loopState: RalphLoopState = {
      id: loopId,
      agentId,
      userId: agent.userId,
      status: 'paused', // Start paused, execute() will set to running
      task,
      currentIteration: 0,
      maxIterations,
      iterations: [],
      currentModel: model,
      startTime: now,
    };

    // Store in memory and persist
    this.activeLoops.set(loopId, loopState);
    this.persistenceService.saveLoop(loopState);

    // Update agent to reference this loop
    this.updateAgentLoopState(agentId, loopId, 'ralph-paused', 'Loop criado, aguardando execução');

    console.log(`[ralph] Created loop ${loopId} for agent ${agent.name} with task: ${task.substring(0, 50)}...`);

    return loopId;
  }

  /**
   * Execute a loop (main loop that iterates until completion or max iterations)
   * Acquires semaphore slot at start, releases on completion/pause/error
   */
  async execute(loopId: string): Promise<LoopExecutionResult> {
    const loop = this.getLoop(loopId);
    if (!loop) {
      throw new Error(`Loop not found: ${loopId}`);
    }

    if (loop.status === 'running') {
      throw new Error(`Loop ${loopId} is already running`);
    }

    if (['completed', 'failed', 'cancelled'].includes(loop.status)) {
      throw new Error(`Loop ${loopId} has already terminated with status: ${loop.status}`);
    }

    const agent = this.agentManager.getAgent(loop.agentId);
    if (!agent) {
      throw new Error(`Agent not found for loop ${loopId}: ${loop.agentId}`);
    }

    // Acquire semaphore slot
    await this.semaphore.acquire();
    this.loopsWithPermit.add(loopId);

    try {
      // Update status to running
      loop.status = 'running';
      this.persistLoop(loop);
      this.updateAgentLoopState(loop.agentId, loopId, 'ralph-loop', `Executando loop (${loop.currentIteration}/${loop.maxIterations})`);

      console.log(`[ralph] Starting execution of loop ${loopId} for agent ${agent.name}`);

      // Main iteration loop
      while (loop.status === 'running' && loop.currentIteration < loop.maxIterations) {
        const iterationResult = await this.executeIteration(loop, agent);

        // Save iteration
        loop.iterations.push(iterationResult.iteration);
        loop.currentIteration++;
        this.persistLoop(loop);

        // Update agent status with iteration progress
        this.updateAgentLoopState(
          loop.agentId,
          loopId,
          'ralph-loop',
          `Iteração ${loop.currentIteration}/${loop.maxIterations}: ${this.truncate(iterationResult.iteration.action, 30)}`
        );

        // Notify progress
        if (this.progressCallback) {
          this.progressCallback(loopId, loop.currentIteration, loop.maxIterations, iterationResult.iteration.action);
        }

        // Check for completion
        if (iterationResult.isComplete) {
          loop.status = 'completed';
          this.persistLoop(loop);
          this.updateAgentLoopState(loop.agentId, loopId, 'idle', 'Loop concluído com sucesso');

          console.log(`[ralph] Loop ${loopId} completed after ${loop.currentIteration} iterations`);

          return {
            loopId,
            status: 'completed',
            iterations: loop.currentIteration,
            isComplete: true,
            isBlocked: false,
          };
        }

        // Check if we were paused externally
        if (loop.status === 'paused') {
          console.log(`[ralph] Loop ${loopId} was paused externally`);
          break;
        }
      }

      // Check why we exited the loop
      if (loop.status === 'paused') {
        // Paused - semaphore will be released, ready for resume
        return {
          loopId,
          status: 'paused',
          iterations: loop.currentIteration,
          isComplete: false,
          isBlocked: false,
        };
      }

      // Max iterations reached without completion - mark as blocked
      if (loop.currentIteration >= loop.maxIterations) {
        loop.status = 'failed';
        this.persistLoop(loop);
        this.updateAgentLoopState(
          loop.agentId,
          loopId,
          'error',
          `Bloqueado: máximo de ${loop.maxIterations} iterações atingido sem conclusão`
        );

        console.log(`[ralph] Loop ${loopId} blocked after ${loop.currentIteration} iterations (max reached)`);

        return {
          loopId,
          status: 'failed',
          iterations: loop.currentIteration,
          isComplete: false,
          isBlocked: true,
        };
      }

      // Should not reach here, but handle gracefully
      return {
        loopId,
        status: loop.status,
        iterations: loop.currentIteration,
        isComplete: false,
        isBlocked: false,
      };

    } catch (error) {
      // Handle execution error
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[ralph] Loop ${loopId} failed with error:`, error);

      loop.status = 'failed';
      this.persistLoop(loop);
      this.updateAgentLoopState(loop.agentId, loopId, 'error', `Erro: ${this.truncate(errorMessage, 50)}`);

      return {
        loopId,
        status: 'failed',
        iterations: loop.currentIteration,
        isComplete: false,
        isBlocked: false,
        error: errorMessage,
      };

    } finally {
      // Release semaphore if we still hold it
      if (this.loopsWithPermit.has(loopId)) {
        this.loopsWithPermit.delete(loopId);
        this.semaphore.release();
      }
    }
  }

  /**
   * Execute a single iteration of the loop
   */
  private async executeIteration(loop: RalphLoopState, agent: Agent): Promise<IterationResult> {
    const startTime = Date.now();
    const iterationNumber = loop.currentIteration + 1;

    // Build the prompt for this iteration
    const prompt = this.buildIterationPrompt(loop, iterationNumber);

    console.log(`[ralph] Executing iteration ${iterationNumber}/${loop.maxIterations} for loop ${loop.id}`);

    // Execute via ClaudeTerminal
    const response = await this.terminal.send(
      prompt,
      loop.currentModel,
      loop.userId,
      loop.agentId,
      agent.workspace,
      undefined // No progress callback for individual iterations
    );

    const endTime = Date.now();
    const duration = endTime - startTime;

    // Check for completion promise
    const completionFound = this.checkCompletion(response.text);

    // Extract action summary from response
    const action = this.extractAction(response.text);

    const iteration: RalphIteration = {
      number: iterationNumber,
      model: loop.currentModel,
      action,
      prompt,
      response: response.text,
      completionPromiseFound: completionFound,
      timestamp: new Date(),
      duration,
    };

    console.log(`[ralph] Iteration ${iterationNumber} completed in ${duration}ms. Completion: ${completionFound}`);

    return {
      iteration,
      isComplete: completionFound,
    };
  }

  /**
   * Build the prompt for an iteration
   * First iteration includes the full task, subsequent iterations continue the conversation
   */
  private buildIterationPrompt(loop: RalphLoopState, iterationNumber: number): string {
    if (iterationNumber === 1) {
      // First iteration - include full context and instructions
      return `You are operating in autonomous Ralph mode. Your task is:

${loop.task}

IMPORTANT: You must work autonomously to complete this task. When you have fully completed the task, you MUST include the exact tag <promise>COMPLETE</promise> in your response.

You have access to all standard tools (Bash, Read, Write, Edit, Glob, Grep). Use them as needed to accomplish the task.

This is iteration 1 of maximum ${loop.maxIterations}. Begin working on the task now.`;
    }

    // Subsequent iterations - continue working
    const lastIteration = loop.iterations[loop.iterations.length - 1];
    const remainingIterations = loop.maxIterations - loop.currentIteration;

    return `Continue working on the task. This is iteration ${iterationNumber} of ${loop.maxIterations} (${remainingIterations} remaining).

Your previous action: ${lastIteration?.action || 'N/A'}

Remember: When you have fully completed the task, include <promise>COMPLETE</promise> in your response.

Continue with the next step of the task.`;
  }

  /**
   * Check if response contains completion promise
   */
  checkCompletion(response: string): boolean {
    return COMPLETION_REGEX.test(response);
  }

  /**
   * Extract action summary from response (first meaningful line or sentence)
   */
  private extractAction(response: string): string {
    // Try to find a summary at the beginning
    const lines = response.split('\n').filter(l => l.trim().length > 0);
    if (lines.length === 0) {
      return 'Processou iteração';
    }

    // Use first line, truncated
    const firstLine = lines[0].trim();

    // Remove markdown formatting
    const cleaned = firstLine
      .replace(/^#+\s*/, '')  // Remove heading markers
      .replace(/^\*+\s*/, '') // Remove bold/italic markers
      .replace(/^-\s*/, '')   // Remove list markers
      .trim();

    return this.truncate(cleaned, 100);
  }

  /**
   * Pause a running loop
   * Releases semaphore slot
   */
  async pause(loopId: string): Promise<void> {
    const loop = this.getLoop(loopId);
    if (!loop) {
      throw new Error(`Loop not found: ${loopId}`);
    }

    if (loop.status !== 'running') {
      throw new Error(`Cannot pause loop ${loopId}: status is ${loop.status}`);
    }

    // Update status (the execute loop will detect this and exit)
    loop.status = 'paused';
    this.persistLoop(loop);
    this.updateAgentLoopState(loop.agentId, loopId, 'ralph-paused', `Pausado na iteração ${loop.currentIteration}/${loop.maxIterations}`);

    // Release semaphore if we hold it
    if (this.loopsWithPermit.has(loopId)) {
      this.loopsWithPermit.delete(loopId);
      this.semaphore.release();
    }

    console.log(`[ralph] Paused loop ${loopId} at iteration ${loop.currentIteration}`);
  }

  /**
   * Resume a paused loop
   * Re-acquires semaphore slot and continues execution
   */
  async resume(loopId: string): Promise<LoopExecutionResult> {
    const loop = this.getLoop(loopId);
    if (!loop) {
      throw new Error(`Loop not found: ${loopId}`);
    }

    if (loop.status !== 'paused') {
      throw new Error(`Cannot resume loop ${loopId}: status is ${loop.status}`);
    }

    console.log(`[ralph] Resuming loop ${loopId} from iteration ${loop.currentIteration}`);

    // execute() handles acquiring semaphore and running the loop
    return this.execute(loopId);
  }

  /**
   * Cancel a loop (terminates it permanently)
   */
  async cancel(loopId: string): Promise<void> {
    const loop = this.getLoop(loopId);
    if (!loop) {
      throw new Error(`Loop not found: ${loopId}`);
    }

    if (['completed', 'failed', 'cancelled'].includes(loop.status)) {
      throw new Error(`Loop ${loopId} is already terminated with status: ${loop.status}`);
    }

    // Update status
    loop.status = 'cancelled';
    this.persistLoop(loop);
    this.updateAgentLoopState(loop.agentId, loopId, 'idle', `Loop cancelado na iteração ${loop.currentIteration}`);

    // Release semaphore if we hold it
    if (this.loopsWithPermit.has(loopId)) {
      this.loopsWithPermit.delete(loopId);
      this.semaphore.release();
    }

    console.log(`[ralph] Cancelled loop ${loopId} at iteration ${loop.currentIteration}`);
  }

  /**
   * Get a loop by ID (from memory or disk)
   */
  getLoop(loopId: string): RalphLoopState | null {
    // Try memory first
    let loop = this.activeLoops.get(loopId);
    if (loop) {
      return loop;
    }

    // Try loading from disk
    loop = this.persistenceService.loadLoop(loopId) ?? undefined;
    if (loop) {
      this.activeLoops.set(loopId, loop);
    }

    return loop ?? null;
  }

  /**
   * Get all loops for an agent
   */
  getLoopsForAgent(agentId: string): RalphLoopState[] {
    return this.persistenceService.getLoopsForAgent(agentId);
  }

  /**
   * Get all active loops (running or paused)
   */
  getActiveLoops(): RalphLoopState[] {
    return this.persistenceService.getActiveLoops();
  }

  /**
   * Load active loops from persistence on startup
   */
  private loadActiveLoops(): void {
    const loops = this.persistenceService.getActiveLoops();
    for (const loop of loops) {
      this.activeLoops.set(loop.id, loop);
    }
    console.log(`[ralph] Loaded ${loops.length} active loops from persistence`);
  }

  /**
   * Persist loop state
   */
  private persistLoop(loop: RalphLoopState): void {
    this.activeLoops.set(loop.id, loop);
    this.persistenceService.saveLoop(loop);
  }

  /**
   * Update agent status and loop reference
   */
  private updateAgentLoopState(
    agentId: string,
    loopId: string,
    status: Agent['status'],
    details: string
  ): void {
    try {
      const agent = this.agentManager.getAgent(agentId);
      if (agent) {
        // Update via agent manager (which handles persistence)
        this.agentManager.updateAgentStatus(agentId, status, details);

        // Update currentLoopId if needed
        if (status === 'idle' && agent.currentLoopId === loopId) {
          // Loop is done, clear the reference
          // Note: We'd need to add a method to AgentManager for this
          // For now, the agent keeps the reference to the last loop
        }
      }
    } catch (error) {
      console.error(`[ralph] Failed to update agent status:`, error);
    }
  }

  /**
   * Truncate string to max length
   */
  private truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength - 3) + '...';
  }

  /**
   * Check if a loop is currently holding a semaphore permit
   */
  hasPermit(loopId: string): boolean {
    return this.loopsWithPermit.has(loopId);
  }

  /**
   * Get count of loops currently holding permits
   */
  getActivePermitCount(): number {
    return this.loopsWithPermit.size;
  }
}
