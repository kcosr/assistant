import {
  AUDIO_FLAG_MIC,
  AUDIO_FRAME_MAGIC,
  AUDIO_FRAME_HEADER_SIZE,
  decodeAudioFrame,
  type AudioFrame,
} from '@assistant/shared';

export interface MicAudioValidationConfig {
  /**
   * Expected sample rate for incoming mic frames (for example, 24000 Hz).
   */
  expectedSampleRate: number;
  /**
   * Expected number of audio channels (for example, mono = 1).
   */
  expectedChannels: number;
}

export interface ValidatedMicAudioFrame {
  frame: AudioFrame;
  /**
   * Raw PCM16 bytes for the frame data.
   */
  pcmBytes: Uint8Array;
}

export function validateAndDecodeMicAudioFrame(
  input: ArrayBuffer | Uint8Array,
  config: MicAudioValidationConfig,
): ValidatedMicAudioFrame {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);

  if (bytes.byteLength < AUDIO_FRAME_HEADER_SIZE) {
    throw new Error('Audio frame too short');
  }

  if (bytes[0] !== AUDIO_FRAME_MAGIC) {
    throw new Error('Invalid audio frame magic');
  }

  const decoded = decodeAudioFrame(bytes);

  if ((decoded.flags & AUDIO_FLAG_MIC) === 0) {
    throw new Error('Audio frame is missing MIC flag');
  }

  if (decoded.sampleRate !== config.expectedSampleRate) {
    throw new Error(
      `Unsupported audio sample rate: ${decoded.sampleRate} (expected ${config.expectedSampleRate})`,
    );
  }

  if (decoded.channels !== config.expectedChannels) {
    throw new Error(
      `Unsupported audio channel count: ${decoded.channels} (expected ${config.expectedChannels})`,
    );
  }

  return {
    frame: decoded,
    pcmBytes: decoded.data,
  };
}
