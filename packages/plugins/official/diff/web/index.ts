import type { PanelEventEnvelope } from '@assistant/shared';

import type { PanelHost } from '../../../../web-client/src/controllers/panelRegistry';
import { apiFetch } from '../../../../web-client/src/utils/api';
import { PanelChromeController } from '../../../../web-client/src/controllers/panelChromeController';
import {
  CORE_PANEL_SERVICES_CONTEXT_KEY,
  type PanelCoreServices,
} from '../../../../web-client/src/utils/panelServices';
import { getPanelContextKey } from '../../../../web-client/src/utils/panelContext';
import {
  renderHunkLines,
  type DiffStyle,
  type RenderOptions,
  type DiffFile as RendererDiffFile,
  type DiffHunk as RendererDiffHunk,
} from './diffRenderer';

const DIFF_PANEL_TEMPLATE = `
  <aside class="diff-panel" aria-label="Diff panel">
    <div class="panel-header panel-chrome-row diff-panel-header" data-role="chrome-row">
      <div class="panel-header-main">
        <span class="panel-header-label" data-role="chrome-title">Diff</span>
        <div class="panel-chrome-instance" data-role="instance-actions">
          <div class="panel-chrome-instance-dropdown" data-role="instance-dropdown-container">
            <button
              type="button"
              class="panel-chrome-instance-trigger"
              data-role="instance-trigger"
              aria-label="Select instance"
              aria-haspopup="listbox"
              aria-expanded="false"
            >
              <span class="panel-chrome-instance-trigger-text" data-role="instance-trigger-text"
                >Default</span
              >
              <svg
                class="panel-chrome-instance-trigger-icon"
                viewBox="0 0 24 24"
                width="12"
                height="12"
                aria-hidden="true"
              >
                <path
                  d="M6 9l6 6 6-6"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
            <div
              class="panel-chrome-instance-menu"
              data-role="instance-menu"
              role="listbox"
              aria-label="Instances"
            >
              <input
                type="text"
                class="panel-chrome-instance-search"
                data-role="instance-search"
                placeholder="Search instances..."
                aria-label="Search instances"
                autocomplete="off"
              />
              <div class="panel-chrome-instance-list" data-role="instance-list"></div>
            </div>
          </div>
        </div>
      </div>
      <div class="panel-chrome-plugin-controls diff-panel-plugin-controls" data-role="chrome-plugin-controls">
        <div class="diff-panel-controls">
          <span class="diff-panel-label">Repo</span>
          <span class="diff-panel-repo-value" data-role="diff-repo-label">Auto</span>
          <span class="diff-panel-label">Branch</span>
          <span class="diff-panel-branch-value" data-role="diff-repo-branch">—</span>
          <button
            type="button"
            class="diff-panel-button diff-panel-secondary"
            data-role="diff-repo-change"
          >
            Change
          </button>
          <label class="diff-panel-label" for="diff-target-select">Target</label>
          <select id="diff-target-select" class="diff-panel-select" data-role="diff-target">
            <option value="working">Working</option>
            <option value="staged">Staged</option>
          </select>
          <label class="diff-panel-label" for="diff-style-select">View</label>
          <select id="diff-style-select" class="diff-panel-select" data-role="diff-style">
            <option value="split">Split</option>
            <option value="unified">Unified</option>
          </select>
          <label class="diff-panel-toggle">
            <input type="checkbox" class="diff-panel-toggle-input" data-role="diff-word-diff" checked />
            Word diff
          </label>
        </div>
        <div class="diff-panel-actions">
          <button type="button" class="diff-panel-button" data-role="diff-refresh">Refresh</button>
          <label class="diff-panel-toggle">
            <input type="checkbox" class="diff-panel-toggle-input" data-role="diff-auto" />
            Auto
          </label>
          <button type="button" class="diff-panel-button diff-panel-secondary" data-role="diff-collapse">
            Collapse
          </button>
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
    <div class="diff-panel-status" data-role="diff-status"></div>
    <div class="diff-panel-body">
      <section class="diff-panel-sidebar" data-role="diff-sidebar">
        <div class="diff-sidebar-search">
          <input
            type="text"
            class="diff-panel-input"
            data-role="diff-search"
            placeholder="Filter files"
            autocomplete="off"
          />
        </div>
        <div class="diff-file-list" data-role="diff-file-list"></div>
        <div class="diff-view-tabs" data-role="diff-tabs">
          <button type="button" class="diff-view-tab" data-view="all">All</button>
          <button type="button" class="diff-view-tab" data-view="tracked">Tracked</button>
          <button type="button" class="diff-view-tab" data-view="untracked">Untracked</button>
        </div>
      </section>
      <section class="diff-panel-main">
        <div class="diff-panel-content" data-role="diff-content"></div>
      </section>
    </div>
    <div class="diff-panel-repo-picker hidden" data-role="diff-repo-picker" aria-hidden="true">
      <div class="diff-panel-repo-picker-backdrop" data-role="diff-repo-picker-close"></div>
      <div
        class="diff-panel-repo-picker-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="diff-repo-picker-title"
      >
        <div class="diff-panel-repo-picker-header">
          <div class="diff-panel-repo-picker-title" id="diff-repo-picker-title">Select repo</div>
          <div class="diff-panel-repo-picker-actions">
            <button
              type="button"
              class="diff-panel-button diff-panel-secondary"
              data-role="diff-repo-picker-refresh"
            >
              Refresh
            </button>
            <button
              type="button"
              class="diff-panel-button diff-panel-secondary"
              data-role="diff-repo-picker-close"
            >
              Close
            </button>
          </div>
        </div>
        <div class="diff-panel-repo-picker-breadcrumbs" data-role="diff-repo-picker-crumbs"></div>
        <div class="diff-panel-repo-picker-list" data-role="diff-repo-picker-list"></div>
        <div class="diff-panel-repo-picker-footer" data-role="diff-repo-picker-footer"></div>
      </div>
    </div>
  </aside>
`;

const AUTO_REFRESH_PING_MS = 5000;
const AUTO_REFRESH_INTERVAL_MS = 2000;
const REPO_SCAN_MAX_DEPTH = 5;
const REPO_SCAN_MAX_REPOS = 50;

const registry = window.ASSISTANT_PANEL_REGISTRY;

type DiffTarget = 'working' | 'staged';

type DiffEntry = {
  path: string;
  status: string;
  renameFrom?: string;
};

type DiffStatusKind =
  | 'untracked'
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'other';

type DiffStatusResponse = {
  repoRoot: string;
  repoRootAbsolute?: string;
  branch: string;
  target: DiffTarget;
  entries: DiffEntry[];
  truncated: boolean;
};

type DiffPatchResponse = {
  repoRoot: string;
  repoRootAbsolute?: string;
  target: DiffTarget;
  path: string;
  patch: string;
  truncated: boolean;
};

type WorkspaceRepoEntry = {
  path: string;
  name: string;
  branch: string;
};

type WorkspaceRepoResponse = {
  root: string;
  rootName: string;
  maxDepth: number;
  maxRepos: number;
  repos: WorkspaceRepoEntry[];
  truncated: boolean;
};

type RepoTreeNode = {
  name: string;
  path: string;
  isRepo: boolean;
  children: RepoTreeNode[];
};

type DiffHunkHeaderInfo = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
};

type DiffHunkLine = {
  type: 'add' | 'del' | 'context' | 'meta';
  prefix?: string;
  text: string;
  oldNumber?: number | null;
  newNumber?: number | null;
};

type DiffHunk = {
  header: string;
  headerInfo: DiffHunkHeaderInfo | null;
  rawLines: string[];
  lines: DiffHunkLine[];
};

type DiffFile = {
  id: string;
  path: string;
  pathA?: string;
  pathB?: string;
  displayPath?: string;
  renameFrom?: string | null;
  renameTo?: string | null;
  headerLines: string[];
  hunks: DiffHunk[];
  binary: boolean;
};

type DiffPatch = {
  files: DiffFile[];
};

type DiffHunkDescriptor = {
  path: string;
  hunkIndex: number;
  listIndex: number;
  hunkHash: string;
  header?: string;
  oldStart?: number;
  oldLines?: number;
  newStart?: number;
  newLines?: number;
};

type DiffHunkSelection = DiffHunkDescriptor & {
  target: DiffTarget;
  repoPath?: string | null;
};

type DiffComment = {
  id: string;
  path: string;
  target: string;
  hunkHash: string;
  header?: string;
  body: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
};

type OperationResponse<T> = { ok: true; result: T } | { error: string };

type Instance = {
  id: string;
  label: string;
};

type PanelUpdatePayload = {
  type?: string;
  action?: string;
  instance_id?: string;
  target?: string;
  repoPath?: string;
  repoRoot?: string;
  repoRootAbsolute?: string;
  branch?: string;
  entries?: DiffEntry[];
  truncated?: boolean;
  comment?: DiffComment;
  id?: string;
  message?: string;
  path?: string;
  hunkHash?: string;
};

const DEFAULT_INSTANCE_ID = 'default';

type PanelCore = {
  setStatus: (text: string) => void;
};

const diffDebugEnabled = (() => {
  try {
    const stored = window.localStorage?.getItem('diff.debug');
    return stored === '1' || stored === 'true';
  } catch {
    return false;
  }
})();

const diffDebugLog = (...args: unknown[]) => {
  if (diffDebugEnabled) {
    console.log('[diff]', ...args);
  }
};

const diffDebugWarn = (...args: unknown[]) => {
  if (diffDebugEnabled) {
    console.warn('[diff]', ...args);
  }
};

const summarizeArgs = (args: Record<string, unknown>) => {
  const summary: Record<string, unknown> = {};
  Object.entries(args).forEach(([key, value]) => {
    if (typeof value === 'string') {
      if (key === 'patch') {
        summary[key] = `[${value.length} chars]`;
        return;
      }
      if (value.length > 200) {
        summary[key] = `${value.slice(0, 200)}… (${value.length} chars)`;
        return;
      }
    }
    summary[key] = value;
  });
  return summary;
};

function resolveServices(host: PanelHost): PanelCore {
  const raw = host.getContext(CORE_PANEL_SERVICES_CONTEXT_KEY);
  if (raw && typeof raw === 'object' && (raw as PanelCoreServices).setStatus) {
    return raw as PanelCore;
  }
  return {
    setStatus: () => undefined,
  };
}

function classifyStatus(entry: DiffEntry): { tracked: boolean; kind: DiffStatusKind } {
  const status = (entry.status || '').trim();
  if (status === '??') {
    return { tracked: false, kind: 'untracked' };
  }
  if (status.startsWith('M')) return { tracked: true, kind: 'modified' };
  if (status.startsWith('A')) return { tracked: true, kind: 'added' };
  if (status.startsWith('D')) return { tracked: true, kind: 'deleted' };
  if (status.startsWith('R')) return { tracked: true, kind: 'renamed' };
  if (status.startsWith('C')) return { tracked: true, kind: 'copied' };
  return { tracked: true, kind: 'other' };
}

function getStatusBadge(
  entry?: DiffEntry | null,
): { text: string; kind: DiffStatusKind; label: string } | null {
  if (!entry) {
    return null;
  }
  const status = (entry.status || '').trim();
  if (status === '??') {
    return { text: 'U', kind: 'untracked', label: 'Untracked' };
  }
  if (status.startsWith('M')) return { text: 'M', kind: 'modified', label: 'Modified' };
  if (status.startsWith('A')) return { text: 'A', kind: 'added', label: 'Added' };
  if (status.startsWith('D')) return { text: 'D', kind: 'deleted', label: 'Deleted' };
  if (status.startsWith('R')) return { text: 'R', kind: 'renamed', label: 'Renamed' };
  if (status.startsWith('C')) return { text: 'C', kind: 'copied', label: 'Copied' };
  return { text: '?', kind: 'other', label: status || 'Changed' };
}

function parseTarget(value: unknown): DiffTarget {
  if (value === 'staged') {
    return 'staged';
  }
  return 'working';
}

function formatInstanceLabel(id: string): string {
  return id
    .split(/[-_\s]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function parseInstance(value: unknown): Instance | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const id = raw['id'];
  if (typeof id !== 'string') {
    return null;
  }
  const label =
    typeof raw['label'] === 'string' && raw['label'].trim().length > 0
      ? raw['label']
      : formatInstanceLabel(id);
  return { id, label };
}

async function callOperation<T>(operation: string, body: Record<string, unknown>): Promise<T> {
  diffDebugLog('callOperation', operation, summarizeArgs(body));
  const response = await apiFetch(`/api/plugins/diff/operations/${operation}`, {
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
    diffDebugWarn('callOperation failed', operation, {
      status: response.status,
      payload,
    });
    const message =
      payload && 'error' in payload && payload.error
        ? payload.error
        : `Request failed (${response.status})`;
    throw new Error(message);
  }

  return payload.result;
}

function buildRepoTree(repos: WorkspaceRepoEntry[], rootName: string): RepoTreeNode {
  const root: RepoTreeNode = {
    name: rootName || 'Workspace',
    path: '',
    isRepo: false,
    children: [],
  };
  const nodeMap = new Map<string, RepoTreeNode>([['', root]]);

  repos.forEach((repo) => {
    const segments = repo.path.split('/').filter((segment) => segment.length > 0);
    if (segments.length === 0) {
      root.isRepo = true;
      return;
    }
    let currentPath = '';
    let currentNode = root;
    segments.forEach((segment) => {
      const nextPath = currentPath ? `${currentPath}/${segment}` : segment;
      let child = nodeMap.get(nextPath);
      if (!child) {
        child = { name: segment, path: nextPath, isRepo: false, children: [] };
        nodeMap.set(nextPath, child);
        currentNode.children.push(child);
      }
      currentNode = child;
      currentPath = nextPath;
    });
    currentNode.isRepo = true;
  });

  const sortTree = (node: RepoTreeNode) => {
    node.children.sort((a, b) => a.name.localeCompare(b.name));
    node.children.forEach(sortTree);
  };
  sortTree(root);

  return root;
}

function findRepoNode(root: RepoTreeNode, pathValue: string): RepoTreeNode | null {
  if (!pathValue) {
    return root;
  }
  const segments = pathValue.split('/').filter((segment) => segment.length > 0);
  let current: RepoTreeNode | undefined = root;
  for (const segment of segments) {
    current = current.children.find((child) => child.name === segment);
    if (!current) {
      return null;
    }
  }
  return current;
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return ('0000000' + hash.toString(16)).slice(-8);
}

function buildHunkSignature(
  filePath: string,
  hunk: DiffHunk | { rawLines?: string[]; header?: string },
): string {
  let parts: string[] = [];
  if (filePath) {
    parts.push(filePath);
  }
  if (hunk && Array.isArray(hunk.rawLines)) {
    parts = parts.concat(hunk.rawLines);
  } else if (hunk && typeof hunk.header === 'string') {
    parts.push(hunk.header);
  }
  return parts.join('\n');
}

function buildHunkHash(
  filePath: string,
  hunk: DiffHunk | { rawLines?: string[]; header?: string },
): string {
  return hashString(buildHunkSignature(filePath || '', hunk || {}));
}

function parseHunkHeader(line: string): DiffHunkHeaderInfo | null {
  const match = /@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
  if (!match) {
    return null;
  }
  return {
    oldStart: Number(match[1]),
    oldLines: Number(match[2] || '1'),
    newStart: Number(match[3]),
    newLines: Number(match[4] || '1'),
  };
}

function parseUnifiedPatch(patchText: string): DiffPatch {
  const lines = patchText.split('\n');
  const files: DiffFile[] = [];
  let currentFile: DiffFile | null = null;
  let current: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  function finalizeFile(): void {
    if (!currentFile) {
      return;
    }
    if (currentFile.renameFrom && currentFile.renameTo) {
      currentFile.displayPath = `${currentFile.renameFrom} → ${currentFile.renameTo}`;
    } else if (currentFile.path) {
      currentFile.displayPath = currentFile.path;
    } else {
      currentFile.displayPath = '(unknown file)';
    }
    files.push(currentFile);
    currentFile = null;
    current = null;
  }

  function startFile(line: string): void {
    finalizeFile();
    const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
    const pathA = match?.[1] ?? '';
    const pathB = match?.[2] ?? '';
    const resolvedPath = pathB && pathB !== '/dev/null' ? pathB : pathA;
    currentFile = {
      id: `file-${files.length}`,
      path: resolvedPath,
      pathA,
      pathB,
      displayPath: resolvedPath,
      renameFrom: null,
      renameTo: null,
      headerLines: [line],
      hunks: [],
      binary: false,
    };
    current = null;
  }

  lines.forEach((line) => {
    if (line.indexOf('diff --git ') === 0) {
      startFile(line);
      return;
    }

    if (!currentFile) {
      return;
    }

    if (
      !current &&
      (line.indexOf('Binary files ') === 0 || line.indexOf('GIT binary patch') === 0)
    ) {
      currentFile.binary = true;
      currentFile.headerLines.push(line);
      return;
    }

    if (line.indexOf('rename from ') === 0) {
      currentFile.renameFrom = line.replace('rename from ', '').trim();
    }
    if (line.indexOf('rename to ') === 0) {
      currentFile.renameTo = line.replace('rename to ', '').trim();
    }
    if (line.indexOf('--- ') === 0) {
      const rawPath = line.replace('--- ', '').trim();
      if (rawPath.indexOf('a/') === 0) {
        currentFile.pathA = rawPath.slice(2);
      }
    }
    if (line.indexOf('+++ ') === 0) {
      const rawPathNew = line.replace('+++ ', '').trim();
      if (rawPathNew.indexOf('b/') === 0) {
        currentFile.pathB = rawPathNew.slice(2);
      }
    }
    if (currentFile.pathB && currentFile.pathB !== '/dev/null') {
      currentFile.path = currentFile.pathB;
    } else if (currentFile.pathA) {
      currentFile.path = currentFile.pathA;
    }

    if (line.indexOf('@@') === 0) {
      const headerInfo = parseHunkHeader(line);
      current = {
        header: line,
        headerInfo,
        rawLines: [line],
        lines: [],
      };
      currentFile.hunks.push(current);
      if (headerInfo) {
        oldLine = headerInfo.oldStart;
        newLine = headerInfo.newStart;
      }
      return;
    }

    if (!current) {
      currentFile.headerLines.push(line);
      return;
    }

    current.rawLines.push(line);

    if (line.indexOf('\\ No newline at end of file') === 0) {
      current.lines.push({
        type: 'meta',
        text: line,
      });
      return;
    }

    const prefix = line.charAt(0);
    const text = line.slice(1);
    if (prefix === '+') {
      current.lines.push({
        type: 'add',
        prefix: '+',
        text,
        oldNumber: null,
        newNumber: newLine,
      });
      newLine += 1;
      return;
    }
    if (prefix === '-') {
      current.lines.push({
        type: 'del',
        prefix: '-',
        text,
        oldNumber: oldLine,
        newNumber: null,
      });
      oldLine += 1;
      return;
    }
    current.lines.push({
      type: 'context',
      prefix: prefix === ' ' ? ' ' : '',
      text: prefix === ' ' ? text : line,
      oldNumber: oldLine,
      newNumber: newLine,
    });
    oldLine += 1;
    newLine += 1;
  });

  finalizeFile();

  return { files };
}

function buildHunkDescriptor(
  filePath: string,
  hunk: DiffHunk,
  hunkIndex: number,
  listIndex: number,
): DiffHunkDescriptor {
  const header = hunk && typeof hunk.header === 'string' ? hunk.header : '';
  const headerInfo = parseHunkHeader(header);
  const descriptor: DiffHunkDescriptor = {
    path: filePath,
    hunkIndex,
    listIndex,
    hunkHash: buildHunkHash(filePath || '', hunk || {}),
    header,
  };
  if (headerInfo) {
    descriptor.oldStart = headerInfo.oldStart;
    descriptor.oldLines = headerInfo.oldLines;
    descriptor.newStart = headerInfo.newStart;
    descriptor.newLines = headerInfo.newLines;
  }
  return descriptor;
}

function normalizeComment(value: unknown): DiffComment | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as Record<string, unknown>;
  const id = typeof record['id'] === 'string' ? record['id'] : '';
  const path = typeof record['path'] === 'string' ? record['path'] : '';
  const target = typeof record['target'] === 'string' ? record['target'] : 'working';
  const hunkHash = typeof record['hunkHash'] === 'string' ? record['hunkHash'] : '';
  const body = typeof record['body'] === 'string' ? record['body'] : '';
  if (!id || !path || !hunkHash) {
    return null;
  }
  return {
    id,
    path,
    target,
    hunkHash,
    body,
    status: typeof record['status'] === 'string' ? record['status'] : 'open',
    header: typeof record['header'] === 'string' ? record['header'] : undefined,
    createdAt: typeof record['createdAt'] === 'string' ? record['createdAt'] : undefined,
    updatedAt: typeof record['updatedAt'] === 'string' ? record['updatedAt'] : undefined,
  };
}

function buildStatusBadge(entry?: DiffEntry | null): HTMLSpanElement {
  const badge = document.createElement('span');
  badge.className = 'diff-status-badge';
  const info = getStatusBadge(entry);
  if (!info) {
    badge.classList.add('empty');
    return badge;
  }
  badge.textContent = info.text;
  badge.dataset['kind'] = info.kind;
  badge.title = info.label;
  return badge;
}

if (registry && typeof registry.registerPanel === 'function') {
  registry.registerPanel('diff', () => ({
    mount(container: HTMLElement, host: PanelHost) {
      container.innerHTML = DIFF_PANEL_TEMPLATE;

      const services = resolveServices(host);
      const contextKey = getPanelContextKey(host.panelId());

      const repoLabel = container.querySelector<HTMLElement>('[data-role="diff-repo-label"]');
      const repoBranchLabel = container.querySelector<HTMLElement>(
        '[data-role="diff-repo-branch"]',
      );
      const repoChangeButton = container.querySelector<HTMLButtonElement>(
        '[data-role="diff-repo-change"]',
      );
      const targetSelect = container.querySelector<HTMLSelectElement>('[data-role="diff-target"]');
      const refreshButton = container.querySelector<HTMLButtonElement>(
        '[data-role="diff-refresh"]',
      );
      const autoToggle = container.querySelector<HTMLInputElement>('[data-role="diff-auto"]');
      const collapseButton = container.querySelector<HTMLButtonElement>(
        '[data-role="diff-collapse"]',
      );
      const statusEl = container.querySelector<HTMLDivElement>('[data-role="diff-status"]');
      const searchInput = container.querySelector<HTMLInputElement>('[data-role="diff-search"]');
      const fileListEl = container.querySelector<HTMLDivElement>('[data-role="diff-file-list"]');
      const sidebarEl = container.querySelector<HTMLElement>('[data-role="diff-sidebar"]');
      const tabsEl = container.querySelector<HTMLDivElement>('[data-role="diff-tabs"]');
      const diffContent = container.querySelector<HTMLDivElement>('[data-role="diff-content"]');

      const repoPicker = container.querySelector<HTMLDivElement>('[data-role="diff-repo-picker"]');
      const repoPickerList = container.querySelector<HTMLDivElement>(
        '[data-role="diff-repo-picker-list"]',
      );
      const repoPickerCrumbs = container.querySelector<HTMLDivElement>(
        '[data-role="diff-repo-picker-crumbs"]',
      );
      const repoPickerFooter = container.querySelector<HTMLDivElement>(
        '[data-role="diff-repo-picker-footer"]',
      );
      const repoPickerRefresh = container.querySelector<HTMLButtonElement>(
        '[data-role="diff-repo-picker-refresh"]',
      );
      const repoPickerCloseButtons = Array.from(
        container.querySelectorAll<HTMLElement>('[data-role="diff-repo-picker-close"]'),
      );

      const diffStyleSelect = container.querySelector<HTMLSelectElement>(
        '[data-role="diff-style"]',
      );
      const wordDiffToggle = container.querySelector<HTMLInputElement>(
        '[data-role="diff-word-diff"]',
      );

      if (
        !repoLabel ||
        !repoBranchLabel ||
        !repoChangeButton ||
        !targetSelect ||
        !refreshButton ||
        !autoToggle ||
        !collapseButton
      ) {
        throw new Error('Diff panel elements missing.');
      }
      if (
        !statusEl ||
        !searchInput ||
        !fileListEl ||
        !sidebarEl ||
        !tabsEl ||
        !diffContent ||
        !repoPicker ||
        !repoPickerList ||
        !repoPickerCrumbs ||
        !repoPickerFooter ||
        !repoPickerRefresh
      ) {
        throw new Error('Diff panel elements missing.');
      }

      let instances: Instance[] = [{ id: DEFAULT_INSTANCE_ID, label: 'Default' }];
      let selectedInstanceId = DEFAULT_INSTANCE_ID;
      let chromeController: PanelChromeController | null = null;
      let repoPath: string | null = null;
      let repoRoot: string | null = null;
      let repoRootAbsolute: string | null = null;
      let repoBranch: string | null = null;
      let repoTree: RepoTreeNode | null = null;
      let repoIndex: WorkspaceRepoResponse | null = null;
      let repoPickerPath = '';
      let repoPickerError: string | null = null;
      let target: DiffTarget = 'working';
      let entries: DiffEntry[] = [];
      const statusByPath = new Map<string, DiffEntry>();
      let autoRefreshEnabled = false;
      let autoRefreshTimer: ReturnType<typeof setInterval> | null = null;
      let selectedPath: string | null = null;
      let selectedRepoPath: string | null = null;
      let selectedRepoFilePath: string | null = null;
      let selectedHunk: DiffHunkSelection | null = null;
      let patchData: DiffPatch | null = null;
      let detachedRepo = false;
      let collapsedSidebar = false;
      const collapsedHunks = new Set<string>();
      const hunkElements = new Map<string, HTMLDivElement>();
      let hunkList: DiffHunkDescriptor[] = [];
      let selectedHunkElement: HTMLDivElement | null = null;
      let comments: DiffComment[] = [];
      let pendingHunkHash: string | null = null;
      let viewMode: 'all' | 'tracked' | 'untracked' = 'all';
      let initialRepoPath: string | null = null;
      let initialNavigatorPath: string | null = null;

      const storedState = host.loadPanelState();
      if (storedState && typeof storedState === 'object') {
        const data = storedState as Record<string, unknown>;
        if (typeof data['instanceId'] === 'string') {
          selectedInstanceId = data['instanceId'];
        }
        if (typeof data['repoPath'] === 'string') {
          initialRepoPath = data['repoPath'];
        }
        if (typeof data['navigatorPath'] === 'string') {
          initialNavigatorPath = data['navigatorPath'];
        }
      }

      // New diff rendering options
      const MOBILE_BREAKPOINT = 800;
      const isMobile = () => window.innerWidth <= MOBILE_BREAKPOINT;

      // Force unified on mobile
      const getEffectiveDiffStyle = (): DiffStyle => {
        if (isMobile()) return 'unified';
        return (diffStyleSelect?.value as DiffStyle) || 'split';
      };

      let diffStyle: DiffStyle = getEffectiveDiffStyle();
      let showWordDiff: boolean = wordDiffToggle?.checked ?? true;

      const getRenderOptions = (): RenderOptions => ({
        diffStyle,
        showWordDiff,
      });

      // Update diff style on resize (force unified on mobile)
      window.addEventListener('resize', () => {
        const newStyle = getEffectiveDiffStyle();
        if (newStyle !== diffStyle) {
          diffStyle = newStyle;
          if (diffStyleSelect) {
            diffStyleSelect.value = diffStyle;
          }
          renderPatch();
        }
      });

      const renderTabs = () => {
        const buttons = Array.from(tabsEl.querySelectorAll<HTMLButtonElement>('.diff-view-tab'));
        buttons.forEach((button) => {
          const nextMode = button.dataset['view'] as typeof viewMode | undefined;
          const isActive = nextMode === viewMode;
          button.classList.toggle('active', isActive);
          button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });
      };

      const setViewMode = (mode: typeof viewMode) => {
        viewMode = mode;
        renderTabs();
        renderFileList();
        if (!selectedPath) {
          loadSelectionContent();
        }
      };

      tabsEl.addEventListener('click', (event) => {
        const target = event.target as HTMLElement | null;
        const button = target?.closest<HTMLButtonElement>('.diff-view-tab');
        const mode = button?.dataset['view'] as typeof viewMode | undefined;
        if (mode && mode !== viewMode) {
          setViewMode(mode);
        }
      });

      renderTabs();

      const setStatus = (message: string, level: 'error' | 'info' | null = null) => {
        statusEl.textContent = message;
        statusEl.className = 'diff-panel-status';
        if (level === 'error') {
          statusEl.classList.add('error');
        }
      };

      const getInstanceLabel = (instanceId: string): string => {
        const match = instances.find((instance) => instance.id === instanceId);
        return match?.label ?? formatInstanceLabel(instanceId);
      };

      const updatePanelMetadata = () => {
        if (selectedInstanceId === DEFAULT_INSTANCE_ID) {
          host.setPanelMetadata({ title: 'Diff' });
          return;
        }
        host.setPanelMetadata({ title: `Diff (${getInstanceLabel(selectedInstanceId)})` });
      };

      const renderInstanceSelect = () => {
        chromeController?.setInstances(instances, selectedInstanceId);
      };

      chromeController = new PanelChromeController({
        root: container,
        host,
        title: 'Diff',
        onInstanceChange: (instanceId) => {
          setActiveInstance(instanceId);
        },
      });
      renderInstanceSelect();
      updatePanelMetadata();

      const isDetachedMessage = (message: string) =>
        message.toLowerCase().includes('detached head');

      const setDetachedState = (message: string) => {
        detachedRepo = true;
        entries = [];
        statusByPath.clear();
        selectedPath = null;
        selectedRepoPath = null;
        selectedRepoFilePath = null;
        patchData = null;
        comments = [];
        repoRootAbsolute = null;
        repoBranch = null;
        clearSelection(true);
        collapsedHunks.clear();
        setStatus(message, 'error');
        updateRepoHeader();
        renderFileList();
        renderPatch();
      };

      const clearDetachedState = () => {
        if (!detachedRepo) {
          return;
        }
        detachedRepo = false;
      };

      const registerRowActivation = (row: HTMLElement, handler: () => void) => {
        let handledPointer = false;
        row.addEventListener('pointerdown', (event) => {
          if (!(event instanceof PointerEvent) || event.button !== 0) {
            return;
          }
          handledPointer = true;
          handler();
        });
        row.addEventListener('click', (event) => {
          if (handledPointer && event.detail !== 0) {
            handledPointer = false;
            return;
          }
          handledPointer = false;
          handler();
        });
      };

      const updatePanelContext = () => {
        const attributes: Record<string, string> = {};
        const repoLabel = selectedRepoPath ?? repoRoot ?? repoPath;
        attributes['instance-id'] = selectedInstanceId;
        if (repoRootAbsolute) {
          const absolutePath = joinAbsolutePath(repoRootAbsolute, selectedRepoFilePath);
          attributes['diff-path-absolute'] = absolutePath;
        }
        if (repoLabel !== null && repoLabel !== undefined) {
          attributes['diff-repo'] = repoLabel || 'Workspace';
        }
        attributes['diff-target'] = target;
        if (selectedPath) {
          attributes['diff-path'] = selectedPath;
        }
        if (selectedHunk) {
          attributes['diff-hunk-hash'] = selectedHunk.hunkHash;
          attributes['diff-hunk-index'] = String(selectedHunk.hunkIndex);
          if (selectedHunk.header) {
            attributes['diff-hunk-header'] = selectedHunk.header;
          }
        }
        host.setContext(contextKey, {
          type: 'diff',
          id: repoLabel ?? 'workspace',
          name: repoLabel || 'Workspace',
          instance_id: selectedInstanceId,
          contextAttributes: attributes,
        });
      };

      const sendPanelEvent = (payload: Record<string, unknown>) => {
        host.sendEvent(payload);
      };

      const callInstanceOperation = async <T>(
        operation: string,
        body: Record<string, unknown>,
      ): Promise<T> =>
        callOperation(operation, {
          ...body,
          instance_id: selectedInstanceId,
        });

      const clearSelection = (emit: boolean) => {
        selectedHunk = null;
        if (selectedHunkElement) {
          selectedHunkElement.classList.remove('selected');
          selectedHunkElement = null;
        }
        if (emit) {
          sendPanelEvent({ type: 'diff_hunk_cleared' });
        }
        updatePanelContext();
      };

      const sendHunkSnapshot = () => {
        const repoPathForOps = resolveRepoPathForOps();
        sendPanelEvent({
          type: 'diff_hunks_snapshot',
          target,
          repoPath: repoPathForOps ?? undefined,
          path: selectedRepoFilePath ?? undefined,
          hunks: hunkList,
        });
      };

      const normalizeRepoRoot = (value: string | null): string | null => {
        if (value === null || value === undefined) {
          return null;
        }
        const trimmed = value.trim();
        if (!trimmed || trimmed === '.' || trimmed === '/') {
          return '';
        }
        return trimmed.replace(/\/+$/, '');
      };

      const toWorkspacePath = (repoRootValue: string | null, entryPath: string): string => {
        const root = normalizeRepoRoot(repoRootValue);
        if (!root) {
          return entryPath;
        }
        return `${root}/${entryPath}`.replace(/\/+/g, '/');
      };

      const toRepoRelativePath = (
        repoRootValue: string | null,
        workspacePath: string,
      ): string | null => {
        const root = normalizeRepoRoot(repoRootValue);
        if (!root) {
          return workspacePath;
        }
        if (workspacePath === root) {
          return '';
        }
        const prefix = `${root}/`;
        if (!workspacePath.startsWith(prefix)) {
          return null;
        }
        return workspacePath.slice(prefix.length);
      };

      const joinAbsolutePath = (root: string, relativePath?: string | null): string => {
        if (!relativePath) {
          return root;
        }
        const separator = root.includes('\\') ? '\\' : '/';
        const normalizedRoot = root.endsWith(separator) ? root.slice(0, -1) : root;
        const normalizedRelative = relativePath
          .replace(/[\\/]+/g, separator)
          .replace(/^[/\\]+/, '');
        return `${normalizedRoot}${separator}${normalizedRelative}`;
      };

      const resolveRepoPathForOps = (): string | null => {
        return normalizeRepoRoot(selectedRepoPath ?? repoPath ?? repoRoot ?? null);
      };

      const persistPanelState = () => {
        host.persistPanelState({
          instanceId: selectedInstanceId,
          repoPath,
          navigatorPath: repoPickerPath,
        });
      };

      const setRepoPickerPath = (nextPath: string) => {
        repoPickerPath = nextPath;
        persistPanelState();
      };

      const loadRepoIndex = async (force: boolean) => {
        if (repoIndex && !force) {
          return;
        }
        repoPickerError = null;
        repoPickerFooter.textContent = 'Loading repositories...';
        repoPickerList.innerHTML = '';
        try {
          const result = await callInstanceOperation<WorkspaceRepoResponse>('workspace-repos', {
            maxDepth: REPO_SCAN_MAX_DEPTH,
            maxRepos: REPO_SCAN_MAX_REPOS,
          });
          repoIndex = result;
          repoTree = buildRepoTree(result.repos, result.rootName);
          if (repoPickerPath && repoTree && !findRepoNode(repoTree, repoPickerPath)) {
            repoPickerPath = '';
            persistPanelState();
          }
        } catch (err) {
          repoPickerError = err instanceof Error ? err.message : 'Failed to load repositories.';
          repoIndex = null;
          repoTree = null;
        }
      };

      const renderRepoPicker = () => {
        repoPickerList.innerHTML = '';
        repoPickerCrumbs.innerHTML = '';
        repoPickerFooter.textContent = '';

        if (repoPickerError) {
          const error = document.createElement('div');
          error.className = 'diff-panel-empty';
          error.textContent = repoPickerError;
          repoPickerList.appendChild(error);
          return;
        }

        if (!repoTree || !repoIndex) {
          repoPickerFooter.textContent = 'Loading repositories...';
          return;
        }

        const branchByPath = new Map<string, string>();
        repoIndex.repos.forEach((repo) => {
          if (repo.path !== undefined) {
            branchByPath.set(repo.path, repo.branch);
          }
        });

        let node = findRepoNode(repoTree, repoPickerPath);
        if (!node) {
          repoPickerPath = '';
          node = repoTree;
        }

        const rootButton = document.createElement('button');
        rootButton.type = 'button';
        rootButton.className = 'diff-repo-crumb';
        rootButton.textContent = repoIndex.rootName || 'Workspace';
        rootButton.addEventListener('click', () => {
          setRepoPickerPath('');
          renderRepoPicker();
        });
        repoPickerCrumbs.appendChild(rootButton);

        const segments = repoPickerPath.split('/').filter((segment) => segment.length > 0);
        let pathCursor = '';
        segments.forEach((segment) => {
          const separator = document.createElement('span');
          separator.className = 'diff-repo-crumb-sep';
          separator.textContent = '/';
          repoPickerCrumbs.appendChild(separator);

          pathCursor = pathCursor ? `${pathCursor}/${segment}` : segment;
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'diff-repo-crumb';
          button.textContent = segment;
          button.addEventListener('click', () => {
            setRepoPickerPath(pathCursor);
            renderRepoPicker();
          });
          repoPickerCrumbs.appendChild(button);
        });

        const addRepoRow = (
          label: string,
          pathValue: string,
          options: { isRepo?: boolean; branch?: string } = {},
        ) => {
          const row = document.createElement('div');
          row.className = 'diff-repo-row';
          if (normalizeRepoRoot(repoPath) === pathValue) {
            row.classList.add('active');
          }

          const nameButton = document.createElement('button');
          nameButton.type = 'button';
          nameButton.className = 'diff-repo-entry';
          nameButton.textContent = label;
          if (options.isRepo) {
            nameButton.addEventListener('click', () => {
              selectRepoPath(pathValue);
            });
          }
          row.appendChild(nameButton);

          const meta = document.createElement('span');
          meta.className = 'diff-repo-meta';
          meta.textContent = options.isRepo
            ? options.branch
              ? `Repo · ${options.branch}`
              : 'Repo'
            : 'Folder';
          row.appendChild(meta);

          if (options.isRepo) {
            const selectButton = document.createElement('button');
            selectButton.type = 'button';
            selectButton.className = 'diff-repo-action';
            selectButton.textContent = 'Select';
            selectButton.addEventListener('click', () => {
              selectRepoPath(pathValue);
            });
            row.appendChild(selectButton);
          }

          repoPickerList.appendChild(row);
        };

        if (repoPickerPath) {
          const upRow = document.createElement('div');
          upRow.className = 'diff-repo-row';
          const upButton = document.createElement('button');
          upButton.type = 'button';
          upButton.className = 'diff-repo-entry';
          upButton.textContent = '..';
          upButton.addEventListener('click', () => {
            const parts = repoPickerPath.split('/').filter((segment) => segment.length > 0);
            parts.pop();
            setRepoPickerPath(parts.join('/'));
            renderRepoPicker();
          });
          upRow.appendChild(upButton);
          const upMeta = document.createElement('span');
          upMeta.className = 'diff-repo-meta';
          upMeta.textContent = 'Up';
          upRow.appendChild(upMeta);
          repoPickerList.appendChild(upRow);
        }

        if (repoPickerPath === '' && repoTree.isRepo) {
          addRepoRow(repoIndex.rootName || 'Workspace', '', {
            isRepo: true,
            branch: branchByPath.get('') ?? undefined,
          });
        }

        node.children.forEach((child) => {
          const hasChildren = child.children.length > 0;
          const branch = branchByPath.get(child.path);
          const row = document.createElement('div');
          row.className = 'diff-repo-row';
          if (normalizeRepoRoot(repoPath) === child.path) {
            row.classList.add('active');
          }

          const nameButton = document.createElement('button');
          nameButton.type = 'button';
          nameButton.className = 'diff-repo-entry';
          nameButton.textContent = child.name;
          nameButton.addEventListener('click', () => {
            if (child.isRepo && !hasChildren) {
              selectRepoPath(child.path);
              return;
            }
            setRepoPickerPath(child.path);
            renderRepoPicker();
          });
          row.appendChild(nameButton);

          const meta = document.createElement('span');
          meta.className = 'diff-repo-meta';
          meta.textContent = child.isRepo ? (branch ? `Repo · ${branch}` : 'Repo') : 'Folder';
          row.appendChild(meta);

          if (child.isRepo) {
            const selectButton = document.createElement('button');
            selectButton.type = 'button';
            selectButton.className = 'diff-repo-action';
            selectButton.textContent = 'Select';
            selectButton.addEventListener('click', () => {
              selectRepoPath(child.path);
            });
            row.appendChild(selectButton);
          }

          repoPickerList.appendChild(row);
        });

        if (node.children.length === 0 && !node.isRepo) {
          const empty = document.createElement('div');
          empty.className = 'diff-panel-empty';
          empty.textContent = 'No repositories found.';
          repoPickerList.appendChild(empty);
        }

        if (repoIndex.truncated) {
          repoPickerFooter.textContent = `Showing first ${repoIndex.maxRepos} repositories.`;
        } else {
          repoPickerFooter.textContent = `${repoIndex.repos.length} repositories.`;
        }
      };

      const setRepoPickerOpen = (open: boolean) => {
        repoPicker.classList.toggle('hidden', !open);
        repoPicker.setAttribute('aria-hidden', open ? 'false' : 'true');
        if (open) {
          void loadRepoIndex(false).then(() => renderRepoPicker());
        }
      };

      const selectRepoPath = (nextPath: string) => {
        selectedPath = null;
        patchData = null;
        updateSelectionRepoContext(null);
        clearSelection(true);
        collapsedHunks.clear();
        applyRepoPath(nextPath, true);
        renderFileList();
        renderPatch();
        setRepoPickerOpen(false);
      };

      const updateRepoLabel = () => {
        if (!repoLabel) {
          return;
        }
        if (repoPath === null) {
          repoLabel.textContent = repoRoot === null ? 'Auto' : repoRoot || 'Workspace';
          return;
        }
        repoLabel.textContent = repoPath || 'Workspace';
      };

      const updateRepoBranchLabel = () => {
        if (!repoBranchLabel) {
          return;
        }
        if (detachedRepo) {
          repoBranchLabel.textContent = 'Detached';
          return;
        }
        if (!repoBranch) {
          repoBranchLabel.textContent = '—';
          return;
        }
        repoBranchLabel.textContent = repoBranch;
      };

      const updateRepoHeader = () => {
        updateRepoLabel();
        updateRepoBranchLabel();
        chromeController?.scheduleLayoutCheck();
      };

      const refreshStatusMap = () => {
        statusByPath.clear();
        entries.forEach((entry) => {
          const workspacePath = toWorkspacePath(repoRoot, entry.path);
          statusByPath.set(workspacePath, entry);
        });
      };

      const filterByQuery = (
        items: Array<{ path: string; displayPath?: string }>,
      ): Array<{ path: string; displayPath?: string }> => {
        const query = searchInput.value.trim().toLowerCase();
        if (!query) {
          return items;
        }
        return items.filter((item) => {
          const label = item.displayPath || item.path;
          return label.toLowerCase().includes(query);
        });
      };

      const getItemsForView = () => {
        const items = entries.map((entry) => {
          const classification = classifyStatus(entry);
          return {
            path: toWorkspacePath(repoRoot, entry.path),
            displayPath: entry.path,
            tracked: classification.tracked,
            entry,
          };
        });
        if (viewMode === 'tracked') {
          return items.filter((item) => item.tracked);
        }
        if (viewMode === 'untracked') {
          return items.filter((item) => !item.tracked);
        }
        return items;
      };

      const getVisibleItems = () => filterByQuery(getItemsForView());

      const syncSelection = (availablePaths: Set<string>) => {
        if (!selectedPath) {
          return;
        }
        if (!availablePaths.has(selectedPath)) {
          selectedPath = null;
          patchData = null;
          updateSelectionRepoContext(null);
          clearSelection(true);
          collapsedHunks.clear();
          void loadSelectionContent();
        }
      };

      const applyRepoPath = (next: string | null, refresh: boolean) => {
        repoPath = next;
        repoRoot = normalizeRepoRoot(next);
        repoRootAbsolute = null;
        repoBranch = null;
        clearDetachedState();
        diffDebugLog('applyRepoPath', { repoPath, repoRoot, refresh });
        updateRepoHeader();
        persistPanelState();
        if (refresh) {
          void refreshAll();
        }
        if (autoRefreshEnabled) {
          registerAutoRefresh();
        }
      };

      const setActiveInstance = (instanceId: string, options?: { refresh?: boolean }) => {
        if (instanceId === selectedInstanceId) {
          return;
        }
        if (autoRefreshEnabled) {
          unregisterAutoRefresh();
        }
        selectedInstanceId = instanceId;
        repoPath = null;
        repoRoot = null;
        repoRootAbsolute = null;
        repoBranch = null;
        repoTree = null;
        repoIndex = null;
        repoPickerPath = '';
        repoPickerError = null;
        entries = [];
        statusByPath.clear();
        selectedPath = null;
        selectedRepoPath = null;
        selectedRepoFilePath = null;
        selectedHunk = null;
        selectedHunkElement = null;
        patchData = null;
        comments = [];
        pendingHunkHash = null;
        detachedRepo = false;
        collapsedHunks.clear();
        hunkElements.clear();
        setStatus('', null);
        if (!repoPicker.classList.contains('hidden')) {
          repoPicker.classList.add('hidden');
          repoPicker.setAttribute('aria-hidden', 'true');
        }
        updateRepoHeader();
        renderInstanceSelect();
        updatePanelMetadata();
        updatePanelContext();
        renderFileList();
        renderPatch();
        persistPanelState();
        const shouldRefresh = options?.refresh !== false;
        if (shouldRefresh) {
          void refreshAll();
        }
        if (autoRefreshEnabled) {
          registerAutoRefresh();
        }
      };

      const refreshInstances = async (options?: { silent?: boolean }) => {
        try {
          const raw = await callOperation<unknown>('instance_list', {});
          const list = Array.isArray(raw) ? raw.map(parseInstance).filter(Boolean) : [];
          instances =
            list.length > 0
              ? (list as Instance[])
              : [{ id: DEFAULT_INSTANCE_ID, label: 'Default' }];
          renderInstanceSelect();
          updatePanelMetadata();

          if (!instances.some((instance) => instance.id === selectedInstanceId)) {
            setActiveInstance(DEFAULT_INSTANCE_ID, { refresh: false });
          }
        } catch (err) {
          if (!options?.silent) {
            setStatus('Failed to load instances', 'error');
          }
          diffDebugWarn('refreshInstances failed', err);
          instances = [{ id: DEFAULT_INSTANCE_ID, label: 'Default' }];
          renderInstanceSelect();
          updatePanelMetadata();
        }
      };

      if (initialNavigatorPath) {
        repoPickerPath = initialNavigatorPath;
      }
      if (initialRepoPath !== null) {
        applyRepoPath(initialRepoPath, false);
      }

      const updateSelectionRepoContext = (workspacePath: string | null) => {
        if (!workspacePath) {
          selectedRepoPath = null;
          selectedRepoFilePath = null;
          return;
        }
        selectedRepoPath = normalizeRepoRoot(repoRoot ?? repoPath);
        selectedRepoFilePath =
          selectedRepoPath === null ? null : toRepoRelativePath(selectedRepoPath, workspacePath);
        diffDebugLog('updateSelectionRepoContext', {
          workspacePath,
          selectedRepoPath,
          selectedRepoFilePath,
        });
        if (selectedRepoPath !== null && selectedRepoPath !== repoPath) {
          applyRepoPath(selectedRepoPath, true);
        }
      };

      const renderFileList = () => {
        fileListEl.innerHTML = '';
        if (detachedRepo) {
          const empty = document.createElement('div');
          empty.className = 'diff-panel-empty';
          empty.textContent = 'Repository is detached. Check out a branch to view diffs.';
          fileListEl.appendChild(empty);
          return;
        }
        const items = getVisibleItems();
        if (items.length === 0) {
          const empty = document.createElement('div');
          empty.className = 'diff-panel-empty';
          empty.textContent = searchInput.value.trim()
            ? 'No matching files.'
            : 'No files available.';
          fileListEl.appendChild(empty);
          return;
        }

        const availablePaths = new Set(items.map((item) => item.path));
        syncSelection(availablePaths);

        const rows = items
          .slice()
          .sort((a, b) => (a.displayPath || a.path).localeCompare(b.displayPath || b.path));
        rows.forEach((item) => {
          const row = document.createElement('button');
          row.type = 'button';
          row.className = 'diff-file-row';
          if (selectedPath === item.path) {
            row.classList.add('active');
          }
          const badge = buildStatusBadge(item.entry ?? null);
          const content = document.createElement('span');
          content.className = 'diff-file-content';
          const name = document.createElement('span');
          name.className = 'diff-file-name';
          name.textContent = item.displayPath || item.path;
          content.appendChild(name);
          row.appendChild(badge);
          row.appendChild(content);
          registerRowActivation(row, () => {
            if (selectedPath !== item.path) {
              selectedPath = item.path;
              diffDebugLog('selectPath', { selectedPath, viewMode });
              updateSelectionRepoContext(selectedPath);
              clearSelection(true);
              collapsedHunks.clear();
              loadSelectionContent();
            }
            renderFileList();
          });
          fileListEl.appendChild(row);
        });
      };

      const clearFileSelection = () => {
        if (!selectedPath) {
          return;
        }
        selectedPath = null;
        updateSelectionRepoContext(null);
        clearSelection(true);
        collapsedHunks.clear();
        loadSelectionContent();
        renderFileList();
      };

      const applyStatusUpdate = (payload: PanelUpdatePayload) => {
        if (payload.entries && Array.isArray(payload.entries)) {
          clearDetachedState();
          entries = payload.entries;
          repoRoot = normalizeRepoRoot(payload.repoRoot ?? repoRoot);
          repoRootAbsolute = payload.repoRootAbsolute ?? repoRootAbsolute;
          if (payload.branch) {
            repoBranch = payload.branch;
          }
          if (payload.target) {
            target = parseTarget(payload.target);
            targetSelect.value = target;
          }
          refreshStatusMap();
          updateSelectionRepoContext(selectedPath);
          updateRepoHeader();
          renderFileList();
          updatePanelContext();
        }
        if (payload.message) {
          if (isDetachedMessage(payload.message)) {
            setDetachedState(payload.message);
          } else {
            setStatus(payload.message, 'error');
          }
        }
      };

      const loadStatus = async () => {
        try {
          setStatus('', null);
          const result = await callInstanceOperation<DiffStatusResponse>('status', {
            repoPath: repoPath ?? undefined,
            target,
          });
          clearDetachedState();
          entries = result.entries || [];
          repoRoot = normalizeRepoRoot(result.repoRoot ?? repoPath);
          repoRootAbsolute = result.repoRootAbsolute ?? null;
          repoBranch = result.branch;
          refreshStatusMap();
          updateSelectionRepoContext(selectedPath);
          updateRepoHeader();
          renderFileList();
          updatePanelContext();
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to load diff status.';
          if (isDetachedMessage(message)) {
            setDetachedState(message);
          } else {
            setStatus(message, 'error');
            services.setStatus(message);
            entries = [];
            statusByPath.clear();
            renderFileList();
          }
        }
      };

      const refreshAll = async () => {
        await loadStatus();
        await loadSelectionContent();
      };

      const loadComments = async (pathFilter: string | null) => {
        if (target !== 'working') {
          comments = [];
          return;
        }
        if (detachedRepo) {
          comments = [];
          return;
        }
        const repoPathForOps = resolveRepoPathForOps();
        if (repoPathForOps === null) {
          comments = [];
          return;
        }
        try {
          const result = await callInstanceOperation<{ comments: unknown[] }>('comments-list', {
            repoPath: repoPathForOps ?? undefined,
            target,
            ...(pathFilter ? { path: pathFilter } : {}),
          });
          comments = (result.comments || [])
            .map(normalizeComment)
            .filter((entry): entry is DiffComment => !!entry);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to load comments.';
          setStatus(message, 'error');
        }
      };

      const wireSplitScrollSync = (linesContainer: HTMLElement) => {
        if (!linesContainer.classList.contains('diff-hunk-lines-split')) {
          return;
        }
        const leftLines = Array.from(
          linesContainer.querySelectorAll<HTMLElement>('.diff-split-left .diff-line-text'),
        );
        const rightLines = Array.from(
          linesContainer.querySelectorAll<HTMLElement>('.diff-split-right .diff-line-text'),
        );
        if (leftLines.length === 0 && rightLines.length === 0) {
          return;
        }
        let syncingLeft = false;
        let syncingRight = false;

        const syncLines = (source: HTMLElement, targets: HTMLElement[], side: 'left' | 'right') => {
          const syncing = side === 'left' ? syncingLeft : syncingRight;
          if (syncing) {
            return;
          }
          if (side === 'left') {
            syncingLeft = true;
          } else {
            syncingRight = true;
          }
          const scrollLeft = source.scrollLeft;
          targets.forEach((line) => {
            if (line !== source) {
              line.scrollLeft = scrollLeft;
            }
          });
          requestAnimationFrame(() => {
            if (side === 'left') {
              syncingLeft = false;
            } else {
              syncingRight = false;
            }
          });
        };

        linesContainer.addEventListener(
          'scroll',
          (event) => {
            const target = event.target as HTMLElement | null;
            if (!target || !target.classList.contains('diff-line-text')) {
              return;
            }
            const side = target.closest('.diff-split-side');
            if (!side) {
              return;
            }
            if (side.classList.contains('diff-split-left')) {
              syncLines(target, leftLines, 'left');
              return;
            }
            if (side.classList.contains('diff-split-right')) {
              syncLines(target, rightLines, 'right');
            }
          },
          true,
        );
      };

      const renderPatch = () => {
        diffContent.innerHTML = '';
        hunkList = [];
        hunkElements.clear();
        selectedHunkElement = null;

        if (detachedRepo) {
          const empty = document.createElement('div');
          empty.className = 'diff-panel-empty';
          empty.textContent = 'Repository is detached. Check out a branch to view diffs.';
          diffContent.appendChild(empty);
          return;
        }

        const buildFileHeader = (
          file: DiffFile,
          workspacePath: string,
          options: { sticky: boolean; actions?: HTMLElement[] },
        ) => {
          const fileHeader = document.createElement('div');
          fileHeader.className = 'diff-file-header';
          if (options.sticky) {
            fileHeader.classList.add('diff-file-header-sticky');
          }
          const badge = buildStatusBadge(statusByPath.get(workspacePath) ?? null);
          const name = document.createElement('div');
          name.className = 'diff-file-header-name';
          name.textContent = file.displayPath || file.path || workspacePath;
          fileHeader.appendChild(badge);
          fileHeader.appendChild(name);
          if (options.actions && options.actions.length > 0) {
            const actions = document.createElement('div');
            actions.className = 'diff-file-header-actions';
            options.actions.forEach((action) => actions.appendChild(action));
            fileHeader.appendChild(actions);
          }
          return fileHeader;
        };

        const hasFiles = patchData && patchData.files.length > 0;
        const showFileHeaders = !selectedPath;
        if (!hasFiles) {
          const empty = document.createElement('div');
          empty.className = 'diff-panel-empty';
          empty.textContent = selectedPath ? 'No diff hunks available.' : 'No changes to show.';
          diffContent.appendChild(empty);
          sendHunkSnapshot();
          clearSelection(true);
          return;
        }

        const repoPathForOps = resolveRepoPathForOps();
        const runFileStage = async (pathValue: string) => {
          try {
            if (target === 'staged') {
              const status = await callInstanceOperation<DiffStatusResponse>('unstage', {
                panelId: host.panelId(),
                repoPath: repoPathForOps ?? undefined,
                path: pathValue,
              });
              applyStatusUpdate(status);
            } else {
              const status = await callInstanceOperation<DiffStatusResponse>('stage', {
                panelId: host.panelId(),
                repoPath: repoPathForOps ?? undefined,
                path: pathValue,
              });
              applyStatusUpdate(status);
            }
            await loadSelectionContent();
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to stage file.';
            setStatus(message, 'error');
          }
        };

        const buildStageButton = (pathValue: string): HTMLButtonElement => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'diff-panel-button diff-panel-stage';
          button.textContent = target === 'staged' ? 'Unstage file' : 'Stage file';
          button.addEventListener('click', async (event) => {
            event.stopPropagation();
            await runFileStage(pathValue);
          });
          return button;
        };

        const fileStageButton =
          selectedPath && selectedRepoFilePath && target ? buildStageButton(selectedPath) : null;

        let hunkListIndex = 0;
        const fileWrapper = document.createElement('div');
        fileWrapper.className = 'diff-file';

        patchData.files.forEach((file, index) => {
          const workspacePath = toWorkspacePath(repoRoot, file.path);
          if (showFileHeaders) {
            const actions = target ? [buildStageButton(workspacePath)] : undefined;
            fileWrapper.appendChild(
              buildFileHeader(file, workspacePath, {
                sticky: true,
                ...(actions ? { actions } : {}),
              }),
            );
          } else if (index === 0) {
            const actions = fileStageButton ? [fileStageButton] : undefined;
            fileWrapper.appendChild(
              buildFileHeader(file, workspacePath, {
                sticky: true,
                ...(actions ? { actions } : {}),
              }),
            );
          }

          const commentsByHunk: Record<string, DiffComment[]> = {};
          comments.forEach((comment) => {
            if (comment.path !== file.path || !comment.hunkHash) {
              return;
            }
            const bucket = commentsByHunk[comment.hunkHash] ?? [];
            bucket.push(comment);
            commentsByHunk[comment.hunkHash] = bucket;
          });

          if (file.binary) {
            const binaryNotice = document.createElement('div');
            binaryNotice.className = 'diff-panel-empty';
            binaryNotice.textContent = 'Binary changes cannot be previewed.';
            fileWrapper.appendChild(binaryNotice);
            return;
          }
          if (!file.hunks || file.hunks.length === 0) {
            const emptyNotice = document.createElement('div');
            emptyNotice.className = 'diff-panel-empty';
            emptyNotice.textContent = 'No diff hunks available.';
            fileWrapper.appendChild(emptyNotice);
            return;
          }

          file.hunks.forEach((hunk, index) => {
            const hunkKey = `${file.path}::${index}`;
            const hunkEl = document.createElement('div');
            hunkEl.className = 'diff-hunk';
            if (collapsedHunks.has(hunkKey)) {
              hunkEl.classList.add('collapsed');
            }
            const descriptor = buildHunkDescriptor(file.path, hunk, index, hunkListIndex);
            hunkListIndex += 1;
            hunkList.push(descriptor);
            hunkElements.set(`${descriptor.path}::${descriptor.hunkHash}`, hunkEl);

            if (
              selectedHunk &&
              selectedHunk.path === descriptor.path &&
              selectedHunk.hunkHash === descriptor.hunkHash
            ) {
              hunkEl.classList.add('selected');
              selectedHunkElement = hunkEl;
            }

            const hunkHeader = document.createElement('div');
            hunkHeader.className = 'diff-hunk-header';

            const toggleButton = document.createElement('button');
            toggleButton.type = 'button';
            toggleButton.className = 'diff-hunk-toggle';
            toggleButton.textContent = collapsedHunks.has(hunkKey) ? '▸' : '▾';
            toggleButton.addEventListener('click', (event) => {
              event.stopPropagation();
              if (collapsedHunks.has(hunkKey)) {
                collapsedHunks.delete(hunkKey);
              } else {
                collapsedHunks.add(hunkKey);
              }
              toggleButton.textContent = collapsedHunks.has(hunkKey) ? '▸' : '▾';
              hunkEl.classList.toggle('collapsed', collapsedHunks.has(hunkKey));
            });

            const hunkTitle = document.createElement('div');
            hunkTitle.className = 'diff-hunk-title';
            hunkTitle.textContent = hunk.header || 'Hunk';

            const hunkActions = document.createElement('div');
            hunkActions.className = 'diff-hunk-actions';

            const stageButton = document.createElement('button');
            stageButton.type = 'button';
            stageButton.className = 'diff-panel-button diff-panel-stage';
            stageButton.textContent = target === 'staged' ? 'Unstage hunk' : 'Stage hunk';
            stageButton.addEventListener('click', async (event) => {
              event.stopPropagation();
              const patchLines = (file.headerLines || []).concat(hunk.rawLines || []);
              let patchText = patchLines.join('\n');
              if (patchText && patchText.charAt(patchText.length - 1) !== '\n') {
                patchText += '\n';
              }
              try {
                if (target === 'staged') {
                  const status = await callInstanceOperation<DiffStatusResponse>('unstage', {
                    panelId: host.panelId(),
                    repoPath: repoPathForOps ?? undefined,
                    patch: patchText,
                  });
                  applyStatusUpdate(status);
                } else {
                  const status = await callInstanceOperation<DiffStatusResponse>('stage', {
                    panelId: host.panelId(),
                    repoPath: repoPathForOps ?? undefined,
                    patch: patchText,
                  });
                  applyStatusUpdate(status);
                }
                await loadSelectionContent();
              } catch (err) {
                const message = err instanceof Error ? err.message : 'Failed to stage hunk.';
                setStatus(message, 'error');
              }
            });

            const commentButton = document.createElement('button');
            commentButton.type = 'button';
            commentButton.className = 'diff-panel-button diff-panel-secondary';
            const hunkComments = commentsByHunk[descriptor.hunkHash] || [];
            commentButton.textContent =
              hunkComments.length > 0 ? `Comments (${hunkComments.length})` : 'Comment';
            commentButton.disabled = target !== 'working';

            const commentSection = document.createElement('div');
            commentSection.className = 'diff-hunk-comments';
            const commentList = document.createElement('div');
            commentList.className = 'diff-comment-list';
            const commentForm = document.createElement('div');
            commentForm.className = 'diff-comment-form';

            const commentInput = document.createElement('textarea');
            commentInput.className = 'diff-comment-textarea';
            commentInput.rows = 3;
            commentInput.placeholder = 'Add a review note...';

            const commentActions = document.createElement('div');
            commentActions.className = 'diff-comment-actions';
            const commentSave = document.createElement('button');
            commentSave.type = 'button';
            commentSave.className = 'diff-panel-button diff-panel-stage';
            commentSave.textContent = 'Save';
            const commentCancel = document.createElement('button');
            commentCancel.type = 'button';
            commentCancel.className = 'diff-panel-button diff-panel-secondary';
            commentCancel.textContent = 'Cancel';

            commentActions.appendChild(commentSave);
            commentActions.appendChild(commentCancel);
            commentForm.appendChild(commentInput);
            commentForm.appendChild(commentActions);
            commentSection.appendChild(commentList);
            commentSection.appendChild(commentForm);

            commentButton.addEventListener('click', (event) => {
              event.stopPropagation();
              commentForm.classList.toggle('active');
              if (commentForm.classList.contains('active')) {
                commentInput.focus();
              }
            });

            commentCancel.addEventListener('click', (event) => {
              event.stopPropagation();
              commentInput.value = '';
              commentForm.classList.remove('active');
            });

            commentSave.addEventListener('click', async (event) => {
              event.stopPropagation();
              const body = commentInput.value.trim();
              if (!body) {
                return;
              }
              try {
                await callInstanceOperation('comment-add', {
                  panelId: host.panelId(),
                  repoPath: repoPathForOps ?? undefined,
                  target,
                  path: workspacePath,
                  hunkHash: descriptor.hunkHash,
                  header: descriptor.header,
                  body,
                });
                commentInput.value = '';
                commentForm.classList.remove('active');
              } catch (err) {
                const message = err instanceof Error ? err.message : 'Failed to save comment.';
                setStatus(message, 'error');
              }
            });

            const renderComment = (comment: DiffComment) => {
              const wrapper = document.createElement('div');
              wrapper.className = 'diff-comment';
              const meta = document.createElement('div');
              meta.className = 'diff-comment-meta';
              const status = document.createElement('span');
              status.className = 'diff-comment-status';
              status.textContent = comment.status === 'resolved' ? 'Resolved' : 'Open';
              meta.appendChild(status);

              const body = document.createElement('div');
              body.className = 'diff-comment-body';
              body.textContent = comment.body;

              const actions = document.createElement('div');
              actions.className = 'diff-comment-actions';
              const resolveButton = document.createElement('button');
              resolveButton.type = 'button';
              resolveButton.className = 'diff-panel-button diff-panel-secondary';
              resolveButton.textContent = comment.status === 'resolved' ? 'Reopen' : 'Resolve';
              resolveButton.addEventListener('click', async () => {
                try {
                  await callInstanceOperation('comment-update', {
                    panelId: host.panelId(),
                    repoPath: repoPathForOps ?? undefined,
                    id: comment.id,
                    status: comment.status === 'resolved' ? 'open' : 'resolved',
                  });
                } catch (err) {
                  const message = err instanceof Error ? err.message : 'Failed to update comment.';
                  setStatus(message, 'error');
                }
              });
              const deleteButton = document.createElement('button');
              deleteButton.type = 'button';
              deleteButton.className = 'diff-panel-button diff-panel-secondary';
              deleteButton.textContent = 'Delete';
              deleteButton.addEventListener('click', async () => {
                try {
                  await callInstanceOperation('comment-delete', {
                    panelId: host.panelId(),
                    repoPath: repoPathForOps ?? undefined,
                    id: comment.id,
                  });
                } catch (err) {
                  const message = err instanceof Error ? err.message : 'Failed to delete comment.';
                  setStatus(message, 'error');
                }
              });
              actions.appendChild(resolveButton);
              actions.appendChild(deleteButton);

              wrapper.appendChild(meta);
              wrapper.appendChild(body);
              wrapper.appendChild(actions);
              return wrapper;
            };

            hunkComments.forEach((comment) => {
              commentList.appendChild(renderComment(comment));
            });

            hunkHeader.addEventListener('click', () => {
              setSelectedHunk(descriptor);
            });

            hunkHeader.appendChild(toggleButton);
            hunkHeader.appendChild(hunkTitle);
            hunkHeader.appendChild(hunkActions);
            hunkActions.appendChild(stageButton);
            hunkActions.appendChild(commentButton);

            // Use the new renderer for hunk lines (supports split view and word diff)
            const linesContainer = renderHunkLines(
              file as RendererDiffFile,
              hunk as RendererDiffHunk,
              getRenderOptions(),
            );
            linesContainer.addEventListener('click', () => {
              setSelectedHunk(descriptor);
            });
            wireSplitScrollSync(linesContainer);

            hunkEl.appendChild(hunkHeader);
            hunkEl.appendChild(linesContainer);
            if (target === 'working') {
              hunkEl.appendChild(commentSection);
            }
            fileWrapper.appendChild(hunkEl);
          });
        });

        diffContent.appendChild(fileWrapper);
        sendHunkSnapshot();
        updatePanelContext();
      };

      const setSelectedHunk = (descriptor: DiffHunkDescriptor) => {
        const repoPathForOps = resolveRepoPathForOps();
        selectedHunk = {
          ...descriptor,
          target,
          repoPath: repoPathForOps ?? undefined,
        };
        const key = `${descriptor.path}::${descriptor.hunkHash}`;
        if (selectedHunkElement) {
          selectedHunkElement.classList.remove('selected');
        }
        const el = hunkElements.get(key) ?? null;
        if (el) {
          el.classList.add('selected');
          selectedHunkElement = el;
        }
        sendPanelEvent({
          type: 'diff_hunk_selected',
          selection: selectedHunk,
          target,
          repoPath: repoPathForOps ?? undefined,
        });
        updatePanelContext();
      };

      const selectHunkByHash = (hash: string): boolean => {
        const descriptor = hunkList.find((entry) => entry.hunkHash === hash);
        if (!descriptor) {
          return false;
        }
        setSelectedHunk(descriptor);
        return true;
      };

      const loadSelectionContent = async () => {
        const repoPathForOps = resolveRepoPathForOps();
        const entry = selectedPath ? (statusByPath.get(selectedPath) ?? null) : null;
        diffDebugLog('loadSelectionContent', {
          selectedPath,
          selectedRepoPath,
          selectedRepoFilePath,
          hasStatusEntry: Boolean(entry),
          target,
        });
        if (detachedRepo) {
          renderPatch();
          return;
        }
        try {
          setStatus('', null);
          if (!selectedPath) {
            await loadComments(null);
            const items = getItemsForView();
            if (items.length === 0) {
              patchData = null;
              renderPatch();
              return;
            }
            const patches = await Promise.all(
              items.map((item) =>
                callInstanceOperation<DiffPatchResponse>('patch', {
                  repoPath: repoPathForOps ?? undefined,
                  target,
                  path: item.path,
                }),
              ),
            );
            if (patches.length > 0) {
              repoRoot = normalizeRepoRoot(patches[0]?.repoRoot ?? repoRoot);
              repoRootAbsolute = patches[0]?.repoRootAbsolute ?? repoRootAbsolute ?? null;
            }
            const combinedPatch = patches
              .map((result) => result.patch || '')
              .filter((section) => section.trim().length > 0)
              .map((section) => (section.endsWith('\n') ? section : `${section}\n`))
              .join('');
            patchData = combinedPatch ? parseUnifiedPatch(combinedPatch) : { files: [] };
            diffDebugLog('patchParsed', {
              files: patchData.files.length,
              hunks: patchData.files.reduce((count, file) => count + file.hunks.length, 0),
            });
            renderPatch();
            if (pendingHunkHash) {
              if (selectHunkByHash(pendingHunkHash)) {
                pendingHunkHash = null;
              }
            }
            return;
          }

          await loadComments(selectedPath);
          const result = await callInstanceOperation<DiffPatchResponse>('patch', {
            repoPath: repoPathForOps ?? undefined,
            target,
            path: selectedPath,
          });
          diffDebugLog('patchResult', {
            path: result.path,
            truncated: result.truncated,
            patchLength: result.patch.length,
          });
          repoRoot = normalizeRepoRoot(result.repoRoot ?? repoRoot);
          repoRootAbsolute = result.repoRootAbsolute ?? repoRootAbsolute ?? null;
          patchData = parseUnifiedPatch(result.patch || '');
          diffDebugLog('patchParsed', {
            files: patchData.files.length,
            hunks: patchData.files.reduce((count, file) => count + file.hunks.length, 0),
          });
          renderPatch();
          if (pendingHunkHash) {
            if (selectHunkByHash(pendingHunkHash)) {
              pendingHunkHash = null;
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Failed to load diff.';
          diffDebugWarn('loadSelectionContent failed', message, err);
          if (isDetachedMessage(message)) {
            setDetachedState(message);
            return;
          }
          setStatus(message, 'error');
          patchData = null;
          renderPatch();
        }
      };

      const handlePanelUpdate = (payload: PanelUpdatePayload) => {
        const payloadInstance = payload.instance_id ?? DEFAULT_INSTANCE_ID;
        if (payloadInstance !== selectedInstanceId) {
          return;
        }
        if (payload.action === 'status_changed') {
          diffDebugLog('panelUpdate', payload.action, {
            repoRoot: payload.repoRoot,
            target: payload.target,
            entries: payload.entries?.length ?? 0,
          });
          applyStatusUpdate(payload);
          void loadSelectionContent();
          return;
        }
        if (payload.action === 'status_error') {
          diffDebugWarn('panelUpdate', payload.action, payload.message);
          if (payload.message) {
            if (isDetachedMessage(payload.message)) {
              setDetachedState(payload.message);
            } else {
              setStatus(payload.message, 'error');
            }
          }
          return;
        }
        if (payload.action === 'patch_changed') {
          diffDebugLog('panelUpdate', payload.action, payload.path);
          if (!selectedRepoFilePath) {
            void loadSelectionContent();
            return;
          }
          if (payload.path && payload.path !== selectedRepoFilePath) {
            return;
          }
          void loadSelectionContent();
          return;
        }
        if (payload.action === 'files_changed') {
          diffDebugLog('panelUpdate', payload.action);
          void refreshAll();
          return;
        }
        if (payload.action && payload.action.startsWith('comment_')) {
          diffDebugLog('panelUpdate', payload.action);
          if (payload.comment) {
            const normalized = normalizeComment(payload.comment);
            if (normalized) {
              const index = comments.findIndex((comment) => comment.id === normalized.id);
              if (payload.action === 'comment_deleted') {
                if (index >= 0) {
                  comments.splice(index, 1);
                }
              } else if (index >= 0) {
                comments[index] = normalized;
              } else {
                comments.push(normalized);
              }
            }
          } else if (payload.id) {
            comments = comments.filter((comment) => comment.id !== payload.id);
          }
          if (patchData) {
            renderPatch();
          }
          return;
        }
      };

      const registerAutoRefresh = () => {
        if (autoRefreshTimer) {
          clearInterval(autoRefreshTimer);
        }
        const repoPathForOps = resolveRepoPathForOps();
        sendPanelEvent({
          type: 'diff_watch_register',
          instance_id: selectedInstanceId,
          target,
          repoPath: repoPathForOps ?? undefined,
          intervalMs: AUTO_REFRESH_INTERVAL_MS,
        });
        autoRefreshTimer = setInterval(() => {
          sendPanelEvent({ type: 'diff_watch_ping' });
          void refreshAll();
        }, AUTO_REFRESH_PING_MS);
      };

      const unregisterAutoRefresh = () => {
        sendPanelEvent({ type: 'diff_watch_unregister' });
        if (autoRefreshTimer) {
          clearInterval(autoRefreshTimer);
          autoRefreshTimer = null;
        }
      };

      repoChangeButton.addEventListener('click', () => {
        setRepoPickerOpen(true);
      });

      repoPickerRefresh.addEventListener('click', () => {
        void loadRepoIndex(true).then(() => renderRepoPicker());
      });

      repoPickerCloseButtons.forEach((button) => {
        button.addEventListener('click', () => {
          setRepoPickerOpen(false);
        });
      });

      targetSelect.addEventListener('change', () => {
        target = parseTarget(targetSelect.value);
        updatePanelContext();
        const refreshForTarget = async () => {
          await loadStatus();
          clearSelection(true);
          collapsedHunks.clear();
          await loadSelectionContent();
        };
        refreshForTarget().catch(() => undefined);
        if (autoRefreshEnabled) {
          registerAutoRefresh();
        }
      });

      // Diff style toggle (split/unified)
      diffStyleSelect?.addEventListener('change', () => {
        diffStyle = (diffStyleSelect.value as DiffStyle) || 'split';
        renderPatch();
      });

      // Word diff toggle
      wordDiffToggle?.addEventListener('change', () => {
        showWordDiff = wordDiffToggle.checked;
        renderPatch();
      });

      refreshButton.addEventListener('click', () => {
        refreshAll().catch(() => undefined);
      });

      autoToggle.addEventListener('change', () => {
        autoRefreshEnabled = autoToggle.checked;
        if (autoRefreshEnabled) {
          registerAutoRefresh();
        } else {
          unregisterAutoRefresh();
        }
      });

      collapseButton.addEventListener('click', () => {
        collapsedSidebar = !collapsedSidebar;
        sidebarEl.classList.toggle('collapsed', collapsedSidebar);
        collapseButton.textContent = collapsedSidebar ? 'Expand' : 'Collapse';
      });

      fileListEl.addEventListener('click', (event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest('.diff-file-row')) {
          return;
        }
        clearFileSelection();
      });

      searchInput.addEventListener('input', () => {
        renderFileList();
      });

      const boot = async () => {
        await refreshInstances({ silent: true });
        await refreshAll();
      };
      boot().catch(() => undefined);

      return {
        onVisibilityChange: (visible) => {
          if (visible) {
            refreshAll().catch(() => undefined);
            if (autoRefreshEnabled) {
              registerAutoRefresh();
            }
            chromeController?.scheduleLayoutCheck();
          } else if (autoRefreshEnabled) {
            unregisterAutoRefresh();
          }
        },
        onFocus: () => {
          refreshAll().catch(() => undefined);
        },
        onEvent: (event: PanelEventEnvelope) => {
          const payload = event.payload as PanelUpdatePayload | null;
          if (!payload) {
            return;
          }
          if (payload.type === 'panel_update') {
            handlePanelUpdate(payload);
            return;
          }
          if (payload.type === 'diff_show') {
            diffDebugLog('diff_show', payload);
            const payloadInstance = payload.instance_id ?? DEFAULT_INSTANCE_ID;
            if (payloadInstance !== selectedInstanceId) {
              let placeholderAdded = false;
              if (!instances.some((instance) => instance.id === payloadInstance)) {
                instances = [
                  ...instances,
                  { id: payloadInstance, label: formatInstanceLabel(payloadInstance) },
                ];
                placeholderAdded = true;
              }
              setActiveInstance(payloadInstance, { refresh: false });
              if (placeholderAdded) {
                void refreshInstances({ silent: true });
              }
            }
            if (payload.repoPath) {
              const raw = payload.repoPath.trim();
              const normalized = raw === '.' ? '' : normalizeRepoRoot(raw);
              applyRepoPath(normalized || null, true);
            }
            if (payload.target) {
              target = parseTarget(payload.target);
              targetSelect.value = target;
            }
            if (payload.path) {
              const repoPrefix = normalizeRepoRoot(payload.repoPath ?? null);
              const resolved =
                repoPrefix && !payload.path.startsWith(repoPrefix)
                  ? `${repoPrefix}/${payload.path}`.replace(/\/+/g, '/')
                  : payload.path;
              selectedPath = resolved;
              updateSelectionRepoContext(selectedPath);
              loadSelectionContent().catch(() => undefined);
              renderFileList();
            }
            if (payload.hunkHash && selectedPath) {
              pendingHunkHash = payload.hunkHash;
              if (patchData) {
                if (selectHunkByHash(payload.hunkHash)) {
                  pendingHunkHash = null;
                }
              }
            }
            updatePanelContext();
          }
        },
        onSessionChange: () => {},
        unmount() {
          unregisterAutoRefresh();
          chromeController?.destroy();
          host.setContext(contextKey, null);
          container.innerHTML = '';
        },
      };
    },
  }));
}
