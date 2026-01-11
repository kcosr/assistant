import type { PanelEventEnvelope } from '@assistant/shared';
import type {
  PanelHost,
  PanelInitOptions,
} from '../../../../web-client/src/controllers/panelRegistry';

type TerminalBufferLine = {
  translateToString: (trimRight?: boolean) => string;
  isWrapped?: boolean;
};

type TerminalBuffer = {
  length?: number;
  cursorX?: number;
  cursorY?: number;
  type?: string;
  getLine: (index: number) => TerminalBufferLine | null;
};

type TerminalInstance = {
  cols: number;
  rows: number;
  buffer?: { active?: TerminalBuffer };
  open: (container: HTMLElement) => void;
  write: (data: string) => void;
  focus: () => void;
  blur: () => void;
  dispose: () => void;
  setOption?: (key: string, value: unknown) => void;
  onData: (handler: (data: string) => void) => { dispose: () => void };
  onResize: (handler: (size: { cols: number; rows: number }) => void) => { dispose: () => void };
  loadAddon: (addon: TerminalFitAddon) => void;
};

type TerminalFitAddon = {
  fit: () => void;
  observeResize: () => void;
  dispose: () => void;
};

type GhosttyModule = {
  init?: () => Promise<void>;
  Terminal?: new (options: {
    fontFamily: string;
    fontSize: number;
    cursorBlink: boolean;
  }) => TerminalInstance;
  FitAddon?: new () => TerminalFitAddon;
};

type TerminalSnapshot = {
  cols: number;
  rows: number;
  cursor: { x: number; y: number };
  bufferType: string;
  lines: string[];
  wrapped: boolean[];
  timestamp: string;
};

type TerminalStatusPayload =
  | { type: 'terminal_status'; state: 'ready' }
  | {
      type: 'terminal_status';
      state: 'closed';
      exitCode?: number | null;
      signal?: number | null;
    }
  | { type: 'terminal_status'; state: 'error'; message: string };

type TerminalSnapshotRequestPayload = { type: 'terminal_snapshot_request'; requestId?: string };

type TerminalOutputPayload = { type: 'terminal_output'; data?: string };

type TerminalWindow = Window & {
  ASSISTANT_API_HOST?: string;
};

type Disposable = { dispose: () => void };

type TerminalPayload =
  | TerminalStatusPayload
  | TerminalSnapshotRequestPayload
  | TerminalOutputPayload
  | { type: string; [key: string]: unknown };

const registry = window.ASSISTANT_PANEL_REGISTRY;
if (!registry || typeof registry.registerPanel !== 'function') {
  console.warn('ASSISTANT_PANEL_REGISTRY is not available for terminal plugin.');
} else {
  let debug = false;
  try {
    debug =
      !!window.localStorage && window.localStorage.getItem('aiAssistantTerminalDebug') === 'true';
  } catch {
    debug = false;
  }

  const log = (...args: unknown[]): void => {
    if (!debug || !window.console || typeof console.log !== 'function') {
      return;
    }
    console.log('[terminal-panel]', ...args);
  };

  let ghosttyPromise: Promise<GhosttyModule> | null = null;
  let assetBaseUrl: string | null = null;

  const resolveHostBase = (): string => {
    const host = (window as TerminalWindow).ASSISTANT_API_HOST;
    if (host && host.includes('://')) {
      return host.replace(/\/+$/, '');
    }
    const protocol = host ? 'https:' : window.location.protocol;
    return `${protocol}//${host || window.location.host}`;
  };

  const resolveFontFamily = (): string => {
    let override: string | null = null;
    try {
      override = window.localStorage?.getItem('aiAssistantTerminalFontFamily') ?? null;
    } catch {
      override = null;
    }
    if (override && override.trim()) {
      return override.trim();
    }
    let cssValue = '';
    try {
      cssValue = window.getComputedStyle(document.documentElement).getPropertyValue('--font-mono');
    } catch {
      cssValue = '';
    }
    if (cssValue && cssValue.trim()) {
      return cssValue.trim();
    }
    return 'monospace';
  };

  const resolveFontSize = (): number => {
    let override: string | null = null;
    try {
      override = window.localStorage?.getItem('aiAssistantTerminalFontSize') ?? null;
    } catch {
      override = null;
    }
    if (override && override.trim()) {
      const parsed = Number.parseFloat(override);
      if (Number.isFinite(parsed) && parsed > 4) {
        return parsed;
      }
    }
    return 13;
  };

  const resolveAssetUrl = (path: string): string => {
    if (!assetBaseUrl) {
      const script = document.currentScript as HTMLScriptElement | null;
      if (script?.src) {
        try {
          assetBaseUrl = new URL('.', script.src).toString();
        } catch {
          assetBaseUrl = new URL('/plugins/terminal/', resolveHostBase()).toString();
        }
      } else {
        assetBaseUrl = new URL('/plugins/terminal/', resolveHostBase()).toString();
      }
    }
    try {
      return new URL(path, assetBaseUrl).toString();
    } catch {
      return path;
    }
  };

  const loadGhostty = (): Promise<GhosttyModule> => {
    if (!ghosttyPromise) {
      const moduleUrl = resolveAssetUrl('ghostty-web.js');
      log('loading ghostty', moduleUrl);
      ghosttyPromise = import(moduleUrl).then((mod: GhosttyModule) => {
        if (mod && typeof mod.init === 'function') {
          return mod.init().then(() => {
            log('ghostty initialized');
            return mod;
          });
        }
        return mod;
      });
    }
    return ghosttyPromise;
  };

  registry.registerPanel('terminal', () => {
    let term: TerminalInstance | null = null;
    let fitAddon: TerminalFitAddon | null = null;
    let disposables: Disposable[] = [];
    let pendingOutput: string[] = [];
    let statusEl: HTMLElement | null = null;
    let body: HTMLElement | null = null;
    let host: PanelHost | null = null;
    let panelId: string | null = null;
    let currentFontFamily: string | null = null;
    let isMounted = false;
    let pendingFocus = false;
    let focusListener: ((event: Event) => void) | null = null;
    let focusAttached = false;

    const setStatus = (text: string, state?: string): void => {
      if (!statusEl) {
        return;
      }
      if (!text) {
        statusEl.textContent = '';
        statusEl.classList.add('hidden');
        delete statusEl.dataset['state'];
        return;
      }
      statusEl.textContent = text;
      statusEl.classList.remove('hidden');
      if (state) {
        statusEl.dataset['state'] = state;
      } else {
        delete statusEl.dataset['state'];
      }
    };

    const writeOutput = (data?: string): void => {
      if (typeof data !== 'string' || data.length === 0) {
        return;
      }
      if (!term) {
        pendingOutput.push(data);
        return;
      }
      term.write(data);
    };

    const flushOutput = (): void => {
      if (!term || pendingOutput.length === 0) {
        return;
      }
      pendingOutput.forEach((chunk) => {
        term?.write(chunk);
      });
      pendingOutput = [];
    };

    const requestFocus = (): void => {
      pendingFocus = true;
      if (term && typeof term.focus === 'function') {
        term.focus();
        pendingFocus = false;
        log('focused', panelId);
      }
    };

    const attachFocusListeners = (): void => {
      if (!body) {
        return;
      }
      if (focusAttached) {
        return;
      }
      if (!focusListener) {
        focusListener = () => {
          log('pointer focus request', panelId);
          requestFocus();
        };
      }
      body.tabIndex = 0;
      body.addEventListener('pointerdown', focusListener);
      body.addEventListener('keydown', focusListener);
      focusAttached = true;
    };

    const detachFocusListeners = (): void => {
      if (!body || !focusListener) {
        return;
      }
      body.removeEventListener('pointerdown', focusListener);
      body.removeEventListener('keydown', focusListener);
      focusAttached = false;
    };

    const applyFontFamily = (nextFontFamily: string): void => {
      const trimmed = nextFontFamily.trim();
      if (!term || !trimmed) {
        return;
      }
      if (currentFontFamily === trimmed) {
        return;
      }
      currentFontFamily = trimmed;
      if (typeof term.setOption === 'function') {
        term.setOption('fontFamily', trimmed);
      }
      fitAddon?.fit();
      if (host) {
        host.sendEvent({ type: 'terminal_resize', cols: term.cols, rows: term.rows });
      }
    };

    const attachTerminal = (mod: GhosttyModule): void => {
      if (!isMounted) {
        return;
      }
      if (!mod?.Terminal || !mod?.FitAddon) {
        setStatus('Terminal module failed to load.', 'error');
        return;
      }
      const fontFamily = resolveFontFamily();
      const fontSize = resolveFontSize();
      log('font', { panelId, fontFamily, fontSize });
      currentFontFamily = fontFamily;
      term = new mod.Terminal({
        fontFamily,
        fontSize,
        cursorBlink: true,
      });
      fitAddon = new mod.FitAddon();
      term.loadAddon(fitAddon);
      if (body) {
        term.open(body);
      }
      fitAddon.fit();
      fitAddon.observeResize();
      attachFocusListeners();
      if (host) {
        disposables.push(
          term.onData((data) => {
            log('send input', { panelId, length: data.length });
            host?.sendEvent({ type: 'terminal_input', text: data });
          }),
        );
        disposables.push(
          term.onResize((size) => {
            log('send resize', { panelId, cols: size.cols, rows: size.rows });
            host?.sendEvent({
              type: 'terminal_resize',
              cols: size.cols,
              rows: size.rows,
            });
          }),
        );
        host.sendEvent({ type: 'terminal_resize', cols: term.cols, rows: term.rows });
      }
      setStatus('', 'ready');
      flushOutput();
      if (pendingFocus) {
        requestFocus();
      }
    };

    const handleStatus = (payload: TerminalStatusPayload): void => {
      if (!payload || payload.type !== 'terminal_status') {
        return;
      }
      log('status', { panelId, state: payload.state });
      if (payload.state === 'ready') {
        setStatus('', 'ready');
        return;
      }
      if (payload.state === 'closed') {
        let suffix = '';
        if (typeof payload.exitCode === 'number') {
          suffix = ` (exit ${payload.exitCode})`;
        }
        setStatus(`Terminal closed${suffix}.`, 'closed');
        return;
      }
      if (payload.state === 'error') {
        const message =
          typeof payload.message === 'string' && payload.message.length > 0
            ? payload.message
            : 'Terminal error.';
        setStatus(message, 'error');
      }
    };

    const buildSnapshot = (): TerminalSnapshot | null => {
      const buffer = term?.buffer?.active;
      if (!term || !buffer) {
        return null;
      }
      const rows = term.rows || 0;
      const cols = term.cols || 0;
      const totalLines = buffer.length || 0;
      const start = Math.max(0, totalLines - rows);
      const lines: string[] = [];
      const wrapped: boolean[] = [];
      for (let i = 0; i < rows; i += 1) {
        const line = buffer.getLine(start + i);
        lines.push(line ? line.translateToString(true) : '');
        wrapped.push(line ? Boolean(line.isWrapped) : false);
      }
      return {
        cols,
        rows,
        cursor: {
          x: buffer.cursorX || 0,
          y: buffer.cursorY || 0,
        },
        bufferType: buffer.type || 'normal',
        lines,
        wrapped,
        timestamp: new Date().toISOString(),
      };
    };

    const handleSnapshotRequest = (
      payload: TerminalSnapshotRequestPayload,
      responseSessionId: string | null,
    ): void => {
      const requestId = payload?.requestId;
      if (!requestId || typeof requestId !== 'string') {
        return;
      }
      if (!term || !host) {
        host?.sendEvent(
          {
            type: 'terminal_snapshot_error',
            requestId,
            message: 'Terminal is not ready.',
          },
          { sessionId: responseSessionId },
        );
        return;
      }
      const snapshot = buildSnapshot();
      if (!snapshot) {
        host.sendEvent(
          {
            type: 'terminal_snapshot_error',
            requestId,
            message: 'Unable to capture terminal snapshot.',
          },
          { sessionId: responseSessionId },
        );
        return;
      }
      log('snapshot', {
        panelId,
        requestId,
        rows: snapshot.rows,
        cols: snapshot.cols,
      });
      host.sendEvent(
        {
          type: 'terminal_snapshot_response',
          requestId,
          snapshot,
        },
        { sessionId: responseSessionId },
      );
    };

    return {
      mount(container: HTMLElement, panelHost: PanelHost, init: PanelInitOptions) {
        host = panelHost;
        panelId = panelHost.panelId();
        pendingFocus = Boolean(init?.focus);
        log('mount', { panelId, focus: pendingFocus });
        isMounted = true;
        container.classList.add('terminal-panel');
        container.innerHTML = '';

        statusEl = document.createElement('div');
        statusEl.className = 'terminal-panel-status';
        statusEl.textContent = 'Loading terminal...';

        body = document.createElement('div');
        body.className = 'terminal-panel-body';

        container.appendChild(statusEl);
        container.appendChild(body);
        attachFocusListeners();

        const themeListener = (event: Event) => {
          const detail =
            event && 'detail' in event
              ? (event as CustomEvent<{ codeFont?: string | null }>).detail
              : null;
          if (detail?.codeFont && typeof detail.codeFont === 'string') {
            applyFontFamily(detail.codeFont);
            return;
          }
          applyFontFamily(resolveFontFamily());
        };
        window.addEventListener('assistant:theme-updated', themeListener);
        disposables.push({
          dispose: () => window.removeEventListener('assistant:theme-updated', themeListener),
        });

        loadGhostty()
          .then((mod) => {
            attachTerminal(mod);
          })
          .catch((err: unknown) => {
            const message = err instanceof Error ? err.message : 'Unknown error.';
            log('ghostty load failed', { panelId, message });
            setStatus(`Failed to load terminal: ${message}`, 'error');
          });

        return {
          onEvent(event: PanelEventEnvelope) {
            const payload = event?.payload as TerminalPayload | null;
            if (!payload || typeof payload !== 'object') {
              return;
            }
            if (payload.type === 'terminal_snapshot_request') {
              const responseSessionId =
                typeof event.sessionId === 'string' ? event.sessionId : null;
              handleSnapshotRequest(payload as TerminalSnapshotRequestPayload, responseSessionId);
              return;
            }
            if (payload.type === 'terminal_output') {
              log('output', {
                panelId,
                length: typeof payload.data === 'string' ? payload.data.length : 0,
              });
              const output = typeof payload.data === 'string' ? payload.data : undefined;
              writeOutput(output);
              return;
            }
            if (payload.type === 'terminal_status') {
              handleStatus(payload as TerminalStatusPayload);
            }
          },
          onFocus() {
            log('focus', panelId);
            requestFocus();
          },
          onBlur() {
            log('blur', panelId);
            term?.blur();
          },
          onResize() {
            fitAddon?.fit();
          },
          onVisibilityChange(visible: boolean) {
            if (!visible || !fitAddon) {
              return;
            }
            requestAnimationFrame(() => {
              fitAddon?.fit();
            });
          },
          unmount() {
            log('unmount', panelId);
            isMounted = false;
            detachFocusListeners();
            disposables.forEach((disposable) => {
              disposable?.dispose?.();
            });
            disposables = [];
            fitAddon?.dispose();
            term?.dispose();
            container.classList.remove('terminal-panel');
            container.innerHTML = '';
            term = null;
            fitAddon = null;
            body = null;
            statusEl = null;
            host = null;
            panelId = null;
            currentFontFamily = null;
          },
        };
      },
    };
  });
}
