import type { ChatEvent, ChatEventType } from '@assistant/shared';

export const PERSISTENT_OVERLAY_CHAT_EVENT_TYPES = [
  'interaction_request',
  'interaction_response',
  'interaction_pending',
  'questionnaire_request',
  'questionnaire_submission',
  'questionnaire_reprompt',
  'questionnaire_update',
] as const satisfies ChatEventType[];

export const TRANSIENT_REPLAY_CHAT_EVENT_TYPES = [
  'turn_start',
  'turn_end',
  'user_message',
  'user_audio',
  'assistant_done',
  'thinking_done',
  'custom_message',
  'summary_message',
  'tool_call',
  'tool_result',
  'agent_message',
  'agent_callback',
  'agent_switch',
  'interrupt',
  'error',
] as const satisfies ChatEventType[];

export const OVERLAY_CHAT_EVENT_TYPES = [
  ...PERSISTENT_OVERLAY_CHAT_EVENT_TYPES,
  ...TRANSIENT_REPLAY_CHAT_EVENT_TYPES,
] as const satisfies ChatEventType[];

export type OverlayChatEventType = (typeof OVERLAY_CHAT_EVENT_TYPES)[number];
export type TransientReplayChatEventType = (typeof TRANSIENT_REPLAY_CHAT_EVENT_TYPES)[number];

const OVERLAY_CHAT_EVENT_TYPE_SET = new Set<ChatEventType>(OVERLAY_CHAT_EVENT_TYPES);
const TRANSIENT_REPLAY_CHAT_EVENT_TYPE_SET = new Set<ChatEventType>(TRANSIENT_REPLAY_CHAT_EVENT_TYPES);

export function isOverlayChatEvent(event: ChatEvent): event is ChatEvent & { type: OverlayChatEventType } {
  return OVERLAY_CHAT_EVENT_TYPE_SET.has(event.type);
}

export function isOverlayChatEventType(type: string): type is OverlayChatEventType {
  return OVERLAY_CHAT_EVENT_TYPE_SET.has(type as ChatEventType);
}

export function isTransientReplayChatEvent(
  event: ChatEvent,
): event is ChatEvent & { type: TransientReplayChatEventType } {
  return TRANSIENT_REPLAY_CHAT_EVENT_TYPE_SET.has(event.type);
}
