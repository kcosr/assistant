# Content Blocks Design

## Overview

This document captures the output formats from Claude CLI and Codex CLI to inform the design of structured content blocks for tool calls, thinking, and results.

## Table of Contents

- [Overview](#overview)
- [Source files](#source-files)
- [Claude CLI Stream Format](#claude-cli-stream-format)
- [Codex CLI Stream Format](#codex-cli-stream-format)
- [Proposed Content Block Types](#proposed-content-block-types)
- [UI Rendering Guidelines](#ui-rendering-guidelines)
- [Implementation Notes](#implementation-notes)
- [Current Implementation Status](#current-implementation-status)
- [Related Issues](#related-issues)

## Source files

- `packages/agent-server/src/claudeCliChat.ts`
- `packages/agent-server/src/codexCliChat.ts`

## Claude CLI Stream Format

Claude CLI outputs newline-delimited JSON with `--output-format stream-json --verbose`.

### Streaming with `--include-partial-messages`

When `--include-partial-messages` is enabled, Claude CLI emits granular `stream_event` messages:

```json
{"type":"stream_event","event":{"type":"message_start","message":{...}}}
{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}}
{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Code"}}}
{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" flows"}}}
{"type":"stream_event","event":{"type":"content_block_stop","index":0}}
{"type":"stream_event","event":{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{...}}}
{"type":"stream_event","event":{"type":"message_stop"}}
```

Key streaming event types:

- `message_start` - Start of a new assistant message
- `content_block_start` - Start of a content block (text or tool_use)
- `content_block_delta` - Incremental content (text_delta or input_json_delta)
- `content_block_stop` - End of content block
- `message_delta` - Message-level updates (stop_reason, usage)
- `message_stop` - End of message

### Event Types

#### 1. System Init

```json
{
  "type": "system",
  "subtype": "init",
  "cwd": "/workspace",
  "session_id": "uuid",
  "tools": ["Bash", "Read", "Write", "Edit", "TodoWrite", ...],
  "model": "claude-opus-4-5-20251101",
  "permissionMode": "default"
}
```

#### 2. Assistant Message (with tool_use)

```json
{
  "type": "assistant",
  "message": {
    "model": "claude-opus-4-5-20251101",
    "id": "msg_...",
    "role": "assistant",
    "content": [
      {
        "type": "tool_use",
        "id": "toolu_...",
        "name": "Read",
        "input": { "file_path": "/path/to/file" }
      }
    ]
  },
  "session_id": "uuid"
}
```

#### 3. Tool Result (user message)

```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": [
      {
        "tool_use_id": "toolu_...",
        "type": "tool_result",
        "content": "file contents here..."
      }
    ]
  },
  "tool_use_result": {
    "type": "text",
    "file": {
      "filePath": "/path/to/file",
      "content": "...",
      "numLines": 100
    }
  }
}
```

#### 4. Assistant Message (text response)

```json
{
  "type": "assistant",
  "message": {
    "model": "claude-opus-4-5-20251101",
    "id": "msg_...",
    "role": "assistant",
    "content": [
      {
        "type": "text",
        "text": "Here is my response..."
      }
    ]
  }
}
```

#### 5. Result Summary

```json
{
  "type": "result",
  "subtype": "success",
  "is_error": false,
  "duration_ms": 8597,
  "num_turns": 2,
  "result": "Final text result...",
  "total_cost_usd": 0.16,
  "usage": { ... }
}
```

### Tool-Specific Payloads

#### Read Tool

```json
{
  "tool_use_result": {
    "type": "text",
    "file": {
      "filePath": "/path/to/file",
      "content": "line 1\nline 2\n...",
      "numLines": 100,
      "startLine": 1,
      "totalLines": 100
    }
  }
}
```

#### Bash Tool

```json
{
  "tool_use_result": {
    "stdout": "command output...",
    "stderr": "",
    "exitCode": 0
  }
}
```

#### TodoWrite Tool

```json
{
  "tool_use_result": {
    "oldTodos": [],
    "newTodos": [
      {
        "content": "Buy groceries",
        "status": "pending",
        "activeForm": "Buying groceries"
      }
    ]
  }
}
```

## Codex CLI Stream Format

Codex CLI outputs newline-delimited JSON with `--json`.

### Event Types

#### 1. Thread Started

```json
{
  "type": "thread.started",
  "thread_id": "uuid"
}
```

#### 2. Turn Started

```json
{
  "type": "turn.started"
}
```

#### 3. Reasoning (Thinking)

```json
{
  "type": "item.completed",
  "item": {
    "id": "item_0",
    "type": "reasoning",
    "text": "I'm thinking about how to approach this..."
  }
}
```

#### 4. Command Execution (Started)

```json
{
  "type": "item.started",
  "item": {
    "id": "item_1",
    "type": "command_execution",
    "command": "/bin/sh -lc 'ls | head -n 5'",
    "aggregated_output": "",
    "exit_code": null,
    "status": "in_progress"
  }
}
```

#### 5. Command Execution (Completed)

```json
{
  "type": "item.completed",
  "item": {
    "id": "item_1",
    "type": "command_execution",
    "command": "/bin/sh -lc 'ls | head -n 5'",
    "aggregated_output": "file1.txt\nfile2.txt\n...",
    "exit_code": 0,
    "status": "completed"
  }
}
```

#### 6. File Change

```json
{
  "type": "item.completed",
  "item": {
    "id": "item_2",
    "type": "file_change",
    "changes": [
      { "path": "/path/to/file.ts", "kind": "modify" },
      { "path": "/path/to/new.ts", "kind": "add" }
    ]
  }
}
```

#### 7. Agent Message

```json
{
  "type": "item.completed",
  "item": {
    "id": "item_3",
    "type": "agent_message",
    "text": "Here is my response..."
  }
}
```

#### 8. Turn Completed

```json
{
  "type": "turn.completed",
  "usage": {
    "input_tokens": 13073,
    "cached_input_tokens": 9472,
    "output_tokens": 68
  }
}
```

## Proposed Content Block Types

Based on the CLI outputs, here are the content block types we should support:

### 1. Text Block

Plain text or markdown content.

```typescript
interface TextBlock {
  type: 'text';
  text: string;
}
```

### 2. Thinking Block

Internal reasoning/planning (collapsible in UI).

```typescript
interface ThinkingBlock {
  type: 'thinking';
  text: string;
}
```

### 3. Tool Call Block

Tool invocation with name and input.

```typescript
interface ToolCallBlock {
  type: 'tool_call';
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
}
```

### 4. Tool Result Block

Result of a tool invocation.

```typescript
interface ToolResultBlock {
  type: 'tool_result';
  toolUseId: string;
  toolName: string;
  result: unknown; // Tool-specific payload
  isError?: boolean;
}
```

### 5. Code Block (extracted from tool results)

For file reads, command outputs, etc.

```typescript
interface CodeBlock {
  type: 'code';
  language?: string;
  filename?: string;
  content: string;
  startLine?: number;
  totalLines?: number;
}
```

### 6. File Change Block

For file modifications (write, edit, delete).

```typescript
interface FileChangeBlock {
  type: 'file_change';
  changes: Array<{
    path: string;
    kind: 'add' | 'modify' | 'delete';
    diff?: string; // Optional unified diff
  }>;
}
```

### 7. Command Block

Shell command execution with output.

```typescript
interface CommandBlock {
  type: 'command';
  command: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}
```

### 8. Todo Block

Task list (from TodoWrite tool).

```typescript
interface TodoBlock {
  type: 'todo';
  items: Array<{
    content: string;
    status: 'pending' | 'in_progress' | 'completed';
  }>;
}
```

## UI Rendering Guidelines

### Collapsible Sections

- **Thinking blocks**: Collapsed by default, show "Thinking..." indicator
- **Tool calls**: Show tool name and collapsed input
- **Tool results**: Collapsed by default for large outputs (>10 lines)

### Syntax Highlighting

- **Code blocks**: Use language hint from filename extension
- **Command output**: Use shell/terminal styling
- **JSON payloads**: Syntax highlight as JSON

### Visual Differentiation

- **Tool calls**: Left border accent, tool icon
- **Tool results**: Indented, muted background
- **Thinking**: Italic, dimmed text
- **File changes**: Color-coded (green add, yellow modify, red delete)

### Actions

- **Code blocks**: Copy button
- **File paths**: Click to open in editor (if available)
- **Commands**: Re-run button (with confirmation)

## Implementation Notes

### Provider Normalization

Each CLI provider should normalize its output to the common block types:

1. **Claude CLI** → Parse `tool_use`, `tool_result`, and `text` content
2. **Codex CLI** → Map `reasoning`, `command_execution`, `file_change`, `agent_message`
3. **OpenAI** → Extract from `tool_calls` and function results

### Storage

Blocks should be stored in the conversation log with full structure for replay/export.

### Streaming

For streaming responses:

- Text blocks can stream incrementally
- Tool call blocks appear when tool is invoked
- Tool result blocks appear when tool completes
- Thinking blocks can stream if the provider supports it

## Current Implementation Status

### Claude CLI Provider (`claudeCliChat.ts`)

**Handled:**

- `stream_event` → `content_block_delta` → `text_delta` (text streaming)
- `stream_event` → `content_block_delta` → `thinking_delta` (thinking blocks)
- `stream_event` → `content_block_start` → `tool_use` (tool calls)
- `stream_event` → `content_block_start` → `tool_result` (tool results)
- `assistant` → `content[].type: tool_use` (non-streaming tool calls)
- `user` → `content[].type: tool_result` (non-streaming tool results)
- `message` → `content[].type: text` (full text extraction)

**Not Yet Handled:**

- `input_json_delta` (streaming tool inputs)
- Usage/cost extraction from `result` events

### Codex CLI Provider (`codexCliChat.ts`)

**Handled:**

- `thread.started` (session ID extraction)
- `error` and `turn.failed` (error display)
- `item.started` → `command_execution` (shell command tool call)
- `item.completed` → `reasoning` (thinking block)
- `item.completed` → `agent_message` (response text)
- `item.completed` → `command_execution` (command output)
- `item.completed` → `file_change` (file modifications)

**Not Yet Handled:**

- `turn.completed` → `usage` (token usage stats)

### Gap Analysis

Both providers currently format output as markdown strings. The content blocks refactor will:

1. Return structured block objects instead of markdown
2. Extract tool-specific payloads (Read → file info, Bash → command info)
3. Enable UI to render blocks with appropriate controls (collapse, copy, etc.)

## Related Issues

- #404 - Structured content blocks for tool calls, thinking, and results (umbrella)
- #405 - Backend: Content block protocol and storage
- #406 - Providers: Normalize Claude/Codex CLI to content blocks
- #407 - Backend: Built-in tools emit content blocks
- #408 - Web: Content block rendering components
- #409 - Web: Block visibility toggles in chat toolbar
