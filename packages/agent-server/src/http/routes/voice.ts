import type { HttpRouteHandler } from '../types';
import type { VoiceService } from '../../voice/service';

export function createVoiceRouteHandler(getVoiceService: () => VoiceService | null): HttpRouteHandler {
  return async (context, req, _res, url, segments, helpers) => {
    if (segments.length < 2 || segments[0] !== 'api' || segments[1] !== 'voice') {
      return false;
    }

    const voice = getVoiceService();
    if (!voice) {
      helpers.sendJson(503, { error: 'Voice service unavailable' });
      return true;
    }

    // GET /api/voice/capabilities
    if (segments.length === 3 && segments[2] === 'capabilities' && req.method === 'GET') {
      helpers.sendJson(200, voice.capabilities());
      return true;
    }

    // POST /api/voice/conversations
    if (segments.length === 3 && segments[2] === 'conversations' && req.method === 'POST') {
      const body = (await helpers.readJsonBody()) ?? {};
      const conversation = await voice.createConversation({
        conversationId:
          typeof body['conversationId'] === 'string' ? body['conversationId'] : null,
        listsInstanceId:
          typeof body['listsInstanceId'] === 'string' ? body['listsInstanceId'] : undefined,
      });
      helpers.sendJson(200, {
        conversationId: conversation.id,
        title: conversation.title,
        listsInstanceId: conversation.listsInstanceId,
      });
      return true;
    }

    // GET /api/voice/conversations/:id
    if (segments.length === 4 && segments[2] === 'conversations' && req.method === 'GET') {
      const id = decodeURIComponent(segments[3] ?? '');
      const conversation = await voice.getConversation(id);
      if (!conversation) {
        helpers.sendJson(404, { error: 'Conversation not found' });
        return true;
      }
      helpers.sendJson(200, {
        conversationId: conversation.id,
        title: conversation.title,
        listsInstanceId: conversation.listsInstanceId,
        journal: conversation.journal.slice(-50),
        activeSessionId: conversation.activeSessionId,
      });
      return true;
    }

    // POST /api/voice/sessions
    if (segments.length === 3 && segments[2] === 'sessions' && req.method === 'POST') {
      try {
        const body = (await helpers.readJsonBody()) ?? {};
        const result = await voice.createSession({
          conversationId:
            typeof body['conversationId'] === 'string' ? body['conversationId'] : null,
          listsInstanceId:
            typeof body['listsInstanceId'] === 'string' ? body['listsInstanceId'] : undefined,
        });
        helpers.sendJson(200, {
          conversationId: result.conversationId,
          sessionId: result.session.id,
          state: result.session.state,
          listsInstanceId: result.session.listsInstanceId,
        });
      } catch (error) {
        helpers.sendJson(400, {
          error: error instanceof Error ? error.message : 'Failed to create voice session',
        });
      }
      return true;
    }

    // Session-scoped routes: /api/voice/sessions/:id/...
    if (segments.length >= 4 && segments[2] === 'sessions') {
      const sessionId = decodeURIComponent(segments[3] ?? '');
      if (!sessionId) {
        helpers.sendJson(400, { error: 'sessionId is required' });
        return true;
      }

      // GET /api/voice/sessions/:id
      if (segments.length === 4 && req.method === 'GET') {
        const session = await voice.getSession(sessionId);
        if (!session) {
          helpers.sendJson(404, { error: 'Session not found' });
          return true;
        }
        helpers.sendJson(200, {
          sessionId: session.id,
          conversationId: session.conversationId,
          state: session.state,
          muted: session.muted,
          lastError: session.lastError,
          sequence: session.sequence,
        });
        return true;
      }

      // POST /api/voice/sessions/:id/offer
      if (segments.length === 5 && segments[4] === 'offer' && req.method === 'POST') {
        try {
          const body = (await helpers.readJsonBody()) ?? {};
          const offerSdp = typeof body['sdp'] === 'string' ? body['sdp'] : '';
          if (!offerSdp.trim()) {
            helpers.sendJson(400, { error: 'sdp is required' });
            return true;
          }
          const result = await voice.negotiateOffer({ sessionId, offerSdp });
          helpers.sendJson(200, {
            sdp: result.answerSdp,
            providerCallId: result.providerCallId,
          });
        } catch (error) {
          helpers.sendJson(400, {
            error: error instanceof Error ? error.message : 'Offer negotiation failed',
          });
        }
        return true;
      }

      // POST /api/voice/sessions/:id/heartbeat
      if (segments.length === 5 && segments[4] === 'heartbeat' && req.method === 'POST') {
        const session = await voice.heartbeat(sessionId);
        if (!session) {
          helpers.sendJson(404, { error: 'Session not found' });
          return true;
        }
        helpers.sendJson(200, { ok: true, state: session.state, sequence: session.sequence });
        return true;
      }

      // POST /api/voice/sessions/:id/mute
      if (segments.length === 5 && segments[4] === 'mute' && req.method === 'POST') {
        const body = (await helpers.readJsonBody()) ?? {};
        const muted = body['muted'] === true;
        const session = await voice.setMuted(sessionId, muted);
        if (!session) {
          helpers.sendJson(404, { error: 'Session not found' });
          return true;
        }
        helpers.sendJson(200, { muted: session.muted });
        return true;
      }

      // GET /api/voice/sessions/:id/events?after=N
      if (segments.length === 5 && segments[4] === 'events' && req.method === 'GET') {
        const after = Number(url.searchParams.get('after') ?? '0');
        const events = await voice.events(sessionId, Number.isFinite(after) ? after : 0);
        helpers.sendJson(200, { events });
        return true;
      }

      // POST /api/voice/sessions/:id/close
      if (segments.length === 5 && segments[4] === 'close' && req.method === 'POST') {
        await voice.closeSession(sessionId, 'client_stop');
        helpers.sendJson(200, { ok: true });
        return true;
      }
    }

    helpers.sendJson(404, { error: 'Not found' });
    return true;
  };
}
