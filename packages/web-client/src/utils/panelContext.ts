export type PanelContextSummary = Record<string, unknown>;

export function getPanelContextKey(panelId: string): string {
  return `panel.context.${panelId}`;
}
