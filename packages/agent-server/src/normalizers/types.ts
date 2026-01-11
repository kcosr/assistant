import type { ChatEvent } from '@assistant/shared';

export interface NormalizerContext {
  sessionId: string;
  turnId: string;
  responseId: string;
  generateEventId: () => string;
  timestamp: () => number;
}

export interface ProviderNormalizer {
  normalize(chunk: unknown, context: NormalizerContext): ChatEvent[];
}
