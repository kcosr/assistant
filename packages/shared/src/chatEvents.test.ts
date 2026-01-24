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
      },
    };

    const result = safeValidateChatEvent(raw);
    expect(result.success).toBe(true);
    if (result.success && result.data.type === 'assistant_done') {
      expect(result.data.payload.text).toBe('Done.');
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
});
