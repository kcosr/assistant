// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { AssistantNativeVoiceBridge } from '../../controllers/speechAudioController';
import { createInputRuntime } from './runtime';

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
    `;

    const [form, inputEl, clearButtonEl, _submitButtonEl, micButtonEl, select] = Array.from(
      document.body.children,
    ) as [
      HTMLFormElement,
      HTMLInputElement,
      HTMLButtonElement,
      HTMLButtonElement,
      HTMLButtonElement,
      HTMLSelectElement,
    ];

    const send = vi.fn();
    const socket = { readyState: WebSocket.OPEN, send } as unknown as WebSocket;
    const nativeVoiceBridge = new AssistantNativeVoiceBridge(() => ({
      AssistantNativeVoice: {
        setAudioMode: vi.fn(),
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
      initialIncludePanelContext: true,
      initialBriefModeEnabled: false,
      speechFeaturesEnabled: false,
      initialAudioMode: 'tool',
      audioModeStorageKey: 'test-audio-mode',
      continuousListeningLongPressMs: 250,
      useNativeVoiceRuntime: true,
      nativeVoiceBridge,
      initialNativeVoiceRuntimeState: 'idle',
    });

    runtime.sendModesUpdate();

    expect(send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(send.mock.calls[0]?.[0] as string)).toMatchObject({
      type: 'set_modes',
      outputMode: 'text',
    });
  });
});
