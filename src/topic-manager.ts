// src/topic-manager.ts
/**
 * TopicManager - Manages Telegram forum topic lifecycle and persistence
 *
 * Responsibilities:
 * - CRUD operations for topics
 * - Telegram API integration for forum topics
 * - Topic persistence using data/topics/{agentId}.json
 * - Sync between local state and Telegram
 */

import { v4 as uuidv4 } from 'uuid';
import type { AgentTopic, TopicType, TopicStatus, AgentTopicsFile } from './types';
import { PersistenceService } from './persistence';
import {
  createForumTopic,
  closeForumTopic,
  reopenForumTopic,
  editForumTopic,
  deleteForumTopic,
  isChatForum,
  getExtendedChat,
  validateForumTopicExists,
  withRetry,
  sleep,
  TOPIC_COLORS,
  type ForumTopicCreated,
} from './telegram';

/**
 * Maximum topic name length (Telegram API limit is 128, we use 100 for safety)
 */
export const MAX_TOPIC_NAME_LENGTH = 100;

/**
 * Options for creating a topic
 */
export interface CreateTopicOptions {
  agentId: string;
  chatId: number;
  name: string;
  type: TopicType;
  emoji?: string;
  sessionId?: string;
  loopId?: string;
  iconColor?: number;
  skipTelegramCreation?: boolean;
}

/**
 * Result of a topic creation
 */
export interface CreateTopicResult {
  success: boolean;
  topic?: AgentTopic;
  error?: string;
  telegramTopicId?: number;
}

/**
 * Result of topic sync operation
 */
export interface SyncResult {
  success: boolean;
  synced: number;          // Topics that remain active
  newlyClosed: number;     // Topics marked as closed during this sync
  alreadyClosed: number;   // Topics that were already closed before sync
  errors: string[];
}

/**
 * Topic validation error
 */
export class TopicValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TopicValidationError';
  }
}

/**
 * Get default color for a topic type
 */
export function getTopicColorForType(type: TopicType): number {
  switch (type) {
    case 'ralph':
      return TOPIC_COLORS.YELLOW;   // 0xFFD67E
    case 'worktree':
      return TOPIC_COLORS.PURPLE;   // 0xCB86DB
    case 'session':
      return TOPIC_COLORS.BLUE;     // 0x6FB9F0
    case 'general':
    default:
      return TOPIC_COLORS.GREEN;    // 0x8EEE98
  }
}

/**
 * Get default emoji for a topic type
 */
export function getTopicEmojiForType(type: TopicType): string {
  switch (type) {
    case 'ralph':
      return '🔄';
    case 'worktree':
      return '🌿';
    case 'session':
      return '💬';
    case 'general':
    default:
      return '📌';
  }
}

/**
 * Validate topic name
 * @throws TopicValidationError if invalid
 */
export function validateTopicName(name: string): void {
  if (!name || typeof name !== 'string') {
    throw new TopicValidationError('Topic name is required');
  }

  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new TopicValidationError('Topic name cannot be empty');
  }

  if (trimmed.length > MAX_TOPIC_NAME_LENGTH) {
    throw new TopicValidationError(`Topic name exceeds maximum length of ${MAX_TOPIC_NAME_LENGTH} characters`);
  }

  // Check for dangerous characters that might cause issues
  const dangerousPattern = /[\x00-\x1F\x7F]/;
  if (dangerousPattern.test(trimmed)) {
    throw new TopicValidationError('Topic name contains invalid control characters');
  }
}

/**
 * TopicManager class
 */
export class TopicManager {
  private persistence: PersistenceService;

  constructor(persistence?: PersistenceService) {
    this.persistence = persistence || new PersistenceService();
  }

  /**
   * Create a new topic
   *
   * @param options - Topic creation options
   * @returns Creation result with topic or error
   */
  async createTopic(options: CreateTopicOptions): Promise<CreateTopicResult> {
    const {
      agentId,
      chatId,
      name,
      type,
      emoji,
      sessionId,
      loopId,
      iconColor,
      skipTelegramCreation = false,
    } = options;

    // Validate name
    try {
      validateTopicName(name);
    } catch (error) {
      if (error instanceof TopicValidationError) {
        return { success: false, error: error.message };
      }
      throw error;
    }

    // Verify chat is a forum (unless skipping Telegram creation)
    if (!skipTelegramCreation) {
      const isForum = await isChatForum(chatId);
      if (!isForum) {
        return {
          success: false,
          error: `Chat ${chatId} is not a forum. Topics must be enabled in group settings.`,
        };
      }
    }

    // Create topic in Telegram
    let telegramTopicId: number | undefined;

    if (!skipTelegramCreation) {
      const topicColor = iconColor ?? getTopicColorForType(type);
      const topicEmoji = emoji ?? getTopicEmojiForType(type);
      const fullName = `${topicEmoji} ${name}`.slice(0, 128);

      const telegramResult = await createForumTopic(chatId, fullName, topicColor);
      if (!telegramResult) {
        return {
          success: false,
          error: 'Failed to create topic in Telegram. Check bot permissions.',
        };
      }

      telegramTopicId = telegramResult.message_thread_id;
    }

    // Create local topic object
    const now = new Date();
    const topic: AgentTopic = {
      id: uuidv4(),
      agentId,
      telegramTopicId: telegramTopicId ?? 0,
      type,
      name: name.trim(),
      emoji: emoji ?? getTopicEmojiForType(type),
      sessionId,
      loopId,
      status: 'active',
      messageCount: 0,
      createdAt: now,
      lastActivity: now,
    };

    // Persist topic
    this.saveTopic(agentId, topic);

    console.log(`[topic-manager] Created topic "${topic.name}" (${topic.id}) for agent ${agentId}`);

    return {
      success: true,
      topic,
      telegramTopicId,
    };
  }

  /**
   * Get a topic by ID
   *
   * @param agentId - The agent ID
   * @param topicId - The topic ID
   * @returns The topic or undefined
   */
  getTopic(agentId: string, topicId: string): AgentTopic | undefined {
    const topics = this.listTopics(agentId);
    return topics.find(t => t.id === topicId);
  }

  /**
   * Get a topic by Telegram thread ID
   *
   * @param agentId - The agent ID
   * @param threadId - The Telegram message_thread_id
   * @returns The topic or undefined
   */
  getTopicByThreadId(agentId: string, threadId: number): AgentTopic | undefined {
    const topics = this.listTopics(agentId);
    return topics.find(t => t.telegramTopicId === threadId);
  }

  /**
   * List all topics for an agent
   *
   * @param agentId - The agent ID
   * @param filter - Optional filter for status
   * @returns Array of topics
   */
  listTopics(agentId: string, filter?: { status?: TopicStatus }): AgentTopic[] {
    const topicsFile = this.persistence.loadTopics(agentId);
    if (!topicsFile) {
      return [];
    }

    let topics = topicsFile.topics;

    if (filter?.status) {
      topics = topics.filter(t => t.status === filter.status);
    }

    return topics;
  }

  /**
   * Close a topic
   *
   * @param agentId - The agent ID
   * @param topicId - The topic ID
   * @param chatId - The Telegram chat ID (for API call)
   * @returns true on success
   */
  async closeTopic(agentId: string, topicId: string, chatId: number): Promise<boolean> {
    const topic = this.getTopic(agentId, topicId);
    if (!topic) {
      console.error(`[topic-manager] Topic ${topicId} not found for agent ${agentId}`);
      return false;
    }

    if (topic.status === 'closed') {
      console.log(`[topic-manager] Topic ${topicId} is already closed`);
      return true;
    }

    // Close in Telegram
    if (topic.telegramTopicId > 0) {
      const telegramSuccess = await closeForumTopic(chatId, topic.telegramTopicId);
      if (!telegramSuccess) {
        console.warn(`[topic-manager] Failed to close topic in Telegram, continuing with local update`);
      }
    }

    // Update local state
    const updatedTopic: AgentTopic = {
      ...topic,
      status: 'closed',
      lastActivity: new Date(),
    };

    this.updateTopic(agentId, updatedTopic);
    console.log(`[topic-manager] Closed topic "${topic.name}" (${topicId})`);

    return true;
  }

  /**
   * Reopen a closed topic
   *
   * @param agentId - The agent ID
   * @param topicId - The topic ID
   * @param chatId - The Telegram chat ID (for API call)
   * @returns true on success
   */
  async reopenTopic(agentId: string, topicId: string, chatId: number): Promise<boolean> {
    const topic = this.getTopic(agentId, topicId);
    if (!topic) {
      console.error(`[topic-manager] Topic ${topicId} not found for agent ${agentId}`);
      return false;
    }

    if (topic.status === 'active') {
      console.log(`[topic-manager] Topic ${topicId} is already active`);
      return true;
    }

    // Reopen in Telegram
    if (topic.telegramTopicId > 0) {
      const telegramSuccess = await reopenForumTopic(chatId, topic.telegramTopicId);
      if (!telegramSuccess) {
        console.warn(`[topic-manager] Failed to reopen topic in Telegram, continuing with local update`);
      }
    }

    // Update local state
    const updatedTopic: AgentTopic = {
      ...topic,
      status: 'active',
      lastActivity: new Date(),
    };

    this.updateTopic(agentId, updatedTopic);
    console.log(`[topic-manager] Reopened topic "${topic.name}" (${topicId})`);

    return true;
  }

  /**
   * Delete a topic
   * WARNING: This deletes all messages in the topic from Telegram
   *
   * @param agentId - The agent ID
   * @param topicId - The topic ID
   * @param chatId - The Telegram chat ID (for API call)
   * @param deleteFromTelegram - Whether to delete from Telegram (default: true)
   * @returns true on success
   */
  async deleteTopic(
    agentId: string,
    topicId: string,
    chatId: number,
    deleteFromTelegram: boolean = true
  ): Promise<boolean> {
    const topic = this.getTopic(agentId, topicId);
    if (!topic) {
      console.error(`[topic-manager] Topic ${topicId} not found for agent ${agentId}`);
      return false;
    }

    // Delete from Telegram if requested
    if (deleteFromTelegram && topic.telegramTopicId > 0) {
      const telegramSuccess = await deleteForumTopic(chatId, topic.telegramTopicId);
      if (!telegramSuccess) {
        console.warn(`[topic-manager] Failed to delete topic from Telegram`);
        // Continue with local deletion
      }
    }

    // Remove from local storage
    this.removeTopic(agentId, topicId);
    console.log(`[topic-manager] Deleted topic "${topic.name}" (${topicId})`);

    return true;
  }

  /**
   * Update topic activity timestamp
   *
   * @param agentId - The agent ID
   * @param topicId - The topic ID
   */
  updateTopicActivity(agentId: string, topicId: string): void {
    const topic = this.getTopic(agentId, topicId);
    if (!topic) return;

    const updatedTopic: AgentTopic = {
      ...topic,
      lastActivity: new Date(),
    };

    this.updateTopic(agentId, updatedTopic);
  }

  /**
   * Update topic session ID
   *
   * @param agentId - The agent ID
   * @param topicId - The topic ID
   * @param sessionId - The new session ID
   */
  updateTopicSession(agentId: string, topicId: string, sessionId: string | undefined): void {
    const topic = this.getTopic(agentId, topicId);
    if (!topic) return;

    const updatedTopic: AgentTopic = {
      ...topic,
      sessionId,
      lastActivity: new Date(),
    };

    this.updateTopic(agentId, updatedTopic);
  }

  /**
   * Set the Ralph loop ID for a topic
   *
   * @param agentId - The agent ID
   * @param topicId - The topic ID
   * @param loopId - The Ralph loop ID
   */
  setTopicLoopId(agentId: string, topicId: string, loopId: string): void {
    const topic = this.getTopic(agentId, topicId);
    if (!topic) return;

    const updatedTopic: AgentTopic = {
      ...topic,
      loopId,
      lastActivity: new Date(),
    };

    this.updateTopic(agentId, updatedTopic);
    console.log(`[topic-manager] Set loopId ${loopId} for topic ${topicId}`);
  }

  /**
   * Clear the Ralph loop ID from a topic
   *
   * @param agentId - The agent ID
   * @param topicId - The topic ID
   */
  clearTopicLoopId(agentId: string, topicId: string): void {
    const topic = this.getTopic(agentId, topicId);
    if (!topic) return;

    const updatedTopic: AgentTopic = {
      ...topic,
      loopId: undefined,
      lastActivity: new Date(),
    };

    this.updateTopic(agentId, updatedTopic);
    console.log(`[topic-manager] Cleared loopId for topic ${topicId}`);
  }

  /**
   * Increment the message count for a topic
   *
   * @param agentId - The agent ID
   * @param topicId - The topic ID
   */
  incrementTopicMessageCount(agentId: string, topicId: string): void {
    const topic = this.getTopic(agentId, topicId);
    if (!topic) return;

    const updatedTopic: AgentTopic = {
      ...topic,
      messageCount: (topic.messageCount || 0) + 1,
      lastActivity: new Date(),
    };

    this.updateTopic(agentId, updatedTopic);
  }

  /**
   * Sync topics with Telegram
   * Verifies that local topics still exist in Telegram and updates status
   * Marks deleted/closed topics as 'closed' in local state
   *
   * @param agentId - The agent ID
   * @param chatId - The Telegram chat ID
   * @returns Sync result with active/closed counts
   */
  async syncTopicsWithTelegram(agentId: string, chatId: number): Promise<SyncResult> {
    const result: SyncResult = {
      success: true,
      synced: 0,
      newlyClosed: 0,
      alreadyClosed: 0,
      errors: [],
    };

    console.log(`[topic-manager] Iniciando sincronização de tópicos para agente ${agentId}`);

    // Verify chat is a forum
    const chat = await getExtendedChat(chatId);
    if (!chat) {
      result.success = false;
      result.errors.push(`Falha ao obter informações do chat ${chatId}`);
      console.error(`[topic-manager] ${result.errors[0]}`);
      return result;
    }

    if (!chat.is_forum) {
      result.success = false;
      result.errors.push(`Chat ${chatId} não é um fórum`);
      console.error(`[topic-manager] ${result.errors[0]}`);
      return result;
    }

    const topics = this.listTopics(agentId);
    let consecutiveRateLimitErrors = 0;
    const MAX_CONSECUTIVE_RATE_LIMITS = 3;

    console.log(`[topic-manager] Validando ${topics.length} tópicos para agente ${agentId}`);

    // Validate each topic individually
    for (const topic of topics) {
      // Skip validation for general topic (always exists as chat itself)
      if (topic.type === 'general' || topic.telegramTopicId <= 1) {
        result.synced++;
        continue;
      }

      // Skip already closed topics
      if (topic.status === 'closed') {
        result.alreadyClosed++;
        continue;
      }

      // Check if topic exists with retry logic for rate limits
      try {
        const exists = await withRetry(
          () => validateForumTopicExists(chatId, topic.telegramTopicId),
          `validação tópico "${topic.name}" (${topic.telegramTopicId})`,
          3,
          1000
        );

        if (exists === false) {
          // Topic deleted - mark as closed
          // Reset rate limit counter on successful API call
          consecutiveRateLimitErrors = 0;
          const updatedTopic: AgentTopic = {
            ...topic,
            status: 'closed',
            lastActivity: new Date(),
          };
          this.updateTopic(agentId, updatedTopic);
          result.newlyClosed++;
          console.log(`[topic-manager] ✓ Tópico "${topic.name}" marcado como fechado (deletado no Telegram)`);
        } else if (exists === true) {
          // Topic validated successfully
          // Reset rate limit counter on successful API call
          consecutiveRateLimitErrors = 0;
          result.synced++;
        } else {
          // null = retry exhausted (likely rate limit), count it
          consecutiveRateLimitErrors++;
          result.errors.push(`Não foi possível validar tópico "${topic.name}"`);

          // Check if we should abort due to rate limits
          if (consecutiveRateLimitErrors >= MAX_CONSECUTIVE_RATE_LIMITS) {
            console.warn(`[topic-manager] Abortando sincronização após ${MAX_CONSECUTIVE_RATE_LIMITS} erros consecutivos de rate limit`);
            result.errors.push(`Sincronização abortada: muitos erros de rate limit`);
            break;
          }
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        const errorLower = errorMsg.toLowerCase();

        // Detect rate limit errors
        if (errorLower.includes('429') || errorLower.includes('too many requests')) {
          consecutiveRateLimitErrors++;
          console.warn(`[topic-manager] Rate limit detectado (${consecutiveRateLimitErrors}/${MAX_CONSECUTIVE_RATE_LIMITS})`);

          if (consecutiveRateLimitErrors >= MAX_CONSECUTIVE_RATE_LIMITS) {
            console.warn(`[topic-manager] Abortando sincronização após ${MAX_CONSECUTIVE_RATE_LIMITS} erros consecutivos de rate limit`);
            result.errors.push(`Sincronização abortada: muitos erros de rate limit`);
            break;
          }

          // Longer delay after rate limit
          await sleep(5000);
        } else {
          result.errors.push(`Erro ao validar tópico "${topic.name}": ${errorMsg}`);
          console.error(`[topic-manager] Erro ao validar tópico "${topic.name}": ${errorMsg}`);
        }
      }

      // Small delay between validations to avoid rate limits
      await sleep(100);
    }

    const totalClosed = result.newlyClosed + result.alreadyClosed;
    console.log(`[topic-manager] ✅ Sincronizados ${topics.length} tópicos (${result.synced} ativos, ${totalClosed} fechados)`);

    return result;
  }

  /**
   * Get main session ID for an agent's topics
   *
   * @param agentId - The agent ID
   * @returns The main session ID or undefined
   */
  getMainSessionId(agentId: string): string | undefined {
    const topicsFile = this.persistence.loadTopics(agentId);
    return topicsFile?.mainSessionId;
  }

  /**
   * Update main session ID for an agent's topics
   *
   * @param agentId - The agent ID
   * @param mainSessionId - The new main session ID
   */
  setMainSessionId(agentId: string, mainSessionId: string | undefined): void {
    const topicsFile = this.persistence.loadTopics(agentId);
    const topics = topicsFile?.topics || [];
    this.persistence.saveTopics(agentId, mainSessionId, topics);
  }

  /**
   * Get all topics files
   * @returns Array of agent IDs with topics
   */
  listAgentsWithTopics(): string[] {
    return this.persistence.listTopicsFiles();
  }

  /**
   * Clean up orphaned topic files
   *
   * @param existingAgentIds - Array of agent IDs that still exist
   * @returns Number of files deleted
   */
  cleanupOrphanedTopics(existingAgentIds: string[]): number {
    return this.persistence.cleanupOrphanedTopics(existingAgentIds);
  }

  /**
   * Register an external (pre-existing) Telegram topic that was created outside the bot
   *
   * This is used to register topics that already exist in Telegram but are not yet
   * tracked in the local state. The topic is created with the correct emoji based on type.
   *
   * @param agentId - The agent ID to associate the topic with
   * @param threadId - The Telegram message_thread_id of the existing topic
   * @param type - The type of topic (session, ralph, worktree, general)
   * @param name - The name to use for the topic
   * @returns The created AgentTopic
   */
  registerExternalTopic(
    agentId: string,
    threadId: number,
    type: TopicType,
    name: string
  ): AgentTopic {
    // Check if topic already exists
    const existingTopic = this.getTopicByThreadId(agentId, threadId);
    if (existingTopic) {
      console.log(`[topic-manager] Topic with threadId ${threadId} already registered for agent ${agentId}`);
      return existingTopic;
    }

    // Create local topic object with correct emoji for the type
    const now = new Date();
    const topic: AgentTopic = {
      id: uuidv4(),
      agentId,
      telegramTopicId: threadId,
      type,
      name: name.trim(),
      emoji: getTopicEmojiForType(type),
      sessionId: undefined,
      loopId: undefined,
      status: 'active',
      messageCount: 0,
      createdAt: now,
      lastActivity: now,
    };

    // Persist topic
    this.saveTopic(agentId, topic);

    console.log(`[topic-manager] Registered external topic "${topic.name}" (threadId: ${threadId}) for agent ${agentId} with emoji ${topic.emoji}`);

    return topic;
  }

  // ============================================
  // Private Helper Methods
  // ============================================

  /**
   * Save a new topic to persistence
   */
  private saveTopic(agentId: string, topic: AgentTopic): void {
    const topicsFile = this.persistence.loadTopics(agentId);
    const topics = topicsFile?.topics || [];
    const mainSessionId = topicsFile?.mainSessionId;

    topics.push(topic);
    this.persistence.saveTopics(agentId, mainSessionId, topics);
  }

  /**
   * Update an existing topic in persistence
   */
  private updateTopic(agentId: string, updatedTopic: AgentTopic): void {
    const topicsFile = this.persistence.loadTopics(agentId);
    if (!topicsFile) return;

    const topics = topicsFile.topics.map(t =>
      t.id === updatedTopic.id ? updatedTopic : t
    );

    this.persistence.saveTopics(agentId, topicsFile.mainSessionId, topics);
  }

  /**
   * Remove a topic from persistence
   */
  private removeTopic(agentId: string, topicId: string): void {
    const topicsFile = this.persistence.loadTopics(agentId);
    if (!topicsFile) return;

    const topics = topicsFile.topics.filter(t => t.id !== topicId);
    this.persistence.saveTopics(agentId, topicsFile.mainSessionId, topics);
  }
}

// Export singleton instance
export const topicManager = new TopicManager();
