import path from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

import type { AgentTool, ToolContext } from './tools/types';
import { ToolError } from './tools/errors';
import { matchesGlobPattern } from './tools/scoping';
import { executeInteraction, interactionUnavailableError } from './interactionExecution';

const APPROVAL_PREVIEW_MAX_CHARS = 320;

function truncatePreview(value: string): string {
  const normalized = value.trim();
  if (normalized.length <= APPROVAL_PREVIEW_MAX_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, APPROVAL_PREVIEW_MAX_CHARS - 1)}…`;
}

function getStringArgument(args: unknown, keys: string[]): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return undefined;
  }
  const record = args as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) {
      return truncatePreview(value);
    }
  }
  return undefined;
}

export function formatToolApprovalPrompt(toolName: string, args: unknown): string {
  const command = getStringArgument(args, ['command', 'cmd']);
  if (command) {
    return `Run command?\n${command}`;
  }

  const path = getStringArgument(args, ['path', 'filePath', 'file', 'directory']);
  const pattern = getStringArgument(args, ['pattern', 'query']);
  if (path && pattern) {
    return `Allow ${toolName} in ${path}?\n${pattern}`;
  }
  if (path) {
    return `Allow ${toolName} for ${path}?`;
  }
  if (pattern) {
    return `Allow ${toolName}?\n${pattern}`;
  }
  return `Allow ${toolName}?`;
}

export function toolRequiresApproval(toolName: string, required: string[] | undefined): boolean {
  return Boolean(required?.some((pattern) => matchesGlobPattern(toolName, pattern)));
}

function writeIsAllowed(
  tool: AgentTool,
  params: unknown,
  directories: string[] | undefined,
): boolean {
  if (
    (tool.name !== 'write' && tool.name !== 'edit') ||
    !directories?.length ||
    !params ||
    typeof params !== 'object'
  ) {
    return false;
  }
  const value = (params as Record<string, unknown>)['path'];
  if (typeof value !== 'string' || !value) {
    return false;
  }
  // Mirrors pi-coding-agent utils/paths.ts normalizePath via resolveToCwd.
  // Real write/edit parity tests in codingToolHost.test.ts guard dependency drift.
  let target = value.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, ' ').replace(/^@/, '');
  if (target === '~' || target.startsWith('~/')) {
    target = path.join(homedir(), target.slice(2));
  }
  if (target.startsWith('file://')) {
    try {
      target = fileURLToPath(target);
    } catch {
      return false;
    }
  }
  if (!path.isAbsolute(target) && !tool.workingDirectory) {
    return false;
  }
  const resolved = path.resolve(tool.workingDirectory ?? '/', target);
  return directories.some((directory) => {
    const relative = path.relative(directory, resolved);
    return (
      relative === '' ||
      (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
    );
  });
}

export function applyToolApprovalPolicy(options: {
  tools: AgentTool[];
  required: string[] | undefined;
  context: ToolContext;
  bashAllowPrefixes?: string[] | undefined;
  writeAllowDirectories?: string[] | undefined;
}): AgentTool[] {
  const { tools, required, context, bashAllowPrefixes, writeAllowDirectories } = options;
  if (!required || required.length === 0) {
    return tools;
  }

  return tools.map((tool) => {
    if (!toolRequiresApproval(tool.name, required)) {
      return tool;
    }

    return {
      ...tool,
      execute: async (toolCallId, params, signal, onUpdate) => {
        if (writeIsAllowed(tool, params, writeAllowDirectories)) {
          return tool.execute(toolCallId, params, signal, onUpdate);
        }
        // This is a workflow exception: a matching prefix permits the entire shell command.
        const command =
          tool.name === 'bash' && params && typeof params === 'object'
            ? (params as Record<string, unknown>)['command']
            : undefined;
        if (
          typeof command === 'string' &&
          bashAllowPrefixes?.some((prefix) => {
            const start = command.trimStart();
            return (
              prefix.length > 0 &&
              start.startsWith(prefix) &&
              (start.length === prefix.length || /[\s;&|<>]/.test(start[prefix.length]!))
            );
          })
        ) {
          return tool.execute(toolCallId, params, signal, onUpdate);
        }

        const sessionHub = context.sessionHub;
        const sessionId = context.sessionId.trim();
        if (!sessionHub || !sessionId) {
          throw new ToolError(
            'interaction_unavailable',
            'Approval required but the tool call is not associated with an interactive session.',
          );
        }

        const request = {
          type: 'approval' as const,
          presentation: 'composer' as const,
          prompt: formatToolApprovalPrompt(tool.name, params),
          approvalScopes: ['once' as const],
          onResponse: (response: { action: 'approve' | 'deny' | 'submit' | 'cancel' }) => ({
            complete: response.action === 'approve',
          }),
        };
        const availability = sessionHub.getInteractionAvailability(sessionId);
        if (!availability.available) {
          throw interactionUnavailableError(request);
        }

        const activeRun = sessionHub.getSessionState(sessionId)?.activeChatRun;
        const approved = await executeInteraction({
          request,
          context: {
            sessionId,
            callId: toolCallId,
            toolName: tool.name,
            sessionHub,
            ...(activeRun?.turnId ? { turnId: activeRun.turnId } : {}),
            ...(activeRun?.requestId ? { requestId: activeRun.requestId } : {}),
            ...(activeRun?.responseId ? { responseId: activeRun.responseId } : {}),
            ...(context.eventStore ? { eventStore: context.eventStore } : {}),
            signal: signal ?? context.signal,
          },
        });
        if (approved !== true) {
          throw new ToolError('tool_denied', `User denied execution of tool "${tool.name}"`);
        }

        return tool.execute(toolCallId, params, signal, onUpdate);
      },
    };
  });
}
