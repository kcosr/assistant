import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parse as parseYaml } from 'yaml';

import type { AgentDefinition, InstructionSkillSource } from './agents';

type DiscoveredInstructionSkill = {
  name: string;
  description: string;
  skillPath: string;
  baseDir: string;
  rootPath: string;
  body: string;
};

type RootDiscoveryResult = {
  rootSpec: string;
  rootPath: string;
  rootRealpath: string;
  skillsByName: Map<string, DiscoveredInstructionSkill>;
};

const rootCache = new Map<string, RootDiscoveryResult>();

function expandHomeDir(input: string): string {
  if (input === '~') {
    return os.homedir();
  }
  if (input.startsWith('~/')) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

function matchesGlob(value: string, pattern: string): boolean {
  if (pattern === '*') {
    return true;
  }
  const hasWildcards = pattern.includes('*') || pattern.includes('?');
  if (!hasWildcards) {
    return value === pattern;
  }
  // Escape regex special chars but keep "*" / "?" as globs.
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regexSource = escaped.replace(/\*/g, '.*').replace(/\?/g, '.');
  const regex = new RegExp(`^${regexSource}$`);
  return regex.test(value);
}

function anyMatch(name: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (matchesGlob(name, pattern)) {
      return true;
    }
  }
  return false;
}

function stripFrontmatter(fileContent: string): string {
  const trimmedStart = fileContent.trimStart();
  if (!trimmedStart.startsWith('---')) {
    return fileContent;
  }
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/m.exec(trimmedStart);
  if (!match) {
    return fileContent;
  }
  const body = match[2] ?? '';
  return body.replace(/^\r?\n/, '');
}

function isSkippableName(name: string): boolean {
  if (!name) {
    return true;
  }
  if (name === 'node_modules') {
    return true;
  }
  if (name.startsWith('.')) {
    return true;
  }
  return false;
}

function isInsideRoot(rootRealpath: string, targetRealpath: string): boolean {
  if (targetRealpath === rootRealpath) {
    return true;
  }
  const rootWithSep = rootRealpath.endsWith(path.sep) ? rootRealpath : `${rootRealpath}${path.sep}`;
  return targetRealpath.startsWith(rootWithSep);
}

function safeRealpath(p: string): string | null {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

function walkForSkillFiles(options: {
  rootRealpath: string;
  dirPath: string;
  visitedDirs: Set<string>;
  onSkillFile: (skillPath: string) => void;
  warn: (message: string) => void;
}): void {
  const { rootRealpath, dirPath, visitedDirs, onSkillFile, warn } = options;
  const dirReal = safeRealpath(dirPath);
  if (!dirReal) {
    warn(`Failed to resolve realpath for "${dirPath}"`);
    return;
  }
  if (!isInsideRoot(rootRealpath, dirReal)) {
    warn(`Skipping directory outside root: "${dirReal}"`);
    return;
  }
  if (visitedDirs.has(dirReal)) {
    return;
  }
  visitedDirs.add(dirReal);

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirReal, { withFileTypes: true });
  } catch (err) {
    warn(`Failed to read directory "${dirReal}": ${(err as Error).message}`);
    return;
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    const name = entry.name;
    if (isSkippableName(name)) {
      continue;
    }

    const entryPath = path.join(dirReal, name);

    if (entry.isFile() && name === 'SKILL.md') {
      onSkillFile(entryPath);
      continue;
    }

    if (entry.isDirectory()) {
      walkForSkillFiles({ rootRealpath, dirPath: entryPath, visitedDirs, onSkillFile, warn });
      continue;
    }

    if (entry.isSymbolicLink()) {
      const targetReal = safeRealpath(entryPath);
      if (!targetReal) {
        warn(`Skipping broken symlink "${entryPath}"`);
        continue;
      }
      if (!isInsideRoot(rootRealpath, targetReal)) {
        warn(`Skipping symlink target outside root: "${entryPath}" -> "${targetReal}"`);
        continue;
      }

      let stat: fs.Stats;
      try {
        stat = fs.statSync(targetReal);
      } catch (err) {
        warn(`Skipping unreadable symlink target "${entryPath}": ${(err as Error).message}`);
        continue;
      }

      if (stat.isFile() && name === 'SKILL.md') {
        onSkillFile(targetReal);
        continue;
      }

      if (stat.isDirectory()) {
        walkForSkillFiles({ rootRealpath, dirPath: targetReal, visitedDirs, onSkillFile, warn });
      }
    }
  }
}

function parseSkillFile(options: {
  rootPath: string;
  skillPath: string;
  warn: (message: string) => void;
}): DiscoveredInstructionSkill | null {
  const { rootPath, skillPath, warn } = options;
  let raw: string;
  try {
    raw = fs.readFileSync(skillPath, 'utf8');
  } catch (err) {
    warn(`Failed to read "${skillPath}": ${(err as Error).message}`);
    return null;
  }

  const trimmedStart = raw.trimStart();
  if (!trimmedStart.startsWith('---')) {
    warn(`Skipping "${skillPath}" (missing YAML frontmatter)`);
    return null;
  }

  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/m.exec(trimmedStart);
  if (!match) {
    warn(`Skipping "${skillPath}" (invalid YAML frontmatter block)`);
    return null;
  }

  const yamlText = match[1] ?? '';
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlText) ?? {};
  } catch (err) {
    warn(`Skipping "${skillPath}" (failed to parse YAML frontmatter): ${(err as Error).message}`);
    return null;
  }

  const meta = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  const nameRaw = typeof meta['name'] === 'string' ? meta['name'].trim() : '';
  const descriptionRaw = typeof meta['description'] === 'string' ? meta['description'].trim() : '';

  const baseDir = path.dirname(skillPath);
  const parentDirName = path.basename(baseDir);

  if (!descriptionRaw) {
    warn(`Skipping "${skillPath}" (missing or empty description)`);
    return null;
  }

  let name = nameRaw;
  if (!name) {
    name = parentDirName;
    warn(`Skill "${skillPath}" is missing frontmatter name; falling back to "${name}"`);
  } else if (name !== parentDirName) {
    warn(
      `Skill "${skillPath}" frontmatter name "${name}" does not match parent directory "${parentDirName}"`,
    );
  }

  const body = stripFrontmatter(raw).trimEnd();
  return {
    name,
    description: descriptionRaw,
    skillPath,
    baseDir,
    rootPath,
    body,
  };
}

function discoverRootSkills(options: { root: string; warn: (message: string) => void }): RootDiscoveryResult | null {
  const { root, warn } = options;
  const expanded = expandHomeDir(root);
  const rootPath = path.isAbsolute(expanded) ? expanded : path.resolve(process.cwd(), expanded);

  let stat: fs.Stats;
  try {
    stat = fs.statSync(rootPath);
  } catch {
    warn(`skills root not found: "${root}" (resolved to "${rootPath}")`);
    return null;
  }

  if (!stat.isDirectory()) {
    warn(`skills root must be a directory: "${root}" (resolved to "${rootPath}")`);
    return null;
  }

  const rootRealpath = safeRealpath(rootPath);
  if (!rootRealpath) {
    warn(`Failed to resolve root realpath: "${rootPath}"`);
    return null;
  }

  const skillsByName = new Map<string, DiscoveredInstructionSkill>();
  const seenSkillFiles = new Set<string>();

  const visitedDirs = new Set<string>();
  const skillFiles: string[] = [];
  walkForSkillFiles({
    rootRealpath,
    dirPath: rootRealpath,
    visitedDirs,
    onSkillFile: (skillPath) => {
      skillFiles.push(skillPath);
    },
    warn,
  });

  for (const skillPath of skillFiles) {
    const skillReal = safeRealpath(skillPath);
    if (!skillReal) {
      warn(`Skipping unreadable skill path "${skillPath}"`);
      continue;
    }
    if (!isInsideRoot(rootRealpath, skillReal)) {
      warn(`Skipping skill outside root: "${skillReal}"`);
      continue;
    }
    if (seenSkillFiles.has(skillReal)) {
      continue;
    }
    seenSkillFiles.add(skillReal);

    const parsed = parseSkillFile({ rootPath: rootRealpath, skillPath: skillReal, warn });
    if (!parsed) {
      continue;
    }
    if (skillsByName.has(parsed.name)) {
      const existing = skillsByName.get(parsed.name);
      warn(
        `Duplicate skill name "${parsed.name}" under root "${rootRealpath}"; keeping "${existing?.skillPath}" and skipping "${parsed.skillPath}"`,
      );
      continue;
    }
    skillsByName.set(parsed.name, parsed);
  }

  return {
    rootSpec: root,
    rootPath,
    rootRealpath,
    skillsByName,
  };
}

function getRootDiscovery(options: { root: string; warn: (message: string) => void }): RootDiscoveryResult | null {
  const { root, warn } = options;
  const expanded = expandHomeDir(root);
  const rootPath = path.isAbsolute(expanded) ? expanded : path.resolve(process.cwd(), expanded);

  const cacheKey = rootPath;
  const existing = rootCache.get(cacheKey);
  if (existing) {
    return existing;
  }

  const discovered = discoverRootSkills({ root, warn });
  if (!discovered) {
    return null;
  }

  rootCache.set(cacheKey, discovered);
  return discovered;
}

function normalizeSourceDefaults(source: InstructionSkillSource): { root: string; available: string[]; inline: string[] } {
  const root = source.root;
  const hasAvailable = Array.isArray(source.available) && source.available.length > 0;
  const hasInline = Array.isArray(source.inline) && source.inline.length > 0;
  if (!hasAvailable && !hasInline) {
    return { root, available: ['*'], inline: [] };
  }
  return {
    root,
    available: hasAvailable ? (source.available as string[]) : [],
    inline: hasInline ? (source.inline as string[]) : [],
  };
}

export function preloadInstructionSkillsForAgents(
  agents: AgentDefinition[],
  log: (level: 'warn', message: string) => void = (_level, message) => console.warn(message),
): void {
  for (const agent of agents) {
    const sources = Array.isArray(agent.skills) ? agent.skills : [];
    for (const source of sources) {
      const normalized = normalizeSourceDefaults(source);
      getRootDiscovery({
        root: normalized.root,
        warn: (message) => log('warn', `[skills] ${message}`),
      });
    }
  }
}

export function buildInstructionSkillsPrompt(
  agent: AgentDefinition,
  log: (level: 'warn', message: string) => void = (_level, message) => console.warn(message),
): string {
  const sources = Array.isArray(agent.skills) ? agent.skills : [];
  if (sources.length === 0) {
    return '';
  }

  const warn = (message: string) => log('warn', `[skills] ${message}`);

  const availableSelected: DiscoveredInstructionSkill[] = [];
  const inlineSelected: DiscoveredInstructionSkill[] = [];

  const selectedNamesAcrossSources = new Set<string>();

  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
    const sourceEntry = sources[sourceIndex];
    if (!sourceEntry) {
      continue;
    }
    const source = normalizeSourceDefaults(sourceEntry);
    const discovered = getRootDiscovery({ root: source.root, warn });
    if (!discovered) {
      continue;
    }

    const discoveredSkills = Array.from(discovered.skillsByName.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    const inlineMatches = source.inline.length > 0
      ? discoveredSkills.filter((skill) => anyMatch(skill.name, source.inline))
      : [];

    const inlineNames = new Set(inlineMatches.map((s) => s.name));

    const availableMatches = source.available.length > 0
      ? discoveredSkills.filter((skill) => anyMatch(skill.name, source.available))
      : [];

    for (const skill of availableMatches) {
      if (inlineNames.has(skill.name)) {
        warn(
          `Skill "${skill.name}" matched both available and inline in root "${source.root}"; inline wins`,
        );
      }
    }

    const filteredAvailable = availableMatches.filter((skill) => !inlineNames.has(skill.name));

    const noteCrossSourceDup = (skill: DiscoveredInstructionSkill) => {
      if (selectedNamesAcrossSources.has(skill.name)) {
        warn(
          `Skill "${skill.name}" was selected from multiple sources (including root "${source.root}")`,
        );
      }
      selectedNamesAcrossSources.add(skill.name);
    };

    for (const skill of filteredAvailable) {
      noteCrossSourceDup(skill);
      availableSelected.push(skill);
    }

    for (const skill of inlineMatches) {
      noteCrossSourceDup(skill);
      inlineSelected.push(skill);
    }

    // Warn about patterns that match nothing (Pi-like mismatch diagnostics).
    for (const pattern of source.available) {
      if (pattern && !availableMatches.some((s) => matchesGlob(s.name, pattern))) {
        warn(`available pattern "${pattern}" matched no skills under root "${source.root}"`);
      }
    }
    for (const pattern of source.inline) {
      if (pattern && !inlineMatches.some((s) => matchesGlob(s.name, pattern))) {
        warn(`inline pattern "${pattern}" matched no skills under root "${source.root}"`);
      }
    }
  }

  const blocks: string[] = [];

  if (availableSelected.length > 0) {
    const lines: string[] = ['<available_skills>'];
    for (const skill of availableSelected) {
      lines.push(
        '  <skill>',
        `    <name>${skill.name}</name>`,
        `    <description>${skill.description}</description>`,
        `    <location>${skill.skillPath}</location>`,
        '  </skill>',
      );
    }
    lines.push('</available_skills>');
    blocks.push(lines.join('\n'));
  }

  for (const skill of inlineSelected) {
    const lines: string[] = [
      `<skill name="${skill.name}" location="${skill.skillPath}">`,
      `References are relative to ${skill.baseDir}.`,
      '',
      skill.body,
      '</skill>',
    ];
    blocks.push(lines.join('\n'));
  }

  if (blocks.length === 0) {
    return '';
  }

  return ['', ...blocks].join('\n');
}
