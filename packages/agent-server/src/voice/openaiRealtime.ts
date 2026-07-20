import WebSocket from 'ws';

import type { RealtimeSessionConfig } from './types';

const OPENAI_API_ORIGIN = 'https://api.openai.com';

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

  constructor(
    private readonly apiKey: string,
    private readonly providerCallId: string,
    private readonly onEvent: SidebandEventHandler,
    private readonly onClose: (reason: string) => void,
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
    });

    this.socket.on('message', (data) => {
      void this.handleMessage(data);
    });

    // ws close: (code, reason Buffer). Code/reason distinguish clean peer close vs abnormal drop.
    this.socket.on('close', (code: number, reasonBuf: Buffer) => {
      const reasonText =
        reasonBuf && reasonBuf.length > 0 ? reasonBuf.toString('utf8') : '';
      const wasClean = code === 1000 || code === 1001;
      const detail = formatSidebandCloseDetail({
        callId: this.providerCallId,
        code,
        reasonText,
        wasClean,
        intentional: this.intentionalClose,
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
    try {
      this.socket?.close(1000, 'client_hangup');
    } catch {
      // ignore
    }
    this.socket = null;
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

function formatSidebandCloseDetail(options: {
  callId: string;
  code: number;
  reasonText: string;
  wasClean: boolean;
  intentional: boolean;
}): string {
  const reasonPart = options.reasonText
    ? ` reason=${JSON.stringify(options.reasonText.slice(0, 200))}`
    : '';
  return (
    `callId=${options.callId} code=${options.code} wasClean=${options.wasClean}` +
    ` intentional=${options.intentional}${reasonPart}`
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
