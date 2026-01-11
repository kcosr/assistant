import { describe, expect, it } from 'vitest';
import { formatNotification, type WebhookPayload } from './notifications.js';

describe('formatNotification', () => {
  it('formats a successful completion with session name and tools', () => {
    const payload: WebhookPayload = {
      sessionId: 'session-12345678',
      sessionName: 'Daily Report',
      status: 'complete',
      toolCallCount: 3,
      response: 'Here is what I did: generated the daily report and emailed it to the team.',
    };

    const notification = formatNotification(payload);

    expect(notification.title).toBe('AI Assistant');
    expect(notification.body).toContain('[Daily Report]:');
    expect(notification.body).toContain('(3 tools)');
  });

  it('falls back to sessionId prefix when sessionName is missing', () => {
    const payload: WebhookPayload = {
      sessionId: 'abcdef123456',
      status: 'complete',
      response: 'Short response',
    };

    const notification = formatNotification(payload);

    expect(notification.body).toContain('[abcdef12]:');
  });

  it('formats error notifications with error-specific title', () => {
    const payload: WebhookPayload = {
      sessionId: 'session-123',
      sessionName: 'Failing Task',
      status: 'error',
      error: 'Tool timeout',
    };

    const notification = formatNotification(payload);

    expect(notification.title).toBe('AI Assistant - Error');
    expect(notification.body).toContain('[Failing Task]: Tool timeout');
  });

  it('truncates long error messages to keep notifications readable', () => {
    const longError = 'y'.repeat(500);

    const payload: WebhookPayload = {
      sessionId: 'session-1234',
      sessionName: 'Long Error',
      status: 'error',
      error: longError,
    };

    const notification = formatNotification(payload);

    expect(notification.body.length).toBeLessThanOrEqual(180);
    expect(notification.body).toContain('...');
  });

  it('truncates long responses to keep notifications readable', () => {
    const longResponse = 'x'.repeat(500);

    const payload: WebhookPayload = {
      sessionId: 'session-1234',
      status: 'complete',
      response: longResponse,
    };

    const notification = formatNotification(payload);

    expect(notification.body.length).toBeLessThanOrEqual(180);
    expect(notification.body).toContain('...');
  });
});
