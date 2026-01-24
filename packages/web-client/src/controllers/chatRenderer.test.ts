// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import type { ChatEvent } from '@assistant/shared';
import { ChatRenderer } from './chatRenderer';

afterEach(() => {
  document.body.innerHTML = '';
});

function createBaseEvent<T extends ChatEvent['type']>(
  type: T,
  overrides: Partial<ChatEvent> = {},
): ChatEvent {
  const base: ChatEvent = {
    id: 'e-base',
    type,
    timestamp: Date.now(),
    sessionId: 's1',
    turnId: 't1',
    responseId: 'r1',
    payload: {} as never,
  };
  return { ...base, ...overrides } as ChatEvent;
}

describe('ChatRenderer', () => {
  it('replays events into the expected DOM structure', () => {
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

    renderer.replayEvents(events);

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

  it('groups contiguous tool calls within the same segment', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container);

    renderer.renderEvent(
      createBaseEvent('tool_call', {
        id: 'e1',
        payload: {
          toolCallId: 'tc1',
          toolName: 'bash',
          args: { command: 'echo first' },
        },
      }),
    );

    renderer.renderEvent(
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

  it('formats tool_result content arrays as tool output', () => {
    const container = document.createElement('div');
    container.className = 'chat-log';
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container);

    renderer.renderEvent(
      createBaseEvent('tool_call', {
        id: 'e1',
        payload: {
          toolCallId: 'tc1',
          toolName: 'bash',
          args: { command: 'echo hi' },
        },
      }),
    );

    renderer.renderEvent(
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

    const toolBlock = container.querySelector<HTMLDivElement>('.tool-output-block');
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

    const renderer = new ChatRenderer(container);

    renderer.renderEvent(
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

    renderer.renderEvent(
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

    const renderer = new ChatRenderer(container);

    expect(renderer.hasActiveOutput()).toBe(false);

    renderer.showTypingIndicator();
    expect(renderer.hasActiveOutput()).toBe(true);

    renderer.hideTypingIndicator();
    expect(renderer.hasActiveOutput()).toBe(false);

    renderer.renderEvent(
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

    renderer.renderEvent(
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

  it('shows agent attribution for user_message events from agents', () => {
    const container = document.createElement('div');
    container.className = 'chat-log';
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container, {
      getAgentDisplayName: () => 'Source Agent',
    });

    renderer.replayEvents([
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

    renderer.replayEvents([
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

    renderer.renderEvent(
      createBaseEvent('assistant_chunk', {
        id: 'e1',
        payload: { text: 'Hello ' },
      }),
    );
    renderer.renderEvent(
      createBaseEvent('assistant_chunk', {
        id: 'e2',
        payload: { text: 'world' },
      }),
    );

    let assistantText = container.querySelector<HTMLDivElement>('.assistant-text');
    expect(assistantText).not.toBeNull();
    expect(assistantText?.textContent).toContain('Hello world');

    renderer.renderEvent(
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

  it('renders interrupt indicators on the active turn', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container);

    renderer.renderEvent(
      createBaseEvent('turn_start', {
        id: 'e0',
        turnId: 't-turn',
        payload: { trigger: 'user' },
      }),
    );

    renderer.renderEvent(
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

    renderer.renderEvent(
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
    renderer.renderEvent(
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

    const renderer = new ChatRenderer(container);

    // First, render the tool_call
    renderer.renderEvent(
      createBaseEvent('tool_call', {
        id: 'e1',
        payload: {
          toolCallId: 'tc1',
          toolName: 'bash',
          args: { command: 'echo hello' },
        },
      }),
    );

    const toolBlock = container.querySelector<HTMLDivElement>('.tool-output-block');
    expect(toolBlock).not.toBeNull();
    expect(toolBlock?.classList.contains('pending')).toBe(true);

    // Stream some output chunks
    renderer.renderEvent(
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
    renderer.renderEvent(
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
    renderer.renderEvent(
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

    const renderer = new ChatRenderer(container);

    renderer.renderEvent(
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

    renderer.renderEvent(
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

    renderer.replayEvents(events);

    const interaction = container.querySelector<HTMLElement>('.interaction-standalone');
    expect(interaction).not.toBeNull();
    expect(interaction?.classList.contains('interaction-complete')).toBe(true);
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

    renderer.replayEvents(events);

    const toolBlock = container.querySelector<HTMLDivElement>('.tool-output-block');
    expect(toolBlock).not.toBeNull();
    if (!toolBlock) return;

    const dock = toolBlock.querySelector<HTMLDivElement>('.tool-interaction-dock');
    expect(dock).not.toBeNull();
    expect(dock?.querySelector('.interaction-approval')).not.toBeNull();
    expect(toolBlock.classList.contains('has-pending-interaction')).toBe(true);
    expect(toolBlock.classList.contains('has-pending-approval')).toBe(true);

    const group = container.querySelector<HTMLDivElement>('.tool-call-group');
    expect(group).not.toBeNull();
    expect(group?.classList.contains('has-pending-interaction')).toBe(true);
    expect(group?.classList.contains('has-pending-approval')).toBe(true);

    renderer.renderEvent(
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
    expect(group?.classList.contains('has-pending-interaction')).toBe(false);
    expect(group?.classList.contains('has-pending-approval')).toBe(false);
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

    renderer.replayEvents(events);

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

    const renderer = new ChatRenderer(container);

    renderer.renderEvent(
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
    renderer.renderEvent(
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
    renderer.renderEvent(
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
    renderer.renderEvent(
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
    renderer.renderEvent(
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

    const renderer = new ChatRenderer(container);

    // First, create the response container via a turn_start
    renderer.renderEvent(
      createBaseEvent('turn_start', {
        id: 't1',
        turnId: 'turn1',
        payload: { trigger: 'user', agentId: 'agent1' },
      }),
    );

    // Stream input chunks before tool_call arrives
    renderer.renderEvent(
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
    renderer.renderEvent(
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
    renderer.renderEvent(
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

  it('groups tool_input_chunk blocks when a second call streams in', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);

    const renderer = new ChatRenderer(container);

    renderer.renderEvent(
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

    renderer.renderEvent(
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

    renderer.replayEvents([
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
});
