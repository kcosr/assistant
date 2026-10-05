import { describe, expect, it } from 'vitest';

import {
  areVoiceSettingsEqual,
  createDefaultVoiceSettings,
  formatStartupPreRollMsLabel,
  formatRecognitionCueGainPercentLabel,
  formatTtsGainPercentLabel,
  normalizeStartupPreRollMs,
  normalizeVoiceSettings,
  normalizeSpeechServerBaseUrl,
  recognitionCueGainPercentToValue,
  recognitionCueGainToPercent,
  ttsGainPercentToValue,
  ttsGainToPercent,
} from './voiceSettings';

describe('voiceSettings', () => {
  it('canonicalizes API roots without changing their path case', () => {
    expect(normalizeSpeechServerBaseUrl(' HTTPS://Assistant:443/speech/v1/// ')).toBe(
      'https://assistant/speech/v1',
    );
    expect(normalizeSpeechServerBaseUrl('http://LOCALHOST:8000/V1')).toBe(
      'http://localhost:8000/V1',
    );
    expect(normalizeSpeechServerBaseUrl('http://[::1]:80/v1')).toBe('http://[::1]/v1');
  });

  it.each([
    '',
    'ftp://host/v1',
    'https://user:secret@host/v1',
    'https://host/v1?token=secret',
    'https://host/v1#secret',
    'https://host/v1?',
    'https://host/v1#',
    'https://host/../v1',
    'https://host/./v1',
    'https://host/%2e%2e/v1',
    'https://host/v1%2fpath',
    'https://host:0/v1',
    'https://host:65536/v1',
    'https://host/v1\\path',
  ])('rejects unsafe speech API root %s before settings storage', (value) => {
    expect(normalizeSpeechServerBaseUrl(value)).toBeNull();
    const settings = normalizeVoiceSettings({ speechServerBaseUrl: value });
    expect(settings.speechServerBaseUrl).toBe('https://assistant/speech/v1');
    expect(JSON.stringify(settings)).not.toContain('secret');
  });
  it('normalizes speech settings without persisting credentials or retired adapter fields', () => {
    const settings = normalizeVoiceSettings({
      speechServerBaseUrl: ' https://assistant/speech/v1 ',
      speechRecognitionModel: ' custom-stt ',
      speechSynthesisModel: 'custom-tts',
      speechVoice: 'custom-voice',
      speechToken: 'secret',
      voiceAdapterBaseUrl: 'https://retired',
    });
    expect(settings.speechServerBaseUrl).toBe('https://assistant/speech/v1');
    expect(settings.speechRecognitionModel).toBe('custom-stt');
    expect(settings.speechSynthesisModel).toBe('custom-tts');
    expect(settings.speechVoice).toBe('custom-voice');
    expect(settings).not.toHaveProperty('speechToken');
    expect(settings).not.toHaveProperty('voiceAdapterBaseUrl');
    expect(areVoiceSettingsEqual(settings, { ...settings, speechVoice: 'other' })).toBe(false);
    expect(createDefaultVoiceSettings().speechRecognitionModel).toBe('parakeet-local');
    expect(normalizeVoiceSettings({ speechVoice: ' ' }).speechVoice).toBe('af_heart');
  });
  it('preserves headset button control and detects changes to it', () => {
    const defaults = createDefaultVoiceSettings({ isCapacitorAndroid: true });
    expect(defaults.mediaButtonsEnabled).toBe(false);
    const enabled = normalizeVoiceSettings({ ...defaults, mediaButtonsEnabled: true });
    expect(enabled.mediaButtonsEnabled).toBe(true);
    expect(areVoiceSettingsEqual(defaults, enabled)).toBe(false);
    const restored = normalizeVoiceSettings(JSON.parse(JSON.stringify(enabled)));
    expect(areVoiceSettingsEqual(restored, enabled)).toBe(true);
    expect(
      normalizeVoiceSettings({ ...enabled, mediaButtonsEnabled: false }).mediaButtonsEnabled,
    ).toBe(false);
  });

  it('defaults tts gain to 100%', () => {
    expect(createDefaultVoiceSettings().ttsGain).toBe(1);
    expect(ttsGainToPercent(createDefaultVoiceSettings().ttsGain)).toBe(100);
    expect(createDefaultVoiceSettings().recognizeStopCommandEnabled).toBe(true);
    expect(createDefaultVoiceSettings().recognitionCueEnabled).toBe(true);
    expect(createDefaultVoiceSettings().recognitionCueGain).toBe(1);
    expect(recognitionCueGainToPercent(createDefaultVoiceSettings().recognitionCueGain)).toBe(100);
    expect(createDefaultVoiceSettings().startupPreRollMs).toBe(512);
    expect(createDefaultVoiceSettings().standaloneNotificationPlaybackEnabled).toBe(false);
    expect(createDefaultVoiceSettings().notificationTitlePlaybackEnabled).toBe(false);
    expect(createDefaultVoiceSettings().localResponseVoiceOnlyEnabled).toBe(false);
    expect(
      createDefaultVoiceSettings({ isCapacitorAndroid: true })
        .standaloneNotificationPlaybackEnabled,
    ).toBe(true);
    expect(
      createDefaultVoiceSettings({ isCapacitorAndroid: true }).localResponseVoiceOnlyEnabled,
    ).toBe(true);
  });

  it('clamps persisted tts gain into the supported range', () => {
    expect(
      normalizeVoiceSettings({
        ttsGain: '0.1',
      }).ttsGain,
    ).toBe(0.25);
    expect(
      normalizeVoiceSettings({
        ttsGain: '9.4',
      }).ttsGain,
    ).toBe(5);
    expect(
      normalizeVoiceSettings({
        recognitionCueGain: '0.1',
      }).recognitionCueGain,
    ).toBe(0.25);
    expect(
      normalizeVoiceSettings({
        recognitionCueGain: '9.4',
      }).recognitionCueGain,
    ).toBe(5);
  });

  it('converts between slider percentages and gain values', () => {
    expect(ttsGainPercentToValue('25')).toBe(0.25);
    expect(ttsGainPercentToValue('500')).toBe(5);
    expect(formatTtsGainPercentLabel(1.75)).toBe('175%');
    expect(recognitionCueGainPercentToValue('25')).toBe(0.25);
    expect(recognitionCueGainPercentToValue('500')).toBe(5);
    expect(formatRecognitionCueGainPercentLabel(1.75)).toBe('175%');
  });

  it('clamps startup pre-roll into the supported range', () => {
    expect(normalizeVoiceSettings({ startupPreRollMs: '-50' }).startupPreRollMs).toBe(0);
    expect(normalizeVoiceSettings({ startupPreRollMs: '99999' }).startupPreRollMs).toBe(4096);
    expect(normalizeStartupPreRollMs('513.6')).toBe(514);
    expect(formatStartupPreRollMsLabel(512)).toBe('512 ms');
  });

  it('preserves the recognize stop command setting', () => {
    expect(
      normalizeVoiceSettings({ recognizeStopCommandEnabled: false }).recognizeStopCommandEnabled,
    ).toBe(false);
  });

  it('preserves the standalone notification playback setting', () => {
    expect(
      normalizeVoiceSettings(
        { standaloneNotificationPlaybackEnabled: false },
        {
          isCapacitorAndroid: true,
        },
      ).standaloneNotificationPlaybackEnabled,
    ).toBe(false);
  });

  it('preserves the local response voice-only setting', () => {
    expect(
      normalizeVoiceSettings(
        { localResponseVoiceOnlyEnabled: false },
        {
          isCapacitorAndroid: true,
        },
      ).localResponseVoiceOnlyEnabled,
    ).toBe(false);
  });

  it('preserves the notification title playback setting', () => {
    expect(
      normalizeVoiceSettings({
        notificationTitlePlaybackEnabled: true,
      }).notificationTitlePlaybackEnabled,
    ).toBe(true);
  });
});
