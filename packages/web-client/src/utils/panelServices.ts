import type { ContextMenuManager } from '../controllers/contextMenu';
import type { DialogManager } from '../controllers/dialogManager';
import type { SessionPickerOpenOptions } from '../controllers/panelSessionPicker';
import type { ListColumnPreferencesClient } from './listColumnPreferences';

export const CORE_PANEL_SERVICES_CONTEXT_KEY = 'core.services';

export interface PanelCoreServices {
  dialogManager: DialogManager;
  contextMenuManager: ContextMenuManager;
  listColumnPreferencesClient: ListColumnPreferencesClient;
  focusInput: () => void;
  setStatus: (text: string) => void;
  isMobileViewport: () => boolean;
  notifyContextAvailabilityChange: () => void;
  /** Request the active panel to clear any text/item selection */
  clearContextSelection?: () => void;
  openSessionPicker?: (options: SessionPickerOpenOptions) => void;
}
