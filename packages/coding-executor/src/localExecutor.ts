import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { access, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { constants, readFileSync } from 'node:fs';
import path from 'node:path';

import * as Diff from 'diff';
import { globIterate } from 'glob';

import type {
  BashRunOptions,
  EditResult,
  FindOptions,
  FindResult,
  GrepDetails,
  GrepOptions,
  GrepResult,
  LsOptions,
  LsResult,
  ReadResult,
  ToolExecutor,
  WriteResult,
} from './types';
import { DEFAULT_MAX_BYTES, truncateHead, truncateLine, truncateTail } from './utils/truncate';
import { ensureSessionWorkspace, resolvePathWithinSession } from './utils/pathUtils';
import { ensureTool } from './utils/toolsManager';

export interface LocalExecutorOptions {
  workspaceRoot: string;
  allowOutsideWorkspaceRoot?: boolean;
}

const DEFAULT_FIND_LIMIT = 1000;

export class LocalExecutor implements ToolExecutor {
  private readonly workspaceRoot: string;
  private readonly allowOutsideWorkspaceRoot: boolean;

  constructor(options: LocalExecutorOptions) {
    this.workspaceRoot = options.workspaceRoot;
    this.allowOutsideWorkspaceRoot = options.allowOutsideWorkspaceRoot === true;
  }

  async ls(requestedPath?: string, options?: LsOptions): Promise<LsResult> {
    await ensureSessionWorkspace({
      workspaceRoot: this.workspaceRoot,
    });

    const sessionOptions = {
      workspaceRoot: this.workspaceRoot,
      allowOutsideWorkspaceRoot: this.allowOutsideWorkspaceRoot,
    };

    const effectivePath =
      typeof requestedPath === 'string' && requestedPath.trim().length > 0 ? requestedPath : '.';
    const dirPath = resolvePathWithinSession(sessionOptions, effectivePath);

    const stats = await stat(dirPath);
    if (!stats.isDirectory()) {
      throw new Error('Path is not a directory');
    }

    const limitFromOptions = options?.limit;
    const effectiveLimit =
      typeof limitFromOptions === 'number' &&
      Number.isFinite(limitFromOptions) &&
      limitFromOptions > 0
        ? limitFromOptions
        : 500;

    const entries = await readdir(dirPath, { withFileTypes: true });

    entries.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));

    const lines: string[] = [];
    for (const entry of entries) {
      if (lines.length >= effectiveLimit) {
        break;
      }

      const suffix = entry.isDirectory() ? '/' : '';
      lines.push(`${entry.name}${suffix}`);
    }

    if (lines.length === 0) {
      return { output: '(empty directory)' };
    }

    const rawOutput = lines.join('\n');
    const truncation = truncateHead(rawOutput);
    const output = truncation.content || '';
    const wasTruncated = truncation.truncated || truncation.firstLineExceedsLimit;

    return {
      output,
      ...(wasTruncated ? { truncation } : {}),
    };
  }

  async runBash(
    command: string,
    options?: BashRunOptions,
  ): Promise<{ ok: boolean; output: string; exitCode: number; timedOut?: boolean }> {
    const workspaceRoot = await ensureSessionWorkspace({
      workspaceRoot: this.workspaceRoot,
    });

    const abortSignal = options?.abortSignal;
    if (abortSignal?.aborted) {
      return {
        ok: false,
        output: '',
        exitCode: -1,
      };
    }

    const timeoutSeconds = options?.timeoutSeconds ?? 300;
    const timeoutMs = timeoutSeconds > 0 ? timeoutSeconds * 1000 : 0;
    const onData = options?.onData;

    return new Promise((resolve, reject) => {
      const child = spawn(command, {
        cwd: workspaceRoot,
        shell: true,
      });

      let stdout = '';
      let stderr = '';
      let finished = false;
      let timedOut = false;
      let aborted = false;
      let abortListener: (() => void) | undefined;

      const cleanup = () => {
        if (abortSignal && abortListener) {
          abortSignal.removeEventListener('abort', abortListener);
        }
      };

      const onError = (err: unknown) => {
        if (finished) return;
        finished = true;
        cleanup();
        reject(err);
      };

      child.on('error', onError);

      if (child.stdout) {
        child.stdout.setEncoding('utf-8');
        child.stdout.on('data', (chunk: string) => {
          stdout += chunk;
          if (onData) {
            onData(chunk, 'stdout');
          }
        });
      }
      if (child.stderr) {
        child.stderr.setEncoding('utf-8');
        child.stderr.on('data', (chunk: string) => {
          stderr += chunk;
          if (onData) {
            onData(chunk, 'stderr');
          }
        });
      }

      let timer: NodeJS.Timeout | undefined;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          if (finished) return;
          timedOut = true;
          child.kill();
        }, timeoutMs);
      }

      if (abortSignal) {
        abortListener = () => {
          if (finished || child.killed) {
            return;
          }
          aborted = true;
          child.kill('SIGTERM');
        };
        abortSignal.addEventListener('abort', abortListener, { once: true });
      }

      child.on('close', (code) => {
        if (timer) {
          clearTimeout(timer);
        }
        cleanup();
        if (finished) return;
        finished = true;

        const combined = [stdout, stderr].filter((v) => v && v.length > 0).join('\n');
        const truncation = truncateTail(combined);
        const output = truncation.content || '';

        const exitCode = typeof code === 'number' ? code : timedOut || aborted ? -1 : 0;
        const ok = exitCode === 0;

        resolve({
          ok,
          output,
          exitCode,
          ...(timedOut ? { timedOut: true } : {}),
          ...(truncation.truncated || truncation.firstLineExceedsLimit ? { truncation } : {}),
        });
      });
    });
  }

  async readFile(filePath: string, options?: { offset?: number; limit?: number }): Promise<ReadResult> {
    await ensureSessionWorkspace({
      workspaceRoot: this.workspaceRoot,
    });
    const absolutePath = resolvePathWithinSession(
      { workspaceRoot: this.workspaceRoot, allowOutsideWorkspaceRoot: this.allowOutsideWorkspaceRoot },
      filePath,
    );

    const ext = path.extname(absolutePath).toLowerCase();
    const imageMime = getImageMimeType(ext);

    await access(absolutePath, constants.R_OK);

    if (imageMime) {
      const buffer = await readFile(absolutePath);
      const base64 = buffer.toString('base64');
      return {
        type: 'image',
        data: base64,
        mimeType: imageMime,
      };
    }

    const textContent = await readFile(absolutePath, 'utf-8');
    const allLines = textContent.split('\n');
    const totalLines = allLines.length;

    const offset = options?.offset ?? 1;
    if (offset < 1) {
      throw new Error('Offset must be >= 1');
    }

    const startIndex = offset - 1;
    if (startIndex >= allLines.length) {
      throw new Error(`Offset ${offset} is beyond end of file (${allLines.length} lines total)`);
    }

    let selectedContent: string;
    let userLimitedLines: number | undefined;
    if (options?.limit !== undefined) {
      const endIndex = Math.min(startIndex + options.limit, allLines.length);
      selectedContent = allLines.slice(startIndex, endIndex).join('\n');
      userLimitedLines = endIndex - startIndex;
    } else {
      selectedContent = allLines.slice(startIndex).join('\n');
    }

    const truncation = truncateHead(selectedContent);

    let content = truncation.content;
    let hasMore = false;

    if (truncation.firstLineExceedsLimit) {
      content = '';
      hasMore = true;
    } else if (truncation.truncated) {
      hasMore = true;
    } else if (userLimitedLines !== undefined && startIndex + userLimitedLines < allLines.length) {
      hasMore = true;
    }

    return {
      type: 'text',
      content,
      totalLines,
      hasMore,
      ...(truncation.truncated || truncation.firstLineExceedsLimit ? { truncation } : {}),
    };
  }

  async writeFile(filePath: string, content: string): Promise<WriteResult> {
    const workspaceRoot = await ensureSessionWorkspace({
      workspaceRoot: this.workspaceRoot,
    });
    const absolutePath = resolvePathWithinSession(
      { workspaceRoot: this.workspaceRoot, allowOutsideWorkspaceRoot: this.allowOutsideWorkspaceRoot },
      filePath,
    );
    const dir = path.dirname(absolutePath);

    await mkdir(dir, { recursive: true });
    await writeFile(absolutePath, content, 'utf-8');

    const bytes = Buffer.byteLength(content, 'utf-8');

    return {
      ok: true,
      path: path.relative(workspaceRoot, absolutePath) || '.',
      bytes,
    };
  }

  async editFile(filePath: string, oldText: string, newText: string): Promise<EditResult> {
    await ensureSessionWorkspace({
      workspaceRoot: this.workspaceRoot,
    });
    const absolutePath = resolvePathWithinSession(
      { workspaceRoot: this.workspaceRoot, allowOutsideWorkspaceRoot: this.allowOutsideWorkspaceRoot },
      filePath,
    );

    await access(absolutePath, constants.R_OK | constants.W_OK);

    const originalContent = await readFile(absolutePath, 'utf-8');

    if (!originalContent.includes(oldText)) {
      throw new Error(
        `Could not find the exact text in ${filePath}. The old text must match exactly including all whitespace and newlines.`,
      );
    }

    const occurrences = originalContent.split(oldText).length - 1;
    if (occurrences > 1) {
      throw new Error(
        `Found ${occurrences} occurrences of the text in ${filePath}. The text must be unique. Please provide more context to make it unique.`,
      );
    }

    const index = originalContent.indexOf(oldText);
    const newContent =
      originalContent.substring(0, index) +
      newText +
      originalContent.substring(index + oldText.length);

    if (originalContent === newContent) {
      throw new Error(
        `No changes made to ${filePath}. The replacement produced identical content. This might indicate an issue with special characters or the text not existing as expected.`,
      );
    }

    await writeFile(absolutePath, newContent, 'utf-8');

    const diff = generateDiffString(originalContent, newContent);

    return {
      ok: true,
      path: filePath,
      diff,
    };
  }
  async grep(options: GrepOptions, abortSignal?: AbortSignal): Promise<GrepResult> {
    const sessionOptions = {
      workspaceRoot: this.workspaceRoot,
      allowOutsideWorkspaceRoot: this.allowOutsideWorkspaceRoot,
    } as const;
    const sessionRoot = await ensureSessionWorkspace(sessionOptions);

    const pattern = options.pattern.trim();
    if (!pattern) {
      throw new Error('Missing required pattern');
    }

    const searchPathArg =
      typeof options.path === 'string' && options.path.trim().length > 0 ? options.path : '.';
    const searchTarget = resolvePathWithinSession(sessionOptions, searchPathArg);

    const searchStat = await stat(searchTarget);
    const isDirectory = searchStat.isDirectory();
    const contextValue = options.context && options.context > 0 ? options.context : 0;
    const effectiveLimit = Math.max(1, options.limit ?? 100);

    const rgPath = await ensureTool('rg', true);
    if (!rgPath) {
      const baseParams = {
        sessionRoot,
        searchTarget,
        isDirectory,
        pattern,
        options,
        contextValue,
        effectiveLimit,
      };
      return this.grepWithNodeFallback(abortSignal ? { ...baseParams, abortSignal } : baseParams);
    }

    const baseParams = {
      sessionRoot,
      searchTarget,
      isDirectory,
      pattern,
      rgPath,
      options,
      contextValue,
      effectiveLimit,
    };

    return this.grepWithRipgrep(abortSignal ? { ...baseParams, abortSignal } : baseParams);
  }

  private async grepWithRipgrep(params: {
    sessionRoot: string;
    searchTarget: string;
    isDirectory: boolean;
    pattern: string;
    rgPath: string;
    options: GrepOptions;
    contextValue: number;
    effectiveLimit: number;
    abortSignal?: AbortSignal;
  }): Promise<GrepResult> {
    const {
      sessionRoot,
      searchTarget,
      isDirectory,
      pattern,
      rgPath,
      options,
      contextValue,
      effectiveLimit,
      abortSignal,
    } = params;

    return new Promise<GrepResult>((resolve, reject) => {
      const formatPath = (filePath: string): string => {
        if (isDirectory) {
          const relative = path.relative(searchTarget, filePath);
          if (relative && !relative.startsWith('..')) {
            return relative.replace(/\\/g, '/');
          }
        }
        const relativeToSession = path.relative(sessionRoot, filePath);
        return (relativeToSession || path.basename(filePath)).replace(/\\/g, '/');
      };

      const fileCache = new Map<string, string[]>();
      const getFileLines = (filePath: string): string[] => {
        let lines = fileCache.get(filePath);
        if (!lines) {
          try {
            const content = readFileSyncUtf8(filePath);
            lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
          } catch {
            lines = [];
          }
          fileCache.set(filePath, lines);
        }
        return lines;
      };

      const args: string[] = ['--json', '--line-number', '--color=never', '--hidden'];

      if (options.ignoreCase) {
        args.push('--ignore-case');
      }
      if (options.literal) {
        args.push('--fixed-strings');
      }
      if (options.glob && options.glob.trim().length > 0) {
        args.push('--glob', options.glob);
      }

      args.push(pattern, searchTarget);

      const child = spawn(rgPath, args, {
        cwd: sessionRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const rl = createInterface({ input: child.stdout });

      let stderr = '';
      let matchCount = 0;
      let matchLimitReached = false;
      let linesTruncated = false;
      let killedDueToLimit = false;
      let aborted = false;
      let abortListener: (() => void) | undefined;

      const cleanup = () => {
        if (abortSignal && abortListener) {
          abortSignal.removeEventListener('abort', abortListener);
        }
      };

      if (abortSignal) {
        abortListener = () => {
          if (child.killed) {
            return;
          }
          aborted = true;
          child.kill('SIGTERM');
        };
        abortSignal.addEventListener('abort', abortListener, { once: true });
      }

      const outputLines: string[] = [];

      child.stderr?.setEncoding('utf-8');
      child.stderr?.on('data', (chunk: string) => {
        stderr += chunk;
      });

      const formatBlock = (filePath: string, lineNumber: number): string[] => {
        const relativePath = formatPath(filePath);
        const lines = getFileLines(filePath);
        if (!lines.length) {
          return [`${relativePath}:${lineNumber}: (unable to read file)`];
        }

        const block: string[] = [];
        const start = contextValue > 0 ? Math.max(1, lineNumber - contextValue) : lineNumber;
        const end =
          contextValue > 0 ? Math.min(lines.length, lineNumber + contextValue) : lineNumber;

        for (let current = start; current <= end; current += 1) {
          const lineText = lines[current - 1] ?? '';
          const sanitized = lineText.replace(/\r/g, '');
          const isMatchLine = current === lineNumber;

          const { text: truncatedText, wasTruncated } = truncateLine(sanitized);
          if (wasTruncated) {
            linesTruncated = true;
          }

          if (isMatchLine) {
            block.push(`${relativePath}:${current}: ${truncatedText}`);
          } else {
            block.push(`${relativePath}-${current}- ${truncatedText}`);
          }
        }

        return block;
      };

      rl.on('line', (line) => {
        if (!line.trim() || matchCount >= effectiveLimit) {
          return;
        }

        let event: unknown;
        try {
          event = JSON.parse(line) as unknown;
        } catch {
          return;
        }

        if (!event || typeof event !== 'object') {
          return;
        }

        const anyEvent = event as { type?: unknown; data?: unknown };
        if (anyEvent.type !== 'match') {
          return;
        }

        const data = anyEvent.data as {
          path?: { text?: string };
          line_number?: number;
        };

        const filePath = data?.path?.text;
        const lineNumber = data?.line_number;

        if (filePath && typeof lineNumber === 'number') {
          matchCount += 1;
          outputLines.push(...formatBlock(filePath, lineNumber));
        }

        if (matchCount >= effectiveLimit) {
          matchLimitReached = true;
          if (!child.killed) {
            killedDueToLimit = true;
            child.kill();
          }
        }
      });

      child.on('error', (error) => {
        rl.close();
        cleanup();
        reject(new Error(`Failed to run ripgrep: ${error.message}`));
      });

      child.on('close', (code) => {
        rl.close();
        cleanup();

        if (aborted) {
          resolve({ content: 'No matches found' });
          return;
        }

        if (!killedDueToLimit && code !== 0 && code !== 1) {
          const errorMsg = stderr.trim() || `ripgrep exited with code ${code}`;
          reject(new Error(errorMsg));
          return;
        }

        if (matchCount === 0) {
          resolve({ content: 'No matches found' });
          return;
        }

        const rawOutput = outputLines.join('\n');
        const truncation = truncateHead(rawOutput, {
          maxLines: Number.MAX_SAFE_INTEGER,
          maxBytes: DEFAULT_MAX_BYTES,
        });

        let output = truncation.content;
        const details: GrepDetails = {};
        const notices: string[] = [];

        if (matchLimitReached) {
          notices.push(
            `${effectiveLimit} matches limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`,
          );
          details.matchLimitReached = effectiveLimit;
        }

        if (truncation.truncated) {
          notices.push(`${DEFAULT_MAX_BYTES / 1024}KB limit reached`);
          details.truncation = truncation;
        }

        if (linesTruncated) {
          notices.push('Some lines truncated to 500 chars. Use read tool to see full lines');
          details.linesTruncated = true;
        }

        if (notices.length > 0) {
          output += `\n\n[${notices.join('. ')}]`;
        }

        const result: GrepResult = { content: output };
        if (Object.keys(details).length > 0) {
          result.details = details;
        }
        resolve(result);
      });
    });
  }

  private async grepWithNodeFallback(params: {
    sessionRoot: string;
    searchTarget: string;
    isDirectory: boolean;
    pattern: string;
    options: GrepOptions;
    contextValue: number;
    effectiveLimit: number;
    abortSignal?: AbortSignal;
  }): Promise<GrepResult> {
    const {
      sessionRoot,
      searchTarget,
      isDirectory,
      pattern,
      options,
      contextValue,
      effectiveLimit,
      abortSignal,
    } = params;

    const literal = options.literal === true;
    const ignoreCase = options.ignoreCase === true;
    const globPattern = options.glob && options.glob.trim().length > 0 ? options.glob.trim() : null;

    const matcher = createLineMatcher(pattern, { literal, ignoreCase });
    const globRegex = globPattern ? globToRegExp(globPattern) : null;

    const formatPath = (filePath: string): string => {
      if (isDirectory) {
        const relative = path.relative(searchTarget, filePath);
        if (relative && !relative.startsWith('..')) {
          return relative.replace(/\\/g, '/');
        }
      }
      const relativeToSession = path.relative(sessionRoot, filePath);
      return (relativeToSession || path.basename(filePath)).replace(/\\/g, '/');
    };

    const outputLines: string[] = [];
    let matchCount = 0;
    let matchLimitReached = false;
    let linesTruncated = false;

    const processFile = async (filePath: string): Promise<void> => {
      if (matchCount >= effectiveLimit) {
        return;
      }

      let content: string;
      try {
        content = await readFile(filePath, 'utf-8');
      } catch {
        return;
      }

      const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

      for (let index = 0; index < lines.length && matchCount < effectiveLimit; index += 1) {
        if (abortSignal?.aborted) {
          return;
        }

        const lineNumber = index + 1;
        const lineText = lines[index] ?? '';
        if (!matcher(lineText)) {
          continue;
        }

        matchCount += 1;

        const relativePath = formatPath(filePath);
        const start = contextValue > 0 ? Math.max(1, lineNumber - contextValue) : lineNumber;
        const end =
          contextValue > 0 ? Math.min(lines.length, lineNumber + contextValue) : lineNumber;

        for (let current = start; current <= end; current += 1) {
          const contextLine = lines[current - 1] ?? '';
          const sanitized = contextLine.replace(/\r/g, '');
          const isMatchLine = current === lineNumber;

          const { text: truncatedText, wasTruncated } = truncateLine(sanitized);
          if (wasTruncated) {
            linesTruncated = true;
          }

          if (isMatchLine) {
            outputLines.push(`${relativePath}:${current}: ${truncatedText}`);
          } else {
            outputLines.push(`${relativePath}-${current}- ${truncatedText}`);
          }
        }
      }
    };

    const walk = async (target: string): Promise<void> => {
      if (abortSignal?.aborted) {
        return;
      }
      const stats = await stat(target);
      if (stats.isDirectory()) {
        const entries = await readdir(target, { withFileTypes: true });
        for (const entry of entries) {
          const entryPath = path.join(target, entry.name);
          if (entry.isDirectory()) {
            if (entry.name === '.git' || entry.name === 'node_modules') {
              continue;
            }
            await walk(entryPath);
          } else if (entry.isFile()) {
            if (globRegex) {
              const relative = path
                .relative(isDirectory ? searchTarget : sessionRoot, entryPath)
                .replace(/\\/g, '/');
              if (!globRegex.test(relative)) {
                continue;
              }
            }
            await processFile(entryPath);
            if (matchCount >= effectiveLimit) {
              matchLimitReached = true;
              return;
            }
          }
        }
      } else if (stats.isFile()) {
        if (globRegex) {
          const relative = path
            .relative(isDirectory ? searchTarget : sessionRoot, target)
            .replace(/\\/g, '/');
          if (!globRegex.test(relative)) {
            return;
          }
        }
        await processFile(target);
        if (matchCount >= effectiveLimit) {
          matchLimitReached = true;
        }
      }
    };

    await walk(searchTarget);

    if (matchCount === 0) {
      return { content: 'No matches found' };
    }

    const rawOutput = outputLines.join('\n');
    const truncation = truncateHead(rawOutput, {
      maxLines: Number.MAX_SAFE_INTEGER,
      maxBytes: DEFAULT_MAX_BYTES,
    });

    let output = truncation.content;
    const details: GrepDetails = {};
    const notices: string[] = [];

    if (matchLimitReached) {
      notices.push(
        `${effectiveLimit} matches limit reached. Use limit=${effectiveLimit * 2} for more, or refine pattern`,
      );
      details.matchLimitReached = effectiveLimit;
    }

    if (truncation.truncated) {
      notices.push(`${DEFAULT_MAX_BYTES / 1024}KB limit reached`);
      details.truncation = truncation;
    }

    if (linesTruncated) {
      notices.push('Some lines truncated to 500 chars. Use read tool to see full lines');
      details.linesTruncated = true;
    }

    if (notices.length > 0) {
      output += `\n\n[${notices.join('. ')}]`;
    }

    const result: GrepResult = { content: output };
    if (Object.keys(details).length > 0) {
      result.details = details;
    }
    return result;
  }

  async find(options: FindOptions, abortSignal?: AbortSignal): Promise<FindResult> {
    await ensureSessionWorkspace({
      workspaceRoot: this.workspaceRoot,
    });

    const pattern = options.pattern;
    if (typeof pattern !== 'string' || !pattern.trim()) {
      throw new Error('pattern is required');
    }

    const rawSearchPath =
      options.path && options.path.trim().length > 0 ? options.path.trim() : '.';
    const searchDir = resolvePathWithinSession(
      { workspaceRoot: this.workspaceRoot, allowOutsideWorkspaceRoot: this.allowOutsideWorkspaceRoot },
      rawSearchPath,
    );

    const limit =
      typeof options.limit === 'number' && Number.isFinite(options.limit) && options.limit > 0
        ? Math.floor(options.limit)
        : DEFAULT_FIND_LIMIT;

    const fdPath = await ensureTool('fd', true);
    const hasPathSeparator = pattern.includes('/') || pattern.includes('\\');

    if (abortSignal?.aborted) {
      return createFindResultFromPaths([], limit);
    }

    let candidatePaths: string[];
    if (fdPath && !hasPathSeparator) {
      candidatePaths = await this.findWithFd(fdPath, searchDir, pattern, limit, abortSignal);
    } else {
      candidatePaths = await this.findWithGlob(searchDir, pattern, limit, abortSignal);
    }

    return createFindResultFromPaths(candidatePaths, limit);
  }

  private async findWithFd(
    fdPath: string,
    searchDir: string,
    pattern: string,
    limit: number,
    abortSignal?: AbortSignal,
  ): Promise<string[]> {
    const fdLimit = limit > 0 ? limit + 1 : DEFAULT_FIND_LIMIT;
    const args = ['--glob', '--color=never', '--hidden', '--max-results', String(fdLimit), pattern];

    return new Promise<string[]>((resolve, reject) => {
      const child = spawn(fdPath, args, {
        cwd: searchDir,
      });

      let stdout = '';
      let stderr = '';
      let aborted = false;
      let abortListener: (() => void) | undefined;

      const cleanup = () => {
        if (abortSignal && abortListener) {
          abortSignal.removeEventListener('abort', abortListener);
        }
      };

      if (abortSignal) {
        abortListener = () => {
          if (child.killed) {
            return;
          }
          aborted = true;
          child.kill('SIGTERM');
        };
        abortSignal.addEventListener('abort', abortListener, { once: true });
      }

      if (child.stdout) {
        child.stdout.setEncoding('utf-8');
        child.stdout.on('data', (chunk: string) => {
          stdout += chunk;
        });
      }
      if (child.stderr) {
        child.stderr.setEncoding('utf-8');
        child.stderr.on('data', (chunk: string) => {
          stderr += chunk;
        });
      }

      child.on('error', (err) => {
        cleanup();
        if (aborted) {
          resolve([]);
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        reject(new Error(`Failed to run fd: ${message}`));
      });

      child.on('close', (code) => {
        cleanup();

        if (aborted) {
          resolve([]);
          return;
        }

        const trimmedStdout = stdout.trim();
        const trimmedStderr = stderr.trim();

        if (typeof code === 'number' && code !== 0 && !trimmedStdout) {
          const message = trimmedStderr || `fd exited with code ${code}`;
          reject(new Error(message));
          return;
        }

        if (!trimmedStdout) {
          resolve([]);
          return;
        }

        const lines = trimmedStdout.split('\n');
        const files: string[] = [];
        for (const rawLine of lines) {
          const line = rawLine.replace(/\r$/, '').trim();
          if (!line) continue;
          files.push(line);
        }

        resolve(files);
      });
    });
  }

  private async findWithGlob(
    searchDir: string,
    pattern: string,
    limit: number,
    abortSignal?: AbortSignal,
  ): Promise<string[]> {
    try {
      const files: string[] = [];

      for await (const match of globIterate(pattern, {
        cwd: searchDir,
        dot: true,
        nodir: true,
      })) {
        if (abortSignal?.aborted) {
          break;
        }
        const line = match.replace(/\r$/, '').trim();
        if (!line) {
          continue;
        }
        files.push(line);
        if (files.length >= limit + 1) {
          break;
        }
      }
      return files;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to search files with glob pattern';
      throw new Error(`Failed to run glob search: ${message}`);
    }
  }
}

const IMAGE_MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

function getImageMimeType(ext: string): string | null {
  return IMAGE_MIME_TYPES[ext] ?? null;
}

function createFindResultFromPaths(paths: string[], limit: number): FindResult {
  if (paths.length === 0) {
    return {
      files: [],
      truncated: false,
      limit,
    };
  }

  const rawOutput = paths.join('\n');
  const truncation = truncateHead(rawOutput, { maxLines: limit });

  const content = truncation.content;
  const files = content
    ? content
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
    : [];

  const truncated = truncation.truncated || truncation.firstLineExceedsLimit;

  return {
    files,
    truncated,
    limit,
    ...(truncated ? { truncation } : {}),
  };
}

function generateDiffString(oldContent: string, newContent: string, contextLines = 4): string {
  const parts = Diff.diffLines(oldContent, newContent);
  const output: string[] = [];

  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');
  const maxLineNum = Math.max(oldLines.length, newLines.length);
  const lineNumWidth = String(maxLineNum).length;

  let oldLineNum = 1;
  let newLineNum = 1;
  let lastWasChange = false;

  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (!part) {
      continue;
    }
    const raw = part.value.split('\n');
    if (raw[raw.length - 1] === '') {
      raw.pop();
    }

    if (part.added || part.removed) {
      for (const line of raw) {
        if (part.added) {
          const lineNum = String(newLineNum).padStart(lineNumWidth, ' ');
          output.push(`+${lineNum} ${line}`);
          newLineNum += 1;
        } else {
          const lineNum = String(oldLineNum).padStart(lineNumWidth, ' ');
          output.push(`-${lineNum} ${line}`);
          oldLineNum += 1;
        }
      }
      lastWasChange = true;
    } else {
      const nextPartIsChange =
        i < parts.length - 1 && !!(parts[i + 1]?.added || parts[i + 1]?.removed);

      if (lastWasChange || nextPartIsChange) {
        let linesToShow = raw;
        let skipStart = 0;
        let skipEnd = 0;

        if (!lastWasChange) {
          skipStart = Math.max(0, raw.length - contextLines);
          linesToShow = raw.slice(skipStart);
        }

        if (!nextPartIsChange && linesToShow.length > contextLines) {
          skipEnd = linesToShow.length - contextLines;
          linesToShow = linesToShow.slice(0, contextLines);
        }

        if (skipStart > 0) {
          output.push(` ${''.padStart(lineNumWidth, ' ')} ...`);
          oldLineNum += skipStart;
          newLineNum += skipStart;
        }

        for (const line of linesToShow) {
          const lineNum = String(oldLineNum).padStart(lineNumWidth, ' ');
          output.push(` ${lineNum} ${line}`);
          oldLineNum += 1;
          newLineNum += 1;
        }

        if (skipEnd > 0) {
          output.push(` ${''.padStart(lineNumWidth, ' ')} ...`);
          oldLineNum += skipEnd;
          newLineNum += skipEnd;
        }
      } else {
        oldLineNum += raw.length;
        newLineNum += raw.length;
      }

      lastWasChange = false;
    }
  }

  return output.join('\n');
}

function readFileSyncUtf8(filePath: string): string {
  return readFileSync(filePath, 'utf-8');
}

function createLineMatcher(
  pattern: string,
  options: { literal: boolean; ignoreCase: boolean },
): (line: string) => boolean {
  if (options.literal) {
    const needle = options.ignoreCase ? pattern.toLowerCase() : pattern;
    return (line: string) => {
      const haystack = options.ignoreCase ? line.toLowerCase() : line;
      return haystack.includes(needle);
    };
  }

  const flags = options.ignoreCase ? 'i' : '';
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, flags);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid regex pattern: ${message}`);
  }
  return (line: string) => regex.test(line);
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .split('')
    .map((char) => {
      if (char === '*') {
        return '__GLOB_STAR__';
      }
      if (char === '?') {
        return '__GLOB_QM__';
      }
      return char.replace(/[-[\]{}()+.,\\^$|#\s]/g, '\\$&');
    })
    .join('');

  const withWildcards = escaped.replace(/__GLOB_STAR__/g, '.*').replace(/__GLOB_QM__/g, '.');

  return new RegExp(`^${withWildcards}$`);
}
