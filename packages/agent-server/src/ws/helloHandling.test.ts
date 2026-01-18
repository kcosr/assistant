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
  it('supports v1 hello with protocolVersion 1', async () => {
    const sessionsFile = createTempFile('hello-handling-v1-sessions');

    const sessionIndex = new SessionIndex(sessionsFile);
    const agentRegistry = new AgentRegistry([]);
    const sessionHub = new SessionHub({
      sessionIndex,
      agentRegistry,
      eventStore: createTestEventStore(),
    });

    const summary = await sessionIndex.createSession({ agentId: 'general' });

    const connection: SessionConnection = {
      sendServerMessageFromHub: () => {},
      sendErrorFromHub: () => {},
    };

    const setSessionState = vi.fn();
    const setSessionId = vi.fn();
    const configureChatCompletionsSession = vi.fn();
    const sendMessage = vi.fn();
    const sendError = vi.fn();
    const close = vi.fn();

    const message: ClientHelloMessage = {
      type: 'hello',
      protocolVersion: 1,
      sessionId: summary.sessionId,
    };

    await handleHello({
      message,
      clientHelloReceived: false,
      setClientHelloReceived: () => {},
      setClientAudioCapabilities: () => {},
      connection,
      sessionHub,
      setSessionState,
      setSessionId,
      configureChatCompletionsSession,
      sendMessage,
      sendError,
      close,
    });

    expect(sendError).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
    expect(setSessionId).toHaveBeenCalledWith(summary.sessionId);
    expect(configureChatCompletionsSession).toHaveBeenCalledTimes(1);

    const subs = Array.from(sessionHub.getConnectionSubscriptions(connection));
    expect(subs).toContain(summary.sessionId);
  });

  it('subscribes to all sessions and sets a primary session for v2 hello', async () => {
    const sessionsFile = createTempFile('hello-handling-v2-sessions');

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

    const setSessionState = vi.fn();
    const setSessionId = vi.fn();
    const configureChatCompletionsSession = vi.fn();
    const sentMessages: ServerMessage[] = [];
    const sendMessage = (msg: ServerMessage): void => {
      sentMessages.push(msg);
    };
    const sendError = vi.fn();
    const close = vi.fn();

    const message: ClientHelloMessage = {
      type: 'hello',
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      subscriptions: [sessionA.sessionId, sessionB.sessionId],
    };

    await handleHello({
      message,
      clientHelloReceived: false,
      setClientHelloReceived: () => {},
      setClientAudioCapabilities: () => {},
      connection,
      sessionHub,
      setSessionState,
      setSessionId,
      configureChatCompletionsSession,
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
    const subscribedSessionIds = subscribedMessages.map(
      (m) => (m as { sessionId?: string }).sessionId,
    );
    expect(subscribedSessionIds).toEqual(
      expect.arrayContaining([sessionA.sessionId, sessionB.sessionId]),
    );

    const activeState = setSessionState.mock.calls[0]?.[0] as {
      summary?: { sessionId?: string };
    };
    expect(activeState?.summary?.sessionId).toBe(sessionA.sessionId);
    expect(setSessionId).toHaveBeenCalledWith(sessionA.sessionId);
    expect(configureChatCompletionsSession).toHaveBeenCalledTimes(1);
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
      // Use a protocol version that is neither 1 nor CURRENT_PROTOCOL_VERSION
      protocolVersion: CURRENT_PROTOCOL_VERSION + 10,
      sessionId: 'test-session',
    };

    await handleHello({
      message,
      clientHelloReceived: false,
      setClientHelloReceived: () => {},
      setClientAudioCapabilities: () => {},
      connection,
      sessionHub,
      setSessionState: () => {},
      setSessionId: () => {},
      configureChatCompletionsSession: () => {},
      sendMessage: () => {},
      sendError,
      close,
    });

    expect(sendError).toHaveBeenCalledTimes(1);
    const [code] = sendError.mock.calls[0] ?? [];
    expect(code).toBe('unsupported_protocol_version');
    expect(close).toHaveBeenCalledTimes(1);
  });
});
