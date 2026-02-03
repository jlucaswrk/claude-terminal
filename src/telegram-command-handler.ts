/**
 * TelegramCommandHandler - Stateless routing system for Telegram messages and commands
 *
 * Implements a stateless router pattern that returns TelegramRouteResult actions
 * for different message types and contexts (group vs private chat).
 */

import type { Agent, ModelMode } from './types';
import { AgentManager } from './agent-manager';
import type { GroupOnboardingManager } from './group-onboarding-manager';

/**
 * Result of routing a Telegram message
 */
export type TelegramRouteResult =
  | { action: 'prompt'; agentId: string; text: string; model?: 'haiku' | 'sonnet' | 'opus'; chatId: number }
  | { action: 'show_model_selector'; agentId: string; text: string; chatId: number }
  | { action: 'reject_private_prompt'; chatId: number; userId: string }
  | { action: 'orphaned_group'; chatId: number; userId: string }
  | { action: 'command'; command: string; args: string; chatId: number; userId: string }
  | { action: 'flow_input'; text: string; chatId: number; userId: string }
  | { action: 'unknown_user'; chatId: number }
  | { action: 'ralph_loop'; agentId: string; task: string; chatId: number; userId: string }
  | { action: 'bash_command'; agentId: string; command: string; chatId: number; userId: string }
  | { action: 'group_onboarding_locked'; chatId: number; userId: string; lockedByUserId: number }
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
    private readonly groupOnboardingManager?: GroupOnboardingManager
  ) {}

  /**
   * Route a message from a Telegram group chat
   *
   * Groups are linked to agents via telegramChatId. Messages in groups
   * are routed to the linked agent for processing.
   *
   * @param chatId - Telegram chat ID
   * @param userId - Internal user ID (phone number)
   * @param text - Message text
   * @param telegramUserId - Telegram user ID (for onboarding lock checks)
   * @returns TelegramRouteResult indicating what action to take
   */
  routeGroupMessage(chatId: number, userId: string, text: string, telegramUserId?: number): TelegramRouteResult {
    // Check if this is a command (starts with /)
    if (text.startsWith('/')) {
      const [command, ...argParts] = text.split(' ');
      const commandLower = command.toLowerCase();
      const args = argParts.join(' ');

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

      // Special handling for /ralph command - parse task inline
      if (commandLower === '/ralph' && args.trim()) {
        const agent = this.agentManager.getAgentByTelegramChatId(chatId);
        if (agent && agent.userId === userId) {
          return {
            action: 'ralph_loop',
            agentId: agent.id,
            task: args.trim(),
            chatId,
            userId,
          };
        }
      }

      return {
        action: 'command',
        command: commandLower,
        args,
        chatId,
        userId,
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
      };
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
    };
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
