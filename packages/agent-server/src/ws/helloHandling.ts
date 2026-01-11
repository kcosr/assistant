import type {
  ClientHelloMessage,
  ServerMessage,
  ServerSubscribedMessage,
} from '@assistant/shared';
import { CURRENT_PROTOCOL_VERSION } from '@assistant/shared';

import type { LogicalSessionState, SessionHub } from '../sessionHub';

import type { SessionConnection } from './sessionConnection';

export interface HandleHelloOptions {
  message: ClientHelloMessage;
  clientHelloReceived: boolean;
  setClientHelloReceived: (received: boolean) => void;
  setClientAudioCapabilities: (audio: ClientHelloMessage['audio']) => void;
  connection: SessionConnection;
  sessionHub: SessionHub;
  setSessionState: (state: LogicalSessionState) => void;
  setSessionId: (sessionId: string) => void;
  configureChatCompletionsSession: () => void;
  onSessionSubscribed?: (state: LogicalSessionState) => void;
  sendMessage: (message: ServerMessage) => void;
  sendError: (
    code: string,
    message: string,
    details?: unknown,
    options?: { retryable?: boolean },
  ) => void;
  close: () => void;
}

export async function handleHello(options: HandleHelloOptions): Promise<void> {
  const {
    message,
    clientHelloReceived,
    setClientHelloReceived,
    setClientAudioCapabilities,
    connection,
    sessionHub,
    setSessionState,
    setSessionId,
    configureChatCompletionsSession,
    onSessionSubscribed,
    sendMessage,
    sendError,
    close,
  } = options;

  if (clientHelloReceived) {
    sendError('duplicate_hello', 'hello has already been received');
    return;
  }

  setClientHelloReceived(true);
  setClientAudioCapabilities(message.audio);

  const protocolVersion = message.protocolVersion;

  if (protocolVersion !== 1 && protocolVersion !== CURRENT_PROTOCOL_VERSION) {
    sendError('unsupported_protocol_version', `Unsupported protocol version: ${protocolVersion}`);
    close();
    return;
  }

  sessionHub.registerConnection(connection);

  const isV2Hello =
    protocolVersion === CURRENT_PROTOCOL_VERSION && Array.isArray(message.subscriptions);

  if (!isV2Hello) {
    try {
      const state = await sessionHub.attachConnection(connection, message.sessionId);
      setSessionState(state);
      setSessionId(state.summary.sessionId);
      onSessionSubscribed?.(state);
    } catch (err) {
      sendError(
        'internal_error',
        'Failed to initialise session',
        { error: String(err) },
        { retryable: true },
      );
      close();
      return;
    }
  } else {
    const rawSubscriptions = message.subscriptions ?? [];
    const trimmedSubscriptions = rawSubscriptions
      .map((id) => (typeof id === 'string' ? id.trim() : ''))
      .filter((id) => id.length > 0);

    const fallbackSessionId =
      typeof message.sessionId === 'string' && message.sessionId.trim().length > 0
        ? message.sessionId.trim()
        : undefined;

    const initialSubscriptions: string[] = [];

    if (trimmedSubscriptions.length > 0) {
      initialSubscriptions.push(...trimmedSubscriptions);
    }

    if (fallbackSessionId && !initialSubscriptions.includes(fallbackSessionId)) {
      initialSubscriptions.unshift(fallbackSessionId);
    }

    let primaryState: LogicalSessionState | undefined;

    try {
      for (const requestedId of initialSubscriptions) {
        const state = await sessionHub.subscribeConnection(connection, requestedId);
        const subscribedMessage: ServerSubscribedMessage = {
          type: 'subscribed',
          sessionId: state.summary.sessionId,
        };
        sendMessage(subscribedMessage);
        if (!primaryState) {
          primaryState = state;
        }
        onSessionSubscribed?.(state);
      }
    } catch (err) {
      sendError(
        'internal_error',
        'Failed to initialise subscriptions for protocol v2 hello',
        { error: String(err) },
        { retryable: true },
      );
      close();
      return;
    }

    if (primaryState) {
      setSessionState(primaryState);
      setSessionId(primaryState.summary.sessionId);
    }
  }

  configureChatCompletionsSession();
}
