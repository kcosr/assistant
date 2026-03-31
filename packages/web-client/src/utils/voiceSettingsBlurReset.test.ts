// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { bindVoiceSettingsBlurResetHandlers } from './voiceSettingsBlurReset';

describe('bindVoiceSettingsBlurResetHandlers', () => {
  it('resets timeout inputs on blur without resetting the adapter URL input', () => {
    const resetVoiceSettingsInputs = vi.fn();
    const voiceAdapterBaseUrlInputEl = document.createElement('input');
    const voiceRecognitionStartTimeoutInputEl = document.createElement('input');
    const voiceRecognitionCompletionTimeoutInputEl = document.createElement('input');
    const voiceRecognitionEndSilenceInputEl = document.createElement('input');

    bindVoiceSettingsBlurResetHandlers({
      voiceRecognitionStartTimeoutInputEl,
      voiceRecognitionCompletionTimeoutInputEl,
      voiceRecognitionEndSilenceInputEl,
      resetVoiceSettingsInputs,
    });

    voiceAdapterBaseUrlInputEl.dispatchEvent(new FocusEvent('blur'));
    expect(resetVoiceSettingsInputs).not.toHaveBeenCalled();

    voiceRecognitionStartTimeoutInputEl.dispatchEvent(new FocusEvent('blur'));
    expect(resetVoiceSettingsInputs).toHaveBeenCalledTimes(1);

    voiceRecognitionCompletionTimeoutInputEl.dispatchEvent(new FocusEvent('blur'));
    expect(resetVoiceSettingsInputs).toHaveBeenCalledTimes(2);

    voiceRecognitionEndSilenceInputEl.dispatchEvent(new FocusEvent('blur'));
    expect(resetVoiceSettingsInputs).toHaveBeenCalledTimes(3);
  });
});
