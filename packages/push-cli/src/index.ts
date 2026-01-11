#!/usr/bin/env node
/**
 * CLI to send push notifications via Firebase Cloud Messaging (FCM v1 API).
 *
 * Usage:
 *   push-cli <service-account.json> <device-token> <title> <body>
 *
 * Example:
 *   push-cli ./firebase-key.json "eXaMpLeToKeN..." "Hello" "Test notification"
 */

import * as fs from 'node:fs';
import * as https from 'node:https';
import * as crypto from 'node:crypto';

interface ServiceAccountKey {
  project_id: string;
  private_key: string;
  client_email: string;
  token_uri: string;
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

async function getAccessToken(serviceAccount: ServiceAccountKey): Promise<string> {
  const jwt = createJwt(serviceAccount);

  return new Promise((resolve, reject) => {
    const postData = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }).toString();

    const url = new URL(serviceAccount.token_uri);

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
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          if (res.statusCode === 200) {
            const response = JSON.parse(body) as { access_token: string };
            resolve(response.access_token);
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
        priority: 'high', // Helps bypass doze/battery saver
        notification: {
          channel_id: 'default', // You may need to create this channel in the app
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
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          if (res.statusCode === 200) {
            console.log('✓ Push sent successfully');
            resolve();
          } else {
            reject(new Error(`FCM error ${res.statusCode}: ${body}`));
          }
        });
      },
    );

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length < 4) {
    console.log('Usage: push-cli <service-account.json> <device-token> <title> <body>');
    console.log('');
    console.log('Arguments:');
    console.log('  service-account.json  Path to Firebase service account key file');
    console.log('  device-token          FCM device token (from app logs)');
    console.log('  title                 Notification title');
    console.log('  body                  Notification body');
    console.log('');
    console.log('Example:');
    console.log('  push-cli ./firebase-key.json "eXaMpLe..." "Hello" "Test message"');
    process.exit(1);
  }

  const [serviceAccountPath, deviceToken, title, body] = args;

  try {
    console.log(`Loading service account from: ${serviceAccountPath}`);
    const serviceAccount = loadServiceAccountKey(serviceAccountPath);
    console.log(`Project: ${serviceAccount.project_id}`);

    console.log('Getting access token...');
    const accessToken = await getAccessToken(serviceAccount);

    console.log(`Sending: "${title}" - "${body}"`);
    await sendPush(serviceAccount, accessToken, deviceToken, title, body);
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

main();
