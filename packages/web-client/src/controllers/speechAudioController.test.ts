// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../utils/audio', () => {
  class MockTtsAudioPlayer {
    setMuted = vi.fn();
    setEnabled = vi.fn();
    stop = vi.fn();
    stopForBargeIn = vi.fn(() => 0);
    handleIncomingFrame = vi.fn();
    getRemainingPlaybackMs = vi.fn(() => 0);

    constructor(_options: unknown) {}
  }

  return {
    TtsAudioPlayer: MockTtsAudioPlayer,
  };
});

import type { AssistantNativeVoiceBridgeTarget } from './speechAudioController';
import { AssistantNativeVoiceBridge, SpeechAudioController } from './speechAudioController';

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

function ensureWebSocketGlobal(): void {
  if (typeof globalThis.WebSocket === 'undefined') {
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = { OPEN: 1 };
  }
}

function dispatchPointerEvent(
  target: HTMLElement,
  type: string,
  options: { pointerType?: string; button?: number } = {},
): void {
  const event = new Event(type, { bubbles: true }) as PointerEvent;
  Object.defineProperty(event, 'pointerType', { value: options.pointerType ?? 'mouse' });
  Object.defineProperty(event, 'button', { value: options.button ?? 0 });
  target.dispatchEvent(event);
}

describe('AssistantNativeVoiceBridge', () => {
  it('calls the direct AssistantNativeVoice bridge when available', () => {
    const target = {
      setVoiceModeEnabled: vi.fn(),
      setSelectedSession: vi.fn(),
      setVoiceAdapterBaseUrl: vi.fn(),
      setAssistantBaseUrl: vi.fn(),
    };

    const bridge = new AssistantNativeVoiceBridge(() => ({
      AssistantNativeVoice: target,
    }));

    expect(bridge.setVoiceModeEnabled(true)).toBe(true);
    expect(bridge.setSelectedSession({ panelId: 'panel-1', sessionId: 'session-1' })).toBe(true);
    expect(bridge.setVoiceAdapterBaseUrl('https://assistant/agent-voice-adapter')).toBe(true);
    expect(bridge.setAssistantBaseUrl('https://assistant')).toBe(true);
    expect(target.setVoiceModeEnabled).toHaveBeenCalledWith({ enabled: true });
    expect(target.setSelectedSession).toHaveBeenCalledWith({
      selection: {
        panelId: 'panel-1',
        sessionId: 'session-1',
      },
    });
    expect(target.setVoiceAdapterBaseUrl).toHaveBeenCalledWith({
      url: 'https://assistant/agent-voice-adapter',
    });
    expect(target.setAssistantBaseUrl).toHaveBeenCalledWith({ url: 'https://assistant' });
  });

  it('passes null selected session through the direct bridge', () => {
    const target = {
      setSelectedSession: vi.fn(),
    };

    const bridge = new AssistantNativeVoiceBridge(() => ({
      AssistantNativeVoice: target,
    }));

    expect(bridge.setSelectedSession(null)).toBe(true);
    expect(target.setSelectedSession).toHaveBeenCalledWith({ selection: null });
  });

  it('calls the Capacitor plugin bridge surface with the final contract methods', () => {
    const target = {
      setVoiceModeEnabled: vi.fn(),
      setSelectedSession: vi.fn(),
      setVoiceAdapterBaseUrl: vi.fn(),
      setAssistantBaseUrl: vi.fn(),
    };

    const bridge = new AssistantNativeVoiceBridge(() => ({
      Capacitor: {
        Plugins: {
          AssistantNativeVoice: target,
        },
      },
    }));

    expect(bridge.setVoiceModeEnabled(false)).toBe(true);
    expect(bridge.setSelectedSession(null)).toBe(true);
    expect(bridge.setVoiceAdapterBaseUrl('https://assistant/agent-voice-adapter')).toBe(true);
    expect(bridge.setAssistantBaseUrl('https://assistant')).toBe(true);
    expect(target.setVoiceModeEnabled).toHaveBeenCalledWith({ enabled: false });
    expect(target.setSelectedSession).toHaveBeenCalledWith({ selection: null });
    expect(target.setVoiceAdapterBaseUrl).toHaveBeenCalledWith({
      url: 'https://assistant/agent-voice-adapter',
    });
    expect(target.setAssistantBaseUrl).toHaveBeenCalledWith({ url: 'https://assistant' });
  });

  it('does not support alternate plugin names', () => {
    const legacyTarget = {
      setVoiceModeEnabled: vi.fn(),
    };

    const plugins: { AssistantNativeVoice?: AssistantNativeVoiceBridgeTarget } & Record<
      string,
      unknown
    > = {};
    plugins['AssistantVoice'] = legacyTarget;

    const bridge = new AssistantNativeVoiceBridge(
      () => ({
        Capacitor: {
          Plugins: plugins,
        },
      }),
    );

    expect(bridge.setVoiceModeEnabled(true)).toBe(false);
    expect(legacyTarget.setVoiceModeEnabled).not.toHaveBeenCalled();
  });

  it('returns false when no native voice bridge is installed', () => {
    const bridge = new AssistantNativeVoiceBridge(() => ({}));

    expect(bridge.setVoiceModeEnabled(true)).toBe(false);
    expect(bridge.setSelectedSession(null)).toBe(false);
  });

  it('supports native state queries, listeners, and control methods', async () => {
    const remove = vi.fn();
    const target = {
      getState: vi.fn(async () => ({ state: 'listening' })),
      stopCurrentInteraction: vi.fn(),
      startManualListen: vi.fn(),
      addListener: vi.fn((_eventName: string, _listener: (payload: unknown) => void) => ({
        remove,
      })),
    };

    const bridge = new AssistantNativeVoiceBridge(() => ({
      AssistantNativeVoice: target,
    }));

    const state = await bridge.getState();
    const offState = bridge.addStateChangedListener(() => {});
    const offError = bridge.addRuntimeErrorListener(() => {});

    expect(state).toEqual({ state: 'listening' });
    expect(bridge.stopCurrentInteraction()).toBe(true);
    expect(bridge.startManualListen()).toBe(true);
    expect(target.stopCurrentInteraction).toHaveBeenCalledTimes(1);
    expect(target.startManualListen).toHaveBeenCalledTimes(1);
    expect(target.addListener).toHaveBeenCalledTimes(2);

    offState?.();
    offError?.();
    expect(remove).toHaveBeenCalledTimes(2);
  });
});

describe('SpeechAudioController.cancelAllActiveOperations', () => {
  it('does not remove pending assistant bubble that already contains tool output', () => {
    ensureWebSocketGlobal();

    const chatLogEl = document.createElement('div');
    document.body.appendChild(chatLogEl);

    const pendingBubble = document.createElement('div');
    pendingBubble.className = 'message assistant';
    pendingBubble.dataset['typing'] = 'true';

    const toolBlock = document.createElement('div');
    toolBlock.className = 'tool-output-block';
    pendingBubble.appendChild(toolBlock);

    const typingIndicator = document.createElement('span');
    typingIndicator.className = 'typing-indicator';
    pendingBubble.appendChild(typingIndicator);

    chatLogEl.appendChild(pendingBubble);

    const send = vi.fn();
    const socket = { readyState: WebSocket.OPEN, send } as unknown as WebSocket;

    let pending: HTMLDivElement | null = pendingBubble;

    const controller = new SpeechAudioController({
      speechFeaturesEnabled: false,
      speechInputController: null,
      micButtonEl: document.createElement('button'),
      audioResponsesCheckboxEl: document.createElement('input'),
      inputEl: document.createElement('input'),
      getPendingAssistantBubble: () => pending,
      setPendingAssistantBubble: (bubble) => {
        pending = bubble;
      },
      getSocket: () => socket,
      getSessionId: () => 'session-a',
      setStatus: vi.fn(),
      setTtsStatus: vi.fn(),
      sendUserText: vi.fn(),
      updateClearInputButtonVisibility: vi.fn(),
      sendModesUpdate: vi.fn(),
      supportsAudioOutput: () => false,
      isOutputActive: () => true,
      updateScrollButtonVisibility: vi.fn(),
      audioResponsesStorageKey: 'test-audio-responses',
      continuousListeningLongPressMs: 250,
      initialAudioResponsesEnabled: false,
    });

    const cancelled = controller.cancelAllActiveOperations();
    expect(cancelled).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(chatLogEl.contains(pendingBubble)).toBe(true);
    expect(pending).toBeNull();
  });

  it('removes an empty pending assistant bubble on cancel', () => {
    ensureWebSocketGlobal();

    const chatLogEl = document.createElement('div');
    document.body.appendChild(chatLogEl);

    const pendingBubble = document.createElement('div');
    pendingBubble.className = 'message assistant';
    pendingBubble.dataset['typing'] = 'true';

    const typingIndicator = document.createElement('span');
    typingIndicator.className = 'typing-indicator';
    pendingBubble.appendChild(typingIndicator);

    chatLogEl.appendChild(pendingBubble);

    const send = vi.fn();
    const socket = { readyState: WebSocket.OPEN, send } as unknown as WebSocket;

    let pending: HTMLDivElement | null = pendingBubble;

    const controller = new SpeechAudioController({
      speechFeaturesEnabled: false,
      speechInputController: null,
      micButtonEl: document.createElement('button'),
      audioResponsesCheckboxEl: document.createElement('input'),
      inputEl: document.createElement('input'),
      getPendingAssistantBubble: () => pending,
      setPendingAssistantBubble: (bubble) => {
        pending = bubble;
      },
      getSocket: () => socket,
      getSessionId: () => 'session-a',
      setStatus: vi.fn(),
      setTtsStatus: vi.fn(),
      sendUserText: vi.fn(),
      updateClearInputButtonVisibility: vi.fn(),
      sendModesUpdate: vi.fn(),
      supportsAudioOutput: () => false,
      isOutputActive: () => true,
      updateScrollButtonVisibility: vi.fn(),
      audioResponsesStorageKey: 'test-audio-responses',
      continuousListeningLongPressMs: 250,
      initialAudioResponsesEnabled: false,
    });

    const cancelled = controller.cancelAllActiveOperations();
    expect(cancelled).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(chatLogEl.contains(pendingBubble)).toBe(false);
    expect(pending).toBeNull();
  });

  it('sends output cancel when TTS is playing without active text streaming', () => {
    ensureWebSocketGlobal();

    const send = vi.fn();
    const socket = { readyState: WebSocket.OPEN, send } as unknown as WebSocket;
    const stopForBargeIn = vi.fn(() => 123);

    const controller = new SpeechAudioController({
      speechFeaturesEnabled: false,
      speechInputController: null,
      micButtonEl: document.createElement('button'),
      audioResponsesCheckboxEl: document.createElement('input'),
      inputEl: document.createElement('input'),
      getSocket: () => socket,
      getSessionId: () => 'session-a',
      setStatus: vi.fn(),
      setTtsStatus: vi.fn(),
      sendUserText: vi.fn(),
      updateClearInputButtonVisibility: vi.fn(),
      sendModesUpdate: vi.fn(),
      supportsAudioOutput: () => false,
      isOutputActive: () => false,
      updateScrollButtonVisibility: vi.fn(),
      audioResponsesStorageKey: 'test-audio-responses',
      continuousListeningLongPressMs: 250,
      initialAudioResponsesEnabled: false,
    });

    const controllerState = controller as unknown as {
      ttsPlayer: { stopForBargeIn: () => number } | null;
      isTtsPlaying: boolean;
    };
    controllerState.ttsPlayer = { stopForBargeIn };
    controllerState.isTtsPlaying = true;

    const cancelled = controller.cancelAllActiveOperations();
    expect(cancelled).toBe(true);
    expect(stopForBargeIn).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(send.mock.calls[0]?.[0] as string) as {
      type: string;
      action: string;
      target: string;
      sessionId: string;
      audioEndMs: number;
    };
    expect(payload).toMatchObject({
      type: 'control',
      action: 'cancel',
      target: 'output',
      sessionId: 'session-a',
      audioEndMs: 123,
    });
  });
});

describe('SpeechAudioController.micButtonState', () => {
  it('toggles the stop state when streaming output', () => {
    let isStreaming = true;
    const micButton = document.createElement('button');

    const controller = new SpeechAudioController({
      speechFeaturesEnabled: true,
      speechInputController: null,
      micButtonEl: micButton,
      audioResponsesCheckboxEl: document.createElement('input'),
      inputEl: document.createElement('input'),
      getPendingAssistantBubble: () => null,
      setPendingAssistantBubble: () => {},
      getSocket: () => null,
      getSessionId: () => null,
      setStatus: vi.fn(),
      setTtsStatus: vi.fn(),
      sendUserText: vi.fn(),
      updateClearInputButtonVisibility: vi.fn(),
      sendModesUpdate: vi.fn(),
      supportsAudioOutput: () => false,
      isOutputActive: () => isStreaming,
      updateScrollButtonVisibility: vi.fn(),
      audioResponsesStorageKey: 'test-audio-responses',
      continuousListeningLongPressMs: 250,
      initialAudioResponsesEnabled: false,
    });

    controller.syncMicButtonState();
    expect(micButton.classList.contains('stopping')).toBe(true);
    expect(micButton.getAttribute('aria-label')).toBe('Stop output');

    isStreaming = false;
    controller.syncMicButtonState();
    expect(micButton.classList.contains('stopping')).toBe(false);
    expect(micButton.getAttribute('aria-label')).toBe('Voice input');
  });

  it('clears stale stop and interrupting classes on connection cleanup', () => {
    const micButton = document.createElement('button');
    micButton.classList.add('stopping', 'interrupting', 'recording');

    const controller = new SpeechAudioController({
      speechFeaturesEnabled: true,
      speechInputController: null,
      micButtonEl: micButton,
      audioResponsesCheckboxEl: document.createElement('input'),
      inputEl: document.createElement('input'),
      getPendingAssistantBubble: () => null,
      setPendingAssistantBubble: () => {},
      getSocket: () => null,
      getSessionId: () => null,
      setStatus: vi.fn(),
      setTtsStatus: vi.fn(),
      sendUserText: vi.fn(),
      updateClearInputButtonVisibility: vi.fn(),
      sendModesUpdate: vi.fn(),
      supportsAudioOutput: () => false,
      isOutputActive: () => false,
      updateScrollButtonVisibility: vi.fn(),
      audioResponsesStorageKey: 'test-audio-responses',
      continuousListeningLongPressMs: 250,
      initialAudioResponsesEnabled: false,
    });

    controller.onConnectionLostCleanup();

    expect(micButton.classList.contains('recording')).toBe(false);
    expect(micButton.classList.contains('interrupting')).toBe(false);
    expect(micButton.classList.contains('stopping')).toBe(false);
    expect(micButton.getAttribute('aria-label')).toBe('Voice input');
  });

  it('notifies listeners when audio responses are enabled and disabled', () => {
    const controller = new SpeechAudioController({
      speechFeaturesEnabled: true,
      speechInputController: null,
      micButtonEl: document.createElement('button'),
      audioResponsesCheckboxEl: document.createElement('input'),
      inputEl: document.createElement('input'),
      getPendingAssistantBubble: () => null,
      setPendingAssistantBubble: () => {},
      getSocket: () => null,
      getSessionId: () => null,
      setStatus: vi.fn(),
      setTtsStatus: vi.fn(),
      sendUserText: vi.fn(),
      updateClearInputButtonVisibility: vi.fn(),
      sendModesUpdate: vi.fn(),
      supportsAudioOutput: () => true,
      isOutputActive: () => false,
      updateScrollButtonVisibility: vi.fn(),
      audioResponsesStorageKey: 'test-audio-responses',
      continuousListeningLongPressMs: 250,
      initialAudioResponsesEnabled: false,
    });
    const handler = vi.fn();

    controller.setAudioResponsesChangeHandler(handler);
    controller.enableAudioResponses();
    controller.disableAudioResponses();

    expect(handler).toHaveBeenNthCalledWith(1, true);
    expect(handler).toHaveBeenNthCalledWith(2, false);
  });

  it('uses native speaking and listening states for the mic button when native voice runtime is active', () => {
    const micButton = document.createElement('button');
    micButton.innerHTML =
      '<svg class="mic-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"></svg>';
    const bridge = new AssistantNativeVoiceBridge(() => ({
      AssistantNativeVoice: {
        startManualListen: vi.fn(),
        stopCurrentInteraction: vi.fn(),
      },
    }));

    const controller = new SpeechAudioController({
      speechFeaturesEnabled: true,
      speechInputController: null,
      micButtonEl: micButton,
      audioResponsesCheckboxEl: document.createElement('input'),
      inputEl: document.createElement('input'),
      getPendingAssistantBubble: () => null,
      setPendingAssistantBubble: () => {},
      getSocket: () => null,
      getSessionId: () => null,
      setStatus: vi.fn(),
      setTtsStatus: vi.fn(),
      sendUserText: vi.fn(),
      updateClearInputButtonVisibility: vi.fn(),
      sendModesUpdate: vi.fn(),
      supportsAudioOutput: () => true,
      isOutputActive: () => true,
      updateScrollButtonVisibility: vi.fn(),
      audioResponsesStorageKey: 'test-audio-responses',
      continuousListeningLongPressMs: 250,
      initialAudioResponsesEnabled: false,
      useNativeVoiceRuntime: true,
      nativeVoiceBridge: bridge,
    });

    controller.enableAudioResponses();
    controller.setNativeRuntimeState('speaking');

    expect(micButton.classList.contains('native-speaking')).toBe(true);
    expect(micButton.classList.contains('stopping')).toBe(false);
    expect(micButton.getAttribute('aria-label')).toBe('Voice playback active');
    expect(micButton.querySelector<SVGElement>('.mic-icon')?.dataset['mode']).toBe('speaker');

    controller.setNativeRuntimeState('listening');

    expect(micButton.classList.contains('native-listening')).toBe(true);
    expect(micButton.classList.contains('stopping')).toBe(true);
    expect(micButton.getAttribute('aria-label')).toBe('Stop listening');
    expect(micButton.querySelector<SVGElement>('.mic-icon')?.dataset['mode']).toBe('stop');
  });
});

describe('SpeechAudioController.longPress', () => {
  it('arms continuous listening when the long-press threshold is reached', async () => {
    ensureWebSocketGlobal();
    vi.useFakeTimers();

    const micButton = document.createElement('button');
    const speechInputController = {
      isActive: false,
      isMobile: false,
      start: vi.fn(),
      stop: vi.fn(),
    };
    const socket = { readyState: WebSocket.OPEN, send: vi.fn() } as unknown as WebSocket;

    const controller = new SpeechAudioController({
      speechFeaturesEnabled: true,
      speechInputController,
      micButtonEl: micButton,
      audioResponsesCheckboxEl: document.createElement('input'),
      inputEl: document.createElement('input'),
      getPendingAssistantBubble: () => null,
      setPendingAssistantBubble: () => {},
      getSocket: () => socket,
      getSessionId: () => null,
      setStatus: vi.fn(),
      setTtsStatus: vi.fn(),
      sendUserText: vi.fn(),
      updateClearInputButtonVisibility: vi.fn(),
      sendModesUpdate: vi.fn(),
      supportsAudioOutput: () => false,
      isOutputActive: () => false,
      updateScrollButtonVisibility: vi.fn(),
      audioResponsesStorageKey: 'test-audio-responses',
      continuousListeningLongPressMs: 250,
      initialAudioResponsesEnabled: false,
    });

    controller.attach();

    dispatchPointerEvent(micButton, 'pointerdown', { pointerType: 'touch', button: 0 });
    vi.advanceTimersByTime(249);
    await Promise.resolve();
    expect(speechInputController.start).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    await Promise.resolve();
    expect(speechInputController.start).toHaveBeenCalledTimes(1);

    dispatchPointerEvent(micButton, 'pointerup', { pointerType: 'touch', button: 0 });
    expect(speechInputController.stop).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});

describe('SpeechAudioController.startPushToTalk', () => {
  it('delegates manual listen to the native voice runtime when enabled', async () => {
    const startManualListen = vi.fn();
    const bridge = new AssistantNativeVoiceBridge(() => ({
      AssistantNativeVoice: {
        startManualListen,
      },
    }));

    const controller = new SpeechAudioController({
      speechFeaturesEnabled: true,
      speechInputController: null,
      micButtonEl: document.createElement('button'),
      audioResponsesCheckboxEl: document.createElement('input'),
      inputEl: document.createElement('input'),
      getPendingAssistantBubble: () => null,
      setPendingAssistantBubble: () => {},
      getSocket: () => null,
      getSessionId: () => 'session-a',
      setStatus: vi.fn(),
      setTtsStatus: vi.fn(),
      sendUserText: vi.fn(),
      updateClearInputButtonVisibility: vi.fn(),
      sendModesUpdate: vi.fn(),
      supportsAudioOutput: () => true,
      isOutputActive: () => false,
      updateScrollButtonVisibility: vi.fn(),
      audioResponsesStorageKey: 'test-audio-responses',
      continuousListeningLongPressMs: 250,
      initialAudioResponsesEnabled: true,
      useNativeVoiceRuntime: true,
      nativeVoiceBridge: bridge,
    });

    await controller.startPushToTalk();

    expect(startManualListen).toHaveBeenCalledTimes(1);
  });

  it('auto-submits final speech text on desktop', async () => {
    ensureWebSocketGlobal();

    let callbacks:
      | {
          onPartial: (text: string) => void;
          onFinal: (text: string) => void;
          onError: (error: unknown) => void;
          onEnd: () => void;
        }
      | undefined;

    const speechInputController = {
      isActive: false,
      isMobile: false,
      start: (options: {
        onPartial: (text: string) => void;
        onFinal: (text: string) => void;
        onError: (error: unknown) => void;
        onEnd: () => void;
      }) => {
        callbacks = options;
      },
      stop: vi.fn(),
    };

    const sendUserText = vi.fn();
    const socket = { readyState: WebSocket.OPEN, send: vi.fn() } as unknown as WebSocket;

    const controller = new SpeechAudioController({
      speechFeaturesEnabled: true,
      speechInputController,
      micButtonEl: document.createElement('button'),
      audioResponsesCheckboxEl: document.createElement('input'),
      inputEl: document.createElement('input'),
      getPendingAssistantBubble: () => null,
      setPendingAssistantBubble: () => {},
      getSocket: () => socket,
      getSessionId: () => 'session-a',
      setStatus: vi.fn(),
      setTtsStatus: vi.fn(),
      sendUserText,
      updateClearInputButtonVisibility: vi.fn(),
      sendModesUpdate: vi.fn(),
      supportsAudioOutput: () => false,
      isOutputActive: () => false,
      updateScrollButtonVisibility: vi.fn(),
      audioResponsesStorageKey: 'test-audio-responses',
      continuousListeningLongPressMs: 250,
      initialAudioResponsesEnabled: false,
    });

    await controller.startPushToTalk();

    expect(callbacks).toBeDefined();
    callbacks?.onFinal('hello world');

    expect(sendUserText).toHaveBeenCalledWith('hello world');
  });

  it('does not submit when stopped manually', async () => {
    ensureWebSocketGlobal();

    let callbacks:
      | {
          onPartial: (text: string) => void;
          onFinal: (text: string) => void;
          onError: (error: unknown) => void;
          onEnd: () => void;
        }
      | undefined;

    const speechInputController = {
      isActive: false,
      isMobile: false,
      start: (options: {
        onPartial: (text: string) => void;
        onFinal: (text: string) => void;
        onError: (error: unknown) => void;
        onEnd: () => void;
      }) => {
        callbacks = options;
      },
      stop: vi.fn(),
    };

    const sendUserText = vi.fn();
    const socket = { readyState: WebSocket.OPEN, send: vi.fn() } as unknown as WebSocket;

    const controller = new SpeechAudioController({
      speechFeaturesEnabled: true,
      speechInputController,
      micButtonEl: document.createElement('button'),
      audioResponsesCheckboxEl: document.createElement('input'),
      inputEl: document.createElement('input'),
      getPendingAssistantBubble: () => null,
      setPendingAssistantBubble: () => {},
      getSocket: () => socket,
      getSessionId: () => 'session-a',
      setStatus: vi.fn(),
      setTtsStatus: vi.fn(),
      sendUserText,
      updateClearInputButtonVisibility: vi.fn(),
      sendModesUpdate: vi.fn(),
      supportsAudioOutput: () => false,
      isOutputActive: () => false,
      updateScrollButtonVisibility: vi.fn(),
      audioResponsesStorageKey: 'test-audio-responses',
      continuousListeningLongPressMs: 250,
      initialAudioResponsesEnabled: false,
    });

    await controller.startPushToTalk();
    controller.stopPushToTalk();

    callbacks?.onFinal('should not send');
    callbacks?.onEnd();

    expect(sendUserText).not.toHaveBeenCalled();
  });

  it('disables speech input when permission is denied', async () => {
    ensureWebSocketGlobal();

    let callbacks:
      | {
          onPartial: (text: string) => void;
          onFinal: (text: string) => void;
          onError: (error: unknown) => void;
          onEnd: () => void;
        }
      | undefined;

    const speechInputController = {
      isActive: false,
      isMobile: false,
      start: (options: {
        onPartial: (text: string) => void;
        onFinal: (text: string) => void;
        onError: (error: unknown) => void;
        onEnd: () => void;
      }) => {
        callbacks = options;
      },
      stop: vi.fn(),
    };

    const micButton = document.createElement('button');
    const socket = { readyState: WebSocket.OPEN, send: vi.fn() } as unknown as WebSocket;

    const controller = new SpeechAudioController({
      speechFeaturesEnabled: true,
      speechInputController,
      micButtonEl: micButton,
      audioResponsesCheckboxEl: document.createElement('input'),
      inputEl: document.createElement('input'),
      getPendingAssistantBubble: () => null,
      setPendingAssistantBubble: () => {},
      getSocket: () => socket,
      getSessionId: () => 'session-a',
      setStatus: vi.fn(),
      setTtsStatus: vi.fn(),
      sendUserText: vi.fn(),
      updateClearInputButtonVisibility: vi.fn(),
      sendModesUpdate: vi.fn(),
      supportsAudioOutput: () => false,
      isOutputActive: () => false,
      updateScrollButtonVisibility: vi.fn(),
      audioResponsesStorageKey: 'test-audio-responses',
      continuousListeningLongPressMs: 250,
      initialAudioResponsesEnabled: false,
    });

    await controller.startPushToTalk();

    expect(callbacks).toBeDefined();
    callbacks?.onError(new Error('Speech recognition error: not-allowed'));
    callbacks?.onEnd();

    expect(micButton.disabled).toBe(true);
    expect(micButton.getAttribute('title')).toMatch(/microphone permissions/i);
    expect(controller.hasSpeechInput).toBe(false);
  });
});
