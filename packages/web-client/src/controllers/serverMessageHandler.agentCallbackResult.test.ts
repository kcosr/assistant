// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

vi.mock('dompurify', () => {
  const addHook = vi.fn();
  const sanitize = (html: string) => html;
  return {
    default: { addHook, sanitize },
  };
});

import { ServerMessageHandler, type ServerMessageHandlerOptions } from './serverMessageHandler';
import type { SpeechAudioController } from './speechAudioController';
import type { ChatRuntime } from '../panels/chat/runtime';
import { CURRENT_PROTOCOL_VERSION } from '@assistant/shared/protocol';

function makeHandler(overrides: Partial<ServerMessageHandlerOptions> = {}) {
  const typingIndicators = new Set<string>();
  const refreshSessions = vi.fn(async () => {});
  const loadSessionTranscript = vi.fn(async () => {});
  const bufferTranscriptEvent = vi.fn();
  const resetSessionTranscriptState = vi.fn();

  const options: ServerMessageHandlerOptions = {
    statusEl: document.createElement('div'),
    sessionsWithPendingMessages: new Set<string>(),
    getSelectedSessionId: () => 's-1',
    setSelectedSessionId: () => {},
    getChatRuntimeForSession: () => null,
    isChatPanelVisible: () => true,
    getSessionSummaries: () => [],
    getSpeechAudioControllerForSession: () => null as SpeechAudioController | null,
    getAudioMode: () => 'off',
    getAgentDisplayName: () => 'Agent',
    sendModesUpdate: () => {},
    supportsAudioOutput: () => false,
    refreshSessions,
    loadSessionTranscript,
    resetSessionTranscriptState,
    shouldBufferTranscriptEvent: () => false,
    bufferTranscriptEvent,
    renderAgentSidebar: () => {},
    appendMessage: () => document.createElement('div'),
    scrollMessageIntoView: () => {},
    showSessionTypingIndicator: (sessionId: string) => {
      typingIndicators.add(sessionId.trim());
    },
    hideSessionTypingIndicator: (sessionId: string) => {
      typingIndicators.delete(sessionId.trim());
    },
    setStatus: () => {},
    setTtsStatus: () => {},
    focusInputForSession: () => {},
    isMobileViewport: () => false,
    isSidebarFocused: () => false,
    getAutoFocusChatOnSessionReady: () => false,
    getExpandToolOutput: () => false,
    showBackgroundSessionActivityIndicator: () => {},
    scheduleBackgroundSessionActivityIndicatorHide: () => {},
    updateSessionModelForSession: () => {},
    cancelQueuedMessage: () => {},
    editQueuedMessage: () => {},
    getPendingMessageListControllerForSession: () => null,
    ...overrides,
  };

  const handler = new ServerMessageHandler(options);

  return {
    handler,
    typingIndicators,
    refreshSessions,
    loadSessionTranscript,
    bufferTranscriptEvent,
    resetSessionTranscriptState,
  };
}

describe('ServerMessageHandler typing indicator', () => {
  it('resets active turn state on reconnect cleanup', async () => {
    const { handler, typingIndicators } = makeHandler();

    await handler.handle({
      type: 'transcript_event',
      event: {
        sessionId: 's-1',
        revision: 1,
        sequence: 0,
        requestId: 't-1',
        eventId: 'e-turn-start',
        kind: 'request_start',
        chatEventType: 'turn_start',
        timestamp: new Date().toISOString(),
        payload: { trigger: 'user' },
      },
    });

    handler.resetRealtimeState();

    await handler.handle({
      type: 'transcript_event',
      event: {
        sessionId: 's-1',
        revision: 1,
        sequence: 1,
        requestId: 't-1',
        eventId: 'e-turn-end',
        kind: 'request_end',
        chatEventType: 'turn_end',
        timestamp: new Date().toISOString(),
        payload: {},
      },
    });

    expect(typingIndicators.has('s-1')).toBe(false);
  });

  it('keeps chat typing indicator in sync with request activity', async () => {
    const runtime = {
      chatRenderer: {
        clear: vi.fn(),
        hideTypingIndicator: vi.fn(),
        showTypingIndicator: vi.fn(),
        handleNewProjectedEvent: vi.fn(() => 'applied'),
      },
      chatScrollManager: {
        scrollToBottom: vi.fn(),
        autoScrollIfEnabled: vi.fn(),
      },
      elements: {
        chatPanel: null,
        chatLog: document.createElement('div'),
        scrollToBottomButtonEl: document.createElement('button'),
        toggleToolOutputButton: null,
        toggleToolExpandButton: null,
        toggleThinkingButton: null,
      },
      dispose: vi.fn(),
    } as unknown as ChatRuntime;
    const setChatPanelStatusForSession = vi.fn();
    const { handler, typingIndicators } = makeHandler({
      getChatRuntimeForSession: () => runtime,
      setChatPanelStatusForSession,
    });

    await handler.handle({
      type: 'transcript_event',
      event: {
        sessionId: 's-1',
        revision: 1,
        sequence: 0,
        requestId: 'turn-1',
        eventId: 'req-start',
        kind: 'request_start',
        chatEventType: 'turn_start',
        timestamp: '2026-04-03T00:00:00.000Z',
        payload: { trigger: 'user' },
      },
    });

    expect(typingIndicators.has('s-1')).toBe(true);
    expect(setChatPanelStatusForSession).toHaveBeenCalledWith('s-1', 'busy');
    expect(runtime.chatRenderer.showTypingIndicator).toHaveBeenCalledTimes(1);

    await handler.handle({
      type: 'transcript_event',
      event: {
        sessionId: 's-1',
        revision: 1,
        sequence: 1,
        requestId: 'turn-1',
        eventId: 'req-end',
        kind: 'request_end',
        chatEventType: 'turn_end',
        timestamp: '2026-04-03T00:00:05.000Z',
        payload: {},
      },
    });

    expect(typingIndicators.has('s-1')).toBe(false);
    expect(setChatPanelStatusForSession).toHaveBeenCalledWith('s-1', 'idle');
    expect(runtime.chatRenderer.hideTypingIndicator).toHaveBeenCalledTimes(1);
  });

  it('forces transcript reload when session history changes', async () => {
    const { handler, refreshSessions, loadSessionTranscript } = makeHandler();

    await handler.handle({
      type: 'session_history_changed',
      sessionId: 's-1',
      updatedAt: '2026-03-29T15:45:00.000Z',
    });

    expect(loadSessionTranscript).toHaveBeenCalledWith('s-1', { force: true });
    expect(refreshSessions).toHaveBeenCalledWith('s-1');
  });

  it('clears active request state before reloading after session history changes', async () => {
    const runtime = {
      chatRenderer: {
        clear: vi.fn(),
        hideTypingIndicator: vi.fn(),
        showTypingIndicator: vi.fn(),
        handleNewProjectedEvent: vi.fn(),
      },
      chatScrollManager: {
        scrollToBottom: vi.fn(),
        autoScrollIfEnabled: vi.fn(),
      },
      elements: {
        chatPanel: null,
        chatLog: document.createElement('div'),
        scrollToBottomButtonEl: document.createElement('button'),
        toggleToolOutputButton: null,
        toggleToolExpandButton: null,
        toggleThinkingButton: null,
      },
      dispose: vi.fn(),
    } as unknown as ChatRuntime;
    const setChatPanelStatusForSession = vi.fn();
    const {
      handler,
      typingIndicators,
      loadSessionTranscript,
      resetSessionTranscriptState,
    } = makeHandler({
      getChatRuntimeForSession: () => runtime,
      setChatPanelStatusForSession,
    });

    await handler.handle({
      type: 'transcript_event',
      event: {
        sessionId: 's-1',
        revision: 1,
        sequence: 0,
        requestId: 'turn-1',
        eventId: 'req-start',
        kind: 'request_start',
        chatEventType: 'turn_start',
        timestamp: '2026-04-03T00:00:00.000Z',
        payload: { trigger: 'user' },
      },
    });

    expect(typingIndicators.has('s-1')).toBe(true);

    await handler.handle({
      type: 'session_history_changed',
      sessionId: 's-1',
      updatedAt: '2026-04-03T00:01:00.000Z',
    });

    expect(typingIndicators.has('s-1')).toBe(false);
    expect(resetSessionTranscriptState).toHaveBeenCalledWith('s-1');
    expect(runtime.chatRenderer.hideTypingIndicator).toHaveBeenCalledTimes(1);
    expect(runtime.chatRenderer.clear).toHaveBeenCalledTimes(1);
    expect(setChatPanelStatusForSession).toHaveBeenCalledWith('s-1', 'idle');
    expect(loadSessionTranscript).toHaveBeenCalledWith('s-1', { force: true });
  });

  it('forces transcript reload when a session becomes ready', async () => {
    const { handler, refreshSessions, loadSessionTranscript } = makeHandler();

    await handler.handle({
      type: 'session_ready',
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      sessionId: 's-1',
      inputMode: 'text',
      outputMode: 'text',
    });

    expect(refreshSessions).toHaveBeenCalledWith('s-1');
    expect(loadSessionTranscript).toHaveBeenCalledWith('s-1', { force: true });
  });

  it('clears cached transcript state when a session is cleared', async () => {
    const resetScrollState = vi.fn();
    const updateScrollButtonVisibility = vi.fn();
    const syncMicButtonState = vi.fn();
    const runtime = {
      chatRenderer: {
        clear: vi.fn(),
      },
      chatScrollManager: {
        resetScrollState,
        updateScrollButtonVisibility,
      },
      elements: {
        chatLog: document.createElement('div'),
      },
    } as unknown as ChatRuntime;
    const {
      handler,
      refreshSessions,
      resetSessionTranscriptState,
    } = makeHandler({
      getChatRuntimeForSession: () => runtime,
      getSpeechAudioControllerForSession: () =>
        ({ syncMicButtonState } as unknown as SpeechAudioController),
    });

    await handler.handle({
      type: 'session_cleared',
      sessionId: 's-1',
    });

    expect(resetSessionTranscriptState).toHaveBeenCalledWith('s-1');
    expect(runtime.chatRenderer.clear).toHaveBeenCalledTimes(1);
    expect(resetScrollState).toHaveBeenCalledTimes(1);
    expect(updateScrollButtonVisibility).toHaveBeenCalledTimes(1);
    expect(syncMicButtonState).toHaveBeenCalledTimes(1);
    expect(refreshSessions).toHaveBeenCalledWith('s-1');
  });

  it('clears cached transcript state when a session is deleted', async () => {
    let selectedSessionId: string | null = 's-1';
    const {
      handler,
      refreshSessions,
      resetSessionTranscriptState,
    } = makeHandler({
      getSelectedSessionId: () => selectedSessionId,
      setSelectedSessionId: (sessionId) => {
        selectedSessionId = sessionId;
      },
    });

    await handler.handle({
      type: 'session_deleted',
      sessionId: 's-1',
    });

    expect(resetSessionTranscriptState).toHaveBeenCalledWith('s-1');
    expect(selectedSessionId).toBeNull();
    expect(refreshSessions).toHaveBeenCalledWith(null);
  });

  it('scrolls visible chat panels to bottom on turn_start', async () => {
    const scrollToBottom = vi.fn();
    const autoScrollIfEnabled = vi.fn();
    const handleNewProjectedEvent = vi.fn();
    const runtime = {
      chatRenderer: {
        handleNewProjectedEvent,
        hideTypingIndicator: vi.fn(),
        showTypingIndicator: vi.fn(),
      },
      chatScrollManager: {
        scrollToBottom,
        autoScrollIfEnabled,
      },
      elements: {
        chatPanel: null,
        chatLog: document.createElement('div'),
        scrollToBottomButtonEl: document.createElement('button'),
        toggleToolOutputButton: null,
        toggleToolExpandButton: null,
        toggleThinkingButton: null,
      },
      dispose: vi.fn(),
    } as unknown as ChatRuntime;

    const { handler } = makeHandler({
      getChatRuntimeForSession: () => runtime,
      isChatPanelVisible: () => true,
    });

    await handler.handle({
      type: 'transcript_event',
      event: {
        sessionId: 's-1',
        revision: 1,
        sequence: 0,
        requestId: 'turn-1',
        eventId: 'turn-1',
        kind: 'request_start',
        chatEventType: 'turn_start',
        timestamp: '2026-04-02T00:00:00.000Z',
        payload: { trigger: 'user' },
      },
    });

    expect(handleNewProjectedEvent).toHaveBeenCalledTimes(1);
    expect(scrollToBottom).toHaveBeenCalledTimes(1);
    expect(autoScrollIfEnabled).not.toHaveBeenCalled();
  });

  it('buffers transcript events while transcript hydration is in progress', async () => {
    const handleNewProjectedEvent = vi.fn();
    const runtime = {
      chatRenderer: {
        handleNewProjectedEvent,
        hideTypingIndicator: vi.fn(),
        showTypingIndicator: vi.fn(),
      },
      chatScrollManager: {
        scrollToBottom: vi.fn(),
        autoScrollIfEnabled: vi.fn(),
      },
      elements: {
        chatPanel: null,
        chatLog: document.createElement('div'),
        scrollToBottomButtonEl: document.createElement('button'),
        toggleToolOutputButton: null,
        toggleToolExpandButton: null,
        toggleThinkingButton: null,
      },
      dispose: vi.fn(),
    } as unknown as ChatRuntime;

    const { handler, bufferTranscriptEvent } = makeHandler({
      getChatRuntimeForSession: () => runtime,
      isChatPanelVisible: () => true,
      shouldBufferTranscriptEvent: () => true,
    });

    const event = {
      sessionId: 's-1',
      revision: 1,
      sequence: 0,
      requestId: 't-1',
      eventId: 'user-1',
      kind: 'user_message',
      chatEventType: 'user_message',
      timestamp: '2026-04-02T00:00:00.000Z',
      payload: { text: 'hello' },
    } as const;

    await handler.handle({
      type: 'transcript_event',
      event,
    });

    expect(bufferTranscriptEvent).toHaveBeenCalledWith('s-1', event);
    expect(handleNewProjectedEvent).not.toHaveBeenCalled();
  });

  it('buffers transcript events when the chat runtime is not ready yet', async () => {
    const bufferTranscriptEvent = vi.fn();
    const { handler } = makeHandler({
      getChatRuntimeForSession: () => null,
      isChatPanelVisible: () => true,
      shouldBufferTranscriptEvent: () => false,
      bufferTranscriptEvent,
    });

    await handler.handle({
      type: 'transcript_event',
      event: {
        sessionId: 's-1',
        revision: 101,
        sequence: 0,
        requestId: 'turn-1',
        eventId: 'transcript-1',
        kind: 'request_start',
        chatEventType: 'turn_start',
        timestamp: '2026-04-01T00:00:00.000Z',
        payload: { trigger: 'user' },
      },
    });

    expect(bufferTranscriptEvent).toHaveBeenCalledWith(
      's-1',
      expect.objectContaining({
        sessionId: 's-1',
        requestId: 'turn-1',
        eventId: 'transcript-1',
      }),
    );
  });

  it('forces a transcript reload when the renderer detects a live sequence gap', async () => {
    const handleNewProjectedEvent = vi.fn(() => 'reload');
    const loadSessionTranscript = vi.fn(async () => {});
    const bufferTranscriptEvent = vi.fn();
    const runtime = {
      chatRenderer: {
        handleNewProjectedEvent,
        hideTypingIndicator: vi.fn(),
        showTypingIndicator: vi.fn(),
      },
      chatScrollManager: {
        scrollToBottom: vi.fn(),
        autoScrollIfEnabled: vi.fn(),
      },
      elements: {
        chatPanel: null,
        chatLog: document.createElement('div'),
        scrollToBottomButtonEl: document.createElement('button'),
        toggleToolOutputButton: null,
        toggleToolExpandButton: null,
        toggleThinkingButton: null,
      },
      dispose: vi.fn(),
    } as unknown as ChatRuntime;

    const { handler } = makeHandler({
      getChatRuntimeForSession: () => runtime,
      isChatPanelVisible: () => true,
      loadSessionTranscript,
      bufferTranscriptEvent,
    });

    await handler.handle({
      type: 'transcript_event',
      event: {
        sessionId: 's-1',
        revision: 101,
        sequence: 3,
        requestId: 'turn-1',
        eventId: 'transcript-gap',
        kind: 'assistant_message',
        chatEventType: 'assistant_chunk',
        timestamp: '2026-04-01T00:00:00.000Z',
        payload: { text: 'chunk', phase: 'response' },
        responseId: 'response-1',
      },
    });

    expect(bufferTranscriptEvent).toHaveBeenCalledWith(
      's-1',
      expect.objectContaining({
        eventId: 'transcript-gap',
      }),
    );
    expect(loadSessionTranscript).toHaveBeenCalledWith('s-1', { force: true });
  });

  it('renders transcript events through the chat renderer path', async () => {
    const handleNewProjectedEvent = vi.fn();
    const scrollToBottom = vi.fn();
    const autoScrollIfEnabled = vi.fn();
    const runtime = {
      chatRenderer: {
        handleNewProjectedEvent,
        hideTypingIndicator: vi.fn(),
        showTypingIndicator: vi.fn(),
      },
      chatScrollManager: {
        scrollToBottom,
        autoScrollIfEnabled,
      },
      elements: {
        chatPanel: null,
        chatLog: document.createElement('div'),
        scrollToBottomButtonEl: document.createElement('button'),
        toggleToolOutputButton: null,
        toggleToolExpandButton: null,
        toggleThinkingButton: null,
      },
      dispose: vi.fn(),
    } as unknown as ChatRuntime;

    const { handler, typingIndicators } = makeHandler({
      getChatRuntimeForSession: () => runtime,
      isChatPanelVisible: () => true,
    });

    await handler.handle({
      type: 'transcript_event',
      event: {
        sessionId: 's-1',
        revision: 101,
        sequence: 0,
        requestId: 'turn-1',
        eventId: 'transcript-1',
        kind: 'request_start',
        chatEventType: 'turn_start',
        timestamp: '2026-04-01T00:00:00.000Z',
        payload: { trigger: 'user' },
      },
    });

    expect(handleNewProjectedEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 's-1',
        requestId: 'turn-1',
        eventId: 'transcript-1',
        kind: 'request_start',
      }),
    );
    expect(scrollToBottom).toHaveBeenCalledTimes(1);
    expect(autoScrollIfEnabled).not.toHaveBeenCalled();
    expect(typingIndicators.has('s-1')).toBe(true);
  });

  it('buffers transcript events while transcript hydration is in progress', async () => {
    const handleNewProjectedEvent = vi.fn();
    const runtime = {
      chatRenderer: {
        handleNewProjectedEvent,
        hideTypingIndicator: vi.fn(),
        showTypingIndicator: vi.fn(),
      },
      chatScrollManager: {
        scrollToBottom: vi.fn(),
        autoScrollIfEnabled: vi.fn(),
      },
      elements: {
        chatPanel: null,
        chatLog: document.createElement('div'),
        scrollToBottomButtonEl: document.createElement('button'),
        toggleToolOutputButton: null,
        toggleToolExpandButton: null,
        toggleThinkingButton: null,
      },
      dispose: vi.fn(),
    } as unknown as ChatRuntime;

    const bufferTranscriptEvent = vi.fn();
    const { handler } = makeHandler({
      getChatRuntimeForSession: () => runtime,
      isChatPanelVisible: () => true,
      shouldBufferTranscriptEvent: () => true,
      bufferTranscriptEvent,
    });

    await handler.handle({
      type: 'transcript_event',
      event: {
        sessionId: 's-1',
        revision: 101,
        sequence: 0,
        requestId: 'turn-1',
        eventId: 'transcript-1',
        kind: 'request_start',
        chatEventType: 'turn_start',
        timestamp: '2026-04-01T00:00:00.000Z',
        payload: { trigger: 'user' },
      },
    });

    expect(bufferTranscriptEvent).toHaveBeenCalledWith(
      's-1',
      expect.objectContaining({
        sessionId: 's-1',
        requestId: 'turn-1',
        eventId: 'transcript-1',
        kind: 'request_start',
      }),
    );
    expect(handleNewProjectedEvent).not.toHaveBeenCalled();
  });

  it('marks sessions busy on turn_start and idle on turn_end before assistant output arrives', async () => {
    const statuses: Array<{ sessionId: string; status: string }> = [];
    const { handler, typingIndicators } = makeHandler({
      setChatPanelStatusForSession: (sessionId, status) => {
        statuses.push({ sessionId, status });
      },
    });

    await handler.handle({
      type: 'transcript_event',
      event: {
        sessionId: 's-1',
        revision: 1,
        sequence: 0,
        requestId: 'turn-1',
        eventId: 'turn-start',
        kind: 'request_start',
        chatEventType: 'turn_start',
        timestamp: '2026-04-02T00:00:00.000Z',
        payload: { trigger: 'user' },
      },
    });

    expect(typingIndicators.has('s-1')).toBe(true);
    expect(statuses.at(-1)).toEqual({ sessionId: 's-1', status: 'busy' });

    await handler.handle({
      type: 'transcript_event',
      event: {
        sessionId: 's-1',
        revision: 1,
        sequence: 1,
        requestId: 'turn-1',
        eventId: 'turn-end',
        kind: 'request_end',
        chatEventType: 'turn_end',
        timestamp: '2026-04-02T00:00:01.000Z',
        payload: {},
      },
    });

    expect(typingIndicators.has('s-1')).toBe(false);
    expect(statuses.at(-1)).toEqual({ sessionId: 's-1', status: 'idle' });
  });
});
