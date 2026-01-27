/**
 * Share Target Controller
 *
 * Handles receiving shared content from other apps (via Capacitor plugin)
 * and provides a modal to select the destination:
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

interface SharedContent {
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
  listDropdown: HTMLSelectElement;
  listConfirmButton: HTMLButtonElement;
};

const MAX_PREVIEW_LENGTH = 200;

let modalElements: ShareModalElements | null = null;
let pendingContent: SharedContent | null = null;
let controllerOptions: ShareTargetOptions | null = null;
let isListenerRegistered = false;
let isSubmitting = false;
let listSelectMode: 'add' | 'fetch' = 'add';

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
  if (modalElements) {
    return modalElements;
  }

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
          <label for="share-list-dropdown">Select list:</label>
          <select id="share-list-dropdown"></select>
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
  const listDropdown = container.querySelector<HTMLSelectElement>('#share-list-dropdown');

  if (
    !previewTitle ||
    !previewText ||
    !optionsView ||
    !listSelectView ||
    !listDropdown ||
    !listConfirm
  ) {
    throw new Error('Share target modal elements missing');
  }

  modalElements = {
    container,
    previewTitle,
    previewText,
    optionsView,
    listSelectView,
    listDropdown,
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
  modal.container.classList.add('visible');
}

function hideShareModal(): void {
  if (modalElements) {
    modalElements.container.classList.remove('visible');
  }
  pendingContent = null;
}

export function closeShareModal(): void {
  hideShareModal();
}

export function isShareModalVisible(): boolean {
  return Boolean(modalElements?.container.classList.contains('visible'));
}

function shareToChatSession(sessionId: string): void {
  if (!pendingContent || !controllerOptions) {
    return;
  }

  const normalized = sessionId.trim();
  if (!normalized) {
    return;
  }

  controllerOptions.selectSession(normalized);

  const runtime = controllerOptions.getChatInputRuntimeForSession(normalized);
  if (!runtime) {
    reportError('Unable to find a chat input for that session.');
    return;
  }

  runtime.inputEl.value = pendingContent.text;
  runtime.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
  runtime.focusInput();
  hideShareModal();
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

function handleShareToChat(anchor: HTMLElement): void {
  if (!pendingContent || !controllerOptions) {
    return;
  }

  const sessionId = resolveChatSessionId();
  if (!sessionId) {
    controllerOptions.openSessionPicker({
      anchor,
      title: 'Select chat session',
      createSessionOptions: { openChatPanel: false, selectSession: false },
      onSelectSession: (selectedSessionId) => {
        shareToChatSession(selectedSessionId);
      },
    });
    return;
  }

  shareToChatSession(sessionId);
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

  try {
    const rawLists = await callOperation<unknown>('/api/plugins/lists/operations/list', {});
    const lists = parseListSummaries(rawLists);

    modal.listDropdown.innerHTML = '';
    if (lists.length === 0) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No lists available';
      option.disabled = true;
      modal.listDropdown.appendChild(option);
      modal.listDropdown.disabled = true;
      modal.listConfirmButton.disabled = true;
    } else {
      for (const list of lists) {
        const option = document.createElement('option');
        option.value = list.id;
        option.textContent = list.name;
        modal.listDropdown.appendChild(option);
      }
      modal.listDropdown.disabled = false;
      modal.listConfirmButton.disabled = false;
    }

    // Update confirm button text based on mode
    modal.listConfirmButton.textContent = mode === 'fetch' ? 'Fetch & Add' : 'Add Item';

    modal.optionsView.classList.add('hidden');
    modal.listSelectView.classList.remove('hidden');
  } catch (error) {
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
  modalElements.listSelectView.classList.add('hidden');
  modalElements.optionsView.classList.remove('hidden');
}

async function handleAddToListSubmit(): Promise<void> {
  if (!pendingContent || !modalElements || isSubmitting) {
    return;
  }

  const listId = modalElements.listDropdown.value;
  if (!listId) {
    return;
  }

  const title = pendingContent.title || generateTitleFromText(pendingContent.text);
  const urlMatch = pendingContent.text.match(/https?:\/\/[^\s]+/);
  const url = urlMatch ? urlMatch[0] : undefined;
  const notes = pendingContent.text !== url ? pendingContent.text : undefined;

  isSubmitting = true;
  try {
    await callOperation('/api/plugins/lists/operations/item-add', {
      listId,
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

function shareToChatSessionAndSubmit(sessionId: string, message: string): void {
  if (!controllerOptions) {
    return;
  }

  const normalized = sessionId.trim();
  if (!normalized) {
    return;
  }

  controllerOptions.selectSession(normalized);

  const runtime = controllerOptions.getChatInputRuntimeForSession(normalized);
  if (!runtime) {
    reportError('Unable to find a chat input for that session.');
    return;
  }

  runtime.textInputController.sendUserText(message);
  hideShareModal();
}

function handleFetchToListSubmit(anchor: HTMLElement): void {
  if (!pendingContent || !modalElements || !controllerOptions) {
    return;
  }

  const listName = modalElements.listDropdown.selectedOptions[0]?.textContent;
  if (!listName) {
    return;
  }

  const urlMatch = pendingContent.text.match(/https?:\/\/[^\s]+/);
  if (!urlMatch) {
    reportError('No URL found in shared content');
    return;
  }

  const message = `Fetch ${urlMatch[0]} and add it to the "${listName}" list with relevant context.`;

  const sessionId = resolveChatSessionId();
  if (!sessionId) {
    controllerOptions.openSessionPicker({
      anchor,
      title: 'Select chat session',
      createSessionOptions: { openChatPanel: false, selectSession: false },
      onSelectSession: (selectedSessionId) => {
        shareToChatSessionAndSubmit(selectedSessionId, message);
      },
    });
    return;
  }

  shareToChatSessionAndSubmit(sessionId, message);
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
          void showShareModal(content);
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
 * Manually trigger share modal (for testing)
 */
export function showShareModalForContent(title: string | undefined, text: string): void {
  if (controllerOptions) {
    const content: SharedContent = title ? { title, text } : { text };
    void showShareModal(content);
  }
}
