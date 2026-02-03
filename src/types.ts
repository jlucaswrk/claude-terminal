/**
 * Core type definitions for the multi-agent system
 */

/**
 * Agent type - Claude Code (AI) or Bash (direct terminal)
 */
export type AgentType = 'claude' | 'bash';

/**
 * Output type - standard conversational or Ralph loop summary
 */
export type OutputType = 'standard' | 'ralph-loop';

/**
 * Represents a single output/response from an agent
 */
export interface Output {
  id: string;
  type?: OutputType;            // Type of output (default: 'standard')
  summary: string;              // Summary of the action (e.g., "Created 3 files")
  prompt: string;               // Original user prompt
  response: string;             // Complete Claude response
  model: 'haiku' | 'sonnet' | 'opus' | 'bash';  // Model used (bash for direct execution)
  status: 'success' | 'warning' | 'error';
  timestamp: Date;
  loopId?: string;              // Reference to Ralph loop (if type is 'ralph-loop')
  iterationCount?: number;      // Number of iterations (for ralph-loop outputs)
}

/**
 * Represents an independent Claude agent
 */
export interface Agent {
  id: string;                   // UUID
  userId: string;               // Owning user ID (phone number)
  name: string;                 // User-provided name
  type: AgentType;              // 'claude' (default) or 'bash'
  mode: 'conversational' | 'ralph';  // Agent operation mode
  emoji?: string;               // Visual identifier emoji (default: 🤖)
  workspace?: string;           // Absolute path (optional, immutable)
  sessionId?: string;           // Claude session ID (managed by SDK)
  currentLoopId?: string;       // Active Ralph loop ID (if in ralph mode)
  title: string;                // Auto-generated title (3-5 words)
  status: 'idle' | 'processing' | 'error' | 'ralph-loop' | 'ralph-paused';
  statusDetails: string;        // e.g., "Awaiting prompt", "Creating API endpoints..."
  priority: 'high' | 'medium' | 'low';
  lastActivity: Date;
  messageCount: number;         // Counter for title update triggers
  outputs: Output[];            // Last 10 outputs (FIFO)
  createdAt: Date;
}

/**
 * Represents a single iteration in a Ralph loop
 */
export interface RalphIteration {
  number: number;               // Iteration number (1-based)
  model: 'haiku' | 'sonnet' | 'opus';
  action: string;               // What the agent decided to do
  prompt: string;               // Prompt sent to Claude
  response: string;             // Claude's response
  completionPromiseFound: boolean;  // Whether completion was signaled
  timestamp: Date;
  duration: number;             // milliseconds
}

/**
 * Represents the state of a Ralph autonomous loop
 */
export interface RalphLoopState {
  id: string;                   // UUID for this loop
  agentId: string;              // Agent running this loop
  userId: string;               // User who initiated the loop
  status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  task: string;                 // Original task description
  currentIteration: number;     // Current iteration number
  maxIterations: number;        // Maximum iterations allowed
  iterations: RalphIteration[]; // History of iterations
  currentModel: 'haiku' | 'sonnet' | 'opus';
  startTime: Date;
}

/**
 * Tracks conversational state per user for multi-step flows
 */
export interface UserContext {
  userId: string;
  currentFlow?: 'create_agent' | 'configure_priority' | 'configure_limit' | 'delete_agent' | 'edit_emoji' | 'configure_ralph';
  flowState?: 'awaiting_name' | 'awaiting_type' | 'awaiting_emoji' | 'awaiting_workspace' | 'awaiting_workspace_choice' | 'awaiting_confirmation' | 'awaiting_selection' | 'awaiting_emoji_text' | 'awaiting_ralph_task' | 'awaiting_ralph_max_iterations';
  flowData?: {
    agentName?: string;
    agentId?: string;
    agentType?: AgentType;
    emoji?: string;
    workspace?: string;
    priority?: string;
    [key: string]: unknown;
  };
  pendingPrompt?: {
    text: string;
    messageId?: string;
    images?: Array<{
      data: string; // base64 encoded
      mimeType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    }>;
  };
  lastChoice?: {
    agentId: string;
    agentName: string;
    model: 'haiku' | 'sonnet' | 'opus';
  };
  bashMode?: boolean;           // Global bash mode toggle
  lastBashWorkspace?: string;   // Last workspace used for bash prefix commands
}

/**
 * Represents a task in the execution queue
 */
export interface QueueTask {
  id: string;
  agentId: string;
  prompt: string;
  model: 'haiku' | 'sonnet' | 'opus';
  priority: number;             // 0-2 (high=0, medium=1, low=2)
  timestamp: Date;
  userId: string;
  images?: Array<{
    data: string; // base64 encoded
    mimeType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  }>;
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
  type?: AgentType;             // 'claude' (default) or 'bash' - optional for backwards compat
  mode?: 'conversational' | 'ralph';  // Agent operation mode - optional for backwards compat
  emoji?: string;               // Visual identifier emoji (default: 🤖)
  workspace?: string;
  sessionId?: string;
  currentLoopId?: string;       // Active Ralph loop ID (if in ralph mode)
  title: string;
  status: 'idle' | 'processing' | 'error' | 'ralph-loop' | 'ralph-paused';
  statusDetails: string;
  priority: 'high' | 'medium' | 'low';
  lastActivity: string;         // ISO date string
  messageCount: number;
  outputs: SerializedOutput[];
  createdAt: string;            // ISO date string
}

export interface SerializedOutput {
  id: string;
  type?: OutputType;            // Type of output (default: 'standard')
  summary: string;
  prompt: string;
  response: string;
  model: 'haiku' | 'sonnet' | 'opus' | 'bash';
  status: 'success' | 'warning' | 'error';
  timestamp: string;            // ISO date string
  loopId?: string;              // Reference to Ralph loop (if type is 'ralph-loop')
  iterationCount?: number;      // Number of iterations (for ralph-loop outputs)
}

/**
 * Serialized version of RalphIteration for JSON storage
 */
export interface SerializedRalphIteration {
  number: number;
  model: 'haiku' | 'sonnet' | 'opus';
  action: string;
  prompt: string;
  response: string;
  completionPromiseFound: boolean;
  timestamp: string;            // ISO date string
  duration: number;
}

/**
 * Serialized version of RalphLoopState for JSON storage
 */
export interface SerializedRalphLoopState {
  id: string;
  agentId: string;
  userId: string;
  status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  task: string;
  currentIteration: number;
  maxIterations: number;
  iterations: SerializedRalphIteration[];
  currentModel: 'haiku' | 'sonnet' | 'opus';
  startTime: string;            // ISO date string
}

/**
 * Result from bash command execution
 */
export interface BashResult {
  command: string;
  output: string;
  exitCode: number;
  duration: number;             // milliseconds
  truncated: boolean;
  blocked?: boolean;            // true if command was blocked
  blockReason?: string;         // reason for blocking
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
  BASH_TIMEOUT: 60000,          // 60 seconds
  BASH_MAX_OUTPUT: 1024 * 1024, // 1MB
  BASH_TRUNCATE_AT: 3500,       // WhatsApp message limit
} as const;
