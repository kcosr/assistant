import type { Tool } from './types';

const ALWAYS_ALLOWED_TOOL_NAMES = new Set<string>([
  'panels_list',
  'panels_selected',
  'panels_event',
]);

export function isSystemOrAlwaysAllowedTool(name: string): boolean {
  return name.startsWith('system_') || ALWAYS_ALLOWED_TOOL_NAMES.has(name);
}

export function matchesGlobPattern(toolName: string, pattern: string): boolean {
  if (pattern === '*') {
    return true;
  }

  if (!pattern.includes('*')) {
    return toolName === pattern;
  }

  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  const regex = new RegExp(`^${escaped}$`);
  return regex.test(toolName);
}

export function filterToolsForAgent(
  tools: Tool[],
  allowlist: string[] | undefined,
  denylist: string[] | undefined,
  capabilityAllowlist?: string[] | undefined,
  capabilityDenylist?: string[] | undefined,
): Tool[] {
  let filtered: Tool[];

  if (!allowlist) {
    filtered = tools;
  } else if (allowlist.length === 0) {
    filtered = tools.filter((tool) => isSystemOrAlwaysAllowedTool(tool.name));
  } else {
    filtered = tools.filter((tool) => {
      if (isSystemOrAlwaysAllowedTool(tool.name)) {
        return true;
      }

      return allowlist.some((pattern) => matchesGlobPattern(tool.name, pattern));
    });
  }

  if (!denylist || denylist.length === 0) {
    if (!capabilityAllowlist && !capabilityDenylist) {
      return filtered;
    }
    return filtered.filter((tool) =>
      isToolAllowedByCapabilities(tool, capabilityAllowlist, capabilityDenylist),
    );
  }

  const afterDenylist = filtered.filter(
    (tool) => !denylist.some((pattern) => matchesGlobPattern(tool.name, pattern)),
  );
  if (!capabilityAllowlist && !capabilityDenylist) {
    return afterDenylist;
  }
  return afterDenylist.filter((tool) =>
    isToolAllowedByCapabilities(tool, capabilityAllowlist, capabilityDenylist),
  );
}

export function filterToolsByAllowlist(tools: Tool[], allowlist: string[] | undefined): Tool[] {
  return filterToolsForAgent(tools, allowlist, undefined, undefined, undefined);
}

function isToolAllowedByCapabilities(
  tool: Tool,
  allowlist: string[] | undefined,
  denylist: string[] | undefined,
): boolean {
  const capabilities = tool.capabilities;
  if (!capabilities || capabilities.length === 0) {
    return true;
  }

  let allowed = true;
  if (allowlist) {
    if (allowlist.length === 0) {
      allowed = false;
    } else {
      allowed = capabilities.every((capability) =>
        allowlist.some((pattern) => matchesGlobPattern(capability, pattern)),
      );
    }
  }

  if (!allowed) {
    return false;
  }

  if (!denylist || denylist.length === 0) {
    return true;
  }

  return !capabilities.some((capability) =>
    denylist.some((pattern) => matchesGlobPattern(capability, pattern)),
  );
}
