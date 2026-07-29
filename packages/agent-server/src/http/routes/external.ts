import type { ChatEvent, ServerTextDoneMessage } from '@assistant/shared';

import type { HttpRouteHandler } from '../types';
import { createExternalResponseId } from '../../externalAgents';
import { appendAndBroadcastChatEvents, createChatEventBase } from '../../events/chatEventUtils';
import { publishFinalResponseNotification } from '../../notificationProducers';

export const handleExternalRoutes: HttpRouteHandler = async (
  context,
  req,
  res,
  url,
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
    const turnOriginId = url.searchParams.get('turnOriginId')?.trim() || undefined;

    let notificationSummary = summary;
    try {
      const updatedSummary = await context.sessionHub.recordSessionActivity(
        sessionId,
        text.length > 120 ? `${text.slice(0, 117)}…` : text,
      );
      if (updatedSummary) {
        notificationSummary = updatedSummary;
      }
    } catch {
      // Session activity persistence is best-effort; retain the existing summary.
    }

    const state = context.sessionHub.getSessionState(sessionId);
    if (state) {
      state.chatMessages.push({ role: 'assistant', content: text, historyTimestampMs: Date.now() });
    }

    const message: ServerTextDoneMessage = {
      type: 'text_done',
      responseId,
      requestId: responseId,
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
        payload: { text, ...(turnOriginId ? { turnOriginId } : {}) },
      },
    ];
    await appendAndBroadcastChatEvents(
      {
        eventStore: context.eventStore,
        sessionHub: context.sessionHub,
        sessionId,
      },
      events,
    );
    await publishFinalResponseNotification({
      sessionId,
      responseId,
      text,
      sessionHub: context.sessionHub,
      summary: notificationSummary,
      ...(turnOriginId ? { turnOriginId } : {}),
    });

    res.statusCode = 200;
    res.end();
    return true;
  }

  return false;
};
