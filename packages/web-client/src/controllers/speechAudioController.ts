import type { ClientControlMessage } from '@assistant/shared';
import { TtsAudioPlayer } from '../utils/audio';
import type { AudioMode } from '../utils/audioMode';
import { normalizeVoiceSettings, type VoiceSettings } from '../utils/voiceSettings';
import type { SpeechInputController } from './speechInput';

export interface AssistantNativeVoiceSelection {
  panelId: string;
  sessionId: string;
}

export interface AssistantNativeVoiceInputDevice {
  id: string;
  label: string;
}

export interface AssistantNativeVoiceSettingsArgs {
  settings: VoiceSettings;
}

export interface AssistantNativeVoiceSelectionArgs {
  selection: AssistantNativeVoiceSelection | null;
}

export interface AssistantNativeVoiceUrlArgs {
  url: string;
}

export type AssistantNativeVoiceRuntimeState =
  | 'disabled'
  | 'connecting'
  | 'idle'
  | 'speaking'
  | 'listening'
  | 'error';

export interface AssistantNativeVoiceStatePayload {
  state?: string;
  voiceSettings?: VoiceSettings;
  assistantBaseUrl?: string;
  selectedSession?: AssistantNativeVoiceSelection | null;
  lastError?: string;
}

export interface AssistantNativeVoiceRuntimeErrorPayload {
  message?: string;
}

interface AssistantNativeVoiceListenerHandle {
  remove?: () => void | Promise<void>;
}

export interface AssistantNativeVoiceBridgeTarget {
  setVoiceSettings?: (args: AssistantNativeVoiceSettingsArgs) => void | Promise<void>;
  setSelectedSession?: (args: AssistantNativeVoiceSelectionArgs) => void | Promise<void>;
  setAssistantBaseUrl?: (args: AssistantNativeVoiceUrlArgs) => void | Promise<void>;
  stopCurrentInteraction?: () => void | Promise<void>;
  startManualListen?: () => void | Promise<void>;
  listInputDevices?:
    () =>
      | AssistantNativeVoiceInputDevice[]
      | Promise<AssistantNativeVoiceInputDevice[]>;
  getState?: () => AssistantNativeVoiceStatePayload | Promise<AssistantNativeVoiceStatePayload>;
  addListener?: (
    eventName: 'stateChanged' | 'runtimeError',
    listener: (payload: unknown) => void,
  ) => AssistantNativeVoiceListenerHandle | Promise<AssistantNativeVoiceListenerHandle>;
}

interface AssistantNativeVoiceBridgeHost {
  AssistantNativeVoice?: AssistantNativeVoiceBridgeTarget;
  Capacitor?: {
    Plugins?: {
      AssistantNativeVoice?: AssistantNativeVoiceBridgeTarget;
    };
  };
}

export class AssistantNativeVoiceBridge {
  constructor(
    private readonly getHost: () => AssistantNativeVoiceBridgeHost | null = () => {
      if (typeof window === 'undefined') {
        return null;
      }
      return window as unknown as AssistantNativeVoiceBridgeHost;
    },
  ) {}

  setSelectedSession(selection: AssistantNativeVoiceSelection | null): Promise<boolean> {
    return this.invokeAsync('setSelectedSession', { selection });
  }

  setVoiceSettings(settings: VoiceSettings): Promise<boolean> {
    return this.invokeAsync('setVoiceSettings', { settings });
  }

  setAssistantBaseUrl(url: string): Promise<boolean> {
    return this.invokeAsync('setAssistantBaseUrl', { url });
  }

  async listInputDevices(): Promise<AssistantNativeVoiceInputDevice[]> {
    const target = this.getTarget();
    if (!target || typeof target.listInputDevices !== 'function') {
      return [];
    }
    try {
      const result = target.listInputDevices();
      const resolved = await Promise.resolve(result);
      const entries = Array.isArray(resolved)
        ? resolved
        : (
            resolved &&
            typeof resolved === 'object' &&
            Array.isArray((resolved as { devices?: unknown }).devices)
          )
          ? (resolved as { devices: unknown[] }).devices
          : [];
      return entries
        .map((entry) => {
          if (!entry || typeof entry !== 'object') {
            return null;
          }
          const record = entry as Record<string, unknown>;
          const id = typeof record['id'] === 'string' ? record['id'].trim() : '';
          const label = typeof record['label'] === 'string' ? record['label'].trim() : '';
          if (!id || !label) {
            return null;
          }
          return { id, label };
        })
        .filter((entry): entry is AssistantNativeVoiceInputDevice => entry !== null);
    } catch (error) {
      console.warn('[client] AssistantNativeVoice.listInputDevices failed', error);
      return [];
    }
  }

  stopCurrentInteraction(): boolean {
    return this.invoke('stopCurrentInteraction');
  }

  startManualListen(): boolean {
    return this.invoke('startManualListen');
  }

  isAvailable(): boolean {
    return this.getTarget() !== null;
  }

  async getState(): Promise<AssistantNativeVoiceStatePayload | null> {
    const target = this.getTarget();
    if (!target || typeof target.getState !== 'function') {
      return null;
    }
    try {
      const result = target.getState();
      return (await Promise.resolve(result)) ?? null;
    } catch (error) {
      console.warn('[client] AssistantNativeVoice.getState failed', error);
      return null;
    }
  }

  addStateChangedListener(
    listener: (payload: AssistantNativeVoiceStatePayload) => void,
  ): (() => void) | null {
    return this.addListener('stateChanged', (payload) => {
      listener((payload as AssistantNativeVoiceStatePayload | null) ?? {});
    });
  }

  addRuntimeErrorListener(
    listener: (payload: AssistantNativeVoiceRuntimeErrorPayload) => void,
  ): (() => void) | null {
    return this.addListener('runtimeError', (payload) => {
      listener((payload as AssistantNativeVoiceRuntimeErrorPayload | null) ?? {});
    });
  }

  private getTarget(): AssistantNativeVoiceBridgeTarget | null {
    const host = this.getHost();
    if (!host) {
      return null;
    }
    return host.AssistantNativeVoice ?? host.Capacitor?.Plugins?.AssistantNativeVoice ?? null;
  }

  private addListener(
    eventName: 'stateChanged' | 'runtimeError',
    listener: (payload: unknown) => void,
  ): (() => void) | null {
    const target = this.getTarget();
    const method = target?.addListener;
    if (typeof method !== 'function') {
      return null;
    }

    let removed = false;
    let handle: AssistantNativeVoiceListenerHandle | null = null;
    const removeHandle = (): void => {
      removed = true;
      if (handle && typeof handle.remove === 'function') {
        void Promise.resolve(handle.remove()).catch((error: unknown) => {
          console.warn(`[client] AssistantNativeVoice.${eventName}.remove failed`, error);
        });
      }
    };

    try {
      const result = method(eventName, listener);
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(result)
          .then((resolved) => {
            handle = (resolved as AssistantNativeVoiceListenerHandle | null) ?? null;
            if (removed && handle && typeof handle.remove === 'function') {
              void Promise.resolve(handle.remove()).catch((error: unknown) => {
                console.warn(`[client] AssistantNativeVoice.${eventName}.remove failed`, error);
              });
            }
          })
          .catch((error: unknown) => {
            console.warn(`[client] AssistantNativeVoice.${eventName} listener failed`, error);
          });
      } else {
        handle = (result as AssistantNativeVoiceListenerHandle | null) ?? null;
      }
      return removeHandle;
    } catch (error) {
      console.warn(`[client] AssistantNativeVoice.${eventName} listener failed`, error);
      return null;
    }
  }

  private invoke<K extends keyof AssistantNativeVoiceBridgeTarget>(
    methodName: K,
    ...args: Parameters<NonNullable<AssistantNativeVoiceBridgeTarget[K]>>
  ): boolean {
    const target = this.getTarget();
    const method = target?.[methodName] as
      | ((...methodArgs: Parameters<NonNullable<AssistantNativeVoiceBridgeTarget[K]>>) => unknown)
      | undefined;
    if (typeof method !== 'function') {
      return false;
    }

    try {
      const result = method(...args);
      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        void Promise.resolve(result).catch((error: unknown) => {
          console.warn(`[client] AssistantNativeVoice.${String(methodName)} failed`, error);
        });
      }
      return true;
    } catch (error) {
      console.warn(`[client] AssistantNativeVoice.${String(methodName)} failed`, error);
      return false;
    }
  }

  private async invokeAsync<K extends keyof AssistantNativeVoiceBridgeTarget>(
    methodName: K,
    ...args: Parameters<NonNullable<AssistantNativeVoiceBridgeTarget[K]>>
  ): Promise<boolean> {
    const target = this.getTarget();
    const method = target?.[methodName] as
      | ((...methodArgs: Parameters<NonNullable<AssistantNativeVoiceBridgeTarget[K]>>) => unknown)
      | undefined;
    if (typeof method !== 'function') {
      return false;
    }

    try {
      const result = method(...args);
      await Promise.resolve(result);
      return true;
    } catch (error) {
      console.warn(`[client] AssistantNativeVoice.${String(methodName)} failed`, error);
      return false;
    }
  }
}

export interface SpeechAudioControllerOptions {
  speechFeaturesEnabled: boolean;
  speechInputController: SpeechInputController | null;
  micButtonEl: HTMLButtonElement;
  audioModeSelectEl: HTMLSelectElement;
  autoListenCheckboxEl: HTMLInputElement;
  voiceAdapterBaseUrlInputEl: HTMLInputElement;
  voiceMicInputSelectEl: HTMLSelectElement;
  voiceRecognitionStartTimeoutInputEl: HTMLInputElement;
  voiceRecognitionCompletionTimeoutInputEl: HTMLInputElement;
  voiceRecognitionEndSilenceInputEl: HTMLInputElement;
  inputEl: HTMLInputElement;
  getSocket: () => WebSocket | null;
  getSessionId: () => string | null;
  setStatus: (text: string) => void;
  setTtsStatus: (text: string) => void;
  sendUserText: (text: string) => void;
  updateClearInputButtonVisibility: () => void;
  sendModesUpdate: () => void;
  supportsAudioOutput: () => boolean;
  isOutputActive: () => boolean;
  updateScrollButtonVisibility: () => void;
  getPendingAssistantBubble?: () => HTMLDivElement | null;
  setPendingAssistantBubble?: (bubble: HTMLDivElement | null) => void;
  voiceSettingsStorageKey: string;
  continuousListeningLongPressMs: number;
  initialVoiceSettings: VoiceSettings;
  useNativeVoiceRuntime?: boolean | undefined;
  nativeVoiceBridge?: AssistantNativeVoiceBridge | null | undefined;
}

export class SpeechAudioController {
  private static readonly AUTO_REARM_GRACE_MS = 300;
  private isSpeechInputActive = false;
  private speechInputDisabledReason: string | null = null;
  private speechStartToken = 0;
  private currentAudioMode: AudioMode;
  private currentAutoListenEnabled: boolean;
  private continuousListeningMode = false;
  private micPressStartTime: number | null = null;
  private micPressTimer: ReturnType<typeof setTimeout> | null = null;
  private micPressHandled = false;
  private speechInputBaseText: string | null = null;
  private speechInputCancelled = false;
  private ttsPlayer: TtsAudioPlayer | null = null;
  private isTtsPlaying = false;
  private mediaSessionAttached = false;
  private chimeContext: AudioContext | null = null;
  private autoRearmTimer: ReturnType<typeof setTimeout> | null = null;
  private autoRearmToken = 0;
  private voiceSettingsChangeHandler: ((settings: VoiceSettings) => void) | null = null;
  private nativeRuntimeState: AssistantNativeVoiceRuntimeState | null = null;
  private currentVoiceSettings: VoiceSettings;
  private availableNativeInputDevices: AssistantNativeVoiceInputDevice[] = [];

  constructor(private readonly options: SpeechAudioControllerOptions) {
    this.currentVoiceSettings = normalizeVoiceSettings(options.initialVoiceSettings);
    this.currentAudioMode = this.currentVoiceSettings.audioMode;
    this.currentAutoListenEnabled = this.currentVoiceSettings.autoListenEnabled;
  }

  get voiceSettings(): VoiceSettings {
    return { ...this.currentVoiceSettings };
  }

  get audioMode(): AudioMode {
    return this.currentAudioMode;
  }

  get autoListenEnabled(): boolean {
    return this.currentAutoListenEnabled;
  }

  setVoiceSettingsChangeHandler(handler: ((settings: VoiceSettings) => void) | null): void {
    this.voiceSettingsChangeHandler = handler;
  }

  setNativeRuntimeState(state: AssistantNativeVoiceRuntimeState | null): void {
    this.nativeRuntimeState = state;
    this.syncMicButtonState();
  }

  async refreshNativeInputDevices(): Promise<void> {
    if (!this.options.useNativeVoiceRuntime) {
      this.availableNativeInputDevices = [];
      this.syncNativeInputDeviceOptions();
      return;
    }
    this.availableNativeInputDevices = await (
      this.options.nativeVoiceBridge?.listInputDevices() ?? Promise.resolve([])
    );
    this.syncNativeInputDeviceOptions();
  }

  private logState(event: string, details: Record<string, unknown> = {}): void {
    console.log('[client] SpeechAudio', event, {
      speechActive: this.isSpeechInputActive,
      ttsPlaying: this.isTtsPlaying,
      outputActive: this.options.isOutputActive(),
      continuousListening: this.continuousListeningMode,
      ...details,
    });
  }

  private attachMediaSessionHandlers(): void {
    if (this.mediaSessionAttached || !this.hasSpeechInput || this.isUsingNativeVoiceRuntime()) {
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.mediaSession) {
      return;
    }

    const mediaSession = navigator.mediaSession;
    const handleToggle = (action: string) => {
      this.logState('media-session-action', { action });
      if (this.isSpeechInputActive || this.isNativeInteractionActive()) {
        this.logState('media-session-step', { step: 'cancel-recording' });
        if (this.isUsingNativeVoiceRuntime()) {
          this.options.nativeVoiceBridge?.stopCurrentInteraction();
        } else {
          this.cancelSpeechInput('media-session');
        }
        this.syncMicButtonState();
        return;
      }
      if (this.cancelAllActiveOperations()) {
        this.logState('media-session-step', { step: 'cancel-output' });
        return;
      }
      this.logState('media-session-step', { step: 'start-recording' });
      this.continuousListeningMode = false;
      void this.startPushToTalk();
    };

    const registerHandler = (action: MediaSessionAction, handler: () => void) => {
      try {
        mediaSession.setActionHandler(action, handler);
      } catch (err) {
        console.warn(`[client] MediaSession handler not supported: ${action}`, err);
      }
    };

    registerHandler('nexttrack', () => handleToggle('nexttrack'));

    this.mediaSessionAttached = true;
    this.updateMediaSessionPlaybackState();
  }

  private updateMediaSessionPlaybackState(): void {
    if (!this.mediaSessionAttached || typeof navigator === 'undefined' || !navigator.mediaSession) {
      return;
    }
    const playbackState: MediaSessionPlaybackState = this.isTtsPlaying ? 'playing' : 'paused';
    try {
      navigator.mediaSession.playbackState = playbackState;
    } catch (err) {
      console.warn('[client] MediaSession playbackState update failed', err);
    }
  }

  private async playStartChime(): Promise<number> {
    if (!this.options.supportsAudioOutput()) {
      return 0;
    }
    if (typeof window === 'undefined') {
      return 0;
    }
    const audioContextCtor =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!audioContextCtor) {
      return 0;
    }

    if (!this.chimeContext) {
      this.chimeContext = new audioContextCtor();
    }

    const ctx = this.chimeContext;
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        return 0;
      }
    }

    const now = ctx.currentTime;
    const delaySec = 0.25;
    const durationSec = 0.35;
    const startTime = now + delaySec;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(0.1, startTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec);
    gain.connect(ctx.destination);

    const oscLow = ctx.createOscillator();
    oscLow.type = 'sine';
    oscLow.frequency.setValueAtTime(660, startTime);
    oscLow.frequency.exponentialRampToValueAtTime(880, startTime + durationSec);
    oscLow.connect(gain);

    const oscHigh = ctx.createOscillator();
    oscHigh.type = 'sine';
    oscHigh.frequency.setValueAtTime(990, startTime);
    oscHigh.frequency.exponentialRampToValueAtTime(1320, startTime + durationSec);
    oscHigh.connect(gain);

    oscLow.start(startTime);
    oscHigh.start(startTime);
    oscLow.stop(startTime + durationSec);
    oscHigh.stop(startTime + durationSec);

    oscHigh.addEventListener(
      'ended',
      () => {
        oscLow.disconnect();
        oscHigh.disconnect();
        gain.disconnect();
      },
      { once: true },
    );

    return Math.round((delaySec + durationSec) * 1000);
  }

  get hasSpeechInput(): boolean {
    return (
      this.options.speechFeaturesEnabled &&
      !!this.options.speechInputController &&
      !this.speechInputDisabledReason
    );
  }

  get isSpeechActive(): boolean {
    return this.isSpeechInputActive;
  }

  get isAudioEnabled(): boolean {
    return this.currentAudioMode !== 'off';
  }

  get isResponseMode(): boolean {
    return this.currentAudioMode === 'response';
  }

  setContinuousListeningMode(enabled: boolean): void {
    this.continuousListeningMode = enabled;
    if (!enabled) {
      this.clearAutoRearmTimer();
    }
    this.logState('continuous-listening', { enabled });
  }

  attach(): void {
    const { micButtonEl, audioModeSelectEl } = this.options;
    const autoListenCheckboxEl = this.options.autoListenCheckboxEl;

    if (!this.hasSpeechInput) {
      micButtonEl.disabled = true;
      const message = this.speechInputDisabledReason
        ? 'Speech input is unavailable. Check microphone permissions.'
        : 'Speech input is not supported in this browser';
      micButtonEl.title = message;
      micButtonEl.setAttribute('aria-label', message);
      console.log('[client] disabling mic button: speech input not supported');
    }

    micButtonEl.addEventListener('pointerdown', (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) {
        return;
      }
      const pointerType = event.pointerType;
      this.logState('mic-pointerdown', { pointerType, button: event.button });
      this.micPressStartTime = performance.now();
      this.micPressHandled = false;
      this.clearMicPressTimer();
      this.micPressTimer = setTimeout(() => {
        this.micPressTimer = null;
        if (this.micPressHandled || this.micPressStartTime === null) {
          return;
        }
        if (this.isSpeechInputActive) {
          return;
        }

        this.logState('mic-longpress', { pointerType });
        if (this.cancelAllActiveOperations()) {
          this.logState('mic-action', { action: 'cancel-output', source: 'long-press' });
          this.micPressHandled = true;
          return;
        }

        this.logState('mic-action', { action: 'start-recording', source: 'long-press' });
        this.continuousListeningMode = true;
        this.micPressHandled = true;
        void this.startPushToTalk();
      }, this.options.continuousListeningLongPressMs);
    });

    micButtonEl.addEventListener('pointerup', (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) {
        return;
      }
      const startTime = this.micPressStartTime;
      const wasHandled = this.micPressHandled;
      this.micPressStartTime = null;
      this.micPressHandled = false;
      this.clearMicPressTimer();
      const now = performance.now();
      const isLongPress =
        typeof startTime === 'number' &&
        now - startTime >= this.options.continuousListeningLongPressMs;

      this.logState('mic-pointerup', {
        isLongPress,
        pointerType: event.pointerType,
        handled: wasHandled,
      });

      if (wasHandled) {
        return;
      }

      if (this.isSpeechInputActive) {
        this.logState('mic-action', { action: 'cancel-recording' });
        this.cancelSpeechInput('mic');
        this.syncMicButtonState();
        return;
      }

      if (this.cancelAllActiveOperations()) {
        this.logState('mic-action', { action: 'cancel-output' });
        return;
      }

      this.logState('mic-action', { action: 'start-recording' });
      this.continuousListeningMode = isLongPress;
      void this.startPushToTalk();
    });

    micButtonEl.addEventListener('pointercancel', () => {
      this.micPressStartTime = null;
      this.micPressHandled = false;
      this.clearMicPressTimer();
      this.logState('mic-pointercancel');
    });

    micButtonEl.addEventListener('pointerleave', () => {
      this.micPressStartTime = null;
      this.micPressHandled = false;
      this.clearMicPressTimer();
      this.logState('mic-pointerleave');
    });

    micButtonEl.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.logState('mic-keydown', { key: event.key });
        if (this.isSpeechInputActive) {
          this.logState('mic-action', { action: 'cancel-recording', source: 'keyboard' });
          this.cancelSpeechInput('keyboard');
          this.syncMicButtonState();
          return;
        }
        if (this.cancelAllActiveOperations()) {
          this.logState('mic-action', { action: 'cancel-output', source: 'keyboard' });
          return;
        }
        this.logState('mic-action', { action: 'start-recording', source: 'keyboard' });
        this.continuousListeningMode = false;
        void this.startPushToTalk();
      }
    });

    audioModeSelectEl.addEventListener('change', () => {
      this.setVoiceSettings({
        ...this.currentVoiceSettings,
        audioMode: audioModeSelectEl.value as AudioMode,
      });
    });
    autoListenCheckboxEl.addEventListener('change', () => {
      this.setVoiceSettings({
        ...this.currentVoiceSettings,
        autoListenEnabled: autoListenCheckboxEl.checked,
      });
    });
    this.options.voiceAdapterBaseUrlInputEl.addEventListener('change', () => {
      this.commitVoiceSettingsFromInputs();
    });
    this.options.voiceMicInputSelectEl.addEventListener('change', () => {
      this.setVoiceSettings({
        ...this.currentVoiceSettings,
        selectedMicDeviceId: this.options.voiceMicInputSelectEl.value,
      });
    });
    this.options.voiceRecognitionStartTimeoutInputEl.addEventListener('change', () => {
      this.commitVoiceSettingsFromInputs();
    });
    this.options.voiceRecognitionCompletionTimeoutInputEl.addEventListener('change', () => {
      this.commitVoiceSettingsFromInputs();
    });
    this.options.voiceRecognitionEndSilenceInputEl.addEventListener('change', () => {
      this.commitVoiceSettingsFromInputs();
    });
    this.options.voiceAdapterBaseUrlInputEl.addEventListener('blur', () => {
      this.syncVoiceSettingsInputs();
    });
    this.options.voiceRecognitionStartTimeoutInputEl.addEventListener('blur', () => {
      this.syncVoiceSettingsInputs();
    });
    this.options.voiceRecognitionCompletionTimeoutInputEl.addEventListener('blur', () => {
      this.syncVoiceSettingsInputs();
    });
    this.options.voiceRecognitionEndSilenceInputEl.addEventListener('blur', () => {
      this.syncVoiceSettingsInputs();
    });

    this.applyVoiceSettings(this.currentVoiceSettings, { persist: false, notify: false });
    void this.refreshNativeInputDevices();

    this.syncMicButtonState();
    this.attachMediaSessionHandlers();
  }

  onConnectionLostCleanup(): void {
    const speechInputController = this.options.speechInputController;
    if (speechInputController && speechInputController.isActive) {
      speechInputController.stop();
    }
    this.isSpeechInputActive = false;
    this.continuousListeningMode = false;
    this.options.micButtonEl.classList.remove('recording', 'interrupting', 'stopping');
    if (this.ttsPlayer) {
      this.ttsPlayer.stop();
    }
    this.clearAutoRearmTimer();
    this.isTtsPlaying = false;
    this.updateMediaSessionPlaybackState();
    this.logState('connection-lost-cleanup');
    this.syncMicButtonState();
    this.options.setTtsStatus('');
  }

  handleIncomingAudioFrame(raw: ArrayBuffer): void {
    if (this.isUsingNativeVoiceRuntime()) {
      return;
    }
    if (!this.ttsPlayer || this.currentAudioMode !== 'response') {
      return;
    }

    const wasPlaying = this.isTtsPlaying;
    this.options.setTtsStatus('Playing audio…');

    console.log('[client] TTS audio frame received; starting/continuing playback');
    this.ttsPlayer.handleIncomingFrame(raw);
    if (!this.isSpeechInputActive) {
      this.options.micButtonEl.classList.add('interrupting');
    }
    this.isTtsPlaying = true;
    this.scheduleAutoRearmAfterTts();
    if (!wasPlaying) {
      this.logState('tts-start');
    }
    this.updateMediaSessionPlaybackState();
    this.syncMicButtonState();
  }

  resetForSessionSwitch(): void {
    if (this.ttsPlayer) {
      this.ttsPlayer.stop();
      if (this.currentAudioMode === 'response') {
        this.ttsPlayer.setEnabled(true);
      }
    }
    this.clearAutoRearmTimer();
    this.options.micButtonEl.classList.remove('interrupting');
    this.isTtsPlaying = false;
    this.updateMediaSessionPlaybackState();
    this.logState('session-switch-reset');
    this.syncMicButtonState();
    this.options.setTtsStatus('');
  }

  handleOutputCancelled(): void {
    if (this.ttsPlayer) {
      this.ttsPlayer.stopForBargeIn();
    }
    this.clearAutoRearmTimer();
    if (this.currentAudioMode !== 'off') {
      this.options.setTtsStatus('Cancelled');
    }
    this.options.micButtonEl.classList.remove('interrupting');
    this.isTtsPlaying = false;
    this.updateMediaSessionPlaybackState();
    this.logState('output-cancelled');
    this.syncMicButtonState();
  }

  maybeAutoStartListeningAfterTts(): void {
    if (!this.options.speechFeaturesEnabled) {
      return;
    }
    if (!this.options.speechInputController) {
      return;
    }
    if (this.isSpeechInputActive) {
      return;
    }
    if (this.currentAudioMode !== 'response') {
      return;
    }
    const socket = this.options.getSocket();
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    if (!this.shouldAutoListenAfterPlayback()) {
      return;
    }

    this.scheduleAutoRearmAfterTts();
  }

  setAudioMode(mode: AudioMode): void {
    this.setVoiceSettings({
      ...this.currentVoiceSettings,
      audioMode: mode,
    });
  }

  setAutoListenEnabled(enabled: boolean): void {
    this.setVoiceSettings({
      ...this.currentVoiceSettings,
      autoListenEnabled: enabled,
    });
  }

  setVoiceSettings(settings: VoiceSettings): void {
    this.applyVoiceSettings(settings, { persist: true, notify: true });
  }

  private commitVoiceSettingsFromInputs(): void {
    this.applyVoiceSettings(
      normalizeVoiceSettings({
        ...this.currentVoiceSettings,
        audioMode: this.options.audioModeSelectEl.value,
        autoListenEnabled: this.options.autoListenCheckboxEl.checked,
        voiceAdapterBaseUrl: this.options.voiceAdapterBaseUrlInputEl.value,
        selectedMicDeviceId: this.options.voiceMicInputSelectEl.value,
        recognitionStartTimeoutMs: this.options.voiceRecognitionStartTimeoutInputEl.value,
        recognitionCompletionTimeoutMs: this.options.voiceRecognitionCompletionTimeoutInputEl.value,
        recognitionEndSilenceMs: this.options.voiceRecognitionEndSilenceInputEl.value,
      }),
      { persist: true, notify: true },
    );
  }

  private applyVoiceSettings(
    settings: VoiceSettings,
    options: { persist: boolean; notify: boolean },
  ): void {
    let nextSettings = normalizeVoiceSettings(settings);
    if (!this.options.supportsAudioOutput()) {
      nextSettings = {
        ...nextSettings,
        audioMode: 'off',
        autoListenEnabled: false,
      };
    }

    const nextMode: AudioMode =
      nextSettings.audioMode === 'response' && this.options.useNativeVoiceRuntime
        ? 'response'
        : nextSettings.audioMode;
    const nextAutoListenEnabled = Boolean(nextSettings.autoListenEnabled);
    const previousSettings = this.currentVoiceSettings;
    const previousMode = previousSettings.audioMode;
    const previousEnabled = previousMode !== 'off';
    const nextEnabled = nextMode !== 'off';

    if (nextMode === 'response' && !this.options.useNativeVoiceRuntime && !this.ttsPlayer) {
      this.ttsPlayer = new TtsAudioPlayer({
        jitterBufferMs: 200,
        onIdle: () => {
          this.options.micButtonEl.classList.remove('interrupting');
          this.options.setTtsStatus('');
          this.isTtsPlaying = false;
          this.logState('tts-idle');
          this.syncMicButtonState();
          this.updateMediaSessionPlaybackState();
          this.maybeAutoStartListeningAfterTts();
        },
      });
    }

    if (this.ttsPlayer) {
      this.ttsPlayer.setMuted(false);
      this.ttsPlayer.setEnabled(nextMode === 'response');
      if (nextMode !== 'response') {
        this.ttsPlayer.stop();
        this.clearAutoRearmTimer();
        this.isTtsPlaying = false;
        this.options.micButtonEl.classList.remove('interrupting');
        this.options.setTtsStatus('');
      }
    }

    if (!nextEnabled) {
      this.clearAutoRearmTimer();
      this.isTtsPlaying = false;
      this.options.setTtsStatus('');
    }
    if (!nextAutoListenEnabled) {
      this.clearAutoRearmTimer();
    }

    nextSettings = {
      ...nextSettings,
      audioMode: nextMode,
      autoListenEnabled: nextAutoListenEnabled,
    };
    this.currentVoiceSettings = nextSettings;
    this.currentAudioMode = nextMode;
    this.currentAutoListenEnabled = nextAutoListenEnabled;
    this.syncVoiceSettingsInputs();
    this.syncVoiceSettingsControlState();
    this.updateMediaSessionPlaybackState();
    this.syncMicButtonState();

    if (options.persist) {
      try {
        localStorage.setItem(
          this.options.voiceSettingsStorageKey,
          JSON.stringify(this.currentVoiceSettings),
        );
      } catch {
        // Ignore localStorage errors
      }
    }
    this.options.sendModesUpdate();
    if (
      options.notify &&
      (
        previousMode !== nextMode ||
        previousEnabled !== nextEnabled ||
        previousSettings.autoListenEnabled !== nextAutoListenEnabled ||
        previousSettings.voiceAdapterBaseUrl !== nextSettings.voiceAdapterBaseUrl ||
        previousSettings.selectedMicDeviceId !== nextSettings.selectedMicDeviceId ||
        previousSettings.recognitionStartTimeoutMs !== nextSettings.recognitionStartTimeoutMs ||
        previousSettings.recognitionCompletionTimeoutMs !==
          nextSettings.recognitionCompletionTimeoutMs ||
        previousSettings.recognitionEndSilenceMs !== nextSettings.recognitionEndSilenceMs
      )
    ) {
      this.voiceSettingsChangeHandler?.({ ...this.currentVoiceSettings });
    }
  }

  private syncVoiceSettingsInputs(): void {
    this.options.audioModeSelectEl.value = this.currentVoiceSettings.audioMode;
    this.options.autoListenCheckboxEl.checked = this.currentVoiceSettings.autoListenEnabled;
    this.options.voiceAdapterBaseUrlInputEl.value = this.currentVoiceSettings.voiceAdapterBaseUrl;
    this.syncNativeInputDeviceOptions();
    this.options.voiceRecognitionStartTimeoutInputEl.value = String(
      this.currentVoiceSettings.recognitionStartTimeoutMs,
    );
    this.options.voiceRecognitionCompletionTimeoutInputEl.value = String(
      this.currentVoiceSettings.recognitionCompletionTimeoutMs,
    );
    this.options.voiceRecognitionEndSilenceInputEl.value = String(
      this.currentVoiceSettings.recognitionEndSilenceMs,
    );
  }

  private syncVoiceSettingsControlState(): void {
    const supportsAudioOutput = this.options.supportsAudioOutput();
    const supportsNativeVoiceSettings = Boolean(this.options.useNativeVoiceRuntime);
    this.options.audioModeSelectEl.disabled = !supportsAudioOutput;
    this.options.autoListenCheckboxEl.disabled = !supportsAudioOutput;
    this.options.voiceAdapterBaseUrlInputEl.disabled = !supportsNativeVoiceSettings;
    this.options.voiceMicInputSelectEl.disabled = !supportsNativeVoiceSettings;
    this.options.voiceRecognitionStartTimeoutInputEl.disabled = !supportsNativeVoiceSettings;
    this.options.voiceRecognitionCompletionTimeoutInputEl.disabled = !supportsNativeVoiceSettings;
    this.options.voiceRecognitionEndSilenceInputEl.disabled = !supportsNativeVoiceSettings;
  }

  private syncNativeInputDeviceOptions(): void {
    const selectEl = this.options.voiceMicInputSelectEl;
    const selectedMicDeviceId = this.currentVoiceSettings.selectedMicDeviceId;
    const devices = this.availableNativeInputDevices;
    const existingValues = new Set<string>();
    selectEl.replaceChildren();

    const systemDefaultOption = document.createElement('option');
    systemDefaultOption.value = '';
    systemDefaultOption.textContent = 'System default';
    selectEl.appendChild(systemDefaultOption);
    existingValues.add('');

    for (const device of devices) {
      if (existingValues.has(device.id)) {
        continue;
      }
      const option = document.createElement('option');
      option.value = device.id;
      option.textContent = device.label;
      selectEl.appendChild(option);
      existingValues.add(device.id);
    }

    if (selectedMicDeviceId && !existingValues.has(selectedMicDeviceId)) {
      const unavailableOption = document.createElement('option');
      unavailableOption.value = selectedMicDeviceId;
      unavailableOption.textContent = `Unavailable device [id:${selectedMicDeviceId}]`;
      selectEl.appendChild(unavailableOption);
    }

    selectEl.value = selectedMicDeviceId;
    if (selectEl.value !== selectedMicDeviceId) {
      selectEl.value = '';
    }
  }

  async startPushToTalk(): Promise<void> {
    console.log('[client] startPushToTalk invoked', {
      socketState: this.options.getSocket()?.readyState,
    });
    this.logState('start-request');
    if (this.isUsingNativeVoiceRuntime()) {
      this.logState('start-native-listen');
      const started = this.options.nativeVoiceBridge?.startManualListen() ?? false;
      if (!started) {
        this.logState('start-abort', { reason: 'native-start-unavailable' });
      }
      return;
    }

    const socket = this.options.getSocket();
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.log('[client] startPushToTalk aborted: socket not open');
      this.logState('start-abort', { reason: 'socket-not-open' });
      return;
    }

    const speechInputController = this.options.speechInputController;
    if (!speechInputController) {
      console.log('[client] startPushToTalk aborted: no speech input controller');
      this.logState('start-abort', { reason: 'no-speech-controller' });
      return;
    }
    if (!this.hasSpeechInput) {
      console.log('[client] startPushToTalk aborted: speech input disabled');
      this.logState('start-abort', { reason: 'speech-disabled' });
      return;
    }

    if (this.shouldInterruptOutput()) {
      console.log('[client] startPushToTalk aborted: output active');
      this.logState('start-abort', { reason: 'output-active' });
      return;
    }

    const startToken = (this.speechStartToken += 1);

    try {
      this.speechInputCancelled = false;
      this.speechInputBaseText = this.options.inputEl.value;
      this.isSpeechInputActive = true;
      this.options.micButtonEl.classList.add('recording');
      this.options.micButtonEl.classList.remove('interrupting');
      this.syncMicButtonState();
      this.options.setStatus('Listening…');
      const chimeDelayMs = await this.playStartChime();
      if (chimeDelayMs > 0) {
        this.logState('start-delay', { delayMs: chimeDelayMs });
        await new Promise<void>((resolve) => {
          setTimeout(resolve, chimeDelayMs);
        });
      }
      if (startToken !== this.speechStartToken) {
        this.speechInputCancelled = false;
        this.logState('start-abort', { reason: 'start-superseded' });
        return;
      }
      if (!this.isSpeechInputActive) {
        this.speechInputCancelled = false;
        this.logState('start-abort', { reason: 'start-cancelled' });
        return;
      }

      this.logState('recording-started');

      const applySpeechText = (text: string) => {
        if (this.speechInputCancelled) {
          return;
        }
        const base = this.speechInputBaseText ?? '';
        if (!text) {
          this.options.inputEl.value = base;
        } else if (base && !base.endsWith(' ')) {
          this.options.inputEl.value = `${base} ${text}`;
        } else {
          this.options.inputEl.value = base ? `${base}${text}` : text;
        }
        this.options.inputEl.setSelectionRange(
          this.options.inputEl.value.length,
          this.options.inputEl.value.length,
        );
        this.options.updateClearInputButtonVisibility();
      };

      speechInputController.start({
        onPartial: (text) => {
          applySpeechText(text);
        },
        onFinal: (text) => {
          if (this.speechInputCancelled) {
            return;
          }
          if (text.trim()) {
            this.options.sendUserText(text);
            return;
          }
          applySpeechText(text);
        },
        onError: (err) => {
          console.error('[client] Speech recognition error', err);
          const errorMessage = err instanceof Error ? err.message : String(err);
          if (this.isSpeechPermissionError(errorMessage)) {
            this.disableSpeechInput(
              'permission',
              'Speech input unavailable. Check microphone permissions.',
            );
            this.logState('speech-error', { error: errorMessage, disabled: true });
            return;
          }
          this.options.setStatus('Speech recognition error – see console');
          this.logState('speech-error', { error: errorMessage });
        },
        onEnd: () => {
          const wasCancelled = this.speechInputCancelled;
          this.speechInputCancelled = false;
          this.isSpeechInputActive = false;
          this.options.micButtonEl.classList.remove('recording');
          const currentSocket = this.options.getSocket();
          if (currentSocket && currentSocket.readyState === WebSocket.OPEN) {
            this.options.setStatus('Connected');
          }
          this.speechInputBaseText = null;
          this.logState('recording-ended', { cancelled: wasCancelled });
        },
      });
    } catch (err) {
      console.error('[client] Failed to start speech input', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (this.isSpeechPermissionError(errorMessage)) {
        this.disableSpeechInput(
          'permission',
          'Speech input unavailable. Check microphone permissions.',
        );
        this.logState('start-failed', { error: errorMessage, disabled: true });
        return;
      }
      this.options.setStatus('Speech input error – see console');
      this.logState('start-failed', { error: errorMessage });
    }
  }

  stopPushToTalk(): void {
    const wasActive = this.isSpeechInputActive;
    this.logState('stop-request');
    if (this.isUsingNativeVoiceRuntime() && this.isNativeInteractionActive()) {
      this.options.nativeVoiceBridge?.stopCurrentInteraction();
      this.logState('recording-stopped', { native: true });
      return;
    }
    if (!wasActive) {
      this.logState('stop-noop');
      return;
    }
    this.cancelSpeechInput('stop', { resetInput: false });
    this.logState('recording-stopped');
  }

  private cancelSpeechInput(
    reason: string,
    options: { resetInput: boolean } = { resetInput: true },
  ): void {
    const speechInputController = this.options.speechInputController;
    console.log('[client] cancelSpeechInput invoked', {
      hasSpeechInputController: !!speechInputController,
      isSpeechInputActive: this.isSpeechInputActive,
      socketState: this.options.getSocket()?.readyState,
      reason,
    });
    if (!speechInputController || !this.isSpeechInputActive) {
      this.logState('recording-cancelled-skip', { reason });
      return;
    }

    this.speechStartToken += 1;
    this.speechInputCancelled = true;
    this.isSpeechInputActive = false;
    this.continuousListeningMode = false;
    this.clearAutoRearmTimer();
    this.options.micButtonEl.classList.remove('recording');
    if (options.resetInput) {
      this.options.inputEl.value = this.speechInputBaseText ?? '';
      this.options.updateClearInputButtonVisibility();
    }
    this.speechInputBaseText = null;
    this.options.setStatus('Connected');
    this.syncMicButtonState();
    this.logState('recording-cancelled', { reason, resetInput: options.resetInput });

    speechInputController.stop();
  }

  cancelAllActiveOperations(): boolean {
    let cancelled = false;
    let audioEndMs: number | undefined;
    const shouldCancelOutput = this.shouldInterruptOutput();
    this.logState('cancel-request');

    if (this.isSpeechInputActive) {
      this.logState('cancel-step', { step: 'speech-input' });
      this.cancelSpeechInput('cancel-all');
      cancelled = true;
    }

    if (this.isUsingNativeVoiceRuntime() && this.isNativeInteractionActive()) {
      this.logState('cancel-step', { step: 'native-voice' });
      this.options.nativeVoiceBridge?.stopCurrentInteraction();
      this.options.setStatus('Connected');
      this.syncMicButtonState();
      this.logState('cancel-complete', { cancelled: true, native: true });
      return true;
    }

    if (this.isTtsPlaying && this.ttsPlayer) {
      this.logState('cancel-step', { step: 'tts' });
      audioEndMs = this.ttsPlayer.stopForBargeIn();
      this.options.micButtonEl.classList.remove('interrupting');
      this.options.setTtsStatus('');
      this.isTtsPlaying = false;
      this.clearAutoRearmTimer();
      this.updateMediaSessionPlaybackState();
      cancelled = true;
    }

    const socket = this.options.getSocket();
    if (shouldCancelOutput && socket && socket.readyState === WebSocket.OPEN) {
      this.logState('cancel-step', { step: 'output', audioEndMs });
      const sessionId = this.options.getSessionId();
      const control: ClientControlMessage = {
        type: 'control',
        action: 'cancel',
        target: 'output',
        ...(sessionId ? { sessionId } : {}),
        ...(typeof audioEndMs === 'number' && audioEndMs > 0 ? { audioEndMs } : {}),
      };
      socket.send(JSON.stringify(control));

      cancelled = true;
    }

    if (cancelled) {
      this.continuousListeningMode = false;
      this.clearAutoRearmTimer();
    }

    if (socket && socket.readyState === WebSocket.OPEN) {
      this.options.setStatus('Connected');
    }

    if (cancelled) {
      this.clearPendingAssistantBubble();
    }

    this.options.updateScrollButtonVisibility();
    this.syncMicButtonState();
    this.logState('cancel-complete', { cancelled, audioEndMs });

    return cancelled;
  }

  private clearPendingAssistantBubble(): void {
    const pendingBubble = this.options.getPendingAssistantBubble?.() ?? null;
    if (!pendingBubble) {
      return;
    }

    const hasContent =
      pendingBubble.querySelector('.tool-output-block') !== null ||
      Boolean(pendingBubble.querySelector('.assistant-message-main')?.textContent?.trim()) ||
      Boolean(pendingBubble.querySelector('.thinking-content')?.textContent?.trim());

    this.options.setPendingAssistantBubble?.(null);
    if (!hasContent) {
      pendingBubble.remove();
    }
  }

  private isSpeechPermissionError(message: string): boolean {
    const normalized = message.toLowerCase();
    return (
      normalized.includes('not-allowed') ||
      normalized.includes('service-not-allowed') ||
      normalized.includes('permission')
    );
  }

  private disableSpeechInput(reason: string, message: string): void {
    if (this.speechInputDisabledReason) {
      return;
    }
    this.speechInputDisabledReason = reason;
    const micButton = this.options.micButtonEl;
    micButton.disabled = true;
    micButton.classList.remove('recording', 'interrupting', 'stopping');
    micButton.setAttribute('title', message);
    micButton.setAttribute('aria-label', message);
    this.logState('speech-disabled', { reason });
  }

  syncMicButtonState(): void {
    const micButton = this.options.micButtonEl;
    const isNativeSpeaking = this.isNativeSpeaking();
    const isNativeListening = this.isNativeListening();
    const shouldShowStop =
      isNativeListening ||
      (!this.isUsingNativeVoiceRuntime() &&
        !this.isSpeechInputActive &&
        !this.isTtsPlaying &&
        this.options.isOutputActive());
    micButton.classList.toggle('stopping', shouldShowStop);
    micButton.classList.toggle('native-speaking', isNativeSpeaking);
    micButton.classList.toggle('native-listening', isNativeListening);
    this.renderMicButtonIcon(
      this.isSpeechInputActive || shouldShowStop
        ? 'stop'
        : isNativeSpeaking || this.isTtsPlaying
          ? 'speaker'
          : 'microphone',
    );

    if (micButton.disabled) {
      return;
    }

    let label = 'Voice input';
    if (isNativeSpeaking) {
      label = 'Voice playback active';
    } else if (isNativeListening) {
      label = 'Stop listening';
    } else if (this.isSpeechInputActive) {
      label = 'Stop recording';
    } else if (this.isTtsPlaying || this.options.isOutputActive()) {
      label = 'Stop output';
    }
    micButton.setAttribute('aria-label', label);
    micButton.setAttribute('title', label);
  }

  private shouldInterruptOutput(): boolean {
    return this.isTtsPlaying || this.options.isOutputActive() || this.isNativeInteractionActive();
  }

  private clearMicPressTimer(): void {
    if (!this.micPressTimer) {
      return;
    }
    clearTimeout(this.micPressTimer);
    this.micPressTimer = null;
  }

  private scheduleAutoRearmAfterTts(): void {
    this.clearAutoRearmTimer();
    if (!this.shouldAutoListenAfterPlayback() || this.currentAudioMode !== 'response') {
      return;
    }
    const player = this.ttsPlayer;
    if (!player) {
      return;
    }

    const remainingMs = player.getRemainingPlaybackMs();
    const delayMs = Math.max(0, remainingMs + SpeechAudioController.AUTO_REARM_GRACE_MS);
    const token = (this.autoRearmToken += 1);

    this.autoRearmTimer = setTimeout(() => {
      if (token !== this.autoRearmToken) {
        return;
      }
      this.autoRearmTimer = null;

      if (!this.shouldAutoListenAfterPlayback() || this.currentAudioMode !== 'response') {
        return;
      }

      const stillRemaining = player.getRemainingPlaybackMs();
      if (this.isTtsPlaying || stillRemaining > 0 || this.options.isOutputActive()) {
        this.scheduleAutoRearmAfterTts();
        return;
      }

      void this.startPushToTalk();
    }, delayMs);
  }

  private clearAutoRearmTimer(): void {
    if (!this.autoRearmTimer) {
      return;
    }
    clearTimeout(this.autoRearmTimer);
    this.autoRearmTimer = null;
  }

  private isUsingNativeVoiceRuntime(): boolean {
    return Boolean(
      this.options.useNativeVoiceRuntime &&
      this.currentAudioMode !== 'off' &&
      this.options.nativeVoiceBridge?.isAvailable(),
    );
  }

  private shouldAutoListenAfterPlayback(): boolean {
    return this.continuousListeningMode || this.currentAutoListenEnabled;
  }

  private isNativeInteractionActive(): boolean {
    return this.isNativeSpeaking() || this.isNativeListening();
  }

  private isNativeSpeaking(): boolean {
    return this.isUsingNativeVoiceRuntime() && this.nativeRuntimeState === 'speaking';
  }

  private isNativeListening(): boolean {
    return this.isUsingNativeVoiceRuntime() && this.nativeRuntimeState === 'listening';
  }

  private renderMicButtonIcon(mode: 'microphone' | 'speaker' | 'stop'): void {
    const svg = this.options.micButtonEl.querySelector<SVGElement>('svg.mic-icon');
    if (!svg || svg.dataset['mode'] === mode) {
      return;
    }
    svg.dataset['mode'] = mode;
    if (mode === 'stop') {
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.innerHTML = '<rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"></rect>';
      return;
    }
    if (mode === 'speaker') {
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.innerHTML =
        '<path d="M11 5 6 9H3v6h3l5 4V5Z"></path><path d="M15.5 8.5a5 5 0 0 1 0 7"></path><path d="M18.5 5.5a9 9 0 0 1 0 13"></path>';
      return;
    }
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.innerHTML =
      '<rect x="9" y="3" width="6" height="12" rx="3"></rect><path d="M12 19a6 6 0 0 0 6-6v-1h-2v1a4 4 0 0 1-8 0v-1H6v1a6 6 0 0 0 6 6z"></path><rect x="11" y="19" width="2" height="3"></rect><path d="M8 22h8a1 1 0 0 1 0 2H8a1 1 0 0 1 0-2z"></path>';
  }
}
