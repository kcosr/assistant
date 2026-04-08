import { applyMarkdownToElement } from './markdown';
import { parse as parsePartialJson } from 'partial-json';

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

interface ToolInputPreview {
  headerLabel: string;
  label: string;
  formattedText: string;
  renderMode: 'raw' | 'markdown' | 'code' | 'json';
  language?: string;
  prettyJson?: string;
  rawJson?: string;
}

interface ToolResultPreview {
  formattedText: string;
  renderMode: 'raw' | 'markdown' | 'code';
  language?: string;
}

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

function writeToolOutputSnapshotDataset(block: HTMLDivElement, state: ToolOutputBlockState): void {
  block.dataset['snapshotToolName'] = state.toolName;
  block.dataset['snapshotInputKind'] = state.input.kind;
  switch (state.input.kind) {
    case 'formatted':
      block.dataset['snapshotArgsJson'] = state.input.argsJson;
      delete block.dataset['snapshotInputText'];
      delete block.dataset['snapshotInputLabel'];
      break;
    case 'streaming':
    case 'custom':
      block.dataset['snapshotInputText'] = state.input.text;
      block.dataset['snapshotInputLabel'] = state.input.label;
      delete block.dataset['snapshotArgsJson'];
      break;
    case 'none':
    default:
      delete block.dataset['snapshotArgsJson'];
      delete block.dataset['snapshotInputText'];
      delete block.dataset['snapshotInputLabel'];
      break;
  }

  block.dataset['snapshotOutputText'] = state.outputText;
  if (state.outputStatus) {
    try {
      block.dataset['snapshotOutputStatus'] = JSON.stringify(state.outputStatus);
    } catch {
      delete block.dataset['snapshotOutputStatus'];
    }
  } else {
    delete block.dataset['snapshotOutputStatus'];
  }
}

function readToolOutputSnapshotStatus(block: HTMLDivElement): ToolOutputStatus | undefined {
  const raw = block.dataset['snapshotOutputStatus'];
  if (!raw) {
    return undefined;
  }
  try {
    return JSON.parse(raw) as ToolOutputStatus;
  } catch {
    return undefined;
  }
}

function buildToolOutputSnapshotStateFromDataset(
  source: HTMLDivElement,
  clone: HTMLDivElement,
): ToolOutputBlockState | null {
  const headerButton = clone.querySelector<HTMLButtonElement>('.tool-output-header');
  const toggleIcon = clone.querySelector<HTMLSpanElement>('.tool-output-toggle');
  const content = clone.querySelector<HTMLDivElement>('.tool-output-content');
  const inputSection = clone.querySelector<HTMLDivElement>('.tool-output-input');
  const outputSection = clone.querySelector<HTMLDivElement>('.tool-output-result');
  if (!headerButton || !toggleIcon || !content || !inputSection || !outputSection) {
    return null;
  }

  const inputKind = source.dataset['snapshotInputKind'] ?? (source.dataset['argsJson'] ? 'formatted' : 'none');
  let input: ToolOutputInputState;
  switch (inputKind) {
    case 'formatted':
      input = {
        kind: 'formatted',
        argsJson: source.dataset['snapshotArgsJson'] ?? source.dataset['argsJson'] ?? '',
      };
      break;
    case 'streaming':
      input = {
        kind: 'streaming',
        text: source.dataset['snapshotInputText'] ?? '',
        label: source.dataset['snapshotInputLabel'] ?? 'Input',
      };
      break;
    case 'custom':
      input = {
        kind: 'custom',
        text: source.dataset['snapshotInputText'] ?? '',
        label: source.dataset['snapshotInputLabel'] ?? 'Input',
      };
      break;
    case 'none':
    default:
      input = { kind: 'none' };
      break;
  }

  const outputStatus = readToolOutputSnapshotStatus(source);
  return {
    headerButton,
    toggleIcon,
    content,
    inputSection,
    outputSection,
    toolName: source.dataset['snapshotToolName'] ?? source.dataset['toolName'] ?? 'tool',
    input,
    outputText: source.dataset['snapshotOutputText'] ?? '',
    ...(outputStatus ? { outputStatus } : {}),
    nearViewport: true,
    staticContent: false,
  };
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function tryParseToolArgs(argsJson: string): { args: Record<string, unknown>; complete: boolean } | null {
  if (argsJson.trim().length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(argsJson) as unknown;
    return isRecord(parsed) ? { args: parsed, complete: true } : null;
  } catch {
    try {
      const parsed = parsePartialJson(argsJson) as unknown;
      return isRecord(parsed) ? { args: parsed, complete: false } : null;
    } catch {
      return null;
    }
  }
}

function formatReadLabel(args: Record<string, unknown>): string {
  const rawPath = typeof args['path'] === 'string' ? args['path'] : '';
  const offset = typeof args['offset'] === 'number' ? args['offset'] : undefined;
  const limit = typeof args['limit'] === 'number' ? args['limit'] : undefined;
  if (!rawPath) {
    return '';
  }
  if (offset === undefined && limit === undefined) {
    return rawPath;
  }
  const startLine = offset ?? 1;
  const endLine =
    limit !== undefined && Number.isFinite(limit) ? `${startLine + Math.max(limit, 1) - 1}` : '';
  return `${rawPath}:${startLine}${endLine ? `-${endLine}` : ''}`;
}

function inferLanguageFromPath(filePath: string): string | undefined {
  const lower = filePath.trim().toLowerCase();
  if (!lower) {
    return undefined;
  }
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) {
    return 'typescript';
  }
  if (lower.endsWith('.js') || lower.endsWith('.jsx') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) {
    return 'javascript';
  }
  if (lower.endsWith('.json')) {
    return 'json';
  }
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
    return 'markdown';
  }
  if (lower.endsWith('.py')) {
    return 'python';
  }
  if (lower.endsWith('.yml') || lower.endsWith('.yaml')) {
    return 'yaml';
  }
  if (lower.endsWith('.css')) {
    return 'css';
  }
  if (lower.endsWith('.html') || lower.endsWith('.htm')) {
    return 'xml';
  }
  if (lower.endsWith('.xml') || lower.endsWith('.svg')) {
    return 'xml';
  }
  if (lower.endsWith('.sql')) {
    return 'sql';
  }
  if (
    lower.endsWith('.sh') ||
    lower.endsWith('.bash') ||
    lower.endsWith('.zsh')
  ) {
    return 'bash';
  }
  return undefined;
}

function formatEditPreview(oldText: string, newText: string): string {
  const removed = oldText.split('\n').map((line) => `-${line}`);
  const added = newText.split('\n').map((line) => `+${line}`);
  return [...removed, ...added].join('\n');
}

function tryParseJsonRecord(rawJson: string | undefined): Record<string, unknown> | null {
  if (!rawJson || rawJson.trim().length === 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(rawJson) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function tryParseJsonValue(rawJson: string | undefined): unknown {
  if (!rawJson || rawJson.trim().length === 0) {
    return null;
  }
  try {
    return JSON.parse(rawJson) as unknown;
  } catch {
    return null;
  }
}

const LIST_ITEM_QUERY_TOOL_NAMES = new Set([
  'lists_items_list',
  'lists_items_search',
  'lists_items_aql',
]);
const LIST_ITEM_MUTATION_TOOL_NAMES = new Set(['lists_item_add', 'lists_item_update']);
const LIST_DEFINITION_TOOL_NAMES = new Set([
  'lists_list',
  'lists_get',
  'lists_create',
  'lists_update',
]);

type ListsToolInputPreview = Pick<ToolInputPreview, 'headerLabel' | 'label' | 'formattedText' | 'renderMode'>;

function isListItemLike(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    typeof value['title'] === 'string' &&
    (typeof value['position'] === 'number' || typeof value['listId'] === 'string')
  );
}

function isListDefinitionLike(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    typeof value['id'] === 'string' &&
    typeof value['name'] === 'string'
  );
}

function normalizeListsTableText(value: string, maxLength = 120): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function formatListsTableValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return normalizeListsTableText(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => formatListsTableValue(entry))
      .filter((entry) => entry.length > 0)
      .join(', ');
  }
  if (isRecord(value)) {
    return normalizeListsTableText(JSON.stringify(value));
  }
  return normalizeListsTableText(String(value));
}

function escapeMarkdownTableCell(value: string): string {
  if (!value) {
    return '';
  }
  return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

function buildMarkdownTable(headers: string[], rows: string[][]): string {
  const headerRow = `| ${headers.map(escapeMarkdownTableCell).join(' | ')} |`;
  const separatorRow = `| ${headers.map(() => '---').join(' | ')} |`;
  const bodyRows = rows.map(
    (row) => `| ${row.map((value) => escapeMarkdownTableCell(value)).join(' | ')} |`,
  );
  return [headerRow, separatorRow, ...bodyRows].join('\n');
}

function formatTags(value: unknown): string {
  if (!Array.isArray(value)) {
    return '';
  }
  return value
    .map((tag) => (typeof tag === 'string' ? tag.trim() : ''))
    .filter((tag) => tag.length > 0)
    .join(', ');
}

function getListsToolInputPreview(
  toolName: string,
  args: Record<string, unknown>,
): ListsToolInputPreview | null {
  if (
    !LIST_ITEM_QUERY_TOOL_NAMES.has(toolName) &&
    !LIST_ITEM_MUTATION_TOOL_NAMES.has(toolName) &&
    !LIST_DEFINITION_TOOL_NAMES.has(toolName)
  ) {
    return null;
  }

  const lines: string[] = [];
  const listId = typeof args['listId'] === 'string' ? args['listId'].trim() : '';
  const id = typeof args['id'] === 'string' ? args['id'].trim() : '';
  const name = typeof args['name'] === 'string' ? args['name'].trim() : '';
  const title = typeof args['title'] === 'string' ? args['title'].trim() : '';
  const lookupTitle = typeof args['lookupTitle'] === 'string' ? args['lookupTitle'].trim() : '';
  const query = typeof args['query'] === 'string' ? args['query'].trim() : '';
  const tags = formatTags(args['tags']);
  const url = typeof args['url'] === 'string' ? args['url'].trim() : '';
  const notes = typeof args['notes'] === 'string' ? args['notes'].trim() : '';
  const position = typeof args['position'] === 'number' ? String(args['position']) : '';

  if (listId) {
    lines.push(`- List: \`${listId}\``);
  } else if (id && (toolName === 'lists_get' || toolName === 'lists_update')) {
    lines.push(`- List: \`${id}\``);
  }
  if (name && (toolName === 'lists_create' || toolName === 'lists_update')) {
    lines.push(`- Name: ${name}`);
  }
  if (title) {
    lines.push(`- Title: ${title}`);
  } else if (lookupTitle) {
    lines.push(`- Item: ${lookupTitle}`);
  }
  if (query) {
    lines.push(`- Query: ${query}`);
  }
  if (position) {
    lines.push(`- Position: ${position}`);
  }
  if (url) {
    lines.push(`- URL: ${url}`);
  }
  if (notes) {
    lines.push(`- Notes: ${normalizeListsTableText(notes)}`);
  }
  if (tags) {
    lines.push(`- Tags: ${tags}`);
  }

  const customFields = args['customFields'];
  if (isRecord(customFields)) {
    for (const [key, value] of Object.entries(customFields)) {
      const formattedValue = formatListsTableValue(value);
      if (!formattedValue) {
        continue;
      }
      lines.push(`- ${key}: ${formattedValue}`);
    }
  }

  const fallbackHeaderLabel = title || name || listId || id || query || lookupTitle;
  if (lines.length === 0) {
    return null;
  }

  return {
    headerLabel: fallbackHeaderLabel,
    label: 'Request',
    formattedText: lines.join('\n'),
    renderMode: 'markdown',
  };
}

function formatListsItemRows(items: Record<string, unknown>[]): string {
  const includeUrl = items.some((item) => typeof item['url'] === 'string' && item['url'].trim().length > 0);
  const includeNotes = items.some(
    (item) => typeof item['notes'] === 'string' && item['notes'].trim().length > 0,
  );
  const customFieldOrder: string[] = [];
  const customFieldSeen = new Set<string>();
  for (const item of items) {
    const customFields = item['customFields'];
    if (!isRecord(customFields)) {
      continue;
    }
    for (const [key, value] of Object.entries(customFields)) {
      if (customFieldSeen.has(key) || formatListsTableValue(value).length === 0) {
        continue;
      }
      customFieldSeen.add(key);
      customFieldOrder.push(key);
    }
  }
  const includeTags = items.some((item) => formatTags(item['tags']).length > 0);

  const headers = ['Position', 'Title'];
  if (includeUrl) {
    headers.push('URL');
  }
  if (includeNotes) {
    headers.push('Notes');
  }
  for (const key of customFieldOrder) {
    headers.push(key);
  }
  if (includeTags) {
    headers.push('Tags');
  }

  const rows = items.map((item) => {
    const row = [
      typeof item['position'] === 'number' ? String(item['position']) : '',
      typeof item['title'] === 'string' ? item['title'].trim() : '',
    ];
    if (includeUrl) {
      row.push(typeof item['url'] === 'string' ? item['url'].trim() : '');
    }
    if (includeNotes) {
      row.push(typeof item['notes'] === 'string' ? normalizeListsTableText(item['notes']) : '');
    }
    const customFields = isRecord(item['customFields']) ? item['customFields'] : null;
    for (const key of customFieldOrder) {
      row.push(customFields ? formatListsTableValue(customFields[key]) : '');
    }
    if (includeTags) {
      row.push(formatTags(item['tags']));
    }
    return row;
  });

  return buildMarkdownTable(headers, rows);
}

function formatListsDefinitionRows(lists: Record<string, unknown>[]): string {
  const includeDescription = lists.some(
    (list) => typeof list['description'] === 'string' && list['description'].trim().length > 0,
  );
  const includeDefaultTags = lists.some((list) => formatTags(list['defaultTags']).length > 0);
  const includeTags = lists.some((list) => formatTags(list['tags']).length > 0);
  const includeFavorite = lists.some((list) => list['favorite'] === true);

  const headers = ['Name', 'ID'];
  if (includeDescription) {
    headers.push('Description');
  }
  if (includeDefaultTags) {
    headers.push('Default tags');
  }
  if (includeTags) {
    headers.push('Tags');
  }
  if (includeFavorite) {
    headers.push('Favorite');
  }

  const rows = lists.map((list) => {
    const row = [
      typeof list['name'] === 'string' ? list['name'].trim() : '',
      typeof list['id'] === 'string' ? list['id'].trim() : '',
    ];
    if (includeDescription) {
      row.push(
        typeof list['description'] === 'string'
          ? normalizeListsTableText(list['description'])
          : '',
      );
    }
    if (includeDefaultTags) {
      row.push(formatTags(list['defaultTags']));
    }
    if (includeTags) {
      row.push(formatTags(list['tags']));
    }
    if (includeFavorite) {
      row.push(list['favorite'] === true ? 'Yes' : '');
    }
    return row;
  });

  return buildMarkdownTable(headers, rows);
}

function getListsToolResultPreview(toolName: string, rawValue: unknown): ToolResultPreview | null {
  if (LIST_ITEM_QUERY_TOOL_NAMES.has(toolName)) {
    if (!Array.isArray(rawValue)) {
      return null;
    }
    const items = rawValue.filter(isListItemLike);
    if (items.length === 0) {
      return null;
    }
    return {
      formattedText: formatListsItemRows(items),
      renderMode: 'markdown',
    };
  }

  if (LIST_ITEM_MUTATION_TOOL_NAMES.has(toolName)) {
    if (!isListItemLike(rawValue)) {
      return null;
    }
    return {
      formattedText: formatListsItemRows([rawValue]),
      renderMode: 'markdown',
    };
  }

  if (toolName === 'lists_get' || toolName === 'lists_create' || toolName === 'lists_update') {
    if (!isListDefinitionLike(rawValue)) {
      return null;
    }
    return {
      formattedText: formatListsDefinitionRows([rawValue]),
      renderMode: 'markdown',
    };
  }

  if (toolName === 'lists_list') {
    if (!Array.isArray(rawValue)) {
      return null;
    }
    const lists = rawValue.filter(isListDefinitionLike);
    if (lists.length === 0) {
      return null;
    }
    return {
      formattedText: formatListsDefinitionRows(lists),
      renderMode: 'markdown',
    };
  }

  return null;
}

function getToolInputPreview(toolName: string, argsJson: string): ToolInputPreview {
  const parsed = tryParseToolArgs(argsJson);
  if (!parsed) {
    return {
      headerLabel: '',
      label: 'Input',
      formattedText: argsJson,
      renderMode: 'raw',
    };
  }

  const { args, complete } = parsed;
  const rawJson = complete ? JSON.stringify(args) : undefined;
  const prettyJson = complete ? JSON.stringify(args, null, 2) : undefined;

  const listsPreview = getListsToolInputPreview(toolName, args);
  if (listsPreview) {
    return {
      ...listsPreview,
      ...(prettyJson ? { prettyJson } : {}),
      ...(rawJson ? { rawJson } : {}),
    };
  }

  if (toolName === 'agents_message' && typeof args['content'] === 'string') {
    return {
      headerLabel: '',
      label: 'Sent',
      formattedText: args['content'],
      renderMode: 'markdown',
      ...(prettyJson ? { prettyJson } : {}),
      ...(rawJson ? { rawJson } : {}),
    };
  }

  if (toolName === 'write' && typeof args['content'] === 'string') {
    return {
      headerLabel: typeof args['path'] === 'string' ? args['path'] : '',
      label: 'Content',
      formattedText: args['content'],
      renderMode: 'code',
      ...(prettyJson ? { prettyJson } : {}),
      ...(rawJson ? { rawJson } : {}),
    };
  }

  if (toolName === 'bash' && typeof args['command'] === 'string') {
    return {
      headerLabel: args['command'],
      label: 'Command',
      formattedText: args['command'],
      renderMode: 'code',
      language: 'bash',
      ...(prettyJson ? { prettyJson } : {}),
      ...(rawJson ? { rawJson } : {}),
    };
  }

  if (toolName === 'read') {
    const headerLabel = formatReadLabel(args);
    if (headerLabel) {
      return {
        headerLabel,
        label: 'Path',
        formattedText: headerLabel,
        renderMode: 'code',
        ...(prettyJson ? { prettyJson } : {}),
        ...(rawJson ? { rawJson } : {}),
      };
    }
  }

  if (
    toolName === 'edit' &&
    typeof args['path'] === 'string' &&
    typeof args['oldText'] === 'string' &&
    typeof args['newText'] === 'string'
  ) {
    return {
      headerLabel: args['path'],
      label: 'Change',
      formattedText: formatEditPreview(args['oldText'], args['newText']),
      renderMode: 'code',
      language: 'diff',
      ...(prettyJson ? { prettyJson } : {}),
      ...(rawJson ? { rawJson } : {}),
    };
  }

  if (toolName === 'edit' && typeof args['path'] === 'string') {
    return {
      headerLabel: args['path'],
      label: 'Path',
      formattedText: args['path'],
      renderMode: 'code',
      ...(prettyJson ? { prettyJson } : {}),
      ...(rawJson ? { rawJson } : {}),
    };
  }

  if (toolName === 'ls' && typeof args['path'] === 'string') {
    return {
      headerLabel: args['path'],
      label: 'Path',
      formattedText: args['path'],
      renderMode: 'code',
      ...(prettyJson ? { prettyJson } : {}),
      ...(rawJson ? { rawJson } : {}),
    };
  }

  if ((toolName === 'find' || toolName === 'grep') && typeof args['pattern'] === 'string') {
    return {
      headerLabel: args['pattern'],
      label: 'Pattern',
      formattedText: args['pattern'],
      renderMode: 'code',
      ...(prettyJson ? { prettyJson } : {}),
      ...(rawJson ? { rawJson } : {}),
    };
  }

  const fallbackHeaderLabel = Object.values(args).find(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );

  return {
    headerLabel: fallbackHeaderLabel ?? '',
    label: 'Input',
    formattedText: prettyJson ?? argsJson,
    renderMode: complete ? 'json' : 'raw',
    ...(prettyJson ? { prettyJson } : {}),
    ...(rawJson ? { rawJson } : {}),
  };
}

function getToolResultPreview(options: {
  toolName: string;
  outputText: string;
  outputStatus?: ToolOutputStatus;
  argsJson?: string;
}): ToolResultPreview | null {
  const { toolName, outputText, outputStatus, argsJson } = options;
  const parsedArgs = argsJson ? tryParseToolArgs(argsJson) : null;
  const parsedResult = tryParseJsonRecord(outputStatus?.rawJson);
  const details = parsedResult && isRecord(parsedResult['details']) ? parsedResult['details'] : null;

  if (toolName === 'edit') {
    const diff = typeof details?.['diff'] === 'string' ? details['diff'] : '';
    if (diff.trim().length > 0) {
      return {
        formattedText: diff,
        renderMode: 'code',
        language: 'diff',
      };
    }
  }

  if (toolName === 'read') {
    const readPath =
      parsedArgs && typeof parsedArgs.args['path'] === 'string' ? parsedArgs.args['path'] : '';
    const readLanguage = readPath ? inferLanguageFromPath(readPath) : undefined;
    return {
      formattedText: outputText,
      renderMode: 'code',
      ...(readLanguage ? { language: readLanguage } : {}),
    };
  }

  if (toolName === 'bash' || toolName === 'shell' || toolName === 'sh') {
    return {
      formattedText: outputText,
      renderMode: 'code',
    };
  }

  if (toolName === 'find' || toolName === 'grep' || toolName === 'ls') {
    return {
      formattedText: outputText,
      renderMode: 'code',
    };
  }

  if (toolName === 'write') {
    return {
      formattedText: outputText,
      renderMode: 'raw',
    };
  }

  const listsResultPreview = getListsToolResultPreview(
    toolName,
    tryParseJsonValue(outputStatus?.rawJson) ?? tryParseJsonValue(outputText),
  );
  if (listsResultPreview) {
    return listsResultPreview;
  }

  return null;
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
  const state = toolOutputBlockStates.get(block);
  if (state) {
    writeToolOutputSnapshotDataset(block, state);
  }

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
    const preview = getToolInputPreview(state.toolName, state.input.text);
    const labelRow = document.createElement('div');
    labelRow.className = 'tool-output-section-label';
    labelRow.textContent = preview.label || state.input.label;
    inputSection.appendChild(labelRow);

    const inputBody = document.createElement('div');
    inputBody.className = 'tool-output-input-body streaming';
    if (preview.renderMode === 'markdown') {
      inputBody.classList.add('markdown-content');
      applyMarkdownToElement(inputBody, preview.formattedText);
    } else if (preview.renderMode === 'code') {
      inputBody.classList.add('markdown-content');
      const language = preview.language ?? '';
      applyMarkdownToElement(inputBody, `\`\`\`${language}\n${preview.formattedText}\n\`\`\``);
    } else {
      inputBody.textContent = preview.formattedText;
    }
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
  if (argsJson.trim().length === 0) {
    return;
  }
  const toolName = state.toolName;
  const preview = getToolInputPreview(toolName, argsJson);
  const formattedText = preview.formattedText;
  const label = preview.label;
  const isAgentMessage = preview.renderMode === 'markdown';
  const isPlainTextInput = preview.renderMode === 'code' && toolName === 'write';
  const inputLanguage = preview.language;
  const rawJson = preview.rawJson ?? '';
  const prettyJson = preview.prettyJson ?? argsJson;

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
      inputLanguage ??
      (toolName === 'bash' || toolName === 'shell' || toolName === 'sh' ? 'bash' : undefined);
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
  const useStreamingPlainText = canUseStreamingPlainTextOutput(status, toolName);
  const argsJson = state.input.kind === 'formatted' ? state.input.argsJson : undefined;
  const resultPreview = getToolResultPreview({
    toolName,
    outputText: trimmed,
    ...(status ? { outputStatus: status } : {}),
    ...(argsJson ? { argsJson } : {}),
  });

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
  } else if (resultPreview?.renderMode === 'raw') {
    const pre = document.createElement('pre');
    pre.className = 'tool-output-streaming-pre';
    pre.textContent = resultPreview.formattedText;
    outputBody.appendChild(pre);
    formattedMarkdown = resultPreview.formattedText;
  } else if (resultPreview?.renderMode === 'code') {
    outputBody.classList.add('markdown-content');
    formattedMarkdown = resultPreview.language
      ? `\`\`\`${resultPreview.language}\n${resultPreview.formattedText}\n\`\`\``
      : `\`\`\`\n${resultPreview.formattedText}\n\`\`\``;
    applyMarkdownToElement(outputBody, formattedMarkdown);
  } else if (resultPreview?.renderMode === 'markdown') {
    outputBody.classList.add('markdown-content');
    formattedMarkdown = resultPreview.formattedText;
    applyMarkdownToElement(outputBody, formattedMarkdown);
  } else {
    formattedMarkdown = `\`\`\`\n${trimmed}\n\`\`\``;
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
          if (
            isMarkdownResult ||
            agentCallback ||
            isAgentMessage ||
            resultPreview?.renderMode === 'markdown'
          ) {
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

export function materializeToolOutputBlockForSnapshot(block: HTMLDivElement): void {
  const state = getToolOutputBlockState(block);
  if (!state) {
    return;
  }
  renderToolOutputInput(state);
  renderToolOutputResult(state);
}

export function cloneToolOutputBlockForSnapshot(source: HTMLDivElement): HTMLDivElement {
  const clone = source.cloneNode(true) as HTMLDivElement;
  const state = getToolOutputBlockState(source);
  const snapshotState = state
    ? (() => {
        const headerButton = clone.querySelector<HTMLButtonElement>('.tool-output-header');
        const toggleIcon = clone.querySelector<HTMLSpanElement>('.tool-output-toggle');
        const content = clone.querySelector<HTMLDivElement>('.tool-output-content');
        const inputSection = clone.querySelector<HTMLDivElement>('.tool-output-input');
        const outputSection = clone.querySelector<HTMLDivElement>('.tool-output-result');
        if (!headerButton || !toggleIcon || !content || !inputSection || !outputSection) {
          return null;
        }
        return {
          ...state,
          headerButton,
          toggleIcon,
          content,
          inputSection,
          outputSection,
          nearViewport: true,
        } satisfies ToolOutputBlockState;
      })()
    : buildToolOutputSnapshotStateFromDataset(source, clone);

  if (!snapshotState) {
    clone.dataset['exportSnapshotState'] = 'incomplete';
    clone.dataset['exportSnapshotInputLength'] = '0';
    clone.dataset['exportSnapshotOutputLength'] = '0';
    return clone;
  }
  renderToolOutputInput(snapshotState);
  renderToolOutputResult(snapshotState);
  clone.dataset['exportSnapshotState'] = state ? 'present' : 'rehydrated';
  clone.dataset['exportSnapshotInputLength'] = `${snapshotState.inputSection.textContent?.trim().length ?? 0}`;
  clone.dataset['exportSnapshotOutputLength'] = `${snapshotState.outputSection.textContent?.trim().length ?? 0}`;
  return clone;
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
  const preview = getToolInputPreview(state.toolName, text);
  state.input = { kind: 'streaming', text, label: preview.label || label };
  writeToolOutputSnapshotDataset(block, state);
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
  writeToolOutputSnapshotDataset(block, state);
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

export function formatByteSize(bytes: number): string {
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
  return getToolInputPreview(toolName, argsJson).headerLabel;
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
  writeToolOutputSnapshotDataset(block, state);
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
  writeToolOutputSnapshotDataset(block, blockState);
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
