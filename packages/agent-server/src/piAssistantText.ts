import type { Message as PiSdkMessage } from '@mariozechner/pi-ai';

import { extractAssistantTextBlocksFromPiMessage } from './llm/piSdkProvider';

export function resolveVisibleAssistantText(options: {
  fullText: string;
  piSdkMessage?: PiSdkMessage;
}): {
  text: string;
  phase?: 'commentary' | 'final_answer';
  textSignature?: string;
} {
  const { fullText, piSdkMessage } = options;
  const blocks = extractAssistantTextBlocksFromPiMessage(piSdkMessage);
  const preferred =
    blocks.find((block) => block.phase === 'final_answer') ??
    blocks[blocks.length - 1];

  if (!preferred?.text?.trim()) {
    return { text: fullText };
  }

  return {
    text: preferred.text,
    ...(preferred.phase ? { phase: preferred.phase } : {}),
    ...(preferred.textSignature ? { textSignature: preferred.textSignature } : {}),
  };
}
