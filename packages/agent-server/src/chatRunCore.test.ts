import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  appendDebugChatCompletionsLogRecord,
  formatDebugPayloadForLog,
  getDebugChatCompletionsLogPath,
} from './chatRunCore';

describe('formatDebugPayloadForLog', () => {
  it('serializes nested payloads without collapsing input objects and redacts secrets', () => {
    const formatted = formatDebugPayloadForLog({
      payload: {
        headers: {
          Authorization: 'Bearer secret',
          'X-Test': 'ok',
        },
        input: [
          {
            role: 'user',
            content: [{ type: 'input_text', text: 'run pwd' }],
          },
          {
            role: 'assistant',
            content: [{ type: 'text', text: 'Checking `pwd` now.' }],
          },
        ],
      },
    });

    expect(formatted).toContain('"input": [');
    expect(formatted).toContain('"role": "user"');
    expect(formatted).toContain('"text": "run pwd"');
    expect(formatted).toContain('"Authorization": "[redacted]"');
    expect(formatted).toContain('"X-Test": "ok"');
    expect(formatted).not.toContain('[Object]');
    expect(formatted).not.toContain('Bearer secret');
  });
});

describe('appendDebugChatCompletionsLogRecord', () => {
  it('writes redacted request and response records to a dedicated jsonl log file', async () => {
    const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'assistant-debug-chat-'));

    const logPath = await appendDebugChatCompletionsLogRecord({
      dataDir,
      record: {
        direction: 'request',
        debugContext: {
          resolutionPath: 'resolved',
          finalToolSpecCount: 63,
        },
        payload: {
          headers: {
            Authorization: 'Bearer secret',
          },
          input: [{ role: 'user', content: [{ type: 'input_text', text: 'run pwd' }] }],
        },
      },
    });

    await appendDebugChatCompletionsLogRecord({
      dataDir,
      record: {
        direction: 'response',
        response: {
          text: 'done',
          toolCalls: [],
        },
      },
    });

    expect(logPath).toBe(getDebugChatCompletionsLogPath(dataDir));

    const contents = await fs.readFile(logPath, 'utf8');
    const lines = contents.trim().split('\n').map((line) => JSON.parse(line));

    expect(lines).toHaveLength(2);
    expect(lines[0].direction).toBe('request');
    expect(lines[0].debugContext.finalToolSpecCount).toBe(63);
    expect(lines[0].payload.headers.Authorization).toBe('[redacted]');
    expect(lines[0].payload.input[0].content[0].text).toBe('run pwd');
    expect(lines[1].direction).toBe('response');
    expect(lines[1].response.text).toBe('done');
  });
});
