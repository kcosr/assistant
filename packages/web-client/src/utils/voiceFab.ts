interface VoiceFabSpeechController {
  getVoiceFabState: () => {
    enabled: boolean;
    mode: 'idle' | 'speaking' | 'listening';
  };
  startVoiceFromFab: () => Promise<boolean>;
  stopVoiceFromFab: () => boolean;
}

export interface VoiceFabOptions {
  button: HTMLButtonElement | null;
  isVisible: () => boolean;
  getSpeechController: () => VoiceFabSpeechController | null;
  getSessionChipState: (mode: 'idle' | 'speaking' | 'listening') => {
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
const SPEAKER_ICON =
  '<svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M11 5 6 9H3v6h3l5 4V5Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"></path><path d="M15.5 8.5a5 5 0 0 1 0 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path><path d="M18.5 5.5a9 9 0 0 1 0 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path></svg>';
const STOP_ICON =
  '<svg class="icon icon-sm" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"></rect></svg>';

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
  let startInFlight = false;

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

  const hideSessionChip = (): void => {
    chip.classList.remove('is-visible');
    chip.classList.remove('is-interactive');
    chip.disabled = false;
    chip.hidden = true;
  };

  const renderSessionChip = (mode: 'idle' | 'speaking' | 'listening'): void => {
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
      return;
    }

    const controller = options.getSpeechController();
    const state = controller?.getVoiceFabState() ?? { enabled: false, mode: 'idle' as const };
    renderSessionChip(state.mode);
    button.classList.add('voice-fab');
    button.classList.toggle('voice-fab-speaking', state.mode === 'speaking');
    button.classList.toggle('voice-fab-listening', state.mode === 'listening');
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
    if (state.mode === 'speaking' || state.mode === 'listening') {
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

  const handleResize = (): void => {
    update();
  };

  const handleButtonPointer = (): void => {
    void handleButtonClick();
  };

  const handleChipClick = (event: MouseEvent): void => {
    if (chip.disabled || chip.hidden) {
      return;
    }
    event.preventDefault();
    options.onSessionChipClick(chip);
  };

  document.body.appendChild(chip);
  button.addEventListener('click', handleButtonPointer);
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
      chip.removeEventListener('click', handleChipClick);
      chip.remove();
    },
  };
}
