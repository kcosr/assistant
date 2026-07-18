import type { Tool } from '../tools';
import { matchesGlobPattern } from '../tools/scoping';

import type { RealtimeFunctionTool } from './types';

/** Built-in Realtime-only hangup tool (not a plugin op; always available on Realtime sessions). */
export const REALTIME_END_SESSION_TOOL_NAME = 'realtime_end_session';

export function isRealtimeEndSessionTool(name: string): boolean {
  return name === REALTIME_END_SESSION_TOOL_NAME;
}

export function buildRealtimeEndSessionTool(): RealtimeFunctionTool {
  return {
    type: 'function',
    name: REALTIME_END_SESSION_TOOL_NAME,
    description:
      'End the current realtime voice call immediately. Use when the user wants to hang up, stop, or end the conversation. Prefer a brief spoken goodbye first when natural, then call this tool.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Optional short reason (for example user_request or done).',
        },
      },
      additionalProperties: false,
    },
  };
}

/**
 * Explicit opt-in filter for realtime voice tools.
 *
 * Unlike text agents ({@link filterToolsForAgent}), a missing or empty allowlist
 * yields no tools — never the full registry.
 */
export function filterToolsForVoiceRealtime<T extends { name: string }>(
  tools: readonly T[],
  allowlist: string[] | undefined,
  denylist: string[] | undefined,
): T[] {
  if (!allowlist || allowlist.length === 0) {
    return [];
  }

  let filtered = tools.filter((tool) =>
    allowlist.some((pattern) => matchesGlobPattern(tool.name, pattern)),
  );

  if (denylist && denylist.length > 0) {
    filtered = filtered.filter(
      (tool) => !denylist.some((pattern) => matchesGlobPattern(tool.name, pattern)),
    );
  }

  return filtered;
}

export function isToolAllowedForVoiceRealtime(
  name: string,
  allowlist: string[] | undefined,
  denylist: string[] | undefined,
): boolean {
  // Built-in hangup is always available on Realtime sessions.
  if (isRealtimeEndSessionTool(name)) {
    return true;
  }
  if (!allowlist || allowlist.length === 0) {
    return false;
  }
  const allowed = allowlist.some((pattern) => matchesGlobPattern(name, pattern));
  if (!allowed) {
    return false;
  }
  if (denylist && denylist.length > 0) {
    if (denylist.some((pattern) => matchesGlobPattern(name, pattern))) {
      return false;
    }
  }
  return true;
}

function normalizeParameters(parameters: unknown): Record<string, unknown> {
  if (parameters && typeof parameters === 'object' && !Array.isArray(parameters)) {
    return parameters as Record<string, unknown>;
  }
  return {
    type: 'object',
    properties: {},
    additionalProperties: false,
  };
}

/** Map host tool descriptors into OpenAI Realtime function tool shape. */
export function toRealtimeFunctionTools(tools: readonly Tool[]): RealtimeFunctionTool[] {
  return tools.map((tool) => ({
    type: 'function',
    name: tool.name,
    description: tool.description?.trim() || tool.name,
    parameters: normalizeParameters(tool.parameters),
  }));
}

export async function buildRealtimeToolsFromHost(options: {
  listTools: () => Promise<Tool[]>;
  toolAllowlist: string[] | undefined;
  toolDenylist: string[] | undefined;
}): Promise<RealtimeFunctionTool[]> {
  const all = await options.listTools();
  const filtered = filterToolsForVoiceRealtime(all, options.toolAllowlist, options.toolDenylist);
  const hostTools = toRealtimeFunctionTools(filtered);
  // Always expose hangup, independent of plugin allowlist (including empty allowlist).
  return [...hostTools, buildRealtimeEndSessionTool()];
}

export function buildRealtimeInstructions(
  contextBlock: string,
  instructionsOverride?: string,
): string {
  const base =
    typeof instructionsOverride === 'string' && instructionsOverride.trim().length > 0
      ? instructionsOverride.trim()
      : [
          'You are the Assistant realtime voice agent.',
          'Speak concisely. Prefer short confirmations after mutations.',
          'You may only use the provided tools. Never invent tool names.',
          'Prefer title or name lookup fields when the user refers to items by name.',
          'When the user wants to hang up, stop, or end the call, call realtime_end_session. A short goodbye first is fine; the call ends when that tool runs.',
          'Do not claim you can control Thread voice, notifications, or coding agents unless those tools are provided.',
        ].join('\n');

  const context =
    contextBlock.trim().length > 0
      ? `Recent conversation context:\n${contextBlock.trim()}`
      : 'No prior conversation context.';

  return `${base}\n${context}`;
}
