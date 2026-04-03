import type { ToolContext } from './types';

export async function resolveSessionWorkingDir(ctx: ToolContext): Promise<string | undefined> {
  const stateWorkingDir = ctx.sessionHub?.getSessionState(ctx.sessionId)?.summary.attributes?.core?.workingDir;
  if (typeof stateWorkingDir === 'string' && stateWorkingDir.trim().length > 0) {
    return stateWorkingDir.trim();
  }

  const ensuredSummary = await ctx.sessionHub?.ensureSessionState?.(ctx.sessionId);
  const ensuredWorkingDir = ensuredSummary?.summary.attributes?.core?.workingDir;
  if (typeof ensuredWorkingDir === 'string' && ensuredWorkingDir.trim().length > 0) {
    return ensuredWorkingDir.trim();
  }

  const indexedSummary = await ctx.sessionIndex?.getSession?.(ctx.sessionId);
  const indexedWorkingDir = indexedSummary?.attributes?.core?.workingDir;
  if (typeof indexedWorkingDir === 'string' && indexedWorkingDir.trim().length > 0) {
    return indexedWorkingDir.trim();
  }

  return undefined;
}
