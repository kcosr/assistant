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
import type { CollectionItemSummary } from './controllers/collectionTypes';
import { PanelRegistry, type PanelFactory, type PanelHost } from './controllers/panelRegistry';
import { PanelHostController } from './controllers/panelHostController';
import { PanelLauncherController } from './controllers/panelLauncherController';
import { PanelWorkspaceController } from './controllers/panelWorkspaceController';
import { initShareTarget } from './controllers/shareTargetController';
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
import { applyTagColorsToRoot } from './utils/tagColors';
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
import { PluginBundleLoader } from './utils/pluginBundleLoader';
import { ICONS } from './utils/icons';
import { formatSessionLabel, resolveAutoTitle } from './utils/sessionLabel';
import { CORE_PANEL_SERVICES_CONTEXT_KEY, type PanelCoreServices } from './utils/panelServices';
import { CHAT_PANEL_SERVICES_CONTEXT_KEY, type ChatPanelServices } from './utils/chatPanelServices';

const PROTOCOL_VERSION = CURRENT_PROTOCOL_VERSION;

const RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_DELAY_MS = 30000;
const WS_DEBUG_STORAGE_KEY = 'aiAssistantWsDebug';

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
}

interface AgentSummary {
  agentId: string;
  displayName: string;
  description?: string;
  type?: 'chat' | 'external';
}

import { apiFetch, getWebSocketUrl } from './utils/api';
import { configureStatusBar, enableAppReloadOnResume } from './utils/capacitor';
import { configureTauri, isTauri } from './utils/tauri';
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
    autoFocusChatCheckbox: autoFocusChatCheckboxEl,
    keyboardShortcutsCheckbox: keyboardShortcutsCheckboxEl,
    autoScrollCheckbox: autoScrollCheckboxEl,
    panelWorkspace: panelWorkspaceRoot,
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
  } = elements;

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
  const AUTO_FOCUS_CHAT_STORAGE_KEY = 'aiAssistantAutoFocusChatOnSessionReady';
  const AUTO_SCROLL_STORAGE_KEY = 'aiAssistantAutoScrollEnabled';
  const SHOW_CONTEXT_STORAGE_KEY = 'aiAssistantShowContextEnabled';
  const INCLUDE_PANEL_CONTEXT_STORAGE_KEY = 'aiAssistantIncludePanelContext';
  const BRIEF_MODE_STORAGE_KEY = 'aiAssistantBriefModeEnabled';
  const LIST_INSERT_AT_TOP_STORAGE_KEY = 'aiAssistantListInsertAtTop';

  const initialPreferences = loadClientPreferences({
    audioResponsesStorageKey: AUDIO_RESPONSES_STORAGE_KEY,
    keyboardShortcutsStorageKey: KEYBOARD_SHORTCUTS_STORAGE_KEY,
    autoFocusChatStorageKey: AUTO_FOCUS_CHAT_STORAGE_KEY,
    autoScrollStorageKey: AUTO_SCROLL_STORAGE_KEY,
    showContextStorageKey: SHOW_CONTEXT_STORAGE_KEY,
  });

  const initialAudioResponsesEnabled = initialPreferences.audioResponsesEnabled;
  let keyboardShortcutsEnabled = initialPreferences.keyboardShortcutsEnabled;
  let autoFocusChatOnSessionReady = initialPreferences.autoFocusChatOnSessionReady;
  let autoScrollEnabled = initialPreferences.autoScrollEnabled;
  let showContextEnabled = initialPreferences.showContextEnabled;
  let includePanelContext = true;

  // Set global flag for stripContextLine to use
  const updateShowContextFlag = (enabled: boolean): void => {
    (globalThis as { __ASSISTANT_HIDE_CONTEXT__?: boolean }).__ASSISTANT_HIDE_CONTEXT__ = !enabled;
  };
  updateShowContextFlag(showContextEnabled);
  let briefModeEnabled = false;
  let listInsertAtTopEnabled = false;

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

  function getPrimaryChatInputRuntime(): InputRuntime | null {
    return (
      getActiveChatInputRuntime() ?? chatPanelsById.values().next().value?.inputRuntime ?? null
    );
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
      }
      return;
    }
    const models = availableModelsBySession.get(normalized) ?? [];
    if (models.length <= 1) {
      modelSelectEl.classList.add('hidden');
      modelSelectEl.innerHTML = '';
      modelSelectEl.disabled = true;
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
      return;
    }
    const currentModel = currentModelBySession.get(normalized) ?? defaultModel;
    modelSelectEl.value = currentModel;
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
    chatPanelsById.set(panelId, entry);
    const abortController = new AbortController();
    if (dom.sessionLabelEl) {
      dom.sessionLabelEl.addEventListener(
        'click',
        (event) => {
          event.preventDefault();
          event.stopPropagation();
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
        },
        { signal: abortController.signal },
      );
    }
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
      }
      if (sessionId) {
        chatPanelIdBySession.set(sessionId, panelId);
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
      } else if (entry.dom.modelSelectEl) {
        entry.dom.modelSelectEl.classList.add('hidden');
        entry.dom.modelSelectEl.innerHTML = '';
        entry.dom.modelSelectEl.disabled = true;
      }
      const active = host.getContext('panel.active') as { panelId?: string } | null;
      if (sessionId && active?.panelId === panelId && sessionId !== inputSessionId) {
        setInputSessionId(sessionId);
      }
      updateSessionSubscriptions();
      if (sessionId) {
        void loadSessionTranscript(sessionId, { force: true });
      }
    };
    updateBinding(host.getBinding());
    const unsubBinding = host.onBindingChange(updateBinding);
    const unsubSessionContext = host.subscribeSessionContext(() => {
      updateChatPanelSessionLabel(entry);
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
    updateChatPanelSessionLabel(entry);
    return () => {
      abortController.abort();
      unsubBinding();
      unsubSessionContext();
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

  // Keyboard navigation state
  type FocusZone = 'sidebar' | 'input';
  let focusedSessionId: string | null = null;

  let keyboardNavigationController: KeyboardNavigationController | null = null;
  let sessionManager: SessionManager | null = null;
  let sessionDataController: SessionDataController | null = null;
  let sessionTypingIndicatorController: SessionTypingIndicatorController | null = null;
  let panelLauncherController: PanelLauncherController | null = null;
  let sessionPickerController: SessionPickerController | null = null;
  let connectionManager: ConnectionManager | null = null;
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
        return Boolean(active.closest('.panel-frame-controls, .chat-header'));
      };
      panelWorkspace?.setActiveChatPanelId(panelId);
      const binding = panelHostControllerInstance.getPanelBinding(panelId);
      const boundSessionId =
        binding?.mode === 'fixed' ? normalizeSessionId(binding.sessionId) : null;
      if (boundSessionId && boundSessionId !== inputSessionId) {
        setInputSessionId(boundSessionId);
      }
      if (focusSource !== 'chrome' && !isChromeActive() && !isMobileViewport()) {
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

  const openSessionPicker = (options: SessionPickerOpenOptions): void => {
    requireSessionPicker().open({
      ...options,
      onDeleteSession: options.onDeleteSession ?? ((sessionId) => void deleteSession(sessionId)),
    });
  };

  panelHostControllerInstance.setContext(CORE_PANEL_SERVICES_CONTEXT_KEY, {
    dialogManager,
    contextMenuManager,
    listColumnPreferencesClient,
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
      for (const summary of summaries) {
        const anySummary = summary as SessionSummary & { model?: string };
        if (typeof anySummary.model === 'string' && anySummary.model.trim().length > 0) {
          currentModelBySession.set(anySummary.sessionId, anySummary.model.trim());
        }
      }
      syncSessionContext();
      for (const sessionId of currentModelBySession.keys()) {
        updateChatPanelModelSelect(sessionId);
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
    updateLayoutReplacePanelState();
  });
  controlsToggleButtonEl.addEventListener('click', () => {
    layoutDropdownController?.toggle(false);
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
        },
      })
    : null;
  panelLauncherController?.attach();

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
        body: JSON.stringify({ sessionId: trimmed }),
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
    socket.send(JSON.stringify(event));
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
    getPendingMessageListControllerForSession: (sessionId) =>
      getChatInputRuntimeForSession(sessionId)?.pendingMessageListController ?? null,
    cancelQueuedMessage,
    editQueuedMessage,
    handlePanelEvent: (event) => {
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
      openPanelLauncher: () => {
        panelLauncherController?.open();
      },
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
      void fetchPlugins();
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
