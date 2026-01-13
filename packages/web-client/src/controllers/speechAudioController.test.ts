// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SpeechAudioController } from './speechAudioController';

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
