import type { ServerMessage } from '@assistant/shared';

export interface SessionConnection {
  id?: string;
  sendServerMessageFromHub(message: ServerMessage): void;
  sendErrorFromHub(code: string, message: string): void;

  /**
   * Optional multiplexing helpers. Implemented by MultiplexedConnection;
   * other SessionConnection implementations may treat these as no-ops.
   */
  subscribe?(sessionId: string): void;
  unsubscribe?(sessionId: string): void;
  isSubscribedTo?(sessionId: string): boolean;
  sendIfSubscribed?(sessionId: string, message: ServerMessage): void;
}
