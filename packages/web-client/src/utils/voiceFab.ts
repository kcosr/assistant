export type VoiceFabMode = 'idle' | 'speaking' | 'listening' | 'realtime';

interface VoiceFabSpeechController {
  getVoiceFabState: () => {
    enabled: boolean;
    mode: VoiceFabMode;
  };
  startVoiceFromFab: () => Promise<boolean>;
  stopVoiceFromFab: () => boolean;
  /** Current Realtime uplink mute (mic). Only meaningful while mode is realtime. */
  getRealtimeMuted?: () => boolean;
  /** Seed muted UI when entering a Realtime call (e.g. mute-on-start). */
  getRealtimeMuteOnStart?: () => boolean;
  setRealtimeMuted?: (muted: boolean) => boolean | Promise<boolean>;
}

export interface VoiceFabOptions {
  button: HTMLButtonElement | null;
  isVisible: () => boolean;
  getSpeechController: () => VoiceFabSpeechController | null;
  getSessionChipState: (mode: VoiceFabMode) => {
    visible: boolean;
    interactive: boolean;
    title: string | null;
  };
  onSessionChipClick: (anchor: HTMLElement) => void;
}

export interface VoiceFabHandle {
  update: () => void;
  showSessionChip: () => void;
  hideSessionChip: () => void;
  destroy: () => void;
}

const MICROPHONE_ICON =
  '<svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="9" y="3" width="6" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="2"></rect><path d="M12 19a6 6 0 0 0 6-6v-1h-2v1a4 4 0 0 1-8 0v-1H6v1a6 6 0 0 0 6 6z" fill="none" stroke="currentColor" stroke-width="2"></path><path d="M12 19v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path><path d="M8 22h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>';
const MICROPHONE_OFF_ICON =
  '<svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="9" y="3" width="6" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="2"></rect><path d="M12 19a6 6 0 0 0 6-6v-1h-2v1a4 4 0 0 1-8 0v-1H6v1a6 6 0 0 0 6 6z" fill="none" stroke="currentColor" stroke-width="2"></path><path d="M12 19v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path><path d="M8 22h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path><path d="M4 4l16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>';
const SPEAKER_ICON =
  '<svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M11 5 6 9H3v6h3l5 4V5Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"></path><path d="M15.5 8.5a5 5 0 0 1 0 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path><path d="M18.5 5.5a9 9 0 0 1 0 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>';
const STOP_ICON =
  '<svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"></rect></svg>';

/** Same stack step as voice FAB vs lists plus FAB (52px button + 12px gap). */
const MUTE_FAB_STACK_STEP_PX = 64;

export function setupVoiceFab(options: VoiceFabOptions): VoiceFabHandle {
  const button = options.button;
  if (!button) {
    return {
      update: () => undefined,
      showSessionChip: () => undefined,
      hideSessionChip: () => undefined,
      destroy: () => undefined,
    };
  }

  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'voice-fab-session-chip';
  chip.hidden = true;

  const muteButton = document.createElement('button');
  muteButton.type = 'button';
  muteButton.className = 'voice-fab-mute';
  muteButton.hidden = true;

  let startInFlight = false;
  let muteToggleInFlight = false;
  /** Local mute UI for the current Realtime call; reset when the call ends. */
  let realtimeMuted = false;
  let wasRealtimeMode = false;
  /**
   * After hangup, native mode can lag briefly as still `realtime`. Keep the mute FAB
   * hidden until mode is no longer realtime so it never sticks past call end.
   */
  let suppressMuteUntilRealtimeEnds = false;

  const positionChip = (): void => {
    const rect = button.getBoundingClientRect();
    const chipRect = chip.getBoundingClientRect();
    const padding = 8;
    const right = window.innerWidth - rect.left + 12;
    let top = rect.top + rect.height / 2 - chipRect.height / 2;
    if (top < padding) {
      top = padding;
    }
    if (top + chipRect.height > window.innerHeight - padding) {
      top = window.innerHeight - chipRect.height - padding;
    }
    chip.style.right = `${right}px`;
    chip.style.top = `${top}px`;
  };

  const positionMuteButton = (): void => {
    const rect = button.getBoundingClientRect();
    const right = Math.max(0, window.innerWidth - rect.right);
    const bottom = Math.max(0, window.innerHeight - rect.top + (MUTE_FAB_STACK_STEP_PX - rect.height));
    muteButton.style.right = `${right}px`;
    muteButton.style.bottom = `${bottom}px`;
  };

  const hideSessionChip = (): void => {
    chip.classList.remove('is-visible');
    chip.classList.remove('is-interactive');
    chip.disabled = false;
    chip.hidden = true;
  };

  const hideMuteButton = (): void => {
    muteButton.classList.remove('is-visible');
    muteButton.classList.remove('is-muted');
    muteButton.hidden = true;
    muteButton.setAttribute('aria-pressed', 'false');
  };

  const clearRealtimeMuteUi = (): void => {
    realtimeMuted = false;
    wasRealtimeMode = false;
    hideMuteButton();
  };

  const renderMuteButton = (mode: VoiceFabMode, visible: boolean): void => {
    // Mute control is Realtime-call-only. Hide as soon as we leave realtime (or suppress
    // after hangup while native state still reports realtime for a beat).
    if (!visible || mode !== 'realtime' || suppressMuteUntilRealtimeEnds) {
      if (mode !== 'realtime') {
        suppressMuteUntilRealtimeEnds = false;
      }
      clearRealtimeMuteUi();
      return;
    }
    const controller = options.getSpeechController();
    // Prefer live native mute (tracks notification toggles). Seed from mute-on-start only
    // the first time we enter a Realtime call when native has not reported yet.
    if (typeof controller?.getRealtimeMuted === 'function') {
      realtimeMuted = Boolean(controller.getRealtimeMuted());
    } else if (!wasRealtimeMode) {
      realtimeMuted = Boolean(controller?.getRealtimeMuteOnStart?.());
    }
    wasRealtimeMode = true;
    muteButton.hidden = false;
    muteButton.classList.add('is-visible');
    muteButton.classList.toggle('is-muted', realtimeMuted);
    muteButton.innerHTML = realtimeMuted ? MICROPHONE_OFF_ICON : MICROPHONE_ICON;
    muteButton.setAttribute('aria-pressed', realtimeMuted ? 'true' : 'false');
    muteButton.setAttribute(
      'aria-label',
      realtimeMuted ? 'Unmute realtime microphone' : 'Mute realtime microphone',
    );
    muteButton.setAttribute('title', realtimeMuted ? 'Unmute microphone' : 'Mute microphone');
    positionMuteButton();
  };

  const renderSessionChip = (mode: VoiceFabMode): void => {
    // Realtime is a separate conversation — hide Thread session chip while active.
    if (mode === 'realtime') {
      hideSessionChip();
      return;
    }
    const chipState = options.getSessionChipState(mode);
    const title = chipState.title?.trim() ?? '';
    if (!chipState.visible || !title) {
      hideSessionChip();
      return;
    }
    chip.textContent = title;
    chip.disabled = !chipState.interactive;
    chip.hidden = false;
    void chip.offsetHeight;
    chip.classList.add('is-visible');
    chip.classList.toggle('is-interactive', chipState.interactive);
    positionChip();
  };

  const showSessionChip = (): void => {
    const controller = options.getSpeechController();
    const mode = controller?.getVoiceFabState().mode ?? 'idle';
    renderSessionChip(mode);
  };

  const update = (): void => {
    const visible = options.isVisible();
    button.classList.toggle('is-visible', visible);
    if (!visible) {
      hideSessionChip();
      clearRealtimeMuteUi();
      return;
    }

    const controller = options.getSpeechController();
    const state = controller?.getVoiceFabState() ?? { enabled: false, mode: 'idle' as const };
    if (state.mode !== 'realtime') {
      suppressMuteUntilRealtimeEnds = false;
    }
    renderSessionChip(state.mode);
    renderMuteButton(state.mode, visible);
    button.classList.add('voice-fab');
    button.classList.toggle('voice-fab-speaking', state.mode === 'speaking');
    // Reuse the red stop treatment for Thread listen and active Realtime.
    button.classList.toggle(
      'voice-fab-listening',
      state.mode === 'listening' || state.mode === 'realtime',
    );
    button.classList.toggle('voice-fab-disabled', !state.enabled);
    button.disabled = !state.enabled && state.mode === 'idle';

    if (state.mode === 'speaking') {
      button.innerHTML = SPEAKER_ICON;
      button.setAttribute('aria-label', 'Stop voice playback');
      button.setAttribute('title', 'Stop voice playback');
    } else if (state.mode === 'listening') {
      button.innerHTML = STOP_ICON;
      button.setAttribute('aria-label', 'Stop voice listening');
      button.setAttribute('title', 'Stop voice listening');
    } else if (state.mode === 'realtime') {
      button.innerHTML = STOP_ICON;
      button.setAttribute('aria-label', 'Stop realtime call');
      button.setAttribute('title', 'Stop realtime call');
    } else {
      button.innerHTML = MICROPHONE_ICON;
      button.setAttribute('aria-label', state.enabled ? 'Start voice input' : 'No selected session');
      button.setAttribute('title', state.enabled ? 'Start voice input' : 'No selected session');
    }
  };

  const handleButtonClick = async (): Promise<void> => {
    const controller = options.getSpeechController();
    if (!controller) {
      return;
    }
    const state = controller.getVoiceFabState();
    if (state.mode === 'speaking' || state.mode === 'listening' || state.mode === 'realtime') {
      if (state.mode === 'realtime') {
        // Immediate hide: do not wait for native idle/connecting reset to drop mode.
        suppressMuteUntilRealtimeEnds = true;
        clearRealtimeMuteUi();
      }
      controller.stopVoiceFromFab();
      update();
      return;
    }
    if (!state.enabled) {
      update();
      return;
    }
    if (startInFlight) {
      return;
    }
    startInFlight = true;
    const started = await controller.startVoiceFromFab();
    try {
      if (started) {
        showSessionChip();
      }
      update();
    } finally {
      startInFlight = false;
    }
  };

  const handleMuteClick = async (): Promise<void> => {
    const controller = options.getSpeechController();
    if (!controller || muteToggleInFlight) {
      return;
    }
    const state = controller.getVoiceFabState();
    if (state.mode !== 'realtime' || typeof controller.setRealtimeMuted !== 'function') {
      return;
    }
    muteToggleInFlight = true;
    const nextMuted = !realtimeMuted;
    try {
      await Promise.resolve(controller.setRealtimeMuted(nextMuted));
      realtimeMuted = nextMuted;
      update();
    } finally {
      muteToggleInFlight = false;
    }
  };

  const handleResize = (): void => {
    update();
  };

  const handleButtonPointer = (): void => {
    void handleButtonClick();
  };

  const handleMutePointer = (): void => {
    void handleMuteClick();
  };

  const handleChipClick = (event: MouseEvent): void => {
    if (chip.disabled || chip.hidden) {
      return;
    }
    event.preventDefault();
    options.onSessionChipClick(chip);
  };

  document.body.appendChild(chip);
  document.body.appendChild(muteButton);
  button.addEventListener('click', handleButtonPointer);
  muteButton.addEventListener('click', handleMutePointer);
  chip.addEventListener('click', handleChipClick);
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', handleResize);
  }
  update();

  return {
    update,
    showSessionChip,
    hideSessionChip,
    destroy: () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', handleResize);
      }
      button.removeEventListener('click', handleButtonPointer);
      muteButton.removeEventListener('click', handleMutePointer);
      chip.removeEventListener('click', handleChipClick);
      chip.remove();
      muteButton.remove();
    },
  };
}
