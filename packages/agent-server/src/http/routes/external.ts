import type { ChatEvent, ServerTextDoneMessage } from '@assistant/shared';

import type { HttpRouteHandler } from '../types';
import { createExternalResponseId } from '../../externalAgents';
import { appendAndBroadcastChatEvents, createChatEventBase } from '../../events/chatEventUtils';

export const handleExternalRoutes: HttpRouteHandler = async (
  context,
  req,
  res,
  _url,
  segments,
  _helpers,
) => {
  if (
    req.method === 'POST' &&
    segments.length === 4 &&
    segments[0] === 'external' &&
    segments[1] === 'sessions' &&
    segments[3] === 'messages'
  ) {
    const sessionId = decodeURIComponent(segments[2] ?? '');
    if (!sessionId) {
      res.statusCode = 404;
      res.end('Not found');
      return true;
    }

    const summary = await context.sessionIndex.getSession(sessionId);
    if (!summary || summary.deleted) {
      res.statusCode = 404;
      res.end('Not found');
      return true;
    }

    let bodyText = '';
    try {
      bodyText = await new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
      });
    } catch {
      res.statusCode = 400;
      res.end('Bad request');
      return true;
    }

    const text = bodyText.trimEnd();
    if (!text.trim()) {
      res.statusCode = 400;
      res.end('Empty message');
      return true;
    }

    const responseId = createExternalResponseId();

    void context.sessionHub.recordSessionActivity(
      sessionId,
      text.length > 120 ? `${text.slice(0, 117)}…` : text,
    );

    const state = context.sessionHub.getSessionState(sessionId);
    if (state) {
      state.chatMessages.push({ role: 'assistant', content: text });
    }

    const message: ServerTextDoneMessage = {
      type: 'text_done',
      responseId,
      text,
    };
    context.sessionHub.broadcastToSession(sessionId, message);

    const events: ChatEvent[] = [
      {
        ...createChatEventBase({
          sessionId,
          responseId,
        }),
        type: 'assistant_done',
        payload: { text },
      },
    ];
    void appendAndBroadcastChatEvents(
      {
        eventStore: context.eventStore,
        sessionHub: context.sessionHub,
        sessionId,
      },
      events,
    );

    res.statusCode = 200;
    res.end();
    return true;
  }

  return false;
};
