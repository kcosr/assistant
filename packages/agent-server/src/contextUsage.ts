import type { AssistantMessage, Usage } from '@mariozechner/pi-ai';
import type { SessionContextUsage, TokenUsageBreakdown } from '@assistant/shared';

export function calculateContextTokens(usage: Pick<Usage, 'totalTokens' | 'input' | 'output' | 'cacheRead' | 'cacheWrite'>): number {
  return (
    usage.totalTokens ||
    usage.input + usage.output + usage.cacheRead + usage.cacheWrite
  );
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function buildTokenUsageBreakdown(
  usage: Pick<Usage, 'input' | 'output' | 'cacheRead' | 'cacheWrite' | 'totalTokens'>,
): TokenUsageBreakdown {
  return {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    totalTokens: usage.totalTokens,
  };
}

export function buildSessionContextUsage(options: {
  contextWindow: number;
  usage: Pick<Usage, 'input' | 'output' | 'cacheRead' | 'cacheWrite' | 'totalTokens'>;
}): SessionContextUsage | null {
  const { contextWindow, usage } = options;
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) {
    return null;
  }
  const totalTokens = calculateContextTokens(usage);
  const availablePercent = clampPercent(((contextWindow - totalTokens) / contextWindow) * 100);
  return {
    availablePercent,
    contextWindow,
    usage: buildTokenUsageBreakdown({
      ...usage,
      totalTokens,
    }),
  };
}

export function extractSessionContextUsageFromAssistantMessage(options: {
  contextWindow: number;
  message: AssistantMessage | undefined;
}): SessionContextUsage | null {
  const { contextWindow, message } = options;
  if (!message?.usage) {
    return null;
  }
  if (message.stopReason === 'aborted' || message.stopReason === 'error') {
    return null;
  }
  return buildSessionContextUsage({
    contextWindow,
    usage: message.usage,
  });
}
