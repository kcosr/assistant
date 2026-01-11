import type { PanelBinding, SessionContext } from '@assistant/shared';

type PanelHost = {
  getBinding(): PanelBinding | null;
  setBinding(binding: PanelBinding | null): void;
  onBindingChange(handler: (binding: PanelBinding | null) => void): () => void;
  getSessionContext(): SessionContext | null;
  subscribeSessionContext(handler: (ctx: SessionContext | null) => void): () => void;
  getContext(key: string): unknown;
  subscribeContext(key: string, handler: (value: unknown) => void): () => void;
};

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

      const body = document.createElement('div');
      body.className = 'panel-body session-info-panel-body';

      const header = document.createElement('div');
      header.className = 'session-info-panel-header';

      const title = document.createElement('div');
      title.className = 'session-info-panel-title';
      title.textContent = 'Session Info';

      const bindingButton = document.createElement('button');
      bindingButton.type = 'button';
      bindingButton.className = 'session-info-panel-binding';
      bindingButton.setAttribute('aria-label', 'Select session');
      bindingButton.setAttribute('aria-haspopup', 'menu');

      header.appendChild(title);
      header.appendChild(bindingButton);

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

      body.appendChild(header);
      body.appendChild(emptyState);
      body.appendChild(bindingLine);
      body.appendChild(sessionLine);
      body.appendChild(nameLine);
      body.appendChild(labelLabel);
      body.appendChild(labelBox);
      body.appendChild(attributesLabel);
      body.appendChild(attributes);
      container.appendChild(body);

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
        unmount() {
          for (const unsubscribe of unsubscribes) {
            try {
              unsubscribe();
            } catch {
              // Ignore teardown errors.
            }
          }
          container.classList.remove('session-info-panel');
          container.innerHTML = '';
        },
      };
    },
  }));
}
