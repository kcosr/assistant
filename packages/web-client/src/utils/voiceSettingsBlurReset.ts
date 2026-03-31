export function bindVoiceSettingsBlurResetHandlers(options: {
  voiceRecognitionStartTimeoutInputEl: HTMLInputElement;
  voiceRecognitionCompletionTimeoutInputEl: HTMLInputElement;
  voiceRecognitionEndSilenceInputEl: HTMLInputElement;
  resetVoiceSettingsInputs: () => void;
}): void {
  const {
    voiceRecognitionStartTimeoutInputEl,
    voiceRecognitionCompletionTimeoutInputEl,
    voiceRecognitionEndSilenceInputEl,
    resetVoiceSettingsInputs,
  } = options;

  voiceRecognitionStartTimeoutInputEl.addEventListener('blur', resetVoiceSettingsInputs);
  voiceRecognitionCompletionTimeoutInputEl.addEventListener('blur', resetVoiceSettingsInputs);
  voiceRecognitionEndSilenceInputEl.addEventListener('blur', resetVoiceSettingsInputs);
}
