import type {
  ClientCancelQueuedMessage,
  ClientControlMessage,
  ClientHelloMessage,
  ClientPanelEventMessage,
  ClientPingMessage,
  ClientSetModesMessage,
  ClientSetSessionModelMessage,
  ClientSetSessionThinkingMessage,
  ClientSubscribeMessage,
  ClientTextInputMessage,
  ClientUnsubscribeMessage,
} from '@assistant/shared';
import { safeValidateClientMessage } from '@assistant/shared';

import type { RateLimiter } from '../rateLimit';

export function handleClientTextMessage(options: {
  raw: string;
  messageRateLimiter: RateLimiter | undefined;
  maxMessagesPerMinute: number;
  rateLimitWindowMs: number;
  sendError: (
    code: string,
    message: string,
    details?: unknown,
    options?: { retryable?: boolean },
  ) => void;
  onHello: (message: ClientHelloMessage) => void | Promise<void>;
  onTextInput: (message: ClientTextInputMessage) => void;
  onSetModes: (message: ClientSetModesMessage) => void;
  onControl: (message: ClientControlMessage) => void;
  onPing: (message: ClientPingMessage) => void;
  onPanelEvent: (message: ClientPanelEventMessage) => void | Promise<void>;
  onSubscribe: (message: ClientSubscribeMessage) => void | Promise<void>;
  onUnsubscribe: (message: ClientUnsubscribeMessage) => void | Promise<void>;
  onSetSessionModel: (message: ClientSetSessionModelMessage) => void | Promise<void>;
  onSetSessionThinking: (message: ClientSetSessionThinkingMessage) => void | Promise<void>;
  onCancelQueuedMessage: (message: ClientCancelQueuedMessage) => void | Promise<void>;
}): void {
  const {
    raw,
    messageRateLimiter,
    maxMessagesPerMinute,
    rateLimitWindowMs,
    sendError,
    onHello,
    onTextInput,
    onSetModes,
    onControl,
    onPing,
    onPanelEvent,
    onSubscribe,
    onUnsubscribe,
    onSetSessionModel,
    onSetSessionThinking,
    onCancelQueuedMessage,
  } = options;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    sendError('invalid_json', 'Client message was not valid JSON');
    return;
  }

  const result = safeValidateClientMessage(parsed);
  if (!result.success) {
    sendError('invalid_client_message', 'Client message validation failed', {
      issues: result.error.issues,
    });
    return;
  }

  const message = result.data;

  // Only rate limit text_input (triggers LLM calls); other messages are cheap local operations
  if (messageRateLimiter && message.type === 'text_input') {
    const rateResult = messageRateLimiter.check(1);
    if (!rateResult.allowed) {
      sendError(
        'rate_limit_messages',
        'Too many messages in a short period; please wait before sending more.',
        {
          limit: maxMessagesPerMinute,
          windowMs: rateLimitWindowMs,
          retryAfterMs: rateResult.retryAfterMs,
        },
        {
          retryable: true,
        },
      );
      return;
    }
  }

  switch (message.type) {
    case 'hello':
      void onHello(message);
      break;
    case 'text_input':
      onTextInput(message);
      break;
    case 'cancel_queued_message':
      void onCancelQueuedMessage(message);
      break;
    case 'set_modes':
      onSetModes(message);
      break;
    case 'control':
      onControl(message);
      break;
    case 'ping':
      onPing(message);
      break;
    case 'panel_event':
      void onPanelEvent(message);
      break;
    case 'subscribe':
      void onSubscribe(message);
      break;
    case 'unsubscribe':
      void onUnsubscribe(message);
      break;
    case 'set_session_model':
      void onSetSessionModel(message);
      break;
    case 'set_session_thinking':
      void onSetSessionThinking(message);
      break;
  }
}
