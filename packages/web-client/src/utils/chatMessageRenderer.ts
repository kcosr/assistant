import { applyMarkdownToElement } from './markdown';
import { clearEmptySessionHint } from './emptySessionHint';

/**
 * Check if context should be hidden from UI.
 * Set window.__ASSISTANT_HIDE_CONTEXT__ = false to show context in messages.
 */
function shouldHideContext(): boolean {
  const globalAny = globalThis as { __ASSISTANT_HIDE_CONTEXT__?: boolean };
  // Default to true (hide context) if not explicitly set to false
  return globalAny.__ASSISTANT_HIDE_CONTEXT__ !== false;
}

/**
 * Build the context line to prepend to user messages.
 * Format:
 * - Item: <context type="..." id="..." name="..." description="..." selection="..." selection-titles="..." mode="..." />
 * - Panel: <context panel-id="..." panel-type="..." panel-title="..." />
 * - Panel attributes: <context diff-path="..." diff-hunk-hash="..." diff-hunk-index="..." />
 * - Note text selection: <context selected-text="..." /> (when text is selected in a note)
 */
const MAX_DESCRIPTION_ATTR_LENGTH = 500;
const MAX_SELECTION_TITLES_ATTR_LENGTH = 1000;
const MAX_CONTEXT_ATTR_LENGTH = 500;
const RESERVED_CONTEXT_ATTRS = new Set([
  'type',
  'id',
  'name',
  'description',
  'selection',
  'selection-titles',
  'mode',
  'panel-id',
  'panel-type',
  'panel-title',
]);

function escapeAttributeValue(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeAttributeValue(value: string, maxLength?: number): string {
  let normalized = value.trim().replace(/\s+/g, ' ');
  if (typeof maxLength === 'number' && maxLength > 0 && normalized.length > maxLength) {
    if (maxLength === 1) {
      normalized = normalized.slice(0, 1);
    } else {
      normalized = `${normalized.slice(0, maxLength - 1)}…`;
    }
  }
  return escapeAttributeValue(normalized);
}

export interface ContextPanelInfo {
  panelId: string;
  panelType: string;
  panelTitle?: string | null;
}

export interface ContextLineOptions {
  mode?: 'brief' | null;
  panel?: ContextPanelInfo | null;
  contextAttributes?: Record<string, string> | null;
}

export function buildContextLine(
  contextItem: { type: string; id: string } | null,
  contextItemName: string | null,
  selectedItemIds: string[],
  contextItemDescription: string | null = null,
  options?: ContextLineOptions,
  selectedItemTitles: string[] = [],
): string {
  const attrs: string[] = [];
  if (contextItem) {
    attrs.push(`type="${contextItem.type}"`);
    attrs.push(`id="${contextItem.id}"`);
    if (contextItemName) {
      attrs.push(`name="${normalizeAttributeValue(contextItemName)}"`);
    }
    if (contextItem.type === 'list' && contextItemDescription) {
      const trimmedDescription = contextItemDescription.trim();
      if (trimmedDescription.length > 0) {
        attrs.push(
          `description="${normalizeAttributeValue(trimmedDescription, MAX_DESCRIPTION_ATTR_LENGTH)}"`,
        );
      }
    }
  }

  if (selectedItemIds.length > 0) {
    attrs.push(`selection="${selectedItemIds.join(',')}"`);
  }
  const normalizedTitles = selectedItemTitles
    .map((title) => title.trim())
    .filter((title) => title.length > 0);
  if (normalizedTitles.length > 0) {
    const serialized = JSON.stringify(normalizedTitles);
    attrs.push(
      `selection-titles="${normalizeAttributeValue(serialized, MAX_SELECTION_TITLES_ATTR_LENGTH)}"`,
    );
  }

  if (options?.mode === 'brief') {
    attrs.push('mode="brief"');
  }

  const activePanel = options?.panel ?? null;
  if (activePanel) {
    attrs.push(`panel-id="${normalizeAttributeValue(activePanel.panelId)}"`);
    attrs.push(`panel-type="${normalizeAttributeValue(activePanel.panelType)}"`);
    const panelTitle = activePanel.panelTitle ?? null;
    if (panelTitle && panelTitle.trim().length > 0) {
      attrs.push(`panel-title="${normalizeAttributeValue(panelTitle)}"`);
    }
  }
  const contextAttributes = options?.contextAttributes ?? null;
  if (contextAttributes) {
    for (const [rawKey, rawValue] of Object.entries(contextAttributes)) {
      const key = rawKey.trim();
      if (!key) {
        continue;
      }
      const normalizedKey = key.toLowerCase();
      if (RESERVED_CONTEXT_ATTRS.has(normalizedKey)) {
        continue;
      }
      if (!/^[a-z][a-z0-9-]*$/i.test(key)) {
        continue;
      }
      const value = rawValue.trim();
      if (!value) {
        continue;
      }
      attrs.push(`${key}="${normalizeAttributeValue(value, MAX_CONTEXT_ATTR_LENGTH)}"`);
    }
  }

  if (attrs.length === 0) {
    return '<context />';
  }

  return `<context ${attrs.join(' ')} />`;
}

/**
 * Strip the context line from the start of a message for display purposes.
 * If __ASSISTANT_HIDE_CONTEXT__ is false, the context line is preserved.
 */
export function stripContextLine(text: string): string {
  if (!shouldHideContext()) {
    return text;
  }
  if (
    text.startsWith('<context ') ||
    text.startsWith('<context/>') ||
    text.startsWith('<context />')
  ) {
    const newlineIndex = text.indexOf('\n');
    if (newlineIndex !== -1) {
      return text.slice(newlineIndex + 1);
    }
    return '';
  }
  return text;
}

export function appendMessage(
  container: HTMLElement,
  role: 'user' | 'assistant' | 'error',
  text: string,
  useMarkdown: boolean = false,
): HTMLDivElement {
  clearEmptySessionHint(container);
  const wrapper = document.createElement('div');
  wrapper.className = `message ${role}`;

  if (role === 'user') {
    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = 'U';
    wrapper.appendChild(avatar);

    const content = document.createElement('div');
    content.className = 'message-content';
    content.textContent = text;
    wrapper.appendChild(content);
  } else if (useMarkdown && role === 'assistant') {
    applyMarkdownToElement(wrapper, text);
  } else {
    wrapper.textContent = text;
  }
  container.appendChild(wrapper);
  return wrapper;
}

export function decorateUserMessageAsAgent(messageEl: HTMLDivElement, agentLabel: string): void {
  const trimmedLabel = agentLabel.trim();
  messageEl.classList.add('agent-message');
  const avatar = messageEl.querySelector<HTMLDivElement>('.message-avatar');
  if (avatar) {
    avatar.classList.add('agent-message-badge');
    const badgeText = trimmedLabel ? trimmedLabel.charAt(0).toUpperCase() : 'A';
    avatar.textContent = badgeText;
  }
  const content = messageEl.querySelector<HTMLDivElement>('.message-content');
  if (!content) {
    return;
  }
  if (content.querySelector('.agent-message-label')) {
    return;
  }
  const text = content.textContent ?? '';
  content.textContent = '';
  const label = document.createElement('div');
  label.className = 'agent-message-label';
  label.textContent = trimmedLabel ? `Message from ${trimmedLabel}` : 'Message from Agent';
  const body = document.createElement('div');
  body.className = 'agent-message-body';
  body.textContent = text;
  content.appendChild(label);
  content.appendChild(body);
}

export function setAssistantBubbleTyping(bubble: HTMLDivElement): void {
  bubble.innerHTML =
    '<span class="typing-indicator"><span></span><span></span><span></span></span>';
  bubble.dataset['typing'] = 'true';
}

export function appendInterruptedIndicator(container: HTMLElement): HTMLDivElement {
  const indicator = document.createElement('div');
  indicator.className = 'message-interrupted';
  indicator.textContent = 'Interrupted';
  container.appendChild(indicator);
  return indicator;
}

export function clearExternalSentIndicators(container: HTMLElement): void {
  const indicators = container.querySelectorAll<HTMLDivElement>(
    '.message-interrupted[data-external-sent="true"]',
  );
  for (const indicator of Array.from(indicators)) {
    indicator.remove();
  }
}

export function appendExternalSentIndicator(container: HTMLElement): HTMLDivElement {
  clearExternalSentIndicators(container);
  const indicator = document.createElement('div');
  indicator.className = 'message-interrupted';
  indicator.dataset['externalSent'] = 'true';
  indicator.textContent = 'Sent to external agent';
  container.appendChild(indicator);
  return indicator;
}

export function scrollMessageIntoView(container: HTMLElement, element: HTMLElement): void {
  container.scrollTop = element.offsetTop;
  const scrollButton =
    container
      .closest<HTMLElement>('.chat-log-container')
      ?.querySelector<HTMLElement>('.chat-scroll-to-bottom') ?? null;
  if (scrollButton) {
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 50;
    if (isAtBottom) {
      scrollButton.classList.remove('visible');
    }
  }
}

export function setStatus(element: HTMLElement, text: string): void {
  element.textContent = text;
}
