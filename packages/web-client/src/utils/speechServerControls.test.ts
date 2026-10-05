// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { AssistantNativeVoiceBridge } from '../controllers/speechAudioController';
import { createDefaultVoiceSettings } from './voiceSettings';
import { bindSpeechServerControls, speechCatalogOptions } from './speechServerControls';

const catalog = {
  object: 'list',
  data: [
    { id: 'parakeet-local', task: 'transcription' },
    { id: 'kokoro-local', task: 'speech', voices: [{ id: 'af_heart' }] },
    { id: 'kokoro-british', task: 'speech', voices: [{ id: 'bf_emma' }] },
  ],
};

describe('speechServerControls', () => {
  it('offers advertised models and voices for the chosen speech model', () => {
    expect(speechCatalogOptions(catalog, 'kokoro-local')).toEqual({
      recognitionModels: ['parakeet-local'],
      synthesisModels: ['kokoro-local', 'kokoro-british'],
      voices: ['af_heart'],
    });
    expect(speechCatalogOptions(catalog, 'custom').voices).toEqual([]);
  });

  it.each(['speech-manage-token-button', 'speech-refresh-models-button'])(
    'rejects token-bearing URLs before %s saves or invokes native methods',
    async (buttonId) => {
      document.body.innerHTML =
        '<button id="speech-manage-token-button"></button><button id="speech-refresh-models-button"></button><p id="speech-credential-status"></p><input id="speech-server-base-url-input" value="https://host/v1?token=secret">';
      const target = {
        setVoiceSettings: vi.fn(),
        manageSpeechCredential: vi.fn(),
        discoverSpeechModels: vi.fn(),
      };
      const syncSettings = vi.fn(() => localStorage.setItem('voice-test-settings', 'secret'));
      localStorage.removeItem('voice-test-settings');
      bindSpeechServerControls({
        bridge: new AssistantNativeVoiceBridge(() => ({ AssistantNativeVoice: target })),
        enabled: true,
        getSettings: createDefaultVoiceSettings,
        syncSettings,
      });
      document.getElementById(buttonId)!.click();
      expect(syncSettings).not.toHaveBeenCalled();
      expect(target.setVoiceSettings).not.toHaveBeenCalled();
      expect(target.manageSpeechCredential).not.toHaveBeenCalled();
      expect(target.discoverSpeechModels).not.toHaveBeenCalled();
      expect(localStorage.getItem('voice-test-settings')).toBeNull();
      expect(document.getElementById('speech-credential-status')!.textContent).not.toContain(
        'secret',
      );
      expect(
        (document.getElementById('speech-server-base-url-input') as HTMLInputElement).value,
      ).toBe('https://host/v1?token=secret');
    },
  );

  it('saves settings before discovery and leaves custom entries intact', async () => {
    document.body.innerHTML =
      '<button id="speech-manage-token-button"></button><button id="speech-refresh-models-button"></button><p id="speech-credential-status"></p><input id="speech-server-base-url-input" value="https://assistant/speech/v1/"><input id="speech-synthesis-model-input"><input id="speech-voice-input" value="custom"><datalist id="speech-recognition-model-options"></datalist><datalist id="speech-synthesis-model-options"></datalist><datalist id="speech-voice-options"></datalist>';
    const calls: string[] = [];
    const target = {
      setVoiceSettings: vi.fn(async () => {
        calls.push('save');
      }),
      discoverSpeechModels: vi.fn(async () => {
        calls.push('discover');
        return { catalog, credentialConfigured: true };
      }),
    };
    bindSpeechServerControls({
      bridge: new AssistantNativeVoiceBridge(() => ({ AssistantNativeVoice: target })),
      enabled: true,
      getSettings: createDefaultVoiceSettings,
      syncSettings: vi.fn(),
    });
    document.getElementById('speech-refresh-models-button')!.click();
    await vi.waitFor(() => expect(calls).toEqual(['save', 'discover']));
    await vi.waitFor(() =>
      expect(document.getElementById('speech-voice-options')!.children).toHaveLength(1),
    );
    expect((document.getElementById('speech-voice-input') as HTMLInputElement).value).toBe(
      'custom',
    );
    expect(document.getElementById('speech-credential-status')!.textContent).toBe(
      'Speech token configured.',
    );
    const modelInput = document.getElementById('speech-synthesis-model-input') as HTMLInputElement;
    modelInput.value = 'kokoro-british';
    modelInput.dispatchEvent(new Event('change'));
    expect(
      (document.querySelector('#speech-voice-options option') as HTMLOptionElement).value,
    ).toBe('bf_emma');
    const endpointInput = document.getElementById(
      'speech-server-base-url-input',
    ) as HTMLInputElement;
    endpointInput.value = 'https://another/speech/v1';
    endpointInput.dispatchEvent(new Event('change'));
    expect(document.getElementById('speech-voice-options')!.children).toHaveLength(0);
  });
});
