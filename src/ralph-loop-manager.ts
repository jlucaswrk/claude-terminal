import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { Semaphore } from './semaphore';
import { AgentManager } from './agent-manager';
import { PersistenceService } from './persistence';
import { ClaudeTerminal, type Model, type ProgressCallback } from './terminal';
import type { RalphLoopState, RalphIteration, Agent } from './types';

/**
 * Promise tag regex
 * Matches <promise>COMPLETE</promise> or <promise>BLOCKED</promise> (case-insensitive, allows whitespace)
 */
const PROMISE_REGEX = /<promise>\s*(COMPLETE|BLOCKED)\s*<\/promise>/i;

/**
 * Result of a single loop iteration
 */
export interface IterationResult {
  iteration: RalphIteration;
  isComplete: boolean;
  promiseType: 'complete' | 'blocked' | null;
}

/**
 * Result of loop execution
 * Note: status can be 'completed', 'failed', 'blocked', 'paused', or 'cancelled'
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
  action: string,
  threadId?: number
) => void;

/**
 * Callback for loop completion
 */
export type LoopCompletionCallback = (
  loopId: string,
  status: RalphLoopState['status'],
  iterations: number,
  threadId?: number
) => void;

/**
 * Message queued during active Ralph loop
 */
export interface QueuedRalphMessage {
  text: string;
  timestamp: Date;
  userId: string;
}

/**
 * RalphLoopManager handles autonomous loop execution for Ralph-mode agents
 *
 * Features:
 * - Create and manage autonomous task loops
 * - Semaphore integration for concurrency control
 * - Promise detection via <promise>COMPLETE</promise> and <promise>BLOCKED</promise> tags
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

  // Completion callback
  private completionCallback?: LoopCompletionCallback;

  // Message queue for active Ralph topics (loopId -> queued messages)
  private messageQueues: Map<string, QueuedRalphMessage[]> = new Map();

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

    // Recover any loops that were running when the process crashed
    const interruptedCount = this.persistenceService.recoverInterruptedLoops();
    if (interruptedCount > 0) {
      console.log(`[ralph] Recovered ${interruptedCount} interrupted loops`);
    }

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
   * Set the completion callback for loop completion events
   */
  setCompletionCallback(callback: LoopCompletionCallback): void {
    this.completionCallback = callback;
  }

  /**
   * Enqueue a message for a running loop
   * Messages are processed in FIFO order when the loop pauses or completes
   * @returns true if message was queued, false if loop doesn't exist or isn't running
   */
  enqueueMessage(loopId: string, text: string, userId: string): boolean {
    const loop = this.getLoop(loopId);
    if (!loop || !['running', 'paused'].includes(loop.status)) {
      return false;
    }

    const queue = this.messageQueues.get(loopId) || [];
    queue.push({
      text,
      timestamp: new Date(),
      userId,
    });
    this.messageQueues.set(loopId, queue);

    console.log(`[ralph] Enqueued message for loop ${loopId}: "${text.substring(0, 50)}..."`);
    return true;
  }

  /**
   * Get all queued messages for a loop
   */
  getQueuedMessages(loopId: string): QueuedRalphMessage[] {
    return this.messageQueues.get(loopId) || [];
  }

  /**
   * Dequeue all messages for a loop (clears the queue)
   * @returns Array of queued messages
   */
  dequeueMessages(loopId: string): QueuedRalphMessage[] {
    const queue = this.messageQueues.get(loopId) || [];
    this.messageQueues.delete(loopId);
    return queue;
  }

  /**
   * Get the number of queued messages for a loop
   */
  getQueueSize(loopId: string): number {
    return (this.messageQueues.get(loopId) || []).length;
  }

  /**
   * Check if a loop has queued messages
   */
  hasQueuedMessages(loopId: string): boolean {
    return this.getQueueSize(loopId) > 0;
  }

  /**
   * Start a new autonomous loop
   * Creates loop state and returns loopId (does not execute)
   * @param agentId - Agent running this loop
   * @param task - Task description
   * @param maxIterations - Maximum iterations allowed
   * @param model - Model to use (default: sonnet)
   * @param threadId - Optional Telegram message_thread_id for topic-based loops
   */
  start(
    agentId: string,
    task: string,
    maxIterations: number,
    model: Model = 'sonnet',
    threadId?: number
  ): string {
    const agent = this.agentManager.getAgent(agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${agentId}`);
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
      threadId,
    };

    // Store in memory and persist
    this.activeLoops.set(loopId, loopState);
    this.persistenceService.saveLoop(loopState);

    // Update agent to reference this loop and set currentLoopId
    this.agentManager.promoteToRalph(agentId, loopId);

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

    if (['completed', 'failed', 'cancelled', 'blocked'].includes(loop.status)) {
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
          this.progressCallback(loopId, loop.currentIteration, loop.maxIterations, iterationResult.iteration.action, loop.threadId);
        }

        // Check for completion
        if (iterationResult.isComplete) {
          loop.status = 'completed';
          this.persistLoop(loop);
          this.agentManager.clearLoopReference(loop.agentId);
          this.updateAgentLoopState(loop.agentId, loopId, 'idle', 'Loop concluído com sucesso');

          console.log(`[ralph] Loop ${loopId} completed after ${loop.currentIteration} iterations`);

          // Notify completion
          if (this.completionCallback) {
            this.completionCallback(loopId, 'completed', loop.currentIteration, loop.threadId);
          }

          return {
            loopId,
            status: 'completed',
            iterations: loop.currentIteration,
            isComplete: true,
            isBlocked: false,
          };
        }

        // Check for blocked promise
        if (iterationResult.promiseType === 'blocked') {
          loop.status = 'blocked';
          this.persistLoop(loop);
          this.writeBlockersMd(loop, `Agent signaled BLOCKED at iteration ${loop.currentIteration}`);
          this.agentManager.clearLoopReference(loop.agentId);
          this.updateAgentLoopState(
            loop.agentId,
            loopId,
            'error',
            `Bloqueado: agente sinalizou bloqueio na iteração ${loop.currentIteration}`
          );

          console.log(`[ralph] Loop ${loopId} blocked by promise at iteration ${loop.currentIteration}`);

          // Notify completion (blocked)
          if (this.completionCallback) {
            this.completionCallback(loopId, 'blocked', loop.currentIteration, loop.threadId);
          }

          return {
            loopId,
            status: 'blocked',
            iterations: loop.currentIteration,
            isComplete: false,
            isBlocked: true,
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
        loop.status = 'blocked';
        this.persistLoop(loop);
        this.writeBlockersMd(loop, `Maximum iterations reached (${loop.maxIterations}) without task completion`);
        this.agentManager.clearLoopReference(loop.agentId);
        this.updateAgentLoopState(
          loop.agentId,
          loopId,
          'error',
          `Bloqueado: máximo de ${loop.maxIterations} iterações atingido sem conclusão`
        );

        console.log(`[ralph] Loop ${loopId} blocked after ${loop.currentIteration} iterations (max reached)`);

        // Notify completion (blocked)
        if (this.completionCallback) {
          this.completionCallback(loopId, 'blocked', loop.currentIteration, loop.threadId);
        }

        return {
          loopId,
          status: 'blocked',
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
      this.agentManager.clearLoopReference(loop.agentId);
      this.updateAgentLoopState(loop.agentId, loopId, 'error', `Erro: ${this.truncate(errorMessage, 50)}`);

      // Notify completion (failed)
      if (this.completionCallback) {
        this.completionCallback(loopId, 'failed', loop.currentIteration, loop.threadId);
      }

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

    // Clear previous session so each iteration starts fresh (isolated session per loop)
    this.terminal.clearTopicSession(loop.id);

    // Execute via ClaudeTerminal with isolated session (topicKey = loop.id)
    const response = await this.terminal.send(
      prompt,
      loop.currentModel,
      loop.userId,
      loop.agentId,
      agent.workspace,
      undefined, // No progress callback for individual iterations
      undefined, // No images
      loop.id    // topicKey: isolated session per loop
    );

    const endTime = Date.now();
    const duration = endTime - startTime;

    // Check for promise tag (COMPLETE or BLOCKED)
    const promiseType = this.checkCompletion(response.text);

    // Extract action summary from response
    const action = this.extractAction(response.text);

    const iteration: RalphIteration = {
      number: iterationNumber,
      model: loop.currentModel,
      action,
      prompt,
      response: response.text,
      completionPromiseFound: promiseType !== null,
      promiseType,
      timestamp: new Date(),
      duration,
    };

    console.log(`[ralph] Iteration ${iterationNumber} completed in ${duration}ms. Promise: ${promiseType}`);

    return {
      iteration,
      isComplete: promiseType === 'complete',
      promiseType,
    };
  }

  /**
   * Build the prompt for an iteration.
   * Every iteration includes the full task, fixed rules, stopping criteria,
   * and optionally a summary of the previous iteration.
   */
  private buildIterationPrompt(loop: RalphLoopState, iterationNumber: number): string {
    const remainingIterations = loop.maxIterations - (iterationNumber - 1);
    const parts: string[] = [];

    // --- Header ---
    parts.push(`You are operating in autonomous Ralph mode.`);
    parts.push(`Iteration ${iterationNumber} of ${loop.maxIterations} (${remainingIterations} remaining).`);
    parts.push('');

    // --- Full task (always included) ---
    parts.push('## TASK');
    parts.push(loop.task);
    parts.push('');

    // --- Previous iteration summary (when available) ---
    if (iterationNumber > 1) {
      const lastIteration = loop.iterations[loop.iterations.length - 1];
      if (lastIteration) {
        parts.push('## PREVIOUS ITERATION SUMMARY');
        parts.push(`Action: ${lastIteration.action}`);
        parts.push(`Promise: ${lastIteration.promiseType ?? 'none'}`);
        parts.push(`Duration: ${lastIteration.duration}ms`);
        parts.push('');
      }
    }

    // --- Fixed rules ---
    parts.push('## RULES');
    parts.push('1. Work autonomously — do NOT ask the user for input.');
    parts.push('2. Use all standard tools (Bash, Read, Write, Edit, Glob, Grep) as needed.');
    parts.push('3. Persist progress to files so state survives between iterations.');
    parts.push('4. Run tests after meaningful changes (`bun test` or the project\'s test command).');
    parts.push('5. Keep changes small and incremental per iteration.');
    parts.push('');

    // --- Stopping criteria ---
    parts.push('## STOPPING CRITERIA');
    parts.push('When the task is **fully done**, include exactly: <promise>COMPLETE</promise>');
    parts.push('When you **cannot make further progress** (missing info, permissions, external dependency):');
    parts.push('  1. First, write a `BLOCKERS.md` file in the current workspace with the following sections:');
    parts.push('     - **Blocker**: What is blocking progress');
    parts.push('     - **Attempts**: What you tried to resolve it');
    parts.push('     - **Relevant Logs/Errors**: Any error messages or log output');
    parts.push('     - **Next Human Step**: What the human needs to do to unblock');
    parts.push('  2. Then include exactly: <promise>BLOCKED</promise>');
    parts.push('If neither applies, keep working — the next iteration will continue from where you left off.');
    parts.push('');

    // --- Skeleton doc example ---
    parts.push('## ITERATION SKELETON');
    parts.push('Follow this structure in your response:');
    parts.push('```');
    parts.push('1. Assess current state (read files / check test results)');
    parts.push('2. Plan the next concrete step');
    parts.push('3. Execute the step (edit, write, bash)');
    parts.push('4. Verify the result (run tests, read output)');
    parts.push('5. Summarize what was done and what remains');
    parts.push('6. If done → <promise>COMPLETE</promise>');
    parts.push('   If stuck → <promise>BLOCKED</promise>');
    parts.push('```');

    return parts.join('\n');
  }

  /**
   * Check if response contains a promise tag (COMPLETE or BLOCKED)
   */
  checkCompletion(response: string): 'complete' | 'blocked' | null {
    const match = response.match(PROMISE_REGEX);
    if (!match) return null;
    return match[1].toUpperCase() === 'COMPLETE' ? 'complete' : 'blocked';
  }

  /**
   * Extract action summary from response (first meaningful line or sentence)
   */
  private extractAction(response: string): string {
    // Try to find a summary at the beginning
    const lines = response.split('\n').filter(l => l.trim().length > 0);
    if (lines.length === 0) {
      return 'Processando...';
    }

    // Find the first meaningful line (skip empty/punctuation-only lines)
    let cleaned = '';
    for (const line of lines) {
      const trimmed = line.trim()
        .replace(/^#+\s*/, '')  // Remove heading markers
        .replace(/^\*+\s*/, '') // Remove bold/italic markers
        .replace(/^-+\s*/, '')  // Remove list markers and dashes
        .replace(/^`+/, '')     // Remove code markers
        .trim();

      // Skip lines that are too short, only punctuation, or only dashes
      if (trimmed.length >= 3 && !/^[-=_.*`]+$/.test(trimmed)) {
        cleaned = trimmed;
        break;
      }
    }

    // If no meaningful text found, return default
    if (!cleaned) {
      return 'Processando...';
    }

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

    if (['completed', 'failed', 'cancelled', 'blocked'].includes(loop.status)) {
      throw new Error(`Loop ${loopId} is already terminated with status: ${loop.status}`);
    }

    // Update status
    loop.status = 'cancelled';
    this.persistLoop(loop);
    this.agentManager.clearLoopReference(loop.agentId);
    this.updateAgentLoopState(loop.agentId, loopId, 'idle', `Loop cancelado na iteração ${loop.currentIteration}`);

    // Release semaphore if we hold it
    if (this.loopsWithPermit.has(loopId)) {
      this.loopsWithPermit.delete(loopId);
      this.semaphore.release();
    }

    // Notify completion (cancelled)
    if (this.completionCallback) {
      this.completionCallback(loopId, 'cancelled', loop.currentIteration, loop.threadId);
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
   * Get active loop for an agent by threadId
   * Useful for finding the loop running in a specific topic
   */
  getLoopByThreadId(agentId: string, threadId: number): RalphLoopState | null {
    // Check in-memory loops first
    for (const loop of this.activeLoops.values()) {
      if (loop.agentId === agentId && loop.threadId === threadId && ['running', 'paused'].includes(loop.status)) {
        return loop;
      }
    }

    // Check persisted loops
    const persistedLoops = this.persistenceService.getLoopsForAgent(agentId);
    for (const loop of persistedLoops) {
      if (loop.threadId === threadId && ['running', 'paused'].includes(loop.status)) {
        this.activeLoops.set(loop.id, loop);
        return loop;
      }
    }

    return null;
  }

  /**
   * Get the active loop for an agent (if any)
   */
  getActiveLoopForAgent(agentId: string): RalphLoopState | null {
    // Check in-memory loops first
    for (const loop of this.activeLoops.values()) {
      if (loop.agentId === agentId && ['running', 'paused'].includes(loop.status)) {
        return loop;
      }
    }

    // Check persisted loops
    const persistedLoops = this.persistenceService.getLoopsForAgent(agentId);
    for (const loop of persistedLoops) {
      if (['running', 'paused'].includes(loop.status)) {
        this.activeLoops.set(loop.id, loop);
        return loop;
      }
    }

    return null;
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
   * Write BLOCKERS.md to the agent's workspace as a safeguard.
   * Called when the loop exits as blocked, in case the model forgot to create the file.
   */
  private writeBlockersMd(loop: RalphLoopState, reason: string): void {
    const agent = this.agentManager.getAgent(loop.agentId);
    const workspace = agent?.workspace;
    if (!workspace) {
      console.log(`[ralph] No workspace for agent ${loop.agentId}, skipping BLOCKERS.md`);
      return;
    }

    const blockersPath = join(workspace, 'BLOCKERS.md');

    // Don't overwrite if the model already created it during this iteration
    if (existsSync(blockersPath)) {
      console.log(`[ralph] BLOCKERS.md already exists at ${blockersPath}, skipping safeguard write`);
      return;
    }

    // Build iteration summary
    const iterationSummary = loop.iterations
      .map(it => `- Iteration ${it.number}: ${it.action} (${it.duration}ms, promise: ${it.promiseType ?? 'none'})`)
      .join('\n');

    const lastResponse = loop.iterations.length > 0
      ? loop.iterations[loop.iterations.length - 1].response
      : '(no iterations executed)';
    const truncatedResponse = lastResponse.length > 2000
      ? lastResponse.substring(0, 2000) + '\n...(truncated)'
      : lastResponse;

    const content = [
      '# BLOCKERS.md',
      '',
      `> Auto-generated safeguard by Ralph loop manager`,
      '',
      '## Blocker',
      reason,
      '',
      '## Iteration Summary',
      `Total iterations: ${loop.currentIteration}/${loop.maxIterations}`,
      iterationSummary || '(none)',
      '',
      '## Last Iteration Response',
      '```',
      truncatedResponse,
      '```',
      '',
      '## Next Human Step',
      'Review the blocker above and the last iteration response, then either:',
      '- Fix the blocking issue and restart the loop',
      '- Provide additional context or permissions',
      '- Adjust the task scope',
      '',
    ].join('\n');

    try {
      if (!existsSync(workspace)) {
        mkdirSync(workspace, { recursive: true });
      }
      writeFileSync(blockersPath, content, 'utf-8');
      console.log(`[ralph] Wrote safeguard BLOCKERS.md to ${blockersPath}`);
    } catch (err) {
      console.error(`[ralph] Failed to write BLOCKERS.md to ${blockersPath}:`, err);
    }
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

  /**
   * Validate active loops against their associated topics
   * Marks loops as 'interrupted' if their topic was deleted or closed
   *
   * @param getTopicByThreadId - Function to lookup topic by agentId and threadId
   * @returns Number of loops marked as interrupted
   */
  async validateLoopsAgainstTopics(
    getTopicByThreadId: (agentId: string, threadId: number) => { status: string } | undefined
  ): Promise<number> {
    const activeLoops = this.persistenceService.getActiveLoops();
    let interruptedCount = 0;

    console.log(`[ralph] Validando ${activeLoops.length} loops ativos contra tópicos`);

    for (const loop of activeLoops) {
      // Skip loops without threadId (not topic-based)
      if (!loop.threadId) {
        continue;
      }

      // Get agent to verify it exists
      const agent = this.agentManager.getAgent(loop.agentId);
      if (!agent) {
        // Agent deleted - mark loop as interrupted
        const interruptedLoop: RalphLoopState = {
          ...loop,
          status: 'interrupted',
        };
        this.persistenceService.saveLoop(interruptedLoop);
        this.activeLoops.set(loop.id, interruptedLoop);
        interruptedCount++;
        console.log(`[ralph] ✓ Loop ${loop.id} marcado como interrompido (agente não encontrado)`);
        continue;
      }

      // Find topic by threadId
      const topic = getTopicByThreadId(loop.agentId, loop.threadId);

      if (!topic) {
        // Topic not found - mark loop as interrupted
        const interruptedLoop: RalphLoopState = {
          ...loop,
          status: 'interrupted',
        };
        this.persistenceService.saveLoop(interruptedLoop);
        this.activeLoops.set(loop.id, interruptedLoop);
        interruptedCount++;
        console.log(`[ralph] ✓ Loop ${loop.id} marcado como interrompido (tópico deletado)`);
      } else if (topic.status === 'closed') {
        // Topic exists but is closed - mark loop as interrupted
        const interruptedLoop: RalphLoopState = {
          ...loop,
          status: 'interrupted',
        };
        this.persistenceService.saveLoop(interruptedLoop);
        this.activeLoops.set(loop.id, interruptedLoop);
        interruptedCount++;
        console.log(`[ralph] ✓ Loop ${loop.id} marcado como interrompido (tópico fechado)`);
      }
    }

    if (interruptedCount > 0) {
      console.log(`[ralph] ✅ Recuperados ${interruptedCount} loops Ralph`);
    }

    return interruptedCount;
  }
}
