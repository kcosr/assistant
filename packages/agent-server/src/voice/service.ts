import type { EnvConfig } from '../envConfig';
import type { ToolContext, ToolHost } from '../tools';
import { ToolError } from '../tools';

import {
  buildRealtimeInstructions,
  buildRealtimeToolsFromHost,
  isRealtimeEndSessionTool,
  isToolAllowedForVoiceRealtime,
} from './listsTools';
import {
  hangupOpenAiRealtimeCall,
  negotiateOpenAiRealtimeCall,
  OpenAiRealtimeSideband,
} from './openaiRealtime';
import { VoiceStore } from './store';
import type {
  VoiceCapabilities,
  VoiceConversationId,
  VoiceSessionId,
  VoiceSessionRecord,
} from './types';

export interface VoiceServiceOptions {
  envConfig: EnvConfig;
  toolHost: ToolHost;
  createToolContext: (sessionId: string) => ToolContext;
  model?: string;
  voice?: string;
  /**
   * Realtime tool globs. Missing/empty allowlist => no tools (explicit opt-in).
   */
  toolAllowlist?: string[];
  toolDenylist?: string[];
  /** Optional instructions override from app config. */
  instructions?: string;
}

interface LiveRealtimeCall {
  sessionId: VoiceSessionId;
  conversationId: VoiceConversationId;
  providerCallId: string;
  sideband: OpenAiRealtimeSideband;
  listsInstanceId: string;
}

/** Drop live Realtime sessions that miss heartbeats for this long (client interval is 15s). */
const HEARTBEAT_LEASE_MS = 45_000;
const LEASE_REAPER_INTERVAL_MS = 15_000;
/** Cap retained closed/failed sessions in the durable store. */
const MAX_TERMINAL_SESSIONS = 100;

export class VoiceService {
  private readonly store: VoiceStore;
  private readonly liveCalls = new Map<VoiceSessionId, LiveRealtimeCall>();
  private readonly model: string;
  private readonly voice: string;
  private readonly toolAllowlist: string[] | undefined;
  private readonly toolDenylist: string[] | undefined;
  private readonly instructionsOverride: string | undefined;
  private leaseReaperTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly options: VoiceServiceOptions,
    dataDir: string,
  ) {
    this.store = new VoiceStore(dataDir);
    // Match T3 Realtime defaults (OpenAiVoiceProvider: gpt-realtime-2.1 + marin).
    this.model =
      options.model?.trim() ||
      process.env['OPENAI_REALTIME_MODEL']?.trim() ||
      'gpt-realtime-2.1';
    this.voice =
      options.voice?.trim() ||
      process.env['OPENAI_REALTIME_VOICE']?.trim() ||
      options.envConfig.ttsVoice ||
      'marin';
    this.toolAllowlist = options.toolAllowlist;
    this.toolDenylist = options.toolDenylist;
    this.instructionsOverride = options.instructions;
  }

  async init(): Promise<void> {
    await this.store.init();
    this.startLeaseReaper();
  }

  shutdown(): void {
    if (this.leaseReaperTimer) {
      clearInterval(this.leaseReaperTimer);
      this.leaseReaperTimer = null;
    }
  }

  capabilities(): VoiceCapabilities {
    const apiKey = this.options.envConfig.apiKey;
    return {
      agentRealtime: {
        status: apiKey ? 'ready' : 'not-configured',
        model: this.model,
        voice: this.voice,
      },
    };
  }

  async createConversation(input: {
    conversationId?: string | null;
    listsInstanceId?: string;
  }) {
    return this.store.getOrCreateConversation({
      ...(input.conversationId !== undefined ? { conversationId: input.conversationId } : {}),
      ...(input.listsInstanceId !== undefined ? { listsInstanceId: input.listsInstanceId } : {}),
    });
  }

  async getConversation(id: VoiceConversationId) {
    return this.store.getConversation(id);
  }

  async createSession(input: {
    conversationId?: string | null;
    listsInstanceId?: string;
  }): Promise<{ conversationId: string; session: VoiceSessionRecord }> {
    const conversation = await this.store.getOrCreateConversation({
      ...(input.conversationId !== undefined ? { conversationId: input.conversationId } : {}),
      ...(input.listsInstanceId !== undefined ? { listsInstanceId: input.listsInstanceId } : {}),
    });
    const session = await this.store.createSession({
      conversationId: conversation.id,
      listsInstanceId: input.listsInstanceId?.trim() || conversation.listsInstanceId,
    });
    return { conversationId: conversation.id, session };
  }

  async getSession(sessionId: VoiceSessionId) {
    return this.store.getSession(sessionId);
  }

  async negotiateOffer(input: {
    sessionId: VoiceSessionId;
    offerSdp: string;
  }): Promise<{ answerSdp: string; providerCallId: string }> {
    const apiKey = this.requireApiKey();
    const session = await this.store.getSession(input.sessionId);
    if (!session) {
      throw new Error('Voice session not found');
    }
    if (session.state === 'closed' || session.state === 'failed') {
      throw new Error(`Voice session is ${session.state}`);
    }

    const conversation = await this.store.getConversation(session.conversationId);
    if (!conversation) {
      throw new Error('Voice conversation not found');
    }

    await this.store.updateSession(session.id, { state: 'connecting' });
    await this.store.appendEvent(session.id, {
      type: 'session_state',
      state: 'connecting',
    });

    const contextBlock = this.store.recentJournalText(conversation);
    const tools = await buildRealtimeToolsFromHost({
      listTools: () => this.options.toolHost.listTools(),
      toolAllowlist: this.toolAllowlist,
      toolDenylist: this.toolDenylist,
    });
    const negotiated = await negotiateOpenAiRealtimeCall({
      apiKey,
      offerSdp: input.offerSdp,
      session: {
        model: this.model,
        voice: this.voice,
        instructions: buildRealtimeInstructions(contextBlock, this.instructionsOverride),
        tools,
      },
    });

    await this.store.updateSession(session.id, {
      state: 'connected',
      providerCallId: negotiated.providerCallId,
      lastError: null,
    });
    await this.store.appendEvent(session.id, {
      type: 'session_state',
      state: 'connected',
    });

    const sideband = new OpenAiRealtimeSideband(
      apiKey,
      negotiated.providerCallId,
      (event) => this.handleSidebandEvent(session.id, event),
      (reason) => {
        void this.failSession(session.id, reason);
      },
    );
    sideband.connect();
    this.liveCalls.set(session.id, {
      sessionId: session.id,
      conversationId: session.conversationId,
      providerCallId: negotiated.providerCallId,
      sideband,
      listsInstanceId: session.listsInstanceId,
    });

    return {
      answerSdp: negotiated.answerSdp,
      providerCallId: negotiated.providerCallId,
    };
  }

  async setMuted(sessionId: VoiceSessionId, muted: boolean): Promise<VoiceSessionRecord | null> {
    return this.store.updateSession(sessionId, { muted });
  }

  async heartbeat(sessionId: VoiceSessionId): Promise<VoiceSessionRecord | null> {
    // Touch via updateSession so the lease timestamp is durable, not only in-memory.
    return this.store.updateSession(sessionId, {});
  }

  private startLeaseReaper(): void {
    if (this.leaseReaperTimer) {
      return;
    }
    this.leaseReaperTimer = setInterval(() => {
      void this.reapStaleLiveCalls().catch((error) => {
        console.warn('[voice] lease reaper failed', error);
      });
    }, LEASE_REAPER_INTERVAL_MS);
    // Do not keep the process alive solely for the reaper.
    if (typeof this.leaseReaperTimer.unref === 'function') {
      this.leaseReaperTimer.unref();
    }
  }

  /** @internal Exported for tests via package access pattern. */
  async reapStaleLiveCalls(nowMs = Date.now()): Promise<string[]> {
    const reaped: string[] = [];
    for (const [sessionId, live] of [...this.liveCalls.entries()]) {
      const session = await this.store.getSession(sessionId);
      if (!session) {
        live.sideband.close();
        this.liveCalls.delete(sessionId);
        reaped.push(sessionId);
        continue;
      }
      if (session.state === 'closed' || session.state === 'failed') {
        live.sideband.close();
        this.liveCalls.delete(sessionId);
        reaped.push(sessionId);
        continue;
      }
      const age = nowMs - session.updatedAtMs;
      if (age > HEARTBEAT_LEASE_MS) {
        const apiKey = this.options.envConfig.apiKey;
        live.sideband.close();
        this.liveCalls.delete(sessionId);
        if (apiKey && live.providerCallId) {
          await hangupOpenAiRealtimeCall({ apiKey, providerCallId: live.providerCallId }).catch(
            () => undefined,
          );
        }
        await this.store.updateSession(sessionId, {
          state: 'failed',
          lastError: 'heartbeat_lease_expired',
        });
        await this.store.appendEvent(sessionId, {
          type: 'error',
          code: 'heartbeat_lease_expired',
          message: 'Realtime session lease expired (missed heartbeats)',
        });
        await this.store.appendEvent(sessionId, {
          type: 'session_state',
          state: 'failed',
          message: 'heartbeat_lease_expired',
        });
        reaped.push(sessionId);
      }
    }
    await this.store.pruneTerminalSessions(MAX_TERMINAL_SESSIONS);
    return reaped;
  }

  async events(sessionId: VoiceSessionId, afterSequence: number) {
    return this.store.eventsSince(sessionId, afterSequence);
  }

  async closeSession(sessionId: VoiceSessionId, reason = 'client_stop'): Promise<void> {
    const live = this.liveCalls.get(sessionId);
    if (live) {
      live.sideband.close();
      this.liveCalls.delete(sessionId);
      const apiKey = this.options.envConfig.apiKey;
      if (apiKey && live.providerCallId) {
        await hangupOpenAiRealtimeCall({ apiKey, providerCallId: live.providerCallId });
      }
    }
    await this.store.updateSession(sessionId, { state: 'closed', lastError: null });
    await this.store.appendEvent(sessionId, { type: 'closed', reason });
    await this.store.appendEvent(sessionId, { type: 'session_state', state: 'closed' });
  }

  private requireApiKey(): string {
    const apiKey = this.options.envConfig.apiKey?.trim();
    if (!apiKey) {
      throw new Error(
        'OPENAI_API_KEY is not configured. Set the environment variable on the agent-server host.',
      );
    }
    return apiKey;
  }

  private async failSession(sessionId: VoiceSessionId, reason: string): Promise<void> {
    const live = this.liveCalls.get(sessionId);
    if (live) {
      live.sideband.close();
      this.liveCalls.delete(sessionId);
    }
    await this.store.updateSession(sessionId, { state: 'failed', lastError: reason });
    await this.store.appendEvent(sessionId, {
      type: 'error',
      code: 'realtime_failed',
      message: reason,
    });
    await this.store.appendEvent(sessionId, { type: 'session_state', state: 'failed', message: reason });
  }

  private async handleSidebandEvent(
    sessionId: VoiceSessionId,
    event: Record<string, unknown>,
  ): Promise<void> {
    const type = typeof event['type'] === 'string' ? event['type'] : '';
    const live = this.liveCalls.get(sessionId);
    if (!live) {
      return;
    }

    if (type === 'response.output_audio_transcript.done' || type === 'response.audio_transcript.done') {
      const text = typeof event['transcript'] === 'string' ? event['transcript'] : '';
      if (text.trim()) {
        await this.store.appendJournal(live.conversationId, {
          kind: 'assistant_transcript',
          text: text.trim(),
        });
        await this.store.appendEvent(sessionId, {
          type: 'transcript',
          role: 'assistant',
          text: text.trim(),
          final: true,
        });
      }
      return;
    }

    if (type === 'conversation.item.input_audio_transcription.completed') {
      const text = typeof event['transcript'] === 'string' ? event['transcript'] : '';
      if (text.trim()) {
        await this.store.appendJournal(live.conversationId, {
          kind: 'user_transcript',
          text: text.trim(),
        });
        await this.store.appendEvent(sessionId, {
          type: 'transcript',
          role: 'user',
          text: text.trim(),
          final: true,
        });
      }
      return;
    }

    if (type === 'response.function_call_arguments.done') {
      const name = typeof event['name'] === 'string' ? event['name'] : '';
      const callId = typeof event['call_id'] === 'string' ? event['call_id'] : '';
      const argsJson = typeof event['arguments'] === 'string' ? event['arguments'] : '{}';
      await this.executeToolCall({
        sessionId,
        live,
        name,
        callId,
        argsJson,
      });
      return;
    }

    if (type === 'error') {
      const message =
        typeof event['error'] === 'object' && event['error'] && 'message' in (event['error'] as object)
          ? String((event['error'] as { message?: unknown }).message ?? 'provider_error')
          : 'provider_error';
      await this.store.appendEvent(sessionId, {
        type: 'error',
        code: 'provider_error',
        message,
      });
    }
  }

  private async executeToolCall(input: {
    sessionId: VoiceSessionId;
    live: LiveRealtimeCall;
    name: string;
    callId: string;
    argsJson: string;
  }): Promise<void> {
    const { sessionId, live, name, callId, argsJson } = input;
    if (!name || !callId) {
      return;
    }

    await this.store.appendEvent(sessionId, {
      type: 'tool',
      name,
      status: 'started',
    });

    if (!isToolAllowedForVoiceRealtime(name, this.toolAllowlist, this.toolDenylist)) {
      const denied = { error: `Tool not allowed in realtime: ${name}` };
      live.sideband.send({
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: callId,
          output: JSON.stringify(denied),
        },
      });
      live.sideband.send({ type: 'response.create' });
      await this.store.appendEvent(sessionId, {
        type: 'tool',
        name,
        status: 'failed',
        detail: 'not_allowed',
      });
      return;
    }

    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(argsJson) as Record<string, unknown>;
    } catch {
      args = {};
    }
    if (!args['instance_id'] && live.listsInstanceId) {
      args['instance_id'] = live.listsInstanceId;
    }

    await this.store.appendJournal(live.conversationId, {
      kind: 'tool_request',
      toolName: name,
      toolCallId: callId,
      payload: args,
    });

    // Built-in hangup: acknowledge the tool, then close so the client plays the end cue.
    if (isRealtimeEndSessionTool(name)) {
      // Protocol close reason is always a success token so the client plays SUCCESS_COMPLETION.
      // Free-text model detail stays only in the tool result / journal payload.
      const detail =
        typeof args['reason'] === 'string' && args['reason'].trim().length > 0
          ? args['reason'].trim()
          : 'agent_end';
      const reason = 'agent_end';
      const output = { ok: true, ending: true, reason, detail };
      await this.store.appendJournal(live.conversationId, {
        kind: 'tool_result',
        toolName: name,
        toolCallId: callId,
        payload: output,
      });
      await this.store.appendEvent(sessionId, {
        type: 'tool',
        name,
        status: 'completed',
      });
      // Best-effort tool output before hangup (provider may already be tearing down).
      try {
        live.sideband.send({
          type: 'conversation.item.create',
          item: {
            type: 'function_call_output',
            call_id: callId,
            output: JSON.stringify(output),
          },
        });
      } catch {
        // ignore
      }
      await this.closeSession(sessionId, reason);
      return;
    }

    const ctx = this.options.createToolContext(`voice:${live.conversationId}`);
    let output: unknown;
    try {
      output = await this.options.toolHost.callTool(name, JSON.stringify(args), ctx);
      await this.store.appendJournal(live.conversationId, {
        kind: 'tool_result',
        toolName: name,
        toolCallId: callId,
        payload: output,
      });
      await this.store.appendEvent(sessionId, {
        type: 'tool',
        name,
        status: 'completed',
      });
    } catch (error) {
      const message =
        error instanceof ToolError
          ? error.message
          : error instanceof Error
            ? error.message
            : 'tool_failed';
      output = { error: message };
      await this.store.appendEvent(sessionId, {
        type: 'tool',
        name,
        status: 'failed',
        detail: message,
      });
    }

    live.sideband.send({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: callId,
        output: JSON.stringify(output ?? {}),
      },
    });
    live.sideband.send({ type: 'response.create' });
  }
}
