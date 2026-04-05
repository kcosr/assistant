// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  closeShareModal,
  handleIncomingSharedContent,
  initShareTarget,
  isShareModalVisible,
} from './shareTargetController';
import type { InputRuntime } from '../panels/input/runtime';

const originalFetch = global.fetch;

function setCapacitorPlatform(platform: string | null): void {
  if (platform) {
    Object.assign(window, {
      Capacitor: {
        getPlatform: () => platform,
      },
    });
    return;
  }
  delete (window as { Capacitor?: unknown }).Capacitor;
}

function createInputRuntime(): InputRuntime {
  const inputEl = document.createElement('textarea');
  document.body.appendChild(inputEl);
  return {
    inputEl,
    focusInput: vi.fn(),
    textInputController: {
      sendUserText: vi.fn(),
    },
  } as unknown as InputRuntime;
}

function clickShareOption(target: 'chat' | 'fetch-to-list'): void {
  const button = document.querySelector<HTMLButtonElement>(`[data-target="${target}"]`);
  if (!button) {
    throw new Error(`Missing share option: ${target}`);
  }
  button.click();
}

async function waitForCondition(condition: () => boolean, attempts = 20): Promise<void> {
  for (let index = 0; index < attempts; index += 1) {
    if (condition()) {
      return;
    }
    await Promise.resolve();
  }
  throw new Error('Condition not met');
}

describe('shareTargetController', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    setCapacitorPlatform(null);
  });

  afterEach(() => {
    closeShareModal();
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = '';
    setCapacitorPlatform(null);
    global.fetch = originalFetch;
  });

  it('keeps the share destination modal for Android share intents', async () => {
    setCapacitorPlatform('android');

    initShareTarget({
      getSelectedSessionId: () => null,
      getActiveChatSessionId: () => null,
      getPreferredShareSessionId: () => 'session-1',
      selectSession: vi.fn(),
      openSessionPicker: vi.fn(),
      getChatInputRuntimeForSession: () => null,
      openPanel: vi.fn(),
      isEnabled: () => false,
    });

    await handleIncomingSharedContent({ text: 'shared text' }, { preferSessionRouting: true });

    expect(isShareModalVisible()).toBe(true);
  });

  it('routes Android chat selection into the preferred session from the share modal', async () => {
    setCapacitorPlatform('android');
    const runtime = createInputRuntime();
    const selectSession = vi.fn();
    const openSessionPicker = vi.fn();

    initShareTarget({
      getSelectedSessionId: () => null,
      getActiveChatSessionId: () => null,
      getPreferredShareSessionId: () => 'session-1',
      selectSession,
      openSessionPicker,
      getChatInputRuntimeForSession: (sessionId) => (sessionId === 'session-1' ? runtime : null),
      openPanel: vi.fn(),
      isEnabled: () => false,
    });

    await handleIncomingSharedContent({ text: 'shared text' }, { preferSessionRouting: true });
    clickShareOption('chat');
    await Promise.resolve();

    expect(selectSession).toHaveBeenCalledWith('session-1');
    expect(openSessionPicker).not.toHaveBeenCalled();
    expect(runtime.inputEl.value).toBe('shared text');
    expect(runtime.focusInput).toHaveBeenCalled();
    expect(isShareModalVisible()).toBe(false);
  });

  it('opens the session picker from Android chat selection when no preferred session is set', async () => {
    setCapacitorPlatform('android');
    const openSessionPicker = vi.fn();

    initShareTarget({
      getSelectedSessionId: () => null,
      getActiveChatSessionId: () => null,
      getPreferredShareSessionId: () => null,
      selectSession: vi.fn(),
      openSessionPicker,
      getChatInputRuntimeForSession: () => null,
      openPanel: vi.fn(),
      isEnabled: () => false,
    });

    await handleIncomingSharedContent({ text: 'shared text' }, { preferSessionRouting: true });
    clickShareOption('chat');

    expect(openSessionPicker).toHaveBeenCalledTimes(1);
    const pickerOptions = openSessionPicker.mock.calls[0]?.[0];
    expect(pickerOptions?.title).toBe('Select share session');
    expect(pickerOptions?.anchor).toBeInstanceOf(HTMLElement);
    expect((pickerOptions?.anchor as HTMLElement | undefined)?.style.left).not.toBe('');
    expect((pickerOptions?.anchor as HTMLElement | undefined)?.style.top).toBe('24vh');
    expect(isShareModalVisible()).toBe(false);
  });

  it('waits briefly for the preferred session chat input to mount after Android chat selection', async () => {
    vi.useFakeTimers();
    setCapacitorPlatform('android');
    const runtime = createInputRuntime();
    const getChatInputRuntimeForSession = vi
      .fn<(sessionId: string) => InputRuntime | null>()
      .mockReturnValueOnce(null)
      .mockReturnValue(runtime);

    initShareTarget({
      getSelectedSessionId: () => null,
      getActiveChatSessionId: () => null,
      getPreferredShareSessionId: () => 'session-2',
      selectSession: vi.fn(),
      openSessionPicker: vi.fn(),
      getChatInputRuntimeForSession,
      openPanel: vi.fn(),
      isEnabled: () => false,
    });

    await handleIncomingSharedContent({ text: 'shared text' }, { preferSessionRouting: true });
    clickShareOption('chat');
    await vi.advanceTimersByTimeAsync(60);

    expect(getChatInputRuntimeForSession).toHaveBeenCalledWith('session-2');
    expect(runtime.inputEl.value).toBe('shared text');
  });

  it('routes Android fetch-to-list submissions through the preferred session', async () => {
    setCapacitorPlatform('android');
    const runtime = createInputRuntime();
    const selectSession = vi.fn();
    const openSessionPicker = vi.fn();

    initShareTarget({
      getSelectedSessionId: () => null,
      getActiveChatSessionId: () => null,
      getPreferredShareSessionId: () => 'session-3',
      selectSession,
      openSessionPicker,
      getChatInputRuntimeForSession: (sessionId) => (sessionId === 'session-3' ? runtime : null),
      openPanel: vi.fn(),
      isEnabled: () => false,
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        result: [{ id: 'list-1', name: 'Inbox' }],
      }),
    }) as unknown as typeof fetch;

    await handleIncomingSharedContent(
      { text: 'https://example.com' },
      { preferSessionRouting: true },
    );
    clickShareOption('fetch-to-list');
    await waitForCondition(() => {
      const dropdown = document.querySelector<HTMLSelectElement>('#share-list-dropdown');
      return Boolean(dropdown && dropdown.options.length > 0);
    });

    const confirmButton = document.querySelector<HTMLButtonElement>('.share-list-confirm');
    if (!confirmButton) {
      throw new Error('Missing fetch confirm button');
    }
    confirmButton.click();
    await Promise.resolve();

    expect(selectSession).toHaveBeenCalledWith('session-3');
    expect(runtime.textInputController.sendUserText).toHaveBeenCalledWith(
      'Fetch https://example.com and add it to the "Inbox" list with relevant context.',
    );
    expect(openSessionPicker).not.toHaveBeenCalled();
  });
});
