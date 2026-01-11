import * as http from 'node:http';
import * as crypto from 'node:crypto';
import { formatNotification, type WebhookPayload } from './notifications.js';
import type { NotifyProxyConfig } from './config.js';
import type { FcmClient } from './fcm.js';

export interface ServerDependencies {
  config: NotifyProxyConfig;
  fcmClient: FcmClient;
}

export function createServer(deps: ServerDependencies): http.Server {
  const { config, fcmClient } = deps;

  const server = http.createServer((req, res) => {
    if (!req.url) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Missing URL' }));
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      const body = JSON.stringify({
        status: 'ok',
        fcmConfigured: Boolean(config.serviceAccountPath && config.deviceToken),
      });
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(body);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/notify') {
      const contentTypeHeader = req.headers['content-type'];
      const contentType = Array.isArray(contentTypeHeader)
        ? contentTypeHeader[0]
        : contentTypeHeader;
      if (!contentType || !contentType.toLowerCase().startsWith('application/json')) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Content-Type must be application/json' }));
        return;
      }

      if (!authorizeRequest(req, config.notifySecret)) {
        res.statusCode = 401;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      let rawBody = '';
      let bodyTooLarge = false;
      const maxBodyBytes = 256 * 1024; // 256KB

      req.on('data', (chunk) => {
        if (bodyTooLarge) {
          return;
        }

        rawBody += chunk;

        if (rawBody.length > maxBodyBytes) {
          bodyTooLarge = true;
          if (!res.headersSent) {
            res.statusCode = 413;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Request body too large' }));
          }
          req.destroy();
        }
      });

      req.on('end', () => {
        if (bodyTooLarge) {
          return;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(rawBody || '{}');
        } catch {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Invalid JSON body' }));
          return;
        }

        const validationError = validateWebhookPayload(parsed);
        if (validationError) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: validationError }));
          return;
        }

        const payload = parsed as WebhookPayload;
        const notification = formatNotification(payload);

        void (async () => {
          try {
            await fcmClient.sendNotification(notification.title, notification.body);
            if (!res.headersSent) {
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(
                JSON.stringify({
                  success: true,
                  message: 'Push notification sent',
                }),
              );
            }
          } catch (err) {
            // Log FCM errors but still return 200 to avoid retries from the caller.
            console.error('Error sending FCM notification:', err);
            if (!res.headersSent) {
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(
                JSON.stringify({
                  success: false,
                  message: 'Failed to send push notification',
                }),
              );
            }
          }
        })();
      });

      req.on('error', (err) => {
        console.error('Request error:', err);
        if (!res.headersSent) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Error reading request body' }));
        }
      });

      return;
    }

    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Not Found' }));
  });

  return server;
}

function authorizeRequest(req: http.IncomingMessage, notifySecret: string | undefined): boolean {
  if (!notifySecret) {
    return true;
  }

  const headerValue = req.headers.authorization;
  const header = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!header) {
    return false;
  }

  const expected = `Bearer ${notifySecret}`;
  const providedBuffer = Buffer.from(header);
  const expectedBuffer = Buffer.from(expected);

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

function validateWebhookPayload(data: unknown): string | null {
  if (data === null || typeof data !== 'object') {
    return 'Request body must be a JSON object';
  }

  const value = data as Record<string, unknown>;

  if (typeof value['sessionId'] !== 'string' || value['sessionId'].length === 0) {
    return 'sessionId is required and must be a non-empty string';
  }

  if (typeof value['status'] !== 'string' || value['status'].length === 0) {
    return 'status is required and must be a non-empty string';
  }

  if (value['sessionName'] !== undefined && typeof value['sessionName'] !== 'string') {
    return 'sessionName must be a string when provided';
  }

  if (value['toolCallCount'] !== undefined && typeof value['toolCallCount'] !== 'number') {
    return 'toolCallCount must be a number when provided';
  }

  if (value['truncated'] !== undefined && typeof value['truncated'] !== 'boolean') {
    return 'truncated must be a boolean when provided';
  }

  if (value['durationMs'] !== undefined && typeof value['durationMs'] !== 'number') {
    return 'durationMs must be a number when provided';
  }

  if (value['responseId'] !== undefined && typeof value['responseId'] !== 'string') {
    return 'responseId must be a string when provided';
  }

  if (value['status'] === 'error') {
    if (value['error'] !== undefined && typeof value['error'] !== 'string') {
      return 'error must be a string when provided';
    }
  } else if (value['response'] !== undefined && typeof value['response'] !== 'string') {
    return 'response must be a string when provided';
  }

  return null;
}
