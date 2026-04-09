import { apiFetch } from './api';
import { getAttachmentContentUrl } from './attachmentActions';
import { applyMarkdownToElement } from './markdown';
import {
  cloneToolOutputBlockForSnapshot,
  materializeToolOutputBlockForSnapshot,
  setToolOutputBlockExpanded,
} from './toolOutputRenderer';

type AttachmentPreviewType = 'none' | 'text' | 'markdown';

interface AttachmentBubbleMeta {
  callId: string;
  fileName: string;
  title: string;
  contentType: string;
  downloadUrl: string;
  previewType: AttachmentPreviewType;
  previewText: string | null;
  previewTruncated: boolean;
}

interface AttachmentExportPayload {
  attachmentId: string;
  fileName: string;
  contentType: string;
  base64: string;
  downloadName: string;
  collapsedPreviewHtml: string | null;
  expandedPreviewHtml: string | null;
  imageDataUrl: string | null;
  openMode: 'download' | 'new_tab' | 'image';
}

export interface BuildSelfContainedChatPanelHtmlOptions {
  chatPanelEl: HTMLElement;
  sessionTitle: string;
  getCanonicalToolBlock?: (callId: string) => HTMLDivElement | null;
}

export interface BuiltSelfContainedChatPanelHtml {
  fileName: string;
  html: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function jsonForInlineScript(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e');
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function sanitizeFileName(label: string): string {
  const trimmed = label.trim();
  const normalized = trimmed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized ? `${normalized}.html` : 'chat-export.html';
}

function isImageContentType(contentType: string): boolean {
  return contentType.trim().toLowerCase().startsWith('image/');
}

function isHtmlContentType(contentType: string): boolean {
  const normalized = contentType.trim().toLowerCase();
  return normalized === 'text/html' || normalized.startsWith('text/html;');
}

function getStylesheetUrl(): string {
  const stylesheetLink = document.querySelector<HTMLLinkElement>('link[rel="stylesheet"][href]');
  const href = stylesheetLink?.href ?? 'styles.css';
  return new URL(href, window.location.href).toString();
}

async function fetchStylesheetText(): Promise<string> {
  const response = await fetch(getStylesheetUrl(), { credentials: 'same-origin' });
  if (!response.ok) {
    throw new Error(`Failed to fetch stylesheet (${response.status})`);
  }
  return response.text();
}

function getRootThemeAttributes(): { attrs: string; inlineStyle: string } {
  const root = document.documentElement;
  const attrs: string[] = [];
  const dataTheme = root.getAttribute('data-theme');
  const dataThemeTone = root.getAttribute('data-theme-tone');
  if (dataTheme) {
    attrs.push(`data-theme="${escapeHtml(dataTheme)}"`);
  }
  if (dataThemeTone) {
    attrs.push(`data-theme-tone="${escapeHtml(dataThemeTone)}"`);
  }
  const inlineStyleParts: string[] = [];
  const uiFont = root.style.getPropertyValue('--font-sans').trim();
  const codeFont = root.style.getPropertyValue('--font-mono').trim();
  if (uiFont) {
    inlineStyleParts.push(`--font-sans:${uiFont}`);
  }
  if (codeFont) {
    inlineStyleParts.push(`--font-mono:${codeFont}`);
  }
  return {
    attrs: attrs.join(' '),
    inlineStyle: inlineStyleParts.join(';'),
  };
}

function readAttachmentBubbleMeta(bubble: HTMLElement): AttachmentBubbleMeta | null {
  const callId = bubble.dataset['toolCallId']?.trim() ?? '';
  const fileName = bubble.dataset['attachmentFileName']?.trim() ?? '';
  const contentType = bubble.dataset['attachmentContentType']?.trim() ?? '';
  const downloadUrl = bubble.dataset['attachmentDownloadUrl']?.trim() ?? '';
  const previewTypeRaw = bubble.dataset['attachmentPreviewType'];
  const previewType: AttachmentPreviewType =
    previewTypeRaw === 'text' || previewTypeRaw === 'markdown' ? previewTypeRaw : 'none';
  if (!callId || !fileName || !contentType || !downloadUrl) {
    return null;
  }
  return {
    callId,
    fileName,
    title: bubble.dataset['attachmentTitle']?.trim() ?? '',
    contentType,
    downloadUrl,
    previewType,
    previewText:
      typeof bubble.dataset['attachmentPreviewText'] === 'string'
        ? bubble.dataset['attachmentPreviewText'] ?? null
        : null,
    previewTruncated: bubble.dataset['attachmentPreviewTruncated'] === 'true',
  };
}

function buildAttachmentPreviewHtml(options: {
  attachment: AttachmentBubbleMeta;
  imageDataUrl?: string | null;
  contentText?: string;
  truncated?: boolean;
  expanded?: boolean;
}): string | null {
  const { attachment, imageDataUrl = null, contentText = '', truncated = false, expanded = false } =
    options;
  const previewEl = document.createElement('div');
  previewEl.className = 'attachment-tool-preview';
  previewEl.style.display = 'block';
  previewEl.classList.toggle('expanded', expanded);

  if (isImageContentType(attachment.contentType) && imageDataUrl) {
    const image = document.createElement('img');
    image.className = 'attachment-tool-preview-image';
    image.src = imageDataUrl;
    image.alt = attachment.title || attachment.fileName;
    image.loading = 'lazy';
    image.tabIndex = 0;
    image.role = 'button';
    previewEl.appendChild(image);
  } else if (attachment.previewType === 'markdown') {
    const contentEl = document.createElement('div');
    contentEl.className = 'attachment-tool-preview-content markdown-content';
    applyMarkdownToElement(contentEl, contentText);
    previewEl.appendChild(contentEl);
  } else if (attachment.previewType === 'text') {
    const contentEl = document.createElement('div');
    contentEl.className = 'attachment-tool-preview-content';
    contentEl.textContent = contentText;
    previewEl.appendChild(contentEl);
  } else {
    return null;
  }

  if (truncated) {
    const statusEl = document.createElement('div');
    statusEl.className = 'attachment-tool-preview-status';
    statusEl.textContent = 'Preview truncated. Expand to load the full attachment.';
    previewEl.appendChild(statusEl);
  }

  return previewEl.innerHTML;
}

function replaceAttachmentPreview(
  bubble: HTMLElement,
  html: string | null,
  options: { expanded: boolean },
): void {
  const previewEl = bubble.querySelector<HTMLDivElement>('.attachment-tool-preview');
  if (!previewEl) {
    return;
  }
  previewEl.replaceChildren();
  if (!html) {
    previewEl.style.display = 'none';
    previewEl.classList.remove('expanded');
    return;
  }
  previewEl.style.display = 'block';
  previewEl.classList.toggle('expanded', options.expanded);
  previewEl.innerHTML = html;
}

function createExportActionButton(label: string, action: string, attachmentId: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'attachment-tool-action-button';
  button.textContent = label;
  button.dataset['exportAction'] = action;
  button.dataset['exportAttachmentId'] = attachmentId;
  return button;
}

function configureAttachmentActions(options: {
  bubble: HTMLElement;
  payload: AttachmentExportPayload;
  defaultExpanded: boolean;
  canExpand: boolean;
}): void {
  const { bubble, payload, defaultExpanded, canExpand } = options;
  const actionsEl = bubble.querySelector<HTMLDivElement>('.attachment-tool-actions');
  if (!actionsEl) {
    return;
  }
  actionsEl.replaceChildren();

  if (canExpand) {
    const expandButton = createExportActionButton('Expand', 'expand', payload.attachmentId);
    const collapseButton = createExportActionButton('Collapse', 'collapse', payload.attachmentId);
    expandButton.hidden = defaultExpanded;
    collapseButton.hidden = !defaultExpanded;
    actionsEl.append(expandButton, collapseButton);
  }

  if (payload.openMode === 'image') {
    actionsEl.appendChild(createExportActionButton('Open', 'open-image', payload.attachmentId));
  } else if (payload.openMode === 'new_tab') {
    actionsEl.appendChild(createExportActionButton('Open', 'open-file', payload.attachmentId));
  }

  actionsEl.appendChild(createExportActionButton('Download', 'download', payload.attachmentId));
}

async function buildAttachmentExportPayload(
  sourceBubble: HTMLElement,
  cloneBubble: HTMLElement,
): Promise<AttachmentExportPayload | null> {
  const attachment = readAttachmentBubbleMeta(sourceBubble);
  if (!attachment) {
    return null;
  }

  const attachmentId = attachment.callId;
  const contentUrl = getAttachmentContentUrl(attachment.downloadUrl);
  let base64 = '';
  let fullText: string | null = null;
  let imageDataUrl: string | null = null;
  let contentType = attachment.contentType;

  try {
    const response = await apiFetch(contentUrl, { method: 'GET' });
    if (!response.ok) {
      throw new Error(`Failed to fetch attachment (${response.status})`);
    }
    const textResponse =
      attachment.previewType === 'text' || attachment.previewType === 'markdown'
        ? response.clone()
        : null;
    const buffer = await response.arrayBuffer();
    base64 = arrayBufferToBase64(buffer);
    contentType = response.headers.get('Content-Type')?.trim() || attachment.contentType;
    if (textResponse) {
      fullText = await textResponse.text();
    }
    if (isImageContentType(contentType)) {
      imageDataUrl = `data:${contentType};base64,${base64}`;
    }
  } catch (error) {
    console.error('[chat-export] Failed to embed attachment', error);
  }

  const defaultExpanded =
    cloneBubble.querySelector('.attachment-tool-preview')?.classList.contains('expanded') === true;
  const canExpand =
    (attachment.previewType === 'text' || attachment.previewType === 'markdown') &&
    attachment.previewTruncated &&
    typeof fullText === 'string';

  const collapsedText =
    attachment.previewType === 'none'
      ? ''
      : attachment.previewText
        ? attachment.previewTruncated
          ? `${attachment.previewText}…`
          : attachment.previewText
        : fullText ?? '';

  const collapsedPreviewHtml = buildAttachmentPreviewHtml({
    attachment,
    imageDataUrl,
    contentText: collapsedText,
    truncated: canExpand,
    expanded: false,
  });

  const expandedPreviewHtml =
    typeof fullText === 'string'
      ? buildAttachmentPreviewHtml({
          attachment,
          imageDataUrl,
          contentText: fullText,
          expanded: true,
        })
      : null;

  replaceAttachmentPreview(
    cloneBubble,
    defaultExpanded && expandedPreviewHtml ? expandedPreviewHtml : collapsedPreviewHtml,
    { expanded: defaultExpanded && Boolean(expandedPreviewHtml) },
  );
  cloneBubble.dataset['exportAttachmentId'] = attachmentId;
  cloneBubble
    .querySelectorAll<HTMLElement>('.attachment-tool-preview-image')
    .forEach((imageEl) => {
      imageEl.dataset['exportAttachmentId'] = attachmentId;
    });

  const payload: AttachmentExportPayload = {
    attachmentId,
    fileName: attachment.fileName,
    contentType,
    base64,
    downloadName: attachment.fileName,
    collapsedPreviewHtml,
    expandedPreviewHtml,
    imageDataUrl,
    openMode: isImageContentType(contentType)
      ? 'image'
      : isHtmlContentType(contentType)
        ? 'new_tab'
        : 'download',
  };
  configureAttachmentActions({
    bubble: cloneBubble,
    payload,
    defaultExpanded: defaultExpanded && Boolean(expandedPreviewHtml),
    canExpand,
  });
  return payload;
}

function sanitizeClonedChatPanel(panel: HTMLElement): void {
  panel.classList.add('chat-export-panel');
  panel.querySelector('[data-role="chrome-controls"]')?.remove();
  panel.querySelector('.chat-input-panel')?.remove();
  panel.querySelector('[data-role="chat-scroll-to-bottom"]')?.remove();
  const pluginControls = panel.querySelector<HTMLElement>('[data-role="chrome-plugin-controls"]');
  if (pluginControls) {
    for (const child of Array.from(pluginControls.children)) {
      const role = child instanceof HTMLElement ? child.dataset['role'] ?? '' : '';
      const keep =
        role === 'chat-toggle-tool-output' ||
        role === 'chat-toggle-thinking' ||
        role === 'chat-toggle-tool-expand';
      if (!keep) {
        child.remove();
      }
    }
  }

  const sessionLabelButton = panel.querySelector<HTMLButtonElement>('.chat-session-label');
  if (sessionLabelButton) {
    const label = document.createElement('span');
    label.className = `${sessionLabelButton.className} chat-export-session-label`;
    label.textContent = sessionLabelButton.textContent ?? '';
    label.title = sessionLabelButton.title;
    sessionLabelButton.replaceWith(label);
  }
}

type SnapshotRestoreState = {
  applyToClone: (clonedPanel: HTMLElement) => void;
  restore: () => void;
};

function setToolCallGroupExpanded(group: HTMLElement, expanded: boolean): void {
  group.classList.toggle('expanded', expanded);
  const header = group.querySelector<HTMLElement>('.tool-call-group-header');
  if (header) {
    header.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  }
  const toggle = group.querySelector<HTMLElement>('.tool-call-group-toggle');
  if (toggle) {
    toggle.textContent = expanded ? '▼' : '▶';
  }
}

function prepareSourcePanelForSnapshot(chatPanelEl: HTMLElement): SnapshotRestoreState {
  const hadHideToolOutput = chatPanelEl.classList.contains('hide-tool-output');
  const hadHideThinking = chatPanelEl.classList.contains('hide-thinking');
  chatPanelEl.classList.remove('hide-tool-output', 'hide-thinking');

  const groups = Array.from(chatPanelEl.querySelectorAll<HTMLElement>('.tool-call-group'));
  const groupStates = groups.map((group) => group.classList.contains('expanded'));
  for (const group of groups) {
    setToolCallGroupExpanded(group, true);
  }

  const toolBlocks = Array.from(chatPanelEl.querySelectorAll<HTMLDivElement>('.tool-output-block'));
  const toolBlockStates = toolBlocks.map((block) => block.classList.contains('expanded'));
  for (const block of toolBlocks) {
    setToolOutputBlockExpanded(block, true);
    materializeToolOutputBlockForSnapshot(block);
  }

  return {
    applyToClone: (clonedPanel) => {
      const clonedGroups = Array.from(clonedPanel.querySelectorAll<HTMLElement>('.tool-call-group'));
      clonedGroups.forEach((group, index) => {
        setToolCallGroupExpanded(group, groupStates[index] === true);
      });
      const clonedBlocks = Array.from(
        clonedPanel.querySelectorAll<HTMLDivElement>('.tool-output-block'),
      );
      clonedBlocks.forEach((block, index) => {
        setToolOutputBlockExpanded(block, toolBlockStates[index] === true);
      });
      clonedPanel.classList.toggle('hide-tool-output', hadHideToolOutput);
      clonedPanel.classList.toggle('hide-thinking', hadHideThinking);
    },
    restore: () => {
      toolBlocks.forEach((block, index) => {
        const expanded = toolBlockStates[index] === true;
        setToolOutputBlockExpanded(block, expanded);
      });
      groups.forEach((group, index) => {
        setToolCallGroupExpanded(group, groupStates[index] === true);
      });
      chatPanelEl.classList.toggle('hide-tool-output', hadHideToolOutput);
      chatPanelEl.classList.toggle('hide-thinking', hadHideThinking);
    },
  };
}

function replaceClonedToolBlocksWithSnapshots(
  sourcePanel: HTMLElement,
  clonedPanel: HTMLElement,
  options?: {
    getCanonicalToolBlock?: (callId: string) => HTMLDivElement | null;
  },
): void {
  const sourceBlocks = Array.from(sourcePanel.querySelectorAll<HTMLDivElement>('.tool-output-block'));
  const clonedBlocks = Array.from(clonedPanel.querySelectorAll<HTMLDivElement>('.tool-output-block'));
  const count = Math.min(sourceBlocks.length, clonedBlocks.length);
  for (let index = 0; index < count; index += 1) {
    const sourceBlock = sourceBlocks[index];
    const clonedBlock = clonedBlocks[index];
    if (!sourceBlock || !clonedBlock) {
      continue;
    }
    const callId = sourceBlock.dataset['callId'] ?? '';
    const canonicalBlock =
      callId && options?.getCanonicalToolBlock ? options.getCanonicalToolBlock(callId) : null;
    const snapshotSource = canonicalBlock ?? sourceBlock;
    const snapshotBlock = cloneToolOutputBlockForSnapshot(snapshotSource);
    clonedBlock.replaceWith(snapshotBlock);
  }
}

function buildExportScript(): string {
  return `(() => {
  const payloadEl = document.getElementById('assistant-chat-export-payload');
  const payload = payloadEl?.textContent ? JSON.parse(payloadEl.textContent) : { attachments: {} };
  const attachments = payload.attachments || {};

  const base64ToBytes = (base64) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  };

  const createBlobUrl = (entry) => {
    const bytes = base64ToBytes(entry.base64 || '');
    const blob = new Blob([bytes], { type: entry.contentType || 'application/octet-stream' });
    return URL.createObjectURL(blob);
  };

  const triggerDownload = (entry) => {
    if (!entry || !entry.base64) {
      return;
    }
    const objectUrl = createBlobUrl(entry);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = entry.downloadName || entry.fileName || 'attachment';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
  };

  const openInNewTab = (entry) => {
    if (!entry || !entry.base64) {
      return;
    }
    const objectUrl = createBlobUrl(entry);
    window.open(objectUrl, '_blank', 'noopener,noreferrer');
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
  };

  const ensureImageOverlay = () => {
    let overlay = document.querySelector('.attachment-image-viewer-overlay');
    if (overlay) {
      return overlay;
    }
    overlay = document.createElement('div');
    overlay.className = 'confirm-dialog-overlay attachment-image-viewer-overlay';
    overlay.innerHTML = '<div class="attachment-image-viewer-dialog" role="dialog" aria-modal="true"><div class="attachment-image-viewer-header"><div class="attachment-image-viewer-title"></div><button type="button" class="attachment-image-viewer-close" aria-label="Close image preview">Close</button></div><div class="attachment-image-viewer-body"><img class="attachment-image-viewer-image" alt="" /></div></div>';
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        overlay.remove();
      }
    });
    overlay.querySelector('.attachment-image-viewer-close')?.addEventListener('click', () => {
      overlay.remove();
    });
    return overlay;
  };

  const openImageOverlay = (entry) => {
    if (!entry?.imageDataUrl) {
      return;
    }
    const overlay = ensureImageOverlay();
    const titleEl = overlay.querySelector('.attachment-image-viewer-title');
    const imageEl = overlay.querySelector('.attachment-image-viewer-image');
    if (titleEl) {
      titleEl.textContent = entry.fileName || 'Attachment';
    }
    if (imageEl) {
      imageEl.src = entry.imageDataUrl;
      imageEl.alt = entry.fileName || 'Attachment';
    }
    if (!overlay.isConnected) {
      document.body.appendChild(overlay);
    }
    overlay.querySelector('.attachment-image-viewer-close')?.focus();
  };

  const setAttachmentExpanded = (bubble, expanded) => {
    const attachmentId = bubble?.dataset?.exportAttachmentId || '';
    const entry = attachments[attachmentId];
    if (!entry) {
      return;
    }
    const previewEl = bubble.querySelector('.attachment-tool-preview');
    if (!previewEl) {
      return;
    }
    const html = expanded ? entry.expandedPreviewHtml : entry.collapsedPreviewHtml;
    if (typeof html !== 'string' || html.length === 0) {
      return;
    }
    previewEl.innerHTML = html;
    previewEl.style.display = 'block';
    previewEl.classList.toggle('expanded', expanded);
    bubble.querySelectorAll('[data-export-action="expand"]').forEach((button) => {
      button.hidden = expanded;
    });
    bubble.querySelectorAll('[data-export-action="collapse"]').forEach((button) => {
      button.hidden = !expanded;
    });
    bubble.querySelectorAll('.attachment-tool-preview-image').forEach((image) => {
      image.dataset.exportAttachmentId = attachmentId;
    });
  };

  const setToolBlockExpanded = (block, expanded) => {
    block.classList.toggle('expanded', expanded);
    const header = block.querySelector('.tool-output-header');
    if (header) {
      header.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    }
    const toggle = block.querySelector('.tool-output-toggle');
    if (toggle) {
      toggle.textContent = expanded ? '▼' : '▶';
    }
  };

  const setToolGroupExpanded = (group, expanded) => {
    group.classList.toggle('expanded', expanded);
    const header = group.querySelector('.tool-call-group-header');
    if (header) {
      header.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    }
    const toggle = group.querySelector('.tool-call-group-toggle');
    if (toggle) {
      toggle.textContent = expanded ? '▼' : '▶';
    }
  };

  const setToggleButtonActive = (button, active) => {
    if (!button) {
      return;
    }
    button.classList.toggle('active', active);
  };

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) {
      return;
    }
    const actionButton = target.closest('[data-export-action]');
    if (actionButton instanceof HTMLElement) {
      const action = actionButton.dataset.exportAction || '';
      const attachmentId = actionButton.dataset.exportAttachmentId || '';
      const entry = attachments[attachmentId];
      const bubble = actionButton.closest('.attachment-tool-bubble');
      if (action === 'expand' && bubble) {
        event.preventDefault();
        setAttachmentExpanded(bubble, true);
        return;
      }
      if (action === 'collapse' && bubble) {
        event.preventDefault();
        setAttachmentExpanded(bubble, false);
        return;
      }
      if (action === 'download') {
        event.preventDefault();
        triggerDownload(entry);
        return;
      }
      if (action === 'open-file') {
        event.preventDefault();
        openInNewTab(entry);
        return;
      }
      if (action === 'open-image') {
        event.preventDefault();
        openImageOverlay(entry);
        return;
      }
    }

    const attachmentImage = target.closest('.attachment-tool-preview-image');
    if (attachmentImage instanceof HTMLElement) {
      const attachmentId = attachmentImage.dataset.exportAttachmentId || '';
      const entry = attachments[attachmentId];
      if (entry?.imageDataUrl) {
        event.preventDefault();
        openImageOverlay(entry);
        return;
      }
    }

    const toolHeader = target.closest('.tool-output-header');
    if (toolHeader instanceof HTMLElement) {
      const block = toolHeader.closest('.tool-output-block');
      if (block instanceof HTMLElement) {
        event.preventDefault();
        setToolBlockExpanded(block, !block.classList.contains('expanded'));
        return;
      }
    }

    const toolGroupHeader = target.closest('.tool-call-group-header');
    if (toolGroupHeader instanceof HTMLElement) {
      const group = toolGroupHeader.closest('.tool-call-group');
      if (group instanceof HTMLElement) {
        event.preventDefault();
        setToolGroupExpanded(group, !group.classList.contains('expanded'));
        return;
      }
    }

    const exportPanel = target.closest('.chat-export-panel');
    if (exportPanel instanceof HTMLElement) {
      const toggleToolOutputButton = target.closest('[data-role="chat-toggle-tool-output"]');
      if (toggleToolOutputButton instanceof HTMLButtonElement) {
        event.preventDefault();
        const hidden = exportPanel.classList.toggle('hide-tool-output');
        setToggleButtonActive(toggleToolOutputButton, !hidden);
        return;
      }
      const toggleThinkingButton = target.closest('[data-role="chat-toggle-thinking"]');
      if (toggleThinkingButton instanceof HTMLButtonElement) {
        event.preventDefault();
        const hidden = exportPanel.classList.toggle('hide-thinking');
        setToggleButtonActive(toggleThinkingButton, !hidden);
        return;
      }
      const toggleExpandButton = target.closest('[data-role="chat-toggle-tool-expand"]');
      if (toggleExpandButton instanceof HTMLButtonElement) {
        event.preventDefault();
        const blocks = Array.from(exportPanel.querySelectorAll('.tool-output-block'));
        const groups = Array.from(exportPanel.querySelectorAll('.tool-call-group'));
        const shouldExpand = blocks.some((block) => !block.classList.contains('expanded'));
        blocks.forEach((block) => setToolBlockExpanded(block, shouldExpand));
        groups.forEach((group) => setToolGroupExpanded(group, shouldExpand));
        setToggleButtonActive(toggleExpandButton, shouldExpand);
      }
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') {
      return;
    }
    const overlay = document.querySelector('.attachment-image-viewer-overlay');
    overlay?.remove();
  });
})();`;
}

function buildExportHtmlDocument(options: {
  sessionTitle: string;
  panelHtml: string;
  stylesText: string;
  attachments: Record<string, AttachmentExportPayload>;
}): string {
  const { sessionTitle, panelHtml, stylesText, attachments } = options;
  const { attrs, inlineStyle } = getRootThemeAttributes();
  const htmlAttrs = [attrs, inlineStyle ? `style="${escapeHtml(inlineStyle)}"` : '']
    .filter(Boolean)
    .join(' ');
  return `<!doctype html>
<html lang="en" ${htmlAttrs}>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(sessionTitle)}</title>
    <style>${stylesText.replaceAll('</style>', '<\\/style>')}</style>
    <style>
      html,
      body.chat-export-body {
        height: auto !important;
        min-height: 100%;
        overflow: auto !important;
      }
      body.chat-export-body {
        margin: 0;
        padding: 24px;
        min-height: 100vh;
        background: var(--color-bg-canvas);
        color: var(--color-text-primary);
        display: block !important;
      }
      .chat-export-shell {
        max-width: 1100px;
        margin: 0 auto;
      }
      .chat-export-panel {
        display: block;
        min-height: auto;
        height: auto !important;
        overflow: visible !important;
      }
      .chat-export-panel .chat-log-container,
      .chat-export-panel .chat-log {
        max-height: none;
        height: auto;
        overflow: visible !important;
      }
      .chat-export-panel .chat-session-label,
      .chat-export-panel .chat-export-session-label {
        pointer-events: none;
      }
      .chat-export-panel [data-role="chrome-plugin-controls"] {
        display: inline-flex;
      }
      .chat-export-panel .attachment-tool-actions .attachment-tool-action-button {
        appearance: none;
        border: none;
        background: transparent;
        cursor: pointer;
      }
    </style>
  </head>
  <body class="chat-export-body">
    <div class="chat-export-shell">${panelHtml}</div>
    <script id="assistant-chat-export-payload" type="application/json">${jsonForInlineScript({ attachments })}</script>
    <script>${buildExportScript().replaceAll('</script>', '<\\/script>')}</script>
  </body>
</html>`;
}

export async function buildSelfContainedChatPanelHtml(
  options: BuildSelfContainedChatPanelHtmlOptions,
): Promise<BuiltSelfContainedChatPanelHtml> {
  const { chatPanelEl, sessionTitle, getCanonicalToolBlock } = options;
  const snapshotState = prepareSourcePanelForSnapshot(chatPanelEl);
  const clonedPanel = chatPanelEl.cloneNode(true) as HTMLElement;
  replaceClonedToolBlocksWithSnapshots(
    chatPanelEl,
    clonedPanel,
    getCanonicalToolBlock ? { getCanonicalToolBlock } : undefined,
  );
  snapshotState.applyToClone(clonedPanel);
  snapshotState.restore();
  sanitizeClonedChatPanel(clonedPanel);

  const sourceAttachmentBubbles = Array.from(
    chatPanelEl.querySelectorAll<HTMLElement>('.attachment-tool-bubble[data-tool-call-id]'),
  );
  const attachmentEntries = await Promise.all(
    sourceAttachmentBubbles.map(async (sourceBubble) => {
      const callId = sourceBubble.dataset['toolCallId'];
      if (!callId) {
        return null;
      }
      const cloneBubble =
        Array.from(
          clonedPanel.querySelectorAll<HTMLElement>('.attachment-tool-bubble[data-tool-call-id]'),
        ).find((candidate) => candidate.dataset['toolCallId'] === callId) ?? null;
      if (!cloneBubble) {
        return null;
      }
      return buildAttachmentExportPayload(sourceBubble, cloneBubble);
    }),
  );

  const attachmentPayloads: Record<string, AttachmentExportPayload> = {};
  for (const entry of attachmentEntries) {
    if (!entry) {
      continue;
    }
    attachmentPayloads[entry.attachmentId] = entry;
  }

  const stylesText = await fetchStylesheetText();
  return {
    fileName: sanitizeFileName(sessionTitle),
    html: buildExportHtmlDocument({
      sessionTitle,
      panelHtml: clonedPanel.outerHTML,
      stylesText,
      attachments: attachmentPayloads,
    }),
  };
}

export async function exportSelfContainedChatPanelHtml(
  options: BuildSelfContainedChatPanelHtmlOptions,
): Promise<{ fileName: string }> {
  const { fileName, html } = await buildSelfContainedChatPanelHtml(options);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  return { fileName };
}
