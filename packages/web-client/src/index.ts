import {
  safeValidateServerMessage,
  type ChatEvent,
  type CombinedPluginManifest,
  type PanelBinding,
  type PanelEventEnvelope,
  type PanelPlacement,
  type PanelStatus,
  type PanelTypeManifest,
  type ServerMessage,
  type SessionAttributesPatch,
  CURRENT_PROTOCOL_VERSION,
  GLOBAL_QUERY_CONTEXT_KEY,
} from '@assistant/shared';
import { DialogManager } from './controllers/dialogManager';
import { ContextMenuManager } from './controllers/contextMenu';
import { SettingsDropdownController } from './controllers/settingsDropdown';
import { ConnectionManager } from './controllers/connectionManager';
import { SessionManager, type CreateSessionOptions } from './controllers/sessionManager';
import { ServerMessageHandler } from './controllers/serverMessageHandler';
import { KeyboardNavigationController } from './controllers/keyboardNavigationController';
import { SessionDataController } from './controllers/sessionDataController';
import { TagColorManagerDialog } from './controllers/tagColorManagerDialog';
import { SessionTypingIndicatorController } from './controllers/sessionTypingIndicatorController';
import { GlobalAqlHeaderController } from './controllers/globalAqlHeaderController';
import type { CollectionItemSummary } from './controllers/collectionTypes';
import { PanelRegistry, type PanelFactory, type PanelHost } from './controllers/panelRegistry';
import { PanelHostController } from './controllers/panelHostController';
import { PanelLauncherController } from './controllers/panelLauncherController';
import {
  CommandPaletteController,
  type GlobalSearchOptions,
  type LaunchAction,
  type SearchApiResult,
  type SearchApiResponse,
  type SearchableScope,
} from './controllers/commandPaletteController';
import { PanelWorkspaceController } from './controllers/panelWorkspaceController';
import {
  closeShareModal,
  initShareTarget,
  isShareModalVisible,
} from './controllers/shareTargetController';
import type { InteractionResponseDraft } from './utils/interactionRenderer';
import {
  SessionPickerController,
  type SessionPickerOpenOptions,
} from './controllers/panelSessionPicker';
import type { ChatRuntime } from './panels/chat';
import type { ChatPanelDom } from './panels/chat/chatPanel';
import { createInputRuntime, type InputRuntime } from './panels/input/runtime';
import { EMPTY_PANEL_MANIFEST, createEmptyPanel } from './panels/empty';
import { WORKSPACE_NAVIGATOR_PANEL_MANIFEST } from './panels/workspaceNavigator/manifest';
import { createWorkspaceNavigatorPanel } from './panels/workspaceNavigator/workspaceNavigatorPanel';
import { createPlaceholderPanel } from './panels/placeholderPanel';
import {
  SESSIONS_PANEL_MANIFEST,
  createSessionsPanel,
  type SessionsRuntime,
  type SessionsRuntimeOptions,
} from './panels/sessions';
import { getWebClientElements } from './utils/webClientElements';
import {
  KeyboardShortcutRegistry,
  createShortcutService,
} from './utils/keyboardShortcuts';
import { applyTagColorsToRoot } from './utils/tagColors';
import { setupCommandPaletteFab } from './utils/commandPaletteFab';
import { loadClientPreferences, wirePreferencesCheckboxes } from './utils/clientPreferences';
import {
  applyThemePreferences,
  CODE_FONT_OPTIONS,
  loadThemePreferences,
  saveThemePreferences,
  THEME_OPTIONS,
  UI_FONT_OPTIONS,
  watchSystemThemeChanges,
} from './utils/themeManager';
import { getPanelContextKey } from './utils/panelContext';
import type { ContextPreviewData } from './controllers/contextPreviewController';
import {
  appendExternalSentIndicator,
  appendMessage,
  buildContextLine,
  scrollMessageIntoView,
  setAssistantBubbleTyping,
  setStatus,
  stripContextLine,
} from './utils/chatMessageRenderer';
import { ensureEmptySessionHint } from './utils/emptySessionHint';
import { ListColumnPreferencesClient } from './utils/listColumnPreferences';
import { ToolOutputPreferencesClient } from './utils/toolOutputPreferences';
import { ThinkingPreferencesClient } from './utils/thinkingPreferences';
import { PluginSettingsClient } from './utils/pluginSettingsClient';
import { shouldAutoOpenSessionPicker } from './utils/sessionPickerAutoOpen';
import { PluginBundleLoader } from './utils/pluginBundleLoader';
import { ICONS } from './utils/icons';
import { formatSessionLabel, resolveAutoTitle } from './utils/sessionLabel';
import { CORE_PANEL_SERVICES_CONTEXT_KEY, type PanelCoreServices } from './utils/panelServices';
import {
  getPanelHeaderActionsKey,
  type PanelHeaderActions,
} from './utils/panelHeaderActions';
import { CHAT_PANEL_SERVICES_CONTEXT_KEY, type ChatPanelServices } from './utils/chatPanelServices';
import {
  createWindowSlot,
  getClientWindowId,
  listWindowSlotStatuses,
  removeWindowSlot,
  resetWindowSlotState,
  setWindowSlotName,
  setClientWindowId,
  startWindowSlotHeartbeat,
} from './utils/windowId';

const PROTOCOL_VERSION = CURRENT_PROTOCOL_VERSION;

const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_DELAY_MS = 30000;
const WS_DEBUG_STORAGE_KEY = 'aiAssistantWsDebug';
const WINDOW_ID = getClientWindowId();
startWindowSlotHeartbeat(WINDOW_ID);

const isDebugFlagEnabled = (key: string): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    const stored = window.localStorage?.getItem(key);
    return stored === '1' || stored === 'true';
  } catch {
    return false;
  }
};

const isWsDebugEnabled = (): boolean => isDebugFlagEnabled(WS_DEBUG_STORAGE_KEY);

const logWsMessage = (message: ServerMessage): void => {
  if (!isWsDebugEnabled()) {
    return;
  }
  const anyMessage = message as Record<string, unknown>;
  const rawType = anyMessage['type'];
  const type = typeof rawType === 'string' ? rawType : 'unknown';
  if (type === 'panel_event') {
    const payload = anyMessage['payload'] as { type?: unknown } | null;
    const payloadType = typeof payload?.type === 'string' ? payload.type : null;
    console.log('[ws] panel_event', {
      panelId: anyMessage['panelId'] ?? null,
      panelType: anyMessage['panelType'] ?? null,
      sessionId: anyMessage['sessionId'] ?? null,
      payloadType,
    });
    return;
  }
  if (type === 'chat_event') {
    const event = anyMessage['event'] as { type?: unknown } | null;
    const eventType = typeof event?.type === 'string' ? event.type : null;
    console.log('[ws] chat_event', {
      sessionId: anyMessage['sessionId'] ?? null,
      eventType,
    });
    return;
  }
  console.log('[ws] message', { type, message });
};

interface SessionSummary {
  agentId?: string;
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  /**
   * When set, indicates that the session is pinned in the UI.
   * The value is the timestamp when the session was pinned and
   * is used for ordering pinned sessions (most recently pinned first).
   */
  pinnedAt?: string;
  /**
   * Optional user-defined session name.
   */
  name?: string;
  /**
   * Optional session-scoped attributes for plugins/panels.
   */
  attributes?: Record<string, unknown>;
  lastSnippet?: string;
  /**
   * Optional selected model for this session.
   */
  model?: string;
  /**
   * Optional selected thinking level for this session.
   */
  thinking?: string;
}

interface AgentSummary {
  agentId: string;
  displayName: string;
  description?: string;
  type?: 'chat' | 'external';
  sessionWorkingDirMode?: 'auto' | 'prompt';
  sessionWorkingDirRoots?: string[];
}

import { apiFetch, getWebSocketUrl } from './utils/api';
import {
  configureStatusBar,
  enableAppReloadOnResume,
  isCapacitorAndroid,
  setupBackButtonHandler,
} from './utils/capacitor';
import { configureTauri, isTauri, waitForTauriProxyReady } from './utils/tauri';
import { initPushNotifications } from './utils/pushNotifications';
import { readSessionOperationResult, sessionsOperationPath } from './utils/sessionsApi';

function createWebSocketUrl(): string {
  return getWebSocketUrl();
}

function isMobileViewport(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    if (typeof window.matchMedia === 'function') {
      return window.matchMedia('(max-width: 600px)').matches;
    }
  } catch {
    // Ignore matchMedia errors and fall back to window size.
  }

  return window.innerWidth <= 600;
}

const listColumnPreferencesClient = new ListColumnPreferencesClient();
const toolOutputPreferencesClient = new ToolOutputPreferencesClient();
const thinkingPreferencesClient = new ThinkingPreferencesClient();
const pluginSettingsClient = new PluginSettingsClient();

async function main(): Promise<void> {
  // Configure Tauri backend URL (no-op if not in Tauri) - must run before WebSocket setup
  await configureTauri();
  if (isTauri()) {
    await waitForTauriProxyReady();
  }

  // Configure Capacitor status bar (no-op if not in Capacitor)
  void configureStatusBar();

  // Reload app on resume for Capacitor builds (no-op if not in Capacitor)
  void enableAppReloadOnResume();

  // Initialize push notifications (no-op if not in Capacitor)
  void initPushNotifications();

  function isSpeechFeatureEnabled(): boolean {
    if (typeof window === 'undefined') {
      return false;
    }

    const global = window as unknown as {
      __ASSISTANT_ENABLE_SPEECH__?: unknown;
      localStorage?: Storage;
    };

    try {
      const flag = global.localStorage?.getItem('aiAssistantEnableSpeech');
      if (flag === '0' || flag === 'false') {
        return false;
      }
      if (flag === '1' || flag === 'true') {
        return true;
      }
    } catch {
      // Ignore localStorage errors and fall back to global flag / default.
    }

    if (global.__ASSISTANT_ENABLE_SPEECH__ === false) {
      return false;
    }

    if (global.__ASSISTANT_ENABLE_SPEECH__ === true) {
      return true;
    }

    // Default: enable speech features when supported.
    return true;
  }

  const elements = getWebClientElements();
  if (!elements) {
    return;
  }

  const panelRegistry = new PanelRegistry();
  const sessionsRuntimes = new Set<SessionsRuntime>();
  type ChatPanelEntry = {
    panelId: string;
    runtime: ChatRuntime;
    inputRuntime: InputRuntime;
    dom: ChatPanelDom;
    bindingSessionId: string | null;
  };
  const chatPanelsById = new Map<string, ChatPanelEntry>();
  const chatPanelIdBySession = new Map<string, string>();
  const loadedChatTranscripts = new Set<string>();

  await listColumnPreferencesClient.load();
  await toolOutputPreferencesClient.load();
  await thinkingPreferencesClient.load();

  const {
    status: statusEl,
    controlsToggleButton: controlsToggleButtonEl,
    audioResponsesCheckbox: audioResponsesCheckboxEl,
    includeContextCheckbox: includeContextCheckboxEl,
    showContextCheckbox: showContextCheckboxEl,
    listInsertAtTopCheckbox: listInsertAtTopCheckboxEl,
    listItemSingleClickSelect: listItemSingleClickSelectEl,
    listInlineCustomFieldEditingCheckbox: listInlineCustomFieldEditingCheckboxEl,
    listItemEditorModeSelect: listItemEditorModeSelectEl,
    autoFocusChatCheckbox: autoFocusChatCheckboxEl,
    keyboardShortcutsCheckbox: keyboardShortcutsCheckboxEl,
    autoScrollCheckbox: autoScrollCheckboxEl,
    interactionModeCheckbox: interactionModeCheckboxEl,
    panelWorkspace: panelWorkspaceRoot,
    windowDropdownButton,
    windowDropdown,
    windowSlotList,
    windowSlotNewButton,
    windowSlotResetButton,
    settingsDropdown,
    themeSelect,
    uiFontSelect,
    codeFontSelect,
    tagColorsSettingsButton,
    resetLayoutButton,
    resetPanelStateButton,
    layoutDropdownButton,
    layoutDropdown,
    panelLauncherButton,
    panelLauncher,
    panelLauncherList,
    panelLauncherSearch,
    panelLauncherCloseButton,
    panelHeaderDock,
    globalAqlHeader,
    globalAqlToggleButton,
    commandPaletteButton,
    commandPaletteFab,
    commandPalette,
    commandPalettePanel,
    commandPaletteInput,
    commandPaletteGhost,
    commandPaletteResults,
    commandPaletteSortButton,
    commandPaletteCloseButton,
  } = elements;

  if (commandPaletteSortButton) {
    commandPaletteSortButton.innerHTML = ICONS.sortAlpha;
  }
  if (globalAqlToggleButton) {
    globalAqlToggleButton.innerHTML = ICONS.search;
  }

  const builtInPanels = new Map<string, { manifest: PanelTypeManifest; factory: PanelFactory }>();
  const registerBuiltInPanel = (manifest: PanelTypeManifest, factory: PanelFactory): void => {
    builtInPanels.set(manifest.type, { manifest, factory });
    if (!panelRegistry.has(manifest.type)) {
      panelRegistry.register(manifest, factory);
    }
  };

  registerBuiltInPanel(
    SESSIONS_PANEL_MANIFEST,
    createSessionsPanel({
      getRuntimeOptions: getSessionsRuntimeOptions,
      onRuntimeReady: (runtime) => {
        sessionsRuntimes.add(runtime);
      },
      onRuntimeRemoved: (runtime) => {
        sessionsRuntimes.delete(runtime);
      },
      onDeleteAll: () => {
        showDeleteAllConfirmation();
      },
    }),
  );
  registerBuiltInPanel(WORKSPACE_NAVIGATOR_PANEL_MANIFEST, createWorkspaceNavigatorPanel());
  registerBuiltInPanel(EMPTY_PANEL_MANIFEST, createEmptyPanel());

  let socket: WebSocket | null = null;

  const speechFeaturesEnabled = isSpeechFeatureEnabled();
  const AUDIO_RESPONSES_STORAGE_KEY = 'aiAssistantAudioResponsesEnabled';
  const KEYBOARD_SHORTCUTS_STORAGE_KEY = 'aiAssistantKeyboardShortcutsEnabled';
  const KEYBOARD_SHORTCUT_BINDINGS_STORAGE_KEY = 'aiAssistantKeyboardShortcutBindings';
  const AUTO_FOCUS_CHAT_STORAGE_KEY = 'aiAssistantAutoFocusChatOnSessionReady';
  const AUTO_SCROLL_STORAGE_KEY = 'aiAssistantAutoScrollEnabled';
  const INTERACTION_MODE_STORAGE_KEY = 'aiAssistantInteractiveModeEnabled';
  const SHOW_CONTEXT_STORAGE_KEY = 'aiAssistantShowContextEnabled';
  const INCLUDE_PANEL_CONTEXT_STORAGE_KEY = 'aiAssistantIncludePanelContext';
  const BRIEF_MODE_STORAGE_KEY = 'aiAssistantBriefModeEnabled';
  const LIST_INSERT_AT_TOP_STORAGE_KEY = 'aiAssistantListInsertAtTop';
  const LIST_ITEM_SINGLE_CLICK_BEHAVIOR_STORAGE_KEY =
    'aiAssistantListSingleClickSelectionEnabled';
  const LIST_INLINE_CUSTOM_FIELD_EDITING_STORAGE_KEY =
    'aiAssistantListInlineCustomFieldEditingEnabled';
  const LIST_ITEM_EDITOR_DEFAULT_MODE_STORAGE_KEY = 'aiAssistantListItemEditorDefaultMode';

  const initialPreferences = loadClientPreferences({
    audioResponsesStorageKey: AUDIO_RESPONSES_STORAGE_KEY,
    keyboardShortcutsStorageKey: KEYBOARD_SHORTCUTS_STORAGE_KEY,
    keyboardShortcutsBindingsStorageKey: KEYBOARD_SHORTCUT_BINDINGS_STORAGE_KEY,
    autoFocusChatStorageKey: AUTO_FOCUS_CHAT_STORAGE_KEY,
    autoScrollStorageKey: AUTO_SCROLL_STORAGE_KEY,
    showContextStorageKey: SHOW_CONTEXT_STORAGE_KEY,
  });

  const initialAudioResponsesEnabled = initialPreferences.audioResponsesEnabled;
  let keyboardShortcutsEnabled = initialPreferences.keyboardShortcutsEnabled;
  const keyboardShortcutBindings = initialPreferences.keyboardShortcutBindings;
  let autoFocusChatOnSessionReady = initialPreferences.autoFocusChatOnSessionReady;
  let autoScrollEnabled = initialPreferences.autoScrollEnabled;
  let showContextEnabled = initialPreferences.showContextEnabled;
  let includePanelContext = true;
  let interactionEnabled = true;

  const updateInteractionElementsEnabled = (enabled: boolean): void => {
    const blocks = document.querySelectorAll<HTMLElement>('.interaction-block');
    for (const block of blocks) {
      if (block.classList.contains('interaction-complete')) {
        continue;
      }
      const controls = block.querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement
      >('input, select, textarea, button');
      for (const control of controls) {
        control.disabled = !enabled;
      }
      const actions = block.querySelectorAll<HTMLElement>('.interaction-actions, .interaction-form');
      for (const action of actions) {
        action.classList.toggle('disabled', !enabled);
      }
      const existingHint = block.querySelector<HTMLElement>('.interaction-hint');
      if (!enabled && !existingHint) {
        const hint = document.createElement('div');
        hint.className = 'interaction-hint';
        hint.textContent = 'Interactive mode disabled — enable to respond.';
        block.appendChild(hint);
      } else if (enabled && existingHint) {
        existingHint.remove();
      }
    }
  };

  const applyInteractionEnabled = (enabled: boolean, options?: { persist?: boolean }): void => {
    const persist = options?.persist ?? true;
    interactionEnabled = enabled;
    if (interactionModeCheckboxEl) {
      interactionModeCheckboxEl.checked = enabled;
    }
    updateInteractionElementsEnabled(enabled);
    if (connectionManager) {
      connectionManager.setInteractionEnabled(enabled);
    }
    if (!persist) {
      return;
    }
    try {
      localStorage.setItem(INTERACTION_MODE_STORAGE_KEY, enabled ? 'true' : 'false');
    } catch {
      // Ignore localStorage errors.
    }
  };

  // Set global flag for stripContextLine to use
  const updateShowContextFlag = (enabled: boolean): void => {
    (globalThis as { __ASSISTANT_HIDE_CONTEXT__?: boolean }).__ASSISTANT_HIDE_CONTEXT__ = !enabled;
  };
  updateShowContextFlag(showContextEnabled);
  let briefModeEnabled = false;
  let listInsertAtTopEnabled = false;
  let listItemSingleClickBehavior: 'none' | 'select' | 'open' | 'open-review' = 'select';

  const normalizeListItemSingleClickBehavior = (
    value: string | null,
  ): 'none' | 'select' | 'open' | 'open-review' => {
    if (value === 'open') {
      return 'open';
    }
    if (value === 'open-review') {
      return 'open-review';
    }
    if (value === 'none' || value === 'false') {
      return 'none';
    }
    if (value === 'select' || value === 'true') {
      return 'select';
    }
    return 'select';
  };
  let listInlineCustomFieldEditingEnabled = true;
  let listItemEditorDefaultMode: 'quick' | 'review' = 'quick';

  try {
    const storedIncludeContext = localStorage.getItem(INCLUDE_PANEL_CONTEXT_STORAGE_KEY);
    if (storedIncludeContext === 'true') {
      includePanelContext = true;
    } else if (storedIncludeContext === 'false') {
      includePanelContext = false;
    }
    const storedBriefMode = localStorage.getItem(BRIEF_MODE_STORAGE_KEY);
    if (storedBriefMode === 'true') {
      briefModeEnabled = true;
    } else if (storedBriefMode === 'false') {
      briefModeEnabled = false;
    }
    const storedInsertAtTop = localStorage.getItem(LIST_INSERT_AT_TOP_STORAGE_KEY);
    if (storedInsertAtTop === 'true') {
      listInsertAtTopEnabled = true;
    } else if (storedInsertAtTop === 'false') {
      listInsertAtTopEnabled = false;
    }
    const storedSingleClickBehavior = localStorage.getItem(
      LIST_ITEM_SINGLE_CLICK_BEHAVIOR_STORAGE_KEY,
    );
    listItemSingleClickBehavior = normalizeListItemSingleClickBehavior(
      storedSingleClickBehavior,
    );
    const storedInlineCustomFields = localStorage.getItem(
      LIST_INLINE_CUSTOM_FIELD_EDITING_STORAGE_KEY,
    );
    if (storedInlineCustomFields === 'true') {
      listInlineCustomFieldEditingEnabled = true;
    } else if (storedInlineCustomFields === 'false') {
      listInlineCustomFieldEditingEnabled = false;
    }
    const storedListItemEditorMode = localStorage.getItem(
      LIST_ITEM_EDITOR_DEFAULT_MODE_STORAGE_KEY,
    );
    if (storedListItemEditorMode === 'review' || storedListItemEditorMode === 'quick') {
      listItemEditorDefaultMode = storedListItemEditorMode;
    }
    const storedInteractionEnabled = localStorage.getItem(INTERACTION_MODE_STORAGE_KEY);
    if (storedInteractionEnabled === 'true') {
      interactionEnabled = true;
    } else if (storedInteractionEnabled === 'false') {
      interactionEnabled = false;
    }
  } catch {
    // Ignore localStorage errors
  }

  const applyIncludePanelContext = (enabled: boolean): void => {
    includePanelContext = enabled;
    if (includeContextCheckboxEl) {
      includeContextCheckboxEl.checked = enabled;
    }
    try {
      localStorage.setItem(INCLUDE_PANEL_CONTEXT_STORAGE_KEY, enabled ? 'true' : 'false');
    } catch {
      // Ignore localStorage errors.
    }
    for (const entry of chatPanelsById.values()) {
      entry.inputRuntime.setIncludePanelContext(enabled);
    }
  };

  const applyBriefModeEnabled = (enabled: boolean): void => {
    briefModeEnabled = enabled;
    try {
      localStorage.setItem(BRIEF_MODE_STORAGE_KEY, enabled ? 'true' : 'false');
    } catch {
      // Ignore localStorage errors.
    }
    for (const entry of chatPanelsById.values()) {
      entry.inputRuntime.setBriefModeEnabled(enabled);
    }
  };

  let inputSessionId: string | null = null;
  let isSettingInputSession = false;
  let pendingInputSessionId: string | null | undefined = undefined;
  let panelHostController: PanelHostController | null = null;
  let panelWorkspace: PanelWorkspaceController | null = null;
  const normalizeSessionId = (sessionId: string | null): string | null => {
    if (typeof sessionId !== 'string') {
      return null;
    }
    const trimmed = sessionId.trim();
    return trimmed.length > 0 ? trimmed : null;
  };
  const getChatPanelEntriesForSession = (sessionId: string | null): ChatPanelEntry[] => {
    const normalized = normalizeSessionId(sessionId);
    if (!normalized) {
      return [];
    }
    const entries: ChatPanelEntry[] = [];
    for (const entry of chatPanelsById.values()) {
      if (entry.bindingSessionId === normalized) {
        entries.push(entry);
      }
    }
    if (entries.length === 0) {
      chatPanelIdBySession.delete(normalized);
      return entries;
    }
    if (entries.length === 1) {
      const only = entries[0];
      if (only) {
        chatPanelIdBySession.set(normalized, only.panelId);
      }
      return entries;
    }
    const visible = panelWorkspace ? new Set(panelWorkspace.getVisiblePanelIds()) : null;
    const fallback = entries[0] ?? null;
    if (!fallback) {
      return entries;
    }
    const preferred = visible
      ? (entries.find((entry) => visible.has(entry.panelId)) ?? fallback)
      : fallback;
    chatPanelIdBySession.set(normalized, preferred.panelId);
    return entries;
  };
  const getChatPanelEntryForSession = (sessionId: string | null): ChatPanelEntry | null => {
    const entries = getChatPanelEntriesForSession(sessionId);
    if (entries.length === 0) {
      return null;
    }
    const fallback = entries[0] ?? null;
    if (!fallback) {
      return null;
    }
    if (entries.length === 1) {
      return fallback;
    }
    if (panelWorkspace) {
      const visible = new Set(panelWorkspace.getVisiblePanelIds());
      const visibleEntry = entries.find((entry) => visible.has(entry.panelId));
      if (visibleEntry) {
        return visibleEntry;
      }
    }
    return fallback;
  };
  const setInputSessionId = (sessionId: string | null): void => {
    const nextSessionId = normalizeSessionId(sessionId);
    if (isSettingInputSession) {
      pendingInputSessionId = nextSessionId;
      return;
    }
    isSettingInputSession = true;
    try {
      let currentSessionId = nextSessionId;
      while (true) {
        inputSessionId = currentSessionId;
        syncSessionContext();
        updateSessionSubscriptions();
        if (pendingInputSessionId === undefined) {
          break;
        }
        if (pendingInputSessionId === inputSessionId) {
          pendingInputSessionId = undefined;
          break;
        }
        currentSessionId = pendingInputSessionId;
        pendingInputSessionId = undefined;
      }
    } finally {
      isSettingInputSession = false;
    }
    pendingInputSessionId = undefined;
  };
  let sessionSummaries: SessionSummary[] = [];
  let agentSummaries: AgentSummary[] = [];
  const sessionsWithPendingMessages = new Set<string>();
  const sessionsWithActiveTyping = new Set<string>();
  const subscribedSessionIds = new Set<string>();
  const availableModelsBySession = new Map<string, string[]>();
  const currentModelBySession = new Map<string, string>();
  const availableThinkingBySession = new Map<string, string[]>();
  const currentThinkingBySession = new Map<string, string>();
  let pluginManifests: CombinedPluginManifest[] = [];
  let pluginManifestsLoaded = false;
  const CORE_CAPABILITIES = ['sessions.read', 'sessions.write', 'panels.read', 'panels.manage'];
  const CORE_PANEL_TYPES = ['sessions', 'navigator', 'empty'];

  function getAvailableCapabilities(): Set<string> | null {
    if (!pluginManifestsLoaded) {
      return null;
    }
    const available = new Set<string>(CORE_CAPABILITIES);
    for (const manifest of pluginManifests) {
      const pluginCaps = manifest.capabilities ?? [];
      const serverCaps = manifest.server?.capabilities ?? [];
      for (const capability of pluginCaps) {
        available.add(capability);
      }
      for (const capability of serverCaps) {
        available.add(capability);
      }
    }
    return available;
  }

  function getAvailablePanelTypes(): Set<string> | null {
    if (!pluginManifestsLoaded) {
      return null;
    }
    const available = new Set<string>(CORE_PANEL_TYPES);
    for (const manifest of pluginManifests) {
      const panels = manifest.panels ?? [];
      for (const panel of panels) {
        if (panel?.type) {
          available.add(panel.type);
        }
      }
    }
    return available;
  }

  function getSessionLabel(sessionId: string): string {
    const summary = sessionSummaries.find((candidate) => candidate.sessionId === sessionId) ?? null;
    return formatSessionLabel(summary ?? { sessionId }, { agentSummaries });
  }

  function getChatRuntimeForSession(sessionId: string): ChatRuntime | null {
    return getChatPanelEntryForSession(sessionId)?.runtime ?? null;
  }

  function getChatInputRuntimeForSession(sessionId: string): InputRuntime | null {
    return getChatPanelEntryForSession(sessionId)?.inputRuntime ?? null;
  }

  function getActiveChatInputRuntime(): InputRuntime | null {
    const active =
      (panelHostController?.getContext('panel.active') as {
        panelId: string;
        panelType: string;
      } | null) ?? null;
    if (active?.panelType === 'chat') {
      return chatPanelsById.get(active.panelId)?.inputRuntime ?? null;
    }
    if (inputSessionId) {
      return getChatInputRuntimeForSession(inputSessionId);
    }
    return null;
  }

  function getActiveChatPanelEntry(): ChatPanelEntry | null {
    const active =
      (panelHostController?.getContext('panel.active') as {
        panelId?: string;
        panelType?: string;
      } | null) ?? null;
    if (active?.panelType !== 'chat' || !active.panelId) {
      return null;
    }
    return chatPanelsById.get(active.panelId) ?? null;
  }

  function openChatPanelSelect(selectEl: HTMLSelectElement | null): boolean {
    if (!selectEl || selectEl.disabled || selectEl.classList.contains('hidden')) {
      return false;
    }
    selectEl.focus();
    selectEl.click();
    return true;
  }

  function openActiveChatSessionPicker(): boolean {
    const entry = getActiveChatPanelEntry();
    const anchor = entry?.dom.sessionLabelEl ?? null;
    if (!anchor) {
      return false;
    }
    anchor.click();
    return true;
  }

  function openActiveChatModelPicker(): boolean {
    const entry = getActiveChatPanelEntry();
    return openChatPanelSelect(entry?.dom.modelSelectEl ?? null);
  }

  function openActiveChatThinkingPicker(): boolean {
    const entry = getActiveChatPanelEntry();
    return openChatPanelSelect(entry?.dom.thinkingSelectEl ?? null);
  }

  function openActivePanelInstancePicker(): boolean {
    const active = getActivePanelContext();
    if (!active || !panelHostController) {
      return false;
    }
    const actions = panelHostController.getContext(
      getPanelHeaderActionsKey(active.panelId),
    ) as PanelHeaderActions | null;
    return actions?.openInstancePicker?.() ?? false;
  }

  function getPrimaryChatInputRuntime(): InputRuntime | null {
    return (
      getActiveChatInputRuntime() ?? chatPanelsById.values().next().value?.inputRuntime ?? null
    );
  }

  function hasChatPanelActiveOutput(panelId: string): boolean {
    const entry = chatPanelsById.get(panelId);
    if (!entry) {
      return false;
    }
    return entry.runtime.chatRenderer.hasActiveOutput();
  }

  function getChatPanelSessionIds(): Set<string> {
    const ids = new Set<string>();
    for (const entry of chatPanelsById.values()) {
      if (entry.bindingSessionId) {
        ids.add(entry.bindingSessionId);
      }
    }
    return ids;
  }

  function updateChatPanelSessionLabel(entry: {
    dom: ChatPanelDom;
    bindingSessionId: string | null;
  }): void {
    if (!entry.dom.sessionLabelEl) {
      return;
    }
    const sessionId = entry.bindingSessionId;
    const label = sessionId ? getSessionLabel(sessionId) : 'Select session';
    entry.dom.sessionLabelEl.textContent = label;
    entry.dom.sessionLabelEl.title = label;
    entry.dom.sessionLabelEl.setAttribute(
      'aria-label',
      sessionId ? `Session: ${label}` : 'Select session',
    );
    entry.dom.sessionLabelEl.classList.toggle('is-unbound', !sessionId);
    entry.dom.chromeController?.scheduleLayoutCheck();
  }

  function updateChatPanelModelSelect(sessionId: string | null): void {
    const normalized = normalizeSessionId(sessionId);
    const entry = normalized ? getChatPanelEntryForSession(normalized) : null;
    const modelSelectEl = entry?.dom.modelSelectEl ?? null;
    if (!normalized || !entry || !modelSelectEl) {
      if (modelSelectEl) {
        modelSelectEl.classList.add('hidden');
        modelSelectEl.innerHTML = '';
        modelSelectEl.disabled = true;
        entry?.dom.chromeController?.scheduleLayoutCheck();
      }
      return;
    }
    const models = availableModelsBySession.get(normalized) ?? [];
    if (models.length <= 1) {
      modelSelectEl.classList.add('hidden');
      modelSelectEl.innerHTML = '';
      modelSelectEl.disabled = true;
      entry.dom.chromeController?.scheduleLayoutCheck();
      return;
    }

    modelSelectEl.classList.remove('hidden');
    modelSelectEl.disabled = false;
    modelSelectEl.innerHTML = '';
    for (const model of models) {
      const option = document.createElement('option');
      option.value = model;
      option.textContent = model;
      modelSelectEl.appendChild(option);
    }

    const defaultModel = models[0];
    if (!defaultModel) {
      entry.dom.chromeController?.scheduleLayoutCheck();
      return;
    }
    const currentModel = currentModelBySession.get(normalized) ?? defaultModel;
    modelSelectEl.value = currentModel;
    entry.dom.chromeController?.scheduleLayoutCheck();
  }

  function updateChatPanelThinkingSelect(sessionId: string | null): void {
    const normalized = normalizeSessionId(sessionId);
    const entry = normalized ? getChatPanelEntryForSession(normalized) : null;
    const thinkingSelectEl = entry?.dom.thinkingSelectEl ?? null;
    if (!normalized || !entry || !thinkingSelectEl) {
      if (thinkingSelectEl) {
        thinkingSelectEl.classList.add('hidden');
        thinkingSelectEl.innerHTML = '';
        thinkingSelectEl.disabled = true;
        entry?.dom.chromeController?.scheduleLayoutCheck();
      }
      return;
    }
    const thinkingLevels = availableThinkingBySession.get(normalized) ?? [];
    if (thinkingLevels.length <= 1) {
      thinkingSelectEl.classList.add('hidden');
      thinkingSelectEl.innerHTML = '';
      thinkingSelectEl.disabled = true;
      entry.dom.chromeController?.scheduleLayoutCheck();
      return;
    }

    thinkingSelectEl.classList.remove('hidden');
    thinkingSelectEl.disabled = false;
    thinkingSelectEl.innerHTML = '';
    for (const level of thinkingLevels) {
      const option = document.createElement('option');
      option.value = level;
      option.textContent = level;
      thinkingSelectEl.appendChild(option);
    }

    const defaultThinking = thinkingLevels[0];
    if (!defaultThinking) {
      entry.dom.chromeController?.scheduleLayoutCheck();
      return;
    }
    const currentThinking = currentThinkingBySession.get(normalized) ?? defaultThinking;
    thinkingSelectEl.value = currentThinking;
    entry.dom.chromeController?.scheduleLayoutCheck();
  }

  function registerChatPanelRuntime(options: {
    runtime: ChatRuntime;
    dom: ChatPanelDom;
    host: PanelHost;
  }): () => void {
    const { runtime, dom, host } = options;
    const panelId = host.panelId();
    let bindingSessionId: string | null = null;
    const inputRuntime = createInputRuntime({
      elements: dom.inputElements,
      getChatRuntime: () => runtime,
      getSelectedSessionId: () => bindingSessionId,
      getChatRuntimeForSession: (sessionId: string) => getChatRuntimeForSession(sessionId),
      getSocket: () => socket,
      setStatus: (text: string) => {
        setStatus(statusEl, text);
      },
      setTtsStatus,
      showSessionTypingIndicator,
      appendMessage,
      appendExternalSentIndicator,
      setAssistantBubbleTyping,
      scrollMessageIntoView,
      buildContextLine,
      getActiveContextItem: () => {
        const activePanel = getActivePanelContext();
        if (!activePanel) {
          return null;
        }
        const panelContext = getActivePanelContextValue(activePanel.panelId);
        if (!panelContext) {
          return null;
        }
        const typeValue = panelContext['type'];
        const idValue = panelContext['id'];
        const type = typeof typeValue === 'string' ? typeValue.trim() : '';
        const id = typeof idValue === 'string' ? idValue.trim() : '';
        if (!type || !id) {
          return null;
        }
        return { type, id };
      },
      getActiveContextItemName: () => {
        const activePanel = getActivePanelContext();
        if (!activePanel) {
          return null;
        }
        const panelContext = getActivePanelContextValue(activePanel.panelId);
        if (!panelContext) {
          return null;
        }
        const nameValue = panelContext['name'] ?? panelContext['title'];
        const name = typeof nameValue === 'string' ? nameValue.trim() : '';
        if (name) {
          return name;
        }
        const idValue = panelContext['id'];
        const id = typeof idValue === 'string' ? idValue.trim() : '';
        return id || null;
      },
      getActiveContextItemDescription: () => {
        const activePanel = getActivePanelContext();
        if (!activePanel) {
          return null;
        }
        const panelContext = getActivePanelContextValue(activePanel.panelId);
        if (!panelContext) {
          return null;
        }
        const descriptionValue = panelContext['description'];
        const description = typeof descriptionValue === 'string' ? descriptionValue.trim() : '';
        return description.length > 0 ? description : null;
      },
      getSelectedItemIds: () => {
        const activePanel = getActivePanelContext();
        if (!activePanel) {
          return [];
        }
        const panelContext = getActivePanelContextValue(activePanel.panelId);
        const rawSelected = panelContext ? panelContext['selectedItemIds'] : null;
        if (!Array.isArray(rawSelected)) {
          return [];
        }
        const selected = rawSelected
          .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
          .map((entry) => entry.trim());
        return Array.from(new Set(selected));
      },
      getSelectedItemTitles: () => {
        const activePanel = getActivePanelContext();
        if (!activePanel) {
          return [];
        }
        const panelContext = getActivePanelContextValue(activePanel.panelId);
        if (!panelContext) {
          return [];
        }
        const rawItems = panelContext['selectedItems'];
        if (Array.isArray(rawItems)) {
          const titles = rawItems
            .map((entry) => {
              if (!entry || typeof entry !== 'object') {
                return '';
              }
              const obj = entry as Record<string, unknown>;
              const title = typeof obj['title'] === 'string' ? obj['title'].trim() : '';
              return title;
            })
            .filter((title) => title.length > 0);
          if (titles.length > 0) {
            return titles;
          }
        }
        const rawTitles = panelContext['selectedItemTitles'];
        if (!Array.isArray(rawTitles)) {
          return [];
        }
        return rawTitles
          .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
          .map((entry) => entry.trim());
      },
      getActivePanelContext,
      getActivePanelContextAttributes,
      getContextPreviewData,
      onClearContextSelection: () => {
        // Broadcast event to clear selection in panels
        document.dispatchEvent(new CustomEvent('assistant:clear-context-selection'));
      },
      getIsSessionExternal: (sessionId: string | null) => isSessionExternal(sessionId),
      getAgentDisplayName,
      cancelQueuedMessage,
      audioResponsesCheckboxEl,
      initialIncludePanelContext: includePanelContext,
      initialBriefModeEnabled: briefModeEnabled,
      onIncludePanelContextChange: (enabled) => {
        applyIncludePanelContext(enabled);
      },
      onBriefModeChange: (enabled) => {
        applyBriefModeEnabled(enabled);
      },
      speechFeaturesEnabled,
      initialAudioResponsesEnabled,
      audioResponsesStorageKey: AUDIO_RESPONSES_STORAGE_KEY,
      continuousListeningLongPressMs: 500,
    });
    const entry: ChatPanelEntry = {
      panelId,
      runtime,
      inputRuntime,
      dom,
      bindingSessionId: null,
    };
    runtime.chatRenderer.setFocusInputHandler(() => {
      inputRuntime.focusInput();
    });
    chatPanelsById.set(panelId, entry);
    let didAutoOpenSessionPicker = false;
    const abortController = new AbortController();
    const openChatSessionPicker = () => {
      const anchor = dom.sessionLabelEl;
      if (!anchor) {
        return;
      }
      const disabledSessionIds = new Set<string>();
      for (const candidate of chatPanelsById.values()) {
        if (candidate.panelId === panelId) {
          continue;
        }
        if (candidate.bindingSessionId) {
          disabledSessionIds.add(candidate.bindingSessionId);
        }
      }
      openSessionPicker({
        anchor,
        title: 'Select session',
        allowUnbound: true,
        ...(disabledSessionIds.size > 0 ? { disabledSessionIds } : {}),
        createSessionOptions: { openChatPanel: false, selectSession: false },
        onSelectSession: (sessionId) => {
          host.setBinding({ mode: 'fixed', sessionId });
        },
        onSelectUnbound: () => {
          host.setBinding(null);
        },
      });
    };
    if (dom.refreshButtonEl) {
      dom.refreshButtonEl.disabled = true;
      dom.refreshButtonEl.addEventListener(
        'click',
        (event) => {
          event.preventDefault();
          event.stopPropagation();
          dom.refreshButtonEl?.blur();
          if (!bindingSessionId) {
            return;
          }
          void loadSessionTranscript(bindingSessionId, { force: true });
        },
        { signal: abortController.signal },
      );
    }
    if (dom.sessionLabelEl) {
      dom.sessionLabelEl.addEventListener(
        'click',
        (event) => {
          event.preventDefault();
          event.stopPropagation();
          openChatSessionPicker();
        },
        { signal: abortController.signal },
      );
    }
    const maybeAutoOpenSessionPicker = () => {
      const active = getActivePanelContext();
      const isActive = active?.panelId === panelId;
      if (
        !shouldAutoOpenSessionPicker({
          hasSession: Boolean(bindingSessionId),
          isActive,
          hasAnchor: Boolean(dom.sessionLabelEl),
          alreadyOpened: didAutoOpenSessionPicker,
        })
      ) {
        return;
      }
      didAutoOpenSessionPicker = true;
      requestAnimationFrame(() => {
        openChatSessionPicker();
      });
    };
    const updateBinding = (binding: PanelBinding | null) => {
      const sessionId = binding?.mode === 'fixed' ? normalizeSessionId(binding.sessionId) : null;
      const previousSessionId = entry.bindingSessionId;
      if (previousSessionId) {
        if (chatPanelIdBySession.get(previousSessionId) === panelId) {
          chatPanelIdBySession.delete(previousSessionId);
        }
      }
      bindingSessionId = sessionId;
      entry.bindingSessionId = sessionId;
      entry.inputRuntime.setSessionId(sessionId);
      entry.inputRuntime.updateContextAvailability();
      if (previousSessionId && previousSessionId !== sessionId) {
        loadedChatTranscripts.delete(previousSessionId);
        // Reset panel state when switching sessions to prevent lingering state from previous session
        entry.runtime.chatRenderer.hideTypingIndicator();
        entry.inputRuntime.speechAudioController?.syncMicButtonState();
        // Set panel to idle immediately; will update to correct state after transcript loads
        if (panelHostController && sessionId) {
          panelHostController.setPanelMetadata(panelId, { status: 'idle' });
        }
      }
      if (sessionId) {
        chatPanelIdBySession.set(sessionId, panelId);
      }
      if (dom.refreshButtonEl) {
        dom.refreshButtonEl.disabled = !sessionId;
      }
      if (!sessionId) {
        entry.runtime.chatRenderer.clear();
        ensureEmptySessionHint(entry.runtime.elements.chatLog);
        entry.runtime.chatScrollManager.resetScrollState();
        entry.runtime.chatScrollManager.updateScrollButtonVisibility();
      }
      updateChatPanelSessionLabel(entry);
      if (sessionId) {
        updateChatPanelModelSelect(sessionId);
        updateChatPanelThinkingSelect(sessionId);
      } else if (entry.dom.modelSelectEl) {
        entry.dom.modelSelectEl.classList.add('hidden');
        entry.dom.modelSelectEl.innerHTML = '';
        entry.dom.modelSelectEl.disabled = true;
      }
      if (!sessionId && entry.dom.thinkingSelectEl) {
        entry.dom.thinkingSelectEl.classList.add('hidden');
        entry.dom.thinkingSelectEl.innerHTML = '';
        entry.dom.thinkingSelectEl.disabled = true;
      }
      const active = host.getContext('panel.active') as { panelId?: string } | null;
      if (sessionId && active?.panelId === panelId && sessionId !== inputSessionId) {
        setInputSessionId(sessionId);
      }
      updateSessionSubscriptions();
      if (sessionId) {
        void loadSessionTranscript(sessionId, { force: true });
      }
      if (!sessionId) {
        maybeAutoOpenSessionPicker();
      }
    };
    updateBinding(host.getBinding());
    const unsubBinding = host.onBindingChange(updateBinding);
    const unsubSessionContext = host.subscribeSessionContext(() => {
      updateChatPanelSessionLabel(entry);
    });
    const unsubActive = host.subscribeContext('panel.active', () => {
      maybeAutoOpenSessionPicker();
    });
    if (dom.modelSelectEl) {
      dom.modelSelectEl.addEventListener(
        'change',
        () => {
          const selected = dom.modelSelectEl?.value ?? '';
          const sessionId = entry.bindingSessionId;
          if (!sessionId || !selected) {
            return;
          }
          const previous = currentModelBySession.get(sessionId) ?? null;
          if (previous === selected) {
            return;
          }
          currentModelBySession.set(sessionId, selected);
          sendSetSessionModel(sessionId, selected);
        },
        { signal: abortController.signal },
      );
    }
    if (dom.thinkingSelectEl) {
      dom.thinkingSelectEl.addEventListener(
        'change',
        () => {
          const selected = dom.thinkingSelectEl?.value ?? '';
          const sessionId = entry.bindingSessionId;
          if (!sessionId || !selected) {
            return;
          }
          const previous = currentThinkingBySession.get(sessionId) ?? null;
          if (previous === selected) {
            return;
          }
          currentThinkingBySession.set(sessionId, selected);
          sendSetSessionThinking(sessionId, selected);
        },
        { signal: abortController.signal },
      );
    }
    updateChatPanelSessionLabel(entry);
    return () => {
      abortController.abort();
      unsubBinding();
      unsubSessionContext();
      unsubActive();
      runtime.chatRenderer.setFocusInputHandler(null);
      chatPanelsById.delete(panelId);
      if (entry.bindingSessionId) {
        loadedChatTranscripts.delete(entry.bindingSessionId);
      }
      if (entry.bindingSessionId && chatPanelIdBySession.get(entry.bindingSessionId) === panelId) {
        chatPanelIdBySession.delete(entry.bindingSessionId);
      }
      updateSessionSubscriptions();
    };
  }

  function syncSessionContext(): void {
    if (!panelHostController) {
      return;
    }
    panelHostController.setContext('session.activeId', inputSessionId);
    panelHostController.setContext('session.summaries', sessionSummaries);
    panelHostController.setContext('agent.summaries', agentSummaries);
    const activeSummary =
      inputSessionId === null
        ? null
        : (sessionSummaries.find((summary) => summary.sessionId === inputSessionId) ?? null);
    panelHostController.setContext('session.activeSummary', activeSummary);
  }

  function mergePanelManifest(
    base: PanelTypeManifest,
    override: PanelTypeManifest,
  ): PanelTypeManifest {
    if (base.type !== override.type) {
      return base;
    }
    return {
      ...base,
      ...override,
      icon: override.icon ?? base.icon,
      description: override.description ?? base.description,
      version: override.version ?? base.version,
      multiInstance: override.multiInstance ?? base.multiInstance,
      defaultSessionBinding: override.defaultSessionBinding ?? base.defaultSessionBinding,
      sessionScope: override.sessionScope ?? base.sessionScope,
      defaultPlacement: override.defaultPlacement ?? base.defaultPlacement,
      defaultPinned: override.defaultPinned ?? base.defaultPinned,
      minSize: override.minSize ?? base.minSize,
      maxSize: override.maxSize ?? base.maxSize,
      capabilities: override.capabilities ?? base.capabilities,
    };
  }

  function syncPanelRegistryFromPlugins(manifests: CombinedPluginManifest[]): void {
    for (const plugin of manifests) {
      const panels = plugin.panels ?? [];
      for (const panel of panels) {
        if (!panel?.type) {
          continue;
        }
        const existing = panelRegistry.getManifest(panel.type);
        if (existing) {
          panelRegistry.updateManifest(panel.type, mergePanelManifest(existing, panel));
          continue;
        }
        const builtIn = builtInPanels.get(panel.type);
        if (builtIn && !panelRegistry.has(panel.type)) {
          panelRegistry.register(mergePanelManifest(builtIn.manifest, panel), builtIn.factory);
          continue;
        }
        if (!panelRegistry.has(panel.type)) {
          panelRegistry.register(panel, createPlaceholderPanel(panel));
        }
      }
    }
  }

  function setPluginSettingsContext(pluginId: string, settings: unknown): void {
    panelHostController?.setContext(`plugin.settings.${pluginId}`, settings);
    panelHostController?.setContext('plugins.settings', pluginSettingsClient.getAll());
  }

  function setPluginManifests(
    nextManifests: CombinedPluginManifest[],
    options: { markLoaded?: boolean } = {},
  ): void {
    pluginManifests = nextManifests;
    if (options.markLoaded !== false) {
      pluginManifestsLoaded = true;
    }
    syncPanelRegistryFromPlugins(pluginManifests);
    pluginBundleLoader.loadFromManifests(pluginManifests);
    syncPanelManifestContext();
    panelHostController?.setContext('plugins.manifests', pluginManifests);
    panelWorkspace?.refreshAvailability();
    panelWorkspace?.applyDefaultPinnedPanels();
    panelLauncherController?.refresh();
  }

  function getAgentDisplayName(agentId: string): string {
    const trimmed = agentId.trim();
    if (!trimmed) {
      return '';
    }
    const matching =
      agentSummaries.length > 0
        ? (agentSummaries.find((summary) => summary.agentId === trimmed) ?? null)
        : null;
    const label = matching?.displayName ?? trimmed;
    return label.trim() || trimmed;
  }

  function isSessionExternal(sessionId: string | null): boolean {
    if (!sessionId) {
      return false;
    }
    const session = sessionSummaries.find((summary) => summary.sessionId === sessionId) ?? null;
    if (!session?.agentId) {
      return false;
    }
    const agent = agentSummaries.find((summary) => summary.agentId === session.agentId) ?? null;
    return agent?.type === 'external';
  }

  function sendSetSessionModel(sessionId: string, model: string): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    const trimmedSessionId = sessionId.trim();
    if (!trimmedSessionId) {
      return;
    }
    const trimmed = model.trim();
    if (!trimmed) {
      return;
    }
    const message = {
      type: 'set_session_model' as const,
      model: trimmed,
      sessionId: trimmedSessionId,
    };
    socket.send(JSON.stringify(message));
  }

  function sendSetSessionThinking(sessionId: string, thinking: string): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    const trimmedSessionId = sessionId.trim();
    if (!trimmedSessionId) {
      return;
    }
    const trimmed = thinking.trim();
    if (!trimmed) {
      return;
    }
    const message = {
      type: 'set_session_thinking' as const,
      thinking: trimmed,
      sessionId: trimmedSessionId,
    };
    socket.send(JSON.stringify(message));
  }

  function sendInteractionResponse(options: {
    sessionId: string;
    callId: string;
    interactionId: string;
    response: InteractionResponseDraft;
  }): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    const sessionId = options.sessionId.trim();
    if (!sessionId) {
      return;
    }
    const message = {
      type: 'tool_interaction_response' as const,
      sessionId,
      callId: options.callId,
      interactionId: options.interactionId,
      action: options.response.action,
      ...(options.response.approvalScope
        ? { approvalScope: options.response.approvalScope }
        : {}),
      ...(options.response.input ? { input: options.response.input } : {}),
      ...(options.response.reason ? { reason: options.response.reason } : {}),
    };
    socket.send(JSON.stringify(message));
  }

  // Keyboard navigation state
  type FocusZone = 'sidebar' | 'input';
  let focusedSessionId: string | null = null;

  let keyboardNavigationController: KeyboardNavigationController | null = null;
  let sessionManager: SessionManager | null = null;
  let sessionDataController: SessionDataController | null = null;
  let sessionTypingIndicatorController: SessionTypingIndicatorController | null = null;
  let panelLauncherController: PanelLauncherController | null = null;
  let commandPaletteController: CommandPaletteController | null = null;
  let sessionPickerController: SessionPickerController | null = null;
  let connectionManager: ConnectionManager | null = null;
  let globalAqlHeaderController: GlobalAqlHeaderController | null = null;
  const getSidebarElementsForKeyboardNav = (): {
    agentSidebar: HTMLElement | null;
    agentSidebarSections: HTMLElement | null;
  } => {
    const active = document.activeElement;
    const focusedSidebar =
      active instanceof HTMLElement ? active.closest<HTMLElement>('.agent-sidebar') : null;
    const sidebar = focusedSidebar ?? document.querySelector<HTMLElement>('.agent-sidebar');
    return {
      agentSidebar: sidebar,
      agentSidebarSections: sidebar?.querySelector<HTMLElement>('.agent-sidebar-sections') ?? null,
    };
  };

  const pluginBundleLoader = new PluginBundleLoader({
    panelRegistry,
    onPanelRegistered: (panelType) => {
      panelWorkspace?.reloadPanelsByType(panelType);
      panelLauncherController?.refresh();
      panelHostController?.setContext('panel.manifests', panelRegistry.listManifests());
    },
  });
  pluginBundleLoader.installGlobalRegistry();

  const dialogManager = new DialogManager();
  const panelHostControllerInstance = new PanelHostController({
    registry: panelRegistry,
    getAvailableCapabilities,
    getAvailablePanelTypes,
    onPanelBindingChange: (panelId, binding) => {
      panelWorkspace?.updatePanelBinding(panelId, binding);
      updateSessionSubscriptions();
    },
    onPanelMetadataChange: (panelId, metadata) => {
      panelWorkspace?.updatePanelMetadata(panelId, metadata);
    },
    onPanelStateChange: (panelId, state) => {
      panelWorkspace?.updatePanelState(panelId, state);
    },
    getPanelState: (panelId) => panelWorkspace?.getPanelState(panelId) ?? null,
    sendPanelEvent,
    updateSessionAttributes,
  });
  panelHostController = panelHostControllerInstance;

  if (globalAqlHeader) {
    globalAqlHeaderController = new GlobalAqlHeaderController({
      containerEl: globalAqlHeader,
      toggleButtonEl: globalAqlToggleButton ?? null,
      dialogManager,
      windowId: WINDOW_ID,
      icons: {
        x: ICONS.x,
        check: ICONS.check,
        save: ICONS.save,
        trash: ICONS.trash,
      },
      onQueryChanged: (query) => {
        panelHostController?.setContext(GLOBAL_QUERY_CONTEXT_KEY, query);
      },
      isCollapsed: isMobileViewport,
    });
  }
  const keyboardShortcutRegistry = new KeyboardShortcutRegistry({
    onConflict: (existing, incoming) => {
      console.warn(`[Keyboard] Shortcut conflict: "${incoming.id}" overwrites "${existing.id}"`);
    },
    isEnabled: () => keyboardShortcutsEnabled && !dialogManager.hasOpenDialog,
    getActivePanel: () => {
      const active =
        (panelHostControllerInstance.getContext('panel.active') as {
          panelId?: string;
          panelType?: string;
        } | null) ?? null;
      if (!active || typeof active.panelId !== 'string' || typeof active.panelType !== 'string') {
        return null;
      }
      return { panelId: active.panelId, panelType: active.panelType };
    },
    ...(keyboardShortcutBindings
      ? { bindingOverrides: keyboardShortcutBindings }
      : {}),
  });
  panelHostControllerInstance.subscribeContext('panel.active', (value) => {
    if (!value || typeof value !== 'object') {
      return;
    }
    const raw = value as { panelId?: unknown; panelType?: unknown; source?: unknown };
    const panelId = typeof raw.panelId === 'string' ? raw.panelId.trim() : '';
    const panelType = typeof raw.panelType === 'string' ? raw.panelType.trim() : '';
    const focusSource = raw.source === 'chrome' ? 'chrome' : 'content';
    if (!panelId || !panelType) {
      return;
    }
    if (panelType === 'chat') {
      const isChromeActive = (): boolean => {
        const active = document.activeElement;
        if (!(active instanceof HTMLElement)) {
          return false;
        }
        return Boolean(active.closest('.panel-chrome-row, .chat-header'));
      };
      const isInteractionActive = (): boolean => {
        const active = document.activeElement;
        if (!(active instanceof HTMLElement)) {
          return false;
        }
        return Boolean(active.closest('.interaction-block, .tool-interaction-dock'));
      };
      panelWorkspace?.setActiveChatPanelId(panelId);
      const binding = panelHostControllerInstance.getPanelBinding(panelId);
      const boundSessionId =
        binding?.mode === 'fixed' ? normalizeSessionId(binding.sessionId) : null;
      if (boundSessionId && boundSessionId !== inputSessionId) {
        setInputSessionId(boundSessionId);
      }
      if (
        focusSource !== 'chrome' &&
        !isChromeActive() &&
        !isMobileViewport() &&
        !isInteractionActive()
      ) {
        window.setTimeout(() => {
          const inputRuntime = chatPanelsById.get(panelId)?.inputRuntime ?? null;
          inputRuntime?.focusInput();
        }, 0);
      }
      return;
    }
  });
  const syncPanelManifestContext = (): void => {
    panelHostController?.setContext('panel.manifests', panelRegistry.listManifests());
  };
  syncPanelManifestContext();
  syncSessionContext();
  setPluginManifests(pluginManifests, { markLoaded: false });
  const contextMenuManager = new ContextMenuManager({
    isSessionPinned: (sessionId) =>
      !!sessionSummaries.find((summary) => summary.sessionId === sessionId)?.pinnedAt,
    pinSession: (sessionId, pinned) => {
      void sessionManager?.pinSession(sessionId, pinned);
    },
    clearHistory: (sessionId) => {
      showClearHistoryConfirmation(sessionId);
    },
    deleteSession: (sessionId) => {
      showDeleteConfirmation(sessionId);
    },
    renameSession: (sessionId) => {
      void renameSession(sessionId);
    },
  });

  function updateSessionSubscriptions(): void {
    if (!connectionManager) {
      return;
    }
    const targetIds = new Set<string>();
    const panelLayout = panelWorkspace?.getLayout() ?? null;
    if (panelLayout) {
      for (const panel of Object.values(panelLayout.panels)) {
        const binding = panel.binding;
        if (binding?.mode === 'fixed') {
          const normalized = normalizeSessionId(binding.sessionId);
          if (normalized) {
            targetIds.add(normalized);
          }
        }
      }
    }
    for (const runtime of sessionsRuntimes) {
      for (const sessionId of runtime.getVisibleSessionIds()) {
        targetIds.add(sessionId);
      }
    }
    for (const sessionId of getChatPanelSessionIds()) {
      targetIds.add(sessionId);
    }
    if (inputSessionId) {
      targetIds.add(inputSessionId);
    }

    for (const sessionId of targetIds) {
      connectionManager.subscribe(sessionId);
    }
    for (const sessionId of subscribedSessionIds) {
      if (!targetIds.has(sessionId)) {
        connectionManager.unsubscribe(sessionId);
      }
    }
    subscribedSessionIds.clear();
    for (const sessionId of targetIds) {
      subscribedSessionIds.add(sessionId);
    }
  }

  function unbindChatPanelsForSession(sessionId: string): void {
    const normalized = normalizeSessionId(sessionId);
    if (!normalized || !panelHostController) {
      return;
    }
    for (const entry of chatPanelsById.values()) {
      if (entry.bindingSessionId === normalized) {
        panelHostController.setPanelBinding(entry.panelId, null);
      }
    }
  }

  function unbindAllChatPanels(): void {
    if (!panelHostController) {
      return;
    }
    for (const entry of chatPanelsById.values()) {
      if (entry.bindingSessionId) {
        panelHostController.setPanelBinding(entry.panelId, null);
      }
    }
  }

  function renderAgentSidebar(): void {
    for (const runtime of sessionsRuntimes) {
      runtime.render();
    }
  }

  function openChatPanelForSession(sessionId: string): void {
    if (!panelWorkspace) {
      return;
    }
    const normalized = normalizeSessionId(sessionId);
    if (!normalized) {
      return;
    }
    const existing = getChatPanelEntryForSession(normalized);
    if (existing) {
      panelWorkspace.activatePanel(existing.panelId);
      void loadSessionTranscript(normalized);
      return;
    }
    const unboundEntry = Array.from(chatPanelsById.values()).find(
      (entry) => !entry.bindingSessionId,
    );
    if (unboundEntry && panelHostController) {
      panelHostController.setPanelBinding(unboundEntry.panelId, {
        mode: 'fixed',
        sessionId: normalized,
      });
      panelWorkspace.activatePanel(unboundEntry.panelId);
      return;
    }
    panelWorkspace.openPanel('chat', {
      focus: true,
      binding: { mode: 'fixed', sessionId: normalized },
    });
  }

  function isChatPanelVisible(sessionId: string): boolean {
    const normalized = normalizeSessionId(sessionId);
    if (!normalized) {
      return false;
    }
    const entries = getChatPanelEntriesForSession(normalized);
    if (entries.length === 0 || !panelWorkspace) {
      return false;
    }
    const visible = new Set(panelWorkspace.getVisiblePanelIds());
    return entries.some((entry) => visible.has(entry.panelId));
  }

  const openPanelLauncher = (options?: {
    targetPanelId?: string | null;
    defaultPlacement?: PanelPlacement | null;
    pinToHeader?: boolean;
    replacePanelId?: string | null;
  }) => {
    if (!panelLauncherController) {
      return;
    }
    if (options) {
      panelLauncherController.openWithPlacement(options);
    } else {
      panelLauncherController.open();
    }
  };

  const fetchSearchScopes = async (): Promise<SearchableScope[]> => {
    const response = await apiFetch('/api/search/scopes');
    if (!response.ok) {
      throw new Error(`Search scopes request failed: ${response.status}`);
    }
    const data = (await response.json()) as { scopes?: SearchableScope[] };
    return Array.isArray(data?.scopes) ? data.scopes : [];
  };

  const fetchSearchResults = async (
    options: GlobalSearchOptions,
  ): Promise<SearchApiResponse> => {
    const params = new URLSearchParams({ q: options.query });
    if (options.profiles && options.profiles.length > 0) {
      params.set('profiles', options.profiles.join(','));
    }
    if (options.plugin) {
      params.set('plugin', options.plugin);
    }
    if (options.scope) {
      params.set('scope', options.scope);
    }
    if (options.instance) {
      params.set('instance', options.instance);
    }
    if (typeof options.limit === 'number') {
      params.set('limit', options.limit.toString());
    }
    const response = await apiFetch(`/api/search?${params.toString()}`);
    if (!response.ok) {
      throw new Error(`Search request failed: ${response.status}`);
    }
    return (await response.json()) as SearchApiResponse;
  };

  const openSessionPicker = (options: SessionPickerOpenOptions): void => {
    requireSessionPicker().open({
      ...options,
      onClearSession:
        options.onClearSession ?? ((sessionId) => showClearHistoryConfirmation(sessionId)),
      onDeleteSession: options.onDeleteSession ?? ((sessionId) => void deleteSession(sessionId)),
      onRenameSession: options.onRenameSession ?? ((sessionId) => void renameSession(sessionId)),
    });
  };

  panelHostControllerInstance.setContext(CORE_PANEL_SERVICES_CONTEXT_KEY, {
    dialogManager,
    contextMenuManager,
    listColumnPreferencesClient,
    keyboardShortcuts: createShortcutService(keyboardShortcutRegistry),
    focusInput: () => {
      getActiveChatInputRuntime()?.focusInput();
    },
    setStatus: (text: string) => {
      setStatus(statusEl, text);
    },
    isMobileViewport,
    notifyContextAvailabilityChange: () => {
      for (const entry of chatPanelsById.values()) {
        entry.inputRuntime.updateContextAvailability();
      }
    },
    openCommandPalette: () => {
      commandPaletteController?.open();
    },
    clearContextSelection: () => {
      // Broadcast a custom event that panels can listen for to clear their selection
      document.dispatchEvent(new CustomEvent('assistant:clear-context-selection'));
    },
    openSessionPicker,
  } satisfies PanelCoreServices);

  panelHostControllerInstance.setContext(CHAT_PANEL_SERVICES_CONTEXT_KEY, {
    getRuntimeOptions: getChatRuntimeOptions,
    registerChatPanel: ({ runtime, dom, host }) => registerChatPanelRuntime({ runtime, dom, host }),
  } satisfies ChatPanelServices);

  await fetchPlugins();

  if (panelWorkspaceRoot) {
    const panelWorkspaceController = new PanelWorkspaceController({
      root: panelWorkspaceRoot,
      registry: panelRegistry,
      host: panelHostControllerInstance,
      headerDockRoot: panelHeaderDock ?? null,
      getAvailableCapabilities,
      getAvailablePanelTypes,
      openPanelLauncher,
      openSessionPicker,
      hasChatPanelActiveOutput,
      windowId: WINDOW_ID,
      onLayoutChange: (layout) => {
        panelHostControllerInstance.setContext('panel.layout', layout);
        updateSessionSubscriptions();
        loadOpenChatPanelTranscripts();
      },
    });
    panelWorkspace = panelWorkspaceController;
    panelHostControllerInstance.setPanelWorkspace(panelWorkspaceController);
    panelWorkspaceController.attach();
    panelWorkspaceController.applyDefaultPinnedPanels();
    loadOpenChatPanelTranscripts();
  }
  connectionManager = new ConnectionManager({
    createWebSocketUrl,
    setStatus: (text) => {
      setStatus(statusEl, text);
    },
    protocolVersion: PROTOCOL_VERSION,
    supportsAudioOutput: () => getPrimaryChatInputRuntime()?.supportsAudioOutput() ?? false,
    getInteractionEnabled: () => interactionEnabled,
    onMessage: (data) => {
      void handleServerMessage(data);
    },
    onOpen: () => {
      panelWorkspace?.publishPanelInventory();
    },
    getSocket: () => socket,
    setSocket: (nextSocket) => {
      socket = nextSocket;
    },
    onConnectionLostCleanup: () => {
      getPrimaryChatInputRuntime()?.speechAudioController?.onConnectionLostCleanup();
    },
    reconnectDelayMs: RECONNECT_DELAY_MS,
    maxReconnectDelayMs: MAX_RECONNECT_DELAY_MS,
  });

  function cancelQueuedMessage(messageId: string): void {
    const currentSocket = socket;
    const trimmedId = messageId.trim();
    if (!currentSocket || currentSocket.readyState !== WebSocket.OPEN || !trimmedId) {
      return;
    }
    const payload = {
      type: 'cancel_queued_message',
      messageId: trimmedId,
    } as const;
    currentSocket.send(JSON.stringify(payload));
  }

  function getActivePanelContext(): {
    panelId: string;
    panelType: string;
    panelTitle?: string | null;
  } | null {
    const context =
      (panelHostController?.getContext('panel.context') as {
        active?: {
          panelId: string;
          panelType: string;
          panelTitle?: string | null;
        } | null;
      } | null) ?? null;
    const active = context?.active ?? null;
    if (!active || !active.panelId || !active.panelType) {
      return null;
    }
    return active;
  }

  function getActivePanelContextValue(panelId: string): Record<string, unknown> | null {
    if (!panelHostController) {
      return null;
    }
    const key = getPanelContextKey(panelId);
    const raw = panelHostController.getContext(key);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return null;
    }
    return raw as Record<string, unknown>;
  }

  function getActivePanelContextAttributes(): Record<string, string> | null {
    const activePanel = getActivePanelContext();
    if (!activePanel) {
      return null;
    }
    const panelContext = getActivePanelContextValue(activePanel.panelId);
    if (!panelContext) {
      return null;
    }
    const raw = panelContext['contextAttributes'];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return null;
    }
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!key || typeof key !== 'string') {
        continue;
      }
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed) {
          result[key] = trimmed;
        }
        continue;
      }
      if (value === null || value === undefined) {
        continue;
      }
      const normalized = String(value).trim();
      if (normalized) {
        result[key] = normalized;
      }
    }
    return Object.keys(result).length > 0 ? result : null;
  }

  function getContextPreviewData(): ContextPreviewData | null {
    const activePanel = getActivePanelContext();
    if (!activePanel) {
      return null;
    }
    const panelContext = getActivePanelContextValue(activePanel.panelId);
    if (!panelContext) {
      return null;
    }

    const type = typeof panelContext['type'] === 'string' ? panelContext['type'] : '';
    const name =
      typeof panelContext['name'] === 'string'
        ? panelContext['name']
        : typeof panelContext['title'] === 'string'
          ? panelContext['title']
          : typeof panelContext['id'] === 'string'
            ? panelContext['id']
            : '';

    if (!type || !name) {
      return null;
    }

    // Get selected text from contextAttributes
    const contextAttrs = panelContext['contextAttributes'];
    const selectedText =
      contextAttrs &&
      typeof contextAttrs === 'object' &&
      !Array.isArray(contextAttrs) &&
      typeof (contextAttrs as Record<string, unknown>)['selected-text'] === 'string'
        ? ((contextAttrs as Record<string, unknown>)['selected-text'] as string)
        : undefined;

    // Get selected items (for lists)
    const selectedItemIds = Array.isArray(panelContext['selectedItemIds'])
      ? (panelContext['selectedItemIds'] as unknown[]).filter(
          (id): id is string => typeof id === 'string',
        )
      : [];
    const selectedItemCount =
      typeof panelContext['selectedItemCount'] === 'number'
        ? panelContext['selectedItemCount']
        : selectedItemIds.length;

    const selectedItems = Array.isArray(panelContext['selectedItems'])
      ? (panelContext['selectedItems'] as unknown[])
      : [];
    const selectedItemTitles = selectedItems
      .map((item) => {
        if (item && typeof item === 'object' && 'title' in item) {
          return typeof (item as { title: unknown }).title === 'string'
            ? (item as { title: string }).title
            : '';
        }
        return '';
      })
      .filter((title) => title.length > 0);

    // Only return data if there's something meaningful to show
    const hasSelectedText = selectedText && selectedText.trim().length > 0;
    const hasSelectedItems = selectedItemCount > 0;

    if (!hasSelectedText && !hasSelectedItems) {
      return null;
    }

    return {
      type,
      name,
      ...(hasSelectedText ? { selectedText } : {}),
      ...(hasSelectedItems ? { selectedItemCount, selectedItemTitles } : {}),
    };
  }

  function getChatRuntimeOptions(_host?: PanelHost) {
    return {
      toolOutputPreferencesClient,
      thinkingPreferencesClient,
      autoScrollEnabled,
      getAgentDisplayName,
      getInteractionEnabled: () => interactionEnabled,
      isMobileViewport,
      sendInteractionResponse,
    };
  }

  function getSessionsRuntimeOptions(): Omit<
    SessionsRuntimeOptions,
    'agentSidebar' | 'agentSidebarSections' | 'viewModeToggle'
  > {
    return {
      icons: { plus: ICONS.plus },
      getSessionSummaries: () => sessionSummaries,
      getAgentSummaries: () => agentSummaries,
      getSelectedSessionId: () => inputSessionId,
      sessionsWithPendingMessages,
      sessionsWithActiveTyping,
      getFocusedSessionId: () => focusedSessionId,
      setFocusedSessionId: (id) => {
        focusedSessionId = id;
      },
      setFocusedSessionItem,
      isSidebarFocused,
      selectSession,
      createSessionForAgent,
      showSessionMenu: (x, y, sessionId) => {
        contextMenuManager.showSessionMenu(x, y, sessionId);
      },
      focusInput: () => {
        getActiveChatInputRuntime()?.focusInput();
      },
      getAutoFocusChatOnSessionReady: () => autoFocusChatOnSessionReady,
      isMobileViewport,
      onSessionSelectedOnMobile: () => {
        if (!isMobileViewport()) {
          return;
        }
        panelWorkspace?.setPanelOpen('sessions', false);
      },
      onRendered: () => {
        updateSessionSubscriptions();
      },
    };
  }
  function clearChatForSession(sessionId: string): void {
    const normalized = normalizeSessionId(sessionId);
    if (!normalized) {
      return;
    }
    for (const entry of chatPanelsById.values()) {
      if (entry.bindingSessionId !== normalized) {
        continue;
      }
      entry.runtime.chatRenderer.clear();
      ensureEmptySessionHint(entry.runtime.elements.chatLog);
      entry.runtime.chatScrollManager.resetScrollState();
      entry.runtime.chatScrollManager.updateScrollButtonVisibility();
    }
  }

  function closeChatPanelForSession(sessionId: string): void {
    if (!panelWorkspace) {
      return;
    }
    const normalized = normalizeSessionId(sessionId);
    if (!normalized) {
      return;
    }
    for (const [panelId, entry] of chatPanelsById.entries()) {
      if (entry.bindingSessionId === normalized) {
        panelWorkspace.closePanel(panelId);
      }
    }
  }

  sessionManager = new SessionManager({
    getSelectedSessionId: () => inputSessionId,
    setSelectedSessionId: (sessionId) => {
      setInputSessionId(sessionId);
    },
    refreshSessions,
    clearChatForSession,
    closeChatPanelForSession,
    openChatPanelForSession,
    clearSidebarFocusState: () => {
      focusedSessionId = null;
    },
    getAllSessionItems,
    focusZone,
    setStatus: (text) => {
      setStatus(statusEl, text);
    },
    dialogManager,
  });

  // Check if sidebar currently has DOM focus
  function isSidebarFocused(): boolean {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) {
      return false;
    }
    return Boolean(active.closest('.agent-sidebar'));
  }

  sessionDataController = new SessionDataController({
    getSelectedSessionId: () => inputSessionId,
    setSelectedSessionId: (sessionId) => {
      setInputSessionId(sessionId);
    },
    setSessionSummaries: (summaries) => {
      sessionSummaries = summaries;
      currentModelBySession.clear();
      currentThinkingBySession.clear();
      for (const summary of summaries) {
        if (typeof summary.model === 'string' && summary.model.trim().length > 0) {
          currentModelBySession.set(summary.sessionId, summary.model.trim());
        }
        if (typeof summary.thinking === 'string' && summary.thinking.trim().length > 0) {
          currentThinkingBySession.set(summary.sessionId, summary.thinking.trim());
        }
      }
      syncSessionContext();
      for (const sessionId of currentModelBySession.keys()) {
        updateChatPanelModelSelect(sessionId);
      }
      for (const sessionId of currentThinkingBySession.keys()) {
        updateChatPanelThinkingSelect(sessionId);
      }
    },
    setAgentSummaries: (agents) => {
      agentSummaries = agents;
      panelHostController?.setContext('agent.summaries', agentSummaries);
    },
    renderAgentSidebar,
  });

  function requireSessionManager(): SessionManager {
    if (!sessionManager) {
      throw new Error('Session manager not initialized');
    }
    return sessionManager;
  }

  function requireSessionPicker(): SessionPickerController {
    if (!sessionPickerController) {
      sessionPickerController = new SessionPickerController({
        getSessionSummaries: () => sessionSummaries,
        getAgentSummaries: () => agentSummaries,
        createSessionForAgent,
      });
    }
    return sessionPickerController;
  }

  // Close context menu and clear text selection when clicking elsewhere
  document.addEventListener('click', (e) => {
    contextMenuManager.close();
    // Clear any text selection (e.g., from long-press on mobile),
    // but do not clear the caret inside focused inputs or the input bar,
    // and do not clear selections in chat log or note content (used for context).
    const target = e.target as HTMLElement | null;
    if (target) {
      const isToolbar = target.closest('.toolbar');
      const isInputBar = target.closest('.input-bar');
      const isChatLog = target.closest('.chat-log');
      const isNoteContent = target.closest('.collection-note-content');
      if (isToolbar || isInputBar || isChatLog || isNoteContent) {
        return;
      }
    }
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      selection.removeAllRanges();
    }
  });

  async function renameSession(sessionId: string): Promise<void> {
    const existing = sessionSummaries.find((summary) => summary.sessionId === sessionId) ?? null;
    const initialName = existing && typeof existing.name === 'string' ? existing.name.trim() : '';

    const fallbackTitle = (() => {
      const autoTitle = resolveAutoTitle(existing?.attributes);
      if (autoTitle) {
        return autoTitle;
      }
      if (existing && typeof existing.lastSnippet === 'string') {
        const trimmed = stripContextLine(existing.lastSnippet).trim();
        if (trimmed) {
          return trimmed;
        }
      }
      return 'New session';
    })();

    const name = await dialogManager.showTextInputDialog({
      title: 'Rename Session',
      message: 'Enter a name for this session.',
      confirmText: 'Save',
      confirmClassName: 'primary',
      cancelText: 'Cancel',
      labelText: 'Session name',
      initialValue: initialName,
      placeholder: fallbackTitle,
      validate: (value) => {
        const trimmed = value.trim();
        if (trimmed.length > 200) {
          return 'Session name must be at most 200 characters';
        }
        return null;
      },
    });

    if (name === null) {
      return;
    }

    const trimmedName = name.trim();
    if (trimmedName === initialName) {
      return;
    }

    try {
      const response = await apiFetch(sessionsOperationPath('update'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sessionId, name: trimmedName || null }),
      });
      if (!response.ok) {
        let errorMessage = 'Failed to rename session';
        try {
          const data = (await response.json()) as { error?: unknown };
          if (data && typeof data.error === 'string' && data.error.trim()) {
            errorMessage = data.error.trim();
          }
        } catch {
          // Ignore JSON parse errors and fall back to default error message.
        }
        setStatus(statusEl, errorMessage);
        return;
      }

      // Refresh sessions so the new name is reflected in the sidebar and controls.
      if (sessionDataController) {
        await sessionDataController.refreshSessions(inputSessionId);
      }
    } catch (err) {
      console.error('Failed to rename session', err);
      setStatus(statusEl, 'Failed to rename session');
    }
  }

  function showClearHistoryConfirmation(sessionId: string): void {
    dialogManager.showConfirmDialog({
      title: 'Clear History',
      message: 'Clear all messages in this session? The active item will be preserved.',
      confirmText: 'Clear',
      confirmClassName: 'primary',
      onConfirm: () => {
        void clearSession(sessionId);
      },
      // Preserve existing behavior: buttons remove overlay without closing dialog state.
      cancelCloseBehavior: 'remove-only',
      confirmCloseBehavior: 'remove-only',
    });
  }

  async function clearSession(sessionId: string): Promise<void> {
    await requireSessionManager().clearSession(sessionId);
  }

  function showDeleteConfirmation(sessionId: string, fromKeyboard: boolean = false): void {
    // Close header popover if open (e.g., sessions panel in popover mode)
    panelWorkspace?.closeHeaderPopover();
    dialogManager.showConfirmDialog({
      title: 'Delete Session',
      message: 'Are you sure you want to delete this session? This cannot be undone.',
      confirmText: 'Delete',
      confirmClassName: 'danger',
      onConfirm: () => {
        void deleteSession(sessionId, fromKeyboard);
      },
      // Preserve existing behavior: buttons remove overlay without closing dialog state.
      cancelCloseBehavior: 'remove-only',
      confirmCloseBehavior: 'remove-only',
    });
  }

  async function deleteSession(sessionId: string, fromKeyboard: boolean = false): Promise<void> {
    await requireSessionManager().deleteSession(sessionId, fromKeyboard);
  }

  function showDeleteAllConfirmation(): void {
    const count = sessionSummaries.length;
    if (count === 0) {
      return;
    }
    // Close header popover if open (e.g., sessions panel in popover mode)
    panelWorkspace?.closeHeaderPopover();
    dialogManager.showConfirmDialog({
      title: 'Delete All Sessions',
      message: `Are you sure you want to delete all ${count} session${count === 1 ? '' : 's'}? This cannot be undone.`,
      confirmText: 'Delete All',
      confirmClassName: 'danger',
      onConfirm: () => {
        void deleteAllSessions();
      },
      cancelCloseBehavior: 'remove-only',
      confirmCloseBehavior: 'remove-only',
    });
  }

  async function deleteAllSessions(): Promise<void> {
    // Clear selected session and chat UI before deleting
    setInputSessionId(null);
    sessionsWithPendingMessages.clear();
    sessionsWithActiveTyping.clear();
    unbindAllChatPanels();
    for (const entry of chatPanelsById.values()) {
      entry.runtime.chatRenderer.clear();
      ensureEmptySessionHint(entry.runtime.elements.chatLog);
      entry.runtime.chatScrollManager.resetScrollState();
      entry.runtime.chatScrollManager.updateScrollButtonVisibility();
    }
    for (const session of sessionSummaries) {
      getChatInputRuntimeForSession(session.sessionId)?.pendingMessageListController?.clearSession(
        session.sessionId,
      );
    }

    const sessions = [...sessionSummaries];
    for (const session of sessions) {
      try {
        await apiFetch(sessionsOperationPath('delete'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: session.sessionId }),
        });
      } catch (err) {
        console.error('Failed to delete session', session.sessionId, err);
      }
    }

    await sessionDataController?.refreshSessions();
  }

  async function togglePinSessionFromKeyboard(sessionId: string): Promise<void> {
    const existing = sessionSummaries.find((summary) => summary.sessionId === sessionId);
    const currentlyPinned = !!existing?.pinnedAt;
    await requireSessionManager().pinSession(sessionId, !currentlyPinned);
  }

  function selectSession(sessionId: string): void {
    requireSessionManager().selectSession(sessionId);
  }

  async function createSessionForAgent(
    agentId: string,
    overrides?: CreateSessionOptions,
  ): Promise<string | null> {
    const trimmed = agentId.trim();
    if (!trimmed) {
      setStatus(statusEl, 'Agent is required to create a session');
      return null;
    }
    const agent =
      agentSummaries.length > 0
        ? (agentSummaries.find((summary) => summary.agentId === trimmed) ?? null)
        : null;
    const baseOptions: CreateSessionOptions = agent
      ? {
          agentDisplayName: agent.displayName,
          ...(agent.type ? { agentType: agent.type } : {}),
        }
      : {};
    const createOptions = overrides ? { ...baseOptions, ...overrides } : baseOptions;
    return requireSessionManager().createSessionForAgent(trimmed, createOptions);
  }

  sessionTypingIndicatorController = new SessionTypingIndicatorController({
    isSessionVisible: (sessionId) => isChatPanelVisible(sessionId),
    sessionsWithPendingMessages,
  });

  if (sessionsRuntimes.size === 0) {
    console.warn('Sessions panel runtime not initialized yet; it will attach when opened.');
  }

  function showSessionTypingIndicator(sessionId: string): void {
    sessionsWithActiveTyping.add(sessionId);
    sessionTypingIndicatorController?.show(sessionId);
  }

  function hideSessionTypingIndicator(sessionId: string): void {
    sessionsWithActiveTyping.delete(sessionId);
    sessionTypingIndicatorController?.hide(sessionId);
  }

  wirePreferencesCheckboxes({
    autoFocusChatCheckbox: autoFocusChatCheckboxEl,
    keyboardShortcutsCheckbox: keyboardShortcutsCheckboxEl,
    autoScrollCheckbox: autoScrollCheckboxEl,
    initialAutoFocusChatOnSessionReady: autoFocusChatOnSessionReady,
    initialKeyboardShortcutsEnabled: keyboardShortcutsEnabled,
    initialAutoScrollEnabled: autoScrollEnabled,
    autoFocusChatStorageKey: AUTO_FOCUS_CHAT_STORAGE_KEY,
    keyboardShortcutsStorageKey: KEYBOARD_SHORTCUTS_STORAGE_KEY,
    autoScrollStorageKey: AUTO_SCROLL_STORAGE_KEY,
    setAutoFocusChatOnSessionReady: (enabled) => {
      autoFocusChatOnSessionReady = enabled;
    },
    setKeyboardShortcutsEnabled: (enabled) => {
      keyboardShortcutsEnabled = enabled;
    },
    setAutoScrollEnabled: (enabled) => {
      autoScrollEnabled = enabled;
      for (const entry of chatPanelsById.values()) {
        entry.runtime.chatScrollManager.setAutoScrollEnabled(enabled);
      }
    },
  });

  const populateSelect = (
    select: HTMLSelectElement,
    options: Array<{ label: string; value: string }>,
    selectedValue: string,
  ): void => {
    select.innerHTML = '';
    options.forEach((option) => {
      const el = document.createElement('option');
      el.value = option.value;
      el.textContent = option.label;
      select.appendChild(el);
    });
    select.value = selectedValue;
  };

  let themePreferences = loadThemePreferences();
  const syncThemePreferences = (source: 'init' | 'user' | 'system'): void => {
    const detail = applyThemePreferences(themePreferences, { source });
    themePreferences = {
      themeId: detail.themeId,
      uiFont: detail.uiFont,
      codeFont: detail.codeFont,
    };
  };
  syncThemePreferences('init');

  if (themeSelect) {
    populateSelect(
      themeSelect,
      THEME_OPTIONS.map((option) => ({ label: option.label, value: option.id })),
      themePreferences.themeId,
    );
    themeSelect.addEventListener('change', () => {
      themePreferences = {
        ...themePreferences,
        themeId: themeSelect.value,
      };
      syncThemePreferences('user');
      saveThemePreferences(themePreferences);
      themeSelect.value = themePreferences.themeId;
    });
  }

  if (uiFontSelect) {
    populateSelect(
      uiFontSelect,
      UI_FONT_OPTIONS.map((option) => ({ label: option.label, value: option.value })),
      themePreferences.uiFont,
    );
    uiFontSelect.addEventListener('change', () => {
      themePreferences = {
        ...themePreferences,
        uiFont: uiFontSelect.value,
      };
      syncThemePreferences('user');
      saveThemePreferences(themePreferences);
      uiFontSelect.value = themePreferences.uiFont;
    });
  }

  if (codeFontSelect) {
    populateSelect(
      codeFontSelect,
      CODE_FONT_OPTIONS.map((option) => ({ label: option.label, value: option.value })),
      themePreferences.codeFont,
    );
    codeFontSelect.addEventListener('change', () => {
      themePreferences = {
        ...themePreferences,
        codeFont: codeFontSelect.value,
      };
      syncThemePreferences('user');
      saveThemePreferences(themePreferences);
      codeFontSelect.value = themePreferences.codeFont;
    });
  }

  watchSystemThemeChanges(() => {
    if (themePreferences.themeId !== 'auto') {
      return;
    }
    syncThemePreferences('system');
  });

  if (includeContextCheckboxEl) {
    includeContextCheckboxEl.checked = includePanelContext;
    includeContextCheckboxEl.addEventListener('change', () => {
      applyIncludePanelContext(includeContextCheckboxEl.checked);
    });
  }
  if (showContextCheckboxEl) {
    showContextCheckboxEl.checked = showContextEnabled;
    showContextCheckboxEl.addEventListener('change', () => {
      showContextEnabled = showContextCheckboxEl.checked;
      updateShowContextFlag(showContextEnabled);
      try {
        localStorage.setItem(SHOW_CONTEXT_STORAGE_KEY, showContextEnabled ? 'true' : 'false');
      } catch {
        // Ignore localStorage errors.
      }
    });
  }
  if (interactionModeCheckboxEl) {
    interactionModeCheckboxEl.checked = interactionEnabled;
    interactionModeCheckboxEl.addEventListener('change', () => {
      applyInteractionEnabled(interactionModeCheckboxEl.checked);
    });
  }
  updateInteractionElementsEnabled(interactionEnabled);
  if (listInsertAtTopCheckboxEl) {
    listInsertAtTopCheckboxEl.checked = listInsertAtTopEnabled;
    listInsertAtTopCheckboxEl.addEventListener('change', () => {
      listInsertAtTopEnabled = listInsertAtTopCheckboxEl.checked;
      try {
        localStorage.setItem(
          LIST_INSERT_AT_TOP_STORAGE_KEY,
          listInsertAtTopEnabled ? 'true' : 'false',
        );
      } catch {
        // Ignore localStorage errors.
      }
    });
  }
  if (listItemSingleClickSelectEl) {
    listItemSingleClickSelectEl.value = listItemSingleClickBehavior;
    listItemSingleClickSelectEl.addEventListener('change', () => {
      listItemSingleClickBehavior = normalizeListItemSingleClickBehavior(
        listItemSingleClickSelectEl.value,
      );
      try {
        localStorage.setItem(
          LIST_ITEM_SINGLE_CLICK_BEHAVIOR_STORAGE_KEY,
          listItemSingleClickBehavior,
        );
      } catch {
        // Ignore localStorage errors.
      }
    });
  }
  if (listInlineCustomFieldEditingCheckboxEl) {
    listInlineCustomFieldEditingCheckboxEl.checked = listInlineCustomFieldEditingEnabled;
    listInlineCustomFieldEditingCheckboxEl.addEventListener('change', () => {
      listInlineCustomFieldEditingEnabled = listInlineCustomFieldEditingCheckboxEl.checked;
      try {
        localStorage.setItem(
          LIST_INLINE_CUSTOM_FIELD_EDITING_STORAGE_KEY,
          listInlineCustomFieldEditingEnabled ? 'true' : 'false',
        );
      } catch {
        // Ignore localStorage errors.
      }
      document.dispatchEvent(
        new CustomEvent('assistant:list-inline-custom-field-editing-updated'),
      );
    });
  }
  if (listItemEditorModeSelectEl) {
    listItemEditorModeSelectEl.value = listItemEditorDefaultMode;
    listItemEditorModeSelectEl.addEventListener('change', () => {
      listItemEditorDefaultMode =
        listItemEditorModeSelectEl.value === 'review' ? 'review' : 'quick';
      try {
        localStorage.setItem(LIST_ITEM_EDITOR_DEFAULT_MODE_STORAGE_KEY, listItemEditorDefaultMode);
      } catch {
        // Ignore localStorage errors.
      }
    });
  }

  applyTagColorsToRoot(document.body);
  window.addEventListener('assistant:tag-colors-updated', () => {
    applyTagColorsToRoot(document.body);
  });

  const settingsDropdownController = new SettingsDropdownController({
    dropdown: settingsDropdown,
    toggleButton: controlsToggleButtonEl,
  });
  settingsDropdownController.attach();
  const layoutDropdownController =
    layoutDropdownButton && layoutDropdown
      ? new SettingsDropdownController({
          dropdown: layoutDropdown,
          toggleButton: layoutDropdownButton,
        })
      : null;
  layoutDropdownController?.attach();
  const windowDropdownController =
    windowDropdownButton && windowDropdown
      ? new SettingsDropdownController({
          dropdown: windowDropdown,
          toggleButton: windowDropdownButton,
        })
      : null;
  windowDropdownController?.attach();

  const renderWindowSlotList = (): void => {
    if (!windowSlotList) {
      return;
    }
    const slots = listWindowSlotStatuses();
    windowSlotList.replaceChildren();
    for (const slot of slots) {
      const row = document.createElement('div');
      row.className = 'window-slot-row';

      const selectButton = document.createElement('button');
      selectButton.type = 'button';
      selectButton.className = 'window-slot-select';
      const isActive = slot.status === 'current';
      const isBusy = slot.status === 'busy';
      row.classList.toggle('is-busy', isBusy);
      row.classList.toggle('is-active', isActive);
      if (isActive) {
        selectButton.classList.add('active');
        selectButton.setAttribute('aria-pressed', 'true');
      } else {
        selectButton.setAttribute('aria-pressed', 'false');
      }
      const label = slot.name?.trim()
        ? `${slot.name.trim()} (${slot.slotId})`
        : `Window (${slot.slotId})`;
      selectButton.textContent = isBusy ? `${label} (in use)` : label;
      selectButton.disabled = isBusy;
      const actions = document.createElement('div');
      actions.className = 'window-slot-actions-inline';

      const renameButton = document.createElement('button');
      renameButton.type = 'button';
      renameButton.className = 'window-slot-action';
      renameButton.innerHTML = ICONS.edit;
      renameButton.setAttribute('aria-label', `Rename window ${slot.slotId}`);
      renameButton.title = 'Rename';
      renameButton.disabled = isBusy;
      renameButton.addEventListener('click', async (event) => {
        event.stopPropagation();
        const currentName = slot.name?.trim() ?? '';
        const result = await dialogManager.showTextInputDialog({
          title: 'Rename window slot',
          message: `Window ${slot.slotId}`,
          confirmText: 'Save',
          cancelText: 'Cancel',
          labelText: 'Name',
          initialValue: currentName,
          placeholder: 'Window name',
          validate: (value) => {
            if (value.trim().length > 40) {
              return 'Name must be 40 characters or fewer.';
            }
            return null;
          },
        });
        if (result === null) {
          return;
        }
        setWindowSlotName(slot.slotId, result);
        renderWindowSlotList();
      });

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'window-slot-action';
      deleteButton.innerHTML = ICONS.trash;
      deleteButton.setAttribute('aria-label', `Delete window ${slot.slotId}`);
      deleteButton.title = 'Delete';
      const canDelete = slot.status === 'available' && slot.slotId !== '0';
      deleteButton.disabled = !canDelete;
      deleteButton.addEventListener('click', (event) => {
        event.stopPropagation();
        if (!canDelete) {
          return;
        }
        removeWindowSlot(slot.slotId);
        renderWindowSlotList();
      });

      actions.appendChild(renameButton);
      actions.appendChild(deleteButton);
      row.appendChild(selectButton);
      row.appendChild(actions);
      const handleSelect = () => {
        if (isBusy) {
          return;
        }
        if (slot.slotId === WINDOW_ID) {
          windowDropdownController?.toggle(false);
          return;
        }
        setClientWindowId(slot.slotId);
        windowDropdownController?.toggle(false);
        window.location.reload();
      };

      row.addEventListener('click', (event) => {
        const target = event.target as Node | null;
        if (target && actions.contains(target)) {
          return;
        }
        handleSelect();
      });
      windowSlotList.appendChild(row);
    }
  };

  windowDropdownButton?.addEventListener('click', () => {
    settingsDropdownController.toggle(false);
    layoutDropdownController?.toggle(false);
    renderWindowSlotList();
  });

  windowSlotNewButton?.addEventListener('click', () => {
    const newSlotId = createWindowSlot();
    setClientWindowId(newSlotId);
    windowDropdownController?.toggle(false);
    window.location.reload();
  });

  windowSlotResetButton?.addEventListener('click', () => {
    resetWindowSlotState(WINDOW_ID);
    windowDropdownController?.toggle(false);
    window.location.reload();
  });

  const layoutReplacePanelButton =
    layoutDropdown?.querySelector<HTMLButtonElement>('#layout-replace-panel') ?? null;
  const updateLayoutReplacePanelState = () => {
    if (!layoutReplacePanelButton) {
      return;
    }
    const activePanelId = panelWorkspace?.getActivePanelId() ?? null;
    const canReplace = Boolean(activePanelId);
    layoutReplacePanelButton.disabled = !canReplace;
    layoutReplacePanelButton.title = canReplace ? '' : 'Select a panel to replace';
  };

  layoutDropdownButton?.addEventListener('click', () => {
    settingsDropdownController.toggle(false);
    windowDropdownController?.toggle(false);
    updateLayoutReplacePanelState();
  });
  controlsToggleButtonEl.addEventListener('click', () => {
    layoutDropdownController?.toggle(false);
    windowDropdownController?.toggle(false);
  });

  panelLauncherController = panelWorkspace
    ? new PanelLauncherController({
        launcherButton: panelLauncherButton,
        launcher: panelLauncher,
        launcherList: panelLauncherList,
        launcherSearch: panelLauncherSearch,
        launcherCloseButton: panelLauncherCloseButton,
        panelRegistry,
        panelWorkspace,
        openSessionPicker,
        getChatPanelSessionIds: () => panelWorkspace?.getChatPanelSessionIds() ?? new Set(),
        getAvailableCapabilities,
        getAvailablePanelTypes,
        onOpen: () => {
          settingsDropdownController.toggle(false);
          layoutDropdownController?.toggle(false);
          windowDropdownController?.toggle(false);
        },
      })
    : null;
  panelLauncherController?.attach();

  const resolveCommandPaletteIcon = (result: SearchApiResult): string | null => {
    const panelType = result.launch.panelType;
    const payload = result.launch.payload;
    if (
      panelType === 'lists' &&
      payload &&
      typeof payload === 'object' &&
      typeof (payload as Record<string, unknown>)['itemId'] === 'string'
    ) {
      return ICONS.check;
    }

    const manifest = panelRegistry.getManifest(panelType);
    const iconName = manifest?.icon;
    if (iconName && iconName in ICONS) {
      return ICONS[iconName as keyof typeof ICONS];
    }
    return ICONS.panelGrid;
  };

  const handleSearchLaunch = (result: SearchApiResult, action: LaunchAction): boolean => {
    if (!panelWorkspace) {
      return false;
    }
    const panelType = result.launch.panelType;
    const payload = result.launch.payload;
    let panelId: string | null = null;

    if (action.type === 'modal') {
      panelId = panelWorkspace.openModalPanel(panelType, { focus: true });
    } else if (action.type === 'workspace') {
      panelId = panelWorkspace.openPanel(panelType, {
        focus: true,
        placement: { region: 'right' },
      });
    } else if (action.type === 'pin') {
      panelId = panelWorkspace.openPanel(panelType, {
        focus: true,
        placement: { region: 'right' },
      });
      if (panelId) {
        panelWorkspace.pinPanelById(panelId);
      }
    } else if (action.type === 'replace') {
      const targetPanelId = panelWorkspace.getActivePanelId();
      if (!targetPanelId) {
        return false;
      }
      const replaced = panelWorkspace.replacePanel(targetPanelId, panelType);
      if (replaced) {
        panelId = targetPanelId;
      } else {
        const existing = panelWorkspace.getPanelIdsByType(panelType)[0] ?? null;
        if (existing) {
          panelWorkspace.focusPanel(existing);
          panelId = existing;
        }
      }
    }

    if (!panelId) {
      setStatus(statusEl, `Unable to open ${panelType} panel`);
      return false;
    }

    requestAnimationFrame(() => {
      panelHostController?.dispatchPanelEvent({
        type: 'panel_event',
        panelId,
        panelType,
        payload,
      } as PanelEventEnvelope);
    });
    return true;
  };

  commandPaletteController =
    commandPalette && commandPaletteInput && commandPaletteResults
      ? new CommandPaletteController({
          overlay: commandPalette,
          palette: commandPalettePanel,
          input: commandPaletteInput,
          ghost: commandPaletteGhost,
          results: commandPaletteResults,
          sortButton: commandPaletteSortButton,
          closeButton: commandPaletteCloseButton,
          triggerButton: commandPaletteButton,
          fetchScopes: fetchSearchScopes,
          fetchResults: fetchSearchResults,
          getSelectedPanelId: () => panelWorkspace?.getActivePanelId() ?? null,
          onLaunch: handleSearchLaunch,
          resolveIcon: resolveCommandPaletteIcon,
          setStatus: (text) => setStatus(statusEl, text),
          isMobileViewport,
        })
      : null;
  commandPaletteController?.attach();
  setupCommandPaletteFab({
    button: commandPaletteFab,
    icon: ICONS.search,
    openCommandPalette: () => {
      if (commandPaletteController) {
        commandPaletteController.open();
        return;
      }
      if (commandPaletteButton) {
        commandPaletteButton.click();
      }
    },
    isMobileViewport,
    isCapacitorAndroid,
  });

  if (layoutDropdown) {
    const presetButtons = layoutDropdown.querySelectorAll<HTMLButtonElement>('[data-layout]');
    presetButtons.forEach((button) => {
      button.addEventListener('click', () => {
        const layoutType = button.dataset['layout'];
        if (!layoutType || !panelWorkspace) {
          return;
        }
        if (layoutType === 'auto') {
          panelWorkspace.applyLayoutPreset({ id: 'auto' });
        } else if (layoutType === 'columns') {
          const rawColumns = button.dataset['columns'];
          const columns = rawColumns ? Number(rawColumns) : NaN;
          if (Number.isFinite(columns) && columns > 0) {
            panelWorkspace.applyLayoutPreset({ id: 'columns', columns });
          }
        }
        button.blur();
        layoutDropdownController?.toggle(false);
      });
    });
  }

  if (layoutReplacePanelButton) {
    layoutReplacePanelButton.addEventListener('click', () => {
      if (!panelWorkspace) {
        return;
      }
      const activePanelId = panelWorkspace.getActivePanelId();
      if (!activePanelId) {
        return;
      }
      panelWorkspace.openPanelLauncher({ replacePanelId: activePanelId });
      layoutReplacePanelButton.blur();
      layoutDropdownController?.toggle(false);
    });
  }

  const getTaggableItemsForTagManager = (): CollectionItemSummary[] => {
    if (!panelWorkspace) {
      return [];
    }
    const items: CollectionItemSummary[] = [];
    const seen = new Set<string>();
    const panelTypes = ['lists', 'notes'];
    for (const panelType of panelTypes) {
      for (const panelId of panelWorkspace.getPanelIdsByType(panelType)) {
        const context = getActivePanelContextValue(panelId);
        if (!context) {
          continue;
        }
        const typeValue = context['type'];
        const idValue = context['id'];
        const type = typeof typeValue === 'string' ? typeValue.trim() : '';
        const id = typeof idValue === 'string' ? idValue.trim() : '';
        if (!type || !id) {
          continue;
        }
        const nameValue = context['name'] ?? context['title'];
        const name =
          typeof nameValue === 'string' && nameValue.trim().length > 0 ? nameValue.trim() : id;
        const tagsValue = context['tags'];
        const tags = Array.isArray(tagsValue)
          ? tagsValue
              .filter((entry): entry is string => typeof entry === 'string')
              .map((entry) => entry.trim())
              .filter((entry) => entry.length > 0)
          : undefined;
        const updatedValue = context['updatedAt'] ?? context['updated'];
        const updatedAt =
          typeof updatedValue === 'string' && updatedValue.trim().length > 0
            ? updatedValue.trim()
            : undefined;
        const key = `${type}:${id}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        items.push({
          type,
          id,
          name,
          ...(tags && tags.length > 0 ? { tags } : {}),
          ...(updatedAt ? { updatedAt } : {}),
        });
      }
    }
    return items;
  };

  const fetchAllTagsForTagManager = async (): Promise<string[]> => {
    const tags = new Set<string>();

    // Fetch all notes
    try {
      const notesResponse = await apiFetch('/api/plugins/notes/operations/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (notesResponse.ok) {
        const notesResult = (await notesResponse.json()) as { result?: unknown };
        const notes = Array.isArray(notesResult.result) ? notesResult.result : [];
        for (const note of notes) {
          const noteTags = (note as { tags?: string[] }).tags;
          if (Array.isArray(noteTags)) {
            for (const tag of noteTags) {
              if (typeof tag === 'string' && tag.trim()) {
                tags.add(tag.trim().toLowerCase());
              }
            }
          }
        }
      }
    } catch {
      // Ignore errors fetching notes
    }

    // Fetch all lists
    const listIds: string[] = [];
    try {
      const listsResponse = await apiFetch('/api/plugins/lists/operations/list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (listsResponse.ok) {
        const listsResult = (await listsResponse.json()) as { result?: unknown };
        const lists = Array.isArray(listsResult.result) ? listsResult.result : [];
        for (const list of lists) {
          const listObj = list as { id?: string; tags?: string[] };
          if (typeof listObj.id === 'string' && listObj.id.trim()) {
            listIds.push(listObj.id);
          }
          if (Array.isArray(listObj.tags)) {
            for (const tag of listObj.tags) {
              if (typeof tag === 'string' && tag.trim()) {
                tags.add(tag.trim().toLowerCase());
              }
            }
          }
        }
      }
    } catch {
      // Ignore errors fetching lists
    }

    // Fetch items for each list to get item-level tags
    for (const listId of listIds) {
      try {
        const itemsResponse = await apiFetch('/api/plugins/lists/operations/items-list', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ listId, limit: 0 }), // limit: 0 means no limit
        });
        if (itemsResponse.ok) {
          const itemsResult = (await itemsResponse.json()) as { result?: unknown };
          const items = Array.isArray(itemsResult.result) ? itemsResult.result : [];
          for (const item of items) {
            const itemTags = (item as { tags?: string[] }).tags;
            if (Array.isArray(itemTags)) {
              for (const tag of itemTags) {
                if (typeof tag === 'string' && tag.trim()) {
                  tags.add(tag.trim().toLowerCase());
                }
              }
            }
          }
        }
      } catch {
        // Ignore errors fetching items for this list
      }
    }

    return Array.from(tags);
  };

  const tagColorManagerDialog = new TagColorManagerDialog({
    dialogManager,
    getAvailableItems: getTaggableItemsForTagManager,
    fetchAllTags: fetchAllTagsForTagManager,
  });

  tagColorsSettingsButton?.addEventListener('click', () => {
    settingsDropdownController.toggle(false);
    tagColorManagerDialog.open();
  });

  resetLayoutButton?.addEventListener('click', () => {
    resetLayoutButton.blur();
    settingsDropdownController.toggle(false);
    panelWorkspace?.resetLayout();
  });
  resetPanelStateButton?.addEventListener('click', () => {
    resetPanelStateButton.blur();
    settingsDropdownController.toggle(false);
    panelWorkspace?.resetPanelStates();
  });

  function setTtsStatus(_text: string): void {
    // TTS status display removed - function kept for compatibility
  }

  async function fetchAgents(): Promise<void> {
    if (!sessionDataController) {
      return;
    }
    await sessionDataController.fetchAgents();
  }

  async function fetchPlugins(): Promise<void> {
    try {
      const response = await apiFetch('/api/plugins');
      if (!response.ok) {
        console.error('Failed to fetch plugins', response.status);
        return;
      }
      const data = (await response.json()) as { plugins?: CombinedPluginManifest[] };
      const manifests = Array.isArray(data.plugins) ? data.plugins : [];
      setPluginManifests(manifests);
      const pluginIds = manifests.map((manifest) => manifest.id).filter(Boolean);
      await Promise.all(
        pluginIds.map(async (pluginId) => {
          const settings = await pluginSettingsClient.load(pluginId);
          if (settings) {
            setPluginSettingsContext(pluginId, settings);
          }
        }),
      );
    } catch (err) {
      console.error('Failed to fetch plugins', err);
    }
  }

  async function refreshSessions(preferredSessionId?: string | null): Promise<void> {
    if (!sessionDataController) {
      return;
    }
    await sessionDataController.refreshSessions(preferredSessionId);
    loadOpenChatPanelTranscripts();
  }

  function loadOpenChatPanelTranscripts(): void {
    for (const sessionId of getChatPanelSessionIds()) {
      void loadSessionTranscript(sessionId);
    }
  }

  async function loadSessionTranscript(
    sessionId: string,
    options?: { force?: boolean },
  ): Promise<void> {
    const trimmed = sessionId.trim();
    if (!trimmed) {
      return;
    }
    if (!options?.force && loadedChatTranscripts.has(trimmed)) {
      return;
    }
    const runtime = getChatRuntimeForSession(trimmed);
    if (!runtime) {
      return;
    }
    loadedChatTranscripts.add(trimmed);
    const chatLogEl = runtime.elements.chatLog;
    const chatRenderer = runtime.chatRenderer;
    const chatScrollManager = runtime.chatScrollManager;
    // Unified events are the single source of truth for transcript replay.
    try {
      const eventsResponse = await apiFetch(sessionsOperationPath('events'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: trimmed,
          ...(options?.force ? { force: true } : {}),
        }),
      });
      if (!eventsResponse.ok) {
        console.error('Failed to fetch session events', sessionId, eventsResponse.status);
        chatRenderer.clear();
        ensureEmptySessionHint(chatLogEl);
        loadedChatTranscripts.delete(trimmed);
        return;
      }

      const data = await readSessionOperationResult<{ sessionId: string; events: ChatEvent[] }>(
        eventsResponse,
      );
      const events = Array.isArray(data?.events) ? data.events : [];

      if (events.length > 0) {
        chatRenderer.replayEvents(events);
        chatScrollManager.scrollToBottom();
      } else {
        chatRenderer.clear();
        ensureEmptySessionHint(chatLogEl);
      }
    } catch {
      console.error('Failed to fetch session events', sessionId);
      chatRenderer.clear();
      ensureEmptySessionHint(chatLogEl);
      loadedChatTranscripts.delete(trimmed);
    }
    // Show typing indicator if session is currently busy
    if (sessionsWithActiveTyping.has(trimmed)) {
      chatRenderer.showTypingIndicator();
      setChatPanelStatusForSession(trimmed, 'busy');
    } else {
      setChatPanelStatusForSession(trimmed, 'idle');
    }
  }

  function sendPanelEvent(event: PanelEventEnvelope): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    const payload = event.windowId ? event : { ...event, windowId: WINDOW_ID };
    socket.send(JSON.stringify(payload));
  }

  const normalizeCommandString = (value: unknown): string | null => {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  };

  const parsePanelCommandBinding = (value: unknown): PanelBinding | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const record = value as Record<string, unknown>;
    const mode = record['mode'];
    if (mode === 'global') {
      return { mode: 'global' };
    }
    if (mode === 'fixed') {
      const sessionId = normalizeCommandString(record['sessionId']);
      if (!sessionId) {
        return null;
      }
      return { mode: 'fixed', sessionId };
    }
    return null;
  };

  const parsePanelCommandPlacement = (value: unknown): PanelPlacement | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }
    const record = value as Record<string, unknown>;
    const region = normalizeCommandString(record['region']);
    if (!region) {
      return null;
    }
    if (!['left', 'right', 'top', 'bottom', 'center'].includes(region)) {
      return null;
    }
    const sizeValue = record['size'];
    if (!sizeValue || typeof sizeValue !== 'object' || Array.isArray(sizeValue)) {
      return { region: region as PanelPlacement['region'] };
    }
    const sizeRecord = sizeValue as Record<string, unknown>;
    const width = typeof sizeRecord['width'] === 'number' ? sizeRecord['width'] : undefined;
    const height = typeof sizeRecord['height'] === 'number' ? sizeRecord['height'] : undefined;
    const hasWidth = typeof width === 'number' && width > 0;
    const hasHeight = typeof height === 'number' && height > 0;
    if (hasWidth || hasHeight) {
      return {
        region: region as PanelPlacement['region'],
        size: {
          ...(hasWidth ? { width } : {}),
          ...(hasHeight ? { height } : {}),
        },
      };
    }
    return { region: region as PanelPlacement['region'] };
  };

  const handleWorkspacePanelEvent = (event: PanelEventEnvelope): boolean => {
    if (event.panelType !== 'workspace' || event.panelId !== 'workspace') {
      return false;
    }
    if (!panelWorkspace) {
      return true;
    }
    const payload = event.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return true;
    }
    const record = payload as Record<string, unknown>;
    if (record['type'] !== 'panel_command') {
      return true;
    }
    const command = normalizeCommandString(record['command']);
    if (!command) {
      return true;
    }
    if (command === 'open_panel') {
      const panelType = normalizeCommandString(record['panelType']) ?? 'empty';
      const targetPanelId = normalizeCommandString(record['targetPanelId']);
      const placement = parsePanelCommandPlacement(record['placement']);
      const binding = parsePanelCommandBinding(record['binding']);
      const pinToHeader = record['pinToHeader'] === true;
      const focus = typeof record['focus'] === 'boolean' ? record['focus'] : !pinToHeader;
      const openOptions: {
        focus?: boolean;
        placement?: PanelPlacement;
        targetPanelId?: string;
        binding?: PanelBinding;
      } = {};
      openOptions.focus = focus;
      if (placement) {
        openOptions.placement = placement;
      }
      if (targetPanelId) {
        openOptions.targetPanelId = targetPanelId;
      }
      if (binding) {
        openOptions.binding = binding;
      }
      const panelId = panelWorkspace.openPanel(panelType, openOptions);
      if (panelId && pinToHeader) {
        panelWorkspace.pinPanelById(panelId);
        panelWorkspace.focusPanel(panelId);
      }
      return true;
    }
    if (command === 'close_panel') {
      const panelId = normalizeCommandString(record['panelId']);
      if (panelId) {
        panelWorkspace.closePanelToPlaceholder(panelId);
      }
      return true;
    }
    if (command === 'remove_panel') {
      const panelId = normalizeCommandString(record['panelId']);
      if (panelId) {
        panelWorkspace.closePanel(panelId);
      }
      return true;
    }
    if (command === 'replace_panel') {
      const panelId = normalizeCommandString(record['panelId']);
      const panelType = normalizeCommandString(record['panelType']);
      if (panelId && panelType) {
        const binding = parsePanelCommandBinding(record['binding']);
        panelWorkspace.replacePanel(panelId, panelType, binding ? { binding } : {});
      }
      return true;
    }
    if (command === 'move_panel') {
      const panelId = normalizeCommandString(record['panelId']);
      const placement = parsePanelCommandPlacement(record['placement']);
      const targetPanelId = normalizeCommandString(record['targetPanelId']);
      if (panelId && placement) {
        panelWorkspace.movePanel(panelId, placement, targetPanelId ?? undefined);
      }
      return true;
    }
    if (command === 'toggle_split_view') {
      const splitId = normalizeCommandString(record['splitId']);
      const panelId = normalizeCommandString(record['panelId']);
      if (splitId) {
        panelWorkspace.toggleSplitViewMode(splitId);
      } else if (panelId) {
        panelWorkspace.toggleSplitViewModeForPanelId(panelId);
      }
      return true;
    }
    if (command === 'close_split') {
      const splitId = normalizeCommandString(record['splitId']);
      if (splitId) {
        panelWorkspace.closeSplit(splitId);
      }
      return true;
    }
    return true;
  };

  async function updateSessionAttributes(
    sessionId: string,
    patch: SessionAttributesPatch,
  ): Promise<void> {
    const trimmed = sessionId.trim();
    if (!trimmed) {
      return;
    }
    const response = await apiFetch(sessionsOperationPath('update-attributes'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sessionId: trimmed, patch }),
    });
    if (!response.ok) {
      throw new Error('Failed to update session attributes');
    }
  }

  const setChatPanelStatusForSession = (sessionId: string, status: PanelStatus): void => {
    if (!panelHostController) {
      return;
    }
    const normalized = normalizeSessionId(sessionId);
    if (!normalized) {
      return;
    }
    for (const entry of chatPanelsById.values()) {
      if (entry.bindingSessionId === normalized) {
        panelHostController.setPanelMetadata(entry.panelId, { status });
      }
    }
  };

  const setSessionsPanelBadge = (badge: string | undefined): void => {
    if (!panelWorkspace || !panelHostController) {
      return;
    }
    const panelIds = panelWorkspace.getPanelIdsByType('sessions');
    for (const panelId of panelIds) {
      panelHostController.setPanelMetadata(panelId, { badge });
    }
  };

  const editQueuedMessage = (messageId: string, text: string, sessionId: string): void => {
    const runtime = getChatInputRuntimeForSession(sessionId) ?? getActiveChatInputRuntime() ?? null;
    if (!runtime) {
      return;
    }
    runtime.inputEl.value = text;
    runtime.updateClearInputButtonVisibility();
    runtime.focusInput();
    cancelQueuedMessage(messageId);
  };

  const serverMessageHandler = new ServerMessageHandler({
    statusEl,
    sessionsWithPendingMessages,
    getSelectedSessionId: () => inputSessionId,
    setSelectedSessionId: (sessionId) => {
      setInputSessionId(sessionId);
    },
    getChatRuntimeForSession: (sessionId: string) => getChatRuntimeForSession(sessionId),
    isChatPanelVisible,
    getSessionSummaries: () => sessionSummaries,
    getSpeechAudioControllerForSession: (sessionId) =>
      getChatInputRuntimeForSession(sessionId)?.speechAudioController ?? null,
    getAudioEnabled: () => getPrimaryChatInputRuntime()?.getAudioEnabled() ?? false,
    getAgentDisplayName,
    sendModesUpdate: () => {
      getPrimaryChatInputRuntime()?.sendModesUpdate();
    },
    supportsAudioOutput: () => getPrimaryChatInputRuntime()?.supportsAudioOutput() ?? false,
    enableAudioResponses: () => {
      getPrimaryChatInputRuntime()?.enableAudioResponses();
    },
    refreshSessions,
    loadSessionTranscript,
    renderAgentSidebar,
    appendMessage,
    scrollMessageIntoView,
    showSessionTypingIndicator,
    hideSessionTypingIndicator,
    onSessionDeleted: (sessionId) => {
      unbindChatPanelsForSession(sessionId);
      connectionManager.handleSessionDeleted(sessionId);
    },
    onSessionUpdated: () => {
      syncSessionContext();
    },
    setStatus,
    setTtsStatus,
    focusInputForSession: (sessionId) => {
      const runtime = getChatInputRuntimeForSession(sessionId);
      runtime?.focusInput();
    },
    isMobileViewport,
    isSidebarFocused,
    getAutoFocusChatOnSessionReady: () => autoFocusChatOnSessionReady,
    getExpandToolOutput: () => toolOutputPreferencesClient.getExpandToolOutput(),
    setChatPanelStatusForSession,
    setSessionsPanelBadge,
    showBackgroundSessionActivityIndicator: (sessionId) => {
      sessionTypingIndicatorController?.showActivity(sessionId);
    },
    scheduleBackgroundSessionActivityIndicatorHide: (sessionId) => {
      // Keep the delay modest to avoid lingering indicators.
      const HIDE_DELAY_MS = 1500;
      sessionTypingIndicatorController?.scheduleHideActivity(sessionId, HIDE_DELAY_MS);
    },
    updateSessionModelForSession: ({ sessionId, availableModels, currentModel }) => {
      if (Array.isArray(availableModels)) {
        const normalized = availableModels
          .map((model) => model.trim())
          .filter((model) => model.length > 0);
        availableModelsBySession.set(sessionId, normalized);
      }
      if (typeof currentModel === 'string' && currentModel.trim().length > 0) {
        currentModelBySession.set(sessionId, currentModel.trim());
      }
      updateChatPanelModelSelect(sessionId);
    },
    updateSessionThinkingForSession: ({ sessionId, availableThinking, currentThinking }) => {
      if (Array.isArray(availableThinking)) {
        const normalized = availableThinking
          .map((level) => level.trim())
          .filter((level) => level.length > 0);
        availableThinkingBySession.set(sessionId, normalized);
      }
      if (typeof currentThinking === 'string' && currentThinking.trim().length > 0) {
        currentThinkingBySession.set(sessionId, currentThinking.trim());
      }
      updateChatPanelThinkingSelect(sessionId);
    },
    getPendingMessageListControllerForSession: (sessionId) =>
      getChatInputRuntimeForSession(sessionId)?.pendingMessageListController ?? null,
    cancelQueuedMessage,
    editQueuedMessage,
    handlePanelEvent: (event) => {
      const eventWindowId =
        typeof event.windowId === 'string' ? event.windowId.trim() : '';
      if (eventWindowId && eventWindowId !== WINDOW_ID) {
        return;
      }
      if (handleWorkspacePanelEvent(event)) {
        return;
      }
      panelHostController?.dispatchPanelEvent(event);
    },
  });

  async function handleServerMessage(raw: MessageEvent['data']): Promise<void> {
    if (typeof raw !== 'string') {
      if (raw instanceof ArrayBuffer) {
        getPrimaryChatInputRuntime()?.speechAudioController?.handleIncomingAudioFrame(raw);
      }
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.error('Received non-JSON message from server', err);
      return;
    }

    const result = safeValidateServerMessage(parsed);
    if (!result.success) {
      console.error('Received invalid server message', result.error.issues);
      return;
    }

    const message = result.data;
    logWsMessage(message);
    await serverMessageHandler.handle(message);
  }

  function connect(): void {
    connectionManager?.connect();
  }

  function ensureConnected(reason: string): void {
    connectionManager?.ensureConnected(reason);
  }

  const handleVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') {
      ensureConnected('visibilitychange');
    }
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('online', () => ensureConnected('online'));
  window.addEventListener('focus', () => ensureConnected('focus'));
  window.addEventListener('pageshow', (event) => {
    if ((event as PageTransitionEvent).persisted) {
      ensureConnected('pageshow');
    }
  });

  async function startPushToTalk(): Promise<void> {
    const controller = getActiveChatInputRuntime()?.speechAudioController;
    if (!controller) {
      return;
    }
    await controller.startPushToTalk();
  }

  function stopPushToTalk(): void {
    getActiveChatInputRuntime()?.speechAudioController?.stopPushToTalk();
  }

  // ==========================================================================
  // Cancel All Active Operations
  // ==========================================================================

  /**
   * Cancel all active operations: TTS, streaming, speech input
   * Returns true if something was cancelled
   */
  function cancelAllActiveOperations(): boolean {
    return getActiveChatInputRuntime()?.speechAudioController?.cancelAllActiveOperations() ?? false;
  }

  function getAllSessionItems(): HTMLElement[] {
    return keyboardNavigationController?.getAllSessionItems() ?? [];
  }

  function focusZone(zone: FocusZone): void {
    keyboardNavigationController?.focusZone(zone);
  }

  if (panelWorkspace) {
    keyboardNavigationController = new KeyboardNavigationController({
      getAgentSidebar: () => getSidebarElementsForKeyboardNav().agentSidebar,
      getAgentSidebarSections: () => getSidebarElementsForKeyboardNav().agentSidebarSections,
      panelWorkspace,
      dialogManager,
      shortcutRegistry: keyboardShortcutRegistry,
      isKeyboardShortcutsEnabled: () => keyboardShortcutsEnabled,
      getSpeechAudioController: () => getActiveChatInputRuntime()?.speechAudioController ?? null,
      cancelAllActiveOperations,
      startPushToTalk,
      stopPushToTalk,
      focusInput: () => {
        getActiveChatInputRuntime()?.focusInput();
      },
      getInputEl: () => getActiveChatInputRuntime()?.inputEl ?? null,
      getActiveChatRuntime: () => {
        const active =
          (panelHostController?.getContext('panel.active') as {
            panelId: string;
            panelType: string;
          } | null) ?? null;
        if (active?.panelType === 'chat') {
          return chatPanelsById.get(active.panelId)?.runtime ?? null;
        }
        if (inputSessionId) {
          return getChatRuntimeForSession(inputSessionId);
        }
        return null;
      },
      openCommandPalette: () => {
        commandPaletteController?.open();
      },
      focusGlobalQuery: () => globalAqlHeaderController?.focus() ?? false,
      openChatSessionPicker: () => openActiveChatSessionPicker(),
      openChatModelPicker: () => openActiveChatModelPicker(),
      openChatThinkingPicker: () => openActiveChatThinkingPicker(),
      openPanelInstancePicker: () => openActivePanelInstancePicker(),
      getFocusedSessionId: () => focusedSessionId,
      setFocusedSessionId: (id) => {
        focusedSessionId = id;
      },
      isSidebarFocused,
      isMobileViewport,
      selectSession,
      showDeleteConfirmation,
      touchSession: (sessionId) => togglePinSessionFromKeyboard(sessionId),
      showClearHistoryConfirmation,
    });
  }

  keyboardNavigationController?.attach();

  const closeWorkspaceSwitcherOverlay = (): boolean => {
    const overlay = document.querySelector<HTMLElement>('.workspace-switcher-overlay.open');
    if (!overlay) {
      return false;
    }
    const closeButton = overlay.querySelector<HTMLElement>('.workspace-switcher-close');
    if (closeButton) {
      closeButton.click();
      return true;
    }
    overlay.classList.remove('open');
    return true;
  };

  const closeSettingsDropdowns = (): boolean => {
    let closed = false;
    if (settingsDropdownController.isDropdownOpen()) {
      settingsDropdownController.close();
      closed = true;
    }
    if (layoutDropdownController?.isDropdownOpen()) {
      layoutDropdownController.close();
      closed = true;
    }
    return closed;
  };

  const closeModalPanel = (): boolean => {
    if (!panelWorkspace) {
      return false;
    }
    const overlay = document.querySelector<HTMLElement>('.panel-modal-overlay.open');
    if (!overlay) {
      return false;
    }
    const modalFrame = overlay.querySelector<HTMLElement>('.panel-frame[data-panel-id]');
    const panelId = modalFrame?.dataset['panelId'];
    if (!panelId) {
      return false;
    }
    panelWorkspace.closePanel(panelId);
    return true;
  };

  const handleAndroidBackButton = (_event: { canGoBack: boolean }): boolean => {
    if (isShareModalVisible()) {
      closeShareModal();
      return true;
    }
    if (document.querySelector('.confirm-dialog-overlay')) {
      dialogManager.closeOpenDialog();
      return true;
    }
    if (commandPaletteController?.isPaletteOpen()) {
      commandPaletteController.close();
      return true;
    }
    if (panelLauncherController?.isLauncherOpen()) {
      panelLauncherController.close();
      return true;
    }
    if (sessionPickerController?.isOpen()) {
      sessionPickerController.close();
      return true;
    }
    if (panelWorkspace) {
      const openHeaderPanelId = panelWorkspace.getOpenHeaderPanelId();
      if (openHeaderPanelId) {
        const panelType = panelWorkspace.getPanelType(openHeaderPanelId);
        if (panelType) {
          panelWorkspace.togglePanel(panelType);
        } else {
          panelWorkspace.closeHeaderPopover();
        }
        return true;
      }
    }
    if (closeSettingsDropdowns()) {
      return true;
    }
    if (closeWorkspaceSwitcherOverlay()) {
      return true;
    }
    if (contextMenuManager.isOpen()) {
      contextMenuManager.close();
      return true;
    }
    if (closeModalPanel()) {
      return true;
    }
    if (panelWorkspace && isMobileViewport() && panelWorkspace.isPanelTypeOpen('sessions')) {
      panelWorkspace.togglePanel('sessions');
      return true;
    }
    if (keyboardNavigationController?.cancelNavigationModes()) {
      return true;
    }
    if (commandPaletteController) {
      commandPaletteController.open();
      return true;
    }
    return false;
  };

  void setupBackButtonHandler(handleAndroidBackButton);

  initShareTarget({
    getSelectedSessionId: () => inputSessionId,
    getActiveChatSessionId: () => {
      const active =
        (panelHostController?.getContext('panel.active') as {
          panelId?: string;
          panelType?: string;
        } | null) ?? null;
      if (active?.panelType === 'chat' && active.panelId) {
        const entry = chatPanelsById.get(active.panelId);
        if (entry?.bindingSessionId) {
          return entry.bindingSessionId;
        }
      }
      const activeSessions = Array.from(chatPanelsById.values())
        .map((entry) => entry.bindingSessionId)
        .filter((sessionId): sessionId is string => typeof sessionId === 'string' && !!sessionId);
      if (activeSessions.length !== 1) {
        return null;
      }
      const [onlySession] = activeSessions;
      return onlySession ?? null;
    },
    selectSession,
    openSessionPicker,
    getChatInputRuntimeForSession,
    openPanel: (panelType) => {
      if (!panelWorkspace) {
        return;
      }
      const panelIds = panelWorkspace.getPanelIdsByType(panelType);
      if (panelIds.length === 0) {
        panelWorkspace.openPanel(panelType, { focus: true });
        return;
      }
      panelWorkspace.setPanelOpen(panelType, true);
      const visiblePanels = new Set(panelWorkspace.getVisiblePanelIds());
      const targetPanelId = panelIds.find((panelId) => visiblePanels.has(panelId)) ?? panelIds[0];
      if (targetPanelId) {
        panelWorkspace.focusPanel(targetPanelId);
      }
    },
    setStatus: (text) => {
      setStatus(statusEl, text);
    },
  });

  function setFocusedSessionItem(item: HTMLElement | null): void {
    keyboardNavigationController?.setFocusedSessionItem(item);
  }

  if (isTauri()) {
    window.addEventListener('assistant:tauri-proxy-ready', () => {
      if (!pluginManifestsLoaded) {
        void fetchPlugins();
      }
      void fetchAgents();
      void refreshSessions();
      connect();
    });
  }

  void fetchAgents();
  void refreshSessions();
  connect();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    void main();
  });
} else {
  void main();
}
