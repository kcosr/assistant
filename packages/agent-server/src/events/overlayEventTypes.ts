import type { ChatEvent, ChatEventType } from '@assistant/shared';

export const OVERLAY_CHAT_EVENT_TYPES = [
  'interaction_request',
  'interaction_response',
  'interaction_pending',
  'questionnaire_request',
  'questionnaire_submission',
  'questionnaire_reprompt',
  'questionnaire_update',
] as const satisfies ChatEventType[];

export type OverlayChatEventType = (typeof OVERLAY_CHAT_EVENT_TYPES)[number];

const OVERLAY_CHAT_EVENT_TYPE_SET = new Set<ChatEventType>(OVERLAY_CHAT_EVENT_TYPES);

export function isOverlayChatEvent(event: ChatEvent): event is ChatEvent & { type: OverlayChatEventType } {
  return OVERLAY_CHAT_EVENT_TYPE_SET.has(event.type);
}

export function isOverlayChatEventType(type: string): type is OverlayChatEventType {
  return OVERLAY_CHAT_EVENT_TYPE_SET.has(type as ChatEventType);
}
