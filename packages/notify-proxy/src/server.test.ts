import * as http from 'node:http';
import { describe, expect, it } from 'vitest';
import { createServer } from './server.js';
import type { NotifyProxyConfig } from './config.js';
import type { FcmClient } from './fcm.js';

function startTestServer(
  config: Partial<NotifyProxyConfig> = {},
  fcmClientOverrides?: Partial<FcmClient>,
) {
  const baseConfig: NotifyProxyConfig = {
    port: config.port ?? 0,
    serviceAccountPath: config.serviceAccountPath ?? '/tmp/dummy.json',
    deviceToken: config.deviceToken ?? 'dummy-token',
    ...(config.notifySecret ? { notifySecret: config.notifySecret } : {}),
  };

  const fcmClient: FcmClient = {
    async sendNotification() {
      // no-op for tests
    },
    ...fcmClientOverrides,
  };

  const server = createServer({ config: baseConfig, fcmClient });

  return new Promise<{
    server: http.Server;
    port: number;
  }>((resolve, reject) => {
    server.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Unexpected server address'));
        return;
      }
      resolve({ server, port: address.port });
    });
  });
}

function requestJson(
  options: http.RequestOptions & { body?: unknown },
): Promise<{ statusCode: number | undefined; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : undefined;
          resolve({ statusCode: res.statusCode, body: parsed });
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', reject);

    if (options.body !== undefined) {
      const bodyString = JSON.stringify(options.body);
      req.write(bodyString);
    }

    req.end();
  });
}

describe('notify-proxy server', () => {
  it('responds to GET /health', async () => {
    const { server, port } = await startTestServer();

    const response = await requestJson({
      hostname: '127.0.0.1',
      port,
      path: '/health',
      method: 'GET',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      status: 'ok',
      fcmConfigured: true,
    });

    server.close();
  });

  it('rejects unauthorized POST /notify when NOTIFY_SECRET is set', async () => {
    const { server, port } = await startTestServer({ notifySecret: 'secret' });

    const response = await requestJson({
      hostname: '127.0.0.1',
      port,
      path: '/notify',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: {
        sessionId: 'session-123',
        status: 'complete',
        response: 'hello',
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.body).toMatchObject({ error: 'Unauthorized' });

    server.close();
  });

  it('accepts authorized POST /notify and sends notification', async () => {
    let sentTitle: string | undefined;
    let sentBody: string | undefined;

    const { server, port } = await startTestServer(
      { notifySecret: 'secret' },
      {
        async sendNotification(title: string, body: string) {
          sentTitle = title;
          sentBody = body;
        },
      },
    );

    const response = await requestJson({
      hostname: '127.0.0.1',
      port,
      path: '/notify',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer secret',
      },
      body: {
        sessionId: 'session-123',
        sessionName: 'My Session',
        status: 'complete',
        response: 'Here is what I did',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      success: true,
      message: 'Push notification sent',
    });
    expect(sentTitle).toBe('AI Assistant');
    expect(sentBody).toContain('Here is what I did');

    server.close();
  });

  it('returns 400 for invalid JSON', async () => {
    const { server, port } = await startTestServer();

    const result = await new Promise<{ statusCode: number | undefined; body: unknown }>(
      (resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port,
            path: '/notify',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
          },
          (res) => {
            let data = '';
            res.on('data', (chunk) => {
              data += chunk;
            });
            res.on('end', () => {
              try {
                const parsed = data ? JSON.parse(data) : undefined;
                resolve({ statusCode: res.statusCode, body: parsed });
              } catch (err) {
                reject(err);
              }
            });
          },
        );

        req.on('error', reject);
        req.write('{"sessionId": "abc", "status":');
        req.end();
      },
    );

    expect(result.statusCode).toBe(400);
    expect(result.body).toMatchObject({ error: 'Invalid JSON body' });

    server.close();
  });

  it('returns 400 when Content-Type is not application/json', async () => {
    const { server, port } = await startTestServer();

    const response = await requestJson({
      hostname: '127.0.0.1',
      port,
      path: '/notify',
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
      },
      body: {
        sessionId: 'session-123',
        status: 'complete',
        response: 'hello',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.body).toMatchObject({
      error: 'Content-Type must be application/json',
    });

    server.close();
  });
});
