/**
 * TelegramCommandHandler - Stateless routing system for Telegram messages and commands
 *
 * Implements a stateless router pattern that returns TelegramRouteResult actions
 * for different message types and contexts (group vs private chat).
 *
 * Topic Routing:
 * - threadId=undefined or threadId=1 → routes to General topic (mainSessionId)
 * - threadId>1 → routes to specific topic.sessionId
 * - Groups without topics enabled → hybrid mode, all messages to mainSessionId
 */

import type { Agent, AgentTopic, ModelMode } from './types';
import { AgentManager } from './agent-manager';
import type { GroupOnboardingManager } from './group-onboarding-manager';
import type { TopicManager } from './topic-manager';

/**
 * Result of routing a Telegram message
 */
export type TelegramRouteResult =
  | { action: 'prompt'; agentId: string; text: string; model?: 'haiku' | 'sonnet' | 'opus'; chatId: number; threadId?: number; sessionId?: string }
  | { action: 'show_model_selector'; agentId: string; text: string; chatId: number; threadId?: number; sessionId?: string }
  | { action: 'reject_private_prompt'; chatId: number; userId: string }
  | { action: 'orphaned_group'; chatId: number; userId: string }
  | { action: 'command'; command: string; args: string; chatId: number; userId: string; threadId?: number }
  | { action: 'flow_input'; text: string; chatId: number; userId: string }
  | { action: 'unknown_user'; chatId: number }
  | { action: 'ralph_loop'; agentId: string; task: string; chatId: number; userId: string; threadId?: number }
  | { action: 'bash_command'; agentId: string; command: string; chatId: number; userId: string; threadId?: number }
  | { action: 'group_onboarding_locked'; chatId: number; userId: string; lockedByUserId: number }
  | { action: 'topic_not_found'; chatId: number; userId: string; threadId: number }
  | { action: 'topic_unregistered'; chatId: number; userId: string; threadId: number; agentId: string }
  | { action: 'topic_closed'; chatId: number; userId: string; threadId: number; topicName: string }
  | { action: 'topic_ralph_active'; chatId: number; userId: string; threadId: number; topicName: string; agentId: string; text: string; loopId: string }
  | { action: 'topic_command'; command: 'ralph' | 'worktree' | 'sessao' | 'topicos'; args: string; chatId: number; userId: string; threadId?: number; agentId?: string }
  | { action: 'topic_workspace'; chatId: number; userId: string; threadId?: number; agentId: string; path?: string }
  | { action: 'topic_workspace_general'; chatId: number; userId: string }
  | { action: 'ralph_control'; command: 'pausar' | 'retomar' | 'cancelar'; chatId: number; userId: string; threadId: number; agentId: string; loopId: string }
  | { action: 'ignore' };

/**
 * Model prefix parsing result
 */
export interface ModelPrefixResult {
  model?: 'haiku' | 'sonnet' | 'opus';
  text: string;
}

/**
 * Chat type detection
 */
export type ChatType = 'private' | 'group' | 'supergroup' | 'channel';

/**
 * TelegramCommandHandler handles routing decisions for Telegram messages
 *
 * This is a stateless router - it makes routing decisions based on the
 * current state of agents and user preferences, returning action objects
 * that the caller can execute.
 */
export class TelegramCommandHandler {
  constructor(
    private readonly agentManager: AgentManager,
    private readonly groupOnboardingManager?: GroupOnboardingManager,
    private readonly topicManager?: TopicManager
  ) {}

  /**
   * Route a message from a Telegram group chat
   *
   * Groups are linked to agents via telegramChatId. Messages in groups
   * are routed to the linked agent for processing.
   *
   * Topic Routing:
   * - threadId=undefined or threadId=1 → routes to General topic (mainSessionId)
   * - threadId>1 → routes to specific topic.sessionId
   * - Groups without topics enabled → hybrid mode, all messages to mainSessionId
   *
   * @param chatId - Telegram chat ID
   * @param userId - Internal user ID (phone number)
   * @param text - Message text
   * @param telegramUserId - Telegram user ID (for onboarding lock checks)
   * @param threadId - Optional message_thread_id from Telegram (for forum topics)
   * @param isForum - Whether the group has topics enabled (is_forum flag)
   * @returns TelegramRouteResult indicating what action to take
   */
  routeGroupMessage(
    chatId: number,
    userId: string,
    text: string,
    telegramUserId?: number,
    threadId?: number,
    isForum: boolean = false
  ): TelegramRouteResult {
    // Check if this is a command (starts with /)
    if (text.startsWith('/')) {
      const [command, ...argParts] = text.split(' ');
      const commandLower = command.toLowerCase();
      const args = argParts.join(' ');

      // Ralph control commands - check FIRST for forum topics with active Ralph loop
      // (must be checked before /cancelar special handling for onboarding)
      const ralphControlCommands = ['/pausar', '/retomar', '/cancelar'];
      if (ralphControlCommands.includes(commandLower) && isForum && threadId !== undefined && threadId > 1) {
        const agent = this.agentManager.getAgentByTelegramChatId(chatId);
        if (agent && agent.userId === userId && this.topicManager) {
          const topic = this.topicManager.getTopicByThreadId(agent.id, threadId);
          if (topic && topic.type === 'ralph' && topic.loopId) {
            return {
              action: 'ralph_control',
              command: commandLower.slice(1) as 'pausar' | 'retomar' | 'cancelar',
              chatId,
              userId,
              threadId,
              agentId: agent.id,
              loopId: topic.loopId,
            };
          }
        }
      }

      // /cancelar always goes through as a command (lock validation happens in handler)
      if (commandLower === '/cancelar') {
        return {
          action: 'command',
          command: commandLower,
          args,
          chatId,
          userId,
        };
      }

      // For other commands during active onboarding, check lock
      if (this.groupOnboardingManager && telegramUserId !== undefined) {
        if (this.groupOnboardingManager.hasActiveOnboarding(chatId)) {
          // Check if message is from the user who has the lock
          if (!this.groupOnboardingManager.isLockedByUser(chatId, telegramUserId)) {
            // Different user - group is locked, silently ignore
            const lockedByUserId = this.groupOnboardingManager.getLockedByUserId(chatId)!;
            return {
              action: 'group_onboarding_locked',
              chatId,
              userId,
              lockedByUserId,
            };
          }
          // User has lock - treat command as flow input (allows workspace paths like /Users/...)
          return {
            action: 'flow_input',
            text,
            chatId,
            userId,
          };
        }
      }

      // /workspace command - route to topic_workspace handler
      if (commandLower === '/workspace') {
        const agent = this.agentManager.getAgentByTelegramChatId(chatId);
        if (!agent || agent.userId !== userId) {
          return {
            action: 'command',
            command: commandLower,
            args,
            chatId,
            userId,
            threadId,
          };
        }

        // In General topic (threadId undefined or 1) → show instruction message
        if (!threadId || threadId === 1) {
          return {
            action: 'topic_workspace_general',
            chatId,
            userId,
          };
        }

        return {
          action: 'topic_workspace',
          chatId,
          userId,
          threadId,
          agentId: agent.id,
          path: args.trim() || undefined,
        };
      }

      // Topic management commands - route to topic_command handler only for forum groups
      // For non-forum groups, /ralph uses the old ralph_loop route and other topic commands show error
      const topicCommands = ['/ralph', '/worktree', '/sessao', '/topicos'];
      if (topicCommands.includes(commandLower)) {
        if (isForum) {
          // Forum group - route all topic commands to topic_command handler
          const agent = this.agentManager.getAgentByTelegramChatId(chatId);
          return {
            action: 'topic_command',
            command: commandLower.slice(1) as 'ralph' | 'worktree' | 'sessao' | 'topicos',
            args,
            chatId,
            userId,
            threadId,
            agentId: agent?.userId === userId ? agent.id : undefined,
          };
        } else if (commandLower === '/ralph' && args.trim()) {
          // Non-forum group with /ralph <task> - use old ralph_loop route
          const agent = this.agentManager.getAgentByTelegramChatId(chatId);
          if (agent && agent.userId === userId) {
            return {
              action: 'ralph_loop',
              agentId: agent.id,
              task: args.trim(),
              chatId,
              userId,
              threadId,
            };
          }
        } else if (commandLower !== '/ralph') {
          // Non-forum group with /worktree, /sessao, /topicos - route to topic_command to show error
          const agent = this.agentManager.getAgentByTelegramChatId(chatId);
          return {
            action: 'topic_command',
            command: commandLower.slice(1) as 'ralph' | 'worktree' | 'sessao' | 'topicos',
            args,
            chatId,
            userId,
            threadId,
            agentId: agent?.userId === userId ? agent.id : undefined,
          };
        }
      }

      return {
        action: 'command',
        command: commandLower,
        args,
        chatId,
        userId,
        threadId,
      };
    }

    // For non-command text during active onboarding, check lock
    if (this.groupOnboardingManager && telegramUserId !== undefined) {
      if (this.groupOnboardingManager.hasActiveOnboarding(chatId)) {
        // Check if message is from the user who has the lock
        if (this.groupOnboardingManager.isLockedByUser(chatId, telegramUserId)) {
          // Same user - treat as flow input
          return {
            action: 'flow_input',
            text,
            chatId,
            userId,
          };
        } else {
          // Different user - group is locked
          const lockedByUserId = this.groupOnboardingManager.getLockedByUserId(chatId)!;
          return {
            action: 'group_onboarding_locked',
            chatId,
            userId,
            lockedByUserId,
          };
        }
      }
    }

    // Find agent linked to this group
    const agent = this.agentManager.getAgentByTelegramChatId(chatId);

    if (!agent) {
      // Orphaned group - no agent linked
      return {
        action: 'orphaned_group',
        chatId,
        userId,
      };
    }

    // Verify agent belongs to this user
    if (agent.userId !== userId) {
      return { action: 'ignore' };
    }

    // Check for bash prefix ($ or >) - execute immediately as bash
    if ((text.startsWith('$ ') || text.startsWith('> ')) && agent.type === 'bash') {
      return {
        action: 'bash_command',
        agentId: agent.id,
        command: text.slice(2).trim(),
        chatId,
        userId,
        threadId,
      };
    }

    // For bash agents, all messages are treated as commands
    if (agent.type === 'bash') {
      return {
        action: 'bash_command',
        agentId: agent.id,
        command: text.trim(),
        chatId,
        userId,
        threadId,
      };
    }

    // Determine session ID based on topic routing
    const { sessionId, routingError } = this.resolveSessionForTopic(agent, threadId, isForum, text);

    // Handle topic routing errors
    if (routingError) {
      return routingError;
    }

    // Parse model prefix from text
    const { model, text: cleanText } = this.parseModelPrefix(text);

    // Determine if we need model selection
    if (agent.modelMode === 'selection' && !model) {
      return {
        action: 'show_model_selector',
        agentId: agent.id,
        text: cleanText,
        chatId,
        threadId,
        sessionId,
      };
    }

    // Use specified model, agent's fixed model, or default to sonnet
    const finalModel = model || (agent.modelMode !== 'selection' ? agent.modelMode : 'sonnet');

    return {
      action: 'prompt',
      agentId: agent.id,
      text: cleanText,
      model: finalModel as 'haiku' | 'sonnet' | 'opus',
      chatId,
      threadId,
      sessionId,
    };
  }

  /**
   * Resolve session ID for topic-based routing
   *
   * @param agent - The agent to route to
   * @param threadId - The Telegram thread ID (undefined or 1 = General, >1 = specific topic)
   * @param isForum - Whether the group has topics enabled
   * @param text - Original message text (for error messages)
   * @returns Session ID and optional routing error
   */
  private resolveSessionForTopic(
    agent: Agent,
    threadId: number | undefined,
    isForum: boolean,
    text: string
  ): { sessionId?: string; routingError?: TelegramRouteResult } {
    // Hybrid mode: group without topics enabled → use mainSessionId
    if (!isForum) {
      return { sessionId: agent.mainSessionId };
    }

    // General topic: threadId is undefined or 1 → use mainSessionId
    if (threadId === undefined || threadId === 1) {
      return { sessionId: agent.mainSessionId };
    }

    // Specific topic: threadId > 1 → find matching topic
    if (!this.topicManager) {
      // TopicManager not available, fall back to mainSessionId
      return { sessionId: agent.mainSessionId };
    }

    const topic = this.topicManager.getTopicByThreadId(agent.id, threadId);

    // Topic not found - return topic_unregistered so it can be auto-registered
    if (!topic) {
      return {
        routingError: {
          action: 'topic_unregistered',
          chatId: agent.telegramChatId!,
          userId: agent.userId,
          threadId,
          agentId: agent.id,
        },
      };
    }

    // Topic is closed
    if (topic.status === 'closed') {
      return {
        routingError: {
          action: 'topic_closed',
          chatId: agent.telegramChatId!,
          userId: agent.userId,
          threadId,
          topicName: topic.name,
        },
      };
    }

    // Topic has active Ralph loop - queue message
    if (topic.type === 'ralph' && topic.loopId) {
      return {
        routingError: {
          action: 'topic_ralph_active',
          chatId: agent.telegramChatId!,
          userId: agent.userId,
          threadId,
          topicName: topic.name,
          agentId: agent.id,
          text,
          loopId: topic.loopId,
        },
      };
    }

    // Return topic's session ID (or mainSessionId for general topic)
    return { sessionId: topic.sessionId || agent.mainSessionId };
  }

  /**
   * Get topic by thread ID for an agent
   */
  getTopicByThreadId(agentId: string, threadId: number): AgentTopic | undefined {
    if (!this.topicManager) return undefined;
    return this.topicManager.getTopicByThreadId(agentId, threadId);
  }

  /**
   * Route a message from a private Telegram chat
   *
   * Private chats are used for management commands only.
   * Prompts are rejected with an educational message.
   *
   * @param chatId - Telegram chat ID
   * @param userId - Internal user ID (phone number)
   * @param text - Message text
   * @param isInFlow - Whether the user is currently in a flow
   * @returns TelegramRouteResult indicating what action to take
   */
  routePrivateMessage(chatId: number, userId: string, text: string, isInFlow: boolean = false): TelegramRouteResult {
    // Check if this is a command (starts with /)
    if (text.startsWith('/')) {
      const [command, ...argParts] = text.split(' ');
      const commandLower = command.toLowerCase();

      // Known commands that should always be processed as commands
      const knownCommands = ['/criar', '/cancelar', '/status', '/help', '/link', '/start', '/agentes', '/listar'];

      // If user is in a flow and this is NOT a known command, treat as flow input
      // This allows paths like /Users/lucas/... to be treated as input
      if (isInFlow && !knownCommands.includes(commandLower)) {
        return {
          action: 'flow_input',
          text,
          chatId,
          userId,
        };
      }

      return {
        action: 'command',
        command: commandLower,
        args: argParts.join(' '),
        chatId,
        userId,
      };
    }

    // If user is in a flow, treat as flow input
    if (isInFlow) {
      return {
        action: 'flow_input',
        text,
        chatId,
        userId,
      };
    }

    // Non-command text in private chat - reject prompt
    return {
      action: 'reject_private_prompt',
      chatId,
      userId,
    };
  }

  /**
   * Parse model prefix from message text
   *
   * Supports prefixes: !haiku, !sonnet, !opus
   *
   * @param text - Message text
   * @returns Object with extracted model (if any) and cleaned text
   */
  parseModelPrefix(text: string): ModelPrefixResult {
    const trimmed = text.trim();

    // Check for model prefixes at the start of the message
    const prefixPatterns: Array<{ prefix: string; model: 'haiku' | 'sonnet' | 'opus' }> = [
      { prefix: '!haiku', model: 'haiku' },
      { prefix: '!sonnet', model: 'sonnet' },
      { prefix: '!opus', model: 'opus' },
    ];

    for (const { prefix, model } of prefixPatterns) {
      if (trimmed.toLowerCase().startsWith(prefix)) {
        // Check if prefix is followed by space or end of string
        const afterPrefix = trimmed.slice(prefix.length);
        if (afterPrefix === '' || afterPrefix.startsWith(' ')) {
          return {
            model,
            text: afterPrefix.trim(),
          };
        }
      }
    }

    // No model prefix found
    return { text: trimmed };
  }

  /**
   * Check if a Telegram group is orphaned (no linked agent)
   *
   * @param chatId - Telegram chat ID
   * @param userId - Internal user ID
   * @returns true if the group has no linked agent for this user
   */
  isOrphanedGroup(chatId: number, userId: string): boolean {
    const agent = this.agentManager.getAgentByTelegramChatId(chatId);

    // No agent linked at all
    if (!agent) {
      return true;
    }

    // Agent exists but belongs to different user
    if (agent.userId !== userId) {
      return true;
    }

    return false;
  }

  /**
   * Detect chat type from Telegram message
   *
   * @param chatType - Chat type string from Telegram API
   * @returns Normalized chat type
   */
  detectChatType(chatType: string): ChatType {
    switch (chatType) {
      case 'private':
        return 'private';
      case 'group':
        return 'group';
      case 'supergroup':
        return 'supergroup';
      case 'channel':
        return 'channel';
      default:
        return 'private';
    }
  }

  /**
   * Check if a chat type is a group (group or supergroup)
   *
   * @param chatType - Chat type from Telegram
   * @returns true if it's a group chat
   */
  isGroupChat(chatType: string): boolean {
    const type = this.detectChatType(chatType);
    return type === 'group' || type === 'supergroup';
  }

  /**
   * Get the agent linked to a Telegram chat
   *
   * @param chatId - Telegram chat ID
   * @returns Agent if found, undefined otherwise
   */
  getLinkedAgent(chatId: number): Agent | undefined {
    return this.agentManager.getAgentByTelegramChatId(chatId);
  }

  /**
   * Get list of agents for a user (for displaying in private chat)
   *
   * @param userId - Internal user ID
   * @returns Array of agents belonging to the user
   */
  getUserAgents(userId: string): Agent[] {
    return this.agentManager.listAgents(userId);
  }
}
