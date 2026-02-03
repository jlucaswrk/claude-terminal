import { Semaphore } from './semaphore';
import { AgentManager } from './agent-manager';
import { ClaudeTerminal, type ClaudeResponse, type ToolUsage } from './terminal';
import type { QueueTask, Output } from './types';
import { PRIORITY_VALUES, DEFAULTS } from './types';
import { executeCommand, formatBashResult, getFullOutputFilename } from './bash-executor';
import { uploadToKapso } from './storage';

/**
 * Tool-specific emojis for progress messages
 */
const TOOL_EMOJI: Record<string, string> = {
  Read: '📄',
  Write: '✏️',
  Edit: '📝',
  Bash: '⚙️',
  Glob: '🔍',
  Grep: '🔎',
  Task: '🤖',
  WebFetch: '🌐',
  WebSearch: '🔎',
};

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
 * Type for Telegram send function
 */
export type SendTelegramFn = (chatId: number, text: string) => Promise<void>;

/**
 * Type for Telegram image send function
 */
export type SendTelegramImageFn = (chatId: number, imageUrl: string, caption?: string) => Promise<void>;

/**
 * Platform detection result
 */
export type Platform = 'telegram' | 'whatsapp_group' | 'whatsapp_user';

/**
 * Detect platform from replyTo value
 * - typeof replyTo === 'number' → Telegram
 * - typeof replyTo === 'string' && replyTo.includes('@g.us') → WhatsApp group
 * - typeof replyTo === 'string' → WhatsApp user
 */
export function detectPlatform(replyTo: string | number | undefined, userId: string): Platform {
  if (typeof replyTo === 'number') {
    return 'telegram';
  }
  if (typeof replyTo === 'string' && replyTo.includes('@g.us')) {
    return 'whatsapp_group';
  }
  return 'whatsapp_user';
}

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
  private readonly sendTelegram?: SendTelegramFn;
  private readonly sendTelegramImage?: SendTelegramImageFn;
  private activeCount: number = 0;

  // Store last errors for retry functionality
  private lastErrors = new Map<string, { agentId: string; prompt: string; model: 'haiku' | 'sonnet' | 'opus' }>();

  constructor(
    semaphore: Semaphore,
    agentManager: AgentManager,
    terminal: ClaudeTerminal,
    sendWhatsApp: SendWhatsAppFn,
    sendWhatsAppImage?: SendWhatsAppImageFn,
    sendErrorWithActions?: SendErrorWithActionsFn,
    sendWhatsAppMedia?: SendWhatsAppMediaFn,
    sendTelegram?: SendTelegramFn,
    sendTelegramImage?: SendTelegramImageFn
  ) {
    this.queue = new PriorityQueue();
    this.semaphore = semaphore;
    this.agentManager = agentManager;
    this.terminal = terminal;
    this.sendWhatsApp = sendWhatsApp;
    this.sendWhatsAppImage = sendWhatsAppImage;
    this.sendErrorWithActions = sendErrorWithActions;
    this.sendWhatsAppMedia = sendWhatsAppMedia;
    this.sendTelegram = sendTelegram;
    this.sendTelegramImage = sendTelegramImage;
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
    const { agentId, prompt, model, userId, images, replyTo } = task;
    // Platform detection is handled by helper methods
    const targetDesc = this.getTargetDescription(replyTo);

    // Progress tracking state
    let lastToolName = '';
    let lastToolInput: Record<string, unknown> | undefined;
    let progressInterval: ReturnType<typeof setInterval> | null = null;
    const startTime = Date.now();

    try {
      // Get agent info for notification
      const agent = this.agentManager.getAgent(agentId);
      if (!agent) {
        throw new Error(`Agent not found: ${agentId}`);
      }

      // Handle bash-type agents differently
      if (agent.type === 'bash') {
        return this.processBashTask(task, agent);
      }

      // Update agent status to processing
      const truncatedPrompt = this.truncatePrompt(prompt, 30);
      this.agentManager.updateAgentStatus(
        agentId,
        'processing',
        `processando - ${truncatedPrompt}...`
      );

      // Notify user that task is starting
      await this.notifyTaskStartPlatform(replyTo, userId, agent.name, model, prompt);

      // Start progress update interval (every 30 seconds)
      progressInterval = setInterval(async () => {
        if (lastToolName) {
          const elapsed = this.formatElapsed(Date.now() - startTime);
          const toolDesc = this.describeToolAction(lastToolName, lastToolInput);
          const emoji = TOOL_EMOJI[lastToolName] || '🌐';
          const message = `${emoji} *${agent.name}*: _${toolDesc}_ (${elapsed})`;
          try {
            await this.sendResponse(replyTo, userId, message);
          } catch (err) {
            console.error('Failed to send progress update:', err);
          }
        }
      }, 30000);

      // Progress callback to track current tool
      const onProgress = (toolName: string, toolInput?: Record<string, unknown>) => {
        lastToolName = toolName;
        lastToolInput = toolInput;
      };

      // Execute the prompt via ClaudeTerminal (with agentId, workspace, progress callback, and images)
      const response = await this.terminal.send(prompt, model, userId, agentId, agent.workspace, onProgress, images);

      // Send images first (if any) - these are screenshots captured from tool_result
      if (response.images.length > 0) {
        for (const imageUrl of response.images) {
          try {
            await this.sendImageResponse(replyTo, userId, imageUrl);
            console.log(`[image] Sent to ${targetDesc}`);
          } catch (err) {
            console.error('Failed to send image:', err);
          }
        }
      }

      // Send the text response with agent header
      if (response.text) {
        const agentEmoji = agent.emoji || '🤖';
        const header = `${agentEmoji} *${agent.name}*\n───\n`;
        const formattedResponse = header + response.text;
        await this.sendResponse(replyTo, userId, formattedResponse);
      }

      // Send created files (documents, spreadsheets, etc.)
      if (response.files && response.files.length > 0) {
        for (const file of response.files) {
          try {
            await this.sendMediaResponse(
              replyTo,
              userId,
              file.mediaId,
              file.mediaType,
              file.filename,
              `📎 ${file.filename}`
            );
            console.log(`[file] Sent ${file.filename} to ${targetDesc}`);
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

      // Generate action summary from tools used
      const actionSummary = this.generateActionSummary(response.toolsUsed);

      // Update agent status back to idle with action summary
      this.agentManager.updateAgentStatus(agentId, 'idle', actionSummary);

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
      await this.notifyTaskErrorPlatform(replyTo, userId, agentId, errorMessage, prompt, model);

      return {
        taskId: task.id,
        agentId,
        success: false,
        error: error instanceof Error ? error : new Error(errorMessage),
      };
    } finally {
      // Clear progress interval
      if (progressInterval) {
        clearInterval(progressInterval);
      }
    }
  }

  /**
   * Process a bash-type agent task (direct terminal execution)
   */
  private async processBashTask(
    task: QueueTask,
    agent: { id: string; name: string; emoji?: string; workspace?: string }
  ): Promise<ProcessingResult> {
    const { agentId, prompt, userId, replyTo } = task;
    const targetDesc = this.getTargetDescription(replyTo);

    try {
      // Update agent status to processing (internal only, no WhatsApp message)
      const truncatedCmd = this.truncatePrompt(prompt, 30);
      this.agentManager.updateAgentStatus(
        agentId,
        'processing',
        `executando - ${truncatedCmd}...`
      );

      const agentEmoji = agent.emoji || '⚡';

      // Execute the command
      const result = await executeCommand(prompt, {
        cwd: agent.workspace,
      });

      // Format the result
      const formattedResult = formatBashResult(result);
      const header = `${agentEmoji} *${agent.name}*\n`;
      await this.sendResponse(replyTo, userId, header + formattedResult);

      // If output was truncated and we have media capabilities, send full output as file
      if (result.truncated && result.output) {
        try {
          const filename = getFullOutputFilename(prompt);
          const fullOutput = `$ ${prompt}\n\n${result.output}\n\nExit code: ${result.exitCode}\nDuration: ${result.duration}ms`;
          const buffer = Buffer.from(fullOutput, 'utf-8');

          const mediaId = await uploadToKapso(buffer, filename, 'text/plain');
          if (mediaId) {
            await this.sendMediaResponse(
              replyTo,
              userId,
              mediaId,
              'document',
              filename,
              '📎 Output completo'
            );
          }
        } catch (err) {
          console.error('Failed to upload full bash output:', err);
        }
      }

      // Create output record
      const output: Output = {
        id: crypto.randomUUID(),
        summary: result.blocked
          ? 'Comando bloqueado'
          : result.exitCode === 0
            ? `Executou: ${this.truncatePrompt(prompt, 30)}`
            : `Falhou: ${this.truncatePrompt(prompt, 30)}`,
        prompt,
        response: formattedResult,
        model: 'bash',
        status: result.blocked ? 'warning' : result.exitCode === 0 ? 'success' : 'error',
        timestamp: new Date(),
      };

      // Add output to agent
      this.agentManager.addOutput(agentId, output);

      // Update agent status back to idle
      const statusDetails = result.blocked
        ? 'comando bloqueado'
        : result.exitCode === 0
          ? `executou ${this.truncatePrompt(prompt, 20)}`
          : `falhou (exit ${result.exitCode})`;
      this.agentManager.updateAgentStatus(agentId, 'idle', statusDetails);

      return {
        taskId: task.id,
        agentId,
        success: !result.blocked && result.exitCode === 0,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Bash task ${task.id} failed:`, error);

      // Update agent status to error
      this.agentManager.updateAgentStatus(
        agentId,
        'error',
        `erro - ${this.truncatePrompt(errorMessage, 50)}`
      );

      // Notify user of error
      await this.sendResponse(
        replyTo,
        userId,
        `❌ *${agent.name}*: Erro ao executar comando\n${this.truncatePrompt(errorMessage, 100)}`
      );

      return {
        taskId: task.id,
        agentId,
        success: false,
        error: error instanceof Error ? error : new Error(errorMessage),
      };
    }
  }

  /**
   * Notify user when a task starts processing (legacy - string destination)
   */
  private async notifyTaskStart(
    userId: string,
    agentName: string,
    model: string,
    prompt: string
  ): Promise<void> {
    const truncatedPrompt = this.truncatePrompt(prompt, 30);
    const message = `🔔 Agente *${agentName}* iniciou seu prompt: '${truncatedPrompt}...' (${model})`;

    try {
      await this.sendWhatsApp(userId, message);
    } catch (error) {
      console.error('Failed to send start notification:', error);
    }
  }

  /**
   * Notify user when a task starts processing (platform-aware)
   */
  private async notifyTaskStartPlatform(
    replyTo: string | number | undefined,
    userId: string,
    agentName: string,
    model: string,
    prompt: string
  ): Promise<void> {
    const truncatedPrompt = this.truncatePrompt(prompt, 30);
    const message = `🔔 Agente *${agentName}* iniciou seu prompt: '${truncatedPrompt}...' (${model})`;

    try {
      await this.sendResponse(replyTo, userId, message);
    } catch (error) {
      console.error('Failed to send start notification:', error);
    }
  }

  /**
   * Notify user when a task fails (with recovery buttons) - legacy string destination
   */
  private async notifyTaskError(
    sendTo: string,
    userId: string,
    agentId: string,
    errorMessage: string,
    prompt: string,
    model: 'haiku' | 'opus' | 'sonnet'
  ): Promise<void> {
    const agent = this.agentManager.getAgent(agentId);
    const agentName = agent?.name || 'Unknown';

    // Store error context for retry functionality (always use userId for error tracking)
    this.lastErrors.set(userId, { agentId, prompt, model });

    // Try to send error with action buttons (Flow 11: Error Recovery)
    if (this.sendErrorWithActions) {
      try {
        await this.sendErrorWithActions(sendTo, agentName, errorMessage);
        return;
      } catch (error) {
        console.error('Failed to send error with actions, falling back to plain text:', error);
      }
    }

    // Fallback to plain text message
    const message = `❌ Erro no agente *${agentName}*: ${this.truncatePrompt(errorMessage, 100)}`;
    try {
      await this.sendWhatsApp(sendTo, message);
    } catch (error) {
      console.error('Failed to send error notification:', error);
    }
  }

  /**
   * Notify user when a task fails (with recovery buttons) - platform-aware
   */
  private async notifyTaskErrorPlatform(
    replyTo: string | number | undefined,
    userId: string,
    agentId: string,
    errorMessage: string,
    prompt: string,
    model: 'haiku' | 'opus' | 'sonnet'
  ): Promise<void> {
    const agent = this.agentManager.getAgent(agentId);
    const agentName = agent?.name || 'Unknown';

    // Store error context for retry functionality (always use userId for error tracking)
    this.lastErrors.set(userId, { agentId, prompt, model });

    const platform = detectPlatform(replyTo, userId);

    // For WhatsApp, try to send error with action buttons (Flow 11: Error Recovery)
    if (platform !== 'telegram' && this.sendErrorWithActions) {
      const sendTo = (typeof replyTo === 'string' ? replyTo : userId);
      try {
        await this.sendErrorWithActions(sendTo, agentName, errorMessage);
        return;
      } catch (error) {
        console.error('Failed to send error with actions, falling back to plain text:', error);
      }
    }

    // Fallback to plain text message (also used for Telegram)
    const message = `❌ Erro no agente *${agentName}*: ${this.truncatePrompt(errorMessage, 100)}`;
    try {
      await this.sendResponse(replyTo, userId, message);
    } catch (error) {
      console.error('Failed to send error notification:', error);
    }
  }

  /**
   * Get last error for a user (used for retry functionality)
   */
  getLastError(userId: string): { agentId: string; prompt: string; model: 'haiku' | 'sonnet' | 'opus' } | undefined {
    return this.lastErrors.get(userId);
  }

  /**
   * Clear last error for a user
   */
  clearLastError(userId: string): void {
    this.lastErrors.delete(userId);
  }

  /**
   * Send a message to the appropriate platform based on replyTo type
   *
   * Platform detection:
   * - typeof replyTo === 'number' → Telegram
   * - typeof replyTo === 'string' && replyTo.includes('@g.us') → WhatsApp group
   * - typeof replyTo === 'string' → WhatsApp user
   */
  private async sendResponse(
    replyTo: string | number | undefined,
    userId: string,
    text: string
  ): Promise<void> {
    const platform = detectPlatform(replyTo, userId);

    if (platform === 'telegram' && typeof replyTo === 'number') {
      if (this.sendTelegram) {
        await this.sendTelegram(replyTo, text);
      } else {
        console.warn('Telegram send function not configured, falling back to WhatsApp');
        await this.sendWhatsApp(userId, text);
      }
    } else {
      // WhatsApp (user or group)
      const sendTo = (typeof replyTo === 'string' ? replyTo : userId);
      await this.sendWhatsApp(sendTo, text);
    }
  }

  /**
   * Send an image to the appropriate platform based on replyTo type
   */
  private async sendImageResponse(
    replyTo: string | number | undefined,
    userId: string,
    imageUrl: string,
    caption?: string
  ): Promise<void> {
    const platform = detectPlatform(replyTo, userId);

    if (platform === 'telegram' && typeof replyTo === 'number') {
      if (this.sendTelegramImage) {
        await this.sendTelegramImage(replyTo, imageUrl, caption);
      } else if (this.sendWhatsAppImage) {
        console.warn('Telegram image function not configured, falling back to WhatsApp');
        await this.sendWhatsAppImage(userId, imageUrl, caption);
      }
    } else if (this.sendWhatsAppImage) {
      const sendTo = (typeof replyTo === 'string' ? replyTo : userId);
      await this.sendWhatsAppImage(sendTo, imageUrl, caption);
    }
  }

  /**
   * Send media to the appropriate platform based on replyTo type
   */
  private async sendMediaResponse(
    replyTo: string | number | undefined,
    userId: string,
    mediaId: string,
    mediaType: 'image' | 'video' | 'audio' | 'document',
    filename?: string,
    caption?: string
  ): Promise<void> {
    const platform = detectPlatform(replyTo, userId);

    if (platform === 'telegram' && typeof replyTo === 'number') {
      // For Telegram, we currently only support text - media would need additional handling
      if (this.sendTelegram) {
        await this.sendTelegram(replyTo, `📎 *${filename || 'file'}*${caption ? `\n${caption}` : ''}`);
      }
    } else if (this.sendWhatsAppMedia) {
      const sendTo = (typeof replyTo === 'string' ? replyTo : userId);
      await this.sendWhatsAppMedia(sendTo, mediaId, mediaType, filename, caption);
    }
  }

  /**
   * Get the target for logging purposes
   */
  private getTargetDescription(replyTo: string | number | undefined): string {
    const platform = detectPlatform(replyTo, '');
    switch (platform) {
      case 'telegram':
        return 'telegram';
      case 'whatsapp_group':
        return 'group';
      default:
        return 'user';
    }
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

  /**
   * Format elapsed time in human readable format
   */
  private formatElapsed(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;

    if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s`;
    }
    return `${seconds}s`;
  }

  /**
   * Describe what a tool is doing based on its name and input
   */
  private describeToolAction(toolName: string, input?: Record<string, unknown>): string {
    switch (toolName) {
      case 'Read': {
        const filePath = input?.file_path as string | undefined;
        if (filePath) {
          const fileName = filePath.split('/').pop() || filePath;
          return `Lendo ${fileName}...`;
        }
        return 'Lendo arquivo...';
      }
      case 'Write': {
        const filePath = input?.file_path as string | undefined;
        if (filePath) {
          const fileName = filePath.split('/').pop() || filePath;
          return `Escrevendo ${fileName}...`;
        }
        return 'Escrevendo arquivo...';
      }
      case 'Edit': {
        const filePath = input?.file_path as string | undefined;
        if (filePath) {
          const fileName = filePath.split('/').pop() || filePath;
          return `Editando ${fileName}...`;
        }
        return 'Editando arquivo...';
      }
      case 'Bash': {
        const command = input?.command as string | undefined;
        if (command) {
          // Handle sleep commands specially - they indicate waiting
          if (command.startsWith('sleep ')) {
            return 'Aguardando...';
          }
          const shortCmd = command.split(' ')[0].split('/').pop() || command;
          return `Executando ${this.truncatePrompt(shortCmd, 20)}...`;
        }
        return 'Executando comando...';
      }
      case 'Glob':
        return 'Buscando arquivos...';
      case 'Grep':
        return 'Pesquisando código...';
      default:
        return `Usando ${toolName}...`;
    }
  }

  /**
   * Generate a summary of actions based on tools used
   */
  private generateActionSummary(tools: ToolUsage[]): string {
    const writes = tools.filter(t => t.name === 'Write').length;
    const edits = tools.filter(t => t.name === 'Edit').length;
    const reads = tools.filter(t => t.name === 'Read').length;
    const bashes = tools.filter(t => t.name === 'Bash').length;
    const globs = tools.filter(t => t.name === 'Glob').length;
    const greps = tools.filter(t => t.name === 'Grep').length;

    // Priority: writes > edits > bashes > reads/searches
    if (writes > 0) {
      return `Criou ${writes} arquivo${writes > 1 ? 's' : ''}`;
    }
    if (edits > 0) {
      return `Editou ${edits} arquivo${edits > 1 ? 's' : ''}`;
    }
    if (bashes > 0) {
      // Try to get the command from the last bash
      const lastBash = tools.filter(t => t.name === 'Bash').pop();
      const cmd = lastBash?.input?.command as string | undefined;
      if (cmd) {
        const shortCmd = cmd.split(' ')[0].split('/').pop() || cmd;
        return `Executou ${shortCmd}`;
      }
      return `Executou ${bashes} comando${bashes > 1 ? 's' : ''}`;
    }
    if (reads > 0 || globs > 0 || greps > 0) {
      const total = reads + globs + greps;
      return `Analisou ${total} arquivo${total > 1 ? 's' : ''}`;
    }

    return 'Processou prompt';
  }
}
