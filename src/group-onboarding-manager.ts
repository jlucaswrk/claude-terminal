/**
 * GroupOnboardingManager - Manages group-scoped onboarding state for Telegram groups
 *
 * Tracks the multi-step process of creating/linking agents from Telegram groups.
 * Enforces single-user locking per group - only one user can configure at a time.
 * All state is in-memory (not persisted across restarts).
 */

import type { GroupOnboardingState, GroupOnboardingStep, ModelMode } from './types';

/**
 * Result of attempting to start onboarding
 */
export interface StartOnboardingResult {
  success: boolean;
  /** If failed, the user ID who has the lock */
  lockedByUserId?: number;
}

/**
 * Partial state update for onboarding data
 */
export interface OnboardingDataUpdate {
  agentName?: string;
  emoji?: string;
  workspace?: string;
  modelMode?: ModelMode;
  selectedAgentId?: string;
}

/**
 * GroupOnboardingManager handles group-scoped onboarding state
 */
export class GroupOnboardingManager {
  private states: Map<number, GroupOnboardingState> = new Map();

  // ============================================
  // Core Onboarding Operations
  // ============================================

  /**
   * Start onboarding for a group
   * Returns success if no active onboarding, or if same user already has lock
   * Returns failure with lockedByUserId if another user has the lock
   */
  startOnboarding(
    chatId: number,
    userId: number,
    initialStep: GroupOnboardingStep = 'awaiting_name'
  ): StartOnboardingResult {
    const existing = this.states.get(chatId);

    // If there's existing onboarding
    if (existing) {
      // Same user - allow restart/continue
      if (existing.userId === userId) {
        // Reset the state for a fresh start
        this.states.set(chatId, {
          chatId,
          userId,
          step: initialStep,
          pinnedMessageId: existing.pinnedMessageId, // Preserve pinned message
          data: {},
          startedAt: new Date(),
        });
        return { success: true };
      }

      // Different user - locked
      return { success: false, lockedByUserId: existing.userId };
    }

    // No existing onboarding - create new
    this.states.set(chatId, {
      chatId,
      userId,
      step: initialStep,
      data: {},
      startedAt: new Date(),
    });

    return { success: true };
  }

  /**
   * Check if a group has active onboarding
   */
  hasActiveOnboarding(chatId: number): boolean {
    return this.states.has(chatId);
  }

  /**
   * Check if onboarding is locked by a specific user
   */
  isLockedByUser(chatId: number, userId: number): boolean {
    const state = this.states.get(chatId);
    return state?.userId === userId;
  }

  /**
   * Get the user ID who has the lock (if any)
   */
  getLockedByUserId(chatId: number): number | undefined {
    return this.states.get(chatId)?.userId;
  }

  /**
   * Get the current onboarding state for a group
   * Returns a cloned copy to prevent external mutation
   */
  getState(chatId: number): GroupOnboardingState | undefined {
    const state = this.states.get(chatId);
    if (!state) {
      return undefined;
    }
    return this.cloneState(state);
  }

  /**
   * Clone a state object to prevent external mutation
   */
  private cloneState(state: GroupOnboardingState): GroupOnboardingState {
    return {
      chatId: state.chatId,
      userId: state.userId,
      step: state.step,
      pinnedMessageId: state.pinnedMessageId,
      data: { ...state.data },
      startedAt: new Date(state.startedAt.getTime()),
    };
  }

  /**
   * Update the onboarding state
   * Only the user who has the lock can update
   * Returns true if updated, false if not authorized
   */
  updateState(
    chatId: number,
    userId: number,
    updates: {
      step?: GroupOnboardingStep;
      data?: OnboardingDataUpdate;
    }
  ): boolean {
    const state = this.states.get(chatId);

    // No active onboarding
    if (!state) {
      return false;
    }

    // Not authorized
    if (state.userId !== userId) {
      return false;
    }

    // Apply updates
    if (updates.step !== undefined) {
      state.step = updates.step;
    }

    if (updates.data !== undefined) {
      state.data = {
        ...state.data,
        ...updates.data,
      };
    }

    this.states.set(chatId, state);
    return true;
  }

  /**
   * Complete onboarding and remove state
   * Only the user who has the lock can complete
   * Returns the final state before removal, or undefined if not authorized
   */
  completeOnboarding(chatId: number, userId: number): GroupOnboardingState | undefined {
    const state = this.states.get(chatId);
    if (!state) {
      return undefined;
    }
    if (state.userId !== userId) {
      return undefined;
    }
    this.states.delete(chatId);
    return this.cloneState(state);
  }

  /**
   * Cancel onboarding and remove state
   * Only the user who has the lock can cancel
   * Returns the cancelled state, or undefined if not authorized
   */
  cancelOnboarding(chatId: number, userId: number): GroupOnboardingState | undefined {
    const state = this.states.get(chatId);
    if (!state) {
      return undefined;
    }
    if (state.userId !== userId) {
      return undefined;
    }
    this.states.delete(chatId);
    return this.cloneState(state);
  }

  // ============================================
  // Pinned Message Management
  // ============================================

  /**
   * Set the pinned message ID for onboarding status
   * Only the user who has the lock can set the pinned message
   * Returns true if set, false if no active onboarding or not authorized
   */
  setPinnedMessageId(chatId: number, userId: number, messageId: number): boolean {
    const state = this.states.get(chatId);
    if (!state) {
      return false;
    }

    if (state.userId !== userId) {
      return false;
    }

    state.pinnedMessageId = messageId;
    this.states.set(chatId, state);
    return true;
  }

  /**
   * Get the pinned message ID
   */
  getPinnedMessageId(chatId: number): number | undefined {
    return this.states.get(chatId)?.pinnedMessageId;
  }

  // ============================================
  // Step Helpers
  // ============================================

  /**
   * Get the current step for a group
   */
  getCurrentStep(chatId: number): GroupOnboardingStep | undefined {
    return this.states.get(chatId)?.step;
  }

  /**
   * Check if at a specific step
   */
  isAtStep(chatId: number, step: GroupOnboardingStep): boolean {
    return this.states.get(chatId)?.step === step;
  }

  /**
   * Advance to the next step
   * Returns true if advanced, false if not authorized or invalid
   */
  advanceStep(chatId: number, userId: number, nextStep: GroupOnboardingStep): boolean {
    return this.updateState(chatId, userId, { step: nextStep });
  }

  // ============================================
  // Data Helpers
  // ============================================

  /**
   * Get the collected data for a group
   * Returns a cloned copy to prevent external mutation
   */
  getData(chatId: number): GroupOnboardingState['data'] | undefined {
    const state = this.states.get(chatId);
    if (!state) {
      return undefined;
    }
    return { ...state.data };
  }

  /**
   * Set the agent name
   */
  setAgentName(chatId: number, userId: number, name: string): boolean {
    return this.updateState(chatId, userId, { data: { agentName: name } });
  }

  /**
   * Set the emoji
   */
  setEmoji(chatId: number, userId: number, emoji: string): boolean {
    return this.updateState(chatId, userId, { data: { emoji } });
  }

  /**
   * Set the workspace
   */
  setWorkspace(chatId: number, userId: number, workspace: string): boolean {
    return this.updateState(chatId, userId, { data: { workspace } });
  }

  /**
   * Set the model mode
   */
  setModelMode(chatId: number, userId: number, modelMode: ModelMode): boolean {
    return this.updateState(chatId, userId, { data: { modelMode } });
  }

  /**
   * Set the selected agent ID (for /link flow)
   */
  setSelectedAgentId(chatId: number, userId: number, agentId: string): boolean {
    return this.updateState(chatId, userId, { data: { selectedAgentId: agentId } });
  }

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Get all active onboarding states (for debugging)
   */
  getAllStates(): Map<number, GroupOnboardingState> {
    return new Map(this.states);
  }

  /**
   * Clear all states (for testing)
   */
  clearAll(): void {
    this.states.clear();
  }

  /**
   * Set the startedAt time for a group (for testing timeout scenarios)
   * Returns true if set, false if no active onboarding
   */
  _setStartedAtForTesting(chatId: number, startedAt: Date): boolean {
    const state = this.states.get(chatId);
    if (!state) {
      return false;
    }
    state.startedAt = startedAt;
    return true;
  }

  /**
   * Get the number of active onboardings
   */
  getActiveCount(): number {
    return this.states.size;
  }

  /**
   * Check if onboarding has timed out (e.g., > 30 minutes)
   * Returns true if timed out and should be cleaned up
   */
  hasTimedOut(chatId: number, timeoutMs: number = 30 * 60 * 1000): boolean {
    const state = this.states.get(chatId);
    if (!state) {
      return false;
    }

    const elapsed = Date.now() - state.startedAt.getTime();
    return elapsed > timeoutMs;
  }

  /**
   * Clean up timed out onboardings
   * Returns array of cleaned up chat IDs
   */
  cleanupTimedOut(timeoutMs: number = 30 * 60 * 1000): number[] {
    const cleanedUp: number[] = [];

    for (const [chatId, state] of this.states) {
      const elapsed = Date.now() - state.startedAt.getTime();
      if (elapsed > timeoutMs) {
        this.states.delete(chatId);
        cleanedUp.push(chatId);
      }
    }

    return cleanedUp;
  }
}
