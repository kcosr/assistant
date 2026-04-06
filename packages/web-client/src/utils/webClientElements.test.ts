// @vitest-environment jsdom
import fs from 'node:fs';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';

import { getWebClientElements } from './webClientElements';

describe('getWebClientElements', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('returns the voice settings controls when present', () => {
    const html = fs.readFileSync(
      path.resolve(process.cwd(), 'packages/web-client/public/index.html'),
      'utf8',
    );
    const dom = new JSDOM(html);
    document.body.innerHTML = dom.window.document.body.innerHTML;

    const elements = getWebClientElements();

    expect(elements).not.toBeNull();
    expect(elements?.voiceSettingsButton.id).toBe('voice-settings-button');
    expect(elements?.voiceSettingsModal.id).toBe('voice-settings-modal');
    expect(elements?.voiceSettingsCloseButton.id).toBe('voice-settings-close-button');
    expect(elements?.audioModeSelect?.id).toBe('audio-mode-select');
    expect(elements?.autoListenCheckbox?.id).toBe('auto-listen-checkbox');
    expect(elements?.voiceAdapterBaseUrlInput.id).toBe('voice-adapter-base-url-input');
    expect(elements?.voicePreferredSessionSelect.id).toBe('voice-preferred-session-select');
    expect(elements?.voiceTtsPreferredSessionOnlyCheckbox.id).toBe(
      'voice-tts-preferred-session-only-checkbox',
    );
    expect(elements?.voiceMicInputSelect.id).toBe('voice-mic-input-select');
    expect(elements?.voiceRecognitionStartTimeoutInput.id).toBe(
      'voice-recognition-start-timeout-input',
    );
    expect(elements?.voiceRecognitionCompletionTimeoutInput.id).toBe(
      'voice-recognition-completion-timeout-input',
    );
    expect(elements?.voiceRecognitionEndSilenceInput.id).toBe(
      'voice-recognition-end-silence-input',
    );
    expect(elements?.voiceRecognizeStopCommandControl.id).toBe(
      'voice-recognize-stop-command-control',
    );
    expect(elements?.voiceRecognizeStopCommandCheckbox.id).toBe(
      'voice-recognize-stop-command-checkbox',
    );
    expect(elements?.voiceRecognitionCueControl.id).toBe('voice-recognition-cue-control');
    expect(elements?.voiceRecognitionCueCheckbox.id).toBe('voice-recognition-cue-checkbox');
    expect(elements?.voiceRecognitionCueGainControl.id).toBe('voice-recognition-cue-gain-control');
    expect(elements?.voiceRecognitionCueGainSlider.id).toBe('voice-recognition-cue-gain-slider');
    expect(elements?.voiceRecognitionCueGainValue.id).toBe('voice-recognition-cue-gain-value');
    expect(elements?.voiceStartupPreRollControl.id).toBe('voice-startup-pre-roll-control');
    expect(elements?.voiceStartupPreRollSlider.id).toBe('voice-startup-pre-roll-slider');
    expect(elements?.voiceStartupPreRollValue.id).toBe('voice-startup-pre-roll-value');
    expect(elements?.voiceTtsGainControl.id).toBe('voice-tts-gain-control');
    expect(elements?.voiceTtsGainSlider.id).toBe('voice-tts-gain-slider');
    expect(elements?.voiceTtsGainValue.id).toBe('voice-tts-gain-value');
  });

  it('keeps the voice settings modal hidden in the static document', () => {
    const html = fs.readFileSync(
      path.resolve(process.cwd(), 'packages/web-client/public/index.html'),
      'utf8',
    );
    const dom = new JSDOM(html);
    const modal = dom.window.document.getElementById('voice-settings-modal');

    expect(modal).not.toBeNull();
    expect(modal?.hidden).toBe(true);
    expect((modal as HTMLElement | null)?.style.display).toBe('none');
    expect(modal?.parentElement?.tagName).toBe('BODY');

    const recognitionCueControl = dom.window.document.getElementById(
      'voice-recognition-cue-control',
    );
    expect(recognitionCueControl?.hasAttribute('hidden')).toBe(true);

    const recognizeStopCommandControl = dom.window.document.getElementById(
      'voice-recognize-stop-command-control',
    );
    expect(recognizeStopCommandControl?.hasAttribute('hidden')).toBe(true);

    const startupPreRollControl = dom.window.document.getElementById('voice-startup-pre-roll-control');
    expect(startupPreRollControl?.hasAttribute('hidden')).toBe(true);

    const ttsGainControl = dom.window.document.getElementById('voice-tts-gain-control');
    expect(ttsGainControl?.hasAttribute('hidden')).toBe(true);
  });
});
