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
  setInteractionState?: (state: { supported: boolean; enabled: boolean }) => void;
  connection: SessionConnection;
  sessionHub: SessionHub;
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
    setInteractionState,
    connection,
    sessionHub,
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
  if (setInteractionState) {
    const interaction = message.interaction;
    if (interaction && typeof interaction.supported === 'boolean') {
      setInteractionState({
        supported: interaction.supported,
        enabled: interaction.supported ? interaction.enabled : false,
      });
    } else {
      setInteractionState({ supported: false, enabled: false });
    }
  }

  const protocolVersion = message.protocolVersion;

  if (protocolVersion !== CURRENT_PROTOCOL_VERSION) {
    sendError('unsupported_protocol_version', `Unsupported protocol version: ${protocolVersion}`);
    close();
    return;
  }

  sessionHub.registerConnection(connection);

  try {
    for (const subscription of message.subscriptions ?? []) {
      const requestedId = subscription.sessionId.trim();
      if (!requestedId) {
        continue;
      }
      const state = await sessionHub.subscribeConnection(connection, requestedId, subscription.mask);
      const subscribedMessage: ServerSubscribedMessage = {
        type: 'subscribed',
        sessionId: state.summary.sessionId,
        ...(subscription.mask ? { mask: subscription.mask } : {}),
      };
      sendMessage(subscribedMessage);
      onSessionSubscribed?.(state);
    }
  } catch (err) {
    sendError(
      'internal_error',
      'Failed to initialise subscriptions for protocol v3 hello',
      { error: String(err) },
      { retryable: true },
    );
    close();
    return;
  }
}
