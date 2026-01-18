export interface ToolResultErrorPayload {
  code: string;
  message: string;
}

export function formatToolResultText(options: {
  toolName: string;
  ok: boolean;
  result: unknown;
  error?: ToolResultErrorPayload;
}): string {
  const { toolName, ok, result, error } = options;

  if (!ok && error) {
    if (error.code === 'tool_interrupted') {
      return '';
    }
    return `Error: ${error.message}`;
  }

  if (result === undefined || result === null) {
    return '';
  }

  if (typeof result === 'string') {
    return result;
  }

  if (typeof result === 'object') {
    const record = result as Record<string, unknown>;

    if (toolName === 'agents_message') {
      const mode = typeof record['mode'] === 'string' ? (record['mode'] as string) : undefined;
      const status =
        typeof record['status'] === 'string' ? (record['status'] as string) : undefined;
      const response =
        typeof record['response'] === 'string' && record['response'].trim().length > 0
          ? (record['response'] as string).trim()
          : undefined;
      const message =
        typeof record['message'] === 'string' && record['message'].trim().length > 0
          ? (record['message'] as string).trim()
          : undefined;

      if (mode === 'sync') {
        if (response) {
          return response;
        }
        if (message) {
          return message;
        }
      } else if (mode === 'async') {
        if (status === 'started' || status === 'queued') {
          return 'Waiting for response';
        }
        if (message) {
          return message;
        }
        return '';
      }
    }

    if (typeof record['output'] === 'string') {
      return record['output'];
    }
    if (typeof record['content'] === 'string') {
      return record['content'];
    }
    if (Array.isArray(record['content'])) {
      const parts: string[] = [];
      for (const block of record['content'] as unknown[]) {
        if (typeof block === 'string') {
          parts.push(block);
          continue;
        }
        if (!block || typeof block !== 'object') {
          continue;
        }
        const blockRecord = block as Record<string, unknown>;
        const text = blockRecord['text'];
        if (typeof text === 'string') {
          parts.push(text);
        }
      }
      if (parts.length > 0) {
        return parts.join('');
      }
    }
    if (typeof record['message'] === 'string') {
      return record['message'];
    }
    if (typeof record['diff'] === 'string') {
      return record['diff'];
    }
  }

  return JSON.stringify(result, null, 2);
}

export function buildToolHeaderLabel(toolName: string): string | undefined {
  if (toolName === 'bash' || toolName === 'shell' || toolName === 'sh') {
    return 'Shell command';
  }
  return undefined;
}
