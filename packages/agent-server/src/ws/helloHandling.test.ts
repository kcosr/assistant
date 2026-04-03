import os from 'node:os';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { ClientHelloMessage, ServerMessage } from '@assistant/shared';
import { CURRENT_PROTOCOL_VERSION } from '@assistant/shared';

import { handleHello } from './helloHandling';
import type { SessionConnection } from './sessionConnection';
import { SessionIndex } from '../sessionIndex';
import { AgentRegistry } from '../agents';
import { SessionHub } from '../sessionHub';
import type { EventStore } from '../events';

function createTempFile(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16)}.jsonl`);
}

function createTestEventStore(): EventStore {
  return {
    append: async () => {},
    appendBatch: async () => {},
    getEvents: async () => [],
    getEventsSince: async () => [],
    subscribe: () => () => {},
    clearSession: async () => {},
    deleteSession: async () => {},
  };
}

describe('handleHello', () => {
  it('subscribes to all structured hello subscriptions and echoes masks', async () => {
    const sessionsFile = createTempFile('hello-handling-v3-sessions');

    const sessionIndex = new SessionIndex(sessionsFile);
    const agentRegistry = new AgentRegistry([]);
    const sessionHub = new SessionHub({
      sessionIndex,
      agentRegistry,
      eventStore: createTestEventStore(),
    });

    const sessionA = await sessionIndex.createSession({ agentId: 'general' });
    const sessionB = await sessionIndex.createSession({ agentId: 'general' });

    const connection: SessionConnection = {
      sendServerMessageFromHub: () => {},
      sendErrorFromHub: () => {},
    };

    const sentMessages: ServerMessage[] = [];
    const sendMessage = (msg: ServerMessage): void => {
      sentMessages.push(msg);
    };
    const sendError = vi.fn();
    const close = vi.fn();

    const message: ClientHelloMessage = {
      type: 'hello',
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      subscriptions: [
        {
          sessionId: sessionA.sessionId,
          mask: {
            serverMessageTypes: ['transcript_event'],
            chatEventTypes: ['tool_call'],
            toolNames: ['voice_speak', 'voice_ask'],
          },
        },
        { sessionId: sessionB.sessionId },
      ],
    };

    await handleHello({
      message,
      clientHelloReceived: false,
      setClientHelloReceived: () => {},
      setClientAudioCapabilities: () => {},
      connection,
      sessionHub,
      sendMessage,
      sendError,
      close,
    });

    expect(sendError).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();

    const subs = Array.from(sessionHub.getConnectionSubscriptions(connection));
    expect(subs).toEqual(expect.arrayContaining([sessionA.sessionId, sessionB.sessionId]));

    const subscribedMessages = sentMessages.filter((m) => m.type === 'subscribed');
    expect(subscribedMessages.length).toBe(2);
    const subscribedSessionIds = subscribedMessages.map((m) => m.sessionId);
    expect(subscribedSessionIds).toEqual(
      expect.arrayContaining([sessionA.sessionId, sessionB.sessionId]),
    );
    expect(subscribedMessages[0]).toMatchObject({
      type: 'subscribed',
      sessionId: sessionA.sessionId,
      mask: {
        serverMessageTypes: ['transcript_event'],
        chatEventTypes: ['tool_call'],
        toolNames: ['voice_speak', 'voice_ask'],
      },
    });
  });

  it('rejects unsupported protocol versions', async () => {
    const sessionsFile = createTempFile('hello-handling-unsupported-sessions');

    const sessionIndex = new SessionIndex(sessionsFile);
    const agentRegistry = new AgentRegistry([]);
    const sessionHub = new SessionHub({
      sessionIndex,
      agentRegistry,
      eventStore: createTestEventStore(),
    });

    const connection: SessionConnection = {
      sendServerMessageFromHub: () => {},
      sendErrorFromHub: () => {},
    };

    const sendError = vi.fn();
    const close = vi.fn();

    const message: ClientHelloMessage = {
      type: 'hello',
      protocolVersion: CURRENT_PROTOCOL_VERSION + 10,
      subscriptions: [],
    };

    await handleHello({
      message,
      clientHelloReceived: false,
      setClientHelloReceived: () => {},
      setClientAudioCapabilities: () => {},
      connection,
      sessionHub,
      sendMessage: () => {},
      sendError,
      close,
    });

    expect(sendError).toHaveBeenCalledTimes(1);
    const [code] = sendError.mock.calls[0] ?? [];
    expect(code).toBe('unsupported_protocol_version');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('accepts an empty v3 subscription list without sending errors', async () => {
    const sessionsFile = createTempFile('hello-handling-empty-v3-sessions');

    const sessionIndex = new SessionIndex(sessionsFile);
    const agentRegistry = new AgentRegistry([]);
    const sessionHub = new SessionHub({
      sessionIndex,
      agentRegistry,
      eventStore: createTestEventStore(),
    });

    const connection: SessionConnection = {
      sendServerMessageFromHub: () => {},
      sendErrorFromHub: () => {},
    };

    const sendMessage = vi.fn();
    const sendError = vi.fn();
    const close = vi.fn();

    const message: ClientHelloMessage = {
      type: 'hello',
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      subscriptions: [],
    };

    await handleHello({
      message,
      clientHelloReceived: false,
      setClientHelloReceived: () => {},
      setClientAudioCapabilities: () => {},
      connection,
      sessionHub,
      sendMessage,
      sendError,
      close,
    });

    expect(sendMessage).not.toHaveBeenCalled();
    expect(sendError).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(Array.from(sessionHub.getConnectionSubscriptions(connection))).toEqual([]);
  });
});
