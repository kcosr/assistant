// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  appendExternalSentIndicator,
  buildContextLine,
  clearExternalSentIndicators,
  decorateUserMessageAsAgent,
} from './chatMessageRenderer';

describe('buildContextLine', () => {
  it('returns empty context when nothing is active', () => {
    expect(buildContextLine(null, null, [])).toBe('<context />');
  });

  it('includes list description when non-empty', () => {
    const line = buildContextLine({ type: 'list', id: 'abc' }, 'My List', [], '  A description  ');
    expect(line).toBe(
      '<context type="list" id="abc" name="My List" description="A description" />',
    );
  });

  it('omits description for non-list items', () => {
    const line = buildContextLine({ type: 'note', id: 'n1' }, 'Note', [], 'desc');
    expect(line).toBe('<context type="note" id="n1" name="Note" />');
  });

  it('omits description when empty or whitespace', () => {
    const line = buildContextLine({ type: 'list', id: 'l1' }, 'List', [], '   ');
    expect(line).toBe('<context type="list" id="l1" name="List" />');
  });

  it('normalizes and escapes description', () => {
    const line = buildContextLine({ type: 'list', id: 'l2' }, 'List', [], `a & b "c" <d>\n'e'`);
    expect(line).toContain('description="a &amp; b &quot;c&quot; &lt;d&gt; &#039;e&#039;"');
  });

  it('truncates very long descriptions', () => {
    const longDesc = 'x'.repeat(600);
    const line = buildContextLine({ type: 'list', id: 'l3' }, 'List', [], longDesc);
    const match = line.match(/description="([^"]+)"/);
    expect(match).not.toBeNull();
    const value = match?.[1] ?? '';
    expect(value.length).toBe(500);
    expect(value.endsWith('…')).toBe(true);
  });

  it('adds mode attribute when brief mode is enabled', () => {
    const line = buildContextLine({ type: 'list', id: 'abc' }, 'My List', ['item1'], null, {
      mode: 'brief',
    });
    expect(line).toContain('mode="brief"');
  });

  it('includes selection titles when provided', () => {
    const line = buildContextLine(
      { type: 'list', id: 'abc' },
      'My List',
      ['item1', 'item2'],
      null,
      undefined,
      ['First item', 'Second item'],
    );
    expect(line).toContain('selection="item1,item2"');
    expect(line).toContain('selection-titles=');
  });

  it('includes context attributes when provided', () => {
    const line = buildContextLine(null, null, [], null, {
      panel: { panelId: 'diff-1', panelType: 'diff' },
      contextAttributes: {
        'diff-path': 'src/index.ts',
        'diff-type': 'file',
        'diff-target': 'working',
        'diff-hunk-hash': 'abc123',
        'diff-hunk-index': '2',
        'diff-hunk-header': '@@ -1,2 +1,2 @@',
      },
    });
    expect(line).toContain('panel-id="diff-1"');
    expect(line).toContain('panel-type="diff"');
    expect(line).toContain('diff-path="src/index.ts"');
    expect(line).toContain('diff-type="file"');
    expect(line).toContain('diff-target="working"');
    expect(line).toContain('diff-hunk-hash="abc123"');
    expect(line).toContain('diff-hunk-index="2"');
    expect(line).toContain('diff-hunk-header="@@ -1,2 +1,2 @@"');
  });

  it('includes selected-text attribute for note text selection', () => {
    const line = buildContextLine({ type: 'note', id: 'my-note' }, 'My Note', [], null, {
      panel: { panelId: 'notes-1', panelType: 'notes' },
      contextAttributes: {
        'selected-text': 'This is the selected text from the note.',
      },
    });
    expect(line).toContain('type="note"');
    expect(line).toContain('id="my-note"');
    expect(line).toContain('name="My Note"');
    expect(line).toContain('panel-id="notes-1"');
    expect(line).toContain('panel-type="notes"');
    expect(line).toContain('selected-text="This is the selected text from the note."');
  });

  it('includes instance-id attribute for notes panel', () => {
    const line = buildContextLine({ type: 'note', id: 'my-note' }, 'My Note', [], null, {
      panel: { panelId: 'notes-1', panelType: 'notes', panelTitle: 'Notes (Plans)' },
      contextAttributes: {
        'instance-id': 'plans',
      },
    });
    expect(line).toContain('type="note"');
    expect(line).toContain('panel-title="Notes (Plans)"');
    expect(line).toContain('instance-id="plans"');
  });

  it('includes instance-id and task attributes for time-tracker panel', () => {
    const line = buildContextLine({ type: 'time-tracker', id: 'task-123' }, 'Project X', [], null, {
      panel: { panelId: 'time-tracker-1', panelType: 'time-tracker' },
      contextAttributes: {
        'instance-id': 'default',
        'task-id': 'task-123',
        'task-name': 'Project X',
      },
    });
    expect(line).toContain('type="time-tracker"');
    expect(line).toContain('name="Project X"');
    expect(line).toContain('instance-id="default"');
    expect(line).toContain('task-id="task-123"');
    expect(line).toContain('task-name="Project X"');
  });
});

describe('external send indicator', () => {
  it('appends and clears external sent indicator', () => {
    const container = document.createElement('div');

    appendExternalSentIndicator(container);
    expect(container.querySelectorAll('[data-external-sent="true"]').length).toBe(1);

    clearExternalSentIndicators(container);
    expect(container.querySelectorAll('[data-external-sent="true"]').length).toBe(0);
  });

  it('replaces any existing external sent indicator', () => {
    const container = document.createElement('div');
    appendExternalSentIndicator(container);
    appendExternalSentIndicator(container);
    expect(container.querySelectorAll('[data-external-sent="true"]').length).toBe(1);
  });
});

describe('decorateUserMessageAsAgent', () => {
  it('applies agent badge styling and initial', () => {
    const container = document.createElement('div');
    const wrapper = document.createElement('div');
    wrapper.className = 'message user';
    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    wrapper.appendChild(avatar);
    const content = document.createElement('div');
    content.className = 'message-content';
    content.textContent = 'Hello';
    wrapper.appendChild(content);
    container.appendChild(wrapper);

    decorateUserMessageAsAgent(wrapper, 'orchestrator');

    expect(avatar.classList.contains('agent-message-badge')).toBe(true);
    expect(avatar.textContent).toBe('O');
    const label = wrapper.querySelector<HTMLDivElement>('.agent-message-label');
    expect(label?.textContent).toBe('Message from orchestrator');
    const body = wrapper.querySelector<HTMLDivElement>('.agent-message-body');
    expect(body?.textContent).toBe('Hello');
  });
});
