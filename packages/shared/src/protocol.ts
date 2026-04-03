import { z } from 'zod';
import { AssistantTextPhaseSchema, ChatEventTypeSchema } from './chatEvents';
import { PanelEventEnvelopeSchema } from './panelProtocol';

export const TokenUsageBreakdownSchema = z.object({
  input: z.number(),
  output: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  totalTokens: z.number(),
});

export const SessionContextUsageSchema = z.object({
  availablePercent: z.number().int().min(0).max(100),
  contextWindow: z.number().int().positive(),
  usage: TokenUsageBreakdownSchema,
});

export const CURRENT_PROTOCOL_VERSION = 5 as const;
export type ProtocolVersion = typeof CURRENT_PROTOCOL_VERSION;

const SERVER_MESSAGE_TYPE_VALUES = [
  'session_ready',
  'text_delta',
  'text_done',
  'thinking_start',
  'thinking_delta',
  'thinking_done',
  'user_message',
  'user_audio',
  'tool_call',
  'tool_call_start',
  'tool_output_delta',
  'tool_result',
  'transcript_event',
  'agent_callback_result',
  'modes_updated',
  'pong',
  'error',
  'message_queued',
  'message_dequeued',
  'output_cancelled',
  'open_url',
  'subscribed',
  'unsubscribed',
  'panel_event',
  'session_cleared',
  'session_created',
  'session_deleted',
  'session_updated',
  'session_history_changed',
] as const;

export const ServerMessageTypeSchema = z.enum(SERVER_MESSAGE_TYPE_VALUES);
export type ServerMessageType = z.infer<typeof ServerMessageTypeSchema>;

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

export const PanelDisplayModeSchema = z
  .enum(['browser', 'item', 'view', 'artifact'])
  .transform((value): 'browser' | 'item' | 'view' => (value === 'artifact' ? 'item' : value));
export type PanelDisplayMode = z.infer<typeof PanelDisplayModeSchema>;

export const ProtocolVersionFieldSchema = z
  .number()
  .int()
  .positive()
  .default(CURRENT_PROTOCOL_VERSION);

const NonEmptyStringArraySchema = z.array(z.string().min(1)).nonempty();

export const SessionSubscriptionMaskSchema = z.object({
  /**
   * Top-level websocket server message types. This dimension is ANDed
   * with the other mask fields. Omitted means "all message types".
   */
  serverMessageTypes: z.array(ServerMessageTypeSchema).nonempty().optional(),
  /**
   * Transcript event subtypes keyed by the underlying `chatEventType`. When present,
   * only `transcript_event` payloads are checked against this list. Non-transcript-event
   * messages are still matched by the other applicable mask fields.
   */
  chatEventTypes: z.array(ChatEventTypeSchema).nonempty().optional(),
  /**
   * Tool-name allowlist for tool-bearing messages/events. This applies only
   * when the message/event actually includes a tool name.
   */
  toolNames: NonEmptyStringArraySchema.optional(),
  /**
   * Assistant text phase allowlist for assistant text messages/events.
   * This applies only when the message/event actually includes a phase.
   */
  messagePhases: z.array(AssistantTextPhaseSchema).nonempty().optional(),
});
export type SessionSubscriptionMask = z.infer<typeof SessionSubscriptionMaskSchema>;

export const SessionSubscriptionSchema = z.object({
  sessionId: z.string(),
  mask: SessionSubscriptionMaskSchema.optional(),
});
export type SessionSubscription = z.infer<typeof SessionSubscriptionSchema>;

export const ClientHelloMessageSchema = z.object({
  type: z.literal('hello'),
  protocolVersion: ProtocolVersionFieldSchema,
  subscriptions: z.array(SessionSubscriptionSchema).optional(),
  userAgent: z.string().optional(),
  audio: ClientAudioCapabilitiesSchema.optional(),
  interaction: z
    .object({
      supported: z.boolean(),
      enabled: z.boolean(),
    })
    .optional(),
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
  mask: SessionSubscriptionMaskSchema.optional(),
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

export const ClientSetSessionThinkingMessageSchema = z.object({
  type: z.literal('set_session_thinking'),
  sessionId: z.string(),
  thinking: z.string(),
});

export const ClientSetInteractionModeMessageSchema = z.object({
  type: z.literal('set_interaction_mode'),
  enabled: z.boolean(),
});

export const ClientToolInteractionResponseMessageSchema = z.object({
  type: z.literal('tool_interaction_response'),
  sessionId: z.string(),
  callId: z.string(),
  interactionId: z.string(),
  action: z.enum(['approve', 'deny', 'submit', 'cancel']),
  approvalScope: z.enum(['once', 'session', 'always']).optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  reason: z.string().optional(),
});

export const ClientQuestionnaireSubmitMessageSchema = z.object({
  type: z.literal('questionnaire_submit'),
  sessionId: z.string(),
  questionnaireRequestId: z.string(),
  answers: z.record(z.string(), z.unknown()),
});

export const ClientQuestionnaireCancelMessageSchema = z.object({
  type: z.literal('questionnaire_cancel'),
  sessionId: z.string(),
  questionnaireRequestId: z.string(),
  reason: z.string().optional(),
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

export const ClientMessageSchema = z.discriminatedUnion('type', [
  ClientHelloMessageSchema,
  ClientTextInputMessageSchema,
  ClientSetModesMessageSchema,
  ClientControlMessageSchema,
  ClientPingMessageSchema,
  ClientCancelQueuedMessageSchema,
  ClientSetInteractionModeMessageSchema,
  ClientToolInteractionResponseMessageSchema,
  ClientQuestionnaireSubmitMessageSchema,
  ClientQuestionnaireCancelMessageSchema,
  PanelEventEnvelopeSchema,
  ClientSubscribeMessageSchema,
  ClientUnsubscribeMessageSchema,
  ClientSetSessionModelMessageSchema,
  ClientSetSessionThinkingMessageSchema,
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
export type ClientSetSessionThinkingMessage = z.infer<typeof ClientSetSessionThinkingMessageSchema>;
export type ClientSetInteractionModeMessage = z.infer<typeof ClientSetInteractionModeMessageSchema>;
export type ClientToolInteractionResponseMessage = z.infer<
  typeof ClientToolInteractionResponseMessageSchema
>;
export type ClientQuestionnaireSubmitMessage = z.infer<
  typeof ClientQuestionnaireSubmitMessageSchema
>;
export type ClientQuestionnaireCancelMessage = z.infer<
  typeof ClientQuestionnaireCancelMessageSchema
>;
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export const ServerSessionReadyMessageSchema = z.object({
  type: z.literal('session_ready'),
  protocolVersion: ProtocolVersionFieldSchema,
  sessionId: z.string(),
  inputMode: InputModeSchema,
  outputMode: OutputModeSchema,
  availableModels: z.array(z.string()).optional(),
  currentModel: z.string().optional(),
  availableThinking: z.array(z.string()).optional(),
  currentThinking: z.string().optional(),
});

export const ServerTextDeltaMessageSchema = z.object({
  type: z.literal('text_delta'),
  responseId: z.string(),
  requestId: z.string().optional(),
  sessionId: z.string().optional(),
  delta: z.string().min(1),
  phase: AssistantTextPhaseSchema.optional(),
  textSignature: z.string().optional(),
});

export const ServerTextDoneMessageSchema = z.object({
  type: z.literal('text_done'),
  responseId: z.string(),
  requestId: z.string().optional(),
  sessionId: z.string().optional(),
  text: z.string(),
  phase: AssistantTextPhaseSchema.optional(),
  textSignature: z.string().optional(),
  /**
   * Optional identifier used to group messages that belong to a single
   * agent-to-agent exchange initiated via agents_message.
   */
  agentExchangeId: z.string().optional(),
});

export const ServerThinkingStartMessageSchema = z.object({
  type: z.literal('thinking_start'),
  responseId: z.string(),
  requestId: z.string().optional(),
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
  requestId: z.string().optional(),
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
  requestId: z.string().optional(),
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
  requestId: z.string().optional(),
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

export const ServerUserAudioMessageSchema = z.object({
  type: z.literal('user_audio'),
  sessionId: z.string(),
  transcription: z.string(),
  durationMs: z.number().int().nonnegative(),
  requestId: z.string().optional(),
});

export const ProjectedTranscriptEventKindSchema = z.enum([
  'request_start',
  'request_end',
  'user_message',
  'assistant_message',
  'thinking',
  'tool_call',
  'tool_input',
  'tool_output',
  'tool_result',
  'interaction_request',
  'interaction_update',
  'interaction_response',
  'interrupt',
  'error',
]);
export type ProjectedTranscriptEventKind = z.infer<typeof ProjectedTranscriptEventKindSchema>;

export const ProjectedTranscriptEventPayloadSchema = z.record(z.string(), z.unknown());
export type ProjectedTranscriptEventPayload = z.infer<typeof ProjectedTranscriptEventPayloadSchema>;

export const ProjectedTranscriptEventSchema = z.object({
  sessionId: z.string(),
  revision: z.number().int().nonnegative(),
  sequence: z.number().int().nonnegative(),
  requestId: z.string(),
  eventId: z.string(),
  kind: ProjectedTranscriptEventKindSchema,
  chatEventType: ChatEventTypeSchema,
  timestamp: z.string(),
  responseId: z.string().optional(),
  messageId: z.string().optional(),
  toolCallId: z.string().optional(),
  interactionId: z.string().optional(),
  exchangeId: z.string().optional(),
  piTurnId: z.string().optional(),
  payload: ProjectedTranscriptEventPayloadSchema,
});
export type ProjectedTranscriptEvent = z.infer<typeof ProjectedTranscriptEventSchema>;

export const SessionReplayRequestSchema = z.object({
  sessionId: z.string(),
  afterCursor: z.string().optional(),
  force: z.boolean().optional(),
});
export type SessionReplayRequest = z.infer<typeof SessionReplayRequestSchema>;

export const SessionReplayResponseSchema = z.object({
  sessionId: z.string(),
  revision: z.number().int().nonnegative(),
  reset: z.boolean(),
  nextCursor: z.string().optional(),
  events: z.array(ProjectedTranscriptEventSchema),
});
export type SessionReplayResponse = z.infer<typeof SessionReplayResponseSchema>;

export const SessionHistoryEditActionSchema = z.enum([
  'trim_before',
  'trim_after',
  'delete_request',
]);
export type SessionHistoryEditAction = z.infer<typeof SessionHistoryEditActionSchema>;

export const SessionHistoryEditRequestSchema = z.object({
  sessionId: z.string(),
  action: SessionHistoryEditActionSchema,
  requestId: z.string(),
});
export type SessionHistoryEditRequest = z.infer<typeof SessionHistoryEditRequestSchema>;

export const SessionHistoryEditResponseSchema = z.object({
  sessionId: z.string(),
  action: SessionHistoryEditActionSchema,
  requestId: z.string(),
  changed: z.boolean(),
  updatedAt: z.string(),
  revision: z.number().int().nonnegative(),
});
export type SessionHistoryEditResponse = z.infer<typeof SessionHistoryEditResponseSchema>;

export const SessionClearResponseSchema = z.object({
  sessionId: z.string(),
  cleared: z.literal(true),
  updatedAt: z.string(),
  revision: z.number().int().nonnegative(),
});
export type SessionClearResponse = z.infer<typeof SessionClearResponseSchema>;

export const ServerToolCallMessageSchema = z.object({
  type: z.literal('tool_call'),
  sessionId: z.string().optional(),
  callId: z.string(),
  toolName: z.string(),
  arguments: z.record(z.string(), z.unknown()),
  requestId: z.string().optional(),
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
  requestId: z.string().optional(),
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
  requestId: z.string().optional(),
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
  requestId: z.string().optional(),
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

export const ServerTranscriptEventMessageSchema = z.object({
  type: z.literal('transcript_event'),
  event: ProjectedTranscriptEventSchema,
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
  requestId: z.string().optional(),
});

export const ServerOpenUrlMessageSchema = z.object({
  type: z.literal('open_url'),
  sessionId: z.string().optional(),
  url: z.string(),
});

export const ServerSubscribedMessageSchema = z.object({
  type: z.literal('subscribed'),
  sessionId: z.string(),
  mask: SessionSubscriptionMaskSchema.optional(),
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
  // Optional runtime context usage snapshot for the session.
  // When present and null, the client should clear stored context usage.
  contextUsage: SessionContextUsageSchema.nullable().optional(),
});

export const ServerSessionHistoryChangedMessageSchema = z.object({
  type: z.literal('session_history_changed'),
  sessionId: z.string(),
  updatedAt: z.string(),
  revision: z.number().int().nonnegative().optional(),
});

export const ServerMessageSchema = z.discriminatedUnion('type', [
  ServerSessionReadyMessageSchema,
  ServerTextDeltaMessageSchema,
  ServerTextDoneMessageSchema,
  ServerThinkingStartMessageSchema,
  ServerThinkingDeltaMessageSchema,
  ServerThinkingDoneMessageSchema,
  ServerUserMessageMessageSchema,
  ServerUserAudioMessageSchema,
  ServerToolCallMessageSchema,
  ServerToolCallStartMessageSchema,
  ServerToolOutputDeltaMessageSchema,
  ServerToolResultMessageSchema,
  ServerTranscriptEventMessageSchema,
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
  ServerSessionHistoryChangedMessageSchema,
]);

export type ServerSessionReadyMessage = z.infer<typeof ServerSessionReadyMessageSchema>;
export type ServerTextDeltaMessage = z.infer<typeof ServerTextDeltaMessageSchema>;
export type ServerTextDoneMessage = z.infer<typeof ServerTextDoneMessageSchema>;
export type ServerThinkingStartMessage = z.infer<typeof ServerThinkingStartMessageSchema>;
export type ServerThinkingDeltaMessage = z.infer<typeof ServerThinkingDeltaMessageSchema>;
export type ServerThinkingDoneMessage = z.infer<typeof ServerThinkingDoneMessageSchema>;
export type ServerUserMessageMessage = z.infer<typeof ServerUserMessageMessageSchema>;
export type ServerUserAudioMessage = z.infer<typeof ServerUserAudioMessageSchema>;
export type ServerToolCallMessage = z.infer<typeof ServerToolCallMessageSchema>;
export type ServerToolCallStartMessage = z.infer<typeof ServerToolCallStartMessageSchema>;
export type ServerToolOutputDeltaMessage = z.infer<typeof ServerToolOutputDeltaMessageSchema>;
export type ServerToolResultMessage = z.infer<typeof ServerToolResultMessageSchema>;
export type ServerTranscriptEventMessage = z.infer<typeof ServerTranscriptEventMessageSchema>;
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
export type ServerSessionHistoryChangedMessage = z.infer<
  typeof ServerSessionHistoryChangedMessageSchema
>;
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

export type SavedView = z.infer<typeof SavedViewSchema>;
export type ViewState = z.infer<typeof ViewStateSchema>;

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
