import * as fs from 'node:fs';
import * as https from 'node:https';
import * as crypto from 'node:crypto';

export interface ServiceAccountKey {
  project_id: string;
  private_key: string;
  client_email: string;
  token_uri: string;
}

export interface FcmClient {
  sendNotification(title: string, body: string): Promise<void>;
}

export function createFcmClient(serviceAccountPath: string, deviceToken: string): FcmClient {
  const serviceAccount = loadServiceAccountKey(serviceAccountPath);
  let cachedAccessToken: string | null = null;
  let tokenExpiresAt = 0;

  async function getAccessToken(): Promise<string> {
    const now = Date.now();
    if (cachedAccessToken && tokenExpiresAt > now) {
      return cachedAccessToken;
    }

    const { accessToken, expiresAt } = await fetchAccessToken(serviceAccount);
    cachedAccessToken = accessToken;
    tokenExpiresAt = expiresAt;
    return cachedAccessToken;
  }

  return {
    async sendNotification(title: string, body: string): Promise<void> {
      const accessToken = await getAccessToken();
      await sendPush(serviceAccount, accessToken, deviceToken, title, body);
    },
  };
}

function loadServiceAccountKey(filePath: string): ServiceAccountKey {
  const content = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(content) as ServiceAccountKey;
}

function createJwt(serviceAccount: ServiceAccountKey): string {
  const now = Math.floor(Date.now() / 1000);
  const expiry = now + 3600;

  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: serviceAccount.token_uri,
    iat: now,
    exp: expiry,
  };

  const base64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
  const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const unsignedToken = `${base64Header}.${base64Payload}`;

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(unsignedToken);
  const signature = sign.sign(serviceAccount.private_key, 'base64url');

  return `${unsignedToken}.${signature}`;
}

async function fetchAccessToken(
  serviceAccount: ServiceAccountKey,
): Promise<{ accessToken: string; expiresAt: number }> {
  const jwt = createJwt(serviceAccount);

  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }).toString();

    const url = new URL(serviceAccount.token_uri);
    const now = Date.now();

    const req = https.request(
      {
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const response = JSON.parse(body) as { access_token: string };
              // Cache slightly under one hour to avoid edge-of-expiry issues.
              const expiresAt = now + 55 * 60 * 1000;
              resolve({ accessToken: response.access_token, expiresAt });
            } catch (err) {
              reject(err);
            }
          } else {
            reject(new Error(`OAuth error ${res.statusCode}: ${body}`));
          }
        });
      },
    );

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function sendPush(
  serviceAccount: ServiceAccountKey,
  accessToken: string,
  deviceToken: string,
  title: string,
  body: string,
): Promise<void> {
  const payload = {
    message: {
      token: deviceToken,
      notification: { title, body },
      android: {
        priority: 'high',
        notification: {
          channel_id: 'default',
        },
      },
    },
  };

  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);

    const req = https.request(
      {
        hostname: 'fcm.googleapis.com',
        path: `/v1/projects/${serviceAccount.project_id}/messages:send`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          Authorization: `Bearer ${accessToken}`,
        },
      },
      (res) => {
        let bodyText = '';
        res.on('data', (chunk) => {
          bodyText += chunk;
        });
        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve();
          } else {
            reject(new Error(`FCM error ${res.statusCode}: ${bodyText}`));
          }
        });
      },
    );

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}
