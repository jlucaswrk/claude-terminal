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
  synced: number;
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
   * Sync topics with Telegram
   * Verifies that local topics still exist in Telegram and updates status
   *
   * @param agentId - The agent ID
   * @param chatId - The Telegram chat ID
   * @returns Sync result
   */
  async syncTopicsWithTelegram(agentId: string, chatId: number): Promise<SyncResult> {
    const result: SyncResult = {
      success: true,
      synced: 0,
      errors: [],
    };

    // Verify chat is a forum
    const chat = await getExtendedChat(chatId);
    if (!chat) {
      result.success = false;
      result.errors.push(`Failed to get chat info for ${chatId}`);
      return result;
    }

    if (!chat.is_forum) {
      result.success = false;
      result.errors.push(`Chat ${chatId} is not a forum`);
      return result;
    }

    const topics = this.listTopics(agentId);

    // We can't list topics from Telegram API (no such endpoint exists)
    // So we'll just verify the chat is still a forum and count local topics
    // Individual topic verification happens when sending messages

    result.synced = topics.length;
    console.log(`[topic-manager] Synced ${result.synced} topics for agent ${agentId} in chat ${chatId}`);

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
