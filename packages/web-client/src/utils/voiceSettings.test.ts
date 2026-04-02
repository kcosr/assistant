import { describe, expect, it } from 'vitest';

import {
  createDefaultVoiceSettings,
  formatTtsGainPercentLabel,
  normalizeVoiceSettings,
  ttsGainPercentToValue,
  ttsGainToPercent,
} from './voiceSettings';

describe('voiceSettings', () => {
  it('defaults tts gain to 100%', () => {
    expect(createDefaultVoiceSettings().ttsGain).toBe(1);
    expect(ttsGainToPercent(createDefaultVoiceSettings().ttsGain)).toBe(100);
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
  });

  it('converts between slider percentages and gain values', () => {
    expect(ttsGainPercentToValue('25')).toBe(0.25);
    expect(ttsGainPercentToValue('500')).toBe(5);
    expect(formatTtsGainPercentLabel(1.75)).toBe('175%');
  });
});
