/**
 * Core type definitions for the multi-agent system
 */

/**
 * Represents a single output/response from an agent
 */
export interface Output {
  id: string;
  summary: string;              // Summary of the action (e.g., "Created 3 files")
  prompt: string;               // Original user prompt
  response: string;             // Complete Claude response
  model: 'haiku' | 'opus';      // Model used
  status: 'success' | 'warning' | 'error';
  timestamp: Date;
}

/**
 * Represents an independent Claude agent
 */
export interface Agent {
  id: string;                   // UUID
  userId: string;               // Owning user ID (phone number)
  name: string;                 // User-provided name
  workspace?: string;           // Absolute path (optional, immutable)
  sessionId?: string;           // Claude session ID (managed by SDK)
  title: string;                // Auto-generated title (3-5 words)
  status: 'idle' | 'processing' | 'error';
  statusDetails: string;        // e.g., "Awaiting prompt", "Creating API endpoints..."
  priority: 'high' | 'medium' | 'low';
  lastActivity: Date;
  messageCount: number;         // Counter for title update triggers
  outputs: Output[];            // Last 10 outputs (FIFO)
  createdAt: Date;
}

/**
 * Tracks conversational state per user for multi-step flows
 */
export interface UserContext {
  userId: string;
  currentFlow?: 'create_agent' | 'configure_priority' | 'configure_limit' | 'delete_agent';
  flowState?: 'awaiting_name' | 'awaiting_workspace' | 'awaiting_confirmation' | 'awaiting_selection';
  flowData?: {
    agentName?: string;
    agentId?: string;
    workspace?: string;
    priority?: string;
    [key: string]: unknown;
  };
  pendingPrompt?: {
    text: string;
    messageId?: string;
  };
}

/**
 * Represents a task in the execution queue
 */
export interface QueueTask {
  id: string;
  agentId: string;
  prompt: string;
  model: 'haiku' | 'opus';
  priority: number;             // 0-2 (high=0, medium=1, low=2)
  timestamp: Date;
  userId: string;
}

/**
 * Global system configuration
 */
export interface SystemConfig {
  maxConcurrent: number;        // Default: 3
  version: string;              // Schema version
}

/**
 * Full state structure for persistence
 */
export interface AgentsState {
  version: string;
  config: SystemConfig;
  agents: Agent[];
}

/**
 * Serialized version of AgentsState for JSON storage
 * (Dates are stored as ISO strings)
 */
export interface SerializedAgentsState {
  version: string;
  config: SystemConfig;
  agents: SerializedAgent[];
}

export interface SerializedAgent {
  id: string;
  userId: string;               // Owning user ID (phone number)
  name: string;
  workspace?: string;
  sessionId?: string;
  title: string;
  status: 'idle' | 'processing' | 'error';
  statusDetails: string;
  priority: 'high' | 'medium' | 'low';
  lastActivity: string;         // ISO date string
  messageCount: number;
  outputs: SerializedOutput[];
  createdAt: string;            // ISO date string
}

export interface SerializedOutput {
  id: string;
  summary: string;
  prompt: string;
  response: string;
  model: 'haiku' | 'opus';
  status: 'success' | 'warning' | 'error';
  timestamp: string;            // ISO date string
}

/**
 * Priority mapping for queue ordering
 */
export const PRIORITY_VALUES: Record<Agent['priority'], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

/**
 * Default values
 */
export const DEFAULTS = {
  MAX_CONCURRENT: 3,
  SCHEMA_VERSION: '1.0',
  MAX_OUTPUTS_PER_AGENT: 10,
  TITLE_UPDATE_INTERVAL: 10,
} as const;
