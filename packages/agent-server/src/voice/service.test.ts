import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EnvConfig } from '../envConfig';
import { CodingToolHost, type ToolContext, type ToolHost } from '../tools';
import { negotiateOpenAiRealtimeCall, OpenAiRealtimeSideband } from './openaiRealtime';
import { VoiceService } from './service';

vi.mock('./openaiRealtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./openaiRealtime')>();
  return {
    ...actual,
    negotiateOpenAiRealtimeCall: vi.fn(),
    OpenAiRealtimeSideband: vi.fn(),
  };
});

const tempDirs: string[] = [];

function makeEnv(partial: Partial<EnvConfig> = {}): EnvConfig {
  return {
    port: 3000,
    toolsEnabled: true,
    dataDir: partial.dataDir ?? path.join(os.tmpdir(), 'voice-test'),
    audioInputMode: 'manual',
    audioSampleRate: 24000,
    audioTranscriptionEnabled: false,
    audioOutputVoice: undefined,
    audioOutputSpeed: undefined,
    ttsModel: 'gpt-4o-mini-tts',
    ttsVoice: 'alloy',
    ttsFrameDurationMs: 250,
    ttsBackend: 'openai',
    elevenLabsApiKey: undefined,
    elevenLabsVoiceId: undefined,
    elevenLabsModelId: undefined,
    elevenLabsBaseUrl: undefined,
    maxMessagesPerMinute: 0,
    maxAudioBytesPerMinute: 0,
    maxToolCallsPerMinute: 0,
    debugChatCompletions: false,
    debugHttpRequests: false,
    ...partial,
  };
}

function makeToolHost(callTool = vi.fn(async () => ({ ok: true }))): ToolHost {
  return {
    listTools: async () => [],
    callTool,
  };
}

function makeToolContext(sessionId: string): ToolContext {
  return {
    sessionId,
    signal: new AbortController().signal,
    eventStore: {} as NonNullable<ToolContext['eventStore']>,
    sessionHub: {} as NonNullable<ToolContext['sessionHub']>,
    sessionIndex: {} as NonNullable<ToolContext['sessionIndex']>,
    agentRegistry: {} as NonNullable<ToolContext['agentRegistry']>,
    envConfig: makeEnv(),
    baseToolHost: makeToolHost(),
  };
}

describe('VoiceService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map(async (dir) => {
        await fs.rm(dir, { recursive: true, force: true });
      }),
    );
  });

  it.each([0, 7])(
    'records native Bash exit %i with its status and structured result',
    async (exitCode) => {
      const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-bash-result-'));
      tempDirs.push(dataDir);
      const send = vi.fn<(message: { type: string; item?: { output: string } }) => void>();
      let onProviderEvent: ((event: Record<string, unknown>) => void | Promise<void>) | undefined;
      vi.mocked(negotiateOpenAiRealtimeCall).mockResolvedValue({
        answerSdp: 'answer',
        providerCallId: 'provider-call',
      });
      vi.mocked(OpenAiRealtimeSideband).mockImplementation((_apiKey, _callId, onEvent) => {
        onProviderEvent = onEvent;
        return { connect: vi.fn(), close: vi.fn(), send } as unknown as OpenAiRealtimeSideband;
      });
      const service = new VoiceService(
        {
          envConfig: makeEnv({ dataDir, apiKey: 'test-key' }),
          toolHost: new CodingToolHost({ dataDir }),
          createToolContext: makeToolContext,
          toolAllowlist: ['bash'],
        },
        dataDir,
      );
      try {
        await service.init();
        const created = await service.createSession({});
        await service.negotiateOffer({ sessionId: created.session.id, offerSdp: 'offer' });
        expect(onProviderEvent).toBeDefined();
        await onProviderEvent!({
          type: 'response.function_call_arguments.done',
          name: 'bash',
          call_id: 'bash-result',
          arguments: JSON.stringify({ command: `printf "command output"; exit ${exitCode}` }),
        });

        const events = await service.events(created.session.id, 0);
        expect(events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: 'tool',
              name: 'bash',
              status: exitCode === 0 ? 'completed' : 'failed',
              ...(exitCode === 0
                ? {}
                : { detail: expect.stringContaining('Command exited with code 7') }),
            }),
          ]),
        );
        const output = send.mock.calls.find(([message]) => message.item)?.[0].item?.output;
        expect(output).toBeDefined();
        const result = JSON.parse(output!);
        expect(result).toMatchObject({
          content: [{ type: 'text', text: expect.stringContaining('command output') }],
          structuredContent: { exit_code: exitCode, output: 'command output' },
          ...(exitCode === 0 ? {} : { isError: true }),
        });
        const conversation = await service.getConversation(created.conversationId);
        expect(
          conversation?.journal.find((entry) => entry.kind === 'tool_result')?.payload,
        ).toEqual(result);
      } finally {
        service.shutdown();
      }
    },
    15_000,
  );

  it('reports not-configured without OPENAI_API_KEY', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-svc-'));
    tempDirs.push(dataDir);
    const service = new VoiceService(
      {
        envConfig: makeEnv({ dataDir }),
        toolHost: makeToolHost(),
        createToolContext: makeToolContext,
      },
      dataDir,
    );
    await service.init();
    expect(service.capabilities().agentRealtime.status).toBe('not-configured');
  });

  it('creates a conversation and session', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-svc-'));
    tempDirs.push(dataDir);
    const service = new VoiceService(
      {
        envConfig: makeEnv({ dataDir, apiKey: 'test-key' }),
        toolHost: makeToolHost(),
        createToolContext: makeToolContext,
      },
      dataDir,
    );
    await service.init();
    expect(service.capabilities().agentRealtime.status).toBe('ready');

    const created = await service.createSession({ listsInstanceId: 'default' });
    expect(created.conversationId).toBeTruthy();
    expect(created.session.state).toBe('created');

    const loaded = await service.getSession(created.session.id);
    expect(loaded?.conversationId).toBe(created.conversationId);
    service.shutdown();
  });

  it('persists heartbeat lease timestamps', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'voice-svc-'));
    tempDirs.push(dataDir);
    const service = new VoiceService(
      {
        envConfig: makeEnv({ dataDir, apiKey: 'test-key' }),
        toolHost: makeToolHost(),
        createToolContext: makeToolContext,
      },
      dataDir,
    );
    await service.init();
    const created = await service.createSession({ listsInstanceId: 'default' });
    const before = created.session.updatedAtMs;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const heartbeated = await service.heartbeat(created.session.id);
    expect(heartbeated?.updatedAtMs).toBeGreaterThanOrEqual(before);
    service.shutdown();
  });
});
