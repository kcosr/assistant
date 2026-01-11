export type SessionLabelSummary = {
  sessionId: string;
  name?: string;
  agentId?: string;
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

function resolveBaseLabel(
  summary: SessionLabelSummary,
  agentSummaries?: AgentLabelSummary[],
): string {
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
