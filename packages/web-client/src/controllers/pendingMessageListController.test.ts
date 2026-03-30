// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { PendingMessageListController } from './pendingMessageListController';

describe('PendingMessageListController', () => {
  it('hides the prepended context line in visible queued message text', () => {
    const container = document.createElement('div');
    const controller = new PendingMessageListController({
      container,
      getSessionId: () => 'session-1',
      getAgentDisplayName: () => 'Agent',
      cancelQueuedMessage: vi.fn(),
    });

    controller.handleMessageQueued({
      type: 'message_queued',
      messageId: 'msg-1',
      sessionId: 'session-1',
      text: '<context panel-id="panel-1" />\nCall Sam when I get home.',
      position: 1,
    });

    const textEl = container.querySelector<HTMLDivElement>('.pending-message-text');
    expect(textEl?.textContent).toBe('Call Sam when I get home.');
  });
});
