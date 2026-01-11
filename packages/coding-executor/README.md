# @assistant/coding-executor

Core execution engine for coding tools (bash, read, write, edit, ls, find, grep).
This package provides the `ToolExecutor` interface and local implementation
used by the coding plugin.

## Table of Contents

- [Overview](#overview)
- [Source files](#source-files)
- [ToolExecutor Interface](#toolexecutor-interface)
- [Operations](#operations)
- [Truncation](#truncation)

## Overview

The coding executor provides safe, session-scoped file and command execution:

- **Session isolation**: Each session has its own workspace directory
- **Path traversal protection**: All paths are resolved within the workspace
- **Output truncation**: Large outputs are automatically truncated with metadata
- **Abort support**: Long-running operations can be cancelled via AbortSignal

## Source files

- `src/localExecutor.ts` - Local filesystem implementation
- `src/types.ts` - TypeScript interfaces and result types
- `src/utils/truncate.ts` - Output truncation utilities
- `src/utils/pathUtils.ts` - Path resolution and validation

## ToolExecutor Interface

```typescript
interface ToolExecutor {
  runBash(sessionId: string, command: string, options?: BashRunOptions): Promise<BashResult>;
  readFile(sessionId: string, path: string, options?: { offset?: number; limit?: number }): Promise<ReadResult>;
  writeFile(sessionId: string, path: string, content: string): Promise<WriteResult>;
  editFile(sessionId: string, path: string, oldText: string, newText: string): Promise<EditResult>;
  ls(sessionId: string, path?: string, options?: LsOptions): Promise<LsResult>;
  find(sessionId: string, options: FindOptions, abortSignal?: AbortSignal): Promise<FindResult>;
  grep(sessionId: string, options: GrepOptions, abortSignal?: AbortSignal): Promise<GrepResult>;
}
```

## Operations

### `runBash`

Execute a bash command in the session workspace.

**Options:**
- `timeoutSeconds` - Command timeout (default: 300)
- `onData` - Streaming callback for stdout/stderr chunks
- `abortSignal` - Cancel the command

**Result:**
- `ok` - Whether command succeeded (exit code 0)
- `output` - Combined stdout/stderr
- `exitCode` - Process exit code
- `timedOut` - True if command timed out
- `truncation` - Truncation metadata if output was truncated

### `readFile`

Read a text or image file from the workspace.

**Options:**
- `offset` - Line number to start from (1-indexed)
- `limit` - Maximum number of lines to read

**Result:**
- `type` - `"text"` or `"image"`
- `content` - File content (text files)
- `data` - Base64 encoded data (images)
- `mimeType` - MIME type (images)
- `totalLines` - Total line count
- `hasMore` - True if more lines available

### `writeFile`

Write content to a file, creating parent directories as needed.

**Result:**
- `ok` - Whether write succeeded
- `path` - Resolved path
- `bytes` - Bytes written

### `editFile`

Replace exact text in a file. The `oldText` must be unique in the file.

**Result:**
- `ok` - Whether edit succeeded
- `path` - Resolved path
- `diff` - Human-readable diff

### `ls`

List directory contents.

**Options:**
- `limit` - Maximum entries (default: 500)

**Result:**
- `output` - Newline-separated entries (directories have "/" suffix)
- `truncation` - Truncation metadata if list was truncated

### `find`

Find files by glob pattern. Uses `fd` when available, falls back to Node.js glob.

**Options:**
- `pattern` - Glob pattern (required)
- `path` - Search directory (default: workspace root)
- `limit` - Maximum results (default: 1000)

**Result:**
- `files` - Array of relative paths
- `truncated` - True if results were limited
- `limit` - Applied limit

### `grep`

Search file contents for a pattern. Uses ripgrep when available.

**Options:**
- `pattern` - Search pattern (required)
- `path` - Search directory (default: workspace root)
- `glob` - File glob filter
- `ignoreCase` - Case-insensitive search
- `literal` - Treat pattern as literal string
- `context` - Lines of context (default: 0)
- `limit` - Maximum matches (default: 100)

**Result:**
- `content` - Formatted match output
- `details` - Truncation and limit metadata

## Truncation

All operations that return potentially large outputs use the shared truncation utilities:

- **Head truncation** (`truncateHead`): Keeps the beginning, truncates the end
- **Tail truncation** (`truncateTail`): Keeps the end, truncates the beginning

Truncation metadata includes:
- `mode` - "head" or "tail"
- `originalBytes` - Original size before truncation
- `truncatedBytes` - Size after truncation
- `truncatedLines` - Lines after truncation (if applicable)

Default limits:
- **Bytes**: 50KB
- **Lines**: 2000
