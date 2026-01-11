import type { TruncationResult } from './utils/truncate';

export interface BashResult {
  ok: boolean;
  output: string;
  exitCode: number;
  timedOut?: boolean;
  /**
   * Details about how the combined stdout/stderr output was truncated,
   * when truncation limits were applied.
   */
  truncation?: TruncationResult;
}

export interface BashRunOptions {
  timeoutSeconds?: number;
  onData?: (chunk: string, source?: 'stdout' | 'stderr') => void;
  /**
   * Optional abort signal to cancel the underlying bash process.
   * When aborted, executors should make a best effort to terminate
   * the child process and resolve promptly.
   */
  abortSignal?: AbortSignal;
}

export type ReadResultType = 'text' | 'image';

export interface ReadResult {
  type: ReadResultType;
  content?: string;
  data?: string;
  mimeType?: string;
  totalLines?: number;
  hasMore?: boolean;
  /**
   * Details about how the file content was truncated before returning
   * it to the tool caller, when applicable.
   */
  truncation?: TruncationResult;
}

export interface WriteResult {
  ok: boolean;
  path: string;
  bytes: number;
}

export interface EditResult {
  ok: boolean;
  path: string;
  diff: string;
}

export interface LsResult {
  /**
   * Newline-separated, truncated list of directory entries.
   * Each directory entry has a "/" suffix for directories.
   */
  output: string;
  /**
   * Details about how the directory listing text was truncated, when applicable.
   */
  truncation?: TruncationResult;
}

export interface LsOptions {
  limit?: number;
}

export interface FindOptions {
  pattern: string;
  path?: string;
  limit?: number;
}

export interface FindResult {
  files: string[];
  /**
   * Whether the result list was truncated either by the result limit or byte/line limits.
   */
  truncated: boolean;
  /**
   * The effective result limit that was applied (default: 1000).
   */
  limit: number;
  /**
   * Details about how the output string was truncated, if applicable.
   */
  truncation?: TruncationResult;
}

export interface GrepDetails {
  truncation?: TruncationResult;
  matchLimitReached?: number;
  linesTruncated?: boolean;
}

export interface GrepOptions {
  pattern: string;
  path?: string;
  glob?: string;
  ignoreCase?: boolean;
  literal?: boolean;
  context?: number;
  limit?: number;
}

export interface GrepResult {
  content: string;
  details?: GrepDetails;
}

export interface ToolExecutor {
  runBash(sessionId: string, command: string, options?: BashRunOptions): Promise<BashResult>;
  readFile(
    sessionId: string,
    path: string,
    options?: { offset?: number; limit?: number },
  ): Promise<ReadResult>;
  writeFile(sessionId: string, path: string, content: string): Promise<WriteResult>;
  editFile(sessionId: string, path: string, oldText: string, newText: string): Promise<EditResult>;
  ls(sessionId: string, path?: string, options?: LsOptions): Promise<LsResult>;
  find(sessionId: string, options: FindOptions, abortSignal?: AbortSignal): Promise<FindResult>;
  grep(sessionId: string, options: GrepOptions, abortSignal?: AbortSignal): Promise<GrepResult>;
}
