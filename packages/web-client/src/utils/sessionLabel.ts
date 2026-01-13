export type SessionLabelSummary = {
  sessionId: string;
  name?: string;
  agentId?: string;
  attributes?: Record<string, unknown>;
};

export type AgentLabelSummary = {
  agentId: string;
  displayName: string;
};

type SessionLabelOptions = {
  agentSummaries?: AgentLabelSummary[];
  includeId?: boolean;
};

export function formatSessionLabel(
  summary: SessionLabelSummary,
  options?: SessionLabelOptions,
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

export function resolveAutoTitle(attributes?: Record<string, unknown>): string {
  if (!attributes || typeof attributes !== 'object') {
    return '';
  }
  const core = (attributes as Record<string, unknown>)['core'];
  if (!core || typeof core !== 'object') {
    return '';
  }
  const autoTitle = (core as Record<string, unknown>)['autoTitle'];
  if (typeof autoTitle !== 'string') {
    return '';
  }
  return autoTitle.trim();
}

function resolveBaseLabel(
  summary: SessionLabelSummary,
  agentSummaries?: AgentLabelSummary[],
): string {
  const name = typeof summary.name === 'string' ? summary.name.trim() : '';
  if (name) {
    return name;
  }
  const autoTitle = resolveAutoTitle(summary.attributes);
  if (autoTitle) {
    return autoTitle;
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
