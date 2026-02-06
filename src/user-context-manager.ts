/**
 * UserContextManager - Manages conversational state for multi-step flows
 *
 * Tracks user state during multi-step interactions like creating agents,
 * configuring priorities, etc. All state is in-memory (not persisted).
 */

import type { UserContext, ModelMode, UserMode } from './types';

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
   * Update the context for a user (alias for setContext, clearer intent)
   */
  updateContext(userId: string, context: UserContext): void {
    this.contexts.set(userId, context);
  }

  /**
   * Clear the context for a user (after flow completion)
   * Preserves activeAgentId and pendingPrompt for continuous conversations
   */
  clearContext(userId: string): void {
    const context = this.contexts.get(userId);
    if (context) {
      const { activeAgentId, pendingPrompt } = context;
      // Only preserve if there's something to preserve
      if (activeAgentId || pendingPrompt) {
        this.contexts.set(userId, { userId, activeAgentId, pendingPrompt });
      } else {
        this.contexts.delete(userId);
      }
    }
  }

  // ============================================
  // Active Agent Management (for continuous conversations)
  // ============================================

  /**
   * Set the active agent for a user
   * Used to route subsequent messages without re-prompting for agent selection
   */
  setActiveAgent(userId: string, agentId: string): void {
    const context = this.contexts.get(userId) ?? { userId };
    context.activeAgentId = agentId;
    this.contexts.set(userId, context);
  }

  /**
   * Get the active agent for a user
   */
  getActiveAgent(userId: string): string | undefined {
    return this.contexts.get(userId)?.activeAgentId;
  }

  /**
   * Clear the active agent for a user
   * Called on explicit user action (switching agents, logout, etc.)
   */
  clearActiveAgent(userId: string): void {
    const context = this.contexts.get(userId);
    if (context) {
      delete context.activeAgentId;
      // Clean up if nothing left
      if (!context.currentFlow && !context.pendingPrompt && !context.lastChoice && !context.bashMode) {
        this.contexts.delete(userId);
      } else {
        this.contexts.set(userId, context);
      }
    }
  }

  /**
   * Check if user has an active agent
   */
  hasActiveAgent(userId: string): boolean {
    return this.contexts.get(userId)?.activeAgentId !== undefined;
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
  // States: awaiting_name → awaiting_type → awaiting_emoji → awaiting_mode → awaiting_workspace_choice → (awaiting_workspace) → awaiting_model_mode → awaiting_confirmation
  // ============================================

  /**
   * Start the create agent flow
   * Preserves activeAgentId and pendingPrompt for continuous conversation support
   */
  startCreateAgentFlow(userId: string): void {
    const existingContext = this.contexts.get(userId);
    this.contexts.set(userId, {
      userId,
      activeAgentId: existingContext?.activeAgentId,
      pendingPrompt: existingContext?.pendingPrompt,
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
   * Advances state to awaiting_mode
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
    context.flowState = 'awaiting_mode';
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
   * Advances state to awaiting_model_mode
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
    context.flowState = 'awaiting_model_mode';
    this.contexts.set(userId, context);
  }

  /**
   * Get the data collected during create agent flow
   */
  getCreateAgentData(userId: string): {
    agentName?: string;
    agentType?: 'claude' | 'bash';
    emoji?: string;
    agentMode?: 'conversational' | 'ralph';
    workspace?: string;
    modelMode?: ModelMode;
  } | undefined {
    const context = this.contexts.get(userId);
    if (!context || context.currentFlow !== 'create_agent') {
      return undefined;
    }
    return {
      agentName: context.flowData?.agentName as string | undefined,
      agentType: context.flowData?.agentType as 'claude' | 'bash' | undefined,
      emoji: context.flowData?.emoji as string | undefined,
      agentMode: context.flowData?.agentMode as 'conversational' | 'ralph' | undefined,
      workspace: context.flowData?.workspace as string | undefined,
      modelMode: context.flowData?.modelMode as ModelMode | undefined,
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
   * Set agent mode (conversational/ralph) in create flow
   * Advances state to awaiting_workspace_choice
   */
  setAgentMode(userId: string, mode: 'conversational' | 'ralph'): void {
    const context = this.contexts.get(userId);
    if (!context || context.currentFlow !== 'create_agent') {
      throw new Error('Not in create agent flow');
    }

    context.flowData = {
      ...context.flowData,
      agentMode: mode,
    };
    context.flowState = 'awaiting_workspace_choice';
    this.contexts.set(userId, context);
  }

  /**
   * Check if awaiting agent mode selection
   */
  isAwaitingAgentMode(userId: string): boolean {
    const context = this.contexts.get(userId);
    return context?.currentFlow === 'create_agent' && context?.flowState === 'awaiting_mode';
  }

  /**
   * Set model mode in create flow
   * Advances state to awaiting_confirmation
   */
  setAgentModelMode(userId: string, modelMode: ModelMode): void {
    const context = this.contexts.get(userId);
    if (!context || context.currentFlow !== 'create_agent') {
      throw new Error('Not in create agent flow');
    }

    context.flowData = {
      ...context.flowData,
      modelMode,
    };
    context.flowState = 'awaiting_confirmation';
    this.contexts.set(userId, context);
  }

  /**
   * Check if awaiting model mode selection
   */
  isAwaitingModelMode(userId: string): boolean {
    const context = this.contexts.get(userId);
    return context?.currentFlow === 'create_agent' && context?.flowState === 'awaiting_model_mode';
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
   * Preserves activeAgentId and pendingPrompt for continuous conversation support
   */
  startEditEmojiFlow(userId: string, agentId: string): void {
    const existingContext = this.contexts.get(userId);
    this.contexts.set(userId, {
      userId,
      activeAgentId: existingContext?.activeAgentId,
      pendingPrompt: existingContext?.pendingPrompt,
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
  // Edit Agent Name Flow
  // States: awaiting_name
  // ============================================

  /**
   * Start the edit agent name flow
   * Preserves activeAgentId and pendingPrompt for continuous conversation support
   */
  startEditNameFlow(userId: string, agentId: string): void {
    const existingContext = this.contexts.get(userId);
    this.contexts.set(userId, {
      userId,
      activeAgentId: existingContext?.activeAgentId,
      pendingPrompt: existingContext?.pendingPrompt,
      currentFlow: 'edit_name',
      flowState: 'awaiting_name',
      flowData: { agentId },
    });
  }

  /**
   * Get the data for edit name flow
   */
  getEditNameData(userId: string): { agentId?: string } | undefined {
    const context = this.contexts.get(userId);
    if (!context || context.currentFlow !== 'edit_name') {
      return undefined;
    }
    return {
      agentId: context.flowData?.agentId as string | undefined,
    };
  }

  /**
   * Check if we're awaiting name input for edit
   */
  isAwaitingEditName(userId: string): boolean {
    const context = this.contexts.get(userId);
    return context?.currentFlow === 'edit_name' && context?.flowState === 'awaiting_name';
  }

  // ============================================
  // Configure Priority Flow
  // States: awaiting_selection (if no agentId) → awaiting_priority
  // ============================================

  /**
   * Start the configure priority flow
   * If agentId is provided, skips agent selection step
   * Preserves activeAgentId and pendingPrompt for continuous conversation support
   */
  startConfigurePriorityFlow(userId: string, agentId?: string): void {
    const existingContext = this.contexts.get(userId);
    if (agentId) {
      // Pre-selected agent - go directly to priority selection
      this.contexts.set(userId, {
        userId,
        activeAgentId: existingContext?.activeAgentId,
        pendingPrompt: existingContext?.pendingPrompt,
        currentFlow: 'configure_priority',
        flowState: 'awaiting_selection', // We'll use this state for priority selection too
        flowData: { agentId },
      });
    } else {
      // Need to select agent first
      this.contexts.set(userId, {
        userId,
        activeAgentId: existingContext?.activeAgentId,
        pendingPrompt: existingContext?.pendingPrompt,
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
   * Preserves activeAgentId and pendingPrompt for continuous conversation support
   */
  startConfigureLimitFlow(userId: string): void {
    const existingContext = this.contexts.get(userId);
    this.contexts.set(userId, {
      userId,
      activeAgentId: existingContext?.activeAgentId,
      pendingPrompt: existingContext?.pendingPrompt,
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
   * Preserves activeAgentId and pendingPrompt for continuous conversation support
   */
  startDeleteAgentFlow(userId: string, agentId: string): void {
    const existingContext = this.contexts.get(userId);
    this.contexts.set(userId, {
      userId,
      activeAgentId: existingContext?.activeAgentId,
      pendingPrompt: existingContext?.pendingPrompt,
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
   * Preserves activeAgentId and pendingPrompt for continuous conversation support
   */
  completeFlow(userId: string): void {
    const context = this.contexts.get(userId);
    if (context) {
      const { activeAgentId, pendingPrompt } = context;
      // Preserve activeAgentId and pendingPrompt if they exist
      if (activeAgentId || pendingPrompt) {
        this.contexts.set(userId, { userId, activeAgentId, pendingPrompt });
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
   * Preserves activeAgentId and pendingPrompt for continuous conversation support
   */
  startConfigureRalphFlow(userId: string, agentId: string): void {
    const existingContext = this.contexts.get(userId);
    this.contexts.set(userId, {
      userId,
      activeAgentId: existingContext?.activeAgentId,
      pendingPrompt: existingContext?.pendingPrompt,
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

  // ============================================
  // Onboarding Flow
  // States: awaiting_mode_selection → (awaiting_telegram_username for dojo) → complete
  // ============================================

  /**
   * Start the onboarding flow for mode selection
   * Preserves activeAgentId and pendingPrompt for continuous conversation support
   */
  startOnboardingFlow(userId: string): void {
    const existingContext = this.contexts.get(userId);
    this.contexts.set(userId, {
      userId,
      activeAgentId: existingContext?.activeAgentId,
      pendingPrompt: existingContext?.pendingPrompt,
      currentFlow: 'onboarding',
      flowState: 'awaiting_mode_selection',
      flowData: {},
    });
  }

  /**
   * Start prompt flow for Telegram - stores agentId and waits for text
   * Also sets activeAgentId for continuous conversation support
   */
  startPromptFlow(userId: string, agentId: string): void {
    const existingContext = this.contexts.get(userId) ?? { userId };
    this.contexts.set(userId, {
      ...existingContext,
      userId,
      activeAgentId: agentId,
      flowData: { agentId },
    });
  }

  /**
   * Check if user has a pending prompt flow (waiting for text)
   */
  hasPendingPromptFlow(userId: string): boolean {
    const context = this.contexts.get(userId);
    return !!context?.flowData?.agentId && !context?.pendingPrompt;
  }

  /**
   * Get the pending agent ID for prompt flow
   */
  getPendingAgentId(userId: string): string | undefined {
    const context = this.contexts.get(userId);
    return context?.flowData?.agentId as string | undefined;
  }

  /**
   * Check if user is awaiting mode selection
   */
  isAwaitingModeSelection(userId: string): boolean {
    const context = this.contexts.get(userId);
    return context?.currentFlow === 'onboarding' && context?.flowState === 'awaiting_mode_selection';
  }

  /**
   * Set the user mode (ronin or dojo)
   */
  setUserMode(userId: string, mode: UserMode): void {
    const context = this.contexts.get(userId);
    if (!context) return;

    context.flowData = { ...context.flowData, userMode: mode };

    if (mode === 'dojo') {
      context.flowState = 'awaiting_telegram_username';
    } else {
      // Ronin mode - complete onboarding
      this.contexts.delete(userId);
    }
  }

  /**
   * Check if user is awaiting telegram username
   */
  isAwaitingTelegramUsername(userId: string): boolean {
    const context = this.contexts.get(userId);
    return context?.currentFlow === 'onboarding' && context?.flowState === 'awaiting_telegram_username';
  }

  /**
   * Set telegram username (completes dojo onboarding)
   */
  setTelegramUsername(userId: string, username: string): void {
    const context = this.contexts.get(userId);
    if (!context) return;

    context.flowData = { ...context.flowData, telegramUsername: username };
    // Flow data is preserved for the caller to use, then they clear context
  }

  // ============================================
  // Topic Creation Flows
  // States for topic_ralph: awaiting_topic_task → awaiting_topic_iterations → complete
  // States for topic_worktree/topic_sessao: awaiting_topic_name → complete
  // ============================================

  /**
   * Start the Ralph topic creation flow
   * @param userId - User ID
   * @param agentId - Agent ID
   * @param telegramChatId - Telegram chat ID for the flow
   * @param task - Optional task if provided inline with command
   */
  startTopicRalphFlow(userId: string, agentId: string, telegramChatId: number, task?: string): void {
    const existingContext = this.contexts.get(userId);
    this.contexts.set(userId, {
      userId,
      activeAgentId: existingContext?.activeAgentId,
      pendingPrompt: existingContext?.pendingPrompt,
      currentFlow: 'topic_ralph',
      flowState: task ? 'awaiting_topic_iterations' : 'awaiting_topic_task',
      flowData: {
        agentId,
        telegramChatId,
        topicTask: task,
      },
    });
  }

  /**
   * Check if user is in a topic Ralph flow
   */
  isInTopicRalphFlow(userId: string): boolean {
    return this.contexts.get(userId)?.currentFlow === 'topic_ralph';
  }

  /**
   * Check if we're awaiting topic task input
   */
  isAwaitingTopicTask(userId: string): boolean {
    const context = this.contexts.get(userId);
    return context?.currentFlow === 'topic_ralph' && context?.flowState === 'awaiting_topic_task';
  }

  /**
   * Set the topic task description
   */
  setTopicTask(userId: string, task: string): void {
    const context = this.contexts.get(userId);
    if (!context || context.currentFlow !== 'topic_ralph') {
      throw new Error('Not in topic Ralph flow');
    }

    context.flowData = {
      ...context.flowData,
      topicTask: task,
    };
    context.flowState = 'awaiting_topic_iterations';
    this.contexts.set(userId, context);
  }

  /**
   * Check if we're awaiting topic max iterations
   */
  isAwaitingTopicIterations(userId: string): boolean {
    const context = this.contexts.get(userId);
    return context?.currentFlow === 'topic_ralph' && context?.flowState === 'awaiting_topic_iterations';
  }

  /**
   * Set the topic max iterations
   */
  setTopicMaxIterations(userId: string, maxIterations: number): void {
    const context = this.contexts.get(userId);
    if (!context || context.currentFlow !== 'topic_ralph') {
      throw new Error('Not in topic Ralph flow');
    }

    context.flowData = {
      ...context.flowData,
      topicMaxIterations: maxIterations,
    };
    this.contexts.set(userId, context);
  }

  /**
   * Get the topic Ralph flow data
   */
  getTopicRalphData(userId: string): {
    agentId?: string;
    telegramChatId?: number;
    topicTask?: string;
    topicMaxIterations?: number;
  } | undefined {
    const context = this.contexts.get(userId);
    if (!context || context.currentFlow !== 'topic_ralph') {
      return undefined;
    }
    return {
      agentId: context.flowData?.agentId as string | undefined,
      telegramChatId: context.flowData?.telegramChatId as number | undefined,
      topicTask: context.flowData?.topicTask as string | undefined,
      topicMaxIterations: context.flowData?.topicMaxIterations as number | undefined,
    };
  }

  /**
   * Start the worktree topic creation flow
   * @param userId - User ID
   * @param agentId - Agent ID
   * @param telegramChatId - Telegram chat ID for the flow
   * @param name - Optional name if provided inline with command
   */
  startTopicWorktreeFlow(userId: string, agentId: string, telegramChatId: number, name?: string): void {
    const existingContext = this.contexts.get(userId);

    // If name is provided, flow completes immediately (no state needed)
    if (name) {
      this.contexts.set(userId, {
        userId,
        activeAgentId: existingContext?.activeAgentId,
        pendingPrompt: existingContext?.pendingPrompt,
        currentFlow: 'topic_worktree',
        flowState: undefined,
        flowData: {
          agentId,
          telegramChatId,
          topicName: name,
        },
      });
    } else {
      this.contexts.set(userId, {
        userId,
        activeAgentId: existingContext?.activeAgentId,
        pendingPrompt: existingContext?.pendingPrompt,
        currentFlow: 'topic_worktree',
        flowState: 'awaiting_topic_name',
        flowData: {
          agentId,
          telegramChatId,
        },
      });
    }
  }

  /**
   * Check if user is in a topic worktree flow
   */
  isInTopicWorktreeFlow(userId: string): boolean {
    return this.contexts.get(userId)?.currentFlow === 'topic_worktree';
  }

  /**
   * Start the session topic creation flow
   * @param userId - User ID
   * @param agentId - Agent ID
   * @param telegramChatId - Telegram chat ID for the flow
   * @param name - Optional name if provided inline with command
   */
  startTopicSessaoFlow(userId: string, agentId: string, telegramChatId: number, name?: string): void {
    const existingContext = this.contexts.get(userId);

    // If name is provided, flow completes immediately (no state needed)
    if (name) {
      this.contexts.set(userId, {
        userId,
        activeAgentId: existingContext?.activeAgentId,
        pendingPrompt: existingContext?.pendingPrompt,
        currentFlow: 'topic_sessao',
        flowState: undefined,
        flowData: {
          agentId,
          telegramChatId,
          topicName: name,
        },
      });
    } else {
      this.contexts.set(userId, {
        userId,
        activeAgentId: existingContext?.activeAgentId,
        pendingPrompt: existingContext?.pendingPrompt,
        currentFlow: 'topic_sessao',
        flowState: 'awaiting_topic_name',
        flowData: {
          agentId,
          telegramChatId,
        },
      });
    }
  }

  /**
   * Check if user is in a topic session flow
   */
  isInTopicSessaoFlow(userId: string): boolean {
    return this.contexts.get(userId)?.currentFlow === 'topic_sessao';
  }

  /**
   * Check if we're awaiting topic name input (for worktree or sessao)
   */
  isAwaitingTopicName(userId: string): boolean {
    const context = this.contexts.get(userId);
    return (context?.currentFlow === 'topic_worktree' || context?.currentFlow === 'topic_sessao')
      && context?.flowState === 'awaiting_topic_name';
  }

  /**
   * Set the topic name
   */
  setTopicName(userId: string, name: string): void {
    const context = this.contexts.get(userId);
    if (!context || (context.currentFlow !== 'topic_worktree' && context.currentFlow !== 'topic_sessao')) {
      throw new Error('Not in topic creation flow');
    }

    context.flowData = {
      ...context.flowData,
      topicName: name,
    };
    context.flowState = undefined; // Flow complete, ready to create
    this.contexts.set(userId, context);
  }

  /**
   * Get the topic creation flow data (for worktree or sessao)
   */
  getTopicCreationData(userId: string): {
    agentId?: string;
    telegramChatId?: number;
    topicName?: string;
    flowType?: 'topic_worktree' | 'topic_sessao';
  } | undefined {
    const context = this.contexts.get(userId);
    if (!context || (context.currentFlow !== 'topic_worktree' && context.currentFlow !== 'topic_sessao')) {
      return undefined;
    }
    return {
      agentId: context.flowData?.agentId as string | undefined,
      telegramChatId: context.flowData?.telegramChatId as number | undefined,
      topicName: context.flowData?.topicName as string | undefined,
      flowType: context.currentFlow,
    };
  }

  /**
   * Check if user is in any topic creation flow
   */
  isInTopicFlow(userId: string): boolean {
    const context = this.contexts.get(userId);
    return context?.currentFlow === 'topic_ralph'
      || context?.currentFlow === 'topic_worktree'
      || context?.currentFlow === 'topic_sessao';
  }
}
