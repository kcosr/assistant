import { describe, expect, it } from 'vitest';

import {
  createDefaultVoiceSettings,
  formatRecognitionCueGainPercentLabel,
  formatTtsGainPercentLabel,
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
    expect(createDefaultVoiceSettings().recognitionCueEnabled).toBe(true);
    expect(createDefaultVoiceSettings().recognitionCueGain).toBe(1);
    expect(recognitionCueGainToPercent(createDefaultVoiceSettings().recognitionCueGain)).toBe(100);
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
});
