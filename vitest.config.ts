import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@assistant/shared': path.resolve(__dirname, 'packages/shared/src'),
    },
  },
  test: {
    environment: 'node',
    include: [
      'packages/shared/src/**/*.test.ts',
      'packages/coding-executor/src/**/*.test.ts',
      'packages/agent-server/src/**/*.test.ts',
      'packages/plugins/**/server/**/*.test.ts',
      'packages/plugins/**/web/**/*.test.ts',
      'packages/notify-proxy/src/**/*.test.ts',
      'packages/web-client/src/**/*.test.ts',
      'packages/assistant-cli/src/**/*.test.ts',
      'packages/coding-sidecar/src/**/*.test.ts',
    ],
    environmentMatchGlobs: [
      // Use jsdom for web-client tests that need DOM APIs
      ['packages/web-client/src/**/markdown.test.ts', 'jsdom'],
    ],
    setupFiles: [
      // Clear API host config in web-client tests so they use relative URLs
      'packages/web-client/src/test/setup.ts',
    ],
  },
});
