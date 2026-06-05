// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { createSpeechInputController } from './speechInput';

type MockSpeechRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onaudiostart: (() => void) | null;
  onaudioend: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onresult: ((event: unknown) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

const originalSpeechRecognition = (window as { SpeechRecognition?: unknown }).SpeechRecognition;
const originalWebkitSpeechRecognition = (window as { webkitSpeechRecognition?: unknown })
  .webkitSpeechRecognition;

afterEach(() => {
  delete (window as { assistantDesktop?: unknown }).assistantDesktop;
  if (originalSpeechRecognition === undefined) {
    delete (window as { SpeechRecognition?: unknown }).SpeechRecognition;
  } else {
    (window as { SpeechRecognition?: unknown }).SpeechRecognition = originalSpeechRecognition;
  }
  if (originalWebkitSpeechRecognition === undefined) {
    delete (window as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
  } else {
    (window as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition =
      originalWebkitSpeechRecognition;
  }
});

function installMockSpeechRecognition(): Mock {
  const constructor = vi.fn((): MockSpeechRecognition => ({
    lang: '',
    continuous: false,
    interimResults: false,
    maxAlternatives: 0,
    onaudiostart: null,
    onaudioend: null,
    onend: null,
    onerror: null,
    onresult: null,
    start: vi.fn(),
    stop: vi.fn(),
    abort: vi.fn(),
  }));
  (window as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition = constructor;
  return constructor;
}

describe('createSpeechInputController', () => {
  it('uses browser speech recognition outside Electron', () => {
    const constructor = installMockSpeechRecognition();

    const controller = createSpeechInputController();
    controller?.start({
      onPartial: vi.fn(),
      onFinal: vi.fn(),
      onError: vi.fn(),
      onEnd: vi.fn(),
    });

    expect(controller).not.toBeNull();
    expect(constructor).toHaveBeenCalledTimes(1);
  });

  it('does not use browser speech recognition in Electron desktop', () => {
    const constructor = installMockSpeechRecognition();
    (window as { assistantDesktop?: unknown }).assistantDesktop = {};

    expect(createSpeechInputController()).toBeNull();
    expect(constructor).not.toHaveBeenCalled();
  });
});
