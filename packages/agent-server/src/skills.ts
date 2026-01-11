import fs from 'node:fs';
import path from 'node:path';

import type { CombinedPluginManifest } from '@assistant/shared';

import type { AgentDefinition } from './agents';
import type { Tool } from './tools';
import { matchesGlobPattern } from './tools/scoping';
import { normalizeToolPrefix } from './plugins/operations';

export type ToolExposureMode = 'tools' | 'skills' | 'mixed';

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  skillsPath: string;
  cliPath: string;
  toolNames: string[];
}

type SkillBundlePaths = {
  skillsPath: string;
  cliPath: string;
};

function normalizeToolSegment(value: string): string {
  return value.replace(/-/g, '_');
}

function getSkillDirName(pluginId: string): string {
  return pluginId;
}

function getSkillCliName(pluginId: string): string {
  return `${pluginId}-cli`;
}

function toTitleCase(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function describeManifest(manifest: CombinedPluginManifest): { name: string; description: string } {
  const description =
    typeof manifest.description === 'string' && manifest.description.trim().length > 0
      ? manifest.description.trim()
      : manifest.panels?.[0]?.description?.trim() || `Tools for ${manifest.id}`;
  const name = manifest.panels?.[0]?.title?.trim() || toTitleCase(manifest.id);
  return { name, description };
}

function resolveSkillBundle(pluginId: string, roots: string[]): SkillBundlePaths | null {
  for (const root of roots) {
    const pluginRoot = path.join(root, getSkillDirName(pluginId));
    const skillsPath = path.join(pluginRoot, 'SKILL.md');
    if (!fs.existsSync(skillsPath)) {
      continue;
    }
    const cliPath = path.join(pluginRoot, getSkillCliName(pluginId));
    if (!fs.existsSync(cliPath)) {
      continue;
    }
    return { skillsPath, cliPath };
  }
  return null;
}

function collectPluginToolNames(
  manifests: CombinedPluginManifest[],
): Map<string, { toolNames: string[]; name: string; description: string }> {
  const result = new Map<string, { toolNames: string[]; name: string; description: string }>();
  for (const manifest of manifests) {
    if (!manifest || typeof manifest.id !== 'string' || !manifest.id.trim()) {
      continue;
    }
    const operations = Array.isArray(manifest.operations) ? manifest.operations : [];
    const surfaces = manifest.surfaces ?? {};
    if (surfaces.tool === false || operations.length === 0) {
      continue;
    }
    const toolPrefix = normalizeToolPrefix(manifest.id);
    const toolNames = operations.map(
      (operation) => `${toolPrefix}_${normalizeToolSegment(operation.id)}`,
    );
    if (toolNames.length === 0) {
      continue;
    }
    const { name, description } = describeManifest(manifest);
    result.set(manifest.id, { toolNames, name, description });
  }
  return result;
}

function isSkillAllowed(
  pluginId: string,
  allowlist: string[] | undefined,
  denylist: string[] | undefined,
): boolean {
  let allowed = true;
  if (allowlist) {
    if (allowlist.length === 0) {
      allowed = false;
    } else {
      allowed = allowlist.some((pattern) => matchesGlobPattern(pluginId, pattern));
    }
  }

  if (!allowed) {
    return false;
  }

  if (!denylist || denylist.length === 0) {
    return true;
  }

  return !denylist.some((pattern) => matchesGlobPattern(pluginId, pattern));
}

export function resolveSkillsRoots(customRoots?: string[]): string[] {
  const repoDistRoot = path.resolve(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    '..',
    '..',
    'dist',
    'skills',
  );
  const packageDistRoot = path.resolve(__dirname, '..', '..', '..', '..', 'dist', 'skills');
  const cwdDistRoot = path.resolve(process.cwd(), 'dist', 'skills');

  const roots: string[] = [];
  const addIfExists = (root: string) => {
    if (roots.includes(root)) {
      return;
    }
    if (fs.existsSync(root)) {
      roots.push(root);
    }
  };

  if (customRoots && customRoots.length > 0) {
    for (const root of customRoots) {
      const resolved = path.resolve(process.cwd(), root);
      addIfExists(resolved);
    }
  }

  if (fs.existsSync(repoDistRoot)) {
    addIfExists(repoDistRoot);
    addIfExists(cwdDistRoot);
    return roots.length > 0 ? roots : [repoDistRoot, cwdDistRoot];
  }

  addIfExists(cwdDistRoot);
  addIfExists(packageDistRoot);

  if (roots.length > 0) {
    return roots;
  }

  return [repoDistRoot, cwdDistRoot, packageDistRoot];
}

export function buildSkillSummaries(options: {
  manifests: CombinedPluginManifest[];
  allowlist?: string[];
  denylist?: string[];
  skillsRoots?: string[];
}): SkillSummary[] {
  const { manifests, allowlist, denylist, skillsRoots } = options;
  const roots = resolveSkillsRoots(skillsRoots);
  const toolNamesByPlugin = collectPluginToolNames(manifests);
  const skills: SkillSummary[] = [];

  for (const manifest of manifests) {
    const pluginId = manifest.id;
    if (!toolNamesByPlugin.has(pluginId)) {
      continue;
    }
    if (!isSkillAllowed(pluginId, allowlist, denylist)) {
      continue;
    }
    const bundle = resolveSkillBundle(pluginId, roots);
    if (!bundle) {
      continue;
    }
    const entry = toolNamesByPlugin.get(pluginId);
    if (!entry) {
      continue;
    }
    skills.push({
      id: pluginId,
      name: entry.name,
      description: entry.description,
      skillsPath: bundle.skillsPath,
      cliPath: bundle.cliPath,
      toolNames: entry.toolNames,
    });
  }

  return skills.sort((a, b) => a.id.localeCompare(b.id));
}

export function resolveToolExposure(options: {
  tools: Tool[];
  agent?: AgentDefinition;
  manifests?: CombinedPluginManifest[];
  skillsRoots?: string[];
}): {
  visibleTools: Tool[];
  skills: SkillSummary[];
  skillToolNames: Set<string>;
  pluginToolNames: Set<string>;
} {
  const { tools, agent, manifests, skillsRoots } = options;
  const exposure: ToolExposureMode = agent?.toolExposure ?? 'tools';
  const manifestList = manifests ?? [];

  if (manifestList.length === 0 || exposure === 'tools') {
    return {
      visibleTools: tools,
      skills: [],
      skillToolNames: new Set<string>(),
      pluginToolNames: new Set<string>(),
    };
  }

  const toolNamesByPlugin = collectPluginToolNames(manifestList);
  const pluginToolNames = new Set<string>();
  for (const entry of toolNamesByPlugin.values()) {
    for (const toolName of entry.toolNames) {
      pluginToolNames.add(toolName);
    }
  }

  let skills: SkillSummary[] = [];
  let skillToolNames = new Set<string>();

  if (exposure === 'skills' || exposure === 'mixed') {
    const allowlist = agent?.skillAllowlist;
    const denylist = agent?.skillDenylist;
    skills = buildSkillSummaries({
      manifests: manifestList,
      ...(allowlist !== undefined ? { allowlist } : {}),
      ...(denylist !== undefined ? { denylist } : {}),
      ...(skillsRoots !== undefined ? { skillsRoots } : {}),
    });
    skillToolNames = new Set(skills.flatMap((skill) => skill.toolNames));
  }

  let visibleTools = tools;
  if (exposure === 'skills' && pluginToolNames.size > 0) {
    visibleTools = tools.filter((tool) => !pluginToolNames.has(tool.name));
  } else if (exposure === 'mixed' && skillToolNames.size > 0) {
    visibleTools = tools.filter((tool) => !skillToolNames.has(tool.name));
  }

  return { visibleTools, skills, skillToolNames, pluginToolNames };
}
