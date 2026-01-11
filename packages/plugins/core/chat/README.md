# Chat Plugin

Core plugin providing the chat transcript panel.

## Table of Contents

- [Overview](#overview)
- [Source files](#source-files)
- [Panel](#panel)

## Overview

The chat plugin provides the main chat interface panel where users interact with agents.
Each chat panel can be bound to a specific session or left unbound.

## Source files

- `packages/plugins/core/chat/manifest.json`
- `packages/plugins/core/chat/web/index.ts`

## Panel

### Type

`chat`

### Features

- Chat transcript display with streaming messages
- Message composer with text input
- Voice input support (when available)
- Tool output rendering with collapse/expand
- Thinking block display (when enabled)
- Session binding controls

### Capabilities

- `chat.read` - Read chat messages
- `chat.write` - Send messages

### Properties

| Property                | Value      | Description                        |
| ----------------------- | ---------- | ---------------------------------- |
| `multiInstance`         | `true`     | Multiple chat panels can be opened |
| `defaultSessionBinding` | `"fixed"`  | Bound to a session by default      |
| `sessionScope`          | `"optional"` | Session binding is optional        |
| `defaultPlacement`      | `center`   | Opens in the center region         |
