/**
 * UserContextManager - Manages conversational state for multi-step flows
 *
 * Tracks user state during multi-step interactions like creating agents,
 * configuring priorities, etc. All state is in-memory (not persisted).
 */

import type { UserContext } from './types';

/**
 * Flow types supported by the context manager
 */
export type FlowType = UserContext['currentFlow'];

/**
 * Flow state types
 */
export type FlowState = UserContext['flowState'];

/**
 * UserContextManager handles conversational state for multi-step flows
 */
export class UserContextManager {
  private contexts: Map<string, UserContext> = new Map();

  // ============================================
  // Core Context Operations
  // ============================================

  /**
   * Get the current context for a user
   */
  getContext(userId: string): UserContext | undefined {
    return this.contexts.get(userId);
  }

  /**
   * Set the context for a user
   */
  setContext(userId: string, context: UserContext): void {
    this.contexts.set(userId, context);
  }

  /**
   * Clear the context for a user (after flow completion)
   */
  clearContext(userId: string): void {
    this.contexts.delete(userId);
  }

  // ============================================
  // Flow State Helpers
  // ============================================

  /**
   * Check if user is currently in any flow
   */
  isInFlow(userId: string): boolean {
    const context = this.contexts.get(userId);
    return context?.currentFlow !== undefined;
  }

  /**
   * Get the current flow type for a user
   */
  getCurrentFlow(userId: string): FlowType | undefined {
    return this.contexts.get(userId)?.currentFlow;
  }

  /**
   * Get the current flow state for a user
   */
  getCurrentFlowState(userId: string): FlowState | undefined {
    return this.contexts.get(userId)?.flowState;
  }

  /**
   * Get flow data for a user
   */
  getFlowData(userId: string): UserContext['flowData'] | undefined {
    return this.contexts.get(userId)?.flowData;
  }

  // ============================================
  // Create Agent Flow
  // States: awaiting_name → awaiting_emoji → awaiting_workspace_choice → (awaiting_workspace) → awaiting_confirmation
  // ============================================

  /**
   * Start the create agent flow
   */
  startCreateAgentFlow(userId: string): void {
    this.contexts.set(userId, {
      userId,
      currentFlow: 'create_agent',
      flowState: 'awaiting_name',
      flowData: {},
    });
  }

  /**
   * Set the agent name in the create flow
   * Advances state to awaiting_type
   */
  setAgentName(userId: string, name: string): void {
    const context = this.contexts.get(userId);
    if (!context || context.currentFlow !== 'create_agent') {
      throw new Error('Not in create agent flow');
    }

    context.flowData = {
      ...context.flowData,
      agentName: name,
    };
    context.flowState = 'awaiting_type';
    this.contexts.set(userId, context);
  }

  /**
   * Set the agent emoji in the create flow
   * Advances state to awaiting_workspace_choice
   */
  setAgentEmoji(userId: string, emoji: string): void {
    const context = this.contexts.get(userId);
    if (!context || context.currentFlow !== 'create_agent') {
      throw new Error('Not in create agent flow');
    }

    context.flowData = {
      ...context.flowData,
      emoji,
    };
    context.flowState = 'awaiting_workspace_choice';
    this.contexts.set(userId, context);
  }

  /**
   * Set state to awaiting custom workspace input
   */
  setAwaitingCustomWorkspace(userId: string): void {
    const context = this.contexts.get(userId);
    if (!context || context.currentFlow !== 'create_agent') {
      throw new Error('Not in create agent flow');
    }

    context.flowState = 'awaiting_workspace';
    this.contexts.set(userId, context);
  }

  /**
   * Set the workspace in the create flow
   * Advances state to awaiting_confirmation
   */
  setAgentWorkspace(userId: string, workspace: string | null): void {
    const context = this.contexts.get(userId);
    if (!context || context.currentFlow !== 'create_agent') {
      throw new Error('Not in create agent flow');
    }

    context.flowData = {
      ...context.flowData,
      workspace: workspace ?? undefined,
    };
    context.flowState = 'awaiting_confirmation';
    this.contexts.set(userId, context);
  }

  /**
   * Get the data collected during create agent flow
   */
  getCreateAgentData(userId: string): { agentName?: string; agentType?: 'claude' | 'bash'; emoji?: string; workspace?: string } | undefined {
    const context = this.contexts.get(userId);
    if (!context || context.currentFlow !== 'create_agent') {
      return undefined;
    }
    return {
      agentName: context.flowData?.agentName as string | undefined,
      agentType: context.flowData?.agentType as 'claude' | 'bash' | undefined,
      emoji: context.flowData?.emoji as string | undefined,
      workspace: context.flowData?.workspace as string | undefined,
    };
  }

  /**
   * Check if we're awaiting agent name
   */
  isAwaitingAgentName(userId: string): boolean {
    const context = this.contexts.get(userId);
    return context?.currentFlow === 'create_agent' && context?.flowState === 'awaiting_name';
  }

  /**
   * Check if we're awaiting emoji selection
   */
  isAwaitingEmoji(userId: string): boolean {
    const context = this.contexts.get(userId);
    return context?.currentFlow === 'create_agent' && context?.flowState === 'awaiting_emoji';
  }

  /**
   * Check if we're awaiting workspace choice
   */
  isAwaitingWorkspaceChoice(userId: string): boolean {
    const context = this.contexts.get(userId);
    return context?.currentFlow === 'create_agent' && context?.flowState === 'awaiting_workspace_choice';
  }

  /**
   * Check if we're awaiting custom workspace input
   */
  isAwaitingWorkspace(userId: string): boolean {
    const context = this.contexts.get(userId);
    return context?.currentFlow === 'create_agent' && context?.flowState === 'awaiting_workspace';
  }

  /**
   * Check if we're awaiting confirmation in create flow
   */
  isAwaitingCreateConfirmation(userId: string): boolean {
    const context = this.contexts.get(userId);
    return context?.currentFlow === 'create_agent' && context?.flowState === 'awaiting_confirmation';
  }

  // ============================================
  // Edit Emoji Flow
  // States: awaiting_emoji_text
  // ============================================

  /**
   * Start the edit emoji flow
   */
  startEditEmojiFlow(userId: string, agentId: string): void {
    this.contexts.set(userId, {
      userId,
      currentFlow: 'edit_emoji',
      flowState: 'awaiting_emoji_text',
      flowData: { agentId },
    });
  }

  /**
   * Get the data for edit emoji flow
   */
  getEditEmojiData(userId: string): { agentId?: string } | undefined {
    const context = this.contexts.get(userId);
    if (!context || context.currentFlow !== 'edit_emoji') {
      return undefined;
    }
    return {
      agentId: context.flowData?.agentId as string | undefined,
    };
  }

  /**
   * Check if we're awaiting emoji text input
   */
  isAwaitingEmojiText(userId: string): boolean {
    const context = this.contexts.get(userId);
    return context?.currentFlow === 'edit_emoji' && context?.flowState === 'awaiting_emoji_text';
  }

  // ============================================
  // Configure Priority Flow
  // States: awaiting_selection (if no agentId) → awaiting_priority
  // ============================================

  /**
   * Start the configure priority flow
   * If agentId is provided, skips agent selection step
   */
  startConfigurePriorityFlow(userId: string, agentId?: string): void {
    if (agentId) {
      // Pre-selected agent - go directly to priority selection
      this.contexts.set(userId, {
        userId,
        currentFlow: 'configure_priority',
        flowState: 'awaiting_selection', // We'll use this state for priority selection too
        flowData: { agentId },
      });
    } else {
      // Need to select agent first
      this.contexts.set(userId, {
        userId,
        currentFlow: 'configure_priority',
        flowState: 'awaiting_selection',
        flowData: {},
      });
    }
  }

  /**
   * Set the agent ID in configure priority flow
   */
  setConfigurePriorityAgent(userId: string, agentId: string): void {
    const context = this.contexts.get(userId);
    if (!context || context.currentFlow !== 'configure_priority') {
      throw new Error('Not in configure priority flow');
    }

    context.flowData = {
      ...context.flowData,
      agentId,
    };
    this.contexts.set(userId, context);
  }

  /**
   * Get the data collected during configure priority flow
   */
  getConfigurePriorityData(userId: string): { agentId?: string } | undefined {
    const context = this.contexts.get(userId);
    if (!context || context.currentFlow !== 'configure_priority') {
      return undefined;
    }
    return {
      agentId: context.flowData?.agentId as string | undefined,
    };
  }

  /**
   * Check if we're in configure priority flow
   */
  isInConfigurePriorityFlow(userId: string): boolean {
    return this.contexts.get(userId)?.currentFlow === 'configure_priority';
  }

  /**
   * Check if priority flow needs agent selection
   */
  needsAgentSelection(userId: string): boolean {
    const context = this.contexts.get(userId);
    return (
      context?.currentFlow === 'configure_priority' &&
      context?.flowState === 'awaiting_selection' &&
      !context?.flowData?.agentId
    );
  }

  // ============================================
  // Configure Limit Flow
  // States: awaiting_selection (for limit option)
  // ============================================

  /**
   * Start the configure limit flow
   */
  startConfigureLimitFlow(userId: string): void {
    this.contexts.set(userId, {
      userId,
      currentFlow: 'configure_limit',
      flowState: 'awaiting_selection',
      flowData: {},
    });
  }

  /**
   * Check if we're in configure limit flow
   */
  isInConfigureLimitFlow(userId: string): boolean {
    return this.contexts.get(userId)?.currentFlow === 'configure_limit';
  }

  // ============================================
  // Delete Agent Flow
  // States: awaiting_confirmation
  // ============================================

  /**
   * Start the delete agent flow
   */
  startDeleteAgentFlow(userId: string, agentId: string): void {
    this.contexts.set(userId, {
      userId,
      currentFlow: 'delete_agent',
      flowState: 'awaiting_confirmation',
      flowData: { agentId },
    });
  }

  /**
   * Get the data collected during delete agent flow
   */
  getDeleteAgentData(userId: string): { agentId?: string } | undefined {
    const context = this.contexts.get(userId);
    if (!context || context.currentFlow !== 'delete_agent') {
      return undefined;
    }
    return {
      agentId: context.flowData?.agentId as string | undefined,
    };
  }

  /**
   * Check if we're awaiting delete confirmation
   */
  isAwaitingDeleteConfirmation(userId: string): boolean {
    const context = this.contexts.get(userId);
    return context?.currentFlow === 'delete_agent' && context?.flowState === 'awaiting_confirmation';
  }

  // ============================================
  // Pending Prompt Management
  // ============================================

  /**
   * Store a pending prompt for a user
   * Used when user sends a prompt and needs to select agent/model
   */
  setPendingPrompt(
    userId: string,
    text: string,
    messageId?: string,
    images?: Array<{ data: string; mimeType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' }>
  ): void {
    const context = this.contexts.get(userId) ?? { userId };
    context.pendingPrompt = { text, messageId, images };
    this.contexts.set(userId, context);
  }

  /**
   * Get the pending prompt for a user
   */
  getPendingPrompt(userId: string): {
    text: string;
    messageId?: string;
    images?: Array<{ data: string; mimeType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' }>;
  } | undefined {
    return this.contexts.get(userId)?.pendingPrompt;
  }

  /**
   * Clear the pending prompt for a user
   */
  clearPendingPrompt(userId: string): void {
    const context = this.contexts.get(userId);
    if (context) {
      delete context.pendingPrompt;
      // If there's no other context, remove the entry entirely
      if (!context.currentFlow) {
        this.contexts.delete(userId);
      } else {
        this.contexts.set(userId, context);
      }
    }
  }

  /**
   * Check if user has a pending prompt
   */
  hasPendingPrompt(userId: string): boolean {
    return this.contexts.get(userId)?.pendingPrompt !== undefined;
  }

  // ============================================
  // Last Choice Management
  // ============================================

  /**
   * Store the user's last agent+model choice
   */
  setLastChoice(
    userId: string,
    agentId: string,
    agentName: string,
    model: 'haiku' | 'sonnet' | 'opus'
  ): void {
    const context = this.contexts.get(userId) ?? { userId };
    context.lastChoice = { agentId, agentName, model };
    this.contexts.set(userId, context);
  }

  /**
   * Get the user's last agent+model choice
   */
  getLastChoice(userId: string): { agentId: string; agentName: string; model: 'haiku' | 'sonnet' | 'opus' } | undefined {
    return this.contexts.get(userId)?.lastChoice;
  }

  /**
   * Check if user has a last choice stored
   */
  hasLastChoice(userId: string): boolean {
    return this.contexts.get(userId)?.lastChoice !== undefined;
  }

  /**
   * Clear the last choice for a user
   */
  clearLastChoice(userId: string): void {
    const context = this.contexts.get(userId);
    if (context) {
      delete context.lastChoice;
      this.contexts.set(userId, context);
    }
  }

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Complete a flow and clear the context
   * Use after successful flow completion
   */
  completeFlow(userId: string): void {
    const context = this.contexts.get(userId);
    if (context) {
      // Keep pending prompt if it exists
      const pendingPrompt = context.pendingPrompt;
      if (pendingPrompt) {
        this.contexts.set(userId, { userId, pendingPrompt });
      } else {
        this.contexts.delete(userId);
      }
    }
  }

  /**
   * Cancel the current flow
   * Keeps pending prompt if it exists
   */
  cancelFlow(userId: string): void {
    this.completeFlow(userId);
  }

  /**
   * Get all active contexts (for debugging)
   */
  getAllContexts(): Map<string, UserContext> {
    return new Map(this.contexts);
  }

  /**
   * Clear all contexts (for testing)
   */
  clearAll(): void {
    this.contexts.clear();
  }

  // ============================================
  // Bash Mode Management
  // ============================================

  /**
   * Enable bash mode for a user
   */
  enableBashMode(userId: string): void {
    const context = this.contexts.get(userId) ?? { userId };
    context.bashMode = true;
    this.contexts.set(userId, context);
  }

  /**
   * Disable bash mode for a user
   */
  disableBashMode(userId: string): void {
    const context = this.contexts.get(userId);
    if (context) {
      context.bashMode = false;
      this.contexts.set(userId, context);
    }
  }

  /**
   * Check if user is in bash mode
   */
  isInBashMode(userId: string): boolean {
    return this.contexts.get(userId)?.bashMode === true;
  }

  /**
   * Set the last bash workspace used
   */
  setLastBashWorkspace(userId: string, workspace: string): void {
    const context = this.contexts.get(userId) ?? { userId };
    context.lastBashWorkspace = workspace;
    this.contexts.set(userId, context);
  }

  /**
   * Get the last bash workspace used
   */
  getLastBashWorkspace(userId: string): string | undefined {
    return this.contexts.get(userId)?.lastBashWorkspace;
  }

  // ============================================
  // Create Agent Flow - Type Selection
  // ============================================

  /**
   * Set the agent type in the create flow
   * Advances state to awaiting_emoji
   */
  setAgentType(userId: string, type: 'claude' | 'bash'): void {
    const context = this.contexts.get(userId);
    if (!context || context.currentFlow !== 'create_agent') {
      throw new Error('Not in create agent flow');
    }

    context.flowData = {
      ...context.flowData,
      agentType: type,
    };
    context.flowState = 'awaiting_emoji';
    this.contexts.set(userId, context);
  }

  /**
   * Check if we're awaiting type selection
   */
  isAwaitingType(userId: string): boolean {
    const context = this.contexts.get(userId);
    return context?.currentFlow === 'create_agent' && context?.flowState === 'awaiting_type';
  }

  // ============================================
  // Failed Transcription Management
  // ============================================

  /**
   * Mark that a transcription failed (for manual fallback)
   */
  setFailedTranscription(userId: string, failed: boolean): void {
    const context = this.contexts.get(userId) ?? { userId };
    (context as any).failedTranscription = failed;
    this.contexts.set(userId, context);
  }

  /**
   * Check if user has a failed transcription pending
   */
  hasFailedTranscription(userId: string): boolean {
    return (this.contexts.get(userId) as any)?.failedTranscription === true;
  }

  /**
   * Clear the failed transcription flag
   */
  clearFailedTranscription(userId: string): void {
    const context = this.contexts.get(userId);
    if (context) {
      delete (context as any).failedTranscription;
      this.contexts.set(userId, context);
    }
  }

  // ============================================
  // Configure Ralph Flow
  // States: awaiting_ralph_task → awaiting_ralph_max_iterations → awaiting_confirmation
  // ============================================

  /**
   * Start the configure Ralph flow
   * Begins collecting Ralph loop configuration (task, max iterations)
   */
  startConfigureRalphFlow(userId: string, agentId: string): void {
    this.contexts.set(userId, {
      userId,
      currentFlow: 'configure_ralph',
      flowState: 'awaiting_ralph_task',
      flowData: { agentId },
    });
  }

  /**
   * Set the Ralph task in the configure flow
   * Advances state to awaiting_ralph_max_iterations
   */
  setRalphTask(userId: string, task: string): void {
    const context = this.contexts.get(userId);
    if (!context || context.currentFlow !== 'configure_ralph') {
      throw new Error('Not in configure Ralph flow');
    }

    context.flowData = {
      ...context.flowData,
      ralphTask: task,
    };
    context.flowState = 'awaiting_ralph_max_iterations';
    this.contexts.set(userId, context);
  }

  /**
   * Set the Ralph max iterations in the configure flow
   * Advances state to awaiting_confirmation
   */
  setRalphMaxIterations(userId: string, maxIterations: number): void {
    const context = this.contexts.get(userId);
    if (!context || context.currentFlow !== 'configure_ralph') {
      throw new Error('Not in configure Ralph flow');
    }

    if (maxIterations < 1 || maxIterations > 100) {
      throw new Error('Max iterations must be between 1 and 100');
    }

    context.flowData = {
      ...context.flowData,
      ralphMaxIterations: maxIterations,
    };
    context.flowState = 'awaiting_confirmation';
    this.contexts.set(userId, context);
  }

  /**
   * Get the data collected during configure Ralph flow
   */
  getRalphConfigData(userId: string): {
    agentId?: string;
    ralphTask?: string;
    ralphMaxIterations?: number;
    ralphModel?: 'haiku' | 'sonnet' | 'opus';
  } | undefined {
    const context = this.contexts.get(userId);
    if (!context || context.currentFlow !== 'configure_ralph') {
      return undefined;
    }
    return {
      agentId: context.flowData?.agentId as string | undefined,
      ralphTask: context.flowData?.ralphTask as string | undefined,
      ralphMaxIterations: context.flowData?.ralphMaxIterations as number | undefined,
      ralphModel: context.flowData?.ralphModel as 'haiku' | 'sonnet' | 'opus' | undefined,
    };
  }

  /**
   * Check if we're in configure Ralph flow
   */
  isInConfigureRalphFlow(userId: string): boolean {
    return this.contexts.get(userId)?.currentFlow === 'configure_ralph';
  }

  /**
   * Check if we're awaiting Ralph task input
   */
  isAwaitingRalphTask(userId: string): boolean {
    const context = this.contexts.get(userId);
    return context?.currentFlow === 'configure_ralph' && context?.flowState === 'awaiting_ralph_task';
  }

  /**
   * Check if we're awaiting Ralph max iterations input
   */
  isAwaitingRalphMaxIterations(userId: string): boolean {
    const context = this.contexts.get(userId);
    return context?.currentFlow === 'configure_ralph' && context?.flowState === 'awaiting_ralph_max_iterations';
  }

  /**
   * Check if we're awaiting Ralph configuration confirmation
   */
  isAwaitingRalphConfirmation(userId: string): boolean {
    const context = this.contexts.get(userId);
    return context?.currentFlow === 'configure_ralph' && context?.flowState === 'awaiting_confirmation';
  }

  /**
   * Set Ralph model selection in configure flow
   */
  setRalphModel(userId: string, model: 'haiku' | 'sonnet' | 'opus'): void {
    const context = this.contexts.get(userId);
    if (!context || context.currentFlow !== 'configure_ralph') {
      throw new Error('Not in configure Ralph flow');
    }

    context.flowData = {
      ...context.flowData,
      ralphModel: model,
    };
    this.contexts.set(userId, context);
  }
}
