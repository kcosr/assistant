// Types
export type {
  BashResult,
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
  ReadResultType,
  ToolExecutor,
  WriteResult,
} from './types';

// Implementation
export { LocalExecutor, type LocalExecutorOptions } from './localExecutor';

// Utils (re-exported for convenience)
export {
  truncateHead,
  truncateTail,
  truncateLine,
  formatSize,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  type TruncationResult,
  type TruncationOptions,
} from './utils/truncate';

export {
  getSessionWorkspaceRoot,
  ensureSessionWorkspace,
  resolvePathWithinSession,
  type SessionPathOptions,
} from './utils/pathUtils';
