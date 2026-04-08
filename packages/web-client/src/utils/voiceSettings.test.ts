import { describe, expect, it } from 'vitest';

import {
  createDefaultVoiceSettings,
  formatStartupPreRollMsLabel,
  formatRecognitionCueGainPercentLabel,
  formatTtsGainPercentLabel,
  normalizeStartupPreRollMs,
  normalizeVoiceSettings,
  recognitionCueGainPercentToValue,
  recognitionCueGainToPercent,
  ttsGainPercentToValue,
  ttsGainToPercent,
} from './voiceSettings';

describe('voiceSettings', () => {
  it('defaults tts gain to 100%', () => {
    expect(createDefaultVoiceSettings().ttsGain).toBe(1);
    expect(ttsGainToPercent(createDefaultVoiceSettings().ttsGain)).toBe(100);
    expect(createDefaultVoiceSettings().recognizeStopCommandEnabled).toBe(true);
    expect(createDefaultVoiceSettings().recognitionCueEnabled).toBe(true);
    expect(createDefaultVoiceSettings().recognitionCueGain).toBe(1);
    expect(recognitionCueGainToPercent(createDefaultVoiceSettings().recognitionCueGain)).toBe(100);
    expect(createDefaultVoiceSettings().startupPreRollMs).toBe(512);
    expect(createDefaultVoiceSettings().standaloneNotificationPlaybackEnabled).toBe(false);
    expect(
      createDefaultVoiceSettings({ isCapacitorAndroid: true }).standaloneNotificationPlaybackEnabled,
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
    expect(normalizeVoiceSettings({ recognizeStopCommandEnabled: false }).recognizeStopCommandEnabled)
      .toBe(false);
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
});
