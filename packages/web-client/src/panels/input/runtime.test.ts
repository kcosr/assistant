// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { AssistantNativeVoiceBridge } from '../../controllers/speechAudioController';
import { createInputRuntime } from './runtime';
import { createDefaultVoiceSettings } from '../../utils/voiceSettings';

describe('createInputRuntime', () => {
  it('keeps websocket output mode on text when native voice runtime owns audio responses', () => {
    if (typeof globalThis.WebSocket === 'undefined') {
      (globalThis as unknown as { WebSocket: unknown }).WebSocket = { OPEN: 1 };
    }

    document.body.innerHTML = `
      <form></form>
      <input />
      <button></button>
      <button></button>
      <button><svg class="mic-icon"></svg></button>
      <select><option value="off">Off</option><option value="tool">Tool</option><option value="response">Response</option></select>
      <input type="checkbox" />
    `;

    const [form, inputEl, clearButtonEl, _submitButtonEl, micButtonEl, select, autoListenCheckbox] =
      Array.from(document.body.children) as [
        HTMLFormElement,
        HTMLInputElement,
        HTMLButtonElement,
        HTMLButtonElement,
        HTMLButtonElement,
        HTMLSelectElement,
        HTMLInputElement,
      ];

    const send = vi.fn();
    const socket = { readyState: WebSocket.OPEN, send } as unknown as WebSocket;
    const nativeVoiceBridge = new AssistantNativeVoiceBridge(() => ({
      AssistantNativeVoice: {
        setVoiceSettings: vi.fn(),
      },
    }));

    const runtime = createInputRuntime({
      elements: {
        contextPreviewEl: null,
        pendingMessageListEl: null,
        form,
        inputEl,
        clearButtonEl,
        contextToggleButtonEl: null,
        briefToggleButtonEl: null,
        micButtonEl,
        submitButtonEl: null,
      },
      getSelectedSessionId: () => 'session-a',
      getChatRuntimeForSession: () => null,
      getSocket: () => socket,
      setStatus: vi.fn(),
      setTtsStatus: vi.fn(),
      showSessionTypingIndicator: vi.fn(),
      appendMessage: vi.fn(),
      appendExternalSentIndicator: vi.fn(),
      setAssistantBubbleTyping: vi.fn(),
      scrollMessageIntoView: vi.fn(),
      buildContextLine: vi.fn(() => ''),
      getActiveContextItem: () => null,
      getActiveContextItemName: () => null,
      getActiveContextItemDescription: () => null,
      getSelectedItemIds: () => [],
      getActivePanelContext: () => null,
      getContextPreviewData: () => null,
      getIsSessionExternal: () => false,
      getAgentDisplayName: () => 'Agent',
      cancelQueuedMessage: vi.fn(),
      audioModeSelectEl: select,
      autoListenCheckboxEl: autoListenCheckbox,
      voiceAdapterBaseUrlInputEl: document.createElement('input'),
      voiceMicInputSelectEl: document.createElement('select'),
      voiceRecognitionStartTimeoutInputEl: document.createElement('input'),
      voiceRecognitionCompletionTimeoutInputEl: document.createElement('input'),
      voiceRecognitionEndSilenceInputEl: document.createElement('input'),
      voiceRecognizeStopCommandCheckboxEl: document.createElement('input'),
      voiceRecognitionCueCheckboxEl: document.createElement('input'),
      voiceRecognitionCueGainSliderEl: document.createElement('input'),
      voiceRecognitionCueGainValueEl: document.createElement('span'),
      voiceStartupPreRollSliderEl: document.createElement('input'),
      voiceStartupPreRollValueEl: document.createElement('span'),
      voiceTtsGainSliderEl: document.createElement('input'),
      voiceTtsGainValueEl: document.createElement('span'),
      initialIncludePanelContext: true,
      initialBriefModeEnabled: false,
      speechFeaturesEnabled: false,
      initialVoiceSettings: {
        audioMode: 'tool',
        autoListenEnabled: true,
        voiceAdapterBaseUrl: 'https://assistant/agent-voice-adapter',
        preferredVoiceSessionId: '',
        ttsPreferredSessionOnly: false,
        selectedMicDeviceId: '',
        recognitionStartTimeoutMs: 30000,
        recognitionCompletionTimeoutMs: 60000,
        recognitionEndSilenceMs: 1200,
        recognizeStopCommandEnabled: true,
        ttsGain: 1,
        recognitionCueEnabled: true,
        recognitionCueGain: 1,
        startupPreRollMs: 512,
      },
      voiceSettingsStorageKey: 'test-voice-settings',
      continuousListeningLongPressMs: 250,
      useNativeVoiceRuntime: true,
      nativeVoiceBridge,
      initialNativeVoiceRuntimeState: 'idle',
    });

    runtime.sendModesUpdate();

    expect(send).toHaveBeenCalled();
    expect(JSON.parse(send.mock.calls.at(-1)?.[0] as string)).toMatchObject({
      type: 'set_modes',
      outputMode: 'text',
    });
  });

  it('updates the context preview immediately when panel context is toggled off', () => {
    document.body.innerHTML = `
      <div data-role="context-preview"></div>
      <form></form>
      <input />
      <button></button>
      <button></button>
      <button><svg class="mic-icon"></svg></button>
      <select><option value="off">Off</option><option value="tool">Tool</option></select>
      <input type="checkbox" />
    `;

    const [
      contextPreviewEl,
      form,
      inputEl,
      clearButtonEl,
      _submitButtonEl,
      micButtonEl,
      select,
      autoListenCheckbox,
    ] = Array.from(document.body.children) as [
      HTMLElement,
      HTMLFormElement,
      HTMLInputElement,
      HTMLButtonElement,
      HTMLButtonElement,
      HTMLButtonElement,
      HTMLSelectElement,
      HTMLInputElement,
    ];

    const runtime = createInputRuntime({
      elements: {
        contextPreviewEl,
        pendingMessageListEl: null,
        form,
        inputEl,
        clearButtonEl,
        contextToggleButtonEl: null,
        briefToggleButtonEl: null,
        micButtonEl,
        submitButtonEl: null,
      },
      getSelectedSessionId: () => 'session-a',
      getChatRuntimeForSession: () => null,
      getSocket: () => null,
      setStatus: vi.fn(),
      setTtsStatus: vi.fn(),
      showSessionTypingIndicator: vi.fn(),
      appendMessage: vi.fn(),
      appendExternalSentIndicator: vi.fn(),
      setAssistantBubbleTyping: vi.fn(),
      scrollMessageIntoView: vi.fn(),
      buildContextLine: vi.fn(() => '<context panel-id="panel-1" />'),
      getActiveContextItem: () => ({ type: 'list', id: 'list-1' }),
      getActiveContextItemName: () => 'Inbox',
      getActiveContextItemDescription: () => null,
      getSelectedItemIds: () => ['item-1'],
      getSelectedItemTitles: () => ['Item 1'],
      getActivePanelContext: () => ({ panelId: 'panel-1', panelType: 'list' }),
      getActivePanelContextAttributes: () => null,
      getContextPreviewData: () => ({
        type: 'list',
        name: 'Inbox',
        selectedItemCount: 1,
        selectedItemTitles: ['Item 1'],
      }),
      getIsSessionExternal: () => false,
      getAgentDisplayName: () => 'Agent',
      cancelQueuedMessage: vi.fn(),
      audioModeSelectEl: select,
      autoListenCheckboxEl: autoListenCheckbox,
      voiceAdapterBaseUrlInputEl: document.createElement('input'),
      voiceMicInputSelectEl: document.createElement('select'),
      voiceRecognitionStartTimeoutInputEl: document.createElement('input'),
      voiceRecognitionCompletionTimeoutInputEl: document.createElement('input'),
      voiceRecognitionEndSilenceInputEl: document.createElement('input'),
      voiceRecognizeStopCommandCheckboxEl: document.createElement('input'),
      voiceRecognitionCueCheckboxEl: document.createElement('input'),
      voiceRecognitionCueGainSliderEl: document.createElement('input'),
      voiceRecognitionCueGainValueEl: document.createElement('span'),
      voiceStartupPreRollSliderEl: document.createElement('input'),
      voiceStartupPreRollValueEl: document.createElement('span'),
      voiceTtsGainSliderEl: document.createElement('input'),
      voiceTtsGainValueEl: document.createElement('span'),
      initialIncludePanelContext: true,
      initialBriefModeEnabled: false,
      speechFeaturesEnabled: false,
      initialVoiceSettings: createDefaultVoiceSettings(),
      voiceSettingsStorageKey: 'test-voice-settings',
      continuousListeningLongPressMs: 250,
    });

    runtime.updateContextPreview();
    expect(contextPreviewEl.classList.contains('visible')).toBe(true);

    runtime.setIncludePanelContext(false);
    expect(contextPreviewEl.classList.contains('visible')).toBe(false);
  });
});
