import type { Tool } from '../tools';
import { matchesGlobPattern } from '../tools/scoping';
import {
  INTERACTION_END_TOOL_NAME,
  INTERACTION_END_TOOL_PARAMETERS,
  isInteractionEndTool,
} from '../interactionEndTool';

import type { RealtimeFunctionTool } from './types';

export function buildRealtimeInteractionEndTool(): RealtimeFunctionTool {
  return {
    type: 'function',
    name: INTERACTION_END_TOOL_NAME,
    description:
      'End the current realtime voice call immediately. You MUST call this tool when the user indicates the call or conversation should end, including phrases such as "stop", "stop now", "you can stop", "stop our interaction", "we are done", or "that is all". A spoken acknowledgment does not end the call. If a brief goodbye is natural, say it before calling this tool.',
    parameters: INTERACTION_END_TOOL_PARAMETERS,
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

/** Apply the voice conversation's Lists profile only to Lists plugin tools. */
export function withListsInstanceIdDefault(
  name: string,
  args: unknown,
  listsInstanceId: string,
): Record<string, unknown> {
  const normalizedArgs =
    args && typeof args === 'object' && !Array.isArray(args)
      ? (args as Record<string, unknown>)
      : {};
  const instanceId = listsInstanceId.trim();
  if (!name.startsWith('lists_') || !instanceId || normalizedArgs['instance_id']) {
    return normalizedArgs;
  }
  return { ...normalizedArgs, instance_id: instanceId };
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
  return filtered.map((tool) =>
    isInteractionEndTool(tool.name)
      ? buildRealtimeInteractionEndTool()
      : toRealtimeFunctionTools([tool])[0]!,
  );
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
          'When the user indicates that the call or conversation should end—including "stop", "stop now", "you can stop", "stop our interaction", "we are done", or "that is all"—you MUST call interaction_end. A spoken acknowledgment does not end the call. If a short goodbye is natural, say it before calling the tool.',
          'Do not claim you can control Thread voice, notifications, or coding agents unless those tools are provided.',
        ].join('\n');

  const context =
    contextBlock.trim().length > 0
      ? `Recent conversation context:\n${contextBlock.trim()}`
      : 'No prior conversation context.';
  return `${base}\n${context}`;
}
