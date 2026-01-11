import type { ClientAudioCapabilities, ClientHelloMessage } from '@assistant/shared';

export interface ConnectionManagerOptions {
  createWebSocketUrl: () => string;
  setStatus: (text: string) => void;
  protocolVersion: number;
  supportsAudioOutput: () => boolean;
  onMessage: (data: MessageEvent['data']) => void | Promise<void>;
  onOpen?: () => void;
  getSocket: () => WebSocket | null;
  setSocket: (socket: WebSocket | null) => void;
  onConnectionLostCleanup: () => void;
  reconnectDelayMs: number;
  maxReconnectDelayMs: number;
}

export class ConnectionManager {
  private reconnectAttempts = 0;
  private reconnectTimeoutId: number | null = null;
  private intentionalClose = false;
  private readonly subscribedSessions = new Set<string>();

  constructor(private readonly options: ConnectionManagerOptions) {}

  private scheduleReconnect(): void {
    if (this.intentionalClose) {
      return;
    }

    if (this.reconnectTimeoutId !== null) {
      return;
    }

    const delay = Math.min(
      this.options.reconnectDelayMs * Math.pow(2, this.reconnectAttempts),
      this.options.maxReconnectDelayMs,
    );
    this.reconnectAttempts += 1;

    this.options.setStatus(`Reconnecting in ${Math.round(delay / 1000)}s…`);

    this.reconnectTimeoutId = window.setTimeout(() => {
      this.reconnectTimeoutId = null;
      this.connect();
    }, delay);
  }

  connect(): void {
    console.log('[client] connect called', { hasSocket: !!this.options.getSocket() });

    if (this.reconnectTimeoutId !== null) {
      window.clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }

    const existingSocket = this.options.getSocket();
    if (existingSocket) {
      console.log('[client] connect: closing existing socket', {
        readyState: existingSocket.readyState,
      });
      if (
        existingSocket.readyState === WebSocket.OPEN ||
        existingSocket.readyState === WebSocket.CONNECTING
      ) {
        this.intentionalClose = true;
        existingSocket.close();
      }
      this.options.setSocket(null);
    }

    this.options.setStatus('Connecting…');

    const url = this.options.createWebSocketUrl();
    const newSocket = new WebSocket(url);
    this.options.setSocket(newSocket);
    newSocket.binaryType = 'arraybuffer';

    newSocket.addEventListener('open', () => {
      if (this.options.getSocket() !== newSocket) {
        console.log('[client] socket open: stale socket, ignoring');
        return;
      }
      console.log('[client] socket open');
      this.intentionalClose = false;
      this.reconnectAttempts = 0;
      this.options.setStatus('Connected');

      const canAudioOut = this.options.supportsAudioOutput();
      const audioCapabilities: ClientAudioCapabilities | undefined = canAudioOut
        ? { audioOut: true }
        : undefined;
      const subscriptions = Array.from(this.subscribedSessions);
      const useV2Hello = this.options.protocolVersion >= 2;
      const hello: ClientHelloMessage = {
        type: 'hello',
        protocolVersion: this.options.protocolVersion,
        userAgent: window.navigator.userAgent,
        audio: audioCapabilities,
        ...(useV2Hello ? { subscriptions } : {}),
      };
      newSocket.send(JSON.stringify(hello));
      this.options.onOpen?.();
    });

    newSocket.addEventListener('message', (event) => {
      if (this.options.getSocket() !== newSocket) {
        return;
      }
      void this.options.onMessage(event.data);
    });

    newSocket.addEventListener('close', () => {
      if (this.options.getSocket() !== newSocket) {
        console.log('[client] socket close: stale socket, ignoring');
        return;
      }
      console.log('[client] socket close', { intentionalClose: this.intentionalClose });
      this.options.setSocket(null);

      this.options.onConnectionLostCleanup();

      if (!this.intentionalClose) {
        console.log('[client] socket close: scheduling reconnect');
        this.options.setStatus('Disconnected');
        this.scheduleReconnect();
      }
    });

    newSocket.addEventListener('error', (e) => {
      if (this.options.getSocket() !== newSocket) {
        console.log('[client] socket error: stale socket, ignoring');
        return;
      }
      console.log('[client] socket error', e);
      this.options.setStatus('Connection error');
      this.options.onConnectionLostCleanup();
    });
  }

  subscribe(sessionId: string): void {
    const trimmed = sessionId.trim();
    if (!trimmed) {
      return;
    }

    this.subscribedSessions.add(trimmed);

    const socket = this.options.getSocket();
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const message = {
      type: 'subscribe',
      sessionId: trimmed,
    };
    socket.send(JSON.stringify(message));
  }

  unsubscribe(sessionId: string): void {
    const trimmed = sessionId.trim();
    if (!trimmed) {
      return;
    }

    this.subscribedSessions.delete(trimmed);

    const socket = this.options.getSocket();
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const message = {
      type: 'unsubscribe',
      sessionId: trimmed,
    };
    socket.send(JSON.stringify(message));
  }

  handleSessionDeleted(sessionId: string): void {
    const trimmed = sessionId.trim();
    if (!trimmed) {
      return;
    }
    this.subscribedSessions.delete(trimmed);
  }
}
