#!/usr/bin/env node
import { loadConfigFromEnv } from './config.js';
import { createFcmClient } from './fcm.js';
import { createServer } from './server.js';

function main(): void {
  try {
    const config = loadConfigFromEnv();
    const fcmClient = createFcmClient(config.serviceAccountPath, config.deviceToken);
    const server = createServer({ config, fcmClient });

    server.listen(config.port, () => {
      console.log(`notify-proxy listening on http://localhost:${config.port}`);
    });

    const shutdown = (signal: string): void => {
      console.log(`Shutting down notify-proxy (${signal})`);
      server.close(() => {
        process.exit(0);
      });
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (err) {
    console.error('Failed to start notify-proxy:', err);
    process.exit(1);
  }
}

main();
