import type { ClientControlMessage } from '@assistant/shared';
import { TtsAudioPlayer } from '../utils/audio';
import type { SpeechInputController } from './speechInput';

export interface SpeechAudioControllerOptions {
  speechFeaturesEnabled: boolean;
  speechInputController: SpeechInputController | null;
  micButtonEl: HTMLButtonElement;
  audioResponsesCheckboxEl: HTMLInputElement;
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
  audioResponsesStorageKey: string;
  continuousListeningLongPressMs: number;
  initialAudioResponsesEnabled: boolean;
}

export class SpeechAudioController {
  private isSpeechInputActive = false;
  private speechInputDisabledReason: string | null = null;
  private speechStartToken = 0;
  private audioResponsesEnabled: boolean;
  private continuousListeningMode = false;
  private micPressStartTime: number | null = null;
  private speechInputBaseText: string | null = null;
  private speechInputCancelled = false;
  private ttsPlayer: TtsAudioPlayer | null = null;
  private isTtsPlaying = false;
  private mediaSessionAttached = false;
  private chimeContext: AudioContext | null = null;

  constructor(private readonly options: SpeechAudioControllerOptions) {
    this.audioResponsesEnabled = options.initialAudioResponsesEnabled;
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
    if (this.mediaSessionAttached || !this.hasSpeechInput) {
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.mediaSession) {
      return;
    }

    const mediaSession = navigator.mediaSession;
    const handleToggle = (action: string) => {
      this.logState('media-session-action', { action });
      if (this.isSpeechInputActive) {
        this.logState('media-session-step', { step: 'cancel-recording' });
        this.cancelSpeechInput('media-session');
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

  get isAudioResponsesEnabled(): boolean {
    return this.audioResponsesEnabled;
  }

  setContinuousListeningMode(enabled: boolean): void {
    this.continuousListeningMode = enabled;
    this.logState('continuous-listening', { enabled });
  }

  attach(): void {
    const { micButtonEl, audioResponsesCheckboxEl } = this.options;

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
      this.logState('mic-pointerdown', { pointerType: event.pointerType, button: event.button });
      this.micPressStartTime = performance.now();
    });

    micButtonEl.addEventListener('pointerup', (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) {
        return;
      }
      const startTime = this.micPressStartTime;
      this.micPressStartTime = null;
      const now = performance.now();
      const isLongPress =
        typeof startTime === 'number' &&
        now - startTime >= this.options.continuousListeningLongPressMs;

      this.logState('mic-pointerup', { isLongPress, pointerType: event.pointerType });

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
      this.logState('mic-pointercancel');
    });

    micButtonEl.addEventListener('pointerleave', () => {
      this.micPressStartTime = null;
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

    audioResponsesCheckboxEl.addEventListener('change', () => {
      if (audioResponsesCheckboxEl.checked) {
        this.enableAudioResponses();
      } else {
        this.disableAudioResponses();
      }
    });

    if (this.options.supportsAudioOutput() && this.audioResponsesEnabled) {
      this.enableAudioResponses();
    }

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
    this.options.micButtonEl.classList.remove('recording');
    if (this.ttsPlayer) {
      this.ttsPlayer.stop();
    }
    this.isTtsPlaying = false;
    this.updateMediaSessionPlaybackState();
    this.logState('connection-lost-cleanup');
    this.syncMicButtonState();
    this.options.setTtsStatus('');
  }

  handleIncomingAudioFrame(raw: ArrayBuffer): void {
    if (!this.ttsPlayer || !this.audioResponsesEnabled) {
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
    if (!wasPlaying) {
      this.logState('tts-start');
    }
    this.updateMediaSessionPlaybackState();
    this.syncMicButtonState();
  }

  resetForSessionSwitch(): void {
    if (this.ttsPlayer) {
      this.ttsPlayer.stop();
      if (this.audioResponsesEnabled) {
        this.ttsPlayer.setEnabled(true);
      }
    }
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
    if (this.audioResponsesEnabled) {
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
    if (!this.audioResponsesEnabled) {
      return;
    }
    const socket = this.options.getSocket();
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }
    if (!this.continuousListeningMode) {
      return;
    }

    console.log('[client] Auto-arming speech input after TTS idle');
    void this.startPushToTalk();
  }

  enableAudioResponses(): void {
    if (!this.options.supportsAudioOutput()) {
      return;
    }

    if (!this.ttsPlayer) {
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

    this.ttsPlayer.setMuted(false);
    this.ttsPlayer.setEnabled(true);
    this.audioResponsesEnabled = true;
    this.options.audioResponsesCheckboxEl.checked = true;
    this.updateMediaSessionPlaybackState();
    try {
      localStorage.setItem(this.options.audioResponsesStorageKey, 'true');
    } catch {
      // Ignore localStorage errors
    }
    this.options.sendModesUpdate();
  }

  disableAudioResponses(): void {
    if (this.ttsPlayer) {
      this.ttsPlayer.stop();
    }
    this.isTtsPlaying = false;
    this.audioResponsesEnabled = false;
    this.options.audioResponsesCheckboxEl.checked = false;
    this.options.setTtsStatus('');
    this.updateMediaSessionPlaybackState();
    this.syncMicButtonState();
    try {
      localStorage.setItem(this.options.audioResponsesStorageKey, 'false');
    } catch {
      // Ignore localStorage errors
    }
    this.options.sendModesUpdate();
  }

  async startPushToTalk(): Promise<void> {
    console.log('[client] startPushToTalk invoked', {
      socketState: this.options.getSocket()?.readyState,
    });
    this.logState('start-request');
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

    if (this.isTtsPlaying && this.ttsPlayer) {
      this.logState('cancel-step', { step: 'tts' });
      audioEndMs = this.ttsPlayer.stopForBargeIn();
      this.options.micButtonEl.classList.remove('interrupting');
      this.options.setTtsStatus('');
      this.isTtsPlaying = false;
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
    const shouldShowStop =
      !this.isSpeechInputActive && !this.isTtsPlaying && this.options.isOutputActive();
    micButton.classList.toggle('stopping', shouldShowStop);

    if (micButton.disabled) {
      return;
    }

    let label = 'Voice input';
    if (this.isSpeechInputActive) {
      label = 'Stop recording';
    } else if (this.isTtsPlaying || this.options.isOutputActive()) {
      label = 'Stop output';
    }
    micButton.setAttribute('aria-label', label);
    micButton.setAttribute('title', label);
  }

  private shouldInterruptOutput(): boolean {
    return this.isTtsPlaying || this.options.isOutputActive();
  }
}
