/**
 * Share Target Controller
 *
 * Handles receiving shared content from other apps (via Capacitor plugin).
 *
 * Shared content always opens the destination modal. On Android share intents,
 * the agent-invoking destinations (`Chat Input` and `Fetch to List`) always
 * raise the session picker so the target session is explicit.
 *
 * Available destinations:
 * - Chat input
 * - New note
 * - Add to list
 * - Fetch to list (only shown when shared content contains a URL)
 */

import { apiFetch } from '../utils/api';
import { ICONS } from '../utils/icons';
import { isCapacitorAndroid } from '../utils/capacitor';
import type { InputRuntime } from '../panels/input/runtime';
import type { SessionPickerOpenOptions } from './panelSessionPicker';

export interface ShareTargetOptions {
  getSelectedSessionId: () => string | null;
  getActiveChatSessionId?: () => string | null;
  selectSession: (sessionId: string) => void;
  openSessionPicker: (options: SessionPickerOpenOptions) => void;
  getChatInputRuntimeForSession: (sessionId: string) => InputRuntime | null;
  openPanel: (panelType: 'notes' | 'lists') => void;
  setStatus?: (text: string) => void;
  isEnabled?: () => boolean;
}

export interface SharedContent {
  title?: string;
  text: string;
}

interface ShareReceivedEvent {
  title?: string;
  texts?: string[];
  files?: Array<{ name: string; mimeType: string; uri: string }>;
}

interface ListSummary {
  id: string;
  name: string;
}

interface OperationResponse<T> {
  ok?: boolean;
  result?: T;
  error?: string;
}

type ShareTargetPlugin = {
  CapacitorShareTarget: {
    addListener: (
      event: 'shareReceived',
      callback: (event: ShareReceivedEvent) => void,
    ) => Promise<{ remove: () => Promise<void> }>;
  };
};

type ShareModalElements = {
  container: HTMLDivElement;
  previewTitle: HTMLElement;
  previewText: HTMLElement;
  optionsView: HTMLElement;
  listSelectView: HTMLElement;
  listSearchInput: HTMLInputElement;
  listPicker: HTMLElement;
  listConfirmButton: HTMLButtonElement;
};

const MAX_PREVIEW_LENGTH = 200;
const CHAT_INPUT_WAIT_ATTEMPTS = 12;
const CHAT_INPUT_WAIT_MS = 50;
const SHARE_SESSION_PICKER_ANCHOR_ID = 'share-session-picker-anchor';
const SHARE_SESSION_PICKER_WIDTH = 320;

let modalElements: ShareModalElements | null = null;
let pendingContent: SharedContent | null = null;
let pendingContentRequiresSessionPickerRouting = false;
let controllerOptions: ShareTargetOptions | null = null;
let isListenerRegistered = false;
let isSubmitting = false;
let listSelectMode: 'add' | 'fetch' = 'add';
let availableShareLists: ListSummary[] = [];
let selectedShareList: ListSummary | null = null;

function reportError(message: string, error?: unknown): void {
  if (error) {
    console.error('[shareTarget]', message, error);
  } else {
    console.error('[shareTarget]', message);
  }
  controllerOptions?.setStatus?.(message);
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeSessionId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Check if text contains an HTTP/HTTPS URL
 */
function containsUrl(text: string): boolean {
  return /https?:\/\/[^\s]+/.test(text);
}

/**
 * Format shared content similar to native Android app
 */
function formatSharedContent(event: ShareReceivedEvent): SharedContent | null {
  const rawTitle = normalizeText(event.title);
  const textParts = Array.isArray(event.texts)
    ? event.texts.map((entry) => normalizeText(entry)).filter((entry) => entry.length > 0)
    : [];
  let text = textParts.join('\n').trim();
  if (!text && rawTitle) {
    text = rawTitle;
  }
  if (!text) {
    return null;
  }

  if (rawTitle && rawTitle !== text) {
    const combined = text ? `${rawTitle}\n${text}` : rawTitle;
    return { title: rawTitle, text: combined };
  }

  return { ...(rawTitle ? { title: rawTitle } : {}), text };
}

function ensureModal(): ShareModalElements {
  if (modalElements?.container.isConnected) {
    return modalElements;
  }
  modalElements = null;

  const container = document.createElement('div');
  container.id = 'share-target-modal';
  container.innerHTML = `
    <div class="share-target-dialog" role="dialog" aria-modal="true">
      <div class="dialog-header">
        <h2>Share to...</h2>
        <button type="button" class="dialog-close-button" aria-label="Close">
          ${ICONS.x}
        </button>
      </div>
      <div class="dialog-body">
        <div class="share-preview">
          <div class="share-preview-title"></div>
          <div class="share-preview-text"></div>
        </div>
        <div class="share-options">
          <button type="button" class="share-option" data-target="chat">
            ${ICONS.messageSquare}
            <span>Chat Input</span>
          </button>
          <button type="button" class="share-option" data-target="note">
            ${ICONS.notebook}
            <span>New Note</span>
          </button>
          <button type="button" class="share-option" data-target="list">
            ${ICONS.list}
            <span>Add to List</span>
          </button>
          <button type="button" class="share-option" data-target="fetch-to-list">
            ${ICONS.globe}
            <span>Fetch to List</span>
          </button>
        </div>
        <div class="share-list-select hidden">
          <label for="share-list-search">Select list:</label>
          <input
            id="share-list-search"
            class="session-picker-search share-list-search"
            type="text"
            placeholder="Search lists..."
            autocomplete="off"
          />
          <div class="session-picker-list share-list-picker" role="listbox"></div>
          <div class="share-list-actions">
            <button type="button" class="share-list-back">Back</button>
            <button type="button" class="share-list-confirm">Add Item</button>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(container);

  const closeButton = container.querySelector<HTMLButtonElement>('.dialog-close-button');
  closeButton?.addEventListener('click', hideShareModal);

  container.addEventListener('click', (event) => {
    if (event.target === container) {
      hideShareModal();
    }
  });

  const chatOption = container.querySelector<HTMLButtonElement>('[data-target="chat"]');
  chatOption?.addEventListener('click', () => {
    if (chatOption) {
      handleShareToChat(chatOption);
    }
  });

  const noteOption = container.querySelector<HTMLButtonElement>('[data-target="note"]');
  noteOption?.addEventListener('click', () => {
    void handleShareToNote();
  });

  const listOption = container.querySelector<HTMLButtonElement>('[data-target="list"]');
  listOption?.addEventListener('click', () => {
    void handleShareToListSelect();
  });

  const fetchToListOption = container.querySelector<HTMLButtonElement>(
    '[data-target="fetch-to-list"]',
  );
  fetchToListOption?.addEventListener('click', () => {
    void handleFetchToListSelect();
  });

  const listBack = container.querySelector<HTMLButtonElement>('.share-list-back');
  listBack?.addEventListener('click', handleListBack);

  const listConfirm = container.querySelector<HTMLButtonElement>('.share-list-confirm');
  listConfirm?.addEventListener('click', () => {
    void handleShareToList();
  });

  const previewTitle = container.querySelector<HTMLElement>('.share-preview-title');
  const previewText = container.querySelector<HTMLElement>('.share-preview-text');
  const optionsView = container.querySelector<HTMLElement>('.share-options');
  const listSelectView = container.querySelector<HTMLElement>('.share-list-select');
  const listSearchInput = container.querySelector<HTMLInputElement>('#share-list-search');
  const listPicker = container.querySelector<HTMLElement>('.share-list-picker');

  if (
    !previewTitle ||
    !previewText ||
    !optionsView ||
    !listSelectView ||
    !listSearchInput ||
    !listPicker ||
    !listConfirm
  ) {
    throw new Error('Share target modal elements missing');
  }

  listSearchInput.addEventListener('input', () => {
    renderShareListPicker(listSearchInput.value);
  });

  modalElements = {
    container,
    previewTitle,
    previewText,
    optionsView,
    listSelectView,
    listSearchInput,
    listPicker,
    listConfirmButton: listConfirm,
  };
  return modalElements;
}

/**
 * Create and show the share destination modal
 */
async function showShareModal(content: SharedContent): Promise<void> {
  pendingContent = content;
  const modal = ensureModal();

  if (content.title && content.title !== content.text) {
    modal.previewTitle.textContent = content.title;
    modal.previewTitle.classList.remove('hidden');
  } else {
    modal.previewTitle.classList.add('hidden');
  }

  const displayText =
    content.text.length > MAX_PREVIEW_LENGTH
      ? `${content.text.slice(0, MAX_PREVIEW_LENGTH)}...`
      : content.text;
  modal.previewText.textContent = displayText;

  // Show/hide fetch-to-list option based on URL presence
  const fetchToListOption = modal.container.querySelector<HTMLElement>(
    '[data-target="fetch-to-list"]',
  );
  if (fetchToListOption) {
    fetchToListOption.classList.toggle('hidden', !containsUrl(content.text));
  }

  modal.optionsView.classList.remove('hidden');
  modal.listSelectView.classList.add('hidden');
  modal.container.classList.remove('share-list-mode');
  modal.container.classList.add('visible');
}

function hideShareModal(): void {
  if (modalElements) {
    modalElements.container.classList.remove('visible');
  }
  pendingContent = null;
  pendingContentRequiresSessionPickerRouting = false;
}

function dismissShareModal(): void {
  modalElements?.container.classList.remove('visible');
}

export function closeShareModal(): void {
  hideShareModal();
}

export function isShareModalVisible(): boolean {
  return Boolean(modalElements?.container.classList.contains('visible'));
}

function waitForDelay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function waitForChatInputRuntime(sessionId: string): Promise<InputRuntime | null> {
  const normalized = normalizeSessionId(sessionId);
  if (!normalized || !controllerOptions) {
    return null;
  }
  const immediate = controllerOptions.getChatInputRuntimeForSession(normalized);
  if (immediate) {
    return immediate;
  }
  for (let attempt = 0; attempt < CHAT_INPUT_WAIT_ATTEMPTS; attempt += 1) {
    await waitForDelay(CHAT_INPUT_WAIT_MS);
    const runtime = controllerOptions.getChatInputRuntimeForSession(normalized);
    if (runtime) {
      return runtime;
    }
  }
  return null;
}

async function shareToChatSession(sessionId: string): Promise<boolean> {
  if (!pendingContent || !controllerOptions) {
    return false;
  }

  const normalized = sessionId.trim();
  if (!normalized) {
    return false;
  }

  controllerOptions.selectSession(normalized);

  const runtime = await waitForChatInputRuntime(normalized);
  if (!runtime) {
    return false;
  }

  runtime.inputEl.value = pendingContent.text;
  runtime.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
  runtime.focusInput();
  hideShareModal();
  return true;
}

function resolveChatSessionId(): string | null {
  if (!controllerOptions) {
    return null;
  }
  const selected = controllerOptions.getSelectedSessionId();
  if (selected) {
    return selected;
  }
  return controllerOptions.getActiveChatSessionId?.() ?? null;
}

function ensureShareSessionPickerAnchor(): HTMLElement {
  let anchor = document.getElementById(SHARE_SESSION_PICKER_ANCHOR_ID) as HTMLElement | null;
  if (!anchor) {
    anchor = document.createElement('div');
    anchor.id = SHARE_SESSION_PICKER_ANCHOR_ID;
    anchor.tabIndex = -1;
    anchor.setAttribute('aria-hidden', 'true');
    anchor.style.position = 'fixed';
    anchor.style.height = '1px';
    anchor.style.opacity = '0';
    anchor.style.pointerEvents = 'none';
    document.body.appendChild(anchor);
  }
  const viewportWidth =
    typeof window.innerWidth === 'number' && window.innerWidth > 0 ? window.innerWidth : 360;
  const anchorWidth = Math.min(
    SHARE_SESSION_PICKER_WIDTH,
    Math.max(280, viewportWidth - 32),
  );
  const anchorLeft = Math.max(8, (viewportWidth - anchorWidth) / 2);
  anchor.style.width = `${anchorWidth}px`;
  anchor.style.left = `${anchorLeft}px`;
  anchor.style.top = isCapacitorAndroid() ? '24vh' : '28vh';
  return anchor;
}

function openShareSessionPicker(
  _anchor: HTMLElement,
  onSelectSession: (sessionId: string) => void,
): void {
  dismissShareModal();
  controllerOptions?.openSessionPicker({
    anchor: ensureShareSessionPickerAnchor(),
    title: 'Select share session',
    createSessionOptions: { openChatPanel: true, selectSession: true },
    onSelectSession: (selectedSessionId) => {
      onSelectSession(selectedSessionId);
    },
  });
}

function handleShareToChat(anchor: HTMLElement): void {
  if (!pendingContent || !controllerOptions) {
    return;
  }

  if (pendingContentRequiresSessionPickerRouting) {
    openShareSessionPicker(anchor, (selectedSessionId) => {
      void shareToChatSession(selectedSessionId);
    });
    return;
  }

  const sessionId = resolveChatSessionId();
  if (!sessionId) {
    controllerOptions.openSessionPicker({
      anchor,
      title: 'Select chat session',
      createSessionOptions: { openChatPanel: false, selectSession: false },
      onSelectSession: (selectedSessionId) => {
        void shareToChatSession(selectedSessionId);
      },
    });
    return;
  }

  void shareToChatSession(sessionId);
}

async function callOperation<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  let payload: OperationResponse<T> | null = null;
  try {
    payload = (await response.json()) as OperationResponse<T>;
  } catch {
    // ignore JSON parsing failures
  }

  if (!response.ok || !payload || payload.error || payload.result === undefined) {
    const message = payload?.error ? payload.error : `Request failed (${response.status})`;
    throw new Error(message);
  }

  return payload.result;
}

function parseListSummary(value: unknown): ListSummary | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const obj = value as Record<string, unknown>;
  const id = typeof obj['id'] === 'string' ? obj['id'].trim() : '';
  const name = typeof obj['name'] === 'string' ? obj['name'].trim() : '';
  if (!id || !name) {
    return null;
  }
  return { id, name };
}

function parseListSummaries(value: unknown): ListSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: ListSummary[] = [];
  for (const entry of value) {
    const parsed = parseListSummary(entry);
    if (parsed) {
      result.push(parsed);
    }
  }
  return result;
}

function setSelectedShareList(list: ListSummary | null): void {
  selectedShareList = list;
  if (modalElements) {
    modalElements.listConfirmButton.disabled = selectedShareList === null;
  }
}

function renderShareListPicker(query: string = ''): void {
  if (!modalElements) {
    return;
  }
  const normalizedQuery = query.trim().toLowerCase();
  const matchingLists = availableShareLists.filter((list) =>
    `${list.name} ${list.id}`.toLowerCase().includes(normalizedQuery),
  );

  modalElements.listPicker.innerHTML = '';

  if (availableShareLists.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'session-picker-empty';
    empty.textContent = 'No lists available';
    modalElements.listPicker.appendChild(empty);
    setSelectedShareList(null);
    return;
  }

  if (matchingLists.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'session-picker-empty';
    empty.textContent = 'No matching lists';
    modalElements.listPicker.appendChild(empty);
    setSelectedShareList(null);
    return;
  }

  if (selectedShareList && !matchingLists.some((list) => list.id === selectedShareList?.id)) {
    setSelectedShareList(null);
  }

  for (const list of matchingLists) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'session-picker-item share-list-picker-item';
    item.dataset['listId'] = list.id;
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', selectedShareList?.id === list.id ? 'true' : 'false');
    if (selectedShareList?.id === list.id) {
      item.classList.add('selected');
    }

    const normalState = document.createElement('span');
    normalState.className = 'session-picker-item-normal';
    const label = document.createElement('span');
    label.className = 'session-picker-item-label';
    label.textContent = list.name;
    normalState.appendChild(label);
    item.appendChild(normalState);

    item.addEventListener('click', () => {
      setSelectedShareList(list);
      renderShareListPicker(modalElements?.listSearchInput.value ?? '');
    });

    modalElements.listPicker.appendChild(item);
  }
}

function renderShareListStatus(message: string): void {
  if (!modalElements) {
    return;
  }
  modalElements.listPicker.innerHTML = '';
  const status = document.createElement('div');
  status.className = 'session-picker-empty';
  status.textContent = message;
  modalElements.listPicker.appendChild(status);
}

async function handleShareToNote(): Promise<void> {
  if (!pendingContent || isSubmitting) {
    return;
  }

  const title = pendingContent.title || generateTitleFromText(pendingContent.text);
  const content = pendingContent.text;

  isSubmitting = true;
  try {
    await callOperation('/api/plugins/notes/operations/write', {
      title,
      content,
    });
    controllerOptions?.openPanel('notes');
    hideShareModal();
  } catch (error) {
    reportError('Failed to create note.', error);
  } finally {
    isSubmitting = false;
  }
}

async function showListSelectView(mode: 'add' | 'fetch'): Promise<void> {
  if (!modalElements) {
    ensureModal();
  }
  const modal = modalElements;
  if (!modal) {
    return;
  }

  listSelectMode = mode;
  availableShareLists = [];
  setSelectedShareList(null);
  modal.listSearchInput.value = '';
  modal.listConfirmButton.textContent = mode === 'fetch' ? 'Fetch & Add' : 'Add Item';
  renderShareListStatus('Loading lists...');
  modal.container.classList.add('share-list-mode');
  modal.optionsView.classList.add('hidden');
  modal.listSelectView.classList.remove('hidden');
  modal.listSearchInput.focus();

  try {
    const rawLists = await callOperation<unknown>('/api/plugins/lists/operations/list', {});
    const lists = parseListSummaries(rawLists);

    availableShareLists = lists;
    setSelectedShareList(lists[0] ?? null);
    renderShareListPicker();
  } catch (error) {
    setSelectedShareList(null);
    renderShareListStatus('Failed to load lists');
    reportError('Failed to load lists.', error);
  }
}

async function handleShareToListSelect(): Promise<void> {
  await showListSelectView('add');
}

async function handleFetchToListSelect(): Promise<void> {
  await showListSelectView('fetch');
}

function handleListBack(): void {
  if (!modalElements) {
    return;
  }
  modalElements.container.classList.remove('share-list-mode');
  modalElements.listSelectView.classList.add('hidden');
  modalElements.optionsView.classList.remove('hidden');
}

async function handleAddToListSubmit(): Promise<void> {
  if (!pendingContent || !modalElements || isSubmitting) {
    return;
  }

  const list = selectedShareList;
  if (!list) {
    return;
  }

  const title = pendingContent.title || generateTitleFromText(pendingContent.text);
  const urlMatch = pendingContent.text.match(/https?:\/\/[^\s]+/);
  const url = urlMatch ? urlMatch[0] : undefined;
  const notes = pendingContent.text !== url ? pendingContent.text : undefined;

  isSubmitting = true;
  try {
    await callOperation('/api/plugins/lists/operations/item-add', {
      listId: list.id,
      title,
      ...(url ? { url } : {}),
      ...(notes ? { notes } : {}),
    });
    controllerOptions?.openPanel('lists');
    hideShareModal();
  } catch (error) {
    reportError('Failed to add list item.', error);
  } finally {
    isSubmitting = false;
  }
}

async function shareToChatSessionAndSubmit(sessionId: string, message: string): Promise<boolean> {
  if (!controllerOptions) {
    return false;
  }

  const normalized = sessionId.trim();
  if (!normalized) {
    return false;
  }

  controllerOptions.selectSession(normalized);

  const runtime = await waitForChatInputRuntime(normalized);
  if (!runtime) {
    return false;
  }

  runtime.textInputController.sendUserText(message);
  hideShareModal();
  return true;
}

function handleFetchToListSubmit(anchor: HTMLElement): void {
  if (!pendingContent || !modalElements || !controllerOptions) {
    return;
  }

  const list = selectedShareList;
  if (!list) {
    return;
  }

  const urlMatch = pendingContent.text.match(/https?:\/\/[^\s]+/);
  if (!urlMatch) {
    reportError('No URL found in shared content');
    return;
  }

  const message = `Fetch ${urlMatch[0]} and add it to the "${list.name}" list with relevant context.`;

  if (pendingContentRequiresSessionPickerRouting) {
    openShareSessionPicker(anchor, (selectedSessionId) => {
      void shareToChatSessionAndSubmit(selectedSessionId, message);
    });
    return;
  }

  const sessionId = resolveChatSessionId();
  if (!sessionId) {
    dismissShareModal();
    controllerOptions.openSessionPicker({
      anchor,
      title: 'Select chat session',
      createSessionOptions: { openChatPanel: false, selectSession: false },
      onSelectSession: (selectedSessionId) => {
        void shareToChatSessionAndSubmit(selectedSessionId, message);
      },
    });
    return;
  }

  void shareToChatSessionAndSubmit(sessionId, message);
}

async function handleShareToList(): Promise<void> {
  if (listSelectMode === 'fetch') {
    // Use the confirm button as anchor for session picker
    const anchor = modalElements?.listConfirmButton;
    if (anchor) {
      handleFetchToListSubmit(anchor);
    }
  } else {
    await handleAddToListSubmit();
  }
}

export async function handleIncomingSharedContent(
  content: SharedContent,
  options?: { requireSessionPicker?: boolean },
): Promise<void> {
  pendingContent = content;
  pendingContentRequiresSessionPickerRouting = options?.requireSessionPicker === true;
  await showShareModal(content);
}

/**
 * Generate a short title from text content
 */
function generateTitleFromText(text: string): string {
  const firstLine = text.split('\n')[0] ?? text;
  const maxLength = 50;

  if (firstLine.length <= maxLength) {
    return firstLine;
  }

  const truncated = firstLine.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');

  if (lastSpace > maxLength / 2) {
    return `${truncated.slice(0, lastSpace)}...`;
  }

  return `${truncated}...`;
}

/**
 * Initialize the share target controller
 * Sets up listeners for the Capacitor share plugin
 */
export function initShareTarget(options: ShareTargetOptions): void {
  controllerOptions = options;
  const enabled = options.isEnabled ? options.isEnabled() : isCapacitorAndroid();
  if (!enabled || isListenerRegistered) {
    return;
  }

  import('@capgo/capacitor-share-target')
    .then((module) => module as ShareTargetPlugin)
    .then(({ CapacitorShareTarget }) => {
      CapacitorShareTarget.addListener('shareReceived', (event: ShareReceivedEvent) => {
        console.log('[shareTarget] Received shared content:', event);

        const content = formatSharedContent(event);
        if (content?.text) {
          void handleIncomingSharedContent(content, { requireSessionPicker: true });
        }
      });

      isListenerRegistered = true;
      console.log('[shareTarget] Share target listener registered');
    })
    .catch(() => {
      console.log('[shareTarget] Share target plugin not available (not in Capacitor context)');
    });
}

/**
 * Manually trigger share handling for the provided content.
 */
export function showShareModalForContent(title: string | undefined, text: string): void {
  if (controllerOptions) {
    const content: SharedContent = title ? { title, text } : { text };
    void handleIncomingSharedContent(content);
  }
}
