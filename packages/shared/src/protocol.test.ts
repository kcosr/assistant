import { describe, expect, it } from 'vitest';
import {
  CURRENT_PROTOCOL_VERSION,
  PanelDisplayModeSchema,
  safeValidateClientMessage,
  safeValidateServerMessage,
  validateClientMessage,
  validateServerMessage,
  type ClientMessage,
  type ServerMessage,
} from './protocol';

describe('client message validation', () => {
  it('accepts a valid hello message', () => {
    const message: ClientMessage = {
      type: 'hello',
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      sessionId: 'session-1',
    };
    const parsed = validateClientMessage(message);
    expect(parsed).toEqual(message);
  });

  it('rejects an invalid text_input message', () => {
    const invalid = {
      type: 'text_input',
    };
    expect(() => validateClientMessage(invalid)).toThrow();
  });

  it('safe validation returns success result for valid message', () => {
    const raw = {
      type: 'hello',
      sessionId: 'session-2',
    };
    const result = safeValidateClientMessage(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        type: 'hello',
        sessionId: 'session-2',
        protocolVersion: CURRENT_PROTOCOL_VERSION,
      });
    }
  });

  it('safe validation returns failure result for invalid message', () => {
    const invalid = {
      type: 'text_input',
    };
    const result = safeValidateClientMessage(invalid);
    expect(result.success).toBe(false);
  });

  it('accepts a panel_event message', () => {
    const message: ClientMessage = {
      type: 'panel_event',
      panelId: 'panel-1',
      panelType: 'diff',
      payload: { kind: 'ping' },
    };

    const parsed = validateClientMessage(message);
    expect(parsed).toEqual(message);
  });

  it('accepts a set_session_thinking message', () => {
    const message: ClientMessage = {
      type: 'set_session_thinking',
      sessionId: 'session-1',
      thinking: 'medium',
    };

    const parsed = validateClientMessage(message);
    expect(parsed).toEqual(message);
  });
});

describe('server message validation', () => {
  it('accepts a valid session_ready message', () => {
    const message: ServerMessage = {
      type: 'session_ready',
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      sessionId: 'session-1',
      inputMode: 'speech',
      outputMode: 'text',
    };
    const parsed = validateServerMessage(message);
    expect(parsed).toEqual(message);
  });

  it('rejects an error message without required fields', () => {
    const invalid = {
      type: 'error',
    };
    expect(() => validateServerMessage(invalid)).toThrow();
  });

  it('safe validation returns success result for valid server message', () => {
    const raw = {
      type: 'session_ready',
      sessionId: 'session-2',
      inputMode: 'text',
      outputMode: 'speech',
    };
    const result = safeValidateServerMessage(raw);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        type: 'session_ready',
        sessionId: 'session-2',
        inputMode: 'text',
        outputMode: 'speech',
        protocolVersion: CURRENT_PROTOCOL_VERSION,
      });
    }
  });

  it('safe validation returns failure result for invalid server message', () => {
    const invalid = {
      type: 'error',
    };
    const result = safeValidateServerMessage(invalid);
    expect(result.success).toBe(false);
  });

  it('accepts an error message with retryable flag', () => {
    const message: ServerMessage = {
      type: 'error',
      code: 'rate_limit',
      message: 'Too many requests',
      retryable: true,
    };

    const parsed = validateServerMessage(message);
    expect(parsed).toEqual(message);
  });

  it('accepts an open_url message', () => {
    const message: ServerMessage = {
      type: 'open_url',
      url: 'https://example.com',
      sessionId: 'session-5',
    };

    const parsed = validateServerMessage(message);
    expect(parsed).toEqual(message);
  });

  it('accepts a session_updated message with attributes', () => {
    const message: ServerMessage = {
      type: 'session_updated',
      sessionId: 'session-1',
      updatedAt: '2024-01-01T00:00:00.000Z',
      attributes: {
        core: { workingDir: '/tmp/session-1' },
      },
    };

    const parsed = validateServerMessage(message);
    expect(parsed).toEqual(message);
  });

  it('accepts a panel_event message', () => {
    const message: ServerMessage = {
      type: 'panel_event',
      panelId: 'panel-2',
      panelType: 'terminal',
      sessionId: 'session-9',
      payload: { kind: 'status', value: 'ready' },
    };

    const parsed = validateServerMessage(message);
    expect(parsed).toEqual(message);
  });

  it('accepts a user_message broadcast', () => {
    const message: ServerMessage = {
      type: 'user_message',
      sessionId: 'session-4',
      text: 'hello',
    };
    expect(validateServerMessage(message)).toEqual(message);
  });
});

describe('panel display mode validation', () => {
  it('accepts legacy artifact display mode and normalizes it', () => {
    expect(PanelDisplayModeSchema.parse('artifact')).toBe('item');
  });
});
