import type {
  PanelHandle,
  PanelHost,
  PanelInitOptions,
} from '../../../../web-client/src/controllers/panelRegistry';
import { PanelChromeController } from '../../../../web-client/src/controllers/panelChromeController';
import type { CoreServices } from '../../../../web-client/src/utils/panelServices';
import { getPanelContextKey } from '../../../../web-client/src/utils/panelContext';
import { apiFetch, getApiBaseUrl } from '../../../../web-client/src/utils/api';

interface ArtifactMetadata {
  id: string;
  title: string;
  filename: string;
  mimeType: string;
  size: number;
  createdAt: string;
  updatedAt: string;
}

interface Instance {
  id: string;
  label: string;
}

type OperationResponse<T> = { ok: true; result: T } | { error: string };

const DEFAULT_INSTANCE_ID = 'default';

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffDays < 7) {
    return date.toLocaleDateString(undefined, { weekday: 'short' });
  } else {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
}

function createIcon(pathD: string, className = 'icon icon-sm'): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', pathD);
  svg.appendChild(path);
  return svg;
}

const ICONS = {
  file: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z M14 2v6h6',
  edit: 'M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7 M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z',
  trash: 'M3 6h18 M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2',
  download: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4 M7 10l5 5 5-5 M12 15V3',
  upload: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4 M17 8l-5-5-5 5 M12 3v12',
  check: 'M20 6L9 17l-5-5',
  x: 'M18 6L6 18 M6 6l12 12',
  externalLink: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6 M15 3h6v6 M10 14L21 3',
};

function isMobileViewport(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    if (typeof window.matchMedia === 'function') {
      return window.matchMedia('(max-width: 600px)').matches;
    }
  } catch {
    // Ignore matchMedia errors
  }
  return window.innerWidth <= 600;
}

function isCapacitorNative(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const win = window as {
    Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
  };
  if (typeof win.Capacitor?.isNativePlatform === 'function') {
    return win.Capacitor.isNativePlatform();
  }
  return typeof win.Capacitor?.getPlatform === 'function';
}

function isTauri(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return !!(window as { __TAURI__?: unknown }).__TAURI__;
}

type TauriInvoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

function getTauriInvoke(): TauriInvoke | null {
  const win = window as { __TAURI__?: { core?: { invoke?: TauriInvoke } } };
  return win.__TAURI__?.core?.invoke ?? null;
}

async function callOperation<T>(operation: string, body: Record<string, unknown>): Promise<T> {
  const response = await apiFetch(`/api/plugins/artifacts/operations/${operation}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  let payload: OperationResponse<T> | null = null;
  try {
    payload = (await response.json()) as OperationResponse<T>;
  } catch {
    // ignore JSON parsing failures
  }

  if (!response.ok || !payload || 'error' in payload) {
    const message =
      payload && 'error' in payload && payload.error
        ? payload.error
        : `Request failed (${response.status})`;
    throw new Error(message);
  }

  return payload.result;
}

async function openInBrowser(url: string): Promise<void> {
  // On Tauri desktop, use the shell plugin to open in system browser
  if (isTauri()) {
    try {
      const invoke = getTauriInvoke();
      if (invoke) {
        await invoke('plugin:shell|open', { path: url });
        return;
      }
    } catch (err) {
      console.warn('[artifacts] Failed to open URL via Tauri shell:', err);
      // Fall through to window.open
    }
  }

  // On Capacitor native (Android/iOS), use the Browser plugin to open in system browser
  if (isCapacitorNative()) {
    try {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url });
      return;
    } catch {
      // Fall through to window.open
    }
  }
  
  // On web browser, open in new tab
  window.open(url, '_blank');
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '_');
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

async function saveWithTauri(options: {
  url: string;
  suggestedName: string;
}): Promise<string | null> {
  const invoke = getTauriInvoke();
  if (!invoke) {
    return null;
  }

  const savePath = await invoke<string | string[] | null>('plugin:dialog|save', {
    options: {
      defaultPath: options.suggestedName,
    },
  });

  const resolvedPath = Array.isArray(savePath) ? savePath[0] : savePath;
  if (!resolvedPath) {
    return null;
  }

  const response = await fetch(options.url);
  if (!response.ok) {
    throw new Error(`Failed to fetch artifact: ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  const base64 = arrayBufferToBase64(buffer);

  await invoke('save_artifact_file', {
    path: resolvedPath,
    content_base64: base64,
  });

  return resolvedPath;
}

async function saveWithCapacitor(options: {
  url: string;
  suggestedName: string;
}): Promise<string | null> {
  if (!isCapacitorNative()) {
    return null;
  }

  const response = await fetch(options.url);
  if (!response.ok) {
    throw new Error(`Failed to fetch artifact: ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  const base64 = arrayBufferToBase64(buffer);

  const safeName = sanitizeFilename(options.suggestedName);
  const filePath = `artifacts/${Date.now()}-${safeName}`;

  try {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const result = await Filesystem.writeFile({
      path: filePath,
      data: base64,
      directory: Directory.Documents,
      recursive: true,
    });

    try {
      const { Share } = await import('@capacitor/share');
      await Share.share({
        title: safeName,
        url: result.uri,
      });
    } catch {
      // Share plugin not available; ignore
    }

    return result.uri ?? filePath;
  } catch (err) {
    console.warn('[artifacts] Failed to save artifact via Capacitor filesystem:', err);
    return null;
  }
}

function buildArtifactUrl(options: {
  instanceId: string;
  artifactId: string;
  download?: boolean;
}): string {
  const base = getApiBaseUrl().replace(/\/+$/, '');
  const url = `${base}/api/plugins/artifacts/files/${encodeURIComponent(
    options.instanceId,
  )}/${encodeURIComponent(options.artifactId)}`;
  if (options.download) {
    return `${url}?download=1`;
  }
  return url;
}

(function () {
  if (!window.ASSISTANT_PANEL_REGISTRY) {
    return;
  }

  window.ASSISTANT_PANEL_REGISTRY.registerPanel('artifacts', () => ({
    mount(container: HTMLElement, host: PanelHost, _init: PanelInitOptions): PanelHandle {
      const services = host.getContext('core.services') as CoreServices | null;
      const contextKey = getPanelContextKey(host.panelId());

      let artifacts: ArtifactMetadata[] = [];
      let instances: Instance[] = [{ id: DEFAULT_INSTANCE_ID, label: 'Default' }];
      let selectedInstanceId = DEFAULT_INSTANCE_ID;
      let editingId: string | null = null;
      let selectedArtifactIds = new Set<string>();
      let lastSelectedIndex: number | null = null;
      let chromeController: PanelChromeController | null = null;

      // Restore persisted state
      const persistedState = host.loadPanelState() as { instanceId?: string } | null;
      if (persistedState?.instanceId) {
        selectedInstanceId = persistedState.instanceId;
      }

      const persistState = (): void => {
        host.persistPanelState({ instanceId: selectedInstanceId });
      };

      const getInstanceLabel = (instanceId: string): string => {
        return instances.find((instance) => instance.id === instanceId)?.label ?? instanceId;
      };

      const getSelectedArtifactIds = (): string[] => {
        return artifacts
          .filter((artifact) => selectedArtifactIds.has(artifact.id))
          .map((artifact) => artifact.id);
      };

      const getSelectedItems = (): { id: string; title: string }[] => {
        return artifacts
          .filter((artifact) => selectedArtifactIds.has(artifact.id))
          .map((artifact) => ({ id: artifact.id, title: artifact.title }))
          .filter((item) => item.title.trim().length > 0);
      };

      const updatePanelContext = (): void => {
        const selectedItemIds = getSelectedArtifactIds();
        const selectedItems = getSelectedItems();
        const contextAttributes: Record<string, string> = {
          'instance-id': selectedInstanceId,
        };
        host.setContext(contextKey, {
          type: 'artifacts',
          id: selectedInstanceId,
          name: getInstanceLabel(selectedInstanceId),
          instance_id: selectedInstanceId,
          artifactCount: artifacts.length,
          selectedItemIds,
          selectedItems,
          selectedItemCount: selectedItemIds.length,
          contextAttributes,
        });
        services?.notifyContextAvailabilityChange?.();
      };

      // Build UI
      container.innerHTML = '';
      container.classList.add('artifacts-panel');

      // Header
      const header = document.createElement('div');
      header.className = 'panel-header panel-chrome-row';
      header.setAttribute('data-role', 'chrome-row');

      const headerMain = document.createElement('div');
      headerMain.className = 'panel-header-main';

      const headerLabel = document.createElement('span');
      headerLabel.className = 'panel-header-label';
      headerLabel.setAttribute('data-role', 'chrome-title');
      headerLabel.textContent = 'Artifacts';
      headerMain.appendChild(headerLabel);

      // Instance dropdown container
      const instanceContainer = document.createElement('div');
      instanceContainer.className = 'panel-chrome-instance';
      instanceContainer.setAttribute('data-role', 'instance-actions');
      instanceContainer.innerHTML = `
        <div class="panel-chrome-instance-dropdown" data-role="instance-dropdown-container">
          <button
            type="button"
            class="panel-chrome-instance-trigger"
            data-role="instance-trigger"
            aria-label="Select instance"
            aria-haspopup="listbox"
            aria-expanded="false"
          >
            <span class="panel-chrome-instance-trigger-text" data-role="instance-trigger-text">Default</span>
            <svg class="panel-chrome-instance-trigger-icon" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
              <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <div
            class="panel-chrome-instance-menu"
            data-role="instance-menu"
            role="listbox"
            aria-label="Instances"
          >
              <div class="panel-chrome-instance-search-row">
                <input
                  type="text"
                  class="panel-chrome-instance-search"
                  data-role="instance-search"
                  placeholder="Search instances..."
                  aria-label="Search instances"
                  autocomplete="off"
                />
                <button
                  type="button"
                  class="panel-chrome-instance-clear"
                  data-role="instance-clear"
                  aria-label="Clear selection"
                >
                  <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
                    <path
                      d="M6 6l12 12M18 6l-12 12"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                    />
                  </svg>
                </button>
              </div>
            <div class="panel-chrome-instance-list" data-role="instance-list"></div>
          </div>
        </div>
      `;
      headerMain.appendChild(instanceContainer);

      header.appendChild(headerMain);

      // Plugin controls
      const pluginControls = document.createElement('div');
      pluginControls.className = 'panel-chrome-plugin-controls';
      pluginControls.setAttribute('data-role', 'chrome-plugin-controls');

      const uploadBtn = document.createElement('button');
      uploadBtn.type = 'button';
      uploadBtn.className = 'artifacts-upload-btn';
      uploadBtn.setAttribute('aria-label', 'Upload file');
      uploadBtn.setAttribute('title', 'Upload file');
      uploadBtn.appendChild(createIcon(ICONS.upload));
      pluginControls.appendChild(uploadBtn);

      header.appendChild(pluginControls);

      // Frame controls
      const frameControls = document.createElement('div');
      frameControls.className = 'panel-chrome-frame-controls';
      frameControls.setAttribute('data-role', 'chrome-controls');
      frameControls.innerHTML = `
        <button type="button" class="panel-chrome-button panel-chrome-toggle" data-action="toggle" aria-label="Panel controls" title="Panel controls">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 18l-6-6 6-6"/>
          </svg>
        </button>
        <div class="panel-chrome-frame-buttons">
          <button type="button" class="panel-chrome-button" data-action="move" aria-label="Move panel" title="Move">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20"/>
            </svg>
          </button>
          <button type="button" class="panel-chrome-button" data-action="reorder" aria-label="Reorder panel" title="Reorder">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M7 16V4M7 4L3 8M7 4l4 4M17 8v12M17 20l4-4M17 20l-4-4"/>
            </svg>
          </button>
          <button type="button" class="panel-chrome-button" data-action="menu" aria-label="More actions" title="More actions">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
              <circle cx="12" cy="5" r="1.5"/>
              <circle cx="12" cy="12" r="1.5"/>
              <circle cx="12" cy="19" r="1.5"/>
            </svg>
          </button>
        </div>
        <button type="button" class="panel-chrome-button panel-chrome-close" data-action="close" aria-label="Close panel" title="Close">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      `;
      header.appendChild(frameControls);

      container.appendChild(header);

      // Body
      const body = document.createElement('div');
      body.className = 'panel-body artifacts-body';

      // Drop zone
      const dropZone = document.createElement('div');
      dropZone.className = 'artifacts-drop-zone';
      dropZone.innerHTML = '<div class="artifacts-drop-zone-text">Drop files here to upload</div>';

      // List
      const listEl = document.createElement('div');
      listEl.className = 'artifacts-list';

      // Empty state
      const emptyState = document.createElement('div');
      emptyState.className = 'artifacts-empty-state';
      emptyState.innerHTML = `
        <div class="artifacts-empty-icon">${createIcon(ICONS.file, 'icon icon-lg').outerHTML}</div>
        <div class="artifacts-empty-text">No artifacts yet</div>
        <div class="artifacts-empty-hint">Upload a file or let an agent create one</div>
      `;

      body.appendChild(dropZone);
      body.appendChild(listEl);
      body.appendChild(emptyState);
      container.appendChild(body);

      // Hidden file input
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.style.display = 'none';
      fileInput.multiple = true;
      container.appendChild(fileInput);

      const applySelectionStyles = (targetIds?: Set<string>): void => {
        const ids = targetIds ?? selectedArtifactIds;
        listEl.querySelectorAll<HTMLElement>('.artifacts-item').forEach((row) => {
          const id = row.dataset['id'];
          if (!id) {
            return;
          }
          row.classList.toggle('artifacts-item-selected', ids.has(id));
        });
      };

      const syncSelection = (): void => {
        const available = new Set(artifacts.map((artifact) => artifact.id));
        let changed = false;
        for (const id of selectedArtifactIds) {
          if (!available.has(id)) {
            selectedArtifactIds.delete(id);
            changed = true;
          }
        }
        if (lastSelectedIndex !== null && (lastSelectedIndex < 0 || lastSelectedIndex >= artifacts.length)) {
          lastSelectedIndex = null;
        }
        if (changed) {
          applySelectionStyles();
          updatePanelContext();
        }
      };

      const clearSelection = (): void => {
        if (selectedArtifactIds.size === 0) {
          return;
        }
        selectedArtifactIds.clear();
        lastSelectedIndex = null;
        applySelectionStyles();
        updatePanelContext();
      };

      const shouldIgnoreSelectionTarget = (target: EventTarget | null): boolean => {
        if (!(target instanceof Element)) {
          return false;
        }
        return Boolean(target.closest('button, input, textarea, select, a'));
      };

      // Initialize chrome controller
      chromeController = new PanelChromeController({
        root: container,
        host,
        title: 'Artifacts',
        onInstanceChange: (instanceIds) => {
          selectedInstanceId = instanceIds[0] ?? DEFAULT_INSTANCE_ID;
          selectedArtifactIds.clear();
          lastSelectedIndex = null;
          applySelectionStyles();
          updatePanelContext();
          persistState();
          void refreshList();
        },
      });

      const renderList = (): void => {
        listEl.innerHTML = '';
        syncSelection();

        if (artifacts.length === 0) {
          emptyState.classList.remove('hidden');
          listEl.classList.add('hidden');
          return;
        }

        emptyState.classList.add('hidden');
        listEl.classList.remove('hidden');

        for (let index = 0; index < artifacts.length; index += 1) {
          const artifact = artifacts[index]!;
          const item = document.createElement('div');
          item.className = 'artifacts-item';
          item.dataset['id'] = artifact.id;
          item.dataset['index'] = String(index);

          if (selectedArtifactIds.has(artifact.id)) {
            item.classList.add('artifacts-item-selected');
          }

          const info = document.createElement('div');
          info.className = 'artifacts-item-info';

          const isEditing = editingId === artifact.id;

          if (isEditing) {
            const editInput = document.createElement('input');
            editInput.type = 'text';
            editInput.className = 'artifacts-item-title-input';
            editInput.value = artifact.title;
            editInput.setAttribute('aria-label', 'Edit title');

            const saveEdit = (): void => {
              const newTitle = editInput.value.trim();
              if (newTitle && newTitle !== artifact.title) {
                renameArtifact(artifact.id, newTitle);
              }
              editingId = null;
              renderList();
            };

            const cancelEdit = (): void => {
              editingId = null;
              renderList();
            };

            editInput.addEventListener('keydown', (e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                saveEdit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelEdit();
              }
            });

            editInput.addEventListener('blur', () => {
              // Small delay to allow button clicks
              setTimeout(() => {
                if (editingId === artifact.id) {
                  cancelEdit();
                }
              }, 150);
            });

            info.appendChild(editInput);

            // Focus input after render
            setTimeout(() => {
              editInput.focus();
              editInput.select();
            }, 0);
          } else {
            const title = document.createElement('button');
            title.type = 'button';
            title.className = 'artifacts-item-title clickable';
            title.textContent = artifact.title;
            title.setAttribute('aria-label', `Open ${artifact.title}`);
            title.addEventListener('click', () => {
              openArtifact(artifact);
            });
            info.appendChild(title);
          }

          const meta = document.createElement('div');
          meta.className = 'artifacts-item-meta';
          meta.textContent = `${formatFileSize(artifact.size)} · ${formatDate(artifact.createdAt)}`;
          info.appendChild(meta);

          item.appendChild(info);

          const actions = document.createElement('div');
          actions.className = 'artifacts-item-actions';

          item.addEventListener('click', (e) => {
            if (isEditing) {
              return;
            }
            if (shouldIgnoreSelectionTarget(e.target)) {
              return;
            }
            if (e.shiftKey && lastSelectedIndex !== null) {
              e.preventDefault();
              e.stopPropagation();
              const start = Math.min(lastSelectedIndex, index);
              const end = Math.max(lastSelectedIndex, index);
              const nextSelected = new Set<string>();
              for (let i = start; i <= end; i += 1) {
                const id = artifacts[i]?.id;
                if (id) {
                  nextSelected.add(id);
                }
              }
              selectedArtifactIds = nextSelected;
              applySelectionStyles(selectedArtifactIds);
              updatePanelContext();
              return;
            }
            if (e.ctrlKey || e.metaKey) {
              e.preventDefault();
              e.stopPropagation();
              if (selectedArtifactIds.has(artifact.id)) {
                selectedArtifactIds.delete(artifact.id);
              } else {
                selectedArtifactIds.add(artifact.id);
              }
              lastSelectedIndex = index;
              item.classList.toggle('artifacts-item-selected', selectedArtifactIds.has(artifact.id));
              updatePanelContext();
            }
          });

          let touchStartTime = 0;
          let touchStartX = 0;
          let touchStartY = 0;
          let touchSelectionBlocked = false;
          const LONG_PRESS_THRESHOLD_MS = 500;
          const TOUCH_MOVE_THRESHOLD = 10;

          item.addEventListener(
            'touchstart',
            (e) => {
              touchSelectionBlocked = shouldIgnoreSelectionTarget(e.target);
              if (touchSelectionBlocked) {
                return;
              }
              touchStartTime = Date.now();
              const touch = e.touches[0];
              if (touch) {
                touchStartX = touch.clientX;
                touchStartY = touch.clientY;
              }
            },
            { passive: true },
          );

          item.addEventListener('touchend', (e) => {
            if (touchSelectionBlocked) {
              touchSelectionBlocked = false;
              return;
            }

            const touchDuration = Date.now() - touchStartTime;
            const touch = e.changedTouches[0];
            if (!touch) {
              return;
            }
            if (touchDuration >= LONG_PRESS_THRESHOLD_MS) {
              const dx = Math.abs(touch.clientX - touchStartX);
              const dy = Math.abs(touch.clientY - touchStartY);
              if (dx < TOUCH_MOVE_THRESHOLD && dy < TOUCH_MOVE_THRESHOLD) {
                e.preventDefault();
                if (selectedArtifactIds.has(artifact.id)) {
                  selectedArtifactIds.delete(artifact.id);
                } else {
                  selectedArtifactIds.add(artifact.id);
                }
                lastSelectedIndex = index;
                item.classList.toggle(
                  'artifacts-item-selected',
                  selectedArtifactIds.has(artifact.id),
                );
                updatePanelContext();
              }
            }

            touchSelectionBlocked = false;
          });

          if (!isEditing) {
            const openBtn = document.createElement('button');
            openBtn.type = 'button';
            openBtn.className = 'artifacts-item-action';
            openBtn.setAttribute('aria-label', 'Open');
            openBtn.setAttribute('title', 'Open in browser');
            openBtn.appendChild(createIcon(ICONS.externalLink));
            openBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              openArtifact(artifact);
            });
            actions.appendChild(openBtn);

            const downloadBtn = document.createElement('button');
            downloadBtn.type = 'button';
            downloadBtn.className = 'artifacts-item-action';
            downloadBtn.setAttribute('aria-label', 'Download');
            downloadBtn.setAttribute('title', 'Download');
            downloadBtn.appendChild(createIcon(ICONS.download));
            downloadBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              downloadArtifact(artifact);
            });
            actions.appendChild(downloadBtn);

            const editBtn = document.createElement('button');
            editBtn.type = 'button';
            editBtn.className = 'artifacts-item-action';
            editBtn.setAttribute('aria-label', 'Rename');
            editBtn.setAttribute('title', 'Rename');
            editBtn.appendChild(createIcon(ICONS.edit));
            editBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              editingId = artifact.id;
              renderList();
            });
            actions.appendChild(editBtn);

            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'artifacts-item-action artifacts-item-action-danger';
            deleteBtn.setAttribute('aria-label', 'Delete');
            deleteBtn.setAttribute('title', 'Delete');
            deleteBtn.appendChild(createIcon(ICONS.trash));
            deleteBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              deleteArtifact(artifact.id);
            });
            actions.appendChild(deleteBtn);
          }

          item.appendChild(actions);
          listEl.appendChild(item);
        }
      };

      const refreshList = async (): Promise<void> => {
        try {
          artifacts = await callOperation<ArtifactMetadata[]>('list', {
            instance_id: selectedInstanceId,
          });
          renderList();
          updatePanelContext();
        } catch (error) {
          services?.setStatus?.('Failed to load artifacts');
          console.error('Failed to load artifacts', error);
        }
      };

      const refreshInstances = async (): Promise<void> => {
        try {
          const list = await callOperation<Instance[]>('instance_list', {});
          instances = list.length > 0 ? list : [{ id: DEFAULT_INSTANCE_ID, label: 'Default' }];
          chromeController?.setInstances(instances, [selectedInstanceId]);
          if (!instances.some((instance) => instance.id === selectedInstanceId)) {
            selectedInstanceId = DEFAULT_INSTANCE_ID;
            persistState();
            await refreshList();
          }
          updatePanelContext();
        } catch (error) {
          services?.setStatus?.('Failed to load instances');
          console.error('Failed to load instances', error);
          instances = [{ id: DEFAULT_INSTANCE_ID, label: 'Default' }];
          chromeController?.setInstances(instances, [selectedInstanceId]);
          updatePanelContext();
        }
      };

      const uploadFile = async (file: File): Promise<void> => {
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = (reader.result as string).split(',')[1];
          try {
            await callOperation<ArtifactMetadata>('upload', {
              instance_id: selectedInstanceId,
              title: file.name,
              filename: file.name,
              content: base64,
              mimeType: file.type || 'application/octet-stream',
            });
            // Wait for panel_update websocket event to update the list.
          } catch (error) {
            services?.setStatus?.('Failed to upload file');
            console.error('Failed to upload file', error);
          }
        };
        reader.readAsDataURL(file);
      };

      const openArtifact = (artifact: ArtifactMetadata): void => {
        const url = buildArtifactUrl({
          instanceId: selectedInstanceId,
          artifactId: artifact.id,
        });
        void openInBrowser(url);
      };

      const downloadArtifact = (artifact: ArtifactMetadata): void => {
        const url = buildArtifactUrl({
          instanceId: selectedInstanceId,
          artifactId: artifact.id,
          download: true,
        });

        if (isTauri()) {
          void saveWithTauri({ url, suggestedName: artifact.filename }).catch((err) => {
            console.warn('[artifacts] Failed to save artifact via Tauri dialog:', err);
          });
          return;
        }

        if (isCapacitorNative()) {
          void saveWithCapacitor({ url, suggestedName: artifact.filename }).catch((err) => {
            console.warn('[artifacts] Failed to save artifact via Capacitor filesystem:', err);
          });
          return;
        }

        const link = document.createElement('a');
        link.href = url;
        link.download = artifact.filename;
        link.click();
      };

      const renameArtifact = (id: string, title: string): void => {
        void (async () => {
          try {
            const artifact = await callOperation<ArtifactMetadata>('rename', {
              instance_id: selectedInstanceId,
              id,
              title,
            });
            const idx = artifacts.findIndex((a) => a.id === artifact.id);
            if (idx >= 0) {
              artifacts[idx] = artifact;
              renderList();
            }
          } catch (error) {
            services?.setStatus?.('Failed to rename artifact');
            console.error('Failed to rename artifact', error);
          }
        })();
      };

      const deleteArtifact = (id: string): void => {
        const handleDelete = () => {
          void (async () => {
            try {
              await callOperation<{ ok: true }>('delete', {
                instance_id: selectedInstanceId,
                id,
              });
              artifacts = artifacts.filter((a) => a.id !== id);
              renderList();
              updatePanelContext();
            } catch (error) {
              services?.setStatus?.('Failed to delete artifact');
              console.error('Failed to delete artifact', error);
            }
          })();
        };

        if (services?.dialogManager) {
          services.dialogManager.showConfirmDialog({
            title: 'Delete artifact',
            message: 'Are you sure you want to delete this artifact? This cannot be undone.',
            confirmText: 'Delete',
            confirmClassName: 'danger',
            keydownStopsPropagation: true,
            removeKeydownOnButtonClick: true,
            confirmCloseBehavior: 'remove-only',
            cancelCloseBehavior: 'remove-only',
            onConfirm: handleDelete,
          });
        } else {
          // Fallback to native confirm
          if (confirm('Are you sure you want to delete this artifact?')) {
            handleDelete();
          }
        }
      };

      // Event handlers
      uploadBtn.addEventListener('click', () => {
        fileInput.click();
      });

      fileInput.addEventListener('change', () => {
        const files = fileInput.files;
        if (files) {
          for (const file of Array.from(files)) {
            void uploadFile(file);
          }
        }
        fileInput.value = '';
      });

      // Drag and drop
      let dragCounter = 0;

      body.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter++;
        dropZone.classList.add('active');
      });

      body.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter === 0) {
          dropZone.classList.remove('active');
        }
      });

      body.addEventListener('dragover', (e) => {
        e.preventDefault();
      });

      body.addEventListener('drop', (e) => {
        e.preventDefault();
        dragCounter = 0;
        dropZone.classList.remove('active');

        const files = e.dataTransfer?.files;
        if (files) {
          for (const file of Array.from(files)) {
            void uploadFile(file);
          }
        }
      });

      const handleClearContextSelection = (): void => {
        clearSelection();
      };
      document.addEventListener('assistant:clear-context-selection', handleClearContextSelection);

      // Initial data fetch
      void refreshInstances();
      void refreshList();

      return {
        onEvent(event) {
          const payload = event.payload as Record<string, unknown> | undefined;
          if (!payload) return;

          const eventType = payload['type'];

          if (eventType === 'list_response') {
            const instanceId = payload['instance_id'] as string;
            if (instanceId === selectedInstanceId) {
              artifacts = (payload['artifacts'] as ArtifactMetadata[]) || [];
              renderList();
              updatePanelContext();
            }
          } else if (eventType === 'instances_response') {
            const newInstances = (payload['instances'] as Instance[]) || [];
            if (newInstances.length > 0) {
              instances = newInstances;
              chromeController?.setInstances(instances, [selectedInstanceId]);
              // If current instance no longer exists, switch to default
              if (!instances.some((i) => i.id === selectedInstanceId)) {
                selectedInstanceId = DEFAULT_INSTANCE_ID;
                persistState();
                void refreshList();
              }
              updatePanelContext();
            }
          } else if (eventType === 'panel_update') {
            const instanceId = payload['instance_id'] as string;
            if (instanceId === selectedInstanceId) {
              const action = payload['action'] as string;
              const artifact = payload['artifact'] as ArtifactMetadata | undefined;
              const artifactId = payload['artifactId'] as string | undefined;

              if (action === 'artifact_uploaded' && artifact) {
                if (!artifacts.some((entry) => entry.id === artifact.id)) {
                  artifacts = [artifact, ...artifacts];
                  renderList();
                  updatePanelContext();
                }
              } else if (action === 'artifact_updated' && artifact) {
                const idx = artifacts.findIndex((a) => a.id === artifact.id);
                if (idx >= 0) {
                  artifacts[idx] = artifact;
                  renderList();
                  updatePanelContext();
                }
              } else if (action === 'artifact_renamed' && artifact) {
                const idx = artifacts.findIndex((a) => a.id === artifact.id);
                if (idx >= 0) {
                  artifacts[idx] = artifact;
                  renderList();
                  updatePanelContext();
                }
              } else if (action === 'artifact_deleted' && artifactId) {
                artifacts = artifacts.filter((a) => a.id !== artifactId);
                renderList();
                updatePanelContext();
              }
            }
          } else if (eventType === 'upload_response') {
            if (!payload['ok']) {
              services?.setStatus?.(`Upload failed: ${payload['error']}`);
            }
          } else if (eventType === 'rename_response') {
            if (!payload['ok']) {
              services?.setStatus?.(`Rename failed: ${payload['error']}`);
            }
          } else if (eventType === 'delete_response') {
            if (!payload['ok']) {
              services?.setStatus?.(`Delete failed: ${payload['error']}`);
            }
          }
        },

        onVisibilityChange(visible) {
          if (visible) {
            void refreshList();
            chromeController?.scheduleLayoutCheck();
          }
        },

        unmount() {
          document.removeEventListener(
            'assistant:clear-context-selection',
            handleClearContextSelection,
          );
          chromeController?.destroy();
          chromeController = null;
          host.setContext(contextKey, null);
          container.innerHTML = '';
        },
      };
    },
  }));
})();
