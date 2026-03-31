// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { TextInputController, type TextInputControllerOptions } from './textInputController';

function createController(overrides: Partial<TextInputControllerOptions> = {}) {
  const form = document.createElement('form');
  const inputEl = document.createElement('input');
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
});
