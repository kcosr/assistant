import { normalizeAudioMode, type AudioMode } from './audioMode';
import { normalizeVoiceRuntimeMode, type VoiceRuntimeMode } from './voiceRuntimeMode';

export const DEFAULT_SPEECH_SERVER_BASE_URL = 'https://assistant/speech/v1';
export const DEFAULT_SPEECH_RECOGNITION_MODEL = 'parakeet-local';
export const DEFAULT_SPEECH_SYNTHESIS_MODEL = 'kokoro-local';
export const DEFAULT_SPEECH_VOICE = 'af_heart';
export const DEFAULT_RECOGNITION_START_TIMEOUT_MS = 30_000;
export const DEFAULT_RECOGNITION_COMPLETION_TIMEOUT_MS = 60_000;
export const DEFAULT_RECOGNITION_END_SILENCE_MS = 1_200;
export const MIN_TTS_GAIN = 0.25;
export const MAX_TTS_GAIN = 5.0;
export const DEFAULT_TTS_GAIN = 1.0;
export const DEFAULT_RECOGNITION_CUE_ENABLED = true;
export const DEFAULT_RECOGNITION_CUE_GAIN = 1.0;
export const DEFAULT_RECOGNIZE_STOP_COMMAND_ENABLED = true;
export const MIN_STARTUP_PRE_ROLL_MS = 0;
export const MAX_STARTUP_PRE_ROLL_MS = 4096;
export const DEFAULT_STARTUP_PRE_ROLL_MS = 512;
export const MIN_TTS_GAIN_PERCENT = MIN_TTS_GAIN * 100;
export const MAX_TTS_GAIN_PERCENT = MAX_TTS_GAIN * 100;

export interface VoiceSettings {
  /** Exclusive native owner preference: Thread FIFO vs Realtime duplex. */
  voiceRuntimeMode: VoiceRuntimeMode;
  realtimeConversationId: string;
  realtimeMuteOnStart: boolean;
  /** Prefer phone loudspeaker for Realtime when no Bluetooth headset is connected. */
  realtimeSpeakerphone: boolean;
  realtimeListsInstanceId: string;
  audioMode: AudioMode;
  autoListenEnabled: boolean;
  mediaButtonsEnabled: boolean;
  localResponseVoiceOnlyEnabled: boolean;
  standaloneNotificationPlaybackEnabled: boolean;
  notificationTitlePlaybackEnabled: boolean;
  speechServerBaseUrl: string;
  speechRecognitionModel: string;
  speechSynthesisModel: string;
  speechVoice: string;
  preferredVoiceSessionId: string;
  ttsPreferredSessionOnly: boolean;
  selectedMicDeviceId: string;
  recognitionStartTimeoutMs: number;
  recognitionCompletionTimeoutMs: number;
  recognitionEndSilenceMs: number;
  recognizeStopCommandEnabled: boolean;
  ttsGain: number;
  recognitionCueEnabled: boolean;
  recognitionCueGain: number;
  startupPreRollMs: number;
}

function normalizeOptionalString(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

export const SPEECH_SERVER_URL_ERROR =
  'Enter an HTTP or HTTPS API root without credentials, query, fragment, or encoded path segments.';

/** Validate the API root before it enters settings storage or the native bridge. */
export function normalizeSpeechServerBaseUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  const candidate = value.trim();
  const parts = /^(https?):\/\/([^/?#]+)(\/[^?#]*)?$/i.exec(candidate);
  if (!parts) return null;
  const authority = /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::([0-9]+))?$/i.exec(parts[2]!);
  if (!authority) return null;
  const host = authority[1]!;
  if (!host.startsWith('[')) {
    const labels = host.endsWith('.') ? host.slice(0, -1).split('.') : host.split('.');
    if (labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))) return null;
  }
  const path = parts[3] || '';
  if (
    !/^[/A-Za-z0-9._~-]*$/.test(path) ||
    path.split('/').some((segment) => segment === '.' || segment === '..')
  )
    return null;
  const port = authority[2] === undefined ? null : Number(authority[2]);
  if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) return null;
  try {
    new URL(candidate);
  } catch {
    return null;
  }
  const scheme = parts[1]!.toLowerCase();
  const portSuffix =
    port === null || (scheme === 'https' && port === 443) || (scheme === 'http' && port === 80)
      ? ''
      : `:${port}`;
  return `${scheme}://${host.toLowerCase()}${portSuffix}${path.replace(/\/+$/, '')}`;
}

function normalizeUrl(value: unknown): string {
  // Stored input is untrusted. Never copy URL-embedded secrets into normalized settings.
  return normalizeSpeechServerBaseUrl(value) ?? DEFAULT_SPEECH_SERVER_BASE_URL;
}

function normalizePositiveInt(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return fallback;
}

export function normalizeTtsGain(value: unknown, fallback = DEFAULT_TTS_GAIN): number {
  const normalizedFallback =
    typeof fallback === 'number' && Number.isFinite(fallback) && fallback > 0
      ? fallback
      : DEFAULT_TTS_GAIN;
  let candidate = normalizedFallback;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    candidate = value;
  } else if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseFloat(value.trim());
    if (Number.isFinite(parsed) && parsed > 0) {
      candidate = parsed;
    }
  }
  return Math.min(MAX_TTS_GAIN, Math.max(MIN_TTS_GAIN, candidate));
}

export function normalizeStartupPreRollMs(
  value: unknown,
  fallback = DEFAULT_STARTUP_PRE_ROLL_MS,
): number {
  const normalizedFallback =
    typeof fallback === 'number' && Number.isFinite(fallback)
      ? Math.min(MAX_STARTUP_PRE_ROLL_MS, Math.max(MIN_STARTUP_PRE_ROLL_MS, Math.round(fallback)))
      : DEFAULT_STARTUP_PRE_ROLL_MS;
  let candidate = normalizedFallback;
  if (typeof value === 'number' && Number.isFinite(value)) {
    candidate = value;
  } else if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number.parseFloat(value.trim());
    if (Number.isFinite(parsed)) {
      candidate = parsed;
    }
  }
  return Math.min(
    MAX_STARTUP_PRE_ROLL_MS,
    Math.max(MIN_STARTUP_PRE_ROLL_MS, Math.round(candidate)),
  );
}

export function formatStartupPreRollMsLabel(value: number): string {
  return `${normalizeStartupPreRollMs(value)} ms`;
}

export function ttsGainToPercent(gain: number): number {
  return Math.round(normalizeTtsGain(gain) * 100);
}

export function ttsGainPercentToValue(value: unknown, fallback = DEFAULT_TTS_GAIN): number {
  return normalizeTtsGain(
    typeof value === 'string' || typeof value === 'number' ? Number(value) / 100 : DEFAULT_TTS_GAIN,
    fallback,
  );
}

export function formatTtsGainPercentLabel(gain: number): string {
  return `${ttsGainToPercent(gain)}%`;
}

export function recognitionCueGainToPercent(gain: number): number {
  return ttsGainToPercent(gain);
}

export function recognitionCueGainPercentToValue(
  value: unknown,
  fallback = DEFAULT_RECOGNITION_CUE_GAIN,
): number {
  return ttsGainPercentToValue(value, fallback);
}

export function formatRecognitionCueGainPercentLabel(gain: number): string {
  return formatTtsGainPercentLabel(gain);
}

export function createDefaultVoiceSettings(options?: {
  isCapacitorAndroid?: boolean;
}): VoiceSettings {
  const isAndroid = options?.isCapacitorAndroid === true;
  return {
    voiceRuntimeMode: 'thread',
    realtimeConversationId: '',
    realtimeMuteOnStart: false,
    realtimeSpeakerphone: true,
    realtimeListsInstanceId: 'default',
    audioMode: isAndroid ? 'tool' : 'off',
    autoListenEnabled: isAndroid,
    mediaButtonsEnabled: false,
    localResponseVoiceOnlyEnabled: isAndroid,
    standaloneNotificationPlaybackEnabled: isAndroid,
    notificationTitlePlaybackEnabled: false,
    speechServerBaseUrl: DEFAULT_SPEECH_SERVER_BASE_URL,
    speechRecognitionModel: DEFAULT_SPEECH_RECOGNITION_MODEL,
    speechSynthesisModel: DEFAULT_SPEECH_SYNTHESIS_MODEL,
    speechVoice: DEFAULT_SPEECH_VOICE,
    preferredVoiceSessionId: '',
    ttsPreferredSessionOnly: false,
    selectedMicDeviceId: '',
    recognitionStartTimeoutMs: DEFAULT_RECOGNITION_START_TIMEOUT_MS,
    recognitionCompletionTimeoutMs: DEFAULT_RECOGNITION_COMPLETION_TIMEOUT_MS,
    recognitionEndSilenceMs: DEFAULT_RECOGNITION_END_SILENCE_MS,
    recognizeStopCommandEnabled: DEFAULT_RECOGNIZE_STOP_COMMAND_ENABLED,
    ttsGain: DEFAULT_TTS_GAIN,
    recognitionCueEnabled: DEFAULT_RECOGNITION_CUE_ENABLED,
    recognitionCueGain: DEFAULT_RECOGNITION_CUE_GAIN,
    startupPreRollMs: DEFAULT_STARTUP_PRE_ROLL_MS,
  };
}

export function normalizeVoiceSettings(
  value: unknown,
  options?: { isCapacitorAndroid?: boolean },
): VoiceSettings {
  const defaults = createDefaultVoiceSettings(options);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return defaults;
  }

  const record = value as Record<string, unknown>;
  return {
    voiceRuntimeMode: normalizeVoiceRuntimeMode(
      typeof record['voiceRuntimeMode'] === 'string'
        ? record['voiceRuntimeMode']
        : defaults.voiceRuntimeMode,
    ),
    realtimeConversationId: normalizeOptionalString(record['realtimeConversationId']),
    realtimeMuteOnStart:
      typeof record['realtimeMuteOnStart'] === 'boolean'
        ? record['realtimeMuteOnStart']
        : defaults.realtimeMuteOnStart,
    realtimeSpeakerphone:
      typeof record['realtimeSpeakerphone'] === 'boolean'
        ? record['realtimeSpeakerphone']
        : defaults.realtimeSpeakerphone,
    realtimeListsInstanceId:
      normalizeOptionalString(record['realtimeListsInstanceId']) ||
      defaults.realtimeListsInstanceId,
    audioMode: normalizeAudioMode(
      typeof record['audioMode'] === 'string' ? record['audioMode'] : defaults.audioMode,
    ),
    autoListenEnabled:
      typeof record['autoListenEnabled'] === 'boolean'
        ? record['autoListenEnabled']
        : defaults.autoListenEnabled,
    mediaButtonsEnabled:
      typeof record['mediaButtonsEnabled'] === 'boolean'
        ? record['mediaButtonsEnabled']
        : defaults.mediaButtonsEnabled,
    localResponseVoiceOnlyEnabled:
      typeof record['localResponseVoiceOnlyEnabled'] === 'boolean'
        ? record['localResponseVoiceOnlyEnabled']
        : defaults.localResponseVoiceOnlyEnabled,
    standaloneNotificationPlaybackEnabled:
      typeof record['standaloneNotificationPlaybackEnabled'] === 'boolean'
        ? record['standaloneNotificationPlaybackEnabled']
        : defaults.standaloneNotificationPlaybackEnabled,
    notificationTitlePlaybackEnabled:
      typeof record['notificationTitlePlaybackEnabled'] === 'boolean'
        ? record['notificationTitlePlaybackEnabled']
        : defaults.notificationTitlePlaybackEnabled,
    speechServerBaseUrl: normalizeUrl(record['speechServerBaseUrl']),
    speechRecognitionModel:
      normalizeOptionalString(record['speechRecognitionModel']) || defaults.speechRecognitionModel,
    speechSynthesisModel:
      normalizeOptionalString(record['speechSynthesisModel']) || defaults.speechSynthesisModel,
    speechVoice: normalizeOptionalString(record['speechVoice']) || defaults.speechVoice,
    preferredVoiceSessionId: normalizeOptionalString(record['preferredVoiceSessionId']),
    ttsPreferredSessionOnly:
      typeof record['ttsPreferredSessionOnly'] === 'boolean'
        ? record['ttsPreferredSessionOnly']
        : defaults.ttsPreferredSessionOnly,
    selectedMicDeviceId: normalizeOptionalString(record['selectedMicDeviceId']),
    recognitionStartTimeoutMs: normalizePositiveInt(
      record['recognitionStartTimeoutMs'],
      defaults.recognitionStartTimeoutMs,
    ),
    recognitionCompletionTimeoutMs: normalizePositiveInt(
      record['recognitionCompletionTimeoutMs'],
      defaults.recognitionCompletionTimeoutMs,
    ),
    recognitionEndSilenceMs: normalizePositiveInt(
      record['recognitionEndSilenceMs'],
      defaults.recognitionEndSilenceMs,
    ),
    recognizeStopCommandEnabled:
      typeof record['recognizeStopCommandEnabled'] === 'boolean'
        ? record['recognizeStopCommandEnabled']
        : defaults.recognizeStopCommandEnabled,
    ttsGain: normalizeTtsGain(record['ttsGain'], defaults.ttsGain),
    recognitionCueEnabled:
      typeof record['recognitionCueEnabled'] === 'boolean'
        ? record['recognitionCueEnabled']
        : defaults.recognitionCueEnabled,
    recognitionCueGain: normalizeTtsGain(record['recognitionCueGain'], defaults.recognitionCueGain),
    startupPreRollMs: normalizeStartupPreRollMs(
      record['startupPreRollMs'],
      defaults.startupPreRollMs,
    ),
  };
}

/** Apply independent edits while retaining the last valid endpoint for an invalid URL draft. */
export function normalizeVoiceSettingsDraft(
  current: VoiceSettings,
  changes: Record<string, unknown>,
): { settings: VoiceSettings; speechServerUrlInvalid: boolean } {
  const endpoint = normalizeSpeechServerBaseUrl(
    changes['speechServerBaseUrl'] ?? current.speechServerBaseUrl,
  );
  return {
    settings: normalizeVoiceSettings({
      ...current,
      ...changes,
      speechServerBaseUrl: endpoint ?? current.speechServerBaseUrl,
    }),
    speechServerUrlInvalid: endpoint === null,
  };
}

export function areVoiceSettingsEqual(left: VoiceSettings, right: VoiceSettings): boolean {
  return (
    left.voiceRuntimeMode === right.voiceRuntimeMode &&
    left.realtimeConversationId === right.realtimeConversationId &&
    left.realtimeMuteOnStart === right.realtimeMuteOnStart &&
    left.realtimeSpeakerphone === right.realtimeSpeakerphone &&
    left.realtimeListsInstanceId === right.realtimeListsInstanceId &&
    left.audioMode === right.audioMode &&
    left.autoListenEnabled === right.autoListenEnabled &&
    left.mediaButtonsEnabled === right.mediaButtonsEnabled &&
    left.localResponseVoiceOnlyEnabled === right.localResponseVoiceOnlyEnabled &&
    left.standaloneNotificationPlaybackEnabled === right.standaloneNotificationPlaybackEnabled &&
    left.notificationTitlePlaybackEnabled === right.notificationTitlePlaybackEnabled &&
    left.speechServerBaseUrl === right.speechServerBaseUrl &&
    left.speechRecognitionModel === right.speechRecognitionModel &&
    left.speechSynthesisModel === right.speechSynthesisModel &&
    left.speechVoice === right.speechVoice &&
    left.preferredVoiceSessionId === right.preferredVoiceSessionId &&
    left.ttsPreferredSessionOnly === right.ttsPreferredSessionOnly &&
    left.selectedMicDeviceId === right.selectedMicDeviceId &&
    left.recognitionStartTimeoutMs === right.recognitionStartTimeoutMs &&
    left.recognitionCompletionTimeoutMs === right.recognitionCompletionTimeoutMs &&
    left.recognitionEndSilenceMs === right.recognitionEndSilenceMs &&
    left.recognizeStopCommandEnabled === right.recognizeStopCommandEnabled &&
    left.ttsGain === right.ttsGain &&
    left.recognitionCueEnabled === right.recognitionCueEnabled &&
    left.recognitionCueGain === right.recognitionCueGain &&
    left.startupPreRollMs === right.startupPreRollMs
  );
}
