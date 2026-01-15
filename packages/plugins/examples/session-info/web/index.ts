import type { PanelBinding, SessionContext } from '@assistant/shared';
import type { PanelHost } from '../../../../web-client/src/controllers/panelRegistry';
import { PanelChromeController } from '../../../../web-client/src/controllers/panelChromeController';

type SessionSummary = {
  sessionId: string;
  name?: string;
  agentId?: string;
};

type AgentLabelSummary = {
  agentId: string;
  displayName: string;
};

type SessionPickerOpenOptions = {
  anchor: HTMLElement;
  title: string;
  allowUnbound?: boolean;
  createSessionOptions?: {
    openChatPanel?: boolean;
    selectSession?: boolean;
  };
  onSelectSession: (sessionId: string) => void;
  onSelectUnbound?: () => void;
};

type PanelCoreServices = {
  openSessionPicker?: (options: SessionPickerOpenOptions) => void;
};

const CORE_PANEL_SERVICES_CONTEXT_KEY = 'core.services';

type SessionInfoAttributes = {
  sessionInfo?: {
    label?: string;
  };
};

function resolveCoreServices(host: PanelHost): PanelCoreServices | null {
  const raw = host.getContext(CORE_PANEL_SERVICES_CONTEXT_KEY);
  if (raw && typeof raw === 'object') {
    return raw as PanelCoreServices;
  }
  return null;
}

function formatBinding(binding: PanelBinding | null): string {
  if (!binding || !binding.mode) {
    return 'Unbound';
  }
  if (binding.mode === 'fixed') {
    return `fixed (${binding.sessionId})`;
  }
  return binding.mode;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return String(value);
  }
}

function normalizeSummaries(raw: unknown): SessionSummary[] {
  return Array.isArray(raw) ? (raw as SessionSummary[]) : [];
}

function normalizeAgentSummaries(raw: unknown): AgentLabelSummary[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const summaries: AgentLabelSummary[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const typed = entry as { agentId?: unknown; displayName?: unknown };
    const agentId = typeof typed.agentId === 'string' ? typed.agentId.trim() : '';
    if (!agentId) {
      continue;
    }
    const displayName = typeof typed.displayName === 'string' ? typed.displayName.trim() : '';
    summaries.push({ agentId, displayName: displayName || agentId });
  }
  return summaries;
}

function getSessionAttributeLabel(attributes: unknown): string | null {
  if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) {
    return null;
  }
  const sessionInfo = (attributes as SessionInfoAttributes).sessionInfo;
  if (!sessionInfo || typeof sessionInfo !== 'object' || Array.isArray(sessionInfo)) {
    return null;
  }
  const label = sessionInfo.label;
  if (typeof label !== 'string' || label.trim().length === 0) {
    return null;
  }
  return label.trim();
}

function getSessionName(summaries: SessionSummary[], sessionId: string | null): string | null {
  if (!sessionId) {
    return null;
  }
  for (const entry of summaries) {
    if (entry && entry.sessionId === sessionId) {
      return entry.name || null;
    }
  }
  return null;
}

function formatSessionLabel(
  summary: SessionSummary,
  options?: { agentSummaries?: AgentLabelSummary[]; includeId?: boolean },
): string {
  const baseLabel = resolveBaseLabel(summary, options?.agentSummaries);
  const idLabel = summary.sessionId.slice(0, 8);
  if (!baseLabel) {
    return idLabel;
  }
  if (options?.includeId === false) {
    return baseLabel;
  }
  return `${baseLabel} (${idLabel})`;
}

function resolveBaseLabel(summary: SessionSummary, agentSummaries?: AgentLabelSummary[]): string {
  const name = typeof summary.name === 'string' ? summary.name.trim() : '';
  if (name) {
    return name;
  }
  const agentId = typeof summary.agentId === 'string' ? summary.agentId.trim() : '';
  if (!agentId) {
    return '';
  }
  const displayName = agentSummaries?.find((agent) => agent.agentId === agentId)?.displayName ?? '';
  if (displayName && displayName.trim()) {
    return displayName.trim();
  }
  return formatAgentId(agentId);
}

function formatAgentId(agentId: string): string {
  const trimmed = agentId.trim();
  if (!trimmed) {
    return '';
  }
  if (/[A-Z]/.test(trimmed)) {
    return trimmed;
  }
  const parts = trimmed.split(/[_-\s]+/).filter(Boolean);
  if (parts.length <= 1) {
    return capitalize(trimmed);
  }
  return parts.map(capitalize).join(' ');
}

function capitalize(value: string): string {
  if (!value) {
    return '';
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function getSessionDisplayLabel(
  summaries: SessionSummary[],
  agents: AgentLabelSummary[],
  sessionId: string | null,
): string {
  if (!sessionId) {
    return 'Select session';
  }
  const summary = summaries.find((candidate) => candidate.sessionId === sessionId) ?? { sessionId };
  return formatSessionLabel(summary, { agentSummaries: agents });
}

const registry = window.ASSISTANT_PANEL_REGISTRY;
if (!registry || typeof registry.registerPanel !== 'function') {
  console.warn('ASSISTANT_PANEL_REGISTRY is not available for session-info plugin.');
} else {
  registry.registerPanel('session-info', () => ({
    mount(container: HTMLElement, host: PanelHost) {
      container.classList.add('session-info-panel');
      container.innerHTML = '';

      const header = document.createElement('div');
      header.className = 'panel-header panel-chrome-row session-info-panel-header';
      header.setAttribute('data-role', 'chrome-row');
      header.innerHTML = `
        <div class="panel-header-main">
          <span class="panel-header-label" data-role="chrome-title">Session Info</span>
        </div>
        <div class="panel-chrome-plugin-controls session-info-panel-plugin-controls" data-role="chrome-plugin-controls">
          <button
            type="button"
            class="session-info-panel-binding"
            data-role="session-info-binding"
            aria-label="Select session"
            aria-haspopup="menu"
          ></button>
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
      `;

      const body = document.createElement('div');
      body.className = 'panel-body session-info-panel-body';

      const bindingButton = header.querySelector<HTMLButtonElement>('[data-role="session-info-binding"]');
      if (!bindingButton) {
        throw new Error('Missing session info binding button.');
      }

      const emptyState = document.createElement('div');
      emptyState.className = 'session-info-panel-empty';
      emptyState.textContent = 'Select a session to view details.';

      const bindingLine = document.createElement('div');
      bindingLine.className = 'session-info-panel-row';

      const sessionLine = document.createElement('div');
      sessionLine.className = 'session-info-panel-row';

      const nameLine = document.createElement('div');
      nameLine.className = 'session-info-panel-row';

      const labelLabel = document.createElement('div');
      labelLabel.className = 'session-info-panel-label';
      labelLabel.textContent = 'Label';

      const labelBox = document.createElement('div');
      labelBox.className = 'session-info-panel-label-box';

      const attributesLabel = document.createElement('div');
      attributesLabel.className = 'session-info-panel-label';
      attributesLabel.textContent = 'Attributes';

      const attributes = document.createElement('pre');
      attributes.className = 'session-info-panel-attributes';

      body.appendChild(emptyState);
      body.appendChild(bindingLine);
      body.appendChild(sessionLine);
      body.appendChild(nameLine);
      body.appendChild(labelLabel);
      body.appendChild(labelBox);
      body.appendChild(attributesLabel);
      body.appendChild(attributes);
      container.appendChild(header);
      container.appendChild(body);

      const chromeController = new PanelChromeController({
        root: container,
        host,
        title: 'Session Info',
      });

      let binding = host.getBinding();
      let summaries = normalizeSummaries(host.getContext('session.summaries'));
      let agentSummaries = normalizeAgentSummaries(host.getContext('agent.summaries'));
      const coreServices = resolveCoreServices(host);
      const openSessionPicker = coreServices?.openSessionPicker ?? null;

      if (openSessionPicker) {
        bindingButton.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          openSessionPicker({
            anchor: bindingButton,
            title: 'Select session',
            allowUnbound: true,
            createSessionOptions: { openChatPanel: false, selectSession: false },
            onSelectSession: (sessionId) => {
              host.setBinding({ mode: 'fixed', sessionId });
            },
            onSelectUnbound: () => {
              host.setBinding(null);
            },
          });
        });
      } else {
        bindingButton.classList.add('is-static');
        bindingButton.disabled = true;
      }

      const render = (ctx: SessionContext | null) => {
        const sessionId = ctx?.sessionId ?? null;
        const isBound = Boolean(sessionId);
        container.classList.toggle('is-unbound', !isBound);
        container.setAttribute('aria-disabled', isBound ? 'false' : 'true');
        emptyState.style.display = isBound ? 'none' : '';
        bindingLine.textContent = `Binding: ${formatBinding(binding)}`;
        sessionLine.textContent = `Session: ${sessionId ?? 'None'}`;
        const sessionName = getSessionName(summaries, sessionId);
        nameLine.textContent = `Name: ${sessionName || 'Untitled'}`;
        const attributesValue = ctx?.attributes ?? {};
        const label = getSessionAttributeLabel(attributesValue);
        labelBox.textContent = label || (isBound ? 'No label set' : 'Select a session');
        labelBox.classList.toggle('empty', !label);
        const sessionLabel = getSessionDisplayLabel(summaries, agentSummaries, sessionId);
        bindingButton.textContent = sessionLabel;
        bindingButton.title = sessionLabel;
        bindingButton.setAttribute(
          'aria-label',
          sessionId ? `Session: ${sessionLabel}` : 'Select session',
        );
        bindingButton.classList.toggle('is-unbound', !sessionId);
        chromeController.scheduleLayoutCheck();
        if (isBound) {
          attributes.classList.remove('empty');
          attributes.textContent = safeStringify(attributesValue);
        } else {
          attributes.classList.add('empty');
          attributes.textContent = 'Select a session to view attributes.';
        }
      };

      const updateSummaries = (raw: unknown) => {
        summaries = normalizeSummaries(raw);
        render(host.getSessionContext());
      };

      const updateAgents = (raw: unknown) => {
        agentSummaries = normalizeAgentSummaries(raw);
        render(host.getSessionContext());
      };

      render(host.getSessionContext());

      const unsubscribes: Array<() => void> = [];
      const unsubscribeContext = host.subscribeSessionContext((ctx) => {
        render(ctx);
      });
      if (typeof unsubscribeContext === 'function') {
        unsubscribes.push(unsubscribeContext);
      }

      const unsubscribeBinding = host.onBindingChange((nextBinding) => {
        binding = nextBinding;
        render(host.getSessionContext());
      });
      if (typeof unsubscribeBinding === 'function') {
        unsubscribes.push(unsubscribeBinding);
      }

      const unsubscribeSummaries = host.subscribeContext('session.summaries', updateSummaries);
      if (typeof unsubscribeSummaries === 'function') {
        unsubscribes.push(unsubscribeSummaries);
      }

      const unsubscribeAgents = host.subscribeContext('agent.summaries', updateAgents);
      if (typeof unsubscribeAgents === 'function') {
        unsubscribes.push(unsubscribeAgents);
      }

      return {
        onVisibilityChange: (visible) => {
          if (visible) {
            chromeController.scheduleLayoutCheck();
          }
        },
        unmount() {
          for (const unsubscribe of unsubscribes) {
            try {
              unsubscribe();
            } catch {
              // Ignore teardown errors.
            }
          }
          container.classList.remove('session-info-panel');
          chromeController.destroy();
          container.innerHTML = '';
        },
      };
    },
  }));
}
