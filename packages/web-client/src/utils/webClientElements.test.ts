// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { getWebClientElements } from './webClientElements';

describe('getWebClientElements', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('returns the static voice adapter base url input when present', () => {
    document.body.innerHTML = `
      <button id="controls-toggle-button"></button>
      <select id="audio-mode-select"></select>
      <input id="auto-listen-checkbox" type="checkbox" />
      <input id="voice-adapter-base-url-input" type="url" />
      <input id="autofocus-chat-checkbox" type="checkbox" />
      <input id="keyboard-shortcuts-checkbox" type="checkbox" />
      <input id="auto-scroll-checkbox" type="checkbox" />
      <div id="status"></div>
      <div id="panel-workspace"></div>
    `;

    const elements = getWebClientElements();

    expect(elements).not.toBeNull();
    expect(elements?.audioModeSelect?.id).toBe('audio-mode-select');
    expect(elements?.autoListenCheckbox?.id).toBe('auto-listen-checkbox');
    expect(elements?.voiceAdapterBaseUrlInput?.id).toBe('voice-adapter-base-url-input');
  });
});
