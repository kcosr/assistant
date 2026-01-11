import { z } from 'zod';
import { ChatEventSchema } from './chatEvents';
import { PanelEventEnvelopeSchema } from './panelProtocol';

export const CURRENT_PROTOCOL_VERSION = 2 as const;
export type ProtocolVersion = typeof CURRENT_PROTOCOL_VERSION;

export const InputModeSchema = z.enum(['text', 'speech', 'both']);
export type InputMode = z.infer<typeof InputModeSchema>;

export const OutputModeSchema = z.enum(['text', 'speech', 'both']);
export type OutputMode = z.infer<typeof OutputModeSchema>;

export const ClientAudioCapabilitiesSchema = z.object({
  /**
   * Whether the client can send microphone audio to the server.
   */
  audioIn: z.boolean().optional(),
  /**
   * Whether the client can receive audio output from the server.
   * Reserved for future use.
   */
  audioOut: z.boolean().optional(),
  /**
   * Supported input sample rates (for example, [24000]).
   */
  sampleRates: z.array(z.number().int().positive()).optional(),
});
export type ClientAudioCapabilities = z.infer<typeof ClientAudioCapabilitiesSchema>;

export const ControlActionSchema = z.enum(['start', 'stop', 'cancel', 'clear']);
export type ControlAction = z.infer<typeof ControlActionSchema>;

export const PanelDisplayModeSchema = z.enum(['browser', 'artifact', 'view']);
export type PanelDisplayMode = z.infer<typeof PanelDisplayModeSchema>;

export const ProtocolVersionFieldSchema = z
  .number()
  .int()
  .positive()
  .default(CURRENT_PROTOCOL_VERSION);

export const ClientHelloMessageSchema = z.object({
  type: z.literal('hello'),
  protocolVersion: ProtocolVersionFieldSchema,
  sessionId: z.string().optional(),
  subscriptions: z.array(z.string()).optional(),
  userAgent: z.string().optional(),
  audio: ClientAudioCapabilitiesSchema.optional(),
});

export const ClientTextInputMessageSchema = z.object({
  type: z.literal('text_input'),
  text: z.string(),
  sessionId: z.string(),
  inputMode: InputModeSchema.optional(),
  clientMessageId: z.string().optional(),
});

export const ClientSetModesMessageSchema = z.object({
  type: z.literal('set_modes'),
  inputMode: InputModeSchema.optional(),
  outputMode: OutputModeSchema.optional(),
});

export const ClientControlMessageSchema = z.object({
  type: z.literal('control'),
  action: ControlActionSchema,
  target: z.enum(['session', 'input', 'output']).optional(),
  sessionId: z.string().optional(),
  /**
   * Optional playback position in milliseconds for barge-in / output cancel
   * operations. When provided with target: "output" and action: "cancel",
   * the server will truncate the current assistant audio item at this offset.
   */
  audioEndMs: z.number().int().nonnegative().optional(),
});

export const ClientPingMessageSchema = z.object({
  type: z.literal('ping'),
  nonce: z.string().optional(),
  timestampMs: z.number().int().nonnegative().optional(),
});

export const ClientCancelQueuedMessageSchema = z.object({
  type: z.literal('cancel_queued_message'),
  messageId: z.string(),
});

export const ClientSubscribeMessageSchema = z.object({
  type: z.literal('subscribe'),
  sessionId: z.string(),
});

export const ClientUnsubscribeMessageSchema = z.object({
  type: z.literal('unsubscribe'),
  sessionId: z.string(),
});

export const ClientSetSessionModelMessageSchema = z.object({
  type: z.literal('set_session_model'),
  sessionId: z.string(),
  model: z.string(),
});

export const FilterOpSchema = z.enum([
  'eq',
  'neq',
  'lt',
  'lte',
  'gt',
  'gte',
  'between',
  'exists',
  'contains',
  'in',
]);

export type FilterOp = z.infer<typeof FilterOpSchema>;

export type FilterClause =
  | {
      field: string;
      op: FilterOp;
      value?: unknown;
      values?: unknown[] | undefined;
    }
  | { and: FilterClause[] }
  | { or: FilterClause[] }
  | { not: FilterClause };

export const FilterClauseSchema: z.ZodType<FilterClause> = z.lazy(() =>
  z.union([
    z.object({
      field: z.string(),
      op: FilterOpSchema,
      value: z.unknown().optional(),
      values: z.array(z.unknown()).optional(),
    }),
    z.object({
      and: z.array(FilterClauseSchema),
    }),
    z.object({
      or: z.array(FilterClauseSchema),
    }),
    z.object({
      not: FilterClauseSchema,
    }),
  ]),
);

export interface ViewQuery {
  sources?:
    | {
        type: 'list' | 'note';
        id: string;
      }[]
    | undefined;
  itemIds?: string[] | undefined;
  query?: string | undefined;
  tags?:
    | {
        include?: string[] | undefined;
        exclude?: string[] | undefined;
      }
    | undefined;
  where?: FilterClause | undefined;
  sort?:
    | {
        field: string;
        direction: 'asc' | 'desc';
        nulls?: 'first' | 'last' | undefined;
      }
    | undefined;
  page?:
    | {
        limit?: number | undefined;
        cursor?: string | undefined;
      }
    | undefined;
  union?: ViewQuery[] | undefined;
}

export const ViewQuerySchema = z.object({
  sources: z
    .array(
      z.object({
        type: z.enum(['list', 'note']),
        id: z.string(),
      }),
    )
    .optional(),
  itemIds: z.array(z.string()).optional(),
  query: z.string().optional(),
  tags: z
    .object({
      include: z.array(z.string()).optional(),
      exclude: z.array(z.string()).optional(),
    })
    .optional(),
  where: FilterClauseSchema.optional(),
  sort: z
    .object({
      field: z.string(),
      direction: z.enum(['asc', 'desc']),
      nulls: z.enum(['first', 'last']).optional(),
    })
    .optional(),
  page: z
    .object({
      limit: z.number().int().positive().optional(),
      cursor: z.string().optional(),
    })
    .optional(),
  union: z.array(z.lazy((): z.ZodTypeAny => ViewQuerySchema as z.ZodTypeAny)).optional(),
});

export const SavedViewSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullable(),
  query: ViewQuerySchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ViewStateSchema = z.object({
  query: ViewQuerySchema,
  viewId: z.string().optional(),
  name: z.string().optional(),
});

export const SelectedViewItemSchema = z.object({
  sourceId: z.string(),
  itemId: z.string(),
});

export const ArtifactsPanelStateSchema = z.object({
  version: z.number().int().nonnegative(),
  updatedAt: z.string(),
  displayMode: PanelDisplayModeSchema,
  selectedArtifactId: z.string().optional(),
  selectedViewItem: SelectedViewItemSchema.nullable().optional(),
  view: ViewStateSchema.nullable().optional(),
});

export const ArtifactsPanelStateUpdateSchema = z.object({
  displayMode: PanelDisplayModeSchema.optional(),
  selectedArtifactId: z.string().nullable().optional(),
  selectedViewItem: SelectedViewItemSchema.nullable().optional(),
  view: ViewStateSchema.nullable().optional(),
});

export const ClientMessageSchema = z.discriminatedUnion('type', [
  ClientHelloMessageSchema,
  ClientTextInputMessageSchema,
  ClientSetModesMessageSchema,
  ClientControlMessageSchema,
  ClientPingMessageSchema,
  ClientCancelQueuedMessageSchema,
  PanelEventEnvelopeSchema,
  ClientSubscribeMessageSchema,
  ClientUnsubscribeMessageSchema,
  ClientSetSessionModelMessageSchema,
]);

export type ClientHelloMessage = z.infer<typeof ClientHelloMessageSchema>;
export type ClientTextInputMessage = z.infer<typeof ClientTextInputMessageSchema>;
export type ClientSetModesMessage = z.infer<typeof ClientSetModesMessageSchema>;
export type ClientControlMessage = z.infer<typeof ClientControlMessageSchema>;
export type ClientPingMessage = z.infer<typeof ClientPingMessageSchema>;
export type ClientCancelQueuedMessage = z.infer<typeof ClientCancelQueuedMessageSchema>;
export type ClientPanelEventMessage = z.infer<typeof PanelEventEnvelopeSchema>;
export type ClientSubscribeMessage = z.infer<typeof ClientSubscribeMessageSchema>;
export type ClientUnsubscribeMessage = z.infer<typeof ClientUnsubscribeMessageSchema>;
export type ClientSetSessionModelMessage = z.infer<typeof ClientSetSessionModelMessageSchema>;
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export const ServerSessionReadyMessageSchema = z.object({
  type: z.literal('session_ready'),
  protocolVersion: ProtocolVersionFieldSchema,
  sessionId: z.string(),
  inputMode: InputModeSchema,
  outputMode: OutputModeSchema,
  availableModels: z.array(z.string()).optional(),
  currentModel: z.string().optional(),
  activeArtifact: z
    .object({
      type: z.string(),
      id: z.string(),
    })
    .optional(),
});

export const ServerTextDeltaMessageSchema = z.object({
  type: z.literal('text_delta'),
  responseId: z.string(),
  sessionId: z.string().optional(),
  delta: z.string().min(1),
});

export const ServerTextDoneMessageSchema = z.object({
  type: z.literal('text_done'),
  responseId: z.string(),
  sessionId: z.string().optional(),
  text: z.string(),
  /**
   * Optional identifier used to group messages that belong to a single
   * agent-to-agent exchange initiated via agents_message.
   */
  agentExchangeId: z.string().optional(),
});

export const ServerThinkingStartMessageSchema = z.object({
  type: z.literal('thinking_start'),
  responseId: z.string(),
  sessionId: z.string().optional(),
  /**
   * Optional identifier used to group messages that belong to a single
   * agent-to-agent exchange initiated via agents_message.
   *
   * When present, the client can use this to associate thinking events
   * with a specific agent exchange block in the UI.
   */
  agentExchangeId: z.string().optional(),
});

export const ServerThinkingDeltaMessageSchema = z.object({
  type: z.literal('thinking_delta'),
  responseId: z.string(),
  sessionId: z.string().optional(),
  delta: z.string().min(1),
  /**
   * Optional identifier used to group messages that belong to a single
   * agent-to-agent exchange initiated via agents_message.
   */
  agentExchangeId: z.string().optional(),
});

export const ServerThinkingDoneMessageSchema = z.object({
  type: z.literal('thinking_done'),
  responseId: z.string(),
  sessionId: z.string().optional(),
  text: z.string(),
  /**
   * Optional identifier used to group messages that belong to a single
   * agent-to-agent exchange initiated via agents_message.
   */
  agentExchangeId: z.string().optional(),
});

export const ServerUserMessageMessageSchema = z.object({
  type: z.literal('user_message'),
  sessionId: z.string(),
  text: z.string(),
  /**
   * Optional identifier of the agent that originated this message
   * when it was sent via agents_message. When present, the
   * client should treat this as an agent-to-agent message for
   * styling and attribution purposes.
   */
  fromAgentId: z.string().optional(),
  /**
   * Optional session id of the originating agent session. Intended
   * for diagnostics and future UI affordances; not required for
   * basic styling.
   */
  fromSessionId: z.string().optional(),
  /**
   * When present, indicates that this user_message originated from
   * agents_message.
   *
   * - "agent_message": user turn in the target agent's session
   * - "agent_callback": async callback delivered to the calling agent
   *
   * The client can use this to decide whether to render an agent
   * exchange block or to suppress the user bubble entirely.
   */
  agentMessageType: z.enum(['agent_message', 'agent_callback']).optional(),
  /**
   * Optional identifier used to group messages that belong to a single
   * agent-to-agent exchange initiated via agents_message.
   *
   * This is typically the responseId of the target agent run.
   */
  agentExchangeId: z.string().optional(),
});

export const ServerTranscriptDeltaMessageSchema = z.object({
  type: z.literal('transcript_delta'),
  transcriptId: z.string(),
  delta: z.string().min(1),
});

export const ServerTranscriptDoneMessageSchema = z.object({
  type: z.literal('transcript_done'),
  transcriptId: z.string(),
  text: z.string(),
});

export const ServerToolCallMessageSchema = z.object({
  type: z.literal('tool_call'),
  sessionId: z.string().optional(),
  callId: z.string(),
  toolName: z.string(),
  arguments: z.record(z.string(), z.unknown()),
  /**
   * Optional identifier used to group tool calls that were made while
   * processing a specific agent-to-agent exchange.
   */
  agentExchangeId: z.string().optional(),
});

export const ServerToolCallStartMessageSchema = z.object({
  type: z.literal('tool_call_start'),
  sessionId: z.string().optional(),
  callId: z.string(),
  toolName: z.string(),
  arguments: z.string(),
  /**
   * Optional identifier used to group tool calls that were made while
   * processing a specific agent-to-agent exchange.
   */
  agentExchangeId: z.string().optional(),
});

export const ServerToolOutputDeltaMessageSchema = z.object({
  type: z.literal('tool_output_delta'),
  sessionId: z.string().optional(),
  callId: z.string(),
  toolName: z.string(),
  delta: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
  /**
   * Optional identifier used to group tool output that was produced
   * while processing a specific agent-to-agent exchange.
   */
  agentExchangeId: z.string().optional(),
});

export const ServerToolResultMessageSchema = z.object({
  type: z.literal('tool_result'),
  sessionId: z.string().optional(),
  callId: z.string(),
  toolName: z.string(),
  ok: z.boolean(),
  /**
   * When true, indicates that the tool output was truncated before being
   * sent to the client (for example, large file reads or long command output).
   */
  truncated: z.boolean().optional(),
  /**
   * The dimension that triggered truncation.
   * - "lines": line-count limit was hit
   * - "bytes": byte-size limit was hit
   */
  truncatedBy: z.enum(['lines', 'bytes']).optional(),
  /**
   * Total number of lines in the original (untruncated) output, when known.
   */
  totalLines: z.number().optional(),
  /**
   * Total number of bytes in the original (untruncated) output, when known.
   */
  totalBytes: z.number().optional(),
  /**
   * Number of lines included in the truncated output, when known.
   */
  outputLines: z.number().optional(),
  /**
   * Number of bytes included in the truncated output, when known.
   */
  outputBytes: z.number().optional(),
  result: z.unknown().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
  /**
   * Optional identifier used to group tool results that were produced
   * while processing a specific agent-to-agent exchange.
   */
  agentExchangeId: z.string().optional(),
});

export const ServerChatEventMessageSchema = z.object({
  type: z.literal('chat_event'),
  sessionId: z.string(),
  event: ChatEventSchema,
});

export const ServerAgentCallbackResultMessageSchema = z.object({
  type: z.literal('agent_callback_result'),
  /**
   * Calling agent's session that receives the async callback result.
   */
  sessionId: z.string(),
  /**
   * Response identifier of the target agent run. This correlates to
   * the responseId returned from the original agents_message
   * tool call in async mode.
   */
  responseId: z.string(),
  /**
   * Final response text returned from the target agent. The client
   * should render this in the tool block result area instead of
   * showing a separate user bubble.
   */
  result: z.string(),
});

export const ServerModesUpdatedMessageSchema = z.object({
  type: z.literal('modes_updated'),
  inputMode: InputModeSchema,
  outputMode: OutputModeSchema,
});

export const ServerPongMessageSchema = z.object({
  type: z.literal('pong'),
  nonce: z.string().optional(),
  timestampMs: z.number().int().nonnegative().optional(),
});

export const ServerErrorMessageSchema = z.object({
  type: z.literal('error'),
  code: z.string(),
  message: z.string(),
  retryable: z.boolean().optional(),
  details: z.unknown().optional(),
});

export const ServerMessageQueuedMessageSchema = z.object({
  type: z.literal('message_queued'),
  messageId: z.string(),
  text: z.string(),
  position: z.number().int().nonnegative(),
  sessionId: z.string().optional(),
  clientMessageId: z.string().optional(),
  source: z.enum(['user', 'agent']).optional(),
  fromAgentId: z.string().optional(),
  fromSessionId: z.string().optional(),
});

export const ServerMessageDequeuedMessageSchema = z.object({
  type: z.literal('message_dequeued'),
  messageId: z.string(),
  sessionId: z.string().optional(),
});

export const ServerOutputCancelledMessageSchema = z.object({
  type: z.literal('output_cancelled'),
  sessionId: z.string().optional(),
  responseId: z.string().optional(),
});

export const ServerOpenUrlMessageSchema = z.object({
  type: z.literal('open_url'),
  sessionId: z.string().optional(),
  url: z.string(),
});

export const ServerSubscribedMessageSchema = z.object({
  type: z.literal('subscribed'),
  sessionId: z.string(),
});

export const ServerUnsubscribedMessageSchema = z.object({
  type: z.literal('unsubscribed'),
  sessionId: z.string(),
});

export const ServerSessionClearedMessageSchema = z.object({
  type: z.literal('session_cleared'),
  sessionId: z.string(),
});

export const ServerSessionDeletedMessageSchema = z.object({
  type: z.literal('session_deleted'),
  sessionId: z.string(),
});

export const ServerSessionCreatedMessageSchema = z.object({
  type: z.literal('session_created'),
  sessionId: z.string(),
  agentId: z.string().optional(),
  createdAt: z.string(),
});

export const ServerSessionUpdatedMessageSchema = z.object({
  type: z.literal('session_updated'),
  sessionId: z.string(),
  updatedAt: z.string(),
  // Optional user-defined session name. When omitted, the
  // client should preserve the existing name. When present
  // and null, the client should clear any stored name.
  name: z.string().nullable().optional(),
  // Optional pin timestamp. When present and non-null, the
  // session should be treated as pinned in the UI and sorted
  // by this timestamp (most recent first). When null, the
  // session should be treated as unpinned.
  pinnedAt: z.string().nullable().optional(),
  // Optional session attributes snapshot. When present and null,
  // the client should clear stored attributes.
  attributes: z.record(z.unknown()).nullable().optional(),
});

export const ServerMessageSchema = z.discriminatedUnion('type', [
  ServerSessionReadyMessageSchema,
  ServerTextDeltaMessageSchema,
  ServerTextDoneMessageSchema,
  ServerThinkingStartMessageSchema,
  ServerThinkingDeltaMessageSchema,
  ServerThinkingDoneMessageSchema,
  ServerUserMessageMessageSchema,
  ServerTranscriptDeltaMessageSchema,
  ServerTranscriptDoneMessageSchema,
  ServerToolCallMessageSchema,
  ServerToolCallStartMessageSchema,
  ServerToolOutputDeltaMessageSchema,
  ServerToolResultMessageSchema,
  ServerChatEventMessageSchema,
  ServerAgentCallbackResultMessageSchema,
  ServerModesUpdatedMessageSchema,
  ServerPongMessageSchema,
  ServerErrorMessageSchema,
  ServerMessageQueuedMessageSchema,
  ServerMessageDequeuedMessageSchema,
  ServerOutputCancelledMessageSchema,
  ServerOpenUrlMessageSchema,
  ServerSubscribedMessageSchema,
  ServerUnsubscribedMessageSchema,
  PanelEventEnvelopeSchema,
  ServerSessionClearedMessageSchema,
  ServerSessionCreatedMessageSchema,
  ServerSessionDeletedMessageSchema,
  ServerSessionUpdatedMessageSchema,
]);

export type ServerSessionReadyMessage = z.infer<typeof ServerSessionReadyMessageSchema>;
export type ServerTextDeltaMessage = z.infer<typeof ServerTextDeltaMessageSchema>;
export type ServerTextDoneMessage = z.infer<typeof ServerTextDoneMessageSchema>;
export type ServerThinkingStartMessage = z.infer<typeof ServerThinkingStartMessageSchema>;
export type ServerThinkingDeltaMessage = z.infer<typeof ServerThinkingDeltaMessageSchema>;
export type ServerThinkingDoneMessage = z.infer<typeof ServerThinkingDoneMessageSchema>;
export type ServerUserMessageMessage = z.infer<typeof ServerUserMessageMessageSchema>;
export type ServerTranscriptDeltaMessage = z.infer<typeof ServerTranscriptDeltaMessageSchema>;
export type ServerTranscriptDoneMessage = z.infer<typeof ServerTranscriptDoneMessageSchema>;
export type ServerToolCallMessage = z.infer<typeof ServerToolCallMessageSchema>;
export type ServerToolCallStartMessage = z.infer<typeof ServerToolCallStartMessageSchema>;
export type ServerToolOutputDeltaMessage = z.infer<typeof ServerToolOutputDeltaMessageSchema>;
export type ServerToolResultMessage = z.infer<typeof ServerToolResultMessageSchema>;
export type ServerChatEventMessage = z.infer<typeof ServerChatEventMessageSchema>;
export type ServerAgentCallbackResultMessage = z.infer<
  typeof ServerAgentCallbackResultMessageSchema
>;
export type ServerModesUpdatedMessage = z.infer<typeof ServerModesUpdatedMessageSchema>;
export type ServerPongMessage = z.infer<typeof ServerPongMessageSchema>;
export type ServerErrorMessage = z.infer<typeof ServerErrorMessageSchema>;
export type ServerMessageQueuedMessage = z.infer<typeof ServerMessageQueuedMessageSchema>;
export type ServerMessageDequeuedMessage = z.infer<typeof ServerMessageDequeuedMessageSchema>;
export type ServerOutputCancelledMessage = z.infer<typeof ServerOutputCancelledMessageSchema>;
export type ServerOpenUrlMessage = z.infer<typeof ServerOpenUrlMessageSchema>;
export type ServerPanelEventMessage = z.infer<typeof PanelEventEnvelopeSchema>;
export type ServerSubscribedMessage = z.infer<typeof ServerSubscribedMessageSchema>;
export type ServerUnsubscribedMessage = z.infer<typeof ServerUnsubscribedMessageSchema>;
export type ServerSessionClearedMessage = z.infer<typeof ServerSessionClearedMessageSchema>;
export type ServerSessionCreatedMessage = z.infer<typeof ServerSessionCreatedMessageSchema>;
export type ServerSessionDeletedMessage = z.infer<typeof ServerSessionDeletedMessageSchema>;
export type ServerSessionUpdatedMessage = z.infer<typeof ServerSessionUpdatedMessageSchema>;
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

export type SavedView = z.infer<typeof SavedViewSchema>;
export type ViewState = z.infer<typeof ViewStateSchema>;
export type ArtifactsPanelState = z.infer<typeof ArtifactsPanelStateSchema>;
export type ArtifactsPanelStateUpdate = z.infer<typeof ArtifactsPanelStateUpdateSchema>;

export function validateClientMessage(data: unknown): ClientMessage {
  return ClientMessageSchema.parse(data);
}

export function validateServerMessage(data: unknown): ServerMessage {
  return ServerMessageSchema.parse(data);
}

export function safeValidateClientMessage(
  data: unknown,
): z.SafeParseReturnType<unknown, ClientMessage> {
  return ClientMessageSchema.safeParse(data);
}

export function safeValidateServerMessage(
  data: unknown,
): z.SafeParseReturnType<unknown, ServerMessage> {
  return ServerMessageSchema.safeParse(data);
}
