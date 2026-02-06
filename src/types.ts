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
 * Model mode - selection (asks each time) or fixed model
 */
export type ModelMode = 'selection' | 'haiku' | 'sonnet' | 'opus';

/**
 * Topic type - type of Telegram forum topic
 * - general: Main topic, shares mainSessionId with agent
 * - ralph: Ralph autonomous loop in isolated session
 * - worktree: Feature/experiment in isolated session
 * - session: Standalone conversation in isolated session
 */
export type TopicType = 'general' | 'ralph' | 'worktree' | 'session';

/**
 * Topic status
 */
export type TopicStatus = 'active' | 'closed';

/**
 * Represents a Telegram forum topic for an agent
 */
export interface AgentTopic {
  id: string;                    // UUID
  agentId: string;               // Parent agent ID
  telegramTopicId: number;       // Telegram message_thread_id
  type: TopicType;
  name: string;                  // Topic name (e.g., "Auth JWT", "feature/payments")
  emoji: string;                 // Visual identifier (🔄, 🌿, 💬, 📌)
  sessionId?: string;            // Claude session ID (isolated, only for non-general topics)
  loopId?: string;               // Ralph loop ID (only for type='ralph')
  workspace?: string;            // Absolute path for topic workspace (optional, overrides agent workspace)
  status: TopicStatus;
  messageCount: number;          // Counter for messages sent to this topic
  createdAt: Date;
  lastActivity: Date;
}

/**
 * User operation mode
 * - ronin: All agents in WhatsApp (default, current behavior)
 * - dojo: Agents in Telegram, WhatsApp has read-only Ronin agent
 */
export type UserMode = 'ronin' | 'dojo';

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
  groupId?: string;             // WhatsApp group ID (format: 120363...@g.us, immutable)
  telegramChatId?: number;      // Telegram group/chat ID for this agent
  modelMode: ModelMode;         // 'selection' (asks each time) or fixed model
  mainSessionId?: string;       // Main Claude session ID (shared by General topic)
  topics: AgentTopic[];         // Telegram forum topics for this agent
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
  status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'blocked';
  task: string;                 // Original task description
  currentIteration: number;     // Current iteration number
  maxIterations: number;        // Maximum iterations allowed
  iterations: RalphIteration[]; // History of iterations
  currentModel: 'haiku' | 'sonnet' | 'opus';
  startTime: Date;
  threadId?: number;            // Telegram message_thread_id for topic-based loops
}

/**
 * State for directory navigation in workspace selector
 */
export interface DirectoryNavigationState {
  currentPath: string;              // Current path in navigation
  baseOptions: string[];            // Base options shown (agent workspace, recents)
  targetTopicId?: string;           // Topic being configured
  targetAgentId?: string;           // Agent for the topic
  visibleDirectories: string[];     // Snapshot of visible directories (for index mapping)
  filter?: string;                  // Active filter (optional)
  awaitingInput?: 'filter' | 'custom_base_path'; // Awaiting user text input
}

/**
 * Tracks conversational state per user for multi-step flows
 */
export interface UserContext {
  userId: string;
  activeAgentId?: string;         // Persists across clearContext() for continuous conversations
  currentFlow?: 'create_agent' | 'configure_priority' | 'configure_limit' | 'delete_agent' | 'edit_emoji' | 'edit_name' | 'configure_ralph' | 'onboarding' | 'ralph_loop' | 'image_action' | 'document_action' | 'topic_ralph' | 'topic_worktree' | 'topic_sessao' | 'workspace_not_found';
  flowState?: 'awaiting_name' | 'awaiting_type' | 'awaiting_emoji' | 'awaiting_mode' | 'awaiting_workspace' | 'awaiting_workspace_choice' | 'awaiting_model_mode' | 'awaiting_confirmation' | 'awaiting_selection' | 'awaiting_emoji_text' | 'awaiting_ralph_task' | 'awaiting_ralph_max_iterations' | 'awaiting_mode_selection' | 'awaiting_telegram_username' | 'awaiting_custom_iterations' | 'awaiting_image_prompt' | 'awaiting_document_prompt' | 'awaiting_topic_name' | 'awaiting_topic_task' | 'awaiting_topic_iterations' | 'awaiting_topic_workspace';
  flowData?: {
    agentName?: string;
    agentId?: string;
    agentType?: AgentType;
    emoji?: string;
    agentMode?: 'conversational' | 'ralph';
    workspace?: string;
    modelMode?: ModelMode;
    priority?: string;
    userMode?: UserMode;           // For onboarding flow
    telegramUsername?: string;     // For onboarding flow
    ralphTask?: string;            // Ralph loop task description
    ralphMaxIterations?: number;   // Ralph loop max iterations
    ralphLoopId?: string;          // Active Ralph loop ID
    telegramChatId?: number;       // Telegram chat ID for the flow
    pendingImageFileId?: string;   // Telegram file ID for pending image
    pendingDocumentFileId?: string; // Telegram file ID for pending document
    pendingDocumentFilename?: string; // Original filename of pending document
    topicName?: string;              // Topic name for topic creation flows
    topicTask?: string;              // Task description for Ralph topic
    topicMaxIterations?: number;     // Max iterations for Ralph topic
    topicWorkspace?: string;         // Workspace path selected during topic creation
    // Workspace not found paused task data
    pausedTaskId?: string;           // ID of the paused task
    pausedPrompt?: string;           // Original prompt
    pausedModel?: 'haiku' | 'sonnet' | 'opus'; // Selected model
    pausedImages?: Array<{data: string; mimeType: string}>; // Attached images
    missingWorkspacePath?: string;   // Path that was not found
    topicId?: string;                // Topic ID for workspace resolution
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
  directoryNavigationState?: DirectoryNavigationState; // Directory navigation for workspace selector
}

/**
 * User preferences (persisted)
 */
export interface UserPreferences {
  userId: string;
  mode: UserMode;
  telegramUsername?: string;       // Telegram username (without @)
  telegramChatId?: number;         // Telegram chat ID for direct messages
  onboardingComplete: boolean;     // Whether user completed mode selection
  sandboxAutoCleanup?: boolean;    // Auto-cleanup sandbox directory on agent deletion
  recentWorkspaces?: string[];     // Last 5 workspaces used (most recent first)
}

/**
 * Serialized user preferences for JSON storage
 */
export interface SerializedUserPreferences {
  userId: string;
  mode: UserMode;
  telegramUsername?: string;
  telegramChatId?: number;
  onboardingComplete: boolean;
  sandboxAutoCleanup?: boolean;
  recentWorkspaces?: string[];
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
  replyTo?: string | number;    // Where to send response (userId, groupId, or Telegram chatId)
  threadId?: number;            // Telegram topic thread ID for forum responses
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

/**
 * Serialized version of AgentTopic for JSON storage
 */
export interface SerializedAgentTopic {
  id: string;
  agentId: string;
  telegramTopicId: number;
  type: TopicType;
  name: string;
  emoji: string;
  sessionId?: string;
  loopId?: string;
  workspace?: string;
  status: TopicStatus;
  messageCount: number;         // Counter for messages sent to this topic
  createdAt: string;            // ISO date string
  lastActivity: string;         // ISO date string
}

export interface SerializedAgent {
  id: string;
  userId: string;               // Owning user ID (phone number)
  name: string;
  type?: AgentType;             // 'claude' (default) or 'bash' - optional for backwards compat
  mode?: 'conversational' | 'ralph';  // Agent operation mode - optional for backwards compat
  emoji?: string;               // Visual identifier emoji (default: 🤖)
  workspace?: string;
  groupId?: string;             // WhatsApp group ID (format: 120363...@g.us)
  telegramChatId?: number;      // Telegram group/chat ID for this agent
  modelMode?: ModelMode;        // Model mode - optional for backwards compat
  sessionId?: string;           // DEPRECATED: Use mainSessionId. Kept for migration compatibility.
  mainSessionId?: string;       // Main Claude session ID (shared by General topic)
  topics?: SerializedAgentTopic[]; // Telegram forum topics - optional for backwards compat
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
  status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'blocked';
  task: string;
  currentIteration: number;
  maxIterations: number;
  iterations: SerializedRalphIteration[];
  currentModel: 'haiku' | 'sonnet' | 'opus';
  startTime: string;            // ISO date string
  threadId?: number;            // Telegram message_thread_id for topic-based loops
}

/**
 * Topics file structure for persistence (data/topics/{agentId}.json)
 */
export interface AgentTopicsFile {
  agentId: string;
  mainSessionId?: string;
  topics: AgentTopic[];
}

/**
 * Serialized version of AgentTopicsFile for JSON storage
 */
export interface SerializedAgentTopicsFile {
  agentId: string;
  mainSessionId?: string;
  topics: SerializedAgentTopic[];
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
 * Group onboarding step
 */
export type GroupOnboardingStep =
  | 'awaiting_name'
  | 'awaiting_emoji'
  | 'awaiting_workspace'
  | 'awaiting_model_mode'
  | 'awaiting_confirmation'
  | 'linking_agent';

/**
 * State for group-based agent onboarding flow
 * Tracks the multi-step process of creating an agent from a Telegram group
 */
export interface GroupOnboardingState {
  chatId: number;                 // Telegram group chat ID
  userId: number;                 // Telegram user ID who initiated onboarding
  step: GroupOnboardingStep;      // Current step in the onboarding flow
  pinnedMessageId?: number;       // Message ID of pinned onboarding status (if any)
  data: {
    agentName?: string;           // Name chosen for the agent
    emoji?: string;               // Emoji identifier for the agent
    workspace?: string;           // Workspace path for the agent
    modelMode?: ModelMode;        // Model selection mode
    selectedAgentId?: string;     // ID of existing agent to link (for /link flow)
  };
  startedAt: Date;                // When onboarding started
}

/**
 * Serialized version of GroupOnboardingState for JSON storage
 */
export interface SerializedGroupOnboardingState {
  chatId: number;
  userId: number;
  step: GroupOnboardingStep;
  pinnedMessageId?: number;
  data: {
    agentName?: string;
    emoji?: string;
    workspace?: string;
    modelMode?: ModelMode;
    selectedAgentId?: string;
  };
  startedAt: string;              // ISO date string
}

/**
 * Callbacks for real-time progress monitoring during SDK processing
 */
export interface ProgressCallbacks {
  onToolUse?: (toolName: string, toolInput: Record<string, unknown>) => void;
  onBashOutput?: (command: string, output: string, exitCode: number) => void;
  onTextChunk?: (chunk: string) => void;
}

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
