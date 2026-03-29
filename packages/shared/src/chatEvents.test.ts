import { describe, expect, it } from 'vitest';
import { safeValidateChatEvent, validateChatEvent, type ChatEvent } from './chatEvents';

describe('chat event validation', () => {
  it('accepts a valid user_message event', () => {
    const event: ChatEvent = {
      id: 'event-1',
      timestamp: Date.now(),
      sessionId: 'session-1',
      type: 'user_message',
      payload: {
        text: 'hello',
      },
    };

    const parsed = validateChatEvent(event);
    expect(parsed).toEqual(event);
  });

  it('accepts user_message events with agent metadata', () => {
    const event: ChatEvent = {
      id: 'event-1b',
      timestamp: Date.now(),
      sessionId: 'session-1',
      type: 'user_message',
      payload: {
        text: 'hello',
        fromAgentId: 'helper',
        fromSessionId: 'session-helper',
      },
    };

    const parsed = validateChatEvent(event);
    expect(parsed).toEqual(event);
  });

  it('rejects an event with mismatched payload', () => {
    const invalid = {
      id: 'event-2',
      timestamp: Date.now(),
      sessionId: 'session-1',
      type: 'tool_call',
      payload: {
        text: 'not a tool_call payload',
      },
    };

    expect(() => validateChatEvent(invalid)).toThrow();
  });

  it('safe validation returns failure result for invalid event', () => {
    const invalid = {
      id: 'event-3',
      timestamp: Date.now(),
      sessionId: 'session-1',
      type: 'assistant_chunk',
      // missing payload
    };

    const result = safeValidateChatEvent(invalid);
    expect(result.success).toBe(false);
  });

  it('accepts an assistant_done event with text', () => {
    const raw = {
      id: 'event-4',
      timestamp: Date.now(),
      sessionId: 'session-1',
      type: 'assistant_done',
      payload: {
        text: 'Done.',
        phase: 'final_answer',
        textSignature: '{"v":1,"id":"msg-1","phase":"final_answer"}',
        interrupted: true,
      },
    };

    const result = safeValidateChatEvent(raw);
    expect(result.success).toBe(true);
    if (result.success && result.data.type === 'assistant_done') {
      expect(result.data.payload.text).toBe('Done.');
      expect(result.data.payload.phase).toBe('final_answer');
      expect(result.data.payload.interrupted).toBe(true);
    }
  });

  it('accepts interaction_request and interaction_response events', () => {
    const request: ChatEvent = {
      id: 'event-5',
      timestamp: Date.now(),
      sessionId: 'session-1',
      type: 'interaction_request',
      payload: {
        toolCallId: 'tool-1',
        toolName: 'ask_user',
        interactionId: 'interaction-1',
        interactionType: 'input',
        presentation: 'questionnaire',
        inputSchema: {
          title: 'Quick question',
          fields: [{ id: 'answer', type: 'text', label: 'Answer', required: true }],
        },
      },
    };

    const response: ChatEvent = {
      id: 'event-6',
      timestamp: Date.now(),
      sessionId: 'session-1',
      type: 'interaction_response',
      payload: {
        toolCallId: 'tool-1',
        interactionId: 'interaction-1',
        action: 'submit',
        input: { answer: 'hello' },
      },
    };

    expect(validateChatEvent(request)).toEqual(request);
    expect(validateChatEvent(response)).toEqual(response);
  });

  it('accepts questionnaire lifecycle events', () => {
    const request: ChatEvent = {
      id: 'event-7',
      timestamp: Date.now(),
      sessionId: 'session-1',
      type: 'questionnaire_request',
      payload: {
        questionnaireRequestId: 'qr-1',
        toolCallId: 'tool-1',
        toolName: 'questions_ask',
        mode: 'async',
        prompt: 'Tell me more',
        schema: {
          title: 'Profile',
          fields: [{ id: 'name', type: 'text', label: 'Name', required: true }],
        },
        status: 'pending',
        createdAt: '2026-03-29T12:00:00.000Z',
      },
    };

    const submission: ChatEvent = {
      id: 'event-8',
      timestamp: Date.now(),
      sessionId: 'session-1',
      type: 'questionnaire_submission',
      payload: {
        questionnaireRequestId: 'qr-1',
        toolCallId: 'tool-1',
        status: 'submitted',
        submittedAt: '2026-03-29T12:01:00.000Z',
        interactionId: 'i-1',
        answers: { name: 'Ada' },
      },
    };

    expect(validateChatEvent(request)).toEqual(request);
    expect(validateChatEvent(submission)).toEqual(submission);
  });

  it('accepts questionnaire reprompt and update events', () => {
    const reprompt: ChatEvent = {
      id: 'event-9',
      timestamp: Date.now(),
      sessionId: 'session-1',
      type: 'questionnaire_reprompt',
      payload: {
        questionnaireRequestId: 'qr-1',
        toolCallId: 'tool-1',
        status: 'pending',
        updatedAt: '2026-03-29T12:02:00.000Z',
        errorSummary: 'Please correct the highlighted fields.',
        fieldErrors: { name: 'This field is required.' },
        initialValues: { name: '' },
      },
    };

    const update: ChatEvent = {
      id: 'event-10',
      timestamp: Date.now(),
      sessionId: 'session-1',
      type: 'questionnaire_update',
      payload: {
        questionnaireRequestId: 'qr-1',
        toolCallId: 'tool-1',
        status: 'cancelled',
        updatedAt: '2026-03-29T12:03:00.000Z',
        reason: 'User dismissed it',
      },
    };

    expect(validateChatEvent(reprompt)).toEqual(reprompt);
    expect(validateChatEvent(update)).toEqual(update);
  });
});
