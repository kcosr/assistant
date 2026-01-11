export const AUDIO_FRAME_MAGIC = 0xa1;
export const AUDIO_FLAG_MIC = 1 << 0;
export const AUDIO_FLAG_TTS = 1 << 1;
export const AUDIO_FRAME_HEADER_SIZE = 14;

export type AudioSampleFormat = 1;

export type AudioFrameFlags = number;

export interface AudioFrameHeader {
  magic: typeof AUDIO_FRAME_MAGIC;
  flags: AudioFrameFlags;
  seq: number;
  timestampMs: number;
  sampleRate: number;
  channels: number;
  sampleFormat: AudioSampleFormat;
}

export interface AudioFrame extends AudioFrameHeader {
  data: Uint8Array;
}

export function encodeAudioFrame(frame: AudioFrame): Uint8Array {
  const buffer = new ArrayBuffer(AUDIO_FRAME_HEADER_SIZE + frame.data.byteLength);
  const view = new DataView(buffer);
  let offset = 0;
  view.setUint8(offset, AUDIO_FRAME_MAGIC);
  offset += 1;
  view.setUint8(offset, frame.flags);
  offset += 1;
  view.setUint32(offset, frame.seq, true);
  offset += 4;
  view.setUint32(offset, frame.timestampMs, true);
  offset += 4;
  view.setUint16(offset, frame.sampleRate, true);
  offset += 2;
  view.setUint8(offset, frame.channels);
  offset += 1;
  view.setUint8(offset, frame.sampleFormat);
  const bytes = new Uint8Array(buffer);
  bytes.set(frame.data, AUDIO_FRAME_HEADER_SIZE);
  return bytes;
}

export function decodeAudioFrame(input: ArrayBuffer | Uint8Array): AudioFrame {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < AUDIO_FRAME_HEADER_SIZE) {
    throw new Error('Audio frame too short');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  const magic = view.getUint8(offset);
  offset += 1;
  if (magic !== AUDIO_FRAME_MAGIC) {
    throw new Error('Invalid audio frame magic');
  }
  const flags = view.getUint8(offset);
  offset += 1;
  const seq = view.getUint32(offset, true);
  offset += 4;
  const timestampMs = view.getUint32(offset, true);
  offset += 4;
  const sampleRate = view.getUint16(offset, true);
  offset += 2;
  const channels = view.getUint8(offset);
  offset += 1;
  const rawSampleFormat = view.getUint8(offset);
  const sampleFormat = rawSampleFormat as AudioSampleFormat;
  if (sampleFormat !== 1) {
    throw new Error(`Unsupported audio sample format: ${rawSampleFormat}`);
  }
  if (channels <= 0) {
    throw new Error(`Invalid channel count: ${channels}`);
  }
  if (sampleRate <= 0) {
    throw new Error(`Invalid sample rate: ${sampleRate}`);
  }
  const data = bytes.subarray(AUDIO_FRAME_HEADER_SIZE);
  return {
    magic: AUDIO_FRAME_MAGIC,
    flags,
    seq,
    timestampMs,
    sampleRate,
    channels,
    sampleFormat,
    data,
  };
}
