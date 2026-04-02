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
  const bufferChatEvent = vi.fn();

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
    shouldBufferChatEvent: () => false,
    bufferChatEvent,
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

  return { handler, typingIndicators, refreshSessions, loadSessionTranscript, bufferChatEvent };
}

describe('ServerMessageHandler typing indicator', () => {
  it('resets active turn state on reconnect cleanup', async () => {
    const { handler, typingIndicators } = makeHandler();

    await handler.handle({
      type: 'chat_event',
      sessionId: 's-1',
      event: {
        id: 'e-turn-start',
        type: 'turn_start',
        timestamp: Date.now(),
        sessionId: 's-1',
        turnId: 't-1',
        payload: {
          trigger: 'user',
        },
      },
    });

    handler.resetRealtimeState();

    await handler.handle({
      type: 'chat_event',
      sessionId: 's-1',
      event: {
        id: 'e-turn-end',
        type: 'turn_end',
        timestamp: Date.now(),
        sessionId: 's-1',
        turnId: 't-1',
        payload: {},
      },
    });

    expect(typingIndicators.has('s-1')).toBe(false);
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

  it('scrolls visible chat panels to bottom on turn_start', async () => {
    const scrollToBottom = vi.fn();
    const autoScrollIfEnabled = vi.fn();
    const handleNewEvent = vi.fn();
    const runtime = {
      chatRenderer: {
        handleNewEvent,
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
      type: 'chat_event',
      sessionId: 's-1',
      event: {
        id: 'turn-1',
        type: 'turn_start',
        timestamp: Date.now(),
        sessionId: 's-1',
        turnId: 'turn-1',
        payload: { trigger: 'user' },
      },
    });

    expect(handleNewEvent).toHaveBeenCalledTimes(1);
    expect(scrollToBottom).toHaveBeenCalledTimes(1);
    expect(autoScrollIfEnabled).not.toHaveBeenCalled();
  });

  it('buffers chat events while transcript hydration is in progress', async () => {
    const handleNewEvent = vi.fn();
    const runtime = {
      chatRenderer: {
        handleNewEvent,
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

    const { handler, bufferChatEvent } = makeHandler({
      getChatRuntimeForSession: () => runtime,
      isChatPanelVisible: () => true,
      shouldBufferChatEvent: () => true,
    });

    const event = {
      id: 'user-1',
      type: 'user_message',
      timestamp: Date.now(),
      sessionId: 's-1',
      turnId: 't-1',
      payload: { text: 'hello' },
    } as const;

    await handler.handle({
      type: 'chat_event',
      sessionId: 's-1',
      event,
    });

    expect(bufferChatEvent).toHaveBeenCalledWith('s-1', event);
    expect(handleNewEvent).not.toHaveBeenCalled();
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
      type: 'chat_event',
      sessionId: 's-1',
      event: {
        id: 'turn-start',
        type: 'turn_start',
        timestamp: Date.now(),
        sessionId: 's-1',
        turnId: 'turn-1',
        payload: { trigger: 'user' },
      },
    });

    expect(typingIndicators.has('s-1')).toBe(true);
    expect(statuses.at(-1)).toEqual({ sessionId: 's-1', status: 'busy' });

    await handler.handle({
      type: 'chat_event',
      sessionId: 's-1',
      event: {
        id: 'turn-end',
        type: 'turn_end',
        timestamp: Date.now(),
        sessionId: 's-1',
        turnId: 'turn-1',
        payload: {},
      },
    });

    expect(typingIndicators.has('s-1')).toBe(false);
    expect(statuses.at(-1)).toEqual({ sessionId: 's-1', status: 'idle' });
  });
});
