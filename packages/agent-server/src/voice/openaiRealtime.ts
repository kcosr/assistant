import type { Socket } from 'node:net';

import WebSocket from 'ws';

import type { RealtimeSessionConfig } from './types';

const OPENAI_API_ORIGIN = 'https://api.openai.com';

/** WebSocket ping interval for the OpenAI sideband (keeps NAT/middleboxes awake). */
export const SIDEBAND_WS_PING_INTERVAL_MS = 60_000;
/** TCP keepalive probe idle delay once the sideband socket is open. */
export const SIDEBAND_TCP_KEEPALIVE_INITIAL_DELAY_MS = 60_000;

export interface NegotiateRealtimeResult {
  answerSdp: string;
  providerCallId: string;
}

export async function negotiateOpenAiRealtimeCall(options: {
  apiKey: string;
  offerSdp: string;
  session: RealtimeSessionConfig;
}): Promise<NegotiateRealtimeResult> {
  const form = new FormData();
  form.set('sdp', options.offerSdp);
  form.set(
    'session',
    JSON.stringify({
      type: 'realtime',
      model: options.session.model,
      instructions: options.session.instructions,
      audio: {
        output: {
          voice: options.session.voice,
        },
      },
      tools: options.session.tools,
      tool_choice: 'auto',
    }),
  );

  const response = await fetch(`${OPENAI_API_ORIGIN}/v1/realtime/calls`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      Accept: 'application/sdp',
    },
    body: form,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `OpenAI realtime negotiate failed (${response.status}): ${detail.slice(0, 500)}`,
    );
  }

  const location = response.headers.get('location') ?? '';
  const providerCallId = location.split('/').filter(Boolean).at(-1) ?? '';
  if (!providerCallId.startsWith('rtc_')) {
    throw new Error('OpenAI realtime response omitted a valid call id');
  }

  const answerSdp = await response.text();
  if (!answerSdp.trim()) {
    throw new Error('OpenAI realtime returned an empty SDP answer');
  }

  return { answerSdp, providerCallId };
}

export type SidebandEventHandler = (event: Record<string, unknown>) => void | Promise<void>;

export class OpenAiRealtimeSideband {
  private static readonly LOG_PREFIX = '[voice:sideband]';
  private socket: WebSocket | null = null;
  private closed = false;
  /** True once we intentionally close; distinguishes peer/network drops from hangup. */
  private intentionalClose = false;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastPongAtMs: number | null = null;
  private pingCount = 0;

  constructor(
    private readonly apiKey: string,
    private readonly providerCallId: string,
    private readonly onEvent: SidebandEventHandler,
    private readonly onClose: (reason: string) => void,
    private readonly options: {
      pingIntervalMs?: number;
      tcpKeepAliveInitialDelayMs?: number;
    } = {},
  ) {}

  connect(): void {
    const url = `wss://api.openai.com/v1/realtime?call_id=${encodeURIComponent(this.providerCallId)}`;
    this.socket = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    this.socket.on('open', () => {
      console.info(
        `${OpenAiRealtimeSideband.LOG_PREFIX} open callId=${this.providerCallId}`,
      );
      this.enableTcpKeepAlive();
      this.startPingLoop();
    });

    this.socket.on('message', (data) => {
      void this.handleMessage(data);
    });

    this.socket.on('pong', () => {
      this.lastPongAtMs = Date.now();
      // Sparse log so we can confirm keepalive is working without flooding journal.
      if (this.pingCount === 1 || this.pingCount % 15 === 0) {
        console.info(
          `${OpenAiRealtimeSideband.LOG_PREFIX} pong callId=${this.providerCallId} pingCount=${this.pingCount}`,
        );
      }
    });

    // ws close: (code, reason Buffer). Code/reason distinguish clean peer close vs abnormal drop.
    this.socket.on('close', (code: number, reasonBuf: Buffer) => {
      this.stopPingLoop();
      const reasonText =
        reasonBuf && reasonBuf.length > 0 ? reasonBuf.toString('utf8') : '';
      const wasClean = code === 1000 || code === 1001;
      const detail = formatSidebandCloseDetail({
        callId: this.providerCallId,
        code,
        reasonText,
        wasClean,
        intentional: this.intentionalClose,
        pingCount: this.pingCount,
        lastPongAtMs: this.lastPongAtMs,
      });
      if (this.intentionalClose) {
        console.info(`${OpenAiRealtimeSideband.LOG_PREFIX} close intentional ${detail}`);
      } else {
        console.warn(`${OpenAiRealtimeSideband.LOG_PREFIX} close unexpected ${detail}`);
      }
      if (!this.closed) {
        this.closed = true;
        // Preserve sideband_closed prefix so existing filters still match; append diagnostics.
        this.onClose(
          this.intentionalClose
            ? `sideband_closed_intentional code=${code}`
            : `sideband_closed code=${code} wasClean=${wasClean}${
                reasonText ? ` reason=${JSON.stringify(reasonText.slice(0, 200))}` : ''
              }`,
        );
      }
    });

    this.socket.on('error', (error: Error) => {
      this.stopPingLoop();
      const message = error?.message ?? String(error);
      console.warn(
        `${OpenAiRealtimeSideband.LOG_PREFIX} error callId=${this.providerCallId} message=${message}`,
        error,
      );
      if (!this.closed) {
        this.closed = true;
        this.onClose(`sideband_error message=${JSON.stringify(message.slice(0, 200))}`);
      }
    });
  }

  send(event: Record<string, unknown>): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.socket.send(JSON.stringify(event));
  }

  close(): void {
    this.intentionalClose = true;
    this.closed = true;
    this.stopPingLoop();
    try {
      this.socket?.close(1000, 'client_hangup');
    } catch {
      // ignore
    }
    this.socket = null;
  }

  private enableTcpKeepAlive(): void {
    const socket = this.socket as WebSocket & { _socket?: Socket | null };
    const tcp = socket?._socket;
    if (!tcp || typeof tcp.setKeepAlive !== 'function') {
      return;
    }
    const delayMs =
      this.options.tcpKeepAliveInitialDelayMs ?? SIDEBAND_TCP_KEEPALIVE_INITIAL_DELAY_MS;
    try {
      tcp.setKeepAlive(true, delayMs);
      console.info(
        `${OpenAiRealtimeSideband.LOG_PREFIX} tcp_keepalive callId=${this.providerCallId} initialDelayMs=${delayMs}`,
      );
    } catch (error) {
      console.warn(
        `${OpenAiRealtimeSideband.LOG_PREFIX} tcp_keepalive_failed callId=${this.providerCallId}`,
        error,
      );
    }
  }

  private startPingLoop(): void {
    this.stopPingLoop();
    const intervalMs = this.options.pingIntervalMs ?? SIDEBAND_WS_PING_INTERVAL_MS;
    if (intervalMs <= 0) {
      return;
    }
    this.pingTimer = setInterval(() => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        return;
      }
      try {
        this.pingCount += 1;
        this.socket.ping();
      } catch (error) {
        console.warn(
          `${OpenAiRealtimeSideband.LOG_PREFIX} ping_failed callId=${this.providerCallId} pingCount=${this.pingCount}`,
          error,
        );
      }
    }, intervalMs);
    // Do not keep the process alive solely for pings.
    if (typeof this.pingTimer.unref === 'function') {
      this.pingTimer.unref();
    }
    console.info(
      `${OpenAiRealtimeSideband.LOG_PREFIX} ping_loop callId=${this.providerCallId} intervalMs=${intervalMs}`,
    );
  }

  private stopPingLoop(): void {
    if (this.pingTimer != null) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private async handleMessage(data: WebSocket.RawData): Promise<void> {
    try {
      const text = typeof data === 'string' ? data : data.toString('utf8');
      const event = JSON.parse(text) as Record<string, unknown>;
      // Log terminal-ish provider events that often precede a drop.
      const type = typeof event['type'] === 'string' ? event['type'] : '';
      if (
        type === 'error' ||
        type === 'session.ended' ||
        type.endsWith('.failed') ||
        type.includes('expired')
      ) {
        console.warn(
          `${OpenAiRealtimeSideband.LOG_PREFIX} event callId=${this.providerCallId} type=${type} body=${JSON.stringify(event).slice(0, 500)}`,
        );
      }
      await this.onEvent(event);
    } catch {
      // ignore malformed frames
    }
  }
}

/** @internal Exported for unit tests. */
export function formatSidebandCloseDetail(options: {
  callId: string;
  code: number;
  reasonText: string;
  wasClean: boolean;
  intentional: boolean;
  pingCount?: number;
  lastPongAtMs?: number | null;
}): string {
  const reasonPart = options.reasonText
    ? ` reason=${JSON.stringify(options.reasonText.slice(0, 200))}`
    : '';
  const pingPart =
    options.pingCount != null ? ` pingCount=${options.pingCount}` : '';
  const pongPart =
    options.lastPongAtMs != null ? ` lastPongAtMs=${options.lastPongAtMs}` : '';
  return (
    `callId=${options.callId} code=${options.code} wasClean=${options.wasClean}` +
    ` intentional=${options.intentional}${reasonPart}${pingPart}${pongPart}`
  );
}

export async function hangupOpenAiRealtimeCall(options: {
  apiKey: string;
  providerCallId: string;
}): Promise<void> {
  try {
    await fetch(
      `${OPENAI_API_ORIGIN}/v1/realtime/calls/${encodeURIComponent(options.providerCallId)}/hangup`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
        },
      },
    );
  } catch {
    // best-effort
  }
}
