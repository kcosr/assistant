import { describe, expect, it } from 'vitest';

import { AgentRegistry } from './agents';
import type { ConversationLogRecord } from './conversationStore';
import { buildChatMessagesFromTranscript } from './sessionChatMessages';

describe('buildChatMessagesFromTranscript', () => {
  it('converts agent_message records to user role messages', () => {
    const registry = new AgentRegistry([]);
    const records: ConversationLogRecord[] = [
      {
        type: 'agent_message',
        timestamp: new Date().toISOString(),
        sessionId: 'session-1',
        fromSessionId: 'source-session',
        fromAgentId: 'source-agent',
        text: 'Hello from another agent',
      },
    ];

    const messages = buildChatMessagesFromTranscript(records, registry, undefined, []);

    expect(messages.length).toBe(2);
    expect(messages[0]?.role).toBe('system');
    expect(messages[1]?.role).toBe('user');
    expect(messages[1]?.content).toBe('Hello from another agent');
  });

  it('converts agent_callback records to user role messages', () => {
    const registry = new AgentRegistry([]);
    const records: ConversationLogRecord[] = [
      {
        type: 'agent_callback',
        timestamp: new Date().toISOString(),
        sessionId: 'session-caller',
        fromSessionId: 'session-target',
        fromAgentId: 'target-agent',
        responseId: 'resp-123',
        text: 'Callback from target agent',
      },
    ];

    const messages = buildChatMessagesFromTranscript(records, registry, undefined, []);

    expect(messages.length).toBe(2);
    expect(messages[0]?.role).toBe('system');
    expect(messages[1]?.role).toBe('user');
    expect(messages[1]?.content).toBe('Callback from target agent');
  });
});
