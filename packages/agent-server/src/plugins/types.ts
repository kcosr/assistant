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
  panelEventHandlers?: Record<string, PanelEventHandler>;
  httpRoutes?: HttpRouteHandler[];
  initialize?: (dataDir: string, pluginConfig?: PluginConfig) => Promise<void>;
  shutdown?: () => Promise<void>;
  prepareGitSnapshot?: (options: { instanceId: string }) => Promise<void> | void;
  onSessionDeleted?: (sessionId: string) => Promise<void> | void;
}
