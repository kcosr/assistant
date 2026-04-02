import { normalizeAudioMode, type AudioMode } from './audioMode';

export const DEFAULT_VOICE_ADAPTER_BASE_URL = 'https://assistant/agent-voice-adapter';
export const DEFAULT_RECOGNITION_START_TIMEOUT_MS = 30_000;
export const DEFAULT_RECOGNITION_COMPLETION_TIMEOUT_MS = 60_000;
export const DEFAULT_RECOGNITION_END_SILENCE_MS = 1_200;
export const MIN_TTS_GAIN = 0.25;
export const MAX_TTS_GAIN = 5.0;
export const DEFAULT_TTS_GAIN = 1.0;
export const DEFAULT_RECOGNITION_CUE_ENABLED = true;
export const DEFAULT_RECOGNITION_CUE_GAIN = 1.0;
export const MIN_TTS_GAIN_PERCENT = MIN_TTS_GAIN * 100;
export const MAX_TTS_GAIN_PERCENT = MAX_TTS_GAIN * 100;

export interface VoiceSettings {
  audioMode: AudioMode;
  autoListenEnabled: boolean;
  voiceAdapterBaseUrl: string;
  preferredVoiceSessionId: string;
  selectedMicDeviceId: string;
  recognitionStartTimeoutMs: number;
  recognitionCompletionTimeoutMs: number;
  recognitionEndSilenceMs: number;
  ttsGain: number;
  recognitionCueEnabled: boolean;
  recognitionCueGain: number;
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
    audioMode: isAndroid ? 'tool' : 'off',
    autoListenEnabled: isAndroid,
    voiceAdapterBaseUrl: DEFAULT_VOICE_ADAPTER_BASE_URL,
    preferredVoiceSessionId: '',
    selectedMicDeviceId: '',
    recognitionStartTimeoutMs: DEFAULT_RECOGNITION_START_TIMEOUT_MS,
    recognitionCompletionTimeoutMs: DEFAULT_RECOGNITION_COMPLETION_TIMEOUT_MS,
    recognitionEndSilenceMs: DEFAULT_RECOGNITION_END_SILENCE_MS,
    ttsGain: DEFAULT_TTS_GAIN,
    recognitionCueEnabled: DEFAULT_RECOGNITION_CUE_ENABLED,
    recognitionCueGain: DEFAULT_RECOGNITION_CUE_GAIN,
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
    preferredVoiceSessionId: normalizeOptionalString(record['preferredVoiceSessionId']),
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
    ttsGain: normalizeTtsGain(record['ttsGain'], defaults.ttsGain),
    recognitionCueEnabled:
      typeof record['recognitionCueEnabled'] === 'boolean'
        ? record['recognitionCueEnabled']
        : defaults.recognitionCueEnabled,
    recognitionCueGain: normalizeTtsGain(record['recognitionCueGain'], defaults.recognitionCueGain),
  };
}

export function areVoiceSettingsEqual(left: VoiceSettings, right: VoiceSettings): boolean {
  return (
    left.audioMode === right.audioMode &&
    left.autoListenEnabled === right.autoListenEnabled &&
    left.voiceAdapterBaseUrl === right.voiceAdapterBaseUrl &&
    left.preferredVoiceSessionId === right.preferredVoiceSessionId &&
    left.selectedMicDeviceId === right.selectedMicDeviceId &&
    left.recognitionStartTimeoutMs === right.recognitionStartTimeoutMs &&
    left.recognitionCompletionTimeoutMs === right.recognitionCompletionTimeoutMs &&
    left.recognitionEndSilenceMs === right.recognitionEndSilenceMs &&
    left.ttsGain === right.ttsGain &&
    left.recognitionCueEnabled === right.recognitionCueEnabled &&
    left.recognitionCueGain === right.recognitionCueGain
  );
}
