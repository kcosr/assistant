// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from './api';
import {
  buildSelfContainedChatPanelHtml,
  exportSelfContainedChatPanelHtml,
} from './chatPanelHtmlExport';
import {
  createToolOutputBlock,
  setToolOutputBlockInput,
  updateToolOutputBlockContent,
} from './toolOutputRenderer';

function createChatPanel(): HTMLElement {
  const panel = document.createElement('main');
  panel.className = 'chat-panel';
  panel.innerHTML = `
    <div class="panel-header panel-chrome-row chat-header" data-role="chrome-row">
      <div class="panel-header-main">
        <span class="panel-header-label" data-role="chrome-title">Chat</span>
        <button type="button" class="chat-session-label" data-role="chat-session-label">My Session</button>
      </div>
      <div class="panel-chrome-plugin-controls" data-role="chrome-plugin-controls">
        <button type="button" data-role="chat-toggle-tool-output">Tool output</button>
        <button type="button" data-role="chat-toggle-thinking">Thinking</button>
        <button type="button" data-role="chat-toggle-tool-expand">Expand</button>
        <button type="button" data-role="chat-refresh-history">Refresh</button>
      </div>
      <div class="panel-chrome-frame-controls" data-role="chrome-controls">
        <button type="button">More actions</button>
      </div>
    </div>
    <div class="chat-log-container" data-role="chat-log-container">
      <div class="chat-log" data-role="chat-log">
        <div class="tool-output-block expanded">
          <button type="button" class="tool-output-header" aria-expanded="true">
            <span class="tool-output-toggle">▼</span>
          </button>
          <div class="tool-output-content">Example tool output</div>
        </div>
        <div
          class="message assistant attachment-tool-bubble"
          data-tool-call-id="att1"
          data-attachment-file-name="note.md"
          data-attachment-title="Meeting notes"
          data-attachment-content-type="text/markdown"
          data-attachment-download-url="/api/attachments/s1/att1?download=1"
          data-attachment-preview-type="markdown"
          data-attachment-preview-text="# Hello"
          data-attachment-preview-truncated="true"
        >
          <div class="attachment-tool-preview">
            <div class="attachment-tool-preview-content markdown-content"><p>Hello…</p></div>
            <div class="attachment-tool-preview-status">Preview truncated. Expand to load the full attachment.</div>
          </div>
          <div class="attachment-tool-actions">
            <button type="button" class="attachment-tool-action-button">Expand</button>
            <button type="button" class="attachment-tool-action-button">Download</button>
          </div>
        </div>
      </div>
      <button type="button" data-role="chat-scroll-to-bottom">Scroll</button>
    </div>
    <div class="chat-input-panel">Input</div>
  `;
  return panel;
}

describe('chatPanelHtmlExport', () => {
  const apiFetchMock = vi.mocked(apiFetch);
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.documentElement.setAttribute('data-theme-tone', 'dark');
    document.documentElement.style.setProperty('--font-sans', 'IBM Plex Sans');
    apiFetchMock.mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-theme-tone');
    document.documentElement.style.removeProperty('--font-sans');
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('builds a self-contained export with embedded attachment content and stripped app chrome', async () => {
    const panel = createChatPanel();
    document.body.appendChild(panel);

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('.chat-panel{color:var(--color-text-primary);}', {
        status: 200,
        headers: { 'Content-Type': 'text/css' },
      }),
    ) as typeof fetch;
    apiFetchMock.mockResolvedValue(
      new Response('# Hello\n\nFull body text', {
        status: 200,
        headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
      }),
    );

    const { fileName, html } = await buildSelfContainedChatPanelHtml({
      chatPanelEl: panel,
      sessionTitle: 'My Session',
    });

    expect(fileName).toBe('my-session.html');
    expect(html).toContain('assistant-chat-export-payload');

    const parsed = new DOMParser().parseFromString(html, 'text/html');
    expect(parsed.querySelector('.chat-input-panel')).toBeNull();
    expect(parsed.querySelector('[data-role="chrome-controls"]')).toBeNull();
    expect(parsed.querySelector('.chat-export-session-label')?.textContent).toBe('My Session');
    const exportedControlRoles = Array.from(
      parsed.querySelectorAll<HTMLElement>('[data-role="chrome-plugin-controls"] > [data-role]'),
    ).map((element) => element.dataset['role']);
    expect(exportedControlRoles).toEqual([
      'chat-toggle-tool-output',
      'chat-toggle-thinking',
      'chat-toggle-tool-expand',
    ]);

    const actionLabels = Array.from(
      parsed.querySelectorAll<HTMLButtonElement>('.attachment-tool-action-button'),
    ).map((button) => button.textContent?.trim());
    expect(actionLabels).toContain('Expand');
    expect(actionLabels).toContain('Download');

    const payloadEl = parsed.getElementById('assistant-chat-export-payload');
    const payload = JSON.parse(payloadEl?.textContent ?? '{}') as {
      attachments?: Record<string, { expandedPreviewHtml?: string; base64?: string }>;
    };
    expect(payload.attachments?.['att1']?.base64).toBeTruthy();
    expect(payload.attachments?.['att1']?.expandedPreviewHtml).toContain('<h1>Hello</h1>');
  });

  it('downloads the generated export as an html file', async () => {
    const panel = createChatPanel();
    document.body.appendChild(panel);

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('.chat-panel{color:var(--color-text-primary);}', {
        status: 200,
        headers: { 'Content-Type': 'text/css' },
      }),
    ) as typeof fetch;
    apiFetchMock.mockResolvedValue(
      new Response('# Hello\n\nFull body text', {
        status: 200,
        headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
      }),
    );

    const createObjectUrlSpy = vi.fn(() => 'blob:assistant-chat-export');
    const revokeObjectUrlSpy = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      writable: true,
      value: createObjectUrlSpy,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      writable: true,
      value: revokeObjectUrlSpy,
    });
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const result = await exportSelfContainedChatPanelHtml({
      chatPanelEl: panel,
      sessionTitle: 'My Session',
    });

    expect(result.fileName).toBe('my-session.html');
    expect(createObjectUrlSpy).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();
    expect(revokeObjectUrlSpy).not.toHaveBeenCalled();
  });

  it('materializes collapsed tool block input and output into the exported HTML', async () => {
    const panel = document.createElement('main');
    panel.className = 'chat-panel';
    panel.innerHTML = `
      <div class="panel-header panel-chrome-row chat-header" data-role="chrome-row">
        <div class="panel-header-main">
          <span class="panel-header-label" data-role="chrome-title">Chat</span>
          <button type="button" class="chat-session-label" data-role="chat-session-label">Debug Session</button>
        </div>
        <div class="panel-chrome-plugin-controls" data-role="chrome-plugin-controls"></div>
        <div class="panel-chrome-frame-controls" data-role="chrome-controls"></div>
      </div>
      <div class="chat-log-container" data-role="chat-log-container">
        <div class="chat-log" data-role="chat-log"></div>
      </div>
    `;
    const chatLog = panel.querySelector<HTMLElement>('[data-role="chat-log"]');
    if (!chatLog) {
      throw new Error('Missing chat log');
    }
    const block = createToolOutputBlock({
      callId: 'tool-1',
      toolName: 'bash',
      headerLabel: 'echo hi',
      expanded: false,
    });
    setToolOutputBlockInput(block, '{"command":"echo hi"}');
    updateToolOutputBlockContent(block, 'bash', 'hi\n', { state: 'complete' });
    expect(block.querySelector('.tool-output-input')?.childElementCount).toBe(0);
    expect(block.querySelector('.tool-output-result')?.childElementCount).toBe(0);
    chatLog.appendChild(block);
    document.body.appendChild(panel);

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('.chat-panel{color:var(--color-text-primary);}', {
        status: 200,
        headers: { 'Content-Type': 'text/css' },
      }),
    ) as typeof fetch;

    const { html } = await buildSelfContainedChatPanelHtml({
      chatPanelEl: panel,
      sessionTitle: 'Debug Session',
    });

    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const exportedBlock = parsed.querySelector('.tool-output-block');
    expect(exportedBlock?.classList.contains('expanded')).toBe(false);
    expect(exportedBlock?.querySelector('.tool-output-input')?.textContent).toContain('echo hi');
    expect(exportedBlock?.querySelector('.tool-output-result')?.textContent).toContain('hi');
    expect(html).toContain('overflow: auto !important');
  });

  it('uses the canonical tool block state when the visible block is only a placeholder shell', async () => {
    const panel = document.createElement('main');
    panel.className = 'chat-panel';
    panel.innerHTML = `
      <div class="panel-header panel-chrome-row chat-header" data-role="chrome-row">
        <div class="panel-header-main">
          <span class="panel-header-label" data-role="chrome-title">Chat</span>
          <button type="button" class="chat-session-label" data-role="chat-session-label">Debug Session</button>
        </div>
        <div class="panel-chrome-plugin-controls" data-role="chrome-plugin-controls"></div>
        <div class="panel-chrome-frame-controls" data-role="chrome-controls"></div>
      </div>
      <div class="chat-log-container" data-role="chat-log-container">
        <div class="chat-log" data-role="chat-log">
          <div class="tool-output-block expanded" data-call-id="tool-2" data-tool-name="lists_get">
            <button type="button" class="tool-output-header" aria-expanded="true">
              <span class="tool-output-toggle">▼</span>
            </button>
            <div class="tool-output-content">
              <div class="tool-output-input"></div>
              <div class="tool-output-result"></div>
            </div>
          </div>
        </div>
      </div>
    `;

    const canonicalBlock = createToolOutputBlock({
      callId: 'tool-2',
      toolName: 'lists_get',
      expanded: true,
    });
    setToolOutputBlockInput(canonicalBlock, '{"listId":"abc"}');
    updateToolOutputBlockContent(canonicalBlock, 'lists_get', '{"items":[]}', { state: 'complete' });
    document.body.appendChild(panel);

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('.chat-panel{color:var(--color-text-primary);}', {
        status: 200,
        headers: { 'Content-Type': 'text/css' },
      }),
    ) as typeof fetch;

    const { html } = await buildSelfContainedChatPanelHtml({
      chatPanelEl: panel,
      sessionTitle: 'Debug Session',
      getCanonicalToolBlock: (callId) => (callId === 'tool-2' ? canonicalBlock : null),
    });

    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const exportedBlock = parsed.querySelector('.tool-output-block[data-call-id="tool-2"]');
    expect(exportedBlock?.querySelector('.tool-output-input')?.textContent).toContain('abc');
    expect(exportedBlock?.querySelector('.tool-output-result')?.textContent).toContain('items');
  });

  it('rehydrates tool block content from snapshot datasets when in-memory state is missing', async () => {
    const panel = document.createElement('main');
    panel.className = 'chat-panel';
    panel.innerHTML = `
      <div class="panel-header panel-chrome-row chat-header" data-role="chrome-row">
        <div class="panel-header-main">
          <span class="panel-header-label" data-role="chrome-title">Chat</span>
          <button type="button" class="chat-session-label" data-role="chat-session-label">Debug Session</button>
        </div>
        <div class="panel-chrome-plugin-controls" data-role="chrome-plugin-controls"></div>
        <div class="panel-chrome-frame-controls" data-role="chrome-controls"></div>
      </div>
      <div class="chat-log-container" data-role="chat-log-container">
        <div class="chat-log" data-role="chat-log"></div>
      </div>
    `;
    const chatLog = panel.querySelector<HTMLElement>('[data-role="chat-log"]');
    if (!chatLog) {
      throw new Error('Missing chat log');
    }

    const originalBlock = createToolOutputBlock({
      callId: 'tool-3',
      toolName: 'lists_items_search',
      expanded: false,
    });
    setToolOutputBlockInput(originalBlock, '{"query":"milk"}');
    updateToolOutputBlockContent(originalBlock, 'lists_items_search', '{"matches":[1,2]}', {
      state: 'complete',
      rawJson: '{"matches":[1,2]}',
    });

    const dehydratedBlock = originalBlock.cloneNode(true) as HTMLDivElement;
    dehydratedBlock.querySelector('.tool-output-input')?.replaceChildren();
    dehydratedBlock.querySelector('.tool-output-result')?.replaceChildren();
    chatLog.appendChild(dehydratedBlock);
    document.body.appendChild(panel);

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('.chat-panel{color:var(--color-text-primary);}', {
        status: 200,
        headers: { 'Content-Type': 'text/css' },
      }),
    ) as typeof fetch;

    const { html } = await buildSelfContainedChatPanelHtml({
      chatPanelEl: panel,
      sessionTitle: 'Debug Session',
      getCanonicalToolBlock: (callId) => (callId === 'tool-3' ? dehydratedBlock : null),
    });

    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const exportedBlock = parsed.querySelector('.tool-output-block[data-call-id="tool-3"]');
    expect(exportedBlock?.querySelector('.tool-output-input')?.textContent).toContain('milk');
    expect(exportedBlock?.querySelector('.tool-output-result')?.textContent).toContain('matches');
  });
});
