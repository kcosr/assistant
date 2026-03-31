import { isCapacitorAndroid } from './capacitor';

export type AudioMode = 'off' | 'tool' | 'response';

export function getDefaultAudioMode(): AudioMode {
  return isCapacitorAndroid() ? 'tool' : 'off';
}

export function normalizeAudioMode(value: string | null | undefined): AudioMode {
  switch (typeof value === 'string' ? value.trim() : '') {
    case 'tool':
      return 'tool';
    case 'response':
      return 'response';
    case 'off':
      return 'off';
    default:
      return getDefaultAudioMode();
  }
}
