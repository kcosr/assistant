export interface SpeechInputController {
  readonly isActive: boolean;
  readonly isMobile: boolean;
  start(options: {
    onPartial: (text: string) => void;
    onFinal: (text: string) => void;
    onError: (error: unknown) => void;
    onEnd: () => void;
  }): void;
  stop(): void;
}

interface BrowserSpeechRecognitionResult {
  isFinal?: boolean;
  [index: number]:
    | {
        transcript?: string;
      }
    | undefined;
}

interface BrowserSpeechRecognitionEvent {
  resultIndex: number;
  results: ArrayLike<BrowserSpeechRecognitionResult>;
}

interface BrowserSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onaudiostart: (() => void) | null;
  onaudioend: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

export function createSpeechInputController(): SpeechInputController | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const global = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };

  const RecognitionCtor = global.SpeechRecognition ?? global.webkitSpeechRecognition;

  if (!RecognitionCtor) {
    return null;
  }

  let recognition: BrowserSpeechRecognition | null = null;
  let active = false;

  // Detect mobile: touch device or narrow screen
  const isMobile =
    'ontouchstart' in window || navigator.maxTouchPoints > 0 || window.innerWidth < 768;

  return {
    get isActive(): boolean {
      return active;
    },

    get isMobile(): boolean {
      return isMobile;
    },

    start(options): void {
      if (active) {
        return;
      }

      recognition = new RecognitionCtor();
      recognition.lang = 'en-US';
      // Mobile browsers don't reliably support continuous mode
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      active = true;
      let lastTranscript = '';

      recognition.onresult = (event: BrowserSpeechRecognitionEvent) => {
        // Rebuild transcript from all results on each event
        // (don't accumulate - browser sends all results each time)
        let finalTranscript = '';
        let interimTranscript = '';

        for (let i = 0; i < event.results.length; i += 1) {
          const result = event.results[i];
          if (!result) {
            continue;
          }
          const firstAlternative = result[0];
          const text = (firstAlternative && firstAlternative.transcript) ?? '';

          if (result.isFinal) {
            // Add space between segments if needed
            if (
              finalTranscript &&
              !finalTranscript.endsWith(' ') &&
              text &&
              !text.startsWith(' ')
            ) {
              finalTranscript += ' ';
            }
            finalTranscript += text;
          } else {
            // Add space between segments if needed
            if (
              interimTranscript &&
              !interimTranscript.endsWith(' ') &&
              text &&
              !text.startsWith(' ')
            ) {
              interimTranscript += ' ';
            }
            interimTranscript += text;
          }
        }

        // Add space between final and interim if needed
        let combined = finalTranscript;
        if (interimTranscript) {
          if (combined && !combined.endsWith(' ') && !interimTranscript.startsWith(' ')) {
            combined += ' ';
          }
          combined += interimTranscript;
        }
        combined = combined.trim();

        lastTranscript = combined;
        if (combined.length > 0) {
          options.onPartial(combined);
        }
      };

      recognition.onerror = (event: { error?: string }) => {
        active = false;
        options.onError(
          event && event.error
            ? new Error(`Speech recognition error: ${event.error}`)
            : new Error('Speech recognition error'),
        );
        options.onEnd();
      };

      recognition.onend = () => {
        const text = lastTranscript.trim();
        if (text.length > 0) {
          options.onFinal(text);
        }
        active = false;
        options.onEnd();
      };

      try {
        recognition.start();
      } catch (err) {
        active = false;
        options.onError(err);
        options.onEnd();
      }
    },

    stop(): void {
      if (!active || !recognition) {
        return;
      }

      try {
        recognition.stop();
      } catch {
        // Ignore stop errors; onend/onerror handlers will clean up if needed.
      }
    },
  };
}
