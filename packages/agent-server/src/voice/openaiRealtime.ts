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
  private socket: WebSocket | null = null;
  private closed = false;

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
      // no-op; session was configured at negotiate time
    });

    this.socket.on('message', (data) => {
      void this.handleMessage(data);
    });

    this.socket.on('close', () => {
      if (!this.closed) {
        this.closed = true;
        this.onClose('sideband_closed');
      }
    });

    this.socket.on('error', () => {
      if (!this.closed) {
        this.closed = true;
        this.onClose('sideband_error');
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
    this.closed = true;
    try {
      this.socket?.close();
    } catch {
      // ignore
    }
    this.socket = null;
  }

  private async handleMessage(data: WebSocket.RawData): Promise<void> {
    try {
      const text = typeof data === 'string' ? data : data.toString('utf8');
      const event = JSON.parse(text) as Record<string, unknown>;
      await this.onEvent(event);
    } catch {
      // ignore malformed frames
    }
  }
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
