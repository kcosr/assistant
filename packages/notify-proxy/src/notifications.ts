export interface WebhookPayload {
  sessionId: string;
  sessionName?: string;
  responseId?: string;
  status: string;
  toolCallCount?: number;
  response?: string;
  truncated?: boolean;
  durationMs?: number;
  error?: string;
}

export interface NotificationMessage {
  title: string;
  body: string;
}

export function formatNotification(payload: WebhookPayload): NotificationMessage {
  const sessionLabel =
    payload.sessionName && payload.sessionName.trim().length > 0
      ? payload.sessionName
      : payload.sessionId.toString().slice(0, 8);

  if (payload.status === 'error') {
    const errorMessage =
      payload.error && payload.error.trim().length > 0 ? payload.error : 'Task failed';
    const maxBodyLen = Math.max(0, 150 - sessionLabel.length - 5);
    const trimmedError =
      errorMessage.length > maxBodyLen && maxBodyLen > 0
        ? `${errorMessage.slice(0, maxBodyLen)}...`
        : errorMessage;

    return {
      title: 'AI Assistant - Error',
      body: `[${sessionLabel}]: ${trimmedError}`,
    };
  }

  const toolSuffix =
    typeof payload.toolCallCount === 'number' && payload.toolCallCount > 0
      ? ` (${payload.toolCallCount} tools)`
      : '';

  const rawResponse = payload.response ?? '';

  const maxBodyLen = Math.max(0, 150 - sessionLabel.length - toolSuffix.length - 5);
  const responsePreview =
    rawResponse.length > maxBodyLen && maxBodyLen > 0
      ? `${rawResponse.slice(0, maxBodyLen)}...`
      : rawResponse;

  return {
    title: 'AI Assistant',
    body: `[${sessionLabel}]: ${responsePreview}${toolSuffix}`,
  };
}
