import type {
  CombinedPluginManifest,
  PanelEventEnvelope,
  ServerMessage,
} from '@assistant/shared';

import type { PluginConfig as AppPluginConfig } from '../config';
import type { SessionHub } from '../sessionHub';
import type { SessionIndex } from '../sessionIndex';
import type { HttpRouteHandler } from '../http/types';
import type { ToolContext } from '../tools';
import type { SessionConnection } from '../ws/sessionConnection';

export interface PluginToolDefinition {
  name: string;
  description: string;
  /**
   * JSON Schema for the tool input parameters.
   * Kept intentionally loose to support a variety
   * of plugin parameter shapes.
   */
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  /**
   * Optional capability identifiers used for agent scoping.
   */
  capabilities?: string[];
  /**
   * Implementation of the tool. Receives validated
   * arguments and the current tool context.
   */
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

export interface SearchOptions {
  /** Limit to specific instance, or undefined for all */
  instanceId?: string;
  /** Maximum results to return */
  limit?: number;
}

export interface SearchResultLaunch {
  /** Panel type to open */
  panelType: string;
  /** Event payload */
  payload: Record<string, unknown>;
}

export interface SearchResult {
  /** Unique identifier for this result */
  id: string;
  /** Display title */
  title: string;
  /** Optional subtitle (e.g., tags, parent list name) */
  subtitle?: string;
  /** Optional text snippet showing match context */
  snippet?: string;
  /** Relevance score (higher = more relevant) */
  score?: number;
  /** How to launch this result */
  launch: SearchResultLaunch;
}

export interface SearchProvider {
  /**
   * Search this plugin's content.
   * Called by the global search service.
   */
  search: (query: string, options: SearchOptions) => Promise<SearchResult[]>;
}

export type OperationHandler = (
  args: Record<string, unknown>,
  ctx: ToolContext,
) => Promise<unknown>;

export interface PanelEventHandlerContext {
  sessionId: string | null;
  panelId: string;
  panelType: string;
  connectionId: string;
  connection: SessionConnection;
  sessionHub: SessionHub;
  sessionIndex: SessionIndex;
  sendToClient: (message: ServerMessage) => void;
  sendToSession: (sessionId: string, message: ServerMessage) => void;
  sendToAll: (message: ServerMessage) => void;
}

export type PanelEventHandler = (
  event: PanelEventEnvelope,
  ctx: PanelEventHandlerContext,
) => Promise<void>;

export interface ToolPlugin {
  /**
   * Unique plugin identifier. Used as the key in
   * configuration (for example, config.json.plugins).
   */
  name: string;
  /**
   * Optional manifest describing the plugin's server surface.
   */
  manifest?: CombinedPluginManifest;
  /**
   * Tools exposed by this plugin.
   */
  tools: PluginToolDefinition[];

  /**
   * Optional search provider for global search.
   */
  searchProvider?: SearchProvider;

  /**
   * Initialise plugin state. Called once with a data
   * directory where the plugin may store persistent data,
   * plus optional per-plugin configuration from config.json.
   */
  initialize(dataDir: string, pluginConfig?: PluginConfig): Promise<void>;

  /**
   * Optional WebSocket panel event handlers, keyed by panel type.
   */
  panelEventHandlers?: Record<string, PanelEventHandler>;

  /**
   * Optional HTTP route handlers registered by the plugin.
   */
  httpRoutes?: HttpRouteHandler[];

  /**
   * Optional graceful shutdown hook.
   */
  shutdown?(): Promise<void>;

  /**
   * Optional hook to prepare data snapshots (for example, flushing WAL files)
   * before git versioning captures the plugin data directory.
   */
  prepareGitSnapshot?(options: { instanceId: string }): Promise<void> | void;

  /**
   * Optional session lifecycle hook invoked when a session is deleted.
   */
  onSessionDeleted?(sessionId: string): Promise<void> | void;
}

export type PluginConfig = AppPluginConfig;

export interface PluginModule {
  tools?: PluginToolDefinition[];
  operations?: Record<string, OperationHandler>;
  searchProvider?: SearchProvider;
  panelEventHandlers?: Record<string, PanelEventHandler>;
  httpRoutes?: HttpRouteHandler[];
  /**
   * Additional HTTP routes that are always included alongside operations routes.
   * Use for binary endpoints (file downloads) that can't be handled by JSON operations.
   */
  extraHttpRoutes?: HttpRouteHandler[];
  initialize?: (dataDir: string, pluginConfig?: PluginConfig) => Promise<void>;
  shutdown?: () => Promise<void>;
  prepareGitSnapshot?: (options: { instanceId: string }) => Promise<void> | void;
  onSessionDeleted?: (sessionId: string) => Promise<void> | void;
}
