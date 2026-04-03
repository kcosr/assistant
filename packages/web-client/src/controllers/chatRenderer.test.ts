// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ChatEvent, ProjectedTranscriptEvent } from '@assistant/shared';
import { ChatRenderer } from './chatRenderer';
import * as attachmentActions from '../utils/attachmentActions';
import { setToolOutputBlockNearViewport } from '../utils/toolOutputRenderer';

afterEach(() => {
  document.body.innerHTML = '';
});

function createBaseEvent<T extends ChatEvent['type']>(
  type: T,
  overrides: Partial<Extract<ChatEvent, { type: T }>> = {},
): Extract<ChatEvent, { type: T }> {
  const base = {
    id: 'e-base',
    type,
    timestamp: Date.now(),
    sessionId: 's1',
    turnId: 't1',
    responseId: 'r1',
    payload: {} as Extract<ChatEvent, { type: T }>['payload'],
  } as unknown as Extract<ChatEvent, { type: T }>;
  return { ...base, ...overrides } as Extract<ChatEvent, { type: T }>;
}

function createProjectedEvent(
  sequence: number,
  overrides: Partial<ProjectedTranscriptEvent> = {},
): ProjectedTranscriptEvent {
  return {
    sessionId: 's1',
    revision: 1,
    sequence,
    requestId: 't1',
    eventId: `e${sequence}`,
    kind: 'assistant_message',
    chatEventType: 'assistant_done',
    timestamp: new Date(1000 + sequence).toISOString(),
    payload: { text: `message ${sequence}` },
    ...overrides,
  };
}

function mapLegacyKind(event: ChatEvent): ProjectedTranscriptEvent['kind'] {
  switch (event.type) {
    case 'turn_start':
      return 'request_start';
    case 'turn_end':
      return 'request_end';
    case 'user_message':
    case 'user_audio':
      return 'user_message';
    case 'assistant_chunk':
    case 'assistant_done':
    case 'custom_message':
    case 'summary_message':
    case 'audio_chunk':
    case 'audio_done':
      return 'assistant_message';
    case 'thinking_chunk':
    case 'thinking_done':
      return 'thinking';
    case 'tool_call':
      return 'tool_call';
    case 'tool_input_chunk':
      return 'tool_input';
    case 'tool_output_chunk':
      return 'tool_output';
    case 'tool_result':
      return 'tool_result';
    case 'interaction_request':
    case 'questionnaire_request':
    case 'agent_message':
      return 'interaction_request';
    case 'interaction_pending':
    case 'questionnaire_reprompt':
    case 'questionnaire_update':
    case 'agent_switch':
      return 'interaction_update';
    case 'interaction_response':
    case 'questionnaire_submission':
    case 'agent_callback':
      return 'interaction_response';
    case 'interrupt':
      return 'interrupt';
    case 'error':
      return 'error';
  }
}

function toProjectedEvent(event: ChatEvent, sequence: number): ProjectedTranscriptEvent {
  const payload = event.payload as Record<string, unknown>;
  const base: ProjectedTranscriptEvent = {
    sessionId: event.sessionId,
    revision: 1,
    sequence,
    requestId:
      (typeof event.turnId === 'string' && event.turnId.trim().length > 0
        ? event.turnId
        : event.responseId) ?? `request:${event.id}`,
    eventId: event.id,
    kind: mapLegacyKind(event),
    chatEventType: event.type,
    timestamp: new Date(event.timestamp).toISOString(),
    payload,
    ...(typeof event.responseId === 'string' && event.responseId.trim().length > 0
      ? { responseId: event.responseId }
      : {}),
  };

  if (typeof payload['toolCallId'] === 'string') {
    base.toolCallId = payload['toolCallId'];
  }
  if (typeof payload['interactionId'] === 'string') {
    base.interactionId = payload['interactionId'];
  }
  if (typeof payload['messageId'] === 'string') {
    base.messageId = payload['messageId'];
  }
  if (typeof payload['exchangeId'] === 'string') {
    base.exchangeId = payload['exchangeId'];
  }

  return base;
}

const rendererSequenceState = new WeakMap<ChatRenderer, number>();

function resetLegacySequence(renderer: ChatRenderer, nextSequence = 0): void {
  rendererSequenceState.set(renderer, nextSequence);
}

function getNextLegacySequence(renderer: ChatRenderer): number {
  const nextSequence = rendererSequenceState.get(renderer) ?? 0;
  rendererSequenceState.set(renderer, nextSequence + 1);
  return nextSequence;
}

function replayLegacyEvents(renderer: ChatRenderer, events: ChatEvent[]): void {
  renderer.replayProjectedEvents(events.map((event, sequence) => toProjectedEvent(event, sequence)), {
    reset: true,
  });
  resetLegacySequence(renderer, events.length);
}

function renderLegacyEvent(renderer: ChatRenderer, event: ChatEvent): void {
  renderer.handleNewProjectedEvent(toProjectedEvent(event, getNextLegacySequence(renderer)));
}

describe('ChatRenderer', () => {
  it('replays projected transcript events into the expected DOM structure', () => {
    const container = document.createElement('div');
    container.className = 'chat-log';
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container, {
      getExpandToolOutput: () => true,
    });

    const events: ProjectedTranscriptEvent[] = [
      {
        sessionId: 's1',
        revision: 1,
        sequence: 0,
        requestId: 't1',
        eventId: 'e0',
        kind: 'request_start',
        chatEventType: 'turn_start',
        timestamp: new Date(1000).toISOString(),
        payload: { trigger: 'user' },
      },
      {
        sessionId: 's1',
        revision: 1,
        sequence: 1,
        requestId: 't1',
        eventId: 'e1',
        kind: 'user_message',
        chatEventType: 'user_message',
        timestamp: new Date(1001).toISOString(),
        payload: { text: 'Projected hello' },
      },
      {
        sessionId: 's1',
        revision: 1,
        sequence: 2,
        requestId: 't1',
        eventId: 'e2',
        kind: 'assistant_message',
        chatEventType: 'assistant_done',
        timestamp: new Date(1002).toISOString(),
        responseId: 'r1',
        payload: { text: 'Projected reply' },
      },
      {
        sessionId: 's1',
        revision: 1,
        sequence: 3,
        requestId: 't1',
        eventId: 'e3',
        kind: 'request_end',
        chatEventType: 'turn_end',
        timestamp: new Date(1003).toISOString(),
        payload: {},
      },
    ];

    renderer.replayProjectedEvents(events);

    const turn = container.querySelector<HTMLDivElement>('.turn');
    expect(turn?.dataset['turnId']).toBe('t1');
    expect(turn?.classList.contains('turn-complete')).toBe(true);

    const userMessage = turn?.querySelector<HTMLDivElement>('.message.user');
    expect(userMessage?.textContent).toContain('Projected hello');

    const assistantText = turn?.querySelector<HTMLDivElement>('.assistant-text');
    expect(assistantText?.textContent).toContain('Projected reply');
    expect(assistantText?.dataset['eventId']).toBe('e2');
  });

  it('orders projected transcript replay by sequence instead of arrival order', () => {
    const container = document.createElement('div');
    container.className = 'chat-log';
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container);

    renderer.replayProjectedEvents([
      createProjectedEvent(2, {
        responseId: 'r1',
        payload: { text: 'assistant' },
      }),
      createProjectedEvent(0, {
        kind: 'request_start',
        chatEventType: 'turn_start',
        payload: { trigger: 'user' },
      }),
      createProjectedEvent(1, {
        kind: 'user_message',
        chatEventType: 'user_message',
        payload: { text: 'user' },
      }),
      createProjectedEvent(3, {
        kind: 'request_end',
        chatEventType: 'turn_end',
        payload: {},
      }),
    ]);

    const turn = container.querySelector<HTMLDivElement>('.turn');
    const userMessage = turn?.querySelector<HTMLDivElement>('.message.user');
    const assistantText = turn?.querySelector<HTMLDivElement>('.assistant-text');
    expect(userMessage?.textContent).toContain('user');
    expect(assistantText?.textContent).toContain('assistant');
  });

  it('ignores duplicate projected transcript events and stale revisions', () => {
    const container = document.createElement('div');
    container.className = 'chat-log';
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container);

    renderer.replayProjectedEvents([
      createProjectedEvent(0, {
        kind: 'request_start',
        chatEventType: 'turn_start',
        payload: { trigger: 'user' },
      }),
      createProjectedEvent(1, {
        kind: 'user_message',
        chatEventType: 'user_message',
        payload: { text: 'hello' },
      }),
    ]);

    renderer.handleNewProjectedEvent(
      createProjectedEvent(1, {
        kind: 'user_message',
        chatEventType: 'user_message',
        payload: { text: 'hello' },
      }),
    );
    renderer.handleNewProjectedEvent(
      createProjectedEvent(0, {
        revision: 0,
        kind: 'user_message',
        chatEventType: 'user_message',
        payload: { text: 'stale' },
      }),
    );

    const messages = Array.from(container.querySelectorAll('.message.user'));
    expect(messages).toHaveLength(1);
    expect(messages[0]?.textContent).toContain('hello');
  });

  it('requests reload when a live projected event arrives with a sequence gap', () => {
    const container = document.createElement('div');
    container.className = 'chat-log';
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container);

    renderer.replayProjectedEvents([
      createProjectedEvent(0, {
        kind: 'request_start',
        chatEventType: 'turn_start',
        payload: { trigger: 'user' },
      }),
      createProjectedEvent(1, {
        kind: 'user_message',
        chatEventType: 'user_message',
        payload: { text: 'hello' },
      }),
    ]);

    const result = renderer.handleNewProjectedEvent(
      createProjectedEvent(3, {
        kind: 'assistant_message',
        chatEventType: 'assistant_chunk',
        responseId: 'r1',
        payload: { text: 'late chunk', phase: 'response' },
      }),
    );

    expect(result).toBe('reload');
  });

  it('requests reload when a replay batch mixes transcript revisions', () => {
    const container = document.createElement('div');
    container.className = 'chat-log';
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container);

    const result = renderer.replayProjectedEvents([
      createProjectedEvent(0, {
        revision: 1,
        kind: 'request_start',
        chatEventType: 'turn_start',
        payload: { trigger: 'user' },
      }),
      createProjectedEvent(0, {
        revision: 2,
        kind: 'request_start',
        chatEventType: 'turn_start',
        payload: { trigger: 'user' },
        eventId: 'mixed-revision-event',
      }),
    ]);

    expect(result).toBe('reload');
  });

  it('replays events into the expected DOM structure', () => {
    const container = document.createElement('div');
    container.className = 'chat-log';
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container, {
      getExpandToolOutput: () => true,
    });

    const events: ChatEvent[] = [
      createBaseEvent('turn_start', {
        id: 'e0',
        turnId: 't1',
        payload: { trigger: 'user' },
      }),
      createBaseEvent('user_message', {
        id: 'e1',
        turnId: 't1',
        responseId: undefined,
        payload: { text: "What's the weather and fix the bug?" },
      }),
      createBaseEvent('assistant_chunk', {
        id: 'e2',
        payload: { text: "It's 72°F in Austin. " },
      }),
      createBaseEvent('assistant_done', {
        id: 'e3',
        payload: {
          text: "It's 72°F in Austin. The code agent fixed the bug.",
        },
      }),
      createBaseEvent('tool_call', {
        id: 'e4',
        payload: {
          toolCallId: 'tc1',
          toolName: 'get_weather',
          args: { city: 'Austin' },
        },
      }),
      createBaseEvent('tool_result', {
        id: 'e5',
        payload: {
          toolCallId: 'tc1',
          result: '72°F, sunny',
        },
      }),
      // agents_message tool call and result (replaces agent_message rendering)
      createBaseEvent('tool_call', {
        id: 'e6',
        payload: {
          toolCallId: 'tc2',
          toolName: 'agents_message',
          args: {
            agentId: 'code-agent',
            content: 'Fix the bug in the code.',
            mode: 'async',
          },
        },
      }),
      createBaseEvent('tool_result', {
        id: 'e7',
        payload: {
          toolCallId: 'tc2',
          result: { mode: 'async', messageId: 'am1' },
        },
      }),
      createBaseEvent('agent_callback', {
        id: 'e8',
        payload: {
          messageId: 'am1',
          fromAgentId: 'code-agent',
          fromSessionId: 's-code',
          result: 'Fixed null pointer on line 42',
        },
      }),
      createBaseEvent('turn_end', {
        id: 'e9',
        payload: {},
      }),
    ];

    replayLegacyEvents(renderer, events);

    const turn = container.querySelector<HTMLDivElement>('.turn');
    expect(turn).not.toBeNull();
    if (!turn) return;

    expect(turn.dataset['turnId']).toBe('t1');
    expect(turn.classList.contains('turn-complete')).toBe(true);

    const userMessage = turn.querySelector<HTMLDivElement>('.message.user');
    expect(userMessage).not.toBeNull();
    expect(userMessage?.dataset['eventId']).toBe('e1');
    expect(userMessage?.textContent).toContain("What's the weather and fix the bug?");

    const assistantResponse = turn.querySelector<HTMLDivElement>('.assistant-response');
    expect(assistantResponse).not.toBeNull();
    if (!assistantResponse) return;

    expect(assistantResponse.dataset['responseId']).toBe('r1');

    const toolBlock = assistantResponse.querySelector<HTMLDivElement>('.tool-output-block');
    expect(toolBlock).not.toBeNull();
    if (!toolBlock) return;
    expect(toolBlock.dataset['callId']).toBe('tc1');
    expect(toolBlock.dataset['toolCallId']).toBe('tc1');
    expect(toolBlock.dataset['eventId']).toBe('e4');

    const header = toolBlock.querySelector<HTMLButtonElement>('.tool-output-header');
    expect(header?.textContent).toContain('get_weather');
    expect(header?.textContent).toContain('Austin');

    const inputBody = toolBlock.querySelector<HTMLDivElement>('.tool-output-input-body');
    expect(inputBody?.textContent).toContain('Austin');

    const toolResultBody = toolBlock.querySelector<HTMLDivElement>('.tool-output-output-body');
    expect(toolResultBody).not.toBeNull();
    expect(toolResultBody?.textContent).toContain('72°F, sunny');

    // agents_message is rendered as a tool block with agent-message-exchange class
    const agentToolBlock = assistantResponse.querySelector<HTMLDivElement>(
      '.tool-output-block.agent-message-exchange',
    );
    expect(agentToolBlock).not.toBeNull();
    if (!agentToolBlock) return;
    expect(agentToolBlock.dataset['toolCallId']).toBe('tc2');
    expect(agentToolBlock.dataset['messageId']).toBe('am1');
    expect(agentToolBlock.classList.contains('resolved')).toBe(true);

    // Check the agent callback result is rendered
    const agentOutputBody = agentToolBlock.querySelector<HTMLDivElement>(
      '.tool-output-output-body',
    );
    expect(agentOutputBody).not.toBeNull();
    expect(agentOutputBody?.textContent).toContain('Fixed null pointer on line 42');

    const assistantText = assistantResponse.querySelector<HTMLDivElement>('.assistant-text');
    expect(assistantText).not.toBeNull();
    expect(assistantText?.dataset['eventId']).toBe('e3');
    expect(assistantText?.textContent).toContain(
      "It's 72°F in Austin. The code agent fixed the bug.",
    );
  });

  it('renders voice_speak and voice_ask as speaker bubbles without generic tool chrome', () => {
    const container = document.createElement('div');
    container.className = 'chat-log';
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container, {
      getExpandToolOutput: () => true,
    });

    replayLegacyEvents(renderer, [
      createBaseEvent('turn_start', {
        id: 'e-turn',
        turnId: 't-voice',
        payload: { trigger: 'user' },
      }),
      createBaseEvent('tool_call', {
        id: 'e-speak',
        turnId: 't-voice',
        responseId: 'r-voice',
        payload: {
          toolCallId: 'tc-speak',
          toolName: 'voice_speak',
          args: { text: 'Checking the porch camera now.' },
        },
      }),
      createBaseEvent('tool_result', {
        id: 'e-speak-result',
        turnId: 't-voice',
        responseId: 'r-voice',
        payload: {
          toolCallId: 'tc-speak',
          result: { accepted: true },
        },
      }),
      createBaseEvent('tool_call', {
        id: 'e-ask',
        turnId: 't-voice',
        responseId: 'r-voice',
        payload: {
          toolCallId: 'tc-ask',
          toolName: 'voice_ask',
          args: { text: 'Do you want me to open the garage too?' },
        },
      }),
      createBaseEvent('tool_result', {
        id: 'e-ask-result',
        turnId: 't-voice',
        responseId: 'r-voice',
        payload: {
          toolCallId: 'tc-ask',
          result: { accepted: true },
        },
      }),
    ]);

    const bubbles = Array.from(container.querySelectorAll<HTMLDivElement>('.voice-tool-bubble'));
    expect(bubbles).toHaveLength(2);
    expect(bubbles[0]?.dataset['toolName']).toBe('voice_speak');
    expect(bubbles[0]?.textContent).toContain('Checking the porch camera now.');
    expect(bubbles[0]?.querySelector('.voice-tool-label')?.textContent).toBe('Speak');
    expect(bubbles[0]?.textContent).not.toContain('Voice Speak');
    expect(bubbles[0]?.textContent).not.toContain('accepted');
    expect(bubbles[1]?.dataset['toolName']).toBe('voice_ask');
    expect(bubbles[1]?.textContent).toContain('Do you want me to open the garage too?');
    expect(bubbles[1]?.querySelector('.voice-tool-label')?.textContent).toBe('Ask');
    expect(bubbles[1]?.textContent).not.toContain('Voice Ask');
    expect(bubbles[1]?.textContent).not.toContain('accepted');
    expect(container.querySelector('[data-tool-name="voice_speak"].tool-output-block')).toBeNull();
    expect(container.querySelector('[data-tool-name="voice_ask"].tool-output-block')).toBeNull();
  });

  it('renders voice tool failures inline on the speaker bubble', () => {
    const container = document.createElement('div');
    container.className = 'chat-log';
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container, {
      getExpandToolOutput: () => true,
    });

    replayLegacyEvents(renderer, [
      createBaseEvent('turn_start', {
        id: 'e-turn',
        turnId: 't-voice-error',
        payload: { trigger: 'user' },
      }),
      createBaseEvent('tool_call', {
        id: 'e-ask',
        turnId: 't-voice-error',
        responseId: 'r-voice-error',
        payload: {
          toolCallId: 'tc-ask',
          toolName: 'voice_ask',
          args: { text: 'Say that again?' },
        },
      }),
      createBaseEvent('tool_result', {
        id: 'e-ask-result',
        turnId: 't-voice-error',
        responseId: 'r-voice-error',
        payload: {
          toolCallId: 'tc-ask',
          result: { accepted: false },
          error: {
            code: 'invalid_args',
            message: 'Prompt text is required.',
          },
        },
      }),
    ]);

    const bubble = container.querySelector<HTMLDivElement>('.voice-tool-bubble');
    expect(bubble).not.toBeNull();
    expect(bubble?.classList.contains('error')).toBe(true);
    expect(bubble?.querySelector('.voice-tool-error')?.textContent).toContain(
      'Prompt text is required.',
    );
  });

  it('renders attachment_send as a dedicated bubble with download and open actions', () => {
    const container = document.createElement('div');
    container.className = 'chat-log';
    document.body.appendChild(container);

    const openSpy = vi
      .spyOn(attachmentActions, 'openHtmlAttachmentInBrowser')
      .mockResolvedValue(undefined);
    const downloadSpy = vi.spyOn(attachmentActions, 'downloadAttachment').mockResolvedValue();

    const renderer = new ChatRenderer(container, {
      getExpandToolOutput: () => true,
    });

    replayLegacyEvents(renderer, [
      createBaseEvent('turn_start', {
        id: 'e-turn',
        turnId: 't-attachment',
        payload: { trigger: 'user' },
      }),
      createBaseEvent('tool_call', {
        id: 'e-attachment-call',
        turnId: 't-attachment',
        responseId: 'r-attachment',
        payload: {
          toolCallId: 'tc-attachment',
          toolName: 'attachment_send',
          args: {
            fileName: 'report.html',
            title: 'Weekly Report',
            text: '<html><body>Hello</body></html>',
          },
        },
      }),
      createBaseEvent('tool_result', {
        id: 'e-attachment-result',
        turnId: 't-attachment',
        responseId: 'r-attachment',
        payload: {
          toolCallId: 'tc-attachment',
          result: {
            ok: true,
            attachment: {
              attachmentId: 'att-1',
              fileName: 'report.html',
              title: 'Weekly Report',
              contentType: 'text/html',
              size: 128,
              downloadUrl: '/api/attachments/session-1/att-1?download=1',
              openUrl: '/api/attachments/session-1/att-1',
              openMode: 'browser_blob',
              previewType: 'none',
            },
          },
        },
      }),
    ]);

    const bubble = container.querySelector<HTMLDivElement>('.attachment-tool-bubble');
    expect(bubble).not.toBeNull();
    expect(bubble?.textContent).toContain('Weekly Report');
    expect(bubble?.textContent).toContain('report.html');
    expect(bubble?.textContent).toContain('text/html');
    expect(bubble?.querySelector('.tool-output-block')).toBeNull();

    const downloadButton = bubble?.querySelector<HTMLButtonElement>('.attachment-tool-actions button');
    expect(downloadButton?.textContent).toBe('Download');
    expect(downloadButton?.className).toBe('attachment-tool-action-button');
    downloadButton?.click();
    expect(downloadSpy).toHaveBeenCalledWith('/api/attachments/session-1/att-1?download=1', 'report.html');

    const openButton = bubble?.querySelectorAll<HTMLButtonElement>('.attachment-tool-actions button')[1];
    expect(openButton?.textContent).toBe('Open');
    expect(openButton?.className).toBe('attachment-tool-action-button');
    openButton?.click();
    expect(openSpy).toHaveBeenCalledWith('/api/attachments/session-1/att-1', 'report.html');
  });

  it('renders attachment_send preview text and attachment errors inline', () => {
    const container = document.createElement('div');
    container.className = 'chat-log';
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container, {
      getExpandToolOutput: () => true,
    });

    replayLegacyEvents(renderer, [
      createBaseEvent('turn_start', {
        id: 'e-turn',
        turnId: 't-attachment-error',
        payload: { trigger: 'user' },
      }),
      createBaseEvent('tool_call', {
        id: 'e-attachment-call',
        turnId: 't-attachment-error',
        responseId: 'r-attachment-error',
        payload: {
          toolCallId: 'tc-attachment-error',
          toolName: 'attachment_send',
          args: {
            fileName: 'note.txt',
            text: 'hello',
          },
        },
      }),
      createBaseEvent('tool_result', {
        id: 'e-attachment-result',
        turnId: 't-attachment-error',
        responseId: 'r-attachment-error',
        payload: {
          toolCallId: 'tc-attachment-error',
          result: {
            ok: true,
            attachment: {
              attachmentId: 'att-2',
              fileName: 'note.txt',
              contentType: 'text/plain',
              size: 5,
              downloadUrl: '/api/attachments/session-1/att-2?download=1',
              previewType: 'text',
              previewText: 'hello',
            },
          },
        },
      }),
      createBaseEvent('tool_call', {
        id: 'e-attachment-call-2',
        turnId: 't-attachment-error',
        responseId: 'r-attachment-error',
        payload: {
          toolCallId: 'tc-attachment-error-2',
          toolName: 'attachment_send',
          args: {
            fileName: 'bad.txt',
            text: 'oops',
          },
        },
      }),
      createBaseEvent('tool_result', {
        id: 'e-attachment-result-2',
        turnId: 't-attachment-error',
        responseId: 'r-attachment-error',
        payload: {
          toolCallId: 'tc-attachment-error-2',
          result: {},
          error: {
            code: 'attachment_failed',
            message: 'Attachment storage failed.',
          },
        },
      }),
    ]);

    const bubbles = Array.from(container.querySelectorAll<HTMLDivElement>('.attachment-tool-bubble'));
    expect(bubbles).toHaveLength(2);
    expect(bubbles[0]?.querySelector('.attachment-tool-preview')?.textContent).toContain('hello');
    expect(bubbles[1]?.classList.contains('error')).toBe(true);
    expect(bubbles[1]?.querySelector('.attachment-tool-error')?.textContent).toContain(
      'Attachment storage failed.',
    );
  });

  it('shows truncated previews with an expand action and renders full text inline after fetch', async () => {
    const container = document.createElement('div');
    container.className = 'chat-log';
    document.body.appendChild(container);

    vi.spyOn(attachmentActions, 'downloadAttachment').mockResolvedValue();
    const fetchSpy = vi.spyOn(attachmentActions, 'fetchAttachmentTextContent').mockResolvedValue(
      'hello world and beyond',
    );

    const renderer = new ChatRenderer(container, {
      getExpandToolOutput: () => true,
    });

    replayLegacyEvents(renderer, [
      createBaseEvent('turn_start', {
        id: 'e-turn-truncated',
        turnId: 't-attachment-truncated',
        payload: { trigger: 'user' },
      }),
      createBaseEvent('tool_call', {
        id: 'e-attachment-call-truncated',
        turnId: 't-attachment-truncated',
        responseId: 'r-attachment-truncated',
        payload: {
          toolCallId: 'tc-attachment-truncated',
          toolName: 'attachment_send',
          args: {
            fileName: 'note.txt',
            text: 'hello world and beyond',
          },
        },
      }),
      createBaseEvent('tool_result', {
        id: 'e-attachment-result-truncated',
        turnId: 't-attachment-truncated',
        responseId: 'r-attachment-truncated',
        payload: {
          toolCallId: 'tc-attachment-truncated',
          result: {
            ok: true,
            attachment: {
              attachmentId: 'att-truncated',
              fileName: 'note.txt',
              contentType: 'text/plain',
              size: 22,
              downloadUrl: '/api/attachments/session-1/att-truncated?download=1',
              previewType: 'text',
              previewText: 'hello',
              previewTruncated: true,
            },
          },
        },
      }),
    ]);

    const bubble = container.querySelector<HTMLDivElement>('.attachment-tool-bubble');
    expect(bubble?.querySelector('.attachment-tool-preview')?.textContent).toContain('hello…');
    expect(bubble?.querySelector('.attachment-tool-preview')?.textContent).toContain(
      'Preview truncated. Expand to load the full attachment.',
    );

    const expandButton = bubble?.querySelector<HTMLButtonElement>('.attachment-tool-actions button');
    expect(expandButton?.textContent).toBe('Expand');
    expandButton?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchSpy).toHaveBeenCalledWith('/api/attachments/session-1/att-truncated');
    expect(bubble?.querySelector('.attachment-tool-preview')?.textContent).toContain(
      'hello world and beyond',
    );
    expect(bubble?.querySelector('.attachment-tool-preview')?.textContent).not.toContain(
      'Preview truncated. Expand to load the full attachment.',
    );
    expect(
      Array.from(bubble?.querySelectorAll<HTMLButtonElement>('.attachment-tool-actions button') ?? []).map(
        (button) => button.textContent,
      ),
    ).toEqual(['Collapse', 'Download']);

    const collapseButton = bubble?.querySelector<HTMLButtonElement>('.attachment-tool-actions button');
    expect(collapseButton?.textContent).toBe('Collapse');
    collapseButton?.click();

    expect(bubble?.querySelector('.attachment-tool-preview')?.textContent).toContain('hello…');
    expect(bubble?.querySelector('.attachment-tool-preview')?.textContent).toContain(
      'Preview truncated. Expand to load the full attachment.',
    );
    expect(
      Array.from(bubble?.querySelectorAll<HTMLButtonElement>('.attachment-tool-actions button') ?? []).map(
        (button) => button.textContent,
      ),
    ).toEqual(['Expand', 'Download']);
  });

  it('shows attachment expand failures inline and keeps the expand action available', async () => {
    const container = document.createElement('div');
    container.className = 'chat-log';
    document.body.appendChild(container);

    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(attachmentActions, 'downloadAttachment').mockResolvedValue();
    vi.spyOn(attachmentActions, 'fetchAttachmentTextContent').mockRejectedValue(new Error('boom'));

    const renderer = new ChatRenderer(container, {
      getExpandToolOutput: () => true,
    });

    replayLegacyEvents(renderer, [
      createBaseEvent('turn_start', {
        id: 'e-turn-expand-fail',
        turnId: 't-attachment-expand-fail',
        payload: { trigger: 'user' },
      }),
      createBaseEvent('tool_call', {
        id: 'e-attachment-call-expand-fail',
        turnId: 't-attachment-expand-fail',
        responseId: 'r-attachment-expand-fail',
        payload: {
          toolCallId: 'tc-attachment-expand-fail',
          toolName: 'attachment_send',
          args: {
            fileName: 'note.txt',
            text: 'hello world and beyond',
          },
        },
      }),
      createBaseEvent('tool_result', {
        id: 'e-attachment-result-expand-fail',
        turnId: 't-attachment-expand-fail',
        responseId: 'r-attachment-expand-fail',
        payload: {
          toolCallId: 'tc-attachment-expand-fail',
          result: {
            ok: true,
            attachment: {
              attachmentId: 'att-expand-fail',
              fileName: 'note.txt',
              contentType: 'text/plain',
              size: 22,
              downloadUrl: '/api/attachments/session-1/att-expand-fail?download=1',
              previewType: 'text',
              previewText: 'hello',
              previewTruncated: true,
            },
          },
        },
      }),
    ]);

    const bubble = container.querySelector<HTMLDivElement>('.attachment-tool-bubble');
    const expandButton = bubble?.querySelector<HTMLButtonElement>('.attachment-tool-actions button');
    expandButton?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(bubble?.querySelector('.attachment-tool-action-error')?.textContent).toContain(
      'Failed to expand attachment.',
    );
    expect(
      Array.from(bubble?.querySelectorAll<HTMLButtonElement>('.attachment-tool-actions button') ?? []).map(
        (button) => button.textContent,
      ),
    ).toEqual(['Expand', 'Download']);
  });

  it('shows attachment action failures inline without dropping the attachment bubble', async () => {
    const container = document.createElement('div');
    container.className = 'chat-log';
    document.body.appendChild(container);

    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(attachmentActions, 'downloadAttachment').mockResolvedValue();
    vi.spyOn(attachmentActions, 'openHtmlAttachmentInBrowser').mockRejectedValue(
      new Error('boom'),
    );

    const renderer = new ChatRenderer(container, {
      getExpandToolOutput: () => true,
    });

    replayLegacyEvents(renderer, [
      createBaseEvent('turn_start', {
        id: 'e-turn-open-fail',
        turnId: 't-open-fail',
        payload: { trigger: 'user' },
      }),
      createBaseEvent('tool_call', {
        id: 'e-attachment-call-open-fail',
        turnId: 't-open-fail',
        responseId: 'r-open-fail',
        payload: {
          toolCallId: 'tc-open-fail',
          toolName: 'attachment_send',
          args: {
            fileName: 'report.html',
            title: 'Weekly Report',
            text: '<html><body>Hello</body></html>',
          },
        },
      }),
      createBaseEvent('tool_result', {
        id: 'e-attachment-result-open-fail',
        turnId: 't-open-fail',
        responseId: 'r-open-fail',
        payload: {
          toolCallId: 'tc-open-fail',
          result: {
            ok: true,
            attachment: {
              attachmentId: 'att-open-fail',
              fileName: 'report.html',
              title: 'Weekly Report',
              contentType: 'text/html',
              size: 128,
              downloadUrl: '/api/attachments/session-1/att-open-fail?download=1',
              openUrl: '/api/attachments/session-1/att-open-fail',
              openMode: 'browser_blob',
              previewType: 'none',
            },
          },
        },
      }),
    ]);

    const bubble = container.querySelector<HTMLDivElement>('.attachment-tool-bubble');
    const openButton = bubble?.querySelectorAll<HTMLButtonElement>('.attachment-tool-actions button')[1];
    openButton?.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(bubble?.querySelector('.attachment-tool-action-error')?.textContent).toContain(
      'Failed to open attachment.',
    );
    expect(bubble?.querySelector('.attachment-tool-title')?.textContent).toContain('Weekly Report');
    expect(bubble?.querySelectorAll('.attachment-tool-actions button').length).toBe(2);
  });

  it('replays wrapped attachment tool results from persisted history', () => {
    const container = document.createElement('div');
    container.className = 'chat-log';
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container, {
      getExpandToolOutput: () => true,
    });

    replayLegacyEvents(renderer, [
      createBaseEvent('turn_start', {
        id: 'e-turn-history',
        turnId: 't-attachment-history',
        payload: { trigger: 'user' },
      }),
      createBaseEvent('tool_call', {
        id: 'e-attachment-call-history',
        turnId: 't-attachment-history',
        responseId: 'r-attachment-history',
        payload: {
          toolCallId: 'tc-attachment-history',
          toolName: 'attachment_send',
          args: {
            fileName: 'note.txt',
            text: 'hello',
          },
        },
      }),
      createBaseEvent('tool_result', {
        id: 'e-attachment-result-history',
        turnId: 't-attachment-history',
        responseId: 'r-attachment-history',
        payload: {
          toolCallId: 'tc-attachment-history',
          result: {
            ok: true,
            result: {
              ok: true,
              attachment: {
                attachmentId: 'att-history',
                fileName: 'note.txt',
                contentType: 'text/plain',
                size: 5,
                downloadUrl: '/api/attachments/session-1/att-history?download=1',
                previewType: 'text',
                previewText: 'hello',
              },
            },
          },
        },
      }),
    ]);

    const bubble = container.querySelector<HTMLDivElement>('.attachment-tool-bubble');
    expect(bubble).not.toBeNull();
    expect(bubble?.querySelector('.attachment-tool-preview')?.textContent).toContain('hello');
    expect(bubble?.querySelector('.attachment-tool-error')).toBeNull();
  });

  it('replays stringified attachment tool results nested under content wrappers', () => {
    const container = document.createElement('div');
    container.className = 'chat-log';
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container, {
      getExpandToolOutput: () => true,
    });

    replayLegacyEvents(renderer, [
      createBaseEvent('turn_start', {
        id: 'e-turn-history-content',
        turnId: 't-attachment-history-content',
        payload: { trigger: 'user' },
      }),
      createBaseEvent('tool_call', {
        id: 'e-attachment-call-history-content',
        turnId: 't-attachment-history-content',
        responseId: 'r-attachment-history-content',
        payload: {
          toolCallId: 'tc-attachment-history-content',
          toolName: 'attachment_send',
          args: {
            fileName: 'note.txt',
            text: 'hello',
          },
        },
      }),
      createBaseEvent('tool_result', {
        id: 'e-attachment-result-history-content',
        turnId: 't-attachment-history-content',
        responseId: 'r-attachment-history-content',
        payload: {
          toolCallId: 'tc-attachment-history-content',
          result: {
            content:
              '{"ok":true,"result":{"ok":true,"attachment":{"attachmentId":"att-history-content","fileName":"note.txt","contentType":"text/plain","size":5,"downloadUrl":"/api/attachments/session-1/att-history-content?download=1","previewType":"text","previewText":"hello"}}}',
          },
        },
      }),
    ]);

    const bubble = container.querySelector<HTMLDivElement>('.attachment-tool-bubble');
    expect(bubble).not.toBeNull();
    expect(bubble?.querySelector('.attachment-tool-preview')?.textContent).toContain('hello');
    expect(bubble?.querySelector('.attachment-tool-error')).toBeNull();
  });

  it('renders user_audio as a user bubble with microphone styling', () => {
    const container = document.createElement('div');
    container.className = 'chat-log';
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container);

    renderLegacyEvent(renderer, 
      createBaseEvent('turn_start', {
        id: 'e-audio-turn-start',
        turnId: 't-audio',
        payload: { trigger: 'user' },
      }),
    );

    renderLegacyEvent(renderer, 
      createBaseEvent('user_audio', {
        id: 'e-audio',
        turnId: 't-audio',
        responseId: undefined,
        payload: {
          transcription: 'Call Sam when I get home.',
          durationMs: 2400,
        },
      }),
    );

    const bubble = container.querySelector<HTMLDivElement>('.message.user.user-audio');
    expect(bubble).not.toBeNull();
    expect(bubble?.dataset['inputType']).toBe('audio');
    expect(bubble?.textContent).toContain('Call Sam when I get home.');
    expect(
      bubble?.querySelector('.message-avatar.user-audio-avatar .voice-event-icon-microphone'),
    ).not.toBeNull();
    expect(container.querySelector('.chat-typing-indicator')?.classList.contains('visible')).toBe(
      true,
    );
  });

  it('strips the context line from rendered user_audio bubbles', () => {
    const container = document.createElement('div');
    container.className = 'chat-log';
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container);

    renderLegacyEvent(renderer, 
      createBaseEvent('user_audio', {
        id: 'e-audio-context',
        turnId: 't-audio-context',
        responseId: undefined,
        payload: {
          transcription: '<context panel-id="panel-1" />\nCall Sam when I get home.',
          durationMs: 2400,
        },
      }),
    );

    const bubble = container.querySelector<HTMLDivElement>('.message.user.user-audio');
    expect(bubble?.textContent).toContain('Call Sam when I get home.');
    expect(bubble?.textContent).not.toContain('<context');
  });

  it('shows the context line in rendered user_audio bubbles when debug context display is enabled', () => {
    (globalThis as { __ASSISTANT_HIDE_CONTEXT__?: boolean }).__ASSISTANT_HIDE_CONTEXT__ = false;

    const container = document.createElement('div');
    container.className = 'chat-log';
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container);

    renderLegacyEvent(renderer, 
      createBaseEvent('user_audio', {
        id: 'e-audio-context-visible',
        turnId: 't-audio-context-visible',
        responseId: undefined,
        payload: {
          transcription: '<context panel-id="panel-1" />\nCall Sam when I get home.',
          durationMs: 2400,
        },
      }),
    );

    const bubble = container.querySelector<HTMLDivElement>('.message.user.user-audio');
    expect(bubble?.textContent).toContain('<context panel-id="panel-1" />');
    expect(bubble?.textContent).toContain('Call Sam when I get home.');

    delete (globalThis as { __ASSISTANT_HIDE_CONTEXT__?: boolean }).__ASSISTANT_HIDE_CONTEXT__;
  });

  it('shows the typing indicator for live voice tool bubbles', () => {
    const container = document.createElement('div');
    container.className = 'chat-log';
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container);

    renderLegacyEvent(renderer, 
      createBaseEvent('turn_start', {
        id: 'e-voice-live-turn-start',
        turnId: 't-voice-live',
        payload: { trigger: 'user' },
      }),
    );

    renderLegacyEvent(renderer, 
      createBaseEvent('tool_call', {
        id: 'e-voice-live',
        turnId: 't-voice-live',
        responseId: 'r-voice-live',
        payload: {
          toolCallId: 'tc-voice-live',
          toolName: 'voice_ask',
          args: { text: 'Are you still there?' },
        },
      }),
    );

    expect(container.querySelector('.voice-tool-bubble')?.textContent).toContain(
      'Are you still there?',
    );
    expect(container.querySelector('.chat-typing-indicator')?.classList.contains('visible')).toBe(
      true,
    );
  });

  it('renders a request divider with the request timestamp', () => {
    const container = document.createElement('div');
    container.className = 'chat-log';
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container);
    const timestamp = new Date('2026-03-29T15:26:00.000Z').getTime();

    renderLegacyEvent(renderer, 
      createBaseEvent('turn_start', {
        id: 'e-turn',
        turnId: 't-turn',
        timestamp,
        payload: { trigger: 'user' },
      }),
    );

    renderLegacyEvent(renderer, 
      createBaseEvent('user_message', {
        id: 'e-user',
        turnId: 't-turn',
        timestamp: timestamp + 1,
        responseId: undefined,
        payload: { text: 'Hello' },
      }),
    );

    const turn = container.querySelector<HTMLDivElement>('.turn');
    expect(turn).not.toBeNull();
    const divider = turn?.querySelector<HTMLDivElement>(':scope > .turn-divider');
    expect(divider).not.toBeNull();
    expect(divider?.querySelectorAll('.turn-divider-line')).toHaveLength(2);
    expect(divider?.querySelector<HTMLElement>('.turn-divider-label')?.textContent).toBe(
      new Intl.DateTimeFormat(undefined, {
        hour: 'numeric',
        minute: '2-digit',
      }).format(new Date(timestamp)),
    );
  });

  it('invokes the request divider action handler with surrounding request context', () => {
    const container = document.createElement('div');
    container.className = 'chat-log';
    document.body.appendChild(container);

    const onRequestDividerActivate = vi.fn();
    const renderer = new ChatRenderer(container);
    renderer.setRequestDividerActionHandler(onRequestDividerActivate);

    renderLegacyEvent(renderer, 
      createBaseEvent('turn_start', {
        id: 'e-turn-1',
        turnId: 't-turn-1',
        timestamp: new Date('2026-03-29T15:20:00.000Z').getTime(),
        payload: { trigger: 'user' },
      }),
    );
    renderLegacyEvent(renderer, 
      createBaseEvent('user_message', {
        id: 'e-user-1',
        turnId: 't-turn-1',
        payload: { text: 'First' },
      }),
    );
    renderLegacyEvent(renderer, 
      createBaseEvent('turn_start', {
        id: 'e-turn-2',
        turnId: 't-turn-2',
        timestamp: new Date('2026-03-29T15:26:00.000Z').getTime(),
        payload: { trigger: 'user' },
      }),
    );
    renderLegacyEvent(renderer, 
      createBaseEvent('user_message', {
        id: 'e-user-2',
        turnId: 't-turn-2',
        payload: { text: 'Second' },
      }),
    );

    const secondTurnDividerButton = container.querySelector<HTMLButtonElement>(
      '.turn[data-turn-id="t-turn-2"] .turn-divider-button',
    );
    expect(secondTurnDividerButton).not.toBeNull();

    secondTurnDividerButton?.click();

    expect(onRequestDividerActivate).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 't-turn-2',
        anchorEl: secondTurnDividerButton,
        hasBefore: true,
        hasAfter: false,
      }),
    );
  });

  it('groups contiguous tool calls within the same segment', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container, {
      getExpandToolOutput: () => true,
    });

    renderLegacyEvent(renderer, 
      createBaseEvent('tool_call', {
        id: 'e1',
        payload: {
          toolCallId: 'tc1',
          toolName: 'bash',
          args: { command: 'echo first' },
        },
      }),
    );

    renderLegacyEvent(renderer, 
      createBaseEvent('tool_call', {
        id: 'e2',
        payload: {
          toolCallId: 'tc2',
          toolName: 'bash',
          args: { command: 'echo second' },
        },
      }),
    );

    const group = container.querySelector<HTMLDivElement>('.tool-call-group');
    expect(group).not.toBeNull();
    expect(group?.dataset['status']).toBe('running');

    const countEl = group?.querySelector<HTMLSpanElement>('.tool-call-group-count');
    expect(countEl?.textContent).toBe('2 calls');

    const summaryEl = group?.querySelector<HTMLSpanElement>('.tool-call-group-summary');
    expect(summaryEl?.textContent).toContain('echo second');

    const blocks = group?.querySelectorAll<HTMLDivElement>(
      ':scope > .tool-call-group-content > .tool-output-block',
    );
    expect(blocks).toHaveLength(2);
  });

  it('renders commentary and final assistant text as separate segments', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container, {
      getExpandToolOutput: () => true,
    });

    replayLegacyEvents(renderer, [
      createBaseEvent('assistant_done', {
        id: 'e-commentary',
        payload: {
          text: 'Let me check.',
          phase: 'commentary',
          textSignature: '{"v":1,"id":"msg-commentary","phase":"commentary"}',
        },
      }),
      createBaseEvent('assistant_done', {
        id: 'e-final',
        payload: {
          text: 'All set.',
          phase: 'final_answer',
          textSignature: '{"v":1,"id":"msg-final","phase":"final_answer"}',
        },
      }),
    ]);

    const segments = Array.from(
      container.querySelectorAll<HTMLDivElement>('.assistant-response .assistant-text'),
    ).map((element) => ({
      phase: element.dataset['phase'],
      text: element.textContent?.trim(),
    }));

    expect(segments).toEqual([
      { phase: 'commentary', text: 'Let me check.' },
      { phase: 'final_answer', text: 'All set.' },
    ]);
  });

  it('formats tool_result content arrays as tool output', () => {
    const container = document.createElement('div');
    container.className = 'chat-log';
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container, {
      getExpandToolOutput: () => true,
    });

    renderLegacyEvent(renderer, 
      createBaseEvent('tool_call', {
        id: 'e1',
        payload: {
          toolCallId: 'tc1',
          toolName: 'bash',
          args: { command: 'echo hi' },
        },
      }),
    );

    renderLegacyEvent(renderer, 
      createBaseEvent('tool_result', {
        id: 'e2',
        payload: {
          toolCallId: 'tc1',
          result: [
            { type: 'text', text: 'line 1\n' },
            { type: 'text', text: 'line 2\n' },
          ],
        },
      }),
    );

    const toolBlock = container.querySelector<HTMLDivElement>('[data-tool-call-id="tc1"]');
    expect(toolBlock).not.toBeNull();
    if (!toolBlock) return;

    const outputBody = toolBlock.querySelector<HTMLDivElement>('.tool-output-output-body');
    expect(outputBody?.textContent).toContain('line 1');
    expect(outputBody?.textContent).toContain('line 2');

    const jsonToggle = toolBlock.querySelector<HTMLButtonElement>('.tool-output-json-toggle');
    expect(jsonToggle).not.toBeNull();
  });

  it('does not group agents_message tool calls', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container, {
      getExpandToolOutput: () => true,
    });

    renderLegacyEvent(renderer, 
      createBaseEvent('tool_call', {
        id: 'e1',
        payload: {
          toolCallId: 'tc1',
          toolName: 'agents_message',
          args: {
            agentId: 'planner',
            content: 'Summarize the plan.',
          },
        },
      }),
    );

    renderLegacyEvent(renderer, 
      createBaseEvent('tool_call', {
        id: 'e2',
        payload: {
          toolCallId: 'tc2',
          toolName: 'agents_message',
          args: {
            agentId: 'qa',
            content: 'Run the tests.',
          },
        },
      }),
    );

    expect(container.querySelector('.tool-call-group')).toBeNull();
    const blocks = container.querySelectorAll<HTMLDivElement>(
      '.tool-output-block.agent-message-exchange',
    );
    expect(blocks).toHaveLength(2);
  });

  it('reports active output for typing indicators and pending tools', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container, {
      getExpandToolOutput: () => true,
    });

    expect(renderer.hasActiveOutput()).toBe(false);

    renderer.showTypingIndicator();
    expect(renderer.hasActiveOutput()).toBe(true);

    renderer.hideTypingIndicator();
    expect(renderer.hasActiveOutput()).toBe(false);

    renderLegacyEvent(renderer, 
      createBaseEvent('tool_call', {
        id: 'e1',
        payload: {
          toolCallId: 'tc1',
          toolName: 'bash',
          args: { command: 'echo test' },
        },
      }),
    );
    expect(renderer.hasActiveOutput()).toBe(true);

    renderer.markOutputCancelled();
    expect(renderer.hasActiveOutput()).toBe(false);

    renderLegacyEvent(renderer, 
      createBaseEvent('tool_result', {
        id: 'e2',
        payload: {
          toolCallId: 'tc1',
          result: 'done',
        },
      }),
    );
    expect(renderer.hasActiveOutput()).toBe(false);
  });

  it('clears active output state when replaying history', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container);

    renderer.showTypingIndicator();
    expect(renderer.hasActiveOutput()).toBe(true);

    replayLegacyEvents(renderer, [
      createBaseEvent('assistant_done', {
        id: 'e-final',
        payload: {
          text: 'Completed earlier.',
        },
      }),
    ]);

    expect(renderer.hasActiveOutput()).toBe(false);
    expect(container.querySelector('.chat-typing-indicator.visible')).toBeNull();
  });

  it('shows the typing indicator immediately on turn_start and clears it on turn_end', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container);

    renderLegacyEvent(renderer, 
      createBaseEvent('turn_start', {
        id: 'turn-1',
        turnId: 'turn-1',
        payload: { trigger: 'user' },
      }),
    );

    expect(container.querySelector('.chat-typing-indicator')?.classList.contains('visible')).toBe(
      true,
    );

    renderLegacyEvent(renderer, 
      createBaseEvent('turn_end', {
        id: 'turn-1-end',
        turnId: 'turn-1',
        payload: {},
      }),
    );

    expect(container.querySelector('.chat-typing-indicator')?.classList.contains('visible')).toBe(
      false,
    );
  });

  it('restores typing indicator after replay when the latest turn is still active', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container);

    replayLegacyEvents(renderer, [
      createBaseEvent('turn_start', {
        id: 'turn-replay',
        turnId: 'turn-replay',
        payload: { trigger: 'user' },
      }),
      createBaseEvent('user_audio', {
        id: 'turn-replay-audio',
        turnId: 'turn-replay',
        responseId: undefined,
        payload: {
          transcription: 'Testing live replay state.',
          durationMs: 1200,
        },
      }),
    ]);

    expect(container.querySelector('.chat-typing-indicator')?.classList.contains('visible')).toBe(
      true,
    );
  });

  it('reports active output after replay when the latest turn is still active', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container);

    replayLegacyEvents(renderer, [
      createBaseEvent('turn_start', {
        id: 'turn-replay',
        turnId: 'turn-replay',
        payload: { trigger: 'user' },
      }),
      createBaseEvent('user_message', {
        id: 'turn-replay-message',
        turnId: 'turn-replay',
        payload: { text: 'sleep 10' },
      }),
      createBaseEvent('tool_call', {
        id: 'turn-replay-tool',
        turnId: 'turn-replay',
        responseId: 'resp-replay',
        payload: {
          toolCallId: 'call-replay',
          toolName: 'shell_command',
          args: { command: 'sleep 10' },
        },
      }),
    ]);

    expect(renderer.hasActiveOutput()).toBe(true);
  });

  it('keeps typing indicator active while interaction is pending within an active turn', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container);

    renderLegacyEvent(renderer, 
      createBaseEvent('turn_start', {
        id: 'turn-pending',
        turnId: 'turn-pending',
        payload: { trigger: 'user' },
      }),
    );

    renderLegacyEvent(renderer, 
      createBaseEvent('interaction_pending', {
        id: 'pending-1',
        turnId: 'turn-pending',
        responseId: undefined,
        payload: {
          toolCallId: 'tc1',
          toolName: 'questions_ask',
          pending: true,
          presentation: 'questionnaire',
        },
      }),
    );

    expect(container.querySelector('.chat-typing-indicator')?.classList.contains('visible')).toBe(
      true,
    );
  });

  it('shows agent attribution for user_message events from agents', () => {
    const container = document.createElement('div');
    container.className = 'chat-log';
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container, {
      getAgentDisplayName: () => 'Source Agent',
    });

    replayLegacyEvents(renderer, [
      createBaseEvent('turn_start', {
        id: 'e0',
        turnId: 't1',
        payload: { trigger: 'system' },
      }),
      createBaseEvent('user_message', {
        id: 'e1',
        turnId: 't1',
        responseId: undefined,
        payload: { text: 'Please summarize this', fromAgentId: 'source' },
      }),
    ]);

    const userMessage = container.querySelector<HTMLDivElement>('.message.user');
    expect(userMessage).not.toBeNull();
    if (!userMessage) return;

    expect(userMessage.classList.contains('agent-message')).toBe(true);
    const label = userMessage.querySelector<HTMLDivElement>('.agent-message-label');
    expect(label?.textContent).toBe('Message from Source Agent');
  });

  it('upgrades agents_message blocks created from tool_input_chunk', () => {
    const container = document.createElement('div');
    container.className = 'chat-log';
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container, {
      getAgentDisplayName: () => 'Coding Agent',
    });

    replayLegacyEvents(renderer, [
      createBaseEvent('turn_start', {
        id: 'e0',
        turnId: 't1',
        payload: { trigger: 'user' },
      }),
      createBaseEvent('tool_input_chunk', {
        id: 'e1',
        payload: {
          toolCallId: 'tc-agent',
          toolName: 'agents_message',
          chunk: '{"agentId":"coding","content":"Run tests"}',
          offset: 1,
        },
      }),
      createBaseEvent('tool_call', {
        id: 'e2',
        payload: {
          toolCallId: 'tc-agent',
          toolName: 'agents_message',
          args: {
            agentId: 'coding',
            content: 'Run tests',
          },
        },
      }),
      createBaseEvent('tool_result', {
        id: 'e3',
        payload: {
          toolCallId: 'tc-agent',
          result: { response: 'Tests passed.' },
        },
      }),
    ]);

    const agentToolBlock = container.querySelector<HTMLDivElement>(
      '.tool-output-block.agent-message-exchange',
    );
    expect(agentToolBlock).not.toBeNull();

    const titleEl = agentToolBlock?.querySelector<HTMLElement>('.tool-output-title');
    expect(titleEl?.textContent).toBe('Coding Agent');
  });

  it('handles streaming assistant chunks before assistant_done', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container);

    renderLegacyEvent(renderer, 
      createBaseEvent('assistant_chunk', {
        id: 'e1',
        payload: { text: 'Hello ' },
      }),
    );
    renderLegacyEvent(renderer, 
      createBaseEvent('assistant_chunk', {
        id: 'e2',
        payload: { text: 'world' },
      }),
    );

    let assistantText = container.querySelector<HTMLDivElement>('.assistant-text');
    expect(assistantText).not.toBeNull();
    expect(assistantText?.textContent).toContain('Hello world');

    renderLegacyEvent(renderer, 
      createBaseEvent('assistant_done', {
        id: 'e3',
        payload: { text: 'Hello world!' },
      }),
    );

    assistantText = container.querySelector<HTMLDivElement>('.assistant-text');
    expect(assistantText).not.toBeNull();
    expect(assistantText?.dataset['eventId']).toBe('e3');
    expect(assistantText?.textContent).toContain('Hello world!');
  });

  it('renders markdown progressively while assistant chunks stream', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container);

    renderLegacyEvent(renderer, 
      createBaseEvent('assistant_chunk', {
        id: 'e1',
        payload: { text: 'Hello **wor' },
      }),
    );
    let assistantText = container.querySelector<HTMLDivElement>('.assistant-text');
    expect(assistantText?.querySelector('strong')?.textContent).toBe('wor');

    renderLegacyEvent(renderer, 
      createBaseEvent('assistant_chunk', {
        id: 'e2',
        payload: { text: 'ld**' },
      }),
    );

    assistantText = container.querySelector<HTMLDivElement>('.assistant-text');
    expect(assistantText?.querySelector('strong')?.textContent).toBe('world');
  });

  it('finalizes streamed assistant markdown before inserting a tool block', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container, {
      getExpandToolOutput: () => true,
    });

    renderLegacyEvent(renderer, 
      createBaseEvent('assistant_chunk', {
        id: 'e1',
        responseId: 'r1',
        payload: { text: 'Before **tool**' },
      }),
    );

    renderLegacyEvent(renderer, 
      createBaseEvent('tool_call', {
        id: 'e2',
        responseId: 'r1',
        payload: {
          toolCallId: 'tc-split',
          toolName: 'bash',
          args: { command: 'echo hi' },
        },
      }),
    );

    const assistantText = container.querySelector<HTMLDivElement>('.assistant-text');
    expect(assistantText).not.toBeNull();
    expect(assistantText?.querySelector('strong')?.textContent).toBe('tool');
  });

  it('does not duplicate a finalized segment when a tool split has no follow-up assistant chunk', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container, {
      getExpandToolOutput: () => true,
    });

    renderLegacyEvent(renderer, 
      createBaseEvent('assistant_chunk', {
        id: 'e1',
        responseId: 'r1',
        payload: { text: 'Before tool' },
      }),
    );

    renderLegacyEvent(renderer, 
      createBaseEvent('tool_call', {
        id: 'e2',
        responseId: 'r1',
        payload: {
          toolCallId: 'tc-split',
          toolName: 'bash',
          args: { command: 'echo hi' },
        },
      }),
    );

    renderLegacyEvent(renderer, 
      createBaseEvent('assistant_done', {
        id: 'e3',
        responseId: 'r1',
        payload: { text: 'Before tool' },
      }),
    );

    const assistantTexts = container.querySelectorAll<HTMLDivElement>('.assistant-text');
    expect(assistantTexts).toHaveLength(1);
    expect(assistantTexts[0]?.textContent).toContain('Before tool');
  });

  it('finalizes the current streamed segment when assistant_done matches the same stream', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container);

    renderLegacyEvent(renderer, 
      createBaseEvent('assistant_chunk', {
        id: 'e1',
        responseId: 'r1',
        payload: { text: 'Drink water', phase: 'final_answer' },
      }),
    );
    renderLegacyEvent(renderer, 
      createBaseEvent('assistant_chunk', {
        id: 'e2',
        responseId: 'r1',
        payload: { text: ' now', phase: 'final_answer' },
      }),
    );
    renderLegacyEvent(renderer, 
      createBaseEvent('assistant_done', {
        id: 'e3',
        responseId: 'r1',
        payload: { text: 'Drink water now' },
      }),
    );

    const assistantTexts = container.querySelectorAll<HTMLDivElement>('.assistant-text');
    expect(assistantTexts).toHaveLength(1);
    expect(assistantTexts[0]?.dataset['eventId']).toBe('e3');
    expect(assistantTexts[0]?.dataset['phase']).toBe('final_answer');
    expect(assistantTexts[0]?.textContent).toContain('Drink water now');
  });

  it('renders interrupt indicators on the active turn', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container);

    renderLegacyEvent(renderer, 
      createBaseEvent('turn_start', {
        id: 'e0',
        turnId: 't-turn',
        payload: { trigger: 'user' },
      }),
    );

    renderLegacyEvent(renderer, 
      createBaseEvent('interrupt', {
        id: 'e1',
        turnId: 't-turn',
        payload: { reason: 'user_cancel' },
      }),
    );

    const turn = container.querySelector<HTMLDivElement>('.turn');
    expect(turn).not.toBeNull();
    if (!turn) return;

    const indicator = turn.querySelector<HTMLDivElement>('.message-interrupted');
    expect(indicator).not.toBeNull();
    expect(indicator?.dataset['eventId']).toBe('e1');
    expect(indicator?.textContent).toContain('Interrupted');
  });

  it('clears DOM and internal state on clear', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container);

    renderLegacyEvent(renderer, 
      createBaseEvent('user_message', {
        id: 'e1',
        turnId: 't1',
        responseId: undefined,
        payload: { text: 'Hello' },
      }),
    );

    expect(container.querySelector('.message.user')).not.toBeNull();

    renderer.clear();

    expect(container.innerHTML).toBe('');
    expect(container.querySelector('.message.user')).toBeNull();

    // Rendering after clear should work normally again.
    renderLegacyEvent(renderer, 
      createBaseEvent('user_message', {
        id: 'e2',
        turnId: 't2',
        responseId: undefined,
        payload: { text: 'Hello again' },
      }),
    );
    expect(container.querySelector('.message.user')).not.toBeNull();
  });

  it('accumulates tool_output_chunk events and updates tool block', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container, {
      getExpandToolOutput: () => true,
    });

    // First, render the tool_call
    renderLegacyEvent(renderer, 
      createBaseEvent('tool_call', {
        id: 'e1',
        payload: {
          toolCallId: 'tc1',
          toolName: 'bash',
          args: { command: 'echo hello' },
        },
      }),
    );

    const toolBlock = container.querySelector<HTMLDivElement>('[data-tool-call-id="tc1"]');
    expect(toolBlock).not.toBeNull();
    expect(toolBlock?.classList.contains('pending')).toBe(true);

    // Stream some output chunks
    renderLegacyEvent(renderer, 
      createBaseEvent('tool_output_chunk', {
        id: 'e2',
        payload: {
          toolCallId: 'tc1',
          toolName: 'bash',
          chunk: 'hello',
          offset: 5,
        },
      }) as ChatEvent,
    );

    expect(toolBlock?.classList.contains('streaming')).toBe(true);
    // Re-query outputBody since updateToolOutputBlockContent recreates it
    let outputBody = toolBlock?.querySelector('.tool-output-output-body');
    expect(outputBody?.textContent).toContain('hello');

    // Stream more output
    renderLegacyEvent(renderer, 
      createBaseEvent('tool_output_chunk', {
        id: 'e3',
        payload: {
          toolCallId: 'tc1',
          toolName: 'bash',
          chunk: ' world',
          offset: 11,
        },
      }) as ChatEvent,
    );

    // Re-query outputBody since it was recreated
    outputBody = toolBlock?.querySelector('.tool-output-output-body');
    expect(outputBody?.textContent).toContain('hello world');

    // Complete the tool
    renderLegacyEvent(renderer, 
      createBaseEvent('tool_result', {
        id: 'e4',
        payload: {
          toolCallId: 'tc1',
          result: 'hello world\n',
        },
      }),
    );

    expect(toolBlock?.classList.contains('streaming')).toBe(false);
    expect(toolBlock?.classList.contains('success')).toBe(true);
  });

  it('applies buffered tool_output_chunk output when tool_call arrives later', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container, {
      getExpandToolOutput: () => true,
    });

    renderLegacyEvent(renderer, 
      createBaseEvent('tool_output_chunk', {
        id: 'e1',
        payload: {
          toolCallId: 'tc1',
          toolName: 'bash',
          chunk: 'hello',
          offset: 5,
        },
      }) as ChatEvent,
    );

    expect(container.querySelector('.tool-output-block')).toBeNull();

    renderLegacyEvent(renderer, 
      createBaseEvent('tool_call', {
        id: 'e2',
        payload: {
          toolCallId: 'tc1',
          toolName: 'bash',
          args: { command: 'echo hello' },
        },
      }),
    );

    const toolBlock = container.querySelector<HTMLDivElement>('.tool-output-block');
    expect(toolBlock).not.toBeNull();
    const outputBody = toolBlock?.querySelector('.tool-output-output-body');
    expect(outputBody?.textContent).toContain('hello');
    expect(toolBlock?.classList.contains('streaming')).toBe(true);
  });

  it('renders standalone questionnaire interactions and marks them complete', () => {
    const container = document.createElement('div');
    container.className = 'chat-log';
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container);

    const events: ChatEvent[] = [
      createBaseEvent('turn_start', {
        id: 'e0',
        turnId: 't1',
        payload: { trigger: 'user' },
      }),
      createBaseEvent('interaction_request', {
        id: 'e1',
        payload: {
          toolCallId: 'tc1',
          toolName: 'ask_user',
          interactionId: 'i1',
          interactionType: 'input',
          presentation: 'questionnaire',
          inputSchema: {
            title: 'Quick question',
            fields: [{ id: 'answer', type: 'text', label: 'Answer', required: true }],
          },
        },
      }),
      createBaseEvent('interaction_response', {
        id: 'e2',
        payload: {
          toolCallId: 'tc1',
          interactionId: 'i1',
          action: 'submit',
          input: { answer: 'hello' },
        },
      }),
    ];

    replayLegacyEvents(renderer, events);

    const interaction = container.querySelector<HTMLElement>('.interaction-standalone');
    expect(interaction).not.toBeNull();
    expect(interaction?.classList.contains('interaction-complete')).toBe(true);
  });

  it('renders async questionnaire lifecycle events and applies reprompt values', () => {
    const container = document.createElement('div');
    container.className = 'chat-log';
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container);

    const events: ChatEvent[] = [
      createBaseEvent('questionnaire_request', {
        id: 'q1',
        payload: {
          questionnaireRequestId: 'qr1',
          toolCallId: 'tc1',
          toolName: 'questions_ask',
          mode: 'async',
          prompt: 'Tell me about yourself',
          schema: {
            title: 'Profile',
            fields: [{ id: 'name', type: 'text', label: 'Name', required: true }],
          },
          status: 'pending',
          createdAt: '2026-03-29T12:00:00.000Z',
        },
      }),
      createBaseEvent('questionnaire_reprompt', {
        id: 'q2',
        payload: {
          questionnaireRequestId: 'qr1',
          toolCallId: 'tc1',
          status: 'pending',
          updatedAt: '2026-03-29T12:01:00.000Z',
          errorSummary: 'Please correct the highlighted fields.',
          fieldErrors: { name: 'This field is required.' },
          initialValues: { name: 'Ada' },
        },
      }),
      createBaseEvent('questionnaire_submission', {
        id: 'q3',
        payload: {
          questionnaireRequestId: 'qr1',
          toolCallId: 'tc1',
          status: 'submitted',
          submittedAt: '2026-03-29T12:02:00.000Z',
          interactionId: 'i1',
          answers: { name: 'Ada' },
        },
      }),
    ];

    replayLegacyEvents(renderer, events);

    const interaction = container.querySelector<HTMLElement>(
      '[data-questionnaire-request-id="qr1"]',
    );
    expect(interaction).not.toBeNull();
    expect(interaction?.classList.contains('interaction-complete')).toBe(true);
    expect(interaction?.textContent).toContain('Submitted');
    const input = interaction?.querySelector<HTMLInputElement>('[data-field-id="name"]');
    expect(input?.value).toBe('Ada');
    expect(input?.disabled).toBe(true);
  });

  it('replays completed async questionnaires as submitted even if events arrive out of order', () => {
    const container = document.createElement('div');
    container.className = 'chat-log';
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container);

    replayLegacyEvents(renderer, [
      createBaseEvent('questionnaire_submission', {
        id: 'q-submitted',
        payload: {
          questionnaireRequestId: 'qr1',
          toolCallId: 'tc1',
          status: 'submitted',
          submittedAt: '2026-03-29T12:02:00.000Z',
          interactionId: 'i1',
          answers: { name: 'Ada' },
        },
      }),
      createBaseEvent('questionnaire_request', {
        id: 'q-request',
        payload: {
          questionnaireRequestId: 'qr1',
          toolCallId: 'tc1',
          toolName: 'questions_ask',
          mode: 'async',
          schema: {
            title: 'Profile',
            fields: [{ id: 'name', type: 'text', label: 'Name', required: true }],
          },
          status: 'pending',
          createdAt: '2026-03-29T12:00:00.000Z',
        },
      }),
    ]);

    const interaction = container.querySelector<HTMLElement>(
      '[data-questionnaire-request-id="qr1"]',
    );
    expect(interaction?.classList.contains('interaction-complete')).toBe(true);
    expect(interaction?.textContent).toContain('Submitted');
    const input = interaction?.querySelector<HTMLInputElement>('[data-field-id="name"]');
    expect(input?.value).toBe('Ada');
    expect(input?.disabled).toBe(true);
  });

  it('renders questionnaire callbacks as user messages in the callback turn', () => {
    const container = document.createElement('div');
    container.className = 'chat-log';
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container);

    replayLegacyEvents(renderer, [
      createBaseEvent('questionnaire_request', {
        id: 'q-request',
        turnId: 't-request',
        responseId: undefined,
        payload: {
          questionnaireRequestId: 'qr1',
          toolCallId: 'tc1',
          toolName: 'questions_ask',
          mode: 'async',
          schema: {
            title: 'Profile',
            fields: [{ id: 'name', type: 'text', label: 'Name', required: true }],
          },
          status: 'pending',
          createdAt: '2026-03-29T12:00:00.000Z',
        },
      }),
      createBaseEvent('questionnaire_submission', {
        id: 'q-submitted',
        turnId: 't-request',
        responseId: undefined,
        payload: {
          questionnaireRequestId: 'qr1',
          toolCallId: 'tc1',
          status: 'submitted',
          submittedAt: '2026-03-29T12:02:00.000Z',
          interactionId: 'i1',
          answers: { name: 'Ada' },
        },
      }),
      createBaseEvent('turn_start', {
        id: 'cb-turn-start',
        turnId: 't-callback',
        responseId: undefined,
        payload: { trigger: 'callback' },
      }),
      createBaseEvent('agent_callback', {
        id: 'cb-1',
        turnId: 't-callback',
        responseId: undefined,
        payload: {
          messageId: 'qr1',
          fromAgentId: 'unknown',
          fromSessionId: 's1',
          result:
            '<questionnaire-response questionnaire-request-id="qr1" tool-call-id="tc1" tool="questions_ask" submitted-at="2026-03-29T12:02:00.000Z" answers-json="{&quot;name&quot;:&quot;Ada&quot;}" />',
        },
      }),
    ]);

    const callbackTurn = container.querySelector<HTMLElement>('.turn[data-turn-id="t-callback"]');
    expect(callbackTurn).not.toBeNull();
    const callbackIndicator = callbackTurn?.querySelector<HTMLElement>(
      '.questionnaire-submission-indicator',
    );
    expect(callbackIndicator?.textContent).toContain('Submitted questionnaire answers');
  });

  it('shows typing immediately after a live questionnaire callback message renders', () => {
    const container = document.createElement('div');
    container.className = 'chat-log';
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container);

    renderLegacyEvent(renderer, 
      createBaseEvent('turn_start', {
        id: 'cb-turn-start',
        turnId: 't-callback',
        responseId: undefined,
        payload: { trigger: 'callback' },
      }),
    );
    renderLegacyEvent(renderer, 
      createBaseEvent('agent_callback', {
        id: 'cb-1',
        turnId: 't-callback',
        responseId: undefined,
        payload: {
          messageId: 'qr1',
          fromAgentId: 'unknown',
          fromSessionId: 's1',
          result:
            '<questionnaire-response questionnaire-request-id="qr1" tool-call-id="tc1" tool="questions_ask" submitted-at="2026-03-29T12:02:00.000Z" answers-json="{&quot;name&quot;:&quot;Ada&quot;}" />',
        },
      }),
    );

    const callbackIndicator = container.querySelector<HTMLElement>(
      '.turn[data-turn-id="t-callback"] .questionnaire-submission-indicator',
    );
    expect(callbackIndicator?.textContent).toContain('Submitted questionnaire answers');
    expect(container.querySelector('.chat-typing-indicator.visible')).not.toBeNull();
  });

  it('submits async questionnaires through the dedicated websocket callbacks', () => {
    const container = document.createElement('div');
    container.className = 'chat-log';
    document.body.appendChild(container);

    const sendQuestionnaireSubmit = vi.fn();
    const renderer = new ChatRenderer(container, {
      sendQuestionnaireSubmit,
    });

    renderLegacyEvent(renderer, 
      createBaseEvent('questionnaire_request', {
        id: 'q1',
        payload: {
          questionnaireRequestId: 'qr1',
          toolCallId: 'tc1',
          toolName: 'questions_ask',
          mode: 'async',
          schema: {
            title: 'Profile',
            fields: [{ id: 'name', type: 'text', label: 'Name', required: true }],
          },
          status: 'pending',
          createdAt: '2026-03-29T12:00:00.000Z',
        },
      }),
    );

    const input = container.querySelector<HTMLInputElement>('[data-field-id="name"]');
    expect(input).not.toBeNull();
    if (!input) return;
    input.value = 'Ada';

    const form = container.querySelector<HTMLFormElement>('.interaction-form');
    expect(form).not.toBeNull();
    form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(sendQuestionnaireSubmit).toHaveBeenCalledWith({
      sessionId: 's1',
      questionnaireRequestId: 'qr1',
      answers: { name: 'Ada' },
    });
  });

  it('renders async questionnaire cancellations as completed interactions', () => {
    const container = document.createElement('div');
    container.className = 'chat-log';
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container);

    replayLegacyEvents(renderer, [
      createBaseEvent('questionnaire_request', {
        id: 'q1',
        payload: {
          questionnaireRequestId: 'qr1',
          toolCallId: 'tc1',
          toolName: 'questions_ask',
          mode: 'async',
          schema: {
            title: 'Profile',
            fields: [{ id: 'name', type: 'text', label: 'Name' }],
          },
          status: 'pending',
          createdAt: '2026-03-29T12:00:00.000Z',
        },
      }),
      createBaseEvent('questionnaire_update', {
        id: 'q2',
        payload: {
          questionnaireRequestId: 'qr1',
          toolCallId: 'tc1',
          status: 'cancelled',
          updatedAt: '2026-03-29T12:01:00.000Z',
          reason: 'User dismissed it',
        },
      }),
    ]);

    const interaction = container.querySelector<HTMLElement>(
      '[data-questionnaire-request-id="qr1"]',
    );
    expect(interaction?.classList.contains('interaction-complete')).toBe(true);
    expect(interaction?.textContent).toContain('User dismissed it');
  });

  it('renders tool calls and questionnaires without responseId', () => {
    const container = document.createElement('div');
    container.className = 'chat-log';
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container);

    const events: ChatEvent[] = [
      createBaseEvent('tool_call', {
        id: 'e1',
        responseId: undefined,
        payload: {
          toolCallId: 'tc1',
          toolName: 'ask_user',
          args: { prompt: 'Question?' },
        },
      }),
      createBaseEvent('interaction_request', {
        id: 'e2',
        responseId: undefined,
        payload: {
          toolCallId: 'tc1',
          toolName: 'ask_user',
          interactionId: 'i1',
          interactionType: 'input',
          presentation: 'questionnaire',
          inputSchema: {
            title: 'Quick question',
            fields: [{ id: 'answer', type: 'text', label: 'Answer', required: true }],
          },
        },
      }),
    ];

    replayLegacyEvents(renderer, events);

    expect(container.querySelector('.tool-output-block')).not.toBeNull();
    expect(container.querySelector('.interaction-standalone')).not.toBeNull();
  });

  it('inserts questionnaires after tool blocks even when responseId is missing', () => {
    const container = document.createElement('div');
    container.className = 'chat-log';
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container);

    const events: ChatEvent[] = [
      createBaseEvent('tool_call', {
        id: 'e1',
        payload: {
          toolCallId: 'tc1',
          toolName: 'ask_user',
          args: { prompt: 'Question?' },
        },
      }),
      createBaseEvent('assistant_done', {
        id: 'e2',
        payload: {
          text: 'Thanks, I will ask a question.',
        },
      }),
      createBaseEvent('interaction_request', {
        id: 'e3',
        responseId: undefined,
        payload: {
          toolCallId: 'tc1',
          toolName: 'ask_user',
          interactionId: 'i1',
          interactionType: 'input',
          presentation: 'questionnaire',
          inputSchema: {
            title: 'Quick question',
            fields: [{ id: 'answer', type: 'text', label: 'Answer', required: true }],
          },
        },
      }),
    ];

    replayLegacyEvents(renderer, events);

    const toolCalls = container.querySelector<HTMLDivElement>('.tool-calls');
    const interaction = container.querySelector<HTMLDivElement>('.interaction-standalone');
    const assistantText = container.querySelector<HTMLDivElement>('.assistant-text');

    expect(toolCalls).not.toBeNull();
    expect(interaction).not.toBeNull();
    expect(assistantText).not.toBeNull();
    expect(toolCalls?.contains(interaction!)).toBe(true);

    if (!toolCalls || !assistantText) return;
    const response = toolCalls.closest<HTMLDivElement>('.assistant-response');
    expect(response).not.toBeNull();
    if (!response) return;

    const children = Array.from(response.children);
    const toolIndex = children.indexOf(toolCalls);
    const textIndex = children.indexOf(assistantText);
    expect(toolIndex).toBeLessThan(textIndex);
  });

  it('ungroups questionnaire tool calls from preceding tool groups', () => {
    const container = document.createElement('div');
    container.className = 'chat-log';
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container);

    renderLegacyEvent(renderer, 
      createBaseEvent('tool_call', {
        id: 'e1',
        payload: {
          toolCallId: 'tc1',
          toolName: 'bash',
          args: { command: 'echo test' },
        },
      }),
    );
    renderLegacyEvent(renderer, 
      createBaseEvent('tool_call', {
        id: 'e2',
        payload: {
          toolCallId: 'tc2',
          toolName: 'questions_ask',
          args: { prompt: 'Ask?' },
        },
      }),
    );

    const grouped = container.querySelectorAll('.tool-call-group');
    expect(grouped.length).toBeGreaterThan(0);

    renderLegacyEvent(renderer, 
      createBaseEvent('interaction_request', {
        id: 'e3',
        payload: {
          toolCallId: 'tc2',
          toolName: 'questions_ask',
          interactionId: 'i1',
          interactionType: 'input',
          presentation: 'questionnaire',
          inputSchema: {
            title: 'Question',
            fields: [{ id: 'answer', type: 'text', label: 'Answer' }],
          },
        },
      }),
    );

    const groupContent = container.querySelector('.tool-call-group-content');
    if (groupContent) {
      expect(groupContent.querySelector('[data-tool-call-id="tc2"]')).toBeNull();
    }
    expect(container.querySelector('[data-tool-call-id="tc2"]')).not.toBeNull();
  });

  it('inserts tool call containers before later text segments', () => {
    const container = document.createElement('div');
    container.className = 'chat-log';
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container);
    const rendererWithInternals = renderer as unknown as {
      getOrCreateAssistantResponseContainer: (
        turnId: string,
        eventId: string,
        responseId: string,
      ) => HTMLDivElement;
      getOrCreateToolCallsContainer: (
        responseEl: HTMLDivElement,
        responseId: string,
      ) => HTMLDivElement;
    };
    const responseEl = rendererWithInternals.getOrCreateAssistantResponseContainer(
      't1',
      'e1',
      'r1',
    );

    const text0 = document.createElement('div');
    text0.className = 'assistant-text';
    text0.dataset['segment'] = '0';
    responseEl.appendChild(text0);

    const text1 = document.createElement('div');
    text1.className = 'assistant-text';
    text1.dataset['segment'] = '1';
    responseEl.appendChild(text1);

    const toolCalls = rendererWithInternals.getOrCreateToolCallsContainer(responseEl, 'r1');

    const children = Array.from(responseEl.children);
    const toolIndex = children.indexOf(toolCalls);
    const text0Index = children.indexOf(text0);
    const text1Index = children.indexOf(text1);

    expect(text0Index).toBeLessThan(toolIndex);
    expect(toolIndex).toBeLessThan(text1Index);
  });

  it('attaches approval interactions to tool blocks and tracks pending state', () => {
    const container = document.createElement('div');
    container.className = 'chat-log';
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container);

    const events: ChatEvent[] = [
      createBaseEvent('turn_start', {
        id: 'e0',
        turnId: 't1',
        payload: { trigger: 'user' },
      }),
      createBaseEvent('tool_call', {
        id: 'e1',
        payload: {
          toolCallId: 'tc1',
          toolName: 'dangerous_action',
          args: { confirm: true },
        },
      }),
      createBaseEvent('tool_call', {
        id: 'e2',
        payload: {
          toolCallId: 'tc2',
          toolName: 'secondary_action',
          args: { confirm: false },
        },
      }),
      createBaseEvent('interaction_request', {
        id: 'e3',
        payload: {
          toolCallId: 'tc1',
          toolName: 'dangerous_action',
          interactionId: 'i1',
          interactionType: 'approval',
          prompt: 'Allow this action?',
        },
      }),
    ];

    replayLegacyEvents(renderer, events);

    const toolBlock = container.querySelector<HTMLDivElement>('.tool-output-block');
    expect(toolBlock).not.toBeNull();
    if (!toolBlock) return;

    const dock = toolBlock.querySelector<HTMLDivElement>('.tool-interaction-dock');
    expect(dock).not.toBeNull();
    expect(dock?.querySelector('.interaction-approval')).not.toBeNull();
    expect(toolBlock.classList.contains('has-pending-interaction')).toBe(true);
    expect(toolBlock.classList.contains('has-pending-approval')).toBe(true);

    const group = container.querySelector<HTMLDivElement>('.tool-call-group');
    expect(group).toBeNull();

    renderLegacyEvent(renderer, 
      createBaseEvent('interaction_response', {
        id: 'e4',
        payload: {
          toolCallId: 'tc1',
          interactionId: 'i1',
          action: 'approve',
          approvalScope: 'once',
        },
      }),
    );

    const interaction = dock?.querySelector<HTMLElement>('.interaction-approval');
    expect(interaction?.classList.contains('interaction-complete')).toBe(true);
    expect(toolBlock.classList.contains('has-pending-interaction')).toBe(false);
    expect(toolBlock.classList.contains('has-pending-approval')).toBe(false);
    expect(group).toBeNull();
  });

  it('cancels approval interaction when the tool fails', () => {
    const container = document.createElement('div');
    container.className = 'chat-log';
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container);

    replayLegacyEvents(renderer, [
      createBaseEvent('tool_call', {
        id: 'e1',
        payload: {
          toolCallId: 'tc1',
          toolName: 'dangerous_action',
          args: { confirm: true },
        },
      }),
      createBaseEvent('interaction_request', {
        id: 'e2',
        payload: {
          toolCallId: 'tc1',
          toolName: 'dangerous_action',
          interactionId: 'i1',
          interactionType: 'approval',
          prompt: 'Allow this action?',
        },
      }),
      createBaseEvent('tool_result', {
        id: 'e3',
        payload: {
          toolCallId: 'tc1',
          error: { code: 'tool_error', message: 'Timed out' },
        },
      }),
    ]);

    const interaction = container.querySelector<HTMLElement>('.interaction-approval');
    expect(interaction).not.toBeNull();
    expect(interaction?.classList.contains('interaction-complete')).toBe(true);

    const summary = interaction?.querySelector<HTMLElement>('.interaction-summary');
    expect(summary?.textContent).toBe('Timed out');

    const toolBlock = container.querySelector<HTMLDivElement>('.tool-output-block');
    expect(toolBlock?.classList.contains('has-pending-approval')).toBe(false);
  });

  it('renders approval interaction on replay even without tool_call event', () => {
    const container = document.createElement('div');
    container.className = 'chat-log';
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container);

    replayLegacyEvents(renderer, [
      createBaseEvent('interaction_request', {
        id: 'e1',
        responseId: undefined,
        payload: {
          toolCallId: 'tc-approval',
          toolName: 'files_read',
          interactionId: 'i-approval',
          interactionType: 'approval',
          presentation: 'tool',
        },
      }),
    ]);

    const toolBlock = container.querySelector<HTMLDivElement>('.tool-output-block');
    expect(toolBlock).not.toBeNull();
    expect(toolBlock?.dataset['toolCallId']).toBe('tc-approval');
    expect(toolBlock?.querySelector('.interaction-approval')).not.toBeNull();
  });

  it('keeps approval tool calls out of tool-call groups', () => {
    const container = document.createElement('div');
    container.className = 'chat-log';
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container);

    replayLegacyEvents(renderer, [
      createBaseEvent('tool_call', {
        id: 'e1',
        payload: {
          toolCallId: 'tc1',
          toolName: 'primary_action',
          args: { confirm: true },
        },
      }),
      createBaseEvent('tool_call', {
        id: 'e2',
        payload: {
          toolCallId: 'tc2',
          toolName: 'dangerous_action',
          args: { confirm: true },
        },
      }),
      createBaseEvent('interaction_request', {
        id: 'e3',
        payload: {
          toolCallId: 'tc2',
          toolName: 'dangerous_action',
          interactionId: 'i-approval',
          interactionType: 'approval',
          prompt: 'Allow this action?',
        },
      }),
      createBaseEvent('tool_call', {
        id: 'e4',
        payload: {
          toolCallId: 'tc3',
          toolName: 'secondary_action',
          args: { confirm: false },
        },
      }),
    ]);

    const approvalBlock = container.querySelector<HTMLDivElement>('[data-tool-call-id="tc2"]');
    expect(approvalBlock).not.toBeNull();
    expect(approvalBlock?.closest('.tool-call-group')).toBeNull();

    const followUpBlock = container.querySelector<HTMLDivElement>('[data-tool-call-id="tc3"]');
    expect(followUpBlock).not.toBeNull();
    expect(followUpBlock?.closest('.tool-call-group')).toBeNull();
  });

  it('does not create a tool block for questionnaire tool_result without tool_call', () => {
    const container = document.createElement('div');
    container.className = 'chat-log';
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container);

    replayLegacyEvents(renderer, [
      createBaseEvent('interaction_request', {
        id: 'e1',
        responseId: undefined,
        payload: {
          toolCallId: 'tc-question',
          toolName: 'questions_ask',
          interactionId: 'i-question',
          interactionType: 'input',
          presentation: 'questionnaire',
          inputSchema: {
            title: 'Question',
            fields: [{ id: 'answer', type: 'text', label: 'Answer' }],
          },
        },
      }),
      createBaseEvent('tool_result', {
        id: 'e2',
        responseId: undefined,
        payload: {
          toolCallId: 'tc-question',
          result: { answers: { answer: 'ok' } },
        },
      }),
    ]);

    expect(
      container.querySelector('.tool-output-block[data-tool-call-id="tc-question"]'),
    ).toBeNull();
    expect(container.querySelector('.interaction-standalone')).not.toBeNull();
  });

  it('creates a new thinking block after tool calls', () => {
    const container = document.createElement('div');
    container.className = 'chat-log';
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container);

    const events: ChatEvent[] = [
      createBaseEvent('thinking_done', {
        id: 'e1',
        payload: { text: 'Planning...' },
      }),
      createBaseEvent('tool_call', {
        id: 'e2',
        payload: {
          toolCallId: 'tc1',
          toolName: 'bash',
          args: { command: 'ls' },
        },
      }),
      createBaseEvent('thinking_done', {
        id: 'e3',
        payload: { text: 'Next steps...' },
      }),
    ];

    replayLegacyEvents(renderer, events);

    const response = container.querySelector<HTMLDivElement>('.assistant-response');
    expect(response).not.toBeNull();
    if (!response) return;

    const thinkingBlocks = response.querySelectorAll<HTMLDivElement>('.thinking-content');
    expect(thinkingBlocks).toHaveLength(2);

    const toolContainer = response.querySelector<HTMLDivElement>('.tool-calls');
    expect(toolContainer).not.toBeNull();
    if (!toolContainer) return;

    const children = Array.from(response.children);
    const firstThinkingIndex = children.indexOf(thinkingBlocks[0]!);
    const toolIndex = children.indexOf(toolContainer);
    const secondThinkingIndex = children.indexOf(thinkingBlocks[1]!);
    expect(firstThinkingIndex).toBeLessThan(toolIndex);
    expect(toolIndex).toBeLessThan(secondThinkingIndex);
  });

  it('deduplicates chunks with same or lower offset', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container, {
      getExpandToolOutput: () => true,
    });

    renderLegacyEvent(renderer, 
      createBaseEvent('tool_call', {
        id: 'e1',
        payload: {
          toolCallId: 'tc1',
          toolName: 'bash',
          args: { command: 'echo test' },
        },
      }),
    );

    // First chunk
    renderLegacyEvent(renderer, 
      createBaseEvent('tool_output_chunk', {
        id: 'e2',
        payload: {
          toolCallId: 'tc1',
          toolName: 'bash',
          chunk: 'first',
          offset: 5,
        },
      }) as ChatEvent,
    );

    const toolBlock = container.querySelector<HTMLDivElement>('.tool-output-block');
    let outputBody = toolBlock?.querySelector('.tool-output-output-body');
    expect(outputBody?.textContent).toContain('first');

    // Duplicate chunk (same offset) - should be ignored
    renderLegacyEvent(renderer, 
      createBaseEvent('tool_output_chunk', {
        id: 'e3',
        payload: {
          toolCallId: 'tc1',
          toolName: 'bash',
          chunk: 'duplicate',
          offset: 5,
        },
      }) as ChatEvent,
    );

    // Re-query and content should not change
    outputBody = toolBlock?.querySelector('.tool-output-output-body');
    expect(outputBody?.textContent).not.toContain('duplicate');
    expect(outputBody?.textContent).toContain('first');

    // Stale chunk (lower offset) - should be ignored
    renderLegacyEvent(renderer, 
      createBaseEvent('tool_output_chunk', {
        id: 'e4',
        payload: {
          toolCallId: 'tc1',
          toolName: 'bash',
          chunk: 'stale',
          offset: 3,
        },
      }) as ChatEvent,
    );

    outputBody = toolBlock?.querySelector('.tool-output-output-body');
    expect(outputBody?.textContent).not.toContain('stale');

    // Valid next chunk (higher offset) - should be appended
    renderLegacyEvent(renderer, 
      createBaseEvent('tool_output_chunk', {
        id: 'e5',
        payload: {
          toolCallId: 'tc1',
          toolName: 'bash',
          chunk: 'second',
          offset: 11,
        },
      }) as ChatEvent,
    );

    // Re-query after update
    outputBody = toolBlock?.querySelector('.tool-output-output-body');
    expect(outputBody?.textContent).toContain('firstsecond');
  });

  it('streams tool input chunks and creates block early', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container, {
      getExpandToolOutput: () => true,
    });

    // First, create the response container via a turn_start
    renderLegacyEvent(renderer, 
      createBaseEvent('turn_start', {
        id: 't1',
        turnId: 'turn1',
        payload: { trigger: 'user' },
      }),
    );

    // Stream input chunks before tool_call arrives
    renderLegacyEvent(renderer, 
      createBaseEvent('tool_input_chunk', {
        id: 'e1',
        turnId: 'turn1',
        responseId: 'resp1',
        payload: {
          toolCallId: 'tc1',
          toolName: 'bash',
          chunk: '{"command":',
          offset: 11,
        },
      }) as ChatEvent,
    );

    // Block should be created
    let toolBlock = container.querySelector<HTMLDivElement>('.tool-output-block');
    expect(toolBlock).not.toBeNull();
    expect(toolBlock?.classList.contains('streaming-input')).toBe(true);

    // Stream more input
    renderLegacyEvent(renderer, 
      createBaseEvent('tool_input_chunk', {
        id: 'e2',
        turnId: 'turn1',
        responseId: 'resp1',
        payload: {
          toolCallId: 'tc1',
          toolName: 'bash',
          chunk: ' "echo hello"}',
          offset: 25,
        },
      }) as ChatEvent,
    );

    // Input section should have accumulated text
    const inputBody = toolBlock?.querySelector('.tool-output-input-body');
    expect(inputBody?.textContent).toContain('{"command": "echo hello"}');
    expect(inputBody?.classList.contains('streaming')).toBe(true);

    // Now the final tool_call event arrives with complete args
    renderLegacyEvent(renderer, 
      createBaseEvent('tool_call', {
        id: 'e3',
        turnId: 'turn1',
        responseId: 'resp1',
        payload: {
          toolCallId: 'tc1',
          toolName: 'bash',
          args: { command: 'echo hello' },
        },
      }),
    );

    // Block should no longer have streaming-input class
    toolBlock = container.querySelector<HTMLDivElement>('.tool-output-block');
    expect(toolBlock?.classList.contains('streaming-input')).toBe(false);
  });

  it('hydrates collapsed tool input content on expand', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container);

    renderLegacyEvent(renderer, 
      createBaseEvent('tool_call', {
        id: 'e1',
        payload: {
          toolCallId: 'tc-write',
          toolName: 'write',
          args: {
            path: '/tmp/test-shape.txt',
            content: 'Line 1: Hello\nLine 2: World\nLine 3: Test',
          },
        },
      }),
    );

    const toolBlock = container.querySelector<HTMLDivElement>('[data-tool-call-id="tc-write"]');
    expect(toolBlock).not.toBeNull();
    if (!toolBlock) return;

    expect(toolBlock.classList.contains('expanded')).toBe(false);
    expect(toolBlock.querySelector('.tool-output-input-body')).toBeNull();

    const header = toolBlock.querySelector<HTMLButtonElement>('.tool-output-header');
    header?.click();

    const inputSection = toolBlock.querySelector<HTMLElement>('.tool-output-input');
    const inputLabel = inputSection?.querySelector<HTMLElement>('.tool-output-section-label');
    expect(inputLabel?.textContent).toContain('Content');

    const inputBody = inputSection?.querySelector<HTMLElement>('.tool-output-input-body');
    expect(inputBody?.textContent).toContain('Line 1: Hello');
    expect(inputBody?.textContent).toContain('Line 2: World');
    expect(inputBody?.textContent).toContain('Line 3: Test');
    expect(inputBody?.textContent).not.toContain('/tmp/test-shape.txt');

    const jsonToggle = inputSection?.querySelector<HTMLButtonElement>('.tool-output-json-toggle');
    expect(jsonToggle).not.toBeNull();
    jsonToggle?.click();

    expect(inputBody?.textContent).toContain('/tmp/test-shape.txt');
    expect(inputBody?.textContent).toContain('"content"');

    header?.click();
    expect(toolBlock.classList.contains('expanded')).toBe(false);
    expect(toolBlock.querySelector('.tool-output-input-body')).toBeNull();
  });

  it('renders bash tool input with a command view and JSON toggle on expand', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container);

    renderLegacyEvent(renderer, 
      createBaseEvent('tool_call', {
        id: 'e1',
        payload: {
          toolCallId: 'tc-bash-input',
          toolName: 'bash',
          args: {
            command: 'printf "hello\\nworld\\n"',
            cwd: '/tmp/demo',
          },
        },
      }),
    );

    const toolBlock = container.querySelector<HTMLDivElement>(
      '[data-tool-call-id="tc-bash-input"]',
    );
    expect(toolBlock).not.toBeNull();
    if (!toolBlock) return;

    expect(toolBlock.classList.contains('expanded')).toBe(false);
    expect(toolBlock.querySelector('.tool-output-input-body')).toBeNull();

    const header = toolBlock.querySelector<HTMLButtonElement>('.tool-output-header');
    header?.click();

    const inputSection = toolBlock.querySelector<HTMLElement>('.tool-output-input');
    const inputLabel = inputSection?.querySelector<HTMLElement>('.tool-output-section-label');
    expect(inputLabel?.textContent).toContain('Command');

    const inputBody = inputSection?.querySelector<HTMLElement>('.tool-output-input-body');
    expect(inputBody?.textContent).toContain('printf "hello\\nworld\\n"');
    expect(inputBody?.textContent).not.toContain('"cwd"');

    const jsonToggle = inputSection?.querySelector<HTMLButtonElement>('.tool-output-json-toggle');
    expect(jsonToggle).not.toBeNull();
    jsonToggle?.click();

    expect(inputBody?.textContent).toContain('"command"');
    expect(inputBody?.textContent).toContain('"cwd"');
  });

  it('hydrates collapsed tool output content on expand', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container);

    renderLegacyEvent(renderer, 
      createBaseEvent('tool_call', {
        id: 'e1',
        payload: {
          toolCallId: 'tc-bash',
          toolName: 'bash',
          args: { command: 'echo hello world' },
        },
      }),
    );

    renderLegacyEvent(renderer, 
      createBaseEvent('tool_result', {
        id: 'e2',
        payload: {
          toolCallId: 'tc-bash',
          result: 'hello world\n',
        },
      }),
    );

    const toolBlock = container.querySelector<HTMLDivElement>('[data-tool-call-id="tc-bash"]');
    expect(toolBlock).not.toBeNull();
    if (!toolBlock) return;

    expect(toolBlock.classList.contains('expanded')).toBe(false);
    expect(toolBlock.querySelector('.tool-output-output-body')).toBeNull();

    const header = toolBlock.querySelector<HTMLButtonElement>('.tool-output-header');
    header?.click();

    const outputBody = toolBlock.querySelector<HTMLElement>('.tool-output-output-body');
    expect(outputBody?.textContent).toContain('hello world');

    header?.click();
    expect(toolBlock.classList.contains('expanded')).toBe(false);
    expect(toolBlock.querySelector('.tool-output-output-body')).toBeNull();
  });

  it('keeps inline tool interactions across collapse and expand', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container, {
      getExpandToolOutput: () => true,
    });

    renderLegacyEvent(renderer, 
      createBaseEvent('tool_call', {
        id: 'e1',
        payload: {
          toolCallId: 'tc-inline',
          toolName: 'ask_user',
          args: { prompt: 'Need your input' },
        },
      }),
    );

    renderLegacyEvent(renderer, 
      createBaseEvent('interaction_request', {
        id: 'e2',
        payload: {
          toolCallId: 'tc-inline',
          toolName: 'ask_user',
          interactionId: 'i-inline',
          interactionType: 'input',
          presentation: 'tool',
          inputSchema: {
            title: 'Need your input',
            fields: [{ id: 'answer', type: 'text', label: 'Answer', required: true }],
          },
        },
      }),
    );

    renderLegacyEvent(renderer, 
      createBaseEvent('interaction_response', {
        id: 'e3',
        payload: {
          toolCallId: 'tc-inline',
          interactionId: 'i-inline',
          action: 'submit',
          input: { answer: 'hello' },
        },
      }),
    );

    const toolBlock = container.querySelector<HTMLDivElement>('[data-tool-call-id="tc-inline"]');
    expect(toolBlock).not.toBeNull();
    if (!toolBlock) return;

    let interaction = toolBlock.querySelector<HTMLDivElement>(
      '.tool-output-result > .tool-interaction.interaction-questionnaire',
    );
    expect(interaction).not.toBeNull();
    expect(interaction?.classList.contains('interaction-complete')).toBe(true);
    expect(interaction?.querySelector<HTMLInputElement>('[data-field-id="answer"]')?.value).toBe(
      'hello',
    );

    const header = toolBlock.querySelector<HTMLButtonElement>('.tool-output-header');
    header?.click();
    expect(toolBlock.classList.contains('expanded')).toBe(false);

    header?.click();
    interaction = toolBlock.querySelector<HTMLDivElement>(
      '.tool-output-result > .tool-interaction.interaction-questionnaire',
    );
    expect(interaction).not.toBeNull();
    expect(interaction?.classList.contains('interaction-complete')).toBe(true);
    expect(interaction?.querySelector<HTMLInputElement>('[data-field-id="answer"]')?.value).toBe(
      'hello',
    );
  });

  it('dehydrates expanded completed tool bodies when they leave the viewport', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container, {
      getExpandToolOutput: () => true,
    });

    renderLegacyEvent(renderer, 
      createBaseEvent('tool_call', {
        id: 'e1',
        payload: {
          toolCallId: 'tc-offscreen',
          toolName: 'bash',
          args: { command: 'echo hello world' },
        },
      }),
    );

    renderLegacyEvent(renderer, 
      createBaseEvent('tool_result', {
        id: 'e2',
        payload: {
          toolCallId: 'tc-offscreen',
          result: 'hello world\n',
        },
      }),
    );

    const toolBlock = container.querySelector<HTMLDivElement>('[data-tool-call-id="tc-offscreen"]');
    expect(toolBlock).not.toBeNull();
    if (!toolBlock) return;

    expect(toolBlock.querySelector('.tool-output-input-body')).not.toBeNull();
    expect(toolBlock.querySelector('.tool-output-output-body')).not.toBeNull();

    setToolOutputBlockNearViewport(toolBlock, false);
    expect(toolBlock.querySelector('.tool-output-input-body')).toBeNull();
    expect(toolBlock.querySelector('.tool-output-output-body')).toBeNull();

    setToolOutputBlockNearViewport(toolBlock, true);
    expect(toolBlock.querySelector('.tool-output-input-body')?.textContent).toContain(
      'echo hello world',
    );
    expect(toolBlock.querySelector('.tool-output-output-body')?.textContent).toContain(
      'hello world',
    );
  });

  it('keeps expanded streaming tool bodies hydrated offscreen', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container, {
      getExpandToolOutput: () => true,
    });

    renderLegacyEvent(renderer, 
      createBaseEvent('tool_call', {
        id: 'e1',
        payload: {
          toolCallId: 'tc-streaming',
          toolName: 'bash',
          args: { command: 'echo hello' },
        },
      }),
    );

    renderLegacyEvent(renderer, 
      createBaseEvent('tool_output_chunk', {
        id: 'e2',
        payload: {
          toolCallId: 'tc-streaming',
          toolName: 'bash',
          chunk: 'hello',
          offset: 5,
        },
      }) as ChatEvent,
    );

    const toolBlock = container.querySelector<HTMLDivElement>('[data-tool-call-id="tc-streaming"]');
    expect(toolBlock).not.toBeNull();
    if (!toolBlock) return;

    setToolOutputBlockNearViewport(toolBlock, false);
    expect(toolBlock.querySelector('.tool-output-output-body')?.textContent).toContain('hello');
  });

  it('groups tool_input_chunk blocks when a second call streams in', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container);

    renderLegacyEvent(renderer, 
      createBaseEvent('tool_input_chunk', {
        id: 'e1',
        payload: {
          toolCallId: 'tc1',
          toolName: 'bash',
          chunk: '{"command":"echo one"}',
          offset: 1,
        },
      }),
    );

    renderLegacyEvent(renderer, 
      createBaseEvent('tool_input_chunk', {
        id: 'e2',
        payload: {
          toolCallId: 'tc2',
          toolName: 'bash',
          chunk: '{"command":"echo two"}',
          offset: 1,
        },
      }),
    );

    const group = container.querySelector<HTMLDivElement>('.tool-call-group');
    expect(group).not.toBeNull();
    const blocks = group?.querySelectorAll<HTMLDivElement>(
      ':scope > .tool-call-group-content > .tool-output-block',
    );
    expect(blocks).toHaveLength(2);
  });

  it('renders custom and summary messages as standalone entries', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container);

    replayLegacyEvents(renderer, [
      createBaseEvent('custom_message', {
        id: 'e-custom',
        turnId: 't-custom',
        responseId: undefined,
        payload: { text: 'Custom entry', label: 'Pi' },
      }),
      createBaseEvent('summary_message', {
        id: 'e-summary',
        turnId: 't-summary',
        responseId: undefined,
        payload: { text: 'Compaction summary', summaryType: 'compaction' },
      }),
    ]);

    const customMessage = container.querySelector<HTMLDivElement>('.message.custom-message');
    expect(customMessage).not.toBeNull();
    expect(customMessage?.dataset['eventId']).toBe('e-custom');
    expect(customMessage?.textContent).toContain('Custom entry');
    const customLabel = customMessage?.querySelector<HTMLDivElement>('.message-meta');
    expect(customLabel?.textContent).toBe('Pi');

    const summaryMessage = container.querySelector<HTMLDivElement>('.message.summary-message');
    expect(summaryMessage).not.toBeNull();
    expect(summaryMessage?.dataset['eventId']).toBe('e-summary');
    expect(summaryMessage?.dataset['summaryType']).toBe('compaction');
    expect(summaryMessage?.textContent).toContain('Compaction summary');
  });

  it('focuses the latest pending questionnaire input when requested', () => {
    const container = document.createElement('div');
    container.className = 'chat-log';
    document.body.appendChild(container);

    const complete = document.createElement('div');
    complete.className = 'interaction-block interaction-questionnaire interaction-complete';
    const completeInput = document.createElement('input');
    completeInput.type = 'text';
    complete.appendChild(completeInput);
    container.appendChild(complete);

    const pendingFirst = document.createElement('div');
    pendingFirst.className = 'interaction-block interaction-questionnaire';
    const pendingFirstInput = document.createElement('input');
    pendingFirstInput.type = 'text';
    pendingFirst.appendChild(pendingFirstInput);
    container.appendChild(pendingFirst);

    const pendingLast = document.createElement('div');
    pendingLast.className = 'interaction-block interaction-questionnaire';
    const pendingLastInput = document.createElement('input');
    pendingLastInput.type = 'text';
    pendingLast.appendChild(pendingLastInput);
    container.appendChild(pendingLast);

    const renderer = new ChatRenderer(container, {
      getShouldAutoFocusQuestionnaire: () => true,
    });

    const didFocus = renderer.focusFirstQuestionnaireInput();

    expect(didFocus).toBe(true);
    expect(document.activeElement).toBe(pendingLastInput);
  });

  it('skips questionnaire auto-focus when disabled', () => {
    const container = document.createElement('div');
    container.className = 'chat-log';
    document.body.appendChild(container);

    const pending = document.createElement('div');
    pending.className = 'interaction-block interaction-questionnaire';
    const input = document.createElement('input');
    input.type = 'text';
    pending.appendChild(input);
    container.appendChild(pending);

    const renderer = new ChatRenderer(container, {
      getShouldAutoFocusQuestionnaire: () => false,
    });

    const didFocus = renderer.focusFirstQuestionnaireInput();

    expect(didFocus).toBe(false);
    expect(document.activeElement).not.toBe(input);
  });

  it('returns focus to the chat input after questionnaire submit', () => {
    const container = document.createElement('div');
    container.className = 'chat-log';
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container, {
      getShouldRestoreFocusAfterInteraction: () => true,
    });
    const focusInput = vi.fn();
    renderer.setFocusInputHandler(focusInput);

    renderLegacyEvent(renderer, 
      createBaseEvent('interaction_request', {
        id: 'e1',
        payload: {
          toolCallId: 'tc1',
          toolName: 'questions_ask',
          interactionId: 'i1',
          interactionType: 'input',
          presentation: 'questionnaire',
          inputSchema: {
            title: 'Quick question',
            fields: [{ id: 'answer', type: 'text', label: 'Answer' }],
          },
        },
      }),
    );

    const form = container.querySelector<HTMLFormElement>('form');
    expect(form).not.toBeNull();
    if (!form) return;
    form.reportValidity = () => true;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    expect(focusInput).toHaveBeenCalledTimes(1);
  });
});

it('renders multiple questionnaires in the same response without removing earlier ones', () => {
  const container = document.createElement('div');
  container.className = 'chat-log';
  document.body.appendChild(container);

  const renderer = new ChatRenderer(container);

  const events: ChatEvent[] = [
    createBaseEvent('interaction_request', {
      id: 'e1',
      turnId: 'turn1',
      responseId: 'resp1',
      payload: {
        toolCallId: 'tc1',
        toolName: 'questions_ask',
        interactionId: 'i1',
        interactionType: 'input',
        presentation: 'questionnaire',
        inputSchema: {
          title: 'First questionnaire',
          fields: [{ id: 'answer1', type: 'text', label: 'Answer 1', required: true }],
        },
      },
    }),
    createBaseEvent('interaction_response', {
      id: 'e2',
      payload: {
        toolCallId: 'tc1',
        interactionId: 'i1',
        action: 'submit',
        input: { answer1: 'response1' },
      },
    }),
    // Second questionnaire with different toolCallId
    createBaseEvent('interaction_request', {
      id: 'e3',
      turnId: 'turn1',
      responseId: 'resp1',
      payload: {
        toolCallId: 'tc2',
        toolName: 'questions_ask',
        interactionId: 'i2',
        interactionType: 'input',
        presentation: 'questionnaire',
        inputSchema: {
          title: 'Second questionnaire',
          fields: [{ id: 'answer2', type: 'text', label: 'Answer 2', required: true }],
        },
      },
    }),
  ];

  replayLegacyEvents(renderer, events);

  const questionnaires = container.querySelectorAll('.interaction-questionnaire');
  expect(questionnaires.length).toBe(2);

  const first = questionnaires[0];
  const second = questionnaires[1];

  expect(first?.classList.contains('interaction-complete')).toBe(true);
  expect(first?.textContent).toContain('First questionnaire');

  expect(second?.classList.contains('interaction-complete')).toBe(false);
  expect(second?.textContent).toContain('Second questionnaire');
});

it('renders multiple questionnaires via handleNewEvent without removing earlier ones', () => {
  const container = document.createElement('div');
  container.className = 'chat-log';
  document.body.appendChild(container);

  const renderer = new ChatRenderer(container);

  // First questionnaire
  renderLegacyEvent(renderer, 
    createBaseEvent('interaction_request', {
      id: 'e1',
      turnId: 'turn1',
      responseId: 'resp1',
      payload: {
        toolCallId: 'tc1',
        toolName: 'questions_ask',
        interactionId: 'i1',
        interactionType: 'input',
        presentation: 'questionnaire',
        inputSchema: {
          title: 'First questionnaire',
          fields: [{ id: 'answer1', type: 'text', label: 'Answer 1', required: true }],
        },
      },
    }),
  );

  // Response to first
  renderLegacyEvent(renderer, 
    createBaseEvent('interaction_response', {
      id: 'e2',
      payload: {
        toolCallId: 'tc1',
        interactionId: 'i1',
        action: 'submit',
        input: { answer1: 'response1' },
      },
    }),
  );

  // Second questionnaire
  renderLegacyEvent(renderer, 
    createBaseEvent('interaction_request', {
      id: 'e3',
      turnId: 'turn1',
      responseId: 'resp1',
      payload: {
        toolCallId: 'tc2',
        toolName: 'questions_ask',
        interactionId: 'i2',
        interactionType: 'input',
        presentation: 'questionnaire',
        inputSchema: {
          title: 'Second questionnaire',
          fields: [{ id: 'answer2', type: 'text', label: 'Answer 2', required: true }],
        },
      },
    }),
  );

  const questionnaires = container.querySelectorAll('.interaction-questionnaire');
  expect(questionnaires.length).toBe(2);

  const first = questionnaires[0];
  const second = questionnaires[1];

  expect(first?.classList.contains('interaction-complete')).toBe(true);
  expect(first?.textContent).toContain('First questionnaire');

  expect(second?.classList.contains('interaction-complete')).toBe(false);
  expect(second?.textContent).toContain('Second questionnaire');
});
