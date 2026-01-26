export type ListItemPanelReference = {
  kind: 'panel';
  panelType: string;
  id: string;
  instanceId?: string;
  label?: string;
};

export type ListItemReference = ListItemPanelReference;

const normalizeString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export function parseListItemReference(value: unknown): ListItemReference | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const raw = value as Record<string, unknown>;
  if (raw['kind'] !== 'panel') {
    return null;
  }
  const panelType = normalizeString(raw['panelType']);
  const id = normalizeString(raw['id']);
  if (!panelType || !id) {
    return null;
  }
  const instanceId = normalizeString(raw['instanceId']);
  const label = normalizeString(raw['label']);
  const reference: ListItemPanelReference = {
    kind: 'panel',
    panelType,
    id,
    ...(instanceId ? { instanceId } : {}),
    ...(label ? { label } : {}),
  };
  return reference;
}

export function formatListItemReferenceLabel(reference: ListItemReference): string {
  const label = reference.label?.trim() || reference.id;
  return label.trim();
}

export function getListItemReferenceTypeLabel(panelType: string): string {
  const normalized = panelType.trim().toLowerCase();
  if (normalized === 'notes' || normalized === 'note') {
    return 'Note';
  }
  if (normalized === 'lists' || normalized === 'list') {
    return 'List';
  }
  return panelType;
}

export function getListItemReferenceSearchText(value: unknown): string {
  const reference = parseListItemReference(value);
  if (!reference) {
    return '';
  }
  const parts = [
    formatListItemReferenceLabel(reference),
    reference.panelType,
    reference.id,
    reference.instanceId ?? '',
  ].filter((part) => part.trim().length > 0);
  return parts.join(' ');
}
