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

function makeHandler() {
  const typingIndicators = new Set<string>();
  const refreshSessions = vi.fn(async () => {});
  const loadSessionTranscript = vi.fn(async () => {});

  const options: ServerMessageHandlerOptions = {
    statusEl: document.createElement('div'),
    sessionsWithPendingMessages: new Set<string>(),
    getSelectedSessionId: () => 's-1',
    setSelectedSessionId: () => {},
    getChatRuntimeForSession: () => null,
    isChatPanelVisible: () => true,
    getSessionSummaries: () => [],
    getSpeechAudioControllerForSession: () => null as SpeechAudioController | null,
    getAudioEnabled: () => false,
    getAgentDisplayName: () => 'Agent',
    sendModesUpdate: () => {},
    supportsAudioOutput: () => false,
    enableAudioResponses: () => {},
    refreshSessions,
    loadSessionTranscript,
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
  };

  const handler = new ServerMessageHandler(options);

  return { handler, typingIndicators, refreshSessions, loadSessionTranscript };
}

describe('ServerMessageHandler agent_callback_result typing indicator', () => {
  it('clears typing indicator after agent_callback_result for selected session', async () => {
    const { handler, typingIndicators } = makeHandler();

    // Simulate typing shown earlier in the session
    typingIndicators.add('s-1');

    await handler.handle({
      type: 'agent_callback_result',
      sessionId: 's-1',
      responseId: 'resp-1',
      result: 'callback text',
    });

    expect(typingIndicators.size).toBe(0);
  });

  it('resets pending interaction state on reconnect cleanup', async () => {
    const { handler, typingIndicators } = makeHandler();

    await handler.handle({
      type: 'chat_event',
      sessionId: 's-1',
      event: {
        id: 'e-pending',
        type: 'interaction_pending',
        timestamp: Date.now(),
        sessionId: 's-1',
        turnId: 't-1',
        responseId: 'r-1',
        payload: {
          toolCallId: 'tool-1',
          pending: true,
          toolName: 'agents_message',
          presentation: 'tool',
        },
      },
    });

    handler.resetRealtimeState();

    await handler.handle({
      type: 'chat_event',
      sessionId: 's-1',
      event: {
        id: 'e-chunk',
        type: 'assistant_chunk',
        timestamp: Date.now(),
        sessionId: 's-1',
        turnId: 't-1',
        responseId: 'r-1',
        payload: {
          text: 'Done.',
        },
      },
    });

    expect(typingIndicators.has('s-1')).toBe(true);
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
});
