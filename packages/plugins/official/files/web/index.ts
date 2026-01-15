import type { PanelHost } from '../../../../web-client/src/controllers/panelRegistry';
import { apiFetch } from '../../../../web-client/src/utils/api';
import { getPanelContextKey } from '../../../../web-client/src/utils/panelContext';
import { MarkdownViewerController } from '../../../../web-client/src/controllers/markdownViewerController';
import { PanelChromeController } from '../../../../web-client/src/controllers/panelChromeController';

const FILES_PANEL_TEMPLATE = `
  <aside class="files-panel" aria-label="Files panel">
    <div class="panel-header panel-chrome-row files-panel-header" data-role="chrome-row">
      <div class="panel-header-main">
        <span class="panel-header-label" data-role="chrome-title">Files</span>
      </div>
      <div class="panel-chrome-plugin-controls files-panel-plugin-controls" data-role="chrome-plugin-controls">
        <div class="files-panel-root" data-role="files-root"></div>
        <div class="files-panel-actions">
          <button type="button" class="files-panel-button" data-role="files-collapse">Collapse all</button>
          <button type="button" class="files-panel-button" data-role="files-refresh">Refresh</button>
        </div>
      </div>
      <div class="panel-chrome-frame-controls" data-role="chrome-controls">
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
      </div>
    </div>
    <div class="files-panel-status" data-role="files-status"></div>
    <div class="files-panel-body">
      <section class="files-panel-tree" data-role="files-tree-panel">
        <div class="files-tree" data-role="files-tree"></div>
      </section>
      <section class="files-panel-preview">
        <div class="files-preview-header" data-role="files-preview-header">
          <button type="button" class="files-preview-back" data-role="files-back" aria-label="Back to file list">← Files</button>
          <span class="files-preview-title" data-role="files-preview-title">Select a file</span>
          <span class="files-preview-meta" data-role="files-preview-meta"></span>
          <div class="files-preview-controls" data-role="files-preview-controls">
            <button type="button" class="files-preview-view-toggle" data-role="files-view-toggle" style="display: none;">View Source</button>
            <button type="button" class="files-preview-expand-toggle" data-role="files-expand-toggle" style="display: none;"></button>
          </div>
        </div>
        <div class="files-preview-status" data-role="files-preview-status"></div>
        <pre class="files-preview-content files-preview-source" data-role="files-preview-content"></pre>
        <div class="files-preview-markdown" data-role="files-preview-markdown"></div>
      </section>
    </div>
  </aside>
`;

const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdown', '.mkd'];

function isMarkdownFile(path: string): boolean {
  const lower = path.toLowerCase();
  return MARKDOWN_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

const registry = window.ASSISTANT_PANEL_REGISTRY;

type WorkspaceEntry = {
  path: string;
  name: string;
  type: 'file' | 'dir';
  repoRoot?: boolean;
};

type WorkspaceListResponse = {
  root: string;
  rootName: string;
  rootIsRepo: boolean;
  path: string;
  entries: WorkspaceEntry[];
  truncated: boolean;
};

type WorkspaceReadResponse = {
  root: string;
  path: string;
  content: string;
  truncated: boolean;
  binary: boolean;
};

type OperationResponse<T> = { ok: true; result: T } | { error: string };

type FileNode = {
  path: string;
  name: string;
  type: 'file' | 'dir';
  repoRoot?: boolean;
  children?: string[];
  isLoaded?: boolean;
  isLoading?: boolean;
  truncated?: boolean;
  error?: string;
};

type PreviewState = {
  path: string | null;
  content: string;
  binary: boolean;
  truncated: boolean;
  loading: boolean;
  error: string;
  isMarkdown: boolean;
  viewMode: 'rendered' | 'source';
};

type PersistedPanelState = {
  selectedPath: string | null;
  expandedPaths: string[];
};

async function callOperation<T>(operation: string, body: Record<string, unknown>): Promise<T> {
  const response = await apiFetch(`/api/plugins/files/operations/${operation}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  let payload: OperationResponse<T> | null = null;
  try {
    payload = (await response.json()) as OperationResponse<T>;
  } catch {
    // ignore
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

if (!registry || typeof registry.registerPanel !== 'function') {
  console.warn('ASSISTANT_PANEL_REGISTRY is not available for files plugin.');
} else {
  registry.registerPanel('files', () => ({
    mount(container: HTMLElement, host: PanelHost) {
      container.innerHTML = FILES_PANEL_TEMPLATE.trim();

      const root = container.firstElementChild as HTMLElement | null;
      if (!root) {
        throw new Error('Failed to render files panel');
      }

      const rootLabel = root.querySelector<HTMLElement>('[data-role="files-root"]');
      const statusEl = root.querySelector<HTMLElement>('[data-role="files-status"]');
      const treePanel = root.querySelector<HTMLElement>('[data-role="files-tree-panel"]');
      const treeEl = root.querySelector<HTMLElement>('[data-role="files-tree"]');
      const refreshButton = root.querySelector<HTMLButtonElement>('[data-role="files-refresh"]');
      const collapseButton = root.querySelector<HTMLButtonElement>('[data-role="files-collapse"]');
      const previewSection = root.querySelector<HTMLElement>('.files-panel-preview');
      const backButton = root.querySelector<HTMLButtonElement>('[data-role="files-back"]');
      const previewTitle = root.querySelector<HTMLElement>('[data-role="files-preview-title"]');
      const previewMeta = root.querySelector<HTMLElement>('[data-role="files-preview-meta"]');
      const previewStatus = root.querySelector<HTMLElement>('[data-role="files-preview-status"]');
      const previewContent = root.querySelector<HTMLElement>('[data-role="files-preview-content"]');
      const previewMarkdown = root.querySelector<HTMLElement>(
        '[data-role="files-preview-markdown"]',
      );
      const viewToggleButton = root.querySelector<HTMLButtonElement>(
        '[data-role="files-view-toggle"]',
      );
      const expandToggleButton = root.querySelector<HTMLButtonElement>(
        '[data-role="files-expand-toggle"]',
      );

      if (
        !rootLabel ||
        !statusEl ||
        !treePanel ||
        !treeEl ||
        !refreshButton ||
        !collapseButton ||
        !previewSection ||
        !backButton ||
        !previewTitle ||
        !previewMeta ||
        !previewStatus ||
        !previewContent ||
        !previewMarkdown ||
        !viewToggleButton ||
        !expandToggleButton
      ) {
        throw new Error('Files panel failed to locate required elements');
      }

      let chromeController: PanelChromeController | null = new PanelChromeController({
        root,
        host,
        title: 'Files',
      });

      // Mobile view state management
      const isMobileView = (): boolean => window.innerWidth <= 900;

      const showPreviewOnMobile = (): void => {
        if (isMobileView()) {
          root.classList.add('mobile-preview-active');
        }
      };

      const showTreeOnMobile = (): void => {
        root.classList.remove('mobile-preview-active');
      };

      // Load persisted state
      const loadPersistedState = (): PersistedPanelState | null => {
        const saved = host.loadPanelState();
        if (saved && typeof saved === 'object') {
          const s = saved as Record<string, unknown>;
          return {
            selectedPath: typeof s.selectedPath === 'string' ? s.selectedPath : null,
            expandedPaths: Array.isArray(s.expandedPaths) ? (s.expandedPaths as string[]) : [],
          };
        }
        return null;
      };

      const saveState = (): void => {
        const persistedState: PersistedPanelState = {
          selectedPath: state.selectedPath,
          expandedPaths: Array.from(state.expanded),
        };
        host.persistPanelState(persistedState);
      };

      const savedState = loadPersistedState();

      let markdownViewer: MarkdownViewerController | null = null;

      const contextKey = getPanelContextKey(host.panelId());

      const state = {
        rootName: 'Workspace',
        rootPath: '',
        rootIsRepo: false,
        rootTruncated: false,
        rootLoading: false,
        rootError: '',
        nodes: new Map<string, FileNode>(),
        rootChildren: [] as string[],
        expanded: new Set<string>(),
        selectedPath: null as string | null,
        preview: {
          path: null,
          content: '',
          binary: false,
          truncated: false,
          loading: false,
          error: '',
          isMarkdown: false,
          viewMode: 'rendered',
        } as PreviewState,
      };

      let listRequestId = 0;
      let previewRequestId = 0;
      const listRequestByPath = new Map<string, number>();

      const setStatus = (message: string, kind?: 'error' | 'loading' | null): void => {
        statusEl.textContent = message;
        statusEl.classList.toggle('error', kind === 'error');
        statusEl.classList.toggle('loading', kind === 'loading');
      };

      const setPreviewStatus = (message: string, kind?: 'error' | 'loading' | null): void => {
        previewStatus.textContent = message;
        previewStatus.classList.toggle('error', kind === 'error');
        previewStatus.classList.toggle('loading', kind === 'loading');
      };

      const renderRootLabel = (): void => {
        rootLabel.innerHTML = '';
        const label = document.createElement('span');
        label.className = 'files-root-label';
        label.textContent = 'Root:';

        const name = document.createElement('span');
        name.className = 'files-root-name';
        name.textContent = state.rootName || 'Not configured';

        rootLabel.appendChild(label);
        rootLabel.appendChild(name);
        if (state.rootIsRepo) {
          const badge = document.createElement('span');
          badge.className = 'files-root-badge';
          badge.textContent = 'repo';
          rootLabel.appendChild(badge);
        }

        if (state.rootPath) {
          rootLabel.title = state.rootPath;
        }
        chromeController?.scheduleLayoutCheck();
      };

      const updateStatus = (): void => {
        if (state.rootError) {
          setStatus(state.rootError, 'error');
          return;
        }
        if (state.rootLoading) {
          setStatus('Loading workspace...', 'loading');
          return;
        }
        if (state.rootTruncated) {
          setStatus('Results truncated for large directories.', null);
          return;
        }
        setStatus('', null);
      };

      const updateExpandToggleLabel = (): void => {
        if (!markdownViewer) {
          return;
        }
        expandToggleButton.textContent = markdownViewer.getExpandCollapseLabel();
        expandToggleButton.setAttribute('aria-label', markdownViewer.getExpandCollapseAriaLabel());
      };

      const renderMarkdownPreview = (): void => {
        const preview = state.preview;
        // Destroy previous viewer
        markdownViewer?.destroy();
        markdownViewer = null;
        expandToggleButton.style.display = 'none';

        if (!preview.isMarkdown || preview.binary || !preview.content) {
          return;
        }

        // Create new viewer
        markdownViewer = new MarkdownViewerController({
          container: previewMarkdown,
          contentClass: 'files-markdown-content',
        });

        markdownViewer.render(preview.content, () => {
          updateExpandToggleLabel();
        });

        // Show/hide expand toggle based on sections
        const hasSections = markdownViewer.hasSections();
        expandToggleButton.style.display = hasSections ? 'inline-flex' : 'none';
        if (hasSections) {
          updateExpandToggleLabel();
        }
      };

      const updatePreview = (): void => {
        const preview = state.preview;
        if (preview.loading) {
          setPreviewStatus('', null);
        } else if (preview.error) {
          setPreviewStatus(preview.error, 'error');
        } else {
          setPreviewStatus('', null);
        }

        if (!preview.path) {
          previewTitle.textContent = 'Select a file';
          previewMeta.textContent = '';
          previewContent.textContent = '';
          previewContent.style.display = '';
          previewMarkdown.style.display = 'none';
          viewToggleButton.style.display = 'none';
          expandToggleButton.style.display = 'none';
          markdownViewer?.destroy();
          markdownViewer = null;
          return;
        }

        previewTitle.textContent = preview.path;

        if (preview.binary) {
          previewMeta.textContent = 'Binary file';
          previewContent.textContent = 'Binary file preview is not available.';
          previewContent.style.display = '';
          previewMarkdown.style.display = 'none';
          viewToggleButton.style.display = 'none';
          expandToggleButton.style.display = 'none';
          markdownViewer?.destroy();
          markdownViewer = null;
          return;
        }

        previewMeta.textContent = preview.truncated ? 'Preview truncated' : '';

        // Handle markdown files
        if (preview.isMarkdown) {
          viewToggleButton.style.display = 'inline-flex';

          if (preview.viewMode === 'rendered') {
            viewToggleButton.textContent = 'View Source';
            previewContent.style.display = 'none';
            previewMarkdown.style.display = '';
            renderMarkdownPreview();
          } else {
            viewToggleButton.textContent = 'View Rendered';
            previewContent.textContent = preview.content;
            previewContent.style.display = '';
            previewMarkdown.style.display = 'none';
            expandToggleButton.style.display = 'none';
            markdownViewer?.destroy();
            markdownViewer = null;
          }
        } else {
          // Non-markdown files
          previewContent.textContent = preview.content;
          previewContent.style.display = '';
          previewMarkdown.style.display = 'none';
          viewToggleButton.style.display = 'none';
          expandToggleButton.style.display = 'none';
          markdownViewer?.destroy();
          markdownViewer = null;
        }
      };

      const createBadge = (text: string, kind?: string): HTMLElement => {
        const badge = document.createElement('span');
        badge.className = 'files-tree-badge';
        if (kind) {
          badge.classList.add(`files-tree-badge-${kind}`);
        }
        badge.textContent = text;
        return badge;
      };

      const renderPlaceholder = (message: string, depth: number, kind?: string): HTMLElement => {
        const row = document.createElement('div');
        row.className = 'files-tree-placeholder';
        if (kind) {
          row.classList.add(`is-${kind}`);
        }
        row.style.setProperty('--files-depth', String(depth));
        row.textContent = message;
        return row;
      };

      const buildTreeRows = (): DocumentFragment => {
        const fragment = document.createDocumentFragment();

        if (state.rootChildren.length === 0) {
          if (state.rootLoading) {
            fragment.appendChild(renderPlaceholder('Loading...', 0));
          } else if (!state.rootError) {
            fragment.appendChild(renderPlaceholder('No files found.', 0));
          }
          return fragment;
        }

        const appendNode = (nodePath: string, depth: number): void => {
          const node = state.nodes.get(nodePath);
          if (!node) {
            return;
          }

          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'files-tree-row';
          row.style.setProperty('--files-depth', String(depth));
          row.classList.toggle('active', node.path === state.selectedPath);
          row.classList.toggle('is-dir', node.type === 'dir');
          row.classList.toggle('expanded', node.type === 'dir' && state.expanded.has(node.path));
          row.dataset['path'] = node.path;

          const caret = document.createElement('span');
          caret.className = 'files-tree-caret';
          if (node.type === 'dir') {
            caret.textContent = state.expanded.has(node.path) ? 'v' : '>';
          } else {
            caret.textContent = '';
          }

          const name = document.createElement('span');
          name.className = 'files-tree-name';
          name.textContent = node.name;

          const meta = document.createElement('span');
          meta.className = 'files-tree-meta';
          if (node.repoRoot) {
            meta.appendChild(createBadge('repo', 'repo'));
          }
          if (node.truncated) {
            meta.appendChild(createBadge('trunc', 'truncated'));
          }

          row.appendChild(caret);
          row.appendChild(name);
          row.appendChild(meta);

          row.addEventListener('click', () => {
            if (node.type === 'dir') {
              toggleDirectory(node.path);
            } else {
              selectFile(node.path);
            }
          });

          fragment.appendChild(row);

          if (node.type === 'dir' && state.expanded.has(node.path)) {
            if (node.isLoading) {
              fragment.appendChild(renderPlaceholder('Loading...', depth + 1));
              return;
            }
            if (node.error) {
              fragment.appendChild(renderPlaceholder(node.error, depth + 1, 'error'));
              return;
            }
            if (node.isLoaded && (!node.children || node.children.length === 0)) {
              fragment.appendChild(renderPlaceholder('Empty folder', depth + 1));
              return;
            }
            if (node.children) {
              node.children.forEach((childPath) => appendNode(childPath, depth + 1));
            }
          }
        };

        state.rootChildren.forEach((childPath) => appendNode(childPath, 0));
        return fragment;
      };

      const renderTree = (): void => {
        treeEl.innerHTML = '';
        treeEl.appendChild(buildTreeRows());
      };

      const updateNode = (entry: WorkspaceEntry): FileNode => {
        const existing = state.nodes.get(entry.path);
        const node: FileNode = {
          path: entry.path,
          name: entry.name,
          type: entry.type,
          repoRoot: entry.repoRoot,
          children: existing?.children,
          isLoaded: existing?.isLoaded,
          isLoading: existing?.isLoading,
          truncated: existing?.truncated,
          error: existing?.error,
        };
        state.nodes.set(entry.path, node);
        return node;
      };

      const updateDirectoryChildren = (
        dirPath: string,
        entries: WorkspaceEntry[],
        truncated: boolean,
      ) => {
        const children = entries.map((entry) => entry.path);
        entries.forEach(updateNode);
        const node = state.nodes.get(dirPath);
        if (node) {
          node.children = children;
          node.isLoaded = true;
          node.isLoading = false;
          node.error = '';
          node.truncated = truncated;
        }
      };

      const loadDirectory = async (dirPath: string): Promise<void> => {
        const requestId = (listRequestId += 1);
        listRequestByPath.set(dirPath, requestId);

        const node = state.nodes.get(dirPath);
        if (node) {
          node.isLoading = true;
          node.error = '';
        }
        renderTree();

        try {
          const result = await callOperation<WorkspaceListResponse>(
            'workspace-list',
            dirPath ? { path: dirPath } : {},
          );

          if (listRequestByPath.get(dirPath) !== requestId) {
            return;
          }
          listRequestByPath.delete(dirPath);
          updateDirectoryChildren(dirPath, result.entries ?? [], result.truncated);
          renderTree();
        } catch (err) {
          if (listRequestByPath.get(dirPath) !== requestId) {
            return;
          }
          listRequestByPath.delete(dirPath);
          const node = state.nodes.get(dirPath);
          if (node) {
            node.isLoading = false;
            node.error = err instanceof Error ? err.message : 'Failed to load folder.';
          }
          renderTree();
        }
      };

      // Restore expanded directories and selected file from saved state
      const restoreState = async (saved: PersistedPanelState): Promise<void> => {
        // Restore expanded directories - need to load each directory's contents
        // We process them in order of depth to ensure parent dirs are loaded first
        const sortedPaths = saved.expandedPaths.slice().sort((a, b) => {
          const depthA = a.split('/').length;
          const depthB = b.split('/').length;
          return depthA - depthB;
        });

        for (const dirPath of sortedPaths) {
          // Check if the directory exists in our nodes
          const node = state.nodes.get(dirPath);
          if (node && node.type === 'dir') {
            state.expanded.add(dirPath);
            if (!node.isLoaded) {
              // Load the directory contents
              try {
                const result = await callOperation<WorkspaceListResponse>('workspace-list', {
                  path: dirPath,
                });
                updateDirectoryChildren(dirPath, result.entries ?? [], result.truncated);
              } catch {
                // If we can't load the directory, just skip it
                state.expanded.delete(dirPath);
              }
            }
          }
        }

        renderTree();

        // Restore selected file
        if (saved.selectedPath) {
          // Check if the file exists (its parent directory should be loaded by now)
          const parentDir = saved.selectedPath.substring(0, saved.selectedPath.lastIndexOf('/'));
          const parentNode = parentDir ? state.nodes.get(parentDir) : null;
          const fileExistsInTree =
            state.nodes.has(saved.selectedPath) ||
            (parentNode?.children?.includes(saved.selectedPath) ?? false) ||
            state.rootChildren.includes(saved.selectedPath);

          if (fileExistsInTree || !parentDir) {
            selectFile(saved.selectedPath);
          }
        }
      };

      const loadRoot = async (): Promise<void> => {
        state.rootLoading = true;
        state.rootError = '';
        updateStatus();
        renderTree();

        const requestId = (listRequestId += 1);
        listRequestByPath.set('', requestId);
        try {
          const result = await callOperation<WorkspaceListResponse>('workspace-list', {});
          if (listRequestByPath.get('') !== requestId) {
            return;
          }
          listRequestByPath.delete('');
          state.rootLoading = false;
          state.rootName = result.rootName || 'Workspace';
          state.rootPath = result.root || '';
          state.rootIsRepo = !!result.rootIsRepo;
          state.rootTruncated = result.truncated;

          const entries = result.entries ?? [];
          entries.forEach(updateNode);
          state.rootChildren = entries.map((entry) => entry.path);

          renderRootLabel();
          updateStatus();
          renderTree();

          // Restore saved state after root is loaded
          if (savedState && (savedState.selectedPath || savedState.expandedPaths.length > 0)) {
            await restoreState(savedState);
          }
        } catch (err) {
          if (listRequestByPath.get('') !== requestId) {
            return;
          }
          listRequestByPath.delete('');
          state.rootLoading = false;
          state.rootError = err instanceof Error ? err.message : 'Failed to load workspace.';
          updateStatus();
          renderTree();
        }
      };

      const loadPreview = async (filePath: string): Promise<void> => {
        const requestId = (previewRequestId += 1);
        state.preview.loading = true;
        state.preview.error = '';
        state.preview.content = '';
        state.preview.binary = false;
        state.preview.truncated = false;
        state.preview.isMarkdown = isMarkdownFile(filePath);
        state.preview.viewMode = 'rendered'; // Default to rendered for markdown
        updatePreview();

        try {
          const result = await callOperation<WorkspaceReadResponse>('workspace-read', {
            path: filePath,
          });
          if (requestId !== previewRequestId) {
            return;
          }
          state.preview.loading = false;
          state.preview.path = result.path;
          state.preview.binary = !!result.binary;
          state.preview.truncated = !!result.truncated;
          state.preview.content = result.content || '';
          state.preview.isMarkdown = isMarkdownFile(result.path);
          updatePreview();
        } catch (err) {
          if (requestId !== previewRequestId) {
            return;
          }
          state.preview.loading = false;
          state.preview.error = err instanceof Error ? err.message : 'Failed to load preview.';
          updatePreview();
        }
      };

      const selectFile = (filePath: string): void => {
        state.selectedPath = filePath;
        const absolutePath = state.rootPath ? `${state.rootPath}/${filePath}` : filePath;
        host.setContext(contextKey, {
          type: 'file',
          path: filePath,
          absolutePath,
          contextAttributes: {
            'selected-path': absolutePath,
          },
        });
        renderTree();
        state.preview.path = filePath;
        loadPreview(filePath);
        showPreviewOnMobile();
        saveState();
      };

      const clearSelection = (): void => {
        state.selectedPath = null;
        state.preview = {
          path: null,
          content: '',
          binary: false,
          truncated: false,
          loading: false,
          error: '',
          isMarkdown: false,
          viewMode: 'rendered',
        };
        host.setContext(contextKey, null);
        markdownViewer?.destroy();
        markdownViewer = null;
        updatePreview();
        renderTree();
      };

      const toggleDirectory = (dirPath: string): void => {
        if (state.expanded.has(dirPath)) {
          state.expanded.delete(dirPath);
          renderTree();
          saveState();
          return;
        }

        state.expanded.add(dirPath);
        saveState();
        const node = state.nodes.get(dirPath);
        if (!node || !node.isLoaded) {
          loadDirectory(dirPath);
        } else {
          renderTree();
        }
      };

      const collapseAll = (): void => {
        state.expanded.clear();
        renderTree();
        saveState();
      };

      const refresh = (): void => {
        state.nodes.clear();
        state.rootChildren = [];
        state.expanded.clear();
        clearSelection();
        loadRoot();
      };

      const handleRefresh = (): void => refresh();
      const handleCollapse = (): void => collapseAll();
      const handleViewToggle = (): void => {
        if (!state.preview.isMarkdown) {
          return;
        }
        state.preview.viewMode = state.preview.viewMode === 'rendered' ? 'source' : 'rendered';
        updatePreview();
      };
      const handleExpandToggle = (): void => {
        if (!markdownViewer) {
          return;
        }
        markdownViewer.cycleExpandLevel();
        updateExpandToggleLabel();
      };
      const handleBack = (): void => {
        showTreeOnMobile();
      };

      refreshButton.addEventListener('click', handleRefresh);
      collapseButton.addEventListener('click', handleCollapse);
      viewToggleButton.addEventListener('click', handleViewToggle);
      expandToggleButton.addEventListener('click', handleExpandToggle);
      backButton.addEventListener('click', handleBack);

      renderRootLabel();
      updateStatus();
      updatePreview();
      loadRoot();

      return {
        unmount() {
          refreshButton.removeEventListener('click', handleRefresh);
          collapseButton.removeEventListener('click', handleCollapse);
          viewToggleButton.removeEventListener('click', handleViewToggle);
          expandToggleButton.removeEventListener('click', handleExpandToggle);
          backButton.removeEventListener('click', handleBack);
          markdownViewer?.destroy();
          markdownViewer = null;
          chromeController?.destroy();
          chromeController = null;
          host.setContext(contextKey, null);
          container.innerHTML = '';
        },
      };
    },
  }));
}
