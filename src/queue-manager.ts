import { Semaphore } from './semaphore';
import { AgentManager } from './agent-manager';
import { ClaudeTerminal, type ClaudeResponse } from './terminal';
import type { QueueTask, Output } from './types';
import { PRIORITY_VALUES, DEFAULTS } from './types';

/**
 * Type for WhatsApp send function
 */
export type SendWhatsAppFn = (to: string, text: string) => Promise<void>;

/**
 * Type for WhatsApp image send function
 */
export type SendWhatsAppImageFn = (to: string, imageUrl: string, caption?: string) => Promise<void>;

/**
 * Type for WhatsApp media send function (generic for images, documents, audio, video)
 */
export type SendWhatsAppMediaFn = (
  to: string,
  mediaId: string,
  mediaType: 'image' | 'video' | 'audio' | 'document',
  filename?: string,
  caption?: string
) => Promise<void>;

/**
 * Type for WhatsApp error with actions function
 */
export type SendErrorWithActionsFn = (to: string, agentName: string, error: string) => Promise<void>;

/**
 * Result of task processing
 */
export interface ProcessingResult {
  taskId: string;
  agentId: string;
  success: boolean;
  response?: ClaudeResponse;
  error?: Error;
}

/**
 * Queue status information
 */
export interface QueueStatus {
  active: number;
  queued: number;
}

/**
 * PriorityQueue implementation using sorted array
 * Ordered by: priority (ascending) then timestamp (FIFO)
 */
class PriorityQueue {
  private items: QueueTask[] = [];

  /**
   * Add a task to the queue, maintaining sort order
   */
  enqueue(task: QueueTask): void {
    // Find insertion point to maintain order
    let insertIndex = this.items.length;
    for (let i = 0; i < this.items.length; i++) {
      if (this.shouldInsertBefore(task, this.items[i])) {
        insertIndex = i;
        break;
      }
    }
    this.items.splice(insertIndex, 0, task);
  }

  /**
   * Remove and return the highest priority task
   */
  dequeue(): QueueTask | undefined {
    return this.items.shift();
  }

  /**
   * Peek at the highest priority task without removing
   */
  peek(): QueueTask | undefined {
    return this.items[0];
  }

  /**
   * Get the number of tasks in the queue
   */
  size(): number {
    return this.items.length;
  }

  /**
   * Check if queue is empty
   */
  isEmpty(): boolean {
    return this.items.length === 0;
  }

  /**
   * Get all tasks (for debugging/testing)
   */
  getAll(): QueueTask[] {
    return [...this.items];
  }

  /**
   * Determine if task A should be inserted before task B
   * Higher priority (lower number) comes first
   * Within same priority, earlier timestamp (FIFO) comes first
   */
  private shouldInsertBefore(a: QueueTask, b: QueueTask): boolean {
    if (a.priority !== b.priority) {
      return a.priority < b.priority;
    }
    return a.timestamp.getTime() < b.timestamp.getTime();
  }
}

/**
 * QueueManager handles task queuing and processing with concurrency control
 *
 * Features:
 * - Priority-based queue ordering (high=0, medium=1, low=2)
 * - FIFO within same priority level
 * - Semaphore-based concurrency limiting
 * - Automatic status updates via AgentManager
 * - User notifications when tasks start processing
 * - Error handling with guaranteed permit release
 * - Recursive processNext() for continuous queue processing
 */
export class QueueManager {
  private readonly queue: PriorityQueue;
  private readonly semaphore: Semaphore;
  private readonly agentManager: AgentManager;
  private readonly terminal: ClaudeTerminal;
  private readonly sendWhatsApp: SendWhatsAppFn;
  private readonly sendWhatsAppImage?: SendWhatsAppImageFn;
  private readonly sendWhatsAppMedia?: SendWhatsAppMediaFn;
  private readonly sendErrorWithActions?: SendErrorWithActionsFn;
  private activeCount: number = 0;

  // Store last errors for retry functionality
  private lastErrors = new Map<string, { agentId: string; prompt: string; model: 'haiku' | 'opus' }>();

  constructor(
    semaphore: Semaphore,
    agentManager: AgentManager,
    terminal: ClaudeTerminal,
    sendWhatsApp: SendWhatsAppFn,
    sendWhatsAppImage?: SendWhatsAppImageFn,
    sendErrorWithActions?: SendErrorWithActionsFn,
    sendWhatsAppMedia?: SendWhatsAppMediaFn
  ) {
    this.queue = new PriorityQueue();
    this.semaphore = semaphore;
    this.agentManager = agentManager;
    this.terminal = terminal;
    this.sendWhatsApp = sendWhatsApp;
    this.sendWhatsAppImage = sendWhatsAppImage;
    this.sendErrorWithActions = sendErrorWithActions;
    this.sendWhatsAppMedia = sendWhatsAppMedia;
  }

  /**
   * Enqueue a task for processing
   * Task priority is derived from the agent's priority
   */
  enqueue(task: Omit<QueueTask, 'id' | 'priority' | 'timestamp'>): QueueTask {
    const agent = this.agentManager.getAgent(task.agentId);
    if (!agent) {
      throw new Error(`Agent not found: ${task.agentId}`);
    }

    const fullTask: QueueTask = {
      ...task,
      id: crypto.randomUUID(),
      priority: PRIORITY_VALUES[agent.priority],
      timestamp: new Date(),
    };

    this.queue.enqueue(fullTask);

    // Try to process immediately
    this.processNext();

    return fullTask;
  }

  /**
   * Process the next task in the queue if a permit is available
   * This method is non-blocking - it returns immediately if no permit is available
   */
  async processNext(): Promise<void> {
    // Check if there are tasks to process
    if (this.queue.isEmpty()) {
      return;
    }

    // Try to acquire a permit (non-blocking check)
    if (this.semaphore.availablePermits() === 0) {
      return;
    }

    // Acquire permit and process
    await this.semaphore.acquire();
    this.activeCount++;

    const task = this.queue.dequeue();
    if (!task) {
      // Queue became empty between check and dequeue
      this.activeCount--;
      this.semaphore.release();
      return;
    }

    // Process asynchronously, then recursively call processNext
    this.processTask(task)
      .catch((error) => {
        console.error(`Error processing task ${task.id}:`, error);
      })
      .finally(() => {
        this.activeCount--;
        this.semaphore.release();
        // Recursively process next task
        this.processNext();
      });
  }

  /**
   * Get current queue status
   */
  getQueueStatus(): QueueStatus {
    return {
      active: this.activeCount,
      queued: this.queue.size(),
    };
  }

  /**
   * Get pending tasks (for debugging/testing)
   */
  getPendingTasks(): QueueTask[] {
    return this.queue.getAll();
  }

  /**
   * Process a single task
   */
  private async processTask(task: QueueTask): Promise<ProcessingResult> {
    const { agentId, prompt, model, userId } = task;

    try {
      // Get agent info for notification
      const agent = this.agentManager.getAgent(agentId);
      if (!agent) {
        throw new Error(`Agent not found: ${agentId}`);
      }

      // Update agent status to processing
      const truncatedPrompt = this.truncatePrompt(prompt, 30);
      this.agentManager.updateAgentStatus(
        agentId,
        'processing',
        `processando - ${truncatedPrompt}...`
      );

      // Notify user that task is starting
      await this.notifyTaskStart(userId, agent.name, model, prompt);

      // Execute the prompt via ClaudeTerminal (with agentId and workspace)
      const response = await this.terminal.send(prompt, model, userId, agentId, agent.workspace);

      // Send images first (if any) - these are screenshots captured from tool_result
      if (response.images.length > 0 && this.sendWhatsAppImage) {
        for (const imageUrl of response.images) {
          try {
            await this.sendWhatsAppImage(userId, imageUrl);
            console.log(`[image] Sent to user`);
          } catch (err) {
            console.error('Failed to send image:', err);
          }
        }
      }

      // Send the text response
      if (response.text) {
        await this.sendWhatsApp(userId, response.text);
      }

      // Send created files (documents, spreadsheets, etc.)
      if (response.files && response.files.length > 0 && this.sendWhatsAppMedia) {
        for (const file of response.files) {
          try {
            await this.sendWhatsAppMedia(
              userId,
              file.mediaId,
              file.mediaType,
              file.filename,
              `📎 ${file.filename}`
            );
            console.log(`[file] Sent ${file.filename} to user`);
          } catch (err) {
            console.error(`Failed to send file ${file.filename}:`, err);
          }
        }
      }

      // Create output record
      // Note: summary is left empty to let AgentManager generate it from response text
      const output: Output = {
        id: crypto.randomUUID(),
        summary: '',
        prompt,
        response: response.text,
        model,
        status: 'success',
        timestamp: new Date(),
      };

      // Add output to agent (this increments messageCount)
      this.agentManager.addOutput(agentId, output);

      // Re-fetch agent to get updated messageCount after addOutput
      const updatedAgent = this.agentManager.getAgent(agentId);
      const messageCount = updatedAgent?.messageCount ?? 0;

      // Update title if this is the first message (messageCount === 1 after increment)
      // or every TITLE_UPDATE_INTERVAL messages
      if (response.title && (messageCount === 1 || messageCount % DEFAULTS.TITLE_UPDATE_INTERVAL === 0)) {
        this.agentManager.updateAgentTitle(agentId, response.title);
      }

      // Update agent status back to idle
      this.agentManager.updateAgentStatus(agentId, 'idle', 'Aguardando prompt');

      return {
        taskId: task.id,
        agentId,
        success: true,
        response,
      };
    } catch (error) {
      // Handle error
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Task ${task.id} failed:`, error);

      // Update agent status to error
      this.agentManager.updateAgentStatus(
        agentId,
        'error',
        `erro - ${this.truncatePrompt(errorMessage, 50)}`
      );

      // Notify user of error (with recovery buttons)
      await this.notifyTaskError(userId, agentId, errorMessage, prompt, model);

      return {
        taskId: task.id,
        agentId,
        success: false,
        error: error instanceof Error ? error : new Error(errorMessage),
      };
    }
  }

  /**
   * Notify user when a task starts processing
   */
  private async notifyTaskStart(
    userId: string,
    agentName: string,
    model: string,
    prompt: string
  ): Promise<void> {
    const truncatedPrompt = this.truncatePrompt(prompt, 30);
    const message = `🔔 Agente ${agentName} iniciou seu prompt: '${truncatedPrompt}...' (${model})`;

    try {
      await this.sendWhatsApp(userId, message);
    } catch (error) {
      console.error('Failed to send start notification:', error);
    }
  }

  /**
   * Notify user when a task fails (with recovery buttons)
   */
  private async notifyTaskError(
    userId: string,
    agentId: string,
    errorMessage: string,
    prompt: string,
    model: 'haiku' | 'opus'
  ): Promise<void> {
    const agent = this.agentManager.getAgent(agentId);
    const agentName = agent?.name || 'Unknown';

    // Store error context for retry functionality
    this.lastErrors.set(userId, { agentId, prompt, model });

    // Try to send error with action buttons (Flow 11: Error Recovery)
    if (this.sendErrorWithActions) {
      try {
        await this.sendErrorWithActions(userId, agentName, errorMessage);
        return;
      } catch (error) {
        console.error('Failed to send error with actions, falling back to plain text:', error);
      }
    }

    // Fallback to plain text message
    const message = `❌ Erro no agente ${agentName}: ${this.truncatePrompt(errorMessage, 100)}`;
    try {
      await this.sendWhatsApp(userId, message);
    } catch (error) {
      console.error('Failed to send error notification:', error);
    }
  }

  /**
   * Get last error for a user (used for retry functionality)
   */
  getLastError(userId: string): { agentId: string; prompt: string; model: 'haiku' | 'opus' } | undefined {
    return this.lastErrors.get(userId);
  }

  /**
   * Clear last error for a user
   */
  clearLastError(userId: string): void {
    this.lastErrors.delete(userId);
  }

  /**
   * Truncate a string to a maximum length
   */
  private truncatePrompt(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength);
  }
}
