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
    document.body.innerHTML = `
      <button id="controls-toggle-button"></button>
      <button id="voice-settings-button"></button>
      <div id="voice-settings-modal"></div>
      <button id="voice-settings-close-button"></button>
      <select id="audio-mode-select"></select>
      <input id="auto-listen-checkbox" type="checkbox" />
      <input id="voice-adapter-base-url-input" type="url" />
      <select id="voice-mic-input-select"></select>
      <input id="voice-recognition-start-timeout-input" type="number" />
      <input id="voice-recognition-completion-timeout-input" type="number" />
      <input id="voice-recognition-end-silence-input" type="number" />
      <input id="autofocus-chat-checkbox" type="checkbox" />
      <input id="keyboard-shortcuts-checkbox" type="checkbox" />
      <input id="auto-scroll-checkbox" type="checkbox" />
      <div id="status"></div>
      <div id="panel-workspace"></div>
    `;

    const elements = getWebClientElements();

    expect(elements).not.toBeNull();
    expect(elements?.voiceSettingsButton.id).toBe('voice-settings-button');
    expect(elements?.voiceSettingsModal.id).toBe('voice-settings-modal');
    expect(elements?.voiceSettingsCloseButton.id).toBe('voice-settings-close-button');
    expect(elements?.audioModeSelect?.id).toBe('audio-mode-select');
    expect(elements?.autoListenCheckbox?.id).toBe('auto-listen-checkbox');
    expect(elements?.voiceAdapterBaseUrlInput.id).toBe('voice-adapter-base-url-input');
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
  });
});
