import type { SessionHub, SessionIndex } from '../index';
import type { AgentRegistry } from '../agents';
import type { EnvConfig } from '../envConfig';
import type { EventStore } from '../events';
import type { HistoryProviderRegistry } from '../history/historyProvider';
import type { ScheduledSessionService } from '../scheduledSessions/scheduledSessionService';
import type { SearchService } from '../search/searchService';

export interface Tool {
  name: string;
  description: string;
  /**
   * JSON Schema describing the tool parameters.
   * Kept as unknown so different MCP servers can provide their own shapes.
   */
  parameters: unknown;
  /**
   * Optional capability identifiers used for agent scoping.
   */
  capabilities?: string[];
}

export interface BuiltInToolDefinition {
  name: string;
  description: string;
  parameters: unknown;
  /**
   * Optional capability identifiers used for agent scoping.
   */
  capabilities?: string[];
  handler: (args: unknown, ctx: ToolContext) => Promise<unknown>;
}

export interface ToolUpdate {
  delta: string;
  details?: Record<string, unknown>;
}

export interface ToolContext {
  /**
   * AbortSignal for the current chat run or tool invocation.
   * Tools can use this to cooperatively handle cancellation,
   * for example by passing it to fetch or long-running operations.
   */
  signal: AbortSignal;
  sessionId: string;
  /**
   * The unique identifier for this tool call.
   */
  toolCallId?: string;
  /**
   * Turn ID for the current chat run. Used for emitting ChatEvents.
   */
  turnId?: string;
  /**
   * Response ID for the current chat run. Used for emitting ChatEvents.
   */
  responseId?: string;
  /**
   * Registry of configured agents. Used by agent-related tools to validate
   * and inspect agents.
   */
  agentRegistry?: AgentRegistry;
  /**
   * Session index for agent/session tools that need to create or look up sessions.
   */
  sessionIndex?: SessionIndex;
  /**
   * Optional EnvConfig for chat completions and tools.
   * Provided when tools need to run chat flows directly (for example, agent messaging).
   */
  envConfig?: EnvConfig;
  /**
   * Session hub instance associated with this tool call.
   * Useful for tools that need to inspect or interact with other sessions.
   */
  sessionHub?: SessionHub;
  /**
   * Base ToolHost for this environment (including built-in, MCP, and plugin tools).
   * Useful for tools that need to scope tools for another agent.
   */
  baseToolHost?: ToolHost;
  /**
   * Optional unified chat event store for this environment. When provided,
   * tools like agents_message can emit ChatEvent records alongside
   * persisted chat history.
   */
  eventStore?: EventStore;
  /**
   * Optional history provider registry for transcript replay.
   */
  historyProvider?: HistoryProviderRegistry;
  /**
   * Optional scheduled sessions service.
   */
  scheduledSessionService?: ScheduledSessionService;
  /**
   * Optional search service for global search operations.
   */
  searchService?: SearchService;
  /**
   * Optional callback for tools to stream incremental updates (for example,
   * bash output). Tools should still return a final result as usual.
   */
  onUpdate?: (update: ToolUpdate) => void;
  /**
   * When set, tool output chunks should be forwarded to this session
   * (used for agent-to-agent messaging to stream nested tool output).
   */
  forwardChunksTo?: {
    sessionId: string;
    /** The tool call ID in the caller session (e.g., the agents_message call) */
    toolCallId: string;
  };
}

export interface ToolHost {
  listTools(): Promise<Tool[]>;
  /**
   * Invoke a tool by name with JSON-encoded arguments.
   * The result must be JSON-serialisable.
   */
  callTool(name: string, argsJson: string, ctx: ToolContext): Promise<unknown>;
}

export interface McpServerConfig {
  command: string;
  name?: string; // optional identifier for logging/debugging
  args?: string[];
  env?: Record<string, string>;
}

export interface ToolHostConfig {
  mcpServers?: McpServerConfig[];
  toolsEnabled: boolean;
}

export interface CreateToolHostDeps {
  sessionHub?: SessionHub;
  sessionIndex?: SessionIndex;
}
