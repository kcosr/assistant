import { normalizeAudioMode, type AudioMode } from './audioMode';

export const DEFAULT_VOICE_ADAPTER_BASE_URL = 'https://assistant/agent-voice-adapter';
export const DEFAULT_RECOGNITION_START_TIMEOUT_MS = 30_000;
export const DEFAULT_RECOGNITION_COMPLETION_TIMEOUT_MS = 60_000;
export const DEFAULT_RECOGNITION_END_SILENCE_MS = 1_200;

export interface VoiceSettings {
  audioMode: AudioMode;
  autoListenEnabled: boolean;
  voiceAdapterBaseUrl: string;
  selectedMicDeviceId: string;
  recognitionStartTimeoutMs: number;
  recognitionCompletionTimeoutMs: number;
  recognitionEndSilenceMs: number;
}

function normalizeOptionalString(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function normalizeUrl(value: unknown): string {
  if (typeof value !== 'string') {
    return DEFAULT_VOICE_ADAPTER_BASE_URL;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_VOICE_ADAPTER_BASE_URL;
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

export function createDefaultVoiceSettings(options?: {
  isCapacitorAndroid?: boolean;
}): VoiceSettings {
  const isAndroid = options?.isCapacitorAndroid === true;
  return {
    audioMode: isAndroid ? 'tool' : 'off',
    autoListenEnabled: isAndroid,
    voiceAdapterBaseUrl: DEFAULT_VOICE_ADAPTER_BASE_URL,
    selectedMicDeviceId: '',
    recognitionStartTimeoutMs: DEFAULT_RECOGNITION_START_TIMEOUT_MS,
    recognitionCompletionTimeoutMs: DEFAULT_RECOGNITION_COMPLETION_TIMEOUT_MS,
    recognitionEndSilenceMs: DEFAULT_RECOGNITION_END_SILENCE_MS,
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
    audioMode: normalizeAudioMode(
      typeof record['audioMode'] === 'string' ? record['audioMode'] : defaults.audioMode,
    ),
    autoListenEnabled:
      typeof record['autoListenEnabled'] === 'boolean'
        ? record['autoListenEnabled']
        : defaults.autoListenEnabled,
    voiceAdapterBaseUrl: normalizeUrl(record['voiceAdapterBaseUrl']),
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
  };
}

export function areVoiceSettingsEqual(left: VoiceSettings, right: VoiceSettings): boolean {
  return (
    left.audioMode === right.audioMode &&
    left.autoListenEnabled === right.autoListenEnabled &&
    left.voiceAdapterBaseUrl === right.voiceAdapterBaseUrl &&
    left.selectedMicDeviceId === right.selectedMicDeviceId &&
    left.recognitionStartTimeoutMs === right.recognitionStartTimeoutMs &&
    left.recognitionCompletionTimeoutMs === right.recognitionCompletionTimeoutMs &&
    left.recognitionEndSilenceMs === right.recognitionEndSilenceMs
  );
}
