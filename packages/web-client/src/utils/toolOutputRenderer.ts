import { applyMarkdownToElement } from './markdown';

export interface ToolOutputBlockOptions {
  callId: string;
  toolName: string;
  /**
   * Optional human-readable header label, for example:
   * "$ ls -la" for the bash tool.
   */
  headerLabel?: string;
  /**
   * Whether to start the block expanded (default: false).
   */
  expanded?: boolean;
}

export interface ToolOutputStatus {
  ok?: boolean;
  truncated?: boolean;
  truncatedBy?: 'lines' | 'bytes';
  totalLines?: number;
  totalBytes?: number;
  outputLines?: number;
  outputBytes?: number;
  interrupted?: boolean;
  /** If true, tool is still running and output is streaming */
  streaming?: boolean;
  /** If true, style as an async agent callback (gold) instead of normal success (green) */
  agentCallback?: boolean;
  /** Optional status state for header and styling */
  state?: ToolOutputState;
  /** Optional label override for the header status */
  statusLabel?: string;
  /** Optional pending copy when showing a waiting/queued indicator */
  pendingText?: string;
  /** Custom label for input section (default: "Input") */
  inputLabel?: string;
  /** Custom label for output section (default: "Output") */
  outputLabel?: string;
  /** If provided, display this as the input content */
  inputText?: string;
  /** If provided, store raw JSON for toggle display */
  rawJson?: string;
}

export type ToolOutputState =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'complete'
  | 'error'
  | 'interrupted';

export type ToolCallGroupState = 'running' | 'error' | 'complete';

export interface ToolCallGroupOptions {
  /**
   * Whether to start the group expanded (default: false).
   */
  expanded?: boolean;
}

type ToolOutputInputState =
  | { kind: 'none' }
  | { kind: 'streaming'; text: string; label: string }
  | { kind: 'formatted'; argsJson: string }
  | { kind: 'custom'; text: string; label: string };

interface ToolOutputBlockState {
  readonly headerButton: HTMLButtonElement;
  readonly toggleIcon: HTMLSpanElement;
  readonly content: HTMLDivElement;
  readonly inputSection: HTMLDivElement;
  readonly outputSection: HTMLDivElement;
  toolName: string;
  input: ToolOutputInputState;
  outputText: string;
  outputStatus?: ToolOutputStatus;
  nearViewport: boolean;
  // Blocks with dedicated custom DOM manage their own body lifecycle and should not be dehydrated.
  staticContent: boolean;
}

const toolOutputBlockStates = new WeakMap<HTMLDivElement, ToolOutputBlockState>();

export function getToolOutputToggleSymbol(expanded: boolean): string {
  return expanded ? '▼' : '▶';
}

export function getToolCallGroupToggleSymbol(expanded: boolean): string {
  return expanded ? '▼' : '▶';
}

function createHeaderLabel(toolName: string, headerLabel?: string): string {
  if (headerLabel && headerLabel.trim().length > 0) {
    return headerLabel.trim();
  }
  return toolName;
}

function getToolCallGroupStatusLabel(state: ToolCallGroupState): string {
  switch (state) {
    case 'running':
      return 'Running';
    case 'error':
      return 'Error';
    case 'complete':
      return 'Complete';
    default:
      return 'Status';
  }
}

export function createToolOutputBlock(options: ToolOutputBlockOptions): HTMLDivElement {
  const { callId, toolName, headerLabel, expanded = false } = options;

  const block = document.createElement('div');
  block.className = expanded ? 'tool-output-block expanded' : 'tool-output-block';
  block.dataset['callId'] = callId;
  block.dataset['toolName'] = toolName;

  const headerButton = document.createElement('button');
  headerButton.type = 'button';
  headerButton.className = 'tool-output-header';
  headerButton.setAttribute('aria-expanded', expanded ? 'true' : 'false');

  const headerMain = document.createElement('span');
  headerMain.className = 'tool-output-header-main';

  const toggleIcon = document.createElement('span');
  toggleIcon.className = 'tool-output-toggle';
  toggleIcon.textContent = getToolOutputToggleSymbol(expanded);

  const title = document.createElement('span');
  title.className = 'tool-output-title';
  title.textContent = toolName;

  const labelText = createHeaderLabel(toolName, headerLabel);
  const label = document.createElement('span');
  label.className = 'tool-output-label';
  label.textContent = labelText;

  headerMain.appendChild(toggleIcon);
  headerMain.appendChild(title);
  if (labelText && labelText !== toolName) {
    headerMain.appendChild(label);
  }

  const status = document.createElement('span');
  status.className = 'tool-output-status';

  const headerChevron = document.createElement('span');
  headerChevron.className = 'tool-output-chevron';
  headerChevron.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  headerButton.appendChild(headerMain);
  headerButton.appendChild(status);
  headerButton.appendChild(headerChevron);

  const content = document.createElement('div');
  content.className = 'tool-output-content';

  // Input section (for tool call arguments)
  const inputSection = document.createElement('div');
  inputSection.className = 'tool-output-input';
  content.appendChild(inputSection);

  // Output section (for tool result)
  const outputSection = document.createElement('div');
  outputSection.className = 'tool-output-result';
  content.appendChild(outputSection);

  headerButton.addEventListener('click', () => {
    setToolOutputBlockExpanded(block, !block.classList.contains('expanded'));
  });

  toolOutputBlockStates.set(block, {
    headerButton,
    toggleIcon,
    content,
    inputSection,
    outputSection,
    toolName,
    input: { kind: 'none' },
    outputText: '',
    nearViewport: true,
    staticContent: false,
  });

  block.appendChild(headerButton);
  block.appendChild(content);

  return block;
}

export function createToolCallGroup(options: ToolCallGroupOptions = {}): HTMLDivElement {
  const { expanded = false } = options;

  const group = document.createElement('div');
  group.className = expanded ? 'tool-call-group expanded' : 'tool-call-group';

  const headerButton = document.createElement('button');
  headerButton.type = 'button';
  headerButton.className = 'tool-call-group-header';
  headerButton.setAttribute('aria-expanded', expanded ? 'true' : 'false');

  const headerMain = document.createElement('span');
  headerMain.className = 'tool-call-group-header-main';

  const toggleIcon = document.createElement('span');
  toggleIcon.className = 'tool-call-group-toggle';
  toggleIcon.textContent = getToolCallGroupToggleSymbol(expanded);

  const title = document.createElement('span');
  title.className = 'tool-call-group-title';
  title.textContent = 'Tool calls';

  const count = document.createElement('span');
  count.className = 'tool-call-group-count';

  const summary = document.createElement('span');
  summary.className = 'tool-call-group-summary';

  headerMain.appendChild(toggleIcon);
  headerMain.appendChild(title);
  headerMain.appendChild(count);
  headerMain.appendChild(summary);

  const status = document.createElement('span');
  status.className = 'tool-call-group-status';

  const headerChevron = document.createElement('span');
  headerChevron.className = 'tool-call-group-chevron';
  headerChevron.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  headerButton.appendChild(headerMain);
  headerButton.appendChild(status);
  headerButton.appendChild(headerChevron);

  const content = document.createElement('div');
  content.className = 'tool-call-group-content';

  headerButton.addEventListener('click', () => {
    const isExpanded = group.classList.toggle('expanded');
    headerButton.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    toggleIcon.textContent = getToolCallGroupToggleSymbol(isExpanded);
  });

  group.appendChild(headerButton);
  group.appendChild(content);

  return group;
}

export function updateToolCallGroup(
  group: HTMLDivElement,
  options: { count: number; summary: string; state: ToolCallGroupState },
): void {
  const countEl = group.querySelector<HTMLElement>('.tool-call-group-count');
  if (countEl) {
    countEl.textContent = `${options.count} call${options.count === 1 ? '' : 's'}`;
  }

  const summaryEl = group.querySelector<HTMLElement>('.tool-call-group-summary');
  if (summaryEl) {
    summaryEl.textContent = options.summary;
  }

  const statusEl = group.querySelector<HTMLElement>('.tool-call-group-status');
  if (statusEl) {
    const statusLabel = getToolCallGroupStatusLabel(options.state);
    statusEl.textContent = statusLabel;
    const showIcon = options.state === 'complete' || options.state === 'error';
    if (showIcon) {
      statusEl.dataset['icon'] = options.state === 'complete' ? 'check' : 'error';
      statusEl.setAttribute('aria-label', statusLabel);
      statusEl.setAttribute('title', statusLabel);
    } else {
      delete statusEl.dataset['icon'];
      statusEl.removeAttribute('aria-label');
      statusEl.removeAttribute('title');
    }
  }

  group.dataset['status'] = options.state;
}

function getStatusLabel(state: ToolOutputState): string {
  switch (state) {
    case 'queued':
      return 'Queued';
    case 'running':
      return 'Running';
    case 'waiting':
      return 'Waiting';
    case 'complete':
      return 'Complete';
    case 'error':
      return 'Error';
    case 'interrupted':
      return 'Interrupted';
    default:
      return 'Status';
  }
}

function applyToolOutputStatus(
  block: HTMLDivElement,
  state: ToolOutputState,
  label?: string,
): void {
  const statusEl = block.querySelector<HTMLElement>('.tool-output-status');
  if (statusEl) {
    const statusLabel = label && label.trim().length > 0 ? label : getStatusLabel(state);
    statusEl.textContent = statusLabel;
    const normalized = statusLabel.trim().toLowerCase();
    const showIcon =
      (state === 'complete' && normalized === 'complete') ||
      (state === 'error' && normalized === 'error');
    if (showIcon) {
      statusEl.dataset['icon'] = state === 'complete' ? 'check' : 'error';
      statusEl.setAttribute('aria-label', statusLabel);
      statusEl.setAttribute('title', statusLabel);
    } else {
      delete statusEl.dataset['icon'];
      statusEl.removeAttribute('aria-label');
      statusEl.removeAttribute('title');
    }
  }
  block.dataset['status'] = state;
}

function getToolOutputBlockState(block: HTMLDivElement): ToolOutputBlockState | null {
  return toolOutputBlockStates.get(block) ?? null;
}

function createToolOutputJsonToggleButton(): HTMLButtonElement {
  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'tool-output-json-toggle';
  toggleBtn.textContent = 'JSON';
  toggleBtn.setAttribute('aria-label', 'Toggle raw JSON view');
  toggleBtn.dataset['showingJson'] = 'false';
  return toggleBtn;
}

function attachToolOutputJsonToggle(
  toggleBtn: HTMLButtonElement,
  renderFormatted: () => void,
  renderJson: () => void,
): void {
  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const showingJson = toggleBtn.dataset['showingJson'] === 'true';
    if (showingJson) {
      renderFormatted();
      toggleBtn.textContent = 'JSON';
      toggleBtn.dataset['showingJson'] = 'false';
      return;
    }

    renderJson();
    toggleBtn.textContent = 'Formatted';
    toggleBtn.dataset['showingJson'] = 'true';
  });
}

function renderToolOutputInput(state: ToolOutputBlockState): void {
  const inputSection = state.inputSection;
  inputSection.replaceChildren();

  if (state.input.kind === 'none') {
    return;
  }

  if (state.input.kind === 'streaming') {
    const labelRow = document.createElement('div');
    labelRow.className = 'tool-output-section-label';
    labelRow.textContent = state.input.label;
    inputSection.appendChild(labelRow);

    const inputBody = document.createElement('div');
    inputBody.className = 'tool-output-input-body streaming';
    inputBody.textContent = state.input.text;
    inputSection.appendChild(inputBody);
    return;
  }

  if (state.input.kind === 'custom') {
    const inputLabel = document.createElement('div');
    inputLabel.className = 'tool-output-section-label';
    inputLabel.textContent = state.input.label;
    inputSection.appendChild(inputLabel);

    const inputBody = document.createElement('div');
    inputBody.className = 'tool-output-input-body markdown-content';
    applyMarkdownToElement(inputBody, state.input.text);
    inputSection.appendChild(inputBody);
    return;
  }

  const argsJson = state.input.argsJson;
  const toolName = state.toolName;
  let formattedText = '';
  let label = 'Input';
  let isAgentMessage = false;
  let isPlainTextInput = false;
  let rawJson = '';
  let prettyJson = '';

  if (argsJson.trim().length === 0) {
    return;
  }

  try {
    const argsRecord = JSON.parse(argsJson) as Record<string, unknown>;
    rawJson = JSON.stringify(argsRecord);
    prettyJson = JSON.stringify(argsRecord, null, 2);

    if (toolName === 'agents_message' && typeof argsRecord['content'] === 'string') {
      formattedText = argsRecord['content'];
      label = 'Sent';
      isAgentMessage = true;
    } else if (toolName === 'write' && typeof argsRecord['content'] === 'string') {
      formattedText = argsRecord['content'];
      label = 'Content';
      isPlainTextInput = true;
    } else if (toolName === 'bash' && typeof argsRecord['command'] === 'string') {
      formattedText = argsRecord['command'] as string;
    } else {
      formattedText = prettyJson;
    }
  } catch {
    formattedText = argsJson;
    rawJson = argsJson;
    prettyJson = argsJson;
  }

  const labelRow = document.createElement('div');
  labelRow.className = 'tool-output-section-label';
  labelRow.textContent = label;

  const hasJsonToggle = rawJson.trim().length > 0;
  if (hasJsonToggle) {
    labelRow.appendChild(createToolOutputJsonToggleButton());
  }

  inputSection.appendChild(labelRow);

  const inputBody = document.createElement('div');
  inputBody.className = 'tool-output-input-body markdown-content';

  const renderFormatted = () => {
    inputBody.innerHTML = '';
    if (isAgentMessage) {
      applyMarkdownToElement(inputBody, formattedText);
      return;
    }
    if (isPlainTextInput) {
      applyMarkdownToElement(inputBody, `\`\`\`\n${formattedText}\n\`\`\``);
      return;
    }
    const language =
      toolName === 'bash' || toolName === 'shell' || toolName === 'sh' ? 'bash' : undefined;
    const markdownText = language
      ? `\`\`\`${language}\n${formattedText}\n\`\`\``
      : `\`\`\`json\n${formattedText}\n\`\`\``;
    applyMarkdownToElement(inputBody, markdownText);
  };

  const renderJson = () => {
    inputBody.innerHTML = '';
    const jsonText = rawJson || prettyJson || argsJson;
    applyMarkdownToElement(inputBody, '```json\n' + jsonText + '\n```');
  };

  renderFormatted();

  const toggleBtn = labelRow.querySelector<HTMLButtonElement>('.tool-output-json-toggle');
  if (toggleBtn) {
    attachToolOutputJsonToggle(toggleBtn, renderFormatted, renderJson);
  }

  inputSection.appendChild(inputBody);
}

function renderToolOutputResult(state: ToolOutputBlockState): void {
  const outputSection = state.outputSection;
  const preservedInteractions = Array.from(outputSection.children).filter((child) =>
    child.classList.contains('tool-interaction'),
  );
  outputSection.replaceChildren();

  const status = state.outputStatus;
  const text = state.outputText;
  const trimmed = text.replace(/\s+$/, '');
  const toolName = state.toolName;

  const streaming = status?.streaming === true;
  const interrupted = status?.interrupted === true;
  const ok = status?.ok;
  const agentCallback = status?.agentCallback === true;
  const derivedState: ToolOutputState | undefined =
    status?.state ??
    (streaming
      ? 'running'
      : interrupted
        ? 'interrupted'
        : ok === false
          ? 'error'
          : ok === true
            ? 'complete'
            : undefined);
  const isPendingState =
    derivedState === 'queued' || derivedState === 'waiting' || derivedState === 'running';

  if (!trimmed && !(isPendingState && status?.pendingText) && preservedInteractions.length === 0) {
    outputSection.classList.remove('markdown-content');
    return;
  }

  for (const interaction of preservedInteractions) {
    outputSection.appendChild(interaction);
  }

  if (!trimmed && !(isPendingState && status?.pendingText)) {
    outputSection.classList.remove('markdown-content');
    return;
  }

  const outputLabel = status?.outputLabel ?? 'Output';
  const labelRow = document.createElement('div');
  labelRow.className = 'tool-output-section-label';
  labelRow.textContent = outputLabel;

  if (status?.rawJson && !(isPendingState && status?.pendingText)) {
    labelRow.appendChild(createToolOutputJsonToggleButton());
  }

  outputSection.appendChild(labelRow);

  if (isPendingState && status?.pendingText) {
    const pendingIndicator = document.createElement('div');
    pendingIndicator.className = 'tool-output-pending';
    const spinner = document.createElement('span');
    spinner.className = 'tool-output-spinner';
    pendingIndicator.appendChild(spinner);
    pendingIndicator.append(` ${status.pendingText}`);
    outputSection.appendChild(pendingIndicator);
    return;
  }

  if (!trimmed) {
    return;
  }

  const outputBody = document.createElement('div');
  outputBody.className = 'tool-output-output-body';
  outputSection.appendChild(outputBody);

  const isMarkdownResult = toolName === 'notes_read' || toolName === 'notes_show';
  const isAgentMessage = toolName === 'agents_message';
  const isBashTool = toolName === 'bash' || toolName === 'shell' || toolName === 'sh';
  const useStreamingPlainText = canUseStreamingPlainTextOutput(status, toolName);

  if (useStreamingPlainText) {
    const pre = document.createElement('pre');
    pre.className = 'tool-output-streaming-pre';
    pre.textContent = text;
    outputBody.appendChild(pre);
    return;
  }

  let formattedMarkdown: string;
  if (isMarkdownResult || agentCallback || isAgentMessage) {
    outputBody.classList.add('markdown-content');
    formattedMarkdown = trimmed;
    applyMarkdownToElement(outputBody, formattedMarkdown);
  } else {
    const language = isBashTool ? 'bash' : undefined;
    formattedMarkdown = language
      ? `\`\`\`${language}\n${trimmed}\n\`\`\``
      : `\`\`\`\n${trimmed}\n\`\`\``;
    applyMarkdownToElement(outputBody, formattedMarkdown);
  }

  if (status?.rawJson) {
    const toggleBtn = labelRow.querySelector<HTMLButtonElement>('.tool-output-json-toggle');
    if (toggleBtn) {
      const rawJson = status.rawJson;
      attachToolOutputJsonToggle(
        toggleBtn,
        () => {
          outputBody.innerHTML = '';
          if (isMarkdownResult || agentCallback || isAgentMessage) {
            outputBody.classList.add('markdown-content');
          }
          applyMarkdownToElement(outputBody, formattedMarkdown);
        },
        () => {
          outputBody.innerHTML = '';
          outputBody.classList.remove('markdown-content');
          applyMarkdownToElement(outputBody, '```json\n' + rawJson + '\n```');
        },
      );
    }
  }

  if (status?.truncated) {
    const footer = document.createElement('div');
    footer.className = 'tool-output-truncation-footer';

    const prefix = '⚠️ Output truncated';
    const truncatedBy = status.truncatedBy;

    let details = '';
    if (
      truncatedBy === 'lines' &&
      typeof status.outputLines === 'number' &&
      typeof status.totalLines === 'number'
    ) {
      details = ` (showing ${status.outputLines} lines of ${status.totalLines})`;
    } else if (
      truncatedBy === 'bytes' &&
      typeof status.outputBytes === 'number' &&
      typeof status.totalBytes === 'number'
    ) {
      const shown = formatByteSize(status.outputBytes);
      const total = formatByteSize(status.totalBytes);
      details = ` (showing ${shown} of ${total})`;
    }

    footer.textContent = `${prefix}${details}`;
    outputSection.appendChild(footer);
  }
}

function syncToolOutputBlockContent(block: HTMLDivElement): void {
  const state = getToolOutputBlockState(block);
  if (!state) {
    return;
  }
  const shouldKeepMountedBody =
    state.staticContent ||
    block.classList.contains('has-pending-interaction') ||
    block.classList.contains('has-pending-approval') ||
    block.querySelector('.tool-interaction') !== null;
  const isRunning =
    state.input.kind === 'streaming' ||
    state.outputStatus?.streaming === true ||
    state.outputStatus?.state === 'queued' ||
    state.outputStatus?.state === 'waiting' ||
    state.outputStatus?.state === 'running';
  const shouldHydrateExpandedBody =
    block.classList.contains('expanded') && (state.nearViewport || isRunning);

  if (!shouldHydrateExpandedBody && !shouldKeepMountedBody) {
    if (!state.inputSection.hasChildNodes() && !state.outputSection.hasChildNodes()) {
      return;
    }
    state.inputSection.replaceChildren();
    state.outputSection.replaceChildren();
    return;
  }

  renderToolOutputInput(state);
  renderToolOutputResult(state);
}

function canUseStreamingPlainTextOutput(status: ToolOutputStatus | undefined, toolName: string): boolean {
  if (!status || status.streaming !== true) {
    return false;
  }
  if (status.rawJson || status.pendingText || status.truncated || status.agentCallback) {
    return false;
  }
  return toolName !== 'notes_read' && toolName !== 'notes_show' && toolName !== 'agents_message';
}

export function setToolOutputBlockNearViewport(
  block: HTMLDivElement,
  nearViewport: boolean,
): void {
  const state = getToolOutputBlockState(block);
  if (!state || state.nearViewport === nearViewport) {
    return;
  }
  state.nearViewport = nearViewport;
  syncToolOutputBlockContent(block);
}

export function setToolOutputBlockExpanded(block: HTMLDivElement, expanded: boolean): void {
  const state = getToolOutputBlockState(block);
  block.classList.toggle('expanded', expanded);
  if (state) {
    state.headerButton.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    state.toggleIcon.textContent = getToolOutputToggleSymbol(expanded);
  } else {
    const headerButton = block.querySelector<HTMLButtonElement>('.tool-output-header');
    if (headerButton) {
      headerButton.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    }
    const toggleIcon = block.querySelector<HTMLElement>('.tool-output-toggle');
    if (toggleIcon) {
      toggleIcon.textContent = getToolOutputToggleSymbol(expanded);
    }
  }
  syncToolOutputBlockContent(block);
}

export function updateToolOutputBlockStreamingInput(
  block: HTMLDivElement,
  text: string,
  label = 'Input',
): void {
  const state = getToolOutputBlockState(block);
  if (!state) {
    return;
  }
  state.input = { kind: 'streaming', text, label };
  const mountedBody = state.inputSection.querySelector<HTMLDivElement>('.tool-output-input-body.streaming');
  const mountedLabel = state.inputSection.querySelector<HTMLDivElement>('.tool-output-section-label');
  if (mountedBody && mountedLabel) {
    mountedBody.textContent = text;
    mountedLabel.textContent = label;
    return;
  }
  syncToolOutputBlockContent(block);
}

export function getToolCallSummary(block: HTMLDivElement): string {
  const title =
    block.querySelector<HTMLElement>('.tool-output-title')?.textContent?.trim() ??
    block.dataset['toolName'] ??
    '';
  const label = block.querySelector<HTMLElement>('.tool-output-label')?.textContent?.trim() ?? '';
  if (label && label !== title) {
    return `${title}: ${label}`;
  }
  return title || 'Tool';
}

export function getToolCallGroupState(blocks: HTMLDivElement[]): ToolCallGroupState {
  if (blocks.length === 0) {
    return 'complete';
  }

  let hasRunning = false;
  let hasError = false;
  let allComplete = true;

  for (const block of blocks) {
    const status = block.dataset['status'];
    const isRunning =
      status === 'running' ||
      status === 'queued' ||
      status === 'waiting' ||
      block.classList.contains('pending') ||
      block.classList.contains('streaming') ||
      block.classList.contains('streaming-input');
    const isError =
      status === 'error' ||
      block.classList.contains('error') ||
      block.classList.contains('interrupted');
    const isComplete =
      status === 'complete' ||
      block.classList.contains('success') ||
      block.classList.contains('agent-callback');

    if (isRunning) {
      hasRunning = true;
    }
    if (isError) {
      hasError = true;
    }
    if (!isComplete) {
      allComplete = false;
    }
  }

  if (hasRunning) {
    return 'running';
  }
  if (hasError) {
    return 'error';
  }
  return allComplete ? 'complete' : 'running';
}

export function updateToolOutputBlockContent(
  block: HTMLDivElement,
  toolName: string,
  text: string,
  status?: ToolOutputStatus,
): void {
  const state = getToolOutputBlockState(block);
  if (!state) {
    return;
  }

  const streaming = status?.streaming === true;
  const interrupted = status?.interrupted === true;
  const ok = status?.ok;
  const truncated = status?.truncated === true;
  const agentCallback = status?.agentCallback === true;
  const derivedState: ToolOutputState | undefined =
    status?.state ??
    (streaming
      ? 'running'
      : interrupted
        ? 'interrupted'
        : ok === false
          ? 'error'
          : ok === true
            ? 'complete'
            : undefined);
  const isPendingState =
    derivedState === 'queued' || derivedState === 'waiting' || derivedState === 'running';

  // For streaming, keep pending state but show content
  // For completed, remove pending state
  if (!streaming && !isPendingState) {
    block.classList.remove('pending');
    const pendingIndicator = block.querySelector('.tool-output-pending');
    if (pendingIndicator) {
      pendingIndicator.remove();
    }
  } else if (isPendingState) {
    block.classList.add('pending');
  }
  if (streaming) {
    // Add streaming class to indicate active output
    block.classList.add('streaming');
  }

  // Set success/error state (only when not streaming)
  if (!streaming) {
    block.classList.remove(
      'success',
      'error',
      'truncated',
      'interrupted',
      'agent-callback',
      'streaming',
    );
    if (!isPendingState) {
      if (interrupted) {
        block.classList.add('interrupted');
      } else if (agentCallback && ok === true) {
        block.classList.add('agent-callback');
      } else if (ok === true) {
        block.classList.add('success');
        if (truncated) {
          block.classList.add('truncated');
        }
      } else if (ok === false) {
        block.classList.add('error');
      }
    }
  }

  if (derivedState) {
    const statusLabel =
      status?.statusLabel ??
      (truncated && ok === true && derivedState === 'complete' ? 'Truncated' : undefined);
    applyToolOutputStatus(block, derivedState, statusLabel);
  }

  if (status?.inputText !== undefined) {
    state.input = {
      kind: 'custom',
      text: status.inputText,
      label: status.inputLabel ?? 'Sent',
    };
  }

  state.outputText = text;
  state.toolName = toolName;
  if (status) {
    state.outputStatus = status;
  } else {
    delete state.outputStatus;
  }
  if (canUseStreamingPlainTextOutput(status, toolName)) {
    const streamingPre = state.outputSection.querySelector<HTMLPreElement>(
      '.tool-output-streaming-pre',
    );
    if (streamingPre) {
      streamingPre.textContent = text;
      return;
    }
  }
  syncToolOutputBlockContent(block);
}

function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return `${bytes}B`;
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)}B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)}KB`;
  }
  const mb = kb / 1024;
  return `${mb.toFixed(1)}MB`;
}

/**
 * Extract a human-readable label from tool call arguments.
 */
export function extractToolCallLabel(toolName: string, argsJson: string): string {
  try {
    const args = JSON.parse(argsJson) as Record<string, unknown>;

    if (toolName === 'bash' && typeof args['command'] === 'string') {
      // Return full command - CSS handles truncation with ellipsis
      return args['command'] as string;
    }

    if (
      (toolName === 'read' || toolName === 'write' || toolName === 'edit') &&
      typeof args['path'] === 'string'
    ) {
      return args['path'] as string;
    }

    // For other tools, show first string argument
    for (const value of Object.values(args)) {
      if (typeof value === 'string' && value.length > 0) {
        return value;
      }
    }
  } catch {
    // Ignore parse errors
  }
  return '';
}

/**
 * Set the tool call input on the block (shown when expanded).
 */
export function setToolOutputBlockInput(block: HTMLDivElement, argsJson: string): void {
  const state = getToolOutputBlockState(block);
  if (!state) {
    return;
  }

  // Store the args for reference
  block.dataset['argsJson'] = argsJson;
  state.input =
    argsJson.trim().length > 0 ? { kind: 'formatted', argsJson } : { kind: 'none' };
  syncToolOutputBlockContent(block);
}

/**
 * Set the tool block to show a "pending" state with tool call info.
 */
export function setToolOutputBlockPending(
  block: HTMLDivElement,
  argsJson: string,
  options?: {
    pendingText?: string;
    statusLabel?: string;
    state?: ToolOutputState;
    outputLabel?: string;
  },
): void {
  block.classList.add('pending');

  // Set the input
  setToolOutputBlockInput(block, argsJson);

  const toolName = block.dataset['toolName'] ?? '';
  const isAgentMessage = toolName === 'agents_message';
  const state = options?.state ?? 'running';
  const statusLabel = options?.statusLabel;
  applyToolOutputStatus(block, state, statusLabel);
  const blockState = getToolOutputBlockState(block);
  if (!blockState) {
    return;
  }
  blockState.outputText = '';
  blockState.toolName = toolName;
  const outputStatus: ToolOutputStatus = {
    state,
    outputLabel: options?.outputLabel ?? (isAgentMessage ? 'Received' : 'Output'),
    pendingText:
      options?.pendingText ?? (isAgentMessage ? 'Waiting for response…' : 'Running…'),
  };
  if (statusLabel !== undefined) {
    outputStatus.statusLabel = statusLabel;
  }
  blockState.outputStatus = outputStatus;
  syncToolOutputBlockContent(block);
}

/**
 * Update the header label of a tool block.
 */
export function updateToolOutputBlockLabel(block: HTMLDivElement, label: string): void {
  const labelEl = block.querySelector<HTMLElement>('.tool-output-label');
  if (labelEl) {
    labelEl.textContent = label;
  } else if (label) {
    // Create label if it doesn't exist
    const headerMain = block.querySelector<HTMLElement>('.tool-output-header-main');
    if (headerMain) {
      const newLabel = document.createElement('span');
      newLabel.className = 'tool-output-label';
      newLabel.textContent = label;
      headerMain.appendChild(newLabel);
    }
  }
}

export interface AgentMessageExchangeBlockOptions {
  /**
   * Logical identifier for this agent exchange. Typically the
   * responseId of the target agent run.
   */
  exchangeId: string;
  /**
   * Human-readable agent label used in the header.
   */
  agentLabel: string;
  /**
   * User-visible input text that was sent to the target agent.
   */
  inputText: string;
  /**
   * Whether to start the block expanded (default: false).
   */
  expanded?: boolean;
}

/**
 * Create a tool-block-style container used to render an agent-to-agent
 * message exchange (incoming agents_message) on the receiver side.
 *
 * The block reuses the existing tool-output-block styling while
 * providing dedicated sections for input, nested tools, and output:
 *
 * - Input: plain text of the incoming message
 * - Tools: nested tool-output-block elements generated while the
 *   target agent processes the message
 * - Output: streaming assistant response from the target agent
 */
export function createAgentMessageExchangeBlock(
  options: AgentMessageExchangeBlockOptions,
): HTMLDivElement {
  const { exchangeId, agentLabel, inputText, expanded = false } = options;

  const headerTitle = `Message from ${agentLabel}`;

  const block = createToolOutputBlock({
    callId: exchangeId,
    toolName: headerTitle,
    expanded,
  });

  block.classList.add('agent-message-exchange', 'pending');
  block.dataset['agentExchangeId'] = exchangeId;
  block.dataset['agentLabel'] = agentLabel;

  applyToolOutputStatus(block, 'running');

  const content = block.querySelector<HTMLDivElement>('.tool-output-content');
  const inputSection = block.querySelector<HTMLDivElement>('.tool-output-input');
  const resultSection = block.querySelector<HTMLDivElement>('.tool-output-result');
  const blockState = getToolOutputBlockState(block);
  if (blockState) {
    blockState.staticContent = true;
  }

  if (content && inputSection && resultSection) {
    // Input section (message received from other agent)
    inputSection.innerHTML = '';
    const inputLabel = document.createElement('div');
    inputLabel.className = 'tool-output-section-label';
    inputLabel.textContent = 'Received';
    inputSection.appendChild(inputLabel);

    const inputBody = document.createElement('div');
    inputBody.className = 'agent-message-input';
    inputBody.textContent = inputText;
    inputSection.appendChild(inputBody);

    // Nested tools container (appears between input and output)
    const toolsContainer = document.createElement('div');
    toolsContainer.className = 'agent-message-tools';
    content.insertBefore(toolsContainer, resultSection);

    // Output section scaffold (response sent back)
    resultSection.innerHTML = '';
    const outputWrapper = document.createElement('div');
    outputWrapper.className = 'agent-message-output';

    const outputLabel = document.createElement('div');
    outputLabel.className = 'tool-output-section-label';
    outputLabel.textContent = 'Sent';
    outputWrapper.appendChild(outputLabel);

    const outputBody = document.createElement('div');
    outputBody.className = 'agent-message-output-body markdown-content';
    outputWrapper.appendChild(outputBody);

    resultSection.appendChild(outputWrapper);
  }

  return block;
}

export function getAgentMessageToolsContainer(block: HTMLDivElement): HTMLDivElement | null {
  return block.querySelector<HTMLDivElement>('.agent-message-tools');
}

export function getAgentMessageOutputBody(block: HTMLDivElement): HTMLDivElement | null {
  return block.querySelector<HTMLDivElement>('.agent-message-output-body');
}
