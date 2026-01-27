export type PanelHeaderActions = {
  openInstancePicker?: () => boolean;
};

const PANEL_HEADER_ACTIONS_PREFIX = 'panel.header.actions';

export function getPanelHeaderActionsKey(panelId: string): string {
  return `${PANEL_HEADER_ACTIONS_PREFIX}.${panelId}`;
}
