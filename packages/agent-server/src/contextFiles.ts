import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { AgentDefinition, ContextFileSource } from './agents';

type ContextFileRecord = {
  relativePath: string;
  displayPath: string;
  absolutePath: string;
  realpath: string;
  content: string;
};

type SourceDiscovery = {
  rootPath: string;
  rootRealpath: string;
  files: Array<{
    relativePath: string;
    matchPath: string;
    absolutePath: string;
    realpath: string;
  }>;
};

const sourceDiscoveryCache = new Map<string, SourceDiscovery>();
const contextPromptCache = new Map<string, string>();

function expandHomeDir(input: string): string {
  if (input === '~') {
    return os.homedir();
  }
  if (input.startsWith('~/')) {
    return path.join(os.homedir(), input.slice(2));
  }
  return input;
}

function normalizePathForMatch(value: string): string {
  return value.split(path.sep).join('/');
}

function isInsideRoot(rootRealpath: string, targetRealpath: string): boolean {
  if (targetRealpath === rootRealpath) {
    return true;
  }
  const rootWithSep = rootRealpath.endsWith(path.sep) ? rootRealpath : `${rootRealpath}${path.sep}`;
  return targetRealpath.startsWith(rootWithSep);
}

function escapeRegex(char: string): string {
  return char.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function globToRegExp(pattern: string): RegExp {
  let source = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern.charAt(i);
    if (char === '*') {
      if (pattern[i + 1] === '*') {
        source += '.*';
        i += 1;
      } else {
        source += '[^/]*';
      }
      continue;
    }
    if (char === '?') {
      source += '[^/]';
      continue;
    }
    if (char === '/' || char === path.sep) {
      source += '/';
      continue;
    }
    source += escapeRegex(char);
  }
  return new RegExp(`^${source}$`);
}

function decodeUtf8File(filePath: string): string {
  let bytes: Uint8Array;
  try {
    bytes = fs.readFileSync(filePath);
  } catch (err) {
    throw new Error(`Failed to read context file "${filePath}": ${(err as Error).message}`);
  }

  if (bytes.includes(0)) {
    throw new Error(`Context file "${filePath}" appears to be binary`);
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/\r\n/g, '\n').trimEnd();
  } catch (err) {
    throw new Error(`Context file "${filePath}" is not valid UTF-8: ${(err as Error).message}`);
  }
}

function ensureDirectoryRoot(rootPath: string): { rootPath: string; rootRealpath: string } {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(rootPath);
  } catch (err) {
    throw new Error(`Context files root not found: "${rootPath}" (${(err as Error).message})`);
  }

  if (!stat.isDirectory()) {
    throw new Error(`Context files root must be a directory: "${rootPath}"`);
  }

  let rootRealpath: string;
  try {
    rootRealpath = fs.realpathSync(rootPath);
  } catch (err) {
    throw new Error(
      `Failed to resolve realpath for context files root "${rootPath}": ${(err as Error).message}`,
    );
  }

  return { rootPath, rootRealpath };
}

function collectFilesForSource(source: ContextFileSource): SourceDiscovery {
  const cached = sourceDiscoveryCache.get(source.root);
  if (cached) {
    return cached;
  }

  const { rootPath, rootRealpath } = ensureDirectoryRoot(source.root);
  const files: SourceDiscovery['files'] = [];

  const walkDirectory = (
    actualDirPath: string,
    relativeDir: string,
    activeRealpaths: Set<string>,
  ): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(actualDirPath, { withFileTypes: true });
    } catch (err) {
      throw new Error(
        `Failed to read context files directory "${actualDirPath}": ${(err as Error).message}`,
      );
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      const entryDisplayPath = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
      const entryFsPath = path.join(actualDirPath, entry.name);
      const displayPath = normalizePathForMatch(entryDisplayPath);

      if (entry.isFile()) {
        let entryRealpath: string;
        try {
          entryRealpath = fs.realpathSync(entryFsPath);
        } catch (err) {
          throw new Error(
            `Failed to resolve context file "${entryFsPath}": ${(err as Error).message}`,
          );
        }
        if (!isInsideRoot(rootRealpath, entryRealpath)) {
          throw new Error(`Context file "${entryDisplayPath}" resolves outside root "${rootPath}"`);
        }
        files.push({
          relativePath: entryDisplayPath,
          matchPath: displayPath,
          absolutePath: entryFsPath,
          realpath: entryRealpath,
        });
        continue;
      }

      if (entry.isDirectory()) {
        let dirRealpath: string;
        try {
          dirRealpath = fs.realpathSync(entryFsPath);
        } catch (err) {
          throw new Error(
            `Failed to resolve context files directory "${entryFsPath}": ${(err as Error).message}`,
          );
        }
        if (!isInsideRoot(rootRealpath, dirRealpath)) {
          throw new Error(
            `Context files directory "${entryDisplayPath}" resolves outside root "${rootPath}"`,
          );
        }
        if (activeRealpaths.has(dirRealpath)) {
          throw new Error(
            `Detected symlink cycle while scanning context files under "${rootPath}"`,
          );
        }
        activeRealpaths.add(dirRealpath);
        walkDirectory(dirRealpath, entryDisplayPath, activeRealpaths);
        activeRealpaths.delete(dirRealpath);
        continue;
      }

      if (entry.isSymbolicLink()) {
        let targetRealpath: string;
        try {
          targetRealpath = fs.realpathSync(entryFsPath);
        } catch (err) {
          throw new Error(
            `Failed to resolve context files symlink "${entryFsPath}": ${(err as Error).message}`,
          );
        }
        if (!isInsideRoot(rootRealpath, targetRealpath)) {
          throw new Error(
            `Context files symlink "${entryDisplayPath}" resolves outside root "${rootPath}"`,
          );
        }

        let targetStat: fs.Stats;
        try {
          targetStat = fs.statSync(targetRealpath);
        } catch (err) {
          throw new Error(
            `Failed to read context files symlink target "${entryFsPath}": ${(err as Error).message}`,
          );
        }

        if (targetStat.isFile()) {
          files.push({
            relativePath: entryDisplayPath,
            matchPath: displayPath,
            absolutePath: entryFsPath,
            realpath: targetRealpath,
          });
          continue;
        }

        if (targetStat.isDirectory()) {
          if (activeRealpaths.has(targetRealpath)) {
            throw new Error(
              `Detected symlink cycle while scanning context files under "${rootPath}"`,
            );
          }
          activeRealpaths.add(targetRealpath);
          walkDirectory(targetRealpath, entryDisplayPath, activeRealpaths);
          activeRealpaths.delete(targetRealpath);
        }
      }
    }
  };

  const activeRealpaths = new Set<string>([rootRealpath]);
  walkDirectory(rootRealpath, '', activeRealpaths);
  files.sort((a, b) => a.matchPath.localeCompare(b.matchPath));

  const discovery = { rootPath, rootRealpath, files };
  sourceDiscoveryCache.set(source.root, discovery);
  return discovery;
}

function resolveSourceFiles(source: ContextFileSource): ContextFileRecord[] {
  const discovery = collectFilesForSource(source);
  const seenRealpaths = new Set<string>();
  const resolved: ContextFileRecord[] = [];

  for (const includePattern of source.include) {
    const matcher = globToRegExp(normalizePathForMatch(includePattern));
    const matches = discovery.files.filter((file) => matcher.test(file.matchPath));
    if (matches.length === 0) {
      throw new Error(
        `Context files include pattern "${includePattern}" matched no files under "${source.root}"`,
      );
    }

    for (const match of matches) {
      if (seenRealpaths.has(match.realpath)) {
        continue;
      }
      seenRealpaths.add(match.realpath);
      resolved.push({
        relativePath: normalizePathForMatch(match.relativePath),
        displayPath: normalizePathForMatch(match.relativePath),
        absolutePath: match.absolutePath,
        realpath: match.realpath,
        content: decodeUtf8File(match.realpath),
      });
    }
  }

  return resolved;
}

function buildContextPrompt(records: ContextFileRecord[]): string {
  if (records.length === 0) {
    return '';
  }

  const sections: string[] = ['', '## Context Files', ''];
  records.forEach((record, index) => {
    if (index > 0) {
      sections.push('');
    }
    sections.push(`--- Context file: ${record.displayPath} ---`);
    sections.push(record.content);
    sections.push(`--- End context file: ${record.displayPath} ---`);
  });
  return sections.join('\n');
}

function getContextCacheKey(agent: AgentDefinition): string {
  return JSON.stringify({
    agentId: agent.agentId,
    contextFiles: agent.contextFiles,
  });
}

function resolveContextPrompt(agent: AgentDefinition): string {
  const sources = Array.isArray(agent.contextFiles) ? agent.contextFiles : [];
  if (sources.length === 0) {
    return '';
  }

  const records: ContextFileRecord[] = [];
  const seenRealpaths = new Set<string>();

  for (const source of sources) {
    for (const record of resolveSourceFiles(source)) {
      if (seenRealpaths.has(record.realpath)) {
        continue;
      }
      seenRealpaths.add(record.realpath);
      records.push(record);
    }
  }

  return buildContextPrompt(records);
}

export function normalizeContextFileSourcesForConfigDir(
  sources: ContextFileSource[] | undefined,
  configDir: string,
): ContextFileSource[] | undefined {
  if (!sources || sources.length === 0) {
    return undefined;
  }

  return sources.map((source) => {
    const expandedRoot = expandHomeDir(source.root);
    const resolvedRoot = path.isAbsolute(expandedRoot)
      ? path.normalize(expandedRoot)
      : path.resolve(configDir, expandedRoot);
    return {
      root: resolvedRoot,
      include: source.include.map((pattern) => pattern.trim()),
    };
  });
}

export function preloadContextFilesForAgents(agents: AgentDefinition[]): void {
  for (const agent of agents) {
    if (!agent.contextFiles || agent.contextFiles.length === 0) {
      continue;
    }
    const cacheKey = getContextCacheKey(agent);
    if (!contextPromptCache.has(cacheKey)) {
      contextPromptCache.set(cacheKey, resolveContextPrompt(agent));
    }
  }
}

export function buildContextFilesPrompt(agent: AgentDefinition | undefined): string {
  if (!agent?.contextFiles || agent.contextFiles.length === 0) {
    return '';
  }
  const cacheKey = getContextCacheKey(agent);
  const existing = contextPromptCache.get(cacheKey);
  if (existing !== undefined) {
    return existing;
  }
  const prompt = resolveContextPrompt(agent);
  contextPromptCache.set(cacheKey, prompt);
  return prompt;
}

export function clearContextFilesCachesForTests(): void {
  sourceDiscoveryCache.clear();
  contextPromptCache.clear();
}
