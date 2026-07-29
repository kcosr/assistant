// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { TextInputController, type TextInputControllerOptions } from './textInputController';

function createController(overrides: Partial<TextInputControllerOptions> = {}) {
  const form = document.createElement('form');
  const inputEl = document.createElement('textarea');
  const clearInputButtonEl = document.createElement('button');
  form.appendChild(inputEl);
  form.appendChild(clearInputButtonEl);

  const socket = {
    readyState: WebSocket.OPEN,
    send: vi.fn(),
  } as unknown as WebSocket;

  const options: TextInputControllerOptions = {
    form,
    inputEl,
    clearInputButtonEl,
    getChatLogEl: () => null,
    appendMessage: vi.fn(),
    appendExternalSentIndicator: vi.fn(),
    setAssistantBubbleTyping: vi.fn(),
    scrollMessageIntoView: vi.fn(),
    showSessionTypingIndicator: vi.fn(),
    buildContextLine: vi.fn(() => '<context panel-id="panel-1" />'),
    getIncludePanelContext: () => true,
    getActiveContextItem: () => null,
    getActiveContextItemName: () => null,
    getActiveContextItemDescription: () => null,
    getSelectedItemIds: () => [],
    getSelectedItemTitles: () => [],
    getActivePanelContext: () => ({ panelId: 'panel-1', panelType: 'list' }),
    getActivePanelContextAttributes: () => null,
    getSessionId: () => 'session-1',
    getSocket: () => socket,
    onBeforeSend: vi.fn(),
    onAfterSend: vi.fn(),
    getIsSessionExternal: () => false,
    getIsSpeechActive: () => false,
    stopPushToTalk: vi.fn(),
    startPushToTalk: vi.fn(async () => {}),
    getBriefModeEnabled: () => false,
    ...overrides,
  };

  return {
    controller: new TextInputController(options),
    inputEl,
    socket,
    options,
  };
}

describe('TextInputController', () => {
  it('submits on Enter and preserves Shift+Enter for newlines', () => {
    const { controller, inputEl, socket } = createController();
    controller.attach();
    inputEl.value = 'hello';

    const enterEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    inputEl.dispatchEvent(enterEvent);

    expect(enterEvent.defaultPrevented).toBe(true);
    expect(socket.send).toHaveBeenCalledTimes(1);

    inputEl.value = 'another line';
    const shiftEnterEvent = new KeyboardEvent('keydown', {
      key: 'Enter',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    inputEl.dispatchEvent(shiftEnterEvent);

    expect(shiftEnterEvent.defaultPrevented).toBe(false);
    expect(socket.send).toHaveBeenCalledTimes(1);
  });

  it('resizes the textarea when its value changes', () => {
    const { controller, inputEl } = createController();
    Object.defineProperty(inputEl, 'scrollHeight', { configurable: true, value: 84 });

    controller.attach();
    inputEl.value = 'wrapped text';
    inputEl.dispatchEvent(new Event('input'));

    expect(inputEl.style.height).toBe('84px');

    inputEl.value = '';
    inputEl.dispatchEvent(new Event('input'));

    expect(inputEl.style.height).toBe('');
  });

  it('does not prepend panel context when the context toggle is off', () => {
    const { controller, socket } = createController({
      getIncludePanelContext: () => false,
    });

    controller.sendUserText('hello');

    expect(socket.send).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(vi.mocked(socket.send).mock.calls[0]?.[0] as string) as {
      text: string;
    };
    expect(payload.text).toBe('hello');
  });

  it('prepends panel context when the context toggle is on', () => {
    const { controller, socket } = createController();

    controller.sendUserText('hello');

    expect(socket.send).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(vi.mocked(socket.send).mock.calls[0]?.[0] as string) as {
      text: string;
    };
    expect(payload.text).toBe('<context panel-id="panel-1" />\nhello');
  });

  it('tags typed submissions with the native turn origin when available', () => {
    const { controller, socket } = createController({
      getTurnOriginId: () => '  process-origin-1  ',
    });

    controller.sendUserText('hello');

    const payload = JSON.parse(vi.mocked(socket.send).mock.calls[0]?.[0] as string) as {
      turnOriginId?: string;
    };
    expect(payload.turnOriginId).toBe('process-origin-1');
  });

  it('omits an empty native turn origin', () => {
    const { controller, socket } = createController({
      getTurnOriginId: () => '   ',
    });

    controller.sendUserText('hello');

    const payload = JSON.parse(vi.mocked(socket.send).mock.calls[0]?.[0] as string) as {
      turnOriginId?: string;
    };
    expect(payload).not.toHaveProperty('turnOriginId');
  });

  it('waits for native origin hydration before sending a cold-start submission', async () => {
    let turnOriginId: string | null = null;
    let resolveHydration!: (value: string | null) => void;
    const hydration = new Promise<string | null>((resolve) => {
      resolveHydration = resolve;
    });
    const { controller, socket } = createController({
      getTurnOriginId: () => turnOriginId,
      resolveTurnOriginId: () => hydration,
    });

    controller.sendUserText('hello');
    controller.sendUserText('hello');
    expect(socket.send).not.toHaveBeenCalled();

    turnOriginId = 'process-origin-1';
    resolveHydration(turnOriginId);
    await hydration;
    await Promise.resolve();

    expect(socket.send).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(vi.mocked(socket.send).mock.calls[0]?.[0] as string) as {
      turnOriginId?: string;
    };
    expect(payload.turnOriginId).toBe('process-origin-1');
  });

  it('keeps a cold-start submission local when the session changes during hydration', async () => {
    let sessionId = 'session-1';
    let resolveHydration!: (value: string | null) => void;
    const hydration = new Promise<string | null>((resolve) => {
      resolveHydration = resolve;
    });
    const { controller, socket, inputEl } = createController({
      getSessionId: () => sessionId,
      getTurnOriginId: () => null,
      resolveTurnOriginId: () => hydration,
    });
    inputEl.value = 'hello';

    controller.sendUserText(inputEl.value);
    sessionId = 'session-2';
    inputEl.value = 'new draft';
    resolveHydration(null);
    await hydration;
    await Promise.resolve();

    expect(socket.send).not.toHaveBeenCalled();
    expect(inputEl.value).toBe('new draft');
  });

  it('sends without an origin when native hydration completes without one', async () => {
    const { controller, socket } = createController({
      getTurnOriginId: () => null,
      resolveTurnOriginId: async () => null,
    });

    controller.sendUserText('hello');
    await Promise.resolve();
    await Promise.resolve();

    expect(socket.send).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(vi.mocked(socket.send).mock.calls[0]?.[0] as string) as {
      turnOriginId?: string;
    };
    expect(payload).not.toHaveProperty('turnOriginId');
  });
});
