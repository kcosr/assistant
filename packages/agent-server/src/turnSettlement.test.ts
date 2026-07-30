import { describe, expect, it, vi } from 'vitest';

import type { ChatEvent, ServerMessage } from '@assistant/shared';

import type { LogicalSessionState, SessionHub } from './sessionHub';
import { broadcastTurnSettledIfIdle, hasSpeakableAssistantOutput } from './turnSettlement';

function createState(overrides: Partial<LogicalSessionState> = {}): LogicalSessionState {
  return {
    summary: {
      sessionId: 'session-1',
      createdAt: '',
      updatedAt: '',
    },
    chatMessages: [],
    messageQueue: [],
    ...overrides,
  } as LogicalSessionState;
}

describe('turn settlement', () => {
  it('broadcasts a completed tool-only settlement after the run is released', () => {
    const broadcast: ServerMessage[] = [];
    const sessionHub = {
      broadcastToSession: (_sessionId: string, message: ServerMessage) => {
        broadcast.push(message);
      },
    } as SessionHub;

    expect(
      broadcastTurnSettledIfIdle({
        sessionId: 'session-1',
        state: createState(),
        sessionHub,
        candidate: {
          requestId: 'turn-1',
          responseId: 'response-1',
          status: 'completed',
          hasSpeakableOutput: false,
          turnOriginId: 'android-process-1',
        },
      }),
    ).toBe(true);
    expect(broadcast).toEqual([
      {
        type: 'turn_settled',
        sessionId: 'session-1',
        requestId: 'turn-1',
        responseId: 'response-1',
        status: 'completed',
        hasSpeakableOutput: false,
        turnOriginId: 'android-process-1',
      },
    ]);
  });

  it('does not settle while a run or queued continuation remains', () => {
    const broadcastToSession = vi.fn();
    const sessionHub = { broadcastToSession } as unknown as SessionHub;
    const candidate = {
      requestId: 'turn-1',
      responseId: 'response-1',
      status: 'completed' as const,
      hasSpeakableOutput: false,
    };

    expect(
      broadcastTurnSettledIfIdle({
        sessionId: 'session-1',
        state: createState({
          activeChatRun: {
            requestId: 'request-1',
            responseId: 'response-1',
            abortController: new AbortController(),
            accumulatedText: '',
          },
        }),
        sessionHub,
        candidate,
      }),
    ).toBe(false);
    expect(
      broadcastTurnSettledIfIdle({
        sessionId: 'session-1',
        state: createState({
          messageQueue: [
            {
              id: 'queued-1',
              text: 'next',
              queuedAt: '',
              source: 'user',
            },
          ],
        }),
        sessionHub,
        candidate,
      }),
    ).toBe(false);
    expect(broadcastToSession).not.toHaveBeenCalled();
  });

  it('recognizes only final-answer assistant output as speakable', () => {
    const event = (phase: 'commentary' | 'final_answer'): ChatEvent => ({
      id: phase,
      timestamp: 1,
      sessionId: 'session-1',
      type: 'assistant_done',
      payload: { text: 'text', phase },
    });

    expect(hasSpeakableAssistantOutput([event('commentary')])).toBe(false);
    expect(hasSpeakableAssistantOutput([event('final_answer')])).toBe(true);
  });
});
