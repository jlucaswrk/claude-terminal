import type { AgentManager } from './agent-manager';
import type { ModelMode } from './types';

export type RouteAction =
  | 'menu'           // Show main menu
  | 'status'         // Show all agents status
  | 'reset_all'      // Reset all agents
  | 'bash'           // Execute bash command
  | 'prompt'         // Send prompt to agent
  | 'reject_prompt'  // Reject prompt on main number
  | 'reject_unlinked_group';  // Message from unlinked group

export interface RouteResult {
  action: RouteAction;
  agentId?: string;
  text?: string;
  command?: string;
  model?: 'haiku' | 'sonnet' | 'opus';
}

/**
 * MessageRouter determines how to handle incoming messages
 * based on whether they come from the main number or a group
 */
export class MessageRouter {
  constructor(
    private readonly agentManager: AgentManager,
    private readonly mainUserPhone: string
  ) {}

  /**
   * Route an incoming text message
   */
  route(from: string, groupId: string | undefined, text: string): RouteResult {
    // Normalize phone
    const normalizedFrom = from.replace('+', '');
    const normalizedMain = this.mainUserPhone.replace('+', '');

    // Message from a group
    if (groupId) {
      return this.routeGroupMessage(groupId, text);
    }

    // Message from main number (command center)
    if (normalizedFrom.endsWith(normalizedMain)) {
      return this.routeMainMessage(text);
    }

    // Unknown sender
    return { action: 'reject_prompt' };
  }

  private routeMainMessage(text: string): RouteResult {
    const trimmed = text.trim();

    // Commands
    if (trimmed === '/') {
      return { action: 'menu' };
    }
    if (trimmed === '/status') {
      return { action: 'status' };
    }
    if (trimmed === '/reset all') {
      return { action: 'reset_all' };
    }

    // Bash prefix
    if (trimmed.startsWith('$ ')) {
      return { action: 'bash', command: trimmed.slice(2) };
    }
    if (trimmed.startsWith('> ')) {
      return { action: 'bash', command: trimmed.slice(2) };
    }

    // Any other text is rejected
    return { action: 'reject_prompt' };
  }

  private routeGroupMessage(groupId: string, text: string): RouteResult {
    // Find agent linked to this group
    const agent = this.agentManager.getAgentByGroupId(groupId);
    if (!agent) {
      return { action: 'reject_unlinked_group' };
    }

    // Parse model prefix (!haiku, !sonnet, !opus)
    const { model, cleanText } = this.parseModelPrefix(text);

    return {
      action: 'prompt',
      agentId: agent.id,
      text: cleanText,
      model: model || this.getDefaultModel(agent.modelMode),
    };
  }

  private parseModelPrefix(text: string): { model?: 'haiku' | 'sonnet' | 'opus'; cleanText: string } {
    const trimmed = text.trim();

    if (trimmed.startsWith('!haiku ')) {
      return { model: 'haiku', cleanText: trimmed.slice(7).trim() };
    }
    if (trimmed.startsWith('!sonnet ')) {
      return { model: 'sonnet', cleanText: trimmed.slice(8).trim() };
    }
    if (trimmed.startsWith('!opus ')) {
      return { model: 'opus', cleanText: trimmed.slice(6).trim() };
    }

    return { cleanText: trimmed };
  }

  private getDefaultModel(modelMode: ModelMode): 'haiku' | 'sonnet' | 'opus' | undefined {
    if (modelMode === 'selection') {
      return undefined; // Will trigger model selection UI
    }
    return modelMode;
  }
}
