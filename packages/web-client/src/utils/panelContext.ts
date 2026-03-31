export type PanelContextSummary = Record<string, unknown>;

export function getPanelContextKey(panelId: string): string {
  return `panel.context.${panelId}`;
}

export function getPanelTitleContextKey(panelId: string): string {
  return `panel.title.${panelId}`;
}
