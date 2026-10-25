import { ToolError } from './errors';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPAQUE_SOURCE_PATTERN = /[\uE200-\uE202]|\bturn\d+(?:search|view|fetch)\d+\b/i;

function fail(message: string): never {
  throw new ToolError('execution_failed', `Codex research ${message}`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseCodexWebSearchOutput(
  stdout: string,
  options: { expectedSessionId?: string; requireSearch: boolean },
): { text: string; sessionId: string } {
  let sessionId: string | undefined;
  let text: string | undefined;
  let turnCompleted = false;
  let searched = false;

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    let event: unknown;
    try {
      event = JSON.parse(line) as unknown;
    } catch {
      fail('returned invalid JSON output');
    }
    if (!isObject(event) || typeof event['type'] !== 'string' || !event['type']) {
      fail('returned an invalid event');
    }

    switch (event['type']) {
      case 'thread.started': {
        const id = event['thread_id'];
        if (typeof id !== 'string' || !UUID_PATTERN.test(id)) {
          fail('returned an invalid session ID');
        }
        if (
          (sessionId !== undefined && sessionId !== id) ||
          (options.expectedSessionId !== undefined && options.expectedSessionId !== id)
        ) {
          fail('returned an unexpected session ID');
        }
        sessionId = id;
        break;
      }
      case 'error':
      case 'turn.failed':
        return fail('failed before completing the answer');
      case 'turn.started':
        turnCompleted = false;
        text = undefined;
        searched = false;
        break;
      case 'turn.completed':
        if (sessionId === undefined) {
          fail('completed without a session ID');
        }
        turnCompleted = true;
        break;
      case 'item.started':
      case 'item.updated':
        turnCompleted = false;
        break;
      case 'item.completed': {
        turnCompleted = false;
        const item = event['item'];
        if (!isObject(item) || typeof item['type'] !== 'string' || !item['type']) {
          fail('returned an invalid completed item');
        }
        if (item['type'] === 'web_search') {
          searched = true;
        } else if (item['type'] === 'agent_message' && item['phase'] !== 'commentary') {
          if (typeof item['text'] !== 'string') {
            fail('returned invalid answer text');
          }
          text = item['text'].trim();
        }
        // An error item can be a recoverable tool warning. Only top-level errors
        // and failed turns are terminal failures in the exec JSONL protocol.
        break;
      }
    }
  }

  if (sessionId === undefined || !turnCompleted) {
    fail('did not complete');
  }
  if (!text) {
    fail('returned no final answer');
  }
  if (options.requireSearch && !searched) {
    fail('completed without searching the web');
  }
  if (OPAQUE_SOURCE_PATTERN.test(text)) {
    fail('returned unresolved source references');
  }

  return { text, sessionId };
}
