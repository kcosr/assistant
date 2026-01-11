// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import { appendInterruptedIndicator, appendMessage } from '../utils/chatMessageRenderer';
import { MessageRenderer } from './messageRenderer';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('MessageRenderer', () => {
  it('interleaves text segments around tool blocks in streaming order', () => {
    const chatLogEl = document.createElement('div');
    document.body.appendChild(chatLogEl);

    const renderer = new MessageRenderer({
      chatLogEl,
      appendMessage,
      appendInterruptedIndicator,
      getExpandToolOutput: () => true,
    });

    renderer.handleEvent({ type: 'thinking_start', responseId: 'r1' });
    renderer.handleEvent({ type: 'thinking_delta', responseId: 'r1', delta: 'Thinking…' });
    renderer.handleEvent({ type: 'text_delta', responseId: 'r1', delta: 'Hello ' });
    renderer.handleEvent({
      type: 'tool_call_start',
      callId: 'c1',
      toolName: 'bash',
      arguments: JSON.stringify({ command: 'echo hi' }),
    });
    renderer.handleEvent({
      type: 'tool_output_delta',
      callId: 'c1',
      toolName: 'bash',
      delta: 'hi\n',
    });
    renderer.handleEvent({
      type: 'tool_result',
      callId: 'c1',
      toolName: 'bash',
      ok: true,
      result: { output: 'hi\n' },
    });
    renderer.handleEvent({ type: 'text_delta', responseId: 'r1', delta: 'world' });
    renderer.handleEvent({ type: 'text_done', responseId: 'r1', text: 'Hello world' });

    const bubble = chatLogEl.querySelector<HTMLDivElement>('.message.assistant');
    expect(bubble).not.toBeNull();
    if (!bubble) return;

    const children = Array.from(bubble.children);
    expect(children.length).toBe(4);
    expect(children[0]?.classList.contains('thinking-content')).toBe(true);
    expect(children[1]?.classList.contains('assistant-message-main')).toBe(true);
    expect(children[2]?.classList.contains('tool-output-block')).toBe(true);
    expect(children[3]?.classList.contains('assistant-message-main')).toBe(true);

    expect(bubble.querySelectorAll(':scope > .assistant-message-main')).toHaveLength(2);
    expect(bubble.querySelectorAll(':scope > .tool-output-block')).toHaveLength(1);
    expect(bubble.querySelectorAll(':scope > .typing-indicator')).toHaveLength(0);
  });

  it('preserves interrupted tool block and appends interrupted indicator on cancel', () => {
    const chatLogEl = document.createElement('div');
    document.body.appendChild(chatLogEl);

    const renderer = new MessageRenderer({
      chatLogEl,
      appendMessage,
      appendInterruptedIndicator,
      getExpandToolOutput: () => true,
    });

    renderer.handleEvent({ type: 'text_delta', responseId: 'r1', delta: 'Working…' });
    renderer.handleEvent({
      type: 'tool_call_start',
      callId: 'c1',
      toolName: 'bash',
      arguments: JSON.stringify({ command: 'sleep 10' }),
    });
    renderer.handleEvent({
      type: 'tool_result',
      callId: 'c1',
      toolName: 'bash',
      ok: false,
      error: { code: 'tool_interrupted', message: 'Tool call was interrupted by the user' },
    });
    renderer.handleEvent({ type: 'output_cancelled', responseId: 'r1' });

    const bubble = chatLogEl.querySelector<HTMLDivElement>('.message.assistant');
    expect(bubble).not.toBeNull();
    if (!bubble) return;

    const toolBlock = bubble.querySelector<HTMLDivElement>(':scope > .tool-output-block');
    expect(toolBlock).not.toBeNull();
    expect(toolBlock?.classList.contains('interrupted')).toBe(true);
    expect(bubble.querySelectorAll(':scope > .typing-indicator')).toHaveLength(0);

    const interruptedIndicator = chatLogEl.querySelector<HTMLDivElement>(
      ':scope > .message-interrupted',
    );
    expect(interruptedIndicator).not.toBeNull();
  });

  it('renders multiple tool calls with correct final states after cancel', () => {
    const chatLogEl = document.createElement('div');
    document.body.appendChild(chatLogEl);

    const renderer = new MessageRenderer({
      chatLogEl,
      appendMessage,
      appendInterruptedIndicator,
      getExpandToolOutput: () => true,
    });

    renderer.handleEvent({ type: 'text_delta', responseId: 'r1', delta: 'Before tools.' });

    renderer.handleEvent({
      type: 'tool_call_start',
      callId: 'c1',
      toolName: 'bash',
      arguments: JSON.stringify({ command: 'echo ok' }),
    });
    renderer.handleEvent({
      type: 'tool_result',
      callId: 'c1',
      toolName: 'bash',
      ok: true,
      result: 'ok\n',
    });

    renderer.handleEvent({
      type: 'tool_call_start',
      callId: 'c2',
      toolName: 'bash',
      arguments: JSON.stringify({ command: 'sleep 10' }),
    });
    renderer.handleEvent({
      type: 'tool_result',
      callId: 'c2',
      toolName: 'bash',
      ok: false,
      error: { code: 'tool_interrupted', message: 'Tool call was interrupted by the user' },
    });

    renderer.handleEvent({ type: 'output_cancelled', responseId: 'r1' });

    const bubble = chatLogEl.querySelector<HTMLDivElement>('.message.assistant');
    expect(bubble).not.toBeNull();
    if (!bubble) return;

    const group = bubble.querySelector<HTMLDivElement>('.tool-call-group');
    expect(group).not.toBeNull();
    if (!group) return;

    const blocks = Array.from(
      group.querySelectorAll<HTMLDivElement>(
        ':scope > .tool-call-group-content > .tool-output-block',
      ),
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.classList.contains('success')).toBe(true);
    expect(blocks[1]?.classList.contains('interrupted')).toBe(true);
  });
});
