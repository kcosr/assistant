import { z } from 'zod';

export const ChatEventTypeSchema = z.enum([
  'turn_start',
  'turn_end',
  'user_message',
  'user_audio',
  'assistant_chunk',
  'assistant_done',
  'thinking_chunk',
  'thinking_done',
  'custom_message',
  'summary_message',
  'tool_call',
  'tool_input_chunk',
  'tool_output_chunk',
  'tool_result',
  'interaction_request',
  'interaction_response',
  'agent_message',
  'agent_callback',
  'agent_switch',
  'interrupt',
  'error',
  'audio_chunk',
  'audio_done',
]);

export type ChatEventType = z.infer<typeof ChatEventTypeSchema>;

export const TurnStartTriggerSchema = z.enum(['user', 'callback', 'system']);
export type TurnStartTrigger = z.infer<typeof TurnStartTriggerSchema>;

export const InterruptReasonSchema = z.enum(['user_cancel', 'timeout', 'error']);
export type InterruptReason = z.infer<typeof InterruptReasonSchema>;

export const UserMessagePayloadSchema = z.object({
  text: z.string(),
  fromAgentId: z.string().optional(),
  fromSessionId: z.string().optional(),
});
export type UserMessagePayload = z.infer<typeof UserMessagePayloadSchema>;

export const UserAudioPayloadSchema = z.object({
  transcription: z.string(),
  durationMs: z.number().int().nonnegative(),
});
export type UserAudioPayload = z.infer<typeof UserAudioPayloadSchema>;

export const AssistantChunkPayloadSchema = z.object({
  text: z.string(),
});
export type AssistantChunkPayload = z.infer<typeof AssistantChunkPayloadSchema>;

export const AssistantDonePayloadSchema = z.object({
  text: z.string(),
});
export type AssistantDonePayload = z.infer<typeof AssistantDonePayloadSchema>;

export const ThinkingChunkPayloadSchema = z.object({
  text: z.string(),
});
export type ThinkingChunkPayload = z.infer<typeof ThinkingChunkPayloadSchema>;

export const ThinkingDonePayloadSchema = z.object({
  text: z.string(),
});
export type ThinkingDonePayload = z.infer<typeof ThinkingDonePayloadSchema>;

export const CustomMessagePayloadSchema = z.object({
  text: z.string(),
  label: z.string().optional(),
});
export type CustomMessagePayload = z.infer<typeof CustomMessagePayloadSchema>;

export const SummaryMessageTypeSchema = z.enum(['compaction', 'branch_summary']);
export type SummaryMessageType = z.infer<typeof SummaryMessageTypeSchema>;

export const SummaryMessagePayloadSchema = z.object({
  text: z.string(),
  summaryType: SummaryMessageTypeSchema.optional(),
});
export type SummaryMessagePayload = z.infer<typeof SummaryMessagePayloadSchema>;

export const ToolCallPayloadSchema = z.object({
  toolCallId: z.string(),
  toolName: z.string(),
  args: z.record(z.string(), z.unknown()),
});
export type ToolCallPayload = z.infer<typeof ToolCallPayloadSchema>;

export const ToolInputChunkPayloadSchema = z.object({
  toolCallId: z.string(),
  toolName: z.string(),
  /** JSON argument text delta */
  chunk: z.string(),
  /** Cumulative character offset (string length units). Used for deduplication on reconnect. */
  offset: z.number().int().nonnegative(),
});
export type ToolInputChunkPayload = z.infer<typeof ToolInputChunkPayloadSchema>;

export const ToolResultErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
});
export type ToolResultError = z.infer<typeof ToolResultErrorSchema>;

export const ToolResultPayloadSchema = z.object({
  toolCallId: z.string(),
  result: z.unknown(),
  error: ToolResultErrorSchema.optional(),
});
export type ToolResultPayload = z.infer<typeof ToolResultPayloadSchema>;

export const InteractionTypeSchema = z.enum(['approval', 'input']);
export type InteractionType = z.infer<typeof InteractionTypeSchema>;

export const InteractionPresentationSchema = z.enum(['tool', 'questionnaire']);
export type InteractionPresentation = z.infer<typeof InteractionPresentationSchema>;

export const ApprovalScopeSchema = z.enum(['once', 'session', 'always']);
export type ApprovalScope = z.infer<typeof ApprovalScopeSchema>;

export const SimpleInputFieldSchema = z.object({
  id: z.string(),
  type: z.enum(['text', 'textarea', 'select', 'checkbox', 'radio']),
  label: z.string(),
  description: z.string().optional(),
  required: z.boolean().optional(),
  defaultValue: z.unknown().optional(),
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
});
export type SimpleInputField = z.infer<typeof SimpleInputFieldSchema>;

export const SimpleInputSchema = z.object({
  type: z.literal('form'),
  fields: z.array(SimpleInputFieldSchema),
});
export type SimpleInputSchema = z.infer<typeof SimpleInputSchema>;

export const QuestionnaireFieldTypeSchema = z.enum([
  'text',
  'textarea',
  'number',
  'boolean',
  'select',
  'multiselect',
  'checkbox',
  'radio',
  'date',
  'time',
  'datetime',
]);
export type QuestionnaireFieldType = z.infer<typeof QuestionnaireFieldTypeSchema>;

export const QuestionnaireFieldSchema = z.object({
  id: z.string(),
  type: QuestionnaireFieldTypeSchema,
  label: z.string(),
  description: z.string().optional(),
  required: z.boolean().optional(),
  placeholder: z.string().optional(),
  defaultValue: z.unknown().optional(),
  validateOnClient: z.boolean().optional(),
  options: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  minLength: z.number().int().nonnegative().optional(),
  maxLength: z.number().int().nonnegative().optional(),
  pattern: z.string().optional(),
});
export type QuestionnaireField = z.infer<typeof QuestionnaireFieldSchema>;

export const QuestionnaireSectionSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  description: z.string().optional(),
  fields: z.array(QuestionnaireFieldSchema),
  optional: z.boolean().optional(),
  submitLabel: z.string().optional(),
});
export type QuestionnaireSection = z.infer<typeof QuestionnaireSectionSchema>;

export const QuestionnaireSchema = z
  .object({
    title: z.string().optional(),
    description: z.string().optional(),
    fields: z.array(QuestionnaireFieldSchema).optional(),
    sections: z.array(QuestionnaireSectionSchema).optional(),
    submitLabel: z.string().optional(),
    cancelLabel: z.string().optional(),
    initialValues: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((value) => {
    const hasFields = Array.isArray(value.fields) && value.fields.length > 0;
    const hasSections = Array.isArray(value.sections) && value.sections.length > 0;
    return (hasFields && !hasSections) || (!hasFields && hasSections);
  });
export type QuestionnaireSchema = z.infer<typeof QuestionnaireSchema>;

export const InteractionInputSchema = z.union([SimpleInputSchema, QuestionnaireSchema]);
export type InteractionInputSchema = z.infer<typeof InteractionInputSchema>;

export const InteractionCompletedViewSchema = z.object({
  showInputs: z.boolean().optional(),
  summaryTemplate: z.string().optional(),
});
export type InteractionCompletedView = z.infer<typeof InteractionCompletedViewSchema>;

export const InteractionRequestPayloadSchema = z.object({
  toolCallId: z.string(),
  interactionId: z.string(),
  toolName: z.string(),
  interactionType: InteractionTypeSchema,
  presentation: InteractionPresentationSchema.optional(),
  prompt: z.string().optional(),
  approvalScopes: z.array(ApprovalScopeSchema).optional(),
  inputSchema: InteractionInputSchema.optional(),
  timeoutMs: z.number().int().positive().optional(),
  completedView: InteractionCompletedViewSchema.optional(),
  errorSummary: z.string().optional(),
  fieldErrors: z.record(z.string(), z.string()).optional(),
});
export type InteractionRequestPayload = z.infer<typeof InteractionRequestPayloadSchema>;

export const InteractionActionSchema = z.enum(['approve', 'deny', 'submit', 'cancel']);
export type InteractionAction = z.infer<typeof InteractionActionSchema>;

export const InteractionResponsePayloadSchema = z.object({
  toolCallId: z.string(),
  interactionId: z.string(),
  action: InteractionActionSchema,
  approvalScope: ApprovalScopeSchema.optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  reason: z.string().optional(),
});
export type InteractionResponsePayload = z.infer<typeof InteractionResponsePayloadSchema>;

export const ToolOutputChunkStreamSchema = z.enum(['stdout', 'stderr', 'output']);
export type ToolOutputChunkStream = z.infer<typeof ToolOutputChunkStreamSchema>;

export const ToolOutputChunkPayloadSchema = z.object({
  toolCallId: z.string(),
  toolName: z.string(),
  chunk: z.string(),
  /** Cumulative character offset (string length units, not bytes). Used for deduplication on reconnect. */
  offset: z.number().int().nonnegative(),
  stream: ToolOutputChunkStreamSchema.optional(),
});
export type ToolOutputChunkPayload = z.infer<typeof ToolOutputChunkPayloadSchema>;

export const AgentMessagePayloadSchema = z.object({
  messageId: z.string(),
  targetAgentId: z.string(),
  targetSessionId: z.string(),
  message: z.string(),
  wait: z.boolean(),
});
export type AgentMessagePayload = z.infer<typeof AgentMessagePayloadSchema>;

export const AgentCallbackPayloadSchema = z.object({
  messageId: z.string(),
  fromAgentId: z.string(),
  fromSessionId: z.string(),
  result: z.string(),
});
export type AgentCallbackPayload = z.infer<typeof AgentCallbackPayloadSchema>;

export const AgentSwitchPayloadSchema = z.object({
  fromAgentId: z.string(),
  toAgentId: z.string(),
});
export type AgentSwitchPayload = z.infer<typeof AgentSwitchPayloadSchema>;

export const InterruptPayloadSchema = z.object({
  reason: InterruptReasonSchema,
});
export type InterruptPayload = z.infer<typeof InterruptPayloadSchema>;

export const ErrorPayloadSchema = z.object({
  code: z.string(),
  message: z.string(),
});
export type ErrorPayload = z.infer<typeof ErrorPayloadSchema>;

export const AudioChunkPayloadSchema = z.object({
  data: z.string(),
  seq: z.number().int().nonnegative(),
});
export type AudioChunkPayload = z.infer<typeof AudioChunkPayloadSchema>;

export const AudioDonePayloadSchema = z.object({
  durationMs: z.number().int().nonnegative(),
});
export type AudioDonePayload = z.infer<typeof AudioDonePayloadSchema>;

export const TurnStartPayloadSchema = z.object({
  trigger: TurnStartTriggerSchema,
});
export type TurnStartPayload = z.infer<typeof TurnStartPayloadSchema>;

export const TurnEndPayloadSchema = z.object({});
export type TurnEndPayload = z.infer<typeof TurnEndPayloadSchema>;

export type ChatEventPayload =
  | TurnStartPayload
  | TurnEndPayload
  | UserMessagePayload
  | UserAudioPayload
  | AssistantChunkPayload
  | AssistantDonePayload
  | ThinkingChunkPayload
  | ThinkingDonePayload
  | CustomMessagePayload
  | SummaryMessagePayload
  | ToolCallPayload
  | ToolInputChunkPayload
  | ToolOutputChunkPayload
  | ToolResultPayload
  | InteractionRequestPayload
  | InteractionResponsePayload
  | AgentMessagePayload
  | AgentCallbackPayload
  | AgentSwitchPayload
  | InterruptPayload
  | ErrorPayload
  | AudioChunkPayload
  | AudioDonePayload;

export const ChatEventBaseSchema = z.object({
  id: z.string(),
  timestamp: z.number().int().nonnegative(),
  sessionId: z.string(),
  turnId: z.string().optional(),
  responseId: z.string().optional(),
});

export const TurnStartEventSchema = ChatEventBaseSchema.extend({
  type: z.literal('turn_start'),
  payload: TurnStartPayloadSchema,
});

export const TurnEndEventSchema = ChatEventBaseSchema.extend({
  type: z.literal('turn_end'),
  payload: TurnEndPayloadSchema,
});

export const UserMessageEventSchema = ChatEventBaseSchema.extend({
  type: z.literal('user_message'),
  payload: UserMessagePayloadSchema,
});

export const UserAudioEventSchema = ChatEventBaseSchema.extend({
  type: z.literal('user_audio'),
  payload: UserAudioPayloadSchema,
});

export const AssistantChunkEventSchema = ChatEventBaseSchema.extend({
  type: z.literal('assistant_chunk'),
  payload: AssistantChunkPayloadSchema,
});

export const AssistantDoneEventSchema = ChatEventBaseSchema.extend({
  type: z.literal('assistant_done'),
  payload: AssistantDonePayloadSchema,
});

export const ThinkingChunkEventSchema = ChatEventBaseSchema.extend({
  type: z.literal('thinking_chunk'),
  payload: ThinkingChunkPayloadSchema,
});

export const ThinkingDoneEventSchema = ChatEventBaseSchema.extend({
  type: z.literal('thinking_done'),
  payload: ThinkingDonePayloadSchema,
});

export const CustomMessageEventSchema = ChatEventBaseSchema.extend({
  type: z.literal('custom_message'),
  payload: CustomMessagePayloadSchema,
});

export const SummaryMessageEventSchema = ChatEventBaseSchema.extend({
  type: z.literal('summary_message'),
  payload: SummaryMessagePayloadSchema,
});

export const ToolCallEventSchema = ChatEventBaseSchema.extend({
  type: z.literal('tool_call'),
  payload: ToolCallPayloadSchema,
});

export const ToolInputChunkEventSchema = ChatEventBaseSchema.extend({
  type: z.literal('tool_input_chunk'),
  payload: ToolInputChunkPayloadSchema,
});

export const ToolOutputChunkEventSchema = ChatEventBaseSchema.extend({
  type: z.literal('tool_output_chunk'),
  payload: ToolOutputChunkPayloadSchema,
});

export const ToolResultEventSchema = ChatEventBaseSchema.extend({
  type: z.literal('tool_result'),
  payload: ToolResultPayloadSchema,
});

export const InteractionRequestEventSchema = ChatEventBaseSchema.extend({
  type: z.literal('interaction_request'),
  payload: InteractionRequestPayloadSchema,
});

export const InteractionResponseEventSchema = ChatEventBaseSchema.extend({
  type: z.literal('interaction_response'),
  payload: InteractionResponsePayloadSchema,
});

export const AgentMessageEventSchema = ChatEventBaseSchema.extend({
  type: z.literal('agent_message'),
  payload: AgentMessagePayloadSchema,
});

export const AgentCallbackEventSchema = ChatEventBaseSchema.extend({
  type: z.literal('agent_callback'),
  payload: AgentCallbackPayloadSchema,
});

export const AgentSwitchEventSchema = ChatEventBaseSchema.extend({
  type: z.literal('agent_switch'),
  payload: AgentSwitchPayloadSchema,
});

export const InterruptEventSchema = ChatEventBaseSchema.extend({
  type: z.literal('interrupt'),
  payload: InterruptPayloadSchema,
});

export const ErrorEventSchema = ChatEventBaseSchema.extend({
  type: z.literal('error'),
  payload: ErrorPayloadSchema,
});

export const AudioChunkEventSchema = ChatEventBaseSchema.extend({
  type: z.literal('audio_chunk'),
  payload: AudioChunkPayloadSchema,
});

export const AudioDoneEventSchema = ChatEventBaseSchema.extend({
  type: z.literal('audio_done'),
  payload: AudioDonePayloadSchema,
});

export const ChatEventSchema = z.discriminatedUnion('type', [
  TurnStartEventSchema,
  TurnEndEventSchema,
  UserMessageEventSchema,
  UserAudioEventSchema,
  AssistantChunkEventSchema,
  AssistantDoneEventSchema,
  ThinkingChunkEventSchema,
  ThinkingDoneEventSchema,
  CustomMessageEventSchema,
  SummaryMessageEventSchema,
  ToolCallEventSchema,
  ToolInputChunkEventSchema,
  ToolOutputChunkEventSchema,
  ToolResultEventSchema,
  InteractionRequestEventSchema,
  InteractionResponseEventSchema,
  AgentMessageEventSchema,
  AgentCallbackEventSchema,
  AgentSwitchEventSchema,
  InterruptEventSchema,
  ErrorEventSchema,
  AudioChunkEventSchema,
  AudioDoneEventSchema,
]);

export type ChatEvent = z.infer<typeof ChatEventSchema>;

export type TurnStartEvent = z.infer<typeof TurnStartEventSchema>;
export type TurnEndEvent = z.infer<typeof TurnEndEventSchema>;
export type UserMessageEvent = z.infer<typeof UserMessageEventSchema>;
export type UserAudioEvent = z.infer<typeof UserAudioEventSchema>;
export type AssistantChunkEvent = z.infer<typeof AssistantChunkEventSchema>;
export type AssistantDoneEvent = z.infer<typeof AssistantDoneEventSchema>;
export type ThinkingChunkEvent = z.infer<typeof ThinkingChunkEventSchema>;
export type ThinkingDoneEvent = z.infer<typeof ThinkingDoneEventSchema>;
export type CustomMessageEvent = z.infer<typeof CustomMessageEventSchema>;
export type SummaryMessageEvent = z.infer<typeof SummaryMessageEventSchema>;
export type ToolCallEvent = z.infer<typeof ToolCallEventSchema>;
export type ToolInputChunkEvent = z.infer<typeof ToolInputChunkEventSchema>;
export type ToolOutputChunkEvent = z.infer<typeof ToolOutputChunkEventSchema>;
export type ToolResultEvent = z.infer<typeof ToolResultEventSchema>;
export type InteractionRequestEvent = z.infer<typeof InteractionRequestEventSchema>;
export type InteractionResponseEvent = z.infer<typeof InteractionResponseEventSchema>;
export type AgentMessageEvent = z.infer<typeof AgentMessageEventSchema>;
export type AgentCallbackEvent = z.infer<typeof AgentCallbackEventSchema>;
export type AgentSwitchEvent = z.infer<typeof AgentSwitchEventSchema>;
export type InterruptEvent = z.infer<typeof InterruptEventSchema>;
export type ErrorEvent = z.infer<typeof ErrorEventSchema>;
export type AudioChunkEvent = z.infer<typeof AudioChunkEventSchema>;
export type AudioDoneEvent = z.infer<typeof AudioDoneEventSchema>;

export function validateChatEvent(data: unknown): ChatEvent {
  return ChatEventSchema.parse(data);
}

export function safeValidateChatEvent(data: unknown): z.SafeParseReturnType<unknown, ChatEvent> {
  return ChatEventSchema.safeParse(data);
}
