import fs from 'node:fs';
import path from 'node:path';

import type { McpServerConfig } from './tools';
import type { AudioInputMode } from './modes';

export interface EnvConfig {
  port: number;
  /**
   * Global OpenAI API key. When unset, OpenAI-based chat providers are disabled
   * but CLI providers (claude-cli, codex-cli, pi-cli) may still be used.
   */
  apiKey?: string;
  /**
   * Default OpenAI chat model id for built-in OpenAI provider.
   * When unset, OpenAI-based chat providers are disabled.
   */
  chatModel?: string;
  mcpServers?: McpServerConfig[];
  toolsEnabled: boolean;
  /**
   * Legacy single-file conversation log path. Kept for migration warnings.
   */
  conversationLogPath: string;
  /**
   * Directory for per-session JSONL transcripts.
   */
  transcriptsDir: string;
  /**
   * Root directory for JSONL conversation logs and related data.
   */
  dataDir: string;
  audioInputMode: AudioInputMode;
  audioSampleRate: number;
  audioTranscriptionEnabled: boolean;
  audioOutputVoice: string | undefined;
  audioOutputSpeed: number | undefined;
  /**
   * TTS configuration for synthesizing assistant text.
   */
  ttsModel: string;
  ttsVoice: string | undefined;
  /**
   * TTS PCM frame duration in milliseconds.
   */
  ttsFrameDurationMs: number;
  /**
   * Logical TTS backend selection.
   */
  ttsBackend: 'openai' | 'elevenlabs';
  /**
   * ElevenLabs configuration for the ElevenLabs TTS backend.
   */
  elevenLabsApiKey: string | undefined;
  elevenLabsVoiceId: string | undefined;
  elevenLabsModelId: string | undefined;
  elevenLabsBaseUrl: string | undefined;
  /**
   * Per-session rate limits (sliding 1-minute window).
   * Values <= 0 effectively disable the corresponding limit.
   */
  maxMessagesPerMinute: number;
  maxAudioBytesPerMinute: number;
  maxToolCallsPerMinute: number;
  /**
   * Enable debug logging for chat completion requests/responses.
   */
  debugChatCompletions: boolean;
  /**
   * Enable debug logging for HTTP requests.
   */
  debugHttpRequests: boolean;
}

export function loadEnvConfig(): EnvConfig {
  const port = Number(process.env['PORT']) || 3000;
  const apiKeyEnv = process.env['OPENAI_API_KEY'];
  const apiKey =
    typeof apiKeyEnv === 'string' && apiKeyEnv.trim().length > 0 ? apiKeyEnv.trim() : undefined;
  const chatModelEnvRaw = process.env['OPENAI_CHAT_MODEL'];

  const toolsEnabledEnv = process.env['MCP_TOOLS_ENABLED'];
  const toolsEnabled =
    toolsEnabledEnv !== undefined &&
    (toolsEnabledEnv.toLowerCase() === 'true' || toolsEnabledEnv === '1');
  const dataDirEnv = process.env['DATA_DIR'];
  const dataDir =
    dataDirEnv && dataDirEnv.trim().length > 0
      ? path.resolve(dataDirEnv)
      : path.resolve(process.cwd(), 'data');

  const conversationLogPathEnv = process.env['CONVERSATION_LOG_PATH'];
  const conversationLogPath =
    conversationLogPathEnv && conversationLogPathEnv.trim().length > 0
      ? path.resolve(conversationLogPathEnv)
      : path.join(dataDir, 'conversations.jsonl');

  const transcriptsDirEnv = process.env['TRANSCRIPTS_DIR'];
  const transcriptsDir =
    transcriptsDirEnv && transcriptsDirEnv.trim().length > 0
      ? path.resolve(transcriptsDirEnv)
      : path.join(dataDir, 'transcripts');

  const audioInputModeEnv = (process.env['AUDIO_INPUT_MODE'] ?? '').toLowerCase();
  const audioInputMode: AudioInputMode =
    audioInputModeEnv === 'server_vad' ? 'server_vad' : 'manual';

  const audioSampleRateEnv = Number(process.env['AUDIO_SAMPLE_RATE']) || 24000;
  const audioSampleRate =
    Number.isFinite(audioSampleRateEnv) && audioSampleRateEnv > 0 ? audioSampleRateEnv : 24000;

  const audioTranscriptionEnabledEnv = process.env['AUDIO_TRANSCRIPTION_ENABLED'];
  const audioTranscriptionEnabled =
    audioTranscriptionEnabledEnv !== undefined
      ? audioTranscriptionEnabledEnv.toLowerCase() === 'true' ||
        audioTranscriptionEnabledEnv === '1'
      : false;

  const audioOutputVoiceEnv = process.env['AUDIO_OUTPUT_VOICE'];
  const audioOutputVoice =
    typeof audioOutputVoiceEnv === 'string' && audioOutputVoiceEnv.trim().length > 0
      ? audioOutputVoiceEnv.trim()
      : undefined;

  const audioOutputSpeedEnv = process.env['AUDIO_OUTPUT_SPEED'];
  const parsedAudioOutputSpeed =
    audioOutputSpeedEnv !== undefined ? Number(audioOutputSpeedEnv) : Number.NaN;
  const audioOutputSpeed =
    Number.isFinite(parsedAudioOutputSpeed) && parsedAudioOutputSpeed > 0
      ? parsedAudioOutputSpeed
      : undefined;

  const ttsModelEnvRaw = process.env['OPENAI_TTS_MODEL'];
  const ttsModel =
    typeof ttsModelEnvRaw === 'string' && ttsModelEnvRaw.trim().length > 0
      ? ttsModelEnvRaw.trim()
      : 'gpt-4o-mini-tts';

  const ttsVoiceEnv = process.env['TTS_VOICE'] ?? audioOutputVoiceEnv;
  const ttsVoice =
    typeof ttsVoiceEnv === 'string' && ttsVoiceEnv.trim().length > 0
      ? ttsVoiceEnv.trim()
      : undefined;

  const ttsFrameDurationEnv = process.env['TTS_FRAME_DURATION_MS'];
  const parsedTtsFrameDuration =
    ttsFrameDurationEnv !== undefined ? Number(ttsFrameDurationEnv) : Number.NaN;
  const ttsFrameDurationMs =
    Number.isFinite(parsedTtsFrameDuration) && parsedTtsFrameDuration > 0
      ? Math.round(parsedTtsFrameDuration)
      : 250;

  const ttsBackendEnv = (process.env['TTS_BACKEND'] ?? '').toLowerCase();
  let ttsBackend: 'openai' | 'elevenlabs' = 'openai';
  if (ttsBackendEnv === 'elevenlabs') {
    ttsBackend = 'elevenlabs';
  } else if (ttsBackendEnv === 'openai') {
    ttsBackend = 'openai';
  }

  const elevenLabsApiKeyEnv = process.env['ELEVENLABS_API_KEY'];
  const elevenLabsApiKey =
    typeof elevenLabsApiKeyEnv === 'string' && elevenLabsApiKeyEnv.trim().length > 0
      ? elevenLabsApiKeyEnv.trim()
      : undefined;
  const elevenLabsVoiceIdEnv = process.env['ELEVENLABS_TTS_VOICE_ID'];
  const elevenLabsVoiceId =
    typeof elevenLabsVoiceIdEnv === 'string' && elevenLabsVoiceIdEnv.trim().length > 0
      ? elevenLabsVoiceIdEnv.trim()
      : undefined;
  const elevenLabsModelEnv = process.env['ELEVENLABS_TTS_MODEL'];
  const elevenLabsModelId =
    typeof elevenLabsModelEnv === 'string' && elevenLabsModelEnv.trim().length > 0
      ? elevenLabsModelEnv.trim()
      : 'eleven_multilingual_v2';

  const elevenLabsBaseUrlEnv = process.env['ELEVENLABS_TTS_BASE_URL'];
  const elevenLabsBaseUrl =
    typeof elevenLabsBaseUrlEnv === 'string' && elevenLabsBaseUrlEnv.trim().length > 0
      ? elevenLabsBaseUrlEnv.trim()
      : 'https://api.elevenlabs.io';

  // Migration helper: log when legacy single-file log exists but transcripts
  // directory has not been created yet. Actual migration is handled during
  // server startup.
  try {
    const legacyExists = fs.existsSync(conversationLogPath);
    const transcriptsDirExists = fs.existsSync(transcriptsDir);
    if (legacyExists && !transcriptsDirExists) {
      console.warn(
        `Found legacy conversation log at ${conversationLogPath}, and transcripts directory ${transcriptsDir} does not exist yet. ` +
          'Legacy conversations will be migrated to per-session transcript files on startup.',
      );
    }
  } catch {
    // Best-effort only; failures here must not prevent startup.
  }

  if (ttsBackend === 'elevenlabs' && (!elevenLabsApiKey || !elevenLabsVoiceId)) {
    console.warn(
      'TTS_BACKEND=elevenlabs requires ELEVENLABS_API_KEY and ELEVENLABS_TTS_VOICE_ID; ElevenLabs TTS backend will be disabled.',
    );
  }

  let maxMessagesPerMinute = 60;
  if (process.env['MAX_MESSAGES_PER_MINUTE'] !== undefined) {
    const parsed = Number(process.env['MAX_MESSAGES_PER_MINUTE']);
    if (Number.isFinite(parsed)) {
      maxMessagesPerMinute = Math.floor(parsed);
    }
  }

  let maxAudioBytesPerMinute = 2_000_000;
  if (process.env['MAX_AUDIO_BYTES_PER_MINUTE'] !== undefined) {
    const parsed = Number(process.env['MAX_AUDIO_BYTES_PER_MINUTE']);
    if (Number.isFinite(parsed)) {
      maxAudioBytesPerMinute = Math.floor(parsed);
    }
  }

  let maxToolCallsPerMinute = 30;
  if (process.env['MAX_TOOL_CALLS_PER_MINUTE'] !== undefined) {
    const parsed = Number(process.env['MAX_TOOL_CALLS_PER_MINUTE']);
    if (Number.isFinite(parsed)) {
      maxToolCallsPerMinute = Math.floor(parsed);
    }
  }

  const debugChatCompletionsEnv = process.env['DEBUG_CHAT_COMPLETIONS'];
  const debugChatCompletions =
    debugChatCompletionsEnv === 'true' || debugChatCompletionsEnv === '1';
  const debugHttpRequestsEnv = process.env['DEBUG_HTTP_REQUESTS'];
  const debugHttpRequests = debugHttpRequestsEnv === 'true' || debugHttpRequestsEnv === '1';

  const chatModel =
    typeof chatModelEnvRaw === 'string' && chatModelEnvRaw.trim().length > 0
      ? chatModelEnvRaw.trim()
      : undefined;

  if (!apiKey || !chatModel) {
    const missing: string[] = [];
    if (!apiKey) missing.push('OPENAI_API_KEY');
    if (!chatModel) missing.push('OPENAI_CHAT_MODEL');

    console.warn(
      missing.length > 0
        ? `OpenAI is not fully configured (missing ${missing.join(
            ', ',
          )}); OpenAI-based chat providers will be disabled. CLI agents (Claude, Codex, Pi) will continue to work.`
        : 'OpenAI is not fully configured; OpenAI-based chat providers will be disabled.',
    );
  }

  return {
    port,
    ...(apiKey ? { apiKey } : {}),
    ...(chatModel ? { chatModel } : {}),
    toolsEnabled,
    conversationLogPath,
    transcriptsDir,
    dataDir,
    audioInputMode,
    audioSampleRate,
    audioTranscriptionEnabled,
    audioOutputVoice,
    audioOutputSpeed,
    ttsModel,
    ttsVoice,
    ttsFrameDurationMs,
    ttsBackend,
    elevenLabsApiKey,
    elevenLabsVoiceId,
    elevenLabsModelId,
    elevenLabsBaseUrl,
    maxMessagesPerMinute,
    maxAudioBytesPerMinute,
    maxToolCallsPerMinute,
    debugChatCompletions,
    debugHttpRequests,
  };
}

export function openaiConfigured(config: EnvConfig): boolean {
  const hasApiKey = typeof config.apiKey === 'string' && config.apiKey.trim().length > 0;
  const hasChatModel = typeof config.chatModel === 'string' && config.chatModel.trim().length > 0;
  return hasApiKey && hasChatModel;
}
